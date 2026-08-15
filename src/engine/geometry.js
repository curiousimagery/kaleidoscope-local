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

// The form's long edge should follow the long edge of the FRAME YOU CAN SEE.
//
// ⚠️ B619 — THE REFERENCE IS THE OUTPUT FRAME, NOT THE SOURCE. B615 keyed this off the source
// aspect, which is wrong wherever the two disagree, and on iOS they always disagree: the mobile
// chrome opens at frameAspect 1 (a square canvas) while the camera hands it a portrait source. The
// old rule turned every form 90° to match an image nobody sees the shape of, so the wedges stood
// vertical inside a square frame with dead space either side. Daniel called it as an iOS exception;
// it generalises cleanly, because "orient to what is visible" is the rule he actually wants
// everywhere, and on desktop (landscape source, landscape frame) it returns the same answer B615
// did. A SQUARE frame has no long edge, so it takes the horizontal default.
export const defaultSliceRotation = (frameAspect) => (frameAspect < 1 ? 90 : 0);

// THE SLICE RESET — one definition, both chromes.
//
// ⚠️ Mobile had its own four-line copy that reset scale/rotation/centre and nothing else: no
// box centring, no orientation, no droste params, no segments. That is why iOS still opened with
// every form parked on its origin after B616 "fixed" it — the fix landed on the desktop path and
// the mobile chrome does not import main.js at all. Two chromes, two answers, one of them stale.
//
// Ordering is load-bearing: every geometry input has to be at its default BEFORE the box is
// measured, and the ORIENTATION has to be set before the centring, because rotating the form
// changes the box it is centred by (Daniel's rule, B615).
// How much of the source the DEFAULT slice box may span, leaving the rest as buffer. Only ever
// shrinks a form that would overflow; a form already inside this keeps exactly what its tuning gave
// it. 0.9 (B628) landed correctly on device but read tight to Daniel, so 0.75 — a 12.5% margin each
// side. Note this bites ONLY where a form overflows: at the 1.78 desktop reference radial (0.632),
// hex (0.587) and triangle (0.751) are all still inside it and remain untouched at scale 1.0;
// square (0.800) now fits down slightly on every aspect.
const FIT_EXTENT = 0.75;

export function resetSliceState(state, form, sourceAspect, frameAspect, applyArmsSnap) {
  state.segments       = 12;
  state.sliceScale     = 1.0;
  state.sliceRotation  = defaultSliceRotation(frameAspect);
  state.sliceCx        = 0.5;
  state.sliceCy        = 0.5;
  state.squareAspect   = 1.0;
  state.drosteZoom     = 2.0;
  state.drosteSpiral   = 0;
  state.drosteMirror   = true;
  state.drosteArms     = 6;   // match the state default (a relatable kaleidoscopic shape, not the lone arms=1 spiral)
  state.drosteWedgeMirror = true;
  state.drosteOffsetX  = 0;
  state.drosteOffsetY  = 0;
  // ⚠️ B627 — PASS STATE. This used to be `applyArmsSnap?.()` with no argument, which carried an
  // implicit contract only ONE of the two callers satisfied: `main.js` injects a zero-arg wrapper
  // that closes over its own `state`, while `mobile/chrome.js` injects `kit/snaps.js`'s
  // `applyArmsSnap(state)` directly. So desktop worked and mobile threw
  // `undefined is not an object (evaluating 'state.drosteSpiral')` — which, because the caller
  // guards this whole function, meant the iPhone silently never centred its slice at all.
  // Passing state makes the contract explicit and satisfiable by both (the wrapper ignores it).
  // **Seventh instance of one behaviour living in two chromes with two answers.**
  applyArmsSnap?.(state);
  // ⚠️ B628 — FIT THE BOX TO THE SOURCE BEFORE CENTRING IT. Centring alone was only half the job:
  // a box wider than the source is off-image however you place it, which is Daniel's iPhone report
  // (*"instead of having some buffer to the left and right we actually have some overage"*).
  //
  // The measured cause is that **the wedge forms' horizontal extent does not depend on source
  // aspect below 1.0.** `sliceVecToSourceUV` divides x by the aspect only when the source is
  // LANDSCAPE; for portrait it shrinks y instead and leaves x at full size. So the same `sizeNorm`
  // that measured 0.632 on the 1.78 desktop reference measures 1.125 on any portrait source:
  //
  //   form      1.78    1.00    0.75    0.46
  //   radial    0.632   1.125   1.125   1.125
  //   hex       0.587   1.018   1.018   1.018
  //   triangle  0.751   1.300   1.300   1.300
  //
  // Scaling to fit here (never up, only down) keeps every value Daniel tuned intact — at 1.78 all
  // four fitting forms are already below the margin, so **the desktop defaults do not move at all**
  // — and only engages where the form would otherwise run off the image.
  const box = form?.defaultOverflow ? null : formBoxCenter(form, state, sourceAspect);
  const extent = box ? 2 * Math.max(box.halfW, box.halfH) : 0;
  if (extent > FIT_EXTENT) state.sliceScale *= FIT_EXTENT / extent;
  Object.assign(state, centerFormInSource(form, state, sourceAspect));
  return state;
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
