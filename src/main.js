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
import { lockState, setLock, makeLockToggle } from './shell/locks.js';
import { DISCRETE_KEYS } from './kit/tween.js';   // discrete settings are global (held to kf0)
import { createEngine } from './engine/index.js';
import { createSourceOverlay } from './components/source-overlay.js';
import { createOutputGestures } from './components/output-gestures.js';
import {
  wireSliderWithScrub,
  makeScrubField,
  buildFormGrid,
  applyFormControls,
  setupStageDivider,
  setupLiveDivider,
  makeControlsSync,
} from './shell/controls.js';
import { PARAMS, DECLARATIVE_PARAM_IDS } from './shell/params.js';
import { snapSpiralValue as kitSnapSpiral, applyArmsSnap as kitApplyArmsSnap } from './kit/snaps.js';
import { createCapabilities, editionAllows, detectRuntime } from './kit/capabilities.js';
import { createCapacitorHost } from './shell/capacitor-host.js';
import { createOpRing } from './kit/op-ring.js';
import { createApp } from './shell/app.js';
import { createFoldAdapter } from './shell/fold-adapter.js';
import { createProgramFrame } from './shell/program-frame.js';
import { createOutputBus } from 'conduit/output-bus';
import { createRecorderSink } from 'conduit/recorder';
import { createSyphonSink } from 'conduit/syphon-sink';
import { createNdiSink } from 'conduit/ndi-sink';
import { createOutputWindow } from './shell/output-window.js';
import { mockSyphonHost } from 'conduit/mock-host';
import { createOutputPanel } from './shell/output-panel.js';
import { mountInputDebug } from './shell/input-debug.js';
import { createPerformRuntime } from './shell/perform-runtime.js';
import { createInputBus } from './shell/input-bus.js';
import { ICONS } from './mobile/icons.js';   // shared glyph set (fit/fill toggle)
import { formatVersion } from './version.js';
import { push as historyPush, undo as historyUndo, redo as historyRedo, canUndo, canRedo } from './shell/history.js';
import { wireDiagnosticButton } from './shell/diagnostics.js';

// ============================================================================
// version footer
// ============================================================================

document.getElementById('versionBadge').textContent = formatVersion();
document.getElementById('aboutVersion').textContent = formatVersion();   // the settings gear replaced the version chip
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

// (the "mini" 2D-copy canvas is GONE — Arc 2a's sibling panels show BOTH real
// views at once, so nothing needs a second-hand copy of the WebGL preview.)

const statusEl = document.getElementById('status');
const diagEl = document.getElementById('diag');
const uploadErrorEl = document.getElementById('uploadError');

// The capability profile (engine identity, capture path, texture cap) is built
// once from the engine's diagnostics — see kit/capabilities.js. Threaded onto
// `env.capabilities` via createApp; used here for the Firefox WebGL-cap notice.
let engine, capabilities;
try {
  engine = createEngine({ canvas: previewCanvas });
  capabilities = createCapabilities(engine);
  // basic always-on diagnostics. expanded with unmasked renderer and device
  // pixel ratio so cross-device comparisons are easier without invoking the
  // full diagnostic panel.
  const dbg = engine.glContext.getExtension('WEBGL_debug_renderer_info');
  const unmasked = dbg ? engine.glContext.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null;
  diagEl.innerHTML = `WebGL2 ok<br>` +
    `renderer: ${unmasked || engine.diagnostics.renderer}<br>` +
    `max texture: ${engine.diagnostics.maxTextureSize}px<br>` +
    `max export: ${engine.diagnostics.maxFBOSize}px<br>` +
    `DPR: ${window.devicePixelRatio || 1}<br>` +
    `profile: ${capabilities.engineId} · capture ${capabilities.capturePath} · maxFBO ${capabilities.maxFBOSize}`;

  // Firefox WebGL-cap notice in the export group. Only rendered when the cap
  // is detected; no-op on Safari/Chrome/Edge and on a Firefox build that
  // somehow doesn't have the 8K cap (unlikely on macOS but possible).
  if (capabilities.firefoxTextureCapped) {
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

// WebGL context-loss safety + diagnostic. preventDefault keeps the context
// RESTORABLE (without it the GPU drops it for good); we surface the loss (a silent
// black preview is worse) and log both edges. This is also the data point for the
// "panels black out on resize while broadcasting" report: if the preview goes black
// but NO 'webglcontextlost' fires, the context is fine and it's a repaint bug, not a
// context loss. (A full restore re-inits engine GL state — a scoped follow-up.)
if (engine) {
  previewCanvas.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault();
    console.warn('[fold] WebGL context LOST (preview canvas)');
    if (statusEl) { statusEl.textContent = 'graphics context lost — recovering…'; statusEl.classList.add('error'); }
  });
  // AUTO-RECOVER (the mobile chrome's proven engine.reinitGL pattern — Daniel hit
  // an OS-initiated loss on the iPad when a 4K display attached, and "reload to
  // recover" is meaningless in a native app). reinitGL rebuilds every GPU
  // resource on the same context object and re-uploads the source; a render
  // brings the panels back.
  previewCanvas.addEventListener('webglcontextrestored', () => {
    console.warn('[fold] WebGL context RESTORED (preview canvas)');
    try {
      engine.reinitGL();
      if (statusEl) { statusEl.textContent = ''; statusEl.classList.remove('error'); }
      scheduleRender();
    } catch (e) {
      console.warn('[fold] GL reinit failed', e);
      if (statusEl) statusEl.textContent = 'graphics context lost — could not recover';
    }
  });
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
  pushHistory: () => historyPush(state, motion, env.clip.trim),
  updateUndoUI: null,  // assigned after setupUndoBar

  // ---- runtime state ------------------------------------------------------
  // Ephemeral runtime flags (NOT the undoable `state`): grouped into cohesive
  // sub-objects so the wiring functions read/write through `env` instead of
  // closing over module-level locals (which is what lets the wiring move to a
  // shared module later). Honors the "no module-level mutable globals" rule.
  // `sourceVideo`/`liveVideo` stay top-level (the source-overlay component
  // binds to those exact handles at construction).
  media: { sourceFilename: '', sourceVideoUrl: null, originalSource: null, captureObjectURL: null },
  live: { isLive: false, active: false, raf: 0, frozen: false },   // frozen = paused on a captured frame, camera resumable (record/pause toggle)
  motionRT: { active: false, raf: 0, start: 0, scrubbing: false, pointers: new Map(), gesture: null, relayoutPending: false },
  clip: {
    trim: { inT: 0, outT: 1, mode: 'forward', slicePoint: 1 / 3, crossfadeMs: 500 },
    prevVideo: null, prevVideoB: null, thumbVideo: null, backup: null, drag: null, raf: 0,
    seg: 0, bounceStart: 0, phase: 'B', seekT: null, seeking: false, baking: false, sel: null,
    fmt: { res: 'source', fps: 'source', speed: 1 },   // output format at bake (resolution / fps / playback speed)
    srcFps: 0,   // measured source frame rate (probed on the bake step; 0 = unknown)
  },
  filmstrip: { timer: 0, lastSig: '', gen: 0, busy: false, freezeEl: null },
  scrub: { seekP: null, seeking: false, assign: true },
  sched: { renderScheduled: false, syncCtrlScheduled: false },
  sourcePreview: { frame: null, overlay: null, parent: null },

  // diagnostics substrate (ephemeral runtime). The unified op-perf ring buffer the
  // live-output bus pushes into and the diagnostics sheet reads back. See
  // kit/op-ring.js + stage/output-bus.js.
  diag: { ops: createOpRing(120) },
};

