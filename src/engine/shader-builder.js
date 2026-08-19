// engine/shader-builder.js
//
// composes the fragment shader source by stitching together:
//   1. the preamble (version, precision, in/out, common uniforms, constants,
//      sampleSource, toSourceUV)
//   2. each form module's per-form uniforms (declared once each)
//   3. each form module's fold function (named foldXxx, where Xxx is the form
//      id capitalized)
//   4. main(), which reads u_formIndex and dispatches to the right fold via a
//      switch.
//
// the form's GLSL string is inserted verbatim — it can refer to any common
// uniforms (u_segments, u_canvasZoom, etc.), any uniforms it declared via the
// `uniforms` field, and the constants PI / TAU / SQRT2 / SQRT3.
//
// also collects the union of all uniforms for use by gl.js when looking up
// uniform locations and pushing values per-frame.

import { FORMS, formSizeNorm, formCanvasNorm, formPanLocked, formOffsetBound } from './forms/index.js';
import { sliceMirror } from './geometry.js';

// uniforms common to ALL forms. these are the shared scaffolding the shader
// preamble depends on. order matters only for readability of the generated
// source; gl.js looks them up by name.
//
// each entry: name → { type: '1f' | '1i' | '2f', get: (state, ctx) => value }
// where ctx provides any non-state values (e.g. sourceAspect from the loaded
// image). returning a 2-element array for vec2 types is fine; gl.js spreads.
const COMMON_UNIFORMS = {
  u_source:        { type: '1i', get: () => 0 /* texture unit 0 */ },
  u_formIndex:     { type: '1i', get: (state, ctx) => ctx.formIndex },
  u_segments:      { type: '1f', get: (state) => state.segments },
  u_canvasRot:     { type: '1f', get: (state) => state.canvasRotation * Math.PI / 180 },
  u_canvasZoom:    { type: '1f', get: (state) => state.canvasZoom * formCanvasNorm(state) },   // per-form "1×" redefinition
  // TILING PAN — canvas-space translation applied before the fold. Stored UNWRAPPED for
  // smooth follower/tween/autoplay; wrapped HERE mod the active form's lattice period so the
  // float32 input stays bounded (the fold wraps it anyway, so this is image-identical). Forms
  // without a latticePeriod() (radial/droste) get the raw offset (0 unless ③ drives it later).
  u_canvasOffset:  { type: '2f', get: (state) => {
    // A pan-LOCKED form renders centered (every form is lockable; only the default differs —
    // see formPanLocked). Non-destructive: the stored offset is ignored here, not cleared, so
    // unlocking restores exactly where you were.
    if (formPanLocked(state)) return [0, 0];
    const form = FORMS.find(f => f.id === state.form);
    const period = form && form.latticePeriod && form.latticePeriod(state);
    // X negated so pushing the joystick RIGHT pans the pattern right (Daniel: X read backwards);
    // Y already reads correctly. This is the single sign-convention point for canvasOffset.
    const ox = -(state.canvasOffsetX || 0), oy = state.canvasOffsetY || 0;
    // NON-LATTICE forms (radial, droste) have no periodicity to make a large offset meaningful,
    // and the offset is ONE GLOBAL VALUE shared by every form. On a tiling form it accumulates
    // UNWRAPPED and is only kept sane by the wrap below — so a long pan on square leaves a large
    // raw value that means nothing here, and droste then reads it verbatim.
    //
    // In droste that is not a translation, it is a shift of the LOG-POLAR CENTRE: a large offset
    // squeezes the whole visible field into a thin annulus, which reads as an extreme zoom into a
    // tiny sample. Daniel's B610 repro exactly — pan around on square, switch to droste, unlock
    // pan, and the canvas leaps to a sample far smaller than the slice overlay.
    //
    // Bounded to the range droste itself declares sane for a centre shift (drosteOffsetX/Y, ±1)
    // rather than the tiling range (±2), because for these forms it IS a centre shift. Clamped
    // rather than cleared, to keep the non-destructive contract above.
    // ⚠️ THE BOUND IS PER-FORM (2026-08-19). It was a flat ±1 for every non-lattice form, which
    // is right for droste (a log-polar centre shift) and wrong for radial (an ordinary pan): see
    // formOffsetBound. Radial's bound widens as you zoom out, which is what keeps a full-side
    // drag from saturating at zoom 1.
    const b = formOffsetBound(state);
    const clampB = (v) => Math.max(-b, Math.min(b, v));
    if (!period) return [clampB(ox), clampB(oy)];
    const wrap = (v, p) => (p > 0 ? ((v % p) + p) % p : v);
    return [wrap(ox, period[0]), wrap(oy, period[1])];
  } },
  u_sliceFactor:   { type: '1f', get: (state) => state.sliceScale * formSizeNorm(state) },   // per-form perceived-size norm
  u_sliceRot:      { type: '1f', get: (state) => state.sliceRotation * Math.PI / 180 },
  u_sliceCenter:   { type: '2f', get: (state) => [state.sliceCx, state.sliceCy] },
  // B635 — slice HANDEDNESS (±1 per axis). Read through `sliceMirror` rather than off state
  // directly: a pre-B635 saved session has neither field, and an undefined here reaches the GPU as
  // NaN, which blanks the canvas rather than failing loudly.
  u_sliceMirror:   { type: '2f', get: (state) => { const m = sliceMirror(state); return [m.mx, m.my]; } },
  u_sourceAspect:  { type: '1f', get: (state, ctx) => ctx.sourceAspect },
  u_oobMode:       { type: '1i', get: (state) => state.oobMode },
  // output framebuffer aspect (width/height). 1.0 for the square preview; the FBO
  // export sets it so non-square output is an undistorted crop, not a stretch.
  u_outputAspect:  { type: '1f', get: (state, ctx) => (ctx && ctx.outputAspect) || 1.0 },
};

