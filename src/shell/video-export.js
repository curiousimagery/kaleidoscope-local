// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/video-export.js
//
// Render a still-animation loop to an MP4 (H.264) frame by frame, using the
// WebCodecs VideoEncoder piped into mp4-muxer. This is the Host-layer video
// export service (Phase 4). The engine renders each interpolated frame straight
// to its GL canvas at the chosen w×h (non-square aspect handled in the shader)
// and the canvas is wrapped directly in a VideoFrame — no readPixels / Y-flip /
// putImageData (the single-core CPU bottleneck). Frame-perfect and faster than
// real time, unlike a MediaRecorder canvas capture.
//
// WebCodecs is required (Chrome, Safari 16+/iPadOS 16+). When unavailable the
// caller gets an error tagged `code === 'unsupported'`. A MediaRecorder fallback
// is a tracked follow-up.

import { Muxer, StreamTarget } from 'mp4-muxer';
import { memHold, memGrow, memRelease } from './mem-ledger.js';
import { pickVideoCodec } from 'conduit/encode';

export function videoExportSupported() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

// Codec discovery lives in the conduit now (conduit/encode.js) so the offline
// exporter, the resolution UI, and the live WebCodecs recorder sink can never
// disagree about what this device encodes. Re-exported for existing callers
// (motion-runtime gates the resolution picker on it).
export { pickVideoCodec };

