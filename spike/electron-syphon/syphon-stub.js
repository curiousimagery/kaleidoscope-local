'use strict';

// syphon-stub.js — stands in for a real Syphon native addon.
//
// Receives frames from the IPC handler, measures throughput, and logs a
// one-line summary once per second. The timing breakdown tells us WHERE
// time is being spent so we know whether the bottleneck is the canvas
// read (capture path) or the renderer→main data transfer (IPC).
//
// When (if) the CPU-path numbers look viable, swap this out for the real
// Syphon addon and wire publish() to push the buffer to an IOSurface.

const WINDOW = 60;    // rolling window: 60 frames (≈1s at 60fps)
const LOG_INTERVAL_MS = 1000;

let frames = [];
let lastLogTs = 0;
let lastResolution = '';

// publish() is called by main.js for every received frame.
// payload: { width, height, captureMs, sendTs, buffer }
// recvTs: performance.now() timestamp recorded in main.js on receipt
//
// Returns a summary object (for window title) or null if not enough data yet.
function publish(payload, recvTs) {
  const { width, height, captureMs, sendTs, buffer } = payload;
  const ipcMs = recvTs - sendTs;
  const totalMs = captureMs + ipcMs;
  const res = `${width}×${height}`;

  // Reset the window when resolution changes so the average is clean.
  if (res !== lastResolution) {
    frames = [];
    lastResolution = res;
    console.log(`[syphon-stub] measuring ${res}  (${(width * height * 4 / 1024 / 1024).toFixed(1)} MB/frame)`);
  }

  frames.push({ ts: recvTs, captureMs, ipcMs, totalMs });
  if (frames.length > WINDOW) frames.shift();

  const now = recvTs;
  if (now - lastLogTs < LOG_INTERVAL_MS || frames.length < 2) return null;
  lastLogTs = now;

  const elapsed = frames[frames.length - 1].ts - frames[0].ts;
  const rollingFps = ((frames.length - 1) / elapsed * 1000).toFixed(1);
  const avgCapture = avg(frames, 'captureMs');
  const avgIpc = avg(frames, 'ipcMs');
  const avgTotal = avg(frames, 'totalMs');

  const verdict = parseFloat(rollingFps) >= 30 ? '✓' : '✗ <30fps';
  const mbPerSec = ((width * height * 4) / 1024 / 1024 * parseFloat(rollingFps)).toFixed(0);

  const sourceNote = (payload.sourceW && payload.sourceW < width)
    ? `  ⚠ source canvas ${payload.sourceW}×${payload.sourceH} (upscaled)`
    : '';

  console.log(
    `[syphon-stub] ${res} @ ${rollingFps} fps  ${verdict}` +
    `  |  capture ${avgCapture}ms  ipc ${avgIpc}ms  total ${avgTotal}ms` +
    `  |  ${mbPerSec} MB/s${sourceNote}`
  );

  // Flag if either phase is a clear bottleneck
  if (parseFloat(avgCapture) > parseFloat(avgIpc) * 3) {
    console.log('  → bottleneck: canvas readback (drawImage + getImageData)');
  } else if (parseFloat(avgIpc) > parseFloat(avgCapture) * 3) {
    console.log('  → bottleneck: IPC transfer');
  }

  return {
    fps: rollingFps,
    captureMs: avgCapture,
    ipcMs: avgIpc,
    totalMs: avgTotal,
  };
}

function fps() {
  if (frames.length < 2) return '–';
  const elapsed = frames[frames.length - 1].ts - frames[0].ts;
  return ((frames.length - 1) / elapsed * 1000).toFixed(1);
}

function avg(arr, key) {
  return (arr.reduce((s, f) => s + f[key], 0) / arr.length).toFixed(1);
}

module.exports = { publish, fps };
