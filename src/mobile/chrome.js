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

// (The desktop stylesheet is dropped in boot.js before this module loads.)

// ---------------------------------------------------------------- DOM scaffold
document.body.innerHTML = `
  <div id="m-root">
    <div id="m-output">
      <div id="m-empty">tap <b>+</b> to begin</div>
      <button id="m-flip" class="m-icon-btn" title="flip camera" style="display:none">${ICONS.flip}</button>
    </div>
    <div id="m-divider"></div>
    <div id="m-context">
      <button id="m-context-toggle" title="source / settings">${ICONS.sliders}</button>
      <div id="m-source"></div>
      <div id="m-settings" class="m-hidden"></div>
    </div>
    <div id="m-tabbar">
      <button id="m-tab-source" class="m-tab" title="source">${ICONS.plus}</button>
      <button id="m-tab-form" class="m-tab" title="form"></button>
      <button id="m-tab-export" class="m-tab" title="save">${ICONS.download}</button>
      <button id="m-tab-capture" class="m-tab" title="capture" style="display:none">${ICONS.aperture}</button>
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
});

createOutputGestures(outputCanvas, {
  state,
  onChange: () => { controlsSync.syncAll(); scheduleRender(); },
});

// ------------------------------------------------------------ settings (State B)
settingsEl.innerHTML = '<h2>settings</h2>';
for (const id of DECLARATIVE_PARAM_IDS) {
  mountRangeControl(settingsEl, PARAMS[id], env);
}
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

// Form-aware control visibility (aspect → square, zoom → droste, etc.). A control
// shows when its registry `formControl` is null (universal) or in the active
// form's `controls` list. Registered with controlsSync so a form switch refreshes it.
function applyFormVisibility() {
  const form = getActiveForm(state);
  for (const id of DECLARATIVE_PARAM_IDS) {
    const p = PARAMS[id];
    const labelEl = $(p.sliderId + 'Label');
    if (!labelEl) continue;
    const visible = !p.formControl || form.controls.includes(p.formControl);
    labelEl.classList.toggle('m-hidden', !visible);
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

// ------------------------------------------------------------------- tab bar
$('m-tab-source').addEventListener('click', () => showSourceMenu());
$('m-tab-form').addEventListener('click', () => showFormMenu());
$('m-file').addEventListener('change', (e) => { if (e.target.files[0]) loadImage(e.target.files[0], 'file'); });
$('m-file-still').addEventListener('change', (e) => { if (e.target.files[0]) loadImage(e.target.files[0], 'still'); });
// null state: tapping the output opens the source menu
outputEl.addEventListener('click', (e) => {
  if (!engine.getSourceImage() && !e.target.closest('#m-flip')) showSourceMenu();
});

$('m-tab-export').addEventListener('click', async () => {
  if (!engine.getSourceImage()) return;
  try {
    const { blob, size } = await engine.exportAt(state, session.exportSize || '2048', session.exportFormat || 'jpg');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `fold-${state.form}-${size}.${session.exportFormat || 'jpg'}`; a.click();
    URL.revokeObjectURL(url);
    engine.render(state);
  } catch (e) { console.error(e); }
});

// ----------------------------------------------------------------- source load
let sourceFilename = '';
function loadImage(file, sourceType = 'file') {
  stopCameraStream();
  cameraMode = 'off';
  updateLiveUI();
  const url = URL.createObjectURL(file);
  sourceFilename = (file.name || 'image').replace(/\.[^.]+$/, '');
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
    cap.style.display = ''; cap.innerHTML = ICONS.aperture; cap.title = 'capture';
    flip.style.display = ''; setSourceIcon('live');
  } else if (cameraMode === 'frozen') {
    cap.style.display = ''; cap.innerHTML = ICONS.record; cap.title = 'go live';
    flip.style.display = 'none'; setSourceIcon('still');
  } else {
    cap.style.display = 'none'; flip.style.display = 'none';
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
