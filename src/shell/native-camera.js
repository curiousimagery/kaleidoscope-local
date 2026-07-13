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

export function createNativeCamera() {
  let pluginRef = null;
  let ws = null;
  let port = 0;
  let canvas = null;          // RGB output canvas — the frameSource the engine samples
  let renderer = null;        // YUV->RGB WebGL2 blitter that owns `canvas`
  let latest = null;          // most recent YUV ArrayBuffer (painted on the render tick)
  let controlRanges = {};     // EV/zoom/WB ranges the device reported (for the UI)
  let facing = 'environment';
  let active = false;

  async function plugin() {
    if (!pluginRef) {
      const { registerPlugin } = await import('@capacitor/core');
      pluginRef = registerPlugin('FoldNativeCamera');
    }
    return pluginRef;
  }

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
    renderer.draw(width, height, yStride, cStride, yPlane, cPlane);
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
    await stop();
    ensureCanvas();
    const p = await plugin();
    const res = await p.start({ preset: 'hd1080', lens: 'auto', preferPhoto: false });
    port = res.port || 8899;
    controlRanges = res.controls || {};
    active = true;
    await openSocket();     // resolves once the first frame is painted (canvas sized)
    return canvas;
  }

  async function stop() {
    active = false;
    if (ws) { try { ws.close(); } catch { /* already closed */ } ws = null; }
    try { const p = await plugin(); await p.stop(); } catch { /* not running */ }
    latest = null;
  }

  // rear-only for now: re-acquire. front support lands with the plugin's position arg.
  async function flip(extra = {}) { return start(extra); }

  function refreshFrame() { paintLatest(); }
  function frameSource() { return canvas; }

  // --- native controls (consumed by the coming camera UI) ---------------------
  async function setExposureBias(value) { return (await plugin()).setExposureBias({ value }); }
  async function setZoom(factor) { return (await plugin()).setZoom({ factor }); }
  async function setWhiteBalance(opts) { return (await plugin()).setWhiteBalance(opts); }
  async function capturePhoto() { return (await plugin()).capturePhoto(); }
  function capabilities() { return controlRanges; }

  return {
    start,
    stop,
    flip,
    refreshFrame,
    frameSource,
    setExposureBias,
    setZoom,
    setWhiteBalance,
    capturePhoto,
    capabilities,
    listDevices: async () => [],
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
  const gl = canvasEl.getContext('webgl2', { antialias: false, alpha: false, desynchronized: true });
  const vs = `#version 300 es
  const vec2 pos[4] = vec2[4](vec2(-1.,-1.),vec2(1.,-1.),vec2(-1.,1.),vec2(1.,1.));
  out vec2 v_uv;
  void main(){ vec2 p = pos[gl_VertexID]; v_uv = vec2((p.x+1.)*0.5, (1.-p.y)*0.5); gl_Position = vec4(p,0.,1.); }`;
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
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  function draw(w, h, yStride, cStride, yPlane, cPlane) {
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog);
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
