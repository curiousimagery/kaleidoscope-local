// shell/overlay.js
//
// renders the slice overlay on top of the source image, and dispatches drag
// gestures (move / scale / rotate / segments / square-edge / square-corner)
// based on cursor classification.
//
// the overlay reads form-specific behavior from the active form's `spokeRule`
// and `buildPolygon` — adding a new form to the registry automatically gets
// correct overlay behavior as long as the form module fills in those fields.
//
// architecture:
//   - drawSourceOverlay(env): draws once. env carries DOM refs + state.
//   - classifyPointer(env, x, y, isTouch): returns mode + diagnostics.
//   - setupSourceInteraction(env): wires mouse/touch events on the wrap.
//
// `env` is the runtime container — { state, engine, sourceOverlayCanvas, ... }
// — assembled by main.js and threaded through. this avoids module-level
// mutable globals while keeping the call sites readable.

import { sliceVecToSourceUV, polygonRadiusAt, pointInPolygon } from '../engine/geometry.js';
import { getActiveForm } from '../engine/forms/index.js';
import { rotateCursorForAngle, scaleCursorForAngle } from './cursors.js';

// touch-surface detection — used to decide whether to render always-visible
// direct-manipulation handles (touch) vs cursor-only affordances (mouse).
const IS_TOUCH = matchMedia('(hover: none)').matches;

// hit-test bands in display pixels. mouse and touch have different sizes; the
// touch versions meet HIG 44pt minimum target sizing.
const HIT = {
  CENTER_DOT_MOUSE:     15,
  SCALE_BAND_IN_MOUSE:  20,
  SCALE_BAND_OUT_MOUSE: 20,
  SPOKE_BAND_IN_MOUSE:   4,
  SPOKE_BAND_OUT_MOUSE: 20,
  CENTER_DOT_TOUCH:     30,
  SCALE_BAND_IN_TOUCH:  28,
  SCALE_BAND_OUT_TOUCH: 28,
  SPOKE_BAND_IN_TOUCH:  10,
  SPOKE_BAND_OUT_TOUCH: 32,
  // Rhombus (triangle) scale band — dedicated so the interior stays mostly a
  // MOVE target. Thin interior band, slightly larger exterior. (The shared
  // SCALE_BAND_* above ate ~16-28px of the interior, leaving small rhombi with
  // no move zone.) See classifyPointer's rhombus branch.
  RHOMBUS_SCALE_IN_MOUSE:  4,
  RHOMBUS_SCALE_OUT_MOUSE: 16,
  RHOMBUS_SCALE_IN_TOUCH:  4,
  RHOMBUS_SCALE_OUT_TOUCH: 16,
};

// ===========================================================================
// drawing
// ===========================================================================

// rAF-coalesced wrapper. multiple calls within a single frame collapse into
// one redraw on the next animation frame.
export function makeOverlayDrawer(env) {
  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      draw();
    });
  }
  function draw() { drawSourceOverlay(env); }
  return { draw, schedule };
}

// displayed image rect inside the wrap. `contain` (default) letterboxes; `cover`
// fills the panel and crops the overflow (the displayed source's CSS fit must
// match — see mountSourceView). Cover is the contain branch inverted. Shared by
// the main overlay draw and the perform-mode ghost pass.
function imageRect(env, w, h, sourceAspect) {
  const coverMode = env.fit === 'cover';
  const wrapAspect = w / h;
  let imgW, imgH, imgX, imgY;
  if ((sourceAspect > wrapAspect) !== coverMode) {
    imgW = w;
    imgH = w / sourceAspect;
    imgX = 0;
    imgY = (h - imgH) / 2;
  } else {
    imgH = h;
    imgW = h * sourceAspect;
    imgX = (w - imgW) / 2;
    imgY = 0;
  }
  return { imgX, imgY, imgW, imgH };
}

// Perform-mode ONION SKIN (Arc 4): ghost wedge outlines for where the live
// output is / recently was, drawn ON TOP of a fresh overlay draw at low alpha
// (outlines only, so over-vs-under is visually equivalent). Older samples are
// nearly invisible; the caller fades the trail as the live output catches up
// (Daniel's onion-skin spec). Forms with bespoke overlays (droste) have no
// polygon to ghost yet — skipped, flagged in BACKLOG.
export function drawGhostWedges(env, ghosts) {
  const { engine } = env;
  if (!env.sourceOverlayCanvas || !engine.getSourceImage() || !ghosts?.length) return;
  const canvas = env.sourceOverlayCanvas;
  const wrap = canvas.parentElement;
  if (!wrap) return;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sourceAspect = engine.getSourceAspect();
  const { imgX, imgY, imgW, imgH } = imageRect(env, w, h, sourceAspect);
  for (const g of ghosts) {
    const st = g.snap;
    const form = getActiveForm(st);
    if (!form.buildPolygon) continue;
    const pts = form.buildPolygon(st);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, g.alpha));
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const { dx, dy } = sliceVecToSourceUV(p.vx, p.vy, st, sourceAspect);
      const x = imgX + (st.sliceCx + dx) * imgW;
      const y = imgY + (st.sliceCy + dy) * imgH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

