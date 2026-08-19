// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/native-video.js  (S3-A stage 3)
//
// ONE DECODE OF THE CLIP, shared by both webviews. The interface-compatible sibling of
// native-camera.js: the `fold-native-video` plugin decodes natively and pushes stamped
// FYUW frames over a localhost socket; this module joins that socket, paints an RGB
// canvas the engine samples like any drawable, and exposes a `sourceClock` so motion
// and perform drive the native player exactly as they drove a `<video>`.
//
// WHY: on iPad, HDMI + a video source opened TWO decoders (the main engine's `<video>`
// and the external view's) and at 4K that trips jetsam → lost GL context. Decoding once
// here and fanning frames to both views removes the second decode and lifts the 1080p
// cap. The external view joins the SAME socket as a second client (output-view.js's
// `video-native` branch), so the two views are frame-synced by construction — there is
// no clock to reconcile and nothing to seek.
//
// THE BYTES. `AVURLAsset` needs a file on disk and a WKWebView Blob has no path, so we
// stream the clip to the plugin over a BINARY SOCKET (Daniel's call — see
// FileUploadServer.swift). `blob.slice()` is lazy and disk-backed, so peak memory is one
// slice no matter how long the clip is: the thing that made a 6min 4K clip a non-starter
// over the bridge.
//
// FALLBACK IS ALWAYS INTACT. Every entry point returns null rather than throwing when
// the plugin is missing or anything fails, and source-host keeps the `<video>` path. The
// worst case is no improvement, never a broken state.

import { registerPlugin, Capacitor } from '@capacitor/core';
import { createNativeFrameReceiver } from './native-frame-receiver.js';
import { perfFlags } from './perf-flags.js';
import { acquireSession, releaseSession } from 'conduit/sessions';

const FoldNativeVideo = registerPlugin('FoldNativeVideo');

const UPLOAD_SLICE = 4 * 1024 * 1024;   // 4MB per socket message: bounded memory, few round trips
const PREVIEW_CAP = 1280;               // the RGB canvas is a PREVIEW now — the engine takes planes

// SOURCE DETAIL (diagnostics toggle → localStorage; settings is the eventual home).
// 0 = native resolution; otherwise the long edge the engine's source texture is bounded
// to. This is the graceful-degradation lever: the decode and the wire stay full-res, and
// the cap only trades detail for fill rate, so slower hardware steps down instead of
// falling over. Read live so the toggle takes effect on the next frame, not the next load.
function sourceCap() {
  try { return Math.max(0, parseInt(localStorage.getItem('foldNativeVideoCap') || '0', 10) || 0); }
  catch { return 0; }
}

// WHY THE LAST ATTEMPT FELL BACK, kept module-level so the caller can publish it after
// `createNativeVideoSource` has returned its deliberate null. See the catch in that
// function for why the STAGE is the diagnostic and not the message.
let lastStartError = null;
export function getNativeStartError() { return lastStartError; }

// THE LOOP-CACHE BUDGET, in MB. Lives here rather than in the plugin's `start` because the whole
// point is comparing 64 against 128 while the same clip loops (Daniel, B605) — read live, pushed
// over the bridge on every change. 0 disables the cache, which is the A/B's off arm.
export function loopCacheMB() {
  try { const v = localStorage.getItem('foldLoopCacheMB'); return v == null ? 64 : Math.max(0, parseInt(v, 10) || 0); }
  catch { return 64; }
}
export function pushLoopCacheBudget() {
  if (!nativeVideoAvailable()) return;
  FoldNativeVideo.setLoopCache({ mb: loopCacheMB() }).catch(() => {});
}

export function nativeVideoAvailable() {
  try {
    return Capacitor?.isNativePlatform?.() && Capacitor.getPlatform() === 'ios';
  } catch { return false; }
}

