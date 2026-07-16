// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// conduit/recorder.js
//
// The record-to-disk sink. Two engines, one sink API:
//
// PRIMARY — WebCodecs: each bus frame's canvas is wrapped in a VideoFrame and
// fed to a hardware VideoEncoder muxed into mp4 (the exact pipeline the host
// app's offline video export runs, live). No canvas.captureStream, no
// MediaRecorder — which is the point: WebKit's captureStream ticks a live
// canvas at a fraction of its paint rate and freezes mid-take, and Chromium's
// MediaRecorder can only produce WebM. Mic audio rides an AudioWorklet tap →
// AudioEncoder (AAC where the platform encodes it, Opus otherwise) muxed into
// the same file, timestamped against the same session clock as the video so
// A/V stay in sync (the muxer's cross-track-offset normalizes the start).
//
// FALLBACK — MediaRecorder over a captureStream'd canvas (the original sink).
// Used wholesale when WebCodecs can't carry the session (no VideoEncoder, no
// encodable codec at this size, or a mic take on a browser without a usable
// AudioEncoder — a take should never silently come back video-only).
//
// Frame orientation is declared by frame.topDown (see engine-adapter.js); the
// producer usually hands us its top-down 2D capture canvas (frame.canvas) so
// no pixels are read back here at all. Sessions are single-use: start() builds
// one, stop() finishes it and hands the file to the injected `save`.
//
// Memory note: like the offline exporter, the mp4 is assembled in memory
// (ArrayBufferTarget); a long 4K take is hundreds of MB. Streaming to OPFS is
// the tracked upgrade if that ceiling is ever hit in practice.

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { pickVideoCodec, pickAudioCodec } from './encode.js';

export function webCodecsRecordingSupported() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

// Prefer MP4 where the browser's MediaRecorder supports it (Safari does), else
// fall back to WebM (Chromium/Firefox). Empty string = let MediaRecorder choose.
function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

