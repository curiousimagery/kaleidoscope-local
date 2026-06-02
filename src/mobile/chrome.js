// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// mobile/chrome.js
//
// The mobile chrome — a phone-class arrangement that MOUNTS THE SAME components
// as desktop (source-overlay, output gestures, registry-rendered controls),
// parameterized not forked. It owns only layout: two stacked regions (OUTPUT
// top, CONTEXT bottom) split by a fat sticky divider, a context panel that
// flips between SOURCE (the overlay) and SETTINGS (registry controls), and a
// bottom tab bar.
//
// This first increment covers the still-editor path (upload → edit → export).
// Camera, source/form popovers, and the export sheet are the next increment;
// undo/redo is out of scope on mobile (the component commit hooks stay unwired).

import './styles.css';
import { createEngine, getActiveForm } from '../engine/index.js';
import { FORMS } from '../engine/forms/index.js';
import { state, session } from '../shell/state.js';
import { makeControlsSync } from '../shell/controls.js';
import { createSourceOverlay } from '../components/source-overlay.js';
import { createOutputGestures } from '../components/output-gestures.js';
import { mountRangeControl } from '../components/param-control.js';
import { PARAMS, DECLARATIVE_PARAM_IDS } from '../shell/params.js';
import { formatVersion } from '../version.js';
import { createCamera } from '../shell/camera.js';
import { ICONS } from './icons.js';
import { applyArmsSnap, snapSpiralValue } from '../kit/snaps.js';
import { zipStore } from '../shell/zip.js';

// (The desktop stylesheet is dropped in boot.js before this module loads.)

// ---------------------------------------------------------------- DOM scaffold
document.body.innerHTML = `
  <div id="m-root">
    <div id="m-output">
      <div id="m-empty">tap&nbsp;<b>+</b>&nbsp;to&nbsp;begin</div>
      <button id="m-flip" class="m-icon-btn" title="flip camera" style="display:none">${ICONS.flip}</button>
    </div>
    <div id="m-divider"></div>
    <div id="m-context">
      <button id="m-context-toggle" title="source / settings">${ICONS.sliders}</button>
      <button id="m-fit-toggle" title="fill / fit">${ICONS.contract}</button>
      <div id="m-source"></div>
      <div id="m-settings" class="m-hidden"></div>
    </div>
    <div id="m-tabbar">
      <button id="m-tab-source" class="m-tab" title="source">${ICONS.plus}</button>
      <button id="m-tab-form" class="m-tab" title="form"></button>
      <button id="m-tab-export" class="m-tab" title="save">${ICONS.download}</button>
      <button id="m-tab-capture" class="m-tab" title="capture" style="display:none">${ICONS.captureCam}</button>
    </div>
    <input type="file" class="m-file-input" id="m-file" accept="image/jpeg,image/png,image/webp">
    <input type="file" class="m-file-input" id="m-file-still" accept="image/*" capture="environment">
  </div>`;

const $ = (id) => document.getElementById(id);
const rootEl = $('m-root'), outputEl = $('m-output'), dividerEl = $('m-divider');
const contextEl = $('m-context'), sourceEl = $('m-source'), settingsEl = $('m-settings');
const emptyEl = $('m-empty'), tabbarEl = $('m-tabbar');

// ---------------------------------------------------------------- engine + env
const outputCanvas = document.createElement('canvas');
outputEl.appendChild(outputCanvas);

let engine;
try {
  // Cap the FBO probe so an iPhone doesn't attempt 8K/16K allocations on init.
  engine = createEngine({ canvas: outputCanvas, maxProbeSize: 4096 });
} catch (e) {
  emptyEl.textContent = e.message;
  throw e;
}

const controlsSync = makeControlsSync();
const env = {
  state, session, engine,
  controlsSync,
  scheduleRender: null,                       // set below
  syncControls: () => controlsSync.syncAll(),
  // mobile undo/redo is out of scope: no pushHistory / updateUndoUI.
};

let renderScheduled = false;
function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    if (engine.getSourceImage()) engine.render(state);
    sourceOverlay.render();
  });
}
env.scheduleRender = scheduleRender;

// ----------------------------------------------------------------- components
const camera = createCamera();
let liveVideo = null;          // the camera <video> while live; null otherwise

