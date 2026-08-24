// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/video-decode.js
//
// The fast decode path for frame-stepping a video source: mp4box demux →
// WebCodecs VideoDecoder, pulled sequentially. Seeking a <video> element per
// frame (the fallback that shipped first) makes the browser re-decode from the
// previous keyframe on EVERY step — a 30fps render of GOP-260 footage decodes
// each frame dozens of times. This reader decodes the stream ONCE, in order,
// and hands out the frame covering each requested time.
//
// Contract: frameAt(sec) is built for (mostly) MONOTONIC targets — the export/
// bake loops step forward. A backward jump is supported at keyframe cost: the
// decoder resets and re-decodes from the last keyframe at/before the target
// (this is what makes the source-preview second pass and the clip-bake's
// segment jumps possible). The returned VideoFrame is OWNED BY THE READER —
// paint it (drawImage) and let go; it is closed on the next call or close().
//
// Every failure path returns null / throws so callers can fall back to element
// seeking: not an mp4/mov, codec this device can't decode, mid-stream decode
// error. WebM sources always take the fallback (mp4box only demuxes ISOBMFF).

import { acquireSession, releaseSession } from 'conduit/sessions';
import { memHold, memGrow, memRelease } from './mem-ledger.js';
import * as MP4BoxModule from 'mp4box';

// mp4box ships UMD-flavored; take named exports wherever the bundler put them
const MP4Box = (MP4BoxModule.default && MP4BoxModule.default.createFile) ? MP4BoxModule.default : MP4BoxModule;

// ⚠️ B735 — THE PARSE IS INCREMENTAL AND THE SAMPLE BYTES GO TO DISK. THIS IS THE ORDER CHANGE.
//
// Every optimisation before this one changed the CONSTANT. B732 took source memory from 4x the file
// to 2x; it is still proportional to the clip. The measured budget on an M1 iPad is around 850MB and
// **a 4-minute 4K source is ~750MB at 25 Mbps and ~1.67GB at 55.7 Mbps 10-bit**, so at Daniel's
// stated typical length (2-6 minutes) the source term alone exceeds the budget. **No further
// constant-factor work reaches it.**
//
// So: feed the file to mp4box in 16MB slices instead of one buffer, copy each batch of sample bytes
// into a Blob (which the browser backs on disk) and drop every heap reference to them — mp4box's
// included, by nulling `s.data` on the object it handed us. What survives the parse is the INDEX:
// `{ cts, duration, timescale, is_sync, size, off }` per sample, a few tens of bytes each.
//
// **Source memory becomes O(1) in clip length.** The transient is one 16MB parse slice.
//
// ⚠️ SAMPLE BYTES ARE READ BACK IN CONTIGUOUS RUNS, NOT ONE AT A TIME. Samples are laid down in
// decode order, so a feed batch is one `Blob.slice()`. One read per feed rather than 24 matters
// because a disk-backed read is not free.
// ⚠️ B736 — PARSE THE MOOV ONLY. B735 STREAMED THE WHOLE FILE THROUGH mp4box AND GOT NOTHING BACK.
//
// B735 appended the file to mp4box in 16MB slices. On Daniel's M1 Max that produced
// `bake-decode-none` — **no reader armed at all** — and the bake silently fell back to seeking a
// `<video>` per frame, which is why it felt *"much much more slowly"* and why the desktop was
// suddenly no faster than the iPad. **The slowdown was never the streaming demux; it was the absence
// of one.** B724's `bake-decode-none` is what turned that from a performance mystery into a fact.
//
// The cause is where the moov sits. **iOS writes .mov files with mdat FIRST and moov at the END**,
// so `onReady` does not fire until the last slice, by which point mp4box has moved past the sample
// data in the slices it already consumed. Appending the whole file at once hid this, because
// everything was present by the time the moov finally parsed.
//
// So: find the moov ourselves by walking the top-level box headers (a handful of 16-byte reads),
// hand mp4box ONLY `ftyp` + `moov`, and take the sample table it builds from that. **mp4box populates
// `trak.samples` with `offset`, `size`, `cts`, `duration`, `timescale` and `is_sync` when it parses
// the moov — the full index, and no sample bytes at all.**
//
// **The bytes are then read straight out of the original Blob at their file offsets: zero copies, no
// second Blob, nothing to release.** Strictly better than B735, which copied every byte into a Blob
// it then had to hold.

// Walk top-level boxes and return their file ranges. Small reads only.
async function findTopLevelBoxes(blob) {
  const out = {};
  let pos = 0;
  for (let guard = 0; guard < 4096 && pos + 8 <= blob.size; guard++) {
    const dv = new DataView(await blob.slice(pos, Math.min(blob.size, pos + 16)).arrayBuffer());
    if (dv.byteLength < 8) break;
    let size = dv.getUint32(0), header = 8;
    const type = String.fromCharCode(dv.getUint8(4), dv.getUint8(5), dv.getUint8(6), dv.getUint8(7));
    if (size === 1) {
      if (dv.byteLength < 16) break;
      size = Number(dv.getBigUint64(8)); header = 16;
    } else if (size === 0) {
      size = blob.size - pos;             // "to end of file"
    }
    if (size < header || pos + size > blob.size) break;
    out[type] = { start: pos, end: pos + size, header };
    pos += size;                          // keep walking: on iOS the moov sits BEHIND the mdat
  }
  return out;
}