// Stream a Blob/File to the plugin over the upload socket. Resolves the native path.
async function uploadClip(blob, name, onProgress) {
  const t0 = performance.now();
  const { port, id } = await FoldNativeVideo.beginUpload({ name: name || 'clip.mp4' });
  console.info(`[fold] native video: upload opened on ${port} (${(blob.size / (1024 * 1024)).toFixed(0)}MB)`);
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.binaryType = 'arraybuffer';
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('upload socket refused'));
    setTimeout(() => rej(new Error('upload socket timed out')), 5000);
  });
  try {
    for (let off = 0; off < blob.size; off += UPLOAD_SLICE) {
      const slice = blob.slice(off, Math.min(off + UPLOAD_SLICE, blob.size));
      ws.send(await slice.arrayBuffer());   // one slice resident at a time
      // don't outrun the socket's own buffer — a 2GB clip queued at once is the very
      // memory blow-up this transport exists to avoid
      while (ws.bufferedAmount > UPLOAD_SLICE * 4) await new Promise((r) => setTimeout(r, 8));
      onProgress?.(Math.min(1, (off + UPLOAD_SLICE) / blob.size));
    }
  } finally {
    // DRAIN BEFORE CLOSING (B609). The loop above deliberately lets up to four slices (16MB) sit
    // in the socket's send buffer, and `close()` does not promise to flush what is queued — so the
    // tail of the clip could simply be dropped. Daniel's B608 report caught it in the act:
    // `failed at "upload": upload short by 11161254 bytes`, which is 10.6MB, squarely inside that
    // window. The consequence is not a slow load, it is **no native decode for the whole session**
    // — the upload "succeeds", AVURLAsset gets a truncated file, and everything falls back to
    // `<video>` (which is what made that session's 64MB cache reading meaningless).
    const until = performance.now() + 30000;
    while (ws.bufferedAmount > 0 && performance.now() < until) await new Promise((r) => setTimeout(r, 8));
    if (ws.bufferedAmount > 0) console.warn(`[fold] upload drain timed out with ${ws.bufferedAmount} bytes queued`);
    try { ws.close(); } catch { /* already gone */ }
  }
  // the bridge and the socket are different channels — `bytes` lets native wait for the
  // last slices to actually land instead of assuming its write queue is drained
  const { path, bytes } = await FoldNativeVideo.finishUpload({ id, bytes: blob.size });
  const secs = (performance.now() - t0) / 1000;
  console.info(`[fold] native video: uploaded ${bytes} of ${blob.size} bytes in ${secs.toFixed(1)}s`
    + ` (${(blob.size / (1024 * 1024) / Math.max(0.001, secs)).toFixed(0)}MB/s) → ${path}`);
  if (!path) throw new Error('upload did not complete');
  if (bytes < blob.size) throw new Error(`upload short by ${blob.size - bytes} bytes`);
  return path;
}

