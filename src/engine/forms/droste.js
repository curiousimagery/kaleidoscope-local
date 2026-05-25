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

  controls: ['segments', 'zoom', 'twist', 'mirror', 'wedgeMirror'],

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
    // wedge-mirror: 1 = reflect at wedge boundaries (kaleidoscope-style, all
    // arms restricted to even); 0 = plain angular mod (N chiral arms with hard
    // boundary seams). only consulted when u_drosteArms > 1.
    u_drosteWedgeMirror: {
      type: '1i',
      get: (state) => (state.drosteWedgeMirror === false ? 0 : 1),
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

      // angular fold for N-arm mode. with wedge-mirror on (default): mirror at
      // wedge boundaries (kaleidoscope feel, N/2 visible bilateral petals at
      // non-zero twist). with wedge-mirror off: plain angular mod (N chiral
      // arms with hard boundary seams — experimental "real spiral" look).
      // arms=1 bypasses both paths and uses the raw theta.
      if (u_drosteArms > 1) {
        float wedge = TAU / float(u_drosteArms);
        if (u_drosteWedgeMirror == 1) {
          float t = mod(theta + wedge * 0.5, wedge * 2.0) - wedge * 0.5;
          if (t > wedge * 0.5) t = wedge - t;
          theta = t;
        } else {
          theta = mod(theta, wedge);
        }
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

    // translucent twisted-wedge overlay — shows the ACTUAL sample region in
    // source space when twist is non-zero. the warp maps canvas (theta=θ, r=R)
    // to source (theta=θ + (twist/logS)·log R, r=R), so the inner ring of the
    // sample wedge is rotated by −twist relative to the outer ring, with
    // log-spiral sides connecting them. drawn after the solid untwisted wedge
    // outline so the user sees both:
    //   - solid untwisted wedge = click/touch reference + straight-line affordance
    //   - translucent twisted wedge = visual preview of the actual pixels sampled
    // skipped at twist=0 (identical to untwisted) and at arms=1 (the full-circle
    // annulus is the sample region regardless of twist).
    const SEAM_STEPS = 24;
    if (Math.abs(twistRad) > 1e-4 && !isFullCircle) {
      ctx.strokeStyle = oobOut ? 'rgba(255, 196, 80, 0.55)' : 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      // 1. outer arc — same as untwisted (twist doesn't shift the outer ring).
      ctx.arc(cx, cy, rOut, wedgeStart, wedgeEnd, false);
      // 2. +halfWedge side: log-spiral from (rOut, wedgeEnd) to (rIn, wedgeEnd − twist).
      for (let i = 1; i <= SEAM_STEPS; i++) {
        const t = 1 - i / SEAM_STEPS;             // t goes 1 → 0 (outer → inner)
        const r = rIn * Math.pow(zoom, t);
        const a = wedgeEnd - twistRad * (1 - t);   // outer: a=wedgeEnd; inner: a=wedgeEnd−twist
        ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
      // 3. inner arc — shifted by −twist.
      ctx.arc(cx, cy, rIn, wedgeEnd - twistRad, wedgeStart - twistRad, true);
      // 4. −halfWedge side: log-spiral back up to (rOut, wedgeStart).
      for (let i = 1; i <= SEAM_STEPS; i++) {
        const t = i / SEAM_STEPS;
        const r = rIn * Math.pow(zoom, t);
        const a = wedgeStart - twistRad * (1 - t);
        ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
      ctx.closePath();
      ctx.stroke();
    }

    // seam line — logarithmic spiral at the wedge center from outer ring
    // (sliceRotation) to inner ring (sliceRotation − twist), matching the
    // actual warp direction. when twist = 0 it's a straight radial. serves as
    // both a twist preview at arms=1 (where there are no wedge sides) and as
    // the visual context for the twist drag handle at all arms.
    const twistHL = env.hoverMode === 'twist' || env.overlayDragMode === 'droste-twist';
    const seamColor = oobOut
      ? (twistHL ? 'rgba(255, 230, 140, 1.0)' : 'rgba(255, 196, 80, 0.85)')
      : (twistHL ? 'rgba(255, 255, 255, 1.0)' : 'rgba(255, 255, 255, 0.8)');
    ctx.strokeStyle = seamColor;
    ctx.lineWidth = twistHL ? 2.5 : 1.5;
    ctx.setLineDash(oobOut ? [6, 4] : []);
    ctx.beginPath();
    for (let i = 0; i <= SEAM_STEPS; i++) {
      const t = i / SEAM_STEPS;                    // 0 at inner, 1 at outer
      const r = rIn * Math.pow(zoom, t);
      const a = seamPhaseRad - twistRad * (1 - t); // inner: a=phase−twist; outer: a=phase
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // twist handle — the seam's INNER endpoint at (rIn, sliceRotation − twist).
    // moves with twist so the user has a visible drag target that tracks the
    // parameter. positioned on the inner ring; the inner-ring scale band still
    // works on the rest of the ring (handle hit is checked first in classify).
    const seamEndAngle = seamPhaseRad - twistRad;
    const seamEndX = cx + rIn * Math.cos(seamEndAngle);
    const seamEndY = cy + rIn * Math.sin(seamEndAngle);
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

    // expose geometry for hit testing. classifyPointer uses halfWedge +
    // sliceRotationRad to restrict ring-band scale hits to the wedge angular
    // range (so dragging outside the wedge always rotates), and to hit-test
    // the radial boundary lines for the droste-arms drag.
    env.sourceOverlayCanvas._geom = {
      imgX, imgY, imgW, imgH,
      cx, cy,
      rOut, rIn,
      seamEndX, seamEndY,
      halfWedge,
      sliceRotationRad: seamPhaseRad,
      isFullCircle,
    };
  },

  // ---------------------------------------------------------------------------
  // hit testing — bespoke, replaces classifyPointer
  // ---------------------------------------------------------------------------
  //
  // mode priorities (highest wins):
  //   1. twist handle hit (small)              → 'twist'
  //   2. ring bands WITHIN the wedge angular range:
  //        a. inner-ring band                  → 'scale' handle='inner' (drives drosteZoom)
  //        b. outer-ring band                  → 'scale' handle='outer' (drives sliceScale)
  //   3. wedge boundary line (arms ≥ 2)        → 'droste-arms' (drag the edge to
  //                                              change the arms count)
  //   4. inside wedge angular range AND inside outer ring → 'move' (reposition)
  //   5. anywhere else (outside wedge angular OR beyond outer ring) → 'rotate'
  //
  // the "wedge angular range" is sliceRotation ± halfWedge. for arms=1 the
  // halfWedge is π so insideWedge is always true; everything inside outer ring
  // is 'move', everything outside is 'rotate', and ring bands fire 360°.
  classifyPointer(env, x, y, isTouch, geom) {
    const g = env.sourceOverlayCanvas?._geom;
    if (!g) return { mode: null };
    const { cx, cy, rOut, rIn, seamEndX, seamEndY, halfWedge, sliceRotationRad, isFullCircle } = g;

    const dx = x - cx, dy = y - cy;
    const r = Math.hypot(dx, dy);
    const theta = Math.atan2(dy, dx);

    const HANDLE_HIT = isTouch ? 22 : 12;
    const BAND_OUT   = isTouch ? 28 : 20;
    const BAND_IN    = isTouch ? 22 : 16;
    const SIDE_BAND  = isTouch ? 22 : 14;  // perpendicular hit zone for wedge boundary lines

    // 1. twist handle
    if (seamEndX != null) {
      const d = Math.hypot(x - seamEndX, y - seamEndY);
      if (d <= HANDLE_HIT) {
        return { mode: 'twist', r, theta, R: rOut, cursorTheta: theta };
      }
    }

    // compute angle relative to sliceRotation (the wedge center axis)
    let relAngle = theta - sliceRotationRad;
    while (relAngle > Math.PI)  relAngle -= 2 * Math.PI;
    while (relAngle < -Math.PI) relAngle += 2 * Math.PI;
    const insideWedge = isFullCircle || Math.abs(relAngle) <= halfWedge;

    // 2. ring band hits — only fire when cursor is within the wedge angular
    // range. outside the wedge, the ring bands are visually faint (we don't
    // even draw arcs there) so dragging that area should rotate.
    if (insideWedge) {
      const dOut = Math.abs(r - rOut);
      const dIn  = Math.abs(r - rIn);
      const inOuterBand = (r > rOut ? dOut <= BAND_OUT : dOut <= BAND_IN);
      const inInnerBand = (r < rIn  ? dIn  <= BAND_OUT : dIn  <= BAND_IN);
      if (inInnerBand && inOuterBand) {
        if (dIn < dOut) return { mode: 'scale', r, theta, R: rIn, handle: 'inner', cursorTheta: theta };
        return { mode: 'scale', r, theta, R: rOut, handle: 'outer', cursorTheta: theta };
      }
      if (inInnerBand) return { mode: 'scale', r, theta, R: rIn, handle: 'inner', cursorTheta: theta };
      if (inOuterBand) return { mode: 'scale', r, theta, R: rOut, handle: 'outer', cursorTheta: theta };
    }

    // 3. wedge boundary lines (arms ≥ 2). hit when cursor is near a radial
    // line at sliceRotation ± halfWedge, within the rIn..rOut radial extent.
    if (!isFullCircle) {
      for (const sign of [-1, 1]) {
        const ba = sliceRotationRad + sign * halfWedge;
        const ux = Math.cos(ba), uy = Math.sin(ba);
        const along = dx * ux + dy * uy;            // projection onto the boundary direction
        const perp  = Math.abs(dx * (-uy) + dy * ux);  // perpendicular distance
        if (along >= rIn - SIDE_BAND && along <= rOut + SIDE_BAND && perp <= SIDE_BAND) {
          return {
            mode: 'droste-arms',
            r, theta, R: along,
            cursorTheta: ba + sign * Math.PI / 2,  // cursor "wants" to move perpendicular to the line
            boundarySign: sign,
          };
        }
      }
    }

    // 4. inside the wedge and inside the outer ring → move (reposition)
    if (insideWedge && r <= rOut) {
      return { mode: 'move', r, theta, R: rIn };
    }

    // 5. fall-through → rotate
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
