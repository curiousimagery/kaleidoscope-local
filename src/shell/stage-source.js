// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/stage-source.js
//
// THE EDITOR'S SOURCE WHILE STAGING — the seam that lets motion's staging survive a
// single decode.
//
// Staging means preparing a look off-air while the committed loop keeps playing. That
// needs the audience and the editor to be at DIFFERENT footage positions, which one
// <video> can't do. The old answer was a second full-resolution PLAYING copy for the
// audience (motion-runtime's stg.video). B495 tried removing it by sharing one playhead
// and that deleted staging outright: parking the edit playhead froze the program.
//
// The fix is to invert which side pays. The AUDIENCE keeps the one playing decode at
// full resolution — it needs 30fps. The EDITOR needs ONE FRAME AT A TIME, at whatever
// the preview canvas can actually show. So the editor gets bounded, on-demand stills:
//   - parked → seek a paused, seek-only decoder to the playhead and paint that frame
//   - following → copy the live frame the audience is already showing
// Either way the stage samples ONE canvas, so the engine's source is set once per
// staging session and never swapped mid-flight.
//
// TWO IMPLEMENTATIONS, one interface (the sourceClock pattern):
//   - createVideoStageSource — this file. A hidden PAUSED <video>; the extra decoder is
//     parked instead of playing, which is already cheaper than what it replaces.
//   - native (S3-A stage 3) — AVAssetImageGenerator on the same asset with maximumSize
//     and seek tolerance: a decode burst per scrub-settle, no second player at all.
//
// CAP: the stage canvas is capped on its long edge. This does NOT make the decode
// cheaper (a <video> decodes at native resolution regardless) — it bounds the TEXTURE
// the preview uploads, which at 4K is 33MB a frame. The parked-vs-playing decoder is
// where the real saving is.

const DEFAULT_CAP = 2048;

import { acquireSession, releaseSession } from 'conduit/sessions';

export function createVideoStageSource(env, { cap = DEFAULT_CAP } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let vid = null;                       // the seek-only decoder (created on begin)
  let token = 0;                        // its entry in the session registry (conduit/sessions)
  let seekBusy = false, seekNext = null;   // latest-wins coalescing (the scrubStillFrame pattern)
  let painted = 0;

  // size the canvas to the source, capped on the long edge
  function fitTo(w, h) {
    if (!w || !h) return false;
    const s = Math.min(1, cap / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    return true;
  }

  // paint whatever drawable we were handed into the stage canvas
  function paintFrom(src) {
    if (!src) return false;
    const w = src.videoWidth || src.naturalWidth || src.width || 0;
    const h = src.videoHeight || src.naturalHeight || src.height || 0;
    if (!fitTo(w, h)) return false;
    try { ctx.drawImage(src, 0, 0, canvas.width, canvas.height); } catch { return false; }
    painted++;
    return true;
  }

  function begin() {
    if (vid) return;
    const url = env.media?.sourceVideoUrl;
    if (!url) return;
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.loop = false;                       // never plays — this decoder only ever seeks
    v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
    v.disablePictureInPicture = true; v.setAttribute('disablepictureinpicture', '');
    v.src = url;
    vid = v;
    token = acquireSession('decode', 'staging seek decoder');
    // seed the canvas from the LIVE element so the stage has pixels before the first
    // seek lands (otherwise the preview is blank for a beat on entering staging)
    followLive();
  }

  function end() {
    const v = vid;
    vid = null;
    seekNext = null;
    if (!v) return;
    try { v.pause(); } catch { /* ignore */ }
    v.removeAttribute('src');             // release the decoder; the blob URL stays owned by media
    try { v.load(); } catch { /* ignore */ }
    releaseSession(token); token = 0;
  }

  // Copy the frame the AUDIENCE is currently showing. Used when the editor is following
  // live: the stage then differs from the program only in its params, which is the point.
  function followLive() {
    return paintFrom(env.sourceVideo);
  }

  // Park on an exact frame. Latest-wins: a drag issues many of these and only the most
  // recent target matters, so we never queue seeks behind a decoder that is still working.
  async function seekTo(sec) {
    if (!vid) return;
    if (seekBusy) { seekNext = sec; return; }
    seekBusy = true;
    try {
      await new Promise((resolve) => {
        if (!vid) { resolve(); return; }
        if (vid.readyState >= 2 && Math.abs(vid.currentTime - sec) < 1e-3) { resolve(); return; }
        let done = false, timer = 0;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          vid?.removeEventListener('seeked', finish);
          resolve();
        };
        vid.addEventListener('seeked', finish, { once: true });
        timer = setTimeout(finish, 2000);   // never let a stage seek wedge the editor
        try { vid.currentTime = sec; } catch { finish(); }
      });
      if (vid) paintFrom(vid);
    } finally {
      seekBusy = false;
    }
    if (seekNext != null) { const n = seekNext; seekNext = null; seekTo(n); }
  }

  return {
    begin,
    end,
    seekTo,
    followLive,
    frameSource: () => canvas,
    get active() { return !!vid; },
    get ready() { return painted > 0 && canvas.width > 0; },
  };
}