// vertex shader is universal — full-screen quad in clip space, passing UVs.
export const VERT_SRC = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

// preamble — everything before the form-specific fold functions. uniforms are
// declared dynamically because per-form uniforms come from the registry; only
// the common uniforms are baked into the preamble.
const COMMON_PREAMBLE = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform int   u_formIndex;
uniform float u_segments;
uniform float u_canvasRot;
uniform float u_canvasZoom;
uniform vec2 u_canvasOffset;
uniform float u_sliceFactor;
uniform float u_sliceRot;
uniform vec2  u_sliceCenter;
uniform vec2  u_sliceMirror;
uniform float u_sourceAspect;
uniform float u_outputAspect;
uniform int   u_oobMode;

#define PI 3.14159265359
#define TAU 6.28318530718
#define SQRT2 1.4142135623730951
#define SQRT3 1.7320508075688772

vec4 sampleSource(vec2 uv) {
  if (u_oobMode == 1) {
    // mirror tiling: triangular wave mapping uv ∈ ℝ to uv ∈ [0, 1].
    // formula: 1 - abs(fract(u * 0.5) * 2 - 1) — see CHANGELOG v0.0.8.
    uv = 1.0 - abs(fract(uv * 0.5) * 2.0 - 1.0);
    return texture(u_source, uv);
  } else if (u_oobMode == 2) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
    return texture(u_source, uv);
  }
  return texture(u_source, clamp(uv, 0.0, 1.0));
}