const sourceOverlay = createSourceOverlay({
  state, engine,
  getLiveVideo: () => liveVideo,
  syncControls: () => controlsSync.syncAll(),
  scheduleRender,
  fit: 'cover',                 // mobile fills the panel by default (no side gutters)
});

createOutputGestures(outputCanvas, {
  state,
  onChange: () => { controlsSync.syncAll(); scheduleRender(); },
});

// ------------------------------------------------------------ settings (State B)
settingsEl.innerHTML = '<h2>settings</h2>';
mountSegmentsControl();
for (const id of DECLARATIVE_PARAM_IDS) {
  mountRangeControl(settingsEl, PARAMS[id], env);
}
mountSpiralControl();
mountToggleControl('mirror', 'drosteMirror', 'tier mirror');
mountToggleControl('wedgeMirror', 'drosteWedgeMirror', 'wedge mirror');
// Out-of-bounds mode (clamp / mirror / transparent) — a stateful 3-way toggle,
// not a range, so it's rendered directly here rather than via mountRangeControl.
(function mountOobControl() {
  const wrap = document.createElement('div');
  wrap.className = 'm-control';
  wrap.innerHTML = '<div class="m-control-row"><span>out of bounds</span></div>';
  const seg = document.createElement('div');
  seg.className = 'm-seg';
  const btns = [['clamp', 0], ['mirror', 1], ['transparent', 2]].map(([label, val]) => {
    const b = document.createElement('button');
    b.className = 'm-seg-btn';
    b.textContent = label;
    b.addEventListener('click', () => { state.oobMode = val; sync(); scheduleRender(); });
    seg.appendChild(b);
    return [b, val];
  });
  function sync() { btns.forEach(([b, v]) => b.classList.toggle('active', state.oobMode === v)); }
  wrap.appendChild(seg);
  settingsEl.appendChild(wrap);
  controlsSync.register(sync);
  sync();
})();

const resetBtn = document.createElement('button');
resetBtn.id = 'm-reset';
resetBtn.textContent = 'reset slice';
resetBtn.addEventListener('click', () => {
  state.sliceScale = 1.0; state.sliceRotation = 0; state.sliceCx = 0.5; state.sliceCy = 0.5;
  state.squareAspect = 1.0; state.drosteZoom = 2.0; state.canvasZoom = 1.0; state.canvasRotation = 0;
  controlsSync.syncAll(); scheduleRender(); sourceOverlay.scheduleDraw();
});
settingsEl.appendChild(resetBtn);

// build/version readout (useful while testing on a phone where there's no footer)
const ver = document.createElement('div');
ver.id = 'm-version';
ver.textContent = formatVersion();
settingsEl.appendChild(ver);

