// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// kit/follow.js
//
// The perform-mode FOLLOWER (Arc 4's core primitive): the live output chases a
// continuously-updated TARGET state instead of snapping to edits. Feed it every
// input as it happens (setTarget replaces — interstitial inputs are bypassed by
// construction, per Daniel's model: a slow follow fine-tuning several params
// moves directly toward the most recent input, never replaying detours), then
// step() once per rendered frame and render the returned snapshot.
//
// The ramp is a critically damped spring per continuous field. That choice IS
// the "perceptual" behavior Daniel picked first: convergence time is roughly
// constant regardless of move size (big moves cover proportionally more ground
// per second, so they read like small ones), it is velocity-continuous under a
// continuously-moving target (no restart stutter as gesture events stream in),
// and it never overshoots. A literal fixed-duration tween can be added as an
// alternate mode later if perceptual disappoints.
//
// CYCLIC fields follow in UNWRAPPED space: each target update accumulates the
// shortest-path delta from the PREVIOUS target, so an input that travels
// 0→350 through intermediate values follows the long way (the way you moved,
// the +gesture direction), while a single 0→350 jump takes the short way (the
// least-disruptive return-to-center path). This is the one rule that makes live
// following feel right for free — and it is period-agnostic: angles cycle at
// 360°, droste infinite-zoom PHASE at 1. drosteZoomPhase joins so a pinch that
// crosses the loop seam in perform keeps zooming the direction you gestured
// instead of the follower easing backward toward the wrapped value. (Gesture
// capture stays the richer winding story — later arc.)
//
// Kit layer: pure functions, no DOM, no chrome, no timers — the caller owns
// the clock (pass dtMs per frame).

import { CONTINUOUS_KEYS, DISCRETE_KEYS } from './tween.js';

// stateKey → cycle PERIOD. Everything else is linear. (Angles used to be a
// hardcoded 360 special-case; generalizing to a period lets infinite-zoom phase
// reuse the identical directional-unwrap without a second code path.)
const CYCLE = { sliceRotation: 360, canvasRotation: 360, drosteZoomPhase: 1 };
const wrapTo = (v, P) => ((v % P) + P) % P;
// signed shortest-path delta a→b within one period, in (−P/2, +P/2]. b may be
// unwrapped (trackpad writes phase raw) or wrapped (mobile writeParam wraps it);
// reducing mod P here handles both. For P=360 this is exactly the old angDelta.
const cycDelta = (a, b, P) => ((b - a + 1.5 * P) % P) - 0.5 * P;

// How many PERIODS of accumulated lead a cyclic field may hold (default 1 — "chase
// where you are, at most one lap behind; never replay stacked laps"). Rotation keeps
// the tight 1-lap cap; the droste infinite-zoom phase is raised so a VIGOROUS multi-
// loop pinch is honored in full instead of truncated to one loop (Daniel).
export const LEAD_CAP = { drosteZoomPhase: 4 };
// Per-field CATCH-UP boost: the field's spring speeds up the farther behind it is, so
// a big backlog (a fast multi-loop droste zoom) rushes to catch up and settles quickly
// rather than crawling the whole distance at the transition rate — with minimal drift
// after you lift (Daniel: "increase the velocity of the trailing motion while it catches
// up"). omega ← omega·(1 + min(max, gain·|lead|/span)). Only drosteZoomPhase opts in.
const BOOST = { drosteZoomPhase: { gain: 2, span: 1, max: 3 } };

// Rough usable span per continuous field — the state-delta metric that makes
// deltas comparable across fields (rotation moves in degrees, scale in ~unity).
// Used for settle detection + the remaining-distance readout (the in-sync
// affordance), NOT for the spring itself (springs are per-field proportional).
export const FOLLOW_SPANS = {
  sliceScale: 2.95, sliceCx: 1, sliceCy: 1, sliceRotation: 360,
  squareAspect: 3.75, drosteZoom: 14.9, drosteSpiral: 6,
  drosteOffsetX: 2, drosteOffsetY: 2,
  canvasZoom: 3.85, canvasRotation: 360, drosteZoomPhase: 1,
  canvasOffsetX: 2, canvasOffsetY: 2,
};

