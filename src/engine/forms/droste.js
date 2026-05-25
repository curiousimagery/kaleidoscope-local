// forms/droste.js
//
// FORM 4 — Droste / logarithmic-conformal map (Lenstra & de Smit).
//
// the source sample region is an ANNULUS (two concentric circles) rather than
// a polygon. each canvas pixel is mapped through `w → w / α` in log-space,
// where α = (logS + iβ) / iβ encodes the spiral. logS = log(outer/inner) sets
// the zoom-per-tier; β (radians) sets the twist-per-tier. β = 0 collapses to a
// pure concentric Droste (no spiral); β = 2π is the Print Gallery (one extra
// turn per tier).
//
// fold-space convention matches the polygon forms: |output| ≤ 1, with output
// magnitude 1 corresponding to the source annulus's outer ring. the engine's
// toSourceUV then applies sliceRotation, scales by 0.5 × sliceScale, applies
// the standard aspect correction (designed so fold-radius 1 → image-pixel
// radius 0.5 × sliceScale × min(imgW, imgH), which keeps the annulus visually
// circular on non-square sources — the same invariant the polygon forms rely
// on for visually-correct wedge geometry).
//
// this form uses two optional schema hooks:
//   - drawOverlay(env, ctx, geom): bespoke overlay drawing (annulus + seam +
//     touch affordances), in lieu of the default polygon-based path
//   - classifyPointer(env, x, y, isTouch, geom): bespoke hit-testing,
//     returning the standard modes (move/scale/rotate) plus two new ones
//     ('droste-ratio', 'droste-twist') that overlay.js dispatches to dedicated
//     drag handlers

const TAU = Math.PI * 2;

