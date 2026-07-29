// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// kit/pan.js
//
// Shared canvas-PAN transform — the single place the "screen finger travel → canvasOffset
// delta" mapping lives, so every pan entry point (the local output gesture in
// components/output-gestures.js AND the remote/phone gesture in shell/input-bus.js) folds in
// the SAME three sign/space facts and pans identically. Extracted so a second surface can't
// silently drift from the first (the registry-hardening "one shared fn per input axis" rule;
// kit/zoom.js is the zoom sibling).
//
// Folds in three facts, all undone here (derivation: δO = −A·M·f):
//   • Y flip: v_uv makes shader p.y point UP (shader-builder.js), while client Y points DOWN.
//   • X-negation: u_canvasOffset negates X but not Y, an axis reflection A = diag(1,−1).
//   • Rotation: the offset is subtracted in the shader's POST-rotation space, so the drag is
//     counter-rotated by the current canvas rotation M.
// fx/fy are a desired CONTENT displacement in CLIENT orientation (x right+, y DOWN+), each
// normalized to half-canvas units. Returns [dOffsetX, dOffsetY] to ADD to canvasOffset.
// Identity-free even at 0° (it negates), which is why touch read inverted before B443.

export function panToOffset(fx, fy, canvasRotationDeg = 0) {
  const r = canvasRotationDeg * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return [-c * fx - s * fy, s * fx - c * fy];
}
