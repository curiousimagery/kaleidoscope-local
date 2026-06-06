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

import { state, session, motion } from './shell/state.js';
import { createEngine, getActiveForm } from './engine/index.js';
import { FORMS } from './engine/forms/index.js';
import { createSourceOverlay } from './components/source-overlay.js';
import { createOutputGestures } from './components/output-gestures.js';
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
import { zipStore } from './shell/zip.js';
import { drawSourceOverlay } from './shell/overlay.js';
import { snapSpiralValue as kitSnapSpiral, applyArmsSnap as kitApplyArmsSnap } from './kit/snaps.js';
import { sampleKeyframes, DISCRETE_KEYS } from './kit/tween.js';
import { exportVideo, videoExportSupported, pickVideoCodec } from './shell/video-export.js';
import { pToMediaSec, seekVideoTo } from './shell/video-source.js';
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
    // sit it right under the resolution hint, above the save buttons
    exportGroup.insertBefore(notice, document.getElementById('exportPackageBtn'));
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
  motion,

  // engine handle
  engine,

  // DOM refs the shell shares
  previewCanvas,
  miniCanvas,
  // (sourceOverlayCanvas + overlay hover state now live inside the
  //  source-overlay component, not on the shared env.)

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
    sourceOverlay.render();
    updateResolutionHint();
    // motion: editing a selected keyframe writes through to it live (snap + thumb).
    if (motionActive && motion.selected >= 0 && !motion.playing && !motionScrubbing) {
      const kf = motion.keyframes[motion.selected];
      // commit the edit live (cheap); the thumbnail refreshes on the debounced,
      // readback-free filmstrip rebuild — NOT per frame (a per-frame exportFrame →
      // readPixels here was the severe Firefox lag while editing a selected keyframe).
      if (kf) { kf.snap = { ...state }; scheduleFilmstrip(); }
    }
  });
}
env.scheduleRender = scheduleRender;

// Coalesce control-widget syncing to one rAF. The direct-manipulation drag path
// (source overlay + output gestures) fired syncControls on EVERY pointermove, and
// its per-event DOM writes (slider.value / val textContent) interleaved with the
// getBoundingClientRect read in the move handler — forcing a synchronous layout
// reflow per event (read→write→read thrash). Firefox fires far more pointermoves
// than Safari/Chrome and is much harsher about forced reflow, so this made slice
// dragging/rotating/scaling sluggish there. Render + overlay-draw were already
// rAF-coalesced; this brings syncControls in line.
let syncCtrlScheduled = false;
function scheduleSyncControls() {
  if (syncCtrlScheduled) return;
  syncCtrlScheduled = true;
  requestAnimationFrame(() => { syncCtrlScheduled = false; env.syncControls(); });
}

// the shared source-overlay component (mounted by both chromes). Desktop bridges
// it to the existing env methods; it owns its own canvas, hover/drag state, and
// overlay-draw scheduler internally.
const sourceOverlay = createSourceOverlay({
  state,
  engine,
  getLiveVideo: () => env.liveVideo,
  getSourceVideo: () => env.sourceVideo,   // a loaded video file source (vs the live camera)
  syncControls: scheduleSyncControls,
  scheduleRender,
  onCommitStart: () => env.pushHistory(),
  onCommitEnd: () => env.updateUndoUI?.(),
  // discrete edits (segment-spoke drag, droste-arms drag) are blocked once motion
  // mode has TWO keyframes (discrete is pinned to keyframe 0 from then on); with a
  // single seeded keyframe they stay editable to set up the starting look.
  canEditDiscrete: () => !(motionActive && motion.keyframes.length >= 2),
  // hide the touch affordance arrows during playback/scrub (they're not useful while
  // the animation runs).
  hideAffordances: () => motionActive && (motion.playing || motionScrubbing),
});
env.scheduleOverlayDraw = sourceOverlay.scheduleDraw;

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
  // fit a frameAspect (w/h) rectangle inside the container — the preview canvas
  // takes the output frame shape so editing is WYSIWYG with export.
  const a = session.frameAspect || 1;
  let cw, ch;
  if (containerW / containerH >= a) { ch = Math.max(160, containerH); cw = ch * a; }
  else { cw = Math.max(160, containerW); ch = cw / a; }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let tw = Math.floor(cw * dpr), th = Math.floor(ch * dpr);
  const mx = Math.max(tw, th);
  if (mx > 2048) { const s = 2048 / mx; tw = Math.floor(tw * s); th = Math.floor(th * s); }
  if (Math.abs(previewCanvas.width - tw) > 16 || Math.abs(previewCanvas.height - th) > 16) {
    previewCanvas.width = tw;
    previewCanvas.height = th;
  }
  previewCanvas.style.width = Math.round(cw) + 'px';
  previewCanvas.style.height = Math.round(ch) + 'px';
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
  // center-crop the (possibly non-square) preview into the square mini.
  const pw = previewCanvas.width, ph = previewCanvas.height, s = Math.min(pw, ph);
  ctx.drawImage(previewCanvas, (pw - s) / 2, (ph - s) / 2, s, s, 0, 0, miniCanvas.width, miniCanvas.height);
}

// ============================================================================
// slot management — main and side slots, swappable content
// ============================================================================

const mainSlot = document.getElementById('mainSlot');
const sideSlot = document.getElementById('sideSlot');
const sideEmptyMsg = document.getElementById('sideEmptyMsg');
const placeholder = document.getElementById('placeholder');

