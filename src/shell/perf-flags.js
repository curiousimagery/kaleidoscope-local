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

  // Rate-limit the PiP monitor to 10Hz instead of every frame (B528). OFF = every frame, which
  // measured **17.3fps recording with the PiP on against 60fps with it off** — a 238×238 thumbnail
  // costing 41ms/frame while its own timer read 0.17ms.
  //
  // B527 established that the TRANSPORT is not the lever: swapping the 2D canvas for an async
  // GPU-to-GPU `createImageBitmap` moved it 9ms and left recording at 19fps. On WebKit, consuming
  // the WebGL canvas as an image source is what costs ~43ms, whatever you consume it into. The one
  // exception is `new VideoFrame(outputCanvas)`, which the record path does on the same canvas in
  // the same frame for 2.7ms — so this is a WebKit image-source path problem, not a copy cost.
  //
  // That leaves frequency. A monitor does not need program parity; at 10Hz framing and composition
  // are perfectly legible. **This flag is also the diagnostic:** restoring 60fps means the cost is
  // per-consume and the rate limit IS the fix. Barely moving means it is a fixed penalty for having
  // consumed at all, and the PiP cannot coexist with recording on WebKit at any rate — which would
  // make it the arc's first genuine "we cannot deliver this as designed" finding.
  pipThrottle: true,

  // Skip a render that would be pixel-identical to the last one (B542). The display refreshes 60
  // times a second; the camera produces 30 new images a second, so half of every render redrew
  // what was already on screen. Guarded by a full `JSON.stringify(state)` — the app has one flat
  // state object, so it cannot miss a field the way a hand-listed signature eventually would.
  //
  // NEVER active while recording, broadcasting or driving an external display: skipping there
  // would drop a frame from the deliverable. This is the idle/preview case, which is also the
  // sustained-installation case — hours of a scene nobody is touching.
  //
  // OFF = render every rAF, the pre-B542 behaviour. Turn it off if the preview ever looks stale.
  renderElide: true,

  // B542's elision for <video> ELEMENT sources, which is where desktop, Electron and mobile web
  // live (B559). `updateSourceFrame` uploads unconditionally on that path, so a 30fps clip against
  // a 60Hz loop pushes every frame into the texture twice; gating on `currentTime` halves it.
  //
  // DEFAULTED OFF, deliberately, and this is the whole reason it is a flag. The take path, the
  // external display and the bus all consume this and all three are carrying unread changes from
  // B549-B558 on desktop and iPad. Shipping it ON would make any problem found there ambiguous
  // between two builds. Run the regression pass with it OFF, then flip it and measure in the same
  // sitting — one build, both answers.
  //
  // ON = skip the upload when the video's currentTime has not moved. Watch for a STALE source on
  // a paused clip or immediately after a seek; that would mean currentTime is not the identity
  // signal on that path and the answer is requestVideoFrameCallback.
  elideElementUploads: false,

  // Force takes through MediaRecorder instead of WebCodecs (B537). ON = the pre-B365 recorder,
  // which muxes natively and demonstrably produces sound — the package's RAW take has had audio
  // this whole time and it is the only thing on that path.
  //
  // Both a WORKAROUND and the decisive A/B. iPhone composition audio has plausibly been silent
  // since B372 put the phone on WebCodecs; six builds of instrumentation have shown real signal
  // (peak 0.72), real chunks, a decoderConfig, and a `soun` track in the container, and the file
  // is still silent. Turning this ON should produce a take with sound. If it does, the fault is
  // definitively inside the WebCodecs audio chain rather than anywhere upstream of it.
  //
  // The cost is real: MediaRecorder ignores our bitrate on WebKit (the 1080p pixelation B365 was
  // built to fix) and brings back the stop-that-never-stops class. Not a default, a lever.
  recordMediaRecorder: false,

  // STREAM the take to disk (OPFS) instead of assembling it in memory (B553). OFF = the original
  // `ArrayBufferTarget` + `fastStart:'in-memory'` path, which holds every encoded chunk until
  // finalize, materialises one contiguous ArrayBuffer, and then COPIES it again into a Blob —
  // peak footprint a multiple of the finished file.
  //
  // This is the tracked fix for the long-take failures, and the precondition for ever lifting the
  // phone's 1080/2048 record cap: that cap cannot come off while the whole file has to fit in RAM
  // twice. It also changes the file layout — `fastStart:false` puts the moov box at the END, since
  // reserving space for a front-loaded one needs a chunk count a live take cannot know.
  //
  // ⚠️ THE THING TO WATCH IS PLAYBACK, NOT SPEED. AVFoundation reads local moov-at-end files
  // fine, so takes should open normally in Photos; what moov-at-end breaks is progressive HTTP
  // streaming, which a saved take never does. If a take ever fails to open or scrub, turn this
  // OFF — that is the one symptom that would point here rather than at the encoder.
  // ✅ PROVEN ON DEVICE B555 — default ON. Daniel's pass: a 22s take opens and plays with sound in
  // Photos (the moov-at-end question, answered), a 2:48 FHD take produced a valid 108MB file, and a
  // 3:28 4K-source take produced a valid 153MB file. The in-memory path stays one tap away.
  //
  // Previously (B554): DEFAULT OFF until it is proven on device. B553 shipped this ON and it cost Daniel a
  // take: the moov was still in flight when the stream closed, so the file had no index at all and
  // the iOS save sheet hung for two minutes on it. The await bug is fixed and the take is now
  // validated before it reaches the OS — but an unproven change to how every take is WRITTEN does
  // not get to be the default. Turn it ON deliberately to test; flip it back if anything is off.
  recordStreamToDisk: true,

  // PIPELINED (async) GPU→CPU readback for the broadcast bus (B519). OFF = the synchronous
  // `readPixels` that measured 21.3ms/frame at 4K on desktop — the largest single cost in the
  // app. This is the one flag whose OFF state is genuinely worse; it exists so the win can be
  // measured rather than asserted, and because a driver that mishandles fences needs an escape.
  asyncReadback: true,
};

