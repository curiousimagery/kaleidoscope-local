// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// engine/yuv.js
//
// biplanar-YUV (420f, full range) -> RGB, as a blit into whatever framebuffer is
// currently bound. Y uploads as R8, CbCr as RG8; padded row strides are handled with
// UNPACK_ROW_LENGTH. Pure GL plumbing — it knows nothing about sockets, cameras, or
// the shell (shell/yuv-renderer.js is the canvas-target wrapper; gl.js is the
// texture-target one).
//
// WHY THIS LIVES IN THE ENGINE NOW. It used to be shell-only, painting an RGB canvas
// that the engine then sampled as an ordinary drawable — and THAT was the 4K wall:
// a texImage2D of a WebGL canvas from a DIFFERENT context is a GPU->CPU readback in
// WebKit, measured on device at ~20ms per megapixel (162ms/frame at 4K, 49ms at
// 1080p, 19ms at 720p — dead linear, Builds 500-503). The planes are already in CPU
// memory when they come off the socket, so uploading them straight into the engine's
// own context and converting here skips the round trip entirely.
//
// The blitter is source-dims-aware ON PURPOSE: the target may be SMALLER than the
// frame (the source-detail cap). The planes always upload at their true size and the
// viewport does the scaling — allocating the plane textures at the target size
// instead reads a top-left CROP of the frame, which is what the first cap
// implementation did (Build 500).

import { COLOR_GLSL, DEFAULT_COLOR, yuvToRgbMatrix, primariesMatrix, transferMode, needsGamut,
  hdrNormFor, toneFromQuery } from './color.js';