function arrangeSlots() {
  updateMotionUI();   // gate motion availability on source/live state; force-exit if needed
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
    sourceOverlay.mount(sideWrap);
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
    sourceOverlay.mount(inner);

    const sideWrap = document.createElement('div');
    sideWrap.className = 'slot-content';
    sideWrap.style.cssText = `position: absolute; inset: 0;`;
    sideWrap.appendChild(miniCanvas);
    sideSlot.appendChild(sideWrap);
  }

  requestAnimationFrame(() => {
    resizePreviewCanvas();
    if (session.isSwapped) sizeMiniCanvas();
    sourceOverlay.render();
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
let sourceVideoUrl = null;   // objectURL of a loaded source video (revoked on replace)

function loadImage(file) {
  if (!engine) return;
  if (isLive) stopCameraMode({ keepSource: true });  // uploading exits live mode
  stopSourceVideoPlayback();                          // stop a loaded video's loop before switching
  env.sourceVideo = null;                            // switching to a still clears any source video
  if (sourceVideoUrl) { URL.revokeObjectURL(sourceVideoUrl); sourceVideoUrl = null; }
  const url = URL.createObjectURL(file);
  sourceFilename = (file.name || 'image').replace(/\.[^.]+$/, '');
  originalSource = { blob: file, name: file.name || 'original' };  // for export package
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

    updateMotionUI();   // re-enable motion mode for a still (it's gated off for video sources)
    arrangeSlots();
  };
  img.onerror = () => {
    if (uploadErrorEl) uploadErrorEl.textContent = 'failed to load image';
    statusEl.textContent = '';
    statusEl.classList.remove('error', 'busy', 'success');
  };
  img.src = url;
}

// Load a source VIDEO (Build 133). Mirrors loadImage, but the source is a paused
// <video> the engine samples like any other texture source (it already accepts a
// <video> — the live camera uses the same path). This first increment loads the
// video and kaleidoscopes its FIRST frame as a static source (full slice/canvas
// editing works on it like a still). Binding it to the motion timeline (scrub +
// keyframes over the moving footage) is the next increment.
function loadVideo(file) {
  if (!engine) return;
  if (isLive) stopCameraMode({ keepSource: true });   // uploading exits live mode
  stopSourceVideoPlayback();                           // stop any previously loaded video's loop
  if (sourceVideoUrl) { URL.revokeObjectURL(sourceVideoUrl); sourceVideoUrl = null; }
  const url = URL.createObjectURL(file);
  sourceVideoUrl = url;
  sourceFilename = (file.name || 'video').replace(/\.[^.]+$/, '');
  originalSource = { blob: file, name: file.name || 'original' };   // for export package
  if (uploadErrorEl) uploadErrorEl.textContent = '';

  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.loop = true; v.preload = 'auto';
  v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
  let loaded = false;

  v.addEventListener('loadeddata', () => {
    loaded = true;
    try {
      engine.setSource(v);            // videoWidth is known now (a frame is decoded)
    } catch (e) {
      if (uploadErrorEl) uploadErrorEl.textContent = e.message;
      statusEl.textContent = '';
      statusEl.classList.remove('error', 'busy', 'success');
      console.error(e);
      return;
    }
    env.sourceVideo = v;              // mountSourceView mounts this element
    env.liveVideo = null;
    const meta = document.getElementById('sourceMeta');
    meta.children[0].textContent = `${v.videoWidth} × ${v.videoHeight}`;
    meta.children[1].textContent = file.name;
    document.getElementById('swapBtn').disabled = false;
    const dur = isFinite(v.duration) ? ` · ${v.duration.toFixed(1)}s` : '';
    statusEl.textContent = `loaded ${v.videoWidth}×${v.videoHeight}${dur}`;
    statusEl.classList.remove('error', 'busy');
    updateMotionUI();                // motion mode stays gated off for a video (until timeline binding)
    arrangeSlots();                  // mounts the <video> into the source slot
    // Play it muted-on-loop and drive the kaleidoscope from it each frame — the
    // same continuous path the live camera uses. A playing video paints reliably
    // across engines (a paused, never-played one does NOT on Blink/Gecko), and the
    // preview + output stay in sync. Timeline-driven scrub/keyframes replace this
    // free-run in the next increment.
    v.play().catch(() => {});        // muted playback is allowed; ignore autoplay rejection
    startLiveLoop();
  }, { once: true });

  v.addEventListener('error', () => {
    if (loaded) {
      // a decode hiccup AFTER the clip already loaded (seen on some Firefox .mov) —
      // not a codec-support problem, so don't blame ProRes. (Firefox .mov decode
      // robustness is a tracked, deferred issue.)
      console.warn('source video decode error after load', v.error);
      return;
    }
    if (uploadErrorEl) uploadErrorEl.textContent = 'could not load this video — the browser may not support its codec (ProRes works only in Safari). Try an H.264 or HEVC .mp4/.mov.';
    statusEl.textContent = '';
    statusEl.classList.remove('error', 'busy', 'success');
  });

  v.src = url;
}

// Stop a loaded source video's render loop + pause it. When the camera is live it
// owns the loop, so leave it alone in that case (its own lifecycle stops it).
function stopSourceVideoPlayback() {
  if (!isLive) stopLiveLoop();
  if (env.sourceVideo) { try { env.sourceVideo.pause(); } catch { /* ignore */ } }
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

// The unmodified original for the current source — bundled into "export
// package" (.zip) alongside the composition. For an upload it's the uploaded
// File; for a camera capture it's the raw frame. { blob, name } or null.
let originalSource = null;
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
      sourceOverlay.paintSourceVideo();   // loaded source video → its 2D preview canvas (no-op otherwise)
    }
    sourceOverlay.render();
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
  updateMotionUI();   // motion mode is disabled while the camera is live
}

async function startCameraMode() {
  if (!engine) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (uploadErrorEl) uploadErrorEl.textContent = 'camera needs a secure context (https or localhost)';
    return;
  }
  if (uploadErrorEl) uploadErrorEl.textContent = '';
  stopSourceVideoPlayback();   // stop a loaded video's loop before the camera takes over
  if (sourceVideoUrl) { URL.revokeObjectURL(sourceVideoUrl); sourceVideoUrl = null; }
  originalSource = null;  // no captured original until the shutter fires
  statusEl.textContent = 'starting camera…';
  statusEl.classList.add('busy');
  try {
    const video = await camera.start(DEFAULT_FACING);
    env.liveVideo = video;
    env.sourceVideo = null;                          // camera takes over the source view
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
    originalSource = { blob, name: `${sourceFilename}-original.png` };
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
    result = await engine.exportAt(state, sizeArg, session.exportFormat, undefined, session.frameAspect);
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

  // restore preview render
  engine.render(state);

  statusEl.textContent = `saved ${sz}×${sz} • ${session.exportFormat} • render ${renderMs.toFixed(0)}ms • read ${readMs.toFixed(0)}ms • encode ${encodeMs.toFixed(0)}ms • ${(blob.size / 1024 / 1024).toFixed(1)}MB`;
  statusEl.classList.remove('busy');
  statusEl.classList.add('success');
  setTimeout(() => statusEl.classList.remove('success'), 2500);
}

