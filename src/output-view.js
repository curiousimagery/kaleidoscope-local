// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// output-view.js
//
// The chrome-free OUTPUT WINDOW (output.html). A SECOND, independent engine view
// that renders the live program on the GPU at the output resolution — not a pixel
// sink. The main app (src/shell/output-window.js) drives it over a same-origin
// BroadcastChannel: it pushes the small `state` JSON every frame and a `source`
// descriptor on change; we render here with zero readback / zero per-frame pixel
// transfer, so it stays smooth to 4K and works in any browser (and Electron — it's
// plain web APIs, no native dependency).
//
// Source parity with the main app: a still arrives as an ImageBitmap (set once); a
// loaded video arrives as a blob URL we play independently (loose sync — deferred);
// the live camera arrives as a deviceId and we open OUR OWN capture of that exact
// device (same physical camera ⇒ effectively in sync, no per-frame transfer),
// reusing shell/camera.js so front-camera mirroring matches.

import { createEngine } from './engine/index.js';
import { createCamera } from './shell/camera.js';

const CHANNEL = 'fold-output';

const canvas = document.getElementById('outputCanvas');
const hint = document.getElementById('hint');

let engine;
try {
  engine = createEngine({ canvas });
} catch (e) {
  if (hint) hint.textContent = 'could not start the output engine: ' + e.message;
  throw e;
}

let latestState = null;          // the most recent program state (params)
let liveSource = false;          // camera/video re-upload the texture each frame; a still does not
let haveSource = false;
let camera = null;               // createCamera() when the source is the live camera
let videoEl = null;              // the popup's own <video> for a loaded-video source
let sourceToken = 0;             // guards against a stale async source setup winning a race

// ---- output resolution: the canvas BACKING store renders at the program's output
// size; CSS (object-fit:contain) scales it to fill the window letterboxed. --------
function applyOutput(out) {
  if (!out || !out.width || !out.height) return;
  if (canvas.width !== out.width || canvas.height !== out.height) {
    canvas.width = out.width;
    canvas.height = out.height;
  }
}

// ---- source setup (one per `source` message) ----------------------------------
async function teardownSource() {
  liveSource = false;
  haveSource = false;
  if (camera) { try { camera.stop(); } catch {} camera = null; }
  if (videoEl) { try { videoEl.pause(); } catch {} videoEl.src = ''; videoEl = null; }
}

async function setupSource(payload) {
  const token = ++sourceToken;
  await teardownSource();
  if (!payload || payload.kind === 'none') return;

  if (payload.kind === 'image' && payload.bitmap) {
    engine.setSource(payload.bitmap);
    if (token !== sourceToken) return;
    liveSource = false; haveSource = true;
    return;
  }

  if (payload.kind === 'camera') {
    camera = createCamera();
    try {
      await camera.start(payload.deviceId ? { deviceId: payload.deviceId } : {});
    } catch (e) {
      if (hint) hint.textContent = 'output window could not open the camera: ' + (e.message || e.name);
      camera = null; return;
    }
    if (token !== sourceToken) { try { camera.stop(); } catch {} camera = null; return; }
    engine.setSource(camera.frameSource());
    liveSource = true; haveSource = true;
    return;
  }

  if (payload.kind === 'video' && payload.url) {
    const v = document.createElement('video');
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
    v.src = payload.url;
    await new Promise((res) => v.addEventListener('loadeddata', res, { once: true }));
    if (token !== sourceToken) return;
    videoEl = v;
    engine.setSource(v);
    v.play().catch(() => {});
    liveSource = true; haveSource = true;
    return;
  }
}

// ---- the render loop: GPU-direct, zero readback --------------------------------
let frames = 0, fpsT = performance.now(), measuredFps = 0;
function tick() {
  if (haveSource && latestState) {
    if (camera) camera.refreshFrame();        // front-camera: redraw the mirrored frame
    if (liveSource) engine.updateSourceFrame(); // re-upload camera/video texture
    engine.render(latestState);
    if (hint && !document.body.classList.contains('live')) document.body.classList.add('live');
    frames++;
    const now = performance.now();
    if (now - fpsT >= 1000) {
      measuredFps = Math.round((frames * 1000) / (now - fpsT));
      frames = 0; fpsT = now;
      try { channel.postMessage({ type: 'fps', fps: measuredFps }); } catch {}
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---- channel: receive state + source from the main app ------------------------
const channel = new BroadcastChannel(CHANNEL);
channel.onmessage = (e) => {
  const msg = e.data;
  if (!msg) return;
  if (msg.type === 'state') {
    latestState = msg.state;
    applyOutput(msg.output);
  } else if (msg.type === 'source') {
    applyOutput(msg.output);
    setupSource(msg.payload);
  } else if (msg.type === 'close') {
    window.close();
  }
};
// announce readiness so the main app (re)sends the current source even if it was
// posted before this window finished loading.
try { channel.postMessage({ type: 'hello' }); } catch {}
window.addEventListener('pagehide', () => { teardownSource(); try { channel.close(); } catch {} });

// ---- zero chrome: click toggles fullscreen; hide the cursor while fullscreen ---
document.addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});
document.addEventListener('fullscreenchange', () => {
  document.body.classList.toggle('fs', !!document.fullscreenElement);
});
