// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// native-camera.js
//
// The NATIVE camera source — an interface-compatible sibling of shell/camera.js,
// used on Capacitor where env.host.nativeCamera.available. Instead of getUserMedia
// it drives the fold-native-camera plugin (a native AVCaptureSession we OWN, so we
// reach EV / WB / lens / 48MP that getUserMedia can't), and receives frames as
// biplanar YUV over a localhost WebSocket, painting them into an RGB canvas that
// the engine samples exactly like a <video> — engine.setSource(frameSource()) then
// engine.updateSourceFrame() per tick, unchanged.
//
// The plugin is dynamic-imported so the plain web bundle never pulls @capacitor/core.
// First slice: REAR live preview + the control methods for the coming UI. Front/flip,
// 48MP-still-on-pause, and native record-audio are follow-on slices.

import { registerPlugin } from '@capacitor/core';

// Registered at module scope (the spike proved this static path works on device; a
// dynamic import('@capacitor/core') stalls inside the capacitor:// webview). On web
// this returns a harmless no-op proxy — the module is only exercised on native.
const FoldNativeCamera = registerPlugin('FoldNativeCamera');

export function createNativeCamera() {
  let ws = null;
  let port = 0;
  let canvas = null;          // RGB output canvas — the frameSource the engine samples
  let renderer = null;        // YUV->RGB WebGL2 blitter that owns `canvas`
  let latest = null;          // most recent YUV ArrayBuffer (painted on the render tick)
  let controlRanges = {};     // EV/zoom/WB ranges the device reported (for the UI)
  let lenses = [];            // [{id,label}] physical lenses on the current facing
  let lens = 'wide';          // the chosen physical lens (never 'auto' — the virtual
                              // device disables custom WB + 48MP; a single sensor allows both)
  let resolutions = [];       // [{id,label,maxFps}] the current lens actually offers
  let preset = 'hd1080';      // the chosen streaming resolution
  let targetFps = 30;         // the requested frame rate (matters in record-video mode)
  let facing = 'environment';
  let active = false;

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    renderer = createYuvRenderer(canvas);
  }

  // Paint the latest received frame into the RGB canvas. Called each render tick
  // (via refreshFrame) so the YUV->RGB blit is synced to the render loop — one blit
  // per rendered frame, not one per socket message.
  function paintLatest() {
    if (!latest || !renderer) return;
    const dv = new DataView(latest);
    if (dv.getUint32(0, false) !== 0x46595556) return;   // "FYUV"
    const width = dv.getUint32(4, true);
    const height = dv.getUint32(8, true);
    const yStride = dv.getUint32(12, true);
    const cStride = dv.getUint32(16, true);
    const cHeight = dv.getUint32(20, true);
    const ySize = yStride * height;
    const cSize = cStride * cHeight;
    const yPlane = new Uint8Array(latest, 24, ySize);
    const cPlane = new Uint8Array(latest, 24 + ySize, cSize);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width; canvas.height = height;
    }
    renderer.draw(width, height, yStride, cStride, yPlane, cPlane, facing === 'user');
  }

  function openSocket() {
    return new Promise((resolve, reject) => {
      let done = false;
      let attempt = 0;
      const connect = () => {
        try { ws = new WebSocket(`ws://127.0.0.1:${port}`); }
        catch (e) { if (!done) { done = true; reject(e); } return; }
        ws.binaryType = 'arraybuffer';
        ws.onmessage = (ev) => {
          latest = ev.data;
          if (!done) { done = true; paintLatest(); resolve(); }
        };
        ws.onclose = () => {
          // the native server may bind a beat after start(); retry a few times
          if (!done && attempt < 6) { attempt++; ws = null; setTimeout(connect, 300); }
        };
      };
      connect();
      setTimeout(() => { if (!done) { done = true; reject(new Error('no native camera frames (ws may be blocked)')); } }, 6000);
    });
  }

  // start the camera. `opts.facingMode` accepted for parity; the plugin is rear-only
  // for now (front is a follow-on slice), so it's stored but not yet applied.
  async function start(opts = {}) {
    if (typeof opts === 'string') opts = { facingMode: opts };
    if (opts.facingMode) facing = opts.facingMode;
    console.info('[native-camera] start', JSON.stringify(opts));
    await stop();
    ensureCanvas();
    console.info('[native-camera] calling plugin.start');
    const res = await FoldNativeCamera.start({
      preset, fps: targetFps, lens, preferPhoto: false,
      facing: facing === 'user' ? 'front' : 'back',
    });
    console.info('[native-camera] plugin.start resolved', JSON.stringify(res));
    port = res.port || 8899;
    controlRanges = res.controls || {};
    lenses = res.lenses || [];
    resolutions = res.resolutions || [];
    active = true;
    await openSocket();     // resolves once the first frame is painted (canvas sized)
    console.info('[native-camera] socket connected — first frame in');
    return canvas;
  }

  async function stop() {
    active = false;
    if (ws) { try { ws.close(); } catch { /* already closed */ } ws = null; }
    try { await FoldNativeCamera.stop(); } catch { /* not running */ }
    latest = null;
  }

  async function flip(extra = {}) {
    const next = facing === 'user' ? 'environment' : 'user';
    return start({ ...extra, facingMode: next });
  }

  // switch to a specific physical lens — re-acquires the session exactly like flip.
  // Re-acquiring resets the sensor to auto EV/WB by construction, which is the desired
  // behavior on a lens change (custom gains are per-sensor and don't carry across).
  async function setLens(id) {
    lens = id;
    return start({ facingMode: facing });
  }

  // change streaming resolution / frame rate — both re-acquire (a format change).
  async function setResolution(id) {
    preset = id;
    // clamp the requested fps to what this resolution offers (avoids asking 60 on a
    // 4K format that only does 30 — the plugin clamps too, but keep the state honest)
    const r = resolutions.find((x) => x.id === id);
    if (r && r.maxFps) targetFps = Math.min(targetFps, Math.round(r.maxFps));
    return start({ facingMode: facing });
  }
  async function setFrameRate(fps) {
    targetFps = fps;
    return start({ facingMode: facing });
  }

  function refreshFrame() { paintLatest(); }
  function frameSource() { return canvas; }

  // --- native controls (consumed by the coming camera UI) ---------------------
  async function setExposureBias(value) { return FoldNativeCamera.setExposureBias({ value }); }
  async function setZoom(factor) { return FoldNativeCamera.setZoom({ factor }); }
  async function setWhiteBalance(opts) { return FoldNativeCamera.setWhiteBalance(opts); }
  async function capturePhoto() { return FoldNativeCamera.capturePhoto(); }
  function capabilities() { return controlRanges; }

  return {
    start,
    stop,
    flip,
    setLens,
    getLenses: () => lenses,       // [{id,label}] for the current facing (picker source)
    getLens: () => lens,
    setResolution,
    setFrameRate,
    getResolutions: () => resolutions,   // [{id,label,maxFps}] for the current lens
    getResolution: () => preset,
    getFrameRate: () => targetFps,
    refreshFrame,
    frameSource,
    setExposureBias,
    setZoom,
    setWhiteBalance,
    capturePhoto,
    capabilities,
    listDevices: async () => [],
    mirrorsInSource: true,           // the front-camera selfie-flip is baked into the canvas
    getVideo: () => canvas,          // duck-types as a drawable; has no srcObject (audio paths degrade)
    getFacing: () => facing,
    getDeviceId: () => null,
    isFront: () => facing === 'user',
    isActive: () => active,
  };
}

// biplanar-YUV (420f, full range) -> RGB into the given canvas via WebGL2. Y as R8,
// CbCr as RG8; padded row strides handled with UNPACK_ROW_LENGTH.
function createYuvRenderer(canvasEl) {
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