// the program frame — the committed "what the audience sees" snapshot every
// output consumer reads (defines env.programFrame / env.commitFrame /
// env.programState; see shell/program-frame.js for the commit discipline)
createProgramFrame(env);

// ---- per-control locks (M3 guardrails, shell/locks.js) ---------------------
// isLocked(key) → { locked, unlockable, why }. Reads the current mode + context. The
// `broadcasting` signal (for the resolution/aspect contextual locks) is wired later by the
// output panel via env.isOutputLive; until then it resolves false (toggleable locks work now).
env.isLocked = (key) => lockState({
  session,
  motionActive: env.motionRT.active,
  keyframeCount: motion.keyframes.length,   // ≥2 = at least one MANUAL keyframe past the seed
  outputLive: env.isOutputLive ? env.isOutputLive() : false,
}, key);
env.setLock = (key, locked) => {
  setLock(session, key, locked);
  env.syncLocks?.();             // re-run the lock syncers: padlock glyphs + the container
                                 // states they own (form-grid `form-locked`, aspect/res
                                 // `lock-dimmed`) — without this a toggle flips the glyph but
                                 // leaves the control's disabled visual stale.
  env.syncControls?.();          // re-sync affected control disabled-states
  env.scheduleOverlayDraw?.();   // gesture locks (segments / offset) change the overlay feel
};

// ============================================================================
// rendering scheduler
// ============================================================================