// The SHIPPED defaults, snapshotted at load. The panel restores from this on close.
//
// It used to restore by setting every flag to `true`, which was correct only while every flag
// defaulted to on ("closing must never leave the app de-optimized"). `recordMediaRecorder`
// defaults to FALSE, so that blanket restore would have silently switched recording to the
// fallback path the moment the panel closed — the exact opposite of restoring.
export const PERF_FLAG_DEFAULTS = { ...perfFlags };

// the switchboard entries the frame-cost panel renders — id, label, and what each one means when
// you turn it OFF (which is the direction you are testing)
export const PERF_FLAG_SPECS = [
  ['overlayGated', 'overlay: draw only on change', 'off = redraw every frame (pre-B513)'],
  ['overlayDprCap', 'overlay: cap at 2x pixels', 'off = raw device pixel ratio'],
  ['busElide', 'bus: skip render when unchanged', 'off = render + read back every frame'],
  ['posterElide', 'external: skip identical posts', 'off = post state every frame'],
  ['asyncReadback', 'bus: pipelined readback', 'off = blocking readPixels (21ms/frame at 4K)'],
  ['recordDirect', 'record: encode the GL canvas', 'off = the 2D blit (40ms/frame at FHD on iPhone)'],
  ['pipThrottle', 'PiP: 10Hz monitor', 'off = every frame (17fps vs 60 while recording)'],
  ['recordMediaRecorder', 'record: use MediaRecorder', 'on = the pre-B365 recorder — takes have SOUND, lower video quality'],
  ['renderElide', 'render: skip identical frames', 'off = render every rAF (2x the renders on a 30fps camera)'],
  ['elideElementUploads', 'source: skip repeat video uploads', 'on = gate <video> texture uploads on currentTime (2x on a 30fps clip at 60Hz)'],
  ['recordStreamToDisk', 'record: stream to disk', 'off = assemble the take in memory (the pre-B553 path; peak RAM a multiple of the file)'],
  ['recordForceFlush', 'record: force sync rasterize', 'Blink-only by default; ON here if a WebKit take shows a stale frame'],
];
