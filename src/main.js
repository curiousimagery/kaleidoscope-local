// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// main.js
//
// entry point — instantiates the engine, builds shell UI, wires controls,
// handles slot management (main/side, swap), file loading, export.
//
// the `env` object is the shared runtime container threaded through shell
// modules. it carries: state, session, engine, key DOM refs, and methods that
// inter-module wiring needs (scheduleRender, syncControls, arrangeSlots, etc.).
// keeping these in one object lets the modules collaborate without reaching
// into each other for globals.

import { state, session } from './shell/state.js';
import { createEngine, getActiveForm } from './engine/index.js';
import { FORMS } from './engine/forms/index.js';
import {
  drawSourceOverlay,
  makeOverlayDrawer,
  mountSourceView,
} from './shell/overlay.js';
import {
  wireSliderWithScrub,
  makeScrubField,
  buildFormGrid,
  applyFormControls,
  setupDivider,
  makeControlsSync,
} from './shell/controls.js';
import { PARAMS, DECLARATIVE_PARAM_IDS } from './shell/params.js';
import { createCamera } from './shell/camera.js';
import { formatVersion } from './version.js';
import { push as historyPush, undo as historyUndo, redo as historyRedo, canUndo, canRedo } from './shell/history.js';
import { wireDiagnosticButton } from './shell/diagnostics.js';

// ============================================================================
// version footer
// ============================================================================

document.getElementById('versionBadge').textContent = formatVersion();
document.getElementById('placeholderTitle').textContent = `kaleidoscope — ${formatVersion()}`;
document.title = `kaleidoscope — ${formatVersion()}`;

// ============================================================================
// engine + canvas setup
// ============================================================================

// preview canvas — separate, never resized for export. the engine owns it.
const previewCanvas = document.createElement('canvas');
previewCanvas.className = 'preview-canvas';
previewCanvas.style.background = '#1a1a1a';
previewCanvas.style.border = '1px solid #222';
previewCanvas.style.maxWidth = '100%';
previewCanvas.style.maxHeight = '100%';
previewCanvas.style.display = 'none';

// "mini" canvas for showing the kaleidoscope in the side slot when swapped.
// drawn from previewCanvas via 2D copy — separate from the WebGL preview canvas.
const miniCanvas = document.createElement('canvas');
miniCanvas.style.cssText = `position: absolute; top: 0; left: 0; width: 100%; height: 100%;`;

const statusEl = document.getElementById('status');
const diagEl = document.getElementById('diag');
const uploadErrorEl = document.getElementById('uploadError');

// Browser detection for the WebGL-cap notice + augmented upload-error text.
// Firefox with Resist Fingerprinting (RFP) caps MAX_TEXTURE_SIZE at 8192
// regardless of underlying hardware. We can't know with certainty whether
// RFP is on, but the combination of "browser is Firefox" + "max texture
// happens to be exactly 8192 on a non-mobile device" is a strong signal.
const isFirefox = /Firefox\//i.test(navigator.userAgent);
function isFirefoxCappedAt8K(engine) {
  return isFirefox && engine.diagnostics.maxTextureSize <= 8192;
}

let engine;
try {
  engine = createEngine({ canvas: previewCanvas });
  // basic always-on diagnostics. expanded with unmasked renderer and device
  // pixel ratio so cross-device comparisons are easier without invoking the
  // full diagnostic panel.
  const dbg = engine.glContext.getExtension('WEBGL_debug_renderer_info');
  const unmasked = dbg ? engine.glContext.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null;
  diagEl.innerHTML = `WebGL2 ok<br>` +
    `renderer: ${unmasked || engine.diagnostics.renderer}<br>` +
    `max texture: ${engine.diagnostics.maxTextureSize}px<br>` +
    `max export: ${engine.diagnostics.maxFBOSize}px<br>` +
    `DPR: ${window.devicePixelRatio || 1}`;

  // Firefox WebGL-cap notice in the export group. Only rendered when the cap
  // is detected; no-op on Safari/Chrome/Edge and on a Firefox build that
  // somehow doesn't have the 8K cap (unlikely on macOS but possible).
  if (isFirefoxCappedAt8K(engine)) {
    const notice = document.createElement('div');
    notice.className = 'browser-notice';
    notice.textContent = 'Firefox limits WebGL textures to 8K. For higher-resolution export on Apple Silicon, try Safari.';
    const exportGroup = document.getElementById('exportBtn').parentElement;
    exportGroup.insertBefore(notice, document.getElementById('exportBtn'));
  }
} catch (e) {
  statusEl.textContent = e.message;
  statusEl.classList.add('error');
  console.error(e);
}

// ============================================================================
// env — shared runtime container threaded through shell modules
// ============================================================================

const controlsSync = makeControlsSync();

