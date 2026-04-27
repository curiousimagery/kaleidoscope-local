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

export function drawSourceOverlay(env) {
  const { state, engine } = env;
  if (!env.sourceOverlayCanvas || !engine.getSourceImage()) return;

  const canvas = env.sourceOverlayCanvas;
  const wrap = canvas.parentElement;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  if (w === 0 || h === 0) return;

  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== w * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const sourceAspect = engine.getSourceAspect();

  // figure out displayed image rect (object-fit: contain)
  const wrapAspect = w / h;
  let imgW, imgH, imgX, imgY;
  if (sourceAspect > wrapAspect) {
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

  // build polygon in source-UV space, then transform to screen pixels.
  const form = getActiveForm(state);
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
      ctx.lineWidth = 1;
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
  for (let i = 0; i < screenPts.length; i++) {
    const a = screenPts[i];
    const b = screenPts[(i + 1) % screenPts.length];
    const aIsCenter = Math.hypot(a.x - cxPx, a.y - cyPx) < SPOKE_EPS_DRAW;
    const bIsCenter = Math.hypot(b.x - cxPx, b.y - cyPx) < SPOKE_EPS_DRAW;
    if (aIsCenter || bIsCenter) spokeEdges.push({ a, b });
    else outerEdges.push({ a, b });
  }

  function strokeEdges(edges, highlighted) {
    if (edges.length === 0) return;
    if (oobAnyAxis) {
      ctx.strokeStyle = highlighted ? 'rgba(255, 230, 140, 1.0)' : 'rgba(255, 196, 80, 0.95)';
      ctx.setLineDash([6, 4]);
    } else {
      ctx.strokeStyle = highlighted ? 'rgba(255, 255, 255, 1.0)' : 'rgba(255, 255, 255, 0.9)';
      ctx.setLineDash([]);
    }
    ctx.lineWidth = highlighted ? 2.5 : 1.5;
    ctx.beginPath();
    for (const e of edges) {
      ctx.moveTo(e.a.x, e.a.y);
      ctx.lineTo(e.b.x, e.b.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const isRotateHover = env.hoverMode === 'rotate';
  const isScaleArcHover = env.hoverMode === 'scale' && !env.hoverOnSpoke;
  const isScaleSpokeHover = env.hoverMode === 'scale' && env.hoverOnSpoke;
  strokeEdges(outerEdges, isRotateHover || isScaleArcHover);
  strokeEdges(spokeEdges, isRotateHover || isScaleSpokeHover);

  // center dot
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cxPx, cyPx, 3, 0, Math.PI * 2);
  ctx.fill();

  // store geometry for hit testing
  canvas._geom = { imgX, imgY, imgW, imgH, screenPts, cx: cxPx, cy: cyPx };
}

// ===========================================================================
// hit testing
// ===========================================================================

// classify pointer position into 'move' | 'scale' | 'rotate' | null. consults
// the active form's spokeRule for behavior switching.
function classifyPointer(env, x, y, isTouch = false) {
  const { state, sourceOverlayCanvas } = env;
  const g = sourceOverlayCanvas?._geom;
  if (!g) return { mode: null };

  const form = getActiveForm(state);
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

// previously-attached window-level handlers from the most recent mount. tracked
// so we can remove them before adding new ones — otherwise each remount of the
// source view (every swap, every divider resize that re-fits the slot) leaks
// a pair of listeners on window.
let _windowHandlers = null;

export function setupSourceInteraction(env, wrap) {
  if (_windowHandlers) {
    window.removeEventListener('mouseup', _windowHandlers.onUp);
    window.removeEventListener('touchend', _windowHandlers.onUp);
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
    if (mode === 'move')   return 'grab';
    if (mode === 'scale')  return scaleCursorForAngle(theta);
    if (mode === 'rotate') return rotateCursorForAngle(theta);
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
      state.sliceRotation = ((drag.startRotation + da) % 360 + 360) % 360;
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
        if (!g) return;
        const a = Math.atan2(y - g.cy, x - g.cx);
        let delta = a - drag.prevAngle;
        if (delta > Math.PI)  delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;
        drag.prevAngle = a;
        state.sliceRotation = state.sliceRotation + delta * 180 / Math.PI;
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
      if (cls.mode !== env.hoverMode || (cls.onSpoke || false) !== env.hoverOnSpoke) {
        env.hoverMode = cls.mode;
        env.hoverOnSpoke = cls.onSpoke || false;
        env.scheduleOverlayDraw();
      }
    }
  }

  function onDown(e) {
    if (!env.engine.getSourceImage()) return;
    const isTouch = !!e.touches;

    // two-finger touch: enter pinch mode regardless of hit zone.
    if (e.touches?.length === 2) {
      const t0 = e.touches[0], t1 = e.touches[1];
      const rect = wrap.getBoundingClientRect();
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
    } else if (cls.mode === 'scale' && cls.onSpoke && form.spokeRule === 'radial') {
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
          const normalAngle = Math.atan2(cls.square.ny, cls.square.nx);
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
    } else if (cls.mode === 'scale') {
      drag = {
        mode: 'scale',
        startR: cls.r,
        startScale: state.sliceScale,
      };
      setCursor(scaleCursorForAngle(cls.cursorTheta != null ? cls.cursorTheta : cls.theta));
    } else if (cls.mode === 'rotate') {
      drag = {
        mode: 'rotate',
        prevAngle: cls.theta,
      };
      setCursor(rotateCursorForAngle(cls.theta));
    }
    e.preventDefault();
  }

  function onUp() {
    if (!drag) return;
    drag = null;
    setCursor('default');
  }

  wrap.addEventListener('mousedown', onDown);
  wrap.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  wrap.addEventListener('touchstart', onDown, { passive: false });
  wrap.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onUp);

  _windowHandlers = { onUp };
}

// mount the source view (image div + overlay canvas) into a slot element.
// returns the new overlay canvas; caller assigns to env.sourceOverlayCanvas.
export function mountSourceView(env, slotEl) {
  slotEl.innerHTML = '';

  // div with background-image (vs <img>) avoids load-event race conditions on
  // remount (cache state varies across browsers).
  const sourceImage = env.engine.getSourceImage();
  const imgDiv = document.createElement('div');
  imgDiv.className = 'src-img';
  imgDiv.style.cssText = `
    position: absolute;
    top: 0; left: 0;
    width: 100%;
    height: 100%;
    background-image: url("${sourceImage.src}");
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
    pointer-events: none;
  `;
  slotEl.appendChild(imgDiv);

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
