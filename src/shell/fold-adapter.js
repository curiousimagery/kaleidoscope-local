// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/fold-adapter.js
//
// Fold's implementation of the stage-layer engine-adapter contract
// (src/stage/engine-adapter.js) — the thin, Fold-specific wrapper that lets the
// engine-agnostic output bus drive Fold's engine. Lives in shell/ (not stage/) on
// purpose: the stage layer stays free of any kaleidoscope assumptions; THIS file
// is where Fold meets the contract. A second tenant writes its own adapter and
// reuses the whole stage layer unchanged.
//
// Universal tier: renderFrameAt reads the LIVE env.state each frame (so dragging
// the wedge updates the live output for free) and renders raw bottom-up RGBA from
// the engine's FBO path (engine.exportFrameRaw, reusing renderToFBO).
//
// Perform tier (Phase 2 consumes these): Fold's single state object + kit/tween.js
// satisfy getState/applyState/tween richly, enabling program/preview + transitions
// when that work lands.

import { lerpState } from '../kit/tween.js';

export function createFoldAdapter(env) {
  return {
    engineId: 'fold',

    // universal tier
    renderFrameAt(w, h) {
      // reads env.state live → manipulating Fold updates the output with no extra wiring
      return env.engine.exportFrameRaw(env.state, w, h);
    },

    // perform tier (Phase 2)
    getState() { return { ...env.state }; },
    applyState(snap) {
      Object.assign(env.state, snap);
      env.scheduleRender();
    },
    tween(from, to, p) { return lerpState(from, to, p); },
  };
}
