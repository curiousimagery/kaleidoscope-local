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
// Memory: the take STREAMS TO DISK via OPFS where the platform supports it (B553), so a long
// or high-resolution take never has to fit in RAM — see createDiskTarget. The in-memory
// ArrayBufferTarget remains the fallback and is still what the offline exporter uses.

import { Muxer, ArrayBufferTarget, StreamTarget } from 'mp4-muxer';
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

// ---------------------------------------------------------------------------
// STREAM THE TAKE TO DISK (B553) instead of assembling it in memory.
//
// `ArrayBufferTarget` + `fastStart:'in-memory'` holds every encoded chunk until finalize, then
// materialises one contiguous ArrayBuffer, which `new Blob([buf])` copies AGAIN. Peak footprint
// is therefore a multiple of the finished file — fine for the 21MB/26s FHD takes we measured,
// and the prime suspect for the long-4K failures Daniel has been hitting for months. It is also
// what makes true 4K recording unshippable on the phone: the cap can't come off while the whole
// file has to fit in RAM twice.
//
// OPFS gives us a real file handle with a seekable writable stream, which is exactly what
// mp4-muxer's FileSystemWritableFileStreamTarget wants. The muxer writes through as it goes, and
// `getFile()` hands back a disk-backed File — a Blob that never occupied the JS heap at all.
//
// `fastStart:false` is required: reserving space for a front-loaded moov needs the chunk count up
// front, which a live take cannot know. So the moov lands at the END of the file. AVFoundation
// (Photos, QuickTime) reads local moov-at-end files fine; what it would break is progressive
// HTTP streaming, which is not a thing we do with a saved take.
//
// Feature-detected and fully optional — `createWritable` on OPFS is Safari 17+ / iOS 17+, and any
// failure anywhere here falls back to the in-memory path rather than losing a take.
async function createDiskTarget(prefix) {
  try {
    if (!navigator?.storage?.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    // Sweep orphans first. A take that died mid-flight (jetsam, a crash, a force-quit) leaves its
    // part-file behind, and OPFS is persistent — without this, the failures this feature exists to
    // fix would each permanently consume their own size in the origin's quota.
    //
    // This also removes the PREVIOUS take's file, which is safe only because the host holds exactly
    // one stashed take: starting a new recording replaces it, so the old one was already
    // unreachable through the UI. If a host ever keeps more than one unsaved take, this sweep has
    // to become age- or reference-aware rather than "delete every .part".
    try {
      for await (const [n, h] of root.entries()) {
        if (n.endsWith('.part') && h.kind === 'file') await root.removeEntry(n).catch(() => {});
      }
    } catch { /* entries() unsupported — skip the sweep, not the take */ }

    const name = `${prefix}-${Date.now()}.mp4.part`;
    const handle = await root.getFileHandle(name, { create: true });
    if (typeof handle.createWritable !== 'function') return null;
    const stream = await handle.createWritable();

    // AWAIT THE WRITES (B554). mp4-muxer's own FileSystemWritableFileStreamTarget calls
    // `stream.write(...)` and discards the promise, so when the synchronous `muxer.finalize()`
    // returns, an unknown number of writes — INCLUDING THE MOOV, which `fastStart:false` puts
    // last — are still in flight. B553 closed the stream immediately afterwards and Daniel got a
    // 48MiB file (exactly 3× the muxer's 16MiB chunk size) containing the media and **no index at
    // all**: `traks: 0`, no video track, no audio track. iOS then sat on it for two minutes trying
    // to import a file with no moov.
    //
    // So drive StreamTarget directly and keep every write promise. `data.slice()` copies out of
    // the muxer's reusable chunk buffer, because an un-awaited write must not race a buffer the
    // muxer is entitled to overwrite.
    const pending = [];
    let writeError = null;
    const target = new StreamTarget({
      chunked: true,
      onData: (data, position) => {
        const p = Promise.resolve(stream.write({ type: 'write', data: data.slice(), position }))
          .catch((e) => { writeError = writeError || e; });
        pending.push(p);
      },
    });

    return {
      target,
      // close the stream, then hand back the finished file WITHOUT reading it into memory
      async finish() {
        await Promise.all(pending);            // the moov is in here
        if (writeError) throw writeError;      // a lost write means a corrupt file — say so
        await stream.close();
        return handle.getFile();
      },
      async cleanup() {
        try { await stream.close(); } catch { /* already closed */ }
        try { await root.removeEntry(name); } catch { /* already gone */ }
      },
    };
  } catch (e) {
    console.warn('[conduit] OPFS unavailable — take will be assembled in memory:', e?.message || e);
    return null;
  }
}

// Reading a streamed take back just to count its boxes would undo the point of streaming it, so
// the audio verdict's container check is size-gated: normal takes still get the full diagnosis,
// and the huge ones — the very takes this exists for — report honestly that it was skipped.
const INSPECT_MAX_BYTES = 128 * 1024 * 1024;

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

// THE GAIN STAGE WE OWED (B560).
//
// B558 disabled echo cancellation, noise suppression and AGC because they are audibly wrong for a
// recording. That was right and it was half the job: **AGC was also the only thing managing LEVEL
// anywhere in the app.** Removing it produced opposite failures on the two devices in the same
// test round — an iPhone `peak` of 2.82 (about 9dB over full scale, nothing preventing clipping)
// and an iPad so quiet Daniel described it as "a master gain tuned way down".
//
// One cause, so one fix, and it is ours to build rather than a reason to revert.
//
// TRIM, THEN LIMIT — in that order, because the limiter has to see the boosted signal:
//
//   src → trim (GainNode) → limiter (DynamicsCompressor) → worklet tap → encoder
//
// THE TRIM IS MEASURED ONCE, NOT RIDDEN. That distinction is the whole design. Browser AGC pumps
// within a syllable, which is what made takes sound processed; this samples the input for ~800ms
// while the mic arms, picks one number, and then does not touch it for the rest of the take. No
// breathing, no ducking, nothing that moves while you talk. It is a trim knob we happen to set for
// you, and the number rides the report so it is never a mystery.
//
// The calibration is deliberately conservative:
//   - it uses the loudest 800ms window it sees, so a pause cannot drive the gain to the ceiling;
//   - it is CLAMPED to 1x..8x — never attenuates (the limiter's job) and never amplifies a dead
//     room into a noise floor;
//   - a signal already at a healthy level gets exactly 1x, so the iPhone is unaffected.
//
// The limiter is pure safety and stays regardless: threshold just under full scale, high ratio,
// fast attack. It only acts on material that would otherwise clip, which is what makes it
// inaudible on everything else.
export const MIC_TARGET_PEAK = 0.5;   // where the `auto` button aims typical speech
export const MIC_MAX_GAIN = 32;
export const MIC_MIN_GAIN = 1;        // never attenuate here — that is the limiter's job

// THE USER'S TRIM, HANDED FORWARD (B562). Set from the level meter's gain control, frozen by the
// take for its whole duration. Module-level because the meter and the take open separate
// `getUserMedia` streams (filed in BACKLOG); when that is unified this becomes one value rather
// than a handoff. Defaults to 1x so a healthy mic is untouched.
let micTrimHint = 1;
// The LIVE trim node of the take in flight, when there is one. A deliberate operator adjustment
// mid-take is not the thing the freeze was protecting against (B568, Daniel: "if i adjust the gain
// while recording the levels update but the recording doesn't seem to apply the new gain").
//
// **The freeze was always about AUTOMATIC changes**, not manual ones — a trim that rides the
// signal by itself is what made takes sound processed. A hand on a fader is what every mixer in
// the world does mid-take, and refusing it would mean a take that starts too quiet stays too
// quiet. So the slider is live, and ramped so the change is a move rather than a step.
let activeTrim = null;
export function setMicTrimHint(gain) {
  micTrimHint = gain > 0 ? Math.min(MIC_MAX_GAIN, Math.max(MIC_MIN_GAIN, gain)) : 1;
  if (activeTrim) {
    try { activeTrim.node.gain.setTargetAtTime(micTrimHint, activeTrim.ctx.currentTime, 0.08); }
    catch { try { activeTrim.node.gain.value = micTrimHint; } catch { /* node gone */ } }
  }
}
export function getMicTrimHint() { return micTrimHint; }

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
    const trim = new GainNode(ctx, { gain: 1 });
    // threshold/ratio chosen to be a LIMITER rather than a compressor: it should do nothing at all
    // until the signal is about to clip, then hold it. knee 0 so there is no gradual squeeze on
    // ordinary material, and a 250ms release so recovery is slow enough not to pump.
    const limiter = new DynamicsCompressorNode(ctx, {
      threshold: -1.5, knee: 0, ratio: 20, attack: 0.003, release: 0.25,
    });
    const node = new AudioWorkletNode(ctx, 'conduit-mic-tap', { numberOfInputs: 1, numberOfOutputs: 0 });
    node.port.onmessage = (e) => onData(e.data);
    src.connect(trim); trim.connect(limiter); limiter.connect(node);

    // Calibrate off a SEPARATE analyser on the raw source, so the measurement can never be
    // influenced by the trim it is setting.
    const probe = new AnalyserNode(ctx, { fftSize: 2048 });
    src.connect(probe);
    // AUTO-CALIBRATION IS GONE (B562). It failed twice, in opposite directions, and the reason is
    // structural rather than a tuning miss.
    //
    // B560 measured a fixed window at record start and always caught silence. B561 fixed the
    // trigger and then fired on ROOM TONE: Daniel's iPhone report reads `micRawPeak 0.00552`, which
    // is about -45dBFS — an air conditioner, not a voice. The trim computed 0.5/0.00552, clamped to
    // 32x, and applied it 2.4 seconds into the take, which is exactly the audible jump he heard.
    //
    // **The unsolvable part is "is this speech?"** Deciding that from a short observation is a real
    // signal-processing problem, and both failure directions are bad: too eager and we amplify an
    // air conditioner by 32x, too shy and we do nothing at all. Two builds spent guessing at a
    // threshold is enough.
    //
    // **So the user tells us when.** The level meter has a gain control with an `auto` button that
    // calibrates against whatever it is hearing AT THE MOMENT IT IS PRESSED — which the user
    // presses while talking. That dissolves the question rather than answering it: there is no
    // "when do we measure", because the press IS the measurement.
    //
    // What survives here is the part that was always right: a trim the take FREEZES for its whole
    // duration, and a limiter so a wrong setting cannot destroy a recording. Default 1x, so a
    // healthy mic (the iPhone's, `peak` 2.82 raw) is untouched except for clip protection.
    //
    // Kept for reference — the dead approach, so nobody rebuilds it:
    // WHY B560's FIRST ATTEMPT DID NOTHING (fixed B561). It sampled a fixed 800ms window starting
    // when the tap opened — which is the instant the take starts, i.e. the one moment the user is
    // reliably NOT talking yet. It measured room tone, fell under the 0.005 floor, and correctly
    // declined to guess. The mechanism was right and the trigger was wrong: **a calibration window
    // that opens on a timer will nearly always open on silence.**
    //
    // Two changes:
    //   1. TRIGGER ON SIGNAL, NOT ON TIME. Keep watching until we actually observe speech-level
    //      input, set the trim once, then freeze. Bounded to the first 15 seconds so it can never
    //      change level deep into a take. If nothing above the floor arrives in that time, we stay
    //      at 1x — still declining to guess, which is the right failure.
    //   2. ACCEPT A HINT FROM THE METER. The level meter has been open and watching real speech
    //      while the mic was armed, long before record was pressed. Its trim is a strictly better
    //      starting point than anything this window can see, so it is used as the initial value
    //      and this calibration only refines it.
    //
    // The result is unchanged in the property that matters: **the gain settles once and then does
    // not move for the rest of the take.**
    // The trim is whatever the user set on the meter, applied once and never touched again.
    const calibratedGain = micTrimHint > 0 ? micTrimHint : 1;
    if (calibratedGain !== 1) { try { trim.gain.value = calibratedGain; } catch { /* read-only */ } }
    activeTrim = { node: trim, ctx };   // let the slider reach this take while it runs
    // We still MEASURE the raw input, because `micRawPeak` beside `peak` is what separates a quiet
    // room from a quiet mic from a trim that never engaged — the three cases this whole saga was
    // unable to tell apart. Measuring is free; acting on it automatically is what went wrong.
    let rawPeak = 0, calTimer = 0;
    const buf = new Float32Array(probe.fftSize);
    const sample = () => {
      probe.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i += 4) { const v = buf[i] < 0 ? -buf[i] : buf[i]; if (v > rawPeak) rawPeak = v; }
      calTimer = setTimeout(sample, 100);
    };
    calTimer = setTimeout(sample, 100);

    return {
      sampleRate: ctx.sampleRate,
      get gain() { return calibratedGain; },
      get rawPeak() { return rawPeak; },
      async stop() {
        activeTrim = null;
        if (calTimer) { clearTimeout(calTimer); calTimer = 0; try { src.disconnect(probe); } catch {} }
        try { node.port.postMessage('flush'); } catch { /* port gone */ }
        await new Promise((r) => setTimeout(r, 80));   // let the flush round-trip
        try { src.disconnect(); trim.disconnect(); limiter.disconnect(); node.disconnect(); } catch { /* already down */ }
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
async function startWebCodecsSession({ w, h, audioTrack, onDone, onError, onProgress = null, streamToDisk = true, filenamePrefix = 'fold-take' }) {
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

  // stream to disk when the platform allows it; otherwise the original in-memory path
  const disk = streamToDisk ? await createDiskTarget(filenamePrefix) : null;
  const muxer = new Muxer({
    target: disk ? disk.target : new ArrayBufferTarget(),
    video: { codec: vcfg.muxerCodec, width: w, height: h, frameRate: 30 },
    ...(acfg ? { audio: { codec: acfg.muxerCodec, sampleRate: mic.sampleRate, numberOfChannels: channels } } : {}),
    // moov at the end is the price of not knowing the chunk count up front — see createDiskTarget
    fastStart: disk ? false : 'in-memory',
    // live takes are VFR on a wall clock: both tracks share the session clock
    // and the muxer shifts them together so the earliest sample lands at 0
    firstTimestampBehavior: 'cross-track-offset',
  });

  let sessionError = null;
  // `decoderConfig` PRESENT BUT `colorSpace` MISSING (B572). The existing guard checked only that
  // `decoderConfig` exists — but mp4-muxer reaches THROUGH it for `colorSpace` and dereferences
  // the result, so a config without that field throws `null is not an object (evaluating
  // 't.info.decoderConfig.colorSpace')` and the take is lost. Filed from B516 as an iPhone FHD
  // failure; Daniel hit it again on iPad recording during a 4K broadcast, so it is not
  // device-specific — it is whatever makes WebKit omit the field under load.
  //
  // Supply the defaults rather than dropping the metadata: without `decoderConfig` the muxer has
  // no avcC to write and the file is unplayable, so passing `undefined` trades a crash for a
  // broken file. These are the values H.264 4:2:0 8-bit is decoded as anyway when a stream
  // carries no VUI, so stating them is a truthful default rather than a guess.
  const safeVideoMeta = (meta) => {
    const dc = meta && meta.decoderConfig;
    if (!dc) return undefined;
    if (dc.colorSpace) return meta;
    return { ...meta, decoderConfig: { ...dc, colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false } } };
  };

  // belt over the probe's braces: only hand the muxer metadata that actually
  // carries a decoderConfig, and never let a muxer throw escape the callback
  const venc = new VideoEncoder({
    output: (chunk, meta) => {
      try { muxer.addVideoChunk(chunk, safeVideoMeta(meta)); }
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
  let lastVideoTsUs = 0, latMinMs = Infinity, latMaxMs = 0;   // A/V drift instrument — see publish()
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
  // finalize telemetry — read by the sink while finalize runs, and folded into the take report
  let progress = null, finalizeMs = 0, finalizeMarks = '', diskStreamed = false;

  // FINALIZE IS THE HIGHEST-STAKES MOMENT IN THE APP and until B550 it was completely dark:
  // "finishing take…" with no progress, no phase, and a caller-side 30s wall clock that
  // DISCARDED the take when it expired. Daniel's report — 4K finalize is slow and "has failed
  // more often than not" — is consistent with takes that were still working being declared dead.
  //
  // So: report where the time actually goes. The video flush is the long pole and it is the one
  // phase with a real denominator — `encodeQueueSize` is the number of frames the encoder still
  // owes us, so watching it drain is genuine determinate progress rather than a guessed bar.
  // The caller uses the same stream to tell "slow" apart from "stuck" (see chrome.js).
  async function finish() {
    // ⚠️ B666 — NAMED `f0`, NOT `t0`, AND THAT IS THE WHOLE BUG. This local used to be `t0`, which
    // SHADOWED the session's take-start `t0` above — so `wallSec`, documented three lines from here
    // as "how long the take really ran", was reporting how long the FINALIZE took. Every take
    // report in the project has carried a `wallSec` of roughly zero, and B665's scripted A/B
    // divided by it and produced 13770 fps. A shadowed variable, in the field named as one of the
    // three clocks that must agree.
    const f0 = performance.now();
    const since = () => Math.round(performance.now() - f0);
    const marks = [];
    const step = (phase, frac, extra) => {
      marks.push(`${phase}@${since()}ms`);
      progress = { phase, frac, ms: since(), ...extra };
      try { onProgress?.(progress); } catch { /* a reporting failure must never lose a take */ }
    };

    // ⚠️ THE AUDIO FLUSH IS THE LONG POLE, NOT THE VIDEO ENCODE (B557). B550 assumed the opposite
    // and weighted the bar accordingly: audio got a flat 5% with no updates, video got 15→85%.
    // Daniel's marks say otherwise, consistently — `flushing audio@0ms · encoding remaining
    // frames@6459ms` means the AUDIO flush took 6.4 of the 7.2 second finish, and on his 4K take
    // it was 32.7 of 33.1 seconds. The video encoder is essentially drained already, because
    // `publish` drops frames whenever its queue exceeds 4; the audio encoder has no such valve and
    // absorbs the entire backlog instead. So he watched "flushing audio 5%" sit still for the
    // whole wait, which is exactly the uninformative spinner the progress work set out to remove.
    //
    // Both flushes now report from their own `encodeQueueSize`, and the weights follow the
    // measurement rather than my assumption.
    step('flushing audio', 0.02);
    if (mic) await mic.stop();   // posts the tail flush → onAudioData → encode
    const aQueued0 = aenc?.encodeQueueSize || 0;
    let aDrain = null;
    if (aQueued0 > 0) {
      aDrain = setInterval(() => {
        const q = aenc?.encodeQueueSize || 0;
        step('flushing audio', 0.02 + 0.73 * (1 - q / aQueued0), { queued: q });
      }, 250);
    }
    try { if (aenc && aenc.state === 'configured') await aenc.flush(); } catch { /* mid-error */ }
    if (aDrain) clearInterval(aDrain);

    const queued0 = venc.encodeQueueSize || 0;
    step('encoding remaining frames', 0.75, { queued: queued0 });
    let drain = null;
    if (queued0 > 0) {
      drain = setInterval(() => {
        const q = venc.encodeQueueSize || 0;
        step('encoding remaining frames', 0.75 + 0.15 * (1 - q / queued0), { queued: q });
      }, 250);
    }
    try { if (venc.state === 'configured') await venc.flush(); } catch { /* mid-error */ }
    if (drain) clearInterval(drain);

    step('writing the file', 0.9);
    try {
      muxer.finalize();
      let blob;
      if (disk) {
        // the muxer has written through; closing the stream hands back a disk-backed File that
        // was never resident in the JS heap
        blob = await disk.finish();
        diskStreamed = true;
      } else {
        const buf = muxer.target.buffer;
        blob = new Blob([buf], { type: 'video/mp4' });
      }
      finalizeMs = since();
      finalizeMarks = marks.join(' · ');
      // reading a streamed take back purely to count boxes would undo the streaming
      if (blob.size <= INSPECT_MAX_BYTES) container = inspectMp4Tracks(await blob.arrayBuffer());
      else container = { skipped: `not inspected — ${(blob.size / 1e6).toFixed(0)}MB streamed to disk`, bytes: blob.size };

      // NEVER HAND THE OS A FILE WE HAVE NOT VALIDATED (B554). B553's indexless take went straight
      // to the iOS save sheet, which sat on it for over two minutes trying to import an mp4 with no
      // moov — a silent hang where a clear failure belonged. When we inspected the container and it
      // has no video track we already KNOW the file is unusable; saying so costs nothing and turns
      // a two-minute mystery into one sentence.
      if (container && !container.skipped && !container.error && !container.hasVideoTrack) {
        throw new Error(`the muxed file has no video track (${(blob.size / 1e6).toFixed(0)}MB, ${container.traks} tracks) — its index is missing, so it would not open`);
      }

      step('saving', 0.97);
      onDone(blob, 'mp4');
      // DOMExceptions stringify to {} — extract the message so the console names it
      if (sessionError) console.warn(`[conduit] recording had encoder errors (take saved up to the failure): ${sessionError.name || ''} ${sessionError.message || sessionError}`);
    } catch (e) {
      // a failed finalize must not leave a part-file squatting in the origin's storage quota
      if (disk) { try { await disk.cleanup(); } catch { /* best effort */ } }
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
              // ORDER MATTERS: a container with NO tracks at all is not an audio bug. B553's
              // indexless file reported "the muxer dropped the audio track" while in fact the whole
              // moov was missing — a verdict that aimed the next build at the wrong half of the
              // pipeline. Check the FILE before blaming one track inside it.
              : (container && !container.skipped && !container.traks) ? `THE FILE HAS NO TRACKS AT ALL (${container.bytes} bytes) — the container index is missing; this is not an audio fault`
                // A SKIPPED INSPECTION IS NOT EVIDENCE OF ANYTHING (B555). The size gate leaves
                // `hasAudioTrack` undefined, which read as false and fired this alarm on Daniel's
                // 153MB take — a take that in fact had perfectly good audio. Crying wolf on a
                // healthy file is worse than staying quiet: the whole point of these verdicts is
                // that they are trustworthy enough to act on.
                : container?.skipped ? `ok (encoded ${audioChunks} chunks, peak ${+audioPeak.toFixed(3)} — file too large to verify: ${container.skipped})`
                  : !container?.hasAudioTrack ? "AUDIO ENCODED BUT THE FILE HAS NO AUDIO ('soun') TRACK — the muxer dropped it"
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
      // `applied` is what the PLATFORM actually honoured, not what we asked for (B566). The whole
      // iPad mic saga has been conducted without it: we have been setting three constraints and
      // inferring from level whether they took. If `balanced` comes back with noiseSuppression
      // true anyway, the flags are not separable on iOS and no amount of UI will make them so.
      trackState: audioTrack ? {
        enabled: audioTrack.enabled, muted: audioTrack.muted,
        readyState: audioTrack.readyState, label: audioTrack.label,
        applied: (() => {
          try {
            const g = audioTrack.getSettings?.() || {};
            return {
              echoCancellation: g.echoCancellation, noiseSuppression: g.noiseSuppression,
              autoGainControl: g.autoGainControl, sampleRate: g.sampleRate, channelCount: g.channelCount,
            };
          } catch { return null; }
        })(),
      } : null,
      finalizeMs, finalizeMarks,   // WHERE the finish went — the 4K-finalize question (B550)
      // THREE CLOCKS THAT SHOULD AGREE (B557). wall = how long the take really ran; video =
      // the span of stamped video timestamps; audio = samples actually encoded. A gap between
      // any two IS the sync drift, and says which side slipped.
      wallSec: +((performance.now() - t0) / 1000).toFixed(1),
      videoSpanSec: +(lastVideoTsUs / 1e6).toFixed(1),
      audioSpanSec: rate ? +(audioFramesIn / rate).toFixed(1) : null,
      captureLatencyMs: latMaxMs ? { min: +latMinMs.toFixed(0), max: +latMaxMs.toFixed(0) } : null,
      diskStreamed,                // true = never assembled in RAM (B553)
      batches: audioBatches, rejected: audioRejected, chunks: audioChunks, withConfig: audioConfigs,
      // seconds IN vs seconds OUT — a large gap means the encoder stalled or dropped mid-take,
      // which a raw chunk count cannot show
      secondsIn: rate ? +(audioFramesIn / rate).toFixed(1) : null,
      secondsOut: rate ? +((audioChunks * 1024) / rate).toFixed(1) : null,
      // `peak` is measured AFTER the trim and limiter, so it describes what was encoded.
      // `micRawPeak` is what the microphone actually delivered and `micGain` is what we did about
      // it — together they say whether a quiet take is a quiet ROOM, a quiet MIC, or our trim
      // failing to engage, which the encoded peak alone cannot distinguish (B560).
      peak: +audioPeak.toFixed(5),
      micGain: mic?.gain ? +mic.gain.toFixed(2) : null,
      micRawPeak: mic?.rawPeak != null ? +mic.rawPeak.toFixed(5) : null,
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
    // ⚠️ B669 — LIVE, DURING THE TAKE, so a take that is encoding NOTHING can say so while it is
    // still happening. B668's take A ran a full 60 seconds after a GL context loss, reported
    // `take:started`, showed no error, and produced a file with zero frames. A take that silently
    // records nothing is worse than one that fails: the operator finds out after the show.
    get framesEncoded() { return videoFramesEncoded; },
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
      // A/V DRIFT INSTRUMENT (B557). Audio advances by exact SAMPLE COUNT while video is stamped
      // on the WALL CLOCK minus capture latency — two different clocks that agree only if no
      // audio is lost and `lat` is stable. Daniel's 6-minute take drifted audibly by the end and
      // guessing which clock slipped is exactly the trap this arc keeps punishing, so record the
      // span of each and the range of the latency correction. Costs three comparisons a frame.
      lastVideoTsUs = ts;
      if (lat < latMinMs) latMinMs = lat;
      if (lat > latMaxMs) latMaxMs = lat;
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
    get progress() { return progress; },
    // called by the sink AFTER the save settles — deleting sooner can invalidate the File
    async cleanupFile() { if (disk) { try { await disk.cleanup(); } catch { /* best effort */ } } },
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
  let published = 0;
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
    // MediaRecorder does not expose an encoded-frame count; publishes are the closest honest
    // proxy, and the watchdog only ever asks "is this still zero".
    get framesEncoded() { return published; },
    publish(frame) {
      published++;
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
export function createRecorderSink({ filenamePrefix = 'fold-live', save = null, engine = 'auto', streamToDisk = true } = {}) {
  let session = null;
  let finishing = null;    // the session while its finalize is in flight — see stop()
  let recording = false;
  let lastResult = null;

  // Live finalize progress, polled by the chrome. `null` when no finalize is in flight.
  const progressOf = () => { const s = finishing || session; return s && 'progress' in s ? s.progress : null; };

  const saveTake = (blob, ext) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = `${filenamePrefix}-${stamp}.${ext}`;
    console.info(`[conduit] take finalized: ${(blob.size / 1e6).toFixed(1)} MB → ${name}`);
    // ⚠️ DO NOT DELETE THE PART-FILE HERE (B556). `save` is not necessarily the save — on the phone
    // it STASHES the take (`wcFinish`) and returns immediately, and the real write to Photos happens
    // whenever the user taps it in the sheet, which may be minutes later. B555 treated this callback
    // resolving as "the file has served its purpose" and removed the OPFS entry the blob is backed
    // by, so the take was already gone by the time it was saved: "save failed", and RETRY failed
    // identically because there was nothing left to retry against.
    //
    // The recorder cannot know when the host is finished with a deferred blob, so it must not guess.
    // Space is reclaimed by the orphan sweep at the next session start, and a host that does know
    // can call `releaseTake()`.
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
    // { phase, frac, ms, queued? } while finalize runs — see finish() in the session
    get progress() { return progressOf(); },
    // Explicit release for a host that KNOWS the take's blob is finished with (saved, or
    // discarded). Optional — the next session's sweep reclaims anything never released.
    async releaseTake() { const s = finishing; finishing = null; await s?.cleanupFile?.(); },
    get supported() { return webCodecsRecordingSupported() || pickMime() !== null; },
    get lastResult() { return lastResult; },
    // B669 — frames encoded so far in the LIVE take, or null when nothing is running. The output
    // panel's watchdog reads it; see the zero-frame check there.
    get framesEncoded() { return recording && session ? (session.framesEncoded ?? null) : null; },

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
          s = await startWebCodecsSession({ w, h, audioTrack, onDone: saveTake, onError: failTake, streamToDisk, filenamePrefix });
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
    //
    // The session is moved to `finishing`, NOT dropped (B555). It used to be nulled here, one line
    // before the finalize it belongs to even starts — so for the whole duration of the flush there
    // was no session to ask, which silently disabled two things that both looked like separate
    // bugs: the finalize progress the panel polls (`progress` read null the entire time, so the
    // toast never showed a phase or a percentage), and the streamed part-file's cleanup, which
    // hangs off the same reference. It survives until the save settles.
    stop() {
      recording = false;
      finishing = session;
      session = null;
      finishing?.stop();
    },
  };
}
