// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/frame-header.js
//
// THE ONE PARSER for the native frame-socket wire format. Producers are the
// `FrameSocketServer.swift` in each plugin (camera on 8899, video on 8900);
// consumers are `native-camera.js` (engine planes + source-panel preview) and
// `native-frame-receiver.js` (the external display's WKWebView, which does not
// own the decode).
//
// WHY THIS FILE EXISTS. The offsets used to be written out twice, once per
// consumer. B540 added a timestamped camera variant and updated only one of
// them, so the other rejected every frame as an unknown magic: the source panel
// went dark in all capture modes while the overlay kept drawing on top of it,
// and it cost a build to find. Two parsers for one wire format cannot be kept
// in sync by discipline — a format change has to be impossible to half-apply.
//
// THREE VARIANTS. All share the same first 24 bytes; the two 40-byte forms
// differ only in what the SECOND f64 means, which is exactly the distinction
// that must not be guessed at:
//
//   "FYUV" — 24 bytes. Clockless. The camera before B540.
//   "FYUX" — 40 bytes = the same fields + f64 capture pts + f64 capture-to-delivery
//            LATENCY (seconds). The camera now. Cinematic stabilization buffers
//            frames for lookahead, so arrival time is not capture time; stamping
//            arrival pushed recorded video behind recorded audio. `pts` is on the
//            capture clock and is not comparable to `performance.now()`, so only
//            `latencySec` is usable downstream.
//   "FYUW" — 40 bytes = the same fields + f64 pts + f64 DURATION (seconds). The
//            video decode, which owns the motion runtime's master clock. Reading
//            its duration as a latency (or vice versa) silently corrupts that
//            clock rather than failing, which is why they carry distinct magics.
//
// Header layout, all little-endian after the big-endian magic:
//   0  u32 magic (BE)   4  u32 width      8  u32 height
//   12 u32 yStride     16 u32 cStride    20 u32 cHeight
//   24 f64 pts         32 f64 latency|duration        (40-byte forms only)

const MAGIC_PLAIN = 0x46595556;     // "FYUV" — camera, clockless
const MAGIC_STAMPED = 0x46595557;   // "FYUW" — video, pts + duration
const MAGIC_CAM_TIMED = 0x46595558; // "FYUX" — camera, pts + latency

/**
 * Parse a frame-socket message into planes plus whatever timing it carried.
 *
 * Returns null — never throws, and never a partial frame — for anything a
 * caller should treat as "hold the last frame": no buffer, a stray non-frame
 * message, an unknown magic, or a payload too short for the planes its own
 * header describes. That last case used to throw a RangeError out of the
 * external-display receiver mid-render-tick; a truncated frame is a dropped
 * frame, not a broken loop.
 *
 * `stamped` means the VIDEO wire specifically. It gates the motion clock, so it
 * must stay false for the camera's timed variant even though both are 40 bytes.
 */
export function parseFrameHeader(buf) {
  if (!buf || buf.byteLength < 24) return null;
  const dv = new DataView(buf);
  const magic = dv.getUint32(0, false);
  if (magic !== MAGIC_PLAIN && magic !== MAGIC_STAMPED && magic !== MAGIC_CAM_TIMED) return null;

  const width = dv.getUint32(4, true);
  const height = dv.getUint32(8, true);
  const yStride = dv.getUint32(12, true);
  const cStride = dv.getUint32(16, true);
  const cHeight = dv.getUint32(20, true);

  const timed = magic !== MAGIC_PLAIN;
  const head = timed ? 40 : 24;
  let pts = 0, duration = 0, latencySec = null;
  if (timed) {
    if (buf.byteLength < 40) return null;
    pts = dv.getFloat64(24, true);
    // the one byte-identical field with two meanings — resolved by magic, never by size
    const second = dv.getFloat64(32, true);
    if (magic === MAGIC_STAMPED) duration = second;
    else latencySec = second >= 0 ? second : null;
  }

  const ySize = yStride * height;
  const cSize = cStride * cHeight;
  if (buf.byteLength < head + ySize + cSize) return null;

  return {
    width, height, yStride, cStride, cHeight,
    pts, duration, latencySec,
    stamped: magic === MAGIC_STAMPED,
    yPlane: new Uint8Array(buf, head, ySize),
    cPlane: new Uint8Array(buf, head + ySize, cSize),
  };
}
