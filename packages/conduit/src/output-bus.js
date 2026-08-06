// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// stage/output-bus.js
//
// "One program frame, many sinks." The spine of the live-output path. When
// running, a paced loop renders ONE frame at the chosen output resolution
// through the engine adapter (engine-agnostic — see engine-adapter.js) and fans
// that single frame to every registered sink: record-to-disk now; Syphon and an
// output-only window via the Electron shell later. The perform UI doesn't care
// which sinks are active — it talks to the bus, the bus talks to the adapter.
//
// Knows NOTHING about kaleidoscopes. Owns output settings { width, height,
// aspect } (live-performance settings, decoupled from the display canvas and from
// still/video export), a measured fps, and an editable server name (for Syphon).
// Idle = stopped (no rAF burned when nothing is being output).
//
// Each registered sink is { id: string, publish(frame) } — publish is called once
// per frame with the shared Frame (raw bottom-up RGBA + timings). A sink may carry
// extra controls (the recorder has start/stop/recording); the bus only ever calls
// publish. Per-frame timings are aggregated into one op:'live-output' record per
// ~second and pushed to diag.ops — the unified diagnostics substrate the status
// chrome and the copy-diagnostics report both read. This is also what settles the
// Chromium-perf question with data rather than vibes.

import { createTestFrame } from './test-pattern.js';

const round1 = (n) => Math.round(n * 10) / 10;