// Stateful settings controls (not declarative ranges): segments (form-routed),
// droste spiral, and the mirror toggles. Behavior/snap is shared with desktop
// via kit/snaps.js; only the touch DOM is built here.
function mountSegmentsControl() {
  const wrap = document.createElement('label');
  wrap.className = 'm-control'; wrap.id = 'segmentsLabel';
  wrap.innerHTML = '<div class="m-control-row"><span>segments</span><span class="m-control-val" id="m-segv"></span></div><input type="range" id="m-seg">';
  settingsEl.appendChild(wrap);
  const seg = wrap.querySelector('#m-seg'), val = wrap.querySelector('#m-segv');
  const key = () => (state.form === 'droste' ? 'drosteArms' : 'segments');
  const snap = (v) => (state.form === 'droste'
    ? (v < 1.5 ? 1 : Math.max(2, Math.min(12, Math.round(v / 2) * 2)))
    : Math.max(2, Math.min(48, Math.round(v / 2) * 2)));
  function sync() {
    const d = state.form === 'droste';
    seg.min = d ? 1 : 2; seg.max = d ? 12 : 48; seg.step = d ? 1 : 2;
    seg.value = state[key()]; val.textContent = String(Math.round(state[key()]));
  }
  seg.addEventListener('input', () => {
    state[key()] = snap(parseFloat(seg.value));
    if (state.form === 'droste') applyArmsSnap(state);
    sync(); if (state.form === 'droste') controlsSync.syncAll();
    scheduleRender(); sourceOverlay.scheduleDraw();
  });
  controlsSync.register(sync); sync();
}
function mountSpiralControl() {
  const wrap = document.createElement('label');
  wrap.className = 'm-control'; wrap.id = 'spiralLabel';
  wrap.innerHTML = '<div class="m-control-row"><span>spiral</span><span class="m-control-val" id="m-spiv"></span></div><input type="range" id="m-spi" min="0" max="6" step="0.001">';
  settingsEl.appendChild(wrap);
  const spi = wrap.querySelector('#m-spi'), val = wrap.querySelector('#m-spiv');
  function sync() { spi.value = state.drosteSpiral; val.textContent = (state.drosteSpiral || 0).toFixed(2); }
  spi.addEventListener('input', () => {
    state.drosteSpiral = snapSpiralValue(state, parseFloat(spi.value));
    sync(); scheduleRender(); sourceOverlay.scheduleDraw();
  });
  controlsSync.register(sync); sync();
}
function mountToggleControl(labelId, key, label) {
  const wrap = document.createElement('label');
  wrap.className = 'm-control'; wrap.id = labelId + 'Label';
  wrap.innerHTML = `<div class="m-control-row"><span>${label}</span></div>`;
  const seg = document.createElement('div'); seg.className = 'm-seg';
  const btns = [['off', false], ['on', true]].map(([t, v]) => {
    const b = document.createElement('button'); b.className = 'm-seg-btn'; b.textContent = t;
    b.addEventListener('click', () => { state[key] = v; sync(); scheduleRender(); sourceOverlay.scheduleDraw(); });
    seg.appendChild(b); return [b, v];
  });
  function sync() { btns.forEach(([b, v]) => b.classList.toggle('active', (state[key] !== false) === v)); }
  wrap.appendChild(seg); settingsEl.appendChild(wrap);
  controlsSync.register(sync); sync();
}

// Form-aware control visibility. A control shows when its `formControl` is null
// (universal) or in the active form's `controls` list. Registered with
// controlsSync so a form switch refreshes it.
const STATEFUL_VIS = [['segmentsLabel', 'segments'], ['spiralLabel', 'spiral'], ['mirrorLabel', 'mirror'], ['wedgeMirrorLabel', 'wedgeMirror']];
function applyFormVisibility() {
  const form = getActiveForm(state);
  for (const id of DECLARATIVE_PARAM_IDS) {
    const p = PARAMS[id];
    const labelEl = $(p.sliderId + 'Label');
    if (labelEl) labelEl.classList.toggle('m-hidden', !(!p.formControl || form.controls.includes(p.formControl)));
  }
  for (const [labelId, fc] of STATEFUL_VIS) {
    const el = $(labelId);
    if (!el) continue;
    let vis = form.controls.includes(fc);
    if (fc === 'wedgeMirror' && vis) vis = Math.round(state.drosteArms || 1) > 1;  // hide at arms=1
    el.classList.toggle('m-hidden', !vis);
  }
}
controlsSync.register(applyFormVisibility);
applyFormVisibility();

// --------------------------------------------------------------- tab-bar icons
// Tab icons reflect the current selection (per Daniel's tab-bar spec).
function setSourceIcon(type) {
  const map = { none: ICONS.plus, file: ICONS.folder, still: ICONS.camera, live: ICONS.record };
  $('m-tab-source').innerHTML = map[type] || ICONS.plus;
}
function setFormIcon() { $('m-tab-form').innerHTML = getActiveForm(state).thumbnail; }
setSourceIcon('none');
setFormIcon();

// ------------------------------------------------------------- context A/B flip
let showingSettings = false;
function setContext(settings) {
  showingSettings = settings;
  sourceEl.classList.toggle('m-hidden', settings);
  settingsEl.classList.toggle('m-hidden', !settings);
  // show the icon of the mode you'll switch TO: sliders (→ settings) / target (→ direct manip)
  $('m-context-toggle').innerHTML = settings ? ICONS.target : ICONS.sliders;
  if (!settings) sourceOverlay.render();      // re-draw overlay (it was zero-sized while hidden)
}
$('m-context-toggle').addEventListener('click', () => setContext(!showingSettings));

