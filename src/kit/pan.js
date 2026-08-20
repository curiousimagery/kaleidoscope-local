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
// ⚠️ THE PAN PROBE (B692) — because three attempts at this bug have been reasoned, not measured.
//
// Daniel's symptom after B691 is *"less able to move after already moving a bit away from center"*,
// and **no model proposed so far predicts progressive resistance**: a constant gain against a hard
// bound gives linear travel then a stop, not increasing drag. So the next move is not another fix.
//
// This records what each pan application actually ASKED for and what the state actually BECAME.
// The gap between those two numbers is the whole question, and it separates the three live
// candidates in one drag:
//   • `asked` shrinking as |offset| grows      → something is scaling the gain by displacement
//   • `asked` steady but `got` < `asked`       → the clamp is biting early (a bound problem)
//   • `asked` steady, `got` == `asked`, but the PICTURE does not move → the offset is not what
//     moves the image, and the bug is downstream of everything examined so far
//
// Always on: a ring of plain numbers, written only while a pan is actually running.
//
// ⚠️ B693 — DECIMATED, BECAUSE B692's RING COULD NOT HOLD A DRAG. A touchmove fires ~60×/s, so a
// 24-entry ring held the last 0.4 SECONDS of the last gesture: it could never show how the pan
// behaved as displacement grew, which is the entire question. An instrument that cannot capture
// the phenomenon is not an instrument (`docs/DEVICE-TESTING.md`: an uncollectable diagnostic is no
// diagnostic), so this keeps ~20 seconds of pans instead of half a second of one.
//
// Three rules, in priority order. Each exists so a specific reading survives thinning:
//   • a GAP > 250ms starts a new gesture and is always kept — the first sample is the one that
//     says where the drag began, and a decimator that dropped it would lose the baseline;
//   • a change in `clamped` is always kept — the exact moment the wall arrives is the single most
//     informative sample in the trail, and it can land between throttle ticks;
//   • otherwise keep at most one per 60ms, which is ~16Hz: dense enough to draw the travel curve,
//     sparse enough that three long drags fit.
const PAN_TRAIL = 300;
const PAN_MIN_MS = 60;
const PAN_GAP_MS = 250;
const panTrail = [];
let panLastAt = -Infinity, panLastKeptAt = 0, panLastClamped = null, panGesture = 0;   // -Inf so the very first pan counts as a gesture start

export function notePan(entry) {
  const at = performance.now();
  const fresh = at - panLastAt > PAN_GAP_MS;
  if (fresh) { panGesture++; panLastKeptAt = 0; panLastClamped = null; }
  panLastAt = at;
  const keep = fresh || entry.clamped !== panLastClamped || at - panLastKeptAt >= PAN_MIN_MS;
  if (!keep) return;
  panLastKeptAt = at;
  panLastClamped = entry.clamped;
  panTrail.push({ at: Math.round(at), g: panGesture, ...entry });
  if (panTrail.length > PAN_TRAIL) panTrail.shift();
}

export function panProbe() {
  if (!panTrail.length) return null;
  return {
    note: 'asked = the offset the gain produced before clamping; got = what state became after. g = gesture index; entries are decimated to ~16Hz, keeping every gesture start and every clamp transition.',
    gestures: panGesture,
    trail: panTrail.slice(),
  };
}

export function panFor(fShortX, fShortY, canvasRotationDeg = 0, zoom = 1, bound = null) {
  return bound == null
    ? panDelta(fShortX, fShortY, canvasRotationDeg, zoom)
    : panDeltaBounded(fShortX, fShortY, canvasRotationDeg, bound);
}
