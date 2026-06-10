// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/video-source.js
//
// Helpers for driving a loaded source <video> from the motion timeline: map the
// timeline's normalized position to media seconds, and seek to an exact frame.
// Kept DOM-light + pure so the same primitives serve scrub, playback, and (later)
// frame-accurate export.

// Normalized timeline position p (0..1) → media seconds, clamped to the clip. An
// optional `clip` { inT, outT } (normalized trim, default the whole clip) scales p into
// the trimmed range, so the timeline spans only [inT, outT] of the footage. Omitting
// `clip` (or passing the full 0..1 range) reproduces the untrimmed mapping exactly.
export function pToMediaSec(video, p, clip) {
  const d = video && video.duration;
  if (!d || !isFinite(d)) return 0;
  const inT = clip ? clip.inT : 0, outT = clip ? clip.outT : 1;
  return Math.max(0, Math.min(d, (inT + p * (outT - inT)) * d));
}

// Seek the video to `sec` and resolve once the decoded frame is ready to upload
// as a texture. Resolve on the 'seeked' event (the frame is decoded + available
// for texImage2D then). We deliberately do NOT wait on requestVideoFrameCallback:
// our source <video> is occluded (opacity 0, behind the preview canvas), so on
// Blink/WebKit it may never present a frame to the compositor → rVFC never fires →
// the seek promise hangs → the scrub loop wedges on a stuck frame (the original
// bug). A long safety timeout guarantees we can never wedge even if 'seeked' is
// somehow skipped. Resolves immediately if we're already there.
export function seekVideoTo(video, sec) {
  return new Promise((resolve) => {
    if (!video) { resolve(); return; }
    if (video.readyState >= 2 && Math.abs(video.currentTime - sec) < 1e-3) { resolve(); return; }
    let done = false;
    let timer = 0;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeEventListener('seeked', finish);
      resolve();
    };
    video.addEventListener('seeked', finish, { once: true });
    timer = setTimeout(finish, 2000);   // safety net — never let a scrub seek hang
    try { video.currentTime = sec; } catch { finish(); }
  });
}
