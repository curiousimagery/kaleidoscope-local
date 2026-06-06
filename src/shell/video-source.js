// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/video-source.js
//
// Helpers for driving a loaded source <video> from the motion timeline: map the
// timeline's normalized position to media seconds, and seek to an exact frame.
// Kept DOM-light + pure so the same primitives serve scrub, playback, and (later)
// frame-accurate export.

// Normalized timeline position p (0..1) → media seconds, clamped to the clip.
// (v1 maps the whole clip; an in/out trim would scale into [inT,outT] here.)
export function pToMediaSec(video, p) {
  const d = video && video.duration;
  if (!d || !isFinite(d)) return 0;
  return Math.max(0, Math.min(d, p * d));
}

// Seek the video to `sec` and resolve once a decoded frame for that time is
// presentable. Prefers requestVideoFrameCallback (guarantees the frame is ready)
// and falls back to the 'seeked' event (Firefox lacks rVFC). Resolves immediately
// if we're already there.
export function seekVideoTo(video, sec) {
  return new Promise((resolve) => {
    if (!video) { resolve(); return; }
    if (video.readyState >= 2 && Math.abs(video.currentTime - sec) < 1e-3) { resolve(); return; }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    const onSeeked = () => {
      if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(() => finish());
      else finish();
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    try { video.currentTime = sec; } catch { finish(); }
  });
}
