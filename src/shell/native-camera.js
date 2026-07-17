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

import { registerPlugin, Capacitor } from '@capacitor/core';
import { createYuvRenderer } from './yuv-renderer.js';

// Registered at module scope (the spike proved this static path works on device; a
// dynamic import('@capacitor/core') stalls inside the capacitor:// webview). On web
// this returns a harmless no-op proxy — the module is only exercised on native.
const FoldNativeCamera = registerPlugin('FoldNativeCamera');

export function createNativeCamera() {
  let ws = null;
  let port = 0;
  let streamGen = 0;          // bumps per acquisition — every re-acquire (flip, lens,
                              // still/video mode, res/fps) restarts the frame socket,
                              // so downstream consumers (the HDMI external view's
                              // receiver) must rebuild; the gen rides streamInfo
  let canvas = null;          // RGB output canvas — the frameSource the engine samples
  let renderer = null;        // YUV->RGB WebGL2 blitter that owns `canvas`
  let latest = null;          // most recent YUV ArrayBuffer (painted on the render tick)
  let controlRanges = {};     // EV/zoom/WB ranges the device reported (for the UI)
  let lenses = [];            // [{id,label}] physical lenses on the current facing
  let lens = 'wide';          // the chosen physical lens (never 'auto' — the virtual
                              // device disables custom WB + 48MP; a single sensor allows both)
  let resolutions = [];       // [{id,label,maxFps}] the current lens actually offers
  let preset = 'hd1080';      // the chosen streaming (video) resolution
  let targetFps = 30;         // the requested frame rate (matters in record-video mode)
  let videoStab = 'cinematic'; // record-video stabilization — three notches, START IN
                               // THE MIDDLE (Daniel: opting toward either end is a
                               // choice; the old cinematicExtended default surprised
                               // as "why isn't my camera following"): 'standard' |
                               // 'cinematic' (default) | 'cinematicExtended'
  // still capture: on pause we grab a real full-res still via capturePhoto (which
  // switches to the photo format for the shot). `stillMode` tells the plugin to preview
  // at the PHOTO aspect (4:3) so the composition doesn't shift on capture; video mode
  // previews 16:9. Set by the shell from the source type before start().
  let stillMode = true;
  let stillResolutions = [];  // [{id,label,width,height}] the current lens's photo sizes
  let stillRes = null;        // chosen {id,width,height}; null → the sensor max
  // video stabilization crops the sensor; the still capture (photo output, un-stabilized)
  // must be cropped to match the composed preview. Per-mode factors are ESTIMATES (AVF
  // doesn't expose the exact crop) — tunable here, calibrate on device.
  let stabilization = 'off';
  const STABILIZATION_CROP = { standard: 0.9, cinematic: 0.82, cinematicExtended: 0.76, off: 1 };
  // EV / WB: reset on a lens or facing change (a different physical sensor — per-sensor
  // gains don't carry), but KEPT across a resolution/fps change (same sensor). start()
  // re-applies these after the session comes up, so a res/fps re-acquire preserves them.
  let evBias = 0;
  let wbMode = 'auto';        // 'auto' | 'manual'
  let wbTemp = 5000;          // Kelvin, when manual
  let facing = 'environment';
  let active = false;

  function resetControls() { evBias = 0; wbMode = 'auto'; wbTemp = 5000; }

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
    // The preview always streams a LIGHT format (never the heavy photo format, which
    // OOM-crashed the GPU). `stillMode` picks a light format matching the PHOTO aspect
    // (4:3) so the composition doesn't shift when capture switches to the photo format;
    // video mode uses the 16:9 record format. Full-res still comes from the capture-time
    // format switch (in capturePhoto), not a heavy preview.
    const res = await FoldNativeCamera.start({
      preset, fps: targetFps, lens, stillMode,
      videoStabilization: videoStab,
      facing: facing === 'user' ? 'front' : 'back',
    });
    console.info('[native-camera] plugin.start resolved', JSON.stringify(res));
    port = res.port || 8899;
    controlRanges = res.controls || {};
    lenses = res.lenses || [];
    resolutions = res.resolutions || [];
    stillResolutions = res.stillResolutions || [];
    stabilization = res.stabilization || 'off';
    // keep the chosen still size valid for this lens (a tele may top out below 48MP);
    // default to the largest the lens offers.
    if (!stillResolutions.some((r) => r.id === stillRes?.id)) {
      stillRes = stillResolutions[stillResolutions.length - 1] || null;
    }
    active = true;
    streamGen++;   // a fresh acquisition = a fresh socket stream
    // re-apply persisted EV/WB — they survive a resolution/fps re-acquire (same sensor);
    // a lens/facing change calls resetControls() first, so this becomes a no-op (auto/0).
    if (evBias !== 0) { try { await FoldNativeCamera.setExposureBias({ value: evBias }); } catch { /* unsupported */ } }
    if (wbMode === 'manual') { try { await FoldNativeCamera.setWhiteBalance({ temperature: wbTemp }); } catch { /* unsupported */ } }
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
    resetControls();                 // different sensor → drop EV/WB
    return start({ ...extra, facingMode: next });
  }

  // switch to a specific physical lens — re-acquires the session exactly like flip,
  // and resets EV/WB (custom gains are per-sensor and don't carry across).
  async function setLens(id) {
    lens = id;
    resetControls();
    return start({ facingMode: facing });
  }

  // The record fps options SAFE for our full pipeline (native capture + YUV→RGB +
  // engine render + MediaRecorder encode). Rule (Daniel's): the device's PEAK
  // resolution×fps combo is what it can do natively but WE can't sustain, so exclude
  // it and offer everything below. 30 is always the floor. Scales per device off what
  // the plugin reports — e.g. 14 Pro: 4K→30 only, 1080p→30/60 (4K60 is its peak).
  function peakThroughput() {
    let peak = 0;
    for (const r of resolutions) {
      for (const f of [30, 60]) {
        if (f <= Math.round(r.maxFps || 0)) peak = Math.max(peak, (r.width || 0) * (r.height || 0) * f);
      }
    }
    return peak;
  }
  function safeFps(id) {
    const r = resolutions.find((x) => x.id === id);
    if (!r) return [30];
    const maxFps = Math.round(r.maxFps || 0);
    const px = (r.width || 0) * (r.height || 0);
    const peak = peakThroughput();
    const out = [];
    if (maxFps >= 30) out.push(30);
    if (maxFps >= 60 && px * 60 < peak) out.push(60);   // 60 only if it's below the device peak combo
    return out.length ? out : [30];
  }

  // change streaming resolution / frame rate — both re-acquire (a format change).
  async function setResolution(id) {
    preset = id;
    const maxSafe = Math.max(...safeFps(id));   // clamp fps to what's safe at this resolution
    if (targetFps > maxSafe) targetFps = maxSafe;
    return start({ facingMode: facing });
  }
  async function setFrameRate(fps) {
    const safe = safeFps(preset);
    targetFps = safe.includes(fps) ? fps : Math.max(...safe);
    return start({ facingMode: facing });
  }
  // record-video stabilization: three notches, default middle. The extremes are
  // opt-in (extended's smoothing lag surprised as the default — Daniel's daylight
  // pass — but is expected behavior once chosen). Re-acquires.
  async function setVideoStabilization(mode) {
    videoStab = ['standard', 'cinematic', 'cinematicExtended'].includes(mode) ? mode : 'cinematic';
    return start({ facingMode: facing });
  }

  // still-capture mode (photo-optimized format) vs record-video mode. Set by the shell
  // before start() from the source type; changing it takes effect on the next start.
  function setStillMode(on) { stillMode = !!on; }
  // pick a still capture size (no re-acquire — just the next capturePhoto's dimensions)
  function setStillResolution(id) { stillRes = stillResolutions.find((r) => r.id === id) || stillRes; }

  function refreshFrame() { paintLatest(); }
  function frameSource() { return canvas; }

  // --- native controls (consumed by the camera UI) ----------------------------
  async function setExposureBias(value) { evBias = value; return FoldNativeCamera.setExposureBias({ value }); }
  async function setZoom(factor) { return FoldNativeCamera.setZoom({ factor }); }
  async function setWhiteBalance(opts) {
    if (opts.mode === 'auto') wbMode = 'auto';
    else if (opts.temperature != null) { wbMode = 'manual'; wbTemp = opts.temperature; }
    return FoldNativeCamera.setWhiteBalance(opts);
  }
  // full-resolution still (up to the chosen size) written to a temp file; returns a
  // webview-loadable URL for use as the editable source (the 48MP-still-on-pause path).
  async function capturePhoto() {
    const d = stillRes || {};
    const t0 = performance.now();
    const res = await FoldNativeCamera.capturePhoto({ width: d.width || 0, height: d.height || 0 });
    // field diagnostic (the ~2s capture-lag complaint): how much of the wait is
    // the NATIVE half (format switch + settle + shot + file write) vs the JS
    // load/crop half, which logs separately at the freeze site
    console.info(`[fold] capturePhoto native half: ${(performance.now() - t0).toFixed(0)}ms → ${res.width}×${res.height}`);
    return { url: res.url ? Capacitor.convertFileSrc(res.url) : null, width: res.width, height: res.height };
  }
  // the temperature auto WB has currently settled on — lets the UI show a live slider
  // that tracks auto and drops to manual on a drag.
  async function readWhiteBalanceTemp() {
    try { const r = await FoldNativeCamera.getWhiteBalance(); return r?.temperature ?? null; }
    catch { return null; }
  }
  // tap-to-focus: nx,ny are normalized (0–1) in the displayed preview. Front is
  // mirrored in our shader, so flag it for the plugin to un-mirror before mapping.
  async function setFocusPoint(nx, ny) {
    return FoldNativeCamera.setFocusPoint({ x: nx, y: ny, mirrored: facing === 'user' });
  }
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
    setStillMode,
    setStillResolution,
    getResolutions: () => resolutions,   // [{id,label,maxFps,width,height}] for the current lens
    getResolution: () => preset,
    getFrameRate: () => targetFps,
    getVideoStabilization: () => videoStab,
    setVideoStabilization,
    getSafeFps: () => safeFps(preset),   // pipeline-safe fps options for the current resolution
    safeFpsFor: (id) => safeFps(id),
    getStillResolutions: () => stillResolutions,   // [{id,label,width,height}]
    getStillResolution: () => stillRes?.id,
    getStillCropFactor: () => STABILIZATION_CROP[stabilization] ?? 1,   // crop the 48MP still to the stabilized preview FOV
    getStabilization: () => stabilization,
    getExposureBias: () => evBias,
    getWhiteBalanceMode: () => wbMode,   // 'auto' | 'manual'
    getWhiteBalanceTemp: () => wbTemp,
    refreshFrame,
    frameSource,
    setExposureBias,
    setZoom,
    setWhiteBalance,
    readWhiteBalanceTemp,
    setFocusPoint,
    capturePhoto,
    capabilities,
    listDevices: async () => [],
    mirrorsInSource: true,           // the front-camera selfie-flip is baked into the canvas
    getVideo: () => canvas,          // duck-types as a drawable; has no srcObject (audio paths degrade)
    getFacing: () => facing,
    getDeviceId: () => null,
    isFront: () => facing === 'user',
    isActive: () => active,
    // interface parity with shell/camera.js (the desktop chrome's flip button)
    flip: () => start({ facingMode: facing === 'user' ? 'environment' : 'user' }),
    // for the external-display view: where to join the frame stream as a second
    // socket client, whether to bake the selfie mirror (we bake ours the same
    // way), and the acquisition generation (a changed gen = a NEW socket stream —
    // the old connection died with the re-acquire; rebuild the receiver)
    streamInfo: () => (active && port ? { port, mirror: facing === 'user', gen: streamGen } : null),
  };
}
// (the YUV->RGB blitter moved verbatim to shell/yuv-renderer.js — shared with
//  the external-display receiver, shell/native-camera-receiver.js)
