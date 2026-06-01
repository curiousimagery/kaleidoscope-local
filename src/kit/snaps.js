// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// kit/snaps.js
//
// Droste arms/spiral snapping — pure functions of the shared state object.
// Kit layer: no DOM, no chrome. Imported by the desktop chrome and by the
// source-overlay component (which adjusts arms via direct manipulation), so the
// snap math is defined once and never reimplemented per chrome.

// Snap step for the spiral (tiers-per-turn) depends on drosteArms AND drosteMirror:
//   - arms ≥ 2: base step is 1/arms (matches wedge closure)
//   - arms = 1: base step is 1 (integer tiers per turn)
//   - tier mirror ON: step doubles (only even multiples of base) because odd
//     tier-counts land in a reflected tier and misalign at the canvas seam
export function armsSnapStep(state) {
  const n = Math.round(state.drosteArms || 1);
  const armsEven = n <= 1 ? 1 : Math.max(2, Math.min(12, n - (n % 2)));
  const base = 1 / armsEven;
  return state.drosteMirror ? base * 2 : base;
}

export function snapSpiralValue(state, v) {
  const step = armsSnapStep(state);
  return Math.max(0, Math.min(6, Math.round(v / step) * step));
}

export function applyArmsSnap(state) {
  // Slider step kept fine-grained (0.001) so snap is purely value-side.
  state.drosteSpiral = snapSpiralValue(state, state.drosteSpiral || 0);
}
