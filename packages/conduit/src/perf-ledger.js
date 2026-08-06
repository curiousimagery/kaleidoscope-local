// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// conduit/perf-ledger.js
//
// THE FRAME-COST LEDGER — what is this app spending per frame, on what, and for whom.
//
// WHY IT EXISTS. Every consumer of conduit renders the same program to several surfaces at
// once (an in-app preview, a PiP, a record/broadcast bus, an external display) and the honest
// answer to "why is this slow / hot" was previously a guess. The audit that produced this
// module found a worst case of ~23 megapixels rasterized per frame to put 8.3 on air. You
// cannot make a degradation decision from that without knowing which surface is which cost.
//
// TWO INSTRUMENTS IN ONE, and the second is the decisive one:
//   · the LEDGER measures (ms, GPU ms where available, and megapixels — per surface, per pass,
//     over a 1s window)
//   · the SWITCHBOARD lets each surface be turned OFF or scaled DOWN live
//
// THE CPU/GPU SPLIT, because it decides how to read every number here. Plain `ms` is main-thread
// time, which for a draw call measures SUBMISSION rather than execution — real but partial.
// `gpuMs` is true GPU time from `EXT_disjoint_timer_query_webgl2`, available on Chromium and
// Electron and generally NOT on WebKit (see conduit/gpu-timer.js). So desktop can read the
// ranking straight off the panel; iPad and iPhone rank by turning things off and watching fps.
// That asymmetry is why the method is "rank on desktop, CONFIRM on device". It is also why the
// switchboard matters more than the numbers: EVERY SWITCH IS A CANDIDATE DEGRADATION LEVER, so
// it is the prototype of the ladder a governor will later drive, not just a way to look.
//
// THREE DESIGN CONSTRAINTS, each of which came from a real future feature and each of which
// would be expensive to retrofit:
//
//   1. LAYOUT-AGNOSTIC. Surfaces REGISTER when they mount and release when they unmount.
//      Nothing here knows that a preview and a PiP exist today, so a UX change that merges
//      or removes panels re-registers a different set and everything downstream — the
//      readout, the switchboard, a future governor — keeps working untouched.
//   2. NESTED. A surface owns PASSES. Today every surface has exactly one, which makes this
//      look like over-design; it is not. A user-loaded shader is a second pass on an existing
//      surface, and a scene-graph layer is a second pass consuming the first. Without nesting
//      the ledger can only say "the preview got slower" instead of "the stipple pass costs
//      4ms of the preview's 6ms".
//   3. ONE-SHOT WORK IS BUDGETED SEPARATELY. A still export has a budget measured in seconds;
//      a live frame has 16ms. The most useful sentence we can say about an expensive effect
//      is "fine on a still, impossible on video", and a ledger that averages both into one
//      number cannot say it.
//
// COST WHEN DISABLED: one boolean read per begin/end. The panel is only reachable
// deliberately, so this is the right trade against the complexity of hot-swapping call sites.

const now = () => performance.now();
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

// A surface's PRIORITY is its place in the yield order: LOWER yields first. Declared by the
// surface itself rather than inferred by a governor, so a new surface arrives already knowing
// how it should degrade instead of needing the governor taught about it.
export const PRIORITY = {
  DECOR: 10,      // editor decoration (ghost trails, hover affordances)
  EDITOR: 30,     // what the operator looks at (in-app preview, PiP)
  PROGRAM: 70,    // what the audience looks at (external display)
  CAPTURE: 90,    // what is recorded or broadcast — yields last, or never
};