// "export package" — one .zip containing the composition + the unmodified
// original. A single download (sidesteps the Safari multiple-downloads block),
// and the seam for future layers (overlay thumbnail, geometry map). See
// BACKLOG; for now: composition + original only.
async function exportPackage() {
  if (!engine || !engine.getSourceImage()) {
    statusEl.textContent = 'load an image first';
    statusEl.classList.add('error');
    return;
  }
  const cap = engine.diagnostics.maxFBOSize;
  const size = session.exportSize === 'max' ? cap : Math.min(parseInt(session.exportSize, 10), cap);
  statusEl.textContent = `packaging ${size}×${size}...`;
  statusEl.classList.remove('error');
  statusEl.classList.add('busy');
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  let result;
  try {
    result = await engine.exportAt(state, session.exportSize, session.exportFormat, undefined, session.frameAspect);
  } catch (e) {
    statusEl.textContent = e.message;
    statusEl.classList.add('error');
    statusEl.classList.remove('busy');
    engine.render(state);
    console.error(e);
    return;
  }

  const files = [{ name: buildFilename(result.size), blob: result.blob }];
  if (originalSource) files.push({ name: originalSource.name, blob: originalSource.blob });
  const zipBlob = await zipStore(files);
  downloadBlob(zipBlob, `${sourceFilename}-package.zip`);

  engine.render(state);
  statusEl.textContent = `saved package • ${files.length} files • ${(zipBlob.size / 1024 / 1024).toFixed(1)}MB`;
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

// Droste snap math lives in kit/snaps.js (shared with the source-overlay
// component). These thin wrappers bind it to this chrome's `state` so all
// existing call sites + the `env.snapDrosteSpiral`/`env.applyArmsSnap` exports
// keep their signatures.
function snapSpiralValue(v) { return kitSnapSpiral(state, v); }
function applyArmsSnap()    { kitApplyArmsSnap(state); }

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
      if (btn.disabled) return;
      session.exportSize = btn.dataset.size;
      document.querySelectorAll('#exportSizes button').forEach(b => b.classList.toggle('active', b === btn));
    });
  });
  // Disable tiers the GPU/canvas can't actually export (with a tooltip), and
  // re-home the selection if the default tier is unsupported on this hardware.
  (function applyExportSizeLimits() {
    const cap = engine.diagnostics.maxFBOSize;
    const capK = (cap / 1024).toFixed(cap % 1024 ? 1 : 0);
    const all = [...document.querySelectorAll('#exportSizes button')];
    let activeDisabled = false;
    all.forEach(b => {
      const unsupported = b.dataset.size !== 'max' && parseInt(b.dataset.size, 10) > cap;
      b.disabled = unsupported;
      b.title = unsupported ? `not supported by this hardware (max ~${capK}K)` : '';
      if (unsupported && b.classList.contains('active')) activeDisabled = true;
    });
    if (activeDisabled) {
      const supported = all.filter(b => !b.disabled && b.dataset.size !== 'max');
      const pick = supported[supported.length - 1] || all.find(b => b.dataset.size === 'max');
      if (pick) { session.exportSize = pick.dataset.size; all.forEach(b => b.classList.toggle('active', b === pick)); }
    }
  })();

  // export format
  document.querySelectorAll('#exportFormats button').forEach(btn => {
    btn.addEventListener('click', () => {
      session.exportFormat = btn.dataset.format;
      document.querySelectorAll('#exportFormats button').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  // Export buttons. While an export is in-flight, swap the button text for a
  // spinner and disable it so a second click can't fire another export.
  function wireExportButton(id, action) {
    document.getElementById(id).addEventListener('click', async () => {
      const btn = document.getElementById(id);
      if (btn.disabled) return;
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-spinner"></span>';
      const start = performance.now();
      try {
        await action();
      } finally {
        // hold the spinner a beat so it's perceptible even on fast exports
        const elapsed = performance.now() - start;
        if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  }
  wireExportButton('exportBtn', () => doExport(session.exportSize));
  wireExportButton('exportPackageBtn', () => exportPackage());

  // file input
  document.getElementById('uploadBtn').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) (f.type.startsWith('video/') ? loadVideo : loadImage)(f);
  });

  // drag & drop
  document.body.addEventListener('dragover', e => e.preventDefault());
  document.body.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (file.type.startsWith('video/')) { loadVideo(file); return; }
    const ok = /^image\/(jpeg|png|webp)$/i.test(file.type);
    if (ok) loadImage(file);
    else if (uploadErrorEl) {
      uploadErrorEl.textContent = `unsupported format: ${file.type || 'unknown'} — use jpg, png, webp, or a video`;
    }
  });

  // swap button
  document.getElementById('swapBtn').addEventListener('click', toggleSwap);
}

// ============================================================================
// preview canvas gesture setup
// ============================================================================

// Output-canvas pinch/twist is the shared createOutputGestures component (wired
// in init below).

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
  // undo/redo now live in the output toolbar (index.html) — just wire them.
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
// motion mode (Phase 3 — multi-keyframe still-animation; desktop/iPad only)
// ============================================================================
//
// A keyframe is a {...state} snapshot at a normalized time t (0..1). Playback
// interpolates between adjacent keyframes (lerpState) and renders each frame
// through the stateless engine. Keyframe 0 (t=0) is the start AND the loop
// bookend: with loop on, the final span tweens the last keyframe back to kf0 at
// t=1. Discrete fields are LOCKED to keyframe 0 for the whole animation.
//
// Edit model (explicit — nothing is keyframed without "+ keyframe"):
//   - select a keyframe (click its marker, or land the scrubber on it): its snap
//     loads into `state` and further edits write through to it live (scheduleRender).
//   - edit while not on a keyframe: a staged preview in `state`; commit with
//     "+ keyframe" (drops at the scrubber). scrubbing/playing away reloads the
//     working state from the timeline, discarding the stage (undo still applies).

let motionActive = false;
let motionRaf = 0;
let motionStart = 0;          // performance.now() baseline for the current play
let motionScrubbing = false;

const KF_EPS = 0.005;         // "on a keyframe" tolerance in normalized time
const kfList = () => motion.keyframes;

// ---- thumbnails -----------------------------------------------------------
// Keyframes hold a blank 120² canvas; the actual thumbnails are painted by
// buildFilmstrip's readback-free CAPTURE path (engine.beginCapture/captureFrame →
// drawImage), on the debounced rebuild. There is intentionally NO per-edit / per-add
// thumbnail render: an exportFrame→readPixels per frame was the severe Firefox lag
// while editing a selected keyframe (Build 124).
function makeThumbCanvas() {
  const c = document.createElement('canvas');
  c.width = 120; c.height = 120;
  return c;
}

// ---- companion source-preview frame --------------------------------------
// Compose one frame of the optional "source preview" video: the source image
// (square frame) with the CLEAN wedge overlay for `snap` — no editing affordances.
// Reuses the live drawSourceOverlay by pointing the overlay view at a temp offscreen
// canvas of the target size and neutralizing hover/affordances, so every form (incl.
// droste's bespoke overlay) renders through its existing path with no per-form code.
// Swap+restore is synchronous (no yield), so a stray live overlay draw can't land on
// the temp canvas. Returns a reused canvas (wrapped in a VideoFrame before reuse).
let _spFrame = null, _spOverlay = null, _spParent = null;
function renderSourcePreviewFrame(snap, size) {
  const img = engine.getSourceImage();
  if (!img) return null;
  if (!_spFrame) {
    _spFrame = document.createElement('canvas');
    _spParent = document.createElement('div');
    _spParent.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none';
    _spOverlay = document.createElement('canvas');
    _spParent.appendChild(_spOverlay);
    document.body.appendChild(_spParent);
  }
  _spFrame.width = size; _spFrame.height = size;
  _spParent.style.width = _spParent.style.height = size + 'px';
  const fctx = _spFrame.getContext('2d');
  fctx.fillStyle = '#000'; fctx.fillRect(0, 0, size, size);

  // source image rect — match drawSourceOverlay's fit math (square frame) so the
  // wedge lines up with the image.
  const view = sourceOverlay.view;
  const sa = engine.getSourceAspect();
  const cover = view.fit === 'cover';
  let iw, ih, ix, iy;
  if ((sa > 1) !== cover) { iw = size; ih = size / sa; ix = 0; iy = (size - ih) / 2; }
  else { ih = size; iw = size * sa; ix = (size - iw) / 2; iy = 0; }
  fctx.drawImage(img, ix, iy, iw, ih);

  const saved = { canvas: view.sourceOverlayCanvas, state: view.state, hover: view.hoverMode, hide: view.hideAffordances, sw: view.overlayStrokeScale };
  view.sourceOverlayCanvas = _spOverlay;
  view.state = snap;
  view.hoverMode = null;
  view.hideAffordances = () => true;
  view.overlayStrokeScale = size / 540;            // ~5px wedge lines at 1920² (vs hairline)
  try { drawSourceOverlay(view); }
  finally {
    view.sourceOverlayCanvas = saved.canvas; view.state = saved.state;
    view.hoverMode = saved.hover; view.hideAffordances = saved.hide; view.overlayStrokeScale = saved.sw;
  }
  fctx.drawImage(_spOverlay, 0, 0, size, size);
  return _spFrame;
}

// ---- sampling -------------------------------------------------------------
// Sample the keyframe list at normalized time p (0..1): a velocity-CONTINUOUS
// Catmull-Rom across keyframes (motion flows through them, slowing only at real
// turning points — no per-keyframe stutter), with motion.smoothing relaxing jaggy
// keyframe values. Loop-aware (kf0 is the return target at t=1). Discrete fields
// are locked to kf0. Math lives in kit/tween.js (sampleKeyframes).
function sampleAt(p) {
  const list = kfList();
  if (list.length === 0) return { ...state };
  const out = sampleKeyframes(list, p, { smoothing: motion.smoothing, loop: motion.loop });
  for (const k of DISCRETE_KEYS) out[k] = list[0].snap[k];   // lock discrete to kf0
  return out;
}
function keyframeAt(p) {
  const list = kfList();
  for (let i = 0; i < list.length; i++) if (Math.abs(list[i].t - p) <= KF_EPS) return i;
  return -1;
}

// ---- playhead + render ----------------------------------------------------
function setPlayhead(p) {
  motion.playhead = p;
  const ph = document.getElementById('mfPlayhead');
  if (ph) ph.style.left = (p * 100) + '%';
}
function renderSampled(p) {
  // mutate the working state to the sampled frame so BOTH the output and the source
  // wedge overlay animate in sync during playback/scrub. (no syncControls — sliders
  // resync on pause/scrub-end via loadPlayheadIntoState; no history push — it's navigation.)
  Object.assign(state, sampleAt(p));
  if (engine && engine.getSourceImage()) {
    engine.render(state);
    if (session.isSwapped) drawMiniKaleidoscope();
  }
  sourceOverlay.render();
  setPlayhead(p);
}
// load the sampled state at the playhead into the working state so the panel and
// overlay reflect it (and editing can continue); selects a keyframe if we landed
// on one. discards any uncommitted staged edit.
function loadPlayheadIntoState() {
  if (!kfList().length) return;
  motion.selected = keyframeAt(motion.playhead);
  if (motion.selected >= 0) setPlayhead(kfList()[motion.selected].t);   // snap onto the keyframe
  Object.assign(state, sampleAt(motion.playhead));
  env.syncControls();
  env.scheduleOverlayDraw();
  env.scheduleRender();
  if (env.sourceVideo) scrubVideo(motion.playhead);   // bring the footage to the (snapped) playhead
}

// ---- video-time binding (a video source's frame follows the timeline) -----
// Put the source video's frame for timeline position p onto the texture.
async function advanceSourceToP(p) {
  const v = env.sourceVideo;
  if (!v) return;
  await seekVideoTo(v, pToMediaSec(v, p));
  engine.updateSourceFrame();
}
// Scrub the footage to p, coalescing seeks (latest target wins) so dragging the
// timeline never floods the decoder. Renders params + the landed frame together.
let _scrubSeekP = null, _scrubSeeking = false, _scrubAssign = true;
// Seek the footage to timeline position p (coalesced — latest target wins) and
// re-render. assignParams=true samples the keyframed params at p (scrub / load-
// playhead); false keeps the working state as-is — selecting a keyframe must show
// its EXACT stored snap, just over the correct video frame (not the interpolated
// value).
async function scrubVideo(p, { assignParams = true } = {}) {
  _filmstripGen++;                 // cancel any in-flight thumbnail build (it would fight our seeks)
  _scrubSeekP = p;
  _scrubAssign = assignParams;
  if (_scrubSeeking) return;
  _scrubSeeking = true;
  try {
    while (_scrubSeekP != null) {
      const target = _scrubSeekP; _scrubSeekP = null;
      const assign = _scrubAssign;
      await advanceSourceToP(target);
      if (assign) Object.assign(state, sampleAt(target));
      if (engine && engine.getSourceImage()) { engine.render(state); if (session.isSwapped) drawMiniKaleidoscope(); }
      sourceOverlay.paintSourceVideo();
      sourceOverlay.render();
      setPlayhead(target);
    }
  } finally {
    _scrubSeeking = false;   // never leave the loop flag stuck (even if a seek/render throws)
  }
}

// ---- playback -------------------------------------------------------------
function haltPlayback() {
  motion.playing = false;
  if (motionRaf) { cancelAnimationFrame(motionRaf); motionRaf = 0; }
  if (env.sourceVideo) { try { env.sourceVideo.pause(); } catch { /* ignore */ } }
}
function startPlayback() {
  if (motion.playing || kfList().length < 2) return;
  if (env.sourceVideo) { startVideoPlayback(); return; }   // a video source is its own clock
  motion.playing = true;
  motion.selected = -1;
  motionStart = performance.now() - motion.playhead * motion.durationMs;
  const tick = () => {
    if (!motion.playing) return;
    let p = (performance.now() - motionStart) / motion.durationMs;
    if (motion.loop) { p -= Math.floor(p); }
    else if (p >= 1) { renderSampled(1); haltPlayback(); loadPlayheadIntoState(); renderTimeline(); updateMotionUI(); return; }
    renderSampled(p);
    motionRaf = requestAnimationFrame(tick);
  };
  motionRaf = requestAnimationFrame(tick);
  updateMotionUI();
}
// Playback over a source video: the <video> is the master clock — it plays, and
// each frame we derive p from its currentTime, sample the params at p, and render
// (so params stay locked to the actual presented frame). Mirrors the live-camera
// loop with parameter sampling layered on.
function startVideoPlayback() {
  const v = env.sourceVideo;
  if (!v) return;
  _filmstripGen++;                 // cancel any in-flight thumbnail build before we drive the footage
  motion.playing = true;
  motion.selected = -1;
  const dur = (v.duration && isFinite(v.duration)) ? v.duration : 1;
  v.currentTime = pToMediaSec(v, motion.playhead >= 1 ? 0 : motion.playhead);
  v.loop = !!motion.loop;
  v.play().catch(() => {});
  const tick = () => {
    if (!motion.playing) return;
    if (!motion.loop && v.currentTime >= dur - 0.05) {   // ran off the end (non-loop)
      haltPlayback(); loadPlayheadIntoState(); renderTimeline(); updateMotionUI(); return;
    }
    let p = v.currentTime / dur;
    if (motion.loop) p -= Math.floor(p);
    engine.updateSourceFrame();
    Object.assign(state, sampleAt(p));
    if (engine && engine.getSourceImage()) { engine.render(state); if (session.isSwapped) drawMiniKaleidoscope(); }
    sourceOverlay.paintSourceVideo();
    sourceOverlay.render();
    setPlayhead(p);
    motionRaf = requestAnimationFrame(tick);
  };
  motionRaf = requestAnimationFrame(tick);
  updateMotionUI();
}
function stopPlayback() {
  haltPlayback();
  loadPlayheadIntoState();
  renderTimeline();
  updateMotionUI();
}

// ---- keyframe operations --------------------------------------------------
// keyframe 0 is the fixed start anchor (t=0). other "anchored" keyframes keep their
// hand-set t; the rest ("auto") distribute evenly within each gap between anchors
// (and between the last anchor and the loop end at t=1). Recomputed after any
// add / delete / drag / anchor-toggle.
function applyAutoSpacing() {
  const list = kfList();
  if (!list.length) return;
  list[0].t = 0;
  let i = 0;
  while (i < list.length) {
    let j = i + 1;
    while (j < list.length && !list[j].anchored) j++;
    const leftT = list[i].t;
    const rightT = j < list.length ? list[j].t : 1;
    const gaps = j - i;
    for (let k = i + 1; k < j; k++) list[k].t = leftT + (rightT - leftT) * (k - i) / gaps;
    i = j;
  }
}
function addKeyframe() {
  if (!engine || !engine.getSourceImage()) return;
  if (motion.playing) stopPlayback();
  // Commit any in-flight edit to the currently-selected keyframe BEFORE laying the
  // next one, so the just-edited keyframe is never left stale. (Daniel's diagnosis:
  // the old Build-97 "duplicate pause" was a missing save-on-add trigger, not
  // auto-select itself — so we keep auto-select and make the commit explicit.)
  if (motion.selected >= 0 && kfList()[motion.selected]) {
    kfList()[motion.selected].snap = { ...state };
  }
  const onIdx = keyframeAt(motion.playhead);
  const kf = { t: 0, snap: { ...state }, thumb: makeThumbCanvas(), anchored: false };
  let newIdx;
  if (kfList().length === 0) {
    kf.anchored = true;                          // keyframe 0 is the fixed start anchor
    kfList().push(kf);
    newIdx = 0;
  } else if (onIdx >= 0) {
    kfList().splice(onIdx + 1, 0, kf);           // insert after the keyframe at the scrubber
    newIdx = onIdx + 1;
  } else {
    let ins = kfList().findIndex(k => k.t > motion.playhead);   // keep the array in time order
    if (ins < 0) ins = kfList().length;
    kfList().splice(ins, 0, kf);
    newIdx = ins;
  }
  applyAutoSpacing();
  // "+keyframe" lays a new keyframe (a copy of the current look) after the current
  // one and AUTO-SELECTS it, so subsequent edits write through (autosave) to it —
  // duplicate-and-tweak. Adding without editing leaves an intentional hold.
  motion.selected = newIdx;
  setPlayhead(kfList()[newIdx].t);
  renderTimeline();                              // marker appears (blank thumb); also schedules the filmstrip
  updateMotionUI();
  if (env.sourceVideo) scrubVideo(kfList()[newIdx].t, { assignParams: false });   // footage follows the new keyframe's (auto-spaced) time
  // thumbnail fills on the debounced, readback-free filmstrip rebuild (no per-add readPixels)
}
// toggle the selected keyframe between anchored (fixed time) and auto (even-spaced).
function toggleAnchor() {
  const i = motion.selected >= 0 ? motion.selected : keyframeAt(motion.playhead);
  if (i <= 0) return;                            // keyframe 0 is always the start anchor; -1 = none
  kfList()[i].anchored = !kfList()[i].anchored;
  applyAutoSpacing();
  setPlayhead(kfList()[i].t);
  renderTimeline();
  updateMotionUI();
}
function deleteSelected() {
  const idx = motion.selected >= 0 ? motion.selected : keyframeAt(motion.playhead);
  if (idx < 0) return;
  kfList().splice(idx, 1);
  motion.selected = -1;
  applyAutoSpacing();                              // autos re-space to fill the gap
  if (kfList().length) loadPlayheadIntoState();
  renderTimeline();
  updateMotionUI();
}
function selectKeyframe(i) {
  if (i < 0 || i >= kfList().length) return;
  if (motion.playing) stopPlayback();
  motion.selected = i;
  setPlayhead(kfList()[i].t);
  Object.assign(state, kfList()[i].snap);
  // keep discrete fields consistent with keyframe 0 even if this keyframe was
  // captured under a different form (the animation already ignores its discrete;
  // this stops a stale-form keyframe from rendering broken on select). Full
  // cross-form transition handling is a backlog item.
  const k0 = kfList()[0].snap;
  for (const k of DISCRETE_KEYS) state[k] = k0[k];
  env.syncControls();
  env.scheduleOverlayDraw();
  env.scheduleRender();
  renderTimeline();
  updateMotionUI();
  // video: bring the footage to this keyframe's time too (params already loaded
  // from the snap — don't re-sample them, just seek the frame).
  if (env.sourceVideo) scrubVideo(kfList()[i].t, { assignParams: false });
}
function stepKeyframe(dir) {
  const list = kfList();
  if (!list.length) return;
  let target = -1;
  if (dir > 0) { for (let i = 0; i < list.length; i++) if (list[i].t > motion.playhead + KF_EPS) { target = i; break; } }
  else { for (let i = list.length - 1; i >= 0; i--) if (list[i].t < motion.playhead - KF_EPS) { target = i; break; } }
  if (target < 0) target = dir > 0 ? 0 : list.length - 1;   // wrap to the far end
  selectKeyframe(target);
}

// ---- filmstrip ------------------------------------------------------------
// a continuous strip of tween thumbnails rendered BEHIND the keyframe markers
// (non-interactive, no outlines), like a video editor's filmstrip. Rebuilt
// debounced on structural/edit changes; renders N sampled states synchronously to
// the preview canvas — the browser composites only once after the JS turn, so there
// is no on-screen flicker — captures each into one strip canvas, then restores the
// current frame.
let filmstripTimer = 0;
let lastFilmstripSig = '';
let _filmstripGen = 0, _filmstripBusy = false;   // async video-thumbnail build: cancellation + single-flight
function scheduleFilmstrip() {
  if (!motionActive) return;
  clearTimeout(filmstripTimer);
  filmstripTimer = setTimeout(buildFilmstrip, 600);   // wait for a real pause before rebuilding
}
// Build the strip via the engine CAPTURE path (render → drawImage to a 2D canvas),
// NOT readPixels: desktop Safari's FBO readback returns corrupt channel-swapped/
// banded frames here (the "blue cells"), and a GPU sync doesn't help because the
// readback itself is broken. Runs SYNCHRONOUSLY so the briefly-borrowed preview
// canvas never composites mid-build (no flicker); the preview is restored after. A
// content signature skips the rebuild when nothing relevant changed — e.g.
// scrubbing fires renderTimeline but leaves the keyframes/curve untouched, so it no
// longer needlessly rebuilds (and re-rolls the corruption). Refreshes the keyframe
// marker thumbnails in the same session, off the same readback-free path.
function buildFilmstrip() {
  const strip = document.getElementById('mfStrip');
  if (!strip) return;
  const track = document.getElementById('mfTrack');
  if (!track || motion.playing || motionScrubbing || !engine || !engine.getSourceImage() || !kfList().length) {
    strip.innerHTML = ''; lastFilmstripSig = ''; return;
  }
  const w = strip.clientWidth, h = strip.clientHeight;
  if (w < 2 || h < 2) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  const S = H;                                     // square frames, matching the keyframe thumbnails
  const n = Math.ceil(W / S);
  const fs = Math.min(H, 240);                     // small square render size (the "look")
  const multi = kfList().length >= 2;             // only ≥2 keyframes get the tween strip

  const sig = W + '|' + motion.smoothing + '|' + motion.loop + '|' + motion.durationMs + '|' +
    kfList().map(k => k.t.toFixed(4) + ':' + JSON.stringify(k.snap)).join(',');
  if (sig === lastFilmstripSig && (strip.firstChild || !multi || env.sourceVideo)) return;   // unchanged (e.g. scrub) — skip

  // Video source: each keyframe's thumbnail is the FOOTAGE at that keyframe's time,
  // which needs an async seek per keyframe (so it stays correct under add / edit /
  // auto-shift / drag). Handled separately; the tween strip is skipped for now.
  if (env.sourceVideo) {
    if (_filmstripBusy) { scheduleFilmstrip(); return; }   // one build at a time — retry after the current finishes
    buildFilmstripVideo(strip, sig);
    return;
  }

  let c = null;
  if (multi) {
    c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.style.cssText = 'width:100%;height:100%;display:block';
  }
  try {
    // one capture session renders the tween strip (≥2 kf) AND refreshes every marker
    // thumbnail — all via the readback-free drawImage path (no readPixels).
    engine.beginCapture(fs, fs);
    if (multi) {
      const cx = c.getContext('2d');
      for (let i = 0; i < n; i++) {
        cx.drawImage(engine.captureFrame(sampleAt(Math.min(1, (i * S + S / 2) / W))), i * S, 0, S, H);
      }
    }
    for (const kf of kfList()) {
      if (kf.thumb) kf.thumb.getContext('2d').drawImage(engine.captureFrame(kf.snap), 0, 0, kf.thumb.width, kf.thumb.height);
    }
  } finally {
    engine.endCapture();
    resizePreviewCanvas();                          // restore + repaint the live preview
  }
  strip.innerHTML = '';
  if (multi) strip.appendChild(c);                  // single keyframe = marker thumb only, no strip
  lastFilmstripSig = sig;
}

// Video source: refresh each keyframe's thumbnail by SEEKING the footage to that
// keyframe's time, then capturing (so thumbs are correct under add / edit / auto-
// shift / drag — the footage frame follows the keyframe's time, not the last edit).
// Async + single-flight (_filmstripBusy) + cancellable (_filmstripGen, bumped by
// scrub/playback). The preview is hidden during the build (captures resize + render
// the live GL canvas) and the footage is restored to the playhead after. The tween
// strip is skipped for video for now (it would need a seek per cell).
async function buildFilmstripVideo(strip, sig) {
  _filmstripBusy = true;
  const gen = ++_filmstripGen;
  const v = env.sourceVideo;
  const saved = v.currentTime;
  const list = [...kfList()];                       // snapshot (the array may mutate during awaits)
  const fs = 240;
  strip.innerHTML = '';                             // no tween strip for video yet — markers carry the thumbs
  // NOTE: we do NOT hide the preview canvas during the build — Firefox can drop the
  // WebGL drawing buffer for a non-composited canvas, which made the captures (and
  // thus the thumbnails) come back blank. The cost is a brief preview flicker as the
  // captures render at thumbnail size; resizePreviewCanvas() restores it after.
  engine.beginCapture(fs, fs);
  try {
    for (const kf of list) {
      if (gen !== _filmstripGen) return;            // superseded by a scrub / playback / newer build
      if (!kf.thumb) continue;
      await seekVideoTo(v, pToMediaSec(v, kf.t));
      if (gen !== _filmstripGen) return;
      engine.updateSourceFrame();
      kf.thumb.getContext('2d').drawImage(engine.captureFrame(kf.snap), 0, 0, kf.thumb.width, kf.thumb.height);
    }
    lastFilmstripSig = sig;
  } finally {
    engine.endCapture();
    if (gen === _filmstripGen) { await seekVideoTo(v, saved); engine.updateSourceFrame(); }   // restore (skip if cancelled — the canceller owns the frame)
    resizePreviewCanvas();
    _filmstripBusy = false;
  }
}

// ---- timeline rendering ---------------------------------------------------
// marker interaction: a click (no drag past threshold) selects; a horizontal drag
// retimes (keyframe 0 is the locked start anchor and only selects). Clamped between
// neighbors so dragging can't reorder.
function makeMarkerDraggable(m, i) {
  let down = null;
  m.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (motion.playing) stopPlayback();
    const track = document.getElementById('mfTrack');
    down = { x: e.clientX, moved: false, rect: track.getBoundingClientRect() };
    m.setPointerCapture?.(e.pointerId);
  });
  m.addEventListener('pointermove', (e) => {
    if (!down) return;
    if (!down.moved && Math.abs(e.clientX - down.x) < 3) return;
    down.moved = true;
    if (i === 0) return;                            // keyframe 0 stays at t=0 (start anchor)
    const list = kfList();
    const lo = list[i - 1].t + 0.01;
    const hi = (i < list.length - 1 ? list[i + 1].t : 1) - 0.01;
    const t = Math.max(lo, Math.min(hi, (e.clientX - down.rect.left) / down.rect.width));
    list[i].t = t;
    list[i].anchored = true;                        // a moved keyframe becomes a fixed anchor
    m.style.left = (t * 100) + '%';
    if (env.sourceVideo) { setPlayhead(t); scrubVideo(t); }   // video: show the footage at the drop position while dragging
    else if (motion.selected === i) setPlayhead(t);
  });
  const end = (e) => {
    if (!down) return;
    const wasDrag = down.moved;
    m.releasePointerCapture?.(e.pointerId);
    down = null;
    if (wasDrag) { applyAutoSpacing(); renderTimeline(); loadPlayheadIntoState(); updateMotionUI(); }
    else selectKeyframe(i);
  };
  m.addEventListener('pointerup', end);
  m.addEventListener('pointercancel', () => { down = null; });
}
function renderTimeline() {
  const markers = document.getElementById('mfMarkers');
  if (!markers) return;
  markers.innerHTML = '';
  const list = kfList();
  list.forEach((kf, i) => {
    const m = document.createElement('div');
    m.className = 'mf-marker' + (i === motion.selected ? ' selected' : '') + (kf.anchored ? ' anchored' : '');
    m.style.left = (kf.t * 100) + '%';
    if (kf.thumb) m.appendChild(kf.thumb);
    const pin = document.createElement('div');
    pin.className = 'mf-pin';
    m.appendChild(pin);
    makeMarkerDraggable(m, i);
    markers.appendChild(m);
  });
  // loop bookend: a faint return-to-kf0 marker at t=1 (shows kf0's thumbnail, so its
  // left edge is visible at the track end). a canvas can't live in two places, so
  // copy kf0's thumb into a fresh canvas for the ghost.
  if (motion.loop && list.length) {
    const g = document.createElement('div');
    g.className = 'mf-marker ghost';
    g.style.left = '100%';
    if (list[0].thumb) {
      const gc = document.createElement('canvas');
      gc.width = list[0].thumb.width; gc.height = list[0].thumb.height;
      gc.getContext('2d').drawImage(list[0].thumb, 0, 0);
      g.appendChild(gc);
    }
    const pin = document.createElement('div'); pin.className = 'mf-pin';
    g.appendChild(pin);
    markers.appendChild(g);
  }
  setPlayhead(motion.playhead);
  scheduleFilmstrip();
}

