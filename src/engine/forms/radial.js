// forms/radial.js
//
// FORM 0 — radial wedge (classic kaleidoscope).
//
// fold output is centered on +X axis: returns vector at angle in
// [-wedge/2, +wedge/2]. with sliceRotation = 0, the wedge axis points at +X
// in source-UV (i.e., "to the right of the slice center on the displayed
// image"). matches overlay polygon exactly.

export default {
  id: 'radial',
  label: 'Radial',
  fileCode: 'r',

  thumbnail: `<svg viewBox="0 0 32 32"><g class="stroke">
    <circle cx="16" cy="16" r="12"/>
    <line x1="16" y1="4" x2="16" y2="28"/>
    <line x1="4" y1="16" x2="28" y2="16"/>
    <line x1="7.5" y1="7.5" x2="24.5" y2="24.5"/>
    <line x1="24.5" y1="7.5" x2="7.5" y2="24.5"/>
  </g></svg>`,

  controls: ['segments'],

  // radial uses universal uniforms only (u_segments). no per-form uniforms.
  uniforms: {},

  // input convention: p in canvas space (after canvas rotation+zoom), spanning
  //   [-1, 1]² plus corners up to |p|=√2.
  // output convention: canvas MID-EDGES (|p|=1) fold to |output|=1 — the
  //   overlay polygon's outer arc. canvas CORNERS (|p|=√2) sample slightly past
  //   the overlay (~1.41× past the wedge tip), and the dashed amber stroke warns
  //   when this crosses the source image bounds.
  glsl: `
    vec2 foldRadial(vec2 p) {
      // no input scaling — canvas mid-edges already at |p|=1, which is what we want.
      float r = length(p);
      float theta = atan(p.y, p.x);
      float wedge = TAU / u_segments;
      // center the fold range around 0 (instead of around wedge/2). after this:
      //   t in [-wedge/2, +3*wedge/2] before mirror.
      float t = mod(theta + wedge * 0.5, wedge * 2.0) - wedge * 0.5;
      // mirror the upper half [+wedge/2, +3*wedge/2] back into [-wedge/2, +wedge/2]
      if (t > wedge * 0.5) t = wedge - t;
      return vec2(cos(t), sin(t)) * r;
    }
  `,

  // radial wedges have center-incident SPOKE edges. dragging perpendicular to
  // a spoke widens/narrows the wedge angle = adjusts segment count.
  spokeRule: 'radial',

  buildPolygon(state) {
    // arc of unit radius, angle = TAU / segments
    const wedge = (Math.PI * 2) / state.segments;
    const pts = [];
    pts.push({ vx: 0, vy: 0 });
    const STEPS = 16;
    for (let i = 0; i <= STEPS; i++) {
      const a = -wedge / 2 + (i / STEPS) * wedge;
      pts.push({ vx: Math.cos(a), vy: Math.sin(a) });
    }
    return pts;
  },

  filenameSuffix(state) {
    return String(state.segments);
  },

  // tile density for resolution hint. radial fans the slice into N angular
  // wedges around the center; perceived effective linear tile count grows as
  // √(N/2) — N tiles around the perimeter, but mostly visible at the edge of
  // the output where angular sampling thins.
  tilesPerDim(state) {
    return Math.sqrt(state.segments / 2);
  },
};
