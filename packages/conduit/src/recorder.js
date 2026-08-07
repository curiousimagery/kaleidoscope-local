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
// THE SILENT-TAKE BUG (fixed B530). iOS WebKit starts an AudioContext SUSPENDED and only lets it
// resume inside a user gesture. `startMicTap` used to create its context deep inside
// `startWebCodecsSession`, which by then had already awaited `pickVideoCodec` and one or two real
// `encoderYieldsConfig` probes — each an actual hardware encode and flush. The activation is long
// gone by then, `resume()` rejects, and the old code SWALLOWED that rejection.
//
// A suspended context delivers zero audio to the worklet, so `onData` never fires — but the tap
// still returned successfully, so the session declared an audio track in the muxer that never
// received a single chunk. **Silent take, no error, no warning.** Exactly the failure this file's
// header says must never happen.
//
// Two defences, because either alone leaves a hole:
//   1. PRIME the context from the user gesture (`primeRecordingAudio`, called at the tap).
//   2. VERIFY the state afterwards and THROW if it is not running, so the session falls back to
//      MediaRecorder — which takes the mic track directly and needs no AudioContext at all.
//      A working take beats a silent one, and a loud failure beats both.
let sharedCtx = null, sharedWorkletReady = null;

// The last take's audio outcome, readable by whatever surface can actually show it to a human.
// Two builds were spent guessing at the silent-take bug because the evidence only ever went to a
// console nobody could open on the device.
let lastAudioReport = null;
export function getLastAudioReport() { return lastAudioReport; }
function reportAudio(r) {
  lastAudioReport = { ...(lastAudioReport?.live ? lastAudioReport : {}), ...r, at: new Date().toISOString() };
  try { globalThis.__foldAudioReport = lastAudioReport; } catch { /* frozen global */ }
}

