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
  out vec2 v_uv;
  void main(){
    vec2 p = pos[gl_VertexID];
    float u = (p.x + 1.) * 0.5;
    float v = mix((1. - p.y) * 0.5, (p.y + 1.) * 0.5, uFlipY);
    v_uv = vec2(mix(u, 1. - u, uMirror), v);
    gl_Position = vec4(p, 0., 1.);
  }`;
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
  const uFlipLoc = gl.getUniformLocation(prog, 'uFlipY');
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

  return { draw, dispose };
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
