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
// Encode ONE frame through a throwaway encoder and report whether its output
// carried `meta.decoderConfig` with a description. isConfigSupported is NOT
// enough: WebKit accepts `latencyMode:'realtime'` but then emits chunks with
// no decoderConfig at all — the muxer can't build the avcC box and finalize
// dies ("null is not an object … decoderConfig.colorSpace", Daniel's iPad
// no-file take). Only an actual encode tells the truth. ~one encoder init at
// record start; the verdict is cached per config for the session.
const probeCache = new Map();
async function encoderYieldsConfig(cfg) {
  const key = `${cfg.codec}|${cfg.width}x${cfg.height}|${cfg.latencyMode || ''}`;
  if (probeCache.has(key)) return probeCache.get(key);
  const verdict = await new Promise((resolve) => {
    let enc = null, done = false;
    const settle = (v) => {
      if (done) return;
      done = true;
      try { enc?.close(); } catch { /* closed */ }
      resolve(v);
    };
    try {
      enc = new VideoEncoder({
        output: (chunk, meta) => settle(!!(meta && meta.decoderConfig && meta.decoderConfig.description)),
        error: () => settle(false),
      });
      enc.configure(cfg);
      const cv = document.createElement('canvas');
      cv.width = cfg.width; cv.height = cfg.height;
      cv.getContext('2d').fillRect(0, 0, 2, 2);
      const vf = new VideoFrame(cv, { timestamp: 0 });
      enc.encode(vf, { keyFrame: true });
      vf.close();
      enc.flush().catch(() => settle(false));
      setTimeout(() => settle(false), 3000);
    } catch { settle(false); }
  });
  probeCache.set(key, verdict);
  return verdict;
}

// The WebCodecs session. Returns { publish, stop } or null when this browser /
// this take can't ride WebCodecs (caller falls back to MediaRecorder).
// onDone(blob, ext) on a finalized take; onError(e) when the take is lost.
async function startWebCodecsSession({ w, h, audioTrack, onDone, onError }) {
  if (!webCodecsRecordingSupported()) return null;

  const vcfg = await pickVideoCodec(w, h, 30);
  if (!vcfg) return null;
  const bitrate = Math.min(40_000_000, Math.round(w * h * 6));
  const baseCfg = { codec: vcfg.codec, width: w, height: h, bitrate, framerate: 30 };

  // realtime latency mode paces the encoder for a live feed — used only where
  // a PROVING encode shows the metadata survives it (Blink: yes; WebKit: no).
  // If even the plain config can't prove itself, this browser's WebCodecs
  // can't feed the muxer — fall back to MediaRecorder wholesale.
  let latency = {};
  if (await encoderYieldsConfig({ ...baseCfg, latencyMode: 'realtime' })) {
    latency = { latencyMode: 'realtime' };
  } else if (!(await encoderYieldsConfig(baseCfg))) {
    return null;
  }

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
  // belt over the probe's braces: only hand the muxer metadata that actually
  // carries a decoderConfig, and never let a muxer throw escape the callback
  const venc = new VideoEncoder({
    output: (chunk, meta) => {
      try { muxer.addVideoChunk(chunk, meta && meta.decoderConfig ? meta : undefined); }
      catch (e) { sessionError = sessionError || e; }
    },
    error: (e) => { sessionError = e; },
  });
  // explicit bitrate (~0.2 bits/px/frame at 30fps, the fallback path's
  // long-standing target) keeps fidelity up in realtime mode
  venc.configure({ ...baseCfg, ...latency });

  let aenc = null;
  const t0 = performance.now();
  let audioClockUs = null;   // sample-accurate once anchored to the session clock
  if (acfg) {
    aenc = new AudioEncoder({
      output: (chunk, meta) => {
        try { muxer.addAudioChunk(chunk, meta && meta.decoderConfig ? meta : undefined); }
        catch (e) { sessionError = sessionError || e; }
      },
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
      onError(sessionError || e);
    }
    try { venc.close(); } catch { /* closed */ }
    try { aenc?.close(); } catch { /* closed */ }
    if (dropped) console.info(`[conduit] recorder dropped ${dropped} frames to encoder backpressure`);
  }

  return {
    engine: 'webcodecs',
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
function startMediaRecorderSession({ w, h, audioTrack, onDone, onError }) {
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
  recorder.onerror = (e) => { if (onError) onError((e && e.error) || new Error('MediaRecorder error')); };
  // stream teardown happens INSIDE onstop — killing the tracks synchronously in
  // stop() raced the encoder on WebKit and the final chunks never arrived
  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    onDone(new Blob(chunks, { type: finalMime }), extFor(finalMime));
  };
  recorder.start();

  return {
    engine: 'mediarecorder',
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
// `engine: 'mediarecorder'` forces the fallback engine (device A/B debugging);
// anything else auto-selects. `lastResult` reports how the LAST take ended —
// `{ ok:true, name, bytes }` after the save resolved, `{ ok:false, error }`
// when the take was lost — so the UI can stop pretending silence is success.
export function createRecorderSink({ filenamePrefix = 'fold-live', save = null, engine = 'auto' } = {}) {
  let session = null;
  let recording = false;
  let lastResult = null;

  const saveTake = (blob, ext) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = `${filenamePrefix}-${stamp}.${ext}`;
    console.info(`[conduit] take finalized: ${(blob.size / 1e6).toFixed(1)} MB → ${name}`);
    Promise.resolve((save || downloadBlob)(blob, name)).then(
      () => { lastResult = { ok: true, name, bytes: blob.size }; },
      (e) => {
        lastResult = { ok: false, error: 'save failed: ' + ((e && e.message) || e) };
        console.warn('[conduit] take save failed:', e);
      },
    );
  };
  const failTake = (e) => {
    lastResult = { ok: false, error: (e && e.message) || String(e) };
    console.warn('[conduit] recording failed — the take is lost:', e);
  };

  return {
    id: 'disk',
    get recording() { return recording; },
    get supported() { return webCodecsRecordingSupported() || pickMime() !== null; },
    get lastResult() { return lastResult; },

    // bus calls this every frame; a no-op until a recording session is started.
    publish(frame) {
      if (recording && session) session.publish(frame);
    },

    // begin a session at w×h. `audioTrack` (optional) — the output panel's audio
    // picker acquires the chosen mic and hands its track here. Async: codec
    // discovery + the mic tap are awaited before the first frame is accepted.
    async start(w, h, audioTrack = null) {
      if (recording) return;
      lastResult = null;
      let s = null;
      if (engine !== 'mediarecorder') {
        try {
          s = await startWebCodecsSession({ w, h, audioTrack, onDone: saveTake, onError: failTake });
        } catch (e) {
          console.warn('[conduit] WebCodecs recorder failed to start, falling back to MediaRecorder:', e);
        }
      }
      if (!s) s = startMediaRecorderSession({ w, h, audioTrack, onDone: saveTake, onError: failTake });
      console.info(`[conduit] recorder engine: ${s.engine} @ ${w}×${h}${audioTrack ? ' + mic' : ''}`);
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
