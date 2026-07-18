// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// conduit/frame-wire.js
//
// The FNDI frame-socket wire format — how a webview streams program frames to
// a native consumer over a localhost socket (the pattern behind the Capacitor
// NDI sender; base64-over-bridge can't sustain 1080p30, a loopback socket can).
//
// Message = 16-byte header + pixels:
//   [0..4)   magic "FNDI" (big-endian constant 0x464E4449)
//   [4..8)   width  (u32 LE)
//   [8..12)  height (u32 LE)
//   [12..16) flags  (u32 LE)  bit0 = topDown (consumers want top-down; this
//                             builder folds any flip into its copy, so the
//                             wire is ALWAYS top-down)
//                             bit1 = UYVY 4:2:2 (2 bytes/px — half the wire
//                             bytes of RGBA; WebKit's WS send path is the
//                             measured fps wall). BT.709 limited range.
//   pixels: width * height * (4 RGBA | 2 UYVY) bytes
//
// UYVY stays OPT-IN pending a device-paired color pass (an Arena test showed
// a blue cast — see the parked investigation in the host app's BACKLOG).

export const FNDI_HEADER = 16;
export const FNDI_MAGIC = 0x464E4449;

// BT.709 limited-range RGBA→UYVY 4:2:2, flip folded in (integer-coefficient).
function packUyvy(out, src, width, height, topDown) {
  const srcStride = width * 4, outStride = width * 2;
  for (let y = 0; y < height; y++) {
    let si = (topDown ? y : height - 1 - y) * srcStride;
    let oi = y * outStride;
    for (let x = 0; x < width; x += 2) {
      const r0 = src[si], g0 = src[si + 1], b0 = src[si + 2];
      const r1 = src[si + 4], g1 = src[si + 5], b1 = src[si + 6];
      const ra = (r0 + r1) >> 1, ga = (g0 + g1) >> 1, ba = (b0 + b1) >> 1;
      out[oi] = 128 + ((-26 * ra - 87 * ga + 112 * ba) >> 8);        // U (shared)
      out[oi + 1] = 16 + ((47 * r0 + 157 * g0 + 16 * b0) >> 8);      // Y0
      out[oi + 2] = 128 + ((112 * ra - 102 * ga - 10 * ba) >> 8);    // V (shared)
      out[oi + 3] = 16 + ((47 * r1 + 157 * g1 + 16 * b1) >> 8);      // Y1
      si += 8; oi += 4;
    }
  }
}

// bytes a frame will occupy on the wire (backpressure gates size off this)
export function frameWireBytes(width, height, { uyvy = false } = {}) {
  return width * height * (uyvy ? 2 : 4);
}

// Build one complete wire message from an RGBA frame. Bottom-up input is
// flipped inside the copy this path already pays (never on the native drain,
// where a second full-frame pass costs delivered fps).
export function buildFrameMessage(pixels, width, height, topDown, { uyvy = false } = {}) {
  const buf = new ArrayBuffer(FNDI_HEADER + frameWireBytes(width, height, { uyvy }));
  const dv = new DataView(buf);
  dv.setUint32(0, FNDI_MAGIC, false);
  dv.setUint32(4, width, true);
  dv.setUint32(8, height, true);
  dv.setUint32(12, 1 | (uyvy ? 2 : 0), true);   // wire is always top-down
  const out = new Uint8Array(buf, FNDI_HEADER);
  if (uyvy) {
    packUyvy(out, pixels, width, height, topDown);
  } else if (topDown) {
    out.set(pixels);
  } else {
    const stride = width * 4;
    for (let y = 0; y < height; y++) {
      out.set(pixels.subarray((height - 1 - y) * stride, (height - y) * stride), y * stride);
    }
  }
  return buf;
}
