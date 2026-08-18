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

// Imported at CALL time inside drawOverlay (a live binding), so the forms↔index cycle is safe —
// the same pattern engine/geometry.js uses for exactly this reason.
import { formSizeNorm } from './index.js';
import { sliceMirror } from '../geometry.js';

const TAU = Math.PI * 2;

export default {
  id: 'droste',
  // ✅ ZOOM EXTENTS TUNED B618 by Daniel with the ?tune=forms range sweep.
  // for droste these really measure the SLICE SCALE range limits (Daniel), since its composition zoom is the phase.
  zoomCover: 2.2,
  zoomInFloor: 0.15,

  label: 'Droste',
  fileCode: 'd',

  thumbnail: `<svg viewBox="0 0 32 32"><g class="stroke" fill="none">
    <circle cx="16" cy="16" r="12"/>
    <circle cx="16" cy="16" r="5"/>
    <path d="M 21 16 A 5 5 0 0 1 22.5 19.5 L 26.6 23.6"/>
  </g></svg>`,

  controls: ['segments', 'zoom', 'spiral', 'mirror', 'wedgeMirror', 'infiniteZoom'],

  // ⚠️ B628 — EXEMPT FROM THE DEFAULT FIT-TO-SOURCE. Every other form's default box is scaled down
  // at reset until it sits inside the source with a margin; droste's is not, because its default
  // is DELIBERATELY larger than the frame. Daniel tuned exactly this at B617, reducing sizeNorm
  // 1.82 → 1.65 to stop it touching the right edge rather than to make it fit — the log-polar fold
  // wants to run past the boundary, and `zoomCover: 2.2` says the same thing from the zoom side.
  // Fitting it would silently undo that tuning.
  defaultOverflow: true,

  // the spiral's eye IS the composition, and seamless infinite zoom depends on staying on it —
  // pan locked (centered) by default. See formPanLockedByDefault.
  panLockedByDefault: true,

  // ✅ TUNED B614 by Daniel against a reference source. Derived through `sliceScale` rather than
  // the ?tune=forms sizeNorm slider, because droste's bespoke drawOverlay was not applying the
  // norm at all (fixed in the same build) so the slider appeared to do nothing to the overlay.
  // The value is still correct: the shader reads `sliceScale × sizeNorm`, so the two are
  // interchangeable for the RENDER — only the overlay was out of step.
  // 1.82 → 1.65 (Daniel, B617): at 1.82 the annulus touched the right edge on standard landscape
  // content once the box was centred properly, so the value had to come down after B616 moved it.
  sizeNorm: 1.65,

  uniforms: {
    // log(drosteZoom) — precomputed to spare the shader a log() per pixel.
    u_drosteLogS: {
      type: '1f',
      get: (state) => Math.log(Math.max(1.0001, state.drosteZoom)),
    },
    // INFINITE ZOOM — a log-radius shift driven by drosteZoomPhase ∈ [0,1). The
    // fold is scale-periodic (logr is reduced mod logS below), so sweeping the
    // shift continuously zooms and wraps with NO seam. shift = phase · loopLog,
    // where the seamless loop is logS for WRAP tiers but 2·logS for MIRROR tiers
    // (a mirror tier reflects — one factor lands on the mirror image, identity
    // returns only at 2·logS). SEAMLESS PRECONDITIONS: offset centered (the
    // Möbius pre-comp is NOT scale-invariant — why the offset is default-locked)
    // and spiral = 0 for a PURE zoom: spiral keeps the radial shift exact
    // (c.real = 1) but adds a residual source rotation per loop = spiral·logS²/(2π),
    // so a seamless spiral zoom must couple canvasRotation to cancel it (the Droste
    // screw motion — not yet wired; needs an on-device sign check).
    u_drosteZoomShift: {
      type: '1f',
      get: (state) => {
        const logS = Math.log(Math.max(1.0001, state.drosteZoom));
        const loopLog = state.drosteMirror ? 2 * logS : logS;
        // phase is stored UNWRAPPED (a continuous accumulator, so the perform follower,
        // motion tween, and autoplay all move it smoothly with no wrap-blip). Wrap mod 1
        // HERE so the float32 shader input stays bounded/precise — integer periods are
        // absorbed by the logr mod below, so this is image-identical to the raw phase.
        const ph = (((state.drosteZoomPhase || 0) % 1) + 1) % 1;
        return ph * loopLog;
      },
    },
    // LENSTRA conformal-map parameter (generalized formulation, committed in
    // Build 55 after A/B test): c = 1 + i·b where b = -spiral·logS/(2π).
    // c.real = 1 always → full 360° of source theta per canvas turn. mildly
    // non-conformal (~4° angular shear per tier at zoom=2). at spiral=0,
    // c = (1, 0) (identity) → standard concentric Droste, no spiral.
    u_drosteC: {
      type: '2f',
      get: (state) => {
        const logS = Math.log(Math.max(1.0001, state.drosteZoom));
        const spiral = state.drosteSpiral || 0;
        return [1, -spiral * logS / (2 * Math.PI)];
      },
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
    // OFFSET — combined center-offset parameter. drives BOTH:
    //   (a) canvas-side Möbius pre-composition (disc automorphism that maps
    //       the spiral pole to canvas position a, preserving circles), and
    //   (b) source-side per-tier drift (z_src += u_drosteOffset·(1−r/r_src),
    //       which is 0 on surface and approaches 1 in deep tiers).
    // single handle (Build 57 merger: was drosteOffset + drosteShift).
    u_drosteOffset: {
      type: '2f',
      get: (state) => [state.drosteOffsetX || 0, state.drosteOffsetY || 0],
    },
  },

  // input convention: p in canvas space [-1, 1]² (post canvas rot/zoom).
  // output convention: a complex number z_src with |z_src| ∈ [1/drosteZoom, 1]
  //   — the source annulus expressed in fold space. toSourceUV places this in
  //   the source image isotropically (annulus stays visually circular).
  glsl: `
    vec2 foldDroste(vec2 p) {
      // 1. CANVAS-SIDE OFFSET — Möbius pre-composition: M(p) = (p - a) / (1 - conj(a)*p).
      // disc automorphism that maps the unit circle to itself (outer ring preserved)
      // and maps origin to −a, so the spiral pole appears at canvas position a.
      // Möbius preserves circles → each tier ring stays circular but with a
      // different center → PhotoSpiralysis off-center-rings aesthetic.
      vec2 a = u_drosteOffset;
      vec2 num = p - a;
      vec2 cap = vec2(a.x * p.x + a.y * p.y, a.x * p.y - a.y * p.x);
      vec2 den = vec2(1.0 - cap.x, -cap.y);
      float denMag2 = max(1e-8, dot(den, den));
      p = vec2(num.x * den.x + num.y * den.y,
               num.y * den.x - num.x * den.y) / denMag2;

      float r = length(p);
      if (r < 1e-8) return vec2(0.0);
      float logr = log(r);
      logr -= u_drosteZoomShift;   // infinite zoom: continuous scale-periodic sweep (wraps via the mod below); − so phase↑ = zoom IN
      float theta = atan(p.y, p.x);

      // 3. ARMS — angular fold into 1/N wedge (unchanged).
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

      // 4. LENSTRA CONFORMAL MAP — z_src = exp(c · log(p)).
      // c pre-computed JS-side (classical or generalized Lenstra). spiral=0
      // gives c = (1, 0) → identity (no spiral, concentric Droste).
      // c·(logr + i·theta) = (c.x·logr − c.y·theta) + i·(c.x·theta + c.y·logr)
      vec2 c = u_drosteC;
      float logr_src  = c.x * logr  - c.y * theta;
      float theta_src = c.x * theta + c.y * logr;

      // (Build 57: removed the arms=1 wedge-mirror tier-parity theta flip.
      // It produced a vertical-flip-by-tier appearance unrelated to the
      // arms≥2 wedge-mirror idiom; wedge mirror UI is now hidden at arms=1.)

      // 5. TIER MIRROR / WRAP — reduce logr_src into the fundamental annulus
      // [-logS, 0). mirror reflects at tier boundaries (triangle wave),
      // wrap jumps (sawtooth — the visible "tier seam" in classical Droste).
      float logS = u_drosteLogS;
      if (u_drosteMirror == 1) {
        float u = mod(logr_src, 2.0 * logS);
        logr_src = abs(u - logS) - logS;
      } else {
        logr_src = mod(logr_src, logS) - logS;
      }

      // 6. SOURCE-SIDE PER-TIER DRIFT — driven by the SAME u_drosteOffset
      // parameter as the Möbius pre-comp in step 1. factor (1 − r/r_src) is
      // 0 on the surface tier and at every mirror reflection point, so the
      // drift is seamless with drosteMirror. Composes with the Möbius to
      // produce both off-center rings AND deeper-tier source drift.
      float r_src = exp(logr_src);
      vec2 z_src = vec2(cos(theta_src), sin(theta_src)) * r_src;
      z_src += u_drosteOffset * (1.0 - r / r_src);
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

  // the TRUE sampled-region outline for the perform onion skin (overlay.js
  // drawGhostWedges) — the placeholder circle above made every droste ghost a
  // complete circle regardless of arms. arms=1 → the full annulus (outer +
  // inner ring, two paths); arms≥2 → the annular wedge with twist-shifted
  // inner arc and log-spiral sides (the drawOverlay OOB-probe geometry).
  // vec space: fold-radius 1 = the outer ring; sliceVecToSourceUV rotates then
  // Y-flips, mapping vec angle a to overlay angle −a — so the inner arc's
  // −twist screen shift is emitted as +twist here.
  ghostPaths(state) {
    const zoom = Math.max(1.0001, state.drosteZoom);
    const rIn = 1 / zoom;
    const n = Math.round(state.drosteArms || 1);
    const arms = n <= 1 ? 1 : Math.max(2, Math.min(12, n - (n % 2)));
    if (arms === 1) {
      const circle = (r) => {
        const pts = [];
        for (let i = 0; i < 32; i++) {
          const a = (i / 32) * TAU;
          pts.push({ vx: r * Math.cos(a), vy: r * Math.sin(a) });
        }
        return pts;
      };
      return [circle(1), circle(rIn)];
    }
    const hW = Math.PI / arms;
    const logS = Math.log(zoom);
    const twist = -(state.drosteSpiral || 0) * logS * logS / (2 * Math.PI);
    const ARC = 12, SIDE = 8;
    const pts = [];
    for (let i = 0; i <= ARC; i++) {           // outer arc
      const a = -hW + (i / ARC) * 2 * hW;
      pts.push({ vx: Math.cos(a), vy: Math.sin(a) });
    }
    for (let i = 1; i <= SIDE; i++) {          // log-spiral side, outer → inner
      const t = 1 - i / SIDE;
      const r = Math.pow(zoom, t - 1);
      const a = hW + twist * (1 - t);
      pts.push({ vx: r * Math.cos(a), vy: r * Math.sin(a) });
    }
    for (let i = 1; i <= ARC; i++) {           // inner arc (twist-shifted)
      const a = hW - (i / ARC) * 2 * hW + twist;
      pts.push({ vx: rIn * Math.cos(a), vy: rIn * Math.sin(a) });
    }
    for (let i = 1; i < SIDE; i++) {           // log-spiral side, inner → outer
      const t = i / SIDE;
      const r = Math.pow(zoom, t - 1);
      const a = -hW + twist * (1 - t);
      pts.push({ vx: r * Math.cos(a), vy: r * Math.sin(a) });
    }
    return [pts];   // closePath returns to the first outer point
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
  //   swirl/shift/offset handle positions (screen px)
  //   halfWedge, sliceRotationRad, isFullCircle
  drawOverlay(env, ctx, geom) {
    const { state } = env;
    const { w, h, imgX, imgY, imgW, imgH, cx, cy, sourceAspect, IS_TOUCH, strokeScale = 1 } = geom;
    // segments (arm count) locked → suppress the "grab & pull" grippy so the seam doesn't read as
    // draggable (the structural seam LINE / rotation tell stays). Matches the overlay's spoke gate.
    const segLocked = !!env.isLocked?.('segments')?.locked;

    // annulus radii in source-UV space, then mapped to screen pixels.
    // mirrors the engine's toSourceUV aspect correction (the smaller image
    // dimension wins — fold-radius 1 lands at image-pixel-radius
    // 0.5 × sliceScale × min(imgW, imgH)).
    const halfMinPx = 0.5 * Math.min(imgW, imgH);
    // ⚠️ formSizeNorm BELONGS HERE and was missing until B614. This bespoke overlay was written
    // before per-form size normalisation existed (B477) and the comment above still describes the
    // pre-B477 mirror. The shader uses `u_sliceFactor = sliceScale × sizeNorm`, so without it the
    // annulus drawn here is wrong by exactly the norm — which is why the ?tune=forms sizeNorm
    // slider appeared to do nothing to droste's overlay (Daniel, B613) and he had to derive
    // droste's value through sliceScale instead. Every sliceScale consumer must apply the norm.
    const rOut = state.sliceScale * formSizeNorm(state) * halfMinPx;
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

    // Negate sliceRotation here to bring Droste's overlay-drawing convention
    // into alignment with the polygon overlay forms post-Build 61. Polygon
    // forms have a Y-flip baked into sliceVecToSourceUV; Droste computes its
    // own positions via cos/sin in screen y-down. Negating the input angle is
    // mathematically equivalent to Y-flipping the wedge graphic (cos(-θ)=cos(θ),
    // sin(-θ)=-sin(θ) — flips the y component). Without this, the rotate-drag
    // delta inversion from Build 61 makes the Droste wedge rotate opposite to
    // cursor direction.
    // ⚠️ B635 — DROSTE MIRRORS THROUGH ITS ANGLES, because it is the one form that does not draw
    // itself through `sliceVecToSourceUV`. Every other form's overlay is the polygon transformed by
    // that shared function, so the handedness flip arrives for free; droste builds its annulus from
    // cos/sin in screen space and would silently keep drawing the UNMIRRORED wedge — the overlay
    // then disagrees with the render, which is the exact failure the fold exists to remove.
    //
    // A reflection of the plane about the slice origin is an angle map. Working it out per case:
    //   (+1,+1) → a        (−1,+1) → π − a        (+1,−1) → −a        (−1,−1) → a + π
    // which is one expression: **a → det·a + φ**, det = mx·my, φ = π when mx < 0. Because the
    // annulus is centred on the origin, radii are untouched — so folding the map into the two
    // angular quantities everything else is derived from (the wedge centre and the twist) mirrors
    // the whole drawing, the OOB probe, the seams and the hit-test geometry in one place.
    const { mx: sMX, my: sMY } = sliceMirror(state);
    const mirrorDet = sMX * sMY;
    const mirrorPhase = sMX < 0 ? Math.PI : 0;
    const seamPhaseRad = mirrorDet * (-state.sliceRotation * Math.PI / 180) + mirrorPhase;
    // Source-theta shift across one tier under generalized Lenstra:
    // theta_src = θ_canvas + b·logr, so at canvas inner (logr = −logS) the
    // shift relative to canvas outer is −b·logS = spiral·logS²/(2π).
    // twistRad is the OOB-probe shift parameter; the probe uses (a − twistRad)
    // for inner-ring points, so twistRad = −shift (negated). For positive
    // spiral, twistRad < 0 — the inner-ring probes sweep in the +θ direction
    // (matching the actual sample region).
    const _logSv = Math.log(Math.max(1.0001, state.drosteZoom));
    // twist is a RELATIVE angle, so it takes the reflection's sign (det) and none of its phase.
    const twistRad = mirrorDet * -(state.drosteSpiral || 0) * _logSv * _logSv / (2 * Math.PI);
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
      // primary ring outline ALWAYS solid white (matches the polygon forms' M4 restyle) — the
      // off-source crossing is shown by the dashed EDGE SEAM below, not by dashing the whole ring.
      ctx.strokeStyle = highlighted ? 'rgba(255, 255, 255, 1.0)' : 'rgba(255, 255, 255, 0.9)';
      ctx.setLineDash([]);
      ctx.lineWidth = (highlighted ? 2.5 : 1.5) * strokeScale;
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

    // EDGE SEAM (droste) — dashed white line where the sampled annulus's OUTER ring crosses a source
    // edge (the fold reflects/clips there). Same language as the polygon forms; sampled from the arc.
    // (Scale-handle hit-testing on this seam is the immediate follow-up, mirroring polygons B450→B451.)
    const drosteSeams = [];   // {p0,p1} screen segments → stashed in _geom so classifyPointer scales on them
    if (oobOut) {
      // sample the FULL sampled-region boundary (not just the outer arc) so the seam + reflection
      // also render where the straight WEDGE SIDES cross a source edge (Daniel: more segments → more
      // straight edge → missed). Closed loop [outer arc, inner arc]; the connecting segments ARE the
      // two sides. arms=1 is just the outer ring.
      const N = 40, arc = [];
      if (isFullCircle) {
        for (let i = 0; i <= N; i++) { const a = (i / N) * Math.PI * 2; arc.push({ x: cx + rOut * Math.cos(a), y: cy + rOut * Math.sin(a) }); }
      } else {
        for (let i = 0; i <= N; i++) { const a = wedgeStart + (i / N) * (wedgeEnd - wedgeStart); arc.push({ x: cx + rOut * Math.cos(a), y: cy + rOut * Math.sin(a) }); }
        for (let i = 0; i <= N; i++) { const a = wedgeEnd   + (i / N) * (wedgeStart - wedgeEnd); arc.push({ x: cx + rIn  * Math.cos(a), y: cy + rIn  * Math.sin(a) }); }
      }
      const seamEdges = [
        { axis: 'x', at: imgX,        lo: imgY, hi: imgY + imgH },
        { axis: 'x', at: imgX + imgW, lo: imgY, hi: imgY + imgH },
        { axis: 'y', at: imgY,        lo: imgX, hi: imgX + imgW },
        { axis: 'y', at: imgY + imgH, lo: imgX, hi: imgX + imgW },
      ];
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5 * strokeScale;
      for (const e of seamEdges) {
        const hits = [];
        for (let i = 0; i < arc.length; i++) {
          const p = arc[i], q = arc[(i + 1) % arc.length];   // closed loop → the sides are segments too
          const pv = e.axis === 'x' ? p.x : p.y, qv = e.axis === 'x' ? q.x : q.y;
          if ((pv - e.at) * (qv - e.at) < 0) {
            const t = (e.at - pv) / (qv - pv);
            hits.push(e.axis === 'x' ? p.y + t * (q.y - p.y) : p.x + t * (q.x - p.x));
          }
        }
        // ⚠️ B640 — THE REFLECTION IS GATED ON BEING OUTSIDE, THE SEAM ON CROSSING. They are not
        // the same test, and conflating them is Daniel's bug: *"if i push it entirely across a
        // canvas edge but keep the origin over the source, the reflection doesn't render at all."*
        //
        // Exactly right, and the reason is that `hits` counts boundary CROSSINGS. Once the sampled
        // wedge is wholly past an edge there are none — nothing straddles the line any more — so
        // the old `continue` skipped the reflection precisely when the reflection is the only thing
        // left to see. The seam line genuinely needs crossings (it is drawn along the crossing
        // span); the reflection only needs "is any of it beyond this edge", which is a point test.
        //
        // The polygon forms never had this bug because they test their vertices directly
        // (`u < 0`, `u > 1`), which stays true when the whole shape is outside.
        const beyond = arc.some((p) => (e.axis === 'x'
          ? (e.at === imgX ? p.x < e.at : p.x > e.at)
          : (e.at === imgY ? p.y < e.at : p.y > e.at)));
        // REFLECTION — mirror the sampled annulus across this edge (where the kaleidoscope
        // ACTUALLY pulls color in mirror mode). Faint amber + dashed, clipped to the source rect —
        // the same "reflected region" language the polygon forms use.
        if (beyond && state.oobMode === 1) {
          ctx.save();
          ctx.beginPath(); ctx.rect(imgX, imgY, imgW, imgH); ctx.clip();
          if (e.axis === 'x') { ctx.translate(2 * e.at, 0); ctx.scale(-1, 1); }
          else                { ctx.translate(0, 2 * e.at); ctx.scale(1, -1); }
          ctx.beginPath();
          if (isFullCircle) { ctx.arc(cx, cy, rOut, 0, Math.PI * 2); ctx.arc(cx, cy, rIn, 0, Math.PI * 2, true); }
          else { ctx.arc(cx, cy, rOut, wedgeStart, wedgeEnd, false); ctx.arc(cx, cy, rIn, wedgeEnd, wedgeStart, true); ctx.closePath(); }
          ctx.fillStyle = 'rgba(255, 196, 80, 0.10)'; ctx.fill('evenodd');
          ctx.strokeStyle = 'rgba(255, 196, 80, 0.6)'; ctx.setLineDash([6, 4]); ctx.lineWidth = 1 * strokeScale; ctx.stroke();
          // B636 — the reflected ORIGIN. It matters most here of all the forms: droste's origin sits
          // at the middle of the annulus, well away from the wedge you are holding, so it is the
          // copy of the origin that tells you which reflection is about to become primary. Drawn
          // inside the same mirror transform, so it lands wherever the reflected annulus centres.
          ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(cx, cy, 3 * strokeScale, 0, TAU);   // matches the primary dot (B639)
          ctx.fillStyle = 'rgba(255, 196, 80, 0.85)'; ctx.fill();
          ctx.restore();
        }
        if (hits.length < 2) continue;   // no crossing = no seam SPAN to draw (the reflection above still drew)
        const lo = Math.max(e.lo, Math.min(...hits)), hi = Math.min(e.hi, Math.max(...hits));
        if (hi <= lo) continue;
        const p0 = e.axis === 'x' ? { x: e.at, y: lo } : { x: lo, y: e.at };
        const p1 = e.axis === 'x' ? { x: e.at, y: hi } : { x: hi, y: e.at };
        drosteSeams.push({ p0, p1 });
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      }
      ctx.restore();
    }

    // wedge sides — radial line segments at the wedge boundaries connecting
    // the inner and outer arcs. only drawn for arms > 1 (full circle has no
    // angular boundary). dashed amber when OOB, white otherwise.
    if (!isFullCircle) {
      const sideHL = ringHL;  // sides highlight with the rest of the ring outline
      ctx.strokeStyle = sideHL ? 'rgba(255, 255, 255, 1.0)' : 'rgba(255, 255, 255, 0.9)';   // always solid white (M4 restyle)
      ctx.lineWidth = (sideHL ? 2.5 : 1.5) * strokeScale;
      ctx.setLineDash([]);
      for (const a of [wedgeStart, wedgeEnd]) {
        ctx.beginPath();
        ctx.moveTo(cx + rIn  * Math.cos(a), cy + rIn  * Math.sin(a));
        ctx.lineTo(cx + rOut * Math.cos(a), cy + rOut * Math.sin(a));
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Spiral preview — show how a canvas-radial line twists in source space.
    // For a canvas pixel at (r, θ_canvas), source theta_src = θ_canvas + b·logr
    // where b = -spiral·logS/(2π). Trace a curve in source-overlay coords from
    // the source outer ring (at θ_canvas at canvas outer = source outer) inward
    // to the source inner ring (where source theta has shifted by b·(−logS)).
    //
    // At arms=1, draw a single curve at θ_canvas=0 (the wedge "center" direction)
    // showing the spiral arm structure. At arms ≥ 2, draw two curves at the
    // wedge boundaries (θ_canvas = ±halfWedge) showing how the wedge tilts
    // toward the spiral's twist direction — content beyond these curves at the
    // inner ring is what gets sampled past the canonical wedge.
    const spiral = state.drosteSpiral || 0;
    if (Math.abs(spiral) > 0.005) {
      const logS = Math.log(Math.max(1.0001, state.drosteZoom));
      const b = -spiral * logS / (2 * Math.PI);
      const SEAM_STEPS = 80;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';   // always solid white (M4 restyle); seam marks OOB
      ctx.lineWidth = 1.5 * strokeScale;
      ctx.setLineDash([]);

      const drawCurve = (thetaCanvas) => {
        ctx.beginPath();
        for (let i = 0; i <= SEAM_STEPS; i++) {
          const t = i / SEAM_STEPS;            // 0 at outer, 1 at inner
          const screen_r = rOut * Math.pow(state.drosteZoom, -t);  // rOut → rIn
          const logr_canvas = -t * logS;                            // 0 → -logS
          const theta_rel = thetaCanvas + b * logr_canvas;
          const a = seamPhaseRad + mirrorDet * theta_rel;   // relative angle → takes the reflection's sign (B635)
          const px = cx + screen_r * Math.cos(a);
          const py = cy + screen_r * Math.sin(a);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      };

      if (isFullCircle) {
        drawCurve(0);
      } else {
        drawCurve(+halfWedge);
        drawCurve(-halfWedge);
      }

      ctx.setLineDash([]);
    }

    // SEAM DIVIDER (arms = 1): the one angular landmark on a full-circle
    // annulus — the rotation TELL (it turns with sliceRotation; without it a
    // spiral-less ring is rotation-invariant on screen) and the segment-count
    // affordance (classifyPointer returns droste-arms along it: grab and pull
    // it around the ring to fold the circle into arms). With spiral active the
    // seam IS the spiral curve above; without, a straight radial line. The
    // double-line grippy rides the seam's middle (radial's spoke idiom).
    if (isFullCircle) {
      const seamHL = env.hoverMode === 'droste-arms' || env.overlayDragMode === 'droste-arms';
      if (Math.abs(spiral) <= 0.005) {
        ctx.strokeStyle = oobOut
          ? 'rgba(255, 196, 80, 0.7)'
          : `rgba(255, 255, 255, ${seamHL ? 1.0 : 0.7})`;
        ctx.lineWidth = (seamHL ? 2.5 : 1.5) * strokeScale;
        ctx.beginPath();
        ctx.moveTo(cx + rIn * Math.cos(seamPhaseRad), cy + rIn * Math.sin(seamPhaseRad));
        ctx.lineTo(cx + rOut * Math.cos(seamPhaseRad), cy + rOut * Math.sin(seamPhaseRad));
        ctx.stroke();
      }
      if (!segLocked) {
        const ux = Math.cos(seamPhaseRad), uy = Math.sin(seamPhaseRad);
        const perpX = -uy, perpY = ux;
        const GAP = 2.5;
        const t0 = rIn + (rOut - rIn) * 0.25;
        const t1 = rIn + (rOut - rIn) * 0.75;
        ctx.lineWidth = (seamHL ? 2 : 1) * strokeScale;
        ctx.strokeStyle = `rgba(255, 255, 255, ${seamHL ? 0.9 : 0.4})`;
        for (const sign of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(cx + ux * t0 + perpX * GAP * sign, cy + uy * t0 + perpY * GAP * sign);
          ctx.lineTo(cx + ux * t1 + perpX * GAP * sign, cy + uy * t1 + perpY * GAP * sign);
          ctx.stroke();
        }
      }
    }

    // center dot. Radius scales with strokeScale (B639) so it survives the companion video render,
    // where every other line is multiplied up to read at 1920².
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, 3 * strokeScale, 0, TAU);
    ctx.fill();

    // direct-manipulation handle: offset (filled blue diamond). Drives the
    // combined center-offset effect — Möbius pre-comp + source-side per-tier
    // drift. (Build 57 merged the shift dot into the offset diamond.)
    const cosRot = Math.cos(seamPhaseRad), sinRot = Math.sin(seamPhaseRad);
    // Offset diamond position: independent of sliceRotation. The diamond
    // represents the spiral-pole canvas-NDC position. User drags diamond to
    // overlay-screen position (cx+dx, cy+dy); pole appears at canvas-screen
    // position with the same direction. Y-flip translates screen y-down to
    // canvas-NDC y-up (drosteOffset is in canvas-NDC fold-space).

    // offset diamond.
    // B635 — the diamond is a POSITION on the overlay, so it reflects with everything else. Its
    // drag branch (overlay.js 'droste-offset') multiplies by the same signs to invert this, which
    // is why they ride in _geom rather than being recomputed there.
    const ox = state.drosteOffsetX || 0;
    const oy = state.drosteOffsetY || 0;
    const offsetHandleX = cx + rOut * ox * sMX;
    const offsetHandleY = cy - rOut * oy * sMY;
    const offsetHL = env.hoverMode === 'droste-offset' || env.overlayDragMode === 'droste-offset';
    const offsetDiamondR = offsetHL ? 7 : 5;
    ctx.fillStyle = oobOut ? 'rgba(255, 196, 80, 1)' : '#ffffff';   /* white (was light-blue #aadcff) — tidier; distinct from the center dot by SHAPE; amber when OOB */
    ctx.beginPath();
    ctx.moveTo(offsetHandleX, offsetHandleY - offsetDiamondR);
    ctx.lineTo(offsetHandleX + offsetDiamondR, offsetHandleY);
    ctx.lineTo(offsetHandleX, offsetHandleY + offsetDiamondR);
    ctx.lineTo(offsetHandleX - offsetDiamondR, offsetHandleY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
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
      // (no boundary exists at arms=1). Suppressed when segments is locked
      // (the arms grab is inert — matches the arms=1 seam grippy gate above).
      if (!isFullCircle && !segLocked) {
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
      offsetHandleX, offsetHandleY,
      halfWedge,
      sliceRotationRad: seamPhaseRad,
      isFullCircle,
      seams: drosteSeams,
      mx: sMX, my: sMY,   // B635 — for the offset-handle drag, the only hit path that has to un-mirror
    };
  },

  // ---------------------------------------------------------------------------
  // hit testing — bespoke, replaces classifyPointer
  // ---------------------------------------------------------------------------
  //
  // mode priorities (highest wins):
  //   1. offset handle (diamond)               → 'droste-offset' (combined effect)
  //   2. ring bands WITHIN the wedge angular range:
  //        a. inner-ring band                  → 'scale' handle='inner' (drosteZoom)
  //        b. outer-ring band                  → 'scale' handle='outer' (sliceScale)
  //   3. wedge boundary line (arms ≥ 2)        → 'droste-arms'
  //   4. inside the inner ring (r ≤ rIn)       → 'move' (regardless of wedge angular)
  //   5. inside wedge AND inside outer ring    → 'move'
  //   6. fall-through                          → 'rotate'
  // (Build 55: seam-endpoint 'twist' removed. Build 56: swirl handle removed.
  //  Build 57: shift dot merged into offset diamond.)
  //
  // band widths follow daniel's "~16 px total, only a few inside the wedge"
  // rule: BAND_IN (in the annulus body, between the rings) is intentionally
  // small so most of the wedge interior is 'move'; BAND_OUT (outside the
  // annulus, into the inner-disc or beyond the outer ring) is larger because
  // those areas are where users naturally grab the ring boundaries.
  classifyPointer(env, x, y, isTouch, geom) {
    const g = env.sourceOverlayCanvas?._geom;
    if (!g) return { mode: null };
    const { cx, cy, rOut, rIn,
            offsetHandleX, offsetHandleY,
            halfWedge, sliceRotationRad, isFullCircle } = g;

    const dx = x - cx, dy = y - cy;
    const r = Math.hypot(dx, dy);
    const theta = Math.atan2(dy, dx);

    const OFFSET_HIT     = isTouch ? 18 : 11;   // diamond (single combined handle)
    const BAND_OUT       = isTouch ? 14 : 12;   // outside the annulus (toward inner-disc or beyond outer)
    const BAND_IN        = isTouch ?  8 :  6;   // inside the annulus body — leaves room for 'move' interior
    const SIDE_BAND_OUT  = isTouch ? 14 : 12;   // outside the wedge angularly
    const SIDE_BAND_IN   = isTouch ?  8 :  6;   // inside the wedge angularly

    // 1. offset handle — diamond (the single combined center-offset control).
    if (offsetHandleX != null) {
      const d = Math.hypot(x - offsetHandleX, y - offsetHandleY);
      if (d <= OFFSET_HIT) {
        return { mode: 'droste-offset', r, theta, R: 0 };
      }
    }

    // EDGE-SEAM scale: when the annulus crosses the source edge, its outer ring is off-source/
    // unreachable — a drag on the dashed edge seam scales instead (like the polygon forms). Returns
    // the OUTER-ring scale (→ the sliceScale ratio-drag). Priority near the seam.
    if (g.seams && g.seams.length) {
      const SEAM_BAND = isTouch ? 24 : 16;
      for (const s of g.seams) {
        const ex = s.p1.x - s.p0.x, ey = s.p1.y - s.p0.y;
        const elen = Math.hypot(ex, ey) || 1;
        const ux = ex / elen, uy = ey / elen;
        const projT = (x - s.p0.x) * ux + (y - s.p0.y) * uy;
        if (projT < -SEAM_BAND || projT > elen + SEAM_BAND) continue;
        const perp = Math.abs((x - s.p0.x) * (-uy) + (y - s.p0.y) * ux);
        if (perp <= SEAM_BAND) return { mode: 'scale', r, theta, R: rOut, handle: 'outer', cursorTheta: theta };
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

    // 3b. the SEAM DIVIDER (arms = 1): the segment-count affordance on a full
    // circle — a radial band along the seam line. The drag handler measures
    // the new half-wedge from drag.sliceRotationRad; a seam grab flags
    // seamGrab so the drag start flips that reference by π (the seam is the
    // wedge CENTER, not a boundary — the grab then starts at arms 1 and folds
    // upward as you pull away around the ring).
    if (isFullCircle) {
      const ux = Math.cos(sliceRotationRad), uy = Math.sin(sliceRotationRad);
      const along = dx * ux + dy * uy;
      const perp = Math.abs(dx * (-uy) + dy * ux);
      const allowance = isTouch ? 14 : 10;
      if (along >= rIn - SIDE_BAND_OUT && along <= rOut + SIDE_BAND_OUT && perp <= allowance) {
        return {
          mode: 'droste-arms',
          r, theta, R: along,
          cursorTheta: sliceRotationRad + Math.PI / 2,
          seamGrab: true,
        };
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

  // filename suffix: zoom + spiral + arms + mirror + offset.
  // e.g. z200q100a01m1                  = zoom 2.00, spiral 1.00 tiers/turn, arms 1, mirror on
  //      z200q050a02m0                  = zoom 2.00, spiral 0.50, arms 2, mirror off
  //      z200q000a02m1ox030y000         = + combined center offset (0.30, 0)
  filenameSuffix(state) {
    const z = Math.round(state.drosteZoom * 100);
    const spiral100 = Math.round((state.drosteSpiral || 0) * 100);
    const arms = Math.max(1, Math.min(12, Math.round(state.drosteArms || 1)));
    const mirror = state.drosteMirror ? 1 : 0;
    let suffix = 'z' + z
      + 'q' + String(spiral100).padStart(3, '0')
      + 'a' + String(arms).padStart(2, '0')
      + 'm' + mirror;
    const enc = (v) => (v < 0 ? 'm' : '') + String(Math.abs(Math.round(v * 100))).padStart(3, '0');
    const ox = state.drosteOffsetX || 0, oy = state.drosteOffsetY || 0;
    if (Math.abs(ox) > 0.005 || Math.abs(oy) > 0.005) {
      suffix += 'ox' + enc(ox) + 'y' + enc(oy);
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