// DOES THE FILE WE PRODUCED ACTUALLY CONTAIN AN AUDIO TRACK? (B533)
//
// The counters proved audio reaches the muxer — 1937 chunks, a decoderConfig, verdict ok — and
// the take is still silent. So the question moved past "did we encode it" to "did it survive
// muxing", and that is answerable from the bytes instead of by another hypothesis.
//
// Walks only the container's own box tree (ftyp/moov/trak/mdia/hdlr), never scanning raw sample
// data, so an `hdlr`-shaped byte sequence inside mdat cannot produce a false positive.
function inspectMp4Tracks(buffer) {
  try {
    const dv = new DataView(buffer);
    const td = new TextDecoder();
    const typeAt = (o) => td.decode(new Uint8Array(buffer, o + 4, 4));
    const tracks = [];
    let cur = null;

    // Per-track detail, because "a soun track exists" turned out not to mean "a soun track plays"
    // (B535: 2 traks, audio=true, silent). Duration, sample count and the sample-entry format are
    // what separate a real track from an empty or misdescribed one.
    const walk = (start, end, depth) => {
      let o = start;
      while (o + 8 <= end && depth < 8) {
        const size = dv.getUint32(o);
        const type = typeAt(o);
        // 0 means "to end of file"; 1 means a 64-bit size we do not need to chase for diagnostics
        const box = size === 0 ? end - o : size;
        if (box < 8 || o + box > end) break;
        if (type === 'trak') { cur = { handler: null, format: null, samples: null, seconds: null }; tracks.push(cur); }
        if (type === 'hdlr' && cur) cur.handler = td.decode(new Uint8Array(buffer, o + 16, 4));
        if (type === 'mdhd' && cur) {
          const v = dv.getUint8(o + 8);
          // v0: timescale @20, duration @24 (32-bit). v1: timescale @28, duration @32 (64-bit)
          const ts = v === 1 ? dv.getUint32(o + 28) : dv.getUint32(o + 20);
          const dur = v === 1 ? Number(dv.getBigUint64(o + 32)) : dv.getUint32(o + 24);
          if (ts) cur.seconds = +(dur / ts).toFixed(2);
        }
        if (type === 'stsd' && cur) cur.format = typeAt(o + 16);   // first sample entry's 4CC
        // stsz: 8 header + 4 version/flags + 4 sample_size, then sample_count
        if (type === 'stsz' && cur) cur.samples = dv.getUint32(o + 16);
        if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) walk(o + 8, o + box, depth + 1);
        o += box;
      }
    };
    walk(0, buffer.byteLength, 0);
    const audio = tracks.find((t) => t.handler === 'soun') || null;
    return {
      traks: tracks.length,
      handlers: tracks.map((t) => t.handler),
      tracks,
      hasAudioTrack: !!audio,
      audioPlayable: !!(audio && audio.samples > 0 && audio.seconds > 0),
      hasVideoTrack: tracks.some((t) => t.handler === 'vide'),
      bytes: buffer.byteLength,
    };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

// Call this SYNCHRONOUSLY from the user gesture that starts a take. Creating and resuming the
// context here is what buys the activation; everything downstream is too late.
export function primeRecordingAudio() {
  try {
    if (!sharedCtx || sharedCtx.state === 'closed') {
      // 48kHz keeps Opus eligible (it only encodes at 48k); fall back to the device default
      // if the context refuses the rate.
      try { sharedCtx = new AudioContext({ sampleRate: 48000 }); } catch { sharedCtx = new AudioContext(); }
      sharedWorkletReady = null;
    }
    // fire-and-forget: the gesture is spent on the CALL, not on awaiting it
    if (sharedCtx.state === 'suspended') sharedCtx.resume().catch(() => {});
  } catch { sharedCtx = null; }
  return sharedCtx;
}

async function startMicTap(track, onData) {
  const ctx = primeRecordingAudio();
  if (!ctx) throw new Error('AudioContext unavailable');
  try {
    try { await ctx.resume(); } catch { /* reported by the state check below */ }
    // THE CHECK THAT WAS MISSING. Suspended here means no audio will ever reach the worklet.
    if (ctx.state !== 'running') throw new Error(`AudioContext ${ctx.state} — no user activation for the mic tap`);
    if (!sharedWorkletReady) {
      const url = URL.createObjectURL(new Blob([MIC_TAP_SRC], { type: 'application/javascript' }));
      sharedWorkletReady = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    }
    await sharedWorkletReady;
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
        // the context is SHARED across takes now and deliberately outlives this one: closing it
        // would mean the next take has to win a user gesture all over again, which is the bug.
      },
    };
  } catch (e) {
    // deliberately no ctx.close() — the context is shared and must survive a failed take.
    // Rethrown so startWebCodecsSession falls back to MediaRecorder rather than recording silence.
    throw e;
  }
}

// ---------------------------------------------------------------------------
// THE SILENT-TAKE FIX (B539). WebKit's AAC encoder returns `decoderConfig.description` as a FULL
// ES_Descriptor (Daniel's device: 39 bytes, `03 80 80 80 22 00 00 00`), while mp4-muxer expects
// the bare AudioSpecificConfig to nest inside the `esds` it builds itself. Handing it the whole
// descriptor nests a descriptor inside a descriptor: an `esds` that no decoder can read, in a
// track that is otherwise perfect — 431 samples, 9.19 seconds, and completely silent.
//
// So unwrap it. ISO 14496-1 layout: ES_Descriptor(0x03) → DecoderConfigDescriptor(0x04) →
// DecoderSpecificInfo(0x05), whose payload IS the AudioSpecificConfig. Sizes use the expandable
// encoding where each byte's high bit means "another length byte follows".
function readDescriptorSize(u8, i) {
  let size = 0, b;
  do { b = u8[i++]; size = (size << 7) | (b & 0x7f); } while (b & 0x80 && i < u8.length);
  return { size, next: i };
}

