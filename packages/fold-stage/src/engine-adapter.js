// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// stage/engine-adapter.js
//
// THE CONTRACT between the engine-agnostic stage layer (output bus + sinks, and
// later the Electron shell + Syphon bridge) and whatever engine it renders. This
// is the ENTIRE coupling surface: the stage knows nothing about kaleidoscopes,
// only this shape. Fold's implementation is src/shell/fold-adapter.js; a future
// tenant (a gesture-traced light source, a zoetrope builder, an audio-reactive
// viz) supplies its own adapter and reuses the stage verbatim.
//
// Two tiers, so a simple engine isn't forced to implement what it can't:
//
//   UNIVERSAL tier (every engine):
//     engineId: string                       — short identifier for op records
//     renderFrameAt(w, h) -> Promise<Frame>   — render ONE frame at w×h, return
//                                               its raw pixels. Reads the engine's
//                                               LIVE state, so manipulating the
//                                               engine updates the output for free.
//   With the universal tier the stage can drive Syphon, the output-only window,
//   record-to-disk, and the fps/op-record status. That is all most apps need.
//
//   PERFORM tier (engines with addressable state — Phase 2 consumes these):
//     getState() -> State                     — snapshot the current look
//     applyState(State)                        — set the live look (program bus)
//     tween(from, to, p) -> State              — interpolate two snapshots at p∈[0,1]
//   These enable program/preview, take/transition, and gesture-record. Fold
//   satisfies them richly (its single state object + kit/tween.js); a universal-
//   only app omits them and the perform features simply stay unavailable.
//
// @typedef {Object} Frame
// @property {Uint8Array} pixels  RGBA. Orientation is declared by `topDown`: the live
//                                output engine renders via drawImage→getImageData and
//                                yields TOP-DOWN (top-left screen order); the legacy FBO
//                                path (still/video export, the diagnostics benchmark)
//                                yields BOTTOM-UP. Sinks flip according to the flag.
// @property {number} w
// @property {number} h
// @property {boolean} [topDown]  true = top-left screen order (getImageData); absent or
//                                false = bottom-up WebGL FBO order. Threaded to sinks so
//                                each flips correctly (the recorder's Y-flip; Syphon's
//                                `flipped` flag across the native bridge).
// @property {HTMLCanvasElement} [canvas]  the 2D capture canvas already holding this
//                                frame top-down, when the producer has one — lets a
//                                canvas-consuming sink (the recorder) drawImage it
//                                straight in and skip a putImageData copy.
// @property {number} [renderMs]  GPU render time, if measured (for op records).
// @property {number} [readMs]    GPU→CPU readback time, if measured.
//
// @typedef {Object} EngineAdapter
// @property {string} engineId
// @property {(w:number, h:number) => Promise<Frame>} renderFrameAt
// @property {() => any} [getState]
// @property {(s:any) => void} [applyState]
// @property {(from:any, to:any, p:number) => any} [tween]

// Whether an adapter implements the perform tier — gates program/preview and
// transition features (Phase 2). The stage calls this instead of assuming.
export function hasPerformTier(adapter) {
  return !!adapter
    && typeof adapter.getState === 'function'
    && typeof adapter.applyState === 'function'
    && typeof adapter.tween === 'function';
}
