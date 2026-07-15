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
// Universal tier: renderFrameAt reads the COMMITTED program frame each frame
// (shell/program-frame.js — manual modes commit the live look on read, so dragging
// the wedge still updates the output for free; in automation modes it's the look
// the owning loop committed). It delegates to the output engine
// (shell/output-engine.js) — a hidden second engine that renders to a real GL canvas
// and pulls pixels with the fast drawImage→getImageData path (~9× faster than the
// FBO readPixels it replaced). The returned Frame is TOP-DOWN (getImageData order);
// sinks flip via its topDown flag.
//
// Perform tier (Phase 2 consumes these): Fold's single state object + kit/tween.js
// satisfy getState/applyState/tween richly, enabling program/preview + transitions
// when that work lands.

import { lerpState } from '../kit/tween.js';
import { createOutputEngine } from './output-engine.js';

export function createFoldAdapter(env) {
  const outputEngine = createOutputEngine(env);

  return {
    engineId: 'fold',

    // universal tier
    renderFrameAt(w, h) {
      // reads the committed program frame → manipulating Fold updates the output
      // with no extra wiring, and automation transients never leak into it
      return outputEngine.renderFrameAt(w, h);
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
