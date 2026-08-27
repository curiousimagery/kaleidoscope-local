// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// conduit/encode.js
//
// Shared WebCodecs codec discovery — the ONE place that decides what this
// device can encode, used by every consumer that feeds an mp4: the live
// recorder sink (recorder.js) and the host app's offline video export
// (Fold's shell/video-export.js imports from here). Keeping discovery here
// means the resolution UI, the offline exporter, and the live recorder can
// never disagree about what's encodable.

// Codec strings for WebCodecs configure() + isConfigSupported(). H.264 High@5.1
// tops out at 4K (the level caps frame size, and most hardware H.264 encoders
// cap there too), so anything larger uses HEVC, which has hardware encode on
// Apple Silicon (Safari) and lifts the 4K wall. mp4-muxer supports both
// container codecs, so HEVC adds no dependency.
const AVC_CODEC = 'avc1.640033';        // H.264 High profile, level 5.1
const HEVC_CODEC = 'hvc1.1.6.L186.B0';  // HEVC Main profile, level 6.2 (covers 6K/8K)

// ~0.1 bits/pixel/frame for high-detail content, clamped 4–120 Mbps (the
// ceiling was raised from 80 to give 6K/8K room).
// ⚠️ B753 — BITS PER PIXEL PER FRAME IS NOW A CHOICE, AND 0.1 WAS NEVER A GOOD DEFAULT.
//
// The old constant here was a hardcoded 0.1 bpp, which is **24.9 Mbps at 4K30**. Daniel's own 4K
// source is 55.8 Mbps, so we were re-encoding to 45% of the input — and below YouTube's RECOMMENDED
// UPLOAD rate (35-45 Mbps) for footage that has already been through a camera encoder.
//
// **Kaleidoscope output is close to the worst case for an encoder**: high-frequency detail across
// the whole frame, mirrored and rotating, so inter-frame prediction barely helps and nearly every
// frame is a new frame. The result was visible macroblocking in every render, which Daniel found by
// comparing against a live broadcast — a path with NO encoder in it at all.
//
// It is nearly free to fix: measured `msPerFrame` on an M1 iPad is `enc 3.27` against `vframe
// 11.45`, so the encode is the smallest stage in the pipeline and the render is not encode-bound.
export const BPP_TIERS = [
  { id: 'draft', bpp: 0.10, label: 'draft' },   // what every render before B753 used
  { id: 'good',  bpp: 0.20, label: 'good'  },
  { id: 'high',  bpp: 0.30, label: 'high'  },   // the default
  { id: 'max',   bpp: 0.45, label: 'max'   },
];
export const DEFAULT_BPP = 0.30;

// ⚠️ THE CEILING IS REAL AND IT BITES AT 8K, WHICH IS WHY THE UI HAS TO SAY SO.
// 120 Mbps is well under what H.264 High 5.1 permits, so this is a conservative choice rather than
// a codec limit — but while it stands, 8K30 tops out at 0.12 bpp and every tier above `draft` is
// INOPERATIVE there. Silently clamping is exactly the "photos dropped to 8-bit without telling us"
// failure Daniel named, so `maxBppFor` exists to let the picker disable those tiers BY NAME.
export const MAX_VIDEO_BITRATE = 120_000_000;
export const MIN_VIDEO_BITRATE = 4_000_000;

export function maxBppFor(width, height, fps) {
  const px = Math.max(1, width * height * fps);
  return MAX_VIDEO_BITRATE / px;
}

export function videoBitrateFor(width, height, fps, bpp = DEFAULT_BPP) {
  const want = Math.round(width * height * fps * (bpp > 0 ? bpp : DEFAULT_BPP));
  return Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, want));
}

// Resolve the video codec to use for an output size on THIS device, or null if
// none can encode it. Prefers H.264 at <=4K (universal); uses HEVC above (and
// as a fallback at <=4K if H.264 isn't available).
// → { muxerCodec: 'avc'|'hevc', codec, bitrate } | null
export async function pickVideoCodec(width, height, fps, bpp = DEFAULT_BPP) {
  if (typeof VideoEncoder === 'undefined') return null;
  const bitrate = videoBitrateFor(width, height, fps, bpp);
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

// Resolve the audio codec for a mic capture, or null if this browser can't
// encode audio via WebCodecs. AAC first (universal mp4 playback — QuickTime,
// Photos, Resolume all read it); Opus as the fallback where the platform has
// no AAC encoder (Opus-in-mp4 plays in Chromium/VLC but not QuickTime — no
// worse than the WebM those browsers produced before). Opus only encodes at
// 48kHz, so it's only offered when the capture context runs at 48k.
// → { muxerCodec: 'aac'|'opus', codec, bitrate } | null
export async function pickAudioCodec(sampleRate, numberOfChannels) {
  if (typeof AudioEncoder === 'undefined') return null;
  const bitrate = 128_000;
  const tries = [['aac', 'mp4a.40.2']];
  if (sampleRate === 48000) tries.push(['opus', 'opus']);
  for (const [muxerCodec, codec] of tries) {
    try {
      const s = await AudioEncoder.isConfigSupported({ codec, sampleRate, numberOfChannels, bitrate });
      if (s && s.supported) return { muxerCodec, codec, bitrate };
    } catch { /* try next codec */ }
  }
  return null;
}