const env = {
  // mutable state (read by all modules, written by controls + drag handlers)
  state,
  session,

  // engine handle
  engine,

  // DOM refs the shell shares
  previewCanvas,
  miniCanvas,
  sourceOverlayCanvas: null,  // assigned when source view is mounted

  // hover state for the overlay (shared between overlay drawing and event handlers)
  hoverMode: null,
  hoverOnSpoke: false,
  hoverHandle: null,         // form-specific handle discriminator (droste: 'inner'|'outer')

  // syncers / methods — defined below
  controlsSync,
  scheduleRender: null,
  scheduleOverlayDraw: null,
  syncControls: () => controlsSync.syncAll(),
  applyFormControls: () => applyFormControls(env),
  resizePreviewCanvas: null,
  arrangeSlots: null,
  pushHistory: () => historyPush({ ...state }),
  updateUndoUI: null,  // assigned after setupUndoBar
};

// ============================================================================
// rendering scheduler
// ============================================================================

let renderScheduled = false;
function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    if (engine && engine.getSourceImage()) {
      engine.render(state);
      if (session.isSwapped) drawMiniKaleidoscope();
    }
    drawSourceOverlay(env);
    updateResolutionHint();
  });
}
env.scheduleRender = scheduleRender;

const overlayDrawer = makeOverlayDrawer(env);
env.scheduleOverlayDraw = overlayDrawer.schedule;

function updateResolutionHint() {
  const el = document.getElementById('resHint');
  if (!el) return;
  if (!engine || !engine.getSourceImage()) { el.textContent = ''; return; }
  const suggested = engine.suggestResolution(state);
  if (suggested == null) { el.textContent = ''; return; }
  const roundedK = (suggested / 1024).toFixed(1);
  el.innerHTML = 'sharp output up to <span class="num">~' + roundedK + 'K</span> at current settings';
}

// ============================================================================
// canvas sizing
// ============================================================================

function resizePreviewCanvas() {
  if (!engine || !engine.getSourceImage()) return;
  let containerW, containerH;
  if (session.isSwapped) {
    const wrap = document.getElementById('sideSlot');
    containerW = wrap.clientWidth;
    containerH = wrap.clientHeight;
  } else {
    const main = document.getElementById('mainSlot');
    containerW = main.clientWidth - 48;
    containerH = main.clientHeight - 48;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssSize = Math.max(200, Math.min(containerW, containerH));
  const target = Math.max(400, Math.min(2048, Math.floor(cssSize * dpr)));

  if (Math.abs(previewCanvas.width - target) > 16) {
    previewCanvas.width = target;
    previewCanvas.height = target;
  }
  previewCanvas.style.width = cssSize + 'px';
  previewCanvas.style.height = cssSize + 'px';
  scheduleRender();
}
env.resizePreviewCanvas = resizePreviewCanvas;

function sizeMiniCanvas() {
  const sideSlot = document.getElementById('sideSlot');
  const w = sideSlot.clientWidth;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  miniCanvas.width = Math.floor(w * dpr);
  miniCanvas.height = Math.floor(w * dpr);
  miniCanvas.style.width = w + 'px';
  miniCanvas.style.height = w + 'px';
}

function drawMiniKaleidoscope() {
  if (!miniCanvas.parentElement) return;
  const ctx = miniCanvas.getContext('2d');
  ctx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
  ctx.drawImage(previewCanvas, 0, 0, miniCanvas.width, miniCanvas.height);
}

// ============================================================================
// slot management — main and side slots, swappable content
// ============================================================================

const mainSlot = document.getElementById('mainSlot');
const sideSlot = document.getElementById('sideSlot');
const sideEmptyMsg = document.getElementById('sideEmptyMsg');
const placeholder = document.getElementById('placeholder');

function arrangeSlots() {
  Array.from(mainSlot.querySelectorAll('.slot-content')).forEach(n => n.remove());
  Array.from(sideSlot.querySelectorAll('.slot-content')).forEach(n => n.remove());

  if (!engine || !engine.getSourceImage()) {
    placeholder.style.display = 'block';
    sideEmptyMsg.style.display = 'flex';
    return;
  }
  placeholder.style.display = 'none';
  sideEmptyMsg.style.display = 'none';

  if (!session.isSwapped) {
    // main = K, side = S
    const mainWrap = document.createElement('div');
    mainWrap.className = 'slot-content';
    mainWrap.style.cssText = `position: relative; max-width: 100%; max-height: 100%; display: flex; align-items: center; justify-content: center;`;
    previewCanvas.style.display = 'block';
    mainWrap.appendChild(previewCanvas);
    mainSlot.appendChild(mainWrap);

    const sideWrap = document.createElement('div');
    sideWrap.className = 'slot-content';
    sideWrap.style.cssText = `position: absolute; inset: 0;`;
    sideSlot.appendChild(sideWrap);
    mountSourceView(env, sideWrap);
  } else {
    // main = S, side = K
    const mainWrap = document.createElement('div');
    mainWrap.className = 'slot-content';
    mainWrap.style.cssText = `position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;`;
    const inner = document.createElement('div');
    const slotW = mainSlot.clientWidth - 48;
    const slotH = mainSlot.clientHeight - 48;
    const sourceAspect = engine.getSourceAspect();
    let dispW, dispH;
    if (sourceAspect > slotW / slotH) {
      dispW = slotW;
      dispH = slotW / sourceAspect;
    } else {
      dispH = slotH;
      dispW = slotH * sourceAspect;
    }
    inner.style.cssText = `position: relative; width: ${dispW}px; height: ${dispH}px; background: #1a1a1a; border: 1px solid #222;`;
    mainWrap.appendChild(inner);
    mainSlot.appendChild(mainWrap);
    mountSourceView(env, inner);

    const sideWrap = document.createElement('div');
    sideWrap.className = 'slot-content';
    sideWrap.style.cssText = `position: absolute; inset: 0;`;
    sideWrap.appendChild(miniCanvas);
    sideSlot.appendChild(sideWrap);
  }

  requestAnimationFrame(() => {
    resizePreviewCanvas();
    if (session.isSwapped) sizeMiniCanvas();
    drawSourceOverlay(env);
    scheduleRender();
  });
}
env.arrangeSlots = arrangeSlots;

function toggleSwap() {
  if (!engine || !engine.getSourceImage()) return;
  setBusy('swapping…');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      session.isSwapped = !session.isSwapped;
      arrangeSlots();
      requestAnimationFrame(() => requestAnimationFrame(clearBusy));
    });
  });
}

