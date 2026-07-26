// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// components/output-gestures.js
//
// Multi-touch gestures on the OUTPUT (kaleidoscope) canvas. TWO fingers carry the
// full manipulation at once — pinch = zoom, twist = canvasRotation, and centroid
// travel = tiling pan (on tileable forms) — the standard Maps/Photos gesture. ONE
// finger is intentionally reserved (falls through to overlay/segment handlers, and
// is free for a future single-finger rotate). Thin input over shared state, mounted
// by both chromes so the mobile OUTPUT region reuses the exact same gesture math.
//
//   createOutputGestures(canvas, {
//     state,           // shared state object (canvasZoom / canvasRotation / canvasOffset*)
//     onChange,        // () => void  after a gesture updates state (render + sync)
//     onCommitStart,   // () => void  gesture start (undo push) — optional
//     onCommitEnd,     // () => void  gesture end (undo UI) — optional
//     editLocked,      // () => bool  read-only while playback/scrub drives state — optional
//     panPeriod,       // () => [px,py]|null  lattice period → tileable form (enables pan) — optional
//     panDrift,        // () => { on, stop, set } drift API for flick-to-drift on release — optional
//   }) → { destroy() }

// UNIFIED ZOOM (Daniel): sliceScale is the PRIMARY zoom range; canvasZoom EXTENDS it. Zooming OUT
// grows the slice to full size FIRST, then dials canvasZoom below 1× (more reach/repeats); zooming IN
// reverses — canvasZoom back to 1×, then shrink the slice, then magnify past 1×. Fixes the trap where
// you bottom out canvasZoom while the slice still has headroom. Applied to the pinch + trackpad-zoom
// on NON-droste forms (droste's zoom is the already-unbounded looping infinite-zoom, no wall). Bounds
// are placeholders — Phase B normalizes sliceScale so ~1× = full source, the natural handoff point.
const Z_SLICE_MIN = 0.05, Z_SLICE_MAX = 5, Z_CANVAS_MIN = 0.15, Z_CANVAS_MAX = 4;
function applyUnifiedZoom(state, factor) {
  let s = state.sliceScale, z = state.canvasZoom;
  if (factor >= 1) {                                          // ZOOM IN
    if (z < 1)                z = Math.min(1, z * factor);
    else if (s > Z_SLICE_MIN) s = Math.max(Z_SLICE_MIN, s / factor);
    else                      z = Math.min(Z_CANVAS_MAX, z * factor);
  } else {                                                    // ZOOM OUT
    if (z > 1)                z = Math.max(1, z * factor);
    else if (s < Z_SLICE_MAX) s = Math.min(Z_SLICE_MAX, s / factor);
    else                      z = Math.max(Z_CANVAS_MIN, z * factor);
  }
  state.sliceScale = s;
  state.canvasZoom = z;
}

