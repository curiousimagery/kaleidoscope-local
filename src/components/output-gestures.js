// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// components/output-gestures.js
//
// Two-finger gestures on the OUTPUT (kaleidoscope) canvas — pinch = canvasZoom,
// twist = canvasRotation. Thin input over shared state, mounted by both chromes.
// Extracted verbatim from the desktop preview-canvas handler so the mobile
// OUTPUT region reuses the exact same gesture math.
//
//   createOutputGestures(canvas, {
//     state,           // shared state object (canvasZoom / canvasRotation)
//     onChange,        // () => void  after a gesture updates state (render + sync)
//     onCommitStart,   // () => void  gesture start (undo push) — optional
//     onCommitEnd,     // () => void  gesture end (undo UI) — optional
//     editLocked,      // () => bool  read-only while playback/scrub drives state — optional
//   }) → { destroy() }

export function createOutputGestures(canvas, ctx) {
  const { state } = ctx;
  let pinch = null;

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

  function onStart(e) {
    if (locked()) return;
    if (e.touches.length === 2) {
      ctx.onCommitStart?.();
      const t0 = e.touches[0], t1 = e.touches[1];
      pinch = {
        startDist:     Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY),
        startAngle:    Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX),
        startZoom:     state.canvasZoom,
        startPhase:    state.drosteZoomPhase || 0,
        startRotation: state.canvasRotation,
      };
      e.preventDefault();
    }
  }

  function onMove(e) {
    if (!pinch || e.touches.length !== 2) return;
    const t0 = e.touches[0], t1 = e.touches[1];
    const dist  = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    const angle = Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX);
    if (zoomIsPhase()) {
      state.drosteZoomPhase = pinch.startPhase + Math.log(dist / pinch.startDist) / loopLog();
    } else {
      state.canvasZoom   = Math.max(0.15, Math.min(4, pinch.startZoom * (dist / pinch.startDist)));
    }
    const da             = (angle - pinch.startAngle) * 180 / Math.PI;
    state.canvasRotation = ((pinch.startRotation + da) % 360 + 360) % 360;
    ctx.onChange?.();
    e.preventDefault();
  }

  function onEnd(e) {
    if (e.touches.length < 2) { pinch = null; ctx.onCommitEnd?.(); }
  }

  // Trackpad pinch-to-zoom the OUTPUT. macOS delivers a trackpad pinch as wheel +
  // ctrlKey (no multi-touch on a Mac), so this is the desktop/Electron pinch path
  // (rotate isn't exposed there — Safari-gesture-only). One undo entry per burst.
  let wheelTimer = 0;
  function onWheel(e) {
    if (!e.ctrlKey) return;
    if (locked()) return;
    e.preventDefault();
    if (!wheelTimer) ctx.onCommitStart?.();
    const factor = Math.exp(-e.deltaY * 0.01);
    if (zoomIsPhase()) {
      state.drosteZoomPhase = (state.drosteZoomPhase || 0) + Math.log(factor) / loopLog();
    } else {
      state.canvasZoom = Math.max(0.15, Math.min(4, state.canvasZoom * factor));
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
