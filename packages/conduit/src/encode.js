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
export function videoBitrateFor(width, height, fps) {
  return Math.min(120_000_000, Math.max(4_000_000, Math.round(width * height * fps * 0.1)));
}

// Resolve the video codec to use for an output size on THIS device, or null if
// none can encode it. Prefers H.264 at <=4K (universal); uses HEVC above (and
// as a fallback at <=4K if H.264 isn't available).
// → { muxerCodec: 'avc'|'hevc', codec, bitrate } | null
export async function pickVideoCodec(width, height, fps) {
  if (typeof VideoEncoder === 'undefined') return null;
  const bitrate = videoBitrateFor(width, height, fps);
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