// ---- mode toggle + UI sync ------------------------------------------------
function toggleMotionMode() {
  if (!engine || !engine.getSourceImage() || isLive) return;
  motionActive = !motionActive;
  motion.selected = -1;          // never carry a stale selection across the toggle
                                 // (otherwise post-exit edits could write through to it)
  if (motionActive && env.sourceVideo) {
    // video: the timeline drives the footage — stop the free-run loop + pause, and
    // lock the loop duration to the clip length (the duration field is read-only then).
    stopSourceVideoPlayback();
    const d = env.sourceVideo.duration;
    if (d && isFinite(d)) motion.durationMs = Math.round(d * 1000);
  }
  if (!motionActive) haltPlayback();
  else if (!kfList().length) addKeyframe();   // QoL: enter motion mode with a keyframe of the current look
  else renderTimeline();                       // (re-entry keeps existing keyframes)
  if (!motionActive && env.sourceVideo) {
    // exiting motion on a video: resume free-run playback (video is "live" again)
    env.sourceVideo.play().catch(() => {});
    startLiveLoop();
  }
  updateMotionUI();
  // the footer changes the main-slot height — re-fit the preview canvas (which
  // also re-renders the working state, replacing any transient playback frame).
  requestAnimationFrame(() => {
    resizePreviewCanvas();
    sourceOverlay.render();
    if (motionActive && env.sourceVideo) scrubVideo(motion.playhead);   // show the playhead frame
  });
}

