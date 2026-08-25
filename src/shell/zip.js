// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// zip.js
//
// Minimal STORE-only (no compression) ZIP writer. Hand-rolled to keep the
// project dependency-free — PNG/JPG payloads are already compressed, so DEFLATE
// would buy almost nothing. Used by "export package" to bundle the composition
// with the original (and, later, overlay/geometry layers) into one file, which
// also sidesteps the browser "multiple downloads" prompt that a multi-file
// export triggers on Safari.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

// Streamed CRC: read the blob in bounded slices so a multi-hundred-MB video
// never sits in memory whole (the mobile save-package case; one pass per file).
async function crc32OfBlob(blob) {
  const CHUNK = 8 * 1024 * 1024;
  let crc = ~0;
  for (let off = 0; off < blob.size; off += CHUNK) {
    const bytes = new Uint8Array(await blob.slice(off, Math.min(off + CHUNK, blob.size)).arrayBuffer());
    for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (~crc) >>> 0;
}

// ⚠️ B740 — ABOVE 4GB THIS WRITER CORRUPTED SILENTLY. IT NOW REFUSES INSTEAD.
//
// Every size and offset below is a `setUint32`, and **`DataView.setUint32` wraps modulo 2^32
// without throwing.** Daniel's 8K render is 6.25GB; written here it declared 1,955,032,704 bytes —
// **31.3% of the file, in a zip that opens.** A 4GB+1 entry declares ONE byte. Proven in a harness
// against this exact function (`scratchpad/zip64-check.mjs`), no device time.
//
// THREE fields overflow, not one: each entry's size, **the local-header offset of every entry after
// the first** (so a small `motion.json` behind a 6.25GB video becomes unreachable), and `cdStart`.
// Checking the RUNNING TOTAL covers all three at once, which per-entry checks would not: two 3GB
// files each fit a uint32 and still push the second entry's offset past the wrap.
//
// The right answer is ZIP64 (~40 lines, and every modern unzip reads it). Until then this REFUSES,
// with a tagged error so the caller can save the files separately rather than lose them — the
// render has already completed by the time we get here, and destroying a finished 14-minute job to
// avoid a corrupt zip would be trading one bad outcome for another.
export const ZIP_MAX_TOTAL = 0xFFFFFFFF;   // uint32 ceiling; cdStart must land below it

// files: [{ name: string, blob: Blob }]  →  Promise<Blob> (application/zip)
// The output Blob COMPOSES the input Blobs lazily (headers are small typed
// arrays; the file bytes stay browser-managed Blob references), so zipping two
// video takes costs one streamed CRC pass, not their combined size in memory.
// STORE format, 32-bit sizes — throws `err.code === 'too-large'` at or above 4GB total.
export async function zipStore(files) {
  const enc = new TextEncoder();

  // Refuse BEFORE the CRC pass — that pass reads every byte of every file, and spending it on a
  // package we are going to reject would add minutes to a failure.
  let projected = 0;
  for (const f of files) projected += 30 + enc.encode(f.name).length + f.blob.size;
  if (projected > ZIP_MAX_TOTAL) {
    const biggest = files.reduce((a, b) => (b.blob.size > a.blob.size ? b : a), files[0]);
    const e = new Error(
      `this package would be ${(projected / 1e9).toFixed(2)}GB, past the 4GB limit of the zip format we write`
      + ` (largest file: ${biggest?.name} at ${(biggest?.blob.size / 1e9).toFixed(2)}GB)`);
    e.code = 'too-large';
    e.projected = projected;
    e.files = files.map((f) => ({ name: f.name, size: f.blob.size }));
    throw e;
  }
  const entries = [];
  for (const f of files) {
    entries.push({ name: enc.encode(f.name), blob: f.blob, size: f.blob.size, crc: await crc32OfBlob(f.blob) });
  }

  const chunks = [];
  let offset = 0;

  // local file headers + data (the data chunk is the Blob itself — lazy)
  for (const e of entries) {
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);   // local file header signature
    h.setUint16(4, 20, true);           // version needed
    h.setUint16(6, 0, true);            // flags
    h.setUint16(8, 0, true);            // method: 0 = store
    h.setUint16(10, 0, true);           // mod time
    h.setUint16(12, 0x21, true);        // mod date: 1980-01-01
    h.setUint32(14, e.crc, true);
    h.setUint32(18, e.size, true);      // compressed size (= uncompressed)
    h.setUint32(22, e.size, true);      // uncompressed size
    h.setUint16(26, e.name.length, true);
    h.setUint16(28, 0, true);           // extra length
    chunks.push(new Uint8Array(h.buffer), e.name, e.blob);
    e.offset = offset;
    offset += 30 + e.name.length + e.size;
  }

  // central directory
  const cdStart = offset;
  let cdSize = 0;
  for (const e of entries) {
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);   // central dir signature
    c.setUint16(4, 20, true);           // version made by
    c.setUint16(6, 20, true);           // version needed
    c.setUint16(8, 0, true);            // flags
    c.setUint16(10, 0, true);           // method
    c.setUint16(12, 0, true);           // time
    c.setUint16(14, 0x21, true);        // date
    c.setUint32(16, e.crc, true);
    c.setUint32(20, e.size, true);
    c.setUint32(24, e.size, true);
    c.setUint16(28, e.name.length, true);
    c.setUint16(30, 0, true);           // extra length
    c.setUint16(32, 0, true);           // comment length
    c.setUint16(34, 0, true);           // disk number start
    c.setUint16(36, 0, true);           // internal attrs
    c.setUint32(38, 0, true);           // external attrs
    c.setUint32(42, e.offset, true);    // local header offset
    chunks.push(new Uint8Array(c.buffer), e.name);
    cdSize += 46 + e.name.length;
  }

  // end of central directory
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, cdStart, true);
  chunks.push(new Uint8Array(eocd.buffer));

  return new Blob(chunks, { type: 'application/zip' });
}
