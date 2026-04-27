// engine/geometry.js
//
// pure geometric functions — no DOM, no GL. these are the JS-side mirrors of
// the shader's geometric math, used by the overlay to display the wedge in the
// SAME coordinate frame the shader samples from. when this math drifts from
// the shader's, the overlay stops matching the rendered output.
//
// also shared utilities like polygonRadiusAt and pointInPolygon that are
// generic enough that any future form's hit-testing can use them.

// JS mirror of the shader's `toSourceUV` for a folded-space unit vector.
// returns the SIGNED OFFSET in source-UV space from sliceCenter for the input
// folded vector. caller adds sliceCenter to get the absolute UV.
//
// this MUST match the shader's transform exactly — same rotation matrix
// convention, same scale factor, same aspect-correction direction. when you
// add a new form whose buildPolygon returns folded-space vertices, this
// function will correctly place those vertices in source-UV.
export function sliceVecToSourceUV(vx, vy, state, sourceAspect) {
  // apply slice rotation (CW positive on screen, y-down)
  const c = Math.cos(state.sliceRotation * Math.PI / 180);
  const s = Math.sin(state.sliceRotation * Math.PI / 180);
  let x = c * vx - s * vy;
  let y = s * vx + c * vy;
  // scale by 0.5 * sliceFactor
  x *= 0.5 * state.sliceScale;
  y *= 0.5 * state.sliceScale;
  // aspect correction (same direction as shader)
  if (sourceAspect >= 1.0) x /= sourceAspect;
  else y *= sourceAspect;
  return { dx: x, dy: y };
}

// ray-from-center boundary radius: shoot a ray from (cx, cy) at angle theta,
// return the distance to the first polygon edge it crosses. in display pixels,
// for use by hit-testing.
//
// algorithm: parametrize the ray as (cx + t*cos(θ), cy + t*sin(θ)) for t > 0;
// for each polygon edge AB, solve for t that puts the ray-point on segment AB.
// keep the smallest positive t. returns null if no edge is hit (which happens
// when theta points outside the polygon's angular range — caller falls back to
// the polygon's max radius).
export function polygonRadiusAt(theta, cx, cy, screenPts) {
  if (!screenPts || screenPts.length < 2) return null;
  const dx = Math.cos(theta), dy = Math.sin(theta);
  let bestT = Infinity;
  for (let i = 0; i < screenPts.length; i++) {
    const a = screenPts[i];
    const b = screenPts[(i + 1) % screenPts.length];
    // line AB parameterized as A + s*(B-A) for s in [0,1]
    // ray as C + t*(dx,dy) for t > 0
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-9) continue;  // ray parallel to edge
    const t = ((a.x - cx) * ey - (a.y - cy) * ex) / denom;
    const s = ((a.x - cx) * dy - (a.y - cy) * dx) / denom;
    if (t > 0 && s >= -1e-6 && s <= 1 + 1e-6 && t < bestT) bestT = t;
  }
  return isFinite(bestT) ? bestT : null;
}

// point-in-polygon ray casting test. (x, y) and pts are in the same coordinate
// system (display pixels for the overlay; folded space for shader-side checks).
export function pointInPolygon(x, y, pts) {
  if (!pts || pts.length < 3) return false;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi || 0.0001) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
