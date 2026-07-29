// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// kit/zoom.js
//
// UNIFIED ZOOM — the SINGLE distribution the GESTURE zoom entry points route through: the canvas
// pinch/trackpad (components/output-gestures.js) and the remote/MIDI/gamepad pinch
// (shell/input-bus.js). One function, all gesture callers, so the model reaches every surface by
// construction instead of per-path. The composition-zoom slider (params.js compZoom) is
// DELIBERATELY not a caller — it stays a direct `canvasZoom` control (the explicit one-axis escape
// hatch); routing it here would make it fight the gesture's distribution.
//
// MODEL — CANVAS-PRIMARY with a BOUNDED SLICE OVERFLOW (Daniel, 2026-07-28, after a UX-history
// review). The output pinch drives `canvasZoom` across its whole range and LEAVES `sliceScale`
// alone — so the slice you set in the source panel is preserved, and "small slice + zoom way out
// = the same small slice repeated a gazillion times" works by construction (canvasZoom < 1 = more
// repeats). ONLY when canvasZoom is pinned at a wall does the gesture "overflow" into the slice
// (grow toward COVER on the way out, shrink toward MIN for detail on the way in) — so it never
// dead-ends (no trap) yet never shoves the slice to an unwieldy extreme. This REPLACES the earlier
// slice-first sweep, which pinned the slice at max on zoom-out (crazy reflections, no slice-shape
// control there) and couldn't reach small-slice + mega-repeat at all.
//
// `factor` is multiplicative (>1 zoom in, <1 zoom out). INVERTIBLE in the normal (canvas) range —
// pinch out then in returns exactly (canvasZoom·f/f, slice untouched). In the rare OVERFLOW
// excursion (canvasZoom already pinned at a wall) the slice is left where the overflow grew/shrank
// it on the way back — a benign, deep-excursion-only stickiness, not a normal-use effect. Bounds
// are placeholders — M4 Phase B normalizes sliceScale per form so Z_SLICE_COVER = "covers source".

// Z_SLICE_IN_FLOOR guards how far the CANVAS zoom may shrink the SLICE. Growing the slice on
// zoom-OUT (Z_SLICE_COVER) reads naturally, but shrinking it on zoom-IN felt unexpected (Daniel:
// "reducing the slice from adjusting the canvas"), so the zoom-IN overflow stops once the slice
// covers ~70% of the source — the canvas simply can't zoom in past that. Going smaller (real source
// detail) is a deliberate SLICE-control action, not a side effect of the canvas gesture. (Placeholder
// ~0.7 ≈ "70% of source"; M4 Phase B calibrates per-form alongside Z_SLICE_COVER.)
export const Z_SLICE_IN_FLOOR = 0.7, Z_SLICE_COVER = 3, Z_CANVAS_MIN = 0.05, Z_CANVAS_MAX = 4;

export function applyUnifiedZoom(state, factor) {
  let s = state.sliceScale, z = state.canvasZoom;
  if (factor >= 1) {                                                    // ZOOM IN
    if (z < Z_CANVAS_MAX)          z = Math.min(Z_CANVAS_MAX, z * factor);  // PRIMARY: magnify the canvas (slice held)
    else if (s > Z_SLICE_IN_FLOOR) s = Math.max(Z_SLICE_IN_FLOOR, s / factor);  // GUARDED overflow: canvas won't shrink the slice below ~70% source
  } else {                                                              // ZOOM OUT
    if (z > Z_CANVAS_MIN)          z = Math.max(Z_CANVAS_MIN, z * factor);  // PRIMARY: more repeats (slice held)
    else if (s < Z_SLICE_COVER)    s = Math.min(Z_SLICE_COVER, s / factor); // overflow past the wall: grow the slice to cover
  }
  state.sliceScale = s;
  state.canvasZoom = z;
}
