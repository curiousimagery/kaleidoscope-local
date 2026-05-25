// forms/droste.js
//
// FORM 4 — Droste / logarithmic-conformal map (Lenstra & de Smit).
//
// the source sample region is an ANNULUS (two concentric circles) rather than
// a polygon. each canvas pixel is mapped through `w_src = c · w_canvas` in
// log-space, where c is a complex multiplier interpolating between identity
// (c=1, no spiral) and the classic Print Gallery exponent
// (c = 2πi/(logS + 2πi), one full extra turn per tier).
//
// the twist slider drives this interpolation linearly: φ = twist/360°, then
// c = (1−φ)·1 + φ·cPG. at twist=0 the warp is identity-plus-mod (= concentric
// Droste); at twist=360° it's full Print Gallery; anywhere in between is a
// continuously interpolated spiral. complex multiplication is conformal at
// every φ, so the warp preserves angles throughout the parameter range.
//
// fold-space convention matches the polygon forms: |output| ≤ 1, with output
// magnitude 1 corresponding to the source annulus's outer ring. the engine's
// toSourceUV then applies sliceRotation, scales by 0.5 × sliceScale, applies
// the standard aspect correction (designed so fold-radius 1 → image-pixel
// radius 0.5 × sliceScale × min(imgW, imgH), which keeps the annulus visually
// circular on non-square sources — the same invariant the polygon forms rely
// on for visually-correct wedge geometry).
//
// per-form options layered on top of the warp:
//   - mirror (drosteMirror): tier transitions reflect radially instead of
//     teleporting. eliminates the type-i source-side wrap seam at the cost
//     of alternating tier parity.
//   - arms (drosteArms): integer N. before applying the warp, θ is folded
//     into a 1/N wedge with mirror at the wedge boundaries (same recipe as
//     radial.js). result: N identical arms with mirror seams between them.
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

  controls: ['zoom', 'arms', 'twist', 'mirror'],

  uniforms: {
    // log(drosteZoom) — precomputed to spare the shader a log() per pixel.
    u_drosteLogS: {
      type: '1f',
      get: (state) => Math.log(Math.max(1.0001, state.drosteZoom)),
    },
    // complex multiplier c = (1−φ)·1 + φ·cPG with φ = twist/360°.
    // cPG = 2πi / (logS + 2πi). precomputed JS-side so the shader is branchless.
    u_drosteC: {
      type: '2f',
      get: (state) => {
        const logS = Math.log(Math.max(1.0001, state.drosteZoom));
        const TAU = Math.PI * 2;
        const D = logS * logS + TAU * TAU;
        const cPG_re = (TAU * TAU) / D;
        const cPG_im = (TAU * logS) / D;
        const phi = (state.drosteTwist || 0) / 360;
        return [
          1 + phi * (cPG_re - 1),
          phi * cPG_im,
        ];
      },
    },
    // tier mirror: 1 = reflect across tier boundary; 0 = mod-wrap (classic Droste).
    u_drosteMirror: {
      type: '1i',
      get: (state) => (state.drosteMirror ? 1 : 0),
    },
    // spiral arms: integer 1..N. arms=1 means no angular folding.
    u_drosteArms: {
      type: '1i',
      get: (state) => Math.max(1, Math.min(12, Math.round(state.drosteArms || 1))),
    },
  },

  // input convention: p in canvas space [-1, 1]² (post canvas rot/zoom).
  // output convention: a complex number z_src with |z_src| ∈ [1/drosteZoom, 1]
  //   — the source annulus expressed in fold space. toSourceUV places this in
  //   the source image isotropically (annulus stays visually circular).
  glsl: `
    vec2 foldDroste(vec2 p) {
      float r = length(p);
      if (r < 1e-8) return vec2(0.0);

      float logr = log(r);
      float theta = atan(p.y, p.x);

      // angular fold for N-arm mode. mirror at wedge boundaries — same recipe
      // as radial.js so seams between arms become mirror axes, not jumps.
      if (u_drosteArms > 1) {
        float wedge = TAU / float(u_drosteArms);
        float t = mod(theta + wedge * 0.5, wedge * 2.0) - wedge * 0.5;
        if (t > wedge * 0.5) t = wedge - t;
        theta = t;
      }

      // conformal warp: w_src = c · w_canvas in log-space, with c interpolating
      // from 1 (identity, no spiral) at twist=0 to cPG (Print Gallery) at twist=360°.
      float logS = u_drosteLogS;
      float cR = u_drosteC.x;
      float cI = u_drosteC.y;
      float logr_new  = cR * logr - cI * theta;
      float theta_new = cI * logr + cR * theta;

      // reduce log-radius into the fundamental annulus [-logS, 0).
      // mirror mode reflects at tier boundaries (triangle wave with period 2·logS);
      // wrap mode jumps (sawtooth with period logS).
      if (u_drosteMirror == 1) {
        float u = mod(logr_new, 2.0 * logS);
        logr_new = abs(u - logS) - logS;
      } else {
        logr_new = mod(logr_new, logS) - logS;
      }

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

    // seams — logarithmic spirals from inner ring to outer ring at each arm's
    // phase. one seam per arm; for arms=1 it's the single Droste seam, for
    // arms>1 the seams sit at sliceRotation + k·(2π/N) for k = 0..N−1.
    // when twist = 0 each seam is a straight radial segment; for twist > 0
    // the spiral bends to preview the warp's per-tier rotation.
    const armsCount = Math.max(1, Math.min(12, Math.round(state.drosteArms || 1)));
    const armStep = TAU / armsCount;
    const twistHL = env.hoverMode === 'twist' || env.overlayDragMode === 'droste-twist';
    const seamColor = oobOut
      ? (twistHL ? 'rgba(255, 230, 140, 1.0)' : 'rgba(255, 196, 80, 0.85)')
      : (twistHL ? 'rgba(255, 255, 255, 1.0)' : 'rgba(255, 255, 255, 0.8)');
    ctx.strokeStyle = seamColor;
    ctx.lineWidth = twistHL ? 2.5 : 1.5;
    ctx.setLineDash(oobOut ? [6, 4] : []);
    const SEAM_STEPS = 32;
    const seamEnds = [];
    for (let k = 0; k < armsCount; k++) {
      const armPhase = seamPhaseRad + k * armStep;
      ctx.beginPath();
      for (let i = 0; i <= SEAM_STEPS; i++) {
        const t = i / SEAM_STEPS;
        const r = rIn * Math.pow(zoom, t);
        const a = armPhase + twistRad * t;
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      const endAngle = armPhase + twistRad;
      seamEnds.push({
        x: cx + rOut * Math.cos(endAngle),
        y: cy + rOut * Math.sin(endAngle),
        angle: endAngle,
      });
    }
    ctx.setLineDash([]);

    // seam outer endpoints — the twist handles. one per arm. drawn after the
    // strokes so they sit on top, and small enough not to crowd the outer-ring
    // affordance when arms is high.
    const HANDLE_R = twistHL ? 6 : 4.5;
    ctx.fillStyle = oobOut ? 'rgba(255, 196, 80, 1)' : 'rgba(255, 255, 255, 1)';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 1;
    for (const end of seamEnds) {
      ctx.beginPath();
      ctx.arc(end.x, end.y, HANDLE_R, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }

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

    // expose geometry for hit testing. seamEnds[0] is kept as the primary seam
    // (the one tied to sliceRotation directly); the rest are arm-copies that
    // also accept twist-drag input.
    env.sourceOverlayCanvas._geom = {
      imgX, imgY, imgW, imgH,
      cx, cy,
      rOut, rIn,
      seamEnds,
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
    const { cx, cy, rOut, rIn, seamEnds } = g;

    const dx = x - cx, dy = y - cy;
    const r = Math.hypot(dx, dy);
    const theta = Math.atan2(dy, dx);

    const HANDLE_HIT = isTouch ? 22 : 12;   // twist handle radius
    const BAND_OUT   = isTouch ? 28 : 20;   // ring band — outside the ring
    const BAND_IN    = isTouch ? 22 : 16;   // ring band — inside the ring
    const CENTER_HIT = isTouch ? 28 : 14;

    // 1. twist handle takes priority over ring-band hits in its immediate vicinity.
    // any arm's seam endpoint can drive the twist drag.
    if (seamEnds) {
      for (const end of seamEnds) {
        const d = Math.hypot(x - end.x, y - end.y);
        if (d <= HANDLE_HIT) {
          return { mode: 'twist', r, theta, R: rOut, cursorTheta: theta };
        }
      }
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

  // filename suffix: zoom + signed twist + arms + mirror.
  // e.g. z200t045a03m1 = zoom 2.00, twist +45°, arms 3, mirror on
  //      z200tm120a01m0 = zoom 2.00, twist −120°, arms 1, mirror off
  filenameSuffix(state) {
    const z = Math.round(state.drosteZoom * 100);
    const tDeg = Math.round(state.drosteTwist);
    const tSign = tDeg < 0 ? 'm' : '';
    const arms = Math.max(1, Math.min(12, Math.round(state.drosteArms || 1)));
    const mirror = state.drosteMirror ? 1 : 0;
    return 'z' + z
      + 't' + tSign + String(Math.abs(tDeg)).padStart(3, '0')
      + 'a' + String(arms).padStart(2, '0')
      + 'm' + mirror;
  },

  // tile density for the resolution hint. arms multiplies the angular tile
  // count; tiers from the log-warp multiply the radial tile count.
  tilesPerDim(state) {
    const zoom = Math.max(1.0001, state.drosteZoom);
    const tiers = Math.log(8) / Math.log(zoom);  // tiers visible from r=1 down to r=1/8
    const arms = Math.max(1, Math.min(12, Math.round(state.drosteArms || 1)));
    // arms folds the angular domain by N, doubling tile count per √N (mirror
    // pairs cancel some of the linear growth).
    return Math.max(1, tiers * Math.sqrt(arms));
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
