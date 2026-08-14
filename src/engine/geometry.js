// engine/geometry.js
//
// (imports formSizeNorm at call-time inside sliceVecToSourceUV — a live binding, safe if the
//  forms↔geometry module graph ever cycles, since it's read per-call not at module eval.)
//
// pure geometric functions — no DOM, no GL. these are the JS-side mirrors of
// the shader's geometric math, used by the overlay to display the wedge in the
// SAME coordinate frame the shader samples from. when this math drifts from
// the shader's, the overlay stops matching the rendered output.
//
// also shared utilities like polygonRadiusAt and pointInPolygon that are
// generic enough that any future form's hit-testing can use them.

import { formSizeNorm } from './forms/index.js';

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
  // scale by 0.5 * sliceFactor — MUST match the shader's u_sliceFactor exactly, including the
  // per-form perceived-size norm (or the wedge overlay desyncs from the render).
  const f = 0.5 * state.sliceScale * formSizeNorm(state);
  x *= f;
  y *= f;
  // aspect correction (same direction as shader)
  if (sourceAspect >= 1.0) x /= sourceAspect;
  else y *= sourceAspect;
  // Y-flip — match the shader's toSourceUV (Build 57 added negate(v.y) before
  // adding sliceCenter so canvas-top samples source-top). Without this mirror
  // here, the polygon overlay shows the wedge at the Y-mirrored position
  // from where the GPU actually samples — visible on forms without bilateral
  // mirror symmetry across the horizontal (radial/hex/square/triangle when
  // sliceRotation is not on a horizontal axis).
  return { dx: x, dy: -y };
}

// CENTRE THE FORM IN THE SOURCE (Daniel, B615). His rule, stated geometrically:
//
//   "draw an imaginary box around the form, including the centre/offset point, then centre that
//    box within the aspect ratio of the source."
//
// This replaces the old behaviour of parking the ORIGIN at (0.5, 0.5), which only ever looked
// right for the rectangle — whose origin IS its centre. Every wedge form grows outward FROM its
// origin, so an origin at the middle pushes the sampled region off to one side.
//
// Derived from each form's own `buildPolygon` rather than per-form constants, so it stays correct
// for forms that do not exist yet, and it automatically tracks sliceScale, sizeNorm, sliceRotation
// and the source aspect — every one of which moves the box.
//
// The origin (0,0) is always included: it is the apex for the wedge forms and the point Daniel
// means by "the centre offset point". Forms whose polygon already surrounds it (rectangle, droste)
// are unaffected by its inclusion, which is why they stay centred and the wedges move.
// The box's midpoint in ABSOLUTE source UV, i.e. "which part of the image is being sampled".
// Returns null when the form has no polygon to measure.
export function formBoxCenter(form, state, sourceAspect) {
  const pts = form?.buildPolygon?.(state);
  if (!pts?.length) return null;
  let minX = 0, maxX = 0, minY = 0, maxY = 0;   // seeded with the origin — see above
  for (const p of pts) {
    const { dx, dy } = sliceVecToSourceUV(p.vx, p.vy, state, sourceAspect);
    if (dx < minX) minX = dx;
    if (dx > maxX) maxX = dx;
    if (dy < minY) minY = dy;
    if (dy > maxY) maxY = dy;
  }
  return {
    x: (state.sliceCx ?? 0.5) + (minX + maxX) / 2,
    y: (state.sliceCy ?? 0.5) + (minY + maxY) / 2,
    halfW: (maxX - minX) / 2,
    halfH: (maxY - minY) / 2,
  };
}

// Put the form's BOX midpoint on (tx, ty) and return the origin that achieves it. Solving for the
// origin rather than storing it is what lets `sliceCx/Cy` keep meaning "which part of the image",
// which is the only reading under which carrying it across a form switch makes sense: the ORIGIN
// means different things per form (apex for the wedges, centre for the rectangle) but the BOX
// CENTRE means the same thing everywhere.
export function placeFormBox(form, state, sourceAspect, tx = 0.5, ty = 0.5) {
  const c = formBoxCenter(form, state, sourceAspect);
  if (!c) return { sliceCx: tx, sliceCy: ty };
  return {
    sliceCx: (state.sliceCx ?? 0.5) + (tx - c.x),
    sliceCy: (state.sliceCy ?? 0.5) + (ty - c.y),
  };
}

export const centerFormInSource = (form, state, sourceAspect) => placeFormBox(form, state, sourceAspect, 0.5, 0.5);

// The form's long edge should follow the SOURCE's long edge, so a portrait source turns every
// form 90° clockwise (Daniel, B615). Returns the default sliceRotation for an orientation.
export const defaultSliceRotation = (sourceAspect) => (sourceAspect < 1 ? 90 : 0);

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