// The sourceClock implementation over the native player. Reads come off the frame the
// receiver is about to paint (its PTS), so "what time is it" answers with the time of
// the frame actually on screen. Writes go over the bridge.
function createNativeClock(receiver, state) {
  return {
    get kind() { return 'native'; },
    get el() { return receiver.frameSource(); },
    get present() { return true; },
    get ready() { return receiver.framesPainted > 0; },
    // OPTIMISTIC THROUGH A SEEK. `receiver.pts` is the timestamp of the frame that has
    // actually been PAINTED, which is the right answer at rest and the wrong one for the
    // few frames a seek takes to come back down the pipe — during which this reported the
    // position we just left. That is Daniel's "on play it sweeps the whole timeline before
    // returning to the beginning" (pressing play from the end seeks to 0, and the clock
    // kept reading the end) and the smaller "scrubber flicks forward a couple of frames
    // before snapping back". So a seek publishes its TARGET until a painted frame lands
    // near it — or until the window expires, so a seek that never resolves can't wedge
    // the clock.
    get time() {
      const painted = receiver.pts || 0;
      const p = state.pending;
      if (!p) return painted;
      if (Math.abs(painted - p.t) < 0.35) { state.pending = null; return painted; }
      // GIVE UP ON EVIDENCE, NOT ON A STOPWATCH. The first version of this held the target
      // for a fixed 1.5s, which a 4K seek into a long clip outlasts — so the guard expired
      // mid-seek, the clock reported the position we had left, and the playhead jumped
      // there before snapping back (Daniel: "skips forward to the middle before hopping
      // back"). Counting PAINTED frames instead measures the thing that matters: a dozen
      // real frames that are all nowhere near the target means the seek isn't landing
      // where we asked, so believe the frames. A stalled decode paints nothing and
      // therefore spends none of this budget.
      if (receiver.framesPainted - p.frames > 12 || performance.now() > p.until) {
        state.pending = null;
        return painted;
      }
      return p.t;
    },
    get duration() { return receiver.duration || 0; },
    get paused() { return state.paused; },
    // native seeks are not observable as a flag; treat the settle window as "seeking"
    // so callers that skip work mid-seek (perform's tick, output-engine) still do
    get seeking() { return performance.now() < state.seekUntil; },
    get rate() { return state.rate; },
    // `settle` is the window during which `seeking` reads true, so callers that skip work
    // mid-seek stand down. It protects a SCRUB, where painting the decoder's flight path
    // would flicker the output. A loop rewind has nothing to protect, so it passes 0 —
    // see `rewind`.
    seek(t, { settle = 120 } = {}) {
      const target = Math.max(0, t);
      state.seekUntil = settle ? performance.now() + settle : 0;
      // `time` reports this target until a painted frame lands near it (see `get time`)
      state.pending = { t: target, frames: receiver.framesPainted, until: performance.now() + 8000 };
      FoldNativeVideo.seek({ time: target }).catch(() => {});
    },
    // THE LOOP BOUNDARY IS NOT A SCRUB (B595). Both playback ticks wrap at the TRIM
    // out-point by seeking, which is right for a `<video>` (whose own loop we cleared)
    // and doubly wrong here.
    //
    // First, AVPlayerLooper is ALREADY looping this asset seamlessly, so when the trim
    // spans the whole clip our seek is a redundant precise 4K seek issued at the exact
    // moment the looper is swapping in the next item. Second, the seek opened a 120ms
    // `seeking` window, and perform's tick skips its ENTIRE body while seeking — no
    // frame refresh, no upload, no render. 120ms is four frames at 30fps, which is
    // Daniel's "holds a frame for a few beats each time it restarts".
    //
    // So: defer to the looper when it owns the wrap, and when we genuinely do own it
    // (a trimmed range) rewind without blanking the render. There are no stray
    // intermediate frames to filter on this path — the receiver only ever holds the
    // newest frame the socket delivered.
    rewind(inSec, outSec) {
      const dur = receiver.duration || 0;
      const whole = dur > 0 && inSec <= 0.05 && outSec >= dur - 0.05;
      if (whole && state.loops) {
        state.suppressed++;
        state.suppressWhy = 'AVPlayerLooper owns the wrap (trim spans the whole clip)';
        return false;
      }
      state.rewinds++;
      // always overwritten, so `why` reports the MOST RECENT decision — the trim can
      // change mid-session, and a stale reason would misread as the current one
      state.suppressWhy = state.loops
        ? `we own the wrap (trim ${inSec.toFixed(2)}–${outSec.toFixed(2)} of ${dur.toFixed(2)}s)`
        : 'we own the wrap (the native player is not looping)';
      this.seek(inSec, { settle: 0 });
      return true;
    },
    // Resolve once a frame at (or past) the target has actually been PAINTED.
    //
    // THE POLL MUST PUMP THE PAINT. `receiver.pts` only advances when paintLatest() runs,
    // and paintLatest only runs from refreshFrame() — which the motion/perform tick calls
    // during PLAYBACK and nothing calls while paused. So a scrub used to fire the seek,
    // poll a clock that could never move, time out after 2s, and leave the canvas holding
    // the old frame: params updated at the new p while the FOOTAGE didn't (Daniel, B501 —
    // "scrubbing updates output based on the keyframed slice position but not the position
    // in the timeline"; and hitting play snapped everything to the real position at once).
    seekSettled(t) {
      this.seek(t);
      return new Promise((resolve) => {
        const deadline = performance.now() + 2000;
        const poll = () => {
          receiver.refreshFrame();   // pump: paint whatever the socket has delivered
          if (Math.abs((receiver.pts || 0) - t) < 0.12 || performance.now() > deadline) { resolve(); return; }
          setTimeout(poll, 16);
        };
        poll();
      });
    },
    setRate(r) {
      state.rate = r || 1;
      if (!state.paused) FoldNativeVideo.setRate({ rate: state.rate }).catch(() => {});
    },
    play() {
      state.paused = false;
      FoldNativeVideo.resume().catch(() => {});
      FoldNativeVideo.setRate({ rate: state.rate }).catch(() => {});
    },
    pause() {
      state.paused = true;
      FoldNativeVideo.pause().catch(() => {});
    },
  };
}

