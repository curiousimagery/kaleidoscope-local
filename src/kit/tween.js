// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// kit/tween.js
//
// State-snapshot interpolation for motion mode. A keyframe is a {...state}
// snapshot — the same currency as an undo entry (see shell/history.js) — so an
// animation is just interpolating between two snapshots over time and rendering
// each frame through the stateless engine (engine.render takes full state).
//
// Kit layer: pure functions, no DOM, no chrome. This module owns the canonical
// classification of which fields animate (continuous) vs. which hold (discrete),
// because params.js can't carry it: the direct-manipulation-only fields
// (sliceCx/Cy, drosteOffsetX/Y) and the non-declarative drosteSpiral animate but
// are not in DECLARATIVE_PARAM_IDS. The two angular keys here mirror the
// `wrap: 360` slider entries in params.js.

// Continuous fields — linearly interpolated between snapshots.
export const CONTINUOUS_KEYS = [
  'sliceScale', 'sliceCx', 'sliceCy', 'sliceRotation',
  'squareAspect', 'drosteZoom', 'drosteSpiral', 'drosteOffsetX', 'drosteOffsetY',
  'canvasZoom', 'canvasRotation',
];

// Angular fields (a subset of continuous) — interpolated along the SHORTEST path
// around the 360° circle, so 350°→10° crosses 0° rather than unwinding 340° the
// long way through 180°.
export const ANGULAR_KEYS = ['sliceRotation', 'canvasRotation'];

// Discrete fields — held (taken verbatim from `a`). Motion mode locks these for
// the whole loop, so in practice they're identical in both keyframes; holding
// from `a` is what keeps the loop continuous (no hard cut mid-tween).
export const DISCRETE_KEYS = [
  'form', 'segments', 'drosteArms', 'oobMode', 'drosteMirror', 'drosteWedgeMirror',
];

// Easing functions, t in [0,1] → eased [0,1]. easeInOut is the default: zero
// velocity at both ends, so an A→B→A loop has no visible "bounce" at the joins.
export const easing = {
  linear: t => t,
  easeIn: t => t * t,
  easeOut: t => t * (2 - t),
  easeInOut: t => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2),
};

const ANGULAR = new Set(ANGULAR_KEYS);

// Shortest-path angle interpolation. delta is wrapped into [-180,180] so we
// always rotate the short way; the result is re-wrapped into [0,360).
function lerpAngle(a, b, t) {
  const delta = ((b - a + 540) % 360) - 180;
  const r = a + delta * t;
  return ((r % 360) + 360) % 360;
}

// Interpolate two state snapshots at fraction t (0→a, 1→b). `ease` may be an
// easing function or a key of `easing`. Returns a NEW snapshot; inputs are not
// mutated. Discrete fields come from `a`; continuous fields are lerped (angular
// ones via shortest path).
export function lerpState(a, b, t, ease = easing.easeInOut) {
  const fn = typeof ease === 'function' ? ease : (easing[ease] || easing.easeInOut);
  const k = fn(t);
  const out = { ...a };               // discrete fields held from a
  for (const key of CONTINUOUS_KEYS) {
    out[key] = ANGULAR.has(key)
      ? lerpAngle(a[key], b[key], k)
      : a[key] + (b[key] - a[key]) * k;
  }
  return out;
}

// ---- multi-keyframe sampling (velocity-continuous) ------------------------
// How many Laplacian relax passes the smoothing control drives at 100%. 1 ≈ very
// mild (a single neighbour-average); higher compounds into much stronger fudging.
// This is the "make it wilder" knob — bump it for a more aggressive max.
const SMOOTH_PASSES = 4;

// shortest-path signed delta a→b (degrees), in [-180,180]. Exported for the
// perform follower (kit/follow.js), which unwraps angles with the same rule.
export function angDelta(a, b) { return ((b - a + 540) % 360) - 180; }

// Laplacian relax of INTERIOR control points toward the mean of their immediate
// neighbours by `amount`∈[0,1]. Endpoints (and the loop bookend, which is kf0) stay
// fixed, preserving the start/loop anchor. Mutates `vs`.
function relaxInterior(ts, vs, amount) {
  const orig = vs.slice();
  for (let i = 1; i < vs.length - 1; i++) {
    vs[i] = orig[i] + ((orig[i - 1] + orig[i + 1]) / 2 - orig[i]) * amount;
  }
}