export function createOutputBus({ engineAdapter, host = null, diag = null } = {}) {
  if (!engineAdapter || typeof engineAdapter.renderFrameAt !== 'function') {
    throw new Error('createOutputBus requires an engineAdapter with renderFrameAt');
  }

  // Output settings. Default to the spike's proven-viable square (1920²,
  // ~95fps on Apple Silicon); never default to square 4K (not viable). The
  // resolution/aspect picker that changes these safely lands in Increment 3.
  let width = 1920;
  let height = 1920;
  let aspect = width / height;
  let serverName = 'Fold';

  let running = false;
  let raf = 0;
  let testPattern = false;   // publish a known reference frame instead of the program
  let lastError = null;      // last render failure (surfaced via getStatus so the panel can report it)

  const sinks = new Map();   // id -> sink

  // fps + op-record window accumulators (reset each ~1s window).
  let fps = 0;
  let winStart = 0, winFrames = 0, winRender = 0, winRead = 0, winPublish = 0, winReused = 0;

  // IDLE ELISION state. `frameSignature()` is OPTIONAL on the adapter — an adapter that does
  // not implement it never elides, so this is additive for every existing consumer.
  let lastFrame = null, lastSig = null, pendingSig = null;

  // Dimensions are part of the identity: a resolution change must re-render even if the look
  // did not move, or the sinks keep receiving a frame at the old size.
  function canReuseLastFrame() {
    // pendingSig is recomputed on EVERY call, including the ones that cannot elide, because the
    // render path stores it as the new identity — leaving a stale value here would let a later
    // frame match a signature it never actually rendered.
    pendingSig = null;
    if (typeof engineAdapter.frameSignature !== 'function') return false;
    let sig;
    try { sig = engineAdapter.frameSignature(); } catch { return false; }
    if (sig == null) return false;                       // adapter says "assume it changed"
    pendingSig = `${sig}|${width}x${height}`;
    return !!lastFrame && pendingSig === lastSig && lastFrame.w === width && lastFrame.h === height;
  }

  function resetWindow(now) {
    winStart = now; winFrames = 0; winRender = 0; winRead = 0; winPublish = 0; winReused = 0;
  }

  function flushOpRecord(now) {
    const elapsed = now - winStart;
    if (!diag?.ops || winFrames === 0) { resetWindow(now); return; }
    fps = round1((winFrames * 1000) / elapsed);
    // per-frame costs are averaged over the frames that actually DID the work, so an elided
    // window reports what a rendered frame costs rather than a figure diluted by the skips
    const rendered = Math.max(1, winFrames - winReused);
    diag.ops.push({
      op: 'live-output',
      t: Date.now(),
      w: width, h: height,
      frames: winFrames,
      reused: winReused,          // frames republished without a re-render (idle elision)
      windowMs: Math.round(elapsed),
      throughputFps: fps,
      perFrameMs: {
        render: round1(winRender / rendered),
        read: round1(winRead / rendered),
        publish: round1(winPublish / winFrames),
      },
      sinks: [...sinks.keys()],
      serverName,
    });
    resetWindow(now);
  }

  // Self-rescheduling async frame. renderFrameAt awaits the GPU fence + readback,
  // so frames never overlap and the loop naturally paces to render-rate (capped
  // by the display's rAF cadence). If the engine has no source yet, renderFrameAt
  // throws — we stop quietly rather than spin on errors.
  async function frame() {
    if (!running) return;
    let f, reused = false;
    if (testPattern) {
      // diagnostic: a static, cached reference frame (no engine, no source needed)
      f = createTestFrame(width, height);
    } else if (canReuseLastFrame()) {
      // IDLE ELISION: the program is provably unchanged, so skip the render AND the readback
      // (historically the most expensive thing in the app) and republish what we already have.
      // We deliberately still PUBLISH: sinks are not all idempotent about silence — a recorder
      // needs a frame per interval to keep its timeline honest, and a network receiver told
      // nothing may decide the sender went away. The saving is the expensive half, not the wire.
      f = lastFrame;
      reused = true;
      winReused += 1;
    } else {
      try {
        f = await engineAdapter.renderFrameAt(width, height);
        lastFrame = f;
        lastSig = pendingSig;
      } catch (e) {
        // Render failed (most likely the output engine couldn't create its GL
        // context). Record + log the reason, then stop — getStatus().error lets the
        // output panel surface it instead of the broadcast dying silently.
        lastError = e;
        console.warn('[fold] output bus render failed — stopping:', e);
        stop();
        return;
      }
      if (!running) return;   // could have been stopped during the await
    }

    let publishMs = 0;
    for (const sink of sinks.values()) {
      const p0 = performance.now();
      try { sink.publish(f); } catch (e) { console.warn(`output sink "${sink.id}" publish failed`, e); }
      publishMs += performance.now() - p0;
    }

    const now = performance.now();
    winFrames += 1;
    // a reused frame carries the timings of the frame that PRODUCED it — counting them again
    // would report work we deliberately skipped
    if (!reused) { winRender += f.renderMs || 0; winRead += f.readMs || 0; }
    winPublish += publishMs;
    if (now - winStart >= 1000) flushOpRecord(now);

    if (running) raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    lastError = null;          // fresh attempt — clear any prior failure
    running = true;
    dropCachedFrame();         // a new session never republishes the previous one's last frame
    resetWindow(performance.now());
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (!running) return;
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    fps = 0;
    dropCachedFrame();
  }

  // Anything that invalidates the cached frame's identity in a way the SIGNATURE cannot see
  // (a resolution change, a test-pattern swap, a fresh session) drops it outright. The
  // signature covers the program's look; this covers the frame's shape and provenance.
  function dropCachedFrame() { lastFrame = null; lastSig = null; pendingSig = null; }

  return {
    // register a sink { id, publish(frame) }. Returns the sink so callers can
    // keep a handle to its extra controls (e.g. the recorder's start/stop).
    registerSink(sink) {
      if (!sink || !sink.id || typeof sink.publish !== 'function') {
        throw new Error('a sink must be { id, publish(frame) }');
      }
      sinks.set(sink.id, sink);
      return sink;
    },
    unregisterSink(id) { sinks.delete(id); },
    getSink(id) { return sinks.get(id) || null; },

    start,
    stop,

    setResolution({ width: w, height: h }) {
      if (w > 0) width = Math.round(w);
      if (h > 0) height = Math.round(h);
      aspect = width / height;
      dropCachedFrame();
    },
    setServerName(name) { serverName = String(name || 'Fold'); },

    // Diagnostic: when on, the loop publishes a known reference frame (test-pattern.js)
    // instead of the program — to verify orientation/scale/color downstream (Arena, a
    // recording). Takes effect on the next frame; no source required.
    setTestPattern(on) { testPattern = !!on; dropCachedFrame(); },

    getStatus() {
      return {
        running,
        // broadcasting = the bus is live AND a Syphon host is publishing. False on
        // plain web (no native host); true once the Electron host's syphon is up.
        broadcasting: running && !!(host && host.syphon && host.syphon.available),
        fps,
        width, height, aspect,
        serverName,
        testPattern,
        sinks: [...sinks.keys()],
        // a render failure that stopped the bus (null when healthy); the panel reports it
        error: lastError ? (lastError.message || String(lastError)) : null,
      };
    },

    get width() { return width; },
    get height() { return height; },
    get running() { return running; },
  };
}
