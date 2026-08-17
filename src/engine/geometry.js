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
// The slice's HANDEDNESS, sanitised. Sessions saved before B635 (and any snapshot assembled by
// hand) have no mirror fields at all, and an undefined here would reach the shader as NaN and
// blank the canvas — so every read goes through this, never through `state.sliceMirrorX` directly.
export function sliceMirror(state) {
  return {
    mx: state?.sliceMirrorX === -1 ? -1 : 1,
    my: state?.sliceMirrorY === -1 ? -1 : 1,
  };
}

// Orientation of the slice frame: +1 = same handedness as the source, −1 = reflected. Everything
// that reads as a DIRECTION rather than a position inverts with it — most visibly rotation, which
// is why the drag handlers multiply their angular delta by this.
export const sliceDet = (state) =>
  (state?.sliceMirrorX === -1 ? -1 : 1) * (state?.sliceMirrorY === -1 ? -1 : 1);

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
  //
  // B635 — the HANDEDNESS flip is applied LAST, on the finished source-UV offset, because that is
  // the space the mirror-tiling symmetry lives in: negating the offset about the slice centre is
  // exactly the reflection that leaves the sampled pixels untouched. Applying it any earlier
  // (before rotation, say) would not compose with `foldSliceIntoSource`'s arithmetic.
  // Read the two signs INLINE rather than through `sliceMirror`, which returns a fresh object: this
  // runs once per polygon vertex, on every overlay draw and every box measurement, so an allocation
  // here is thousands of short-lived objects a second during a drag. Same sanitising, no garbage.
  const mx = state?.sliceMirrorX === -1 ? -1 : 1;
  const my = state?.sliceMirrorY === -1 ? -1 : 1;
  return { dx: x * mx, dy: -y * my };
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

// ===========================================================================
// THE SAMPLED BOX — "the slice you can actually see" (B635)
// ===========================================================================
//
// ⚠️ THIS IS A DIFFERENT BOX FROM `formBoxCenter` ABOVE, ON PURPOSE. Two questions, two answers:
//
//   formBoxCenter  → the form's DECLARED polygon, with the ORIGIN seeded in. Answers "where should
//                    a freshly reset form sit", which is why it includes the origin (Daniel's B615
//                    rule) and why droste, whose declared polygon is a placeholder full circle,
//                    centres its annulus on the frame.
//   sliceBoxCenter → the region the shader ACTUALLY samples, with NO origin seed. Answers "is the
//                    thing on screen still on the image", which is the only question a bound may
//                    ask.
//
// **Collapsing them would break droste in the exact way Daniel reported:** *"because the droste
// origin is far away from the slice, you can drag near the origin and push the slice itself
// entirely off canvas."* Droste's declared polygon is a unit circle centred on the origin, so a
// bound measured from it is really a bound on the origin — and the annular WEDGE, which is what
// you see, was free to leave. `ghostPaths` is already the form's own statement of its true sampled
// outline (it exists for the perform onion skin), so the bound reuses it rather than inventing a
// second description that could drift from the render.
//
// Forms with no ghostPaths fall back to buildPolygon, which for every wedge form already has the
// apex at (0,0) as a real vertex — so dropping the origin seed changes nothing for them.
function sampleOutlines(form, state) {
  const paths = form?.ghostPaths?.(state);
  if (paths?.length) return paths.filter((p) => p?.length);
  const poly = form?.buildPolygon?.(state);
  return poly?.length ? [poly] : [];
}

export function sliceBoxCenter(form, state, sourceAspect) {
  const paths = sampleOutlines(form, state);
  if (!paths.length) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const pts of paths) {
    for (const p of pts) {
      const { dx, dy } = sliceVecToSourceUV(p.vx, p.vy, state, sourceAspect);
      if (dx < minX) minX = dx;
      if (dx > maxX) maxX = dx;
      if (dy < minY) minY = dy;
      if (dy > maxY) maxY = dy;
    }
  }
  if (!isFinite(minX) || !isFinite(minY)) return null;
  return {
    x: (state.sliceCx ?? 0.5) + (minX + maxX) / 2,
    y: (state.sliceCy ?? 0.5) + (minY + maxY) / 2,
    halfW: (maxX - minX) / 2,
    halfH: (maxY - minY) / 2,
  };
}

// Solve for the origin that puts the SAMPLED box's midpoint on (tx, ty). The origin→box offset is
// fixed for a given scale/rotation/handedness, so this is an exact one-step solve, not an iteration.
export function placeSliceBox(form, state, sourceAspect, tx, ty) {
  const c = sliceBoxCenter(form, state, sourceAspect);
  if (!c) return { sliceCx: tx, sliceCy: ty };
  return {
    sliceCx: (state.sliceCx ?? 0.5) + (tx - c.x),
    sliceCy: (state.sliceCy ?? 0.5) + (ty - c.y),
  };
}

