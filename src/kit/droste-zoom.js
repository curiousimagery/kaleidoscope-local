// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// kit/droste-zoom.js
//
// DROSTE INFINITE ZOOM — the loop math (M3 ride-along). The Droste fold is
// SCALE-PERIODIC: the folded image repeats every time the sampled radius is
// multiplied by drosteZoom (the shader mods logr into the fundamental annulus of
// width logS = log(drosteZoom) — droste.js:170-176). canvasZoom scales the
// sample position (`p /= u_canvasZoom`, shader-builder.js:157), so animating
// canvasZoom multiplicatively across ONE period returns to an identical frame —
// an endless zoom with no seam.
//
// This module is the DRIVER-AGNOSTIC math only: the period, a multiplicative
// wrap that keeps the animated zoom bounded, and a per-frame stepper. It carries
// no clock and no control surface — a toggle, an autoplay field, or a joystick
// all call the same math. (Which of those drives it is an open design decision.)
//
// SEAMLESSNESS PRECONDITIONS (both must hold, else the loop is not identity):
//   • OFFSET CENTERED (drosteOffsetX/Y = 0). The canvas-side Möbius pre-comp
//     (droste.js:125-136) is NOT scale-invariant, so an off-center offset makes
//     canvasZoom·drosteZoom ≠ identity. This is why the offset is default-locked.
//   • SPIRAL = 0 for a PURE zoom. With spiral on, the Lenstra map keeps the
//     radial shift exact (c.real = 1, droste.js:75-81) but leaves a residual
//     rotation of the source per loop (see spiralResidualPerLoop) — a pure zoom
//     then "pops" in rotation at the wrap. A seamless spiral zoom must couple
//     canvasRotation to cancel that residual (the classic Droste screw motion).
//     That coupling is exposed below but NOT yet wired — it needs on-device sign
//     verification before it drives anything.

const clampZoom = (z) => Math.max(1.0001, z || 0);

// The multiplicative period: multiply canvasZoom by this and the folded image is
// identical. WRAP tiers (drosteMirror off) repeat every ×drosteZoom. MIRROR tiers
// repeat every ×drosteZoom² — the fold reflects at each tier boundary (period
// 2·logS), so one factor lands on the mirror image, not the original.
export function drosteZoomPeriod(state) {
  const z = clampZoom(state.drosteZoom);
  return state.drosteMirror ? z * z : z;
}

// Fold a (possibly runaway) zoom back into one loop interval [base, base·period),
// multiplicatively — the folded image is unchanged by the wrap. `base` is the
// zoom the loop is anchored at (a driver may pin it to the user's framing zoom;
// defaults to 1× = the natural canvas). period from drosteZoomPeriod(state).
export function wrapZoomToLoop(zoom, period, base = 1) {
  if (!(period > 1) || !(base > 0) || !(zoom > 0)) return zoom;
  const logP = Math.log(period);
  let ph = Math.log(zoom / base);                 // phase, in log-zoom space
  ph -= Math.floor(ph / logP) * logP;             // wrap into [0, logP)
  return base * Math.exp(ph);
}

// One frame of infinite zoom: grow (or shrink) canvasZoom by dLog nepers of
// log-zoom, then wrap. dLog > 0 zooms IN, < 0 zooms OUT; magnitude = speed × dt.
// Driver-agnostic — the caller owns the clock and the speed dial.
export function stepZoomLoop(zoom, state, dLog, base = 1) {
  return wrapZoomToLoop((zoom || base) * Math.exp(dLog), drosteZoomPeriod(state), base);
}

// The residual SOURCE rotation (radians) left after one wrap-tier loop when
// spiral ≠ 0 — the amount canvasRotation must advance per loop to keep a spiral
// zoom seamless. 0 at spiral = 0. Derivation: θ_src = θ + c.y·logr with
// c.y = −spiral·logS/(2π); one loop shifts logr by −logS ⇒ Δθ_src = spiral·logS²/(2π).
// EXPOSED, NOT WIRED — sign/coupling need on-device confirmation before use.
export function spiralResidualPerLoop(state) {
  const spiral = state.drosteSpiral || 0;
  if (!spiral) return 0;
  const logS = Math.log(clampZoom(state.drosteZoom));
  const loops = state.drosteMirror ? 2 : 1;       // mirror period is 2·logS
  return (spiral * logS * logS) / (2 * Math.PI) * loops;
}
