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

// THE ONE PAN GAIN, shared by every surface (B611). Takes a finger displacement expressed as a
// FRACTION OF THE GESTURE SURFACE'S SHORT SIDE — which makes it screen-size independent by
// construction, so a phone, a tablet and the app's own canvas all speak the same units — and
// returns the canvasOffset delta, rotation folded in.
//
// The contract: drag across the short side of whatever you are touching, and content travels the
// short side of the host canvas. Any device, any size.
//
// The 1/zoom is the whole reason this exists. `u_canvasOffset` is subtracted AFTER
// `p /= u_canvasZoom` (shader-builder), so one offset unit moves content on screen in PROPORTION
// to the zoom. Every surface previously carried its own hand-tuned constant to paper over that
// (3.5 locally, 3 × 1.2 on the remote) and none of them divided by the zoom, so all of them
// accelerated as you zoomed in and crawled as you zoomed out. Derived, not tuned:
//   δ = 2 · fShort / Z      (2 because fShort is a full-side fraction, offsets are half-side units)
export function panDelta(fShortX, fShortY, canvasRotationDeg = 0, zoom = 1) {
  const g = 2 / Math.max(1e-4, zoom);
  return panToOffset(fShortX * g, fShortY * g, canvasRotationDeg);
}

// ⚠️ B691 — A BOUNDED PAN NEEDS A DIFFERENT GAIN, AND THE 1/zoom ABOVE IS WHY THE LAST TWO
// ATTEMPTS FAILED.
//
// `panDelta`'s contract — "drag across the short side, content travels the short side" — is right
// for a LATTICE form, which has no bound and wraps. On a BOUNDED form (radial, droste) the same
// 1/zoom makes the gain explode as you zoom out:
//
//   zoom 0.25 · one full drag asks for 8.0 units against a bound of 2 → the wall arrives after a
//               QUARTER of a drag, and every pixel of finger travel moves 4 units. **That is
//               Daniel's "very jerky and barely moves off center": an enormous gain pinned against
//               a wall it reaches almost immediately.**
//   zoom 4    · one full drag asks for 0.5 against the same bound → four full drags to cross,
//               which is his "works better... until it hits a wall".
//
// So B688 fixed the bound (it no longer moves under zoom, which killed the drift) and left the
// gain wrong in the opposite direction at each end. **Both symptoms are one cause.**
//
// For a bounded form the natural unit is the RANGE, not the screen: a full-side drag moves you
// `bound` units — half the total travel — at every zoom. Same feel zoomed in or out, no explosion,
// and the wall is exactly two drags away instead of a quarter of one.
export function panDeltaBounded(fShortX, fShortY, canvasRotationDeg = 0, bound = 1) {
  const g = Math.max(1e-4, bound);
  return panToOffset(fShortX * g, fShortY * g, canvasRotationDeg);
}

// The one call every pan surface should make. `bound` null/undefined = an unbounded lattice form,
// which keeps the screen-proportional contract; a number = a bounded form, which gets range units.
export function panFor(fShortX, fShortY, canvasRotationDeg = 0, zoom = 1, bound = null) {
  return bound == null
    ? panDelta(fShortX, fShortY, canvasRotationDeg, zoom)
    : panDeltaBounded(fShortX, fShortY, canvasRotationDeg, bound);
}
