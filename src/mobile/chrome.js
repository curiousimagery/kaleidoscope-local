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
import { createFollower } from '../kit/follow.js';
import { createAutoDrift } from '../kit/drift.js';
import { ICONS } from './icons.js';
import { applyArmsSnap, snapSpiralValue } from '../kit/snaps.js';
import { zipStore } from '../shell/zip.js';

// (The desktop stylesheet is dropped in boot.js before this module loads.)

// ---------------------------------------------------------------- DOM scaffold
document.body.innerHTML = `
  <div id="m-root">
    <div id="m-output">
      <div id="m-empty">tap&nbsp;<b>+</b>&nbsp;to&nbsp;begin</div>
      <span id="m-stage-label" class="m-hidden">preview</span>
      <div id="m-pip" class="m-hidden">
        <canvas id="m-pip-canvas"></canvas>
        <span class="m-pip-label"><i id="m-pip-dot"></i>output</span>
      </div>
      <button id="m-canvas-gear" class="m-hidden" title="canvas settings">${ICONS.sliders}</button>
      <div id="m-canvas-pop" class="m-hidden"></div>
    </div>
    <div id="m-divider"></div>
    <div id="m-context">
      <button id="m-context-toggle" title="source / settings">${ICONS.sliders}</button>
      <button id="m-flip" class="m-icon-btn" title="flip camera" style="display:none">${ICONS.flip}</button>
      <button id="m-fit-toggle" title="fill / fit">${ICONS.contract}</button>
      <div id="m-source"></div>
      <div id="m-settings" class="m-hidden"></div>
    </div>
    <div id="m-tabbar">
      <button id="m-tab-source" class="m-tab" title="source">${ICONS.plus}</button>
      <button id="m-tab-form" class="m-tab" title="form"></button>
      <button id="m-tab-export" class="m-tab" title="save">${ICONS.download}</button>
      <button id="m-tab-capture" class="m-tab" title="pause" style="display:none">${ICONS.pause}</button>
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
// the record-video FOLLOWER (declared early — the transition-speed control
// binds to it at mount time): the recorded output eases toward edits at
// session.performResponse, the same primitive as desktop perform.
let follower = null;
// AUTOPLAY: the same kit drift desktop perform runs — another pair of hands
// writing state; the preview shows it immediately, the follower eases the
// recorded output through it. Manual edits win per field (kit contract).
const drift = createAutoDrift({ state, session });
let autoOn = false;
let lastAutoSync = 0;
let syncAutoUI = () => {};   // bound by the motion-section mount below

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
// The SLICE settings live in the context panel (its top-left sliders toggle);
// the CANVAS settings moved to their own popover on the OUTPUT panel top-left
// (Daniel's record-video reorg, B295 — "these are all slice-related behaviors"
// now includes the motion block: transition speed, autoplay later). Section
// membership comes from each param's `scope` field in params.js.
const canvasPopEl = $('m-canvas-pop');
settingsEl.innerHTML = '<h2>slice</h2>';
mountSegmentsControl();
for (const id of DECLARATIVE_PARAM_IDS) {
  if (PARAMS[id].scope === 'slice') mountRangeControl(settingsEl, PARAMS[id], env);
}
mountSpiralControl();
mountToggleControl('mirror', 'drosteMirror', 'tier mirror');
mountToggleControl('wedgeMirror', 'drosteWedgeMirror', 'wedge mirror');

const resetBtn = document.createElement('button');
resetBtn.id = 'm-reset';
resetBtn.textContent = 'reset slice';
resetBtn.addEventListener('click', () => {
  // slice-scoped only — the canvas menu has its own reset now
  state.sliceScale = 1.0; state.sliceRotation = 0; state.sliceCx = 0.5; state.sliceCy = 0.5;
  state.squareAspect = 1.0; state.drosteZoom = 2.0;
  controlsSync.syncAll(); scheduleRender(); sourceOverlay.scheduleDraw();
});
settingsEl.appendChild(resetBtn);

// motion block (record video only): the transition speed the recorded output
// eases with. Autoplay + its sub-settings join here (spec v2; next increment).
const motionSec = document.createElement('div');
motionSec.id = 'm-motion-sec';
motionSec.className = 'm-hidden';
motionSec.innerHTML = '<h2>motion</h2>';
settingsEl.appendChild(motionSec);
(function mountTransitionSpeed() {
  const wrap = document.createElement('label');
  wrap.className = 'm-control';
  wrap.innerHTML = '<div class="m-control-row"><span>transition speed</span><span class="m-control-val" id="m-followv"></span></div><input type="range" id="m-follow" min="0" max="10" step="0.05">';
  motionSec.appendChild(wrap);
  const inp = wrap.querySelector('#m-follow'), val = wrap.querySelector('#m-followv');
  const fmt = (v) => (v < 0.02 ? 'instant' : v.toFixed(2) + 's');
  const apply = (v) => {
    session.performResponse = v;
    follower?.setResponse(v);
    val.textContent = fmt(v);
  };
  inp.value = String(session.performResponse ?? 0.35);
  apply(parseFloat(inp.value));
  inp.addEventListener('input', () => apply(parseFloat(inp.value) || 0));
})();
// autoplay: the on/off toggle (the loop-toggle pattern) + the four guardrail
// dials, disabled until autoplay is on (Daniel's spec).
(function mountAutoplay() {
  const wrap = document.createElement('div');
  wrap.className = 'm-control';
  wrap.innerHTML = '<div class="m-control-row"><span>autoplay</span></div>';
  const seg = document.createElement('div');
  seg.className = 'm-seg';
  const btns = [['off', false], ['on', true]].map(([t, v]) => {
    const b = document.createElement('button');
    b.className = 'm-seg-btn';
    b.textContent = t;
    b.addEventListener('click', () => {
      if (v === autoOn) return;
      autoOn = v;
      if (v) drift.reset();          // fresh homes at the current look
      syncAutoUI();
    });
    seg.appendChild(b);
    return [b, v];
  });
  wrap.appendChild(seg);
  motionSec.appendChild(wrap);

  const DIALS = [
    ['pace', 'performAutoPace', 0.5],
    ['range', 'performAutoRange', 0.3],
    ['variety', 'performAutoVariety', 0.5],
    ['smoothing', 'performAutoSmooth', 0.65],
  ];
  const dialEls = DIALS.map(([label, key, dflt]) => {
    const row = document.createElement('label');
    row.className = 'm-control';
    row.innerHTML = `<div class="m-control-row"><span>${label}</span><span class="m-control-val"></span></div><input type="range" min="0.05" max="1" step="0.05">`;
    const inp2 = row.querySelector('input'), val2 = row.querySelector('.m-control-val');
    inp2.value = String(session[key] ?? dflt);
    const show = () => { val2.textContent = Math.round(parseFloat(inp2.value) * 100) + '%'; };
    show();
    inp2.addEventListener('input', () => { session[key] = parseFloat(inp2.value) || 0; show(); });
    motionSec.appendChild(row);
    return { row, inp2 };
  });
  syncAutoUI = () => {
    btns.forEach(([b, v]) => b.classList.toggle('active', autoOn === v));
    for (const { row, inp2 } of dialEls) {
      inp2.disabled = !autoOn;
      row.style.opacity = autoOn ? '' : '0.45';
    }
  };
  syncAutoUI();
})();

// build/version readout (useful while testing on a phone where there's no footer)
const ver = document.createElement('div');
ver.id = 'm-version';
ver.textContent = formatVersion();
settingsEl.appendChild(ver);

// ---- the CANVAS settings popover (output panel, top-left gear) --------------
canvasPopEl.innerHTML = '<h2>canvas</h2>';
// frame aspect — the desktop row's exact behavior (1:1 · 5:4 · 4:3 · 3:2 · 16:9,
// landscape default, tapping the SELECTED ratio flips portrait ↔ landscape);
// mobile output honored only square before this.
(function mountAspectControl() {
  const wrap = document.createElement('div');
  wrap.className = 'm-control';
  wrap.innerHTML = '<div class="m-control-row"><span>frame aspect</span></div>';
  const seg = document.createElement('div');
  seg.className = 'm-seg';
  const DEFS = [[1, '1:1', '1:1'], [1.25, '5:4', '4:5'], [1.3333, '4:3', '3:4'], [1.5, '3:2', '2:3'], [1.7778, '16:9', '9:16']];
  const EPS = 0.001;
  const btns = DEFS.map(([land, l, p]) => {
    const b = document.createElement('button');
    b.className = 'm-seg-btn';
    b.textContent = l;
    b.addEventListener('click', () => {
      const a = session.frameAspect || 1;
      const active = Math.abs(a - land) < EPS || Math.abs(a - 1 / land) < EPS;
      if (active && land > 1) session.frameAspect = a > 1 ? 1 / land : land;   // re-tap flips (1:1 has none)
      else session.frameAspect = land;
      sync(); sizeOutput(); scheduleRender();
    });
    seg.appendChild(b);
    return { b, land, l, p };
  });
  function sync() {
    const a = session.frameAspect || 1;
    for (const { b, land, l, p } of btns) {
      const active = Math.abs(a - land) < EPS || Math.abs(a - 1 / land) < EPS;
      b.classList.toggle('active', active);
      b.textContent = active && land > 1 && a < 1 ? p : l;
    }
  }
  wrap.appendChild(seg);
  canvasPopEl.appendChild(wrap);
  controlsSync.register(sync);
  sync();
})();
for (const id of DECLARATIVE_PARAM_IDS) {
  if (PARAMS[id].scope === 'canvas') mountRangeControl(canvasPopEl, PARAMS[id], env);
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
  canvasPopEl.appendChild(wrap);
  controlsSync.register(sync);
  sync();
})();
const resetCanvasBtn = document.createElement('button');
resetCanvasBtn.id = 'm-reset-canvas';
resetCanvasBtn.textContent = 'reset canvas';
resetCanvasBtn.addEventListener('click', () => {
  state.canvasZoom = 1.0; state.canvasRotation = 0; state.oobMode = 1;
  session.frameAspect = 1;
  controlsSync.syncAll(); sizeOutput(); scheduleRender();
});
canvasPopEl.appendChild(resetCanvasBtn);

// gear toggles the popover; a tap outside closes it
$('m-canvas-gear').addEventListener('click', (e) => {
  e.stopPropagation();
  canvasPopEl.classList.toggle('m-hidden');
});
document.addEventListener('pointerdown', (e) => {
  if (canvasPopEl.classList.contains('m-hidden')) return;
  if (!e.target.closest('#m-canvas-pop') && !e.target.closest('#m-canvas-gear')) canvasPopEl.classList.add('m-hidden');
});

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
// The source tab stays "+" regardless of the active source (Daniel, Build 222): the
// per-source-type icon swap (folder/camera/record) was more confusing than helpful —
// people couldn't tell how to take a picture. The arg is ignored now (kept so existing
// callers don't change). FALLBACK: map { none:plus, file:folder, still:camera, live:record }.
function setSourceIcon(_type) {
  $('m-tab-source').innerHTML = ICONS.plus;
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
  $('m-canvas-gear').classList.toggle('m-hidden', !engine.getSourceImage());
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

$('m-tab-export').addEventListener('click', () => {
  if (videoMode) { saveRecordedVideo(); return; }   // gated by :disabled until a take exists
  if (engine.getSourceImage()) openSaveSheet();
});

// ----------------------------------------------------------------- source load
let sourceFilename = '';
let originalSource = null;   // { blob, name } — bundled into "save package"
function loadImage(file, sourceType = 'file') {
  leaveVideoMode();              // a new source replaces the take (guarded upstream)
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
let lastFacing = 'environment';  // remembered so freeze → "go live" keeps the flipped (selfie) camera
let liveActive = false, liveRaf = 0;

// ------------------------------------------------------------- record video mode
// "Record video" = live camera + recording the OUTPUT canvas (with mic audio).
// NOT perform-on-mobile (Daniel's re-frame): a recorded video with symmetry
// effects, inheriting the trailing auto-follow infrastructure later — no
// staging/transport here. The far-right tab slot becomes record ● / stop ■.
let videoMode = false;         // the "record video" source is active
let recState = 'idle';         // 'idle' | 'recording'
let recordedVideo = null;      // { blob, ext } — the finished take
let recordingSaved = false;    // download tapped since the take finished
let mediaRec = null, recChunks = [], micStream = null;
let recordCanvas = null;       // full-res 2D canvas the recorder captures
function paintRecord() {
  if (recState !== 'recording' || !recordCanvas) return;
  const ctx = recordCanvas.getContext('2d');
  ctx.drawImage(outputCanvas, 0, 0, recordCanvas.width, recordCanvas.height);
  // FORCE the copy to rasterize NOW: Chromium 2D canvases are deferred — a
  // drawImage from a WebGL canvas that re-renders later in the SAME task would
  // otherwise capture the LATER render (the preview, not the followed output)
  ctx.getImageData(0, 0, 1, 1);
}

// one guard for every path that would lose an unsaved take (re-record, source
// switch, leaving the mode). Native confirm() is the interim treatment — the
// systematic destructive-interrupt pattern (BACKLOG) replaces it app-wide.
function confirmLoseRecording(msg) {
  if (recState === 'recording') {
    if (!window.confirm(msg || 'stop and discard the current recording?')) return false;
    // discard THROUGH the recorder's stop path (onstop still runs its mic/state
    // cleanup): mute the chunk sink and empty it, so onstop builds no take —
    // nulling recordedVideo here would lose the race with the async onstop.
    if (mediaRec) mediaRec.ondataavailable = null;
    recChunks = [];
    stopRecording();
    return true;
  }
  if (recordedVideo && !recordingSaved) return window.confirm(msg || 'your recording has not been saved and will be lost — continue?');
  return true;
}

async function startRecording() {
  if (recState === 'recording') return;
  if (recordedVideo && !recordingSaved &&
      !window.confirm('start a new recording? it will replace this one — save first if you want to keep it.')) return;
  // the recording captures a dedicated full-res canvas painted with the
  // FOLLOWED output each tick (not the on-screen preview) — size locked at
  // record start so a mid-take divider drag can't change the file's resolution
  let stream;
  try {
    recordCanvas = document.createElement('canvas');
    recordCanvas.width = outputCanvas.width || 1080;
    recordCanvas.height = outputCanvas.height || 1080;
    recordCanvas.getContext('2d').drawImage(outputCanvas, 0, 0);
    stream = recordCanvas.captureStream(30);
  } catch { recordCanvas = null; return; }
  // mic joins the canvas stream; denied permission degrades to video-only
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const t of micStream.getAudioTracks()) stream.addTrack(t);
  } catch { micStream = null; }
  const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
    .find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
  try {
    mediaRec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12e6 } : undefined);
  } catch {
    micStream?.getTracks().forEach((t) => t.stop()); micStream = null;
    return;
  }
  recChunks = [];
  mediaRec.ondataavailable = (e) => { if (e.data?.size) recChunks.push(e.data); };
  mediaRec.onstop = () => {
    const type = mediaRec?.mimeType || mime || 'video/webm';
    recordedVideo = recChunks.length ? { blob: new Blob(recChunks, { type }), ext: /mp4/.test(type) ? 'mp4' : 'webm' } : null;
    recChunks = [];
    recordingSaved = false;
    micStream?.getTracks().forEach((t) => t.stop()); micStream = null;
    recordCanvas = null;
    recState = 'idle';
    releaseRecWakeLock();
    updateLiveUI();
  };
  mediaRec.start(1000);   // timeslice: chunks survive even if stop never fires cleanly
  recordedVideo = null;
  recordingSaved = false;
  recState = 'recording';
  acquireRecWakeLock();
  updateLiveUI();
}
function stopRecording() {
  try { mediaRec?.stop(); } catch { /* already inactive */ }
}
function saveRecordedVideo() {
  if (!recordedVideo) return;
  const d = new Date();
  const ts = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  downloadBlob(recordedVideo.blob, `fold-video-${ts}.${recordedVideo.ext}`);
  recordingSaved = true;
}
function leaveVideoMode() {
  if (!videoMode) return;
  videoMode = false;
  recordedVideo = null;
  recordingSaved = false;
  follower = null;
  autoOn = false;
  syncAutoUI();
}

async function startRecordVideo() {
  if (videoMode && cameraMode === 'live') return;   // already there — don't restart the camera
  videoMode = true;
  await startCamera();
  updateLiveUI();
}

// ---- the live-output PiP ("output" = what's being recorded; the big panel is
// the "preview" stage). For now the PiP MIRRORS the output canvas — when the
// trailing auto-follow lands (increment 3) the two diverge: preview renders
// edits immediately, output eases toward them and is what records.
const pipEl = $('m-pip'), pipCanvas = $('m-pip-canvas');
let pipCorner = 'tr';          // 'tr' | 'br' | 'bl' — top-left is reserved for
                               // the canvas-settings gizmo (spec: PiP refuses it)
function placePip() {
  const st = pipEl.style;
  st.top = st.right = st.bottom = st.left = st.transform = '';
  if (pipCorner.includes('t')) st.top = 'calc(8px + env(safe-area-inset-top))';
  else st.bottom = 'calc(8px + env(safe-area-inset-bottom))';
  if (pipCorner.includes('r')) st.right = 'calc(8px + env(safe-area-inset-right))';
  else st.left = 'calc(8px + env(safe-area-inset-left))';
}
placePip();
function paintPip() {
  if (pipEl.classList.contains('m-hidden')) return;
  const w = pipEl.clientWidth;
  if (!w || !outputCanvas.width || !outputCanvas.height) return;
  const ar = outputCanvas.width / outputCanvas.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pw = Math.round(w * dpr), ph = Math.max(1, Math.round((w / ar) * dpr));
  if (pipCanvas.width !== pw || pipCanvas.height !== ph) { pipCanvas.width = pw; pipCanvas.height = ph; }
  const pctx = pipCanvas.getContext('2d');
  pctx.drawImage(outputCanvas, 0, 0, pw, ph);
  pctx.getImageData(0, 0, 1, 1);   // same forced flush as paintRecord (deferral)
}
// drag → snap to the nearest allowed corner (a small move is a tap: no-op)
(function setupPipDrag() {
  let sx = 0, sy = 0, ox = 0, oy = 0, moved = false, dragging = false;
  pipEl.addEventListener('pointerdown', (e) => {
    dragging = true; moved = false;
    sx = e.clientX; sy = e.clientY; ox = 0; oy = 0;
    pipEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  pipEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    ox = e.clientX - sx; oy = e.clientY - sy;
    if (Math.hypot(ox, oy) > 6) moved = true;
    if (moved) pipEl.style.transform = `translate(${ox}px, ${oy}px)`;
  });
  pipEl.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    if (!moved) { pipEl.style.transform = ''; return; }
    const pr = pipEl.getBoundingClientRect();
    const or2 = outputEl.getBoundingClientRect();
    const cx = pr.left + pr.width / 2 - or2.left, cy = pr.top + pr.height / 2 - or2.top;
    let c = (cy < or2.height / 2 ? 't' : 'b') + (cx < or2.width / 2 ? 'l' : 'r');
    if (c === 'tl') c = (cy / or2.height < cx / or2.width) ? 'tr' : 'bl';   // reserved corner → nearest allowed
    pipCorner = c;
    placePip();
    paintPip();
  });
  pipEl.addEventListener('pointercancel', () => { dragging = false; pipEl.style.transform = ''; placePip(); });
})();

// ---- screen wake lock while a take rolls (auto-lock would kill the recording)
let recWakeLock = null;
async function acquireRecWakeLock() {
  try { recWakeLock = await navigator.wakeLock?.request('screen'); } catch { recWakeLock = null; }
}
function releaseRecWakeLock() {
  try { recWakeLock?.release(); } catch { /* already released */ }
  recWakeLock = null;
}

let lastTickT = 0;
function startLiveLoop() {
  if (liveActive) return;
  liveActive = true;
  lastTickT = 0;
  const tick = (now) => {
    if (!liveActive) return;
    camera.refreshFrame();                     // front camera: redraw mirrored frame
    engine.updateSourceFrame();
    if (videoMode) {
      // record video: the OUTPUT (PiP + recording) eases toward the edited
      // state through the follower; the big panel stays the immediate PREVIEW.
      // While settled the two are identical — one render serves both.
      if (!follower) follower = createFollower(state, { response: session.performResponse ?? 0.35 });
      const dt = lastTickT ? Math.min(now - lastTickT, 100) : 16;
      if (autoOn) {
        drift.tick(now, dt);                   // wander writes state like a hand
        sourceOverlay.scheduleDraw();          // the slice overlay rides along
        if (now - lastAutoSync > 250) { lastAutoSync = now; controlsSync.syncAll(); }
      }
      follower.setTarget(state);
      const eased = follower.step(dt);
      const diverged = !follower.isSettled(0.002);
      engine.render(diverged ? eased : state);
      paintRecord();
      paintPip();
      if (diverged) engine.render(state);      // restore the preview on screen
    } else {
      engine.render(state);
    }
    lastTickT = now;
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
  if (videoMode && cameraMode === 'live') {
    // record video: the slot is record ● (red) / stop ■ — the live-cam pattern
    // with record semantics. Download stays but gates on a finished take.
    cap.style.display = '';
    if (recState === 'recording') { cap.innerHTML = ICONS.stop; cap.title = 'stop recording'; cap.style.color = ''; }
    else { cap.innerHTML = ICONS.record; cap.title = 'start recording'; cap.style.color = '#e8504a'; }
    flip.style.display = ''; setSourceIcon('video');
  } else if (cameraMode === 'live') {
    cap.style.display = ''; cap.innerHTML = ICONS.pause; cap.title = 'pause'; cap.style.color = '';   /* record/pause toggle (was the stop square; before that the aperture) */
    flip.style.display = ''; setSourceIcon('live');
  } else if (cameraMode === 'frozen') {
    // still "in" live capture, just paused: go-live record is RED (actionable),
    // and the SOURCE icon stays the live record (mental model: paused, not a new still).
    cap.style.display = ''; cap.innerHTML = ICONS.record; cap.title = 'go live'; cap.style.color = '#e8504a';
    flip.style.display = 'none'; setSourceIcon('live');
  } else {
    cap.style.display = 'none'; flip.style.display = 'none'; cap.style.color = '';
  }
  // download: in record-video mode it saves the take, so it needs one to exist
  $('m-tab-export').disabled = videoMode ? !recordedVideo : false;
  // record-video chrome: the "preview" stage label + the output PiP (+ its
  // recording dot) show only while the mode is live; the motion settings block
  // rides the mode too. The canvas gear shows whenever a source is loaded.
  const inVideo = videoMode && cameraMode === 'live';
  $('m-stage-label').classList.toggle('m-hidden', !inVideo);
  pipEl.classList.toggle('m-hidden', !inVideo);
  $('m-pip-dot').classList.toggle('rec', recState === 'recording');
  $('m-motion-sec').classList.toggle('m-hidden', !videoMode);
  $('m-canvas-gear').classList.toggle('m-hidden', !engine.getSourceImage());
  if (inVideo) paintPip();
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
    const video = await camera.start(lastFacing);   // rear by default; remembers a flip across freeze→go-live
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
    lastFacing = camera.isFront() ? 'user' : 'environment';   // remember for go-live
    engine.setSource(camera.frameSource());
    sourceOverlay.mount(sourceEl);             // remount picks up the mirror transform
  } catch (e) { console.error(e); }
}

$('m-tab-capture').addEventListener('click', () => {
  if (videoMode) {
    if (recState === 'recording') stopRecording();
    else startRecording();
    return;
  }
  if (cameraMode === 'live') captureFrame();
  else if (cameraMode === 'frozen') startCamera();   // "go live"
});
$('m-flip').addEventListener('click', flipCamera);

// ----------------------------------------------------------------- tab popovers
// items: { icon, iconClass?, label, action, current? }
function showMenu(items, anchorId) {
  // tapping the same tab again closes its open menu (toggle), not reopen it.
  const open = document.getElementById('m-menu');
  const toggleOff = open && open.dataset.anchor === anchorId;
  closeMenu();
  if (toggleOff) return;
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
  rootEl.appendChild(menu);           // fixed-positioned; parent is irrelevant
  positionMenu(menu, anchorId);
  setTimeout(() => document.addEventListener('pointerdown', onMenuOutside), 0);
}
// Anchor the popover off its launching tab button: unfurl upward from it in
// portrait (tab bar at the bottom), to the left of it in landscape (tab bar on
// the right), top-aligned to the button. Clamped to stay on-screen.
function positionMenu(menu, anchorId) {
  const a = document.getElementById(anchorId);
  if (!a) return;
  const b = a.getBoundingClientRect();
  const gap = 8, m = 8;
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left, top;
  if (isLandscape()) { left = b.left - gap - mw; top = b.top; }
  else { left = b.left; top = b.top - gap - mh; }
  menu.style.left = Math.max(m, Math.min(left, window.innerWidth - mw - m)) + 'px';
  menu.style.top = Math.max(m, Math.min(top, window.innerHeight - mh - m)) + 'px';
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
  // dot semantics (Daniel): green = live, red = record
  showMenu([
    { icon: ICONS.record, iconClass: 'm-icon-live', label: 'live camera', action: enterLiveCamera },
    { icon: ICONS.record, iconClass: 'm-icon-record', label: 'record video', action: startRecordVideo },
    { icon: ICONS.camera, label: 'take still', action: () => { if (confirmLoseRecording()) $('m-file-still').click(); } },
    { icon: ICONS.photo, label: 'choose photo / file', action: () => { if (confirmLoseRecording()) $('m-file').click(); } },
  ], 'm-tab-source');
}
async function enterLiveCamera() {
  if (!confirmLoseRecording()) return;
  leaveVideoMode();
  await startCamera();
  updateLiveUI();
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
// The same DOM serves both orientations (DOM order = OUTPUT, divider, CONTEXT,
// tab bar — already the left→right landscape order). CSS flips #m-root between a
// column (portrait) and a row (landscape); here we just drive the OUTPUT's
// main-axis size (height in portrait, width in landscape) and clear the other.
let ratio = 0.5;                               // OUTPUT fraction of the split area
const mqlLandscape = matchMedia('(orientation: landscape)');
const isLandscape = () => mqlLandscape.matches;
function layout() {
  if (isLandscape()) {
    const availW = rootEl.clientWidth - tabbarEl.offsetWidth - dividerEl.offsetWidth;
    outputEl.style.height = '';
    outputEl.style.width = Math.round(ratio * availW) + 'px';   // context flex:1 fills the rest
  } else {
    const availH = rootEl.clientHeight - tabbarEl.offsetHeight - dividerEl.offsetHeight;
    outputEl.style.width = '';
    outputEl.style.height = Math.round(ratio * availH) + 'px';
  }
  sizeOutput();
  sourceOverlay.scheduleDraw();
  const om = document.getElementById('m-menu');     // keep an open popover anchored
  if (om) positionMenu(om, om.dataset.anchor);
}
function sizeOutput() {
  const w = outputEl.clientWidth, h = outputEl.clientHeight;
  if (w === 0 || h === 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // fit a frameAspect (w/h) rect in the panel — mobile was square-only until
  // the canvas menu gained the aspect row (B295)
  const a = session.frameAspect || 1;
  let cw = Math.min(w, h * a), ch = cw / a;
  cw = Math.max(1, cw); ch = Math.max(1, ch);
  let pw = Math.floor(cw * dpr), ph = Math.floor(ch * dpr);
  const cap = 2048 / Math.max(pw, ph);
  if (cap < 1) { pw = Math.floor(pw * cap); ph = Math.floor(ph * cap); }
  if (outputCanvas.width !== pw || outputCanvas.height !== ph) { outputCanvas.width = pw; outputCanvas.height = Math.max(1, ph); }
  outputCanvas.style.width = Math.round(cw) + 'px';
  outputCanvas.style.height = Math.round(ch) + 'px';
  if (engine.getSourceImage()) scheduleRender();
}

// ------------------------------------------------------------- divider gestures
(function setupDivider() {
  let dragging = false;
  function onDown(e) { dragging = true; dividerEl.classList.add('dragging'); e.preventDefault(); }
  function onMove(e) {
    if (!dragging) return;
    let r;
    if (isLandscape()) {
      const x = (e.touches ? e.touches[0].clientX : e.clientX);
      const availW = rootEl.clientWidth - tabbarEl.offsetWidth - dividerEl.offsetWidth;
      r = (x - rootEl.getBoundingClientRect().left) / availW;
    } else {
      const y = (e.touches ? e.touches[0].clientY : e.clientY);
      const availH = rootEl.clientHeight - tabbarEl.offsetHeight - dividerEl.offsetHeight;
      r = (y - rootEl.getBoundingClientRect().top) / availH;
    }
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
// Relayout on rotation without tearing down the chrome, so a live camera feed
// keeps running across portrait↔landscape (no reload, the <video> stays mounted).
mqlLandscape.addEventListener('change', layout);
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

// The pagehide handler below deliberately RELEASES the GL context when the app
// hands off to iOS — which includes the save/share flow — to avoid Safari's
// GPU-context pileup crash. Restoration is the other half (without it, saving
// consistently returned to a black output): preventDefault on `webglcontextlost`
// keeps the context restorable, and on `webglcontextrestored` the engine rebuilds
// its GPU resources + re-uploads the source on the same context object. Also
// covers genuine OS-initiated context losses.
//
// CRITICAL: the WEBGL_lose_context extension must be grabbed WHILE THE CONTEXT IS
// ALIVE and cached — on a LOST context Safari's getExtension returns null, which is
// exactly why the Build-230 restore silently never fired (restoreContext was looked
// up after the loss). The cached object stays valid across loss/restore cycles
// (extensions belong to the context, and the context object survives).
const loseCtxExt = (() => {
  try { return engine.glContext?.getExtension('WEBGL_lose_context') || null; } catch { return null; }
})();
outputCanvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
outputCanvas.addEventListener('webglcontextrestored', () => {
  try { engine.reinitGL(); } catch (e) { console.warn('[fold] GL reinit failed', e); return; }
  if (cameraMode === 'live') { stopLiveLoop(); startLiveLoop(); }
  else if (engine.getSourceImage()) scheduleRender();
});

// Release the WebGL context on navigation away so a refresh doesn't pile up GPU
// contexts (a known iOS Safari crash vector — possible cause of the intermittent
// "a problem repeatedly occurred" on reload).
window.addEventListener('pagehide', () => {
  try { loseCtxExt?.loseContext(); } catch { /* noop */ }
});

// Returning to the app (e.g. after viewing an exported image) can leave the
// output dark: a backgrounded rAF chain may not resume, and a still needs a
// re-render. Force-resume on visibility.
function onVisible() {
  if (document.visibilityState !== 'visible') return;
  // if pagehide released the context, ask for it back first — the
  // webglcontextrestored handler above rebuilds + repaints when it arrives.
  // (Must use the CACHED extension: getExtension on a lost context returns null.)
  const gl = engine.glContext;
  if (gl && gl.isContextLost()) {
    try { loseCtxExt?.restoreContext(); } catch { /* browser-initiated losses restore on their own */ }
    return;
  }
  if (cameraMode === 'live') { stopLiveLoop(); startLiveLoop(); }
  else if (engine.getSourceImage()) { scheduleRender(); }
}
document.addEventListener('visibilitychange', onVisible);
window.addEventListener('pageshow', onVisible);