function scheduleRender() {
  if (env.sched.renderScheduled) return;
  env.sched.renderScheduled = true;
  requestAnimationFrame(() => {
    env.sched.renderScheduled = false;
    if (engine && engine.getSourceImage()) {
      engine.render(state);
    }
    env.commitFrame();   // the render's look is the committed program frame
    sourceOverlay.render();
    updateResolutionHint();
    // motion: editing a selected keyframe writes through to it live (snap + thumb).
    if (env.motionRT.active && motion.selected >= 0 && !motion.playing && !env.motionRT.scrubbing) {
      const kf = motion.keyframes[motion.selected];
      // commit the edit live (cheap); the thumbnail refreshes on the debounced,
      // readback-free filmstrip rebuild — NOT per frame (a per-frame exportFrame →
      // readPixels here was the severe Firefox lag while editing a selected keyframe).
      if (kf) {
        kf.snap = { ...state };
        // DISCRETE settings are global — playback holds them to keyframe 0. So editing a discrete
        // control (segment count, mirror, oob…) on a NON-kf0 keyframe writes only that snap, and the
        // hold re-reads kf0 → the edit "forgets" (Daniel). Propagate discrete → every keyframe so a
        // discrete edit is global by construction. (Continuous fields stay per-keyframe.)
        for (const other of motion.keyframes) {
          if (other === kf || !other.snap) continue;
          for (const dk of DISCRETE_KEYS) other.snap[dk] = state[dk];
        }
        env.scheduleFilmstrip();
      }
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
function scheduleSyncControls() {
  if (env.sched.syncCtrlScheduled) return;
  env.sched.syncCtrlScheduled = true;
  requestAnimationFrame(() => { env.sched.syncCtrlScheduled = false; env.syncControls(); });
}

// True while an animation OWNS the program state — playback or an active scrub
// sample params into `state` every frame. Param-editing gestures (slice drag, output
// pinch/twist) are clobbered by that next tick, so they must be inert: the live-output
// bus renders `state` on its own loop and would otherwise broadcast the half-second of
// uncommitted drag before playback re-asserts (the wedge "jumps" in Syphon). Same
// shape as the hideAffordances condition below.
const isMotionDriven = () => env.motionRT.active && (motion.playing || env.motionRT.scrubbing);

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
  // discrete edits (segment-spoke drag, droste-arms drag) follow the SEGMENTS lock — which
  // encodes the keyframe rule (locks at ≥2 keyframes), output-live, and any manual override.
  // So the on-canvas gesture and the padlock always agree (fixes: locked setting but live gesture).
  canEditDiscrete: () => !env.isLocked('segments').locked,
  // per-control lock lookup for the overlay's own gesture checks (e.g. the offset diamond)
  isLocked: (key) => env.isLocked(key),
  // hide the touch affordance arrows during playback/scrub (they're not useful while
  // the animation runs).
  hideAffordances: () => env.motionRT.active && (motion.playing || env.motionRT.scrubbing),
  // lock slice editing while an animation drives the state (see isMotionDriven) —
  // the edit would be clobbered next tick and would leak into the Syphon broadcast.
  editLocked: isMotionDriven,
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
  // the preview always lives in the OUTPUT sibling panel (swap mirrors sides, it
  // doesn't relocate content) — size to the panel's CONTENT WRAP (flex-basis 0, so
  // it measures the actual free space after the meta/control rows take theirs;
  // measuring the whole panel oversized the canvas into its siblings)
  const panel = document.getElementById('outPanel');
  const wrap = panel.querySelector('.slot-content') || panel;
  const containerW = wrap.clientWidth - 16;
  const containerH = wrap.clientHeight - 16;
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

// ============================================================================
// slot management — the symmetric sibling panels (Arc 2a)
// Source and output are PEER panels inside the stage split: middle-aligned,
// ratio via --stage-src-pct (the stage divider drags session.stageSrcPct),
// swap mirrors the sides (row-reverse) — content never relocates, so the old
// mini-canvas 2D copy is gone. Third-panel-ready: output-staged (Arc 5) joins
// as one more .stage-panel.
// ============================================================================

const msStage = document.getElementById('msStage');   // the preview area inside mainSlot, below the bar/bands
const stageSplit = document.getElementById('stageSplit');
const srcPanel = document.getElementById('srcPanel');
const outPanel = document.getElementById('outPanel');
const placeholder = document.getElementById('placeholder');

// vertical-middle parity (Daniel): every sibling panel's PICTURE shares one true
// vertical middle. The below-picture stacks differ per panel (source: meta + form
// row; output: aspect + gear; live: nothing), so each panel gets a bottom SPACER
// sized to the tallest stack minus its own — every content wrap then centers in
// the same box. Runs synchronously inside arrangeSlots, BEFORE the wraps are
// measured, so the source box and preview size against the equalized space.
function equalizeStageMiddles() {
  const panels = [srcPanel, outPanel, document.getElementById('livePanel')]
    .filter(p => p && !p.hidden);
  const stacks = panels.map(p => {
    let h = 0;
    for (const el of p.children) {
      if (el.classList.contains('slot-content') || el.classList.contains('live-wrap') ||
          el.classList.contains('stage-spacer') || el.hidden) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'absolute' || cs.display === 'none') continue;
      h += el.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    }
    return h;
  });
  const tallest = Math.max(0, ...stacks);
  panels.forEach((p, i) => {
    let sp = p.querySelector(':scope > .stage-spacer');
    if (!sp) { sp = document.createElement('div'); sp.className = 'stage-spacer'; p.appendChild(sp); }
    sp.style.height = Math.max(0, Math.round(tallest - stacks[i])) + 'px';
  });
}

function arrangeSlots() {
  env.updateMotionUI();   // gate motion availability on source/live state; force-exit if needed
  env.updateOutputUI?.();  // gate the live-output button on a loaded source
  env.refreshPerformSource?.();   // mid-perform source switches refresh the footer (identity-guarded)
  Array.from(stageSplit.querySelectorAll('.slot-content')).forEach(n => n.remove());

  if (!engine || !engine.getSourceImage()) {
    placeholder.style.display = 'block';
    stageSplit.hidden = true;
    return;
  }
  placeholder.style.display = 'none';
  stageSplit.hidden = false;
  stageSplit.classList.toggle('swapped', session.isSwapped);
  stageSplit.style.setProperty('--stage-src-pct', (session.stageSrcPct || 32) + '%');
  stageSplit.style.setProperty('--stage-live-pct', (session.stageLivePct || 32) + '%');
  equalizeStageMiddles();

  // Both content wraps use flex-basis 0 (not auto): their size is the free space the
  // flex layout hands them AFTER the scrubber/meta/control rows take theirs — so
  // measuring a wrap gives the true available box no matter what's inside it. (Basis
  // auto let oversized content inflate the wrap and overflow the panel — the iPad
  // "source covers the toolbar" bug.)
  const WRAP_CSS = `position: relative; flex: 1 1 0; min-height: 0; display: flex; align-items: center; justify-content: center;`;

  // OUTPUT panel: the WebGL preview, centered (resizePreviewCanvas sizes it)
  const outWrap = document.createElement('div');
  outWrap.className = 'slot-content';
  outWrap.style.cssText = WRAP_CSS;
  previewCanvas.style.display = 'block';
  outWrap.appendChild(previewCanvas);
  outPanel.appendChild(outWrap);

  // SOURCE panel: an aspect-fit box, centered — the same middle alignment as the
  // output. Mount the (empty) wrap FIRST, then measure IT — the wrap is the real
  // available space, panel minus the sibling rows.
  const srcWrap = document.createElement('div');
  srcWrap.className = 'slot-content';
  srcWrap.style.cssText = WRAP_CSS;
  srcPanel.appendChild(srcWrap);
  const inner = document.createElement('div');
  const slotW = Math.max(80, srcWrap.clientWidth - 8);
  const slotH = Math.max(80, srcWrap.clientHeight - 8);
  const sourceAspect = engine.getSourceAspect() || 1;
  let dispW, dispH;
  if (sourceOverlay.getFit() === 'cover') {
    // FILL: the source box takes the whole wrap and the source covers it (cropped)
    // — a bigger manipulation surface; the overlay owns the cover-fit geometry.
    dispW = slotW;
    dispH = slotH;
  } else if (sourceAspect > slotW / slotH) {
    dispW = slotW;
    dispH = slotW / sourceAspect;
  } else {
    dispH = slotH;
    dispW = slotH * sourceAspect;
  }
  inner.style.cssText = `position: relative; width: ${Math.round(dispW)}px; height: ${Math.round(dispH)}px; background: #1a1a1a; border: 1px solid #222;`;
  srcWrap.appendChild(inner);
  sourceOverlay.mount(inner);

  requestAnimationFrame(() => {
    resizePreviewCanvas();
    // A relayout re-mounts the source view with a FRESH (blank) video canvas.
    // Only scrub/playback repaint it (paintSourceVideo), so a video source in motion
    // mode went dark on every relayout until you scrubbed/added a keyframe. Repaint it +
    // rebuild the filmstrip here so the relayout shows the current frame immediately.
    sourceOverlay.paintSourceVideo();
    sourceOverlay.render();
    scheduleRender();
    if (env.motionRT.active && env.sourceVideo) env.scheduleFilmstrip();
  });
}
env.arrangeSlots = arrangeSlots;

// fit/fill toggle (the last Arc 2 source extra, from mobile): fit = the whole
// source, aspect-fit; fill = the source covers the panel space (cropped) for a
// bigger manipulation surface. The icon shows the ACTION you'll take.
const srcFitBtn = document.getElementById('srcFitBtn');
if (srcFitBtn) {
  srcFitBtn.innerHTML = ICONS.expand;
  srcFitBtn.addEventListener('click', () => {
    if (!engine || !engine.getSourceImage()) return;
    const next = sourceOverlay.getFit() === 'cover' ? 'contain' : 'cover';
    sourceOverlay.setFit(next);
    srcFitBtn.innerHTML = next === 'cover' ? ICONS.contract : ICONS.expand;
    srcFitBtn.title = next === 'cover' ? 'fit the whole source (letterbox)' : 'fill the panel (crop)';
    arrangeSlots();   // the source box is sized per fit — refit + remount
  });
}

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

// ---- image / video loading -------------------------------------------------
// Extracted to shell/source-host.js (Phase 2b) — createSourceHost(env) owns
// loadImage / loadVideo / stopSourceVideoPlayback (+ camera + still export) and
// hangs the chrome-facing ones on `env` (env.loadImage / env.loadVideo /
// env.stopSourceVideoPlayback / env.startLiveLoop / env.doExport /
// env.exportPackage / env.downloadBlob).


// ---- clip editor (pre-animation video prep) -------------------------------
// Extracted to shell/clip-editor.js (Phase 2a) — createClipEditor(env) defines
// the trim/bounce/slice sheet + bake pipeline and hangs its public surface
// (openClipEditor / closeClipEditor / applyClip / setClipMode / makeClipHandle /
// clipSeekTo / startClipPreview / stopClipPreview) on `env`.

// ---- live camera + still export --------------------------------------------
// Both extracted to shell/source-host.js (Phase 2b). The camera host (getUserMedia
// + live render loop + flip + capture-to-still) and still export (doExport /
// exportPackage) live there; createSourceHost wires the camera buttons itself and
// exposes env.doExport / env.exportPackage / env.downloadBlob for the chrome.

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
// per-control LOCKS (M3 guardrails) — inject the padlock into each lockable control's row
// and enforce the lock (dim the row + disable its control). One config entry per control;
// env.syncLocks() re-runs them on mode change / toggle. Gesture-level enforcement (a locked
// segment spoke / offset diamond falling through) lives in the overlay via env.isLocked.
// ============================================================================
function wireLocks() {
  const byId = (id) => document.getElementById(id);
  // A locked control is inert (pointer-events:none / disabled), so a tap/hover on it falls through
  // to its container — carry the "why" there so the control EXPLAINS itself instead of silently
  // doing nothing (Daniel: "tapping a locked state should just show the tooltip about why"). Native
  // title covers desktop hover; data-tip-lock feeds the touch tap-tip (wireDisabledTips).
  const applyLockTip = (hostEl, st) => {
    if (!hostEl) return;
    if (st.locked && st.why) { hostEl.title = st.why; hostEl.dataset.tipLock = st.why; }
    else { hostEl.removeAttribute('title'); delete hostEl.dataset.tipLock; }
  };
  const tipHost = (row) => (row.closest && row.closest('.slider')) || row;
  // key → build() returning { row, disable(locked) }. Extended as controls are wired.
  // shared builder for a slider row (input + scrub value in one .row)
  const sliderTarget = (inputId, valId) => () => {
    const inp = byId(inputId), val = byId(valId), row = val && val.parentElement;
    if (!row) return null;
    return { row, disable(locked) {
      row.classList.toggle('locked-row', locked);
      if (inp) inp.disabled = locked;
      if (val) val.style.pointerEvents = locked ? 'none' : '';   // block the scrub-on-value
    } };
  };
  // shared builder for a toggle/enum control: padlock goes in `rowFn()` (a label row or a
  // field-label); locking dims + disables the control element `ctrlId` (its button group).
  const toggleTarget = (rowFn, ctrlId) => () => {
    const row = rowFn(), ctrl = byId(ctrlId);
    if (!row || !ctrl) return null;
    return { row, disable(locked) { ctrl.classList.toggle('lock-dimmed', locked); } };
  };
  const TARGETS = [
    { key: 'segments',    build: sliderTarget('segments', 'segVal') },
    { key: 'spiral',      build: sliderTarget('spiral', 'spiralVal') },                       // droste-only; motion-only lock
    { key: 'mirror',      build: toggleTarget(() => byId('mirrorLabel')?.querySelector('.row'), 'mirrorToggle') },
    { key: 'wedgeMirror', build: toggleTarget(() => byId('wedgeMirrorLabel')?.querySelector('.row'), 'wedgeMirrorToggle') },
    { key: 'oobMode',     build: toggleTarget(() => byId('oobModes')?.previousElementSibling, 'oobModes') },
    // NOTE: center offset is NOT here — it has no padlock. Its manual gesture is governed by the
    // two-toggle on its row (wired below); the overlay enforces via isLocked('drosteOffset').
  ];
  const syncers = [];
  for (const t of TARGETS) {
    const spec = t.build();
    if (!spec) continue;
    spec.row.classList.add('has-lock');
    const btn = makeLockToggle(env, t.key, () => spec.disable(env.isLocked(t.key).locked));
    spec.row.appendChild(btn);
    const sync = () => {
      const st = env.isLocked(t.key);
      btn.sync();
      spec.disable(st.locked);
      applyLockTip(tipHost(spec.row), st);
    };
    syncers.push(sync);
  }

  // FORM picker — a whole-picker lock (form is one logical control). The padlock lives in a header
  // ABOVE the thumbs (#formLockHead) so it never overlaps a form thumb (the old corner overlay
  // covered droste). While locked the grid gets a scrim + goes inert (CSS .form-locked::after);
  // UNLOCKING warns (switching form mid-animation restructures everything, applies to every kf).
  const formGrid = byId('formGrid');
  const formHead = byId('formLockHead');
  if (formGrid && formHead) {
    formHead.classList.add('has-lock');
    const pad = makeLockToggle(env, 'form', null,
      () => window.confirm('switch form? this restructures the whole animation and applies to every keyframe.'));
    formHead.appendChild(pad);
    syncers.push(() => {
      const st = env.isLocked('form');
      pad.sync();
      formGrid.classList.toggle('form-locked', st.locked);
      applyLockTip(formHead, st);
    });
  }

  // CONTEXTUAL locks (resolution while broadcasting, aspect while broadcasting/playing) — the
  // SAME padlock, not clickable; it appears only when the context is active and clears when it
  // ends. Hosted on each control's field-label.
  for (const [key, ctrlId] of [['outputRes', 'outputResTiers'], ['frameAspect', 'frameAspect']]) {
    const ctrl = byId(ctrlId), host = ctrl && ctrl.previousElementSibling;
    if (!host || host.querySelector?.('.lock-toggle')) continue;
    host.classList.add('has-lock');
    const btn = makeLockToggle(env, key, null);   // contextual → makeLockToggle renders it non-clickable
    host.appendChild(btn);
    syncers.push(() => {
      const st = env.isLocked(key);
      btn.sync();
      ctrl.classList.toggle('lock-dimmed', st.locked);
      applyLockTip(host, st);
    });
  }

  env.syncLocks = () => syncers.forEach((s) => s());
  env.syncLocks();

  // center-offset TWO-TOGGLE (Daniel) — both default OFF. `manual` gates the on-canvas diamond
  // drag (fat-finger guard; the overlay reads it via isLocked('drosteOffset')); `autoplay` opts
  // the offset into drift (drift.js reads session.autoplayInclude). Independent — set each alone.
  const offManual = [...document.querySelectorAll('#offsetManual button')];
  const syncOffManual = () => {
    const on = !!session.offsetManual;
    offManual.forEach((b) => b.classList.toggle('active', (b.dataset.manual === '1') === on));
  };
  offManual.forEach((b) => b.addEventListener('click', () => {
    session.offsetManual = b.dataset.manual === '1';
    syncOffManual();
    env.scheduleOverlayDraw?.();   // the diamond's grabbability changed
  }));
  syncOffManual();

  const offAuto = [...document.querySelectorAll('#offsetAutoplay button')];
  const syncOffAuto = () => {
    const inc = !!(session.autoplayInclude && session.autoplayInclude.drosteOffsetX);
    offAuto.forEach((b) => b.classList.toggle('active', (b.dataset.autoplay === '1') === inc));
  };
  offAuto.forEach((b) => b.addEventListener('click', () => {
    const inc = b.dataset.autoplay === '1';
    if (!session.autoplayInclude) session.autoplayInclude = {};
    session.autoplayInclude.drosteOffsetX = inc;
    session.autoplayInclude.drosteOffsetY = inc;
    syncOffAuto();
  }));
  syncOffAuto();
}

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

  // canvas reset — the output stack's parallel of reset slice (Arc 2b). FRAME
  // ASPECT is deliberately NOT reset (Daniel): the canvas settings are
  // sub-attributes OF the selected aspect, so reset applies to them only —
  // and resetting aspect mid-broadcast desynced the preview from the locked
  // output resolution.
  document.getElementById('canvasReset')?.addEventListener('click', () => {
    env.pushHistory();
    state.canvasZoom     = 1.0;
    state.canvasRotation = 0;
    state.oobMode        = 1;   // mirror, the default
    env.controlsSync.syncAll();
    // the OOB buttons sync only in their own click handler — mirror the state here
    document.querySelectorAll('#oobModes button').forEach(b => b.classList.toggle('active', b.dataset.oob === '1'));
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
  wireExportButton('exportBtn', () => env.doExport(session.exportSize));
  wireExportButton('exportPackageBtn', () => env.exportPackage());

  // file input
  document.getElementById('uploadBtn').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) (f.type.startsWith('video/') ? env.loadVideo : env.loadImage)(f);
  });

  // drag & drop
  document.body.addEventListener('dragover', e => e.preventDefault());
  document.body.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (file.type.startsWith('video/')) { env.loadVideo(file); return; }
    const ok = /^image\/(jpeg|png|webp)$/i.test(file.type);
    if (ok) env.loadImage(file);
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

// One restore path for all four triggers (buttons + ⌘Z/⇧⌘Z). History entries now
// carry the keyframe slice of `motion` too, so a restore must also stop playback
// (the tick would clobber the restored state) and rebuild the timeline surfaces.
function performHistoryStep(step) {
  if (motion.playing) env.stopPlayback?.();
  if (!step(state, motion, env.clip.trim)) return;
  env.syncControls();
  env.scheduleRender();
  env.scheduleOverlayDraw();
  env.renderTimeline?.();
  env.updateMotionUI?.();
  env.refreshLoopBuilder?.();   // re-derive the Loop Builder surface from the restored trim (no-op unless active)
  updateUndoUI();
}

function setupUndoBar() {
  env.updateUndoUI = updateUndoUI;
  // undo/redo now live in the output toolbar (index.html) — just wire them.
  document.getElementById('undoBtn').addEventListener('click', () => performHistoryStep(historyUndo));
  document.getElementById('redoBtn').addEventListener('click', () => performHistoryStep(historyRedo));
}

window.addEventListener('keydown', e => {
  if (e.metaKey && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    performHistoryStep(historyUndo);
  } else if (e.metaKey && e.key === 'z' && e.shiftKey) {
    e.preventDefault();
    performHistoryStep(historyRedo);
  }
});

// global output frame aspect — reshapes the preview (WYSIWYG) and is inherited by
// still + video export. Arc 2d: 1:1 · 5:4 · 4:3 · 3:2 · 16:9 (squarest → widest,
// LANDSCAPE default); clicking the SELECTED ratio again flips portrait ↔ landscape
// (the button label follows — 4:3 becomes 3:4). One group since Arc 3 (the output
// panel's frame-aspect row persists across modes).
function wireFrameAspect() {
  const group = document.getElementById('frameAspect');
  if (!group) return;
  const EPS = 0.001;
  const buttons = [...group.querySelectorAll('button')];
  const landOf = (b) => parseFloat(b.dataset.asp) || 1;
  const isActive = (b) => {
    const land = landOf(b);
    return Math.abs(session.frameAspect - land) < EPS || Math.abs(session.frameAspect - 1 / land) < EPS;
  };
  const syncActive = () => buttons.forEach((b) => {
    const active = isActive(b);
    const portrait = active && landOf(b) > 1 && session.frameAspect < 1;
    b.classList.toggle('active', active);
    b.textContent = portrait ? b.dataset.p : b.dataset.l;
  });
  const apply = () => {
    syncActive();
    resizePreviewCanvas();      // reshape the preview to the new frame (also re-renders)
    env.scheduleFilmstrip();
  };
  buttons.forEach((b) => b.addEventListener('click', () => {
    const land = landOf(b);
    if (isActive(b) && land > 1) {
      // click-again flips orientation (1:1 has none)
      session.frameAspect = session.frameAspect > 1 ? 1 / land : land;
    } else {
      session.frameAspect = land;   // a new ratio lands in landscape, the default
    }
    apply();
  }));
  syncActive();
  // let other modes reprogram the frame aspect through the same path (e.g. motion's
  // one-time 16:9 default) so the button highlight + preview + filmstrip all re-sync.
  env.applyFrameAspect = apply;
}

// Global output-toolbar sheets (save / diagnostics) — relocated from the right
// sidebar into modals launched from the toolbar, mirroring the mobile save sheet.
// The inner controls keep their original ids, so their wiring (wireControls /
// wireDiagnosticButton) is unchanged; this only adds open/close.
function wireGlobalSheets() {
  const wire = (sheetId, openId, closeId) => {
    const sheet = document.getElementById(sheetId);
    if (!sheet) return;
    document.getElementById(openId)?.addEventListener('click', () => { sheet.hidden = false; });
    document.getElementById(closeId)?.addEventListener('click', () => { sheet.hidden = true; });
    sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.hidden = true; });
  };
  wire('exportSheet', 'openExportBtn', 'exportClose');
  wire('settingsSheet', 'settingsBtn', 'settingsClose');
  // (#outputBtn toggles the in-column output expand-band, not a sheet — see
  //  wireBarBands below.)

  // the settings sheet's tabs (about · inputs · diagnostics). The diag tab
  // surfaces the recent live-output op records (env.diag.ops) on each show.
  const tabs = document.getElementById('setTabs');
  tabs?.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    tabs.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    for (const t of document.querySelectorAll('.set-tab')) t.hidden = t.id !== b.dataset.tab;
    if (b.dataset.tab === 'tabDiag') renderDiagOps();
  }));
  document.getElementById('settingsBtn')?.addEventListener('click', renderDiagOps);
}