export function drawSourceOverlay(env) {
  const { state, engine } = env;
  if (!env.sourceOverlayCanvas || !engine.getSourceImage()) return;
  // outline stroke multiplier — 1 for the live overlay; the companion source-preview
  // render bumps it so the wedge lines read at 1920² instead of hairline.
  const sw = env.overlayStrokeScale || 1;

  const canvas = env.sourceOverlayCanvas;
  const wrap = canvas.parentElement;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  if (w === 0 || h === 0) return;

  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const sourceAspect = engine.getSourceAspect();
  const { imgX, imgY, imgW, imgH } = imageRect(env, w, h, sourceAspect);

  const form = getActiveForm(state);

  // form-overridable overlay path — used by forms whose sample region isn't a
  // polygon (droste's annulus, future hyperbolic disc, etc.). the form takes
  // over from here: drawing its own dim background / holes / outlines /
  // affordances and populating canvas._geom with whatever its classifyPointer
  // needs.
  if (form.drawOverlay) {
    const cxPx = imgX + state.sliceCx * imgW;
    const cyPx = imgY + state.sliceCy * imgH;
    form.drawOverlay(env, ctx, {
      w, h, imgX, imgY, imgW, imgH,
      cx: cxPx, cy: cyPx,
      sourceAspect,
      IS_TOUCH,
      strokeScale: sw,
    });
    return;
  }

  // build polygon in source-UV space, then transform to screen pixels.
  const pts = form.buildPolygon(state);
  let oobAnyAxis = false;
  let oobLeft = false, oobRight = false, oobTop = false, oobBottom = false;
  const uvPts = pts.map(p => {
    const { dx, dy } = sliceVecToSourceUV(p.vx, p.vy, state, sourceAspect);
    const u = state.sliceCx + dx;
    const v = state.sliceCy + dy;
    if (u < 0) oobLeft = true;
    if (u > 1) oobRight = true;
    if (v < 0) oobTop = true;
    if (v > 1) oobBottom = true;
    if (u < 0 || u > 1 || v < 0 || v > 1) oobAnyAxis = true;
    return { u, v };
  });
  const uvToScreen = (u, v) => ({ x: imgX + u * imgW, y: imgY + v * imgH });
  const screenPts = uvPts.map(({ u, v }) => uvToScreen(u, v));

  // Optional secondary polygon: the actual fold sample region, drawn alongside
  // the main polygon when the two don't match (currently only triangle). Its
  // hole is unioned with the main polygon's; outline is drawn after the main
  // outline so it sits on top.
  let sampleScreenPts = null;
  if (form.buildSampleRegion) {
    const samplePts = form.buildSampleRegion(state);
    sampleScreenPts = samplePts.map(p => {
      const { dx, dy } = sliceVecToSourceUV(p.vx, p.vy, state, sourceAspect);
      return uvToScreen(state.sliceCx + dx, state.sliceCy + dy);
    });
  }

  // dim background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, w, h);

  // cut hole for slice region (the primary wedge)
  ctx.beginPath();
  screenPts.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fill();

  // also cut the sample-region hole so the wedge's poke-out (beyond the main
  // polygon) reveals source image too.
  if (sampleScreenPts) {
    ctx.beginPath();
    sampleScreenPts.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // mirror reflection visualization — when OOB mode is mirror AND the wedge
  // crosses an image edge, draw the reflected polygons (where the kaleidoscope
  // ACTUALLY pulls color from in mirror mode). drawn faintly + dashed.
  if (state.oobMode === 1 && oobAnyAxis) {
    const transforms = [];
    if (oobLeft)   transforms.push(({ u, v }) => ({ u: -u, v }));
    if (oobRight)  transforms.push(({ u, v }) => ({ u: 2 - u, v }));
    if (oobTop)    transforms.push(({ u, v }) => ({ u, v: -v }));
    if (oobBottom) transforms.push(({ u, v }) => ({ u, v: 2 - v }));
    // diagonal corner reflections (compose two)
    if (oobLeft && oobTop)     transforms.push(({ u, v }) => ({ u: -u, v: -v }));
    if (oobLeft && oobBottom)  transforms.push(({ u, v }) => ({ u: -u, v: 2 - v }));
    if (oobRight && oobTop)    transforms.push(({ u, v }) => ({ u: 2 - u, v: -v }));
    if (oobRight && oobBottom) transforms.push(({ u, v }) => ({ u: 2 - u, v: 2 - v }));

    ctx.save();
    ctx.beginPath();
    ctx.rect(imgX, imgY, imgW, imgH);
    ctx.clip();
    for (const tf of transforms) {
      const reflected = uvPts.map(tf).map(({ u, v }) => uvToScreen(u, v));
      ctx.beginPath();
      reflected.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 196, 80, 0.10)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 196, 80, 0.6)';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1 * sw;
      ctx.stroke();
    }
    ctx.restore();
  }

  // outline of primary wedge — solid white inside image bounds, dashed amber
  // when the polygon crosses the image edge. edge-specific highlight: scale-on-arc
  // brightens outer edges; scale-on-spoke brightens spokes; rotate brightens all.
  const cxPx = imgX + state.sliceCx * imgW;
  const cyPx = imgY + state.sliceCy * imgH;
  const SPOKE_EPS_DRAW = 1.0;
  const spokeEdges = [];
  const outerEdges = [];
  // Only split edges into spokes vs outer when the form has a functional spoke
  // distinction (radial: spokes = segments handle; hex: spokes = visual artifact
  // suppressed for scale). For spokeRule:'none' forms, treat all edges as outer
  // so they all highlight on scale-drag (e.g. triangle's rhombus, where the apex
  // sits at slice center but all edges are still cell boundaries).
  const splitSpokes = form.spokeRule !== 'none';
  for (let i = 0; i < screenPts.length; i++) {
    const a = screenPts[i];
    const b = screenPts[(i + 1) % screenPts.length];
    if (splitSpokes) {
      const aIsCenter = Math.hypot(a.x - cxPx, a.y - cyPx) < SPOKE_EPS_DRAW;
      const bIsCenter = Math.hypot(b.x - cxPx, b.y - cyPx) < SPOKE_EPS_DRAW;
      if (aIsCenter || bIsCenter) { spokeEdges.push({ a, b }); continue; }
    }
    outerEdges.push({ a, b });
  }

  // `closed` (Build 223): draw the boundary as ONE continuous path so its corners JOIN.
  // The per-edge moveTo/lineTo path (used for spokes) leaves butt-ended, unjoined corners
  // at the polygon vertices — the "rough corners" cleanup. Assumes the edges are sequential
  // around the loop (e[i].b === e[i+1].a), which holds for the slice polygon boundary.
  // REVERT: drop the `closed` branch + the `true` arg at the outerEdges call.
  function strokeEdges(edges, highlighted, closed) {
    if (edges.length === 0) return;
    if (oobAnyAxis) {
      ctx.strokeStyle = highlighted ? 'rgba(255, 230, 140, 1.0)' : 'rgba(255, 196, 80, 0.95)';
      ctx.setLineDash([6, 4]);
    } else {
      ctx.strokeStyle = highlighted ? 'rgba(255, 255, 255, 1.0)' : 'rgba(255, 255, 255, 0.9)';
      ctx.setLineDash([]);
    }
    ctx.lineWidth = (highlighted ? 2.5 : 1.5) * sw;
    const prevJoin = ctx.lineJoin;
    ctx.beginPath();
    if (closed) {
      ctx.lineJoin = 'round';
      ctx.moveTo(edges[0].a.x, edges[0].a.y);
      for (const e of edges) ctx.lineTo(e.b.x, e.b.y);
      // Close the loop ONLY if the chain actually returns to its start (a true closed
      // polygon: square/hex/triangle). Radial's outerEdges is an OPEN arc (the spokes
      // close the shape) — closing it would draw a chord across the wedge mouth.
      const f = edges[0].a, l = edges[edges.length - 1].b;
      if (Math.hypot(l.x - f.x, l.y - f.y) < 1.5) ctx.closePath();
    } else {
      for (const e of edges) {
        ctx.moveTo(e.a.x, e.a.y);
        ctx.lineTo(e.b.x, e.b.y);
      }
    }
    ctx.stroke();
    ctx.lineJoin = prevJoin;
    ctx.setLineDash([]);
  }

  const isRotateHover = env.hoverMode === 'rotate';
  const isScaleArcHover = env.hoverMode === 'scale' && !env.hoverOnSpoke;
  const isScaleSpokeHover = env.hoverMode === 'scale' && env.hoverOnSpoke;
  // On touch, hoverMode is always null (no hover events). Mirror the highlight
  // using the active drag mode so the outline lights up during touch gestures.
  const dm = env.overlayDragMode;
  const dragHL      = dm === 'rotate' || dm === 'scale' || dm === 'square-edge' || dm === 'square-corner' || dm === 'pinch';
  const dragHLSpoke = dm === 'segments' || dm === 'pinch';
  strokeEdges(outerEdges, isRotateHover || isScaleArcHover || dragHL, true);   /* closed loop → joined corners */
  strokeEdges(spokeEdges, isRotateHover || isScaleSpokeHover || dragHLSpoke);

  // sample-region outline: indicator showing the actual fold sample region.
  // Subtler than the main outline (1px @ 0.7 opacity vs 1.5px @ 0.9) so it
  // reads as informational rather than competing with the interactive frame.
  if (sampleScreenPts && sampleScreenPts.length >= 2) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1 * sw;
    ctx.setLineDash([]);
    ctx.beginPath();
    sampleScreenPts.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.stroke();
  }

  // center dot
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cxPx, cyPx, 3, 0, Math.PI * 2);
  ctx.fill();

  // Touch-only persistent affordances — drawn at ~60% opacity, fading to ~25%
  // during active drag so they don't compete with the active-state stroke highlights.
  if (IS_TOUCH && !(env.hideAffordances && env.hideAffordances())) {
    drawTouchAffordances(ctx, screenPts, cxPx, cyPx, outerEdges, spokeEdges, form,
      !!env.overlayDragging, env.overlayDragMode ?? null);
  }

  // store geometry for hit testing
  canvas._geom = { imgX, imgY, imgW, imgH, screenPts, cx: cxPx, cy: cyPx };
}

// ===========================================================================
// touch affordance drawing
// ===========================================================================