// Slope dv/dt at control index i via finite differences (Catmull-Rom). Loop uses
// ghost neighbours wrapped one period (Δt=1) so the seam velocity is continuous;
// non-loop ends use one-sided differences (natural endpoints).
function tangent(ts, vs, i, loop) {
  const m = ts.length;
  const per = vs[m - 1] - vs[0];   // value change across one loop period
  let tPrev, vPrev, tNext, vNext;
  if (i > 0)        { tPrev = ts[i - 1]; vPrev = vs[i - 1]; }
  else if (loop)    { tPrev = ts[m - 2] - 1; vPrev = vs[m - 2] - per; }
  else              { tPrev = ts[i]; vPrev = vs[i]; }
  if (i < m - 1)    { tNext = ts[i + 1]; vNext = vs[i + 1]; }
  else if (loop)    { tNext = ts[1] + 1; vNext = vs[1] + per; }
  else              { tNext = ts[i]; vNext = vs[i]; }
  const dT = tNext - tPrev;
  return dT > 1e-9 ? (vNext - vPrev) / dT : 0;
}

// Finite-difference Hermite (Catmull-Rom) sample of non-uniform control points.
function hermiteSample(ts, vs, p, loop) {
  const m = ts.length;
  if (p <= ts[0]) return vs[0];
  if (p >= ts[m - 1]) return vs[m - 1];
  let i = 0;
  while (i < m - 1 && p > ts[i + 1]) i++;
  const t0 = ts[i], t1 = ts[i + 1], dt = (t1 - t0) || 1e-6;
  const u = (p - t0) / dt, u2 = u * u, u3 = u2 * u;
  const m0 = tangent(ts, vs, i, loop), m1 = tangent(ts, vs, i + 1, loop);
  return (2 * u3 - 3 * u2 + 1) * vs[i]
       + (u3 - 2 * u2 + u) * dt * m0
       + (-2 * u3 + 3 * u2) * vs[i + 1]
       + (u3 - u2) * dt * m1;
}

// Sample the keyframe list at normalized time p∈[0,1] with a velocity-CONTINUOUS
// curve, so motion flows THROUGH keyframes instead of easing to a stop at each
// one — it only slows at genuine turning points (where a value reverses). This is
// the baseline (not a setting). `smoothing`∈[0,1] additionally relaxes the interior
// keyframe VALUES toward their neighbours before interpolating, fudging exact values
// to absorb jaggy timing/placement (like a drawing app smoothing pen-stroke shake).
// Angular fields are unwrapped (spline runs on continuous angle) then re-wrapped.
// Loop-aware: kf0 is the return target at t=1 and the curve is periodic (seamless
// velocity across the join). Discrete fields are held from kf0.
export function sampleKeyframes(list, p, { smoothing = 0, loop = false } = {}) {
  const n = list.length;
  if (n === 0) return null;
  const out = { ...list[0].snap };
  if (n === 1) return out;

  for (const key of CONTINUOUS_KEYS) {
    const angular = ANGULAR.has(key);
    const ts = [], vs = [];
    for (let i = 0; i < n; i++) {
      const raw = list[i].snap[key] ?? 0;
      ts.push(list[i].t);
      vs.push(i === 0 || !angular ? raw : vs[i - 1] + angDelta(list[i - 1].snap[key] ?? 0, raw));
    }
    if (loop) {   // kf0's look returns at t=1 (unwrapped so it lands on the same angle)
      ts.push(1);
      vs.push(angular ? vs[n - 1] + angDelta(list[n - 1].snap[key] ?? 0, list[0].snap[key] ?? 0) : vs[0]);
    }
    // per-pass strength is capped at 0.5 (stable Laplacian; >0.5 oscillates when
    // iterated). The control scales that, and SMOOTH_PASSES compounds it.
    if (smoothing > 0) for (let s = 0; s < SMOOTH_PASSES; s++) relaxInterior(ts, vs, smoothing * 0.5);
    let v = hermiteSample(ts, vs, p, loop);
    if (angular) v = ((v % 360) + 360) % 360;
    out[key] = v;
  }
  return out;
}
