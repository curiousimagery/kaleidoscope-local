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
    if (!v.videoWidth) {
      await new Promise(res => v.addEventListener('loadedmetadata', res, { once: true }));
    }
    return v;
  }

  // Mirror the front-camera preview (selfie convention). Applied to the video
  // element only; the texture and captured frame are mirrored separately at
  // capture time so what you saved matches what you saw.
  function applyMirror() {
    if (video) video.style.transform = facing === 'user' ? 'scaleX(-1)' : '';
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
    getVideo: () => video,
    getFacing: () => facing,
    isFront: () => facing === 'user',
    isActive: () => !!stream,
  };
}
