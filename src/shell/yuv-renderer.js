// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/yuv-renderer.js
//
// biplanar-YUV -> RGB into a CANVAS. A thin adapter over engine/yuv.js, which owns the
// blit itself (the engine needs the same conversion straight into its own source
// texture — see gl.js createPlanarUploader — and one implementation beats two).
//
// This canvas path is now a PREVIEW path: the source panel draws from it, and it is
// the fallback for any consumer that hasn't been moved onto the planar upload. The
// engine no longer samples it on the native-video path, because doing so cost a
// cross-context readback per frame (~20ms/megapixel on WebKit).

import { createYuvBlitter } from '../engine/yuv.js';
import { watchGLContext } from './gl-watch.js';

// ⚠️ B709 — THIS IS A **FIFTH** GL CONTEXT, AND UNTIL THIS BUILD NOTHING WATCHED IT.
//
// `grep "getContext('webgl"` finds exactly two creators in this codebase: `engine/gl.js` (the four
// engines B705 wired) and this file. **This one had no `webglcontextlost` handler at all** — which
// is worse than being unreported, because **without `preventDefault()` the browser drops the
// context permanently and no restore is ever offered.** Its loss was unrecoverable by construction.
//
// That is Daniel's blank source panel, and it is why B708 did not fix it. The reflections came back
// because the PREVIEW ENGINE is watched; the source panel's picture never did, because it is
// painted by this renderer onto the receiver's own canvas (`frameSource()`). Two different GL
// contexts, one recovered and one could not — which is exactly what he described:
// *"the source is lacking a picture... and the reflections are showing."*
//
// **And the counters could not have caught it.** `offered === taken` describes the ENGINE's plane
// reader, a different consumer entirely. This surface has never had a counter.
//
// Two instances exist: the video source panel (`native-frame-receiver.js`) and the camera source
// panel (`native-camera.js`). Both are fixed here rather than twice, for the reason `gl-watch.js`
// exists at all.
export function createYuvRenderer(canvasEl, { surface = 'yuv', mark = null } = {}) {
  // preserveDrawingBuffer so the freeze-frame `drawImage(canvas)` (which runs OUTSIDE
  // the render loop) reads real pixels instead of a cleared buffer. (desynchronized
  // dropped — it can leave the canvas unreadable for out-of-loop drawImage.)
  const gl = canvasEl.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
  let blitter = createYuvBlitter(gl, { flipY: false });   // canvas target: row 0 at the top
  let lastDraw = null;   // B709 — so a restore can repaint without waiting for a new frame

  watchGLContext({
    canvas: canvasEl,
    surface,
    mark,
    rebuild: () => { blitter = createYuvBlitter(gl, { flipY: false }); },
    glOf: () => gl,
    // ⚠️ REPAINT FROM THE HELD FRAME. Same lesson as B708: the recovery cannot wait for the next
    // frame, because a paused clip does not produce one. `lastDraw` is the argument list of the
    // most recent successful draw, which is all this surface needs to come back.
    onRestored: () => { if (lastDraw) { try { blitter.draw(...lastDraw); } catch { /* next frame */ } } },
  });

  // `frame` is the parsed wire frame; vw/vh are the canvas size, which may be smaller
  // than the frame (the source-detail cap) — the viewport scales, the planes don't crop.
  function draw(frame, vw, vh, mirror) {
    // Drawing into a lost context throws on every call. The caller paints from a render tick, so
    // that is an exception per frame for as long as the loss lasts — noisy, and it can take down
    // whatever called us. Hold instead; `onRestored` repaints.
    if (gl.isContextLost()) return;
    lastDraw = [frame, vw, vh, mirror];
    blitter.draw(frame, vw, vh, mirror);
  }
  // B761 — the input transform. The source panel is a PREVIEW of the same pixels the engine
  // converts, so it has to use the same description or the two disagree on screen.
  return { draw, setColor: (c) => blitter.setColor(c) };
}
