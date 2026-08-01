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
// TWO WIRE VARIANTS, one parser (see FrameSocketServer.swift in each plugin):
//   "FYUV" — 24-byte header, CLOCKLESS. The camera: a live stream, "now" is the
//            only time there is.
//   "FYUW" — 40-byte header = the same fields + f64 pts + f64 duration (seconds).
//            The video decode, which OWNS the motion runtime's master clock:
//            `pts`/`duration` below answer currentTime/duration off the frame we
//            are about to paint, with no per-frame bridge round-trip. A duration
//            of 0 means "not known yet" and holds the last good value rather than
//            collapsing the timeline.
// The mirror flag (front/selfie camera) arrives with the source payload — the
// sender bakes it into its own canvas the same way (uMirror).

import { createYuvRenderer } from './yuv-renderer.js';

const MAGIC_PLAIN = 0x46595556;    // "FYUV" — camera, clockless, 24-byte header
const MAGIC_STAMPED = 0x46595557;  // "FYUW" — video, + pts/duration, 40-byte header

// `cap` bounds the RGB canvas's long edge. It does NOT reduce the decode or the wire —
// it bounds what the ENGINE then has to upload from this canvas, which at 4K is a 33MB
// cross-context texture copy per frame. Diagnostics knob, off by default: this is the
// leading suspect for the fixed-cadence stutter but it is a TRADE (source detail for
// throughput), so it stays measurable rather than assumed.
export function createNativeFrameReceiver({ port = 8899, mirror = false, cap = 0 } = {}) {
  const canvas = document.createElement('canvas');
  const renderer = createYuvRenderer(canvas);
  let ws = null;
  let latest = null;      // most recent YUV ArrayBuffer (painted on the render tick)
  let stopped = false;
  let pts = 0;            // clock of the most recently PAINTED frame (stamped wire only)
  let duration = 0;
  let painted = 0;
  // rolling counters — WHERE the frames are going. `arrived` is what the socket delivered,
  // `painted` is what actually reached the canvas: if arrived is healthy and painted is
  // not, the wall is on the GPU side, and if arrived itself is low the wall is the wire.
  let arrived = 0, winArrived = 0, winPainted = 0, winPaintMs = 0;

  // Paint the latest received frame into the RGB canvas. Called each render
  // tick (refreshFrame) so the YUV->RGB blit is synced to the render loop —
  // one blit per rendered frame, not one per socket message.
  function paintLatest() {
    if (!latest) return;
    const dv = new DataView(latest);
    const magic = dv.getUint32(0, false);
    if (magic !== MAGIC_PLAIN && magic !== MAGIC_STAMPED) return;
    const width = dv.getUint32(4, true);
    const height = dv.getUint32(8, true);
    const yStride = dv.getUint32(12, true);
    const cStride = dv.getUint32(16, true);
    const cHeight = dv.getUint32(20, true);
    let head = 24;
    if (magic === MAGIC_STAMPED) {
      // the clock advances with the PAINT, not with arrival — a reader asking
      // "what time is the frame on screen?" gets the frame on screen
      const t = dv.getFloat64(24, true);
      const d = dv.getFloat64(32, true);
      if (isFinite(t) && t >= 0) pts = t;      // 0 is a real position (head of the clip)
      if (isFinite(d) && d > 0) duration = d;  // 0 = not loaded yet; hold the last good value
      head = 40;
    }
    const ySize = yStride * height;
    const cSize = cStride * cHeight;
    const yPlane = new Uint8Array(latest, head, ySize);
    const cPlane = new Uint8Array(latest, head + ySize, cSize);
    // the renderer sets its viewport from the dims it's handed, so a capped canvas simply
    // scales the same full-screen quad down — no separate resample pass
    const scale = cap > 0 ? Math.min(1, cap / Math.max(width, height)) : 1;
    const cw = Math.max(1, Math.round(width * scale)), ch = Math.max(1, Math.round(height * scale));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const t0 = performance.now();
    renderer.draw(cw, ch, yStride, cStride, yPlane, cPlane, mirror);
    winPaintMs += performance.now() - t0;
    painted++; winPainted++;
  }

  // resolves on the FIRST frame (proves the socket + a live stream), with the
  // same retry posture as the camera module (the server may bind a beat late)
  function start() {
    return new Promise((resolve, reject) => {
      let done = false;
      let attempt = 0;
      const connect = () => {
        if (stopped) return;
        try { ws = new WebSocket(`ws://127.0.0.1:${port}`); }
        catch (e) { if (!done) { done = true; reject(e); } return; }
        ws.binaryType = 'arraybuffer';
        ws.onmessage = (ev) => {
          latest = ev.data;
          arrived++; winArrived++;
          if (!done) { done = true; paintLatest(); resolve(); }
        };
        ws.onclose = () => {
          if (!done && !stopped && attempt < 6) { attempt++; ws = null; setTimeout(connect, 300); }
        };
      };
      connect();
      setTimeout(() => {
        if (!done) { done = true; reject(new Error(`no native frames on port ${port} (ws blocked or nothing streaming)`)); }
      }, 6000);
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
    get port() { return port; },
    // clock readouts — meaningful only on the stamped ("FYUW") video socket
    get pts() { return pts; },
    get duration() { return duration; },
    get framesPainted() { return painted; },
    get framesArrived() { return arrived; },
    // consume + reset the rolling window (the caller owns the reporting cadence)
    takeStats() {
      const s = { arrived: winArrived, painted: winPainted, paintMs: winPainted ? winPaintMs / winPainted : 0 };
      winArrived = 0; winPainted = 0; winPaintMs = 0;
      return s;
    },
  };
}
