// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// camera-spike.js
//
// THROWAWAY Tier-2 frame-bridge harness. Boots ONLY when built with
// VITE_FOLD_SPIKE=camera (or ?spike=camera in a browser) — see boot.js. It asks
// the native plugin to start the camera, opens the localhost WebSocket, uploads
// each biplanar-YUV frame as two WebGL2 textures, converts YUV->RGB in a shader,
// and reports fps + per-frame JS cost + resolution in an on-screen HUD.
//
// What it answers: is the copy-based native->WebGL bridge smooth enough at
// preview res (720p) and, crucially, at record res (1080p floor / 4K target)?
// It is NOT wired into the kaleidoscope engine — that's the next step if the
// numbers hold. Delete this directory when the spike concludes.

import { registerPlugin } from '@capacitor/core';

const FoldNativeCamera = registerPlugin('FoldNativeCamera');

const MAGIC = 0x46595556; // "FYUV"

export function mount() {
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#000;overflow:hidden;font-family:-apple-system,system-ui,sans-serif;';

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#000;';
  document.body.appendChild(canvas);

  const hud = document.createElement('div');
  hud.style.cssText = [
    'position:fixed;left:12px;right:12px;top:max(12px,env(safe-area-inset-top));',
    'padding:10px 12px;border-radius:10px;background:rgba(0,0,0,0.62);color:#eee;',
    'font-size:13px;line-height:1.5;white-space:pre;pointer-events:none;',
    'text-shadow:0 1px 2px #000;z-index:10;'
  ].join('');
  hud.textContent = 'camera bridge spike — tap Start';
  document.body.appendChild(hud);

  const controls = document.createElement('div');
  controls.style.cssText = [
    'position:fixed;left:0;right:0;bottom:max(16px,env(safe-area-inset-bottom));',
    'display:flex;gap:10px;justify-content:center;z-index:10;'
  ].join('');
  const startBtn = mkBtn('Start');
  const stopBtn = mkBtn('Stop');
  const presetBtn = mkBtn('1080p');
  const fpsBtn = mkBtn('30fps');
  const captureBtn = mkBtn('📷');
  controls.append(presetBtn, fpsBtn, startBtn, stopBtn, captureBtn);
  document.body.appendChild(controls);

  const presets = ['hd720', 'hd1080', 'uhd'];
  const presetLabels = { hd720: '720p', hd1080: '1080p', uhd: '4K' };
  let presetIdx = 1;
  presetBtn.onclick = () => {
    presetIdx = (presetIdx + 1) % presets.length;
    presetBtn.textContent = presetLabels[presets[presetIdx]];
  };

  // fps target: 30, 60, or 0 = run the camera as fast as the format allows (ceiling).
  const fpsTargets = [30, 60, 0];
  const fpsLabels = { 30: '30fps', 60: '60fps', 0: 'max fps' };
  let fpsIdx = 0;
  fpsBtn.onclick = () => {
    fpsIdx = (fpsIdx + 1) % fpsTargets.length;
    fpsBtn.textContent = fpsLabels[fpsTargets[fpsIdx]];
  };

  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, desynchronized: true });
  if (!gl) { hud.textContent = 'no WebGL2'; return; }
  const renderer = createYuvRenderer(gl);

  let ws = null;
  let frames = 0;
  let lastFpsAt = performance.now();
  let fps = 0;
  let jsMs = 0;
  let vw = 0, vh = 0;
  let camMax = 0;
  let ctlPanel = null;
  let currentLens = 'auto';
  let availLenses = ['auto'];
  let status = 'idle';

  function updateHud() {
    hud.textContent =
      `${status}\n` +
      `${vw}×${vh}  ·  ${fps.toFixed(0)} fps sustained  ·  ${jsMs.toFixed(1)} ms/frame js\n` +
      `${presetLabels[presets[presetIdx]]} @ ${fpsLabels[fpsTargets[fpsIdx]]}` +
      (camMax ? `  ·  camera max ${camMax.toFixed(0)} fps at this res` : '');
  }
  updateHud();

  async function start() {
    if (ws) return;
    status = 'requesting camera…';
    updateHud();
    let res;
    try {
      res = await FoldNativeCamera.start({ preset: presets[presetIdx], fps: fpsTargets[fpsIdx], lens: currentLens });
    } catch (e) {
      status = 'plugin.start rejected: ' + (e && e.message ? e.message : e);
      updateHud();
      return;
    }
    camMax = (res && res.cameraMaxFps) || 0;
    availLenses = (res && res.availableLenses) || ['auto'];
    mountControls((res && res.controls) || {});
    const port = (res && res.port) || 8899;
    status = `connecting ws://127.0.0.1:${port}…`;
    updateHud();
    connect(port, 0);
  }

  function connect(port, attempt) {
    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}`);
    } catch (e) {
      status = 'ws construct failed: ' + e;
      updateHud();
      return;
    }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { status = 'streaming'; updateHud(); };
    ws.onmessage = (ev) => onFrame(ev.data);
    ws.onerror = () => { status = 'ws error'; updateHud(); };
    ws.onclose = () => {
      // the server may bind a moment after start(); retry a few times
      if (attempt < 8 && status !== 'stopped') {
        status = `ws retry ${attempt + 1}…`;
        updateHud();
        ws = null;
        setTimeout(() => connect(port, attempt + 1), 400);
      } else if (status !== 'stopped') {
        status = 'ws closed';
        updateHud();
        ws = null;
      }
    };
  }

  function onFrame(buf) {
    const t0 = performance.now();
    const dv = new DataView(buf);
    if (dv.getUint32(0, false) !== MAGIC) return;
    const width = dv.getUint32(4, true);
    const height = dv.getUint32(8, true);
    const yStride = dv.getUint32(12, true);
    const cStride = dv.getUint32(16, true);
    const cHeight = dv.getUint32(20, true);
    const ySize = yStride * height;
    const cSize = cStride * cHeight;
    const yPlane = new Uint8Array(buf, 24, ySize);
    const cPlane = new Uint8Array(buf, 24 + ySize, cSize);

    if (width !== vw || height !== vh) {
      vw = width; vh = height;
      canvas.width = width; canvas.height = height;
    }
    renderer.draw(width, height, yStride, cStride, yPlane, cPlane);

    jsMs = jsMs * 0.9 + (performance.now() - t0) * 0.1;
    frames++;
    const now = performance.now();
    if (now - lastFpsAt >= 500) {
      fps = (frames * 1000) / (now - lastFpsAt);
      frames = 0; lastFpsAt = now;
      updateHud();
    }
  }

  async function stop() {
    status = 'stopped';
    unmountControls();
    if (ws) { try { ws.close(); } catch { /* ignore */ } ws = null; }
    try { await FoldNativeCamera.stop(); } catch { /* ignore */ }
    updateHud();
  }

  // Re-acquire with a changed lens (the socket rebinds, so drop + pause + re-open).
  async function restart() {
    await stop();
    await new Promise((r) => setTimeout(r, 250));
    await start();
  }

  // Build the native-control sliders from the ranges the device reported. Purely
  // capability-driven: a control only appears if the device advertises it.
  function mountControls(controls) {
    unmountControls();
    ctlPanel = document.createElement('div');
    ctlPanel.style.cssText = [
      'position:fixed;right:12px;top:110px;width:210px;z-index:10;',
      'display:flex;flex-direction:column;gap:12px;padding:12px;',
      'border-radius:10px;background:rgba(0,0,0,0.55);color:#eee;',
      'font-size:12px;text-shadow:0 1px 2px #000;'
    ].join('');

    // lens selector — a physical lens gives full manual control (incl. Kelvin WB);
    // "auto" is the seamless multi-lens composite (no custom WB).
    if (availLenses.length > 1) {
      const lensRow = document.createElement('div');
      lensRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
      const labels = { auto: 'auto', ultraWide: 'UW', wide: 'wide', tele: 'tele' };
      availLenses.forEach((ln) => {
        const b = wbBtn(labels[ln] || ln, async () => { currentLens = ln; await restart(); });
        if (ln === currentLens) b.style.background = '#0a84ff';
        lensRow.appendChild(b);
      });
      ctlPanel.appendChild(lensRow);
    }

    // still-photo resolution ceiling for the current lens
    const ph = controls.photo;
    if (ph && ph.sensorMaxW) {
      const note = document.createElement('div');
      note.style.cssText = 'opacity:0.8;font-size:11px;';
      note.textContent = `still: ${(ph.sensorMaxW * ph.sensorMaxH / 1e6).toFixed(0)}MP  (${ph.sensorMaxW}×${ph.sensorMaxH})`;
      ctlPanel.appendChild(note);
    }

    const ev = controls.exposureBias;
    if (ev && ev.max > ev.min) {
      addSlider(ctlPanel, 'EV', ev.min, ev.max, 0.1, 0, (v) => v.toFixed(1),
        throttle((v) => FoldNativeCamera.setExposureBias({ value: v }), 40));
    }
    const z = controls.zoom;
    if (z && z.max > z.min) {
      // cap the slider to the usable optical range (past the last lens is digital crop)
      const lensMax = (z.lensFactors && z.lensFactors.length) ? Math.max(...z.lensFactors) : 8;
      const cap = Math.min(z.max, Math.max(lensMax * 1.5, 4));
      const lens = (z.lensFactors && z.lensFactors.length)
        ? ' · lens@' + z.lensFactors.map((n) => n.toFixed(1)).join('/') : '';
      addSlider(ctlPanel, 'zoom' + lens, z.min, cap, 0.05, z.min, (v) => v.toFixed(2) + '×',
        throttle((v) => FoldNativeCamera.setZoom({ factor: v }), 40));
    }
    const wb = controls.whiteBalance || {};
    // diagnostic: does THIS (multi-lens) camera allow Kelvin WB, and would the wide lens?
    const wbNote = document.createElement('div');
    wbNote.style.cssText = 'opacity:0.75;font-size:11px;line-height:1.4;';
    wbNote.textContent =
      `WB kelvin: this cam ${wb.customGainsSupported ? '✓' : '✗'} · wide lens ${wb.customGainsSupportedWideLens ? '✓' : '✗'}`;
    ctlPanel.appendChild(wbNote);

    if (wb.customGainsSupported) {
      const auto = wbBtn('WB auto', () => FoldNativeCamera.setWhiteBalance({ mode: 'auto' }));
      ctlPanel.appendChild(auto);
      addSlider(ctlPanel, 'WB temp', 3000, 8000, 100, 5000, (v) => v.toFixed(0) + 'K',
        throttle((v) => FoldNativeCamera.setWhiteBalance({ temperature: v }), 60));
    } else if (wb.lockSupported) {
      // no Kelvin on this camera — offer auto vs lock-current only
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;';
      row.append(
        wbBtn('WB auto', () => FoldNativeCamera.setWhiteBalance({ mode: 'auto' })),
        wbBtn('WB lock', () => FoldNativeCamera.setWhiteBalance({ mode: 'lock' }))
      );
      ctlPanel.appendChild(row);
    }
    document.body.appendChild(ctlPanel);
  }

  function unmountControls() {
    if (ctlPanel) { ctlPanel.remove(); ctlPanel = null; }
  }

  // Capture a full-res still (EV/WB/zoom baked in) and save to Photos.
  async function capture() {
    if (!ws) { status = 'start the camera first'; updateHud(); return; }
    status = 'capturing…'; updateHud();
    try {
      const r = await FoldNativeCamera.capturePhoto();
      const mp = (r.width * r.height / 1e6).toFixed(1);
      status = `captured ${r.width}×${r.height} · ${mp}MP · ${(r.bytes / 1e6).toFixed(1)}MB · Photos ${r.savedToPhotos ? '✓' : '✗'}`;
    } catch (e) {
      status = 'capture failed: ' + (e && e.message ? e.message : e);
    }
    updateHud();
  }

  startBtn.onclick = start;
  stopBtn.onclick = stop;
  captureBtn.onclick = capture;
}

function mkBtn(label) {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = [
    'appearance:none;border:0;border-radius:10px;padding:12px 20px;',
    'background:#2a2a2a;color:#fff;font-size:15px;font-weight:600;',
    'box-shadow:0 2px 8px rgba(0,0,0,0.5);'
  ].join('');
  return b;
}

// A small labelled button wired to a click handler (WB auto/lock).
function wbBtn(label, onClick) {
  const b = mkBtn(label);
  b.style.padding = '8px 12px';
  b.style.fontSize = '13px';
  b.onclick = onClick;
  return b;
}

// Coalesce rapid slider input to a max rate (each device-config call locks the
// camera, so we don't want one per pointer event), always flushing the last value.
function throttle(fn, ms) {
  let last = 0, pending = null, timer = null;
  return (...args) => {
    const now = performance.now();
    if (now - last >= ms) { last = now; fn(...args); }
    else {
      pending = args;
      if (!timer) {
        timer = setTimeout(() => { last = performance.now(); timer = null; fn(...pending); }, ms - (now - last));
      }
    }
  };
}

function addSlider(parent, label, min, max, step, value, fmt, onInput) {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;justify-content:space-between;gap:8px;';
  const name = document.createElement('span'); name.textContent = label;
  const val = document.createElement('span'); val.textContent = fmt(value);
  head.append(name, val);
  const input = document.createElement('input');
  input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value;
  input.style.width = '100%';
  input.oninput = () => { const v = parseFloat(input.value); val.textContent = fmt(v); onInput(v); };
  wrap.append(head, input);
  parent.appendChild(wrap);
}

// WebGL2 biplanar-YUV (420f, full range) -> RGB. Y as R8, CbCr as RG8; padded
// row strides handled via UNPACK_ROW_LENGTH.
function createYuvRenderer(gl) {
  const vs = `#version 300 es
  const vec2 pos[4] = vec2[4](vec2(-1.,-1.),vec2(1.,-1.),vec2(-1.,1.),vec2(1.,1.));
  out vec2 v_uv;
  void main(){
    vec2 p = pos[gl_VertexID];
    v_uv = vec2((p.x+1.)*0.5, (1.-p.y)*0.5); // flip V: texture top-row first
    gl_Position = vec4(p,0.,1.);
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
    float r = y + 1.402*c.g;
    float g = y - 0.344136*c.r - 0.714136*c.g;
    float b = y + 1.772*c.r;
    frag = vec4(r,g,b,1.);
  }`;
  const prog = link(gl, vs, fs);
  gl.useProgram(prog);
  const yTex = mkTex(gl);
  const cTex = mkTex(gl);
  gl.uniform1i(gl.getUniformLocation(prog, 'yTex'), 0);
  gl.uniform1i(gl.getUniformLocation(prog, 'cTex'), 1);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  function draw(w, h, yStride, cStride, yPlane, cPlane) {
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, yTex);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, yStride);           // luma: 1 byte/texel
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, yPlane);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, cTex);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, cStride >> 1);       // chroma: 2 bytes/texel
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, w >> 1, h >> 1, 0, gl.RG, gl.UNSIGNED_BYTE, cPlane);

    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  return { draw };
}

function mkTex(gl) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function link(gl, vsSrc, fsSrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link failed');
  return p;
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'compile failed');
  return s;
}