function updateMotionUI() {
  const available = !!(engine && engine.getSourceImage()) && !isLive;
  if (motionActive && !available) { motionActive = false; haltPlayback(); }

  const q = (id) => document.getElementById(id);
  const btn = q('motionBtn');
  if (btn) { btn.disabled = !available; btn.classList.toggle('active', motionActive); }
  const footer = q('motionFooter');
  if (footer) footer.hidden = !motionActive;
  // motion mode pins discrete fields to keyframe 0 — hide the form picker and
  // dim/disable the non-animatable controls (see body.motion rules in styles.css).
  // The starting keyframe (kf0) is seeded on entry, but discrete stays editable
  // while there's only ONE keyframe (refine the starting look); it locks once a
  // SECOND keyframe exists — i.e. the moment animating actually begins.
  document.body.classList.toggle('motion', motionActive && kfList().length >= 2);

  const n = kfList().length;
  const canDelete = motion.selected >= 0 || keyframeAt(motion.playhead) >= 0;
  if (q('mfAdd')) q('mfAdd').disabled = !available;
  if (q('mfDelete')) q('mfDelete').disabled = !canDelete;
  const aIdx = motion.selected >= 0 ? motion.selected : keyframeAt(motion.playhead);
  const selKf = aIdx > 0 ? kfList()[aIdx] : null;   // kf0 is always the start anchor
  if (q('mfAnchor')) { q('mfAnchor').disabled = !selKf; q('mfAnchor').classList.toggle('active', !!(selKf && selKf.anchored)); }
  if (q('mfPlay')) { q('mfPlay').disabled = n < 2; q('mfPlay').textContent = motion.playing ? 'pause' : 'play'; }
  if (q('mfRender')) q('mfRender').disabled = n < 2;
  if (q('mfPrev')) q('mfPrev').disabled = n < 1;
  if (q('mfNext')) q('mfNext').disabled = n < 1;
  q('mfLoop')?.classList.toggle('active', motion.loop);
  q('mfDurVal')?._sync?.();
  q('mfSmoothVal')?._sync?.();
}

