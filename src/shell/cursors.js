// shell/cursors.js
//
// pre-generated rotate cursors (16 angle-indexed SVG variants) and helpers for
// picking the right cursor for a given drag mode + angle. CSS doesn't support
// rotated cursors, so we bake N variants at module load.

// rotation cursors — angle-indexed variants. CSS doesn't support rotated
// cursors, so we pre-generate N variants at module load (at angles around the
// circle) and pick the closest one based on the cursor's angle from center.
//
// design: in the BASE orientation (deg=0), the slice center is OFF-SCREEN to
// the RIGHT in cursor-local coordinates. so "inward toward center" means +X.
// the cursor draws an arc on the LEFT side, curving outward away from the
// slice. the arc ends carry FILLED TRIANGLE arrowheads pointing INWARD along
// the arc's tangent — indicating "rotate around the slice center."
//
// rendering: every visible element is drawn TWICE — once as a thick BLACK
// outline, then as a thinner WHITE fill / stroke on top. high contrast against
// any image background.
const ROTATE_CURSOR_STEPS = 16;
const ROTATE_CURSORS = (() => {
  const arr = [];
  // arc endpoints: top (-3, -8), bottom (-3, 8). tangent at top end going
  // along arc: (-0.5, +0.87). tangent at bottom end going outward: mirror.
  // for each arrow, base midpoint is at endpoint, tip is at endpoint + 4 * tangent.
  // base half-width 2.8 along perpendicular to tangent.
  const arrowTopD = 'M -5 -4.5 L -0.56 -6.6 L -5.44 -9.4 Z';
  const arrowBotD = 'M -5 4.5 L -0.56 6.6 L -5.44 9.4 Z';
  const arcD = 'M -3 -8 A 9 9 0 0 0 -3 8';
  for (let i = 0; i < ROTATE_CURSOR_STEPS; i++) {
    const deg = (i / ROTATE_CURSOR_STEPS) * 360;
    const svg =
      '<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'32\' height=\'32\' viewBox=\'-16 -16 32 32\'>' +
        '<g transform=\'rotate(' + deg.toFixed(1) + ')\' stroke-linecap=\'round\' stroke-linejoin=\'round\'>' +
          // === BLACK OUTLINE PASS ===
          '<g fill=\'black\' stroke=\'black\' stroke-width=\'4\'>' +
            '<path d=\'' + arcD + '\' fill=\'none\'/>' +
            '<path d=\'' + arrowTopD + '\'/>' +
            '<path d=\'' + arrowBotD + '\'/>' +
          '</g>' +
          // === WHITE INNER PASS ===
          '<g fill=\'white\' stroke=\'white\' stroke-width=\'1.75\'>' +
            '<path d=\'' + arcD + '\' fill=\'none\'/>' +
            '<path d=\'' + arrowTopD + '\'/>' +
            '<path d=\'' + arrowBotD + '\'/>' +
          '</g>' +
        '</g>' +
      '</svg>';
    arr.push('url("data:image/svg+xml;utf8,' + svg + '") 16 16, move');
  }
  return arr;
})();

// pick rotate cursor for cursor-from-center angle theta (radians, screen-y-down).
// rotates the SVG so its +X (the "inward" direction) points toward the slice
// center, which is at (-cos theta, -sin theta) from cursor's perspective.
export function rotateCursorForAngle(theta) {
  const TAU = Math.PI * 2;
  const t = ((theta + Math.PI) % TAU + TAU) % TAU;
  const idx = Math.round(t / TAU * ROTATE_CURSOR_STEPS) % ROTATE_CURSOR_STEPS;
  return ROTATE_CURSORS[idx];
}

// pick a CSS cursor for scale-direction at angle theta (radians, screen-y-down).
// CSS doesn't support rotated cursors, so map angle to nearest 45° step among
// the four bidirectional resize cursors.
export function scaleCursorForAngle(theta) {
  // normalize to [0, π) — bidirectional resize is 180°-symmetric
  const t = ((theta % Math.PI) + Math.PI) % Math.PI;
  const step = Math.PI / 8;
  if (t < step || t >= 7 * step) return 'ew-resize';      // ~horizontal
  if (t < 3 * step) return 'nwse-resize';                  // \\
  if (t < 5 * step) return 'ns-resize';                    // |
  return 'nesw-resize';                                    // /
}
