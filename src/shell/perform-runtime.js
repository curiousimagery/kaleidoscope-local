// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/perform-runtime.js
//
// PERFORM mode (Arc 4): the third mode. Your edits render to the main output
// panel immediately (the STAGE — what's up next), while the LIVE view (the PiP
// + every broadcast destination) eases toward them through the follower
// (kit/follow.js — perceptual ramp, most-recent-input chasing, unwrapped
// angles). Its own mode by design (Daniel): live-performance needs get a space
// of their own instead of weighing down the authoring modes; they may collapse
// back together later.
//
// The seam to the outside world is env.programState(): "the state the audience
// sees". In still/motion it returns env.state (current behavior, untouched);
// in perform it returns the follower's latest snapshot. The output bus's
// hidden engine and the GPU output window both read it, so broadcasting works
// from ANY mode (Daniel's requirement) with one accessor.
//
// The PiP renders through its OWN small engine (the proven second-engine
// pattern: output window, output-engine). Source-sync mirrors output-engine's
// rules: re-setSource on reference/dimension change, per-frame re-upload for
// live sources, hold during video seeks.

import { createFollower } from '../kit/follow.js';
import { createEngine } from '../engine/index.js';

export function createPerformRuntime(env) {
  const { state, session } = env;
  env.performRT = { active: false, followed: null };

  let follower = null;
  let raf = 0, lastT = 0;
  let pipEngine = null, pipLastSource = null, pipFailed = false;
  let dotSynced = null;   // last applied sync-dot state (avoid per-frame class churn)

  // onion-skin trail (Daniel's ghost spec, round 2): the trail spans the FULL
  // transition — samples persist for the whole chase (capped, oldest dropped),
  // graded oldest-faint → newest-strong, and the entire trail fades out over
  // ~450ms once the live output catches up. (Round 1 aged samples out after
  // 900ms, which truncated long chases to the last stretch — Daniel's note.)
  const GHOST_EVERY_MS = 80, GHOST_MAX = 28, GHOST_FADE_MS = 450, GHOST_MAX_A = 0.32;
  let trail = [];          // { snap } — ordered oldest → newest
  let lastGhostT = 0;
  let settleFadeT = 0;     // when the catch-up fade started (0 = still chasing)

  const byId = (id) => document.getElementById(id);

  // ---- the program-state seam (bus + output window read this) --------------
  env.programState = () =>
    (env.performRT.active && env.performRT.followed) ? env.performRT.followed : env.state;

  // ---- the live PiP ---------------------------------------------------------
  function ensurePipEngine() {
    if (pipEngine || pipFailed) return;
    const canvas = byId('livePipCanvas');
    if (!canvas) { pipFailed = true; return; }
    try {
      pipEngine = createEngine({ canvas });
    } catch (e) {
      // couldn't get another GL context — perform still works (broadcasts follow
      // via programState); only the in-app live view is unavailable.
      pipFailed = true;
      console.warn('[fold] live PiP engine unavailable:', e.message || e);
      const pip = byId('livePip');
      if (pip) pip.hidden = true;
    }
  }

  function sizePip() {
    const canvas = byId('livePipCanvas');
    if (!canvas) return;
    const w = canvas.clientWidth;
    if (w < 8) return;
    const a = session.frameAspect || 1;
    const h = Math.max(40, Math.round(w / a));
    if (canvas.style.height !== h + 'px') canvas.style.height = h + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let tw = Math.round(w * dpr), th = Math.round(h * dpr);
    const mx = Math.max(tw, th);
    if (mx > 960) { const s = 960 / mx; tw = Math.round(tw * s); th = Math.round(th * s); }
    if (Math.abs(canvas.width - tw) > 8 || Math.abs(canvas.height - th) > 8) {
      canvas.width = tw;
      canvas.height = th;
    }
  }

  // output-engine's source-sync rules, applied to the PiP engine
  function syncPipSource() {
    const src = env.engine?.getSourceImage?.();
    if (!src || !pipEngine) return false;
    const w = src.naturalWidth || src.videoWidth || src.width || 0;
    const h = src.naturalHeight || src.videoHeight || src.height || 0;
    const cur = pipEngine.getSourceSize();
    if (src !== pipLastSource || (w && h && (w !== cur.w || h !== cur.h))) {
      try { pipEngine.setSource(src); pipLastSource = src; }
      catch { /* not ready this frame — retry next tick */ }
    }
    if (env.live?.isLive || (env.sourceVideo && !env.sourceVideo.seeking)) {
      pipEngine.updateSourceFrame();
    }
    return pipLastSource === src;
  }

  function updateSyncDot() {
    const synced = follower ? follower.isSettled() : true;
    if (synced === dotSynced) return;
    dotSynced = synced;
    byId('lpDot')?.classList.toggle('sync', synced);
    const pip = byId('livePip');
    if (pip) pip.title = synced
      ? 'live output — in sync with the stage'
      : 'live output — easing toward your edits';
  }

  // ---- the perform loop -----------------------------------------------------
  function tick(t) {
    if (!env.performRT.active) return;
    const dt = lastT ? Math.min(t - lastT, 100) : 16.7;   // clamp tab-back jumps
    lastT = t;
    // the working state IS the target: every input path (sliders, scrubs, wedge
    // drags, output gestures) feeds the follower with zero per-control wiring
    follower.setTarget(state);
    env.performRT.followed = follower.step(dt);
    if (pipEngine && syncPipSource()) {
      sizePip();
      try { pipEngine.render(env.performRT.followed); } catch { /* keep the loop alive */ }
    }
    // onion skin: sample the live position across the WHOLE chase; on catch-up,
    // fade the entire trail out. The ghosts are handed to the overlay via
    // view.performGhosts and painted by EVERY overlay draw (ours, the camera
    // loop's, hover redraws) — drawing them from out here strobed against the
    // camera loop's own per-frame draws.
    const settled = follower.isSettled();
    if (!settled) {
      settleFadeT = 0;
      if (t - lastGhostT >= GHOST_EVERY_MS) {
        trail.push({ snap: env.performRT.followed });
        if (trail.length > GHOST_MAX) trail.shift();
        lastGhostT = t;
      }
    } else if (trail.length) {
      if (!settleFadeT) settleFadeT = t;
      if (t - settleFadeT >= GHOST_FADE_MS) { trail = []; settleFadeT = 0; }
    }
    const view = env.sourceOverlay.view;
    if (trail.length) {
      const fade = settleFadeT ? Math.max(0, 1 - (t - settleFadeT) / GHOST_FADE_MS) : 1;
      const n = trail.length;
      view.performGhosts = trail.map((g, i) => ({
        snap: g.snap,
        alpha: fade * (0.05 + GHOST_MAX_A * ((i + 1) / n)),   // oldest nearly invisible
      }));
      env.sourceOverlay.scheduleDraw();
    } else if (view.performGhosts) {
      view.performGhosts = null;
      env.sourceOverlay.scheduleDraw();     // one clean redraw after the trail clears
    }
    updateSyncDot();
    raf = requestAnimationFrame(tick);
  }

  // ---- mode switching --------------------------------------------------------
  function setPerform(on) {
    if (on === env.performRT.active) return;
    if (on) {
      if (!env.engine?.getSourceImage?.()) return;
      // leaving motion for perform goes through motion's own exit path
      if (env.motionRT.active) byId('stillBtn')?.click();
      follower = createFollower(state, { response: session.performResponse ?? 0.35 });
      env.performRT.active = true;
      env.performRT.followed = { ...state };
      trail = []; lastGhostT = 0; settleFadeT = 0;
      ensurePipEngine();
      if (!pipFailed) { const p = byId('livePip'); if (p) p.hidden = false; }
      const row = byId('performFollowRow');
      if (row) row.hidden = false;
      dotSynced = null;
      lastT = 0;
      raf = requestAnimationFrame(tick);
    } else {
      env.performRT.active = false;
      env.performRT.followed = null;   // broadcasts revert to the working state (a hard cut)
      follower = null;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      const p = byId('livePip'); if (p) p.hidden = true;
      const row = byId('performFollowRow'); if (row) row.hidden = true;
      trail = []; settleFadeT = 0;
      if (env.sourceOverlay?.view) env.sourceOverlay.view.performGhosts = null;
      env.sourceOverlay?.scheduleDraw?.();   // wipe any lingering ghost strokes
    }
    env.updateMotionUI?.();   // one radio sync + export gating pass for all three modes
    env.updateSrcScrub?.();
  }
  env.setPerform = setPerform;

  // ---- wiring -----------------------------------------------------------------
  byId('performBtn')?.addEventListener('click', () => { if (!env.performRT.active) setPerform(true); });
  // the other segments exit perform (motion-runtime's own handlers run first and
  // switch the mode; this runs after and shuts the perform loop down)
  byId('stillBtn')?.addEventListener('click', () => setPerform(false));
  byId('motionBtn')?.addEventListener('click', () => setPerform(false));

  // THE transition-speed control (instant → slow); persisted in session, applied live
  const speedInput = byId('followSpeed');
  const speedVal = byId('followVal');
  const fmtResponse = (v) => (v < 0.02 ? 'instant' : v.toFixed(2) + 's');
  function applyResponse(v) {
    session.performResponse = v;
    follower?.setResponse(v);
    if (speedVal) speedVal.textContent = fmtResponse(v);
  }
  if (speedInput) {
    speedInput.value = String(session.performResponse ?? 0.35);
    applyResponse(parseFloat(speedInput.value));
    speedInput.addEventListener('input', () => applyResponse(parseFloat(speedInput.value) || 0));
  }
}
