// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// camera.js
//
// Host-layer module: turns a device camera into a playing <video> the engine
// can use as a live source. Pure plumbing — no kaleidoscope UI, no rendering.
// The shell drives a continuous render loop that pulls frames from getVideo()
// via engine.updateSourceFrame() each tick.
//
// getUserMedia requires a secure context (https, or localhost in dev). On a
// LAN IP without https it will reject; the shell surfaces that error.

export function createCamera() {
  let stream = null;
  let video = null;
  let facing = 'environment';  // 'environment' (rear) | 'user' (front)
  let mirrorCanvas = null;     // front-camera frames flipped horizontally
  let currentDeviceId = null;  // the deviceId of the live track (for the picker)

  function ensureVideo() {
    if (video) return video;
    video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    // iOS Safari needs the attribute form too to avoid fullscreen takeover.
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    return video;
  }

  // start the camera. `opts` is either a facingMode string (legacy: 'user' /
  // 'environment') or an object { facingMode, deviceId }. A deviceId (the picker
  // path) wins — it pins an exact camera; we then derive `facing` from the track
  // so mirroring still follows whether the chosen camera is user-facing.
  async function start(opts = {}) {
    if (typeof opts === 'string') opts = { facingMode: opts };
    const wantDevice = opts.deviceId || null;
    if (opts.facingMode) facing = opts.facingMode;
    stopStream();
    // Request as much resolution as the camera will give — capture saves the
    // raw frame at native size. By facingMode (`ideal`, so single-camera laptops
    // still succeed) unless an exact deviceId was picked.
    const video = wantDevice
      ? { deviceId: { exact: wantDevice }, width: { ideal: 3840 }, height: { ideal: 2160 } }
      : { facingMode: { ideal: facing }, width: { ideal: 3840 }, height: { ideal: 2160 } };
    stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    const track = stream.getVideoTracks()[0];
    const settings = track ? track.getSettings() : {};
    currentDeviceId = settings.deviceId || wantDevice || null;
    // Picked by device → no facingMode intent; mirror only if the track itself
    // reports user-facing (external/USB cams report nothing → no mirror).
    if (wantDevice) facing = settings.facingMode === 'user' ? 'user' : 'environment';
    const v = ensureVideo();
    v.srcObject = stream;
    applyMirror();
    await v.play();
    // wait for a decoded frame (readyState HAVE_CURRENT_DATA) so videoWidth is
    // known AND the mirror canvas can be drawn before the first setSource.
    if (v.readyState < 2) {
      await new Promise(res => v.addEventListener('loadeddata', res, { once: true }));
    }
    refreshFrame();   // prime the mirror canvas before the first setSource
    return v;
  }

  // List the available video input devices (deviceId + label). Labels are only
  // populated once camera permission has been granted, so call this after start.
  async function listDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter(d => d.kind === 'videoinput')
      .map(d => ({ deviceId: d.deviceId, label: d.label }));
  }

  // Mirror the front-camera preview (selfie convention) on the displayed video
  // element. The texture is mirrored to match (see frameSource/refreshFrame) so
  // the wedge overlay samples what the user actually sees under it.
  function applyMirror() {
    if (video) video.style.transform = facing === 'user' ? 'scaleX(-1)' : '';
  }

  // The element the ENGINE should sample: the raw <video> for the rear camera,
  // or a horizontally-flipped offscreen canvas for the front camera so the
  // sampled content matches the mirrored preview.
  function frameSource() {
    return facing === 'user' ? mirrorCanvas : video;
  }

  // Front camera only: redraw the current video frame flipped into the mirror
  // canvas. Called each render tick by the shell's live loop before the engine
  // re-uploads the frame. No-op for the rear camera (the video is uploaded
  // directly) and until the video has a decoded frame.
  function refreshFrame() {
    if (facing !== 'user') return;
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    const w = video.videoWidth, h = video.videoHeight;
    if (!mirrorCanvas) mirrorCanvas = document.createElement('canvas');
    if (mirrorCanvas.width !== w || mirrorCanvas.height !== h) {
      mirrorCanvas.width = w; mirrorCanvas.height = h;
    }
    const cx = mirrorCanvas.getContext('2d');
    cx.setTransform(-1, 0, 0, 1, w, 0);   // flip X
    cx.drawImage(video, 0, 0, w, h);
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  }

  function stop() {
    stopStream();
    if (video) video.srcObject = null;
  }

  // flip front<->rear; re-acquires the stream. returns the (same) video element.
  async function flip() {
    return start(facing === 'environment' ? 'user' : 'environment');
  }

  return {
    start,
    stop,
    flip,
    listDevices,
    refreshFrame,
    frameSource,
    getVideo: () => video,
    getFacing: () => facing,
    getDeviceId: () => currentDeviceId,
    isFront: () => facing === 'user',
    isActive: () => !!stream,
  };
}
