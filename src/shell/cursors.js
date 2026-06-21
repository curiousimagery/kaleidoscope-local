// shell/cursors.js
//
// Pre-generated ROTATE + SCALE cursors (CSS can't rotate a cursor, so we bake N
// angle-indexed SVG variants at module load) and the helpers that pick one for a
// given drag mode + angle.
//
// Build 225 — Daniel-supplied rotate shape (a filled curved double-arrow, WHITE fill
// + BLACK outline) replaces the old stroked design; the SCALE cursors are now custom
// SVGs in the SAME white-fill/black-outline style (replacing the OS resize cursors,
// which are the opposite — light outline over dark), so all cursors are consistent.
// Hotspots are a first guess (cursor centre); sanity-check on screen and nudge.
//
// FALLBACK (old rotate design, 32×32, hotspot 16 16) — to revert, restore:
//   arcD='M -3 -8 A 9 9 0 0 0 -3 8'; arrowTopD='M -5 -4.5 L -0.56 -6.6 L -5.44 -9.4 Z';
//   arrowBotD='M -5 4.5 L -0.56 6.6 L -5.44 9.4 Z'; drawn black(4)+white(1.75) stroked,
//   rotate(deg), 'url(...) 16 16, move'. And SCALE returned the CSS keywords
//   'ew-resize' / 'ns-resize' / 'nwse-resize' / 'nesw-resize'.

const ROTATE_CURSOR_STEPS = 16;
// Daniel's 0° rotate shape (his 31×67 art; bbox ~x4-27 y4-63, centre ~15.5,33.5).
const ROTATE_SHAPE = 'M24.1605 33.6411C24.1605 28.2002 22.0491 19.5955 15.2488 12.7887L11.9329 18.2631L4 4L20.3909 4.30159L16.7556 10.3015C24.5871 17.8095 27 27.4766 27 33.6411C27 39.7247 25.356 48.0088 18.395 55.5594L22.5611 61.1629L6.27161 63L12.8158 48.0565L16.6724 53.2431C22.7275 46.4478 24.1605 39.0978 24.1605 33.6411Z';
// 76×76 canvas so the shape never clips when rotated; centre the art at (38,38)
// (translate 22.5,4.5 maps its centre 15.5,33.5 → 38,38) then rotate about (38,38).
const ROTATE_CURSORS = (() => {
  const arr = [];
  for (let i = 0; i < ROTATE_CURSOR_STEPS; i++) {
    const deg = (i / ROTATE_CURSOR_STEPS) * 360;
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='76' height='76' viewBox='0 0 76 76'>` +
        `<g transform='rotate(${deg.toFixed(1)} 38 38) translate(22.5 4.5)'>` +
          `<path d='${ROTATE_SHAPE}' fill='white' stroke='black' stroke-width='2.5' stroke-linejoin='round'/>` +
        `</g>` +
      `</svg>`;
    arr.push(`url("data:image/svg+xml;utf8,${svg}") 38 38, move`);
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

// SCALE cursors — a bidirectional double-arrow in the same white-fill/black-outline
// style (drawn black-wide then white-thin), baked for the four 45° directions so the
// scale cursor matches the rotate cursor instead of the OS resize cursor. Falls back
// to the matching CSS resize keyword if the SVG can't load.
const SCALE_ARROW = 'M8 20H32M11 17L8 20L11 23M29 17L32 20L29 23';   // horizontal ↔ in a 40 box
function scaleCursor(angleDeg, fallback) {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'>` +
      `<g transform='rotate(${angleDeg} 20 20)' fill='none' stroke-linecap='round' stroke-linejoin='round'>` +
        `<path d='${SCALE_ARROW}' stroke='black' stroke-width='5'/>` +
        `<path d='${SCALE_ARROW}' stroke='white' stroke-width='2.5'/>` +
      `</g>` +
    `</svg>`;
  return `url("data:image/svg+xml;utf8,${svg}") 20 20, ${fallback}`;
}
const SCALE_EW = scaleCursor(0, 'ew-resize');     // ↔
const SCALE_NS = scaleCursor(90, 'ns-resize');    // ↕
const SCALE_NWSE = scaleCursor(45, 'nwse-resize'); // ⤡
const SCALE_NESW = scaleCursor(135, 'nesw-resize'); // ⤢

// pick a scale cursor for scale-direction at angle theta (radians, screen-y-down).
// 180°-symmetric (bidirectional resize), mapped to the nearest 45° step.
export function scaleCursorForAngle(theta) {
  const t = ((theta % Math.PI) + Math.PI) % Math.PI;
  const step = Math.PI / 8;
  if (t < step || t >= 7 * step) return SCALE_EW;      // ~horizontal
  if (t < 3 * step) return SCALE_NWSE;                 // ⤡
  if (t < 5 * step) return SCALE_NS;                   // ~vertical
  return SCALE_NESW;                                   // ⤢
}