// transform a folded-2D vector into a source-UV sample point.
// rotation convention: CW positive (matching screen-space y-down).
vec2 toSourceUV(vec2 v) {
  float c = cos(u_sliceRot), s = sin(u_sliceRot);
  v = mat2(c, s, -s, c) * v;  // GLSL col-major: matrix [[c,-s],[s,c]]
  v *= 0.5 * u_sliceFactor;
  if (u_sourceAspect >= 1.0) {
    v.x /= u_sourceAspect;
  } else {
    v.y *= u_sourceAspect;
  }
  // negate v.y: textures upload with UNPACK_FLIP_Y_WEBGL=false (image top-left
  // at UV 0,0), so canvas-y-positive (math up) must map to UV-y-negative
  // (texture-up) to keep canvas-top sampling source-top. Without this, source
  // appears upside-down at default state on forms without mirror symmetry
  // (e.g. Droste at arms=1). Invisible on mirror-symmetric forms.
  //
  // u_sliceMirror (B635) is the slice's HANDEDNESS, ±1 per axis, applied to the finished offset.
  // Mirror-mode sampling is symmetric about every source edge, so (centre + off) and
  // (2·edge − centre − off) are the same texel — which is what lets the JS side fold the origin
  // back onto the image without the picture changing. Both halves of that identity have to agree,
  // so this line and geometry.js sliceVecToSourceUV must stay in lockstep.
  // (No backticks in here — this is a JS template literal and one would break the parse silently.)
  return vec2(v.x, -v.y) * u_sliceMirror + u_sliceCenter;
}
`;

// capitalize form id for fold function name. 'radial' → 'Radial' → 'foldRadial'.
function capitalize(id) {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

// build the complete fragment shader source by stitching preamble + per-form
// uniform declarations + per-form fold functions + main().
export function buildFragmentSource() {
  // collect per-form uniform declarations (deduplicated across forms — multiple
  // forms could in principle share a uniform, though current forms don't).
  const declaredUniforms = new Set();
  let perFormUniformDecls = '';
  for (const form of FORMS) {
    for (const [name, spec] of Object.entries(form.uniforms || {})) {
      if (declaredUniforms.has(name)) continue;
      declaredUniforms.add(name);
      const glslType = ({ '1f': 'float', '1i': 'int', '2f': 'vec2' })[spec.type];
      if (!glslType) {
        throw new Error(`unsupported uniform type '${spec.type}' for ${name}`);
      }
      perFormUniformDecls += `uniform ${glslType} ${name};\n`;
    }
  }

  // concatenate fold functions in registry order.
  const foldFunctions = FORMS.map(f => f.glsl.trim()).join('\n\n');

  // build dispatch switch. the dispatch is by INDEX in the FORMS array; gl.js
  // passes u_formIndex from the active form's index.
  const dispatchCases = FORMS.map((f, i) => {
    const fnName = `fold${capitalize(f.id)}`;
    const elseKw = i === 0 ? 'if' : 'else if';
    return `  ${elseKw} (u_formIndex == ${i}) folded = ${fnName}(p);`;
  }).join('\n');

  const main = `
void main() {
  vec2 p = v_uv * 2.0 - 1.0;
  // output aspect: scale the longer axis so a non-square framebuffer shows an
  // undistorted CROP (more of the pattern), rather than stretching the square.
  if (u_outputAspect >= 1.0) p.x *= u_outputAspect; else p.y /= u_outputAspect;
  // canvas rotation — same convention as slice rotation: CW visually positive.
  float c = cos(u_canvasRot), s = sin(u_canvasRot);
  p = mat2(c, s, -s, c) * p;
  // canvas zoom (1 = 1× — natural canvas range; <1 zooms out, >1 zooms in)
  p /= u_canvasZoom;
  // tiling pan — translate the sample position; the tiling fold's mod makes this periodic
  // (a shift by one lattice vector is identity), so panning loops seamlessly. 0 elsewhere.
  p -= u_canvasOffset;

  vec2 folded;
${dispatchCases}
  else folded = p;  // fallback — should never hit if u_formIndex is in range

  vec2 src = toSourceUV(folded);
  fragColor = sampleSource(src);
}`;

  return COMMON_PREAMBLE + '\n' + perFormUniformDecls + '\n' + foldFunctions + '\n' + main;
}

// collect all uniform names (common + per-form) for gl.js to look up locations.
export function collectAllUniformNames() {
  const names = new Set(Object.keys(COMMON_UNIFORMS));
  for (const form of FORMS) {
    for (const name of Object.keys(form.uniforms || {})) {
      names.add(name);
    }
  }
  return [...names];
}

// build a flat uniform spec map: name → { type, get(state, ctx) }. covers both
// common uniforms and the union of per-form uniforms. gl.js iterates this on
// every render to push values.
export function collectUniformSpecs() {
  const specs = { ...COMMON_UNIFORMS };
  for (const form of FORMS) {
    for (const [name, spec] of Object.entries(form.uniforms || {})) {
      // if a uniform is declared by multiple forms with the same name, the
      // first form's spec wins. shouldn't happen in practice.
      if (!(name in specs)) specs[name] = spec;
    }
  }
  return specs;
}
