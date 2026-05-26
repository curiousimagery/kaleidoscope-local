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
    // SWIRL — Möbius pre-composition parameter (drosteSwirlX, drosteSwirlY).
    // applied BEFORE the log-shear. moves the spiral pole AND non-uniformly
    // distorts the disc interior (the "swirl/rotation" feel). UNCLAMPED so the
    // user can drag past |a|=1 into the back half of the Riemann sphere; when
    // |a|>1 a single pixel inside the disc (at p = 1/conj(a)) sources from
    // infinity — caught by the engine's existing OOB modes.
    u_drosteSwirl: {
      type: '2f',
      get: (state) => [state.drosteSwirlX || 0, state.drosteSwirlY || 0],
    },
    // SHIFT — per-tier linear translation, applied POST-warp. each recursive
    // tier drifts by a fraction toward this vector; factor (1 − r/r_src) is
    // exactly 0 on the surface tier (no shift) and approaches 1 as recursion
    // deepens. C0-continuous at every tier boundary in mirror mode (at the
    // reflection point r = r_src on both sides → factor = 0 on both sides).
    u_drosteShift: {
      type: '2f',
      get: (state) => [state.drosteShiftX || 0, state.drosteShiftY || 0],
    },
  },

  // input convention: p in canvas space [-1, 1]² (post canvas rot/zoom).
  // output convention: a complex number z_src with |z_src| ∈ [1/drosteZoom, 1]
  //   — the source annulus expressed in fold space. toSourceUV places this in
  //   the source image isotropically (annulus stays visually circular).
  glsl: `
    vec2 foldDroste(vec2 p) {
      // SWIRL — Möbius pre-composition: M(p) = (p - a) / (1 - conj(a) * p).
      // moves the spiral pole AND non-uniformly distorts the disc interior.
      // identity at a = 0. with conj(a) = (a.x, -a.y), conj(a)*p expands to
      // (a.x*p.x + a.y*p.y, a.x*p.y - a.y*p.x).
      vec2 a = u_drosteSwirl;
      vec2 num = p - a;
      vec2 cap = vec2(a.x * p.x + a.y * p.y, a.x * p.y - a.y * p.x);
      vec2 den = vec2(1.0 - cap.x, -cap.y);
      // complex division: num / den = num * conj(den) / |den|^2
      float denMag2 = max(1e-8, dot(den, den));
      p = vec2(num.x * den.x + num.y * den.y,
               num.y * den.x - num.x * den.y) / denMag2;

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

      // SHIFT — per-tier linear translation in fold-space. surface tier has
      // r = r_src so factor = 0 (no shift on the visible annulus). deeper tiers
      // accumulate drift toward u_drosteShift. in mirror mode the factor
      // crosses 0 at every tier reflection, so the shift effect remains
      // seamless across the mirror boundaries.
      float r_src = exp(logr_new);
      vec2 z_src = vec2(cos(theta_new), sin(theta_new)) * r_src;
      z_src += u_drosteShift * (1.0 - r / r_src);
      return z_src;
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

    const seamPhaseRad = state.sliceRotation * Math.PI / 180;
    const twistRad = state.drosteTwist * Math.PI / 180;
    const wedgeStart = seamPhaseRad - halfWedge;
    const wedgeEnd   = seamPhaseRad + halfWedge;

    // OOB check — only the actual sampled region matters. for arms=1 that's
    // the full annulus, so the simple full-circle bounds check still applies.
    // for arms ≥ 2 we sample the TWISTED wedge boundary (outer arc, inner arc
    // shifted by −twist, both log-spiral sides) at discrete points; any point
    // outside the displayed image rect triggers OOB. fixes the Build 45 case
    // where the full outer ring exited the image but the wedge itself was
    // entirely inside bounds and shouldn't have read as OOB.
    let oobOut;
    if (isFullCircle) {
      oobOut = (cx - rOut < imgX) || (cx + rOut > imgX + imgW) ||
               (cy - rOut < imgY) || (cy + rOut > imgY + imgH);
    } else {
      oobOut = false;
      const OOB_STEPS = 12;
      const xR = imgX + imgW, yB = imgY + imgH;
      function probe(rr, aa) {
        const x = cx + rr * Math.cos(aa);
        const y = cy + rr * Math.sin(aa);
        if (x < imgX || x > xR || y < imgY || y > yB) oobOut = true;
      }
      for (let i = 0; i <= OOB_STEPS; i++) {
        const t = i / OOB_STEPS;
        const aArc = wedgeStart + t * (wedgeEnd - wedgeStart);
        probe(rOut, aArc);                              // outer arc
        probe(rIn,  aArc - twistRad);                   // inner arc (shifted by −twist)
        if (i > 0 && i < OOB_STEPS) {
          // log-spiral sides — only sample interior points (corners covered above)
          const rs = rIn * Math.pow(zoom, t);
          probe(rs, wedgeStart - twistRad * (1 - t));   // − side
          probe(rs, wedgeEnd   - twistRad * (1 - t));   // + side
        }
        if (oobOut) break;
      }
    }

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
      ctx.strokeStyle = oobOut ? 'rgba(255, 196, 80, 0.32)' : 'rgba(255, 255, 255, 0.3)';
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

    // swirl + shift handles — two direct-manipulation targets. both are mapped
    // from fold-space to screen via slice rotation + rOut (fold-radius 1 → rOut
    // screen-px). when both are at (0,0) the filled shift dot sits inside the
    // open swirl ring, forming a target/bullseye over the center dot.
    const cosRot = Math.cos(seamPhaseRad), sinRot = Math.sin(seamPhaseRad);

    // swirl ring — Möbius parameter; UNCLAMPED visual position (when |swirl|>1
    // the ring draws outside the source rect, which is fine — canvas overflow
    // is invisible to the user but the position is still hit-testable by
    // dragging in that direction).
    const sx = state.drosteSwirlX || 0;
    const sy = state.drosteSwirlY || 0;
    const swirlHandleX = cx + rOut * (sx * cosRot - sy * sinRot);
    const swirlHandleY = cy + rOut * (sx * sinRot + sy * cosRot);
    const swirlHL = env.hoverMode === 'droste-swirl' || env.overlayDragMode === 'droste-swirl';
    const swirlRingR = swirlHL ? 12 : 10;
    ctx.strokeStyle = oobOut ? 'rgba(255, 196, 80, 1)' : 'rgba(255, 255, 255, 1)';
    ctx.lineWidth = swirlHL ? 2.5 : 2;
    ctx.beginPath();
    ctx.arc(swirlHandleX, swirlHandleY, swirlRingR, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(swirlHandleX, swirlHandleY, swirlRingR + 1.5, 0, TAU);
    ctx.stroke();

    // shift dot — per-tier translation; small filled circle that sits inside
    // the swirl ring at (0, 0). also unclamped.
    const tx = state.drosteShiftX || 0;
    const ty = state.drosteShiftY || 0;
    const shiftHandleX = cx + rOut * (tx * cosRot - ty * sinRot);
    const shiftHandleY = cy + rOut * (tx * sinRot + ty * cosRot);
    const shiftHL = env.hoverMode === 'droste-shift' || env.overlayDragMode === 'droste-shift';
    const shiftDotR = shiftHL ? 8 : 6;
    ctx.fillStyle = oobOut ? 'rgba(255, 196, 80, 1)' : 'rgba(255, 255, 255, 1)';
    ctx.beginPath();
    ctx.arc(shiftHandleX, shiftHandleY, shiftDotR, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

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

      // rotation arc — centered at slice center, just past the outer ring in
      // the wedge's own direction (seamPhaseRad). same idiom as radial/hex:
      // the arc hugs the outside of the outer boundary, centered on the wedge.
      const { op: rop, lw: rlw } = afStyle(env.overlayDragMode === 'rotate');
      const rotArcRadius = rOut + (IS_TOUCH ? 24 : 18);
      drawRotationArc(ctx, cx, cy, seamPhaseRad, rotArcRadius, rop, rlw, 22 * Math.PI / 180);

      // thickness and scale arrows — placed on the lower portion of the wedge
      // arc (below the angular midpoint) and oriented purely radially (pointing
      // directly away from the slice center).
      const arrowAngle = isFullCircle
        ? seamPhaseRad + Math.PI / 4
        : seamPhaseRad + halfWedge * 0.65;
      const tDx = Math.cos(arrowAngle), tDy = Math.sin(arrowAngle);
      const arrowCos = Math.cos(arrowAngle), arrowSin = Math.sin(arrowAngle);

      const { op: tip, lw: tlw } = afStyle(env.overlayDragMode === 'droste-ratio');
      drawRadialArrow(ctx, cx + rIn * arrowCos, cy + rIn * arrowSin, tDx, tDy, tip, tlw);

      const { op: sop, lw: slw } = afStyle(env.overlayDragMode === 'scale');
      drawRadialArrow(ctx, cx + rOut * arrowCos, cy + rOut * arrowSin, tDx, tDy, sop, slw);

      // segment-drag affordance — two faint parallel lines along the UPPER
      // wedge boundary (the one with the smaller midpoint y on screen), same
      // visual idiom as radial's spoke double-line. only drawn when arms ≥ 2
      // (no boundary exists at arms=1).
      if (!isFullCircle) {
        const midR = (rIn + rOut) / 2;
        const startMidY = cy + midR * Math.sin(wedgeStart);
        const endMidY   = cy + midR * Math.sin(wedgeEnd);
        const upperAngle = startMidY < endMidY ? wedgeStart : wedgeEnd;
        const ux = Math.cos(upperAngle), uy = Math.sin(upperAngle);
        const perpX = -uy, perpY = ux;
        const GAP = 2.5;
        const t0 = rIn + (rOut - rIn) * 0.2;
        const t1 = rIn + (rOut - rIn) * 0.8;
        const { op: aop, lw: alw } = afStyle(env.overlayDragMode === 'droste-arms');
        ctx.lineWidth = (env.overlayDragMode === 'droste-arms') ? alw : 1;
        ctx.strokeStyle = `rgba(255,255,255,${aop * 0.7})`;
        for (const sign of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(cx + ux * t0 + perpX * GAP * sign, cy + uy * t0 + perpY * GAP * sign);
          ctx.lineTo(cx + ux * t1 + perpX * GAP * sign, cy + uy * t1 + perpY * GAP * sign);
          ctx.stroke();
        }
      }
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
      swirlHandleX, swirlHandleY,
      shiftHandleX, shiftHandleY,
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
  //   1. shift handle hit (snug)               → 'droste-shift'
  //   2. swirl handle hit (looser)             → 'droste-swirl'
  //   3. twist handle hit                      → 'twist'
  //   4. ring bands WITHIN the wedge angular range:
  //        a. inner-ring band                  → 'scale' handle='inner' (drosteZoom)
  //        b. outer-ring band                  → 'scale' handle='outer' (sliceScale)
  //   5. wedge boundary line (arms ≥ 2)        → 'droste-arms'
  //   6. inside the inner ring (r ≤ rIn)       → 'move' (regardless of wedge angular)
  //   7. inside wedge AND inside outer ring    → 'move'
  //   8. fall-through                          → 'rotate'
  //
  // band widths follow daniel's "~16 px total, only a few inside the wedge"
  // rule: BAND_IN (in the annulus body, between the rings) is intentionally
  // small so most of the wedge interior is 'move'; BAND_OUT (outside the
  // annulus, into the inner-disc or beyond the outer ring) is larger because
  // those areas are where users naturally grab the ring boundaries.
  classifyPointer(env, x, y, isTouch, geom) {
    const g = env.sourceOverlayCanvas?._geom;
    if (!g) return { mode: null };
    const { cx, cy, rOut, rIn, seamEndX, seamEndY,
            swirlHandleX, swirlHandleY, shiftHandleX, shiftHandleY,
            halfWedge, sliceRotationRad, isFullCircle } = g;

    const dx = x - cx, dy = y - cy;
    const r = Math.hypot(dx, dy);
    const theta = Math.atan2(dy, dx);

    const HANDLE_HIT     = isTouch ? 22 : 12;
    const SHIFT_HIT      = isTouch ? 16 : 10;   // snug — the filled center dot
    const SWIRL_HIT      = isTouch ? 22 : 14;   // looser — annulus around shift
    const BAND_OUT       = isTouch ? 14 : 12;   // outside the annulus (toward inner-disc or beyond outer)
    const BAND_IN        = isTouch ?  8 :  6;   // inside the annulus body — leaves room for 'move' interior
    const SIDE_BAND_OUT  = isTouch ? 14 : 12;   // outside the wedge angularly
    const SIDE_BAND_IN   = isTouch ?  8 :  6;   // inside the wedge angularly

    // 1. shift handle — highest priority. when at zero the dot sits inside the
    // swirl ring; SHIFT_HIT is tight enough that hitting just outside the dot
    // (annulus 10–14 px from center) still falls through to the swirl handle.
    if (shiftHandleX != null) {
      const d = Math.hypot(x - shiftHandleX, y - shiftHandleY);
      if (d <= SHIFT_HIT) {
        return { mode: 'droste-shift', r, theta, R: 0 };
      }
    }

    // 2. swirl handle — second priority. when at zero (overlapping shift), this
    // catches the annular region just outside the shift dot.
    if (swirlHandleX != null) {
      const d = Math.hypot(x - swirlHandleX, y - swirlHandleY);
      if (d <= SWIRL_HIT) {
        return { mode: 'droste-swirl', r, theta, R: 0 };
      }
    }

    // 3. twist handle
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

    // 2. ring band hits — only within the wedge angular range. ring bands are
    // intentionally asymmetric: thin on the annulus-body side (leaves the
    // interior for 'move'), thicker on the outside (where users grab to
    // adjust ring size).
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

    // 3. wedge boundary lines (arms ≥ 2). asymmetric perpendicular band:
    // larger on the outside-the-wedge side (where users naturally grab to
    // change arms), small inside the wedge to reserve interior for 'move'.
    if (!isFullCircle) {
      for (const sign of [-1, 1]) {
        const ba = sliceRotationRad + sign * halfWedge;
        const ux = Math.cos(ba), uy = Math.sin(ba);
        const along = dx * ux + dy * uy;
        const perpSigned = dx * (-uy) + dy * ux;        // signed perpendicular
        const isOutside = sign * perpSigned > 0;        // + boundary: outside = perpSigned > 0
        const allowance = isOutside ? SIDE_BAND_OUT : SIDE_BAND_IN;
        if (along >= rIn - SIDE_BAND_OUT && along <= rOut + SIDE_BAND_OUT && Math.abs(perpSigned) <= allowance) {
          return {
            mode: 'droste-arms',
            r, theta, R: along,
            cursorTheta: ba + sign * Math.PI / 2,
            boundarySign: sign,
          };
        }
      }
    }

    // 4. inside the inner ring (any angle) → always move. catches the small
    // center region cleanly even when cursor crosses outside the wedge
    // angular range (which would otherwise fire rotate at #6).
    if (r <= rIn) {
      return { mode: 'move', r, theta, R: rIn };
    }

    // 5. inside the wedge and inside the outer ring → move
    if (insideWedge && r <= rOut) {
      return { mode: 'move', r, theta, R: rIn };
    }

    // 6. fall-through → rotate
    return { mode: 'rotate', r, theta, R: rOut };
  },

  // filename suffix: zoom + signed twist + arms + mirror + swirl + shift.
  // e.g. z200t045a03m1                   = zoom 2.00, twist +45°, arms 3, mirror on
  //      z200tm120a01m0                  = zoom 2.00, twist −120°, arms 1, mirror off
  //      z200t000a02m1sx030ym020         = + swirl (0.30, −0.20). omitted when (0, 0).
  //      z200t000a02m1tx015y025          = + shift (0.15, 0.25). omitted when (0, 0).
  filenameSuffix(state) {
    const z = Math.round(state.drosteZoom * 100);
    const tDeg = Math.round(state.drosteTwist);
    const tSign = tDeg < 0 ? 'm' : '';
    const arms = Math.max(1, Math.min(12, Math.round(state.drosteArms || 1)));
    const mirror = state.drosteMirror ? 1 : 0;
    let suffix = 'z' + z
      + 't' + tSign + String(Math.abs(tDeg)).padStart(3, '0')
      + 'a' + String(arms).padStart(2, '0')
      + 'm' + mirror;
    const enc = (v) => (v < 0 ? 'm' : '') + String(Math.abs(Math.round(v * 100))).padStart(3, '0');
    const sx = state.drosteSwirlX || 0, sy = state.drosteSwirlY || 0;
    if (Math.abs(sx) > 0.005 || Math.abs(sy) > 0.005) {
      suffix += 'sx' + enc(sx) + 'y' + enc(sy);
    }
    const tx = state.drosteShiftX || 0, ty = state.drosteShiftY || 0;
    if (Math.abs(tx) > 0.005 || Math.abs(ty) > 0.005) {
      suffix += 'tx' + enc(tx) + 'y' + enc(ty);
    }
    return suffix;
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

function drawRotationArc(ctx, cx, cy, angle, radius, op, lw, hspan) {
  const HSPAN = hspan != null ? hspan : 11 * Math.PI / 180;
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