function setBusy(msg) {
  const el = document.getElementById('busyOverlay');
  document.getElementById('busyMsg').textContent = msg || 'working…';
  el.classList.add('visible');
}
function clearBusy() {
  document.getElementById('busyOverlay').classList.remove('visible');
}

// ============================================================================
// image loading
// ============================================================================

let sourceFilename = '';

function loadImage(file) {
  if (!engine) return;
  if (isLive) stopCameraMode({ keepSource: true });  // uploading exits live mode
  pendingOriginal = null;  // an uploaded file is already on the user's disk
  const url = URL.createObjectURL(file);
  sourceFilename = (file.name || 'image').replace(/\.[^.]+$/, '');
  const img = new Image();
  // Clear any prior upload error before attempting this load.
  if (uploadErrorEl) uploadErrorEl.textContent = '';

  img.onload = () => {
    try {
      engine.setSource(img);
    } catch (e) {
      // Engine throws with a descriptive message (e.g. "image too large for
      // GPU: 18000×18000 (max 16384×16384 on this device)"). Surface near
      // the upload control (not the export status pane) so it's actually
      // discoverable. When the cap is a Firefox RFP limit and not a real
      // hardware constraint, append a hint to try Safari.
      let msg = e.message;
      if (isFirefoxCappedAt8K(engine) && /too large/i.test(msg)) {
        msg += ' Firefox limits WebGL to 8K — try Safari for full-size images on Apple Silicon.';
      }
      if (uploadErrorEl) uploadErrorEl.textContent = msg;
      statusEl.textContent = '';
      statusEl.classList.remove('error', 'busy', 'success');
      console.error(e);
      return;
    }

    document.getElementById('sourceMeta').children[0].textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
    document.getElementById('sourceMeta').children[1].textContent = file.name;
    document.getElementById('swapBtn').disabled = false;

    statusEl.textContent = `loaded ${img.naturalWidth}×${img.naturalHeight}`;
    statusEl.classList.remove('error', 'busy');
    if (uploadErrorEl) uploadErrorEl.textContent = '';

    arrangeSlots();
  };
  img.onerror = () => {
    if (uploadErrorEl) uploadErrorEl.textContent = 'failed to load image';
    statusEl.textContent = '';
    statusEl.classList.remove('error', 'busy', 'success');
  };
  img.src = url;
}

// ============================================================================
// live camera (Phase 0.5 — camera host module wired into the desktop/iPad chrome)
// ============================================================================
//
// The camera is a HOST capability, not a separate chrome: getUserMedia gives a
// live <video> that flows into the SAME engine + source-view + wedge-overlay
// machinery as a still image. The only structural addition is a continuous
// render loop (the still path is render-on-demand). Capture freezes the frame
// as a normal editable still; nothing is saved automatically — the original is
// saved alongside the kaleidoscope on the first export (see doExport).

const camera = createCamera();
let isLive = false;
let liveActive = false;
let liveRaf = 0;

// The unmodified source to save alongside the kaleidoscope on the FIRST export
// of a captured frame (the raw camera frame only exists in-app). { blob, name }
// or null. Cleared once saved, and on upload (the user already has that file).
let pendingOriginal = null;
// Object URL backing the frozen-capture still source. Kept alive while it's the
// source (the source view paints it via background-image); revoked on replace.
let captureObjectURL = null;

// Default facing by device. Touch devices (iPad) default to the rear camera
// ("frame the world"); desktops have no real rear camera and want the front
// (mirrored, selfie-intuitive) by default.
const DEFAULT_FACING =
  matchMedia('(pointer: coarse)').matches ? 'environment' : 'user';