// fill ↔ fit toggle (top-right of the source panel): cover crops to fill, contain
// shows the whole sensor. Icon shows the action you'll take.
$('m-fit-toggle').addEventListener('click', () => {
  if (!engine.getSourceImage()) return;
  const next = sourceOverlay.getFit() === 'cover' ? 'contain' : 'cover';
  sourceOverlay.setFit(next);
  $('m-fit-toggle').innerHTML = next === 'cover' ? ICONS.contract : ICONS.expand;
  sourceOverlay.render();
});

// ------------------------------------------------------------------- tab bar
$('m-tab-source').addEventListener('click', () => showSourceMenu());
$('m-tab-form').addEventListener('click', () => showFormMenu());
$('m-file').addEventListener('change', (e) => { if (e.target.files[0]) loadImage(e.target.files[0], 'file'); });
$('m-file-still').addEventListener('change', (e) => { if (e.target.files[0]) loadImage(e.target.files[0], 'still'); });
// null state: tapping the output opens the source menu
outputEl.addEventListener('click', (e) => {
  if (!engine.getSourceImage() && !e.target.closest('#m-flip')) showSourceMenu();
});

$('m-tab-export').addEventListener('click', () => { if (engine.getSourceImage()) openSaveSheet(); });

// ----------------------------------------------------------------- source load
let sourceFilename = '';
let originalSource = null;   // { blob, name } — bundled into "save package"
function loadImage(file, sourceType = 'file') {
  stopCameraStream();
  cameraMode = 'off';
  updateLiveUI();
  const url = URL.createObjectURL(file);
  sourceFilename = (file.name || 'image').replace(/\.[^.]+$/, '');
  originalSource = { blob: file, name: file.name || 'original.png' };
  const img = new Image();
  img.onload = () => {
    engine.setSource(img);
    setSourceIcon(sourceType);                 // folder (file) or camera (still)
    emptyEl.classList.add('m-hidden');
    setContext(false);                         // show SOURCE state
    sourceOverlay.mount(sourceEl);
    sizeOutput();
    scheduleRender();
  };
  img.src = url;
}

// ------------------------------------------------------------------- live camera
let cameraMode = 'off';        // 'off' | 'live' | 'frozen'
let liveActive = false, liveRaf = 0;

function startLiveLoop() {
  if (liveActive) return;
  liveActive = true;
  const tick = () => {
    if (!liveActive) return;
    camera.refreshFrame();                     // front camera: redraw mirrored frame
    engine.updateSourceFrame();
    engine.render(state);
    sourceOverlay.render();
    liveRaf = requestAnimationFrame(tick);
  };
  liveRaf = requestAnimationFrame(tick);
}
function stopLiveLoop() {
  liveActive = false;
  if (liveRaf) { cancelAnimationFrame(liveRaf); liveRaf = 0; }
}
function stopCameraStream() {
  stopLiveLoop();
  camera.stop();
  liveVideo = null;
}

function updateLiveUI() {
  const cap = $('m-tab-capture'), flip = $('m-flip');
  if (cameraMode === 'live') {
    cap.style.display = ''; cap.innerHTML = ICONS.captureCam; cap.title = 'capture'; cap.style.color = '';
    flip.style.display = ''; setSourceIcon('live');
  } else if (cameraMode === 'frozen') {
    // still "in" live capture, just paused: go-live record is RED (actionable),
    // and the SOURCE icon stays the live record (mental model: paused, not a new still).
    cap.style.display = ''; cap.innerHTML = ICONS.record; cap.title = 'go live'; cap.style.color = '#e8504a';
    flip.style.display = 'none'; setSourceIcon('live');
  } else {
    cap.style.display = 'none'; flip.style.display = 'none'; cap.style.color = '';
  }
}

function cameraErrorMessage(e) {
  if (e?.name === 'NotAllowedError') return 'camera permission denied — allow access and retry';
  if (e?.name === 'NotFoundError') return 'no camera found';
  return 'could not start camera';
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    emptyEl.textContent = 'camera needs a secure context (https or localhost)';
    emptyEl.classList.remove('m-hidden');
    return;
  }
  try {
    const video = await camera.start('environment');   // rear default on phones
    liveVideo = video;
    console.log(`[camera] granted resolution ${video.videoWidth}×${video.videoHeight}`);
    engine.setSource(camera.frameSource());
  } catch (e) {
    liveVideo = null;
    emptyEl.textContent = cameraErrorMessage(e);
    emptyEl.classList.remove('m-hidden');
    return;
  }
  sourceFilename = 'camera';
  cameraMode = 'live';
  emptyEl.classList.add('m-hidden');
  setContext(false);
  sourceOverlay.mount(sourceEl);
  sizeOutput();
  updateLiveUI();
  startLiveLoop();
}