// ---- motion data (JSON round-trip) ----------------------------------------
// Portable motion authoring: keyframes + settings, source-AGNOSTIC (stores the
// motion parameters, not the image), so loading applies the motion to whatever
// source is currently loaded. Lets a user preserve/share work across sessions
// without a backend.
function motionToJSON() {
  return JSON.stringify({
    format: 'fold-motion', version: 1, app: formatVersion(),
    durationMs: motion.durationMs, loop: motion.loop, smoothing: motion.smoothing,
    keyframes: kfList().map(k => ({ t: k.t, anchored: !!k.anchored, snap: { ...k.snap } })),
  });
}
function motionJSONBlob() { return new Blob([motionToJSON()], { type: 'application/json' }); }
function downloadMotionJSON() {
  if (!kfList().length) return;
  downloadBlob(motionJSONBlob(), (sourceFilename || 'animation') + '-motion.json');
}
// returns null on success, or an error string
function loadMotionFromJSON(text) {
  let o;
  try { o = JSON.parse(text); } catch { return 'not valid JSON'; }
  if (!o || o.format !== 'fold-motion' || !Array.isArray(o.keyframes) || !o.keyframes.length) return 'not a Fold motion file';
  motion.durationMs = Math.max(500, Math.min(600000, +o.durationMs || 30000));
  motion.loop = o.loop !== false;
  motion.smoothing = Math.max(0, Math.min(1, +o.smoothing || 0));
  motion.keyframes = o.keyframes.map(k => ({ t: +k.t || 0, anchored: !!k.anchored, snap: { ...k.snap }, thumb: makeThumbCanvas() }));
  motion.keyframes[0].anchored = true;          // kf0 is always the start anchor at t=0
  motion.selected = -1;
  applyAutoSpacing();
  setPlayhead(0);
  loadPlayheadIntoState();                       // adopt kf0's look (incl. discrete/form) into state
  applyFormControls(env);                        // sync the form picker + form-specific controls
  renderTimeline();
  updateMotionUI();
  scheduleFilmstrip();                           // regenerates thumbnails (readback-free)
  return null;
}

