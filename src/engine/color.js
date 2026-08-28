// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// engine/color.js
//
// THE INPUT TRANSFORM — stage one of colour management (plan PHASE 2.5).
//
// One seam that turns "whatever the source declared" into linear sRGB. Pure data and pure GLSL
// text: no GL calls, no DOM, no shell. `engine/yuv.js` compiles the snippet below into the planar
// blitter; `shell/source-color.js` produces the description that drives it.
//
// ⚠️ WHY THIS EXISTS, and it is a shipped defect rather than a new feature.
//
// The planar path converted YUV to RGB with hardcoded **BT.601** coefficients, no transfer
// function and no primaries, on every source. Nothing ever read what the file declared. That is
// the native-decode path, so it is in-app playback AND the broadcast on iPad.
//
// Then B747 removed a 2D-canvas intermediate from the render path for a 73x upload win, and that
// canvas had silently been doing HLG-to-SDR tone mapping and BT.2020-to-sRGB gamut conversion. So
// the win exposed that we never owned a colour pipeline at all.
//
// ⚠️ AND THE CLIP EVERY DEVICE MEASUREMENT IN THIS ARC WAS MADE ON IS HDR. `IMG_5132.MOV`, read
// from its own boxes at B761: **BT.2020 primaries, HLG transfer, BT.2020 matrix, HEVC Main 10**.
// Decoded as BT.601 SDR. Three compounding errors on the footage every quality judgement was made
// against.
//
// ▶ WHAT THIS STAGE DOES AND DOES NOT DO. It corrects matrix, range, primaries and transfer, in an
// 8-bit working space. So hue and saturation become right, and HDR sources get a defensible SDR
// rendering. It will still BAND on HDR gradients, because 8 bits is 8 bits. **A half-float working
// space is stage two**, and it is what stills at higher bit depth need; the seam does not change,
// only the buffer behind it. Display transforms and ICC are stage three, on the output side.

// ─── matrix coefficients (ISO/IEC 23091-2 `MatrixCoefficients`) ────────────────────────────────
export const MATRIX = { IDENTITY: 0, BT709: 1, UNSPECIFIED: 2, FCC: 4, BT470BG: 5, BT601: 6, SMPTE240: 7, BT2020_NCL: 9, BT2020_CL: 10 };
// ─── transfer characteristics (`TransferCharacteristics`) ──────────────────────────────────────
export const TRANSFER = { BT709: 1, UNSPECIFIED: 2, BT470M: 4, BT470BG: 5, SMPTE170M: 6, LINEAR: 8, SRGB: 13, BT2020_10: 14, BT2020_12: 15, PQ: 16, HLG: 18 };
// ─── colour primaries (`ColourPrimaries`) ──────────────────────────────────────────────────────
export const PRIMARIES = { BT709: 1, UNSPECIFIED: 2, BT470BG: 5, SMPTE170M: 6, BT2020: 9, P3: 12 };

// What we assume when a file declares nothing. BT.709 everywhere: it is what essentially all HD
// and 4K SDR video is, and it is what the old BT.601 hardcode was wrong about most often.
export const DEFAULT_COLOR = Object.freeze({
  matrix: MATRIX.BT709, transfer: TRANSFER.BT709, primaries: PRIMARIES.BT709,
  fullRange: true, why: 'nothing declared — assuming BT.709',
});

// ⚠️ WHAT THE SHADER DID BEFORE B761, kept as a named thing so the change is A/B-able on a device
// with `?color=off`. Daniel has to be able to see the old and new side by side to judge it, and
// "revert the build" is not a comparison you can make mid-session. It is also the honest record of
// what every measurement in the B7xx arc was actually looking at.
export const LEGACY_COLOR = Object.freeze({
  matrix: 6 /* BT.601 */, transfer: 1 /* treat as SDR: no transfer applied */,
  primaries: 1 /* none applied */, fullRange: true,
  why: 'LEGACY BT.601 — the pre-B761 hardcode, forced by ?color=off',
});

// ─── the three shader modes ────────────────────────────────────────────────────────────────────
// Kept as small integers because they are uniforms. A UNIFORM branch is coherent across every
// fragment, so the SDR path costs a predicted jump and nothing else.
export const XFER_SDR = 0;   // already display-referred: pass through (BT.709/sRGB/SMPTE170M)
export const XFER_HLG = 1;   // ARIB STD-B67
export const XFER_PQ = 2;    // SMPTE ST 2084