// continuous render driver — runs only while the camera is live. each tick
// refreshes the (possibly mirrored) frame, re-uploads it, renders, and redraws
// the overlay.
function startLiveLoop() {
  if (liveActive) return;
  liveActive = true;
  const tick = () => {
    if (!liveActive) return;
    if (engine) {
      camera.refreshFrame();      // front camera: redraw the mirrored frame
      engine.updateSourceFrame();
      engine.render(state);
      if (session.isSwapped) drawMiniKaleidoscope();
    }
    drawSourceOverlay(env);
    liveRaf = requestAnimationFrame(tick);
  };
  liveRaf = requestAnimationFrame(tick);
}
function stopLiveLoop() {
  liveActive = false;
  if (liveRaf) { cancelAnimationFrame(liveRaf); liveRaf = 0; }
}

function cameraErrorMessage(e) {
  if (e && e.name === 'NotAllowedError') return 'camera permission denied — allow access and try again';
  if (e && e.name === 'NotFoundError') return 'no camera found on this device';
  return 'could not start camera: ' + (e && e.message ? e.message : 'unknown error');
}

function setCameraMeta(label) {
  const v = camera.getVideo();
  const meta = document.getElementById('sourceMeta');
  if (v && v.videoWidth) meta.children[0].textContent = `${v.videoWidth} × ${v.videoHeight}`;
  meta.children[1].textContent = label;
}

function updateCameraUI() {
  document.getElementById('cameraBtn').style.display = isLive ? 'none' : '';
  document.getElementById('uploadBtn').style.display = isLive ? 'none' : '';
  document.getElementById('cameraLive').style.display = isLive ? 'flex' : 'none';
  // flip button labels the camera it switches TO.
  const flip = document.getElementById('flipBtn');
  if (flip) flip.textContent = camera.isFront() ? 'rear' : 'front';
}

async function startCameraMode() {
  if (!engine) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (uploadErrorEl) uploadErrorEl.textContent = 'camera needs a secure context (https or localhost)';
    return;
  }
  if (uploadErrorEl) uploadErrorEl.textContent = '';
  pendingOriginal = null;
  statusEl.textContent = 'starting camera…';
  statusEl.classList.add('busy');
  try {
    const video = await camera.start(DEFAULT_FACING);
    env.liveVideo = video;
    engine.setSource(camera.frameSource());
  } catch (e) {
    env.liveVideo = null;
    statusEl.textContent = '';
    statusEl.classList.remove('busy');
    if (uploadErrorEl) uploadErrorEl.textContent = cameraErrorMessage(e);
    console.error(e);
    return;
  }
  statusEl.classList.remove('busy');
  statusEl.textContent = 'live camera';
  isLive = true;
  sourceFilename = 'camera';
  setCameraMeta('live camera');
  document.getElementById('swapBtn').disabled = false;
  updateCameraUI();
  arrangeSlots();
  startLiveLoop();
}

// stop the camera. by default returns to the empty placeholder (cancel path);
// pass { keepSource: true } when another source is about to take over (upload).
function stopCameraMode({ keepSource = false } = {}) {
  stopLiveLoop();
  camera.stop();
  isLive = false;
  env.liveVideo = null;
  updateCameraUI();
  if (keepSource) return;
  engine.clearSource();
  const meta = document.getElementById('sourceMeta');
  meta.children[0].textContent = '—';
  meta.children[1].textContent = '—';
  document.getElementById('swapBtn').disabled = true;
  statusEl.textContent = '';
  statusEl.classList.remove('busy', 'success', 'error');
  arrangeSlots();
}

async function flipCamera() {
  if (!isLive) return;
  try {
    const video = await camera.flip();
    env.liveVideo = video;
    engine.setSource(camera.frameSource());   // video (rear) or mirror canvas (front)
  } catch (e) {
    if (uploadErrorEl) uploadErrorEl.textContent = cameraErrorMessage(e);
    return;
  }
  setCameraMeta('live camera');
  updateCameraUI();
  arrangeSlots();              // remount picks up the mirror transform + aspect
}

// grab the current camera frame into a canvas at native resolution. mirrored
// to match the front-camera preview so the saved frame is what the user saw.
function captureLiveFrame() {
  const video = camera.getVideo();
  if (!video || !video.videoWidth) return null;
  const w = video.videoWidth, h = video.videoHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d');
  if (camera.isFront()) { cx.translate(w, 0); cx.scale(-1, 1); }
  cx.drawImage(video, 0, 0, w, h);
  return c;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

// shutter: freeze the current frame as the new editable still and stop the
// camera. Nothing is saved automatically — the raw frame is stashed as the
// pending original and written out, with the kaleidoscope, on the first export.
function captureFrame() {
  const frame = captureLiveFrame();
  if (!frame) return;
  stopLiveLoop();
  camera.stop();
  isLive = false;
  env.liveVideo = null;
  updateCameraUI();

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  sourceFilename = `camera-${ts}`;

  frame.toBlob(blob => {
    if (!blob) return;
    pendingOriginal = { blob, name: `${sourceFilename}-original.png` };
    // keep the URL alive — the source view paints it via background-image.
    if (captureObjectURL) URL.revokeObjectURL(captureObjectURL);
    captureObjectURL = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      engine.setSource(img);                            // frozen still source
      document.getElementById('sourceMeta').children[0].textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
      document.getElementById('sourceMeta').children[1].textContent = `${sourceFilename}.png`;
      document.getElementById('swapBtn').disabled = false;
      statusEl.textContent = 'captured — export to save';
      statusEl.classList.remove('busy', 'error', 'success');
      arrangeSlots();
    };
    img.src = captureObjectURL;
  }, 'image/png');
}