// Persistent touch affordances drawn on top of the polygon outline.
// Only called when IS_TOUCH is true (hover-none devices).
//
// Opacity rules:
//   rest (not dragging)       → 0.55 at 1.5px stroke
//   dragging, affordance active  → 1.00 at 2.5px stroke
//   dragging, affordance inactive → 0.25 at 1.5px stroke
//
// Pinch gestures dim all affordances — the form outline highlight (via dragHL
// in strokeEdges) provides the gesture feedback instead.
function drawTouchAffordances(ctx, screenPts, cx, cy, outerEdges, spokeEdges, form, isDragging, dragMode) {
  const SPOKE_EPS = 2;

  function afStyle(isActive) {
    if (!isDragging) return { op: 0.55, lw: 1.5 };
    return isActive ? { op: 1.00, lw: 2.5 } : { op: 0.25, lw: 1.5 };
  }

  // Pinch excluded: affordances all dim during pinch; outline handles the feedback.
  const rotateActive = isDragging && dragMode === 'rotate';
  const scaleActive  = isDragging && (dragMode === 'scale' || dragMode === 'square-edge');
  const spokesActive = isDragging && dragMode === 'segments';
  const cornerActive = isDragging && dragMode === 'square-corner';

  ctx.save();
  ctx.lineCap = 'round';

  if (form.id === 'square') {
    if (screenPts.length < 4) { ctx.restore(); return; }

    // Screen-relative affordance placement (orientation-independent): one
    // cluster only — a scale arrow on the TOP edge (height), one on the RIGHT
    // edge (width), a diagonal on the TOP-RIGHT corner, and the rotation arc
    // just beyond the right edge. Hit-testing still accepts all edges/corners;
    // this is only which handles we draw (per Daniel: drop the 5 redundant
    // mirror duplicates that crowded the chrome).
    const edgeMids = [];
    for (let i = 0; i < 4; i++) {
      const a = screenPts[i], b = screenPts[(i + 1) % 4];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const el = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      let nx = -(b.y - a.y) / el, ny = (b.x - a.x) / el;
      if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
      edgeMids.push({ mx, my, nx, ny });
    }
    const topEdge   = edgeMids.reduce((p, c) => (c.my < p.my ? c : p));
    const rightEdge = edgeMids.reduce((p, c) => (c.mx > p.mx ? c : p));
    const trVtx     = screenPts.reduce((p, c) => ((c.x - c.y) > (p.x - p.y) ? c : p));

    // Rotation arc beyond the right edge (24px clears its scale arrow).
    const reAng = Math.atan2(rightEdge.my - cy, rightEdge.mx - cx);
    const reR   = Math.hypot(rightEdge.mx - cx, rightEdge.my - cy);
    const { op: rop, lw: rlw } = afStyle(rotateActive);
    afRotationArc(ctx, cx, cy, reAng, reR + 24, rop, rlw);

    // Scale arrows: top edge + right edge.
    const { op: sop, lw: slw } = afStyle(scaleActive);
    afScaleArrow(ctx, topEdge.mx, topEdge.my, topEdge.nx, topEdge.ny, sop, slw);
    afScaleArrow(ctx, rightEdge.mx, rightEdge.my, rightEdge.nx, rightEdge.ny, sop, slw);

    // Diagonal scale arrow: top-right corner.
    const { op: cop, lw: clw } = afStyle(cornerActive);
    const cdx = trVtx.x - cx, cdy = trVtx.y - cy;
    const cLen = Math.hypot(cdx, cdy) || 1;
    afScaleArrow(ctx, trVtx.x, trVtx.y, cdx / cLen, cdy / cLen, cop, clw);

  } else if (form.id === 'triangle') {
    // Triangle's polygon is a horizontal 60-120 rhombus with the slice center
    // at the apex. All 4 edges are scale targets via spokeRule:'none'. Show
    // arrows on the 2 NON-APEX edges (the edges that don't touch slice
    // center). Per Daniel's feedback: dragging away from the apex grows the
    // rhombus, and the apex-incident edges have an asymmetric scale-grace
    // zone (Build 63 mitigated this but the natural grab point is still the
    // far side). Placing arrows on the non-apex edges makes the affordance
    // align with the natural drag direction.
    if (screenPts.length < 4) { ctx.restore(); return; }

    const edges = [];
    for (let i = 0; i < screenPts.length; i++) {
      const a = screenPts[i];
      const b = screenPts[(i + 1) % screenPts.length];
      const aIsApex = Math.hypot(a.x - cx, a.y - cy) < 1;
      const bIsApex = Math.hypot(b.x - cx, b.y - cy) < 1;
      const isApex = aIsApex || bIsApex;
      edges.push({ a, b, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, isApex });
    }
    const nonApexEdges = edges.filter(e => !e.isApex);
    const targetEdges = nonApexEdges.length >= 2
      ? nonApexEdges
      : edges.slice().sort((e1, e2) => e1.my - e2.my).slice(0, 2);

    const { op: sop, lw: slw } = afStyle(scaleActive);
    for (let i = 0; i < Math.min(2, targetEdges.length); i++) {
      const e = targetEdges[i];
      const ex = e.b.x - e.a.x;
      const ey = e.b.y - e.a.y;
      const el = Math.hypot(ex, ey) || 1;
      let nx = -ey / el, ny = ex / el;
      if ((e.mx - cx) * nx + (e.my - cy) * ny < 0) { nx = -nx; ny = -ny; }
      afScaleArrow(ctx, e.mx, e.my, nx, ny, sop, slw);
    }

    let topVtx = screenPts[0];
    for (const p of screenPts) {
      if (p.y < topVtx.y) topVtx = p;
    }
    const topAng = Math.atan2(topVtx.y - cy, topVtx.x - cx);
    const topR   = Math.hypot(topVtx.x - cx, topVtx.y - cy);
    let maxVD = 0;
    for (const p of screenPts) {
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d > maxVD) maxVD = d;
    }
    const { op: rop, lw: rlw } = afStyle(rotateActive);
    afRotationArc(ctx, cx, cy, topAng, Math.max(topR + 20, maxVD + 16), rop, rlw);

  } else {
    // Wedge forms (radial, hex): centroid of outer edge midpoints gives a stable
    // direction (bisector for radial, outer edge midpoint for hex) without jumps.
    if (outerEdges.length === 0) { ctx.restore(); return; }
    let ocx = 0, ocy = 0;
    for (const edge of outerEdges) {
      ocx += (edge.a.x + edge.b.x) / 2;
      ocy += (edge.a.y + edge.b.y) / 2;
    }
    ocx /= outerEdges.length;
    ocy /= outerEdges.length;
    const outerDist  = Math.hypot(ocx - cx, ocy - cy) || 1;
    const outerAngle = Math.atan2(ocy - cy, ocx - cx);
    const outNx = Math.cos(outerAngle);
    const outNy = Math.sin(outerAngle);

    // Exact polygon boundary at the centroid direction (so the arrow lands on the edge).
    const R = polygonRadiusAt(outerAngle, cx, cy, screenPts) ?? outerDist;

    // Scale arrow — centered on the outer boundary, intersecting the path.
    const { op: sop, lw: slw } = afStyle(scaleActive);
    afScaleArrow(ctx, cx + R * outNx, cy + R * outNy, outNx, outNy, sop, slw);

    // Rotation arc — adaptive gap so it clears the shape at all sizes.
    //   At least 20px beyond the boundary at the centroid direction.
    //   At least 16px beyond the outermost vertex (prevents clipping through corners
    //   on hex, where the vertex is farther from center than the edge midpoint).
    let maxVD = 0;
    for (const p of screenPts) {
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d > maxVD) maxVD = d;
    }
    const { op: rop, lw: rlw } = afStyle(rotateActive);
    afRotationArc(ctx, cx, cy, outerAngle, Math.max(R + 20, maxVD + 16), rop, rlw);

    // Spoke double-line — radial only, hints at segment-count adjustment.
    // Draw on ALL spoke edges (both sides of the wedge) so the affordance is
    // visible regardless of which side the user looks at. Pre-Build 61 only
    // the first spoke got the marker; after the Y-flip changed which spoke
    // appears at the screen-top, the single marker felt inconsistent.
    if (form.spokeRule === 'radial' && spokeEdges.length > 0) {
      const { op: spop, lw: splw } = afStyle(spokesActive);
      ctx.lineWidth = spokesActive ? splw : 1;
      ctx.strokeStyle = `rgba(255,255,255,${spop * 0.7})`;
      for (const spk of spokeEdges) {
        const aIsCenter = Math.hypot(spk.a.x - cx, spk.a.y - cy) < SPOKE_EPS;
        const origin = aIsCenter ? spk.a : spk.b;
        const tip    = aIsCenter ? spk.b : spk.a;
        const sx = tip.x - origin.x, sy = tip.y - origin.y;
        const slen = Math.hypot(sx, sy) || 1;
        const ux = sx / slen, uy = sy / slen;
        const perpX = -uy, perpY = ux;
        const GAP = 2.5, t0 = slen * 0.2, t1 = slen * 0.68;
        for (const sign of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(origin.x + ux * t0 + perpX * GAP * sign, origin.y + uy * t0 + perpY * GAP * sign);
          ctx.lineTo(origin.x + ux * t1 + perpX * GAP * sign, origin.y + uy * t1 + perpY * GAP * sign);
          ctx.stroke();
        }
      }
    }
  }

  ctx.restore();
}

