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

import { FORMS } from './forms/index.js';

// uniforms common to ALL forms. these are the shared scaffolding the shader
// preamble depends on. order matters only for readability of the generated
// source; gl.js looks them up by name.
//
// each entry: name → { type: '1f' | '1i' | '2f', get: (state, ctx) => value }
// where ctx provides any non-state values (e.g. sourceAspect from the loaded
// image). returning a 2-element array for vec2 types is fine; gl.js spreads.
export const COMMON_UNIFORMS = {
  u_source:        { type: '1i', get: () => 0 /* texture unit 0 */ },
  u_formIndex:     { type: '1i', get: (state, ctx) => ctx.formIndex },
  u_segments:      { type: '1f', get: (state) => state.segments },
  u_canvasRot:     { type: '1f', get: (state) => state.canvasRotation * Math.PI / 180 },
  u_canvasZoom:    { type: '1f', get: (state) => state.canvasZoom },
  u_sliceFactor:   { type: '1f', get: (state) => state.sliceScale },
  u_sliceRot:      { type: '1f', get: (state) => state.sliceRotation * Math.PI / 180 },
  u_sliceCenter:   { type: '2f', get: (state) => [state.sliceCx, state.sliceCy] },
  u_sourceAspect:  { type: '1f', get: (state, ctx) => ctx.sourceAspect },
  u_oobMode:       { type: '1i', get: (state) => state.oobMode },
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
uniform float u_sliceFactor;
uniform float u_sliceRot;
uniform vec2  u_sliceCenter;
uniform float u_sourceAspect;
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
  return v + u_sliceCenter;
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
  // canvas rotation — same convention as slice rotation: CW visually positive.
  float c = cos(u_canvasRot), s = sin(u_canvasRot);
  p = mat2(c, s, -s, c) * p;
  // canvas zoom (1 = 1× — natural canvas range; <1 zooms out, >1 zooms in)
  p /= u_canvasZoom;

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
