// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/source-color.js
//
// WHAT DID THE FILE ACTUALLY DECLARE? Reads the ISO-BMFF `colr` box out of a clip and returns the
// description `engine/color.js` needs. Stage one of colour management (plan PHASE 2.5).
//
// ⚠️ WHY WE PARSE THIS OURSELVES rather than asking the decoder.
//
// On iOS the picture comes from the native AVFoundation decode over a socket as raw 8-bit biplanar
// planes. **That wire format carries no colour tags at all** — the plugin would have to read
// `kCVImageBufferYCbCrMatrixKey` and send it, which is a Swift change and a native rebuild. The
// container has the same answer sitting in ~19 bytes, and reading it in JS works on every platform
// and every path without waiting on a plugin release. `VideoFrame.colorSpace` (recorded since B748)
// covers the WebCodecs paths and agrees with it; this is the one that covers the native path.
//
// ⚠️ AND IT READS ~64KB, NOT THE FILE. iOS writes .mov with `mdat` FIRST and `moov` at the END, so
// this walks the top-level box headers to find the moov (a handful of 16-byte reads through
// `Blob.slice`, which never pulls the payload) and then parses only that. On Daniel's 741MB clip
// that is two slices. The same layout fact `video-decode.js` documents at length for mp4box.

import { MATRIX, TRANSFER, PRIMARIES, DEFAULT_COLOR } from '../engine/color.js';

// Sample entries hide their child boxes behind a fixed preamble; everything else nests directly.
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);
const VISUAL_ENTRIES = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'mp4v', 'av01', 'vp09', 'apcn', 'ap4h', 'dvh1', 'dvhe']);
const VISUAL_PREAMBLE = 78;   // 8 reserved + 2 index + 70 VisualSampleEntry fields, before the extensions
const STSD_PREAMBLE = 8;      // version/flags + entry_count

// Everything this module could not answer, said out loud. An absence is not evidence
// (DEBUGGING-PROTOCOL) and a wrong colour assumption is invisible without a reason attached.
let lastWhy = null;
export function sourceColorWhy() { return lastWhy; }

async function readAt(blob, off, len) {
  if (off < 0 || off >= blob.size) return null;
  const buf = await blob.slice(off, Math.min(blob.size, off + len)).arrayBuffer();
  return buf.byteLength ? new DataView(buf) : null;
}

// Walk one level of boxes inside [off, end), returning the first descendant of interest.
async function findColr(blob, off, end, depth = 0) {
  if (depth > 8) return null;
  while (off + 8 <= end) {
    const head = await readAt(blob, off, 16);
    if (!head || head.byteLength < 8) return null;
    let size = head.getUint32(0);
    let hdr = 8;
    let type = '';
    for (let i = 4; i < 8; i++) type += String.fromCharCode(head.getUint8(i));
    if (size === 1) {
      if (head.byteLength < 16) return null;
      // 64-bit sizes are exact up to 2^53, which is nine petabytes of clip
      size = head.getUint32(8) * 4294967296 + head.getUint32(12);
      hdr = 16;
    }
    if (size === 0) size = end - off;
    if (size < hdr || off + size > end) return null;

    if (type === 'colr') return readColrBox(blob, off + hdr, size - hdr);
    if (CONTAINERS.has(type)) {
      const hit = await findColr(blob, off + hdr, off + size, depth + 1);
      if (hit) return hit;
    } else if (type === 'stsd') {
      const hit = await findColr(blob, off + hdr + STSD_PREAMBLE, off + size, depth + 1);
      if (hit) return hit;
    } else if (VISUAL_ENTRIES.has(type)) {
      const hit = await findColr(blob, off + hdr + VISUAL_PREAMBLE, off + size, depth + 1);
      if (hit) return hit;
    }
    off += size;
  }
  return null;
}