// The global bar's expand-band: #outputBtn reveals #outputRow (live-output controls,
// content wired by createOutputPanel). The band pushes only the preview down.
// (The canvas band is gone — Arc 2b moved the canvas controls into the output
// panel's control stack.)
function wireBarBands() {
  // #outputRow is a vertical DROPDOWN now (Daniel's output-menu redesign) — a
  // fixed-position popover anchored under its toolbar button, so opening it
  // never reflows the stage the way the old in-flow bar-row did.
  const bands = { output: 'outputRow' };
  const btns = { output: 'outputBtn' };

  function setBand(which) {
    for (const k of Object.keys(bands)) {
      const band = document.getElementById(bands[k]);
      if (band) band.hidden = (k !== which);
      document.getElementById(btns[k])?.classList.toggle('band-open', k === which);
    }
    if (which === 'output') {
      env.refreshOutputBand?.();
      // anchor under the trigger, clamped to the viewport (measured after unhide)
      const btn = document.getElementById('outputBtn');
      const pop = document.getElementById('outputRow');
      if (btn && pop && !pop.hidden) {
        const r = btn.getBoundingClientRect();
        const pw = pop.offsetWidth;
        const left = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), window.innerWidth - pw - 8);
        pop.style.left = Math.round(left) + 'px';
        pop.style.top = Math.round(r.bottom + 8) + 'px';
      }
    }
  }
  env.setBand = setBand;

  for (const k of Object.keys(bands)) {
    document.getElementById(btns[k])?.addEventListener('click', () => {
      const band = document.getElementById(bands[k]);
      setBand(band && band.hidden ? k : null);
    });
  }
  // dropdown manners: outside pointerdown or Escape closes (drags that start
  // INSIDE the menu — the mic select, sliders — never re-enter here)
  document.addEventListener('pointerdown', (e) => {
    const band = document.getElementById('outputRow');
    if (!band || band.hidden) return;
    if (e.target.closest('#outputRow') || e.target.closest('#outputBtn')) return;
    setBand(null);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const band = document.getElementById('outputRow');
      if (band && !band.hidden) setBand(null);
    }
  });
}

