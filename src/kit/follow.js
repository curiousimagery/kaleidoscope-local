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
// Angles follow in UNWRAPPED space: each target update accumulates the
// shortest-path delta from the PREVIOUS target, so an input that travels
// 0°→350° through intermediate values follows the long way (the way you
// moved), while a single 0°→350° jump takes the short way (−10°). Gesture
// capture stays the richer winding story (later arc); this rule is what makes
// live following feel right for free.
//
// Kit layer: pure functions, no DOM, no chrome, no timers — the caller owns
// the clock (pass dtMs per frame).

import { CONTINUOUS_KEYS, ANGULAR_KEYS, DISCRETE_KEYS, angDelta } from './tween.js';

const ANGULAR = new Set(ANGULAR_KEYS);
const wrap360 = (v) => ((v % 360) + 360) % 360;

// Rough usable span per continuous field — the state-delta metric that makes
// deltas comparable across fields (rotation moves in degrees, scale in ~unity).
// Used for settle detection + the remaining-distance readout (the in-sync
// affordance), NOT for the spring itself (springs are per-field proportional).
export const FOLLOW_SPANS = {
  sliceScale: 2.95, sliceCx: 1, sliceCy: 1, sliceRotation: 360,
  squareAspect: 3.75, drosteZoom: 14.9, drosteSpiral: 6,
  drosteOffsetX: 2, drosteOffsetY: 2,
  canvasZoom: 3.85, canvasRotation: 360,
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
      if (ANGULAR.has(k)) {
        // angular: accumulate the shortest-path delta from the PREVIOUS target —
        // a streamed 0→350 unwinds forward, a single jump goes the short way
        let nt = tgt[k] + angDelta(wrap360(tgt[k]), next[k]);
        // cap the accumulated LEAD at one turn: live following chases where you
        // ARE (in your direction, at most a full lap behind) — it never replays
        // stacked laps. Spinning past 360° used to queue every lap and leave the
        // output visibly rotating long after the hand stopped.
        const lead = nt - cur[k];
        if (lead > 360) { const m = lead % 360; nt = cur[k] + (m === 0 ? 360 : m); }
        else if (lead < -360) { const m = (-lead) % 360; nt = cur[k] + (m === 0 ? -360 : -m); }
        // re-base a long session's drift toward 0 so unwrapped values never grow
        // unbounded (shift target + current together; velocity is a rate, unchanged)
        if (Math.abs(nt) > 7200) { const s = 360 * Math.floor(nt / 360); nt -= s; cur[k] -= s; }
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
      const omega = 2 / tau;
      const decay = Math.exp(-omega * dt);
      for (const k of CONTINUOUS_KEYS) {
        const y = cur[k] - tgt[k];
        const tmp = (vel[k] + omega * y) * dt;
        cur[k] = tgt[k] + (y + tmp) * decay;
        vel[k] = (vel[k] - omega * tmp) * decay;
      }
    }
    for (const k of CONTINUOUS_KEYS) snapshot[k] = ANGULAR.has(k) ? wrap360(cur[k]) : cur[k];
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
