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

import { applyUnifiedZoom } from '../kit/zoom.js';   // shared: EVERY zoom entry point routes through this
import { panToOffset } from '../kit/pan.js';         // shared: EVERY pan entry point routes through this
import { formCanvasNorm } from '../engine/forms/index.js';   // the shader's effective zoom includes it

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

  // Map a desired CONTENT screen displacement → a canvasOffset delta so content follows the
  // finger. The transform (rotation + X-negation + Y-flip) lives in kit/pan.js so the remote
  // gesture surface (input-bus) pans identically; here we just pass the current canvas rotation.
  const pan = (fx, fy) => panToOffset(fx, fy, state.canvasRotation);

  // PAN GAIN — derived from the shader, not tuned by feel.
  //
  // `u_canvasOffset` is subtracted AFTER `p /= u_canvasZoom` (shader-builder), so one offset
  // unit moves content on screen IN PROPORTION TO THE ZOOM. A constant gain therefore
  // accelerates as you zoom in and crawls as you zoom out. Daniel measured exactly that on
  // iPad: content crossed the whole canvas on ~60% of a finger sweep at 1×, and on ~20% at
  // 2.48× — a 3× error for a 2.48× zoom change, which is the signature of a missing 1/zoom.
  //
  // Solving the shader's transform for "content stays under the finger":
  //   δp = 2·(pixels)/H/Z   (p-space is isotropic in PIXELS — that is what the aspect
  //                          correction buys), while fx/fy are normalized by half-WIDTH and
  //                          half-HEIGHT respectively — so x carries the aspect and y does not.
  //   → gain_x = aspect/Z        gain_y = 1/Z
  //
  // The old flat 3.5 was a feel-fudge marked TUNE; it could only ever be right at one zoom.
  // NOTE: during a simultaneous pinch+pan the accumulated travel is scaled by the CURRENT
  // zoom rather than integrated across the gesture, so content can drift slightly under the
  // fingers while both change at once. Exact anchoring needs a content-space centroid; the
  // pinch itself is unaffected and reads correct (Daniel).
  // The REMOTE gesture surface has its own reference frame (the phone's screen, not this
  // canvas) and its own gain in input-bus.js — deliberately not changed from here.
  const panGain = (rect) => {
    const z = Math.max(1e-4, state.canvasZoom * formCanvasNorm(state));
    return [(rect.height > 0 ? rect.width / rect.height : 1) / z, 1 / z];
  };

  function onStart(e) {
    if (locked()) return;
    if (e.touches.length !== 2) return;    // one finger reserved (future rotate); ignore here
    ctx.onCommitStart?.();
    const t0 = e.touches[0], t1 = e.touches[1];
    const canPan = !!(ctx.panDrivable ? ctx.panDrivable() : (ctx.panPeriod && ctx.panPeriod()));
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
      const [gx, gy] = panGain(rect);
      const [cdx, cdy] = pan(gx * (cx - manip.cx0) / (rect.width / 2), gy * (cy - manip.cy0) / (rect.height / 2));
      state.canvasOffsetX = manip.ox + cdx;
      state.canvasOffsetY = manip.oy + cdy;
      const dtms = now - manip.lastT;   // centroid velocity (same transform) → flick-to-drift on release
      if (dtms > 0) {
        const [vx, vy] = pan(gx * (cx - manip.lastCx) / (rect.width / 2), gy * (cy - manip.lastCy) / (rect.height / 2));
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
      if (!(ctx.panDrivable ? ctx.panDrivable() : (ctx.panPeriod && ctx.panPeriod()))) return;
      e.preventDefault();
      if (!wheelTimer) { ctx.onCommitStart?.(); ctx.panDrift?.()?.stop?.(); }   // start of scroll takes control
      const rect = canvas.getBoundingClientRect();
      // Natural-scroll trackpad: a two-finger scroll delta is the NEGATED finger travel, so the
      // fingers' content displacement is (−deltaX, −deltaY). Same transform → content follows the
      // fingers at any rotation. At 0° this reduces to (+deltaX, +deltaY) — the confirmed behavior.
      // Same missing-1/zoom defect as the touch path above, so the /z is applied here too.
      // The BASE gain is deliberately left alone: wheel deltas arrive OS-accelerated by an
      // unknown factor, so there is no derivable "correct" constant the way there is for raw
      // touch. That makes this a NO-OP at 1× and a fix only where pan was already wrong —
      // the zoomed-in runaway and the zoomed-out crawl.
      const wz = Math.max(1e-4, state.canvasZoom * formCanvasNorm(state));
      const [cdx, cdy] = pan(-e.deltaX / (rect.width / 2) / wz, -e.deltaY / (rect.height / 2) / wz);
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