// Progressive disclosure (Daniel's round-5 direction; replaces the below/flank
// placement variations): each panel persists its essentials, and the dense controls
// open in a POPOVER anchored to the panel's .panel-gear trigger. One popover at a
// time; re-click, outside pointerdown, or Escape closes. The popovers are fixed-
// position at body level so the panels' overflow clipping can't cut them off.
// disabled controls explain themselves on TAP (Daniel, mobile usability):
// title tooltips don't exist on touch, so tapping a disabled control flashes
// its title as a transient tip. Disabled elements never receive events, but
// elementFromPoint still hit-tests them — listen at the document.
function wireDisabledTips() {
  let tip = null, tipT = 0;
  const show = (x, y, text) => {
    if (!text) return;
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'tap-tip';
      document.body.appendChild(tip);
    }
    tip.textContent = text;
    tip.style.left = Math.round(Math.min(window.innerWidth - 12, Math.max(12, x))) + 'px';
    tip.style.top = Math.round(Math.max(34, y)) + 'px';
    tip.classList.add('on');
    clearTimeout(tipT);
    tipT = setTimeout(() => tip.classList.remove('on'), 2400);
  };
  document.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (!t) return;
    const el = document.elementFromPoint(t.clientX, t.clientY);
    if (!el) return;
    const dis = el.closest?.('button[disabled], input[disabled], select[disabled], [aria-disabled="true"]');
    if (dis) {
      const r = dis.getBoundingClientRect();
      show(r.left + r.width / 2, r.top - 8, dis.title || dis.getAttribute('aria-label'));
      return;
    }
    // a locked control is inert, so the tap lands on its container (which carries data-tip-lock):
    // explain WHY it's locked instead of doing nothing (unlock is only via the padlock).
    const locked = el.closest?.('[data-tip-lock]');
    if (locked) { show(t.clientX, t.clientY - 14, locked.dataset.tipLock); return; }
    // CSS-gated clusters (pointer-events: none — motion locks the form grid /
    // discrete rows this way) never hit-test, so the tap lands on an ancestor:
    // it carries data-tip-motion, honored only while the motion gate is on.
    // Live interactive elements win over the container tip.
    if (el.closest('button:not([disabled]), input:not([disabled]), select:not([disabled]), a, .val.scrub')) return;
    const holder = el.closest('[data-tip-motion]');
    if (holder && document.body.classList.contains('motion')) {
      show(t.clientX, t.clientY - 14, holder.getAttribute('data-tip-motion'));
    }
  }, { passive: true });
}

