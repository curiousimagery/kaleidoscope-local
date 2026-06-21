// shell/cursors.js
//
// Pre-generated ROTATE + SCALE cursors (CSS can't rotate a cursor, so we bake N
// angle-indexed SVG variants at module load) and the helpers that pick one for a
// given drag mode + angle.
//
// Build 226 — re-done in ONE normalized style: a thin BLACK outline with a WHITE line
// on top (high contrast over any image). The ROTATE cursor takes the DESIGN from
// Daniel's art — a rotation arc with TANGENT arrowheads at both ends — but drawn in our
// stroked style at a normal cursor size (32px, not his ~76px raw asset). The SCALE
// cursors are a matching double-arrow (replacing the OS resize cursors, which are the
// opposite: light outline over dark), with the CSS keyword as a graceful fallback.
//
// Orientation: in the base frame the slice centre is toward +X, so the arc bulges LEFT
// (concave toward the centre). `rotate(deg)` spins it to each angle. Hotspot = centre.

const STROKE_BLACK = 4, STROKE_WHITE = 2;   // shared outline/fill weights (both cursors)

// ---- ROTATE -----------------------------------------------------------------
const ROTATE_CURSOR_STEPS = 16;
// Build the arc + tangent-arrowhead path once (afRotationArc geometry): an arc of a
// circle centred at (ACX,0), radius AR, spanning ±HSPAN about the leftmost point, with
// a V arrowhead tangent to each end.
function rotateArcPath() {
  const ACX = 7, AR = 11, HSPAN = 1.05, HEAD = 4.5, BARB = 2.5, N = 16;
  const base = Math.PI, sA = base - HSPAN, eA = base + HSPAN;
  let d = '';
  for (let k = 0; k <= N; k++) {
    const e = sA + (eA - sA) * k / N;
    d += (k ? 'L' : 'M') + (ACX + AR * Math.cos(e)).toFixed(2) + ' ' + (AR * Math.sin(e)).toFixed(2);
  }
  for (const [a, tang] of [[eA, eA + Math.PI / 2], [sA, sA - Math.PI / 2]]) {
    const tx = ACX + AR * Math.cos(a), ty = AR * Math.sin(a);
    const b1x = tx + Math.cos(tang + BARB) * HEAD, b1y = ty + Math.sin(tang + BARB) * HEAD;
    const b2x = tx + Math.cos(tang - BARB) * HEAD, b2y = ty + Math.sin(tang - BARB) * HEAD;
    d += `M${b1x.toFixed(2)} ${b1y.toFixed(2)}L${tx.toFixed(2)} ${ty.toFixed(2)}L${b2x.toFixed(2)} ${b2y.toFixed(2)}`;
  }
  return d;
}
const ROTATE_PATH = rotateArcPath();
const ROTATE_CURSORS = (() => {
  const arr = [];
  for (let i = 0; i < ROTATE_CURSOR_STEPS; i++) {
    const deg = (i / ROTATE_CURSOR_STEPS) * 360;
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='-16 -16 32 32'>` +
        `<g transform='rotate(${deg.toFixed(1)})' fill='none' stroke-linecap='round' stroke-linejoin='round'>` +
          `<path d='${ROTATE_PATH}' stroke='black' stroke-width='${STROKE_BLACK}'/>` +
          `<path d='${ROTATE_PATH}' stroke='white' stroke-width='${STROKE_WHITE}'/>` +
        `</g>` +
      `</svg>`;
    arr.push(`url("data:image/svg+xml;utf8,${svg}") 16 16, move`);
  }
  return arr;
})();

// pick rotate cursor for cursor-from-center angle theta (radians, screen-y-down).
export function rotateCursorForAngle(theta) {
  const TAU = Math.PI * 2;
  const t = ((theta + Math.PI) % TAU + TAU) % TAU;
  const idx = Math.round(t / TAU * ROTATE_CURSOR_STEPS) % ROTATE_CURSOR_STEPS;
  return ROTATE_CURSORS[idx];
}

// ---- SCALE ------------------------------------------------------------------
// A bidirectional double-arrow in the same black-outline/white style, baked for the
// four 45° directions; falls back to the matching CSS resize keyword.
const SCALE_PATH = 'M-9 0H9M-6 -3L-9 0L-6 3M6 -3L9 0L6 3';   // horizontal ↔, -16..16 frame
function scaleCursor(angleDeg, fallback) {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='-16 -16 32 32'>` +
      `<g transform='rotate(${angleDeg})' fill='none' stroke-linecap='round' stroke-linejoin='round'>` +
        `<path d='${SCALE_PATH}' stroke='black' stroke-width='${STROKE_BLACK}'/>` +
        `<path d='${SCALE_PATH}' stroke='white' stroke-width='${STROKE_WHITE}'/>` +
      `</g>` +
    `</svg>`;
  return `url("data:image/svg+xml;utf8,${svg}") 16 16, ${fallback}`;
}
const SCALE_EW = scaleCursor(0, 'ew-resize');       // ↔
const SCALE_NS = scaleCursor(90, 'ns-resize');      // ↕
const SCALE_NWSE = scaleCursor(45, 'nwse-resize');  // ⤡
const SCALE_NESW = scaleCursor(135, 'nesw-resize'); // ⤢

// pick a scale cursor for scale-direction at angle theta (radians, screen-y-down).
// 180°-symmetric (bidirectional resize), mapped to the nearest 45° step.
export function scaleCursorForAngle(theta) {
  const t = ((theta % Math.PI) + Math.PI) % Math.PI;
  const step = Math.PI / 8;
  if (t < step || t >= 7 * step) return SCALE_EW;
  if (t < 3 * step) return SCALE_NWSE;
  if (t < 5 * step) return SCALE_NS;
  return SCALE_NESW;
}
