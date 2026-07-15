// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/yuv-renderer.js
//
// biplanar-YUV (420f, full range) -> RGB into the given canvas via WebGL2. Y as
// R8, CbCr as RG8; padded row strides handled with UNPACK_ROW_LENGTH.
//
// Extracted VERBATIM from shell/native-camera.js (the kit/drift.js precedent:
// one proven implementation, multiple consumers) so the external-display view
// (shell/native-camera-receiver.js) can decode the same native camera frames
// WITHOUT importing the full camera module (which carries @capacitor/core and
// the plugin control surface). Both the camera and the receiver paint through
// this one blitter.

export function createYuvRenderer(canvasEl) {
  // preserveDrawingBuffer so the freeze-frame `drawImage(canvas)` (which runs OUTSIDE
  // the render loop) reads real pixels instead of a cleared buffer. (desynchronized
  // dropped — it can leave the canvas unreadable for out-of-loop drawImage.)
  const gl = canvasEl.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
  const vs = `#version 300 es
  const vec2 pos[4] = vec2[4](vec2(-1.,-1.),vec2(1.,-1.),vec2(-1.,1.),vec2(1.,1.));
  uniform float uMirror;   // 1.0 = flip horizontally (front/selfie camera)
  out vec2 v_uv;
  void main(){ vec2 p = pos[gl_VertexID]; float u=(p.x+1.)*0.5; v_uv = vec2(mix(u,1.-u,uMirror), (1.-p.y)*0.5); gl_Position = vec4(p,0.,1.); }`;
  const fs = `#version 300 es
  precision mediump float;
  in vec2 v_uv;
  uniform sampler2D yTex;
  uniform sampler2D cTex;
  out vec4 frag;
  void main(){
    float y = texture(yTex, v_uv).r;
    vec2 c = texture(cTex, v_uv).rg - 0.5;
    frag = vec4(y + 1.402*c.g, y - 0.344136*c.r - 0.714136*c.g, y + 1.772*c.r, 1.);
  }`;
  const prog = linkProgram(gl, vs, fs);
  gl.useProgram(prog);
  const yTex = makeTex(gl), cTex = makeTex(gl);
  gl.uniform1i(gl.getUniformLocation(prog, 'yTex'), 0);
  gl.uniform1i(gl.getUniformLocation(prog, 'cTex'), 1);
  const uMirrorLoc = gl.getUniformLocation(prog, 'uMirror');
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  function draw(w, h, yStride, cStride, yPlane, cPlane, mirror) {
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog);
    gl.uniform1f(uMirrorLoc, mirror ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, yTex);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, yStride);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, yPlane);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, cTex);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, cStride >> 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, w >> 1, h >> 1, 0, gl.RG, gl.UNSIGNED_BYTE, cPlane);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  return { draw };
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