export function createYuvBlitter(gl, { flipY = false } = {}) {
  // flipY selects where image row 0 lands in the target:
  //   false — a CANVAS target: row 0 at the top, matching how texImage2D(canvas)
  //           later reads it back with UNPACK_FLIP_Y_WEBGL off.
  //   true  — a TEXTURE target (FBO): row 0 at t=0, i.e. NDC y=-1, so the result
  //           matches the orientation the engine's shaders already expect.
  const vs = `#version 300 es
  const vec2 pos[4] = vec2[4](vec2(-1.,-1.),vec2(1.,-1.),vec2(-1.,1.),vec2(1.,1.));
  uniform float uMirror;   // 1.0 = flip horizontally (front/selfie camera)
  uniform float uFlipY;    // 1.0 = texture target (row 0 at the bottom of NDC)
  uniform float uRot;      // container rotation, in quarter turns clockwise (0..3)
  out vec2 v_uv;
  void main(){
    vec2 p = pos[gl_VertexID];
    float u = (p.x + 1.) * 0.5;
    float v = mix((1. - p.y) * 0.5, (p.y + 1.) * 0.5, uFlipY);
    vec2 uv = vec2(u, v);
    // ⚠️ B762 — APPLY THE CONTAINER ROTATION. Four vertices, not four million fragments, so this
    // is free. The rotation is about the centre and the caller has already swapped the TARGET
    // dimensions for a quarter turn, so the sample stays inside 0..1 either way.
    float q = mod(uRot, 4.0);
    vec2 c = uv - 0.5;
    if (q >= 3.0)      c = vec2(-c.y,  c.x);
    else if (q >= 2.0) c = vec2(-c.x, -c.y);
    else if (q >= 1.0) c = vec2( c.y, -c.x);
    uv = c + 0.5;
    v_uv = vec2(mix(uv.x, 1. - uv.x, uMirror), uv.y);
    gl_Position = vec4(p, 0., 1.);
  }`;
  // ⚠️ B761 — THE INPUT TRANSFORM LIVES HERE NOW. This shader used to be four hardcoded BT.601
  // coefficients applied to every source on earth (see engine/color.js for what that cost). It is
  // now driven by what the file declared, with BT.709 as the default when it declared nothing.
  //
  // `highp` is required, not preference: mediump is fp16 on iOS and the PQ inverse EOTF overflows it.
  const fs = `#version 300 es
  precision highp float;
  in vec2 v_uv;
  uniform sampler2D yTex;
  uniform sampler2D cTex;
  uniform mat3 uYuvToRgb;     // matrix coefficients, derived from Kr/Kb
  uniform mat3 uPrimaries;    // source primaries -> sRGB, in LINEAR light (identity for BT.709)
  uniform int  uTransfer;     // 0 = SDR passthrough, 1 = HLG, 2 = PQ
  uniform float uWhiteLinear; // linear value of diffuse white for the HDR modes
  uniform vec2 uRange;        // x = luma offset, y = luma scale (limited-range expansion)
  uniform int  uGamut;        // 1 = the SDR path must round-trip through linear for the primaries
  uniform vec3 uTone;         // x = shoulder (white squared, 1 = off), y = exposure, z = gamma
  out vec4 frag;
${COLOR_GLSL}
  void main(){
    float y = (texture(yTex, v_uv).r - uRange.x) * uRange.y;
    vec2 cc = (texture(cTex, v_uv).rg - 0.5) * uRange.y;
    vec3 rgb = uYuvToRgb * vec3(y, cc.r, cc.g);

    // SDR onto an sRGB display: the signal is already display-referred, so the correct transform
    // after the matrix is NOTHING. Round-tripping through linear would only add error.
    if (uTransfer == 0) {
      if (uGamut == 0) { frag = vec4(clamp(rgb, 0.0, 1.0), 1.); return; }
      // ...unless the primaries differ, and a gamut conversion is only correct in linear light.
      frag = vec4(linearToSrgb(uPrimaries * srgbToLinear(rgb)), 1.);
      return;
    }

    vec3 lin = (uTransfer == 1) ? hlgToLinear(clamp(rgb, 0.0, 1.0)) : pqToLinear(rgb);
    lin = lin / max(uWhiteLinear, 1e-6);   // HLG: 1.0 by design. PQ: put diffuse white at 1.0.
    lin = uPrimaries * lin;                // gamut, in linear light
    // The three controls, in the order the panel presents them. See TONE_DEFAULTS in color.js for
    // what each one is for and why the order matters.
    lin = max(lin, 0.0) * uTone.y;         // 1. exposure — linear gain
    lin = pow(lin, vec3(uTone.z));         // 2. gamma — bends midtones, fixes 0 and 1
    lin = toneMap(lin, uTone.x);           // 3. shoulder — highlight roll-off (1.0 = off)
    frag = vec4(linearToSrgb(lin), 1.);
  }`;
  const prog = linkProgram(gl, vs, fs);
  gl.useProgram(prog);
  const yTex = makeTex(gl), cTex = makeTex(gl);
  gl.uniform1i(gl.getUniformLocation(prog, 'yTex'), 0);
  gl.uniform1i(gl.getUniformLocation(prog, 'cTex'), 1);
  const uMirrorLoc = gl.getUniformLocation(prog, 'uMirror');
  const uFlipLoc = gl.getUniformLocation(prog, 'uFlipY');
  const uYuvLoc = gl.getUniformLocation(prog, 'uYuvToRgb');
  const uPrimLoc = gl.getUniformLocation(prog, 'uPrimaries');
  const uXferLoc = gl.getUniformLocation(prog, 'uTransfer');
  const uWhiteLoc = gl.getUniformLocation(prog, 'uWhiteLinear');
  const uRangeLoc = gl.getUniformLocation(prog, 'uRange');
  const uGamutLoc = gl.getUniformLocation(prog, 'uGamut');
  const uRotLoc = gl.getUniformLocation(prog, 'uRot');
  const uToneLoc = gl.getUniformLocation(prog, 'uTone');
  // ⚠️ B763 — LIVE, NOT READ-ONCE. B762 read `?tone=` at construction, which meant every comparison
  // cost a reload AND a re-load of the clip. Daniel: *"i have to reload the source each time to
  // compare... which makes diffs hard to compare and takes a long time."* A curve you cannot A/B
  // quickly is a curve that gets tuned by guessing, which is what the knob existed to avoid.
  // The URL still seeds it, so a value can be pinned for a scripted run.
  let tone = toneFromQuery(typeof location !== 'undefined' ? location.search : '');
  function setTone(t) {
    tone = { shoulder: t?.shoulder > 0 ? t.shoulder : tone.shoulder,
             exposure: t?.exposure > 0 ? t.exposure : tone.exposure,
             gamma: t?.gamma > 0 ? t.gamma : tone.gamma };
    gl.useProgram(prog);
    gl.uniform3f(uToneLoc, tone.shoulder, tone.exposure, tone.gamma);
  }
  setTone(tone);

  // B762 — the container rotation, in quarter turns. Set per source alongside the colour.
  let quarterTurns = 0;
  function setRotation(deg) {
    quarterTurns = ((Math.round((deg || 0) / 90) % 4) + 4) % 4;
  }
  // Does this rotation swap width and height? The caller sizes the target, so it has to ask.
  function swapsAxes() { return quarterTurns === 1 || quarterTurns === 3; }

  // ⚠️ B761 — SET ONCE PER SOURCE, NOT PER FRAME. The description changes when a clip loads and
  // never in between, so `draw` stays exactly as cheap as it was. Applied immediately rather than
  // latched for the next draw, because a blitter with no colour set yet must still be usable —
  // hence the DEFAULT_COLOR call below, which is what every existing caller gets for free.
  let colorDesc = null;
  function setColor(color) {
    const c = color || DEFAULT_COLOR;
    colorDesc = c;
    const mode = transferMode(c.transfer);
    // Limited range expands Y by 255/219 about 16/255; full range is the identity. Both plugins
    // request a FULL-range pixel format, so the native paths are always the identity here — this
    // exists for container-declared limited range on the element paths.
    const off = c.fullRange ? 0 : 16 / 255;
    const scale = c.fullRange ? 1 : 255 / 219;
    gl.useProgram(prog);
    gl.uniformMatrix3fv(uYuvLoc, false, yuvToRgbMatrix(c.matrix));
    gl.uniformMatrix3fv(uPrimLoc, false, primariesMatrix(c.primaries));
    gl.uniform1i(uXferLoc, mode);
    gl.uniform1f(uWhiteLoc, hdrNormFor(mode));
    gl.uniform2f(uRangeLoc, off, scale);
    gl.uniform1i(uGamutLoc, needsGamut(c.primaries) ? 1 : 0);
  }
  setColor(null);   // a blitter is never in an undefined colour state
  // an OWN vertex array so the blit can't inherit (or leak) the caller's attribute
  // state — this shader draws from gl_VertexID and binds no attributes at all
  const vao = gl.createVertexArray();

  // `frame` is the parsed wire frame: { width, height, yStride, cStride, yPlane, cPlane }.
  // vw/vh are the TARGET dimensions (viewport), which may differ from the frame's.
  function draw(frame, vw, vh, mirror = false) {
    const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    gl.bindVertexArray(vao);
    gl.useProgram(prog);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, vw, vh);
    gl.uniform1f(uMirrorLoc, mirror ? 1 : 0);
    gl.uniform1f(uFlipLoc, flipY ? 1 : 0);
    gl.uniform1f(uRotLoc, quarterTurns);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, yTex);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, frame.yStride);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, frame.width, frame.height, 0, gl.RED, gl.UNSIGNED_BYTE, frame.yPlane);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, cTex);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, frame.cStride >> 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, frame.width >> 1, frame.height >> 1, 0, gl.RG, gl.UNSIGNED_BYTE, frame.cPlane);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);     // leave the unit the engine's own binds assume
    gl.bindVertexArray(prevVao);
  }

  function dispose() {
    try { gl.deleteTexture(yTex); gl.deleteTexture(cTex); gl.deleteVertexArray(vao); gl.deleteProgram(prog); }
    catch { /* context already gone */ }
  }

  return { draw, dispose, setColor, setRotation, setTone, swapsAxes,
    get color() { return colorDesc; }, get tone() { return tone; } };
}

function makeTex(gl) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function linkProgram(gl, vsSrc, fsSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link failed');
  return p;
}

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'compile failed');
  return s;
}
