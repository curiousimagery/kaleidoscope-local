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

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export function videoExportSupported() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

// Codec strings for WebCodecs configure() + isConfigSupported(). H.264 High@5.1
// tops out at 4K (the level caps frame size, and most hardware H.264 encoders
// cap there too), so anything larger uses HEVC, which has hardware encode on
// Apple Silicon (Safari) and lifts the 4K wall. mp4-muxer already supports both
// container codecs, so HEVC adds no dependency.
const AVC_CODEC = 'avc1.640033';        // H.264 High profile, level 5.1
const HEVC_CODEC = 'hvc1.1.6.L186.B0';  // HEVC Main profile, level 6.2 (covers 6K/8K)

// ~0.1 bits/pixel/frame for this high-detail content, clamped 4–120 Mbps (the
// ceiling was raised from 80 to give 6K/8K room).
function bitrateFor(width, height, fps) {
  return Math.min(120_000_000, Math.max(4_000_000, Math.round(width * height * fps * 0.1)));
}

// Resolve the codec to use for an output size on THIS device, or null if none
// can encode it. Prefers H.264 at <=4K (universal); uses HEVC above (and as a
// fallback at <=4K if H.264 isn't available). Used to BOTH gate the resolution
// UI and pick the encoder config inside exportVideo, so they always agree.
// → { muxerCodec: 'avc'|'hevc', codec, bitrate } | null
export async function pickVideoCodec(width, height, fps) {
  if (typeof VideoEncoder === 'undefined') return null;
  const bitrate = bitrateFor(width, height, fps);
  const big = Math.max(width, height) > 4096;
  const tries = big
    ? [['hevc', HEVC_CODEC]]
    : [['avc', AVC_CODEC], ['hevc', HEVC_CODEC]];
  for (const [muxerCodec, codec] of tries) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate, framerate: fps });
      if (s && s.supported) return { muxerCodec, codec, bitrate };
    } catch { /* try next codec */ }
  }
  return null;
}

// exportVideo({ frameAt, onBegin, onEnd, width, height, fps, durationMs, onProgress, shouldCancel })
//   frameAt    — (p: 0..1) => a CanvasImageSource (canvas) for that point in the loop
//   onBegin/onEnd — optional setup/teardown around the frame loop (e.g. the engine's
//                   beginCapture/endCapture, which borrows the preview canvas)
//   width/height — even pixel dimensions of the output (caller clamps to GPU max)
//   fps, durationMs — frame rate and total loop length
//   onProgress — (0..1) => void   (optional)
//   shouldCancel — () => boolean  (optional; checked each frame)
// → { blob, ext: 'mp4', frames } | throws (err.code === 'unsupported' / 'cancelled')
export async function exportVideo({ frameAt, onBegin, onEnd, width, height, fps, durationMs, onProgress, shouldCancel, captureMode = '2d' }) {
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

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: muxerCodec, width, height, frameRate: fps },
    fastStart: 'in-memory',
  });

  let encError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
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
      if (encError) throw encError;

      let t = performance.now();
      const cv = frameAt(i / frames);
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

      encoder.encode(frame, { keyFrame: i % gop === 0 });
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
    onProgress?.(1);
    return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), ext: 'mp4', frames, timing: { frames, glMs, vfMs, encMs } };
  } finally {
    onEnd?.();
    try { if (encoder.state !== 'closed') encoder.close(); } catch { /* already closed */ }
  }
}
