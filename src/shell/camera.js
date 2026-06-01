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

  async function start(facingMode = facing) {
    facing = facingMode;
    stopStream();
    // Request as much resolution as the camera will give — capture saves the
    // raw frame at native size. facingMode is `ideal` so devices with only one
    // camera (most laptops) still succeed.
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
      audio: false,
    });
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
    refreshFrame,
    frameSource,
    getVideo: () => video,
    getFacing: () => facing,
    isFront: () => facing === 'user',
    isActive: () => !!stream,
  };
}
