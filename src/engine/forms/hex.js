// forms/hex.js
//
// FORM 2 — hex mirror tile (p6m wallpaper group).
//
// strategy: hex tiling, fold into one of the 12 fundamental triangles per hex
// (6-fold rotation × mirror = 12 cosets).
//
// approach:
//   1. find which hex cell we're in (using axial coords)
//   2. get position relative to hex center
//   3. fold via 6-fold rotation: collapse into a 60° wedge
//   4. fold via mirror: collapse the 60° wedge into a 30° wedge
//   5. map back to a unit-bounded sample vector

export default {
  id: 'hex',
  label: 'Hex',
  fileCode: 'h',

  thumbnail: `<svg viewBox="0 0 32 32"><g class="stroke">
    <polygon points="16,4 25,9 25,19 16,24 7,19 7,9"/>
    <line x1="16" y1="4" x2="16" y2="24"/>
    <line x1="7" y1="9" x2="25" y2="19"/>
    <line x1="25" y1="9" x2="7" y2="19"/>
  </g></svg>`,

  controls: [],

  // hex uses universal uniforms only.
  uniforms: {},

  // input convention: p in canvas space, [-1, 1]² (no normalization).
  // output convention: unit-bounded vector in the fundamental wedge [0°, 30°].
  //   the 12-fold symmetry of foldHex's outputs sweeps a regular pointy-top hex
  //   (vertex at 30° at radius 1, edge midpoint at 0° at radius √3/2). matches
  //   overlay polygon exactly.
  glsl: `
    vec2 foldHex(vec2 p) {
      // pointy-top hex tiling. HEX_SIZE controls how many hex tiles fit on canvas.
      // smaller = more tiles visible. 0.6 gives roughly a 2x2 tile pattern.
      float HEX_SIZE = 0.6;
      vec2 q = p / HEX_SIZE;

      // convert cartesian to axial (pointy-top)
      // ax = (sqrt(3)/3) * x - (1/3) * y
      // ay = (2/3) * y
      vec2 ax = vec2(
        (SQRT3 / 3.0) * q.x - (1.0 / 3.0) * q.y,
        (2.0 / 3.0) * q.y
      );

      // round to nearest hex via cube coord rounding
      // cube: x = ax.x, z = ax.y, y = -x - z
      float cx = ax.x, cz = ax.y, cy = -cx - cz;
      float rx = floor(cx + 0.5);
      float ry = floor(cy + 0.5);
      float rz = floor(cz + 0.5);
      float dx = abs(rx - cx);
      float dy = abs(ry - cy);
      float dz = abs(rz - cz);
      if (dx > dy && dx > dz) rx = -ry - rz;
      else if (dy > dz) ry = -rx - rz;
      else rz = -rx - ry;

      // hex center in axial -> cartesian
      vec2 hexCenter = vec2(
        HEX_SIZE * (SQRT3 * rx + (SQRT3 / 2.0) * rz),
        HEX_SIZE * (1.5 * rz)
      );
      // local position within hex
      vec2 local = p - hexCenter;

      // fold via 6-fold rotation: get the angle, mod TAU/6
      float r = length(local);
      float theta = atan(local.y, local.x);
      // wedge angle = 60°
      float wedge = TAU / 6.0;
      float t = mod(theta + wedge / 2.0, wedge) - wedge / 2.0;  // -30°..30°

      // mirror across the wedge's axis (60° wedge becomes 30°)
      t = abs(t);

      // back to cartesian; normalize so the max radius (HEX_SIZE * 1) maps to ~1
      vec2 result = vec2(cos(t), sin(t)) * (r / HEX_SIZE);
      return result;
    }
  `,

  // hex wedge has TWO center-incident "spoke" edges that are NOT cell
  // boundaries — they're visual artifacts of how we draw the fundamental wedge
  // of the hex tile. dragging "near a spoke" on hex shouldn't classify as
  // scale (scale should only fire on the FAR cell-boundary edge).
  spokeRule: 'hex',

  buildPolygon(state) {
    // per Daniel's v0.0.7 feedback, show a wedge representing the FUNDAMENTAL
    // sample region (the same region radial shows), not the cumulative envelope.
    // For hex (p6m wallpaper group), the fundamental wedge is a 30° triangle:
    //   - vertex at slice center
    //   - one edge along the +X axis out to radius √3/2 (hex inradius)
    //   - other edge at +30° out to radius 1 (hex circumradius)
    // The wedge has STRAIGHT EDGES because the hex tile has straight sides.
    const HEX_INR = Math.sqrt(3) / 2;
    return [
      { vx: 0, vy: 0 },
      { vx: HEX_INR, vy: 0 },
      { vx: Math.cos(Math.PI / 6), vy: Math.sin(Math.PI / 6) },
    ];
  },

  filenameSuffix(state) {
    return '';
  },

  // tile density for resolution hint. hex tiling at HEX_SIZE=0.6 packs ~1.4
  // distinct mirror-tiles per linear axis on the canvas; this was the original
  // pre-build-2 value and is left unchanged because it wasn't reporting issues.
  // could be re-derived from HEX_SIZE if hex layout changes in the future.
  tilesPerDim(state) {
    return 1.4;
  },
};
