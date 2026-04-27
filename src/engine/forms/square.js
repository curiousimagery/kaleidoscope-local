// forms/square.js
//
// FORM 1 — square mirror tile (p4m wallpaper group).
//
// rectangular cells supported via squareAspect parameter. area-preserving
// normalization: cell width = √aspect, height = 1/√aspect, so the cell's "size"
// stays comparable across aspect changes.

export default {
  id: 'square',
  label: 'Square',
  fileCode: 's',

  thumbnail: `<svg viewBox="0 0 32 32"><g class="stroke">
    <rect x="4" y="4" width="11" height="11"/>
    <rect x="17" y="4" width="11" height="11"/>
    <rect x="4" y="17" width="11" height="11"/>
    <rect x="17" y="17" width="11" height="11"/>
  </g></svg>`,

  controls: ['aspect'],

  // square form needs the aspect ratio in the shader.
  uniforms: {
    u_squareAspect: {
      type: '1f',
      get: (state) => state.squareAspect,
    },
  },

  // input convention: p in canvas space, [-1, 1]² (no normalization).
  // output convention: (cell_x - 0.5, cell_y - 0.5), in [-0.5, 0.5]² when
  //   u_squareAspect = 1; rectangular [-W/2, W/2] × [-H/2, H/2] with W = √aspect
  //   and H = 1/√aspect when aspect != 1.
  glsl: `
    vec2 foldSquare(vec2 p) {
      float W = sqrt(u_squareAspect);
      float H = 1.0 / W;
      // pre-scale: map a (W × H) rectangle period into the standard unit-period fold
      vec2 q = vec2(p.x / W, p.y / H);
      vec2 cell = fract(q * 0.5);              // 0..1 within tile
      cell = abs(cell * 2.0 - 1.0);            // mirror: 0->0, 0.5->1, 1->0
      cell = cell - 0.5;                       // recenter to -0.5..0.5
      // post-scale: stretch the unit-square output back to the (W × H) extent
      return vec2(cell.x * W, cell.y * H);
    }
  `,

  // square cells have no center-incident edges. all four edges are cell
  // boundaries; spoke handling does not apply.
  spokeRule: 'none',

  buildPolygon(state) {
    // foldSquare returns values in [-W/2, W/2] × [-H/2, H/2]. when squareAspect
    // = 1, W = H = 0.5 (the original unit-square cell).
    const W = 0.5 * Math.sqrt(state.squareAspect);
    const H = 0.5 / Math.sqrt(state.squareAspect);
    return [
      { vx: -W, vy: -H },
      { vx:  W, vy: -H },
      { vx:  W, vy:  H },
      { vx: -W, vy:  H },
    ];
  },

  filenameSuffix(state) {
    // aspect ratio in hundredths after the form code, e.g. 'a100' = 1.00
    return 'a' + Math.round(state.squareAspect * 100);
  },

  // tile density for resolution hint. square cells of width W = √aspect tile
  // the canvas with period 2W, so canvas-extent-2 contains 1/W periods, and
  // each period contains 2 mirror copies of the cell → 2/W tiles per dim.
  // for non-1 aspects, the constraining axis is the larger cell dimension —
  // we use 2/√aspect as a single number; if you wanted per-axis hints we'd
  // return an object. (build 2: keeping it as a single linear count to match
  // the formula shape used by other forms.)
  tilesPerDim(state) {
    const W = Math.sqrt(state.squareAspect);
    return 2 / W;
  },
};