export function createOutputGestures(canvas, ctx) {
  const { state } = ctx;
  let manip = null;   // active two-finger manipulation (zoom + twist + centroid pan)

  // DROSTE INFINITE ZOOM: in droste, pinch drives the loop PHASE (drosteZoomPhase),
  // not canvasZoom — so it circles endlessly instead of hitting the [0.15,4] wall. A
  // multiplicative zoom by one factor of the loop period (drosteZoom, ×2 with mirror)
  // = exactly one loop, so map the zoom ratio into phase in log space: phase↑ = zoom
  // in (matches the shader `logr -= shift`). Twist still drives canvasRotation.
  const zoomIsPhase = () => state.form === 'droste';
  const loopLog = () => Math.log(Math.max(1.0001, state.drosteZoom)) * (state.drosteMirror ? 2 : 1);
  // phase is stored UNWRAPPED (continuous accumulator) — the shader wraps it, and the
  // perform follower / autoplay stay smooth with no wrap-blip.

  // canvasZoom/canvasRotation are animated params; while an animation drives the
  // state a gesture's write is clobbered next tick and would leak into the live
  // broadcast (the output bus renders state on its own loop). So go inert then.
  const locked = () => !!(ctx.editLocked && ctx.editLocked());

  // Map a desired CONTENT screen displacement → a canvasOffset delta so the content follows
  // the given screen vector. Folds in three sign/space facts, all of which must be undone:
  //   • Y flip: v_uv makes shader p.y point UP (shader-builder.js:63), but client Y points DOWN.
  //   • X-negation: u_canvasOffset negates X but not Y (shader-builder.js:43), so O maps to the
  //     sample coord as (+Ox, −Oy) — an axis reflection A = diag(1,−1).
  //   • Rotation: the offset is subtracted in the shader's POST-rotation space (:170 rotates p,
  //     :175 subtracts O), so the drag must be counter-rotated by the current canvas rotation.
  // Deriving δO = −A·M·f (f = content displacement in p-space, y-up) collapses to the below.
  // fx/fy are in CLIENT orientation (x right+, y DOWN+). Identity-free even at 0° (it negates),
  // which is why touch — never cleanly tested un-rotated before — read inverted.
  function panToOffset(fx, fy) {
    const r = state.canvasRotation * Math.PI / 180;
    const c = Math.cos(r), s = Math.sin(r);
    return [-c * fx - s * fy, s * fx - c * fy];
  }

  function onStart(e) {
    if (locked()) return;
    if (e.touches.length !== 2) return;    // one finger reserved (future rotate); ignore here
    ctx.onCommitStart?.();
    const t0 = e.touches[0], t1 = e.touches[1];
    const canPan = !!(ctx.panPeriod && ctx.panPeriod());
    if (canPan) ctx.panDrift?.()?.stop?.();          // grabbing takes control — stop any running drift
    const cx = (t0.clientX + t1.clientX) / 2, cy = (t0.clientY + t1.clientY) / 2;
    const startDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    manip = {
      startDist,
      prevDist:      startDist,   // incremental pinch-zoom (feeds applyUnifiedZoom on non-droste)
      startAngle:    Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX),
      startZoom:     state.canvasZoom,
      startPhase:    state.drosteZoomPhase || 0,
      startRotation: state.canvasRotation,
      canPan,
      cx0: cx, cy0: cy, ox: state.canvasOffsetX || 0, oy: state.canvasOffsetY || 0,
      vx: 0, vy: 0, lastCx: cx, lastCy: cy, lastT: performance.now(),
    };
    e.preventDefault();
  }

  function onMove(e) {
    if (!manip || e.touches.length !== 2) return;
    const t0 = e.touches[0], t1 = e.touches[1];
    const dist  = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    const angle = Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX);
    if (zoomIsPhase()) {
      state.drosteZoomPhase = manip.startPhase + Math.log(dist / manip.startDist) / loopLog();
    } else {
      applyUnifiedZoom(state, dist / manip.prevDist);   // slice-first-then-canvas (incremental)
      manip.prevDist = dist;
    }
    const da             = (angle - manip.startAngle) * 180 / Math.PI;
    state.canvasRotation = ((manip.startRotation + da) % 360 + 360) % 360;
    if (manip.canPan) {
      // centroid travel → tiling pan; content follows the two fingers' midpoint.
      const rect = canvas.getBoundingClientRect(), now = performance.now();
      const cx = (t0.clientX + t1.clientX) / 2, cy = (t0.clientY + t1.clientY) / 2;
      const [cdx, cdy] = panToOffset((cx - manip.cx0) / (rect.width / 2), (cy - manip.cy0) / (rect.height / 2));
      state.canvasOffsetX = manip.ox + cdx;
      state.canvasOffsetY = manip.oy + cdy;
      const dtms = now - manip.lastT;   // centroid velocity (same transform) → flick-to-drift on release
      if (dtms > 0) {
        const [vx, vy] = panToOffset((cx - manip.lastCx) / (rect.width / 2), (cy - manip.lastCy) / (rect.height / 2));
        manip.vx = vx / (dtms / 1000); manip.vy = vy / (dtms / 1000);
      }
      manip.lastCx = cx; manip.lastCy = cy; manip.lastT = now;
    }
    ctx.onChange?.();
    e.preventDefault();
  }

  function onEnd(e) {
    if (e.touches.length >= 2 || !manip) return;   // ends when we drop below two fingers
    ctx.onCommitEnd?.();
    if (manip.canPan) {
      // FLICK-TO-DRIFT: if drift mode is on, continue at the centroid's release velocity — a quick
      // swipe drifts fast; panning to a stop before lifting leaves ~0 velocity → no drift (Daniel).
      // Touch only; trackpad (wheel) keeps its native momentum coast.
      const pd = ctx.panDrift?.();
      if (pd?.on?.()) pd.set?.(manip.vx || 0, manip.vy || 0);
    }
    manip = null;
  }

  // Trackpad pinch-to-zoom the OUTPUT. macOS delivers a trackpad pinch as wheel +
  // ctrlKey (no multi-touch on a Mac), so this is the desktop/Electron pinch path
  // (rotate isn't exposed there — Safari-gesture-only). One undo entry per burst.
  let wheelTimer = 0;
  function onWheel(e) {
    if (locked()) return;
    if (!e.ctrlKey) {
      // NON-ctrl wheel = a trackpad TWO-FINGER scroll/drag → tiling pan (desktop/Electron
      // have no touch, so this is their pan gesture). Tileable forms only.
      if (!(ctx.panPeriod && ctx.panPeriod())) return;
      e.preventDefault();
      if (!wheelTimer) { ctx.onCommitStart?.(); ctx.panDrift?.()?.stop?.(); }   // start of scroll takes control
      const rect = canvas.getBoundingClientRect();
      // Natural-scroll trackpad: a two-finger scroll delta is the NEGATED finger travel, so the
      // fingers' content displacement is (−deltaX, −deltaY). Same transform → content follows the
      // fingers at any rotation. At 0° this reduces to (+deltaX, +deltaY) — the confirmed behavior.
      const [cdx, cdy] = panToOffset(-e.deltaX / (rect.width / 2), -e.deltaY / (rect.height / 2));
      state.canvasOffsetX += cdx;
      state.canvasOffsetY += cdy;
      ctx.onChange?.();
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => { wheelTimer = 0; ctx.onCommitEnd?.(); }, 250);
      return;
    }
    e.preventDefault();
    if (!wheelTimer) ctx.onCommitStart?.();
    const factor = Math.exp(-e.deltaY * 0.01);
    if (zoomIsPhase()) {
      state.drosteZoomPhase = (state.drosteZoomPhase || 0) + Math.log(factor) / loopLog();
    } else {
      applyUnifiedZoom(state, factor);   // slice-first-then-canvas
    }
    ctx.onChange?.();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { wheelTimer = 0; ctx.onCommitEnd?.(); }, 250);
  }

  canvas.addEventListener('touchstart', onStart, { passive: false });
  canvas.addEventListener('touchmove', onMove, { passive: false });
  canvas.addEventListener('touchend', onEnd);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return {
    destroy() {
      canvas.removeEventListener('touchstart', onStart);
      canvas.removeEventListener('touchmove', onMove);
      canvas.removeEventListener('touchend', onEnd);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}