// createFollower(initialState, { response }) →
//   setTarget(state)   feed the latest input (full or partial snapshot)
//   jump(state)        hard cut — follow state lands ON the target (take/cut)
//   step(dtMs)         advance; returns a NEW full snapshot to render
//   setResponse(sec)   the transition-speed control: ~0 = instant, bigger = slower
//   getResponse()
//   remaining()        max normalized |target − current| across fields (0 = in sync)
//   isSettled(eps)     remaining() below eps AND velocities damped — drives the
//                      live/staged "showing the same thing" affordance
export function createFollower(initial, { response = 0.35 } = {}) {
  const cur = {}, vel = {}, tgt = {};      // spring state, UNWRAPPED for angular fields
  const snapshot = { ...initial };         // full state; non-continuous fields ride verbatim
  for (const k of CONTINUOUS_KEYS) { cur[k] = tgt[k] = initial[k] ?? 0; vel[k] = 0; }
  let tau = Math.max(0, response);

  function setResponse(sec) { tau = Math.max(0, sec); }
  function getResponse() { return tau; }

  function setTarget(next) {
    for (const k of CONTINUOUS_KEYS) {
      if (next[k] == null) continue;
      const P = CYCLE[k];
      if (P) {
        // cyclic: accumulate the shortest-path delta from the PREVIOUS target —
        // a streamed 0→350 unwinds forward, a single jump goes the short way
        let nt = tgt[k] + cycDelta(wrapTo(tgt[k], P), next[k], P);
        // cap the accumulated LEAD at LEAD_CAP periods (default 1): live following
        // chases where you ARE (in your direction, at most that many laps behind) —
        // it never replays stacked laps beyond the cap. Rotation caps at 1 lap;
        // droste zoom caps higher so a vigorous multi-loop pinch travels in full.
        // Subtract whole periods to bring the lead back within the cap, preserving
        // the target's phase alignment (nt ≡ next mod P).
        const cap = (LEAD_CAP[k] || 1) * P;
        const lead = nt - cur[k];
        if (lead > cap) nt -= P * Math.ceil((lead - cap) / P);
        else if (lead < -cap) nt += P * Math.ceil((-lead - cap) / P);
        // re-base a long session's drift toward 0 so unwrapped values never grow
        // unbounded (shift target + current together; velocity is a rate, unchanged)
        if (Math.abs(nt) > 20 * P) { const s = P * Math.floor(nt / P); nt -= s; cur[k] -= s; }
        tgt[k] = nt;
      } else {
        tgt[k] = next[k];
      }
    }
    // everything non-continuous (form, segments, mirrors, any future field) cuts
    // immediately — there is no meaningful interpolation for discrete state
    for (const k in next) {
      if (!CONTINUOUS_KEYS.includes(k)) snapshot[k] = next[k];
    }
  }

  function jump(next) {
    setTarget(next);
    for (const k of CONTINUOUS_KEYS) { cur[k] = tgt[k]; vel[k] = 0; }
  }

  function step(dtMs) {
    const dt = Math.max(0, dtMs) / 1000;
    if (tau <= 0.001) {
      for (const k of CONTINUOUS_KEYS) { cur[k] = tgt[k]; vel[k] = 0; }
    } else if (dt > 0) {
      // exact critically damped step: y(t) = (y0 + (v0 + ωy0)t)·e^(−ωt)
      const omega0 = 2 / tau;
      for (const k of CONTINUOUS_KEYS) {
        const y = cur[k] - tgt[k];
        // per-field catch-up boost: fields in BOOST speed up the farther behind they
        // are, so a big backlog rushes to catch up + settles (others ride omega0).
        let omega = omega0;
        const b = BOOST[k];
        if (b) omega = omega0 * (1 + Math.min(b.max, b.gain * Math.abs(y) / b.span));
        const decay = Math.exp(-omega * dt);
        const tmp = (vel[k] + omega * y) * dt;
        cur[k] = tgt[k] + (y + tmp) * decay;
        vel[k] = (vel[k] - omega * tmp) * decay;
      }
    }
    for (const k of CONTINUOUS_KEYS) snapshot[k] = CYCLE[k] ? wrapTo(cur[k], CYCLE[k]) : cur[k];
    return { ...snapshot };
  }

  function remaining() {
    let mx = 0;
    for (const k of CONTINUOUS_KEYS) {
      const span = FOLLOW_SPANS[k] || 1;
      const d = Math.abs(tgt[k] - cur[k]) / span;
      if (d > mx) mx = d;
    }
    return mx;
  }

  function isSettled(eps = 0.002) {
    if (remaining() > eps) return false;
    for (const k of CONTINUOUS_KEYS) {
      const span = FOLLOW_SPANS[k] || 1;
      if (Math.abs(vel[k]) * Math.max(tau, 0.05) / span > eps) return false;
    }
    return true;
  }

  return { setTarget, jump, step, setResponse, getResponse, remaining, isSettled };
}

// re-exported so perform consumers need one import
export { CONTINUOUS_KEYS, DISCRETE_KEYS };
