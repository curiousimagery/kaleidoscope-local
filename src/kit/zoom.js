// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// kit/zoom.js
//
// UNIFIED ZOOM — the SINGLE distribution every zoom entry point routes through: the canvas
// pinch/trackpad (components/output-gestures.js), the remote/MIDI/gamepad pinch (shell/input-bus.js),
// and — later — the composition-zoom slider. One function, all callers, so the "slice-first-then-
// canvas" trap fix reaches every surface by construction instead of per-path.
//
// sliceScale is the PRIMARY range; canvasZoom EXTENDS it. Zoom OUT grows the slice to full size
// first, then dials canvasZoom below 1×; zoom IN reverses (canvasZoom→1×, shrink the slice, then
// magnify past 1×). `factor` is multiplicative (>1 zoom in, <1 zoom out). Bounds are placeholders —
// Phase B normalizes sliceScale so ~1× = full source, which is where the handoff belongs.

export const Z_SLICE_MIN = 0.05, Z_SLICE_MAX = 5, Z_CANVAS_MIN = 0.15, Z_CANVAS_MAX = 4;

export function applyUnifiedZoom(state, factor) {
  let s = state.sliceScale, z = state.canvasZoom;
  if (factor >= 1) {                                          // ZOOM IN
    if (z < 1)                z = Math.min(1, z * factor);
    else if (s > Z_SLICE_MIN) s = Math.max(Z_SLICE_MIN, s / factor);
    else                      z = Math.min(Z_CANVAS_MAX, z * factor);
  } else {                                                    // ZOOM OUT
    if (z > 1)                z = Math.max(1, z * factor);
    else if (s < Z_SLICE_MAX) s = Math.min(Z_SLICE_MAX, s / factor);
    else                      z = Math.max(Z_CANVAS_MIN, z * factor);
  }
  state.sliceScale = s;
  state.canvasZoom = z;
}
