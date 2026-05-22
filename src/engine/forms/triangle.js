// forms/triangle.js
//
// FORM 3 — equilateral triangle wallpaper (p3m1 group, D3 fold variant).
//
// strategy: tile the plane with equilateral triangles (alternating "up" and
// "down" orientation in a rhombus unit cell). fold around each triangle's
// CENTROID — not around lattice vertices — because the triangle edges (= cell
// boundaries between centroids) are mirror axes in p3m1, which keeps the fold
// continuous across the boundaries. folding around vertices would put the
// Voronoi boundary along perpendicular bisectors of adjacent vertices, which
// are NOT p3m1 mirror axes → visible seams.
//
// approach:
//   1. convert p to axial coords (basis = triangle lattice vectors, vertices
//      at integer (u, v))
//   2. identify which triangle of the tiling p falls in via fu + fv < 1
//   3. compute that triangle's centroid in cartesian
//   4. fold local position via D3: 120° wedge, then mirror to 60° wedge
//   5. map back to a unit-bounded sample vector
//
// note: D3 at the centroid adds altitude-mirror symmetry that p3m1 itself
// doesn't have. visually this enriches the kaleidoscope feel and matches the
// hex.js pattern. a strict-p3m1 variant (C3-only, no internal mirror) is a
// possible later refinement.

export default {
  id: 'triangle',
  label: 'Triangle',
  fileCode: 't',

  thumbnail: `<svg viewBox="0 0 32 32"><g class="stroke">
    <polygon points="16,4 27.7,24 4.3,24"/>
    <line x1="16" y1="4" x2="16" y2="24"/>
    <line x1="27.7" y1="24" x2="10.15" y2="14"/>
    <line x1="4.3" y1="24" x2="21.85" y2="14"/>
  </g></svg>`,

  controls: [],

  // triangle uses universal uniforms only.
  uniforms: {},

  // input convention: p in canvas space, [-1, 1]² (no normalization).
  // output convention: unit-bounded vector in the fundamental wedge [0°, 60°].
  //   the D3 fold around each triangle's centroid sweeps a 60° wedge whose far
  //   edge sits at radius ~r/TRI_SIZE. matches overlay polygon exactly when the
  //   polygon is the 60° apex-at-center wedge.
  glsl: `
    vec2 foldTriangle(vec2 p) {
      // triangle side length (in canvas units). controls how many tiles fit on
      // canvas; smaller = more tiles. 0.6 mirrors hex.js's HEX_SIZE choice.
      float TRI_SIZE = 0.6;

      // axial-coords basis: triangular lattice with vertices at integer (u, v).
      // u = (p.x - p.y/√3) / TRI_SIZE
      // v = (2/√3) * p.y / TRI_SIZE
      vec2 q = p / TRI_SIZE;
      float u = q.x - q.y / SQRT3;
      float v = (2.0 / SQRT3) * q.y;

      // identify which triangle (up vs down) p is in.
      // up triangle (i, j): corners (i, j), (i+1, j), (i, j+1) — fu + fv < 1.
      // down triangle (i, j): corners (i+1, j), (i+1, j+1), (i, j+1) — fu + fv >= 1.
      float fi = floor(u);
      float fj = floor(v);
      float fu = u - fi;
      float fv = v - fj;
      bool isUp = (fu + fv < 1.0);

      // compute triangle centroid in cartesian.
      // up centroid: (i + 1/3) e1 + (j + 1/3) e2
      // down centroid: (i + 2/3) e1 + (j + 2/3) e2
      vec2 e1 = TRI_SIZE * vec2(1.0, 0.0);
      vec2 e2 = TRI_SIZE * vec2(0.5, SQRT3 / 2.0);
      vec2 base = fi * e1 + fj * e2;
      vec2 triCenter = isUp
        ? base + (e1 + e2) / 3.0
        : base + 2.0 * (e1 + e2) / 3.0;

      // local position relative to centroid.
      vec2 local = p - triCenter;

      // D3 fold: 3-fold rotation collapses 360° → 120° wedge, then mirror
      // across the wedge axis collapses 120° → 60° wedge.
      float r = length(local);
      float theta = atan(local.y, local.x);
      float wedge = TAU / 3.0;
      float t = mod(theta + wedge / 2.0, wedge) - wedge / 2.0;  // -60°..60°
      t = abs(t);                                                 // 0°..60°

      // normalize: scale local distance back to ~unit output. matches the
      // 60° wedge overlay polygon whose outer edge is at radius 1.
      return vec2(cos(t), sin(t)) * (r / TRI_SIZE);
    }
  `,

  // triangle is locked equilateral with the slice center at the centroid (not
  // at a vertex). all three edges are cell boundaries; the user can scale by
  // dragging any edge and rotate by dragging outside the polygon. matches
  // square's spokeRule semantics.
  spokeRule: 'none',

  buildPolygon(state) {
    // equilateral triangle, centroid at slice center, apex up on screen
    // (folded-space y is positive-down). circumradius √3/3 matches the fold
    // output's natural scale (max output magnitude is √3/3 at canvas-space
    // triangle vertices).
    //
    // vertex positions:
    //   top:           (0, -√3/3)
    //   bottom-right:  (1/2,  √3/6)
    //   bottom-left:   (-1/2, √3/6)
    const R = Math.sqrt(3) / 3;
    return [
      { vx: 0,    vy: -R },
      { vx: 0.5,  vy:  R * 0.5 },
      { vx: -0.5, vy:  R * 0.5 },
    ];
  },

  filenameSuffix(state) {
    return '';
  },

  // tile density for the resolution hint. triangle period TRI_SIZE=0.6 packs
  // more distinct mirror-tiles per linear axis than hex's HEX_SIZE=0.6 because
  // each triangle is smaller than a hex (1 triangle = 1/3 of a hex's area).
  // approximate as ~2× hex's 1.4 → 2.4. tune if resolution hint feels off.
  tilesPerDim(state) {
    return 2.4;
  },
};