// Bidirectional scale arrow at (mx, my) oriented along (nx, ny).
// HALF=14 gives 28px total line (Issue 2: was 14px, too short).
// Exported so the UI Lab can render the REAL affordance primitive (no divergent
// reproduction). Pure: draws on the given 2D context at the given coords.
export function afScaleArrow(ctx, mx, my, nx, ny, op, lw) {
  const HALF = 14, HEAD = 5;
  ctx.strokeStyle = `rgba(255,255,255,${op})`;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(mx - nx * HALF, my - ny * HALF);
  ctx.lineTo(mx + nx * HALF, my + ny * HALF);
  ctx.stroke();
  for (const [tx, ty, dx, dy] of [
    [mx + nx * HALF, my + ny * HALF,  nx,  ny],
    [mx - nx * HALF, my - ny * HALF, -nx, -ny],
  ]) {
    const a = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + Math.cos(a + 2.6) * HEAD, ty + Math.sin(a + 2.6) * HEAD);
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + Math.cos(a - 2.6) * HEAD, ty + Math.sin(a - 2.6) * HEAD);
    ctx.stroke();
  }
}

// Rotation arc: bidirectional curved arc, centered at (cx,cy), pointing toward
// cAngle direction, at explicit radius arcR. Arrowheads at both ends.
// Exported for the UI Lab (renders the real affordance primitive).
export function afRotationArc(ctx, cx, cy, cAngle, arcR, op, lw) {
  const HSPAN = 11 * Math.PI / 180;
  const HEAD  = 5;
  ctx.strokeStyle = `rgba(255,255,255,${op})`;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(cx, cy, arcR, cAngle - HSPAN, cAngle + HSPAN, false);
  ctx.stroke();
  // Arrowheads at both ends: clockwise end (+HSPAN) and counterclockwise end (-HSPAN).
  // Tangent direction at angle a on a clockwise arc (y-down) = a + π/2.
  // Reverse tangent (counterclockwise) = a - π/2.
  for (const [a, tang] of [
    [cAngle + HSPAN, cAngle + HSPAN + Math.PI / 2],
    [cAngle - HSPAN, cAngle - HSPAN - Math.PI / 2],
  ]) {
    const tipX = cx + arcR * Math.cos(a);
    const tipY = cy + arcR * Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX + Math.cos(tang + 2.6) * HEAD, tipY + Math.sin(tang + 2.6) * HEAD);
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX + Math.cos(tang - 2.6) * HEAD, tipY + Math.sin(tang - 2.6) * HEAD);
    ctx.stroke();
  }
}

// ===========================================================================
// hit testing
// ===========================================================================

