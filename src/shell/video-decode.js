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

import * as MP4BoxModule from 'mp4box';

// mp4box ships UMD-flavored; take named exports wherever the bundler put them
const MP4Box = (MP4BoxModule.default && MP4BoxModule.default.createFile) ? MP4BoxModule.default : MP4BoxModule;

// Demux the whole file (they're already-loaded local blobs — the compressed
// bytes are a fraction of one decoded frame ceiling). Returns
// { track, samples, description } or null when this isn't demuxable.
function demux(buf) {
  const mp4 = MP4Box.createFile();
  let info = null, err = null;
  const samples = [];
  mp4.onError = (e) => { err = e || 'parse error'; };
  mp4.onSamples = (id, user, list) => { for (const s of list) samples.push(s); };
  // extraction must be armed INSIDE onReady — arming it after appendBuffer has
  // already processed the mdat yields zero samples (verified against 2.4.1)
  mp4.onReady = (i) => {
    info = i;
    const t = i.videoTracks && i.videoTracks[0];
    if (t) {
      mp4.setExtractionOptions(t.id, null, { nbSamples: 1000 });
      mp4.start();
    }
  };
  try {
    buf.fileStart = 0;
    mp4.appendBuffer(buf);
    mp4.flush();
  } catch { return null; }
  if (err || !info) return null;
  const track = info.videoTracks && info.videoTracks[0];
  if (!track || !samples.length) return null;

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
  return { track, samples, description, rotation };
}

// ISO track matrix → clockwise rotation in degrees (0/90/180/270). a=m[0], b=m[1] in 16.16.
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
    const buf = await res.arrayBuffer();
    const parsed = demux(buf);
    if (!parsed) return null;
    const { track, samples, rotation } = parsed;
    const durSec = track.duration && track.timescale ? track.duration / track.timescale : 0;
    const n = track.nb_samples || samples.length;
    return {
      fps: durSec > 0 && n > 1 ? n / durSec : 0,
      rotation,
      width: (track.video && track.video.width) || track.track_width || 0,
      height: (track.video && track.video.height) || track.track_height || 0,
    };
  } catch { return null; }
}

// createSequentialFrameReader(url) → reader | null (null = use the seek fallback)
export async function createSequentialFrameReader(url, { maxBytes = 1_500_000_000 } = {}) {
  if (typeof VideoDecoder === 'undefined' || !MP4Box.createFile) return null;

  let buf;
  try {
    const res = await fetch(url);
    buf = await res.arrayBuffer();
  } catch { return null; }
  if (!buf.byteLength || buf.byteLength > maxBytes) return null;

  const parsed = demux(buf);
  if (!parsed) return null;
  const { track, samples, description, rotation } = parsed;

  const config = {
    codec: track.codec,
    codedWidth: (track.video && track.video.width) || track.track_width || 0,
    codedHeight: (track.video && track.video.height) || track.track_height || 0,
    ...(description ? { description } : {}),
  };
  try {
    const s = await VideoDecoder.isConfigSupported(config);
    if (!s || !s.supported) return null;
  } catch { return null; }

  const usOf = (s) => Math.round((s.cts * 1e6) / s.timescale);
  const chunkOf = (s) => new EncodedVideoChunk({
    type: s.is_sync ? 'key' : 'delta',
    timestamp: usOf(s),
    duration: Math.max(1, Math.round((s.duration * 1e6) / s.timescale)),
    data: s.data,
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
        if (f.timestamp + (f.duration || 33_333) > targetUs) { covered = true; break; }
      }
      if (covered) break;
      if (flushDone && i >= samples.length) break;   // end of stream
      feed();
      await new Promise((r) => setTimeout(r));
    }
  }

  function makeDecoder() {
    const d = new VideoDecoder({
      output: (f) => { if (closed) f.close(); else outQ.push(f); },
      error: (e) => { decErr = e; },
    });
    d.configure(config);
    return d;
  }
  dec = makeDecoder();

  function feed() {
    while (i < samples.length && dec.decodeQueueSize < 24 && outQ.length < 12) {
      dec.decode(chunkOf(samples[i++]));
    }
    if (i >= samples.length && !flushing) {
      flushing = true;
      dec.flush().then(() => { flushDone = true; }, () => { /* reset() aborts a flush */ });
    }
  }

  function drainQ() {
    for (const f of outQ) f.close();
    outQ = [];
  }

  // Sync points as (decode-order index, presentation time), sorted by TIME. Built once
  // so a backward jump is a binary search instead of a scan — and, more importantly, so
  // it is CORRECT: see resetTo.
  const syncPoints = [];
  for (let j = 0; j < samples.length; j++) {
    if (samples[j].is_sync) syncPoints.push({ j, us: usOf(samples[j]) });
  }
  syncPoints.sort((a, b) => a.us - b.us);

  // backward jump: re-decode from the last keyframe at/before the target.
  //
  // (The previous scan walked `samples` in DECODE order and broke on the first cts past
  // the target. A harness over IPBB-reordered tables showed it agrees with the correct
  // answer on well-formed input, so it was NOT the bounce stall — but its early break is
  // a real hazard on unusual tables and it was O(n) per reset. The time-sorted binary
  // search below can't be fooled by reordering and costs O(log n).)
  function resetTo(targetUs) {
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
  }

  return {
    width: config.codedWidth,
    height: config.codedHeight,
    rotation,   // clockwise degrees the consumer must apply when drawing decoded frames
    // measured source frame rate (0 = unknown) — nb_samples over the track's duration
    fps: (() => {
      const durSec = track.duration && track.timescale ? track.duration / track.timescale : 0;
      const n = track.nb_samples || samples.length;
      return durSec > 0 && n > 1 ? n / durSec : 0;
    })(),

    // Resolve the decoded frame covering `sec` (monotonic-friendly; backward
    // jumps pay a keyframe re-decode). The frame stays owned by the reader.
    async frameAt(sec) {
      if (closed) throw new Error('reader closed');
      const target = Math.max(0, Math.round(sec * 1e6));
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
      const deadline = performance.now() + 10_000;   // a wedged decoder must not hang the render
      for (;;) {
        if (performance.now() > deadline) {
          throw new Error(`decode timed out at ${sec.toFixed(3)}s (10s budget for one frame — `
            + `usually a very long keyframe interval, or a backward seek re-decoding too much)`);
        }
        if (decErr) throw decErr;
        // drop frames that a LATER queued frame supersedes for this target
        while (outQ.length >= 2 && outQ[1].timestamp <= target) outQ.shift().close();
        if (outQ.length) {
          const f = outQ[0];
          const end = f.timestamp + (f.duration || 33_333);
          if (f.timestamp >= target) return f;                    // stream starts after target
          if (end > target) return f;                             // target inside this frame
          if (flushDone && outQ.length === 1 && i >= samples.length) return f;   // last frame of the stream
        } else if (flushDone && i >= samples.length) {
          throw new Error('decoder produced no frame for ' + sec.toFixed(3) + 's');
        }
        feed();
        await new Promise((r) => setTimeout(r));   // let decoder outputs land
      }
    },

    close() {
      if (closed) return;
      closed = true;
      drainQ();
      revClear();   // the reverse window owns its frames outright
      try { dec.close(); } catch { /* already closed */ }
    },
  };
}