function wireMotion() {
  const byId = (id) => document.getElementById(id);
  byId('motionBtn')?.addEventListener('click', toggleMotionMode);
  byId('mfAdd')?.addEventListener('click', addKeyframe);
  byId('mfDelete')?.addEventListener('click', deleteSelected);
  byId('mfAnchor')?.addEventListener('click', toggleAnchor);
  byId('mfPrev')?.addEventListener('click', () => stepKeyframe(-1));
  byId('mfNext')?.addEventListener('click', () => stepKeyframe(1));
  byId('mfPlay')?.addEventListener('click', () => { if (motion.playing) stopPlayback(); else startPlayback(); });
  byId('mfLoop')?.addEventListener('click', () => { motion.loop = !motion.loop; renderTimeline(); updateMotionUI(); });

  // ⋯ motion-data menu — download / load the keyframes+settings as portable JSON.
  const moreMenu = byId('mfMoreMenu'), moreBtn = byId('mfMore');
  const closeMore = () => { if (moreMenu) moreMenu.hidden = true; document.removeEventListener('pointerdown', onMoreOutside); };
  function onMoreOutside(e) { if (!e.target.closest('#mfMoreMenu') && e.target !== moreBtn) closeMore(); }
  moreBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!moreMenu.hidden) { closeMore(); return; }
    moreMenu.hidden = false;
    const r = moreBtn.getBoundingClientRect();              // place above the button (footer is at the bottom)
    moreMenu.style.left = r.left + 'px';
    moreMenu.style.top = Math.max(8, r.top - moreMenu.offsetHeight - 6) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', onMoreOutside), 0);
  });
  byId('mfSaveData')?.addEventListener('click', () => { downloadMotionJSON(); closeMore(); });
  byId('mfLoadData')?.addEventListener('click', () => { byId('mfDataFile')?.click(); closeMore(); });
  byId('mfDataFile')?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    const err = loadMotionFromJSON(await f.text());
    if (err) alert(`Couldn't load motion data: ${err}`);   // rare (wrong file) — needs to be visible
  });

  // duration scrub field (DAW-style), in seconds (whole-animation length).
  makeScrubField(byId('mfDurVal'), {
    get: () => motion.durationMs / 1000,
    set: (v) => { if (env.sourceVideo) return; motion.durationMs = Math.max(0.5, Math.min(600, v)) * 1000; },  // locked to clip length for a video
    step: 0.5, fineStep: 0.1, coarseStep: 10, min: 0.5, max: 600,
    format: (v) => v.toFixed(1) + 's',
    parse: (s) => { const n = parseFloat(String(s).replace(/[s\s]/g, '')); return isNaN(n) ? null : n; },
  });

  // motion smoothing degree (0 = exact keyframes; higher relaxes jaggy keyframe
  // values toward a smoother path). Velocity-continuity through keyframes is always
  // on regardless — this only adds value-fudging for sloppy timing/placement.
  makeScrubField(byId('mfSmoothVal'), {
    get: () => Math.round(motion.smoothing * 100),
    set: (v) => { motion.smoothing = Math.max(0, Math.min(100, v)) / 100; },
    step: 5, fineStep: 1, coarseStep: 20, min: 0, max: 100,
    format: (v) => Math.round(v) + '%',
    parse: (s) => { const n = parseFloat(String(s).replace(/[%\s]/g, '')); return isNaN(n) ? null : n; },
    onChange: () => { if (!motion.playing) renderSampled(motion.playhead); scheduleFilmstrip(); },
  });

  // scrubber — drag on the track background (markers handle their own selection).
  const track = byId('mfTrack');
  if (track) {
    const scrubTo = (clientX) => {
      const r = track.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      if (env.sourceVideo) { setPlayhead(p); scrubVideo(p); }   // video: seek footage (coalesced) + params
      else renderSampled(p);
    };
    track.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.mf-marker') || !kfList().length) return;
      motionScrubbing = true;
      if (motion.playing) haltPlayback();
      track.setPointerCapture(e.pointerId);
      scrubTo(e.clientX);
      e.preventDefault();
    });
    track.addEventListener('pointermove', (e) => { if (motionScrubbing) scrubTo(e.clientX); });
    const end = (e) => {
      if (!motionScrubbing) return;
      motionScrubbing = false;
      track.releasePointerCapture?.(e.pointerId);
      loadPlayheadIntoState();
      renderTimeline();
      updateMotionUI();
    };
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
  }

  updateMotionUI();
}

// global output frame aspect (1:1 / 4:5 / 16:9) — reshapes the preview (WYSIWYG)
// and is inherited by still + video export.
function wireFrameAspect() {
  // two synced control groups: the canvas-group "frame" (always visible, for stills)
  // and the motion-footer one (near duration, for the animation workflow).
  const groups = ['frameAspect', 'mfFrame'].map((id) => document.getElementById(id)).filter(Boolean);
  if (!groups.length) return;
  const syncActive = () => groups.forEach((g) =>
    g.querySelectorAll('button').forEach((b) =>
      b.classList.toggle('active', Math.abs(parseFloat(b.dataset.asp) - session.frameAspect) < 0.001)));
  groups.forEach((g) =>
    g.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        session.frameAspect = parseFloat(b.dataset.asp) || 1;
        syncActive();
        resizePreviewCanvas();      // reshape the preview to the new frame (also re-renders)
        scheduleFilmstrip();
      })));
  syncActive();
}

// Frame source for video export, chosen per browser engine (Builds 130–132 A/B).
// All WebKit (Safari) is far faster wrapping the WebGL canvas directly in a
// VideoFrame than routing through a 2D canvas (whose 2D→VideoFrame conversion is
// very slow on WebKit): desktop Safari ~130 fps vs ~6 @4K, iPad M1 ~55 vs ~18
// (Daniel tested both). The VideoFrame-from-WebGL path that hung iPadOS in Build
// 115 is fixed on current iPadOS (stable over a 75s render). Firefox + Chromium
// are fast on — and Firefox slightly prefers — the 2D path, so WebGL-direct is
// used for ALL WebKit and 2D for everyone else. `?capture=2d|bitmap|gl` overrides
// (a safety hatch if some older iOS device still hangs on the WebGL path).
function defaultCaptureMode() {
  const q = new URLSearchParams(location.search).get('capture');
  if (q === '2d' || q === 'bitmap' || q === 'gl') return q;
  const ua = navigator.userAgent;
  const isWebKit = /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox|FxiOS|CriOS/.test(ua);
  return isWebKit ? 'gl' : '2d';
}