export function createPerfLedger({ enabled = false, windowMs = 1000, pressure = null } = {}) {
  let on = !!enabled;
  const surfaces = new Map();   // id -> surface record
  const oneShots = new Map();   // id -> { id, calls, ms, maxMs }

  // wall-clock frame timing, sampled by our OWN rAF rather than by counting surface renders.
  // A surface count would report the loop we happen to instrument; this reports what the
  // device actually delivered, which is the number a pressure signal has to be derived from.
  let raf = 0, lastFrameT = 0;
  const frameTimes = [];        // current window, ms between rAF callbacks
  let winStart = 0;
  let latest = emptyReport();

  function emptyReport() {
    return { fps: 0, frameMs: { p50: 0, p95: 0 }, surfaces: [], oneShots: [], mpPerFrame: 0, windowMs: 0 };
  }

  function tick(t) {
    if (!on) { raf = 0; return; }
    if (lastFrameT) frameTimes.push(t - lastFrameT);
    lastFrameT = t;
    if (t - winStart >= windowMs) flush(t);
    raf = requestAnimationFrame(tick);
  }

  function pct(sorted, p) {
    if (!sorted.length) return 0;
    const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
    return sorted[i];
  }

  function flush(t) {
    const elapsed = t - winStart || 1;
    const sorted = frameTimes.slice().sort((a, b) => a - b);
    const frames = frameTimes.length;
    const rows = [];
    let mp = 0;
    for (const s of surfaces.values()) {
      const size = safeSize(s);
      const passes = [];
      let sMs = 0, sGpu = 0;
      for (const p of s.passes.values()) {
        // per-FRAME cost, not per-call: a surface rendered twice in one frame (rare, but the
        // scrub path does it) should read as what it costs the frame, not as a smaller average
        const perFrame = frames ? p.ms / frames : 0;
        const gpuPerFrame = frames ? p.gpuMs / frames : 0;
        sMs += perFrame; sGpu += gpuPerFrame;
        passes.push({
          id: p.id, msPerFrame: round2(perFrame), gpuMsPerFrame: round2(gpuPerFrame),
          calls: p.calls, maxMs: round2(p.maxMs),
        });
        p.ms = 0; p.calls = 0; p.maxMs = 0; p.gpuMs = 0;
      }
      const surfaceMp = (size.w * size.h) / 1e6;
      // a switched-off or unrendered surface still LISTS (you need to see what you turned off)
      // but contributes no pixels to the frame total. A REMOTE surface renders in another
      // process (an external display's own webview), so it has no ms here and its pixels
      // still count — leaving them out would understate the frame by the largest single item.
      if (s.enabled && (sMs > 0 || s.remote)) mp += surfaceMp;
      rows.push({
        id: s.id, label: s.label, serves: s.serves, priority: s.priority,
        w: size.w, h: size.h, mp: round2(surfaceMp), remote: s.remote,
        enabled: s.enabled, scale: s.scale, scaleLadder: s.scaleLadder,
        msPerFrame: round2(sMs), gpuMsPerFrame: round2(sGpu), passes,
      });
    }
    rows.sort((a, b) => b.msPerFrame - a.msPerFrame || b.mp - a.mp);

    const shots = [];
    for (const o of oneShots.values()) {
      if (o.calls) shots.push({ id: o.id, calls: o.calls, ms: round1(o.ms), maxMs: round1(o.maxMs) });
      o.calls = 0; o.ms = 0; o.maxMs = 0;
    }

    latest = {
      fps: round1((frames * 1000) / elapsed),
      frameMs: { p50: round2(pct(sorted, 50)), p95: round2(pct(sorted, 95)) },
      surfaces: rows,
      oneShots: shots,
      mpPerFrame: round2(mp),
      windowMs: Math.round(elapsed),
      pressure: pressure ? { value: round2(pressure.value), source: pressure.source, label: pressure.label } : null,
    };
    pressure?.note(latest.frameMs.p50);
    frameTimes.length = 0;
    winStart = t;
    onReport?.(latest);
  }

  let onReport = null;

  function safeSize(s) {
    try { const d = s.size ? s.size() : null; return { w: d?.w || 0, h: d?.h || 0 }; }
    catch { return { w: 0, h: 0 }; }
  }

  function start() {
    if (raf) return;
    winStart = now(); lastFrameT = 0; frameTimes.length = 0;
    raf = requestAnimationFrame(tick);
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    latest = emptyReport();
  }

  // ---- the measurable unit -------------------------------------------------
  // begin/end rather than a wrapping callback: the hot paths here are render loops, and a
  // closure per frame per surface is exactly the kind of cost an instrument must not add.
  function makeItem(bucket, id) {
    let t0 = 0;
    return {
      id,
      begin() { if (on) t0 = now(); },
      end() {
        if (!on || !t0) return;
        const ms = now() - t0; t0 = 0;
        bucket.ms += ms; bucket.calls += 1;
        if (ms > bucket.maxMs) bucket.maxMs = ms;
      },
      // TRUE GPU time, fed asynchronously by a producer that has it (conduit/gpu-timer.js).
      // Kept in its own accumulator rather than replacing `ms`, because the two answer different
      // questions: `ms` is what this cost the main thread, `gpuMs` is what it cost the GPU, and
      // a surface can be expensive in one and free in the other. Its presence is also what tells
      // a producer that reporting it is worth the query objects.
      gpu(ms) { if (on && ms > 0) bucket.gpuMs += ms; },
    };
  }

  return {
    get enabled() { return on; },
    set enabled(v) {
      const next = !!v;
      if (next === on) return;
      on = next;
      if (on) start(); else stop();
    },

    // Register a render surface. Everything is a callback or an accessor so the ledger never
    // holds a reference to DOM or engine state — a surface that unmounts just releases.
    //   id/label   identity
    //   serves     'program' (the audience sees it) | 'editor' (only the operator does)
    //   priority   PRIORITY.* — the declared yield order
    //   size()     -> { w, h } the surface's CURRENT drawing-buffer size
    //   onEnabled  (bool)  the switchboard actuator; omit for a surface that cannot be cut
    //   onScale    (n)     the resolution actuator; omit for a fixed-size surface
    surface(spec) {
      const rec = {
        id: spec.id,
        label: spec.label || spec.id,
        serves: spec.serves || 'editor',
        priority: spec.priority ?? PRIORITY.EDITOR,
        size: spec.size || null,
        remote: !!spec.remote,   // rendered in another process; pixels count, ms cannot
        onEnabled: spec.onEnabled || null,
        onScale: spec.onScale || null,
        scaleLadder: spec.scaleLadder || [1, 0.75, 0.5, 0.35, 0.25],
        enabled: true,
        scale: 1,
        passes: new Map(),
      };
      surfaces.set(rec.id, rec);
      return {
        id: rec.id,
        // A named pass WITHIN this surface. Today each surface has one; a post-process
        // effect or a scene layer registers its own and becomes separately attributable.
        pass(passId) {
          const key = passId || 'render';
          let b = rec.passes.get(key);
          if (!b) { b = { id: key, ms: 0, calls: 0, maxMs: 0, gpuMs: 0 }; rec.passes.set(key, b); }
          return makeItem(b, `${rec.id}.${key}`);
        },
        // the switchboard's answer, read by the surface's own render path
        get skip() { return !rec.enabled; },
        get scale() { return rec.scale; },
        // The shape an ENGINE takes: one object carrying both the cut and the measurement, so
        // an engine has a single optional collaborator instead of three loose callbacks, and
        // both the switch and the timing land at the one place every caller funnels through.
        enginePerf(passId) {
          const item = this.pass(passId);
          return {
            get skip() { return !rec.enabled; },
            begin: item.begin, end: item.end,
            // its PRESENCE is the signal that GPU timing is wanted — an engine only allocates
            // query objects when someone is going to read them
            gpu: item.gpu,
          };
        },
        release() { surfaces.delete(rec.id); },
      };
    },

    // ONE-SHOT work (a still export, a thumbnail pass, a bake step) — reported as calls and
    // total ms, never averaged into the per-frame budget. See constraint 3 above.
    oneShot(id) {
      let b = oneShots.get(id);
      if (!b) { b = { id, ms: 0, calls: 0, maxMs: 0, gpuMs: 0 }; oneShots.set(id, b); }
      return makeItem(b, id);
    },

    // ---- the switchboard, driven by a panel or (later) a governor ----------
    setSurfaceEnabled(id, v) {
      const s = surfaces.get(id);
      if (!s) return;
      s.enabled = !!v;
      try { s.onEnabled?.(s.enabled); } catch { /* a surface that refuses stays listed */ }
    },
    setSurfaceScale(id, n) {
      const s = surfaces.get(id);
      if (!s || !s.onScale) return;
      s.scale = n;
      try { s.onScale(n); } catch { /* ditto */ }
    },

    // COST PROBE — render `frames` iterations of `fn` and report the distribution. This is the
    // primitive that will classify an unbounded user-loaded shader at load time ("fine on a
    // still, impossible on video") and the same code a named-scenario baseline run needs.
    // Synchronous by design: it measures submission-to-return, so callers wanting true GPU
    // cost must include their own read/flush inside `fn`.
    probe(fn, frames = 30) {
      const samples = [];
      try { fn(); } catch { return null; }         // warm — first call pays shader/JIT costs
      for (let i = 0; i < frames; i++) {
        const t0 = now();
        try { fn(); } catch { return null; }
        samples.push(now() - t0);
      }
      samples.sort((a, b) => a - b);
      return {
        frames,
        p50: round2(pct(samples, 50)),
        p95: round2(pct(samples, 95)),
        min: round2(samples[0]),
        max: round2(samples[samples.length - 1]),
      };
    },

    get report() { return latest; },
    get surfaces() { return [...surfaces.values()].map((s) => ({ id: s.id, label: s.label })); },
    onReport(fn) { onReport = fn; },
    get pressure() { return pressure; },
  };
}