// exportVideo({ frameAt, onBegin, onEnd, width, height, fps, durationMs, onProgress, shouldCancel })
//   frameAt    — (p: 0..1) => CanvasImageSource (canvas), optionally async (a video
//                source awaits a per-frame seek before capturing) — awaited each frame
//   onBegin/onEnd — optional setup/teardown around the frame loop (e.g. the engine's
//                   beginCapture/endCapture, which borrows the preview canvas)
//   width/height — even pixel dimensions of the output (caller clamps to GPU max)
//   fps, durationMs — frame rate and total loop length
//   onProgress — (0..1) => void   (optional)
//   shouldCancel — () => boolean  (optional; checked each frame)
//   glLost — () => boolean  (optional; checked each frame — see the guard below)
// → { blob, ext: 'mp4', frames } | throws (err.code === 'unsupported' / 'cancelled' / 'gl-lost')
//
// ⚠️ B705 — THE CONTEXT-LOST GUARD, AND WHAT IT IS AND IS NOT FOR.
//
// It does NOT prevent a context loss. Nothing in JS can stop the WebKit GPU process from dying,
// and this arc's evidence (`docs/temp/821-contextLoss-02.json`) is that it dies for reasons outside
// the render loop. What this guard does is stop the render the moment the context goes, so:
//
//   1. the job fails with a NAMED error at a KNOWN frame, instead of dying mute. Daniel lost a
//      3193-frame render at B704 and the export contributed no diagnostic of its own, because the
//      only abort condition in this loop was `shouldCancel`;
//   2. we stop feeding a dead context. The loop was calling `frameAt` for every remaining frame
//      after the context died — thousands of GL calls into nothing. That is plausibly a
//      CONTRIBUTOR to the process death rather than only a casualty of it, which is why the guard
//      may reduce the blast radius even though it cannot address the cause.
//
// Resuming a killed render is deliberately NOT attempted here — that needs the muxer, the encoder
// and the source clock to agree on a restart point, and belongs with the stage-manager teardown
// work rather than riding along in an instrumentation build.
export async function exportVideo({ frameAt, onBegin, onEnd, width, height, fps, durationMs, onProgress, shouldCancel, glLost, captureMode = '2d' }) {
  if (!videoExportSupported()) {
    const e = new Error('Video export needs a browser with WebCodecs (Chrome, or Safari 16+ / iPadOS 16+).');
    e.code = 'unsupported';
    throw e;
  }

  const frames = Math.max(2, Math.round((durationMs / 1000) * fps));

  // Pick the best-supported codec for this size (H.264 <=4K, HEVC above), and
  // confirm the device can encode it before committing.
  const picked = await pickVideoCodec(width, height, fps);
  if (!picked) {
    const e = new Error(`This browser can't encode video at ${width}×${height}. Try a smaller resolution.`);
    e.code = 'unsupported';
    throw e;
  }
  const { codec, muxerCodec, bitrate } = picked;

  // ⚠️ B734 — THE OUTPUT NO LONGER ACCUMULATES IN THE HEAP, AND FAST START IS PRESERVED.
  //
  // `ArrayBufferTarget` + `fastStart: 'in-memory'` held the ENTIRE encoded result in memory and
  // reallocated and copied as it grew, so its real transient was roughly double what the ledger
  // counted. **That is the whole desktop ceiling** — a 47:45 FHD bake died with
  // `Array buffer allocation failed` on a 64GB M1 Max — and on the iPad it is the term that grows
  // through the encode, which is where the bake now fails (frame 2116 of 3178, with ~967MB
  // attributed, BELOW the 1441MB peak the same run had already survived).
  //
  // ⚠️ THE FORMAT DOES NOT CHANGE. Daniel, 2026-08-24: *"the bake output should be durable and
  // optimized for export to other applications."* That rules out `fastStart: false` (moov at the
  // end) and `'fragmented'` (fMP4), which were the two options I first offered and both of which
  // trade file compatibility for memory. **`fastStart: { expectedVideoChunks }` is the third: it
  // RESERVES space for the metadata up front, so the moov still lands at the front of the file and
  // nothing has to be buffered to compute it.** We know the frame count exactly.
  //
  // Writes land as Blob parts, which the browser backs on disk, so the heap holds at most
  // FLUSH_BYTES of pending output at a time regardless of how long the clip is.
  const FLUSH_BYTES = 8 * 1024 * 1024;
  let parts = [];          // finished Blob pieces, in file order
  let pending = [];        // Uint8Array writes not yet flushed into a Blob
  let pendingBytes = 0, writePos = 0;
  const backfills = [];    // out-of-order writes — in practice only the reserved moov, at finalize
  const flushPending = () => {
    if (!pending.length) return;
    parts.push(new Blob(pending));
    pending = []; pendingBytes = 0;
  };
  let outBytes = 0;
  const outId = memHold('encoder-output', 0);
  const muxer = new Muxer({
    target: new StreamTarget({
      onData: (data, position) => {
        // `data` is a view onto the muxer's own scratch buffer, so it MUST be copied before it is
        // handed to a Blob that will outlive this call. A view retained here reads as corruption
        // later, in the finished file, with nothing pointing back at this line.
        const copy = data.slice();
        if (position === writePos) {
          pending.push(copy);
          pendingBytes += copy.byteLength;
          writePos += copy.byteLength;
          if (pendingBytes >= FLUSH_BYTES) flushPending();
        } else {
          backfills.push({ position, data: copy });
        }
      },
    }),
    video: { codec: muxerCodec, width, height, frameRate: fps },
    fastStart: { expectedVideoChunks: frames },
  });

  let encError = null;
  const encoder = new VideoEncoder({
    // B728 — the encoded bytes, which is what makes "how long a clip can this device bake"
    // arithmetic rather than folklore. Since B734 this is a THROUGHPUT figure rather than a resident
    // one: the output goes to disk-backed Blob parts, so the heap holds at most FLUSH_BYTES of it.
    output: (chunk, meta) => { outBytes += chunk.byteLength; memGrow(outId, Math.min(outBytes, FLUSH_BYTES)); muxer.addVideoChunk(chunk, meta); },
    error: (e) => { encError = e; },
  });
  // NOTE: we tried `hardwareAcceleration: 'prefer-hardware'` (Build 127) and it
  // made ZERO measurable difference on Safari — 8K HEVC stayed ~1 fps on a single
  // pegged core both with and without it. So this export path is CPU / color-
  // conversion bound (per-frame canvas→VideoFrame + sequential encode), not
  // encoder-SELECTION bound; the hint was inert here, so we keep the default
  // ('no-preference'). Real multi-core / hardware-encode throughput is a native-
  // wrapper concern (FOLD.md Phase 4), not something this browser path can reach.
  encoder.configure({ codec, width, height, bitrate, framerate: fps });

  const frameDur = Math.round(1_000_000 / fps);   // microseconds
  const gop = Math.max(1, Math.round(fps * 2));    // keyframe every ~2s

  // Per-stage timing accumulators (ms) — a diagnostic to localize the single-
  // threaded export bottleneck (cost scales ~linearly with output pixels):
  //   glMs  = frameAt (GL render + GL→2D capture blit)
  //   vfMs  = VideoFrame construction (the suspected per-frame color conversion)
  //   encMs = encoder backpressure wait + flush — where the real, sequential
  //           encode throughput shows up, since encode() itself only queues.
  let glMs = 0, vfMs = 0, encMs = 0;

  try {
    // Each frame is a canvas (from frameAt) wrapped directly in a VideoFrame — no
    // readPixels / Y-flip / putImageData. onBegin/onEnd wrap any setup the frame
    // source needs (e.g. the engine's capture session).
    onBegin?.();
    for (let i = 0; i < frames; i++) {
      if (shouldCancel && shouldCancel()) { const e = new Error('cancelled'); e.code = 'cancelled'; throw e; }
      // ⚠️ CHECKED BEFORE `frameAt`, NOT AFTER — the point is to not make the call at all.
      // The error carries the frame index because "it died at frame 1847 of 3193" is the whole
      // diagnostic; "the render failed" is what we had before and it aimed nobody anywhere.
      if (glLost && glLost()) {
        const e = new Error(`graphics context lost at frame ${i} of ${frames}`);
        e.code = 'gl-lost'; e.frame = i; e.frames = frames;
        throw e;
      }
      if (encError) throw encError;

      let t = performance.now();
      // ⚠️ B709 — `frameAt` IS ASYNC AND LONG, SO THE CONTEXT CAN DIE INSIDE IT.
      //
      // The guard above runs BEFORE the call, which is right but not sufficient: on a video source
      // this awaits a 4K seek, and a loss during that await surfaces as whatever GL error the
      // capture raises rather than as `gl-lost`. Daniel's first bake in
      // `docs/temp/8-21-contextLoss-06.json` lost the context at 07:21:01.509 and produced **no
      // `export-aborted` mark at all** — the error escaped as something else, so the trail could
      // not say what had killed the render. Re-check after the await and re-label.
      let cv;
      try {
        cv = await frameAt(i / frames);   // may be async (video source seeks the footage per frame)
      } catch (err) {
        if (glLost && glLost()) {
          const e = new Error(`graphics context lost at frame ${i} of ${frames}`);
          e.code = 'gl-lost'; e.frame = i; e.frames = frames; e.cause = err;
          throw e;
        }
        throw err;
      }
      if (glLost && glLost()) {   // survived the call but the context went during it
        const e = new Error(`graphics context lost at frame ${i} of ${frames}`);
        e.code = 'gl-lost'; e.frame = i; e.frames = frames;
        throw e;
      }
      glMs += performance.now() - t;

      // vframe bucket = whatever it takes to get an encodable VideoFrame for this
      // mode (the Safari bottleneck). EXPERIMENT (Build 130): 'bitmap' routes through
      // createImageBitmap; 'gl' wraps the WebGL canvas directly (cv is already the
      // GL canvas via captureFrameGL); '2d' is the proven 2D-canvas path.
      t = performance.now();
      let frame, bmp;
      if (captureMode === 'bitmap') {
        bmp = await createImageBitmap(cv);
        frame = new VideoFrame(bmp, { timestamp: i * frameDur, duration: frameDur });
      } else {
        frame = new VideoFrame(cv, { timestamp: i * frameDur, duration: frameDur });
      }
      vfMs += performance.now() - t;

      // ⚠️ B707 — REPORT THE CAUSE, NOT THE CONSEQUENCE.
      //
      // When a VideoEncoder errors, its state leaves 'configured' and the NEXT `encode()` throws
      // synchronously with `VideoEncoder is not configured` — which is what Daniel saw ~3/4 through
      // a 2635-frame 4K bake (`docs/temp/8-21-26-contextLoss-05.json`). That message describes the
      // state we found the encoder in, **not what broke it**, and it beats the `encError` check at
      // the top of the loop because a synchronous throw does not wait for the next iteration.
      //
      // The real reason is already in `encError` (the encoder's own `error` callback). Prefer it.
      try {
        encoder.encode(frame, { keyFrame: i % gop === 0 });
      } catch (err) {
        if (encError) throw encError;                       // the cause, if the encoder told us one
        if (encoder.state !== 'configured') {
          const e2 = new Error(`encoder stopped at frame ${i} of ${frames} (state: ${encoder.state})`);
          e2.code = 'encoder-stopped'; e2.frame = i; e2.frames = frames; e2.state = encoder.state;
          throw e2;
        }
        throw err;
      }
      frame.close();
      bmp?.close();

      // yield so the progress UI updates; throttle if the encoder queue backs up.
      if (i % 3 === 0) { onProgress?.(i / frames); await new Promise((r) => setTimeout(r)); }
      t = performance.now();
      while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r));
      encMs += performance.now() - t;
    }

    const tFlush = performance.now();
    await encoder.flush();
    encMs += performance.now() - tFlush;
    if (encError) throw encError;
    muxer.finalize();
    flushPending();
    // Splice the reserved-metadata backfill into place. `Blob.slice` does not copy, so this is
    // cheap however long the clip is — the whole point of keeping the parts as Blobs.
    let blob = new Blob(parts, { type: 'video/mp4' });
    for (const { position, data } of backfills) {
      const end = position + data.byteLength;
      // ⚠️ REFUSE TO SHIP A FILE WE CANNOT ASSEMBLE. A backfill past the end means our model of the
      // muxer's write pattern is wrong, and the failure mode of guessing here is a CORRUPT EXPORT
      // that looks fine until Daniel opens it in Arena. Loud beats plausible.
      if (end > blob.size) {
        const e = new Error('the muxer wrote past the end of the file while finalising');
        e.code = 'mux-assembly';
        throw e;
      }
      blob = new Blob([blob.slice(0, position), data, blob.slice(end)], { type: 'video/mp4' });
    }
    onProgress?.(1);
    return { blob, ext: 'mp4', frames, timing: { frames, glMs, vfMs, encMs } };
  } finally {
    onEnd?.();
    try { if (encoder.state !== 'closed') encoder.close(); } catch { /* already closed */ }
    // ⚠️ RELEASED ON EVERY EXIT, INCLUDING THE ABORTED ONES. An export that is cancelled or dies on
    // a lost context still built its buffer, and a ledger that only balances on the happy path
    // would report a leak on exactly the runs being investigated for one.
    memRelease(outId);
  }
}
