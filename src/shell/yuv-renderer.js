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

export function createYuvRenderer(canvasEl) {
  // preserveDrawingBuffer so the freeze-frame `drawImage(canvas)` (which runs OUTSIDE
  // the render loop) reads real pixels instead of a cleared buffer. (desynchronized
  // dropped — it can leave the canvas unreadable for out-of-loop drawImage.)
  const gl = canvasEl.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
  const blitter = createYuvBlitter(gl, { flipY: false });   // canvas target: row 0 at the top

  // `frame` is the parsed wire frame; vw/vh are the canvas size, which may be smaller
  // than the frame (the source-detail cap) — the viewport scales, the planes don't crop.
  function draw(frame, vw, vh, mirror) {
    blitter.draw(frame, vw, vh, mirror);
  }
  return { draw };
}
