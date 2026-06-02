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

// The desktop stylesheet is a static <link> in the shared index.html; drop it on
// mobile so its split-pane body rules don't fight the mobile layout. (Targeted by
// id so the mobile chrome's own injected CSS is untouched.)
document.getElementById('desktop-styles')?.remove();

// ---------------------------------------------------------------- DOM scaffold
document.body.innerHTML = `
  <div id="m-root">
    <div id="m-output"><div id="m-empty">tap <b>upload</b> to begin</div></div>
    <div id="m-divider"></div>
    <div id="m-context">
      <button id="m-context-toggle" title="source / settings">⚙</button>
      <div id="m-source"></div>
      <div id="m-settings" class="m-hidden"></div>
    </div>
    <div id="m-tabbar">
      <button id="m-tab-source">upload</button>
      <button id="m-tab-form">form</button>
      <button id="m-tab-export">export</button>
    </div>
    <input type="file" class="m-file-input" id="m-file" accept="image/jpeg,image/png,image/webp">
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
  engine = createEngine({ canvas: outputCanvas });
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
const sourceOverlay = createSourceOverlay({
  state, engine,
  getLiveVideo: () => null,                   // camera wired in the next increment
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
const resetBtn = document.createElement('button');
resetBtn.id = 'm-reset';
resetBtn.textContent = 'reset slice';
resetBtn.addEventListener('click', () => {
  state.sliceScale = 1.0; state.sliceRotation = 0; state.sliceCx = 0.5; state.sliceCy = 0.5;
  state.squareAspect = 1.0; state.drosteZoom = 2.0; state.canvasZoom = 1.0; state.canvasRotation = 0;
  controlsSync.syncAll(); scheduleRender(); sourceOverlay.scheduleDraw();
});
settingsEl.appendChild(resetBtn);

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

// ------------------------------------------------------------- context A/B flip
let showingSettings = false;
function setContext(settings) {
  showingSettings = settings;
  sourceEl.classList.toggle('m-hidden', settings);
  settingsEl.classList.toggle('m-hidden', !settings);
  $('m-context-toggle').textContent = settings ? '◈' : '⚙';
  if (!settings) sourceOverlay.render();      // re-draw overlay (it was zero-sized while hidden)
}
$('m-context-toggle').addEventListener('click', () => setContext(!showingSettings));

// ------------------------------------------------------------------- tab bar
$('m-tab-source').addEventListener('click', () => $('m-file').click());
$('m-file').addEventListener('change', (e) => { if (e.target.files[0]) loadImage(e.target.files[0]); });

$('m-tab-form').addEventListener('click', () => {
  const i = FORMS.findIndex(f => f.id === state.form);
  state.form = FORMS[(i + 1) % FORMS.length].id;
  controlsSync.syncAll();
  scheduleRender();
  sourceOverlay.scheduleDraw();
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
function loadImage(file) {
  const url = URL.createObjectURL(file);
  sourceFilename = (file.name || 'image').replace(/\.[^.]+$/, '');
  const img = new Image();
  img.onload = () => {
    engine.setSource(img);
    emptyEl.classList.add('m-hidden');
    setContext(false);                         // show SOURCE state
    sourceOverlay.mount(sourceEl);
    sizeOutput();
    scheduleRender();
  };
  img.src = url;
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
