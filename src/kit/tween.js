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
