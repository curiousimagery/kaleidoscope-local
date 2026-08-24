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
        // B721 — the second test is the same hole as the forward loop's. `revLookup` already
        // returns the last frame at/before the target, so once we have decoded PAST the target
        // the window holds the answer; without this, a hole burned the full 9s deadline first.
        if (f.timestamp + (f.duration || 33_333) > targetUs) { covered = true; break; }
        if (f.timestamp > targetUs) { covered = true; break; }
      }
      if (covered) break;
      if (flushDone && i >= samples.length) break;   // end of stream
      feed();
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

  function feed() {
    while (i < samples.length && dec.decodeQueueSize < 24 && outQ.length < 12) {
      dec.decode(chunkOf(samples[i++])); gopWalk++;
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
      of: samples.length,
      flushDone,
      sinceOutputMs: lastOutputAt ? Math.round(performance.now() - lastOutputAt) : -1,
      headEndUs: head ? (head.timestamp + (head.duration || 33_333)) - target : null,
      nextStartUs: next ? next.timestamp - target : null,
    };
  }

  function resetTo(targetUs) {
    resetsForTarget++;
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
    // B716 — the most expensive single target this reader served, success or timeout. Read it
    // after a bake (or after a failure) and compare `decoded` across platforms before `ms`.
    worstTarget: () => (worst ? { ...worst, holes: holesBridged } : null),
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
      framesDecoded = 0; resetsForTarget = 0; gopWalk = 0;
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
          if (flushDone && outQ.length === 1 && i >= samples.length) { noteTarget(sec, performance.now() - t0, false, 'eos'); return f; }   // last frame of the stream
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
      releaseSession(readerToken);   // B699 — paired with the acquire above; see its comment
    },
  };
}