// capture: freeze the current frame as the editable still (mirrored to match the
// front-camera preview). Camera stops; the same control becomes "go live".
function captureFrame() {
  const video = camera.getVideo();
  if (!video || !video.videoWidth) return;
  const w = video.videoWidth, h = video.videoHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d');
  if (camera.isFront()) { cx.translate(w, 0); cx.scale(-1, 1); }
  cx.drawImage(video, 0, 0, w, h);
  stopCameraStream();
  cameraMode = 'frozen';
  updateLiveUI();
  c.toBlob((blob) => {
    if (!blob) return;
    originalSource = { blob, name: `${sourceFilename}-original.jpg` };
    const img = new Image();
    img.onload = () => {
      engine.setSource(img);
      setContext(false);
      sourceOverlay.mount(sourceEl);
      scheduleRender();
    };
    img.src = URL.createObjectURL(blob);
  }, 'image/jpeg', 0.95);
}

async function flipCamera() {
  if (cameraMode !== 'live') return;
  try {
    const video = await camera.flip();
    liveVideo = video;
    engine.setSource(camera.frameSource());
    sourceOverlay.mount(sourceEl);             // remount picks up the mirror transform
  } catch (e) { console.error(e); }
}

$('m-tab-capture').addEventListener('click', () => {
  if (cameraMode === 'live') captureFrame();
  else if (cameraMode === 'frozen') startCamera();   // "go live"
});
$('m-flip').addEventListener('click', flipCamera);

// ----------------------------------------------------------------- tab popovers
// items: { icon, iconClass?, label, action, current? }
function showMenu(items, anchorId) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'm-menu';
  menu.id = 'm-menu';
  menu.dataset.anchor = anchorId;
  items.forEach((it) => {
    const b = document.createElement('button');
    b.className = 'm-menu-item' + (it.current ? ' current' : '');
    b.innerHTML = `<span class="m-menu-icon ${it.iconClass || ''}">${it.icon || ''}</span>` +
                  `<span class="m-menu-label">${it.label}</span>`;
    b.addEventListener('click', () => { closeMenu(); it.action(); });
    menu.appendChild(b);
  });
  rootEl.appendChild(menu);
  setTimeout(() => document.addEventListener('pointerdown', onMenuOutside), 0);
}
function onMenuOutside(e) {
  const m = document.getElementById('m-menu');
  if (!m) return;
  if (!e.target.closest('#m-menu') && !e.target.closest('#' + m.dataset.anchor)) closeMenu();
}
function closeMenu() {
  document.getElementById('m-menu')?.remove();
  document.removeEventListener('pointerdown', onMenuOutside);
}

// source menu — three capability-distinct entries (iOS collapses photo-library
// vs choose-file into the same system sheet, so they're one item). "take still"
// uses the native camera (full-res) via the capture-attribute file input.
function showSourceMenu() {
  showMenu([
    { icon: ICONS.record, iconClass: 'm-icon-record', label: 'live camera', action: startCamera },
    { icon: ICONS.camera, label: 'take still', action: () => $('m-file-still').click() },
    { icon: ICONS.photo, label: 'choose photo / file', action: () => $('m-file').click() },
  ], 'm-tab-source');
}

function showFormMenu() {
  showMenu(FORMS.map((f) => ({
    icon: f.thumbnail, label: f.label, current: f.id === state.form,
    action: () => selectForm(f.id),
  })), 'm-tab-form');
}
function selectForm(id) {
  state.form = id;
  controlsSync.syncAll();
  applyFormVisibility();
  scheduleRender();
  sourceOverlay.scheduleDraw();
  setFormIcon();
}