function wireCamera() {
  document.getElementById('cameraBtn').addEventListener('click', startCameraMode);
  document.getElementById('shutterBtn').addEventListener('click', captureFrame);
  document.getElementById('flipBtn').addEventListener('click', flipCamera);
  document.getElementById('stopCameraBtn').addEventListener('click', () => stopCameraMode());
}

// ============================================================================
// export
// ============================================================================

async function doExport(sizeArg) {
  if (!engine || !engine.getSourceImage()) {
    statusEl.textContent = 'load an image first';
    statusEl.classList.add('error');
    return;
  }

  // resolve size for status messaging
  const cap = engine.diagnostics.maxFBOSize;
  let size = sizeArg === 'max' ? cap : Math.min(parseInt(sizeArg, 10), cap);

  statusEl.textContent = `rendering ${size}×${size}...`;
  statusEl.classList.remove('error');
  statusEl.classList.add('busy');
  // (no setBusy here — the export button's own spinner + this status text are
  // the feedback path; the fullscreen busy overlay would cover the button.)
  // Double rAF so the spinner + status actually PAINT before the synchronous
  // FBO render/readPixels in exportAt blocks the main thread (a single rAF runs
  // its callback before paint, so the spinner never showed — Build 66 regression).
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  let result;
  try {
    result = await engine.exportAt(state, sizeArg, session.exportFormat);
  } catch (e) {
    statusEl.textContent = e.message;
    statusEl.classList.add('error');
    statusEl.classList.remove('busy');
    // restore preview render
    engine.render(state);
    console.error(e);
    return;
  }

  const { blob, size: sz, renderMs, readMs, encodeMs } = result;
  downloadBlob(blob, buildFilename(sz));

  // First export of a captured frame also saves the unmodified original (the
  // raw camera frame only exists in-app). Subsequent exports of the same source
  // save only the kaleidoscope. Uploads have no pending original.
  if (pendingOriginal) {
    const orig = pendingOriginal;
    pendingOriginal = null;
    downloadBlob(orig.blob, orig.name);
  }

  // restore preview render
  engine.render(state);

  statusEl.textContent = `exported ${sz}×${sz} • ${session.exportFormat} • render ${renderMs.toFixed(0)}ms • read ${readMs.toFixed(0)}ms • encode ${encodeMs.toFixed(0)}ms • ${(blob.size / 1024 / 1024).toFixed(1)}MB`;
  statusEl.classList.remove('busy');
  statusEl.classList.add('success');
  setTimeout(() => statusEl.classList.remove('success'), 2500);
}

function buildFilename(size) {
  const form = getActiveForm(state);
  const f = form.fileCode;
  const formSuffix = form.filenameSuffix ? form.filenameSuffix(state) : '';
  const sliceR = ((state.sliceRotation % 360) + 360) % 360 | 0;
  const canvasR = ((state.canvasRotation % 360) + 360) % 360 | 0;
  const sliceS = Math.round(state.sliceScale * 100);
  const compZ = Math.round(state.canvasZoom * 100);
  const cx = Math.round(state.sliceCx * 1000).toString().padStart(3, '0');
  const cy = Math.round(state.sliceCy * 1000).toString().padStart(3, '0');
  const oob = ['c','m','t'][state.oobMode];
  const ext = session.exportFormat === 'jpg' ? 'jpg' : 'png';
  return `${sourceFilename}-${f}${formSuffix}-sr${sliceR}-cr${canvasR}-ss${sliceS}-cz${compZ}-xy${cx}${cy}-${oob}-${size}.${ext}`;
}

// ============================================================================
// droste twist snap + segments slider routing (shared with the segments
// slider's form-aware wiring and with overlay.js's seam-drag handler)
// ============================================================================

