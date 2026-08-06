// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/perf-flags.js
//
// BEHAVIOR FLAGS for the optimizations that changed how the app works — each one live-toggleable
// so it can be A/B'd against itself on real hardware instead of argued about.
//
// WHY THESE EXIST. Build 513's cuts were justified by reasoning, not measurement: in each case
// the work provably produced an identical result, so skipping it cannot change what you see.
// That reasoning is sound but it is not evidence, and two of the three (the overlay ones) were
// shipped precisely because Daniel wanted the numbers on them. A flag makes the A/B a two-tap
// operation on the device instead of a pair of builds.
//
// They are NOT user settings and never will be. They default to the shipped behavior (all
// optimizations ON) and are reachable only from the frame-cost panel. Nothing persists: a reload
// returns to the shipped behavior, so the app cannot be left in a de-optimized state by accident.
//
// A flag that proves its optimization worthless should be DELETED along with the optimization —
// this file is a measuring stage, not a permanent configuration surface.

// The shipping resolution ladder, from Daniel's on-device judgement (B516/B517). 50% and 35%
// are DELIBERATELY absent: 50 "lives in that uncanny 'something is off' zone", which is the worst
// possible place for a degradation to sit — visible enough to distract, ambiguous enough to read
// as a broken output rather than a deliberate one. So the ladder is a step nobody notices (75)
// and a step everybody notices ON PURPOSE (25, which reads as honest system status: "this is not
// pushing full resolution"). Nothing in between to be misread.
import { detectEngine } from '../kit/capabilities.js';

export const QUALITY_LADDER = [1, 0.75, 0.25];

export const perfFlags = {
  // draw the slice overlay only when something it draws actually changed (B513). OFF = redraw
  // on every call, which is the pre-B513 behavior: every frame of camera preview and playback.
  overlayGated: true,

  // cap the overlay canvas at 2x device pixels (B513), matching every other canvas. OFF = the
  // raw device ratio, which on a 3x phone is 2.25x the pixels for the same vector line work.
  overlayDprCap: true,

  // skip the broadcast bus's render + GPU readback when the program is provably unchanged
  // (B513). The frame is still PUBLISHED either way; this only elides producing it.
  busElide: true,

  // skip posting an identical state message to a self-rendering external view (B513), subject
  // to the heartbeat floor. OFF = post every frame, the pre-B513 behavior.
  posterElide: true,

  // FORCE the record blit to rasterize synchronously (`getImageData(0,0,1,1)` after the drawImage)
  // — now BLINK-ONLY, which is where the behavior it guards against actually lives.
  //
  // What it defends: Chromium's 2D canvases are DEFERRED, so a drawImage out of a WebGL canvas
  // that re-renders later in the same task captures the LATER render — the preview instead of the
  // followed output. Real bug, found on Chromium, fix still required there.
  //
  // Why it is off elsewhere: B522 measured that one-pixel read at **39.29ms/frame on iPhone at
  // FHD (58ms with a 4K source) against 3.19ms to encode** — twelve to one, and the whole reason
  // phone recording sat at 20fps. It is a full pipeline sync, not a copy: the record canvas is the
  // same size in both measurements while the cost nearly doubles with a 4K SOURCE, i.e. it waits
  // longer for a slower render. B523 shipped it as a switch and Daniel verified on device that a
  // take recorded WITHOUT it plays back correctly, with no out-of-place frames.
  //
  // ⚠️ ONE TAKE IS EVIDENCE, NOT PROOF. Canvas deferral is timing-dependent, so a stale frame
  // could still appear under different load. The switch stays in the panel for exactly that case:
  // if a take on WebKit ever shows a frame out of place, turn this ON and we will know within one
  // recording, and the architectural fix (a VideoFrame straight off the GL canvas, which orders
  // correctly without leaving the GPU) becomes the answer instead.
  recordForceFlush: detectEngine().isBlink,

  // Hand WebCodecs the GL output canvas DIRECTLY, deleting the intermediate 2D record canvas
  // (B525). OFF = the old GL→2D blit, which is what every measurement through B524 was made
  // against: 40.7ms/frame at FHD, 92.57ms with a 4K source, against 3.1ms to encode.
  //
  // Why the blit was pure overhead: `recordCanvas.width = outputCanvas.width` at record start,
  // and `recordUpscale` makes sizeOutput render the output canvas AT record resolution while a
  // take rolls. So it was a same-size canvas-to-canvas copy — and `drawImage` out of a WebGL
  // canvas carries an implicit sync, which is what B524 proved when removing the explicit
  // `getImageData` flush changed nothing.
  //
  // It also makes `recordForceFlush` moot on this path: `new VideoFrame(canvas)` is specified to
  // COPY at construction, so a later render in the same task cannot bleed into the take. That is
  // the ordering guarantee the forced flush was buying with a full pipeline stall.
  //
  // The blit path stays live behind this flag and is still used unconditionally for the
  // MediaRecorder fallback and for the rare mid-take resize, where scaling is the correct answer.
  recordDirect: true,

  // PIPELINED (async) GPU→CPU readback for the broadcast bus (B519). OFF = the synchronous
  // `readPixels` that measured 21.3ms/frame at 4K on desktop — the largest single cost in the
  // app. This is the one flag whose OFF state is genuinely worse; it exists so the win can be
  // measured rather than asserted, and because a driver that mishandles fences needs an escape.
  asyncReadback: true,
};

// the switchboard entries the frame-cost panel renders — id, label, and what each one means when
// you turn it OFF (which is the direction you are testing)
export const PERF_FLAG_SPECS = [
  ['overlayGated', 'overlay: draw only on change', 'off = redraw every frame (pre-B513)'],
  ['overlayDprCap', 'overlay: cap at 2x pixels', 'off = raw device pixel ratio'],
  ['busElide', 'bus: skip render when unchanged', 'off = render + read back every frame'],
  ['posterElide', 'external: skip identical posts', 'off = post state every frame'],
  ['asyncReadback', 'bus: pipelined readback', 'off = blocking readPixels (21ms/frame at 4K)'],
  ['recordDirect', 'record: encode the GL canvas', 'off = the 2D blit (40ms/frame at FHD on iPhone)'],
  ['recordForceFlush', 'record: force sync rasterize', 'Blink-only by default; ON here if a WebKit take shows a stale frame'],
];
