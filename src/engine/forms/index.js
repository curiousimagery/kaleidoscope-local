// forms/index.js
//
// the registry. ALL forms are listed here, in DISPLAY ORDER. the form picker
// renders them in this order; the engine resolves form IDs against this list;
// shader-builder concatenates each form's GLSL in this order.
//
// to add a new form:
//   1. copy _template.js to a new file (e.g. droste.js)
//   2. fill in the schema
//   3. add an import here and append to FORMS
// nothing else needs to know about the new form.
//
// to remove a form, delete it from this array. the new ordering becomes
// canonical immediately. existing exports retain their fileCode, but new
// exports won't reference the removed form.

import radial from './radial.js';
import square from './square.js';
import hex from './hex.js';
import triangle from './triangle.js';
import droste from './droste.js';

export const FORMS = [radial, square, hex, triangle, droste];

// build a lookup table: id → form module. used by the engine and shell when
// they need to resolve state.form (a string) to the active form object.
export const FORMS_BY_ID = Object.fromEntries(FORMS.map(f => [f.id, f]));

// helper: get the active form, defaulting to the first form if state.form
// references something that's not registered (e.g. removed form, typo).
export function getActiveForm(state) {
  return FORMS_BY_ID[state.form] || FORMS[0];
}

// helper: get the index of the active form in display order. useful for the
// shader's switch statement and form-picker active-state highlighting.
export function getActiveFormIndex(state) {
  const idx = FORMS.findIndex(f => f.id === state.form);
  return idx < 0 ? 0 : idx;
}

// helper: the per-form perceived-SIZE normalization multiplier. `sliceScale` is global, but each
// form maps it to a different fundamental-domain size — hex/triangle (SIZE=0.6) read much smaller
// than radial/rectangle/droste at the same sliceScale (Daniel's long-standing note). A form's
// `sizeNorm` (default 1.0) scales the EFFECTIVE slice factor so sliceScale=1.0 is perceptually
// comparable across forms. MUST be applied at EVERY sliceScale consumer — the shader's u_sliceFactor,
// the overlay geometry, and the sharpness hint — or the overlay wedge desyncs from the render.
export function formSizeNorm(state) {
  return getActiveForm(state).sizeNorm ?? 1;
}

// helper: the per-form CANVAS-ZOOM normalization multiplier — "redefine what 1× means" per form
// (Daniel). Applied to the shader's u_canvasZoom so a form that reads too zoomed-out (triangle packs
// denser tiles than hex) opens bigger while the composition-zoom slider still shows 1×. State stays
// raw (the slider value is unchanged); only the RENDER scales — the overlays are source-space, so
// nothing to desync. Distinct from sizeNorm, which scales the SLICE sample. Default 1.0.
export function formCanvasNorm(state) {
  return getActiveForm(state).canvasNorm ?? 1;
}

// helper: does this form DEFAULT to pan-locked (centered)?
//
// Originally this was hardcoded as "radial or droste", on the reasoning that only those two have a
// focal point and the tileable forms are translation-symmetric so panning them is free. That reading
// was too narrow (Daniel, 2026-08-03): hexagonal mirroring also has a clear center, and drifting off
// it while pinching to zoom is disconcertingly easy — the two-finger gesture composes pan with zoom,
// so any centroid travel during a pinch pans as a side effect. It's a property of the FORM's
// symmetry, not of whether it happens to tile: p6m reads as radiating from a point, p4m/p3m1 read as
// wallpaper. So it belongs on the form.
//
// EVERY form is lockable (Daniel, 2026-08-03) — the padlock, the progressive disclosure of the
// pan joystick, and the mechanism behind them are identical everywhere. The ONLY per-form
// difference is which way the lock starts: forms with a center default LOCKED, wallpaper forms
// default UNLOCKED. `panLockedByDefault: true` declares the former.
export function formPanLockedByDefault(form) {
  return !!(form && form.panLockedByDefault);
}

// The per-form ZOOM-OVERFLOW bounds (kit/zoom.js). The unified zoom is canvas-primary and only
// spills into `sliceScale` once canvasZoom is pinned at a wall: growing toward `zoomCover` on the
// way out ("the slice now covers the source") and shrinking toward `zoomInFloor` on the way in.
//
// These were flat module constants (3 and 0.7) with a note that M4 Phase B should make them
// per-form, and the note was right: "covers the source" is a different sliceScale for a small
// radial wedge than for a hex cell, so one number is necessarily wrong for four of the five forms.
// Wrong in a way that matters, too — too low re-introduces the zoom trap the canvas-primary model
// exists to remove, too high lets the slice overshoot into the unwieldy extreme it exists to avoid.
//
// Defaults keep the previous flat values, so a form that declares nothing behaves exactly as before.
export function formZoomBounds(state) {
  const f = getActiveForm(state);
  return { cover: f.zoomCover ?? 3, inFloor: f.zoomInFloor ?? 0.7 };
}

// Is pan locked RIGHT NOW for the active form? `state.panLock` holds per-form user overrides
// (formId → boolean); absent means "use this form's default". Lives on STATE rather than in
// session.locks because the ENGINE needs the answer — the shader zeroes u_canvasOffset while
// locked, and the engine can see state but not the shell's session.
export function formPanLocked(state) {
  const form = getActiveForm(state);
  const override = state.panLock && state.panLock[form.id];
  return override !== undefined ? !!override : formPanLockedByDefault(form);
}