// snap step depends on drosteArms AND drosteMirror:
//   - arms ≥ 2: base step is 1/arms (matches wedge closure)
//   - arms = 1: base step is 1 (integer tiers per turn)
//   - tier mirror ON: step doubles (only even multiples of base) because odd
//     tier-counts land in a reflected tier and misalign at the canvas seam
function armsSnapStep() {
  const n = Math.round(state.drosteArms || 1);
  const armsEven = n <= 1 ? 1 : Math.max(2, Math.min(12, n - (n % 2)));
  const base = 1 / armsEven;
  return state.drosteMirror ? base * 2 : base;
}
function snapSpiralValue(v) {
  const step = armsSnapStep();
  return Math.max(0, Math.min(6, Math.round(v / step) * step));
}
function applyArmsSnap() {
  // Slider step kept fine-grained (0.001) so snap is purely value-side.
  state.drosteSpiral = snapSpiralValue(state.drosteSpiral || 0);
}

// segments slider — shared DOM, form-aware routing. radial drives state.segments
// (2..48 step 2); droste drives state.drosteArms (valid set {1, 2, 4, 6, 8, 10,
// 12}). triangle/hex/square don't use this slider — controls.js disables it.
function setupSegmentsSlider() {
  const seg = document.getElementById('segments');
  const segVal = document.getElementById('segVal');

  function segmentsKey() {
    return state.form === 'droste' ? 'drosteArms' : 'segments';
  }
  function segmentsRange() {
    return state.form === 'droste'
      ? { min: 1, max: 12, step: 1 }
      : { min: 2, max: 48, step: 2 };
  }
  function segmentsSnap(v) {
    if (state.form === 'droste') {
      if (v < 1.5) return 1;
      return Math.max(2, Math.min(12, Math.round(v / 2) * 2));
    }
    return Math.max(2, Math.min(48, Math.round(v / 2) * 2));
  }
  function getSeg() { return state[segmentsKey()]; }
  function setSeg(v) {
    state[segmentsKey()] = segmentsSnap(v);
    // changing drosteArms cascades into the twist snap step.
    if (state.form === 'droste') applyArmsSnap();
  }
  function applyRange() {
    const r = segmentsRange();
    seg.min = r.min;
    seg.max = r.max;
    seg.step = r.step;
  }
  function sync() {
    segVal.textContent = String(Math.round(getSeg()));
    seg.value = getSeg();
  }

  applyRange();
  sync();

  let pushed = false;
  seg.addEventListener('mousedown', () => { pushed = false; });
  seg.addEventListener('touchstart', () => { env.pushHistory(); }, { passive: true });
  seg.addEventListener('mouseup', () => env.updateUndoUI?.());
  seg.addEventListener('touchend', () => env.updateUndoUI?.());
  seg.addEventListener('input', () => {
    if (!pushed) { env.pushHistory(); pushed = true; }
    setSeg(parseFloat(seg.value));
    sync();
    // when in droste, arms change cascades — refresh twist slider state.
    if (state.form === 'droste') env.controlsSync.syncAll();
    env.scheduleRender();
  });

  makeScrubField(segVal, {
    get: getSeg,
    set: setSeg,
    step: 1,
    format: v => String(Math.round(v)),
    parse: s => {
      const n = parseInt(s, 10);
      return isNaN(n) ? null : n;
    },
    onChange: () => {
      sync();
      if (state.form === 'droste') env.controlsSync.syncAll();
      env.scheduleRender();
    },
    onStart: () => env.pushHistory(),
    onEnd: () => env.updateUndoUI?.(),
  });

  // Re-sync on every controlsSync.syncAll() so form switches + undo/redo
  // refresh range + slider position.
  env.controlsSync.register(() => {
    applyRange();
    sync();
  });
}

// Exposed for overlay.js's seam-drag + boundary-drag handlers.
env.snapDrosteSpiral = snapSpiralValue;
env.applyArmsSnap = applyArmsSnap;

// ============================================================================
// wire all controls
// ============================================================================

