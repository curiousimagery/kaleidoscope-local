// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// kit/motion-probe.js
//
// WHO IS STILL MOVING, AND IS ANYTHING ALLOWED TO BE.
//
// Built for the droste infinite-zoom loop (B611 / B612 / B619), where four separate mechanisms
// have now been eliminated by reading and simulation and the investigation has reached a
// contradiction worth stating plainly:
//
//   With autoplay off, drift mode off, and no fingers on the glass, an exhaustive grep finds NO
//   writer that can move `canvasOffsetX/Y` or `drosteZoomPhase` — and `follow.js` provably settles
//   against constant state. Yet the motion Daniel reports is real and only a reset clears it.
//
// So either a writer exists that static reading has missed, or the moving quantity is not one of
// the two we assumed. **No amount of further code reading distinguishes those.** This does.
//
// ⚠️ THE WRONG-NOUN TEST, completed before this shipped:
//   "this samples the STATE FIELDS THE SHADER ACTUALLY READS, which equals what I care about only
//    if the motion is in state rather than in the render." That is exactly the disjunction under
//    test, which is why the follower's own `cur` is sampled ALONGSIDE state rather than instead of
//    it. If state is flat and `cur` is moving, the follower is the culprit despite the simulation;
//    if both are flat, the motion is downstream of both and every hypothesis so far is wrong.
//
// These are CONSERVED QUANTITIES (the actual numbers being rendered), never activity counters.
// A counter of "how many writes happened" would have told us nothing here: the question is not
// whether writes occur, it is which value is travelling.
//
// The probe never writes state and never touches the render path. It samples on its own rAF and
// is INERT unless `?probe=motion` is set, so it costs nothing in a normal session.

// The fields a droste runaway could possibly live in. canvasOffset is droste's LOG-POLAR CENTRE
// (B612 root-caused it as the "superzoom" driver when read raw), drosteOffset is the Möbius disc
// automorphism, and drosteZoomPhase is the loop accumulator. canvasZoom rides along because the
// pan GAIN is 2/canvasZoom (kit/pan.js) — a small canvasZoom multiplies every centroid nudge, and
// droste never drives canvasZoom down itself, so it keeps whatever the previous form left.
const WATCH = ['canvasOffsetX', 'canvasOffsetY', 'drosteZoomPhase', 'drosteOffsetX', 'drosteOffsetY', 'canvasZoom'];

// A field counts as MOVING when its rate clears this, in units/sec. Deliberately low: in a
// log-polar form the phase is the LOG of scale, so a rate far below any "looks settled" threshold
// is still visible continuous zoom. The B619 simulation had to be re-run against RATE for exactly
// this reason — a displacement threshold called a live tail "zero".
const MOVING_EPS = 1e-4;

export function createMotionProbe(env, { enabled = false } = {}) {
  if (!enabled) return { report: () => null, stop: () => {} };

  const { state } = env;
  const prev = {};
  const f = {};                     // per-field accumulators
  for (const k of WATCH) { prev[k] = state[k] ?? 0; f[k] = { rate: 0, travel: 0, movingMs: 0, quietMovingMs: 0, peak: 0 }; }

  let raf = 0, lastT = 0, running = true;
  let quietMs = 0;                  // how long nothing has been ALLOWED to write

  // Touch/pointer census, observed DIRECTLY rather than asked of the chrome. There is no existing
  // `env.gesturesActive`, and inventing one in two chromes to serve a probe would be the same
  // "wired to one of N paths" mistake this arc has now made four times. Listening at the document
  // in the capture phase sees every surface without either chrome knowing the probe exists.
  let downCount = 0;
  const onDown = () => { downCount++; };
  const onUp = () => { downCount = Math.max(0, downCount - 1); };
  const opts = { capture: true, passive: true };
  document.addEventListener('pointerdown', onDown, opts);
  document.addEventListener('pointerup', onUp, opts);
  document.addEventListener('pointercancel', onUp, opts);

  // "QUIET" = every known writer is provably idle. If a field moves while quiet, a writer exists
  // that static reading missed — which is the whole question. Each term is read live rather than
  // cached, and anything we CANNOT observe counts as NOT quiet: an absence is not evidence, and a
  // false "quiet" would manufacture exactly the finding we are testing for.
  function quietNow() {
    const autoOn = !!(env.performRT?.auto?.on ?? env.autoOn ?? false);
    // `.drifting` is set by pan-joystick on BOTH instances (canvas pan and the droste centre
    // offset), which matters here: the droste one is unreachable from `env.panDrift`, so asking
    // the API would miss precisely the latched drift most likely to be responsible.
    const drifting = !!document.querySelector('.pan-joy.drifting');
    return !autoOn && downCount === 0 && !drifting;
  }

  function tick(now) {
    raf = 0;
    if (!running) return;
    const dt = Math.min(now - lastT, 250) / 1000;
    lastT = now;
    if (dt > 0) {
      const quiet = quietNow();
      quietMs = quiet ? quietMs + dt * 1000 : 0;
      for (const k of WATCH) {
        const v = state[k] ?? 0;
        const d = v - prev[k];
        prev[k] = v;
        const rate = Math.abs(d) / dt;
        f[k].rate = rate;
        f[k].travel += Math.abs(d);
        if (rate > f[k].peak) f[k].peak = rate;
        if (rate > MOVING_EPS) {
          f[k].movingMs += dt * 1000;
          // THE HEADLINE NUMBER. Time a field spent travelling while nothing was allowed to write
          // it. Anything above a few frames of this is the bug, and it names the field outright.
          if (quiet) f[k].quietMovingMs += dt * 1000;
        }
      }
    }
    raf = requestAnimationFrame(tick);
  }
  lastT = performance.now();
  raf = requestAnimationFrame(tick);

  function report() {
    const fields = {};
    for (const k of WATCH) {
      const a = f[k];
      // omit fields that have never moved at all, so the report names suspects rather than listing
      // the whole watch set
      if (!a.travel) continue;
      fields[k] = {
        now: +(state[k] ?? 0).toFixed(5),
        rate: +a.rate.toFixed(5),
        peakRate: +a.peak.toFixed(5),
        travel: +a.travel.toFixed(3),
        movingMs: Math.round(a.movingMs),
        quietMovingMs: Math.round(a.quietMovingMs),
      };
    }
    // the FOLLOWER's own position for the same fields — the other half of the disjunction. If
    // state is flat and these are not, the follower is moving on its own despite the simulation.
    const fc = env.performRT?.followerDebug?.() || env.followerDebug?.() || null;
    const follower = fc ? Object.fromEntries(WATCH.filter((k) => fc.cur && k in fc.cur)
      .map((k) => [k, { cur: +fc.cur[k].toFixed(5), tgt: +fc.tgt[k].toFixed(5), vel: +fc.vel[k].toFixed(5) }])) : null;
    return {
      quietMs: Math.round(quietMs),
      // the one-line verdict, so the report answers the question without needing to be read closely
      verdict: Object.entries(fields).filter(([, v]) => v.quietMovingMs > 250).map(([k]) => k).join(', ')
        || (Object.keys(fields).length ? 'moved, but never while quiet' : 'nothing moved'),
      fields,
      follower,
    };
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    document.removeEventListener('pointerdown', onDown, opts);
    document.removeEventListener('pointerup', onUp, opts);
    document.removeEventListener('pointercancel', onUp, opts);
  }
  return { report, stop };
}