function extFor(mime) {
  return mime && mime.startsWith('video/mp4') ? 'mp4' : 'webm';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoke after the download has had a chance to start
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------------------------------------------------------------------------
// The mic tap: an AudioWorklet that batches ~25 messages/s of raw Float32
// planes back to the main thread (small enough for latency, big enough that
// message traffic is negligible). Inlined as a Blob URL so the conduit stays
// a plain package with no asset-path coupling to its host app. A 'flush'
// message posts whatever partial batch remains (the take's last ~40ms).
const MIC_TAP_SRC = `registerProcessor('conduit-mic-tap', class extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = []; this.frames = 0;
    this.port.onmessage = () => {
      if (this.chunks.length) this.port.postMessage(this.chunks);
      this.chunks = []; this.frames = 0;
    };
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length && input[0].length) {
      this.chunks.push(input.map((c) => c.slice(0)));
      this.frames += input[0].length;
      if (this.frames >= 1200) {
        this.port.postMessage(this.chunks);
        this.chunks = []; this.frames = 0;
      }
    }
    return true;
  }
});`;

// Wire a mic track into an AudioWorklet tap. onData receives batches of
// [perChunk: [perChannel: Float32Array]]. Returns null-ish failure by THROWING
// (the caller treats any audio setup failure as "fall back to MediaRecorder").
async function startMicTap(track, onData) {
  // 48kHz keeps Opus eligible (it only encodes at 48k); fall back to the
  // device default if the context refuses the rate.
  let ctx;
  try { ctx = new AudioContext({ sampleRate: 48000 }); } catch { ctx = new AudioContext(); }
  try {
    try { await ctx.resume(); } catch { /* not user-gesture-bound here */ }
    const url = URL.createObjectURL(new Blob([MIC_TAP_SRC], { type: 'application/javascript' }));
    try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const node = new AudioWorkletNode(ctx, 'conduit-mic-tap', { numberOfInputs: 1, numberOfOutputs: 0 });
    node.port.onmessage = (e) => onData(e.data);
    src.connect(node);
    return {
      sampleRate: ctx.sampleRate,
      async stop() {
        try { node.port.postMessage('flush'); } catch { /* port gone */ }
        await new Promise((r) => setTimeout(r, 80));   // let the flush round-trip
        try { src.disconnect(); node.disconnect(); } catch { /* already down */ }
        try { await ctx.close(); } catch { /* already closed */ }
      },
    };
  } catch (e) {
    try { await ctx.close(); } catch { /* never opened */ }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// The WebCodecs session. Returns { publish, stop } or null when this browser /
// this take can't ride WebCodecs (caller falls back to MediaRecorder).
async function startWebCodecsSession({ w, h, audioTrack, onDone }) {
  if (!webCodecsRecordingSupported()) return null;

  const vcfg = await pickVideoCodec(w, h, 30);
  if (!vcfg) return null;

  // Audio is decided BEFORE the muxer exists (tracks are declared at
  // construction). Any audio failure rejects the whole WebCodecs session —
  // a mic take must never silently come back video-only.
  let mic = null, acfg = null, channels = 1;
  let pendingAudio = [];                    // batches that arrive before the encoder is up
  let onAudioData = (batch) => pendingAudio.push(batch);
  if (audioTrack) {
    try {
      mic = await startMicTap(audioTrack, (batch) => onAudioData(batch));
      const s = audioTrack.getSettings?.() || {};
      channels = s.channelCount === 2 ? 2 : 1;
      acfg = await pickAudioCodec(mic.sampleRate, channels);
      if (!acfg) { await mic.stop(); return null; }
    } catch (e) {
      console.warn('[conduit] mic tap unavailable, falling back to MediaRecorder:', e);
      return null;
    }
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: vcfg.muxerCodec, width: w, height: h, frameRate: 30 },
    ...(acfg ? { audio: { codec: acfg.muxerCodec, sampleRate: mic.sampleRate, numberOfChannels: channels } } : {}),
    fastStart: 'in-memory',
    // live takes are VFR on a wall clock: both tracks share the session clock
    // and the muxer shifts them together so the earliest sample lands at 0
    firstTimestampBehavior: 'cross-track-offset',
  });

  let sessionError = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { sessionError = e; },
  });
  // realtime latency mode: the encoder paces itself for a live feed instead of
  // buffering for quality; the explicit bitrate (~0.2 bits/px/frame at 30fps,
  // the fallback path's long-standing target) keeps fidelity up.
  venc.configure({
    codec: vcfg.codec, width: w, height: h,
    bitrate: Math.min(40_000_000, Math.round(w * h * 6)),
    framerate: 30, latencyMode: 'realtime',
  });

  let aenc = null;
  const t0 = performance.now();
  let audioClockUs = null;   // sample-accurate once anchored to the session clock
  if (acfg) {
    aenc = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => { sessionError = e; },
    });
    aenc.configure({ codec: acfg.codec, sampleRate: mic.sampleRate, numberOfChannels: channels, bitrate: acfg.bitrate });
    const rate = mic.sampleRate;
    onAudioData = (batch) => {
      if (!aenc || aenc.state !== 'configured' || sessionError) return;
      let frames = 0;
      for (const chunk of batch) frames += chunk[0].length;
      if (!frames) return;
      // anchor the first batch to the session clock, backdated by its own
      // duration (those samples happened BEFORE this message arrived)
      if (audioClockUs === null) {
        audioClockUs = Math.max(0, (performance.now() - t0) * 1000 - (frames / rate) * 1e6);
      }
      // assemble one planar buffer with exactly `channels` planes (a mono
      // source fills a stereo config by duplication; extra planes drop)
      const data = new Float32Array(frames * channels);
      let off = 0;
      for (const chunk of batch) {
        const n = chunk[0].length;
        for (let c = 0; c < channels; c++) {
          data.set(chunk[Math.min(c, chunk.length - 1)], c * frames + off);
        }
        off += n;
      }
      const ad = new AudioData({
        format: 'f32-planar', sampleRate: rate,
        numberOfFrames: frames, numberOfChannels: channels,
        timestamp: audioClockUs, data,
      });
      audioClockUs += (frames / rate) * 1e6;
      try { aenc.encode(ad); } finally { ad.close(); }
    };
    // drain anything the tap delivered while the encoder was being built
    const early = pendingAudio; pendingAudio = [];
    for (const b of early) onAudioData(b);
  }

  let lastKeyUs = -Infinity;
  let flipBuf = null;
  let dropped = 0;

  async function finish() {
    if (mic) await mic.stop();   // posts the tail flush → onAudioData → encode
    try { if (aenc && aenc.state === 'configured') await aenc.flush(); } catch { /* mid-error */ }
    try { if (venc.state === 'configured') await venc.flush(); } catch { /* mid-error */ }
    try {
      muxer.finalize();
      onDone(new Blob([muxer.target.buffer], { type: 'video/mp4' }), 'mp4');
      if (sessionError) console.warn('[conduit] recording had encoder errors (take saved up to the failure):', sessionError);
    } catch (e) {
      console.warn('[conduit] recording finalize failed — the take is lost:', e);
    }
    try { venc.close(); } catch { /* closed */ }
    try { aenc?.close(); } catch { /* closed */ }
    if (dropped) console.info(`[conduit] recorder dropped ${dropped} frames to encoder backpressure`);
  }

  return {
    publish(frame) {
      if (sessionError || venc.state !== 'configured') return;
      if (frame.w !== w || frame.h !== h) return;          // bus resized mid-take: skip
      if (venc.encodeQueueSize > 4) { dropped++; return; } // freshness over completeness, live
      const ts = Math.round((performance.now() - t0) * 1000);
      let vf;
      if (frame.canvas) {
        vf = new VideoFrame(frame.canvas, { timestamp: ts });
      } else {
        // raw-pixel producer (no capture canvas): VideoFrame wants top-down rows
        let px = frame.pixels;
        if (!frame.topDown) {
          const stride = w * 4;
          if (!flipBuf || flipBuf.length < stride * h) flipBuf = new Uint8Array(stride * h);
          for (let y = 0; y < h; y++) {
            flipBuf.set(px.subarray((h - 1 - y) * stride, (h - y) * stride), y * stride);
          }
          px = flipBuf;
        }
        vf = new VideoFrame(px, { format: 'RGBA', codedWidth: w, codedHeight: h, timestamp: ts });
      }
      const key = ts - lastKeyUs >= 2_000_000;
      if (key) lastKeyUs = ts;
      try { venc.encode(vf, { keyFrame: key }); } finally { vf.close(); }
    },
    stop() { finish(); },
  };
}