// ---- video export ---------------------------------------------------------
function setupVideoExport() {
  const byId = (id) => document.getElementById(id);
  const sheet = byId('vidSheet');
  if (!sheet) return;
  let selLong = 2560, selFps = 30, selCap = defaultCaptureMode(), cancelRender = false, rendering = false;

  // raw output dimensions for a given LONG side + current aspect (even, unclamped).
  const rawDims = (long) => {
    const a = session.frameAspect || 1;          // w/h
    let w, h;
    if (a >= 1) { w = long; h = Math.round(long / a); }   // square / landscape: long = width
    else { h = long; w = Math.round(long * a); }          // portrait (4:5): long = height
    w -= w % 2; h -= h % 2;                       // H.264/HEVC need even dimensions
    return { w, h };
  };
  // clamped to the GPU FBO ceiling — a defensive net; gating already disables
  // tiers this device can't render, so this is normally a no-op.
  const dims = () => {
    let { w, h } = rawDims(selLong);
    const cap = (engine && engine.diagnostics.maxFBOSize) || 4096;
    const m = Math.max(w, h);
    if (m > cap) { const s = cap / m; w = Math.round(w * s); h = Math.round(h * s); }
    w -= w % 2; h -= h % 2;
    return { w, h };
  };
  const frameCount = () => Math.max(2, Math.round((motion.durationMs / 1000) * selFps));
  const codecLabel = () => {
    const c = byId('vidRes')?.querySelector('button.active')?.dataset.codec;
    return c === 'hevc' ? ' · HEVC' : c === 'avc' ? ' · H.264' : '';
  };
  const refreshMeta = () => {
    const { w, h } = dims();
    const meta = byId('vidMeta');
    if (meta) meta.textContent = `${w}×${h} · ${frameCount()} frames · ${(motion.durationMs / 1000).toFixed(1)}s @ ${selFps}fps${codecLabel()}`;
  };

  // Enable only the resolution tiers this device can actually render AND encode.
  // Render limit = the probed FBO ceiling; encode limit = pickVideoCodec (H.264
  // <=4K, HEVC above where supported). Disabled tiers carry the reason in their
  // title; if the active tier becomes unsupported, fall back to a safe <=4K pick.
  async function gateResolutions() {
    const grp = byId('vidRes');
    if (!grp) return;
    const cap = (engine && engine.diagnostics.maxFBOSize) || 4096;
    const btns = [...grp.querySelectorAll('button')];
    await Promise.all(btns.map(async (b) => {
      const { w, h } = rawDims(parseInt(b.dataset.long, 10));
      const overFBO = Math.max(w, h) > cap;
      const codec = overFBO ? null : await pickVideoCodec(w, h, selFps);
      const ok = !overFBO && !!codec;
      b.disabled = !ok;
      b.dataset.codec = ok ? codec.muxerCodec : '';
      b.title = ok
        ? (codec.muxerCodec === 'hevc' ? 'HEVC (H.265)' : 'H.264')
        : (overFBO ? `exceeds this device's render limit (~${Math.round(cap / 1024)}K)` : `this browser can't encode ${w}×${h}`);
    }));
    const active = grp.querySelector('button.active');
    if (!active || active.disabled) {
      const supported = btns.filter((b) => !b.disabled);
      const safe = supported.filter((b) => parseInt(b.dataset.long, 10) <= 3840);
      const pick = safe[safe.length - 1] || supported[0] || btns[0];
      btns.forEach((x) => x.classList.toggle('active', x === pick));
      selLong = parseInt(pick.dataset.long, 10);
    }
    refreshMeta();
  }

  const wireGroup = (groupId, attr, set) => {
    const grp = byId(groupId);
    grp?.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        grp.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
        set(b.dataset[attr]);
        refreshMeta();
      });
    });
  };
  wireGroup('vidRes', 'long', (v) => { selLong = parseInt(v, 10); });
  wireGroup('vidFps', 'fps', (v) => { selFps = parseInt(v, 10); gateResolutions(); });

  function open() {
    if (kfList().length < 2) return;
    if (motion.playing) stopPlayback();
    const status = byId('vidStatus');
    const ok = videoExportSupported();
    status.textContent = ok ? '' : 'video export needs WebCodecs (Chrome, or Safari 16+ / iPadOS 16+).';
    status.className = ok ? 'status' : 'status error';
    byId('vidRenderBtn').disabled = !ok;
    refreshMeta();
    sheet.hidden = false;
    if (ok) gateResolutions();
  }
  function close() {
    cancelRender = true;                          // cancels an in-flight render
    if (!rendering) sheet.hidden = true;
  }

  byId('mfRender')?.addEventListener('click', open);
  byId('vidClose')?.addEventListener('click', close);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  byId('vidRenderBtn')?.addEventListener('click', async () => {
    const btn = byId('vidRenderBtn');
    if (btn.disabled || rendering) return;
    const { w, h } = dims();
    rendering = true; cancelRender = false;
    btn.disabled = true;
    const prog = byId('vidProgress'), bar = byId('vidBar'), status = byId('vidStatus');
    prog.hidden = false; bar.style.width = '0%';
    status.textContent = 'rendering…'; status.className = 'status busy';
    const renderStart = performance.now();
    const wantSource = byId('vidSourcePreview')?.checked;
    const base = sourceFilename || 'animation';
    try {
      // main kaleidoscope video (GL capture path)
      const { blob, frames, timing } = await exportVideo({
        width: w, height: h, fps: selFps, durationMs: motion.durationMs, captureMode: selCap,
        onBegin: () => engine.beginCapture(w, h),
        // a video source seeks the footage to p BEFORE capturing, so the clip
        // actually advances frame-by-frame in the render (frame-accurate export).
        frameAt: env.sourceVideo
          ? async (p) => { await advanceSourceToP(p); return selCap === 'gl' ? engine.captureFrameGL(sampleAt(p)) : engine.captureFrame(sampleAt(p)); }
          : (p) => selCap === 'gl' ? engine.captureFrameGL(sampleAt(p)) : engine.captureFrame(sampleAt(p)),
        onEnd: () => engine.endCapture(),
        onProgress: (p) => { bar.style.width = Math.round(p * (wantSource ? 50 : 100)) + '%'; },
        shouldCancel: () => cancelRender,
      });
      // optional companion "source preview" video → forces a .zip package
      const extras = [];
      if (wantSource) {
        status.textContent = 'rendering source preview…';
        const SP = 1920;   // square, capped
        const { blob: sblob } = await exportVideo({
          width: SP, height: SP, fps: selFps, durationMs: motion.durationMs,
          frameAt: env.sourceVideo
            ? async (p) => { await advanceSourceToP(p); return renderSourcePreviewFrame(sampleAt(p), SP); }
            : (p) => renderSourcePreviewFrame(sampleAt(p), SP),
          onProgress: (p) => { bar.style.width = Math.round(50 + p * 50) + '%'; },
          shouldCancel: () => cancelRender,
        });
        extras.push({ name: base + '-source.mp4', blob: sblob });
      }
      if (byId('vidMotionJSON')?.checked) {
        extras.push({ name: base + '-motion.json', blob: motionJSONBlob() });
      }
      if (extras.length) {
        const zipBlob = await zipStore([{ name: base + '.mp4', blob }, ...extras]);
        downloadBlob(zipBlob, base + '-package.zip');
      } else {
        downloadBlob(blob, base + '.mp4');
      }
      const secs = (performance.now() - renderStart) / 1000;
      // render duration + effective throughput (frames rendered per wall-second — a
      // device/perf diagnostic, distinct from the output fps).
      const rate = frames ? ` · ${(frames / secs).toFixed(0)} frames/s` : '';
      // per-stage timing reader — localizes the single-threaded export bottleneck
      // (gl render+capture vs VideoFrame convert vs sequential encode). See BACKLOG
      // "[HIGH PRI] Export throughput ceiling".
      let diag = '';
      if (timing && timing.frames) {
        const f = timing.frames;
        const gl = timing.glMs / f, vf = timing.vfMs / f, enc = timing.encMs / f;
        diag = ` · /frame: gl ${gl.toFixed(0)} · vframe ${vf.toFixed(0)} · encode ${enc.toFixed(0)} ms`;
        console.log('[video-export] per-frame ms:', { mode: selCap, gl: +gl.toFixed(1), vframe: +vf.toFixed(1), encode: +enc.toFixed(1), frames: f, totalSecs: +secs.toFixed(1) });
      }
      status.textContent = `saved ✓ · rendered in ${secs.toFixed(1)}s${rate}${diag}`; status.className = 'status success';
    } catch (e) {
      if (e.code === 'cancelled') { status.textContent = 'cancelled'; status.className = 'status'; }
      else { status.textContent = e.message || 'render failed'; status.className = 'status error'; console.error(e); }
    } finally {
      rendering = false; btn.disabled = false; prog.hidden = true;
      if (cancelRender) sheet.hidden = true;
      resizePreviewCanvas();   // the capture session resized the GL canvas — restore + repaint the preview
      if (env.sourceVideo) scrubVideo(motion.playhead);   // restore the footage to the playhead (export left it at the last frame)
    }
  });
}

// ============================================================================
// init
// ============================================================================

if (engine) {
  buildFormGrid(env);
  applyFormControls(env);
  wireControls();
  wireCamera();
  setupDivider(env);
  createOutputGestures(previewCanvas, {
    state,
    onChange: () => { scheduleSyncControls(); env.scheduleRender(); },
    onCommitStart: () => env.pushHistory(),
    onCommitEnd: () => updateUndoUI(),
  });
  setupUndoBar();
  wireFrameAspect();
  wireMotion();
  setupVideoExport();
  wireDiagnosticButton(engine, () => state);

  window.addEventListener('resize', () => {
    resizePreviewCanvas();
    if (session.isSwapped) arrangeSlots();
    sourceOverlay.render();
    scheduleFilmstrip();
  });
}