// ------------------------------------------------------------- layout + sizing
let ratio = 0.5;                               // OUTPUT fraction of the split area
function layout() {
  const availH = rootEl.clientHeight - tabbarEl.offsetHeight - dividerEl.offsetHeight;
  outputEl.style.height = Math.round(ratio * availH) + 'px';   // context flex:1 fills the rest
  sizeOutput();
  sourceOverlay.scheduleDraw();
}
function sizeOutput() {
  const w = outputEl.clientWidth, h = outputEl.clientHeight;
  if (w === 0 || h === 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const css = Math.max(1, Math.min(w, h));
  const target = Math.max(1, Math.min(2048, Math.floor(css * dpr)));
  if (outputCanvas.width !== target) { outputCanvas.width = target; outputCanvas.height = target; }
  outputCanvas.style.width = css + 'px';
  outputCanvas.style.height = css + 'px';
  if (engine.getSourceImage()) scheduleRender();
}

// ------------------------------------------------------------- divider gestures
(function setupDivider() {
  let dragging = false;
  function onDown(e) { dragging = true; dividerEl.classList.add('dragging'); e.preventDefault(); }
  function onMove(e) {
    if (!dragging) return;
    const y = (e.touches ? e.touches[0].clientY : e.clientY);
    const availH = rootEl.clientHeight - tabbarEl.offsetHeight - dividerEl.offsetHeight;
    const top = rootEl.getBoundingClientRect().top;
    let r = (y - top) / availH;
    if (Math.abs(r - 0.5) < 0.04) r = 0.5;     // soft center detent
    ratio = Math.max(0, Math.min(1, r));
    layout();
    e.preventDefault();
  }
  function onUp() { dragging = false; dividerEl.classList.remove('dragging'); }
  dividerEl.addEventListener('mousedown', onDown);
  dividerEl.addEventListener('touchstart', onDown, { passive: false });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('mouseup', onUp);
  window.addEventListener('touchend', onUp);
})();

window.addEventListener('resize', layout);
requestAnimationFrame(layout);

// ------------------------------------------------------------------ save sheet
function downloadBlob(blob, name) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u; a.download = name; a.click();
  URL.revokeObjectURL(u);
}
let refreshSaveLimits = () => {};   // assigned in buildSaveSheet
let probedExport = false;
function openSaveSheet() {
  if (!probedExport) {
    // first open: lazily probe a higher FBO cap (8192) so capable phones can pick
    // a >4096 export. Init keeps a low cap to avoid the load-time memory crash.
    probedExport = true;
    try { engine.probeExportMax(8192); } catch { /* stay at the init cap */ }
    refreshSaveLimits();
  }
  const hint = $('m-res-hint');
  if (hint) {
    const s = engine.suggestResolution(state);
    hint.textContent = s ? `sharp output up to ~${(s / 1024).toFixed(1)}K at current settings` : '';
  }
  $('m-sheet')?.classList.remove('m-hidden');
}
function closeSaveSheet() { $('m-sheet')?.classList.add('m-hidden'); }