export default {
  id: 'droste',
  label: 'Droste',
  fileCode: 'd',

  thumbnail: `<svg viewBox="0 0 32 32"><g class="stroke" fill="none">
    <circle cx="16" cy="16" r="12"/>
    <circle cx="16" cy="16" r="5"/>
    <path d="M 21 16 A 5 5 0 0 1 22.5 19.5 L 26.6 23.6"/>
  </g></svg>`,

  controls: ['zoom', 'twist'],

  uniforms: {
    // log(drosteZoom) — precomputed to spare the shader a log() per pixel.
    u_drosteLogS: {
      type: '1f',
      get: (state) => Math.log(Math.max(1.0001, state.drosteZoom)),
    },
    // twist in radians.
    u_drosteTwist: {
      type: '1f',
      get: (state) => state.drosteTwist * Math.PI / 180,
    },
  },

  // input convention: p in canvas space [-1, 1]² (post canvas rot/zoom).
  // output convention: a complex number z_src with |z_src| ∈ [1/drosteZoom, 1]
  //   — the source annulus expressed in fold space. toSourceUV places this in
  //   the source image isotropically (annulus stays visually circular).
  //
  // math: w_src = w_canvas / α, where α = (logS + iβ) / iβ.
  //   when β = 0 the warp collapses to identity (followed by mod-reduction),
  //   giving a pure concentric Droste — the small-twist limit is handled
  //   explicitly to avoid division by zero.
  glsl: `
    vec2 foldDroste(vec2 p) {
      float r = length(p);
      if (r < 1e-8) return vec2(0.0);

      float logr = log(r);
      float theta = atan(p.y, p.x);
      float logS = u_drosteLogS;
      float beta = u_drosteTwist;

      float logr_new, theta_new;
      if (abs(beta) < 1e-5) {
        logr_new = logr;
        theta_new = theta;
      } else {
        // 1/α = iβ / (logS + iβ) = (β² + i·logS·β) / (logS² + β²)
        float D = logS * logS + beta * beta;
        float a = (beta * beta) / D;
        float b = (logS * beta) / D;
        logr_new  = a * logr - b * theta;
        theta_new = b * logr + a * theta;
      }

      // reduce log-radius into the fundamental annulus [-logS, 0).
      // mod() in GLSL returns values in [0, logS); subtracting logS shifts the
      // result into [-logS, 0) which corresponds to source-r ∈ [1/zoom, 1).
      logr_new = mod(logr_new, logS) - logS;

      float r_src = exp(logr_new);
      return vec2(cos(theta_new), sin(theta_new)) * r_src;
    }
  `,

  // droste owns its overlay + classifier entirely; the polygon-based fields
  // below are placeholders satisfying the schema. they're not consulted while
  // drawOverlay/classifyPointer are present.
  spokeRule: 'none',

  // outer-circle polygon as a sampled approximation. unused by the default
  // overlay path (drawOverlay overrides it) but kept so any future
  // polygon-consuming code (export filename hashing, future fallbacks) sees a
  // sensible bounding shape.
  buildPolygon(state) {
    const N = 32;
    const pts = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      pts.push({ vx: Math.cos(a), vy: Math.sin(a) });
    }
    return pts;
  },

  // ---------------------------------------------------------------------------
  // overlay drawing — bespoke, replaces the polygon path
  // ---------------------------------------------------------------------------
  //
  // draws an annulus (outer + inner circle, hole cut between them) plus a
  // logarithmic-spiral seam line that previews the warp's angular wrap. when
  // β = 0 the seam is a straight radial segment; for β > 0 it bends into a
  // log-spiral with one tier of the actual warp encoded in it.
  //
  // populates canvas._geom with:
  //   imgX, imgY, imgW, imgH  (image rect in screen px)
  //   cx, cy                  (slice center in screen px)
  //   rOut, rIn               (outer/inner annulus radii in screen px)
  //   seamEndX, seamEndY      (seam outer endpoint in screen px)
  //   seamAngle               (seam phase angle in radians)
  drawOverlay(env, ctx, geom) {
    const { state } = env;
    const { w, h, imgX, imgY, imgW, imgH, cx, cy, sourceAspect, IS_TOUCH } = geom;

    // annulus radii in source-UV space, then mapped to screen pixels.
    // mirrors the engine's toSourceUV aspect correction (the smaller image
    // dimension wins — fold-radius 1 lands at image-pixel-radius
    // 0.5 × sliceScale × min(imgW, imgH)).
    const halfMinPx = 0.5 * Math.min(imgW, imgH);
    const rOut = state.sliceScale * halfMinPx;
    const zoom = Math.max(1.0001, state.drosteZoom);
    const rIn  = rOut / zoom;

    // OOB if the outer ring exits the image rect.
    const oobOut = (cx - rOut < imgX) || (cx + rOut > imgX + imgW) ||
                   (cy - rOut < imgY) || (cy + rOut > imgY + imgH);

    const seamPhaseRad = state.sliceRotation * Math.PI / 180;
    const twistRad = state.drosteTwist * Math.PI / 180;

    // dim background.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, w, h);

    // cut the annulus hole: punch the outer disc, then re-fill the inner disc.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, rOut, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.arc(cx, cy, rIn, 0, TAU);
    ctx.fill();

    // outline both rings — solid white inside image bounds, dashed amber when
    // the outer ring exits the image.
    const ringHL = env.hoverMode === 'rotate' || env.overlayDragMode === 'rotate' || env.overlayDragMode === 'pinch';
    const outerHL = env.hoverMode === 'scale' && env.hoverHandle === 'outer'
                 || env.overlayDragMode === 'scale';
    const innerHL = env.hoverMode === 'scale' && env.hoverHandle === 'inner'
                 || env.overlayDragMode === 'droste-ratio';

    function strokeRing(r, highlighted) {
      if (oobOut) {
        ctx.strokeStyle = highlighted ? 'rgba(255, 230, 140, 1.0)' : 'rgba(255, 196, 80, 0.95)';
        ctx.setLineDash([6, 4]);
      } else {
        ctx.strokeStyle = highlighted ? 'rgba(255, 255, 255, 1.0)' : 'rgba(255, 255, 255, 0.9)';
        ctx.setLineDash([]);
      }
      ctx.lineWidth = highlighted ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    strokeRing(rOut, outerHL || ringHL);
    strokeRing(rIn,  innerHL || ringHL);

    // seam — logarithmic spiral from inner ring to outer ring at the current
    // phase. when twist = 0 it's a straight radial; the curvature previews
    // exactly the angular wrap the warp produces over one tier.
    const twistHL = env.hoverMode === 'twist' || env.overlayDragMode === 'droste-twist';
    const seamColor = oobOut
      ? (twistHL ? 'rgba(255, 230, 140, 1.0)' : 'rgba(255, 196, 80, 0.85)')
      : (twistHL ? 'rgba(255, 255, 255, 1.0)' : 'rgba(255, 255, 255, 0.8)');
    ctx.strokeStyle = seamColor;
    ctx.lineWidth = twistHL ? 2.5 : 1.5;
    ctx.setLineDash(oobOut ? [6, 4] : []);
    const SEAM_STEPS = 32;
    const logS = Math.log(zoom);
    ctx.beginPath();
    for (let i = 0; i <= SEAM_STEPS; i++) {
      const t = i / SEAM_STEPS;                       // 0 at inner, 1 at outer
      const r = rIn * Math.pow(zoom, t);              // r = rIn * zoom^t
      // along the spiral the angle accumulates β * (log r - log rIn) / logS = β·t.
      const a = seamPhaseRad + twistRad * t;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // seam outer endpoint — the twist handle. always drawn so it's findable
    // even at twist=0 where the seam endpoint sits on the +X side of the ring.
    const seamEndAngle = seamPhaseRad + twistRad;
    const seamEndX = cx + rOut * Math.cos(seamEndAngle);
    const seamEndY = cy + rOut * Math.sin(seamEndAngle);
    const HANDLE_R = twistHL ? 6 : 4.5;
    ctx.fillStyle = oobOut ? 'rgba(255, 196, 80, 1)' : 'rgba(255, 255, 255, 1)';
    ctx.beginPath();
    ctx.arc(seamEndX, seamEndY, HANDLE_R, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // center dot.
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, TAU);
    ctx.fill();

    // touch affordances — rotation arc beyond the outer ring, "depth" arrow
    // straddling the inner ring. opacity dims during pinch to defer to the
    // outline highlight.
    if (IS_TOUCH) {
      const isPinch = env.overlayDragMode === 'pinch';
      const isDragging = !!env.overlayDragMode && !isPinch;

      function afStyle(active) {
        if (isPinch) return { op: 0.25, lw: 1.5 };
        if (!isDragging) return { op: 0.55, lw: 1.5 };
        return active ? { op: 1.0, lw: 2.5 } : { op: 0.25, lw: 1.5 };
      }

      // rotation arc above the top of the outer ring.
      const { op: rop, lw: rlw } = afStyle(env.overlayDragMode === 'rotate');
      drawRotationArc(ctx, cx, cy, -Math.PI / 2, rOut + 22, rop, rlw);

      // inner-ring "depth" arrow — bidirectional radial across the inner ring,
      // placed on the side opposite the seam so it doesn't collide with the
      // twist handle.
      const innerAngle = seamPhaseRad + Math.PI;
      const innerX = cx + rIn * Math.cos(innerAngle);
      const innerY = cy + rIn * Math.sin(innerAngle);
      const { op: sop, lw: slw } = afStyle(env.overlayDragMode === 'droste-ratio');
      drawRadialArrow(ctx, innerX, innerY, Math.cos(innerAngle), Math.sin(innerAngle), sop, slw);
    }

    // expose geometry for hit testing.
    env.sourceOverlayCanvas._geom = {
      imgX, imgY, imgW, imgH,
      cx, cy,
      rOut, rIn,
      seamEndX, seamEndY,
      seamAngle: seamEndAngle,
    };
  },

  // ---------------------------------------------------------------------------
  // hit testing — bespoke, replaces classifyPointer
  // ---------------------------------------------------------------------------
  //
  // mode priorities (highest wins):
  //   1. twist handle hit (small)         → 'droste-twist'
  //   2. inner-ring band                  → 'scale' (handle='inner') → drives droste-ratio
  //   3. outer-ring band                  → 'scale' (handle='outer') → drives sliceScale
  //   4. inside inner disc / near center  → 'move'
  //   5. outside outer ring               → 'rotate'
  //
  // the 'scale' classification is returned with a `handle` discriminator that
  // overlay.js maps to the right drag mode (droste-ratio vs scale).
  classifyPointer(env, x, y, isTouch, geom) {
    const g = env.sourceOverlayCanvas?._geom;
    if (!g) return { mode: null };
    const { cx, cy, rOut, rIn, seamEndX, seamEndY } = g;

    const dx = x - cx, dy = y - cy;
    const r = Math.hypot(dx, dy);
    const theta = Math.atan2(dy, dx);

    const HANDLE_HIT = isTouch ? 22 : 12;   // twist handle radius
    const BAND_OUT   = isTouch ? 28 : 20;   // ring band — outside the ring
    const BAND_IN    = isTouch ? 22 : 16;   // ring band — inside the ring
    const CENTER_HIT = isTouch ? 28 : 14;

    // 1. twist handle takes priority over ring-band hits in its immediate vicinity.
    const seamDist = Math.hypot(x - seamEndX, y - seamEndY);
    if (seamDist <= HANDLE_HIT) {
      return { mode: 'twist', r, theta, R: rOut, cursorTheta: theta };
    }

    // 2-3. ring band hits. compare absolute distance to each ring; the closer
    // ring wins. tie-break: outer (more common gesture).
    const dOut = Math.abs(r - rOut);
    const dIn  = Math.abs(r - rIn);
    const inOuterBand = (r > rOut ? dOut <= BAND_OUT : dOut <= BAND_IN);
    const inInnerBand = (r < rIn  ? dIn  <= BAND_OUT : dIn  <= BAND_IN);

    if (inInnerBand && inOuterBand) {
      // both rings in range (happens when zoom is small and the rings sit close).
      // pick the closer one; if equidistant, outer.
      if (dIn < dOut) return { mode: 'scale', r, theta, R: rIn, handle: 'inner', cursorTheta: theta };
      return { mode: 'scale', r, theta, R: rOut, handle: 'outer', cursorTheta: theta };
    }
    if (inInnerBand) return { mode: 'scale', r, theta, R: rIn, handle: 'inner', cursorTheta: theta };
    if (inOuterBand) return { mode: 'scale', r, theta, R: rOut, handle: 'outer', cursorTheta: theta };

    // 4. center: any cursor inside the inner disc OR within a small center radius.
    if (r <= rIn || r <= CENTER_HIT) {
      return { mode: 'move', r, theta, R: rIn };
    }

    // 5. outside the outer ring: rotate.
    return { mode: 'rotate', r, theta, R: rOut };
  },

  // filename suffix: zoom in hundredths + signed twist in whole degrees.
  // e.g. z200t045 = zoom 2.00, twist +45°; z200tm045 = zoom 2.00, twist -45°.
  filenameSuffix(state) {
    const z = Math.round(state.drosteZoom * 100);
    const tDeg = Math.round(state.drosteTwist);
    const tSign = tDeg < 0 ? 'm' : '';
    return 'z' + z + 't' + tSign + String(Math.abs(tDeg)).padStart(3, '0');
  },

  // tile density for the resolution hint. each spiral tier contributes one
  // visible copy of the source picture; the number of tiers visible across the
  // canvas extent is approximately log(canvas_radius / r_inner) / log(zoom).
  // for sliceScale=1, canvasZoom=1, drosteZoom=2 that's ~5-6 tiers, so the
  // perceived linear sample density grows accordingly.
  tilesPerDim(state) {
    const zoom = Math.max(1.0001, state.drosteZoom);
    // crude: each tier roughly doubles the linear tile density compared to a
    // 1-tier (= radial-like) baseline. log2-based so larger zoom → fewer tiers
    // visible → lower density.
    const tiers = Math.log(8) / Math.log(zoom);  // tiers visible from r=1 down to r=1/8
    return Math.max(1, tiers);
  },
};

// ---- local helpers (kept local to keep the form module self-contained) ----

function drawRotationArc(ctx, cx, cy, angle, radius, op, lw) {
  const HSPAN = 11 * Math.PI / 180;
  const HEAD = 5;
  ctx.strokeStyle = 'rgba(255,255,255,' + op + ')';
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, angle - HSPAN, angle + HSPAN, false);
  ctx.stroke();
  for (const [a, tang] of [
    [angle + HSPAN, angle + HSPAN + Math.PI / 2],
    [angle - HSPAN, angle - HSPAN - Math.PI / 2],
  ]) {
    const tipX = cx + radius * Math.cos(a);
    const tipY = cy + radius * Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX + Math.cos(tang + 2.6) * HEAD, tipY + Math.sin(tang + 2.6) * HEAD);
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX + Math.cos(tang - 2.6) * HEAD, tipY + Math.sin(tang - 2.6) * HEAD);
    ctx.stroke();
  }
}

function drawRadialArrow(ctx, mx, my, nx, ny, op, lw) {
  const HALF = 14, HEAD = 5;
  ctx.strokeStyle = 'rgba(255,255,255,' + op + ')';
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
