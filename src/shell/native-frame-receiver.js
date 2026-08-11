// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/native-frame-receiver.js
//
// RECEIVE-ONLY consumer of a native FRAME SOCKET — how a natively-decoded source
// (live camera on 8899, video clip on 8900) reaches a webview that does NOT own
// the decode. Today that's the EXTERNAL DISPLAY view (output-view.js); with the
// shared-socket video path it's the main engine too. The producer owns the
// AVFoundation session and every control; this module just joins
// ws://127.0.0.1:<port> as a client (the frame server broadcasts to all
// connections), decodes the biplanar-YUV wire format, and paints an RGB canvas
// the engine samples like any drawable. No @capacitor/core, no plugin calls —
// plain WebSocket + WebGL2, so it runs in the plain external WKWebView.
//
// The three wire variants and their byte layout live in `shell/frame-header.js`,
// which is the only place those offsets are written down. This module cares about
// one distinction it makes: `stamped` is true for the VIDEO wire only, and that is
// what gates the motion runtime's master clock below.
// The mirror flag (front/selfie camera) arrives with the source payload — the
// sender bakes it into its own canvas the same way (uMirror).

import { createYuvRenderer } from './yuv-renderer.js';
import { parseFrameHeader } from './frame-header.js';

// `cap` bounds the RGB PREVIEW canvas's long edge. It does not reduce the decode or
// the wire, and since Build 504 it no longer bounds what the engine samples either —
// the engine takes the planes directly (`planeReader`) and applies its own cap. What
// is left here is the source-panel preview and the fallback for consumers that still
// read a drawable.
export function createNativeFrameReceiver({ port = 8899, mirror = false, cap = 0 } = {}) {
  const canvas = document.createElement('canvas');
  // a valid size BEFORE the first frame: the external view calls engine.setSource on this
  // canvas as soon as the socket opens (it no longer waits for a frame), and setSource
  // rejects a zero-sized source. The first real frame resizes it, and the planar path
  // re-derives the true aspect from the frame itself, so this placeholder never shows.
  canvas.width = 1280; canvas.height = 720;
  const renderer = createYuvRenderer(canvas);
  let ws = null;
  let latest = null;      // most recent YUV ArrayBuffer (painted on the render tick)
  let seq = 0;            // bumped per message — how a plane reader knows the frame is new
  let stopped = false;
  let pts = 0;            // clock of the most recently PAINTED frame (stamped wire only)
  let duration = 0;
  let painted = 0;
  // rolling counters — WHERE the frames are going. `arrived` is what the socket delivered,
  // `painted` is what actually reached the canvas: if arrived is healthy and painted is
  // not, the wall is on the GPU side, and if arrived itself is low the wall is the wire.
  let arrived = 0, winArrived = 0, winPainted = 0, winPaintMs = 0;
  let lastArrivalT = 0;
  const arrivalGaps = [];   // ms between socket messages — see ws.onmessage (B578)
  // WHY THE FRAMES STOPPED, WHICH IS A DIFFERENT QUESTION FROM WHETHER THEY DID (B584). Daniel's
  // B583 session had this client reading 0.0 in/s while the external view took 30/s from the SAME
  // socket, and there was no way to tell a closed connection from a starving one. The native
  // fan-out skips a client whose previous send is still in flight, and reaps one that has been
  // sending for 6s — two very different diagnoses that produced one identical symptom.
  let closes = 0, reconnects = 0, lastCloseT = 0;
  // frames handed to the ENGINE as raw planes (the fast path) — counted apart from the
  // preview blit so the report can say which one is actually carrying the picture
  let taken = 0, winTaken = 0;

  // Parse the wire header into a frame the blitters understand. Cheap and pure — the
  // engine calls this per render tick to get planes it can upload directly, so it must
  // not touch GL or the canvas. Returns null when nothing has arrived (or a stray
  // message came through), which callers read as "hold the last frame".
  function parseLatest() {
    const f = parseFrameHeader(latest);
    // `mirror` is this receiver's own knowledge (it comes with the source payload, not the
    // wire), so it is added here rather than by the shared parser.
    return f ? { ...f, mirror } : null;
  }

  // The clock advances with the frame that reaches a RENDER TARGET, not with arrival —
  // a reader asking "what time is the frame on screen?" gets the frame on screen. Both
  // consumers (the engine's planar upload and the preview blit) report through here,
  // so the clock keeps running whichever one a given mode actually uses.
  function noteClock(frame) {
    if (!frame.stamped) return;
    if (isFinite(frame.pts) && frame.pts >= 0) pts = frame.pts;        // 0 is a real position (head of the clip)
    if (isFinite(frame.duration) && frame.duration > 0) duration = frame.duration;  // 0 = not loaded yet; hold the last good value
  }

  // Paint the latest received frame into the RGB PREVIEW canvas. Called each render
  // tick (refreshFrame) so the YUV->RGB blit is synced to the render loop — one blit
  // per rendered frame, not one per socket message.
  function paintLatest() {
    const frame = parseLatest();
    if (!frame) return;
    noteClock(frame);
    // the blitter uploads the planes at their TRUE size and lets the viewport scale, so
    // a capped canvas is a downscale. (Allocating the plane textures at the CAPPED size
    // instead reads a top-left crop of the frame — what Build 500's cap actually did.)
    const scale = cap > 0 ? Math.min(1, cap / Math.max(frame.width, frame.height)) : 1;
    const cw = Math.max(2, Math.round(frame.width * scale)), ch = Math.max(2, Math.round(frame.height * scale));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const t0 = performance.now();
    renderer.draw(frame, cw, ch, mirror);
    winPaintMs += performance.now() - t0;
    painted++; winPainted++;
  }

  // RESOLVES ON THE SOCKET, NOT ON THE FIRST FRAME.
  //
  // It used to wait for a frame, on the reasoning that a frame proves both the transport
  // and a live decode. That conflates two things, and the conflation is what made the
  // broadcast fail from motion mode on a long 4K clip while succeeding from perform
  // (Daniel, B505): entering motion runs a thumbnail pass, and AVAssetImageGenerator
  // competing with the player stalls frame delivery for seconds on a 6:39 4K source. The
  // socket was open and healthy the whole time; only the frames were late. A hard 6s
  // deadline turned a temporary stall into a permanent "could not join the video stream".
  //
  // An open socket is the thing this call can actually assert. Frames arriving late are
  // normal and already handled — the engine holds its last frame until a new one lands.
  // The native side now reports the fan-out ("[FoldFrames:<port>] client ready — N
  // receiving"), which is where a genuinely dead stream shows up.
  // `requireFrame` picks which of the two assertions this call makes, and the choice is
  // about whether the caller HAS A FALLBACK. The main webview does (the `<video>` path),
  // and a decode that never produces a frame must fall back to it — that exact failure
  // shipped once already (B499's AVPlayerLooper output attached to an item that never
  // played). The external display has no fallback, so for it a stall must not be fatal.
  function start({ requireFrame = false, timeout = 10000 } = {}) {
    return new Promise((resolve, reject) => {
      let done = false;
      let attempt = 0;
      const finish = () => { if (!done) { done = true; resolve(); } };
      const connect = () => {
        if (stopped) return;
        try { ws = new WebSocket(`ws://127.0.0.1:${port}`); }
        catch (e) { if (!done) { done = true; reject(e); } return; }
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => {
          if (requireFrame) return;   // the caller wants proof of a live decode, not just a socket
          finish();
          // not fatal, but worth saying: an open socket with no traffic means the producer
          // is stalled rather than absent
          setTimeout(() => {
            if (!stopped && arrived === 0) console.warn(`[fold] joined port ${port} but no frames yet — the decode may be stalled`);
          }, 5000);
        };
        ws.onmessage = (ev) => {
          latest = ev.data;
          seq++;
          arrived++; winArrived++;
          // WHEN frames arrive, not just how many (B578). The external view's B577 reading showed
          // 30 arrivals per second reaching the screen as only 7 new pictures, which is only
          // possible if arrivals are BUNCHED — and this is the only place that can prove it,
          // because it runs on the socket event rather than at render time.
          {
            const at = performance.now();
            if (lastArrivalT) arrivalGaps.push(at - lastArrivalT);
            lastArrivalT = at;
            if (arrivalGaps.length > 300) arrivalGaps.shift();
          }
          if (arrived === 1) paintLatest();   // prime the preview canvas with real dimensions
          finish();
        };
        ws.onclose = () => {
          if (!done && !stopped && attempt < 6) { attempt++; ws = null; setTimeout(connect, 300); }
          // A CLOSE AFTER THE FIRST FRAME USED TO BE TERMINAL AND SILENT. Nothing reconnected and
          // nothing said so, so a reaped client left the app frozen on a still with every other
          // number in the report looking healthy (Daniel, B583: app fps 42.5, both panels drawing
          // 43x/s, source at 0.0 in/s). The rejoin is deliberately LOUD — `reconnects` rides the
          // report — because a rescue that reads as normal operation aims the next build wrong.
          if (done && !stopped) {
            closes++;
            lastCloseT = performance.now();
            ws = null;
            // backoff, capped: the producer may genuinely be gone (stop, teardown, source swap)
            if (closes <= 8) setTimeout(() => { if (!stopped && !ws) { reconnects++; connect(); } }, Math.min(2000, 200 * closes));
          }
        };
      };
      connect();
      setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error(requireFrame
          ? `no native frames on port ${port} (nothing streaming)`
          : `could not open port ${port} (ws blocked or nothing listening)`));
      }, timeout);
    });
  }

  function stop() {
    stopped = true;
    try { ws?.close(); } catch { /* already closed */ }
    ws = null;
    latest = null;
  }

  return {
    start,
    stop,
    refreshFrame: paintLatest,
    frameSource: () => canvas,
    // THE FAST PATH: hand the raw planes to whoever is going to render them, so the
    // pixels never make a round trip through another context's canvas. Counts as a
    // painted frame — it IS the frame that reaches the screen on this path.
    // One reader PER CONSUMING ENGINE (preview, output bus, PiP, the external view).
    // Each tracks the last message it has seen and returns null when nothing new has
    // arrived, which its engine reads as "hold the last frame" — so a 60Hz render loop
    // on a 30fps clip does 30 uploads, not 60, and three engines don't starve each
    // other by racing a single shared cursor.
    planeReader() {
      let lastSeq = -1;
      return () => {
        if (seq === lastSeq) return null;
        const frame = parseLatest();
        if (!frame) return null;
        lastSeq = seq;
        noteClock(frame);
        taken++; winTaken++;
        return frame;
      };
    },
    get port() { return port; },
    // clock readouts — meaningful only on the stamped ("FYUW") video socket
    get pts() { return pts; },
    get duration() { return duration; },
    get framesPainted() { return painted + taken; },
    get framesArrived() { return arrived; },
    // THE STATE OF THE PIPE ITSELF, not of the pictures in it (B584). `msSinceFrame` is the one
    // that ends the ambiguity fastest: a socket that is OPEN with a large gap is being SKIPPED by
    // the fan-out, and one that is CLOSED was reaped or torn down. Those need opposite fixes.
    socketState() {
      const rs = ws ? ws.readyState : -1;
      return {
        readyState: rs,
        open: rs === 1,
        state: rs === 0 ? 'connecting' : rs === 1 ? 'open' : rs === 2 ? 'closing' : rs === 3 ? 'closed' : 'none',
        msSinceFrame: lastArrivalT ? Math.round(performance.now() - lastArrivalT) : -1,
        msSinceClose: lastCloseT ? Math.round(performance.now() - lastCloseT) : -1,
        closes, reconnects, arrived,
      };
    },
    // The DISTRIBUTION of arrival intervals, consumed and reset by the caller. Measured on the
    // socket event, so it is independent of whatever the render loop is doing — which is the
    // whole point: it separates "frames arrive in bursts" from "we render in bursts", and those
    // two have entirely different fixes.
    arrivalSpread() {
      const a = arrivalGaps.slice().sort((x, y) => x - y);
      arrivalGaps.length = 0;
      if (!a.length) return null;
      const p = (q) => Math.round(a[Math.min(a.length - 1, Math.max(0, Math.round((q / 100) * (a.length - 1))))]);
      return { p50: p(50), p95: p(95), max: Math.round(a[a.length - 1]), n: a.length };
    },
    // consume + reset the rolling window (the caller owns the reporting cadence)
    takeStats() {
      const s = {
        arrived: winArrived,
        painted: winPainted,
        taken: winTaken,
        paintMs: winPainted ? winPaintMs / winPainted : 0,
      };
      winArrived = 0; winPainted = 0; winTaken = 0; winPaintMs = 0;
      return s;
    },
  };
}
