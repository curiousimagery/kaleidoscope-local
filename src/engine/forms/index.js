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

export const FORMS = [radial, square, hex];

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
