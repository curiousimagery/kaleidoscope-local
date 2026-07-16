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
  // minus its own 8-byte box header — the shape VideoDecoder wants
  let description = null;
  try {
    const trak = mp4.getTrackById(track.id);
    const entry = trak.mdia.minf.stbl.stsd.entries.find((e) => e.avcC || e.hvcC || e.vpcC || e.av1C);
    const box = entry && (entry.avcC || entry.hvcC || entry.vpcC || entry.av1C);
    if (box) {
      const ds = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
      box.write(ds);
      description = new Uint8Array(ds.buffer, 8);
    }
  } catch { /* some codecs carry their config in-band */ }
  return { track, samples, description };
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
  const { track, samples, description } = parsed;

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
  let closed = false;

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

  // backward jump: re-decode from the last keyframe at/before the target
  function resetTo(targetUs) {
    drainQ();
    try { dec.reset(); } catch { /* already closed */ }
    try { dec.configure(config); } catch { dec = makeDecoder(); }
    flushing = false; flushDone = false;
    let k = 0;
    for (let j = 0; j < samples.length; j++) {
      if (samples[j].is_sync && usOf(samples[j]) <= targetUs) k = j;
      if (usOf(samples[j]) > targetUs && j > 0) break;
    }
    i = k;
  }

  return {
    width: config.codedWidth,
    height: config.codedHeight,

    // Resolve the decoded frame covering `sec` (monotonic-friendly; backward
    // jumps pay a keyframe re-decode). The frame stays owned by the reader.
    async frameAt(sec) {
      if (closed) throw new Error('reader closed');
      const target = Math.max(0, Math.round(sec * 1e6));
      if (target < lastTargetUs) resetTo(target);
      lastTargetUs = target;
      const deadline = performance.now() + 10_000;   // a wedged decoder must not hang the render
      for (;;) {
        if (performance.now() > deadline) throw new Error('decoder stalled at ' + sec.toFixed(3) + 's');
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
      try { dec.close(); } catch { /* already closed */ }
    },
  };
}