async function demuxStreaming(blob) {
  const boxes = await findTopLevelBoxes(blob);
  if (!boxes.moov) return null;

  const mp4 = MP4Box.createFile();
  let info = null, err = null;
  mp4.onError = (e) => { err = e || 'parse error'; };
  mp4.onReady = (i) => { info = i; };
  // ⚠️ B737 — THE mdat HEADER IS WHAT LETS THE PARSER REACH A TRAILING moov.
  //
  // B736 appended `ftyp` + `moov` and nothing else, and on Daniel's clips **`onReady` never fired**
  // — two device sessions, both silently on the slow per-frame fallback. Harnessed against a real
  // moov-at-end file (`scratchpad/mp4box-moov-check.mjs`, built with mp4-muxer at
  // `fastStart: false`, the layout iOS writes): moov-at-FRONT indexed 120/120 samples, moov-at-END
  // produced nothing at all.
  //
  // **mp4box parses forward from byte 0.** After `ftyp` it looks at offset 28, finds no buffer, and
  // stops — the moov sitting 700MB later is never reached. Giving it the mdat's 16-byte HEADER tells
  // it how large that box is, so it skips the payload it does not need and lands on the moov.
  //
  // So: every box in full EXCEPT mdat, which contributes its header only. Both layouts now index
  // identically, and the payload is never read into the heap.
  try {
    const appends = Object.entries(boxes)
      .map(([type, box]) => (type === 'mdat'
        ? { start: box.start, end: Math.min(box.start + (box.header || 8) + 8, box.end) }
        : box))
      .sort((x, y) => x.start - y.start);
    for (const box of appends) {
      const part = await blob.slice(box.start, box.end).arrayBuffer();
      part.fileStart = box.start;         // mp4box places sparse appends by this, not by arrival
      mp4.appendBuffer(part);
    }
    mp4.flush();
  } catch { return null; }
  if (err || !info) return null;
  const track = info.videoTracks && info.videoTracks[0];
  if (!track) return null;

  // The index mp4box builds from the moov: offsets and sizes into the ORIGINAL file, and no bytes.
  let raw = null;
  try { raw = mp4.getTrackById(track.id)?.samples || null; } catch { raw = null; }
  if (!raw || !raw.length) return null;
  const index = new Array(raw.length);
  for (let k = 0; k < raw.length; k++) {
    const smp = raw[k];
    index[k] = {
      cts: smp.cts, duration: smp.duration, timescale: smp.timescale,
      is_sync: !!smp.is_sync, size: smp.size, off: smp.offset,
    };
  }

  // decoder config description (avcC/hvcC/…): serialize the sample-entry box,
  // minus its own 8-byte box header — the shape VideoDecoder wants.
  // ALSO read the track rotation from the tkhd matrix: WebCodecs decodes RAW frames and does
  // NOT apply the container rotation (an iPhone portrait clip decodes landscape + 90°), so a
  // consumer drawing decoded frames must rotate them itself. (`<video>`/drawImage does this
  // for us; the decoder does not.)
  let description = null, rotation = 0;
  try {
    const trak = mp4.getTrackById(track.id);
    const entry = trak.mdia.minf.stbl.stsd.entries.find((e) => e.avcC || e.hvcC || e.vpcC || e.av1C);
    const box = entry && (entry.avcC || entry.hvcC || entry.vpcC || entry.av1C);
    if (box) {
      const ds = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
      box.write(ds);
      description = new Uint8Array(ds.buffer, 8);
    }
    rotation = rotationFromMatrix(trak && trak.tkhd && trak.tkhd.matrix);
  } catch { /* some codecs carry their config in-band */ }
  const moovBytes = boxes.moov ? (boxes.moov.end - boxes.moov.start) : 0;
  return { track, index, bytes: blob, description, rotation, moovBytes };   // the bytes ARE the original file
}

// ISO track matrix → clockwise rotation in degrees (0/90/180/270). a=m[0], b=m[1] in 16.16.
const usOf = (s) => Math.round((s.cts * 1e6) / s.timescale);

// B736 — the most sample bytes one feed batch will read from the file in a single slice.
const FEED_BYTES = 8 * 1024 * 1024;

function rotationFromMatrix(m) {
  if (!m || m.length < 2) return 0;
  const a = m[0] / 65536, b = m[1] / 65536;
  const deg = Math.round(Math.atan2(b, a) * 180 / Math.PI / 90) * 90;
  return ((deg % 360) + 360) % 360;
}

