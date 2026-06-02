// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// components/source-overlay.js
//
// The source-overlay as a standalone, mountable component — mounted by BOTH
// chromes (desktop and mobile), parameterized, never forked. It owns the
// expensive, hard-won pieces (object-fit proportionality, polygon hit-testing,
// the move/scale/rotate/segments/square/droste/pinch gesture math) by wrapping
// the implementation in src/shell/overlay.js behind a clean lifecycle. The
// overlay implementation is unchanged: it already operates on a passed-in
// "view" object, so the component just constructs that view from the host's
// context and exposes mount/render/destroy.
//
// Interface:
//   createSourceOverlay({
//     state, engine,
//     getLiveVideo,     // () => HTMLVideoElement | null  (camera display)
//     syncControls,     // () => void   refresh control widgets after a gesture
//     scheduleRender,   // () => void   re-render the engine output
//     onCommitStart,    // () => void   drag start (undo push) — optional
//     onCommitEnd,      // () => void   drag end (undo UI) — optional
//   }) → { mount(container), render(), scheduleDraw(), get canvas, get view, destroy() }
//
// Touch-target sizing is handled inside overlay.js via a per-device
// matchMedia('(hover: none)') constant, so it is already correct in both
// chromes without threading an isTouch flag.

import { mountSourceView, drawSourceOverlay, makeOverlayDrawer } from '../shell/overlay.js';
import { applyArmsSnap, snapSpiralValue } from '../kit/snaps.js';

export function createSourceOverlay(ctx) {
  // Private view — the object the overlay implementation reads/writes. This
  // replaces the global desktop `env`: the component owns the overlay canvas,
  // hover/drag state, and the snap helpers (from Kit) rather than the chrome.
  const view = {
    state: ctx.state,
    engine: ctx.engine,
    get liveVideo() { return ctx.getLiveVideo ? ctx.getLiveVideo() : null; },

    fit: ctx.fit || 'contain',   // 'contain' (letterbox) | 'cover' (fill + crop)
    container: null,

    sourceOverlayCanvas: null,
    hoverMode: null,
    hoverOnSpoke: false,
    hoverHandle: null,
    overlayDragging: false,
    overlayDragMode: null,

    syncControls: ctx.syncControls || (() => {}),
    scheduleRender: ctx.scheduleRender || (() => {}),
    pushHistory: ctx.onCommitStart || undefined,
    updateUndoUI: ctx.onCommitEnd || undefined,

    // form-snap logic from Kit, bound to this view's state (overlay.js reaches
    // it as view.applyArmsSnap during droste-arms drags).
    applyArmsSnap: () => applyArmsSnap(view.state),
    snapDrosteSpiral: (v) => snapSpiralValue(view.state, v),

    scheduleOverlayDraw: null,
  };

  const drawer = makeOverlayDrawer(view);
  view.scheduleOverlayDraw = drawer.schedule;

  return {
    // mount the source view (image/live-video + overlay canvas + interaction)
    // into a container. Safe to call repeatedly (e.g. desktop slot swap) —
    // mountSourceView clears the container and re-binds listeners.
    mount(container) { view.container = container; mountSourceView(view, container); },

    render() { drawSourceOverlay(view); },
    scheduleDraw: drawer.schedule,

    // switch source display fit ('contain' | 'cover'). Re-mounts so the displayed
    // source's CSS fit + the overlay geometry update together.
    getFit() { return view.fit; },
    setFit(mode) {
      view.fit = mode;
      if (view.container) mountSourceView(view, view.container);
    },

    get canvas() { return view.sourceOverlayCanvas; },
    get view() { return view; },

    destroy() {
      // overlay.js tracks its window-level listeners via a module singleton and
      // replaces them on the next mount; clearing the container drops the
      // container-level listeners with the detached DOM.
      const parent = view.sourceOverlayCanvas?.parentElement;
      if (parent) parent.innerHTML = '';
      view.sourceOverlayCanvas = null;
    },
  };
}