// ===========================================================================
// THE FOLD (B635) — this is what replaces the origin guardrail
// ===========================================================================
//
// **A bound that is not in STATE is not a bound.** B611 learned it, the B630→B634 guardrail
// violated it, and it leaked five times from five different writers (the scale drag, the phone's
// cover crop, the bus's translation mapping, droste's centre-offset handle, the original move
// drag). The reason is structural, not sloppiness: `clampOriginToSource` lived inside the overlay's
// drag handler, so it could only ever bound the one writer it sat inside — and autoplay, the tween,
// the follower, the bus and the remote all write `sliceCx/Cy` without passing through it.
//
// So the bound stops being a defence and becomes an IDENTITY. In mirror mode the source repeats
// with period 2 and reflects about every integer, so these three states sample **the same pixels,
// exactly**:
//
//     (cx, mirrorX)      ≡      (cx + 2k, mirrorX)      ≡      (2m − cx, −mirrorX)
//
// Fold the state into the representative whose SAMPLED BOX centre lands in [0,1] and the
// out-of-range state is not defended, it is *unrepresentable*. There is nothing left for a writer
// to escape, because the fold runs on the state that is about to be shown rather than at the point
// of each write.
//
// **The fold is pixel-preserving by construction**, which is the property that makes it safe to
// apply anywhere, at any time, as often as you like: it never changes the render, only which of
// several identical descriptions of the render we are holding. What it changes is which copy the
// overlay draws as PRIMARY — so the outline you are dragging is always the one you can see, and a
// gesture can no longer act on a reflection while you watch the original. That was the whole point
// (Daniel: *"when the slice overlay closest to the origin gets reflected it becomes the main slice
// instead of the reflection"*).
//
// ⚠️ MIRROR MODE ONLY. `clamp` smears its edge pixels and `transparent` is empty out there, so
// neither has the symmetry this relies on — those modes keep the origin itself inside [0,1], the
// pre-B630 behaviour.
//
// Returns the affine map it applied, `{ x: {a, b}, y: {a, b} }` with `v → a·v + b`, or null if the
// state was already canonical. Callers that hold an INTERPOLATOR over sliceCx/Cy (perform's
// follower) must push the same map through it — see follow.js `remap` — or the follower keeps
// easing toward a target that has moved out from under it.
// How much of the slice has to stay in view before the fold takes over. Daniel's own number from
// B631, kept deliberately: *"we must keep some % of the original slice overlapping with the visible
// source area."* What changed at B635 is the RESPONSE, not the threshold — falling below it used to
// hit a clamp that fought the drag, and now re-expresses the state as the reflection you can see.
const MIN_OVERLAP = 0.25;

// The canonical representative: which repeat of the mirrored plane the box centre fell into, and
// how to get home. The PARITY decides translation vs reflection; both are symmetries of the
// triangle wave, which is why either leaves the pixels alone. Null when already home.
// ===========================================================================
// ALIGNING TWO SNAPSHOTS INTO ONE FRAME (B637) — what makes motion mode correct
// ===========================================================================
//
// Motion holds every DISCRETE field to keyframe 0, and `sampleKeyframes` starts each frame from
// `{...list[0].snap}` — so kf0's handedness is pinned whatever the other keyframes say. That is
// fine for `segments` or `form`, and **wrong for the slice mirror, because it is the first discrete
// field COUPLED to a continuous one**: pinning kf0's handedness onto kf1's position renders a
// picture the operator never posed. Fold the slice between laying two keyframes and the second end
// of the loop comes back mirrored.
//
// The fix is not to stop pinning — it is to make the pin TRUE, by re-expressing the later keyframe
// in kf0's frame before anyone reads it. The symmetry group gives that for free: `(cx, m)` and
// `(2n − cx, −m)` are the same picture, so there is always a description of kf1 that carries kf0's
// handedness, and adopting it does not change how that keyframe looks.
//
// **WHICH reflection, though — that is the whole difficulty, and it is why the ±1 flag alone cannot
// solve this.** A flag of −1 does not record whether it came from a reflection about u=1 or u=3.
// So rather than trying to recover the history, pick the representative whose SAMPLED BOX lands
// nearest the reference's: `n = round((ref + cur) / 2)` is exactly the integer that puts
// `2n − cur` closest to `ref`. That is also what a tween wants — the shortest honest travel between
// the two looks, which plays as the slice running out to the edge and reflecting back. Which is
// precisely what the operator watched happen when they dragged it there.
//
// Returns true if it changed anything. **The handedness comparison comes first and costs two
// integer reads**, so the overwhelmingly common already-aligned case never measures a box — this
// runs on every sampled frame of playback.
export function alignSliceFrame(snap, ref, form, sourceAspect) {
  if (!snap || !ref) return false;
  const smx = snap.sliceMirrorX === -1 ? -1 : 1, smy = snap.sliceMirrorY === -1 ? -1 : 1;
  const rmx = ref.sliceMirrorX === -1 ? -1 : 1,  rmy = ref.sliceMirrorY === -1 ? -1 : 1;
  if (smx === rmx && smy === rmy) return false;
  const c = sliceBoxCenter(form, snap, sourceAspect);
  const r = sliceBoxCenter(form, ref, sourceAspect);
  if (!c || !r || !isFinite(c.x) || !isFinite(r.x)) return false;
  // Axes are independent: reflecting x negates only the x offsets, so `c.y` stays valid below.
  if (smx !== rmx) {
    const n = Math.round((r.x + c.x) / 2);
    snap.sliceCx = 2 * n - (snap.sliceCx ?? 0.5);
    snap.sliceMirrorX = rmx;
  }
  if (smy !== rmy) {
    const n = Math.round((r.y + c.y) / 2);
    snap.sliceCy = 2 * n - (snap.sliceCy ?? 0.5);
    snap.sliceMirrorY = rmy;
  }
  return true;
}