function wirePanelPopovers() {
  const pairs = [
    { btn: document.getElementById('sliceSettingsBtn'), pop: document.getElementById('slicePopover') },
    { btn: document.getElementById('canvasSettingsBtn'), pop: document.getElementById('canvasPopover') },
    { btn: document.getElementById('pfAutoGear'), pop: document.getElementById('autoPopover') },
    // modules created during createApp queue theirs here (the camera-settings
    // gear): onOpen rebuilds dynamic content, onClose stops any live polling.
    ...(env.pendingPopovers || []),
  ].filter((p) => p.btn && p.pop);
  const closeAll = () => pairs.forEach(({ btn, pop, onClose }) => {
    if (!pop.hidden) onClose?.();
    pop.hidden = true; btn.classList.remove('open');
  });
  document.addEventListener('pointerdown', (e) => {
    // drags that START inside a popover (sliders, scrub fields) never re-enter here
    if (e.target.closest('.panel-popover') || e.target.closest('.panel-gear')) return;
    closeAll();
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
  for (const { btn, pop, onOpen } of pairs) {
    btn.addEventListener('click', () => {
      const wasOpen = !pop.hidden;
      closeAll();
      if (wasOpen) return;
      onOpen?.();          // build dynamic content BEFORE unhiding so the measure is real
      pop.hidden = false;
      btn.classList.add('open');
      // anchor ABOVE the trigger (it sits near the panel's bottom edge), centered on
      // it, clamped to the viewport; measured after unhide so the dims are real.
      const r = btn.getBoundingClientRect();
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      const left = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), window.innerWidth - pw - 8);
      let top = r.top - ph - 8;
      if (top < 8) top = Math.min(r.bottom + 8, window.innerHeight - ph - 8);
      pop.style.left = Math.round(left) + 'px';
      pop.style.top = Math.round(top) + 'px';
    });
  }
}