// probeVideoInfo(url) → { fps, rotation, width, height } | null — demux only (no decoder), so
// it's a cheap way to learn the source frame rate + rotation without arming a full reader.
export async function probeVideoInfo(url) {
  try {
    const res = await fetch(url);
    const parsed = await demuxStreaming(await res.blob());
    if (!parsed) return null;
    const { track, index, rotation } = parsed;
    const durSec = track.duration && track.timescale ? track.duration / track.timescale : 0;
    const n = track.nb_samples || index.length;
    return {
      fps: durSec > 0 && n > 1 ? n / durSec : 0,
      rotation,
      width: (track.video && track.video.width) || track.track_width || 0,
      height: (track.video && track.video.height) || track.track_height || 0,
    };
  } catch { return null; }
}

// ⚠️ B732 — PARSING IS NOW SEPARATE FROM READING, AND THAT IS THE WHOLE POINT.
//
// A slice bake needs TWO monotonic readers over the same file (one per segment). Until now each one
// called `createSequentialFrameReader(url)`, so the same file was fetched twice and demuxed twice.
// The controlled four-machine gauntlet measured what that costs: **`peakMB` 2143.2, of which
// `sample-table` was 1404.2 (two tables) and `source-buffer` 707.3** — and `frames-held: 0` at the
// peak, which places the high-water mark BEFORE a single frame is decoded. **The bake was at its
// most dangerous during its second demux.**
//
// A parsed source is READ-ONLY: the sample table, the sync points and the decoder config are never
// mutated by a reader. Only the decoder, its output queue, the feed cursor and the reverse-window
// cache are per-reader, and those stay per-reader. So sharing is safe by construction rather than by
// discipline.
//
// ⚠️ THE SAMPLE BYTES ARE NOT DETACHED BY SHARING. `EncodedVideoChunk` COPIES the data it is given,
// so two decoders building chunks from the same `s.data` do not race or neuter it.
//
// Expected effect: **2143MB → ~1441MB peak**, landing exactly on the moment that fails on both iPads.
//
// `createSequentialFrameReader(url)` is unchanged for every single-reader caller (bounce, forward,
// the export fallback). It opens a source, takes one reader, and closes the source with it.

// openSharedSource(url) → source | null. Parse ONCE; take as many readers as you need.
// The source is refcounted: it releases its sample table when the last reader closes AND the caller
// has closed it, whichever comes last.
export async function openSharedSource(url, { maxBytes = 1_500_000_000 } = {}) {
  if (typeof VideoDecoder === 'undefined' || !MP4Box.createFile) return null;

  let blob;
  try {
    const res = await fetch(url);
    blob = await res.blob();
  } catch { return null; }
  if (!blob.size || blob.size > maxBytes) return null;

  // ⚠️ B736 — THE TRANSIENT IS THE MOOV, NOT THE FILE.
  //
  // B730 held a `source-buffer` term across the demux because the whole file genuinely was resident
  // for that interval. Since B736 only `ftyp` + `moov` are ever read into the heap — typically a few
  // hundred KB on a long clip, since the moov is an index — and the sample bytes are read from the
  // original Blob on demand and never accumulate anywhere.
  //
  // The term keeps its own name so a report can show it COLLAPSE rather than simply go missing: **a
  // term that disappears reads as an instrument change; a term that drops from 707MB to under 1MB
  // reads as the fix.**
  const fileBytes = blob.size;
  const parsed = await demuxStreaming(blob);
  if (!parsed) return null;
  const { track, index, bytes, description, rotation, moovBytes } = parsed;
  // The moov is the ONLY part of the file this path ever reads into the heap, and it is released as
  // soon as the index is built. Recorded so a report can show it collapse rather than go missing.
  memRelease(memHold('parse-window', moovBytes || 0));

  const config = {
    codec: track.codec,
    codedWidth: (track.video && track.video.width) || track.track_width || 0,
    codedHeight: (track.video && track.video.height) || track.track_height || 0,
    ...(description ? { description } : {}),
  };
  try {
    const sup = await VideoDecoder.isConfigSupported(config);
    if (!sup || !sup.supported) return null;
  } catch { return null; }

  // ⚠️ THE INDEX IS THE ONLY THING THE HEAP KEEPS. ~64 bytes a sample: a 3,178-frame clip costs
  // ~0.2MB where its sample table cost 702MB. The BYTES live in a Blob, which the browser backs on
  // disk and which is deliberately NOT counted here — the ledger measures the heap, and counting a
  // disk-backed blob in it would put the old number back under a new name.
  const indexId = memHold('sample-index', index.length * 64);

  // Sync points as (decode-order index, presentation time), sorted by TIME. Built ONCE per source:
  // a backward jump is a binary search rather than a scan, and it cannot be fooled by an
  // IPBB-reordered table the way the old decode-order walk could.
  const syncPoints = [];
  for (let k = 0; k < index.length; k++) {
    if (index[k].is_sync) syncPoints.push({ j: k, us: usOf(index[k]) });
  }
  syncPoints.sort((a, b) => a.us - b.us);

  const durSec = track.duration && track.timescale ? track.duration / track.timescale : 0;
  const nSamples = track.nb_samples || index.length;

  let readers = 0, ownerOpen = true, released = false;
  function maybeRelease() {
    if (released || ownerOpen || readers > 0) return;
    released = true;
    memRelease(indexId);
  }

  const source = {
    config, index, bytes, syncPoints, rotation, fileBytes,
    codec: config.codec,
    fps: durSec > 0 && nSamples > 1 ? nSamples / durSec : 0,
    mbps: durSec > 0 ? +((fileBytes * 8) / durSec / 1e6).toFixed(1) : 0,
    // Sync — the parse already happened. Returns null only if the decoder cannot be constructed.
    createReader() {
      if (released) return null;
      readers++;
      // ⚠️ IDEMPOTENT PER READER, AND NOT BECAUSE THE READER PROMISES TO BE.
      //
      // `reader.close()` already guards on its own `closed` flag, so a double close cannot reach
      // here today. **That is exactly the kind of masking this arc keeps paying for**: the refcount
      // would be correct only for as long as an unrelated guard three hundred lines away stays in
      // place, and a double-decrement here releases the sample table while another reader is still
      // walking it. The scratchpad harness `shared-source-check.mjs` fails without this line.
      let done = false;
      return makeReader(source, () => { if (done) return; done = true; readers--; maybeRelease(); });
    },
    close() { ownerOpen = false; maybeRelease(); },
  };
  return source;
}