function extractAudioSpecificConfig(desc) {
  try {
    const u8 = desc instanceof Uint8Array ? desc
      : desc instanceof ArrayBuffer ? new Uint8Array(desc)
        : new Uint8Array(desc.buffer, desc.byteOffset || 0, desc.byteLength);
    if (!u8.length || u8[0] !== 0x03) return null;   // already a bare ASC — leave it alone
    let i = 1, r = readDescriptorSize(u8, i); i = r.next;
    i += 2;                                   // ES_ID
    const flags = u8[i++];
    if (flags & 0x80) i += 2;                 // streamDependenceFlag → dependsOn_ES_ID
    if (flags & 0x40) i += 1 + u8[i];         // URL_Flag → length-prefixed URL
    if (flags & 0x20) i += 2;                 // OCRstreamFlag → OCR_ES_Id
    if (u8[i] !== 0x04) return null;
    i++; r = readDescriptorSize(u8, i); i = r.next;
    i += 13;                                  // objectTypeIndication, streamType, bufferSizeDB(3), max+avg bitrate(8)
    if (u8[i] !== 0x05) return null;
    i++; r = readDescriptorSize(u8, i); i = r.next;
    if (!r.size || i + r.size > u8.length) return null;
    return u8.slice(i, i + r.size);
  } catch { return null; }
}

const probeCache = new Map();

// Does the AUDIO encoder actually yield a usable decoderConfig? `isConfigSupported` is not enough
// — WebKit answers yes and then emits chunks with no config, and `addAudioChunk(chunk, undefined)`
// does not throw, so the muxer writes a sample description it cannot fill and the track comes back
// silent while the video is perfect. A `false` verdict rejects the whole WebCodecs session, so the
// take falls back to MediaRecorder and comes back WITH sound: lower fidelity, infinitely better
// than silent. Cached per config for the session.
async function audioEncoderYieldsConfig(cfg) {
  const key = `audio|${cfg.codec}|${cfg.sampleRate}|${cfg.numberOfChannels}`;
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
      enc = new AudioEncoder({
        // AAC in MP4 requires a usable AudioSpecificConfig. Present is not enough — WebKit hands
        // back a full ES_Descriptor, so the real bar is that we can UNWRAP one (B539). Opus is
        // self-describing and legitimately ships without a description at all.
        output: (chunk, meta) => {
          if (!meta || !meta.decoderConfig) return settle(false);
          if (!/^mp4a/.test(cfg.codec)) return settle(true);
          const d = meta.decoderConfig.description;
          if (!d) return settle(false);
          const u = d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer || d, d.byteOffset || 0, d.byteLength ?? d.length);
          settle(u[0] !== 0x03 || !!extractAudioSpecificConfig(u));
        },
        error: () => settle(false),
      });
      enc.configure(cfg);
      // ~20ms of silence is enough to force one encoded frame out
      const frames = Math.round(cfg.sampleRate / 50);
      const data = new Float32Array(frames * cfg.numberOfChannels);
      const ad = new AudioData({
        format: 'f32-planar', sampleRate: cfg.sampleRate,
        numberOfFrames: frames, numberOfChannels: cfg.numberOfChannels,
        timestamp: 0, data,
      });
      try { enc.encode(ad); } finally { ad.close(); }
      enc.flush().catch(() => settle(false));
    } catch { settle(false); }
    setTimeout(() => settle(false), 2000);
  });
  probeCache.set(key, verdict);
  if (!verdict) console.warn(`[conduit] audio encoder ${cfg.codec} yields no decoderConfig — MediaRecorder fallback (take keeps its sound)`);
  return verdict;
}

