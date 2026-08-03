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

// helper: does this form have a MEANINGFUL CENTER that panning would pull you off?
//
// Originally this was hardcoded as "radial or droste", on the reasoning that only those two have a
// focal point and the tileable forms are translation-symmetric so panning them is free. That reading
// was too narrow (Daniel, 2026-08-03): hexagonal mirroring also has a clear center, and drifting off
// it while pinching to zoom is disconcertingly easy — the two-finger gesture composes pan with zoom,
// so any centroid travel during a pinch pans as a side effect. It's a property of the FORM's
// symmetry, not of whether it happens to tile: p6m reads as radiating from a point, p4m/p3m1 read as
// wallpaper. So it belongs on the form.
//
// `centerLock: true` means "defaults to centered, unlock (state.panManual) to translate".
export function formCenterLocked(state) {
  return !!getActiveForm(state).centerLock;
}