// One frame at `sec` as a decoded <img>, straight from AVAssetImageGenerator. The ONLY
// way to get a still while the native decode owns the clip — seeking the parked `<video>`
// instead would wake a second 4K decode session and starve both (Daniel, B500).
export async function nativeStillAt(sec, maxPx = 1280, tolerance = 0.05) {
  try {
    const res = await FoldNativeVideo.frameAt({ time: Math.max(0, sec), maxSize: maxPx, tolerance });
    if (!res?.dataUrl) return null;
    const img = new Image();
    img.src = res.dataUrl;
    await img.decode().catch(() => {});
    return img.naturalWidth ? img : null;
  } catch { return null; }
}

// Bounded stills for the EDITOR while motion staging is on — the native half of the
// stageSource seam. AVAssetImageGenerator on the same asset: a decode burst per
// scrub-settle, no second player, which is the whole reason staging survives one decode.
// Last decode failure and how many there have been, published so a stalled 4K clip can say why
// instead of presenting as inert UI (B570). Cleared by the first successful frame.
let lastDecodeError = null, decodeErrors = 0;
export function getNativeDecodeError() { return lastDecodeError ? { message: lastDecodeError, count: decodeErrors } : null; }
function noteDecode(msg) {
  if (!msg) { lastDecodeError = null; decodeErrors = 0; return; }
  lastDecodeError = msg; decodeErrors += 1;
  if (decodeErrors === 1 || decodeErrors % 20 === 0) console.warn(`[fold] native decode failed (${decodeErrors}): ${msg}`);
}

