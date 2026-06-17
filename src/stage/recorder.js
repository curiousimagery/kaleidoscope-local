// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// stage/recorder.js
//
// The record-to-disk sink — the FIRST concrete output sink and the universal
// stand-in that lets perform-mode UX be built and tested in the browser without
// Syphon. It draws each output-bus frame into a hidden 2D canvas and runs a
// MediaRecorder over that canvas's captureStream(); start/stop bookend a session
// and stop downloads a playable file.
//
// Frames arrive raw and BOTTOM-UP (WebGL FBO order; see engine-adapter.js), so
// publish does the per-frame Y-flip into the 2D canvas (the same flip exportFrame
// does for stills) — top-down is what the 2D canvas / video wants. Engine-agnostic
// and self-contained (no shell/engine imports): it only touches the Frame shape
// and the DOM APIs it needs, so it lives cleanly in the stage layer.
//
// Minimal here (Increment 2); a higher-quality WebCodecs path can reuse
// shell/video-export.js later if recording fidelity becomes a need.

// Prefer MP4 where the browser's MediaRecorder supports it (Safari does), else
// fall back to WebM (Chromium/Firefox). Empty string = let MediaRecorder choose.
function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

function extFor(mime) {
  return mime && mime.startsWith('video/mp4') ? 'mp4' : 'webm';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoke after the download has had a chance to start
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function createRecorderSink({ filenamePrefix = 'fold-live' } = {}) {
  let canvas = null, ctx = null, imgData = null;
  let recorder = null, stream = null, chunks = [];
  let recording = false;

  // (Re)size the hidden 2D canvas + reusable ImageData to match the frame.
  function ensureCanvas(w, h) {
    if (!canvas) { canvas = document.createElement('canvas'); ctx = canvas.getContext('2d'); }
    if (canvas.width !== w || canvas.height !== h || !imgData) {
      canvas.width = w; canvas.height = h;
      imgData = ctx.createImageData(w, h);
    }
  }

  return {
    id: 'disk',
    get recording() { return recording; },
    get supported() { return pickMime() !== null; },

    // bus calls this every frame; a no-op until a recording session is started.
    publish(frame) {
      if (!recording || !ctx) return;
      const { pixels, w, h } = frame;
      ensureCanvas(w, h);
      const stride = w * 4;
      const data = imgData.data;
      for (let y = 0; y < h; y++) {
        const src = (h - 1 - y) * stride;   // bottom-up FBO row → top-down canvas row
        data.set(pixels.subarray(src, src + stride), y * stride);
      }
      ctx.putImageData(imgData, 0, 0);
    },

    // begin a session at w×h. Sizes the canvas, draws nothing yet (the first
    // publish fills it), and starts MediaRecorder over its captureStream.
    start(w, h) {
      if (recording) return;
      ensureCanvas(w, h);
      const mime = pickMime();
      if (mime === null) throw new Error('MediaRecorder is not available in this browser');
      chunks = [];
      stream = canvas.captureStream();   // tracks the canvas as it's drawn each frame
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const finalMime = recorder.mimeType || mime || 'video/webm';
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: finalMime });
        chunks = [];
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        downloadBlob(blob, `${filenamePrefix}-${stamp}.${extFor(finalMime)}`);
      };
      recorder.start();
      recording = true;
    },

    // end the session → onstop fires → file downloads.
    stop() {
      recording = false;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      recorder = null;
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    },
  };
}
