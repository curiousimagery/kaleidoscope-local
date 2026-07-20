// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/motion-runtime.js
//
// The MOTION runtime: the multi-keyframe still-animation + source-video timeline
// (desktop/iPad). One cohesive, tightly-coupled subsystem — sampling/playback,
// keyframe ops, the timeline (ruler + markers + zoom/pan view-transform + filmstrip),
// video scrub/retime, motion-JSON round-trip, and the video-export sheet — kept in a
// single module because these all call each other constantly (splitting would convert
// in-file calls into cross-module handles with no real separation).
//
// Extracted from main.js (Phase 2c). Collaborators are reached via late-bound env
// handles (env.resizePreviewCanvas / arrangeSlots / sourceOverlay /
// scheduleRender / syncControls / pushHistory / applyFormControls / stopSourceVideoPlayback /
// startLiveLoop / openClipEditor …); the runtime hangs its own public surface back on env
// (env.scrubVideo / renderTimeline / updateMotionUI / haltPlayback / rebindMotionToSource /
// ensureSeededSelection / lockVideoDuration / stopPlayback / fmtClock / renderRuler /
// scheduleFilmstrip) and wires its own DOM (wireMotion + setupVideoExport).

import { sampleKeyframes, DISCRETE_KEYS, CONTINUOUS_KEYS, ANGULAR_KEYS, angDelta } from '../kit/tween.js';
import { FOLLOW_SPANS } from '../kit/follow.js';
import { ICONS } from '../mobile/icons.js';
import { pToMediaSec, seekVideoTo } from './video-source.js';
import { exportVideo, videoExportSupported, pickVideoCodec } from './video-export.js';
import { createSequentialFrameReader } from './video-decode.js';
import { drawSourceOverlay } from './overlay.js';
import { makeScrubField } from './controls.js';
import { zipStore } from './zip.js';
import { formatVersion } from '../version.js';

