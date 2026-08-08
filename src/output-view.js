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
import { createTestFrame } from 'conduit/test-pattern';

const CHANNEL = 'fold-output';

const canvas = document.getElementById('outputCanvas');
const hint = document.getElementById('hint');

let engine;
try {
  // maxProbeSize is REQUIRED here: the default boot probe walks FBO sizes up to
  // maxTextureSize, deliberately committing the memory — on an iPhone that's a
  // ~1GB 16384² attempt, which jetsam-killed the external-display webview before
  // it ever said hello (the pass-5 crash loop; same reason mobile/chrome.js caps
  // its probe). This view only renders to canvas — it never exports — so it
  // needs no large FBO at all.
  engine = createEngine({ canvas, maxProbeSize: 2048 });
} catch (e) {
  if (hint) hint.textContent = 'could not start the output engine: ' + e.message;
  throw e;
}

let latestState = null;          // the most recent program state (params)
let latestVideo = null;          // {t,paused,rate} of the main app's video clock (loaded-video source)
let liveSource = false;          // camera/video re-upload the texture each frame; a still does not
let haveSource = false;
let camera = null;               // createCamera() when the source is the live camera
let receiver = null;             // native-camera frame-socket receiver (external display)
let planarSource = false;        // the engine takes the receiver's planes directly (native video)
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
  planarSource = false;
  try { engine.setPlanarSource(null); } catch { /* engine may not have started */ }
  if (camera) { try { camera.stop(); } catch {} camera = null; }
  if (receiver) { try { receiver.stop(); } catch {} receiver = null; }
  if (videoEl) { try { videoEl.pause(); } catch {} videoEl.src = ''; videoEl = null; }
  // clear the canvas — otherwise the LAST RENDERED FRAME persists while the new
  // source loads or when it fails (Daniel saw a stale still stay on the external
  // display after switching to a source that couldn't open). Black + the hint
  // is the honest in-between.
  try {
    const gl = engine.glContext;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  } catch { /* engine may not expose its context */ }
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

  if (payload.kind === 'native-camera' && payload.port) {
    // the NATIVE camera (Capacitor): join its frame socket as a second client —
    // no second capture session (iOS wouldn't allow one), same frames the phone
    // previews. Receiver is lazy-loaded (never needed by the web popup).
    let recv = null;
    try {
      const mod = await import('./shell/native-frame-receiver.js');
      recv = mod.createNativeFrameReceiver({ port: payload.port, mirror: !!payload.mirror });
      await recv.start();
    } catch (e) {
      if (hint) hint.textContent = 'could not join the camera stream: ' + (e.message || e);
      try { recv?.stop(); } catch { /* not started */ }
      return;
    }
    if (token !== sourceToken) { recv.stop(); return; }
    receiver = recv;
    engine.setSource(receiver.frameSource());
    liveSource = true; haveSource = true;
    return;
  }

  if (payload.kind === 'video-native' && payload.port) {
    // S3-A stage 4 — THE CRASH FIX COMPLETES. This view used to stage the whole clip to
    // disk and run its OWN <video> decoder on top of a second WebGL context; at 4K that
    // is the memory exhaustion that lost the main context ~30s in. Now it joins the same
    // frame socket the main engine reads, as a second client of ONE native decode. No
    // second decoder, no staged file, no range server, and no clock to reconcile: both
    // views are looking at the identical frame by construction, so reconcileVideo never
    // runs on this path.
    let recv = null;
    try {
      const mod = await import('./shell/native-frame-receiver.js');
      // cap the receiver's own canvas hard: this view never samples it (the engine takes
      // planes), it exists only to give setSource the source's dimensions and aspect —
      // and an uncapped one would cost a full 4K readback right when the join window is
      // ticking, which is the worst possible moment for a 160ms stall
      recv = mod.createNativeFrameReceiver({ port: payload.port, cap: 1280 });
      await recv.start();
    } catch (e) {
      if (hint) hint.textContent = 'could not join the video stream: ' + (e.message || e);
      try { recv?.stop(); } catch { /* not started */ }
      return;
    }
    if (token !== sourceToken) { recv.stop(); return; }
    receiver = recv;
    // PLANES, NOT A CANVAS (B504). Sampling the receiver's own WebGL canvas from this
    // engine's context is a GPU→CPU→GPU round trip on WebKit — ~20ms per megapixel, so
    // 4K over HDMI could never exceed ~6fps no matter how fast the frames arrived. The
    // planes are already in CPU memory; upload them here and convert in one blit.
    engine.setSource(receiver.frameSource());
    engine.setPlanarSource(receiver.planeReader(), payload.cap || 0);
    planarSource = true;
    liveSource = true; haveSource = true;
    return;
  }

  if (payload.kind === 'notice') {
    // The main app is doing something the audience shouldn't watch — the Loop Builder,
    // or a bake. `teardownSource` above already released THIS view's decoder and cleared
    // the canvas, which is the entire point: a 4K bake and a 4K external render at the
    // same time is what restarted the app (Daniel, 6min 4K + broadcasting). With no
    // source, renderFrame returns early, so this view goes quiet until the real source
    // is re-posted. A line of text is more than adequate here (Daniel's call).
    if (hint) hint.textContent = payload.text || 'editing in Fold';
    document.body.classList.remove('live');
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
    // match the MAIN app's negotiated capture mode (width/height ride the
    // payload) — a second consumer of the same device can otherwise land on a
    // different aspect and skew every slice coordinate in this window.
    // deviceId only works on the SAME-origin popup path (getUserMedia ids are
    // salted per origin — a foreign id matches nothing); the native transport
    // sends facingMode instead, and a failed deviceId retries by facing.
    const dims = payload.width ? { width: payload.width, height: payload.height } : {};
    try {
      await camera.start({
        ...(payload.deviceId ? { deviceId: payload.deviceId } : {}),
        ...(payload.facingMode && !payload.deviceId ? { facingMode: payload.facingMode } : {}),
        ...dims,
      });
    } catch (e) {
      let recovered = false;
      if (payload.deviceId && payload.facingMode) {
        try { await camera.start({ facingMode: payload.facingMode, ...dims }); recovered = true; }
        catch { /* fall through to the hint */ }
      }
      if (!recovered) {
        if (hint) hint.textContent = 'output window could not open the camera: ' + (e.message || e.name);
        camera = null; return;
      }
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
// Keep this view's own <video> copy locked to the main app's clock: match paused
// (motion mode pauses the main video) + retime rate, and converge currentTime toward
// the master.
//
// SEEK THRASH — the 4K-over-HDMI stutter (Daniel, B491). This runs on EVERY rendered
// frame, and a bare `currentTime = t` on a 4K clip costs far more than one frame. So
// once drift crossed the threshold we re-seeked before the previous seek had landed:
// drift never closed, and playback locked into permanent start/stop. His tell nailed
// it — smooth playback degenerates into stutter the moment you scrub forward, and only
// recovers when the view is rebuilt (a Loop Builder round trip re-posts the source, so
// the copy restarts aligned). A trimmed clip does the same thing every loop, because
// this copy wraps at the file end while the master wraps at the trim out-point.
//
// Two changes: never issue a seek while one is in flight or still settling, and close
// ORDINARY drift by trimming the playback RATE (the decoder keeps streaming; nothing
// flushes) instead of seeking. A hard seek is now reserved for a real discontinuity —
// a scrub, or a loop wrap — where there is no nearby time to converge to.
const SEEK_JUMP_S = 1.0;      // drift beyond this means "somewhere else entirely", not "running behind"
const SEEK_SETTLE_MS = 500;   // after a seek, let the decoder land before judging drift again
const RATE_TRIM_MAX = 0.10;   // ±10%: closes 0.4s of drift in ~4s, and reads as normal playback
const RATE_TRIM_GAIN = 0.25;  // drift seconds → rate trim, before clamping
let lastSeekT = 0;
function reconcileVideo() {
  if (!videoEl || !latestVideo) return;
  const now = performance.now();
  // `seeking` covers the seek we issued; the settle window covers the decode after it
  const settling = videoEl.seeking || (now - lastSeekT) < SEEK_SETTLE_MS;
  const drift = videoEl.currentTime - latestVideo.t;   // positive = ahead of the master
  const hardSeek = () => {
    try { videoEl.currentTime = latestVideo.t; lastSeekT = now; } catch { /* not seekable yet */ }
  };
  if (latestVideo.paused) {
    if (!videoEl.paused) videoEl.pause();
    if (videoEl.playbackRate !== 1) { try { videoEl.playbackRate = 1; } catch { /* clamped */ } }
    // parked: there is no playback to converge through, so the seek IS the mechanism
    // (this is the scrub path, where landing on the exact frame is the whole point)
    if (!settling && Math.abs(drift) > 0.05) hardSeek();
    return;
  }
  if (videoEl.paused) videoEl.play().catch(() => {});
  const base = latestVideo.rate || 1;
  if (!settling && Math.abs(drift) > SEEK_JUMP_S) {
    hardSeek();
    try { videoEl.playbackRate = base; } catch { /* clamped */ }
    return;
  }
  // ordinary drift: ahead → run slightly slow, behind → slightly fast. While settling we
  // hold the base rate rather than reacting to a mid-seek clock.
  const trim = settling ? 0
    : Math.max(-RATE_TRIM_MAX, Math.min(RATE_TRIM_MAX, -drift * RATE_TRIM_GAIN));
  const target = base * (1 + trim);
  if (Math.abs(videoEl.playbackRate - target) > 1e-3) {
    try { videoEl.playbackRate = target; } catch { /* some browsers clamp extreme rates */ }
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
let lastArrived = -1;   // receiver.framesArrived at the last fps window (see renderFrame)
function renderFrame() {
  if (!(haveSource && latestState)) return;
  if (camera) camera.refreshFrame();        // front-camera: redraw the mirrored frame
  // on the planar path updateSourceFrame takes the socket frame itself — blitting the
  // receiver's canvas first would just be a second conversion nothing reads
  if (receiver && !planarSource) receiver.refreshFrame();
  if (videoEl) reconcileVideo();             // keep the video copy in sync with the main clock
  if (liveSource) engine.updateSourceFrame(); // re-upload camera/video texture
  engine.render(latestState);
  if (hint && !document.body.classList.contains('live')) document.body.classList.add('live');
  lastRenderT = performance.now();
  frames++;
  if (lastRenderT - fpsT >= 1000) {
    measuredFps = Math.round((frames * 1000) / (lastRenderT - fpsT));
    // HOW MANY OF THOSE RENDERS SHOWED A NEW PICTURE (B552).
    //
    // Daniel's iPad broadcast updated once every 5–10 seconds while this counter cheerfully
    // reported 51fps and the app reported its own loop healthy — neither side saw a problem
    // because neither side was measuring the right thing. `frames` counts RENDER CALLS. When the
    // receiver has no new socket frame, we re-render the identical picture, and that is
    // indistinguishable from real throughput here.
    //
    // This is the same mistake, in the same shape, as the iPad source stall of B519: `refresh`
    // cost 1.13ms/frame while ZERO frames were arriving, because repainting the last frame is not
    // evidence of arrival. That was fixed by reporting the WIRE rate (`N in/s`) beside the render
    // rate. Same remedy here — a remote surface needs an arrival counter, not just a paint counter.
    const inNow = receiver ? receiver.framesArrived : (videoEl ? -1 : -1);
    const srcFps = inNow >= 0 && lastArrived >= 0 ? Math.round(((inNow - lastArrived) * 1000) / (lastRenderT - fpsT)) : -1;
    lastArrived = inNow;
    frames = 0; fpsT = lastRenderT;
    sendUp({ type: 'fps', fps: measuredFps, srcFps });
  }
}

// Fallback floor. The state stream normally drives rendering; this only fires when messages
// stop arriving. It used to sit at 100ms, which silently WAS the frame rate for the whole time
// the poster was eliding a live source (B549): the display ran at exactly 10fps and the app,
// measuring only its own loop, reported 46. A keepalive that doubles as an undetectable
// throttle is the wrong shape — 32ms degrades a message gap to ~30fps instead of 10, so the
// same class of bug costs one frame rather than five sixths of them.
const FALLBACK_MS = 32;
function tick() {
  if (performance.now() - lastRenderT > FALLBACK_MS) renderFrame();
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
// THIS VIEW'S CONSOLE REACHES NOBODY (B559). Only the MAIN webview's `console.*` is bridged to
// the Xcode log, so every failure inside this file — a source payload that never arrives, an
// engine that never renders, "could not join the video stream" — has been invisible unless it
// happened to draw text on the HDMI screen. That has cost two rounds of guessing.
//
// `sendUp` already exists as a channel out of here, so warnings and errors ride it and the driver
// re-logs them with a `[fold ext]` prefix. Console output is preserved, not replaced: this is an
// ADDITIONAL destination, so a browser popup (where devtools do work) loses nothing.
//
// Deliberately warn/error only. `console.log` here is per-frame in places and would flood the
// bridge; anything worth reading remotely is worth logging at a level that says so.
for (const level of ['warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    original(...args);
    // never let a logging failure take down the view it is reporting on
    try {
      sendUp({ type: 'log', level, text: args.map(fmtLogArg).join(' ') });
    } catch { /* channel closed or message not cloneable */ }
  };
}
// Errors cross the bridge as strings: a postMessage of a live Error or a DOM node either throws
// on structured clone or arrives stripped of the very fields worth reading.
function fmtLogArg(a) {
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  if (typeof a === 'object' && a !== null) { try { return JSON.stringify(a); } catch { return String(a); } }
  return String(a);
}
window.addEventListener('error', (e) => {
  sendUp({ type: 'log', level: 'error', text: `uncaught: ${e.message} @ ${e.filename}:${e.lineno}` });
});
window.addEventListener('unhandledrejection', (e) => {
  sendUp({ type: 'log', level: 'error', text: `unhandled rejection: ${fmtLogArg(e.reason)}` });
});

// announce readiness so the driver (re)sends the current source even if it was
// posted before this view finished loading.
sendUp({ type: 'hello' });

// GL context-loss recovery — this view runs unattended on an external display
// (or an unfocused popup), so a loss must heal itself: reinitGL rebuilds the
// GPU resources and re-uploads the held source; 'hello' asks the driver to
// re-post the source payload too (belt and suspenders for live sources). The
// loss is reported upstream so the device console shows it.
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  sendUp({ type: 'glLost' });
});
canvas.addEventListener('webglcontextrestored', () => {
  try { engine.reinitGL(); } catch { /* the next hello-driven source post retries */ }
  sendUp({ type: 'glRestored' });
  sendUp({ type: 'hello' });
});
window.addEventListener('pagehide', () => { teardownSource(); try { channel.close(); } catch {} });

// ---- zero chrome: click toggles fullscreen; hide the cursor while fullscreen ---
document.addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});
document.addEventListener('fullscreenchange', () => {
  document.body.classList.toggle('fs', !!document.fullscreenElement);
});
