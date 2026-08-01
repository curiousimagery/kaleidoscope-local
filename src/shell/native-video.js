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

const FoldNativeVideo = registerPlugin('FoldNativeVideo');

const UPLOAD_SLICE = 4 * 1024 * 1024;   // 4MB per socket message: bounded memory, few round trips

// Diagnostics knob (settings → diagnostics is the eventual home; localStorage for now).
// 0 = native resolution. Caps the RGB canvas the ENGINE uploads from — see the note in
// native-frame-receiver.js. Set to e.g. 1920 to A/B whether the cross-context 4K texture
// copy is what pins the frame rate.
function sourceCap() {
  try { return Math.max(0, parseInt(localStorage.getItem('foldNativeVideoCap') || '0', 10) || 0); }
  catch { return 0; }
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
    get time() { return receiver.pts || 0; },
    get duration() { return receiver.duration || 0; },
    get paused() { return state.paused; },
    // native seeks are not observable as a flag; treat the settle window as "seeking"
    // so callers that skip work mid-seek (perform's tick, output-engine) still do
    get seeking() { return performance.now() < state.seekUntil; },
    get rate() { return state.rate; },
    seek(t) {
      state.seekUntil = performance.now() + 120;
      FoldNativeVideo.seek({ time: Math.max(0, t) }).catch(() => {});
    },
    // resolve once a frame at (or past) the target has actually been PAINTED — the
    // scrub path needs the texture to be right before it renders, not just the request sent
    seekSettled(t) {
      this.seek(t);
      return new Promise((resolve) => {
        const deadline = performance.now() + 2000;
        const poll = () => {
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
export async function nativeStillAt(sec, maxPx = 1280) {
  try {
    const res = await FoldNativeVideo.frameAt({ time: Math.max(0, sec), maxSize: maxPx });
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
        if (img.naturalWidth) paint(img, img.naturalWidth, img.naturalHeight);
      }
    } catch { /* fall back to whatever the canvas holds */ }
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
export async function createNativeVideoSource(env, blob, { name, loop = true, onProgress } = {}) {
  if (!nativeVideoAvailable() || !blob) return null;
  const state = { paused: false, rate: 1, seekUntil: 0 };
  let receiver = null;
  // STAGE BREADCRUMB — every failure here falls back to <video>, which is safe but silent.
  // Naming the stage turns "it fell back" into "it fell back HERE" (the B498 iPad round
  // cost a whole verification pass to narrow down).
  let stage = 'upload';
  try {
    const path = await uploadClip(blob, name, onProgress);
    stage = 'plugin start';
    const { port } = await FoldNativeVideo.start({ path, loop });
    console.info(`[fold] native video: decode started, serving port ${port || 8900}`);
    stage = 'frame socket';
    receiver = createNativeFrameReceiver({ port: port || 8900, cap: sourceCap() });
    await receiver.start();     // resolves on the first frame — proves decode + socket
    console.info('[fold] native video: first frame received');
  } catch (e) {
    console.warn(`[fold] native video source unavailable at "${stage}", using <video>:`, e?.message || e);
    try { receiver?.stop(); } catch { /* not started */ }
    try { await FoldNativeVideo.stop(); } catch { /* nothing running */ }
    return null;
  }
  const clock = createNativeClock(receiver, state);

  // WHERE THE TIME GOES. Daniel's B499 run: frames arrive at a FIXED low cadence that
  // doesn't change with playback rate, which says a throughput wall rather than a clock
  // problem — but "socket" and "GPU" both fit that shape, and guessing has already cost
  // two rounds. So report the split: frames in off the wire, frames actually painted, the
  // YUV→RGB blit, and the engine's upload out of that canvas (the 4K cross-context copy).
  let lastReport = performance.now(), upMs = 0, ups = 0;
  function report() {
    const now = performance.now();
    const dt = (now - lastReport) / 1000;
    if (dt < 3) return;
    lastReport = now;
    const s = receiver.takeStats();
    const cap = sourceCap();
    console.info(`[fold] native video: ${(s.arrived / dt).toFixed(1)} in/s · ${(s.painted / dt).toFixed(1)} painted/s`
      + ` · blit ${s.paintMs.toFixed(1)}ms · engine upload ${(ups ? upMs / ups : 0).toFixed(1)}ms`
      + ` · ${receiver.frameSource().width}×${receiver.frameSource().height}${cap ? ` (capped ${cap})` : ''}`);
    upMs = 0; ups = 0;
  }

  return {
    kind: 'native-video',
    clock,
    port: receiver.port,
    frameSource: () => receiver.frameSource(),
    refreshFrame: () => { receiver.refreshFrame(); report(); },
    noteUpload: (ms) => { upMs += ms; ups++; },
    get width() { return receiver.frameSource().width; },
    get height() { return receiver.frameSource().height; },
    stop() {
      try { receiver.stop(); } catch { /* already closed */ }
      FoldNativeVideo.stop().catch(() => {});
    },
  };
}