async function readColrBox(blob, off, len) {
  const v = await readAt(blob, off, Math.max(len, 4));
  if (!v || v.byteLength < 4) return null;
  let kind = '';
  for (let i = 0; i < 4; i++) kind += String.fromCharCode(v.getUint8(i));
  // `nclx` (MP4) and `nclc` (QuickTime) carry the same three indices; only nclx carries the range
  // flag. iOS writes `nclc`, so the range has to come from somewhere else — see below.
  if (kind !== 'nclx' && kind !== 'nclc') return { unsupported: kind };
  if (v.byteLength < 10) return null;
  const primaries = v.getUint16(4);
  const transfer = v.getUint16(6);
  const matrix = v.getUint16(8);
  // ⚠️ nclc DOES NOT CARRY THE RANGE, and guessing wrong crushes or clips the blacks. Both native
  // plugins request `kCVPixelFormatType_420YpCbCr8BiPlanarFullRange`, so the planes reaching the
  // blitter are full-range regardless of what the container intended — the decoder already did the
  // expansion. Full range is therefore the correct answer for OUR pipeline, not a guess about the file.
  const fullRange = kind === 'nclx' && v.byteLength >= 11 ? (v.getUint8(10) & 0x80) !== 0 : true;
  return { primaries, transfer, matrix, fullRange, box: kind };
}

/**
 * Read a clip's declared colour. Never throws and never returns null: an unreadable or untagged
 * file gets DEFAULT_COLOR (BT.709) with `why` saying which of those happened.
 */
export async function readSourceColor(blob) {
  lastWhy = null;
  if (!blob || !blob.size) {
    lastWhy = 'no bytes to read';
    return { ...DEFAULT_COLOR, why: lastWhy };
  }
  try {
    const hit = await findColr(blob, 0, blob.size);
    if (!hit) {
      lastWhy = 'the file declares no colr box — assuming BT.709';
      return { ...DEFAULT_COLOR, why: lastWhy };
    }
    if (hit.unsupported) {
      lastWhy = `colr box is '${hit.unsupported}' (ICC profile, not indices) — assuming BT.709`;
      return { ...DEFAULT_COLOR, why: lastWhy };
    }
    // "Unspecified" is a legal value and means the file genuinely does not know. Fall back per
    // field rather than for the whole description, so a file that tags matrix but not primaries
    // keeps the half it was sure about.
    const pick = (v, fallback) => (v === 2 || v === 0 || v == null ? fallback : v);
    const color = {
      matrix: pick(hit.matrix, DEFAULT_COLOR.matrix),
      transfer: pick(hit.transfer, DEFAULT_COLOR.transfer),
      primaries: pick(hit.primaries, DEFAULT_COLOR.primaries),
      fullRange: hit.fullRange,
      why: `read from the file's ${hit.box} box`,
    };
    lastWhy = color.why;
    return color;
  } catch (e) {
    lastWhy = `could not read the colr box: ${e?.message || e} — assuming BT.709`;
    return { ...DEFAULT_COLOR, why: lastWhy };
  }
}

/**
 * The WebCodecs half. `VideoFrame.colorSpace` exposes the same three fields under string names, so
 * a decoded frame can confirm (or contradict) what the container said. Returns null when the
 * browser exposes nothing, which is itself worth reporting.
 */
export function colorFromVideoFrame(frame) {
  const cs = frame?.colorSpace;
  if (!cs) return null;
  const MATRIX_BY_NAME = { rgb: MATRIX.IDENTITY, 'bt709': MATRIX.BT709, 'bt470bg': MATRIX.BT470BG, 'smpte170m': MATRIX.BT601, 'bt2020-ncl': MATRIX.BT2020_NCL };
  const TRANSFER_BY_NAME = { 'bt709': TRANSFER.BT709, 'smpte170m': TRANSFER.SMPTE170M, 'iec61966-2-1': TRANSFER.SRGB, 'linear': TRANSFER.LINEAR, 'pq': TRANSFER.PQ, 'hlg': TRANSFER.HLG };
  const PRIMARIES_BY_NAME = { 'bt709': PRIMARIES.BT709, 'bt470bg': PRIMARIES.BT470BG, 'smpte170m': PRIMARIES.SMPTE170M, 'bt2020': PRIMARIES.BT2020 };
  if (cs.matrix == null && cs.transfer == null && cs.primaries == null) return null;
  return {
    matrix: MATRIX_BY_NAME[cs.matrix] ?? DEFAULT_COLOR.matrix,
    transfer: TRANSFER_BY_NAME[cs.transfer] ?? DEFAULT_COLOR.transfer,
    primaries: PRIMARIES_BY_NAME[cs.primaries] ?? DEFAULT_COLOR.primaries,
    fullRange: cs.fullRange !== false,
    why: 'read from VideoFrame.colorSpace',
  };
}
