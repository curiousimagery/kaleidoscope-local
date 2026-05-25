// forms/droste.js
//
// FORM 4 — Droste / log-shear spiral (kaleidoscope-friendly variant).
//
// the source sample region is an ANNULUS (two concentric circles) rather than
// a polygon. each canvas pixel is mapped through a SHEAR in log-space:
//
//   theta_src = theta + (twist_rad / logS) · log r
//   logr_src  = log r
//
// then logr_src is mod-reduced (wrap or mirror) and exp'd back. twist_rad is
// exactly the rotation accumulated over one tier of zoom: at twist=0 the warp
// is identity-plus-mod (= concentric Droste); at twist=360° each tier rotates
// one full turn (the classic Print Gallery spiral feel); intermediate values
// give partial spirals.
//
// trade-off vs the strict Lenstra/de Smit conformal map: the shear isn't
// conformal — shapes get slightly sheared along the spiral. in exchange:
// twist's effect is independent of zoom (always exactly twist_deg of rotation
// per tier), and N-arm snap values are simple multiples of 360°/N. for the
// kaleidoscope context (arbitrary photos + mirror folds), the shear is
// imperceptible and the slider's intuitive behavior matters more than strict
// conformality.
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

  controls: ['segments', 'zoom', 'twist', 'mirror'],

  uniforms: {
    // log(drosteZoom) — precomputed to spare the shader a log() per pixel.
    u_drosteLogS: {
      type: '1f',
      get: (state) => Math.log(Math.max(1.0001, state.drosteZoom)),
    },
    // twist in radians. exactly the rotation accumulated over one tier; the
    // slider's UI is in degrees, converted here.
    u_drosteTwist: {
      type: '1f',
      get: (state) => (state.drosteTwist || 0) * Math.PI / 180,
    },
    // tier mirror: 1 = reflect across tier boundary; 0 = mod-wrap (classic Droste).
    u_drosteMirror: {
      type: '1i',
      get: (state) => (state.drosteMirror ? 1 : 0),
    },
    // spiral arms: integer from {1, 2, 4, 6, 8, 10, 12}. arms=1 disables the
    // wedge fold (single chiral spiral, Print Gallery feel). arms ≥ 2 are
    // restricted to even integers so the wedge-mirror parity is consistent
    // around the full circle.
    u_drosteArms: {
      type: '1i',
      get: (state) => {
        const n = Math.round(state.drosteArms || 2);
        if (n <= 1) return 1;
        return Math.max(2, Math.min(12, n - (n % 2)));
      },
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
      // arms is restricted to even integers JS-side, so chirality parity is
      // consistent around the full circle.
      if (u_drosteArms > 1) {
        float wedge = TAU / float(u_drosteArms);
        float t = mod(theta + wedge * 0.5, wedge * 2.0) - wedge * 0.5;
        if (t > wedge * 0.5) t = wedge - t;
        theta = t;
      }

      // log-shear spiral: rotate theta by (twist_rad / logS) per unit log r.
      // log r is unchanged, so tier scaling stays exactly logS regardless of twist.
      float logS = u_drosteLogS;
      float twistRad = u_drosteTwist;
      float theta_new = theta + (twistRad / logS) * logr;
      float logr_new  = logr;

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

    // angular span of the fundamental sample wedge. arms=1 → full circle;
    // arms=N → 2π/N centered on sliceRotation (the wedge mirror reflects the
    // rest of the annulus from this fundamental region).
    const armsCount = (() => {
      const n = Math.round(state.drosteArms || 1);
      if (n <= 1) return 1;
      return Math.max(2, Math.min(12, n - (n % 2)));
    })();
    const halfWedge = Math.PI / armsCount;        // half the angular span
    const isFullCircle = armsCount === 1;

    // OOB if the outer ring exits the image rect.
    const oobOut = (cx - rOut < imgX) || (cx + rOut > imgX + imgW) ||
                   (cy - rOut < imgY) || (cy + rOut > imgY + imgH);

    const seamPhaseRad = state.sliceRotation * Math.PI / 180;
    const twistRad = state.drosteTwist * Math.PI / 180;
    const wedgeStart = seamPhaseRad - halfWedge;
    const wedgeEnd   = seamPhaseRad + halfWedge;

    // dim background.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, w, h);

    // cut the sample-wedge hole. for arms=1 this is the full annulus (punch
    // outer disc, refill inner). for arms>1 it's just the annular wedge
    // spanning the fundamental angular region — the rest of the annulus stays
    // dim, signalling that those pixels are mirror-images of the wedge rather
    // than independently sampled.
    ctx.globalCompositeOperation = 'destination-out';
    if (isFullCircle) {
      ctx.beginPath();
      ctx.arc(cx, cy, rOut, 0, TAU);
      ctx.fill();
    } else {
      // annular wedge: outer arc + inner arc (reverse) + close.
      ctx.beginPath();
      ctx.arc(cx, cy, rOut, wedgeStart, wedgeEnd, false);
      ctx.arc(cx, cy, rIn,  wedgeEnd,   wedgeStart, true);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    if (isFullCircle) {
      // re-fill the inner disc so the annulus appears as a ring.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.arc(cx, cy, rIn, 0, TAU);
      ctx.fill();
    }

    // outline the sample wedge — arcs at the inner and outer ring spanning
    // wedgeStart→wedgeEnd, plus radial sides at the wedge boundaries when
    // arms > 1.
    const ringHL = env.hoverMode === 'rotate' || env.overlayDragMode === 'rotate' || env.overlayDragMode === 'pinch';
    const outerHL = env.hoverMode === 'scale' && env.hoverHandle === 'outer'
                 || env.overlayDragMode === 'scale';
    const innerHL = env.hoverMode === 'scale' && env.hoverHandle === 'inner'
                 || env.overlayDragMode === 'droste-ratio';

    function strokeRingArc(r, highlighted) {
      if (oobOut) {
        ctx.strokeStyle = highlighted ? 'rgba(255, 230, 140, 1.0)' : 'rgba(255, 196, 80, 0.95)';
        ctx.setLineDash([6, 4]);
      } else {
        ctx.strokeStyle = highlighted ? 'rgba(255, 255, 255, 1.0)' : 'rgba(255, 255, 255, 0.9)';
        ctx.setLineDash([]);
      }
      ctx.lineWidth = highlighted ? 2.5 : 1.5;
      ctx.beginPath();
      if (isFullCircle) {
        ctx.arc(cx, cy, r, 0, TAU);
      } else {
        ctx.arc(cx, cy, r, wedgeStart, wedgeEnd, false);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    strokeRingArc(rOut, outerHL || ringHL);
    strokeRingArc(rIn,  innerHL || ringHL);

    // wedge sides — radial line segments at the wedge boundaries connecting
    // the inner and outer arcs. only drawn for arms > 1 (full circle has no
    // angular boundary). dashed amber when OOB, white otherwise.
    if (!isFullCircle) {
      const sideHL = ringHL;  // sides highlight with the rest of the ring outline
      ctx.strokeStyle = oobOut
        ? (sideHL ? 'rgba(255, 230, 140, 1.0)' : 'rgba(255, 196, 80, 0.95)')
        : (sideHL ? 'rgba(255, 255, 255, 1.0)' : 'rgba(255, 255, 255, 0.9)');
      ctx.lineWidth = sideHL ? 2.5 : 1.5;
      ctx.setLineDash(oobOut ? [6, 4] : []);
      for (const a of [wedgeStart, wedgeEnd]) {
        ctx.beginPath();
        ctx.moveTo(cx + rIn  * Math.cos(a), cy + rIn  * Math.sin(a));
        ctx.lineTo(cx + rOut * Math.cos(a), cy + rOut * Math.sin(a));
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // single seam — logarithmic spiral from inner ring to outer ring at the
    // primary phase (sliceRotation). when twist = 0 it's a straight radial;
    // for twist > 0 the seam bends to preview exactly one tier of rotation.
    // the N-arm symmetry is implied by the wedge fold, not drawn explicitly —
    // one seam is enough as a hit-target for twist and reads much cleaner at
    // high arms counts.
    const twistHL = env.hoverMode === 'twist' || env.overlayDragMode === 'droste-twist';
    const seamColor = oobOut
      ? (twistHL ? 'rgba(255, 230, 140, 1.0)' : 'rgba(255, 196, 80, 0.85)')
      : (twistHL ? 'rgba(255, 255, 255, 1.0)' : 'rgba(255, 255, 255, 0.8)');
    ctx.strokeStyle = seamColor;
    ctx.lineWidth = twistHL ? 2.5 : 1.5;
    ctx.setLineDash(oobOut ? [6, 4] : []);
    const SEAM_STEPS = 32;
    ctx.beginPath();
    for (let i = 0; i <= SEAM_STEPS; i++) {
      const t = i / SEAM_STEPS;
      const r = rIn * Math.pow(zoom, t);
      const a = seamPhaseRad + twistRad * t;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // seam outer endpoint — the twist handle, drawn on top of the seam stroke.
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

    // expose geometry for hit testing. only one seam endpoint — dragging it
    // adjusts drosteTwist, and the N-arm symmetry follows automatically via
    // the wedge fold in the shader.
    env.sourceOverlayCanvas._geom = {
      imgX, imgY, imgW, imgH,
      cx, cy,
      rOut, rIn,
      seamEndX, seamEndY,
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
    if (seamEndX != null) {
      const d = Math.hypot(x - seamEndX, y - seamEndY);
      if (d <= HANDLE_HIT) {
        return { mode: 'twist', r, theta, R: rOut, cursorTheta: theta };
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