// createSequentialFrameReader(url) → reader | null (null = use the seek fallback)
// Unchanged contract for single-reader callers; the source closes with the reader.
export async function createSequentialFrameReader(url, opts = {}) {
  const src = await openSharedSource(url, opts);
  if (!src) return null;
  const reader = src.createReader();
  src.close();                 // refcounted: the table survives until this reader closes
  if (!reader) { return null; }
  return reader;
}

function makeReader(source, onClosed) {
  const { config, index, bytes, syncPoints, rotation, fileBytes } = source;
  const chunkOf = (s, data) => new EncodedVideoChunk({
    type: s.is_sync ? 'key' : 'delta',
    timestamp: usOf(s),
    duration: Math.max(1, Math.round((s.duration * 1e6) / s.timescale)),
    data,
  });

  let outQ = [];          // decoded frames, presentation order
  let decErr = null;
  let dec = null;
  let i = 0;              // next sample (decode order) to feed
  let flushing = false, flushDone = false;
  let lastTargetUs = -Infinity;
  // how far ahead a target has to be before we SEEK to it rather than decode our way there.
  // 2s is comfortably longer than any sane GOP, so the ordinary forward march never trips it.
  const FORWARD_SEEK_US = 2_000_000;
  let closed = false;

  // REVERSE-WALK CACHE — the bounce bake's real cost. `frameAt` is monotonic-friendly:
  // a backward target re-decodes from the preceding keyframe. Bounce plays forward and
  // then REVERSES, so every frame past the midpoint is a backward jump and pays that
  // re-decode again, which is what put Daniel's 176s clip over the 10s per-frame budget
  // at exactly its halfway point (B495). Filling a window of frames per miss turns one
  // re-decode per FRAME into one per WINDOW.
  //
  // Bounded by BYTES, not frames, so it self-scales: ~96MB is ~32 frames at 1080p and
  // ~8 at 4K, which is the right shape — the bigger the frame, the fewer we hold.
  const REV_CACHE_BYTES = 96 * 1024 * 1024;
  const frameBytes = Math.max(1, Math.round(
    ((config.codedWidth || 1920) * (config.codedHeight || 1080) * 3) / 2));
  const REV_CACHE_MAX = Math.max(4, Math.min(48, Math.floor(REV_CACHE_BYTES / frameBytes)));
  let revCache = [];   // decoded frames, ascending presentation time

  function revClear() {
    for (const f of revCache) f.close();
    revCache = [];
    noteFrames();
  }
  function revLookup(targetUs) {
    for (let j = revCache.length - 1; j >= 0; j--) {
      const f = revCache[j];
      if (f.timestamp <= targetUs && f.timestamp + (f.duration || 33_333) > targetUs) return f;
      if (f.timestamp <= targetUs) return f;   // last frame at/before the target covers it
    }
    return null;
  }
  // Decode forward from the keyframe to `targetUs`, keeping the trailing window. Frames
  // move OUT of outQ and are owned solely by the cache, so nothing is double-closed.
  async function revFill(targetUs) {
    revClear();
    resetTo(targetUs);
    const deadline = performance.now() + 9000;
    for (;;) {
      if (decErr) throw decErr;
      if (performance.now() > deadline) break;
      let covered = false;
      while (outQ.length) {
        const f = outQ.shift();
        revCache.push(f);
        while (revCache.length > REV_CACHE_MAX) revCache.shift().close();
        // B721 — the second test is the same hole as the forward loop's. `revLookup` already
        // returns the last frame at/before the target, so once we have decoded PAST the target
        // the window holds the answer; without this, a hole burned the full 9s deadline first.
        if (f.timestamp + (f.duration || 33_333) > targetUs) { covered = true; break; }
        if (f.timestamp > targetUs) { covered = true; break; }
      }
      if (covered) break;
      if (flushDone && i >= index.length) break;   // end of stream
      await feed();
      await new Promise((r) => setTimeout(r));
    }
  }

  // ⚠️ B699 — THE BAKE'S DECODER WAS INVISIBLE TO THE SESSION REGISTRY, AND IT IS THE ONE PATH
  // THAT JUST FAILED WITH A DECODER TIMEOUT.
  //
  // Daniel, 2026-08-21: *"Could not bake the clip: decode timed out at 39.288s (10s budget for one
  // frame...)"*, twice, about halfway through the progress bar. That error means a `VideoDecoder`
  // produced NOTHING for ten wall-clock seconds — which is what a decoder does when the platform
  // has run out of decode sessions to give it.
  //
  // **And a bake runs from inside the loop builder, which already holds three counted decoders**
  // (`clip-editor.js`: preview, A-head crossfade, thumbnail strip) **on top of the source element
  // and, on Capacitor, the native decode.** So the bake's decoder is the sixth or seventh live
  // decode on one clip, and until this line it was the only one the registry could not see.
  // `sessions.peak.decode` was therefore UNDERCOUNTING by exactly the session most likely to be
  // the one that could not be granted.
  //
  // This does not fix the bake. It makes the next failure diagnosable, which is the precondition
  // for fixing it — and it is the standing rule (an uncollectable diagnostic is no diagnostic).
  const readerToken = acquireSession('decode', 'bake: frame reader');

  function makeDecoder() {
    const d = new VideoDecoder({
      output: (f) => {
        if (closed) { f.close(); return; }
        framesDecoded++;
        lastOutputAt = performance.now();   // B721 — "is the decoder still alive" needs a clock, not a count
        outQ.push(f);
      },
      error: (e) => { decErr = e; },
    });
    d.configure(config);
    return d;
  }
  dec = makeDecoder();

  // ⚠️ B735 — FEEDING IS ASYNC NOW, AND THE TWO GUARDS BELOW ARE NOT OPTIONAL.
  //
  // Sample bytes live in a disk-backed Blob, so getting them is a promise. Two hazards follow, and
  // both produce silent corruption rather than an error:
  //
  //   1. RE-ENTRY. The wait loop calls this every iteration. Without `feeding`, a second call would
  //      start while the first is awaiting its read and both would advance `i`, feeding samples out
  //      of order into a decoder that cannot tell.
  //   2. A RESET DURING THE AWAIT. `resetTo` moves `i` back to a keyframe. If that lands mid-read,
  //      the in-flight batch would be decoded on top of the new position. `gen` makes the stale
  //      batch discard itself.
  //
  // The batch is ONE contiguous `Blob.slice`: samples are laid down in decode order, so a run of
  // them is a single range. One read per feed instead of one per sample.
  let feeding = false, gen = 0;
  async function feed() {
    if (feeding || closed) return;
    if (!(i < index.length && dec.decodeQueueSize < 24 && outQ.length < 12)) {
      if (i >= index.length && !flushing) {
        flushing = true;
        dec.flush().then(() => { flushDone = true; }, () => { /* reset() aborts a flush */ });
      }
      return;
    }
    feeding = true;
    const myGen = gen;
    try {
      const start = i;
      let end = i, want = 0;
      while (end < index.length && (end - start) < 24 && want < FEED_BYTES) { want += index[end].size; end++; }
      const from = index[start].off;
      const to = index[end - 1].off + index[end - 1].size;
      const buf = new Uint8Array(await bytes.slice(from, to).arrayBuffer());
      if (closed || gen !== myGen) return;       // reset landed mid-read: this batch is stale
      for (let k = start; k < end; k++) {
        const smp = index[k];
        const at = smp.off - from;
        dec.decode(chunkOf(smp, buf.subarray(at, at + smp.size)));
        gopWalk++;
      }
      i = end;
      if (i >= index.length && !flushing) {
        flushing = true;
        dec.flush().then(() => { flushDone = true; }, () => { /* reset() aborts a flush */ });
      }
    } catch (e) {
      if (!closed && gen === myGen) decErr = e;   // a failed read must surface, not stall the loop
    } finally { feeding = false; }
  }

  // Decoded 4K frames are ~12.4MB each and we hold up to twelve per reader plus the reverse window,
  // so this term is second only to the file itself — and unlike the file it MOVES during the bake.
  const framesId = memHold('frames-held', 0);
  function noteFrames() { memGrow(framesId, (outQ.length + revCache.length) * frameBytes); }

  function drainQ() {
    for (const f of outQ) f.close();
    outQ = [];
    noteFrames();
  }

  // (`syncPoints` is built once per SOURCE now — see openSharedSource. It is read-only here.)

  // backward jump: re-decode from the last keyframe at/before the target.
  //
  // (The previous scan walked `samples` in DECODE order and broke on the first cts past
  // the target. A harness over IPBB-reordered tables showed it agrees with the correct
  // answer on well-formed input, so it was NOT the bounce stall — but its early break is
  // a real hazard on unusual tables and it was O(n) per reset. The time-sorted binary
  // search below can't be fooled by reordering and costs O(log n).)
  // ⚠️ B716 — THE CONSERVED QUANTITY IS FRAMES DECODED PER TARGET, NOT MILLISECONDS.
  //
  // ⛔ B721: THE TWO-OUTCOME TABLE BELOW IS SUPERSEDED. It was written believing the failure was
  // slowness, because the error text's leading number reads as an elapsed time and is actually the
  // TARGET time. Nine frames in thirty seconds is a stall, not slowness. Counting frames per target
  // is still right; *"the flat budget is simply too tight for 4K on one media engine"* is not, and
  // must not be carried forward. See `stallState` for what actually distinguishes the causes.
  //
  // The bake fails on iPad with `decode timed out at 81.470s` and succeeds on desktop with the same
  // file and the same code. Timing that failure in ms answers "which machine is faster", which we
  // already know. **What we cannot currently tell is whether the two platforms are doing the same
  // WORK** — i.e. whether the reader walks the same number of frames to satisfy the frame at
  // 81.470s. That number is a property of the CLIP's GOP structure and must survive the boundary
  // between the two platforms; ms does not.
  //
  //   same count, different ms  → the clip is the constant, throughput is the variable, and the
  //                               flat budget is simply too tight for 4K on one media engine.
  //   different count           → the READER behaves differently per platform (sync-point search,
  //                               reset semantics, open-GOP handling) and the budget is a red herring.
  //
  // Those need opposite fixes, which is exactly why counting the right noun matters here.
  let framesDecoded = 0;     // decoder outputs consumed for the CURRENT target
  let resetsForTarget = 0;   // decoder reconfigures for the CURRENT target
  let gopWalk = 0;           // samples fed since the sync point this target reset to
  let worst = null;          // the most expensive target so far, whatever the outcome
  let lastOutputAt = 0;      // performance.now() of the most recent decoder output
  let holesBridged = 0;      // B721 — targets served by the last-frame-before rule below

  function noteTarget(sec, ms, timedOut, via, extra) {
    if (worst && worst.decoded >= framesDecoded && !timedOut) return;
    worst = {
      sec: +sec.toFixed(3),
      ms: Math.round(ms),
      decoded: framesDecoded,      // ← the conserved quantity
      resets: resetsForTarget,
      gopWalk,
      via,                         // which branch resolved it, or 'timeout'
      timedOut: !!timedOut,
      ...(extra || {}),
    };
  }

  // ⚠️ B721 — THE ONE READING THAT SEPARATES OUR BUG FROM THE PLATFORM'S.
  //
  // A timeout says a target went unserved; it does not say who stopped. Two very different
  // things produce the identical message, and they need opposite fixes:
  //
  //   outQ FULL (≈12) + decode queue near empty + no output for seconds
  //       → the decoder is idle because WE stopped asking. Our wait loop is stuck.
  //   outQ near EMPTY + decode queue pinned at 24 + no output for seconds
  //       → we are asking and the platform is not answering. A wedged/starved decoder.
  //
  // `headEndUs` / `nextStartUs` are the microseconds from the target to the end of the frame
  // we are holding and to the start of the next one. **Both positive means the target fell in
  // a HOLE in the presentation timeline** — the state the forward loop could not leave before
  // this build. Keep them: if the hole rule below ever mis-fires, this is what shows it.
  function stallState(target) {
    const head = outQ[0], next = outQ[1];
    let queue = -1;
    try { queue = dec.decodeQueueSize; } catch { /* closed */ }
    return {
      outQ: outQ.length,
      queue,
      fed: i,
      of: index.length,
      flushDone,
      sinceOutputMs: lastOutputAt ? Math.round(performance.now() - lastOutputAt) : -1,
      headEndUs: head ? (head.timestamp + (head.duration || 33_333)) - target : null,
      nextStartUs: next ? next.timestamp - target : null,
    };
  }

  function resetTo(targetUs) {
    resetsForTarget++;
    gen++;                     // B735 — discard any feed batch still awaiting its read

    drainQ();
    try { dec.reset(); } catch { /* already closed */ }
    try { dec.configure(config); } catch { dec = makeDecoder(); }
    flushing = false; flushDone = false;
    let lo = 0, hi = syncPoints.length - 1, k = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (syncPoints[mid].us <= targetUs) { k = syncPoints[mid].j; lo = mid + 1; }
      else hi = mid - 1;
    }
    i = k;
    gopWalk = 0;   // samples fed from here to the target IS the re-decode this reset costs
  }

  return {
    width: config.codedWidth,
    height: config.codedHeight,
    // ⚠️ B731 — WHAT MEDIA IS THIS, REALLY. "SAME CLIP" HAS BEEN WRONG TWICE.
    //
    // The iPad was handed a 334MB copy of the file the Macs read at 741MB: same name, same
    // 3840×2160, same 106.45s, same 30fps — **so nothing in the report could distinguish them except
    // the byte count**, and the byte count only showed up because the ledger's arithmetic happened
    // to be exact. Identical dimensions and duration at 45% of the size means a lower-bitrate
    // RE-ENCODE, not a downsample, and the codec is the field that says which.
    //
    // Photos hands out a transcoded copy on AirDrop/share; the original has to travel through Files.
    // **Every "the iPad handles 4K" result in this project's history may have been measured on the
    // lighter copy**, and this is the field that lets a future reader check rather than assume.
    codec: source.codec,
    fileBytes,
    mbps: source.mbps,
    // B716 — the most expensive single target this reader served, success or timeout. Read it
    // after a bake (or after a failure) and compare `decoded` across platforms before `ms`.
    worstTarget: () => (worst ? { ...worst, holes: holesBridged } : null),
    rotation,   // clockwise degrees the consumer must apply when drawing decoded frames
    fps: source.fps,   // measured source frame rate (0 = unknown) — nb_samples over the duration

    // Resolve the decoded frame covering `sec` (monotonic-friendly; backward
    // jumps pay a keyframe re-decode). The frame stays owned by the reader.
    async frameAt(sec) {
      if (closed) throw new Error('reader closed');
      const target = Math.max(0, Math.round(sec * 1e6));
      // ⚠️ B722 — ZERO THE PER-TARGET COUNTERS FIRST. THEY USED TO BE ZEROED LAST, WHICH MADE
      // `resets` A FIELD THAT COULD ONLY EVER READ ZERO.
      //
      // Every `resetTo` a target can cause happens ABOVE the old zeroing line — the backward jump,
      // `revFill`, and the long-forward-seek. So the reconfigure was counted and then wiped before
      // anything could read it, and **every failure message this arc has said "0 decoder resets"
      // whether or not the decoder reconfigured.** I used that zero at B720 to rule out a
      // reconfigure as the cause of the stall; that inference was not supported.
      //
      // `framesDecoded` had the same shape: frames decoded during a `revFill` were discarded from
      // the count, so the reverse window's cost never appeared in the conserved quantity that
      // exists to measure it.
      framesDecoded = 0; resetsForTarget = 0; gopWalk = 0;
      if (target < lastTargetUs) {
        // walking BACKWARDS (the bounce bake): serve from the reverse window when we can,
        // and refill it when we can't — one re-decode per window instead of per frame
        const hit = revLookup(target);
        if (hit) { lastTargetUs = target; return hit; }
        await revFill(target);
        const filled = revLookup(target);
        if (filled) { lastTargetUs = target; return filled; }
        resetTo(target);   // window didn't cover it (end of stream / timeout) — normal path
      } else if (revCache.length) {
        revClear();        // moving forward again: the window is dead weight
      }
      // A LONG FORWARD JUMP IS A SEEK, NOT A WALK (B604).
      //
      // This reader starts at sample 0 and `frameAt` walks forward to the target, which is right
      // for the frame-by-frame march a bake does — and catastrophic for the FIRST call, because
      // the trim's in-point can be minutes into the file. Baking a 30s loop from the middle of a
      // long clip decoded every frame from 0 to the in-point before producing anything: Daniel,
      // B603, "at the rate it started it felt like it might have taken 10+ minutes", against
      // seconds for the same trim taken from the head of the file.
      //
      // `resetTo` already binary-searches the sync points and re-configures the decoder — it was
      // just only ever used on the backward path. A forward jump past the next keyframe is the
      // same operation, and skipping to it costs one keyframe re-decode instead of thousands of
      // discarded frames. The threshold keeps the ordinary frame-to-frame march on the walk,
      // where it belongs, since a reset there would re-decode a GOP per frame.
      if (target > lastTargetUs + FORWARD_SEEK_US) {
        const nextKey = syncPoints.find((p) => p.us > lastTargetUs && p.us <= target);
        if (nextKey) resetTo(target);
      }
      lastTargetUs = target;
      // ⚠️ B720 — `gopWalk` RESETS PER TARGET NOW. B716 reset it only inside `resetTo`, so with
      // `resets: 0` it accumulated across every target since the last reconfigure and the failure
      // message's *"953 samples since the keyframe"* was not that at all — it was samples since
      // the last decoder reset, which may be the start of the file. **A label that names the wrong
      // span is worse than no label**, because it aims the next reader at GOP structure.
      // ⚠️ B716 — THE BUDGET SCALES WITH THE FRAME, BECAUSE 10s WAS A FLAT NUMBER MEETING VARIABLE WORK.
      //
      // Same shape as B700's first-frame deadline: a flat 8s that a 193MB clip missed by five
      // milliseconds. A 4K frame is ~4x the pixels of FHD and the GOP walk behind it costs
      // proportionally more, so one constant cannot serve both — and it is a very good match for
      // Daniel's own history (*"ipad historically has been reliable with FHD clips but has
      // struggled with baking higher res"*). FHD keeps exactly the 10s it has always had.
      //
      // ⚠️ RAISING IT IS NOT THE FIX AND MUST NOT BE MISTAKEN FOR ONE. It buys headroom so the
      // NEXT run reports a real number instead of stopping at the ceiling. If the bake now
      // succeeds, `worst.ms` is the measurement that says what the budget should actually be; if
      // it still fails, `worst.decoded` says whether the work itself is the problem.
      const mp = ((config.codedWidth || 1920) * (config.codedHeight || 1080)) / 1e6;
      const budgetMs = Math.min(30_000, Math.max(10_000, Math.round(mp * 4_000)));
      const t0 = performance.now();
      const deadline = t0 + budgetMs;   // a wedged decoder must not hang the render
      for (;;) {
        if (performance.now() > deadline) {
          const st = stallState(target);
          noteTarget(sec, performance.now() - t0, true, 'timeout', st);
          // ⚠️ THE LEADING NUMBER IS THE TARGET TIME, NOT THE ELAPSED TIME. The old wording
          // ("timed out at 30.982s") read as a duration, and a whole build's reasoning was aimed at
          // throughput because of it — with a 30s budget the two numbers even look alike.
          throw new Error(`decode stalled waiting for the frame at ${sec.toFixed(3)}s `
            + `(gave up after ${(budgetMs / 1000).toFixed(1)}s; decoded ${framesDecoded} frames, `
            + `${resetsForTarget} decoder reset${resetsForTarget === 1 ? '' : 's'}, `
            + `${gopWalk} samples fed for this target; held ${st.outQ} frames, `
            + `decode queue ${st.queue}, ${st.sinceOutputMs}ms since the last output, `
            + `fed ${st.fed}/${st.of}${st.flushDone ? ', flushed' : ''})`);
        }
        if (decErr) throw decErr;
        // drop frames that a LATER queued frame supersedes for this target
        while (outQ.length >= 2 && outQ[1].timestamp <= target) outQ.shift().close();
        if (outQ.length) {
          const f = outQ[0];
          const end = f.timestamp + (f.duration || 33_333);
          if (f.timestamp >= target) { noteTarget(sec, performance.now() - t0, false, 'ahead'); return f; }   // stream starts after target
          if (end > target) { noteTarget(sec, performance.now() - t0, false, 'cover'); return f; }            // target inside this frame
          // ⚠️ B721 — A HOLE IN THE PRESENTATION TIMELINE WAS AN UNESCAPABLE STATE.
          //
          // The two tests above ask "does a frame COVER the target". The drop above asks "does a
          // LATER frame supersede it". When the target falls between this frame's end and the next
          // frame's start, **neither is true and neither can become true** — every frame the decoder
          // can still produce sorts after `outQ[1]`, so nothing can ever land in the hole. The loop
          // then spins to the budget and throws on a file that is perfectly decodable.
          //
          // Two ordinary things open such a hole: a sample whose container duration is 0 (chunkOf
          // clamps it to 1µs, so the frame claims to last a microsecond) and a jump in presentation
          // time from VFR, a dropped slot or an edit list. And the bake asks for CONTINUOUS targets
          // (`t = p * outDur` in clip-editor) — they are never snapped to the source frame grid, so
          // landing inside a hole is not exotic.
          //
          // The rule is the one `revLookup` has always used twelve lines up: **the last frame at or
          // before the target covers it.** Only the backward path had it.
          //
          // This branch is reachable ONLY from the terminal state described above, so it cannot
          // change any answer the loop already produced — verified over 16,000 targets on four
          // well-formed CFR tables (scratchpad `waitloop-check.mjs`, and `holes` in the report is
          // how we find out whether it ever fires in the field).
          if (outQ.length >= 2 && outQ[1].timestamp > target) {
            holesBridged++;
            noteTarget(sec, performance.now() - t0, false, 'hole', { holeUs: outQ[1].timestamp - end });
            return f;
          }
          if (flushDone && outQ.length === 1 && i >= index.length) { noteTarget(sec, performance.now() - t0, false, 'eos'); return f; }   // last frame of the stream
        } else if (flushDone && i >= index.length) {
          throw new Error('decoder produced no frame for ' + sec.toFixed(3) + 's');
        }
        await feed();
        noteFrames();
        await new Promise((r) => setTimeout(r));   // let decoder outputs land
      }
    },

    // B728 — what this reader is holding right now, for the residue question. Read it BEFORE close().
    memBytes: () => ({ file: fileBytes, frames: (outQ.length + revCache.length) * frameBytes }),

    close() {
      if (closed) return;
      closed = true;
      drainQ();
      revClear();   // the reverse window owns its frames outright
      try { dec.close(); } catch { /* already closed */ }
      releaseSession(readerToken);   // B699 — paired with the acquire above; see its comment
      // ⚠️ THIS RECORDS THAT WE DROPPED THE REFERENCES. IT DOES NOT CLAIM WEBKIT COLLECTED THEM.
      // `heldMB` returning to zero while the NEXT bake still dies early is the signature of a GC or
      // engine-side residue rather than a retained reference — the two need opposite fixes, and D2
      // vs D3 already showed the residue is real without saying which kind it is.
      memRelease(framesId);
      // B732 — the SOURCE owns the sample table now and releases it when its last reader closes.
      try { onClosed?.(); } catch { /* an instrument must never break a teardown */ }
    },
  };
}