const foldMap = (c) => {
  if (!(c < 0) && !(c > 1)) return null;
  const k = Math.floor(c);
  return (k % 2 === 0)
    ? { a: 1, b: -k }            // even repeat → slide back
    : { a: -1, b: k + 1 };       // odd repeat  → reflect about (k+1)/2
};

// ⚠️ THE TRIGGER IS "HAS IT LEFT", NOT "HAS ITS CENTRE CROSSED" — and measurement is what settled
// that. Folding on the centre alone is tidier arithmetic and it is WRONG, because droste's default
// fails it: on a square or portrait source its sampled wedge centres at u = 1.091, so a freshly
// reset droste would fold on sight and open with its origin off the right of the panel. Daniel
// named this exact risk before a line was written — *"with droste in particular the origin is often
// some distance from the slice and it would be strange to clip the overlay into a reflection before
// it even reaches the edge of the source"* — and `defaultOverflow` is droste saying out loud that
// overflowing the source IS its look.
//
// So the fold waits until the slice has genuinely stopped being visible, then adopts the
// representative that brings it back. Two guards keep that terminating:
//   1. only fold when coverage is below the threshold, so a slice merely hanging over an edge is
//      left exactly where the operator put it;
//   2. only adopt the canonical representative when it is strictly BETTER, so a slice larger than
//      the source (which can never reach 25% anywhere) settles instead of flipping every frame.
const axisFold = (c, half, lo, hi) => {
  const span = 2 * half;
  if (!(span > 0)) return null;
  const cover = (cc) => Math.max(0, Math.min(cc + half, hi) - Math.max(cc - half, lo)) / span;
  const now = cover(c);
  if (now >= MIN_OVERLAP) return null;
  const m = foldMap(c);
  if (!m) return null;                          // already canonical — nothing better exists
  return cover(m.a * c + m.b) > now ? m : null;
};

// `view` is the part of the source the operator can actually SEE, as {u0,u1,v0,v1} — the phone
// mounts its source panel `fit: 'cover'`, so a slice can sit inside the source and outside the
// panel, which to the operator is indistinguishable from off-canvas (Daniel, B633). It is the
// reference for the TRIGGER only. The FOLD is always into the source's own [0,1] domain, because
// that is where the mirror symmetry lives — a crop has no symmetry to exploit. Two questions, two
// references; conflating them is what made the old bound wrong on one chrome.
export function foldSliceIntoSource(state, form, sourceAspect, view = null) {
  if (!state) return null;
  if (state.oobMode !== 1) {
    // No symmetry to exploit: `clamp` smears its edge and `transparent` is empty, so a reflection
    // out there is not the same picture. Keep the ORIGIN on the image, the pre-B630 rule.
    state.sliceCx = Math.max(0, Math.min(1, state.sliceCx ?? 0.5));
    state.sliceCy = Math.max(0, Math.min(1, state.sliceCy ?? 0.5));
    return null;
  }
  const box = sliceBoxCenter(form, state, sourceAspect);
  if (!box || !isFinite(box.x) || !isFinite(box.y)) return null;
  const v = view || { u0: 0, u1: 1, v0: 0, v1: 1 };
  const fx = axisFold(box.x, box.halfW, v.u0, v.u1);
  const fy = axisFold(box.y, box.halfH, v.v0, v.v1);
  if (!fx && !fy) return null;
  if (fx) {
    state.sliceCx = fx.a * (state.sliceCx ?? 0.5) + fx.b;
    state.sliceMirrorX = sliceMirror(state).mx * fx.a;
  }
  if (fy) {
    state.sliceCy = fy.a * (state.sliceCy ?? 0.5) + fy.b;
    state.sliceMirrorY = sliceMirror(state).my * fy.a;
  }
  return { x: fx, y: fy };
}

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
  state.sliceMirrorX   = 1;   // B635 — handedness is geometry, so it resets with the rest of it,
  state.sliceMirrorY   = 1;   // and BEFORE the box below is measured (a mirrored box is a different box)
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
