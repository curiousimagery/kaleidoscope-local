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

import { createFollower, FOLLOW_SPANS, CONTINUOUS_KEYS } from '../kit/follow.js';
import { angDelta, ANGULAR_KEYS } from '../kit/tween.js';
import { createEngine } from '../engine/index.js';

export function createPerformRuntime(env) {
  const { state, session } = env;
  // hold (Arc 5): while true, the follower stops receiving targets — the live
  // output freezes on its last committed look and the stage edits OFF-AIR.
  env.performRT = { active: false, followed: null, hold: false };
  const ANGULAR = new Set(ANGULAR_KEYS);

  let follower = null;
  let raf = 0, lastT = 0;
  let pipEngine = null, pipLastSource = null, pipFailed = false;
  let dotSynced = null;   // last applied sync-dot state (avoid per-frame class churn)

  // onion-skin trail (Daniel's ghost spec, round 2): the trail spans the FULL
  // transition — samples persist for the whole chase (capped, oldest dropped),
  // graded oldest-faint → newest-strong, and the entire trail fades out over
  // ~450ms once the live output catches up. (Round 1 aged samples out after
  // 900ms, which truncated long chases to the last stretch — Daniel's note.)
  const GHOST_EVERY_MS = 80, GHOST_MAX = 28, GHOST_FADE_MS = 450, GHOST_MAX_A = 0.18;   // was 0.32 — Daniel: too high
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
    const docked = byId('livePip')?.classList.contains('docked');
    const a = session.frameAspect || 1;
    let w, h;
    if (docked) {
      // three-panel layout: fit the frame aspect inside the live panel's wrap
      // (both dimensions constrain — the panel can be shorter than wide)
      const wrap = byId('liveWrap');
      const cw = (wrap?.clientWidth || 0) - 16, ch = (wrap?.clientHeight || 0) - 16;
      if (cw < 8 || ch < 8) return;
      if (cw / ch >= a) { h = ch; w = h * a; } else { w = cw; h = w / a; }
      const ws = Math.round(w) + 'px';
      if (canvas.style.width !== ws) canvas.style.width = ws;
    } else {
      w = canvas.clientWidth;
      if (w < 8) return;
      h = Math.max(40, Math.round(w / a));
      if (canvas.style.width) canvas.style.width = '';   // the PiP is CSS-sized (width 100%)
    }
    const hs = Math.round(h) + 'px';
    if (canvas.style.height !== hs) canvas.style.height = hs;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let tw = Math.round(w * dpr), th = Math.round(h * dpr);
    const mx = Math.max(tw, th);
    const cap = docked ? 1600 : 960;   // the docked panel is a big view — let it stay crisp
    if (mx > cap) { const s = cap / mx; tw = Math.round(tw * s); th = Math.round(th * s); }
    if (Math.abs(canvas.width - tw) > 8 || Math.abs(canvas.height - th) > 8) {
      canvas.width = tw;
      canvas.height = th;
    }
  }

  // ---- the live-view layout (Arc 5): PiP overlay ↔ third sibling panel -------
  // #livePip re-parents between the stage panel (absolute overlay) and the live
  // panel's wrap (docked, aspect-fit) — the canvas keeps its GL context across
  // the move (the srcScrub re-parenting pattern). The live DIVIDER shows in BOTH
  // layouts while performing: in PiP it sits at the far edge, and pulling it out
  // reopens the panel (Daniel's grippy way back, beside the PiP button + the
  // footer selector).
  function applyLayout() {
    const pip = byId('livePip'), panel = byId('livePanel'),
          div = byId('liveDivider'), wrap = byId('liveWrap');
    if (!pip || !panel) return;
    const on = env.performRT.active && !pipFailed;
    const three = on && session.performLayout === 'three';
    if (three && wrap && pip.parentElement !== wrap) wrap.appendChild(pip);
    else if (!three && pip.parentElement !== byId('outPanel')) byId('outPanel').appendChild(pip);
    pip.classList.toggle('docked', three);
    pip.hidden = !on;
    panel.hidden = !three;
    if (div) div.hidden = !on;
    byId('pfLayout')?.querySelectorAll('[data-playout]').forEach((b) =>
      b.classList.toggle('active', b.dataset.playout === (session.performLayout || 'pip')));
    requestAnimationFrame(() => env.arrangeSlots?.());
  }
  function setLayout(l) {
    session.performLayout = l;
    applyLayout();
  }
  env.setPerformLayout = setLayout;

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

  // ---- source transport (a video source LOOPS while performing) -------------
  function startVideoLoop() {
    const v = env.sourceVideo;
    if (!v) return;
    v.loop = true;
    try { v.playbackRate = session.performVideoSpeed || 1; } catch { /* clamped */ }
    v.play().catch(() => {});
    syncTransportUI();
    env.updateSrcScrub?.();
  }
  function toggleVideoPlayback() {
    const v = env.sourceVideo;
    if (!v) return;
    if (v.paused) { v.loop = true; v.play().catch(() => {}); }
    else v.pause();
    syncTransportUI();
    env.updateSrcScrub?.();   // the frame picker shows while paused (pick a frame mid-set)
  }
  function syncTransportUI() {
    const v = env.sourceVideo;
    const hasVideo = !!v && env.performRT.active;
    // play keeps its motion-mode geography — disabled (not hidden) for non-video
    const play = byId('pfPlay');
    if (play) { play.disabled = !hasVideo; play.textContent = hasVideo && !v.paused ? 'pause' : 'play'; }
    const sp = byId('pfSpeed');
    if (sp) {
      sp.hidden = !hasVideo;
      sp.querySelectorAll('[data-pspd]').forEach((b) =>
        b.classList.toggle('active', Math.abs(parseFloat(b.dataset.pspd) - (session.performVideoSpeed || 1)) < 1e-6));
    }
    byId('pfHold')?.classList.toggle('active', !!env.performRT.hold);
    const take = byId('pfTake');
    if (take) take.disabled = !env.performRT.hold;
    // staging and autoplay are mutually exclusive (both want to drive the
    // stage) — each disables the other, and the title says why
    const hold = byId('pfHold');
    if (hold) {
      hold.disabled = auto.on;
      hold.title = auto.on
        ? 'staging is available when autoplay is off — auto drives the stage continuously'
        : 'stage — freeze the live output and build what’s up next off-air (S / space)';
    }
    const autoBtn = byId('pfAuto');
    if (autoBtn) {
      autoBtn.disabled = !!env.performRT.hold;
      autoBtn.title = env.performRT.hold
        ? 'autoplay is available when staging is off — take or cut the staged look first'
        : 'autoplay — the look drifts on its own within the guardrails (A)';
    }
    // center: a live camera shows icon + device name where the timeline would go
    const liveLabel = byId('pfLiveLabel');
    const isLive = !!env.live?.isLive && env.performRT.active;
    if (liveLabel) {
      liveLabel.hidden = !isLive;
      if (isLive) {
        const sel = document.getElementById('cameraSelect');
        const name = sel?.selectedOptions?.[0]?.textContent;
        byId('pfLiveName').textContent = name || 'live camera';
      }
    }
    // center: a STILL shows a lightweight placeholder (thumb + name · dims) — the
    // current→staged tween strip stays a spec'd follow-up pending conviction
    const stillLabel = byId('pfStillLabel');
    if (stillLabel) {
      const src = env.engine?.getSourceImage?.();
      const isStill = env.performRT.active && !!src && !env.sourceVideo && !isLive;
      stillLabel.hidden = !isStill;
      if (isStill) {
        const img = byId('pfStillThumb');
        const url = src.src || src.currentSrc || '';
        if (img) {
          if (url && img.src !== url) img.src = url;
          img.style.display = url ? '' : 'none';   // a frozen-camera canvas has no URL — meta only
        }
        const size = env.engine.getSourceSize?.() || {};
        const name = env.media?.originalSource?.name || env.media?.sourceFilename || 'source';
        byId('pfStillMeta').textContent = `${name}${size.w ? ` · ${size.w} × ${size.h}` : ''}`;
      }
    }
  }

  // video time ruler above the footer timeline — EFFECTIVE duration (clip length ÷
  // playback speed), so retiming visibly stretches/shrinks the scale (Daniel: seeing
  // 2 vs 8 minutes remaining matters when performing over footage)
  function renderPfRuler() {
    const ruler = byId('pfRuler');
    if (!ruler) return;
    const v = env.sourceVideo;
    const show = env.performRT.active && !!v && isFinite(v.duration) && v.duration > 0;
    ruler.hidden = !show;
    ruler.innerHTML = '';
    if (!show) return;
    const fmt = env.fmtClock || ((s) => s.toFixed(1) + 's');
    const NICE = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
    const dur = v.duration / (session.performVideoSpeed || 1);
    const w = ruler.clientWidth || 400;
    const targetLabels = Math.max(2, Math.min(12, Math.floor(w / 84)));
    const step = NICE.find((s) => dur / s <= targetLabels) ?? Math.ceil(dur / targetLabels);
    const frag = document.createDocumentFragment();
    const majors = Math.floor(dur / step + 1e-6);
    for (let i = 0; i <= majors; i++) {
      const t = i * step, p = t / dur;
      if (i > 0 && dur - t < step * 0.45) continue;   // too close to the total label
      const tick = document.createElement('div');
      tick.className = 'mf-tick major';
      tick.style.left = (p * 100) + '%';
      frag.appendChild(tick);
      const lab = document.createElement('span');
      lab.className = 'mf-time' + (p <= 0.001 ? ' start' : '');
      lab.textContent = fmt(t);
      lab.style.left = (p * 100) + '%';
      frag.appendChild(lab);
    }
    const eTick = document.createElement('div');
    eTick.className = 'mf-tick major'; eTick.style.left = '100%';
    frag.appendChild(eTick);
    const eLab = document.createElement('span');
    eLab.className = 'mf-time end total'; eLab.textContent = fmt(dur); eLab.style.left = '100%';
    frag.appendChild(eLab);
    ruler.appendChild(frag);
  }

  // source changed mid-perform (upload, camera start/stop): re-home the timeline,
  // restart the loop for a new video, refresh every center/transport read. Guarded
  // by source identity so relayouts (divider drags → arrangeSlots) don't re-play a
  // deliberately paused video.
  let lastSrcRef = null;
  env.refreshPerformSource = () => {
    if (!env.performRT.active) return;
    const src = env.engine?.getSourceImage?.() || null;
    if (src === lastSrcRef) { syncTransportUI(); return; }
    lastSrcRef = src;
    placeSrcScrub(true);
    startVideoLoop();
    syncTransportUI();
    env.updateSrcScrub?.();
    requestAnimationFrame(renderPfRuler);
  };

  // the source timeline (#srcScrub) lives in the SOURCE PANEL in still mode and
  // re-parents into the footer center in perform (full-size playback timeline);
  // CSS `order` places it correctly in the panel regardless of DOM position
  function placeSrcScrub(inFooter) {
    const scrub = byId('srcScrub');
    if (!scrub) return;
    const home = inFooter ? byId('pfCenter') : byId('srcPanel');
    if (home && scrub.parentElement !== home) {
      home.appendChild(scrub);
      requestAnimationFrame(() => env.buildSrcStrip?.());   // re-render thumbs at the new width
    }
  }

  // ---- autoplay ("drift") — Daniel's spec, approved 2026-07-08 --------------
  // Auto is ANOTHER PAIR OF HANDS ON THE SAME STAGE: a per-field wander writes
  // destinations into env.state exactly like user input, and the follower
  // chases as always — onion skin, sync dot, stage/take/cut, broadcasts need
  // zero special-casing. MANUAL WINS PER FIELD: auto tracks what it last
  // wrote, and a mismatch means your hand moved the field — it backs off
  // (cooldown), adopts your placement as the field's new HOME, and resumes
  // breathing around it. Staging pauses the drift (the stage is your off-air
  // workbench); on unhold the mismatch detection re-homes automatically.
  const AUTO_BOUNDS = {   // guardrails: destinations never leave these (rotation wraps freely)
    sliceScale: [0.25, 2.6], sliceCx: [0.15, 0.85], sliceCy: [0.15, 0.85],
    canvasZoom: [0.45, 2.4], squareAspect: [0.45, 2.4],
    drosteZoom: [1.4, 9], drosteSpiral: [-3, 3],
    drosteOffsetX: [-0.55, 0.55], drosteOffsetY: [-0.55, 0.55],
  };
  const AUTO_OWN_MS = 2000;   // manual-input cooldown before auto touches a field again
  // FRAMING fields are tempered (Daniel's calibration round: canvas zoom +
  // rotation were "more enthusiastic than expected") — they wander a fraction
  // of the range and stay anchored to their autoplay-start home; the slice is
  // the show, the canvas is the frame.
  const AUTO_TEMPER = { canvasZoom: 0.3, canvasRotation: 0.25 };
  const wrap360 = (v) => ((v % 360) + 360) % 360;
  const auto = { on: false, f: {}, roll: 0, lastSync: 0 };

  function autoFields() {
    return CONTINUOUS_KEYS.filter((k) => {
      if (k.startsWith('droste')) return state.form === 'droste';
      if (k === 'squareAspect') return state.form === 'square';
      return true;
    });
  }
  function autoField(k, now) {
    let F = auto.f[k];
    if (!F) {
      const v = state[k] ?? 0;
      F = auto.f[k] = { cur: v, vel: 0, home: v, dest: v, dir: 0, pickT: now + Math.random() * 800, ownedUntil: 0, active: false };
    }
    return F;
  }
  // destination picks carry INTENT (Daniel's tuning round): momentum (mostly
  // keep traveling the same way — fewer startling reversals, more full
  // rotations) and a coverage bias (the slice leans toward looks that cover
  // MORE of the source: scale picks lean high, position picks stay near home).
  function autoPick(k, F, now) {
    const range = (session.performAutoRange ?? 0.3) * (AUTO_TEMPER[k] || 1);
    if (k === 'canvasRotation') {
      // framing rotation OSCILLATES around home instead of walking — the
      // momentum walk belongs to the slice (full rotations are the show there)
      F.dest = F.home + (Math.random() * 2 - 1) * range * 360;
    } else if (ANGULAR.has(k)) {
      const dir = F.dir || (Math.random() < 0.5 ? -1 : 1);
      const keep = Math.random() < 0.78 ? dir : -dir;
      const sweep = (0.25 + 0.75 * Math.random()) * range * 360;   // never a micro-nudge
      F.dest = F.cur + keep * sweep;
      F.dir = keep;
    } else {
      const span = FOLLOW_SPANS[k] || 1;
      let r = Math.random() * 2 - 1;
      if (k === 'sliceScale') r = 1 - 2 * Math.pow(Math.random(), 1.7);      // leans large (coverage)
      else if (k === 'sliceCx' || k === 'sliceCy') r *= Math.random();       // leans home (keeps big slices on-image)
      else if (F.dir && Math.random() < 0.65) r = Math.abs(r) * F.dir;       // momentum
      let d = F.home + r * range * span;
      const b = AUTO_BOUNDS[k];
      if (b) {
        // the guardrail bounds AUTO's wandering, never the user: if a manual
        // edit homed the field outside them, the window stretches to include it
        d = Math.max(Math.min(b[0], F.home), Math.min(Math.max(b[1], F.home), d));
      }
      F.dir = Math.sign(d - F.cur) || F.dir;
      F.dest = d;
    }
    // pace curve recentered on Daniel's calibration (his found-good sat at the
    // old slider's floor): default (50%) ≈ 5.2s between picks, floor ≈ 15s,
    // ceiling ≈ 1.5s
    const pace = session.performAutoPace ?? 0.5;
    F.pickT = now + (1500 + Math.pow(1 - pace, 2) * 14800) * (0.6 + Math.random() * 0.8);
  }
  function autoTick(now, dt) {
    const fields = autoFields();
    if (now >= auto.roll) {
      // variety: how many fields wander at once (a fresh weighted subset)
      const variety = session.performAutoVariety ?? 0.5;
      const count = Math.max(1, Math.round(fields.length * (0.15 + 0.85 * variety)));
      const set = new Set([...fields].sort(() => Math.random() - 0.5).slice(0, count));
      for (const k of fields) autoField(k, now).active = set.has(k);
      auto.roll = now + 5000 + Math.random() * 5000;
    }
    // the glide is a critically damped SPRING per field (smoothing = its
    // response): velocity stays CONTINUOUS across destination changes, so a
    // new pick never jerks and an opposite pick decelerates through zero
    // instead of snapping into reverse — the honest in-auto smoothing.
    // smoothing recentered the same way (his found-good was ~90% of the old
    // curve): default (65%) ≈ the feel he liked, ceiling reaches silkier still
    const smooth = session.performAutoSmooth ?? 0.65;
    const tau = 0.4 + Math.pow(smooth, 1.3) * 5.0;
    const omega = 2 / tau;
    const dts = Math.min(dt, 100) / 1000;
    const decay = Math.exp(-omega * dts);
    for (const k of fields) {
      const F = autoField(k, now);
      const live = state[k] ?? 0;
      // ownership: auto writes exact values, so ANY external change means a
      // hand (or system) moved the field — yield, adopt it as the new home
      const moved = ANGULAR.has(k)
        ? Math.abs(angDelta(wrap360(F.cur), wrap360(live))) > 1e-4
        : Math.abs(live - F.cur) > (FOLLOW_SPANS[k] || 1) * 1e-6;
      if (moved) {
        F.ownedUntil = now + AUTO_OWN_MS;
        F.cur = live; F.vel = 0; F.home = live; F.dest = live; F.dir = 0;
        F.pickT = now + 400;
        continue;
      }
      if (!F.active || now < F.ownedUntil) { F.cur = live; F.vel = 0; F.home = live; F.dest = live; continue; }
      if (now >= F.pickT) autoPick(k, F, now);
      const y = F.cur - F.dest;
      const tmp = (F.vel + omega * y) * dts;
      F.cur = F.dest + (y + tmp) * decay;
      F.vel = (F.vel - omega * tmp) * decay;
      if (ANGULAR.has(k)) {
        // re-base a long drift toward 0 so unwrapped values never grow unbounded
        if (Math.abs(F.cur) > 7200) { const s = 360 * Math.floor(F.cur / 360); F.cur -= s; F.dest -= s; }
        state[k] = wrap360(F.cur);
      } else {
        state[k] = F.cur;
      }
    }
  }
  function setAuto(on) {
    if (on === auto.on) return;
    if (on && env.performRT.hold) return;     // mutually exclusive with staging (the buttons explain)
    auto.on = on;
    if (on) { auto.f = {}; auto.roll = 0; }   // fresh homes at the current look
    byId('pfAuto')?.classList.toggle('active', on);
    syncTransportUI();                         // stage/auto disable each other with explanatory titles
  }

  // normalized live-vs-stage distance (the in-sync read). Measured directly
  // between the stage (state) and the live view (followed) — the follower's own
  // settle flag isn't enough once HOLD exists (a settled spring on a frozen
  // target still differs from an edited stage).
  function stageDivergence() {
    const f = env.performRT.followed;
    if (!f) return 0;
    let mx = 0;
    for (const k of CONTINUOUS_KEYS) {
      const span = FOLLOW_SPANS[k] || 1;
      const d = ANGULAR.has(k)
        ? Math.abs(angDelta(f[k] ?? 0, state[k] ?? 0))
        : Math.abs((state[k] ?? 0) - (f[k] ?? 0));
      if (d / span > mx) mx = d / span;
    }
    return mx;
  }

  function updateSyncDot() {
    const synced = follower ? (follower.isSettled() && stageDivergence() < 0.002) : true;
    // Daniel's clarified spec: amber while differing; in sync + BROADCASTING =
    // GREEN (honest "what's out is what you see"); in sync, no broadcast = quiet.
    const broadcasting = !!document.querySelector('#outputLed i.on-green');
    const key = synced + ':' + broadcasting;
    if (key === dotSynced) return;
    dotSynced = key;
    const dot = byId('lpDot');
    if (dot) {
      dot.classList.toggle('sync', synced);
      dot.classList.toggle('live', synced && broadcasting);
    }
    const pip = byId('livePip');
    if (pip) pip.title = synced
      ? 'live output — in sync with the stage'
      : (env.performRT.hold ? 'live output — holding; the staged look differs' : 'live output — easing toward your edits');
  }

  // ---- the perform loop -----------------------------------------------------
  function tick(t) {
    if (!env.performRT.active) return;
    const dt = lastT ? Math.min(t - lastT, 100) : 16.7;   // clamp tab-back jumps
    lastT = t;
    // the working state IS the target: every input path (sliders, scrubs, wedge
    // drags, output gestures) feeds the follower with zero per-control wiring
    // a PLAYING video source drives the stage each frame (the preview otherwise
    // renders on demand): fresh frame → texture → render the target state.
    // (the camera's own live loop already does this for live sources.)
    const v = env.sourceVideo;
    if (v && !v.paused && !v.seeking && env.engine?.getSourceImage?.()) {
      env.engine.updateSourceFrame();
      env.engine.render(state);
      env.sourceOverlay.paintSourceVideo();
      // the footer timeline's playhead rides the loop
      if (isFinite(v.duration) && v.duration > 0) {
        const head = byId('srcScrubHead');
        if (head) head.style.left = ((v.currentTime / v.duration) * 100) + '%';
      }
      if (!env.performRT.videoWasPlaying) { env.performRT.videoWasPlaying = true; syncTransportUI(); }
    } else if (env.performRT.videoWasPlaying) {
      env.performRT.videoWasPlaying = false;
      syncTransportUI();
    }
    // autoplay drifts the stage like any hand would (paused while staged —
    // the stage is the off-air workbench; unhold re-homes via mismatch)
    if (auto.on && !env.performRT.hold) {
      autoTick(t, dt);
      env.scheduleRender?.();               // repaint the stage with the drifted look
      env.sourceOverlay.scheduleDraw();     // the wedge overlay rides along
      if (t - auto.lastSync > 250) { auto.lastSync = t; env.syncControls?.(); }
    }
    // HOLD gates the target feed: while holding, the live view keeps its last
    // committed look and stage edits stay off-air (take/cut commit them)
    if (!env.performRT.hold) follower.setTarget(state);
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
    if (env.performRT.hold && stageDivergence() > 0.002 && settled) {
      // STAGING onion skin (Daniel): while a staged look is being built, show the
      // PRIOR (held live) state as one steady ghost beside the staged wedge —
      // the side-by-side read; the animated trail belongs to the take itself
      view.performGhosts = [{ snap: env.performRT.followed, alpha: 0.22 }];
      env.sourceOverlay.scheduleDraw();
    } else if (trail.length) {
      const fade = settleFadeT ? Math.max(0, 1 - (t - settleFadeT) / GHOST_FADE_MS) : 1;
      const n = trail.length;
      view.performGhosts = trail.map((g, i) => ({
        snap: g.snap,
        alpha: fade * (0.03 + GHOST_MAX_A * ((i + 1) / n)),   // oldest nearly invisible
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
      document.activeElement?.blur?.();   // enter with clean focus — the keys work from keypress one
      follower = createFollower(state, { response: session.performResponse ?? 0.35 });
      env.performRT.active = true;
      env.performRT.followed = { ...state };
      env.performRT.hold = false;
      trail = []; lastGhostT = 0; settleFadeT = 0;
      ensurePipEngine();
      applyLayout();   // shows the live view per session.performLayout (pip / three-panel)
      // the labels show in EVERY mode; perform just renames the output panel to
      // its perform role ("staged" — what's up next, vs the live view)
      const sl = byId('stageLabel'); if (sl) sl.textContent = 'staged';
      const footer = byId('performFooter');
      if (footer) footer.hidden = false;
      placeSrcScrub(true);             // the video timeline moves into the footer center
      startVideoLoop();                // a video source loops while performing
      lastSrcRef = env.engine?.getSourceImage?.() || null;
      syncTransportUI();
      requestAnimationFrame(renderPfRuler);   // after the footer lays out (real width)
      dotSynced = null;
      lastT = 0;
      raf = requestAnimationFrame(tick);
    } else {
      env.performRT.active = false;
      env.performRT.followed = null;   // broadcasts revert to the working state (a hard cut)
      env.performRT.hold = false;
      setAuto(false);                  // the drift is a perform behavior — off with the mode
      follower = null;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      applyLayout();   // hides the live view, panel + divider; re-homes the PiP
      const sl = byId('stageLabel'); if (sl) sl.textContent = 'output';
      const footer = byId('performFooter'); if (footer) footer.hidden = true;
      placeSrcScrub(false);            // the timeline returns to the source panel
      renderPfRuler();                 // hides itself when perform is off
      // park a playing video (still-mode semantics: the frame picker owns frames)
      if (env.sourceVideo && !env.sourceVideo.paused) { try { env.sourceVideo.pause(); } catch { /* ignore */ } }
      env.scheduleRender?.();
      trail = []; settleFadeT = 0;
      if (env.sourceOverlay?.view) env.sourceOverlay.view.performGhosts = null;
      env.sourceOverlay?.scheduleDraw?.();   // wipe any lingering ghost strokes
    }
    env.updateMotionUI?.();   // one radio sync + export gating pass for all three modes
    env.updateSrcScrub?.();
    // the footer changes the stage height — refit the panels + preview
    requestAnimationFrame(() => env.arrangeSlots?.());
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

  // staged-transition transport (Arc 5 core). HOLD toggles the target gate;
  // TAKE commits the CURRENT stage once (the spring blends live → stage at the
  // transition speed) and STAYS held, so you keep building the next look
  // off-air; CUT snaps live to the stage instantly (also skips an in-flight
  // ease while following).
  byId('pfHold')?.addEventListener('click', () => {
    env.performRT.hold = !env.performRT.hold;
    syncTransportUI();
  });
  byId('pfTake')?.addEventListener('click', () => {
    if (env.performRT.hold) follower?.setTarget(state);
  });
  byId('pfCut')?.addEventListener('click', () => { follower?.jump(state); });

  // keyboard (perform only — space is FREE here, unlike motion, so it gets the
  // ergonomic star role Daniel wanted: press to STAGE the next take, press again
  // to TAKE. S / T are the explicit memorable pair; video play/pause stays a
  // button (P if it earns a key later).
  window.addEventListener('keydown', (e) => {
    if (!env.performRT.active) return;
    const el = e.target;
    const tag = el?.tagName;
    // only TEXT-ENTRY fields keep the keys: any clicked slider/button holds focus
    // afterward, and a blanket INPUT guard silently ate space/S/T until something
    // else blurred it (Daniel: "not reliable until I press take in the UI")
    if (el && (el.isContentEditable || tag === 'TEXTAREA' || tag === 'SELECT' ||
        (tag === 'INPUT' && !/^(range|checkbox|radio|button|submit|reset|color|file)$/.test(el.type)))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (tag === 'BUTTON') el.blur();   // space must never double as "re-click the focused button"
    if (e.code === 'Space') {
      e.preventDefault();
      if (auto.on) return;               // staging is off while autoplay drives the stage
      if (!env.performRT.hold) { env.performRT.hold = true; syncTransportUI(); }
      else follower?.setTarget(state);   // take — stays staged for the next build
    } else if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      if (auto.on) return;               // staging is off while autoplay drives the stage
      env.performRT.hold = !env.performRT.hold;
      syncTransportUI();
    } else if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      if (env.performRT.hold) follower?.setTarget(state);
    } else if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      setAuto(!auto.on);   // autoplay toggle (the footer button's key)
    }
  });

  // source transport (video-loop play/pause + playback speed)
  byId('pfPlay')?.addEventListener('click', toggleVideoPlayback);
  byId('pfSpeed')?.querySelectorAll('[data-pspd]').forEach((b) =>
    b.addEventListener('click', () => {
      session.performVideoSpeed = parseFloat(b.dataset.pspd) || 1;
      const v = env.sourceVideo;
      if (v) { try { v.playbackRate = session.performVideoSpeed; } catch { /* clamped */ } }
      syncTransportUI();
      renderPfRuler();   // effective duration changed
    }));

  // autoplay: the footer toggle + the guardrail dials (the gear's popover is
  // wired by main.js wirePanelPopovers alongside the panel popovers)
  byId('pfAuto')?.addEventListener('click', () => setAuto(!auto.on));
  const wireAutoDial = (id, valId, key) => {
    const el = byId(id), val = byId(valId);
    if (!el) return;
    el.value = String(session[key] ?? parseFloat(el.value));
    const show = () => { if (val) val.textContent = Math.round(parseFloat(el.value) * 100) + '%'; };
    show();
    el.addEventListener('input', () => { session[key] = parseFloat(el.value) || 0; show(); });
  };
  wireAutoDial('autoPace', 'autoPaceVal', 'performAutoPace');
  wireAutoDial('autoRange', 'autoRangeVal', 'performAutoRange');
  wireAutoDial('autoVariety', 'autoVarietyVal', 'performAutoVariety');
  wireAutoDial('autoSmooth', 'autoSmoothVal', 'performAutoSmooth');

  // the live-view layout: the footer selector + the hover dock button on the PiP
  byId('pfLayout')?.querySelectorAll('[data-playout]').forEach((b) =>
    b.addEventListener('click', () => setLayout(b.dataset.playout)));
  byId('pipDockBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setLayout('three');
  });

  // clicked footer buttons release focus, so space/S/T always reach the perform
  // keys (a focused button ate space; a focused select did native type-ahead)
  byId('performFooter')?.addEventListener('click', (e) => e.target.closest('button')?.blur());
  // any select used while performing releases focus too — a focused select owns
  // the keyboard natively (space opens it, S type-aheads) and can't be shared
  document.addEventListener('change', (e) => {
    if (env.performRT.active && e.target?.tagName === 'SELECT') e.target.blur();
  });
}