function wireControls() {
  // Segments slider — shared DOM element across forms. Routes by active form:
  //   radial → state.segments  (range 2..48, step 2, even integers)
  //   droste → state.drosteArms (valid set {1, 2, 4, 6, 8, 10, 12})
  //   others → disabled (controls.js applyFormControls handles the disable class)
  // This is custom wiring (not wireSliderWithScrub) because the key, range,
  // step, and snap function all shift with state.form. Other sliders below
  // continue to use the standard wireSliderWithScrub path.
  setupSegmentsSlider();

  // Declarative sliders — scale, composition zoom, slice rotation, square
  // aspect, droste thickness (zoom), and canvas rotation. Their ranges, steps,
  // and fmt/parse live in the parameter registry (src/shell/params.js) so a
  // second chrome can render the same controls without re-hand-wiring them.
  // The stateful controls below (segments, spiral, the toggles) stay bespoke
  // because their behavior reads or cascades into other state.
  for (const id of DECLARATIVE_PARAM_IDS) {
    const p = PARAMS[id];
    wireSliderWithScrub(env, p.sliderId, p.valId, p.key, p.opts);
  }

  // droste spiral — tiers per canvas turn. snaps to multiples of 1/arms so
  // the spiral closes cleanly with the arms-fold lattice (1/12 at arms=12,
  // 1/2 at arms=2, integers at arms=1). signed value gives chirality.
  wireSliderWithScrub(env, 'spiral', 'spiralVal', 'drosteSpiral', {
    min: 0, max: 6, step: 0.001, scrubStep: 0.05,
    fmt: v => {
      // Prefer fraction format when on a snap point. arms-aware: when
      // v·arms rounds to a small integer, show p/q form.
      if (Math.abs(v) < 1e-6) return '0';
      const arms = Math.max(1, Math.round(state.drosteArms || 1));
      const armsEven = arms <= 1 ? 1 : Math.max(2, Math.min(12, arms - (arms % 2)));
      const num = Math.round(v * armsEven);
      const denom = armsEven;
      if (Math.abs(v * armsEven - num) < 0.01) {
        const sign = v < 0 ? '−' : '';
        const a = Math.abs(num);
        if (denom === 1 || a === 0) return sign + a;
        // reduce fraction
        function gcd(x, y) { return y === 0 ? x : gcd(y, x % y); }
        const g = gcd(a, denom);
        const n = a / g, d = denom / g;
        if (d === 1) return sign + n;
        return sign + n + '/' + d;
      }
      return (v >= 0 ? '+' : '') + v.toFixed(2);
    },
    parse: s => {
      const cleaned = s.replace(/[+−]/g, c => c === '−' ? '-' : '').trim();
      // Accept "p/q" fraction syntax.
      const m = cleaned.match(/^(-?\d+)\s*\/\s*(\d+)$/);
      if (m) {
        const n = parseFloat(m[1]), d = parseFloat(m[2]);
        return d !== 0 ? n / d : null;
      }
      const n = parseFloat(cleaned);
      return isNaN(n) ? null : n;
    },
    snap: snapSpiralValue,
  });

  // initialize the slider snap to the current arms.
  applyArmsSnap();

  // droste tier mirror toggle (on/off buttons). registered with controlsSync
  // so undo/redo updates the button highlight along with state.
  function syncMirrorToggle() {
    document.querySelectorAll('#mirrorToggle button').forEach(b => {
      const wantsOn = b.dataset.mirror === '1';
      b.classList.toggle('active', wantsOn === !!state.drosteMirror);
    });
  }
  document.querySelectorAll('#mirrorToggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      env.pushHistory();
      state.drosteMirror = btn.dataset.mirror === '1';
      // tier mirror affects the spiral snap step (even multiples when on),
      // so any currently-odd snap value would land in a misaligned tier.
      // re-snap and refresh the slider display.
      applyArmsSnap();
      env.controlsSync.syncAll();
      syncMirrorToggle();
      scheduleRender();
      updateUndoUI();
    });
  });
  syncMirrorToggle();
  env.controlsSync.register(syncMirrorToggle);

  // droste wedge mirror toggle (on/off buttons). when off, the angular wedge
  // fold uses plain mod instead of mirror — N chiral arms with hard boundary
  // seams. experimental; default on.
  function syncWedgeMirrorToggle() {
    document.querySelectorAll('#wedgeMirrorToggle button').forEach(b => {
      const wantsOn = b.dataset.wedgemirror === '1';
      b.classList.toggle('active', wantsOn === (state.drosteWedgeMirror !== false));
    });
    // Wedge mirror is conceptually meaningful only at arms ≥ 2 (it reflects
    // adjacent angular wedges). Hide the row entirely at arms=1 so the
    // toggle doesn't suggest an effect when there's no wedge to mirror.
    const wmLabel = document.getElementById('wedgeMirrorLabel');
    if (wmLabel && state.form === 'droste') {
      const arms = Math.round(state.drosteArms || 1);
      wmLabel.style.display = arms > 1 ? '' : 'none';
    }
  }
  document.querySelectorAll('#wedgeMirrorToggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      env.pushHistory();
      state.drosteWedgeMirror = btn.dataset.wedgemirror === '1';
      syncWedgeMirrorToggle();
      scheduleRender();
      updateUndoUI();
    });
  });
  syncWedgeMirrorToggle();
  env.controlsSync.register(syncWedgeMirrorToggle);

  // slice reset — single button that resets all form-specific + slice-section
  // params to their defaults. does NOT change which form is selected or any
  // global state (canvas zoom/rotation, OOB mode, export size).
  document.getElementById('sliceReset').addEventListener('click', () => {
    env.pushHistory();
    state.segments       = 12;
    state.sliceScale     = 1.0;
    state.sliceRotation  = 0;
    state.sliceCx        = 0.5;
    state.sliceCy        = 0.5;
    state.squareAspect   = 1.0;
    state.drosteZoom     = 2.0;
    state.drosteSpiral   = 0;
    state.drosteMirror   = true;
    state.drosteArms     = 1;
    state.drosteWedgeMirror = true;
    state.drosteOffsetX  = 0;
    state.drosteOffsetY  = 0;
    applyArmsSnap();
    env.controlsSync.syncAll();
    scheduleRender();
    updateUndoUI();
  });

  // OOB modes
  document.querySelectorAll('#oobModes button').forEach(btn => {
    btn.addEventListener('click', () => {
      env.pushHistory();
      state.oobMode = parseInt(btn.dataset.oob);
      document.querySelectorAll('#oobModes button').forEach(b => b.classList.toggle('active', b === btn));
      scheduleRender();
      updateUndoUI();
    });
  });

  // export resolution
  document.querySelectorAll('#exportSizes button').forEach(btn => {
    btn.addEventListener('click', () => {
      session.exportSize = btn.dataset.size;
      document.querySelectorAll('#exportSizes button').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  // export format
  document.querySelectorAll('#exportFormats button').forEach(btn => {
    btn.addEventListener('click', () => {
      session.exportFormat = btn.dataset.format;
      document.querySelectorAll('#exportFormats button').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  // explicit Export button — the action. while export is in-flight, swap the
  // button text for a spinner and disable the button so a second click while
  // the user is waiting can't fire another export.
  document.getElementById('exportBtn').addEventListener('click', async () => {
    const btn = document.getElementById('exportBtn');
    if (btn.disabled) return;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span>';
    try {
      await doExport(session.exportSize);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  // file input
  document.getElementById('uploadBtn').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', e => {
    if (e.target.files[0]) loadImage(e.target.files[0]);
  });

  // drag & drop
  document.body.addEventListener('dragover', e => e.preventDefault());
  document.body.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const ok = /^image\/(jpeg|png|webp)$/i.test(file.type);
    if (ok) loadImage(file);
    else if (uploadErrorEl) {
      uploadErrorEl.textContent = `unsupported format: ${file.type || 'unknown'} — use jpg, png, or webp`;
    }
  });

  // swap button
  document.getElementById('swapBtn').addEventListener('click', toggleSwap);
}

// ============================================================================
// preview canvas gesture setup
// ============================================================================

function setupPreviewGestures(env) {
  const canvas = env.previewCanvas;
  let pinch = null;

  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      env.pushHistory();
      const t0 = e.touches[0], t1 = e.touches[1];
      pinch = {
        startDist:     Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY),
        startAngle:    Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX),
        startZoom:     env.state.canvasZoom,
        startRotation: env.state.canvasRotation,
      };
      e.preventDefault();
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return;
    const t0 = e.touches[0], t1 = e.touches[1];
    const dist  = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    const angle = Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX);
    env.state.canvasZoom     = Math.max(0.15, Math.min(4, pinch.startZoom * (dist / pinch.startDist)));
    const da                 = (angle - pinch.startAngle) * 180 / Math.PI;
    env.state.canvasRotation = ((pinch.startRotation + da) % 360 + 360) % 360;
    env.syncControls();
    env.scheduleRender();
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    if (e.touches.length < 2) { pinch = null; updateUndoUI(); }
  });
}

// ============================================================================
// undo / redo UI
// ============================================================================

function updateUndoUI() {
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  if (!undoBtn || !redoBtn) return;
  undoBtn.disabled = !canUndo();
  redoBtn.disabled = !canRedo();
}

function setupUndoBar() {
  env.updateUndoUI = updateUndoUI;
  const bar = document.createElement('div');
  bar.id = 'undoBar';
  bar.className = 'undo-bar';
  bar.innerHTML =
    '<button id="undoBtn" class="undo-btn" disabled title="Undo (Cmd+Z)">&#8592;</button>' +
    '<button id="redoBtn" class="undo-btn" disabled title="Redo (Cmd+Shift+Z)">&#8594;</button>';
  mainSlot.appendChild(bar);

  document.getElementById('undoBtn').addEventListener('click', () => {
    if (historyUndo(state)) {
      env.syncControls();
      env.scheduleRender();
      env.scheduleOverlayDraw();
      updateUndoUI();
    }
  });
  document.getElementById('redoBtn').addEventListener('click', () => {
    if (historyRedo(state)) {
      env.syncControls();
      env.scheduleRender();
      env.scheduleOverlayDraw();
      updateUndoUI();
    }
  });
}

window.addEventListener('keydown', e => {
  if (e.metaKey && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    if (historyUndo(state)) {
      env.syncControls();
      env.scheduleRender();
      env.scheduleOverlayDraw();
      updateUndoUI();
    }
  } else if (e.metaKey && e.key === 'z' && e.shiftKey) {
    e.preventDefault();
    if (historyRedo(state)) {
      env.syncControls();
      env.scheduleRender();
      env.scheduleOverlayDraw();
      updateUndoUI();
    }
  }
});

// ============================================================================
// init
// ============================================================================

if (engine) {
  buildFormGrid(env);
  applyFormControls(env);
  wireControls();
  wireCamera();
  setupDivider(env);
  setupPreviewGestures(env);
  setupUndoBar();
  wireDiagnosticButton(engine, () => state);

  window.addEventListener('resize', () => {
    resizePreviewCanvas();
    if (session.isSwapped) arrangeSlots();
    drawSourceOverlay(env);
  });
}