// ⚠️ Kr/Kb per matrix, which is the ONLY thing that varies in a non-constant-luminance YCbCr
// conversion. Deriving the 3x3 from them rather than pasting four sets of magic numbers is what
// keeps this auditable — the old hardcode was four magic numbers with no name attached.
const KRKB = {
  [MATRIX.BT709]: [0.2126, 0.0722],
  [MATRIX.BT601]: [0.299, 0.114],                // SMPTE 170M
  [MATRIX.BT470BG]: [0.299, 0.114],              // same coefficients as 601, different primaries
  [MATRIX.SMPTE240]: [0.212, 0.087],
  [MATRIX.BT2020_NCL]: [0.2627, 0.0593],
  [MATRIX.BT2020_CL]: [0.2627, 0.0593],          // treated as NCL: constant-luminance is not in use anywhere we ship
};

// YCbCr -> R'G'B' for non-constant luminance, from Kr/Kb (ITU-R BT.709 §3.3 form).
//   R = Y +               2(1-Kr) Cr
//   G = Y - (2 Kb (1-Kb)/Kg) Cb - (2 Kr (1-Kr)/Kg) Cr
//   B = Y + 2(1-Kb) Cb
// Returned COLUMN-MAJOR, which is what `gl.uniformMatrix3fv` wants without a transpose.
export function yuvToRgbMatrix(matrixId) {
  const [kr, kb] = KRKB[matrixId] || KRKB[MATRIX.BT709];
  const kg = 1 - kr - kb;
  const cbR = 0, crR = 2 * (1 - kr);
  const cbG = -2 * kb * (1 - kb) / kg, crG = -2 * kr * (1 - kr) / kg;
  const cbB = 2 * (1 - kb), crB = 0;
  // columns are the Y, Cb, Cr contributions
  return new Float32Array([1, 1, 1, cbR, cbG, cbB, crR, crG, crB]);
}

// Linear-light primaries conversion, source -> sRGB/BT.709, D65 throughout. Column-major.
// Identity for BT.709 sources, which is the overwhelming majority, so the common case is exact.
const PRIMARY_MATRICES = {
  [PRIMARIES.BT2020]: [1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187],
  [PRIMARIES.P3]: [1.2249, -0.0420, -0.0197, -0.2247, 1.0419, -0.0786, 0.0000, 0.0000, 1.0979],
  [PRIMARIES.SMPTE170M]: [0.9395, -0.0177, -0.0016, 0.0502, 0.9658, -0.0044, 0.0103, 0.0520, 1.0060],
};
PRIMARY_MATRICES[PRIMARIES.BT470BG] = PRIMARY_MATRICES[PRIMARIES.SMPTE170M];
const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function primariesMatrix(primariesId) {
  return new Float32Array(PRIMARY_MATRICES[primariesId] || IDENTITY3);
}

export function transferMode(transferId) {
  if (transferId === TRANSFER.HLG) return XFER_HLG;
  if (transferId === TRANSFER.PQ) return XFER_PQ;
  return XFER_SDR;
}

export function isHDR(color) {
  const t = color?.transfer;
  return t === TRANSFER.HLG || t === TRANSFER.PQ;
}

// ⚠️ HOW MUCH TO SCALE HDR LINEAR LIGHT BEFORE TONE MAPPING, and both numbers are references
// rather than taste. HLG's reference white sits at 75% signal (ITU-R BT.2100 Table 5); PQ's
// diffuse white is 203 nits of its 10,000 (ITU-R BT.2408). Dividing by those puts diffuse white at
// 1.0 so the tone curve only has to deal with what is genuinely ABOVE white.
// Computed, not pasted: a hand-copied constant is a number nobody can check, and the harness would
// only be checking my typing against itself.
export const HLG_WHITE_LINEAR = (Math.exp((0.75 - 0.55991073) / 0.17883277) + 0.28466892) / 12;
export const PQ_WHITE_LINEAR = 0.0203;     // 203 / 10000