// classify pointer position into 'move' | 'scale' | 'rotate' | form-specific | null.
// consults the active form's spokeRule for behavior switching, OR defers to a
// form-supplied classifyPointer override when the form's sample region doesn't
// fit the standard polygon model (droste's annulus, etc.).
function classifyPointer(env, x, y, isTouch = false) {
  const { state, sourceOverlayCanvas } = env;
  const g = sourceOverlayCanvas?._geom;
  if (!g) return { mode: null };

  const form = getActiveForm(state);

  // form-overridable hit testing. forms with bespoke overlays (droste) own
  // their hit-test math too — the built-in polygon-radius logic doesn't apply.
  if (form.classifyPointer) {
    return form.classifyPointer(env, x, y, isTouch, g);
  }
  const { cx, cy, screenPts: pts } = g;
  const px = x - cx;
  const py = y - cy;
  const r = Math.hypot(px, py);
  const theta = Math.atan2(py, px);

  const CENTER = isTouch ? HIT.CENTER_DOT_TOUCH : HIT.CENTER_DOT_MOUSE;
  if (r <= CENTER) return { mode: 'move', r, theta, R: null };

  const SCALE_IN  = isTouch ? HIT.SCALE_BAND_IN_TOUCH  : HIT.SCALE_BAND_IN_MOUSE;
  const SCALE_OUT = isTouch ? HIT.SCALE_BAND_OUT_TOUCH : HIT.SCALE_BAND_OUT_MOUSE;
  const SPOKE_IN  = isTouch ? HIT.SPOKE_BAND_IN_TOUCH  : HIT.SPOKE_BAND_IN_MOUSE;
  const SPOKE_OUT = isTouch ? HIT.SPOKE_BAND_OUT_TOUCH : HIT.SPOKE_BAND_OUT_MOUSE;

  let R = polygonRadiusAt(theta, cx, cy, pts);
  let outsideAngular = false;
  if (R == null) {
    R = Math.max(...pts.map(p => Math.hypot(p.x - cx, p.y - cy)));
    outsideAngular = true;
  }

  // Per-edge proximity check — for forms whose slice center sits at a polygon
  // vertex (e.g., triangle's rhombus apex). The standard CASE A check measures
  // "distance from outer angular boundary," which misses apex-incident edges
  // that lie INTERIOR to the polygon's angular range. For these forms, treat
  // any polygon edge within SCALE_OUT as a scale target. When the cursor is
  // angularly outside the polygon (outsideAngular), only apex-incident edges
  // count — those edges form the polygon's angular boundary, so cursor close
  // to one perpendicular-wise is the natural scale-grace zone on the outside.
  // Without that allowance, the apex-incident edge had only HALF the grace
  // zone of a non-apex edge (inside-perpendicular only).
  const sliceCenterAtVertex = pts.some(p => Math.hypot(p.x - cx, p.y - cy) < 1);
  if (form.spokeRule === 'none' && sliceCenterAtVertex) {
    // Rhombus (triangle): thin interior scale band so most of the interior is a
    // MOVE target. Signed perpendicular per edge (positive = outside the
    // polygon): scale only within a small interior band or a modest exterior
    // band; everything else inside is move, outside is rotate. Self-contained —
    // we don't fall through to CASE A, whose radial scale band would re-inflate
    // the interior scale region this branch is meant to trim.
    const APEX_EPS = 1.0;
    const SC_IN  = isTouch ? HIT.RHOMBUS_SCALE_IN_TOUCH  : HIT.RHOMBUS_SCALE_IN_MOUSE;
    const SC_OUT = isTouch ? HIT.RHOMBUS_SCALE_OUT_TOUCH : HIT.RHOMBUS_SCALE_OUT_MOUSE;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const aIsCenter = Math.hypot(a.x - cx, a.y - cy) < APEX_EPS;
      const bIsCenter = Math.hypot(b.x - cx, b.y - cy) < APEX_EPS;
      const isApexEdge = aIsCenter || bIsCenter;
      // Skip non-apex edges when angularly outside the polygon — those edges
      // are interior to the polygon's angular range, so cursor outside the
      // range can't be perpendicular-close to one in a useful way.
      if (outsideAngular && !isApexEdge) continue;
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const elen = Math.hypot(ex, ey) || 1;
      const ux = ex / elen, uy = ey / elen;
      const projT = (x - a.x) * ux + (y - a.y) * uy;
      if (projT < 0 || projT > elen) continue;
      // outward normal (away from polygon center) → signed distance from edge.
      let nx = -uy, ny = ux;
      const mxE = (a.x + b.x) / 2, myE = (a.y + b.y) / 2;
      if ((mxE - cx) * nx + (myE - cy) * ny < 0) { nx = -nx; ny = -ny; }
      const signed = (x - a.x) * nx + (y - a.y) * ny;
      if (signed >= -SC_IN && signed <= SC_OUT) {
        return { mode: 'scale', r, theta, R, onSpoke: false, cursorTheta: theta };
      }
    }
    if (!outsideAngular && r <= R) return { mode: 'move', r, theta, R };
    return { mode: 'rotate', r, theta, R };
  }

  // square form helper: classify cursor as near a CORNER or EDGE of the rect.
  const CORNER_ZONE = isTouch ? 44 : 28;
  function squareHandle() {
    if (form.id !== 'square' || pts.length !== 4) return null;
    let bestVtx = null;
    for (let i = 0; i < 4; i++) {
      const v = pts[i];
      const d = Math.hypot(v.x - x, v.y - y);
      if (bestVtx == null || d < bestVtx.d) bestVtx = { d, v };
    }
    let bestEdge = null;
    for (let i = 0; i < 4; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 4];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const d = Math.hypot(mx - x, my - y);
      if (bestEdge == null || d < bestEdge.d) bestEdge = { d, mx, my, a, b };
    }
    if (bestVtx.d < CORNER_ZONE && bestVtx.d < bestEdge.d) {
      const vsx = bestVtx.v.x - cx, vsy = bestVtx.v.y - cy;
      return {
        kind: 'corner',
        signX: Math.sign(vsx) || 1,
        signY: Math.sign(vsy) || 1,
        vx: bestVtx.v.x, vy: bestVtx.v.y,
      };
    }
    const ex = bestEdge.b.x - bestEdge.a.x;
    const ey = bestEdge.b.y - bestEdge.a.y;
    const elen = Math.hypot(ex, ey) || 1;
    const tx = ex / elen, ty = ey / elen;
    let nx = -ty, ny = tx;
    const out = (bestEdge.mx - cx) * nx + (bestEdge.my - cy) * ny;
    if (out < 0) { nx = -nx; ny = -ny; }
    return {
      kind: 'edge',
      tx, ty, nx, ny,
      mx: bestEdge.mx, my: bestEdge.my,
    };
  }

  const SPOKE_EPS = 1.0;
  function nearestSpoke() {
    let best = null;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const aIsCenter = Math.hypot(a.x - cx, a.y - cy) < SPOKE_EPS;
      const bIsCenter = Math.hypot(b.x - cx, b.y - cy) < SPOKE_EPS;
      if (!aIsCenter && !bIsCenter) continue;
      const tip = aIsCenter ? b : a;
      const sx = tip.x - cx, sy = tip.y - cy;
      const slen = Math.hypot(sx, sy) || 1;
      const ux = sx / slen, uy = sy / slen;
      const t = px * ux + py * uy;
      if (t < -SPOKE_OUT || t > slen + SPOKE_OUT) continue;
      const perp = px * (-uy) + py * ux;
      const absPerp = Math.abs(perp);
      if (best == null || absPerp < best.absPerp) {
        best = { ux, uy, t, slen, perp, absPerp };
      }
    }
    return best;
  }

  // for hex: closest polygon edge by perpendicular distance — if it's a spoke
  // edge (long side of the wedge representation), suppress scale classification.
  function isClosestEdgeSpoke() {
    let bestPerp = Infinity;
    let bestIsSpoke = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ex = b.x - a.x, ey = b.y - a.y;
      const elen = Math.hypot(ex, ey) || 1;
      const ux = ex / elen, uy = ey / elen;
      const projT = (x - a.x) * ux + (y - a.y) * uy;
      if (projT < 0 || projT > elen) continue;
      const perpDist = Math.abs((x - a.x) * (-uy) + (y - a.y) * ux);
      if (perpDist < bestPerp) {
        bestPerp = perpDist;
        const aIsCenter = Math.hypot(a.x - cx, a.y - cy) < SPOKE_EPS;
        const bIsCenter = Math.hypot(b.x - cx, b.y - cy) < SPOKE_EPS;
        bestIsSpoke = aIsCenter || bIsCenter;
      }
    }
    return bestIsSpoke;
  }

  function spokePerpAngle(sp) {
    return Math.atan2(sp.ux, -sp.uy);
  }

  // CASE A: cursor angle is INSIDE the polygon's angular range
  if (!outsideAngular) {
    // radial: spoke proximity = scale-on-spoke (= segments).
    if (form.spokeRule === 'radial') {
      const sp = nearestSpoke();
      if (sp && sp.absPerp <= Math.max(SPOKE_IN, SPOKE_OUT)) {
        const allowable = (r <= R) ? SPOKE_IN : SPOKE_OUT;
        if (sp.absPerp <= allowable && sp.t >= 0 && sp.t <= sp.slen + SPOKE_OUT) {
          return {
            mode: 'scale', r, theta, R,
            onSpoke: true, spoke: sp,
            cursorTheta: spokePerpAngle(sp),
          };
        }
      }
    }
    // hex: skip scale if closest edge is a spoke (visual artifact, not a cell boundary).
    const skipScaleForSpokeOnHex = form.spokeRule === 'hex' && isClosestEdgeSpoke();
    if (r <= R) {
      if (R - r <= SCALE_IN && !skipScaleForSpokeOnHex) {
        const sh = squareHandle();
        const ct = sh ? squareHandleCursorAngle(sh, cx, cy) : theta;
        return { mode: 'scale', r, theta, R, onSpoke: false, cursorTheta: ct, square: sh };
      }
      return { mode: 'move', r, theta, R };
    }
    if (r - R <= SCALE_OUT && !skipScaleForSpokeOnHex) {
      const sh = squareHandle();
      const ct = sh ? squareHandleCursorAngle(sh, cx, cy) : theta;
      return { mode: 'scale', r, theta, R, onSpoke: false, cursorTheta: ct, square: sh };
    }
    return { mode: 'rotate', r, theta, R };
  }

  // CASE B: cursor angle is OUTSIDE the polygon's angular range (radial wedges).
  // most space here is rotate; spoke-adjacent regions retain spoke-scale band.
  if (form.spokeRule === 'radial') {
    const sp = nearestSpoke();
    if (sp && sp.absPerp <= SPOKE_OUT && sp.t >= 0 && sp.t <= sp.slen + SPOKE_OUT) {
      return {
        mode: 'scale', r, theta, R,
        onSpoke: true, spoke: sp,
        cursorTheta: spokePerpAngle(sp),
      };
    }
  }
  return { mode: 'rotate', r, theta, R };
}

// for square form: handle hit → angle that should drive cursor selection.
// EDGE: the edge normal direction — cursor stays perpendicular to the edge as
//   the cursor moves along it.
// CORNER: a fixed 45° diagonal aligned with the corner's quadrant. uses the
//   SIGNS (not magnitudes) of the corner's offset from cell center, so the
//   cursor stays diagonal regardless of cell aspect ratio. without this, a
//   wide rectangle's corner would sit at a near-horizontal angle and the
//   cursor would discretize to ew-resize — visually breaking the "this is a
//   uniform-scale gesture" affordance.
function squareHandleCursorAngle(handle, cx, cy) {
  if (handle.kind === 'edge') {
    return Math.atan2(handle.ny, handle.nx);
  }
  if (handle.kind === 'corner') {
    return Math.atan2(handle.signY, handle.signX);
  }
  return 0;
}

// ===========================================================================
// drag dispatch
// ===========================================================================