function buildSaveSheet() {
  const sheet = document.createElement('div');
  sheet.id = 'm-sheet'; sheet.className = 'm-hidden';
  sheet.innerHTML = `
    <div class="m-sheet-backdrop"></div>
    <div class="m-sheet-panel">
      <div class="m-sheet-grip"></div>
      <button class="m-sheet-link" id="m-diag-toggle">show diagnostics</button>
      <div id="m-diag" class="m-hidden"></div>
      <div class="m-sheet-cap">format</div><div class="m-seg" id="m-fmt"></div>
      <div class="m-sheet-cap">size</div><div class="m-seg" id="m-size"></div>
      <div class="m-sheet-res" id="m-res-hint"></div>
      <div class="m-sheet-status" id="m-save-status"></div>
      <button id="m-save-package">save package (.zip)</button>
      <button id="m-save-comp" class="m-save-primary">save composition</button>
    </div>`;
  rootEl.appendChild(sheet);

  const fmt = sheet.querySelector('#m-fmt');
  [['JPG', 'jpg'], ['PNG', 'png']].forEach(([label, v]) => {
    const b = document.createElement('button'); b.className = 'm-seg-btn'; b.textContent = label; b.dataset.v = v;
    b.addEventListener('click', () => { session.exportFormat = v; syncFmt(); });
    fmt.appendChild(b);
  });
  const syncFmt = () => fmt.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === (session.exportFormat || 'jpg')));

  const szEl = sheet.querySelector('#m-size');
  const syncSize = () => szEl.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === session.exportSize));
  function renderSizeTiers() {
    const cap = engine.diagnostics.maxFBOSize;
    if (!session.exportSize || (session.exportSize !== 'max' && parseInt(session.exportSize, 10) > cap)) {
      session.exportSize = String(Math.min(4096, cap));
    }
    szEl.innerHTML = '';
    const capK = (cap / 1024).toFixed(0);
    ['1024', '2048', '4096', '8192', 'max'].forEach(s => {
      const b = document.createElement('button'); b.className = 'm-seg-btn'; b.dataset.v = s;
      b.textContent = s === 'max' ? 'max' : (parseInt(s, 10) / 1024) + 'K';
      const unsupported = s !== 'max' && parseInt(s, 10) > cap;
      b.disabled = unsupported;
      if (unsupported) b.title = `max ~${capK}K on this device`;
      b.addEventListener('click', () => { if (b.disabled) return; session.exportSize = s; syncSize(); });
      szEl.appendChild(b);
    });
    syncSize();
  }

  const diag = sheet.querySelector('#m-diag'), diagToggle = sheet.querySelector('#m-diag-toggle');
  const renderDiag = () => {
    diag.innerHTML = `WebGL2 • ${engine.diagnostics.renderer}<br>max texture ${engine.diagnostics.maxTextureSize}px • max export ${engine.diagnostics.maxFBOSize}px • DPR ${window.devicePixelRatio || 1}`;
  };
  diagToggle.addEventListener('click', () => {
    const hidden = diag.classList.toggle('m-hidden');
    diagToggle.textContent = hidden ? 'show diagnostics' : 'hide diagnostics';
  });

  sheet.querySelector('#m-save-comp').addEventListener('click', () => doSave(false));
  sheet.querySelector('#m-save-package').addEventListener('click', () => doSave(true));
  sheet.querySelector('.m-sheet-backdrop').addEventListener('click', closeSaveSheet);
  sheet.querySelector('.m-sheet-grip').addEventListener('click', closeSaveSheet);

  refreshSaveLimits = () => { renderSizeTiers(); renderDiag(); };
  syncFmt();
  refreshSaveLimits();
}

async function doSave(pkg) {
  if (!engine.getSourceImage()) return;
  const status = $('m-save-status');
  status.textContent = 'rendering…';
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  let res;
  try { res = await engine.exportAt(state, session.exportSize, session.exportFormat || 'jpg'); }
  catch (e) { status.textContent = e.message; return; }
  const ext = session.exportFormat === 'png' ? 'png' : 'jpg';
  const base = sourceFilename || 'fold';
  const compName = `${base}-${state.form}-${res.size}.${ext}`;
  if (pkg) {
    const files = [{ name: compName, blob: res.blob }];
    if (originalSource) files.push(originalSource);
    const zip = await zipStore(files);
    downloadBlob(zip, `${base}-package.zip`);
    status.textContent = `saved package • ${files.length} files • ${(zip.size / 1048576).toFixed(1)}MB`;
  } else {
    downloadBlob(res.blob, compName);
    status.textContent = `saved ${res.size}×${res.size} • ${(res.blob.size / 1048576).toFixed(1)}MB`;
  }
  engine.render(state);
}
buildSaveSheet();

// Release the WebGL context on navigation away so a refresh doesn't pile up GPU
// contexts (a known iOS Safari crash vector — possible cause of the intermittent
// "a problem repeatedly occurred" on reload).
window.addEventListener('pagehide', () => {
  try { engine.glContext?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* noop */ }
});

// Returning to the app (e.g. after viewing an exported image) can leave the
// output dark: a backgrounded rAF chain may not resume, and a still needs a
// re-render. Force-resume on visibility.
function onVisible() {
  if (document.visibilityState !== 'visible') return;
  if (cameraMode === 'live') { stopLiveLoop(); startLiveLoop(); }
  else if (engine.getSourceImage()) { scheduleRender(); }
}
document.addEventListener('visibilitychange', onVisible);
window.addEventListener('pageshow', onVisible);