// ⚠️ B762 — THE TONE CURVE IS A LOOK, AND A LOOK IS NOT SOMETHING TO GUESS ACROSS THREE BUILDS.
//
// Daniel on B761: *"overall tone curve is better and has much more contrast, bright areas are too
// bright and we're crushing our highlights."* And, decisively: *"the way the clip renders in the
// Loop Builder is excellent... that tone mapping is very close to exactly where we should target."*
// The Loop Builder draws AVAssetImageGenerator stills, so **the target he named is Apple's own
// HDR-to-SDR rendering**, which is the best possible reference to tune against.
//
// `shoulder` is the Reinhard white point SQUARED. The curve maps x -> x(1 + x/shoulder)/(1 + x),
// which reaches 1.0 at x = sqrt(shoulder). HLG peak lands at 1/HLG_WHITE ~= 3.77 after
// normalisation, so:
//   shoulder 16  (white 4.0)  -> peak 0.98: almost linear at the top. B761's default, too hot.
//   shoulder 50  (white 7.1)  -> peak 0.85
//   shoulder 120 (white 11)   -> peak 0.81, close to pure Reinhard's 0.79
// LARGER is softer. `exposure` scales before the curve, for when the whole image is off rather
// than just its highlights.
//
// Tunable live with `?tone=shoulder,exposure` — see the UI Lab cheat sheet. Committing a value is
// one edit here once Daniel has swept it.
export const TONE_DEFAULTS = Object.freeze({ shoulder: 50, exposure: 1 });

export function toneFromQuery(search) {
  try {
    const raw = new URLSearchParams(search || '').get('tone');
    if (!raw) return { ...TONE_DEFAULTS };
    const [a, b] = raw.split(',').map((n) => parseFloat(n));
    return {
      shoulder: Number.isFinite(a) && a > 0 ? a : TONE_DEFAULTS.shoulder,
      exposure: Number.isFinite(b) && b > 0 ? b : TONE_DEFAULTS.exposure,
    };
  } catch { return { ...TONE_DEFAULTS }; }
}

// Human-readable, for the report and the source note. This is the half that makes a wrong
// assumption findable on a device, so it names the source of every field.
export function describeColor(color) {
  if (!color) return 'no colour info';
  const name = (map, v) => Object.keys(map).find((k) => map[k] === v) || `#${v}`;
  return [
    `matrix ${name(MATRIX, color.matrix)}`,
    `transfer ${name(TRANSFER, color.transfer)}`,
    `primaries ${name(PRIMARIES, color.primaries)}`,
    color.fullRange ? 'full range' : 'limited range',
    isHDR(color) && '⚠ HDR → SDR tone mapped',
    color.why,
  ].filter(Boolean).join(' · ');
}

// ─── the GLSL ──────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ highp IS REQUIRED, NOT PREFERENCE. `mediump` is fp16 on iOS, and the PQ inverse EOTF raises
// a value to the power 1/0.1593, which overflows fp16 outright. The SDR path does not need it, but
// one shader serves all three and a per-mode shader is not worth the compile.
//
// ⚠️ AND NOTE WHAT THE SDR PATH DELIBERATELY DOES NOT DO. For a BT.709 SDR source the signal is
// already display-referred and the display is sRGB, so the correct transform after the matrix is
// NOTHING. Round-tripping it through linear and back would only add error. So `XFER_SDR` returns
// straight out of the matrix, and the ONLY behaviour change for an SDR clip is that the matrix is
// finally the right one.
export const COLOR_GLSL = `
const float HLG_A = 0.17883277, HLG_B = 0.28466892, HLG_C = 0.55991073;

// ARIB STD-B67 inverse OETF: signal -> scene linear
vec3 hlgToLinear(vec3 e) {
  vec3 lo = (e * e) / 3.0;
  vec3 hi = (exp((e - HLG_C) / HLG_A) + HLG_B) / 12.0;
  return mix(lo, hi, step(vec3(0.5), e));
}

// SMPTE ST 2084 inverse EOTF: signal -> linear, 1.0 = 10,000 nits
vec3 pqToLinear(vec3 e) {
  const float m1 = 0.1593017578125, m2 = 78.84375;
  const float c1 = 0.8359375, c2 = 18.8515625, c3 = 18.6875;
  vec3 p = pow(max(e, 0.0), vec3(1.0 / m2));
  return pow(max(p - c1, 0.0) / max(c2 - c3 * p, 1e-6), vec3(1.0 / m1));
}

// Reinhard with a white point: rolls highlights off instead of clipping them, and leaves
// everything at or below diffuse white essentially untouched. Deliberately the simplest curve
// that is defensible — a filmic curve is a LOOK, and a look is a decision for the output stage.
vec3 toneMap(vec3 x, float whiteSq) {
  return (x * (1.0 + x / whiteSq)) / (1.0 + x);
}

vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

vec3 srgbToLinear(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
`;

// A gamut conversion is only correct in LINEAR light, so an SDR source with non-sRGB primaries
// costs a decode/encode round trip that a BT.709 source must not pay. This is what tells the
// shader which of the two SDR paths to take.
export function needsGamut(primariesId) {
  return !!PRIMARY_MATRICES[primariesId];
}
