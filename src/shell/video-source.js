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

// ---- the source clock seam (S3-A stage 2) ----------------------------------
// WHO OWNS TIME. The motion and perform runtimes treat the source video as their master
// clock: every frame derives progress from it, and scrub / trim-rewind / retime write
// back to it. That works because a <video> IS a clock. The shared-socket path replaces
// the element with a canvas fed by a single native decode — which has no `currentTime`
// and cannot be seeked — so the runtimes have to address an INTERFACE rather than an
// element.
//
// This is that interface. Today's only implementation is a straight passthrough to the
// <video>: same reads, same writes, same order, so routing a call site through it is
// behavior-neutral by construction. Stage 3 adds the native implementation (time from
// the latest frame's PTS, transport over the Capacitor bridge) and nothing above this
// line changes.
//
//   time      seconds into the clip of the frame currently presented
//   duration  clip length in seconds (0 when not known yet)
//   present / ready / paused / seeking / rate      transport state
//   seek(t) / seekSettled(t) / setRate(r) / play() / pause()   transport writes
//
// LOOPING IS OURS, NOT THE ELEMENT'S: `play()` clears the native loop flag, because
// every caller loops within the TRIMMED range itself and a native decode has no
// element-level loop to inherit. Keeping that in one place is what stopped perform and
// motion from disagreeing about clip length (B492).
//
// `resolve` is a getter rather than a bound element on purpose: the working source is
// swapped out from under the runtimes (upload, Loop Builder bake), and a clock holding
// the old element would silently drive a dead decoder.
export function createVideoElementClock(resolve) {
  const el = () => (typeof resolve === 'function' ? resolve() : resolve);
  return {
    get kind() { return 'video'; },
    get el() { return el(); },
    get present() { return !!el(); },
    get ready() { const v = el(); return !!v && v.readyState >= 2; },
    get time() { const v = el(); return v ? v.currentTime : 0; },
    get duration() { const d = el()?.duration; return (d && isFinite(d)) ? d : 0; },
    get paused() { const v = el(); return v ? !!v.paused : true; },
    get seeking() { const v = el(); return v ? !!v.seeking : false; },
    get rate() { const v = el(); return v ? v.playbackRate : 1; },
    seek(t) { const v = el(); if (v) { try { v.currentTime = t; } catch { /* not seekable yet */ } } },
    seekSettled(t) { return seekVideoTo(el(), t); },
    setRate(r) { const v = el(); if (v) { try { v.playbackRate = r; } catch { /* some browsers clamp extreme rates */ } } },
    play() {
      const v = el(); if (!v) return;
      try { v.loop = false; } catch { /* ignore */ }
      v.play().catch(() => {});
    },
    pause() { const v = el(); if (v) { try { v.pause(); } catch { /* ignore */ } } },
  };
}
