// forms/_template.js
//
// COPY THIS FILE to add a new form. fill in the fields below, then register the
// new module in forms/index.js. that's the only place outside this file that
// needs to know about it.
//
// the form-module schema is the contract between the engine and a form's math:
// the engine knows nothing about your form's internals; it just calls your
// declared functions and reads your declared GLSL.
//
// SHADER COMPOSITION: at compile time, shader-builder.js stitches together the
// preamble (uniforms, helpers, sampleSource, toSourceUV) plus every form's
// fold function, then a switch in main() that dispatches on u_formIndex.
// each form's fold function is named foldXXX (where XXX is the form id) and
// receives a vec2 p in canvas space [-1, 1]² (post canvas rot/zoom) and returns
// a vec2 in folded sample space (then passed through toSourceUV).
//
// JS / SHADER PARALLEL: buildPolygon() must return vertices in the SAME folded
// space your fold function produces. the overlay renders these vertices through
// the same toSourceUV math the shader uses, so the highlighted region
// accurately represents what's sampled. when the math drifts between JS and
// GLSL, the overlay wedge stops matching the rendered output — see CHANGELOG
// v0.0.5 for the diagnostic story behind this lesson.

export default {
  // UNIQUE STRING ID. used in state.form, filenames, registry lookup. lowercase,
  // no spaces.
  id: 'template',

  // DISPLAY LABEL for tooltips and form-picker hover state.
  label: 'Template',

  // FILE CODE for export filenames. one or two letters, no overlap with other forms.
  fileCode: 't',

  // SVG THUMBNAIL for the form picker. 32×32 viewBox; group must have class
  // "stroke" so the active/inactive color theming applies.
  thumbnail: `<svg viewBox="0 0 32 32"><g class="stroke">
    <!-- your shape here -->
  </g></svg>`,

  // WHICH SLICE CONTROLS this form uses. determines which sliders are shown
  // when this form is active. valid keys: 'segments' (radial), 'aspect' (square).
  // 'scale' and 'rotation' are universal and always shown.
  controls: [],

  // PER-FORM UNIFORMS this form's GLSL reads. shader-builder declares these
  // uniforms in the shader and pulls values from state via the get() function.
  // type is one of '1f' | '1i' | '2f' (matches gl.uniformXxx names).
  uniforms: {
    // u_someParam: { type: '1f', get: (state) => state.someParam },
  },

  // GLSL FOLD FUNCTION — fragment-shader code.
  //
  // input  p:  vec2 in canvas space, post canvas rot/zoom. range [-1, 1]² with
  //            corners up to |p|=√2.
  // output:    vec2 in folded sample space — by convention, the canvas mid-edges
  //            (|p|=1) should map to |output|=1 (the "outer boundary" of your
  //            fundamental region). canvas corners may sample beyond and the
  //            dashed amber stroke handles that case visually.
  //
  // FUNCTION NAME must be `fold${id}` with id capitalized (e.g. foldRadial).
  // SHADER GLOBALS available: PI, TAU, SQRT2, SQRT3 (defines), and any uniforms
  // you declared in `uniforms` above plus universal ones (u_segments, etc.).
  glsl: `
    vec2 foldTemplate(vec2 p) {
      // your fold math here
      return p;
    }
  `,

  // SPOKE RULE — how this form's polygon edges interact with the direct-
  // manipulation hit-tester for spoke gestures. one of:
  //   'radial'  — center-incident edges are spokes; dragging perpendicular to
  //               a spoke adjusts segment count. (radial form behavior.)
  //   'hex'     — center-incident edges are visual artifacts only; scale should
  //               only fire on the FAR (cell-boundary) edge. (hex form behavior.)
  //   'none'    — no spokes; cell boundary is the entire polygon outline.
  //               (square form behavior.)
  spokeRule: 'none',

  // BUILD POLYGON — return vertex array bounding the sample region in folded
  // space. these vertices are the SAME ones the shader's fold function maps to;
  // the overlay renders them via toSourceUV to show the user what's sampled.
  // returns: Array<{ vx, vy }> (folded-space coordinates).
  buildPolygon(state) {
    return [
      { vx: 0, vy: 0 },
      { vx: 1, vy: 0 },
      { vx: 0, vy: 1 },
    ];
  },

  // OPTIONAL: filename suffix for this form's per-form parameters (e.g.
  // square form encodes squareAspect). returns a short string appended after
  // the form-code in the export filename. omit to write nothing.
  filenameSuffix(state) {
    return '';
  },

  // OPTIONAL: tile-density for the resolution hint. returns the linear count
  // of distinct sample-tiles fitting across one output axis at canvasZoom=1.
  // the engine multiplies this by sourceMin × sliceScale / canvasZoom and
  // applies a perceptual softening factor to compute the suggested resolution.
  // if omitted, defaults to 1 (probably wrong — implement this for accuracy).
  tilesPerDim(state) {
    return 1;
  },
};
