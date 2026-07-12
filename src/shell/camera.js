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
  let track = null;            // the live video track (for capability-gated controls)

  function ensureVideo() {
    if (video) return video;
    video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    // iOS Safari needs the attribute form too to avoid fullscreen takeover.
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    // suppress the browser's own picture-in-picture toggle (Firefox overlays one
    // on the displayed camera video — clicking it rips the source out of the app)
    video.disablePictureInPicture = true;
    video.setAttribute('disablepictureinpicture', '');
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
    // still succeed) unless an exact deviceId was picked. An explicit width/height
    // (the output window matching the MAIN capture's negotiated mode — a second
    // consumer of the same device can otherwise land on a different aspect, which
    // skews every normalized slice coordinate) overrides the max-res ask.
    const idealW = opts.width || 3840, idealH = opts.height || 2160;
    const video = wantDevice
      ? { deviceId: { exact: wantDevice }, width: { ideal: idealW }, height: { ideal: idealH } }
      : { facingMode: { ideal: facing }, width: { ideal: idealW }, height: { ideal: idealH } };
    // opts.audio: request the mic IN THE SAME CALL — one combined permission
    // prompt instead of camera-then-mic-later (mobile record video's ask)
    stream = await navigator.mediaDevices.getUserMedia({ video, audio: !!opts.audio });
    track = stream.getVideoTracks()[0];
    const settings = track ? track.getSettings() : {};
    currentDeviceId = settings.deviceId || wantDevice || null;
    // CAMERA-CONTROL SPIKE diagnostic (native arc): log what THIS platform's track
    // actually exposes, so on-device (Safari Web Inspector) we SEE the reachable
    // zoom/torch/focus + their ranges instead of guessing before designing the gear.
    // One info line per camera start; harmless on platforms that expose nothing.
    try {
      console.info('[fold camera] getCapabilities:', track?.getCapabilities?.() ?? {},
        '· getSettings:', settings);
    } catch { /* getCapabilities unsupported on this engine */ }
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
    track = null;
  }

  // --- camera controls (capability-gated, best-effort) ------------------------
  // What the CURRENT track can adjust: zoom {min,max,step}, torch (bool), focusMode
  // (list), etc. Empty object when the platform exposes nothing (iOS Safari long
  // exposed little; recent WebKit adds zoom/torch/focus). The camera-settings gear
  // reads this and only shows controls that actually exist here — so nothing appears
  // where the platform can't honor it. EV/WB/lens-select that getUserMedia never
  // exposes come from the native shell via host.nativeCamera (the Capacitor path).
  function capabilities() {
    try { return (track && track.getCapabilities) ? track.getCapabilities() : {}; }
    catch { return {}; }
  }
  // Current values for the adjustable fields (getSettings()).
  function controls() {
    try { return (track && track.getSettings) ? track.getSettings() : {}; }
    catch { return {}; }
  }
  // Apply advanced constraints (e.g. { zoom: 2 }, { torch: true }, { focusMode:
  // 'continuous' }). Advanced constraints are best-effort per spec — a field the
  // track can't honor is ignored rather than throwing. Returns true on success.
  async function applyControls(obj) {
    if (!track || !track.applyConstraints) return false;
    try { await track.applyConstraints({ advanced: [obj] }); return true; }
    catch { return false; }
  }

  function stop() {
    stopStream();
    if (video) video.srcObject = null;
  }

  // flip front<->rear; re-acquires the stream. returns the (same) video element.
  async function flip(extra = {}) {
    return start({ facingMode: facing === 'environment' ? 'user' : 'environment', ...extra });
  }

  return {
    start,
    stop,
    flip,
    listDevices,
    refreshFrame,
    frameSource,
    capabilities,
    controls,
    applyControls,
    getTrack: () => track,
    getVideo: () => video,
    getFacing: () => facing,
    getDeviceId: () => currentDeviceId,
    isFront: () => facing === 'user',
    isActive: () => !!stream,
  };
}