// Render the most recent live-output op records into the diagnostics sheet. Each
// record is one ~1s window pushed by the output bus: throughput + per-frame
// render/readback/publish timings. Empty until a record session has run.
function renderDiagOps() {
  const el = document.getElementById('diagOps');
  if (!el || !env.diag?.ops) return;
  const ops = env.diag.ops.toArray().filter(o => o.op === 'live-output').slice(-8);
  if (!ops.length) { el.innerHTML = ''; return; }
  const rows = ops.map(o =>
    `${o.w}×${o.h} · ${o.throughputFps} fps · render ${o.perFrameMs.render} + read ${o.perFrameMs.read} + publish ${o.perFrameMs.publish} ms`
  ).reverse().join('<br>');
  el.innerHTML = `<br>live output (recent):<br>${rows}`;
}


// ============================================================================
// init
// ============================================================================

if (engine) {
  // Chrome collaborators the extracted modules reach through `env`. Each createX(env)
  // sets its OWN public handles (env.scrubVideo, env.loadImage, env.openClipEditor,
  // …); the shared sourceOverlay stays in main.js — it's chrome. (Per-engine
  // capability checks live on env.capabilities, set below.)
  env.sourceOverlay = sourceOverlay;

  // Mount the shared app wiring (clip editor + source host + motion runtime) and
  // thread the injectable runtime seams. `capabilities` is the browser profile
  // (kit/capabilities.js); `host` is the native-services seam — `?mocksyphon` →
  // the mock Syphon host (exercises the broadcasting path on web), else
  // `window.foldHost` when an Electron/Capacitor shell injected one (Increment 4+),
  // else createApp defaults to the web no-op (shell/host.js). A native shell
  // injects its own host without touching the app.
  // ?mocksyphon → the mock Syphon host (exercises broadcasting on web); else the
  // Electron shell's injected window.foldHost; else the Capacitor host (native iOS)
  // built from @capacitor plugins; else createApp defaults to the web no-op.
  const host = new URLSearchParams(window.location.search).has('mocksyphon')
    ? mockSyphonHost
    : (window.foldHost || (detectRuntime().isCapacitor ? createCapacitorHost() : undefined));
  createApp(env, { capabilities, host });

  // Perform mode (Arc 4) — wired AFTER createApp on purpose: its still/motion
  // segment listeners must run after motion-runtime's own, so a mode switch
  // settles in one pass (motion toggles, then perform shuts down).
  createPerformRuntime(env);

  // The control bus (Arc 6): MIDI + game-controller signals through the mapping
  // layer onto state fields / transport actions. Wired after perform so action
  // dispatch can see env.performRT.
  createInputBus(env);

  // the visible mode picker: a dropdown proxying the hidden segmented buttons
  // (which keep the ordered mode-switch wiring); updateMotionUI re-syncs the
  // select afterward, so a refused switch snaps back
  document.getElementById('modeSelect')?.addEventListener('change', (e) => {
    // (Loop Builder is a fullscreen interstitial now — the app bar + this picker are hidden
    // while it's open, so mode-switching mid-edit can't happen from here.)
    const id = { still: 'stillBtn', motion: 'motionBtn', perform: 'performBtn' }[e.target.value];
    document.getElementById(id)?.click();
    env.updateMotionUI?.();
    // release focus: a focused select eats the perform keys (S did native
    // type-ahead → jumped to STILL; space toggled the dropdown open)
    e.target.blur();
  });

  // Edition gate (the cross-shell seam): an edition may withhold whole feature
  // families. A withheld mode drops from the picker AND its hidden wiring button,
  // so nothing can reach it. Default edition allows all → the shipping build is
  // untouched; `?edition=lite` exercises it (mobile reads the SAME seam).
  for (const m of ['motion', 'perform']) {
    if (!editionAllows(m)) {
      document.querySelector(`#modeSelect option[value="${m}"]`)?.remove();
      document.getElementById(m + 'Btn')?.setAttribute('hidden', '');
    }
  }

  // Stage layer: the engine-agnostic live-output bus + its first sink (record-to-
  // disk), wired through Fold's adapter. The bus renders one frame at the output
  // resolution and fans it to sinks; the output panel (toolbar button with a traffic-
  // light + the docked #outputRow band) drives record/broadcast and shows live status.
  // Syphon + the output-only window are later sinks against this same bus. env.host is
  // set by createApp above (?mocksyphon → the mock host).
  const outputBus = createOutputBus({
    engineAdapter: createFoldAdapter(env),
    host: env.host,
    diag: env.diag,
  });
  // host-aware save: the recorder's own <a download> is a silent no-op inside
  // Capacitor's webview (Daniel's iPad takes vanished) — env.downloadBlob routes
  // through host.fileSystem (share sheet / native dialog) and falls back to the
  // browser download on plain web.
  outputBus.registerSink(createRecorderSink({
    save: (blob, name) => env.downloadBlob(blob, name),
    // ?recorder=mediarecorder forces the fallback engine (device A/B debugging)
    engine: new URLSearchParams(window.location.search).get('recorder') || 'auto',
  }));
  // The external-window destination is universal (plain web APIs), so always available.
  // It's a self-rendering GPU engine view (shell/output-window.js, needsBus:false), not
  // a bus pixel sink — the bus's read-back loop never runs for a window-only session.
  // The Syphon sink only exists where a native host advertises it (the Electron shell);
  // on plain web it's never registered, so the destination picker simply won't list it.
  outputBus.registerSink(createOutputWindow(env));
  if (env.host?.syphon?.available) outputBus.registerSink(createSyphonSink(env.host));
  // NDI mirrors Syphon: registered only where a host embeds a real NDI sender
  // (none yet — the sink + picker row light up the moment host.ndi.available flips).
  if (env.host?.ndi?.available) outputBus.registerSink(createNdiSink(env.host));
  env.outputBus = outputBus;
  createOutputPanel(env, outputBus);

  // HDMI / external display (Capacitor iOS/iPadOS): the sink module — and with it
  // @capacitor/core — loads lazily so the web bundle stays clean (the
  // native-camera pattern); the destination row appears once it's ready via
  // env.addOutputDestination (the panel handles late registration + the
  // auto-select-on-plug-in behavior).
  if (detectRuntime().isCapacitor) {
    import('./shell/external-display.js')
      .then((m) => {
        outputBus.registerSink(m.createExternalDisplaySink(env));
        // one UIScreen path serves BOTH transports and iOS can't tell us which,
        // so the row says so honestly ('HDMI · 3840×2160' alone misled Daniel's
        // AirPlay session); the connected readout appends the display's pixels.
        env.addOutputDestination?.({
          id: 'hdmi',
          label: 'HDMI / AirPlay',
          title: 'present the program on the connected external display — HDMI cable or AirPlay screen mirroring (chrome-free, full screen)',
        });
      })
      .catch((e) => console.warn('[fold] external display unavailable:', e));
  }

  buildFormGrid(env);
  applyFormControls(env);
  wireControls();
  wireLocks();          // padlocks on lockable controls (M3) — after the controls exist
  setupStageDivider(env);
  setupLiveDivider(env);
  wirePanelPopovers();
  wireDisabledTips();
  // claim multi-touch on the output preview too (pinch/twist), same reason as the
  // source surface — keep the browser from swallowing the gesture as a page zoom.
  previewCanvas.style.touchAction = 'none';
  createOutputGestures(previewCanvas, {
    state,
    onChange: () => { scheduleSyncControls(); env.scheduleRender(); },
    onCommitStart: () => env.pushHistory(),
    onCommitEnd: () => updateUndoUI(),
    // same lock as the source overlay: canvasZoom/canvasRotation are animated, so an
    // output pinch/twist during playback is clobbered + would leak into the broadcast.
    editLocked: isMotionDriven,
  });
  setupUndoBar();
  wireFrameAspect();
  wireGlobalSheets();
  wireBarBands();
  wireDiagnosticButton(engine, () => state);
  mountInputDebug();   // ?inputdebug → on-screen pointer/touch/gesture readout (hybrid-input diagnosis)

  window.addEventListener('resize', () => {
    // both sibling panels resize with the window — rebuild so the source box
    // refits (same as the old swapped branch, now unconditional)
    if (engine && engine.getSourceImage()) arrangeSlots();
    else resizePreviewCanvas();
    sourceOverlay.render();
    env.renderRuler();                   // label density depends on width
    env.scheduleFilmstrip();
  });
}
