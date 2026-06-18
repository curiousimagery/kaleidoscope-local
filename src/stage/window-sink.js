// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// stage/window-sink.js
//
// The external-window output sink: a clean, chrome-free output surface you drag to a
// second display (or projector) and fullscreen. Fold's standalone output path — no
// Resolume/Arena required — and a universal one: it uses plain web APIs (window.open
// + a canvas), so it works on the web build AND in Electron (both Chromium-class),
// unlike Syphon (Electron/macOS only).
//
// The popup is same-origin (about:blank inherits our origin), so the opener draws
// straight into its canvas — no postMessage, no IPC. Frames arrive bottom-up RGBA
// (engine FBO order); we Y-flip into the canvas the same way the recorder does. The
// canvas is sized to the output resolution and CSS-scaled to fit the window.
//
// Engine-agnostic; only registered as a bus sink, only forwards while active (start/
// stop). window.open must run from a user gesture, which it does (the start click).

export function createWindowSink() {
  let win = null, canvas = null, ctx = null, imgData = null;
  let active = false;

  function ensureCanvas(w, h) {
    if (!canvas || canvas.width !== w || canvas.height !== h || !imgData) {
      canvas.width = w; canvas.height = h;
      imgData = ctx.createImageData(w, h);
    }
  }

  return {
    id: 'window',
    supported: typeof window !== 'undefined' && typeof window.open === 'function',
    // active only while the popup is open — the user may have closed it directly.
    get active() { return active && !!win && !win.closed; },

    start() {
      win = window.open('', 'fold-output', 'width=1280,height=720');
      if (!win) throw new Error('output window blocked — allow pop-ups for this site');
      const d = win.document;
      d.title = 'Fold — Output';
      d.body.style.cssText = 'margin:0;height:100vh;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center';
      canvas = d.createElement('canvas');
      // fill the window, scaling UP past 100% if needed (contain = no crop, keep aspect)
      canvas.style.cssText = 'width:100vw;height:100vh;object-fit:contain;image-rendering:auto';
      d.body.appendChild(canvas);
      ctx = canvas.getContext('2d');
      active = true;
    },

    stop() {
      active = false;
      if (win && !win.closed) win.close();
      win = null; canvas = null; ctx = null; imgData = null;
    },

    // bottom-up RGBA → Y-flipped into the popup canvas (same as the recorder).
    publish(frame) {
      if (!active || !win || win.closed || !ctx) return;
      const { pixels, w, h } = frame;
      ensureCanvas(w, h);
      const stride = w * 4;
      const data = imgData.data;
      for (let y = 0; y < h; y++) {
        const src = (h - 1 - y) * stride;
        data.set(pixels.subarray(src, src + stride), y * stride);
      }
      ctx.putImageData(imgData, 0, 0);
    },
  };
}
