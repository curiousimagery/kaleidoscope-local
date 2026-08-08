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
// it on the way back — a benign, deep-excursion-only stickiness, not a normal-use effect.

import { formZoomBounds } from '../engine/forms/index.js';

// The zoom-IN floor guards how far the CANVAS zoom may shrink the SLICE. Growing the slice on
// zoom-OUT (the cover bound) reads naturally, but shrinking it on zoom-IN felt unexpected (Daniel:
// "reducing the slice from adjusting the canvas"), so the zoom-IN overflow stops once the slice
// covers ~70% of the source — the canvas simply can't zoom in past that. Going smaller (real source
// detail) is a deliberate SLICE-control action, not a side effect of the canvas gesture.
//
// The CANVAS bounds are genuinely form-agnostic (canvasZoom means the same thing everywhere), so
// they stay module constants. The SLICE overflow bounds are per-form — see formZoomBounds.
export const Z_CANVAS_MIN = 0.05, Z_CANVAS_MAX = 4;
// The per-form slice defaults used to be duplicated here, with a comment saying formZoomBounds
// consulted them. It never did — it carried its own literals — so changing these changed nothing
// and would have quietly misled the next person tuning zoom extents. They now live beside the
// function that reads them (engine/forms/index.js: ZOOM_COVER_DEFAULT / ZOOM_IN_FLOOR_DEFAULT).

export function applyUnifiedZoom(state, factor) {
  const { cover, inFloor } = formZoomBounds(state);
  let s = state.sliceScale, z = state.canvasZoom;
  if (factor >= 1) {                                              // ZOOM IN
    if (z < Z_CANVAS_MAX) z = Math.min(Z_CANVAS_MAX, z * factor);  // PRIMARY: magnify the canvas (slice held)
    else if (s > inFloor) s = Math.max(inFloor, s / factor);       // GUARDED overflow: the canvas won't shrink the slice past this form's detail floor
  } else {                                                        // ZOOM OUT
    if (z > Z_CANVAS_MIN) z = Math.max(Z_CANVAS_MIN, z * factor);  // PRIMARY: more repeats (slice held)
    else if (s < cover)   s = Math.min(cover, s / factor);         // overflow past the wall: grow the slice until it covers the source for this form
  }
  state.sliceScale = s;
  state.canvasZoom = z;
}
