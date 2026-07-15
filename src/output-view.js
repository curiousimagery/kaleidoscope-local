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
import { createTestFrame } from './stage/test-pattern.js';

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
let latestVideo = null;          // {t,paused,rate} of the main app's video clock (loaded-video source)
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

  if (payload.kind === 'image' && (payload.bitmap || payload.dataUrl)) {
    let src = payload.bitmap;
    if (!src) {
      // the native external-display transport can't structured-clone an
      // ImageBitmap — the still arrives as a data URL instead
      src = new Image();
      src.src = payload.dataUrl;
      await new Promise((res) => { src.onload = res; src.onerror = res; });
      if (!src.naturalWidth) return;
    }
    if (token !== sourceToken) return;
    engine.setSource(src);
    liveSource = false; haveSource = true;
    return;
  }

  if (payload.kind === 'unsupported') {
    // an honest hint instead of a stale frame (e.g. video sources over the
    // native bridge — a follow-up)
    if (hint) hint.textContent = payload.reason || 'this source is not yet supported here';
    document.body.classList.remove('live');
    return;
  }

  if (payload.kind === 'camera') {
    camera = createCamera();
    try {
      // match the MAIN app's negotiated capture mode (width/height ride the
      // payload) — a second consumer of the same device can otherwise land on a
      // different aspect and skew every slice coordinate in this window
      await camera.start({
        ...(payload.deviceId ? { deviceId: payload.deviceId } : {}),
        ...(payload.width ? { width: payload.width, height: payload.height } : {}),
      });
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

// ---- test pattern overlay -------------------------------------------------------
// The bus's test pattern is a reference frame this GPU-direct window used to IGNORE
// (it self-renders from state, not bus frames) — the "test pattern inert during
// output-window broadcast" bug, confirmed on desktop + iPad. A 2D overlay canvas
// with the SAME letterbox treatment as the GL canvas mirrors the pattern here, so
// the window is an honest probe of the display path too. Works with no source
// loaded (the pattern is a pre-show pipe check).
let testOn = false;
let testCanvas = null;
let testDrawnKey = '';   // "WxH" last drawn — state messages arrive per frame; redraw only on toggle/resize
function applyTestPattern(on) {
  if (!on) {
    if (testOn && testCanvas) testCanvas.style.display = 'none';
    testOn = false; testDrawnKey = '';
    return;
  }
  testOn = true;
  if (!testCanvas) {
    testCanvas = document.createElement('canvas');
    testCanvas.id = 'testCanvas';
    testCanvas.style.cssText = 'display:block;width:100vw;height:100vh;object-fit:contain;position:fixed;inset:0;background:#000;';
    document.body.appendChild(testCanvas);
  }
  testCanvas.style.display = 'block';
  const w = canvas.width || 1920, h = canvas.height || 1080;
  const key = w + 'x' + h;
  if (testDrawnKey === key) return;
  testDrawnKey = key;
  testCanvas.width = w; testCanvas.height = h;
  // createTestFrame caches per size and hands its drawn 2D canvas through
  testCanvas.getContext('2d').drawImage(createTestFrame(w, h).canvas, 0, 0);
  document.body.classList.add('live');   // the pattern IS a frame — dismiss the hint
}

// ---- the render loop: GPU-direct, zero readback --------------------------------
let frames = 0, fpsT = performance.now(), measuredFps = 0;
// Keep the popup's own <video> copy locked to the main app's clock: match paused
// (motion mode pauses the main video) + retime rate, and nudge currentTime toward
// the master only on real drift (tight when paused/scrubbing, looser while playing
// so we don't seek every frame).
function reconcileVideo() {
  if (!videoEl || !latestVideo) return;
  if (latestVideo.paused) {
    if (!videoEl.paused) videoEl.pause();
    if (Math.abs(videoEl.currentTime - latestVideo.t) > 0.05) videoEl.currentTime = latestVideo.t;
  } else {
    if (videoEl.paused) videoEl.play().catch(() => {});
    if (videoEl.playbackRate !== latestVideo.rate) videoEl.playbackRate = latestVideo.rate || 1;
    if (Math.abs(videoEl.currentTime - latestVideo.t) > 0.2) videoEl.currentTime = latestVideo.t;
  }
}

// One frame of the popup's render. Driven PRIMARILY by the per-frame state
// message from the main app (below): Firefox throttles/suspends rAF in an
// unfocused window, so a loop-driven popup renders jerkily (or freezes) the
// moment focus goes elsewhere — exactly the perform-mode showstopper (the main
// app streams smooth 60Hz state, the popup painted it at whatever its starved
// rAF allowed). Messages aren't throttled, so rendering on arrival keeps the
// broadcast smooth; the rAF tick stays as a fallback for when messages pause.
let lastRenderT = 0;
function renderFrame() {
  if (!(haveSource && latestState)) return;
  if (camera) camera.refreshFrame();        // front-camera: redraw the mirrored frame
  if (videoEl) reconcileVideo();             // keep the video copy in sync with the main clock
  if (liveSource) engine.updateSourceFrame(); // re-upload camera/video texture
  engine.render(latestState);
  if (hint && !document.body.classList.contains('live')) document.body.classList.add('live');
  lastRenderT = performance.now();
  frames++;
  if (lastRenderT - fpsT >= 1000) {
    measuredFps = Math.round((frames * 1000) / (lastRenderT - fpsT));
    frames = 0; fpsT = lastRenderT;
    sendUp({ type: 'fps', fps: measuredFps });
  }
}

function tick() {
  // fallback only: the state stream normally drives rendering (see above)
  if (performance.now() - lastRenderT > 100) renderFrame();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---- transport: receive state + source from the main app ----------------------
// Two ingress paths, one handler: the same-origin BroadcastChannel (the popup
// output window) and window.__foldExternal (the Capacitor external-display
// plugin evaluates messages into this webview — BroadcastChannel can't cross
// WKWebViews, so the committed state-stream arrives over the bridge instead).
function handleMessage(msg) {
  if (!msg) return;
  if (msg.type === 'state') {
    latestState = msg.state;
    latestVideo = msg.video || null;
    applyOutput(msg.output);
    applyTestPattern(!!msg.test);
    // the state stream IS the render clock (rAF is throttled unfocused — see renderFrame)
    renderFrame();
  } else if (msg.type === 'source') {
    applyOutput(msg.output);
    setupSource(msg.payload);
  } else if (msg.type === 'close') {
    window.close();
  }
}
const channel = new BroadcastChannel(CHANNEL);
channel.onmessage = (e) => handleMessage(e.data);
window.__foldExternal = handleMessage;

// messages UP to whoever drives us: the BroadcastChannel peer (main window) or
// the native bridge (the external-display plugin's script message handler).
function sendUp(msg) {
  try { channel.postMessage(msg); } catch { /* channel closed */ }
  try { window.webkit?.messageHandlers?.foldExternal?.postMessage(msg); } catch { /* not native */ }
}
// announce readiness so the driver (re)sends the current source even if it was
// posted before this view finished loading.
sendUp({ type: 'hello' });
window.addEventListener('pagehide', () => { teardownSource(); try { channel.close(); } catch {} });

// ---- zero chrome: click toggles fullscreen; hide the cursor while fullscreen ---
document.addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});
document.addEventListener('fullscreenchange', () => {
  document.body.classList.toggle('fs', !!document.fullscreenElement);
});
