// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// kit/zoom.js
//
// UNIFIED ZOOM — the SINGLE distribution the GESTURE zoom entry points route through: the canvas
// pinch/trackpad (components/output-gestures.js) and the remote/MIDI/gamepad pinch
// (shell/input-bus.js). One function, all gesture callers, so the "slice-first-then-canvas" trap
// fix reaches every surface by construction instead of per-path. The composition-zoom slider
// (params.js compZoom) is DELIBERATELY not a caller — it stays a direct `canvasZoom` control (the
// explicit one-axis escape hatch); routing it here would make it fight the gesture's distribution.
//
// sliceScale is the PRIMARY range; canvasZoom EXTENDS it. Zoom OUT grows the slice to full size
// first, then dials canvasZoom below 1×; zoom IN reverses (canvasZoom→1×, shrink the slice, then
// magnify past 1×). `factor` is multiplicative (>1 zoom in, <1 zoom out). Bounds are placeholders —
// Phase B normalizes sliceScale so ~1× = full source, which is where the handoff belongs.

export const Z_SLICE_MIN = 0.05, Z_SLICE_MAX = 5, Z_CANVAS_MIN = 0.15, Z_CANVAS_MAX = 4;
const Z_PIVOT = 1;   // the neutral slice ("full source" — Phase B calibrates); neutral canvas = 1.

// A single monotonic, invertible sweep through (sliceScale, canvasZoom) with the pivot at
// (slice=1, canvas=1). Zoom OUT is SLICE-FIRST (grow the window, then dial canvasZoom < 1 = more
// repeats) — Daniel's spec. Zoom IN MAGNIFIES the canvas first (canvasZoom > 1), then zooms into a
// source detail (slice < 1); it also cleanly undoes a grown window / a zoom-out framing on the way
// back, so pinch-in-then-out returns to where you started (no hysteresis).
export function applyUnifiedZoom(state, factor) {
  let s = state.sliceScale, z = state.canvasZoom;
  if (factor >= 1) {                                              // ZOOM IN
    if (z < 1)                 z = Math.min(1, z * factor);              // undo a zoom-out framing
    else if (s > Z_PIVOT)      s = Math.max(Z_PIVOT, s / factor);        // undo a grown window (→ full)
    else if (z < Z_CANVAS_MAX) z = Math.min(Z_CANVAS_MAX, z * factor);   // MAGNIFY the canvas (primary)
    else                       s = Math.max(Z_SLICE_MIN, s / factor);    // then zoom into a source detail
  } else {                                                        // ZOOM OUT
    if (s < Z_PIVOT)           s = Math.min(Z_PIVOT, s / factor);        // undo a detail-zoom (→ full)
    else if (z > 1)            z = Math.max(1, z * factor);              // undo a magnify (→ 1)
    else if (s < Z_SLICE_MAX)  s = Math.min(Z_SLICE_MAX, s / factor);    // GROW the slice window (primary)
    else                       z = Math.max(Z_CANVAS_MIN, z * factor);   // then more repeats (canvas < 1)
  }
  state.sliceScale = s;
  state.canvasZoom = z;
}