// ---------------------------------------------------------------------------
// The MediaRecorder session — the original sink, kept intact as the fallback.
// Draws each frame into a hidden canvas and records its captureStream.
function startMediaRecorderSession({ w, h, audioTrack, onDone }) {
  const mime = pickMime();
  if (mime === null) throw new Error('recording is not supported in this browser (no WebCodecs, no MediaRecorder)');

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  let imgData = ctx.createImageData(w, h);

  const stream = canvas.captureStream();   // tracks the canvas as it's drawn each frame
  if (audioTrack) { try { stream.addTrack(audioTrack); } catch { /* video-only */ } }
  // Quality: MediaRecorder's default bitrate for a canvas stream is low → heavily
  // compressed footage. Target ~0.2 bits/pixel/frame at 30fps (≈ w·h·6), capped so
  // the real-time encoder can keep up. Much better fidelity than the default.
  const opts = { videoBitsPerSecond: Math.min(40_000_000, Math.round(w * h * 6)) };
  if (audioTrack) opts.audioBitsPerSecond = 128_000;
  if (mime) opts.mimeType = mime;
  const recorder = new MediaRecorder(stream, opts);
  const finalMime = recorder.mimeType || mime || 'video/webm';
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  // stream teardown happens INSIDE onstop — killing the tracks synchronously in
  // stop() raced the encoder on WebKit and the final chunks never arrived
  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    onDone(new Blob(chunks, { type: finalMime }), extFor(finalMime));
  };
  recorder.start();

  return {
    publish(frame) {
      const { pixels, w: fw, h: fh, topDown, canvas: src } = frame;
      if (canvas.width !== fw || canvas.height !== fh) {
        canvas.width = fw; canvas.height = fh;
        imgData = ctx.createImageData(fw, fh);
      }
      // Fast path: the producer already has the frame top-down in a 2D canvas — GPU
      // blit it straight into ours (no readback bytes, no putImageData copy).
      if (src) { ctx.drawImage(src, 0, 0, fw, fh); return; }
      const stride = fw * 4;
      const data = imgData.data;
      if (topDown) {
        data.set(pixels);                    // already top-left order — one copy, no flip
      } else {
        for (let y = 0; y < fh; y++) {
          const s = (fh - 1 - y) * stride;   // bottom-up FBO row → top-down canvas row
          data.set(pixels.subarray(s, s + stride), y * stride);
        }
      }
      ctx.putImageData(imgData, 0, 0);
    },
    stop() {
      if (recorder.state !== 'inactive') recorder.stop();
      else stream.getTracks().forEach((t) => t.stop());
    },
  };
}

// ---------------------------------------------------------------------------
// `save(blob, filename)` (optional) replaces the <a download> click — REQUIRED on
// hosts where download-navigation is a silent no-op (Capacitor WKWebView: Daniel's
// iPad takes vanished without a trace); the app passes its host-aware saver (the
// iOS share sheet / Electron dialog / browser download fallback).
export function createRecorderSink({ filenamePrefix = 'fold-live', save = null } = {}) {
  let session = null;
  let recording = false;

  const saveTake = (blob, ext) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    (save || downloadBlob)(blob, `${filenamePrefix}-${stamp}.${ext}`);
  };

  return {
    id: 'disk',
    get recording() { return recording; },
    get supported() { return webCodecsRecordingSupported() || pickMime() !== null; },

    // bus calls this every frame; a no-op until a recording session is started.
    publish(frame) {
      if (recording && session) session.publish(frame);
    },

    // begin a session at w×h. `audioTrack` (optional) — the output panel's audio
    // picker acquires the chosen mic and hands its track here. Async: codec
    // discovery + the mic tap are awaited before the first frame is accepted.
    async start(w, h, audioTrack = null) {
      if (recording) return;
      let s = null;
      try {
        s = await startWebCodecsSession({ w, h, audioTrack, onDone: saveTake });
      } catch (e) {
        console.warn('[conduit] WebCodecs recorder failed to start, falling back to MediaRecorder:', e);
      }
      if (!s) s = startMediaRecorderSession({ w, h, audioTrack, onDone: saveTake });
      session = s;
      recording = true;
    },

    // end the session → the active engine flushes/finalizes → the file saves
    // through the host-aware path.
    stop() {
      recording = false;
      const s = session;
      session = null;
      s?.stop();
    },
  };
}