// The VIDEO side of the same probe. Encode one frame through a throwaway encoder and report
// whether its output carried `meta.decoderConfig` with a description. WebKit accepts
// `latencyMode:'realtime'` and then emits chunks with no decoderConfig at all — the muxer can't
// build the avcC box and finalize dies ("null is not an object … decoderConfig.colorSpace",
// Daniel's iPad no-file take). Only an actual encode tells the truth.
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
      if (!acfg) {
        reportAudio({ verdict: 'NO USABLE AUDIO CODEC — falling back to MediaRecorder', trackSupplied: true, engine: 'none' });
        await mic.stop(); return null;
      }
      // …and prove the chosen codec actually hands back a decoderConfig, because
      // `isConfigSupported` saying yes is not evidence on WebKit (B531).
      const proves = await audioEncoderYieldsConfig({
        codec: acfg.codec, sampleRate: mic.sampleRate, numberOfChannels: channels, bitrate: acfg.bitrate,
      });
      if (!proves) {
        reportAudio({ verdict: 'AUDIO CODEC YIELDS NO decoderConfig — falling back to MediaRecorder', codec: acfg.codec, sampleRate: mic.sampleRate, channels, trackSupplied: true, engine: 'none' });
        await mic.stop(); return null;
      }
    } catch (e) {
      console.warn('[conduit] mic tap unavailable, falling back to MediaRecorder:', e);
      reportAudio({ verdict: `MIC TAP FAILED — falling back to MediaRecorder: ${e?.message || e}`, trackSupplied: true, ctxState: sharedCtx?.state || null, engine: 'none' });
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
  // AUDIO TELEMETRY. B531-B533 counted the PIPELINE and every stage read healthy while the take
  // stayed silent, ending at `container: 2 traks [vide,soun] audio=true` — a real audio track,
  // full length, in the file, inaudible.
  //
  // The flaw was mine: **an AudioWorklet emits render quanta whether or not there is any signal
  // in them.** A starved input produces a perfectly steady stream of zeros, so `batches > 0`
  // proved the graph was running and said nothing about whether audio was flowing through it.
  // Counting a pipeline is not the same as measuring what moves through it.
  //
  // So measure the SIGNAL (B534): peak amplitude across everything handed to the encoder.
  //   peak 0 (or ~1e-7)  → we encoded digital silence; the fault is upstream of WebAudio, and the
  //                        prime suspect is the native camera's AVAudioSession starving the
  //                        WebAudio input (MediaRecorder gets sound off the same track, which is
  //                        why the package's RAW take has audio and the composition does not)
  //   peak meaningful    → real audio was encoded and muxed, and the fault is in playback or save
  let audioBatches = 0, audioRejected = 0, audioChunks = 0, audioConfigs = 0;
  let audioFramesIn = 0;      // samples handed to the encoder — vs chunks out, catches a stall
  let audioPeak = 0;          // loudest sample seen this take, 0..1
  let audioDescBytes = null;  // AudioSpecificConfig size — 0/null means an undecodable AAC track
  let audioDescHex = null, audioDescLooksLikeEsds = false, audioAsc = null;
  let audioSilentBatches = 0; // batches that were entirely zeros
  let container = null;       // what the finished file actually contains (B533)
  const t0 = performance.now();
  let audioClockUs = null;   // sample-accurate once anchored to the session clock
  if (acfg) {
    aenc = new AudioEncoder({
      output: (chunk, meta) => {
        audioChunks++;
        if (meta && meta.decoderConfig) {
          audioConfigs++;
          // the byte length of the AudioSpecificConfig. For AAC a null/0 here means the muxer
          // writes an `esds` with nothing to describe the stream — a track that exists and
          // cannot be decoded. This is the number that was missing for four builds.
          const d = meta.decoderConfig.description;
          audioDescBytes = d ? (d.byteLength ?? d.length ?? 0) : 0;
          // WHAT the description actually IS, not just how big (B536). An AAC-LC AudioSpecificConfig
          // for 48kHz mono is TWO bytes; WebKit handed back 39, which is ES_Descriptor territory.
          // mp4-muxer expects the bare ASC to nest inside the esds it builds, so if this is a full
          // ES_Descriptor we are nesting a descriptor inside a descriptor — a malformed esds, a
          // track that exists and cannot be decoded, and playback that is silent. The first byte
          // settles it: 0x03 is the ES_Descriptor tag; an ASC starts with the object type in its
          // top 5 bits (AAC-LC = 2, so 0x11/0x12-ish).
          if (d) {
            const u = d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer || d, d.byteOffset || 0, audioDescBytes);
            audioDescHex = Array.from(u.slice(0, 8)).map((b) => b.toString(16).padStart(2, '0')).join(' ');
            audioDescLooksLikeEsds = u[0] === 0x03;
            // unwrap once and reuse: the config is identical on every chunk that carries one
            if (audioDescLooksLikeEsds) audioAsc = extractAudioSpecificConfig(u);
          }
        }
        // Hand the muxer the bare AudioSpecificConfig it expects, never WebKit's ES_Descriptor.
        // Everything else about the take was already correct — this one substitution is the
        // difference between a `soun` track that decodes and one that plays as silence.
        const m = (meta && meta.decoderConfig)
          ? (audioAsc ? { ...meta, decoderConfig: { ...meta.decoderConfig, description: audioAsc } } : meta)
          : undefined;
        try { muxer.addAudioChunk(chunk, m); }
        catch (e) { sessionError = sessionError || e; }
      },
      error: (e) => { sessionError = e; },
    });
    aenc.configure({ codec: acfg.codec, sampleRate: mic.sampleRate, numberOfChannels: channels, bitrate: acfg.bitrate });
    const rate = mic.sampleRate;
    onAudioData = (batch) => {
      audioBatches++;
      if (!aenc || aenc.state !== 'configured' || sessionError) { audioRejected++; return; }
      let frames = 0;
      for (const chunk of batch) frames += chunk[0].length;
      if (!frames) return;
      audioFramesIn += frames;
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
      // MEASURE THE SIGNAL, not just the plumbing (B534). Sampled every 16th value — enough to
      // catch a live mic, cheap enough to run on every batch in the record loop.
      let peak = 0;
      for (let i = 0; i < data.length; i += 16) { const v = data[i] < 0 ? -data[i] : data[i]; if (v > peak) peak = v; }
      if (peak > audioPeak) audioPeak = peak;
      if (peak === 0) audioSilentBatches++;
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
  let videoFramesEncoded = 0;
  // publish what the session was CONFIGURED with straight away — Daniel captured a report
  // mid-take and got `audio: null`, because the only report was written at finish (B533)
  reportAudio({
    live: true, verdict: 'recording…', engine: 'webcodecs',
    codec: acfg?.codec || null, muxerCodec: acfg?.muxerCodec || null,
    sampleRate: mic?.sampleRate || null, channels: acfg ? channels : null,
    trackSupplied: !!audioTrack,
    trackState: audioTrack ? { enabled: audioTrack.enabled, muted: audioTrack.muted, readyState: audioTrack.readyState, label: audioTrack.label } : null,
  });
  // VideoFrame(2D canvas) is ~15ms on WebKit (a hidden readback) but cheap on
  // Blink; VideoFrame(pixel buffer) is a plain copy everywhere. Probe the
  // canvas path's real cost on the first frames and switch to the pixels path
  // for the session if it's the slow one (Daniel's iPad: 17fps recording while
  // the bus rendered 29 — the construction cost was throttling the loop).
  let vfMode = null, vfProbeN = 0, vfProbeMs = 0;

  async function finish() {
    if (mic) await mic.stop();   // posts the tail flush → onAudioData → encode
    try { if (aenc && aenc.state === 'configured') await aenc.flush(); } catch { /* mid-error */ }
    try { if (venc.state === 'configured') await venc.flush(); } catch { /* mid-error */ }
    try {
      muxer.finalize();
      const buf = muxer.target.buffer;
      container = inspectMp4Tracks(buf);
      onDone(new Blob([buf], { type: 'video/mp4' }), 'mp4');
      // DOMExceptions stringify to {} — extract the message so the console names it
      if (sessionError) console.warn(`[conduit] recording had encoder errors (take saved up to the failure): ${sessionError.name || ''} ${sessionError.message || sessionError}`);
    } catch (e) {
      onError(sessionError || e);
    }
    try { venc.close(); } catch { /* closed */ }
    try { aenc?.close(); } catch { /* closed */ }
    if (dropped) console.info(`[conduit] recorder dropped ${dropped} frames to encoder backpressure`);
    const verdict = !acfg ? 'NO AUDIO TRACK on this take — the sink was handed no mic track at all'
      : !audioBatches ? 'NO MIC DATA — the worklet never delivered (context suspended or tap dead)'
        : !audioChunks ? 'MIC DATA BUT NO ENCODED CHUNKS — the audio encoder produced nothing'
          : !audioConfigs ? 'CHUNKS BUT NO decoderConfig — the muxer could not describe the track'
            // the check that should have existed from the start: a full-length track of zeros
            // passes every count above and is inaudible
            : audioPeak < 1e-5 ? `SILENCE ENCODED — peak ${audioPeak}; WebAudio got no signal from a live track (suspect the native camera's audio session)`
              : !container?.hasAudioTrack ? 'AUDIO ENCODED BUT NO soun TRACK IN THE FILE — the muxer dropped it'
                // real audio, real track, and no AudioSpecificConfig to decode it with
                : (/^mp4a/.test(acfg.codec) && !audioDescBytes) ? 'AAC WITHOUT AudioSpecificConfig — the soun track exists but cannot be decoded (silent playback)'
                  : (audioDescLooksLikeEsds && !audioAsc) ? `ES_DESCRIPTOR THAT WOULD NOT UNWRAP (${audioDescBytes}B, ${audioDescHex}) — no AudioSpecificConfig to give the muxer`
                    : container && !container.audioPlayable ? `soun TRACK IS EMPTY OR ZERO-LENGTH — ${JSON.stringify(container.tracks?.find((t) => t.handler === 'soun') || null)}`
                      : 'ok';
    // PUBLISHED, not just logged — see perf-panel's export. A console-only diagnostic on a
    // Capacitor device is a diagnostic nobody can collect.
    const rate = mic?.sampleRate || 0;
    reportAudio({
      live: false,
      // THE QUESTION MOVED. The counters below proved audio reaches the muxer, and the take was
      // still silent — so `container` is now the load-bearing field: it says whether the file we
      // handed back actually has a `soun` track. `hasAudioTrack: false` with chunks > 0 means the
      // muxer dropped it and the fault is in muxing/config. `true` means the bytes are there and
      // the fault is downstream in save or playback.
      container,
      verdict,
      codec: acfg?.codec || null,
      muxerCodec: acfg?.muxerCodec || null,
      sampleRate: rate || null,
      channels: acfg ? channels : null,
      trackSupplied: !!audioTrack,
      trackState: audioTrack ? { enabled: audioTrack.enabled, muted: audioTrack.muted, readyState: audioTrack.readyState, label: audioTrack.label } : null,
      batches: audioBatches, rejected: audioRejected, chunks: audioChunks, withConfig: audioConfigs,
      // seconds IN vs seconds OUT — a large gap means the encoder stalled or dropped mid-take,
      // which a raw chunk count cannot show
      secondsIn: rate ? +(audioFramesIn / rate).toFixed(1) : null,
      secondsOut: rate ? +((audioChunks * 1024) / rate).toFixed(1) : null,
      peak: +audioPeak.toFixed(5),
      silentBatches: audioSilentBatches,
      descBytes: audioDescBytes,
      descHex: audioDescHex,
      descLooksLikeEsds: audioDescLooksLikeEsds,
      ascBytes: audioAsc ? audioAsc.length : null,   // the unwrapped config actually muxed
      videoFrames: videoFramesEncoded,
      engine: 'webcodecs',
    });
    const line = `[conduit] audio: ${audioBatches} batches (${audioSilentBatches} silent) → ${audioChunks} chunks, peak ${audioPeak.toFixed(5)}, desc ${audioDescBytes ?? 'none'}B — ${verdict}`
      + ` (${audioDescHex || 'n/a'})`
      + ` | container: ${container ? `${container.traks} traks ${JSON.stringify(container.tracks)}` : 'not inspected'}`;
    if (verdict === 'ok') console.info(line); else console.warn(line);
  }

  return {
    engine: 'webcodecs',
    publish(frame) {
      if (sessionError || venc.state !== 'configured') return;
      if (frame.w !== w || frame.h !== h) return;          // bus resized mid-take: skip
      if (venc.encodeQueueSize > 4) { dropped++; return; } // freshness over completeness, live
      // `latencySec` (optional) is how long ago the source actually SAW this frame. Cinematic
      // video stabilization buffers frames for lookahead, so at `cinematicExtended` a frame can
      // reach us ~a second after the lens saw it — and stamping arrival puts recorded video that
      // far behind recorded audio, which is what broke lip sync. Subtracting it places the frame
      // on the timeline at capture time, which is what AVFoundation does natively and is why it
      // never has this problem. Mode-independent: nothing to calibrate, nothing to re-tune.
      const lat = frame.latencySec > 0 ? frame.latencySec * 1000 : 0;
      const ts = Math.max(0, Math.round((performance.now() - lat - t0) * 1000));
      // duration is NOMINAL but must exist: mp4-muxer requires a non-negative
      // duration per chunk (WebKit passes a missing VideoFrame duration through
      // as null → "addVideoChunkRaw's fourth argument…", Daniel's iPad take),
      // while actual timing comes from timestamp deltas (timescaleUnitsToNextSample)
      const dur = 33_333;
      let vf;
      const useCanvas = frame.canvas && vfMode !== 'pixels';
      if (useCanvas && !(vfMode === null && frame.pixels)) {
        vf = new VideoFrame(frame.canvas, { timestamp: ts, duration: dur });
      } else if (frame.canvas && vfMode === null) {
        // probe: time three canvas-constructions before committing
        const t = performance.now();
        vf = new VideoFrame(frame.canvas, { timestamp: ts, duration: dur });
        vfProbeMs += performance.now() - t;
        if (++vfProbeN >= 3) {
          vfMode = vfProbeMs / vfProbeN > 5 ? 'pixels' : 'canvas';
          if (vfMode === 'pixels') console.info(`[conduit] recorder: VideoFrame(canvas) ${(vfProbeMs / vfProbeN).toFixed(1)}ms — switching to the pixel path`);
        }
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
        vf = new VideoFrame(px, { format: 'RGBA', codedWidth: w, codedHeight: h, timestamp: ts, duration: dur });
      }
      const key = ts - lastKeyUs >= 2_000_000;
      if (key) lastKeyUs = ts;
      try { venc.encode(vf, { keyFrame: key }); videoFramesEncoded++; } finally { vf.close(); }
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
  let audioAdded = false;
  if (audioTrack) { try { stream.addTrack(audioTrack); audioAdded = true; } catch { /* video-only */ } }
  // report from THIS path too — otherwise a fallback take reads as "no data" in the export and
  // looks like the WebCodecs failure it was actually rescued from
  reportAudio({
    verdict: !audioTrack ? 'NO AUDIO TRACK handed to the MediaRecorder session'
      : audioAdded ? 'ok (MediaRecorder muxes the track natively)' : 'TRACK REJECTED by the capture stream',
    trackSupplied: !!audioTrack,
    trackState: audioTrack ? { enabled: audioTrack.enabled, muted: audioTrack.muted, readyState: audioTrack.readyState, label: audioTrack.label } : null,
    engine: 'mediarecorder',
  });
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
// `engine`: 'auto' (default) tries WebCodecs then falls back to MediaRecorder;
// 'mediarecorder' forces the fallback (device A/B debugging); 'webcodecs'
// throws instead of falling back (for callers with their own MediaRecorder
// integration — the mobile record path). `lastResult` reports how the LAST take ended —
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
      if (!s && engine === 'webcodecs') {
        // webcodecs-or-nothing mode: the caller has its own (better-integrated)
        // MediaRecorder machinery and only wants this sink for the upgrade path
        throw new Error('WebCodecs recording unavailable on this browser');
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
