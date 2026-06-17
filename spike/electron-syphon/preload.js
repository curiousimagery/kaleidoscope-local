'use strict';

const { ipcRenderer } = require('electron');

// ── Resolution ladder ────────────────────────────────────────────────────────
const RESOLUTIONS = [
  { w: 960,  h: 960  },
  { w: 1920, h: 1920 },
  { w: 3840, h: 3840 },
  { w: 3840, h: 2160 },   // 16:9 4K — fewer pixels than square 4K
];
let captureW = 960;
let captureH = 960;

let captureCanvas = document.createElement('canvas');
captureCanvas.width  = captureW;
captureCanvas.height = captureH;
let ctx2d = captureCanvas.getContext('2d', { willReadFrequently: true });

function setResolution(idx) {
  const r = RESOLUTIONS[idx];
  if (captureW === r.w) return;
  captureW = r.w;
  captureH = r.h;
  captureCanvas.width  = captureW;
  captureCanvas.height = captureH;
  console.log(`[syphon-spike] switched to ${captureW}×${captureH}`);
}

window.addEventListener('keydown', (e) => {
  if (e.key === '1') setResolution(0);
  if (e.key === '2') setResolution(1);
  if (e.key === '3') setResolution(2);
  if (e.key === '4') setResolution(3);
}, true);

// ── Diagnostic ping ───────────────────────────────────────────────────────────
// Confirms IPC is reachable regardless of canvas state.
// Watch for "[main] ping" in the npm start terminal.
setInterval(() => {
  try {
    ipcRenderer.send('syphon:ping', { ts: Date.now() });
  } catch (e) {
    console.error('[syphon-spike] ping error:', e.message);
  }
}, 2000);

// ── Find the main preview canvas ─────────────────────────────────────────────
// The app has multiple canvases (the preview canvas + possibly small helpers).
// Always pick the LARGEST one by pixel count — that's the WebGL preview.
function findMainCanvas() {
  const all = [...document.querySelectorAll('canvas')];
  if (!all.length) return null;
  return all.reduce((best, c) =>
    (c.width * c.height > best.width * best.height) ? c : best
  );
}

// ── Capture loop ──────────────────────────────────────────────────────────────
let loopStarted = false;

function startCaptureLoop() {
  if (loopStarted) return;
  loopStarted = true;
  console.log('[syphon-spike] capture loop started');

  let lastStatusTs = 0;

  function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();

    // Every 2 seconds: log all canvases in the DOM so we can see what's there.
    if (now - lastStatusTs > 2000) {
      lastStatusTs = now;
      const all = [...document.querySelectorAll('canvas')];
      const sizes = all.map(c => `${c.width}×${c.height}`).join(', ');
      console.log(`[syphon-spike] DOM canvases: [${sizes || 'none'}]`);
    }

    // Pick the largest canvas each frame (handles the app resizing it after boot).
    const source = findMainCanvas();
    if (!source || source.width < 100 || source.height < 100) return;

    try {
      const t0 = performance.now();
      ctx2d.drawImage(source, 0, 0, captureW, captureH);
      const imageData = ctx2d.getImageData(0, 0, captureW, captureH);
      const captureMs = performance.now() - t0;

      const sendTs = Date.now();   // wall-clock ms, comparable across processes
      ipcRenderer.send('syphon:frame', {
        width: captureW,
        height: captureH,
        sourceW: source.width,    // actual canvas dimensions (for the warning flag)
        sourceH: source.height,
        captureMs,
        sendTs,
        buffer: imageData.data.buffer,
      });
    } catch (e) {
      console.error('[syphon-spike] capture/send error:', e.message);
    }
  }

  requestAnimationFrame(loop);
}

// Start the loop once the DOM is ready — the canvas survey runs every 2s
// inside the loop itself, so we don't need to wait for a specific canvas.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startCaptureLoop);
} else {
  startCaptureLoop();
}
