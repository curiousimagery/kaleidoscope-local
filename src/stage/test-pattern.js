// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// stage/test-pattern.js
//
// A known reference frame the output bus can publish INSTEAD of the program, to
// answer "does what I send arrive clean?" in Arena (and in a recording) — which a
// kaleidoscope can't answer by eye, since it's symmetric and hides flips/mirrors.
// Engine-agnostic; returns the SAME Frame shape the engine produces (raw BOTTOM-UP
// RGBA), so it travels the exact same per-sink path (recorder Y-flip, Syphon flipped
// flag) as a real frame — that's what makes it a faithful orientation probe.
//
// What it reveals:
//   - ORIENTATION + MIRRORING — corner labels TL/TR/BL/BR + a "▲ TOP" arrow. Upright
//     and readable = correct; "TL" at bottom = vertical flip; reads mirrored = flip+mirror.
//   - CROP / SCALE — a full-bleed red border. Any missing edge in Arena = the source is
//     being cropped/zoomed (e.g. an Arena clip set to fill, or an aspect mismatch).
//   - ASPECT — a center circle. Stays circular only if undistorted; an ellipse = stretch.
//   - COLOR / RANGE — RGB/CMY/white/gray/black bars across the top (the washed-out
//     colorspace question).
// Generated once per size and cached (it's static).

let cache = null;   // { w, h, frame }

export function createTestFrame(w, h) {
  if (cache && cache.w === w && cache.h === h) return cache.frame;

  const min = Math.min(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');

  // Drawn in NATURAL top-down canvas coords; flipped to bottom-up at the end.
  g.fillStyle = '#101014';
  g.fillRect(0, 0, w, h);

  // color bars across the top
  const bars = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffffff', '#808080', '#000000'];
  const bw = w / bars.length;
  const barH = Math.round(h * 0.12);
  bars.forEach((col, i) => { g.fillStyle = col; g.fillRect(i * bw, 0, Math.ceil(bw), barH); });

  // grid
  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.lineWidth = Math.max(1, Math.round(min / 700));
  const step = Math.round(min / 12);
  for (let x = 0; x <= w; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (let y = 0; y <= h; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }

  // corner-to-corner diagonals
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke();

  // center circle (aspect check)
  const r = min * 0.3;
  g.strokeStyle = '#ffcc00'; g.lineWidth = Math.max(2, Math.round(min / 300));
  g.beginPath(); g.arc(w / 2, h / 2, r, 0, Math.PI * 2); g.stroke();

  // full-bleed border (crop check)
  const bd = Math.max(3, Math.round(min / 200));
  g.strokeStyle = '#ff3030'; g.lineWidth = bd;
  g.strokeRect(bd / 2, bd / 2, w - bd, h - bd);

  // corner labels (orientation + mirroring)
  const fs = Math.round(min / 12);
  g.fillStyle = '#ffffff'; g.font = `bold ${fs}px sans-serif`;
  g.textBaseline = 'top';    g.textAlign = 'left';   g.fillText('TL', bd * 2, barH + bd * 2);
  g.textAlign = 'right';                             g.fillText('TR', w - bd * 2, barH + bd * 2);
  g.textBaseline = 'bottom'; g.textAlign = 'left';   g.fillText('BL', bd * 2, h - bd * 2);
  g.textAlign = 'right';                             g.fillText('BR', w - bd * 2, h - bd * 2);

  // center: a TOP arrow + the published resolution
  g.fillStyle = '#ffcc00'; g.textAlign = 'center';
  g.textBaseline = 'bottom'; g.font = `bold ${Math.round(fs * 0.7)}px sans-serif`;
  g.fillText('▲ TOP', w / 2, h / 2 - r * 0.45);
  g.textBaseline = 'middle'; g.font = `bold ${Math.round(fs * 0.9)}px sans-serif`;
  g.fillText(`${w}×${h}`, w / 2, h / 2);

  // top-down (canvas) → bottom-up (engine FBO convention every sink expects)
  const top = g.getImageData(0, 0, w, h).data;
  const pixels = new Uint8Array(w * h * 4);
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    const srcRow = y * stride;
    pixels.set(top.subarray(srcRow, srcRow + stride), (h - 1 - y) * stride);
  }

  const frame = { pixels, w, h, renderMs: 0, readMs: 0 };
  cache = { w, h, frame };
  return frame;
}
