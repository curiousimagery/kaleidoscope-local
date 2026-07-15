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
  let winStart = 0, winFrames = 0, winRender = 0, winRead = 0, winPublish = 0;

  function resetWindow(now) {
    winStart = now; winFrames = 0; winRender = 0; winRead = 0; winPublish = 0;
  }

  function flushOpRecord(now) {
    const elapsed = now - winStart;
    if (!diag?.ops || winFrames === 0) { resetWindow(now); return; }
    fps = round1((winFrames * 1000) / elapsed);
    diag.ops.push({
      op: 'live-output',
      t: Date.now(),
      w: width, h: height,
      frames: winFrames,
      windowMs: Math.round(elapsed),
      throughputFps: fps,
      perFrameMs: {
        render: round1(winRender / winFrames),
        read: round1(winRead / winFrames),
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
    let f;
    if (testPattern) {
      // diagnostic: a static, cached reference frame (no engine, no source needed)
      f = createTestFrame(width, height);
    } else {
      try {
        f = await engineAdapter.renderFrameAt(width, height);
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
    winRender += f.renderMs || 0;
    winRead += f.readMs || 0;
    winPublish += publishMs;
    if (now - winStart >= 1000) flushOpRecord(now);

    if (running) raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    lastError = null;          // fresh attempt — clear any prior failure
    running = true;
    resetWindow(performance.now());
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (!running) return;
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    fps = 0;
  }

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
    },
    setServerName(name) { serverName = String(name || 'Fold'); },

    // Diagnostic: when on, the loop publishes a known reference frame (test-pattern.js)
    // instead of the program — to verify orientation/scale/color downstream (Arena, a
    // recording). Takes effect on the next frame; no source required.
    setTestPattern(on) { testPattern = !!on; },

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