export function createMotionRuntime(env) {
  // Stable refs (set at env construction, never reassigned) are captured here; all
  // cross-module FUNCTION handles are called late-bound as env.X() (see header).
  const { engine, state, session, motion, previewCanvas } = env;

// However you arrive in the motion editor — fresh entry, source switch, or the clip
// editor (trim/bake) — you should always land with a kf0 (the start/end anchor recording
// the current look) AND with it selected, so the next +keyframe adds an IN-BETWEEN
// keyframe rather than re-creating a start anchor. Returns true if it seeded kf0 (which
// renders/scrubs on its own, so the caller can skip its own render).
function ensureSeededSelection() {
  if (!env.motionRT.active) { motion.selected = -1; return false; }
  if (!kfList().length) { addKeyframe({ seed: true }); return true; }   // seed kf0 (records the current slice look)
  const i = keyframeAt(motion.playhead);
  motion.selected = i >= 0 ? i : 0;                          // kf0 at the playhead → selected, so +keyframe inserts between
  return false;
}

// A new source loaded while we're in motion mode with keyframes: re-bind the motion to
// it instead of leaving stale state behind (old locked duration, old-source thumbnails,
// a desynced play/pause). Keyframes are source-AGNOSTIC (params over time, like the
// motion-JSON), so they're kept; everything that depends on the source is reset.
function rebindMotionToSource() {
  // a new source mid-staging: the committed set (and its footage copy's blob
  // URL, about to be revoked) belongs to the OLD source — commit as a cut
  if (stg.on) endStaging('cut', { resume: false });
  haltPlayback();
  session.timelineZoom = 1; session.timelinePan = 0;          // back to fit
  motion.playhead = 0;
  if (env.sourceVideo) lockVideoDuration();                  // re-lock to the new clip (× retime)
  env.filmstrip.lastSig = '';                                // old-source thumbs → force a rebuild
  if (ensureSeededSelection()) return;                       // seeded kf0 → it handled render/scrub
  renderTimeline();
  updateMotionUI();
  if (env.sourceVideo) scrubVideo(0);                         // show the new clip's first frame (timeline-driven, not free-run)
  else renderSampled(0);                                      // still: show the playhead-0 look
}

// CLIP edit state (pre-animation): trim + loop strategy lives in `env.clip.trim`.
// `inT`/`outT` are normalized trim handles (default = whole clip). bounce/slice are the
// seamless-loop modes (bounce = forward-then-reverse source time; slice = baked
// crossfade — increment B). The timeline spans only [inT, outT]; defaults reproduce the
// untrimmed behavior exactly.

// VIDEO retime: the locked motion duration = the TRIMMED clip length ÷ the playback-
// speed multiplier (so ¼× makes the timeline + export 4× longer = slow-mo). Stills set
// durationMs directly and ignore videoSpeed.
function videoNativeDurationMs() {
  const d = env.sourceVideo && env.sourceVideo.duration;
  if (!(d && isFinite(d))) return 0;
  return Math.round((env.clip.trim.outT - env.clip.trim.inT) * d * 1000);   // trimmed length
}
function lockVideoDuration() {
  const nat = videoNativeDurationMs();
  if (nat) motion.durationMs = Math.max(1, Math.round(nat / (motion.videoSpeed || 1)));
}
function setVideoSpeed(spd) {
  if (!env.sourceVideo) return;
  motion.videoSpeed = spd;
  lockVideoDuration();
  try { env.sourceVideo.playbackRate = spd; } catch { /* some browsers clamp extreme rates */ }
  if (stg.video) { try { stg.video.playbackRate = spd; } catch { /* clamp */ } }   // retime is global — the committed copy follows
  clampTimelineView();                 // duration changed → max-zoom bound changed
  renderTimeline();                    // ruler reflects the new effective duration
  updateMotionUI();
}


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

// Motion runtime state lives in `env.motionRT`: active (mode on/off), raf (the play
// loop handle), start (performance.now() baseline for the current play), scrubbing,
// pointers (active track pointers for multi-touch pinch/pan), gesture (two-finger
// anchor: start dist / zoom / pan), relayoutPending (timeline-relayout coalescing).

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
  c.width = 160; c.height = 160;   // 120² before Arc 3 — the taller track shows bigger keyframes
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
function renderSourcePreviewFrame(snap, size) {
  const sp = env.sourcePreview;
  const img = engine.getSourceImage();
  if (!img) return null;
  if (!sp.frame) {
    sp.frame = document.createElement('canvas');
    sp.parent = document.createElement('div');
    sp.parent.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none';
    sp.overlay = document.createElement('canvas');
    sp.parent.appendChild(sp.overlay);
    document.body.appendChild(sp.parent);
  }
  sp.frame.width = size; sp.frame.height = size;
  sp.parent.style.width = sp.parent.style.height = size + 'px';
  const fctx = sp.frame.getContext('2d');
  fctx.fillStyle = '#000'; fctx.fillRect(0, 0, size, size);

  // source image rect — match drawSourceOverlay's fit math (square frame) so the
  // wedge lines up with the image.
  const view = env.sourceOverlay.view;
  const sa = engine.getSourceAspect();
  const cover = view.fit === 'cover';
  let iw, ih, ix, iy;
  if ((sa > 1) !== cover) { iw = size; ih = size / sa; ix = 0; iy = (size - ih) / 2; }
  else { ih = size; iw = size * sa; ix = (size - iw) / 2; iy = 0; }
  fctx.drawImage(img, ix, iy, iw, ih);

  const saved = { canvas: view.sourceOverlayCanvas, state: view.state, hover: view.hoverMode, hide: view.hideAffordances, sw: view.overlayStrokeScale };
  view.sourceOverlayCanvas = sp.overlay;
  view.state = snap;
  view.hoverMode = null;
  view.hideAffordances = () => true;
  view.overlayStrokeScale = size / 540;            // ~5px wedge lines at 1920² (vs hairline)
  try { drawSourceOverlay(view); }
  finally {
    view.sourceOverlayCanvas = saved.canvas; view.state = saved.state;
    view.hoverMode = saved.hover; view.hideAffordances = saved.hide; view.overlayStrokeScale = saved.sw;
  }
  fctx.drawImage(sp.overlay, 0, 0, size, size);
  return sp.frame;
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
  if (ph) ph.style.left = tToPct(p) + '%';
}
function renderSampled(p) {
  // mutate the working state to the sampled frame so BOTH the output and the source
  // wedge overlay animate in sync during playback/scrub. (no syncControls — sliders
  // resync on pause/scrub-end via loadPlayheadIntoState; no history push — it's navigation.)
  Object.assign(state, sampleAt(p));
  if (engine && engine.getSourceImage()) {
    engine.render(state);
  }
  env.commitFrame?.();   // playback's commit point: the sampled look is the program
  env.sourceOverlay.render();
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
//
// Two ways to get there. Normally: seek the <video> element (universal, but the
// browser re-decodes from the previous keyframe on EVERY step — the export-speed
// wall). During a render, setupExportReader() may arm the FAST path: an mp4box +
// VideoDecoder sequential reader (shell/video-decode.js) that decodes the stream
// once, painting each frame into a canvas the engine was re-pointed at. Any
// mid-render failure tears the reader down and the rest of the render continues
// on the seek path — the fast path can only ever cost nothing.
let exportReader = null, exportReaderCtx = null;

async function setupExportReader() {
  const v = env.sourceVideo;
  if (!v || exportReader) return;
  let reader = null;
  try {
    reader = await createSequentialFrameReader(v.currentSrc || v.src);
    if (!reader) return;
    const cv = document.createElement('canvas');
    cv.width = v.videoWidth || reader.width;
    cv.height = v.videoHeight || reader.height;
    const ctx = cv.getContext('2d');
    try { ctx.drawImage(v, 0, 0, cv.width, cv.height); } catch { /* seed only */ }
    engine.setSource(cv);                          // render loop is paused during a render session
    exportReader = reader;
    exportReaderCtx = ctx;
    console.info('[fold] render uses the fast decode path (sequential VideoDecoder)');
  } catch (e) {
    try { reader?.close(); } catch { /* never opened */ }
    console.warn('[fold] fast decode unavailable — rendering via element seeks:', e);
  }
}

function teardownExportReader() {
  if (!exportReader) return;
  try { exportReader.close(); } catch { /* already closed */ }
  exportReader = null;
  exportReaderCtx = null;
  const v = env.sourceVideo;
  if (v) {
    try { engine.setSource(v); engine.updateSourceFrame(); } catch { /* not ready */ }
  }
}

async function advanceSourceToP(p) {
  const v = env.sourceVideo;
  if (!v) return;
  const sec = pToMediaSec(v, p, env.clip.trim);
  if (exportReader) {
    try {
      const frame = await exportReader.frameAt(sec);
      exportReaderCtx.drawImage(frame, 0, 0, exportReaderCtx.canvas.width, exportReaderCtx.canvas.height);
      engine.updateSourceFrame();
      return;
    } catch (e) {
      console.warn('[fold] fast decode failed mid-render — falling back to element seeks:', e);
      teardownExportReader();   // re-points the engine at the video element
    }
  }
  await seekVideoTo(v, sec);
  engine.updateSourceFrame();
}
// Scrub the footage to p, coalescing seeks (latest target wins) so dragging the
// timeline never floods the decoder. Renders params + the landed frame together.
// Seek the footage to timeline position p (coalesced — latest target wins) and
// re-render. assignParams=true samples the keyframed params at p (scrub / load-
// playhead); false keeps the working state as-is — selecting a keyframe must show
// its EXACT stored snap, just over the correct video frame (not the interpolated
// value).
async function scrubVideo(p, { assignParams = true } = {}) {
  env.filmstrip.gen++;             // cancel any in-flight thumbnail build (it would fight our seeks)
  env.scrub.seekP = p;
  env.scrub.assign = assignParams;
  if (env.scrub.seeking) return;
  env.scrub.seeking = true;
  try {
    while (env.scrub.seekP != null) {
      const target = env.scrub.seekP; env.scrub.seekP = null;
      const assign = env.scrub.assign;
      await advanceSourceToP(target);
      if (assign) Object.assign(state, sampleAt(target));
      if (engine && engine.getSourceImage()) engine.render(state);
      env.commitFrame?.();   // the scrub's settled look is the program
      env.sourceOverlay.paintSourceVideo();
      env.sourceOverlay.render();
      setPlayhead(target);
    }
  } finally {
    env.scrub.seeking = false;   // never leave the loop flag stuck (even if a seek/render throws)
  }
}

// ---- playback -------------------------------------------------------------
function haltPlayback() {
  motion.playing = false;
  if (env.motionRT.raf) { cancelAnimationFrame(env.motionRT.raf); env.motionRT.raf = 0; }
  if (env.sourceVideo) { try { env.sourceVideo.pause(); } catch { /* ignore */ } }
}
function startPlayback() {
  if (motion.playing || kfList().length < (env.sourceVideo ? 1 : 2)) return;   // video: 1 kf is playable (footage moves)
  closeKfMenu();
  if (env.sourceVideo) { startVideoPlayback(); return; }   // a video source is its own clock
  motion.playing = true;
  motion.selected = -1;
  env.motionRT.start = performance.now() - motion.playhead * motion.durationMs;
  const tick = () => {
    if (!motion.playing) return;
    let p = (performance.now() - env.motionRT.start) / motion.durationMs;
    if (motion.loop) { p -= Math.floor(p); }
    else if (p >= 1) { renderSampled(1); haltPlayback(); loadPlayheadIntoState(); renderTimeline(); updateMotionUI(); return; }
    renderSampled(p);
    followPlayhead(p);
    env.motionRT.raf = requestAnimationFrame(tick);
  };
  env.motionRT.raf = requestAnimationFrame(tick);
  updateMotionUI();
}
// Playback over a source video: the <video> is the master clock — it plays, and
// each frame we derive p from its currentTime, sample the params at p, and render
// (so params stay locked to the actual presented frame). Mirrors the live-camera
// loop with parameter sampling layered on.
function startVideoPlayback() {
  const v = env.sourceVideo;
  if (!v) return;
  env.filmstrip.gen++;             // cancel any in-flight thumbnail build before we drive the footage
  motion.playing = true;
  motion.selected = -1;
  const dur = (v.duration && isFinite(v.duration)) ? v.duration : 1;
  const inSec = env.clip.trim.inT * dur, outSec = env.clip.trim.outT * dur, span = Math.max(0.001, outSec - inSec);
  v.currentTime = pToMediaSec(v, motion.playhead >= 1 ? 0 : motion.playhead, env.clip.trim);
  v.loop = false;                  // we loop within the TRIMMED range ourselves (native loop = whole clip)
  try { v.playbackRate = motion.videoSpeed || 1; } catch { /* clamp */ }   // retime
  v.play().catch(() => {});
  const tick = () => {
    if (!motion.playing) return;
    if (v.currentTime >= outSec - 0.03 || v.currentTime < inSec - 0.03) {   // reached the trimmed end
      if (motion.loop) { try { v.currentTime = inSec; } catch { /* ignore */ } }
      else { haltPlayback(); loadPlayheadIntoState(); renderTimeline(); updateMotionUI(); return; }
    }
    let p = Math.max(0, Math.min(1, (v.currentTime - inSec) / span));
    engine.updateSourceFrame();
    Object.assign(state, sampleAt(p));
    if (engine && engine.getSourceImage()) engine.render(state);
    env.commitFrame?.();   // video playback's commit point (params locked to the presented frame)
    env.sourceOverlay.paintSourceVideo();
    env.sourceOverlay.render();
    setPlayhead(p);
    followPlayhead(p);
    env.motionRT.raf = requestAnimationFrame(tick);
  };
  env.motionRT.raf = requestAnimationFrame(tick);
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
function addKeyframe(opts) {
  if (!engine || !engine.getSourceImage()) return;
  if (motion.playing) stopPlayback();
  // Undoable — EXCEPT the automatic kf0 seed on entering motion mode (a system
  // add the user didn't perform; recording it would put a weird empty-motion
  // step in the history). Click handlers pass an event here, not opts, so the
  // seed flag only exists on the explicit seed call sites.
  if (!(opts && opts.seed)) { env.pushHistory?.(); env.updateUndoUI?.(); }
  // Commit any in-flight edit to the currently-selected keyframe BEFORE laying the
  // next one, so the just-edited keyframe is never left stale. (Daniel's diagnosis:
  // the old Build-97 "duplicate pause" was a missing save-on-add trigger, not
  // auto-select itself — so we keep auto-select and make the commit explicit.)
  if (motion.selected >= 0 && kfList()[motion.selected]) {
    kfList()[motion.selected].snap = { ...state };
  }
  const kf = { t: 0, snap: { ...state }, thumb: makeThumbCanvas(), anchored: false };
  let newIdx;
  if (kfList().length === 0) {
    kf.anchored = true;                          // keyframe 0 is the fixed start anchor
    kfList().push(kf);
    newIdx = 0;
  } else if (motion.selected >= 0) {
    // a keyframe is highlighted → lay an AUTO-SPACED keyframe right after it (the spacing
    // rebalances across the auto keyframes).
    kfList().splice(motion.selected + 1, 0, kf);
    newIdx = motion.selected + 1;
  } else {
    // scrubbed to a free point with nothing highlighted → ANCHOR a keyframe at that exact
    // scrubber position (the user picked the moment; honor it instead of auto-spacing).
    kf.anchored = true;
    kf.t = motion.playhead;
    let ins = kfList().findIndex(k => k.t > motion.playhead);   // keep the array in time order
    if (ins < 0) ins = kfList().length;
    kfList().splice(ins, 0, kf);
    newIdx = ins;
  }
  applyAutoSpacing();
  // An auto-spaced keyframe should LIE on the existing motion curve at its new time, so
  // inserting it doesn't detour the motion — capture the INTERPOLATED value there, not a
  // copy of the highlighted keyframe (the bug: inserting between two keyframes inherited
  // the first one's look). Anchored adds already capture the interpolated value via
  // `state` (loaded from the playhead sample), so this targets the auto-spaced branch.
  let interpolated = false;
  if (!kf.anchored && kfList().length > 1) {
    const tNew = kfList()[newIdx].t;
    const others = kfList().filter((_, i) => i !== newIdx);
    const interp = sampleKeyframes(others, tNew, { smoothing: motion.smoothing, loop: motion.loop });
    for (const dk of DISCRETE_KEYS) interp[dk] = kfList()[0].snap[dk];   // discrete stays locked to kf0
    kf.snap = interp;
    Object.assign(state, interp);                 // edits build on the interpolated base, not the old look
    interpolated = true;
  }
  // the new keyframe is AUTO-SELECTED, so subsequent edits write through (autosave) to it.
  motion.selected = newIdx;
  setPlayhead(kfList()[newIdx].t);
  if (interpolated) env.syncControls?.();         // panel reflects the interpolated value
  renderTimeline();                              // marker appears (blank thumb); also schedules the filmstrip
  updateMotionUI();
  if (env.sourceVideo) scrubVideo(kfList()[newIdx].t, { assignParams: false });   // footage follows the new keyframe's time
  else if (interpolated) env.scheduleRender?.();  // re-render the output to the interpolated look
  // thumbnail fills on the debounced, readback-free filmstrip rebuild (no per-add readPixels)
}
// ===========================================================================
// +gesture — record a manipulation as ONE keyframe (Daniel's model, round 2:
// a gesture is not a timing recording — it lands as a single keyframe that
// blends from the previous one like any other. What the capture adds is the
// WINDING: rotate 350° or 400° and the tween travels the full amount instead
// of the shortest path, because the take accumulates the signed angular
// travel and stores it as kf.wind — consumed by sampleKeyframes' winding
// class snap. The smoothed translation-path capture is a spec'd follow-up.)
// Arm → your next manipulation starts the take → press again ends it (or
// ~1.2s of stillness). The keyframe inserts exactly like +keyframe would
// (same selection/auto-space/undo semantics).
// ===========================================================================
const GEST_ANGULAR = new Set(ANGULAR_KEYS);
const gest = { armed: false, recording: false, base: null, last: null, wind: {}, lastMoveT: 0, raf: 0, preSel: -1 };
const GEST_EPS = 0.006;       // movement threshold (normalized state distance)
const GEST_IDLE_MS = 1200;    // stillness that ends a take
const GEST_MAX_MS = 120000;   // hard cap on a take

function gestDist(a, b) {
  let mx = 0;
  for (const k of CONTINUOUS_KEYS) {
    const span = FOLLOW_SPANS[k] || 1;
    const d = GEST_ANGULAR.has(k)
      ? Math.abs(angDelta(a[k] ?? 0, b[k] ?? 0))
      : Math.abs((a[k] ?? 0) - (b[k] ?? 0));
    if (d / span > mx) mx = d / span;
  }
  return mx;
}

function syncGestUI() {
  const btn = document.getElementById('mfGesture');
  if (!btn) return;
  btn.classList.toggle('active', gest.armed);
  btn.textContent = gest.recording ? '● recording' : gest.armed ? '● armed' : '＋ gesture';
  btn.title = gest.recording
    ? 'recording — press again to land the keyframe (G)'
    : gest.armed
      ? 'armed — your next manipulation starts the take; press again to cancel (G)'
      : 'record a gesture as a keyframe — full rotations kept: arm, manipulate, press again to finish (G)';
}

function cancelGesture() {
  gest.armed = gest.recording = false;
  if (gest.raf) { cancelAnimationFrame(gest.raf); gest.raf = 0; }
  gest.wind = {};
  syncGestUI();
}

function gestTick() {
  if (!gest.armed) return;
  const now = performance.now();
  if (!gest.recording && gestDist(state, gest.base) > GEST_EPS) {
    gest.recording = true;
    gest.t0 = now;
    gest.lastMoveT = now;
    gest.last = { ...gest.base };
    gest.wind = {};
    syncGestUI();
  }
  if (gest.recording) {
    // accumulate the signed angular travel — per-frame deltas are < 180°, so
    // the sum is the exact winding (this is the whole point of the capture)
    for (const k of ANGULAR_KEYS) {
      gest.wind[k] = (gest.wind[k] || 0) + angDelta(gest.last[k] ?? 0, state[k] ?? 0);
    }
    if (gestDist(state, gest.last) > GEST_EPS * 0.5) gest.lastMoveT = now;
    gest.last = { ...state };
    if (now - gest.lastMoveT > GEST_IDLE_MS || now - gest.t0 > GEST_MAX_MS) { finishGesture(); return; }
  }
  gest.raf = requestAnimationFrame(gestTick);
}

function finishGesture() {
  const base = gest.base, wind = gest.wind;
  const final = { ...state };
  cancelGesture();
  // a real take moved somewhere — or wound somewhere and back (a full 360 spin
  // ends where it began; the winding is exactly what it captured)
  const wound = Object.values(wind).some((w) => Math.abs(w) > 5);
  if (gestDist(base, final) < GEST_EPS && !wound) { updateMotionUI(); return; }
  // insert through the normal +keyframe pathway (history push, in-flight commit,
  // selection/auto-space semantics) — with state restored to the ARMED look so
  // the commit-to-selected step writes the pre-take state, not the take's end
  Object.assign(state, base);
  motion.selected = gest.preSel;
  addKeyframe();
  const kf = kfList()[motion.selected];
  if (!kf) return;
  kf.snap = { ...final };
  for (const dk of DISCRETE_KEYS) kf.snap[dk] = kfList()[0].snap[dk];   // the timeline invariant
  // winding rides the keyframe for fields that traveled meaningfully; the
  // sampler snaps it to the class that lands exactly on the keyframe's angle
  const w = {};
  for (const k of ANGULAR_KEYS) {
    if (wind[k] != null && Math.abs(wind[k]) > 1) w[k] = Math.round(wind[k] * 10) / 10;
  }
  if (Object.keys(w).length) kf.wind = w;
  Object.assign(state, kf.snap);
  env.syncControls?.();
  renderTimeline();
  env.scheduleRender?.();
}

function toggleGesture() {
  if (!env.motionRT.active || !engine || !engine.getSourceImage()) return;
  if (gest.armed) {
    if (gest.recording) finishGesture();
    else cancelGesture();                 // armed but never moved → disarm quietly
    return;
  }
  if (motion.playing) stopPlayback();
  closeKfMenu();
  gest.preSel = motion.selected;          // the take's keyframe inserts where +keyframe would have
  motion.selected = -1;                   // edits must not write through to a keyframe mid-take
  renderTimeline();
  gest.armed = true;
  gest.recording = false;
  gest.base = { ...state };
  syncGestUI();
  gest.raf = requestAnimationFrame(gestTick);
}

// ===========================================================================
// STAGE CHANGES — live keyframe editing while the animation keeps playing
// (Daniel's approved spec + his two-playhead play/pause decision). On entry
// the keyframe set FORKS: the COMMITTED copy keeps driving the live view and
// every broadcast (the programState seam) on its own clock — on-air and
// untouchable; motion.keyframes becomes the STAGED set you edit with every
// normal interaction, and the stage canvas previews it. SPACE plays/pauses
// the STAGED preview (the existing playback machinery IS that player — it
// drives env.state, which no longer feeds broadcasts while staging). TAKE
// (T, the only commit key) swaps committed→staged and eases the on-air
// output across the discontinuity at the shared transition speed; CUT swaps
// instantly; DISCARD restores the committed set (undoable). Leaving motion
// mid-staging commits as a cut — staged edits are never silently lost.
// VIDEO sources fork a SECOND decode path: staging spins up its own hidden
// <video> on the same blob URL (one element can't present two times at once —
// the committed loop's frame vs your edit frame), and that copy IS the
// committed clock. The program consumers (output bus, live PiP, output
// window) follow it through env.programVideo(); the take blend is params-only
// (sync+play aligns the phases when frame continuity across a take matters).
// ===========================================================================
const stg = { on: false, committed: null, playing: false, p: 0, t0: 0, raf: 0, live: null, blend: null, lastBar: 0, video: null };
const stgWrap360 = (v) => ((v % 360) + 360) % 360;
// consumed by env.programState (perform-runtime): what the audience sees
// while staging (the committed loop) or while a take blends across
env.motionStageLive = () => (stg.on ? stg.live : (stg.blend ? stg.blend.live : null));
// the FOOTAGE the audience sees: while staging a video source, every program
// consumer (bus hidden engine, live PiP, output window's clock) reads frames
// from the committed copy instead of the shared edit element. Consumers keep
// the shared element until the copy's first frame decodes (readyState guard),
// so the handoff never shows an empty texture or a t=0 clock blip.
env.programVideo = () => (stg.on && stg.video && stg.video.readyState >= 2 ? stg.video : null);

// The committed loop's own footage copy. Seeded at the fork position once its
// first frame decodes (until then stgAdvance runs on the wall clock, so p
// carries over seamlessly); loops within the trimmed range itself, mirroring
// startVideoPlayback. Torn down on every staging exit — take/cut/discard all
// hand the program back to the shared element.
function stgStartVideo() {
  const v2 = document.createElement('video');
  v2.muted = true; v2.playsInline = true; v2.preload = 'auto'; v2.loop = false;
  v2.setAttribute('playsinline', ''); v2.setAttribute('muted', '');
  v2.disablePictureInPicture = true; v2.setAttribute('disablepictureinpicture', '');
  v2.src = env.media.sourceVideoUrl;
  v2.addEventListener('loadeddata', () => {
    if (stg.video !== v2) return;                      // staging ended before the copy loaded
    try { v2.playbackRate = motion.videoSpeed || 1; } catch { /* some browsers clamp */ }
    try { v2.currentTime = pToMediaSec(v2, stg.p, env.clip.trim); } catch { /* not seekable yet */ }
    if (stg.playing) v2.play().catch(() => {});
  }, { once: true });
  stg.video = v2;
}
function stgStopVideo() {
  const v2 = stg.video;
  if (!v2) return;
  stg.video = null;
  try { v2.pause(); } catch { /* ignore */ }
  v2.removeAttribute('src');                           // release the decoder; the blob URL stays owned by media
  try { v2.load(); } catch { /* ignore */ }
}

function stgEval(list, p) {
  const out = sampleKeyframes(list, p, { smoothing: motion.smoothing, loop: motion.loop });
  for (const k of DISCRETE_KEYS) out[k] = list[0].snap[k];
  return out;
}
function stgAdvance(now) {
  // a video source: the committed COPY is its own clock (mirrors
  // startVideoPlayback — deriving p from the presented frame keeps the
  // program's params locked to the footage it's actually showing)
  const v2 = stg.video;
  if (v2 && v2.readyState >= 2 && v2.duration && isFinite(v2.duration)) {
    const inSec = env.clip.trim.inT * v2.duration, outSec = env.clip.trim.outT * v2.duration;
    const span = Math.max(0.001, outSec - inSec);
    if (stg.playing) {
      if (v2.paused && !v2.seeking) v2.play().catch(() => {});
      if (v2.currentTime >= outSec - 0.03 || v2.currentTime < inSec - 0.03) {   // trimmed end
        if (motion.loop) { try { v2.currentTime = inSec; } catch { /* ignore */ } }
        else { stg.playing = false; try { v2.pause(); } catch { /* ignore */ } }
      }
    } else if (!v2.paused) { try { v2.pause(); } catch { /* ignore */ } }
    stg.p = Math.max(0, Math.min(1, (v2.currentTime - inSec) / span));
    return stg.p;
  }
  if (stg.playing) {
    let p = (now - stg.t0) / motion.durationMs;
    if (motion.loop) p -= Math.floor(p);
    else if (p >= 1) { p = 1; stg.playing = false; }
    stg.p = p;
  }
  return stg.p;
}
function stgChanges() {
  const a = motion.keyframes, b = stg.committed || [];
  let n = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (Math.abs(a[i].t - b[i].t) > 1e-6) { n++; continue; }
    let diff = false;
    for (const k of CONTINUOUS_KEYS) if ((a[i].snap[k] ?? 0) !== (b[i].snap[k] ?? 0)) { diff = true; break; }
    if (!diff) for (const k of DISCRETE_KEYS) if (a[i].snap[k] !== b[i].snap[k]) { diff = true; break; }
    if (diff) n++;
  }
  return n;
}
function stgLoop(now) {
  if (!stg.on) return;
  const p = stgAdvance(now);
  stg.live = stgEval(stg.committed, p);
  env.commitFrame?.();   // staging's commit point: the committed loop stays on-air
  env.liveView?.render(stg.live);
  const head = document.getElementById('mfLiveHead');
  if (head) head.style.left = tToPct(p) + '%';
  if (now - stg.lastBar > 300) {   // the change counter is a diff — keep it off the per-frame path
    stg.lastBar = now;
    const c = document.getElementById('stgCount');
    if (c) { const n = stgChanges(); c.textContent = n ? `staging · ${n} change${n === 1 ? '' : 's'}` : 'staging'; }
  }
  stg.raf = requestAnimationFrame(stgLoop);
}
function stgSetUI(on) {
  const bar = document.getElementById('stgBar');
  if (bar) bar.hidden = !on;
  const head = document.getElementById('mfLiveHead');
  if (head) head.hidden = !on;
  const sl = document.getElementById('stageLabel');
  if (sl) sl.textContent = on ? 'staged' : 'output';
  document.getElementById('mfStage')?.classList.toggle('active', on);
  env.liveView?.set(on);
}
function startStaging() {
  if (stg.on || !env.motionRT.active || env.live?.isLive) return;
  // a still needs ≥2 keyframes to stage against; a video is stageable with 1
  // (the footage IS the motion — tweaking kf0's params off-air is the use case)
  if (kfList().length < (env.sourceVideo ? 1 : 2)) return;
  closeKfMenu();
  stg.committed = kfList().map((k) => ({ t: k.t, anchored: k.anchored, snap: { ...k.snap }, thumb: k.thumb, ...(k.wind ? { wind: { ...k.wind } } : {}) }));
  stg.playing = motion.playing;
  stg.p = motion.playhead;
  stg.t0 = performance.now() - stg.p * motion.durationMs;
  if (env.sourceVideo && env.media?.sourceVideoUrl) stgStartVideo();   // the committed loop's own decode path
  // BOTH sides keep playing (Daniel's round-2 call: auto-pausing the staged
  // preview was unexpected — users pause it themselves; edit interactions
  // still pause it exactly as they do outside staging)
  stg.on = true;
  stg.blend = null;
  stg.lastBar = 0;
  stgSetUI(true);
  stg.raf = requestAnimationFrame(stgLoop);
  renderTimeline();
  updateMotionUI();
}
function endStaging(how, { resume = true } = {}) {   // 'take' | 'cut' | 'discard'
  if (!stg.on) return;
  const committed = stg.committed;
  const wasPlaying = stg.playing;
  const pNow = stgAdvance(performance.now());
  if (stg.raf) { cancelAnimationFrame(stg.raf); stg.raf = 0; }
  stg.on = false;
  stg.live = null;
  stg.committed = null;
  stgStopVideo();   // the program follows the shared element again (the take blend is params-only)
  if (how === 'discard') {
    env.pushHistory?.(); env.updateUndoUI?.();   // undo brings the discarded staged set back
    motion.keyframes = committed;
    motion.selected = -1;
  } else if (how === 'take') {
    // ease the on-air output across the swap at the shared transition speed —
    // the loop keeps playing while the look crossfades onto the new keyframes.
    // live is PRE-SEEDED with the exact on-air look: an unseeded first frame
    // fell through to the NEW state for one frame (Daniel read the flash as a
    // hard cut).
    const dur = Math.max(120, (env.session?.performResponse ?? 0.35) * 2500);
    stg.blend = {
      from: committed, t0: performance.now(), dur, playing: wasPlaying, p: pNow,
      clock0: performance.now() - pNow * motion.durationMs,
      live: stgEval(committed, pNow),
    };
    requestAnimationFrame(stgBlendLoop);
  }
  stgSetUI(false);
  if (stg.blend) env.liveView?.set(true);   // the live view stays up to show the take LAND (hides on settle)
  // one timeline again. If the STAGED preview is currently playing, it simply
  // keeps playing (it's the new committed loop now — don't interrupt it);
  // otherwise the on-air position carries over, resuming if IT was playing.
  if (resume && !motion.playing) {
    motion.playhead = Math.max(0, Math.min(1, pNow));
    if (wasPlaying) startPlayback();
    else loadPlayheadIntoState();
  }
  renderTimeline();
  updateMotionUI();
}
function stgBlendLoop() {
  const B = stg.blend;
  if (!B) return;
  const now = performance.now();
  const b = Math.min(1, (now - B.t0) / B.dur);
  const e = b * b * (3 - 2 * b);                 // smoothstep
  let pOld = B.p;
  if (B.playing) {
    pOld = (now - B.clock0) / motion.durationMs;
    if (motion.loop) pOld -= Math.floor(pOld);
    else pOld = Math.min(1, pOld);
  }
  const from = stgEval(B.from, pOld);
  const to = state;                              // resumed playback IS the new committed eval
  const out = { ...to };
  for (const k of CONTINUOUS_KEYS) {
    const av = from[k] ?? 0, bv = to[k] ?? 0;
    out[k] = GEST_ANGULAR.has(k) ? stgWrap360(av + angDelta(av, bv) * e) : av + (bv - av) * e;
  }
  B.live = out;
  env.commitFrame?.();   // the take blend's commit point: the crossfade is on-air
  env.liveView?.render(out);                       // the live view shows the take landing
  if (b >= 1) { stg.blend = null; env.liveView?.set(false); return; }
  requestAnimationFrame(stgBlendLoop);
}
// staged-diff classification for the marker vocabulary (Daniel's spec): added/
// edited keyframes read DOTTED; deleted committed keyframes stay visible as
// FADED phantoms until the take (then they disappear and dotted turns solid —
// which falls out of the re-render, since the diff is gone).
function stgMarkerDiff() {
  if (!stg.on) return null;
  const a = motion.keyframes, b = stg.committed || [];
  const matched = new Set();
  const changed = new Set();
  a.forEach((kf, i) => {
    let bi = -1, best = 0.004;                     // match by nearest committed time
    b.forEach((ck, j) => {
      if (matched.has(j)) return;
      const d = Math.abs(ck.t - kf.t);
      if (d < best) { best = d; bi = j; }
    });
    if (bi < 0) { changed.add(i); return; }        // no committed partner → added/moved
    matched.add(bi);
    const ck = b[bi];
    let diff = false;
    for (const k of CONTINUOUS_KEYS) if ((kf.snap[k] ?? 0) !== (ck.snap[k] ?? 0)) { diff = true; break; }
    if (!diff) for (const k of DISCRETE_KEYS) if (kf.snap[k] !== ck.snap[k]) { diff = true; break; }
    if (diff) changed.add(i);
  });
  return { changed, deleted: b.filter((_, j) => !matched.has(j)) };
}

function requestStagingExit() {
  if (!stg.on) return;
  if (stgChanges() > 0) {
    if (window.confirm('Discard the staged changes? Take (T) commits them instead.')) endStaging('discard');
  } else {
    endStaging('cut');   // nothing changed — a silent exit
  }
}

// set the selected keyframe anchored (pinned at its exact time) or auto (even-spaced
// between anchors) — the two states are explicit commands in the keyframe context menu.
function setAnchored(val) {
  const i = motion.selected;
  if (i <= 0 || !kfList()[i] || !!kfList()[i].anchored === val) return;   // kf0 is always the start anchor
  env.pushHistory?.(); env.updateUndoUI?.();     // undoable: re-spacing moves keyframe times
  kfList()[i].anchored = val;
  applyAutoSpacing();
  setPlayhead(kfList()[i].t);
  renderTimeline();
  updateMotionUI();
  if (env.sourceVideo) scrubVideo(kfList()[i].t, { assignParams: false });   // footage follows the re-spaced time
}

// ---- keyframe context menu --------------------------------------------------
// Keyframe ops are contextual to the keyframe itself (Daniel): selecting a marker
// (or right-clicking it) opens a small menu near it — anchor position / auto space
// (mutually exclusive, current one reads active) and destructive delete. kf0 has
// no ops (fixed start anchor, undeletable), so it never shows a menu.
function showKfMenu(i) {
  const menu = document.getElementById('kfMenu');
  const track = document.getElementById('mfTrack');
  const kf = kfList()[i];
  if (!menu || !track || i <= 0 || !kf) return;
  menu.hidden = false;
  document.getElementById('kfAnchorPos')?.classList.toggle('active', !!kf.anchored);
  document.getElementById('kfAutoSpace')?.classList.toggle('active', !kf.anchored);
  // position above the marker's time on the track (markers are rebuilt on select,
  // so anchor to coordinates, not the element), clamped to the viewport
  const r = track.getBoundingClientRect();
  const x = r.left + (tToPct(kf.t) / 100) * r.width;
  menu.style.left = Math.round(Math.max(8, Math.min(x - menu.offsetWidth / 2, window.innerWidth - menu.offsetWidth - 8))) + 'px';
  menu.style.top = Math.round(Math.max(8, r.top - menu.offsetHeight - 10)) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', onKfMenuOutside), 0);
}
function closeKfMenu() {
  const menu = document.getElementById('kfMenu');
  if (menu) menu.hidden = true;
  document.removeEventListener('pointerdown', onKfMenuOutside);
}
function onKfMenuOutside(e) { if (!e.target.closest('#kfMenu')) closeKfMenu(); }
function deleteSelected() {
  const idx = motion.selected >= 0 ? motion.selected : keyframeAt(motion.playhead);
  if (idx <= 0) return;   // kf0 is the primary/start anchor — never deletable (Arc 3 hardening)
  env.pushHistory?.(); env.updateUndoUI?.();     // undoable
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
// jump the playhead to a bare position (keyboard Home/End) — same path as a track
// scrub landing there, including the state reload + keyframe snap.
function jumpToPlayhead(p) {
  if (!kfList().length) return;
  if (motion.playing) haltPlayback();
  if (env.sourceVideo) { setPlayhead(p); scrubVideo(p); }
  else renderSampled(p);
  loadPlayheadIntoState();
  renderTimeline();
  updateMotionUI();
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
// Freeze the live preview behind a static snapshot while a background filmstrip
// rebuild borrows + resizes the GL canvas — so the off-screen work is invisible (no
// flash) on every engine. A 2D copy of the current preview, position:fixed over the
// preview's rect; lifted after the preview is repainted.
function freezePreview() {
  if (env.filmstrip.freezeEl || !previewCanvas || previewCanvas.style.display === 'none') return;
  const r = previewCanvas.getBoundingClientRect();
  if (r.width < 2 || r.height < 2 || !previewCanvas.width) return;
  const c = document.createElement('canvas');
  c.width = previewCanvas.width; c.height = previewCanvas.height;
  try { c.getContext('2d').drawImage(previewCanvas, 0, 0); } catch { return; }
  c.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:6;pointer-events:none`;
  document.body.appendChild(c);
  env.filmstrip.freezeEl = c;
}
function unfreezePreview() { if (env.filmstrip.freezeEl) { env.filmstrip.freezeEl.remove(); env.filmstrip.freezeEl = null; } }

// Filmstrip async-build state lives in `env.filmstrip`: timer (debounce), lastSig
// (content signature → skip unchanged rebuilds), gen (cancellation token, also bumped
// by scrub/playback), busy (single-flight for the async video path).
function scheduleFilmstrip() {
  if (!env.motionRT.active) return;
  clearTimeout(env.filmstrip.timer);
  env.filmstrip.timer = setTimeout(buildFilmstrip, 600);   // wait for a real pause before rebuilding
}
// Build the tween band as a row of aspect-locked square CELLS spanning the currently
// VISIBLE window [pan, pan+span] (so zoom gives crisp, denser thumbnails rather than a
// stretched canvas). Cells are positioned by time (zPct); zoom repositions them (they
// spread) and this rebuild — debounced, so it runs when idle — re-renders the set for
// the new window. Uses the readback-free CAPTURE path (drawImage, no readPixels: desktop
// Safari's FBO readback is the "blue cells" corruption, and Gecko's is slow). The still
// path is synchronous (one JS turn → no on-screen flicker); the video path is async (a
// seek per cell) and freezes the preview behind a snapshot. A content signature (now
// incl. zoom + pan) skips the rebuild when nothing relevant changed.
function buildFilmstrip() {
  const strip = document.getElementById('mfStrip');
  if (!strip) return;
  const track = document.getElementById('mfTrack');
  if (!track || motion.playing || env.motionRT.scrubbing || !engine || !engine.getSourceImage() || !kfList().length) {
    strip.innerHTML = ''; env.filmstrip.lastSig = ''; return;
  }
  const w = strip.clientWidth, h = strip.clientHeight;
  if (w < 2 || h < 2) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const fs = Math.min(Math.round(h * dpr), 240);    // square render resolution per cell
  const n = Math.max(1, Math.ceil(w / h));          // square cells filling the visible window
  const span = tlSpan(), pan = session.timelinePan || 0, z = session.timelineZoom || 1;
  const multi = kfList().length >= 2;               // only ≥2 keyframes get the tween band

  const sig = w + '|' + h + '|' + z.toFixed(3) + '|' + pan.toFixed(4) + '|' + motion.smoothing + '|' + motion.loop + '|' + motion.durationMs + '|' +
    kfList().map(k => k.t.toFixed(4) + ':' + JSON.stringify(k.snap)).join(',');
  if (sig === env.filmstrip.lastSig && (strip.firstChild || !multi)) return;   // unchanged (e.g. scrub) — skip

  const cellTime = (i) => Math.min(1, Math.max(0, pan + (i + 0.5) * span / n));

  if (env.sourceVideo) {
    if (env.filmstrip.busy) { scheduleFilmstrip(); return; }   // one build at a time — retry after the current finishes
    buildFilmstripVideo(strip, sig, { fs, n, multi, cellTime });
    return;
  }

  const cells = [];
  try {
    // one capture session renders the tween cells (≥2 kf) AND every marker thumbnail.
    engine.beginCapture(fs, fs);
    if (multi) {
      for (let i = 0; i < n; i++) {
        const t = cellTime(i);
        const cv = makeStripCell(t, fs);
        cv.getContext('2d').drawImage(engine.captureFrame(sampleAt(t)), 0, 0, fs, fs);
        cells.push(cv);
      }
    }
    for (const kf of kfList()) {
      if (kf.thumb) kf.thumb.getContext('2d').drawImage(engine.captureFrame(kf.snap), 0, 0, kf.thumb.width, kf.thumb.height);
    }
  } finally {
    engine.endCapture();
    env.resizePreviewCanvas();                          // restore + repaint the live preview
  }
  strip.innerHTML = '';
  for (const c of cells) strip.appendChild(c);       // single keyframe = no band (cells empty)
  env.filmstrip.lastSig = sig;
}

// Video source: same cell model, but each cell + marker thumb is the FOOTAGE at its time,
// which needs an async seek (so they stay correct under add / edit / auto-shift / drag /
// zoom). One ascending pass over time covers every cell + thumb (monotonic seeks are
// smoother than jumping around). Async + single-flight (env.filmstrip.busy) + cancellable
// (env.filmstrip.gen, bumped by scrub/playback); footage restored to the playhead after; the
// preview is frozen behind a snapshot so the borrowed GL canvas never flashes.
async function buildFilmstripVideo(strip, sig, geom) {
  env.filmstrip.busy = true;
  const gen = ++env.filmstrip.gen;
  const v = env.sourceVideo;
  const saved = v.currentTime;
  const list = [...kfList()];                       // snapshot (the array may mutate during awaits)
  const { fs, n, multi, cellTime } = geom;

  const cells = [];
  const jobs = [];
  if (multi) {
    for (let i = 0; i < n; i++) {
      const t = cellTime(i);
      const cv = makeStripCell(t, fs);
      cells.push(cv);
      jobs.push({ p: t, snap: sampleAt(t), draw: (src) => cv.getContext('2d').drawImage(src, 0, 0, fs, fs) });
    }
  }
  for (const kf of list) {
    if (!kf.thumb) continue;
    jobs.push({ p: kf.t, snap: kf.snap, draw: (src) => kf.thumb.getContext('2d').drawImage(src, 0, 0, kf.thumb.width, kf.thumb.height) });
  }
  jobs.sort((a, b) => a.p - b.p);

  freezePreview();                                  // hide the borrowed preview behind a snapshot
  engine.beginCapture(fs, fs);
  try {
    for (const job of jobs) {
      if (gen !== env.filmstrip.gen) return;        // superseded by a scrub / playback / newer build
      await seekVideoTo(v, pToMediaSec(v, job.p, env.clip.trim));
      if (gen !== env.filmstrip.gen) return;
      engine.updateSourceFrame();
      job.draw(engine.captureFrame(job.snap));
    }
    if (gen !== env.filmstrip.gen) return;
    strip.innerHTML = '';
    for (const c of cells) strip.appendChild(c);     // single keyframe = no band (cells empty)
    env.filmstrip.lastSig = sig;
  } finally {
    engine.endCapture();                            // restore the borrowed canvas's backing size
    if (gen === env.filmstrip.gen) { await seekVideoTo(v, saved); engine.updateSourceFrame(); }   // not cancelled → restore footage to the playhead
    env.resizePreviewCanvas();
    if (engine.getSourceImage()) engine.render(state);   // sync repaint BEFORE lifting the freeze (no flash)
    unfreezePreview();
    env.filmstrip.busy = false;
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
    // undoable: capture once, at the moment a press becomes a retime drag
    if (!down.pushed) { env.pushHistory?.(); env.updateUndoUI?.(); down.pushed = true; }
    const list = kfList();
    const lo = list[i - 1].t + 0.01;
    const hi = (i < list.length - 1 ? list[i + 1].t : 1) - 0.01;
    const t = Math.max(lo, Math.min(hi, pctToT((e.clientX - down.rect.left) / down.rect.width)));
    list[i].t = t;
    list[i].anchored = true;                        // a moved keyframe becomes a fixed anchor
    m.style.left = zPct(t) + '%';                    // zoom-only; the layer transform supplies the pan
    if (env.sourceVideo) { setPlayhead(t); scrubVideo(t); }   // video: show the footage at the drop position while dragging
    else if (motion.selected === i) setPlayhead(t);
  });
  const end = (e) => {
    if (!down) return;
    const wasDrag = down.moved;
    m.releasePointerCapture?.(e.pointerId);
    down = null;
    if (wasDrag) { applyAutoSpacing(); renderTimeline(); loadPlayheadIntoState(); updateMotionUI(); }
    else { selectKeyframe(i); showKfMenu(i); }   // select opens the keyframe's context menu (no-op for kf0)
  };
  m.addEventListener('pointerup', end);
  m.addEventListener('pointercancel', () => { down = null; });
  m.addEventListener('contextmenu', (e) => {     // right-click = the same contextual menu
    e.preventDefault();
    if (motion.playing) stopPlayback();
    selectKeyframe(i);
    showKfMenu(i);
  });
}
// ---- timeline ruler (ticks + occasional timestamps) -----------------------
// A measuring scale above the track: minor ticks at a regular interval and major
// ticks with a timestamp at a coarser "nice" interval chosen so labels stay readable
// at the current width. Relative keyframe position stays the focus; the timestamps
// give a sense of absolute time, which fixed-duration media (video) needs.
const TICK_NICE = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
function fmtClock(sec) {
  if (sec >= 60) { const m = Math.floor(sec / 60), s = Math.round(sec % 60); return `${m}:${String(s).padStart(2, '0')}`; }
  return Number.isInteger(sec) ? `${sec}s` : `${sec.toFixed(1)}s`;
}
function renderRuler() {
  const ruler = document.getElementById('mfRuler');
  const layer = document.getElementById('mfRulerLayer');
  if (!ruler || !layer) return;
  layer.innerHTML = '';
  const dur = motion.durationMs / 1000;
  const w = ruler.clientWidth;
  if (!(dur > 0) || w < 2) return;                              // footer hidden / zero width → nothing to draw
  // The labeled interval comes from the VISIBLE window (zoom-aware: a zoomed
  // view labels finer), and ticks generate a couple of screens past each edge
  // so cheap transform pans stay covered — the debounced refresh re-centers
  // the tick window after a pan. (Daniel's iPad bug: ticks used to exist only
  // for the full-duration scale, and the PAN transform sat on the ruler BOX,
  // sliding it under the left cluster and off the right edge — the box is
  // fixed now and the layer pans.)
  const spanT = tlSpan();
  const pan = session.timelinePan || 0;
  const visDur = dur * spanT;
  const targetLabels = Math.max(2, Math.min(12, Math.floor(w / 84)));
  const step = TICK_NICE.find(s => visDur / s <= targetLabels) ?? Math.ceil(visDur / targetLabels);
  const tA = Math.max(0, (pan - 2 * spanT) * dur);
  const tB = Math.min(dur, (pan + 3 * spanT) * dur);
  const minor = step / 5;                                       // 5 minor ticks per labeled span
  const frag = document.createDocumentFragment();
  if ((tB - tA) / minor <= 600) {                               // skip minors if they'd flood the DOM
    for (let i = Math.ceil(tA / minor - 1e-6); i * minor <= tB + 1e-6; i++) {
      if (i % 5 === 0) continue;                                // a major sits here
      const tick = document.createElement('div');
      tick.className = 'mf-tick minor';
      tick.style.left = zPct((i * minor) / dur) + '%';
      frag.appendChild(tick);
    }
  }
  for (let i = Math.ceil(tA / step - 1e-6); i * step <= tB + 1e-6; i++) {
    const t = i * step, p = t / dur;
    if (t > 0 && (dur - t) < step * 0.45) continue;   // too close to the total-duration label — skip
    const tick = document.createElement('div');
    tick.className = 'mf-tick major';
    tick.style.left = zPct(p) + '%';
    frag.appendChild(tick);
    const lab = document.createElement('span');
    lab.className = 'mf-time' + (p <= 0.001 ? ' start' : '');
    lab.textContent = fmtClock(t);
    lab.style.left = zPct(p) + '%';
    frag.appendChild(lab);
  }
  if (tB >= dur - 1e-6) {
    // total-duration label at the end (the bound — brighter so it reads as the
    // clip / loop length); only when the end is within the tick window
    const eTick = document.createElement('div');
    eTick.className = 'mf-tick major';
    eTick.style.left = zPct(1) + '%';
    frag.appendChild(eTick);
    const eLab = document.createElement('span');
    eLab.className = 'mf-time end total';
    eLab.textContent = fmtClock(dur);
    eLab.style.left = zPct(1) + '%';
    frag.appendChild(eLab);
  }
  layer.appendChild(frag);
  layer.style.transform = `translateX(${panPct().toFixed(4)}%)`;
}
let rulerRefreshT = 0;
function scheduleRulerRefresh() { clearTimeout(rulerRefreshT); rulerRefreshT = setTimeout(renderRuler, 120); }
// ---- timeline view transform (zoom / pan) ---------------------------------
// Ephemeral, session-scoped (never keyframed): timelineZoom (≥1) and timelinePan
// (left edge of the visible window, in normalized [0,1]). Everything positioned by
// time routes through tToPct/pctToT so markers, playhead, ruler, and scrub all share
// one window. The tween strip is rendered at full-timeline width and CSS-transformed
// (translate + scaleX) so zoom/pan is instant and never re-seeks the footage.
function tlMaxZoom() { const dur = motion.durationMs / 1000 || 1; return Math.max(4, Math.min(240, dur / 2)); }
function tlSpan() { return 1 / (session.timelineZoom || 1); }
function tToPct(t) { return (t - (session.timelinePan || 0)) / tlSpan() * 100; }      // time → % across the track
function pctToT(frac) { return (session.timelinePan || 0) + frac * tlSpan(); }         // 0..1 across the track → time
function clampTimelineView() {
  session.timelineZoom = Math.max(1, Math.min(tlMaxZoom(), session.timelineZoom || 1));
  session.timelinePan = Math.max(0, Math.min(1 - tlSpan(), session.timelinePan || 0));
}
function applyTimelineTransform() {
  const strip = document.getElementById('mfStrip');
  if (!strip) return;
  strip.style.transformOrigin = 'left center';
  strip.style.transform = `translateX(${panPct().toFixed(4)}%)`;   // pan only — the cells carry zoom in their own positions (no stretch)
}
// the tween band is a row of aspect-locked square cells positioned by time. Zoom
// repositions them (they spread, never stretch); a debounced rebuild re-renders the
// set for the current visible window so they fill back in crisply when idle.
function makeStripCell(t, fs) {
  const cv = document.createElement('canvas');
  cv.width = fs; cv.height = fs;
  cv.className = 'mf-cell';
  cv.dataset.t = t;
  cv.style.left = zPct(t) + '%';
  return cv;
}
function repositionStripCells() {
  const strip = document.getElementById('mfStrip');
  if (!strip) return;
  for (const c of strip.children) { const t = +c.dataset.t; if (!Number.isNaN(t)) c.style.left = zPct(t) + '%'; }
}
// markers + ruler are positioned by ZOOM only (zPct) and PANNED via a layer translate,
// so following the playhead / two-finger scroll just slides a transform — no DOM rebuild,
// so it stays smooth + cheap. (The three layers — markers, ruler, strip — share the
// track's inner width, so one panPct% translate aligns them all.)
function zPct(t) { return t * (session.timelineZoom || 1) * 100; }                 // time → % within the zoom-only content layer
function panPct() { return -(session.timelinePan || 0) * (session.timelineZoom || 1) * 100; }
function applyPan() {
  const tx = `translateX(${panPct().toFixed(4)}%)`;
  const m = document.getElementById('mfMarkers'); if (m) m.style.transform = tx;
  const r = document.getElementById('mfRulerLayer'); if (r) r.style.transform = tx;   // the LAYER pans; the box stays put
  applyTimelineTransform();                  // strip (pan + scaleX)
  setPlayhead(motion.playhead);              // playhead lives in the track itself (absolute, via tToPct)
}
function zoomTimelineAt(frac, factor) {      // zoom keeping the time under `frac` fixed
  const tUnder = pctToT(frac);
  session.timelineZoom = (session.timelineZoom || 1) * factor;
  clampTimelineView();
  session.timelinePan = tUnder - frac * tlSpan();
  clampTimelineView();
  relayoutTimeline();
  updateZoomButtons();
  scheduleFilmstrip();                       // re-render the cells for the new window when idle
}
function fitTimeline() { session.timelineZoom = 1; session.timelinePan = 0; relayoutTimeline(); updateZoomButtons(); scheduleFilmstrip(); }
function scheduleRelayout() {                 // coalesce rapid zoom/pan (wheel, pinch) to one frame
  if (env.motionRT.relayoutPending) return;
  env.motionRT.relayoutPending = true;
  requestAnimationFrame(() => { env.motionRT.relayoutPending = false; relayoutTimeline(); });
}
function updateZoomButtons() {
  const z = session.timelineZoom || 1, mx = tlMaxZoom();
  const q = (id) => document.getElementById(id);
  if (q('mfFit')) q('mfFit').disabled = z <= 1.001;
  if (q('mfZoomOut')) q('mfZoomOut').disabled = z <= 1.001;
  if (q('mfZoomIn')) q('mfZoomIn').disabled = z >= mx * 0.999;
}
// During playback when zoomed in, follow the playhead by sliding the timeline UNDER it
// (continuous pan, not a jump): once it reaches ~80% of the window it stays pinned there
// while the timeline scrolls, so the eye keeps tracking the scrubber. On a loop wrap
// (playhead jumps left of view) we bring the start back near the left edge. Uses the
// cheap applyPan (transform only), so it's smooth every frame.
function followPlayhead(p) {
  if (!motion.playing || (session.timelineZoom || 1) <= 1) return;
  const span = tlSpan();
  const frac = (p - (session.timelinePan || 0)) / span;
  const PIN = 0.8;
  if (frac > PIN) session.timelinePan = p - PIN * span;        // pin the scrubber; scroll the timeline
  else if (frac < 0) session.timelinePan = p - 0.1 * span;     // wrapped/jumped left of view → re-enter near the left
  else return;                                                 // comfortably in view — leave the pan be
  clampTimelineView();
  applyPan();
}

// renderTimeline = relayout (markers/playhead/ruler/strip-transform) + a debounced
// filmstrip rebuild. Zoom/pan only relayout (no rebuild — the strip is CSS-transformed).
function renderTimeline() { relayoutTimeline(); scheduleFilmstrip(); }
function relayoutTimeline() {
  const markers = document.getElementById('mfMarkers');
  if (!markers) return;
  clampTimelineView();
  markers.innerHTML = '';
  const list = kfList();
  const sd = stgMarkerDiff();          // staging vocabulary (null outside staging)
  list.forEach((kf, i) => {
    const m = document.createElement('div');
    m.className = 'mf-marker' + (i === motion.selected ? ' selected' : '') + (kf.anchored ? ' anchored' : '');
    if (sd?.changed.has(i)) m.classList.add('stg-new');   // added/edited → dotted outline
    m.style.left = zPct(kf.t) + '%';                 // zoom-only; pan applied via the layer transform
    if (kf.thumb) m.appendChild(kf.thumb);
    const pin = document.createElement('div');
    pin.className = 'mf-pin';
    m.appendChild(pin);
    makeMarkerDraggable(m, i);
    markers.appendChild(m);
  });
  // deleted committed keyframes stay visible as FADED phantoms until the take
  // (thumb copied — a canvas can't live in two places; non-interactive)
  if (sd) {
    for (const ck of sd.deleted) {
      const d = document.createElement('div');
      d.className = 'mf-marker stg-del';
      d.style.left = zPct(ck.t) + '%';
      d.title = 'deleted in this staging — take removes it, discard restores it';
      if (ck.thumb) {
        const dc = document.createElement('canvas');
        dc.width = ck.thumb.width; dc.height = ck.thumb.height;
        dc.getContext('2d').drawImage(ck.thumb, 0, 0);
        d.appendChild(dc);
      }
      const pin = document.createElement('div'); pin.className = 'mf-pin';
      d.appendChild(pin);
      markers.appendChild(d);
    }
  }
  // loop bookend: a faint return-to-kf0 marker at t=1 (shows kf0's thumbnail, so its
  // left edge is visible at the track end). a canvas can't live in two places, so
  // copy kf0's thumb into a fresh canvas for the ghost.
  if (motion.loop && list.length) {
    const g = document.createElement('div');
    g.className = 'mf-marker ghost';
    g.style.left = zPct(1) + '%';
    g.title = 'the loop returns to the first keyframe — click to select it';
    if (list[0].thumb) {
      const gc = document.createElement('canvas');
      gc.width = list[0].thumb.width; gc.height = list[0].thumb.height;
      gc.getContext('2d').drawImage(list[0].thumb, 0, 0);
      g.appendChild(gc);
    }
    const pin = document.createElement('div'); pin.className = 'mf-pin';
    g.appendChild(pin);
    // the ghost IS kf0 at the end position — clicking it selects kf0 (it isn't
    // draggable/retimable; stopPropagation keeps the track from scrubbing)
    g.addEventListener('pointerdown', (e) => e.stopPropagation());
    g.addEventListener('click', () => selectKeyframe(0));
    markers.appendChild(g);
  }
  renderRuler();
  repositionStripCells();              // zoom spreads the existing cells (rebuild fills the gaps when idle)
  applyPan();                           // marker/ruler/strip transforms + playhead
}

// ---- mode toggle + UI sync ------------------------------------------------
function toggleMotionMode() {
  if (!engine || !engine.getSourceImage() || env.live.isLive) return;
  // leaving motion mid-staging commits as a CUT (no playback resume — the mode
  // is ending); staged edits are never silently lost
  if (env.motionRT.active && stg.on) endStaging('cut', { resume: false });
  env.motionRT.active = !env.motionRT.active;
  motion.selected = -1;          // never carry a stale selection across the toggle
                                 // (otherwise post-exit edits could write through to it)
  if (env.motionRT.active) { session.timelineZoom = 1; session.timelinePan = 0; }   // enter fit-to-view
  if (env.motionRT.active && env.sourceVideo) {
    // video: the timeline drives the footage — stop the free-run loop + pause, and
    // lock the loop duration to the clip length (the duration field is read-only then).
    env.stopSourceVideoPlayback();
    lockVideoDuration();               // lock to clip length ÷ retime speed
  }
  if (!env.motionRT.active) haltPlayback();
  else if (!kfList().length) addKeyframe({ seed: true });   // QoL: enter motion mode with a keyframe of the current look
  else renderTimeline();                       // (re-entry keeps existing keyframes)
  if (!env.motionRT.active && env.sourceVideo) {
    // exiting motion on a video: STILL MODE DOESN'T AUTOPLAY (Arc 2c) — stay parked
    // on the playhead's frame; the source panel's mini scrubber picks frames.
    try { env.sourceVideo.pause(); } catch { /* ignore */ }
    env.scheduleRender();
  }
  env.updateSrcScrub?.();   // video-in-still shows the frame scrubber; motion/camera hide it
  updateMotionUI();
  // the footer changes the main-slot height — re-fit the preview canvas (which
  // also re-renders the working state, replacing any transient playback frame).
  requestAnimationFrame(() => {
    env.resizePreviewCanvas();
    env.sourceOverlay.render();
    renderRuler();                       // footer is visible now → the ruler has a real width
    if (env.motionRT.active && env.sourceVideo) scrubVideo(motion.playhead);   // show the playhead frame
  });
}

function updateMotionUI() {
  const available = !!(engine && engine.getSourceImage()) && !env.live.isLive;
  if (env.motionRT.active && !available) {
    // a force-exit (source gone / camera started) bypasses toggleMotionMode —
    // end an open staging as a cut here too, or its loop + video copy leak on
    if (stg.on) endStaging('cut', { resume: false });
    env.motionRT.active = false;
    haltPlayback();
  }
  // perform force-exits only when the SOURCE goes away (it accepts live sources);
  // setPerform re-enters here once with performing=false, then settles
  if (env.performRT?.active && !(engine && engine.getSourceImage())) env.setPerform?.(false);

  const q = (id) => document.getElementById(id);
  const performing = !!env.performRT?.active;
  const btn = q('motionBtn');
  if (btn) { btn.disabled = !available; btn.classList.toggle('active', env.motionRT.active); }
  // still|motion|perform segments are radio semantics: exactly one active. still
  // is the resting mode, so it's active whenever neither of the others is.
  // Perform accepts LIVE sources (unlike motion) — any source enables it.
  q('stillBtn')?.classList.toggle('active', !env.motionRT.active && !performing);
  const pBtn = q('performBtn');
  if (pBtn) {
    pBtn.disabled = !(engine && engine.getSourceImage());
    pBtn.classList.toggle('active', performing);
  }
  // the visible mode picker (a dropdown proxying the hidden buttons): current
  // mode selected, unavailable modes disabled (re-synced here so a refused
  // switch snaps the select back)
  const sel = q('modeSelect');
  if (sel) {
    sel.value = env.loopIsActive?.() ? 'loop' : performing ? 'perform' : env.motionRT.active ? 'motion' : 'still';
    const optM = sel.querySelector('option[value="motion"]');
    if (optM) optM.disabled = !available;
    const optP = sel.querySelector('option[value="perform"]');
    if (optP) optP.disabled = !(engine && engine.getSourceImage());
  }
  // Mode-gated export surfaces (Arc 1): SAVE applies to stills, OUTPUT
  // (record/broadcast) to motion AND perform (broadcasting the live loop is the
  // point). Two deliberate exceptions keep output reachable in still mode: a
  // LIVE CAMERA (live broadcast is the core rig use) and a RUNNING bus (stop
  // must never be hidden mid-broadcast/record).
  const saveBtn = q('openExportBtn');
  if (saveBtn) saveBtn.hidden = env.motionRT.active || performing;
  const outBtn = q('outputBtn');
  if (outBtn) {
    const busRunning = !!env.outputBus?.getStatus?.().running;
    outBtn.hidden = !env.motionRT.active && !performing && !env.live.isLive && !busRunning;
    // if the gate hides the button while its expand-band is open, close the band
    // through its own toggle so the accordion state stays consistent
    if (outBtn.hidden && outBtn.classList.contains('band-open')) outBtn.click();
  }
  const footer = q('motionFooter');
  if (footer) footer.hidden = !env.motionRT.active;
  env.updateSrcScrub?.();   // the still-mode frame scrubber hides in motion/live/frozen
  // motion mode pins discrete fields to keyframe 0 — hide the form picker and
  // dim/disable the non-animatable controls (see body.motion rules in styles.css).
  // The starting keyframe (kf0) is seeded on entry, but discrete stays editable
  // while there's only ONE keyframe (refine the starting look); it locks once a
  // SECOND keyframe exists — i.e. the moment animating actually begins.
  document.body.classList.toggle('motion', env.motionRT.active && kfList().length >= 2);

  const n = kfList().length;
  if (q('mfAdd')) q('mfAdd').disabled = !available;
  if (q('mfGesture')) q('mfGesture').disabled = !available;
  if (!env.motionRT.active && gest.armed) cancelGesture();   // leaving motion abandons a take
  const stgBtn = q('mfStage');
  if (stgBtn) {
    stgBtn.disabled = !available || kfList().length < (env.sourceVideo ? 1 : 2);
    stgBtn.title = 'stage changes — edit keyframes off-air while the animation keeps playing to the live output (S)';
  }
  // (keyframe ops — anchor/auto-space/delete — live in the #kfMenu context menu,
  //  which gates itself: it only opens for kf1+.)
  const minKf = env.sourceVideo ? 1 : 2;   // video plays/renders with 1 kf (the footage provides motion)
  if (q('mfPlay')) {
    q('mfPlay').disabled = n < minKf;
    // icon+label normally; ICON-ONLY while staging (the cell splits to fit "+ sync")
    q('mfPlay').innerHTML = (motion.playing ? ICONS.pause : ICONS.play)
      + (stg.on ? '' : `<span>${motion.playing ? 'pause' : 'play'}</span>`);
  }
  if (q('mfSyncPlay')) { q('mfSyncPlay').hidden = !stg.on; q('mfSyncPlay').disabled = n < minKf; }
  // render lives in the APP BAR (per-mode export controls): motion-only, gated like play
  if (q('mfRender')) { q('mfRender').hidden = !env.motionRT.active; q('mfRender').disabled = n < minKf; }
  if (q('mfPrev')) q('mfPrev').disabled = n < 1;
  if (q('mfNext')) q('mfNext').disabled = n < 1;
  q('mfLoop')?.classList.toggle('active', motion.loop);
  updateZoomButtons();
  // retime control: video sources only (stills set duration directly)
  const sp = q('mfSpeed');
  if (sp) {
    sp.hidden = !env.sourceVideo;
    sp.querySelectorAll('[data-spd]').forEach(b =>
      b.classList.toggle('active', Math.abs(parseFloat(b.dataset.spd) - (motion.videoSpeed || 1)) < 1e-6));
  }
  if (q('mfClip')) {
    q('mfClip').hidden = !env.sourceVideo;   // clip editor: video sources only
    // trim handles write to the SHARED clip mapping live — mid-staging that
    // would shift the committed loop on-air, so the editor waits for the take
    q('mfClip').disabled = stg.on;
    q('mfClip').title = stg.on ? 'the clip editor edits the on-air loop’s trim — take or discard the staged changes first' : '';
  }
  // duration is READ-ONLY for a video source (locked to clip length ÷ speed) — show
  // it as locked instead of an editable-looking scrub field that ignores input
  const durEl = q('mfDurVal');
  if (durEl) {
    durEl.classList.toggle('locked', !!env.sourceVideo);
    durEl.title = env.sourceVideo ? 'locked to the clip length ÷ playback speed' : '';
  }
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
    durationMs: motion.durationMs, loop: motion.loop, smoothing: motion.smoothing, videoSpeed: motion.videoSpeed,
    keyframes: kfList().map(k => ({ t: k.t, anchored: !!k.anchored, snap: { ...k.snap }, ...(k.wind ? { wind: { ...k.wind } } : {}) })),
  });
}
function motionJSONBlob() { return new Blob([motionToJSON()], { type: 'application/json' }); }
function downloadMotionJSON() {
  if (!kfList().length) return;
  env.downloadBlob(motionJSONBlob(), (env.media.sourceFilename || 'animation') + '-motion.json');
}
// returns null on success, or an error string
function loadMotionFromJSON(text) {
  let o;
  try { o = JSON.parse(text); } catch { return 'not valid JSON'; }
  if (!o || o.format !== 'fold-motion' || !Array.isArray(o.keyframes) || !o.keyframes.length) return 'not a Fold motion file';
  env.pushHistory?.(); env.updateUndoUI?.();   // undoable (keyframes + selection/playhead;
                                               // duration/loop/smoothing are outside history's scope)
  motion.durationMs = Math.max(500, Math.min(600000, +o.durationMs || 30000));
  motion.loop = o.loop !== false;
  motion.smoothing = Math.max(0, Math.min(1, +o.smoothing || 0));
  motion.videoSpeed = Math.max(0.1, Math.min(4, +o.videoSpeed || 1));
  if (env.sourceVideo) lockVideoDuration();      // a video source overrides duration with native ÷ speed
  motion.keyframes = o.keyframes.map(k => ({ t: +k.t || 0, anchored: !!k.anchored, snap: { ...k.snap }, thumb: makeThumbCanvas(), ...(k.wind && typeof k.wind === 'object' ? { wind: { ...k.wind } } : {}) }));
  motion.keyframes[0].anchored = true;          // kf0 is always the start anchor at t=0
  motion.selected = -1;
  applyAutoSpacing();
  setPlayhead(0);
  loadPlayheadIntoState();                       // adopt kf0's look (incl. discrete/form) into state
  env.applyFormControls();                        // sync the form picker + form-specific controls
  renderTimeline();
  updateMotionUI();
  scheduleFilmstrip();                           // regenerates thumbnails (readback-free)
  return null;
}

function wireMotion() {
  const byId = (id) => document.getElementById(id);
  // segments select a mode; clicking the current mode's segment is a no-op
  byId('motionBtn')?.addEventListener('click', () => { if (!env.motionRT.active) toggleMotionMode(); });
  byId('stillBtn')?.addEventListener('click', () => { if (env.motionRT.active) toggleMotionMode(); });
  byId('mfAdd')?.addEventListener('click', addKeyframe);
  byId('mfGesture')?.addEventListener('click', toggleGesture);
  // stage changes: the ⋯ toggle + the staging bar's transport
  byId('mfStage')?.addEventListener('click', () => { if (stg.on) requestStagingExit(); else startStaging(); });
  byId('stgTake')?.addEventListener('click', () => endStaging('take'));
  byId('stgCut')?.addEventListener('click', () => endStaging('cut'));
  byId('stgDiscard')?.addEventListener('click', requestStagingExit);
  // keyframe context menu actions (the menu opens from marker select / right-click)
  byId('kfAnchorPos')?.addEventListener('click', () => { setAnchored(true); closeKfMenu(); });
  byId('kfAutoSpace')?.addEventListener('click', () => { setAnchored(false); closeKfMenu(); });
  byId('kfDelete')?.addEventListener('click', () => { closeKfMenu(); deleteSelected(); });
  byId('mfPrev')?.addEventListener('click', () => { closeKfMenu(); stepKeyframe(-1); });
  byId('mfNext')?.addEventListener('click', () => { closeKfMenu(); stepKeyframe(1); });
  byId('mfPlay')?.addEventListener('click', () => { if (motion.playing) stopPlayback(); else startPlayback(); });
  // staging's sync+play: start the staged preview FROM the on-air playhead, in
  // lockstep (same clock as the committed loop → zero drift)
  const syncBtn = byId('mfSyncPlay');
  if (syncBtn) {
    syncBtn.innerHTML = ICONS.play + '<span>+ sync</span>';
    syncBtn.addEventListener('click', () => {
      if (!stg.on) return;
      if (motion.playing) haltPlayback();
      motion.playhead = stgAdvance(performance.now());
      startPlayback();
      if (stg.playing && motion.playing) env.motionRT.start = stg.t0;
      updateMotionUI();
    });
  }
  byId('mfLoop')?.addEventListener('click', () => { motion.loop = !motion.loop; renderTimeline(); updateMotionUI(); });
  byId('mfFit')?.addEventListener('click', fitTimeline);
  byId('mfZoomIn')?.addEventListener('click', () => zoomTimelineAt(0.5, 1.6));
  byId('mfZoomOut')?.addEventListener('click', () => zoomTimelineAt(0.5, 1 / 1.6));
  byId('mfSpeed')?.querySelectorAll('[data-spd]').forEach(b =>
    b.addEventListener('click', () => setVideoSpeed(parseFloat(b.dataset.spd))));
  // (mfClip is wired with the ⋯ menu below — it closes the menu before opening the sheet)
  byId('clipClose')?.addEventListener('click', () => env.closeClipEditor(false));
  byId('clipCancel')?.addEventListener('click', () => env.closeClipEditor(false));
  // the primary button is context-aware: "next" through the steps, then apply/bake
  byId('clipApply')?.addEventListener('click', () => env.loopPrimaryAction());
  byId('loopBack')?.addEventListener('click', () => env.loopBack());
  // the left step rail — jump to any reached step
  byId('clipSheet')?.querySelectorAll('.loop-step').forEach(b =>
    b.addEventListener('click', () => { if (!b.disabled) env.jumpToStep(+b.dataset.step); }));
  // post-bake next-step nudge → render/save, motion, perform, or dismiss. Each closes
  // the Loop Builder sheet first, then routes (the baked loop is already the source).
  byId('clipNudgeSave')?.addEventListener('click', () => { env.closeLoopBuilderNudge(); byId('openExportBtn')?.click(); });
  byId('clipNudgeMotion')?.addEventListener('click', () => { env.closeLoopBuilderNudge(); byId('motionBtn')?.click(); });
  byId('clipNudgePerform')?.addEventListener('click', () => { env.closeLoopBuilderNudge(); byId('performBtn')?.click(); });
  byId('clipNudgeDismiss')?.addEventListener('click', () => env.closeLoopBuilderNudge());
  // behavior choice (step 2) — changes which later steps exist
  byId('clipSheet')?.querySelectorAll('[data-mode]').forEach(b =>
    b.addEventListener('click', () => { if (!b.disabled) env.chooseBehavior(b.dataset.mode); }));
  env.makeClipHandle(byId('clipIn'), 'in');
  env.makeClipHandle(byId('clipOut'), 'out');
  env.makeClipHandle(byId('clipCut'), 'cut');
  // drag either edge of the crossfade region (step 4) to adjust the crossfade in place
  env.makeXfadeSeamHandle?.(byId('clipXfadeHL'), 'left');
  env.makeXfadeSeamHandle?.(byId('clipXfadeHR'), 'right');
  byId('clipXfadeMinus')?.addEventListener('click', () => { env.pushHistory?.(); env.setCrossfadeSec(env.getCrossfadeSec() - 0.1); env.updateUndoUI?.(); });
  byId('clipXfadePlus')?.addEventListener('click', () => { env.pushHistory?.(); env.setCrossfadeSec(env.getCrossfadeSec() + 0.1); env.updateUndoUI?.(); });
  // scrub the clip bar (off the handles) to inspect any moment — pauses the auto-loop,
  // coalesced seek, resumes on release.
  const clipBar = byId('clipBar');
  if (clipBar) {
    let barScrub = false, resumeAfter = false;
    // the fraction along the track maps to a SOURCE time through the current view (full clip /
    // trimmed range / resequenced B→A) — so scrubbing works on every step, crossfade included.
    const seekToEvt = (e) => {
      const r = clipBar.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      // clipScrubToFrac shows the real frame — and the live dissolve when the cursor is inside
      // the crossfade zone; falls back to a plain coalesced seek if unavailable.
      if (env.clipScrubToFrac) env.clipScrubToFrac(frac);
      else { const dur = env.clip.prevVideo?.duration || 1; env.clipSeekTo((env.barFracToMedia?.(frac) ?? frac * dur) / dur); }
      const ph = byId('clipPlayhead');
      if (ph) ph.style.left = (frac * 100) + '%';
    };
    clipBar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.clip-handle') || e.target.closest('.clip-xfade-region')) return;   // handles + the crossfade region own their interactions
      barScrub = true;
      resumeAfter = !!env.clip.raf;                   // only resume playback on release if it was playing
      env.stopClipPreview();
      clipBar.setPointerCapture?.(e.pointerId);
      seekToEvt(e);
      e.preventDefault();
    });
    clipBar.addEventListener('pointermove', (e) => { if (barScrub) seekToEvt(e); });
    const barUp = (e) => {
      if (!barScrub) return;
      barScrub = false;
      clipBar.releasePointerCapture?.(e.pointerId);
      if (resumeAfter) env.startClipPreview(false);   // resume only if it was playing before the scrub
    };
    clipBar.addEventListener('pointerup', barUp);
    clipBar.addEventListener('pointercancel', barUp);
  }
  if (byId('clipXfade')) makeScrubField(byId('clipXfade'), {
    get: () => env.getCrossfadeSec(),
    set: (v) => env.setCrossfadeSec(v),                // keeps the bar's crossfade region in sync
    step: 0.1, fineStep: 0.05, min: 0, max: 3,
    format: (v) => v.toFixed(2) + 's',
    parse: (s) => { const n = parseFloat(String(s).replace(/[s\s]/g, '')); return isNaN(n) ? null : n; },
    onStart: () => env.pushHistory?.(),
    onEnd: () => env.updateUndoUI?.(),
    // the live two-video blend reads the crossfade duration each frame — no recapture needed
  });

  // ⋯ overflow menu (Arc 3) — the occasional settings (duration / smoothing / loop /
  // speed / clip editor) + the motion-data JSON round-trip. Setting rows keep the
  // menu open (you're adjusting); actions that open a sheet close it.
  const moreMenu = byId('mfMoreMenu'), moreBtn = byId('mfMore');
  const closeMore = () => { if (moreMenu) moreMenu.hidden = true; document.removeEventListener('pointerdown', onMoreOutside); };
  function onMoreOutside(e) { if (!e.target.closest('#mfMoreMenu') && e.target !== moreBtn) closeMore(); }
  moreBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!moreMenu.hidden) { closeMore(); return; }
    moreMenu.hidden = false;
    // place above the button (footer is at the bottom), clamped to the right edge
    // (the ⋯ sits in the right icon stack now)
    const r = moreBtn.getBoundingClientRect();
    moreMenu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - moreMenu.offsetWidth - 8)) + 'px';
    moreMenu.style.top = Math.max(8, r.top - moreMenu.offsetHeight - 6) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', onMoreOutside), 0);
  });
  byId('mfClip')?.addEventListener('click', () => { closeMore(); env.openClipEditor(); });
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
    onChange: () => { clampTimelineView(); relayoutTimeline(); updateZoomButtons(); },   // duration drives the timestamps + max zoom
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
      const p = Math.max(0, Math.min(1, pctToT((clientX - r.left) / r.width)));   // through the zoom/pan window
      if (env.sourceVideo) { setPlayhead(p); scrubVideo(p); }   // video: seek footage (coalesced) + params
      else renderSampled(p);
    };
    track.addEventListener('pointerdown', (e) => {
      env.motionRT.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      track.setPointerCapture?.(e.pointerId);
      if (env.motionRT.pointers.size === 2) {       // second finger → switch from scrub to pinch/pan
        env.motionRT.scrubbing = false;
        const pts = [...env.motionRT.pointers.values()];
        env.motionRT.gesture = {
          dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
          mid: (pts[0].x + pts[1].x) / 2,
          zoom: session.timelineZoom || 1, pan: session.timelinePan || 0,
          rect: track.getBoundingClientRect(),
        };
        return;
      }
      if (e.target.closest('.mf-marker') || !kfList().length) return;
      env.motionRT.scrubbing = true;
      if (motion.playing) haltPlayback();
      scrubTo(e.clientX);
      e.preventDefault();
    });
    track.addEventListener('pointermove', (e) => {
      if (env.motionRT.pointers.has(e.pointerId)) env.motionRT.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = env.motionRT.gesture;
      if (g && env.motionRT.pointers.size >= 2) {    // pinch-zoom by the finger ratio; the start-midpoint's
        const pts = [...env.motionRT.pointers.values()];   // content time follows the moving midpoint (= pan)
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        const mid = (pts[0].x + pts[1].x) / 2, r = g.rect;
        const frac0 = (g.mid - r.left) / r.width;
        const tAnchor = g.pan + frac0 * (1 / g.zoom);   // content under the initial midpoint
        session.timelineZoom = g.zoom * (dist / g.dist);
        clampTimelineView();
        session.timelinePan = tAnchor - Math.max(0, Math.min(1, (mid - r.left) / r.width)) * tlSpan();
        clampTimelineView();
        scheduleRelayout(); updateZoomButtons(); scheduleFilmstrip();
        e.preventDefault();
        return;
      }
      if (env.motionRT.scrubbing) scrubTo(e.clientX);
    });
    const up = (e) => {
      env.motionRT.pointers.delete(e.pointerId);
      track.releasePointerCapture?.(e.pointerId);
      if (env.motionRT.pointers.size < 2) env.motionRT.gesture = null;
      if (!env.motionRT.scrubbing) return;
      env.motionRT.scrubbing = false;
      loadPlayheadIntoState();
      renderTimeline();
      updateMotionUI();
    };
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
    const onTimelineWheel = (e) => {
      if (!env.motionRT.active) return;
      const r = track.getBoundingClientRect();
      if (e.ctrlKey) {                              // trackpad pinch (browsers map it to ctrl+wheel) → zoom on cursor
        zoomTimelineAt(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.exp(-e.deltaY * 0.01));
        e.preventDefault();
      } else {                                      // two-finger scroll → pan (only meaningful when zoomed in)
        if ((session.timelineZoom || 1) <= 1) return;
        const dx = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        session.timelinePan += (dx / r.width) * tlSpan();
        clampTimelineView(); applyPan();            // pan-only → cheap transform slide (no rebuild)
        scheduleFilmstrip();                        // re-render the cells for the new window when idle
        scheduleRulerRefresh();                     // re-center the ruler's tick window when idle
        e.preventDefault();
      }
    };
    track.addEventListener('wheel', onTimelineWheel, { passive: false });

    // the ruler scrubs AND pinch-zooms/pans (Daniel: it must respond like the
    // track everywhere along its width — it reads as part of the timeline
    // surface). Mirrors the track's two-finger logic with its own pointer map.
    const ruler = byId('mfRuler');
    if (ruler) {
      const rPtrs = new Map();
      let rScrub = false, rGesture = null;
      ruler.addEventListener('pointerdown', (e) => {
        rPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        ruler.setPointerCapture?.(e.pointerId);
        if (rPtrs.size === 2) {                     // second finger → pinch/pan, not scrub
          rScrub = false; env.motionRT.scrubbing = false;
          const pts = [...rPtrs.values()];
          rGesture = {
            dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
            mid: (pts[0].x + pts[1].x) / 2,
            zoom: session.timelineZoom || 1, pan: session.timelinePan || 0,
            rect: ruler.getBoundingClientRect(),
          };
          return;
        }
        if (!kfList().length) return;
        rScrub = true; env.motionRT.scrubbing = true;
        if (motion.playing) haltPlayback();
        scrubTo(e.clientX);
        e.preventDefault();
      });
      ruler.addEventListener('pointermove', (e) => {
        if (rPtrs.has(e.pointerId)) rPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (rGesture && rPtrs.size >= 2) {
          const pts = [...rPtrs.values()];
          const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
          const mid = (pts[0].x + pts[1].x) / 2, r = rGesture.rect;
          const frac0 = (rGesture.mid - r.left) / r.width;
          const tAnchor = rGesture.pan + frac0 * (1 / rGesture.zoom);
          session.timelineZoom = rGesture.zoom * (dist / rGesture.dist);
          clampTimelineView();
          session.timelinePan = tAnchor - Math.max(0, Math.min(1, (mid - r.left) / r.width)) * tlSpan();
          clampTimelineView();
          scheduleRelayout(); updateZoomButtons(); scheduleFilmstrip();
          e.preventDefault();
          return;
        }
        if (rScrub) scrubTo(e.clientX);
      });
      const rEnd = (e) => {
        rPtrs.delete(e.pointerId);
        ruler.releasePointerCapture?.(e.pointerId);
        if (rPtrs.size < 2) rGesture = null;
        if (!rScrub) return;
        rScrub = false; env.motionRT.scrubbing = false;
        loadPlayheadIntoState(); renderTimeline(); updateMotionUI();
      };
      ruler.addEventListener('pointerup', rEnd);
      ruler.addEventListener('pointercancel', rEnd);
      ruler.addEventListener('wheel', onTimelineWheel, { passive: false });
    }
  }

  // keyboard (Arc 3, full set blessed by Daniel): space = play/pause · delete =
  // delete selected · ←/→ = prev/next · K = +keyframe · A = anchor/auto toggle ·
  // Home/End = playhead to start/end · +/− = zoom · 0 = fit. Motion mode only;
  // never while focus is in a field (inputs, selects, in-flight scrub edits).
  // (G is reserved for +gesture when the capability lands.)
  window.addEventListener('keydown', (e) => {
    if (!env.motionRT.active) return;
    const t = e.target;
    const tag = t?.tagName;
    // only TEXT-ENTRY fields keep the whole keyboard (same fix as perform's): a
    // clicked slider is an INPUT that holds focus, and the blanket guard ate
    // space until something else blurred it. A focused slider DOES keep its own
    // native keys (arrows / Home / End = precision nudge) — everything else
    // falls through to the shortcuts.
    if (t && (t.isContentEditable || tag === 'TEXTAREA' || tag === 'SELECT' ||
        (tag === 'INPUT' && !/^(range|checkbox|radio|button|submit|reset|color|file)$/.test(t.type)))) return;
    if (tag === 'INPUT' && t.type === 'range' && /^(Arrow(Left|Right|Up|Down)|Home|End)$/.test(e.key)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;   // don't shadow shortcuts (⌘Z etc.)
    if (tag === 'BUTTON') t.blur();   // space must never double as "re-click the focused button"
    if (e.code === 'Space') {
      e.preventDefault();                             // page scroll
      if (motion.playing) stopPlayback(); else startPlayback();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      closeKfMenu();
      deleteSelected();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();                             // page/element scroll
      closeKfMenu();
      stepKeyframe(e.key === 'ArrowLeft' ? -1 : 1);   // cycle prev / next (wraps at the ends)
    } else if (e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      closeKfMenu();
      addKeyframe();
    } else if (e.key === 'g' || e.key === 'G') {
      e.preventDefault();
      toggleGesture();      // arm / finish / cancel — the +gesture button's key
    } else if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      if (stg.on) requestStagingExit(); else startStaging();   // staging toggle (perform's S, same vocabulary)
    } else if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      if (stg.on) endStaging('take');   // T is the ONLY commit key (Daniel)
    } else if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      const i = motion.selected;
      if (i > 0 && kfList()[i]) { closeKfMenu(); setAnchored(!kfList()[i].anchored); }
    } else if (e.key === 'Home') {
      e.preventDefault();
      closeKfMenu();
      jumpToPlayhead(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      closeKfMenu();
      jumpToPlayhead(1);
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomTimelineAt(0.5, 1.6);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      zoomTimelineAt(0.5, 1 / 1.6);
    } else if (e.key === '0') {
      e.preventDefault();
      fitTimeline();
    }
  });

  updateMotionUI();
}

// ---- video export ---------------------------------------------------------
// The frame-source capture path (per browser engine: WebGL-direct on WebKit, 2D
// elsewhere; `?capture=` override) now lives in the capability profile —
// `env.capabilities.capturePath` (kit/capabilities.js).
function setupVideoExport() {
  const byId = (id) => document.getElementById(id);
  const sheet = byId('vidSheet');
  if (!sheet) return;
  let selLong = 2560, selFps = 30, selCap = env.capabilities.capturePath, cancelRender = false, rendering = false;

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
    if (kfList().length < (env.sourceVideo ? 1 : 2)) return;
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
    const base = env.media.sourceFilename || 'animation';
    try {
      // arm the fast decode path (falls back silently; the source-preview pass
      // restarts at p=0, which the reader handles as a keyframe reset)
      if (env.sourceVideo) { status.textContent = 'preparing footage…'; await setupExportReader(); status.textContent = 'rendering…'; }
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
        env.downloadBlob(zipBlob, base + '-package.zip');
      } else {
        env.downloadBlob(blob, base + '.mp4');
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
      teardownExportReader();      // re-points the engine at the video element (no-op on the seek path)
      rendering = false; btn.disabled = false; prog.hidden = true;
      if (cancelRender) sheet.hidden = true;
      env.resizePreviewCanvas();   // the capture session resized the GL canvas — restore + repaint the preview
      if (env.sourceVideo) scrubVideo(motion.playhead);   // restore the footage to the playhead (export left it at the last frame)
    }
  });
}

  // ---- public surface (consumed by chrome + clip-editor + source-host) -------
  env.scrubVideo = scrubVideo;
  env.renderTimeline = renderTimeline;
  env.renderRuler = renderRuler;
  env.scheduleFilmstrip = scheduleFilmstrip;
  env.updateMotionUI = updateMotionUI;
  env.ensureSeededSelection = ensureSeededSelection;
  env.lockVideoDuration = lockVideoDuration;
  env.stopPlayback = stopPlayback;
  env.haltPlayback = haltPlayback;
  env.rebindMotionToSource = rebindMotionToSource;
  env.fmtClock = fmtClock;

  // ---- self-wiring (DOM event listeners; index.html elements exist at init) --
  wireMotion();
  setupVideoExport();
}