// Handlers attached by the most recent mount — tracked so we remove them before
// re-binding. mountSourceView re-runs on every swap / fit-toggle / divider re-fit
// / source change with the SAME persistent slot element (`wrap`), and clearing
// the slot's innerHTML drops the canvas but NOT the slot's own listeners. Both
// the wrap-level AND window-level listeners must be removed: a leaked wrap
// `mousemove`/`touchmove` makes the accumulative rotate gesture fire N times per
// move, multiplying a 90° drag into 2-3× the rotation (it's the only gesture
// that sums deltas; absolute move/scale are immune, which is why only rotate ran
// away). Single active source overlay per chrome, so a module singleton is fine.
let _attachedHandlers = null;

export function setupSourceInteraction(env, wrap) {
  if (_attachedHandlers) {
    const h = _attachedHandlers;
    h.wrap.removeEventListener('mousedown', h.onDown);
    h.wrap.removeEventListener('mousemove', h.onMove);
    h.wrap.removeEventListener('touchstart', h.onDown);
    h.wrap.removeEventListener('touchmove', h.onMove);
    h.wrap.removeEventListener('wheel', h.onWheel);
    window.removeEventListener('mouseup', h.onUp);
    window.removeEventListener('touchend', h.onUp);
  }

  let drag = null;

  function localCoords(e) {
    const rect = wrap.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    return { x, y };
  }

  function uvFromXY(x, y) {
    const g = env.sourceOverlayCanvas?._geom;
    if (!g) return null;
    const u = (x - g.imgX) / g.imgW;
    const v = (y - g.imgY) / g.imgH;
    return { u, v };
  }

  function setCursor(c) {
    wrap.style.cursor = c;
  }

  function cursorForMode(mode, theta) {
    if (mode === 'move')          return 'grab';
    if (mode === 'scale')         return scaleCursorForAngle(theta);
    if (mode === 'rotate')        return rotateCursorForAngle(theta);
    if (mode === 'droste-arms')   return scaleCursorForAngle(theta);
    if (mode === 'droste-offset') return 'grab';
    return 'default';
  }

  function onMove(e) {
    const isTouch = !!e.touches;

    // two-finger pinch: scale + rotate + reposition the slice.
    if (drag?.mode === 'pinch' && e.touches?.length === 2) {
      const t0 = e.touches[0], t1 = e.touches[1];
      const dist  = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const angle = Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX);
      const { state } = env;
      state.sliceScale    = Math.max(0.05, Math.min(10, drag.startScale * (dist / drag.startDist)));
      let da = (angle - drag.startAngle) * 180 / Math.PI;
      // Y-flip in overlay means sliceRotation must be negated to keep the
      // wedge graphic rotating in the same screen direction as the fingers.
      // The apex-orbit below uses da_rad as-is (it's a position rotation in
      // screen y-down, unaffected by the wedge-direction flip).
      state.sliceRotation = ((drag.startRotation - da) % 360 + 360) % 360;
      // Rotate the apex around the finger midpoint — the standard two-finger
      // rigid-body transform. This keeps the midpoint as the true pivot so the
      // wedge tracks naturally under the fingers. Without this, rotation orbits
      // the apex (the wedge tip), which feels disconnected from where you're
      // actually touching.
      const g = env.sourceOverlayCanvas?._geom;
      if (g && drag.startPivotUV) {
        const rect = wrap.getBoundingClientRect();
        const midX = (t0.clientX + t1.clientX) / 2 - rect.left;
        const midY = (t0.clientY + t1.clientY) / 2 - rect.top;
        const curMid = uvFromXY(midX, midY);
        if (curMid) {
          const da_rad = da * Math.PI / 180;
          const cosA = Math.cos(da_rad);
          const sinA = Math.sin(da_rad);
          const dx = drag.startCx - drag.startPivotUV.u;
          const dy = drag.startCy - drag.startPivotUV.v;
          state.sliceCx = Math.max(0, Math.min(1, curMid.u + dx * cosA - dy * sinA));
          state.sliceCy = Math.max(0, Math.min(1, curMid.v + dx * sinA + dy * cosA));
        }
      }
      env.syncControls();
      env.scheduleRender();
      env.scheduleOverlayDraw();
      e.preventDefault();
      return;
    }

    const { x, y } = localCoords(e);

    if (drag) {
      const { state } = env;
      const g = env.sourceOverlayCanvas?._geom;

      if (drag.mode === 'move') {
        const newCxPx = x + drag.dragOffsetX;
        const newCyPx = y + drag.dragOffsetY;
        const uv = uvFromXY(newCxPx, newCyPx);
        if (!uv) return;
        state.sliceCx = Math.max(0, Math.min(1, uv.u));
        state.sliceCy = Math.max(0, Math.min(1, uv.v));
      } else if (drag.mode === 'scale') {
        if (!g) return;
        const r = Math.hypot(x - g.cx, y - g.cy);
        if (drag.startR < 1) return;
        let newScale = drag.startScale * (r / drag.startR);
        newScale = Math.max(0.05, Math.min(3, newScale));
        state.sliceScale = newScale;
      } else if (drag.mode === 'square-edge') {
        if (!g) return;
        const perpNow = (x - g.cx) * drag.nx + (y - g.cy) * drag.ny;
        if (Math.abs(drag.startPerp) < 1) return;
        let r = perpNow / drag.startPerp;
        if (r < 0.05) r = 0.05;
        const newAspect = drag.axis === 'x'
          ? drag.startAspect * r
          : drag.startAspect / r;
        const newScale  = drag.startSliceScale * Math.sqrt(r);
        state.squareAspect = Math.max(0.25, Math.min(4, newAspect));
        state.sliceScale   = Math.max(0.05, Math.min(3, newScale));
      } else if (drag.mode === 'square-corner') {
        if (!g) return;
        const startDx = drag.startVx - drag.startCx;
        const startDy = drag.startVy - drag.startCy;
        const nowDx   = x - g.cx;
        const nowDy   = y - g.cy;
        if (e.shiftKey) {
          const rx = Math.abs(startDx) > 1 ? nowDx / startDx : 1;
          const ry = Math.abs(startDy) > 1 ? nowDy / startDy : 1;
          const rx2 = Math.max(0.05, rx);
          const ry2 = Math.max(0.05, ry);
          const newAspect = drag.startAspect * (rx2 / ry2);
          const newScale  = drag.startSliceScale * Math.sqrt(rx2 * ry2);
          state.squareAspect = Math.max(0.25, Math.min(4, newAspect));
          state.sliceScale   = Math.max(0.05, Math.min(3, newScale));
        } else {
          const startD = Math.hypot(startDx, startDy);
          const nowD   = Math.hypot(nowDx, nowDy);
          if (startD < 1) return;
          let r = nowD / startD;
          r = Math.max(0.05, r);
          state.sliceScale = Math.max(0.05, Math.min(3, drag.startSliceScale * r));
        }
      } else if (drag.mode === 'segments') {
        if (!g) return;
        const spx = x - g.cx, spy = y - g.cy;
        const perpNow = spx * (-drag.spoke.uy) + spy * drag.spoke.ux;
        const ang0 = Math.atan2(drag.spoke.perp, drag.spoke.slen);
        const angNow = Math.atan2(perpNow, drag.spoke.slen);
        const startWedge = (Math.PI * 2) / drag.startSegments;
        const newWedge = startWedge + 2 * Math.sign(drag.spoke.perp || 1) * (angNow - ang0);
        const targetWedge = Math.max((Math.PI * 2) / 48, Math.min(Math.PI, newWedge));
        let newSegs = Math.round((Math.PI * 2) / targetWedge);
        if (newSegs % 2 !== 0) newSegs += 1;
        newSegs = Math.max(2, Math.min(48, newSegs));
        if (newSegs !== state.segments) {
          state.segments = newSegs;
        }
      } else if (drag.mode === 'rotate') {
        // Compute the pointer angle in the FROZEN frame snapshotted at drag start
        // (drag.rect + drag.cx0/cy0), not the live panel rect. If the source
        // panel reflows mid-drag (e.g. iPhone Safari hiding its address bar fires
        // resize), the live rect would shift under the snapshot center and inject
        // spurious angle that accumulates — the wedge then spins far faster than
        // the finger. Freezing the frame keeps rotation tracking the finger 1:1.
        const fx = (e.touches ? e.touches[0].clientX : e.clientX) - drag.rect.left;
        const fy = (e.touches ? e.touches[0].clientY : e.clientY) - drag.rect.top;
        const a = Math.atan2(fy - drag.cy0, fx - drag.cx0);
        let delta = a - drag.prevAngle;
        if (delta > Math.PI)  delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;
        drag.prevAngle = a;
        state.sliceRotation = state.sliceRotation - delta * 180 / Math.PI;
      } else if (drag.mode === 'droste-ratio') {
        // inner-ring radial drag — feel matches outer-ring scale-drag (relative,
        // r_now / r_start), but moves the inner ring instead of the outer.
        // dragging inward shrinks the inner ring, raising drosteZoom.
        if (!g) return;
        const r = Math.hypot(x - g.cx, y - g.cy);
        if (drag.startR < 1 || r < 1) return;
        const ratio = drag.startR / r;
        const newZoom = Math.max(1.1, Math.min(16, drag.startZoom * ratio));
        state.drosteZoom = newZoom;
      } else if (drag.mode === 'droste-arms') {
        // drag a wedge boundary line angularly to change the arms count. the
        // cursor's |relative angle from sliceRotation| becomes the new
        // halfWedge; arms = π / halfWedge, snapped to the valid set {1, 2, 4,
        // 6, 8, 10, 12}. arms change cascades into the twist snap step via
        // env.applyArmsSnap.
        if (!g) return;
        const cursorAngle = Math.atan2(y - g.cy, x - g.cx);
        let rel = cursorAngle - drag.sliceRotationRad;
        while (rel > Math.PI)  rel -= 2 * Math.PI;
        while (rel < -Math.PI) rel += 2 * Math.PI;
        const newHalfWedge = Math.max(Math.PI / 12, Math.min(Math.PI, Math.abs(rel)));
        const armsFloat = Math.PI / newHalfWedge;
        let newArms;
        if (armsFloat < 1.5) newArms = 1;
        else newArms = Math.max(2, Math.min(12, Math.round(armsFloat / 2) * 2));
        if (newArms !== state.drosteArms) {
          state.drosteArms = newArms;
          env.applyArmsSnap?.();
        }
      } else if (drag.mode === 'droste-offset') {
        // direct manipulation: cursor → canvas-NDC offset (drives Möbius
        // pre-comp + source-side per-tier drift). drosteOffset is in
        // canvas-NDC y-up; screen is y-down, so negate dys. No sliceRotation
        // applied: diamond's overlay-screen position corresponds directly to
        // the spiral pole's canvas-screen position regardless of wedge angle.
        if (!g || g.rOut < 1) return;
        state.drosteOffsetX = (x - g.cx) / g.rOut;
        state.drosteOffsetY = -((y - g.cy) / g.rOut);
      }
      env.syncControls();
      env.scheduleRender();
      e.preventDefault();
    } else {
      // hover — set cursor based on what mode this position would activate.
      const cls = classifyPointer(env, x, y, isTouch);
      const cursorAngle = cls.cursorTheta != null ? cls.cursorTheta : cls.theta;
      setCursor(cursorForMode(cls.mode, cursorAngle));
      // discoverability: redraw if hover mode changed for stroke highlighting.
      const newHandle = cls.handle || null;
      if (cls.mode !== env.hoverMode
          || (cls.onSpoke || false) !== env.hoverOnSpoke
          || newHandle !== env.hoverHandle) {
        env.hoverMode = cls.mode;
        env.hoverOnSpoke = cls.onSpoke || false;
        env.hoverHandle = newHandle;
        env.scheduleOverlayDraw();
      }
    }
  }

  function onDown(e) {
    if (!env.engine.getSourceImage()) return;
    // read-only while an animation drives the state (playback/scrub): the edit would
    // be clobbered next tick and would leak into the live-output broadcast. Bail
    // before pushHistory so we don't log a no-op undo entry.
    if (env.editLocked && env.editLocked()) return;
    env.pushHistory?.();
    const isTouch = !!e.touches;

    // two-finger touch: enter pinch mode regardless of hit zone.
    if (e.touches?.length === 2) {
      const t0 = e.touches[0], t1 = e.touches[1];
      const rect = wrap.getBoundingClientRect();
      env.overlayDragging = true;
      env.overlayDragMode = 'pinch';
      drag = {
        mode: 'pinch',
        startDist:     Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY),
        startAngle:    Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX),
        startScale:    env.state.sliceScale,
        startRotation: env.state.sliceRotation,
        startCx:       env.state.sliceCx,
        startCy:       env.state.sliceCy,
        startPivotUV:  uvFromXY((t0.clientX + t1.clientX) / 2 - rect.left,
                                (t0.clientY + t1.clientY) / 2 - rect.top),
      };
      e.preventDefault();
      return;
    }

    const { x, y } = localCoords(e);
    const cls = classifyPointer(env, x, y, isTouch);
    if (!cls.mode) return;

    // discrete edits are blocked when the host says so (motion mode after a keyframe):
    // droste-arms drag becomes a no-op; the radial spoke falls through to a scale drag.
    const allowDiscrete = env.canEditDiscrete ? env.canEditDiscrete() : true;
    if (!allowDiscrete && cls.mode === 'droste-arms') return;

    env.overlayDragging = true;
    const g = env.sourceOverlayCanvas._geom;
    const { state } = env;
    const form = getActiveForm(state);

    if (cls.mode === 'move') {
      drag = {
        mode: 'move',
        dragOffsetX: g.cx - x,
        dragOffsetY: g.cy - y,
      };
      setCursor('grabbing');
    } else if (cls.mode === 'scale' && cls.onSpoke && form.spokeRule === 'radial' && allowDiscrete) {
      drag = {
        mode: 'segments',
        startSegments: state.segments,
        spoke: cls.spoke,
      };
      setCursor(scaleCursorForAngle(cls.cursorTheta));
    } else if (cls.mode === 'scale' && form.id === 'square' && cls.square && cls.square.kind === 'edge') {
      drag = {
        mode: 'square-edge',
        startSliceScale: state.sliceScale,
        startAspect:     state.squareAspect,
        startCursor:     { x, y },
        nx: cls.square.nx,
        ny: cls.square.ny,
        startPerp: (cls.square.mx - g.cx) * cls.square.nx + (cls.square.my - g.cy) * cls.square.ny,
        axis: (() => {
          // cls.square.ny is the edge normal in screen y-down (post-Y-flip
          // overlay coords). sliceRotation is in raw shader convention.
          // Negate ny to compensate for the overlay's Y-flip so the rel angle
          // correctly classifies whether this edge's normal aligns with the
          // rectangle's local x-axis (long dim) or y-axis (short dim).
          // Without this, rotating the rectangle inverted which edge was
          // labeled 'x' vs 'y', causing aspect drag to adjust the wrong axis.
          const normalAngle = Math.atan2(-cls.square.ny, cls.square.nx);
          const rotRad = state.sliceRotation * Math.PI / 180;
          const rel = normalAngle - rotRad;
          let r = ((rel % (2 * Math.PI)) + 2 * Math.PI + Math.PI) % (2 * Math.PI) - Math.PI;
          return Math.abs(Math.cos(r)) > Math.abs(Math.sin(r)) ? 'x' : 'y';
        })(),
      };
      setCursor(scaleCursorForAngle(Math.atan2(cls.square.ny, cls.square.nx)));
    } else if (cls.mode === 'scale' && form.id === 'square' && cls.square && cls.square.kind === 'corner') {
      drag = {
        mode: 'square-corner',
        startSliceScale: state.sliceScale,
        startAspect:     state.squareAspect,
        startCursor:     { x, y },
        startCx:         g.cx,
        startCy:         g.cy,
        startVx:         cls.square.vx,
        startVy:         cls.square.vy,
      };
      setCursor(scaleCursorForAngle(cls.cursorTheta != null ? cls.cursorTheta : cls.theta));
    } else if (cls.mode === 'scale' && form.id === 'droste' && cls.handle === 'inner') {
      drag = {
        mode: 'droste-ratio',
        startR: cls.r,
        startZoom: state.drosteZoom,
      };
      setCursor(scaleCursorForAngle(cls.cursorTheta != null ? cls.cursorTheta : cls.theta));
    } else if (cls.mode === 'scale') {
      drag = {
        mode: 'scale',
        startR: cls.r,
        startScale: state.sliceScale,
      };
      setCursor(scaleCursorForAngle(cls.cursorTheta != null ? cls.cursorTheta : cls.theta));
    } else if (cls.mode === 'droste-arms') {
      drag = {
        mode: 'droste-arms',
        sliceRotationRad: env.sourceOverlayCanvas._geom.sliceRotationRad,
        boundarySign: cls.boundarySign,
      };
      setCursor(scaleCursorForAngle(cls.cursorTheta != null ? cls.cursorTheta : cls.theta));
    } else if (cls.mode === 'droste-offset') {
      drag = { mode: 'droste-offset' };
      setCursor('grabbing');
    } else if (cls.mode === 'rotate') {
      // Snapshot the rotation center AND the panel rect at drag start, then orbit
      // that fixed point in that frozen frame. The wedge center can't move during
      // a rotate (only sliceRotation changes), so if the source panel reflows
      // mid-drag — e.g. iPhone Safari hiding its address bar, which doesn't happen
      // on desktop/iPad — reading the live geom/rect each move corrupts the
      // accumulated angle delta and the wedge spins far faster than the finger.
      // prevAngle is seeded with the same atan2 the move uses (not cls.theta,
      // which a form's custom classifyPointer may compute in another convention),
      // so there's no first-move jump on any form.
      drag = {
        mode: 'rotate',
        rect: wrap.getBoundingClientRect(),
        cx0: g.cx,
        cy0: g.cy,
        prevAngle: Math.atan2(y - g.cy, x - g.cx),
      };
      setCursor(rotateCursorForAngle(cls.theta));
    }
    env.overlayDragMode = drag?.mode ?? null;
    e.preventDefault();
  }

  function onUp() {
    if (!drag) return;
    drag = null;
    env.overlayDragging = false;
    env.overlayDragMode = null;
    setCursor('default');
    env.updateUndoUI?.();
    env.scheduleOverlayDraw?.();
  }

  // Trackpad pinch-to-scale the SLICE. macOS browsers deliver a trackpad pinch as a
  // `wheel` event with ctrlKey (no real multi-touch on a Mac — see memory), so this
  // is the one pinch gesture that works on desktop incl. our Electron build. Scales
  // sliceScale (same clamp as the two-finger pinch); one undo entry per burst.
  let wheelTimer = 0;
  function onWheel(e) {
    if (!e.ctrlKey) return;
    if (env.editLocked && env.editLocked()) return;   // read-only while playback/scrub drives state
    e.preventDefault();
    if (!wheelTimer) env.pushHistory?.();
    const factor = Math.exp(-e.deltaY * 0.01);
    env.state.sliceScale = Math.max(0.05, Math.min(10, env.state.sliceScale * factor));
    env.syncControls?.();
    env.scheduleRender?.();
    env.scheduleOverlayDraw?.();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { wheelTimer = 0; env.updateUndoUI?.(); }, 250);
  }

  // Claim multi-touch on the source surface so the browser doesn't swallow a
  // two-finger pinch as a page zoom (it was reaching the browser, not our pinch
  // handler — most visibly on desktop touchscreens like the Movink). Mobile already
  // wants this; it's harmless where there's no touch (a mouse is single-pointer).
  wrap.style.touchAction = 'none';
  wrap.addEventListener('mousedown', onDown);
  wrap.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  wrap.addEventListener('touchstart', onDown, { passive: false });
  wrap.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onUp);
  wrap.addEventListener('wheel', onWheel, { passive: false });

  _attachedHandlers = { wrap, onDown, onMove, onUp, onWheel };
}