export function createNativeStageSource(env, { cap = 2048 } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let busy = false, next = null, painted = 0, live = false;

  function paint(img, w, h) {
    const s = Math.min(1, cap / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    ctx.drawImage(img, 0, 0, cw, ch);
    painted++;
  }

  function followLive() {
    const src = env.nativeVideo?.frameSource?.();
    if (!src || !src.width) return false;
    paint(src, src.width, src.height);
    return true;
  }

  // THE SWALLOWED FAILURE (B570). This catch discarded every decode error, so a `frameAt` that
  // rejected — a timeout, a memory failure, an unsupported profile — presented as a scrubber that
  // simply does nothing. **A dead control with no error looks identical to a dead control with a
  // reason**, and that is precisely the state Daniel hit: a 4K clip where the scrubber, the
  // transport and the still-mode mini-timeline were all inert, in every mode, with nothing
  // anywhere to say why.
  //
  // The fallback behaviour is still right (holding the last frame beats a black canvas), so the
  // catch stays — but the reason is now recorded and PUBLISHED. It reaches the source note and
  // rides the exported report, because a console-only diagnostic on a Capacitor device is a
  // diagnostic nobody can collect.
  async function seekTo(sec) {
    if (!live) return;
    if (busy) { next = sec; return; }
    busy = true;
    try {
      const res = await FoldNativeVideo.frameAt({ time: Math.max(0, sec), maxSize: cap });
      if (res?.dataUrl) {
        const img = new Image();
        img.src = res.dataUrl;
        await img.decode().catch(() => {});
        if (img.naturalWidth) { paint(img, img.naturalWidth, img.naturalHeight); noteDecode(null); }
        else noteDecode('frameAt returned an image that would not decode');
      } else {
        noteDecode(`frameAt returned no image at ${sec.toFixed(2)}s`);
      }
    } catch (e) {
      noteDecode(e?.message || String(e));
    }
    finally { busy = false; }
    if (next != null) { const n = next; next = null; seekTo(n); }
  }

  return {
    begin() { live = true; followLive(); },
    end() { live = false; next = null; },
    seekTo,
    followLive,
    frameSource: () => canvas,
    get active() { return live; },
    get ready() { return painted > 0; },
  };
}

// The source itself. Returns null (never throws) when native isn't usable, so the
// caller falls straight through to the <video> path.
// ⚠️ HOW LONG TO WAIT FOR THE FIRST NATIVE FRAME — 2026-08-19, and this was a REAL FAILURE.
//
// This was a flat 8000ms. A 1.25GB / 6:39 4K clip does not produce its first frame inside eight
// seconds: AVPlayer has to open the asset and parse an index proportional to the clip's length
// before it can decode anything. So the deadline expired, the decode "failed", and the app fell
// back to <video> — **which is the DOUBLE-DECODE path** (our <video> plus the external view's own
// copy of the staged file), the configuration every memory guard in this codebase exists to avoid.
// Two GL context losses followed within three minutes, with 5GB of device memory still free.
//
// **A fixed deadline is the wrong shape**: it is a bet that startup cost does not scale with the
// input, and here it plainly does. Scaling it is not the same as just raising it — a genuinely
// dead decode must still fall back FAST on a small clip, which is the case the deadline was
// written for (B499's looper attached to an item that never played).
//
// **THE RISK HERE IS ONE-SIDED, AND THE NUMBERS FOLLOW FROM THAT.** Waiting too long costs a slow
// load. Falling back too early costs the double-decode path, which is the one that crashes. So on
// a large clip, be generous: 20ms per megabyte, floored at the original 8s and capped at 40s.
//
// **The 8s floor is deliberate**: a small clip's behaviour is unchanged, so this cannot regress the
// path that has always worked. Only clips past ~400MB see a different deadline at all.
//
// ⚠️ THE 20ms/MB IS A FIRST ESTIMATE, NOT A MEASUREMENT. We know 8s was too short for 1.25GB and we
// do not know what would have been enough. **That is why the timeout message now names the deadline
// it used** — a second failure reports `within 23904ms` and tells us the real requirement, instead
// of repeating the same ambiguity at a different number.
function firstFrameDeadline(bytes) {
  const perMB = 20;                                     // ms of grace per megabyte
  const grace = Math.round((bytes / (1024 * 1024)) * perMB);
  return Math.min(40000, Math.max(8000, grace));
}

export async function createNativeVideoSource(env, blob, { name, loop = true, onProgress } = {}) {
  if (!nativeVideoAvailable() || !blob) return null;
  // pending = the seek target the clock reports until a painted frame catches up to it
  // ({ t, frames, until } — see `get time()`)
  // loops/rewinds/suppressed = who wraps the clip at the loop boundary, and how often
  // each mechanism actually fired (see `rewind` and the loopStall report)
  const state = { paused: false, rate: 1, seekUntil: 0, pending: null, loops: !!loop, rewinds: 0, suppressed: 0, suppressWhy: '' };
  let receiver = null;
  // STAGE BREADCRUMB — every failure here falls back to <video>, which is safe but silent.
  // Naming the stage turns "it fell back" into "it fell back HERE" (the B498 iPad round
  // cost a whole verification pass to narrow down).
  let stage = 'upload';
  // the fan-out's own counters, refreshed by `pollFanOut()` on the report cadence — the bridge
  // call is async and the report builder is not, so the report reads the last poll
  let lastFanOut = null, fanOutBusy = false;
  // ⚠️ B688 — WHERE DID THE TIME GO. A known-good FHD clip failed to attach with
  // `no native frames within 12678ms`, and the report could not say whether that was a slow upload,
  // a slow plugin start, or a decoder that genuinely never produced — three different causes with
  // three different fixes. The deadline covers only the LAST of the three, so without the split
  // the number is unreadable. Raising the deadline again without this would be a guess.
  const tStart = Date.now();
  let uploadMs = 0, startMs = 0, firstFrameMs = 0;
  try {
    const path = await uploadClip(blob, name, onProgress);
    uploadMs = Date.now() - tStart;
    stage = 'plugin start';
    // startPaused parks the player natively on the tick that pushes the first frame, which
    // is the only place the window can actually be closed. The JS pause below stays as the
    // fallback for a webview running ahead of an older plugin build.
    // loopBySeek picks WHICH loop mechanism the plugin uses — read here rather than per frame,
    // which is why the flag says to reload the clip (see perf-flags.js for the measurement).
    const { port } = await FoldNativeVideo.start({
      path, loop, startPaused: true, loopBySeek: !!perfFlags.loopBySeek,
    });
    startMs = Date.now() - tStart - uploadMs;
    console.info(`[fold] native video: decode started, serving port ${port || 8900}`);
    stage = 'frame socket';
    // the preview canvas is bounded hard: nothing samples it for output any more (the
    // engine takes planes directly), and every consumer that still reads it — the source
    // panel, a freeze-frame — pays a readback per draw, so keeping it small is free detail
    receiver = createNativeFrameReceiver({ port: port || 8900, cap: PREVIEW_CAP });
    // the MAIN path insists on a real frame: if the decode is dead we want the <video>
    // fallback, not a black source (see the requireFrame note in native-frame-receiver)
    const deadline = firstFrameDeadline(blob?.size || 0);
    const tFrame = Date.now();
    try {
      await receiver.start({ requireFrame: true, timeout: deadline });
    } finally { firstFrameMs = Date.now() - tFrame; }
    console.info('[fold] native video: first frame received');
    // A FRESHLY LOADED CLIP IS PARKED, exactly like a <video> that has loaded and never
    // been played (B595). The plugin's start() calls play() so a first frame can arrive —
    // which is what makes the requireFrame assertion above mean anything — but nothing
    // ever paused it again, so `state.paused` read false while the transport UI showed a
    // parked clip. The flag and the player disagreed from the moment of load.
    //
    // Invisible until something rendered the stream on its own clock: starting a
    // broadcast joins the external view to the socket, it draws every arriving frame,
    // and the clip plays with the app still showing "paused" (Daniel, B594). A scrub
    // never fixed it because a seek does not pause; one play/pause toggle did, because
    // that is the first call that ever reaches the plugin's pause().
    state.paused = true;
    await FoldNativeVideo.pause().catch(() => {});
    pushLoopCacheBudget();   // the plugin's own default is 64MB; make the panel authoritative
  } catch (e) {
    // the STAGE is the whole diagnostic value here (upload / plugin start / frame socket
    // point at three completely different faults), and until B597 it only ever reached the
    // console — which on a Capacitor device is nowhere
    // the three-way split is the whole point — see the note above `tStart`
    lastStartError = `failed at "${stage}": ${e?.message || e}`
      + ` · upload ${uploadMs}ms · plugin start ${startMs}ms · first frame ${firstFrameMs}ms`
      + ` · clip ${Math.round((blob?.size || 0) / (1024 * 1024))}MB`;
    console.warn(`[fold] native video source unavailable at "${stage}", using <video>:`, e?.message || e);
    try { receiver?.stop(); } catch { /* not started */ }
    try { await FoldNativeVideo.stop(); } catch { /* nothing running */ }
    return null;
  }
  lastStartError = null;
  // The AVPlayer decode. On iOS this runs ALONGSIDE the source <video>, which the app deliberately
  // keeps loaded for authoring — two decoders of one clip, by design, and previously counted by
  // nothing (session audit 2026-08-19).
  let nativeToken = acquireSession('decode', `native decode: ${name || 'clip'}`);
  const clock = createNativeClock(receiver, state);

  // WHERE THE TIME GOES. Every field here exists because a guess about it cost a device
  // round: `in/s` separates the wire from the GPU, `engine` is the per-frame source
  // upload (the 162ms-at-4K cross-context copy that Build 504 replaced with a planar
  // upload), and `preview` is the source panel's readback — the one remaining place the
  // old cost can still hide. Dims are the SOURCE's, and the cap is the one in force.
  let lastReport = performance.now(), upMs = 0, ups = 0, pvMs = 0, pvs = 0;
  let lastDims = { w: 0, h: 0 };
  function report() {
    const now = performance.now();
    const dt = (now - lastReport) / 1000;
    if (dt < 3) return;
    lastReport = now;
    const s = receiver.takeStats();
    const cap = sourceCap();
    console.info(`[fold] native video: ${(s.arrived / dt).toFixed(1)} in/s · ${(s.painted / dt).toFixed(1)} painted/s`
      + ` · engine ${(ups ? upMs / ups : 0).toFixed(1)}ms · preview ${(pvs ? pvMs / pvs : 0).toFixed(1)}ms`
      + ` · ${lastDims.w}×${lastDims.h}${cap ? ` (capped ${cap})` : ''}`);
    upMs = 0; ups = 0; pvMs = 0; pvs = 0;
  }

  return {
    kind: 'native-video',
    clock,
    port: receiver.port,
    frameSource: () => receiver.frameSource(),
    // THE ENGINE'S SOURCE. Handing over the planes (rather than the preview canvas) is
    // what deletes the cross-context readback; the cap rides along so the source-detail
    // toggle takes effect on the next frame instead of the next clip load. The preview
    // engine gets this reader; every OTHER engine (output bus, PiP, the external view)
    // makes its own, so each tracks its own last-seen frame.
    planeProvider: (() => {
      const read = receiver.planeReader();
      return () => {
        const f = read();
        if (f) lastDims = { w: f.width, h: f.height };
        return f;
      };
    })(),
    planeReader: () => receiver.planeReader(),
    get cap() { return sourceCap(); },
    // TOTAL frames the socket has delivered. The frame-cost panel divides this over time to show
    // a live wire rate, which is the one number that separates "the decode stopped" from "the
    // renderer stopped" — a distinction that cost a round of guessing on the iPad playback
    // regression, since a stalled decode still leaves the render loop reporting a healthy 60fps.
    get framesArrived() { return receiver.framesArrived; },
    // THE CONTROL FOR THE EXTERNAL VIEW'S BURST (B579). The app and the view are two clients on
    // the SAME socket. If the app sees even arrivals while the view sees a 2ms median, the
    // producer and the native fan-out are exonerated and the fault is the view's own main thread —
    // which is the difference between a fix we can make in JS and a Class 2 investigation with
    // Xcode attached. Consumes and resets, so only the report should call it.
    arrivalSpread: () => receiver.arrivalSpread?.() || null,
    // WHY IT STOPPED, from BOTH ends of the wire (B584).
    //
    // `socketState()` is this client's own view (open/closed, how long since a frame). `fanOut` is
    // the NATIVE server's account, polled over the Capacitor bridge — deliberately not over the
    // frame socket, so it still answers when that socket is the thing failing. The pair that
    // settles it is per-client `offered` vs `taken`: **equal counts with a stalled picture means
    // the wire is fine and the fault is ours; a growing `skipped` means the fan-out is passing us
    // over; a bumped `reaped` means we were dropped and are not coming back on our own.**
    socketState: () => receiver.socketState?.() || null,
    // WHO WRAPPED THE CLIP, alongside the receiver's account of what crossed the wire.
    // `wraps` is the pts discontinuity as seen by the frames themselves; `rewinds` and
    // `suppressed` are the two ways OUR playback tick can reach the same boundary. The
    // three together are what makes every outcome readable: suppressed ≈ wraps with the
    // hold gone confirms the redundant seek was it; rewinds ≈ wraps with the hold still
    // there means the seek fires but is not the cause; both 0 means our rewind never ran
    // and the hold is somewhere else entirely.
    loopStall: () => ({
      ...(receiver.loopStall?.() || {}),
      rewinds: state.rewinds,
      suppressed: state.suppressed,
      why: state.suppressWhy || (state.loops ? 'no loop boundary reached yet' : 'the native player is not looping'),
    }),
    get fanOut() { return lastFanOut; },
    pollFanOut: () => {
      if (fanOutBusy) return;
      fanOutBusy = true;
      FoldNativeVideo.frameStats()
        .then((s) => { lastFanOut = s || null; })
        .catch(() => { lastFanOut = null; })
        .finally(() => { fanOutBusy = false; });
    },
    refreshFrame: () => { receiver.refreshFrame(); report(); },
    noteUpload: (ms) => { upMs += ms; ups++; },
    notePreview: (ms) => { pvMs += ms; pvs++; },
    get width() { return lastDims.w || receiver.frameSource().width; },
    get height() { return lastDims.h || receiver.frameSource().height; },
    // AWAITABLE, because the teardown purges the staging directory and the next thing the
    // caller does may be staging a new clip into it (the Loop Builder bake). See
    // FileUploadServer.purge for the race this closes from the other side.
    stop() {
      try { receiver.stop(); } catch { /* already closed */ }
      releaseSession(nativeToken); nativeToken = 0;
      return FoldNativeVideo.stop().catch(() => {});
    },
  };
}
