// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// color-parse-check.mjs — does the input transform read and derive the right numbers?
//
// Two halves, both runnable with no device and no browser:
//   1. The MATRIX MATH. Derived Kr/Kb coefficients checked against the published constants in
//      ITU-R BT.601/709/2020. This is what the old hardcode got wrong, so it is what must be right.
//   2. The BOX PARSER, against a real file when one is given:
//        node tools/color-parse-check.mjs ~/Downloads/IMG_5132.MOV
//      Without an argument it runs the math half only, so it is safe in `npm run check`.
//
// ⚠️ WHY A HARNESS AND NOT A DEVICE RUN. Every number here is decidable on this machine. Sending a
// colour build to a device before these pass would spend a session confirming arithmetic.

import { yuvToRgbMatrix, primariesMatrix, transferMode, needsGamut, MATRIX, TRANSFER, PRIMARIES,
  XFER_SDR, XFER_HLG, XFER_PQ, HLG_REFERENCE_WHITE, hdrNormFor, toneFromQuery, TONE_DEFAULTS } from '../src/engine/color.js';

let pass = 0, fail = 0;
const near = (a, b, eps = 5e-4) => Math.abs(a - b) <= eps;
function check(name, got, want, eps) {
  const list = (v) => Array.isArray(v) || ArrayBuffer.isView(v);
  const ok = list(want)
    ? want.length === got.length && Array.from(want).every((w, i) => near(got[i], w, eps))
    : near(got, want, eps);
  if (ok) { pass++; return; }
  fail++;
  console.error(`FAIL ${name}\n  got  ${list(got) ? Array.from(got).map((n) => n.toFixed(6)).join(', ') : got}\n  want ${list(want) ? Array.from(want).join(', ') : want}`);
}

// The published YCbCr->RGB coefficients. Column-major: [Yr,Yg,Yb, Cb_r,Cb_g,Cb_b, Cr_r,Cr_g,Cr_b].
// BT.601 is the set the shader used to apply to EVERYTHING; it is here to prove we can still
// produce it when a file genuinely asks for it.
check('BT.601 matrix', yuvToRgbMatrix(MATRIX.BT601),
  [1, 1, 1, 0, -0.344136, 1.772, 1.402, -0.714136, 0]);
check('BT.709 matrix', yuvToRgbMatrix(MATRIX.BT709),
  [1, 1, 1, 0, -0.187324, 1.8556, 1.5748, -0.468124, 0]);
check('BT.2020 NCL matrix', yuvToRgbMatrix(MATRIX.BT2020_NCL),
  [1, 1, 1, 0, -0.164553, 1.8814, 1.4746, -0.571353, 0]);
check('unknown matrix falls back to BT.709', yuvToRgbMatrix(9999), yuvToRgbMatrix(MATRIX.BT709));

// A conversion matrix must preserve the white point: (1,1,1) in must land on (1,1,1) out, or
// neutral greys tint. This is the property that catches a transposed or mistyped 3x3.
for (const [name, id] of [['BT.2020', PRIMARIES.BT2020], ['P3', PRIMARIES.P3], ['SMPTE170M', PRIMARIES.SMPTE170M]]) {
  const m = primariesMatrix(id);
  for (let row = 0; row < 3; row++) {
    check(`${name} primaries preserve white (row ${row})`, m[row] + m[row + 3] + m[row + 6], 1, 3e-3);
  }
}
check('BT.709 primaries are identity', primariesMatrix(PRIMARIES.BT709), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
check('BT.709 needs no gamut round trip', needsGamut(PRIMARIES.BT709) ? 1 : 0, 0);
check('BT.2020 needs a gamut round trip', needsGamut(PRIMARIES.BT2020) ? 1 : 0, 1);

check('BT.709 transfer is passthrough', transferMode(TRANSFER.BT709), XFER_SDR);
check('sRGB transfer is passthrough', transferMode(TRANSFER.SRGB), XFER_SDR);
check('HLG transfer selects HLG', transferMode(TRANSFER.HLG), XFER_HLG);
check('PQ transfer selects PQ', transferMode(TRANSFER.PQ), XFER_PQ);

// The HLG reference-white constant, recomputed from ARIB STD-B67 rather than trusted as a literal.
const a = 0.17883277, b = 0.28466892, c = 0.55991073;
check('HLG reference white = inverseOETF(0.75)', HLG_REFERENCE_WHITE, (Math.exp((0.75 - c) / a) + b) / 12, 1e-5);

// ⚠️ B764 — HLG IS NOT NORMALISED. It is SDR-backward-compatible by design (BT.2100), and dividing
// by its reference white is what blew B761/B762's highlights out. PQ still is: 1.0 there is 10,000
// nits. These two assertions are the ones that stop that regression coming back.
check('HLG is displayed as authored (no normalisation)', hdrNormFor(XFER_HLG), 1);
check('PQ normalises to 203-nit diffuse white', hdrNormFor(XFER_PQ), 0.0203);

// The tone curve's identity point. `toneMap(x, 1) = x(1 + x)/(1 + x) = x` exactly, so shoulder 1
// means OFF — which is the default, and is what Daniel converged on by sweeping.
const toneMap = (x, w2) => (x * (1 + x / w2)) / (1 + x);
for (const x of [0.05, 0.2, 0.5, 1, 2, 3.77]) {
  check(`shoulder 1 is the identity at x=${x}`, toneMap(x, 1), x, 1e-9);
}
check('shoulder 16 darkens diffuse white', toneMap(1, 16) < 1 ? 1 : 0, 1);
check('a larger shoulder darkens more', toneMap(1, 50) < toneMap(1, 16) ? 1 : 0, 1);

check('defaults are the identity', [TONE_DEFAULTS.shoulder, TONE_DEFAULTS.exposure, TONE_DEFAULTS.gamma], [1, 1, 1]);
const t = toneFromQuery('?tone=12,0.8,1.4');
check('?tone parses three values', [t.shoulder, t.exposure, t.gamma], [12, 0.8, 1.4]);
const t2 = toneFromQuery('?tone=12');
check('?tone fills missing values from the defaults', [t2.shoulder, t2.exposure, t2.gamma], [12, 1, 1]);

const file = process.argv[2];
if (file) {
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(file);
  // Blob.slice over a Buffer gives the parser exactly the interface it sees in the browser.
  const blob = new Blob([bytes]);
  const { readSourceMeta } = await import('../src/shell/source-color.js');
  const { describeColor } = await import('../src/engine/color.js');
  const { color, rotation, trackW, trackH } = await readSourceMeta(blob);
  console.log(`\n${file}\n  ${describeColor(color)}\n  rotation ${rotation}deg · track ${trackW}x${trackH}`);
  check('a real file parses to something other than the default reason',
    color.why.startsWith('read from') ? 1 : 0, 1);
  // The rotation must be one of the four legal quarter turns, and the track must have a size —
  // a metadata track (0x0, identity matrix) being picked up as the picture is the failure mode.
  check('rotation is a quarter turn', [0, 90, 180, 270].includes(rotation) ? 1 : 0, 1);
  check('the picture track has dimensions', trackW > 0 && trackH > 0 ? 1 : 0, 1);
}

console.log(`\ncolour parse check: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