// mount the source view (image div + overlay canvas) into a slot element.
// returns the new overlay canvas; caller assigns to env.sourceOverlayCanvas.
export function mountSourceView(env, slotEl) {
  slotEl.innerHTML = '';

  const sourceImage = env.engine.getSourceImage();
  env.sourceVideoCanvas = null;   // reset; set below only for a loaded source video
  if (env.liveVideo) {
    // Live camera: mount the actual <video> element (it can't be painted via
    // background-image like a still). object-fit: contain matches the still
    // path's letterboxing so the wedge overlay geometry still aligns. Set layout
    // props individually so the camera's mirror transform survives. (The engine
    // may be sampling a mirrored canvas, not this element — but the mirrored
    // preview + texture share an orientation, so the overlay still lines up.)
    const v = env.liveVideo;
    v.style.position = 'absolute';
    v.style.top = '0'; v.style.left = '0';
    v.style.width = '100%'; v.style.height = '100%';
    v.style.objectFit = env.fit === 'cover' ? 'cover' : 'contain';
    v.style.pointerEvents = 'none';
    v.style.opacity = '';
    slotEl.appendChild(v);
  } else if (env.sourceVideo) {
    // Loaded source video: a <video> used as a WebGL texture source renders BLACK
    // when displayed directly on Blink/Gecko (works on WebKit). So keep the
    // <video> in the DOM but occluded (opacity 0) — it must stay live to decode +
    // serve the texture — and paint a 2D-canvas COPY on top that the render loop
    // refreshes each frame. A canvas composites reliably on every engine, and it
    // also avoids the native-video color/rotation display quirks.
    const sv = env.sourceVideo;
    sv.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; object-fit:contain; pointer-events:none; opacity:0;';
    slotEl.appendChild(sv);
    const c = document.createElement('canvas');
    const s = Math.min(1, 640 / Math.max(sv.videoWidth || 1, sv.videoHeight || 1));   // small thumbnail res
    c.width = Math.max(16, Math.round((sv.videoWidth || 16) * s));
    c.height = Math.max(16, Math.round((sv.videoHeight || 16) * s));
    c.style.cssText = `position:absolute; top:0; left:0; width:100%; height:100%; object-fit:${env.fit === 'cover' ? 'cover' : 'contain'}; pointer-events:none;`;
    slotEl.appendChild(c);
    env.sourceVideoCanvas = c;
    env.sourceVideoCtx = c.getContext('2d');
  } else {
    // div with background-image (vs <img>) avoids load-event race conditions on
    // remount (cache state varies across browsers).
    const imgDiv = document.createElement('div');
    imgDiv.className = 'src-img';
    imgDiv.style.cssText = `
      position: absolute;
      top: 0; left: 0;
      width: 100%;
      height: 100%;
      background-image: url("${sourceImage.src}");
      background-size: ${env.fit === 'cover' ? 'cover' : 'contain'};
      background-repeat: no-repeat;
      background-position: center;
      pointer-events: none;
    `;
    slotEl.appendChild(imgDiv);
  }

  // overlay canvas — drawn ON TOP of the image div. explicit transparent
  // background to defeat the .main-slot canvas { background: #1a1a1a } rule
  // that would otherwise cover the imgDiv when swapped.
  const overlay = document.createElement('canvas');
  overlay.className = 'overlay-canvas';
  overlay.style.cssText = `position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; background: transparent !important; border: none !important;`;
  slotEl.appendChild(overlay);
  env.sourceOverlayCanvas = overlay;

  setupSourceInteraction(env, slotEl);
  // schedule a draw — by next frame, layout is settled
  requestAnimationFrame(() => drawSourceOverlay(env));
  return overlay;
}
