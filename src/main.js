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
  buildFormGrid,
  applyFormControls,
  setupDivider,
  makeControlsSync,
} from './shell/controls.js';
import { formatVersion } from './version.js';

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

let engine;
try {
  engine = createEngine({ canvas: previewCanvas });
  diagEl.innerHTML = `WebGL2 ok<br>renderer: ${engine.diagnostics.renderer}<br>max texture: ${engine.diagnostics.maxTextureSize}px<br>max export: ${engine.diagnostics.maxFBOSize}px`;
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

  // syncers / methods — defined below
  controlsSync,
  scheduleRender: null,
  scheduleOverlayDraw: null,
  syncControls: () => controlsSync.syncAll(),
  applyFormControls: () => applyFormControls(env),
  resizePreviewCanvas: null,
  arrangeSlots: null,
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
  const url = URL.createObjectURL(file);
  sourceFilename = (file.name || 'image').replace(/\.[^.]+$/, '');
  const img = new Image();
  img.onload = () => {
    try {
      engine.setSource(img);
    } catch (e) {
      // engine throws with a descriptive message (e.g. "image too large for
      // GPU: 18000×18000 (max 16384×16384 on this device)"). surface verbatim.
      statusEl.textContent = e.message;
      statusEl.classList.add('error');
      console.error(e);
      return;
    }

    document.getElementById('sourceMeta').children[0].textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
    document.getElementById('sourceMeta').children[1].textContent = file.name;
    document.getElementById('swapBtn').disabled = false;

    statusEl.textContent = `loaded ${img.naturalWidth}×${img.naturalHeight}`;
    statusEl.classList.remove('error', 'busy');

    arrangeSlots();
  };
  img.onerror = () => {
    statusEl.textContent = 'failed to load image';
    statusEl.classList.add('error');
  };
  img.src = url;
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
  setBusy(`rendering ${size}×${size}…`);
  await new Promise(r => requestAnimationFrame(r));

  let result;
  try {
    result = await engine.exportAt(state, sizeArg, session.exportFormat);
  } catch (e) {
    statusEl.textContent = e.message;
    statusEl.classList.add('error');
    statusEl.classList.remove('busy');
    clearBusy();
    // restore preview render
    engine.render(state);
    console.error(e);
    return;
  }

  const { blob, size: sz, renderMs, readMs, encodeMs } = result;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = buildFilename(sz);
  a.click();
  URL.revokeObjectURL(url);

  // restore preview render
  engine.render(state);

  statusEl.textContent = `exported ${sz}×${sz} • ${session.exportFormat} • render ${renderMs.toFixed(0)}ms • read ${readMs.toFixed(0)}ms • encode ${encodeMs.toFixed(0)}ms • ${(blob.size / 1024 / 1024).toFixed(1)}MB`;
  statusEl.classList.remove('busy');
  statusEl.classList.add('success');
  clearBusy();
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
// wire all controls
// ============================================================================

function wireControls() {
  // segments — even integers
  wireSliderWithScrub(env, 'segments', 'segVal', 'segments', {
    min: 2, max: 48, step: 2, scrubStep: 2,
    fmt: v => String(Math.round(v)),
    parse: s => {
      const n = parseInt(s);
      if (isNaN(n)) return null;
      return Math.max(2, Math.min(48, Math.round(n / 2) * 2));
    },
  });

  // scale
  wireSliderWithScrub(env, 'scale', 'scaleVal', 'sliceScale', {
    min: 0.05, max: 3, step: 0.005, scrubStep: 0.01,
    fmt: v => v.toFixed(2) + '×',
    parse: s => {
      const cleaned = s.replace(/[×x*]/g, '').trim();
      const n = parseFloat(cleaned);
      return isNaN(n) ? null : n;
    },
  });

  // composition zoom
  wireSliderWithScrub(env, 'compZoom', 'compZoomVal', 'canvasZoom', {
    min: 0.25, max: 4, step: 0.01, scrubStep: 0.05,
    fmt: v => v.toFixed(2) + '×',
    parse: s => {
      const cleaned = s.replace(/[×x*]/g, '').trim();
      const n = parseFloat(cleaned);
      return isNaN(n) ? null : n;
    },
  });

  // slice rotation
  wireSliderWithScrub(env, 'sliceRot', 'sliceRotVal', 'sliceRotation', {
    min: 0, max: 360, step: 0.5, scrubStep: 1,
    fmt: v => v.toFixed(1) + '°',
    parse: s => {
      const cleaned = s.replace(/°/g, '').trim();
      const n = parseFloat(cleaned);
      return isNaN(n) ? null : n;
    },
    wrap: 360,
  });

  // square aspect
  wireSliderWithScrub(env, 'aspect', 'aspectVal', 'squareAspect', {
    min: 0.25, max: 4, step: 0.01, scrubStep: 0.02,
    fmt: v => v.toFixed(2),
    parse: s => {
      const n = parseFloat(s);
      return isNaN(n) ? null : n;
    },
  });

  // canvas rotation
  wireSliderWithScrub(env, 'canvasRot', 'canvasRotVal', 'canvasRotation', {
    min: 0, max: 360, step: 0.5, scrubStep: 1,
    fmt: v => v.toFixed(1) + '°',
    parse: s => {
      const cleaned = s.replace(/°/g, '').trim();
      const n = parseFloat(cleaned);
      return isNaN(n) ? null : n;
    },
    wrap: 360,
  });

  // OOB modes
  document.querySelectorAll('#oobModes button').forEach(btn => {
    btn.addEventListener('click', () => {
      state.oobMode = parseInt(btn.dataset.oob);
      document.querySelectorAll('#oobModes button').forEach(b => b.classList.toggle('active', b === btn));
      scheduleRender();
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

  // explicit Export button — the action
  document.getElementById('exportBtn').addEventListener('click', () => {
    doExport(session.exportSize);
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
    else {
      statusEl.textContent = `unsupported format: ${file.type || 'unknown'} — use jpg, png, or webp`;
      statusEl.classList.add('error');
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
    env.state.canvasZoom     = Math.max(0.25, Math.min(4, pinch.startZoom * (dist / pinch.startDist)));
    const da                 = (angle - pinch.startAngle) * 180 / Math.PI;
    env.state.canvasRotation = ((pinch.startRotation + da) % 360 + 360) % 360;
    env.syncControls();
    env.scheduleRender();
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    if (e.touches.length < 2) pinch = null;
  });
}

// ============================================================================
// init
// ============================================================================

if (engine) {
  buildFormGrid(env);
  applyFormControls(env);
  wireControls();
  setupDivider(env);
  setupPreviewGestures(env);

  window.addEventListener('resize', () => {
    resizePreviewCanvas();
    if (session.isSwapped) arrangeSlots();
    drawSourceOverlay(env);
  });
}
