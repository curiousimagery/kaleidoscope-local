// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/clip-editor.js
//
// The pre-animation CLIP EDITOR (a focused #clipSheet for prepping a video clip
// before animating): trim front/back, and the seamless-loop modes — bounce
// (forward-then-reverse) and slice (cut + crossfade). bounce/slice BAKE a new
// processed clip (reusing the video-export encoder) and swap it in as the source.
// In-editor previews are smooth: a coalesced scrubber, seek-driven bounce, and a
// two-video live crossfade.
//
// Extracted from main.js (Phase 2a). State lives on `env.clip` (the `trim` object
// + the preview/bake machine). Cross-module collaborators are reached through
// late-bound `env` method handles (env.scrubVideo, env.renderTimeline, …); the
// clip editor's own public surface is hung back on `env` for the chrome's wiring.

import { exportVideo } from './video-export.js';
import { seekVideoTo } from './video-source.js';
import { createSequentialFrameReader } from './video-decode.js';

export function createClipEditor(env) {
  // Stable refs (set before this runs, never reassigned) can be captured; cross-
  // module FUNCTION handles must be called as env.X() so init order can't bite.
  const { motion, session, engine } = env;

  // ---- clip editor (pre-animation video prep) -------------------------------
  // Uses its OWN preview <video> (the same blob URL) so it never disturbs the
  // texture-source element. Applying commits the trim to `env.clip.trim`; the
  // motion timeline re-binds to the trimmed range.
  function openClipEditor(opts = {}) {
    if (!env.sourceVideo || !env.media.sourceVideoUrl) return;
    const sheet = document.getElementById('clipSheet');
    if (!sheet) return;
    // entering with existing keyframes: baking reshuffles the source, which shifts
    // keyframe positions. Warn on an EXPLICIT open (mode menu / overflow), not on the
    // auto-open after a fresh video load (a new clip carries only the seeded kf0).
    if (!opts.fromLoad && motion.keyframes && motion.keyframes.length > 1) {
      if (!window.confirm('Editing this clip in Loop Builder will shift your existing keyframe positions (baking reshuffles the source footage). Continue?')) return;
    }
    if (motion.playing) env.stopPlayback();
    env.clip.backup = { ...env.clip.trim };          // for Cancel
    const pv = document.getElementById('clipVideo');
    pv.muted = true; pv.playsInline = true; pv.loop = false;
    pv.src = env.media.sourceVideoUrl;
    env.clip.prevVideo = pv;
    // a second, hidden-but-decoding preview video: plays the A-head during the seam
    // crossfade so the two streams can be alpha-blended live (smooth, no capture).
    const vB = document.createElement('video');
    vB.muted = true; vB.playsInline = true; vB.loop = false; vB.preload = 'auto';
    vB.setAttribute('playsinline', ''); vB.setAttribute('muted', '');
    vB.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    vB.src = env.media.sourceVideoUrl;
    (document.querySelector('.clip-stage') || sheet).appendChild(vB);
    env.clip.prevVideoB = vB;
    const nudge = document.getElementById('clipNudge'); if (nudge) nudge.hidden = true;   // clear any prior post-bake nudge
    // enter the mode: the surface sits BELOW the global app bar (which stays visible +
    // gated), and the mode picker reflects "loop builder" as the active mode
    document.body.classList.add('loop-active');
    const bar = document.getElementById('outputToolbar');
    sheet.style.top = bar ? Math.round(bar.getBoundingClientRect().bottom) + 'px' : '0px';
    const ms = document.getElementById('modeSelect'); if (ms) ms.value = 'loop';
    sheet.hidden = false;
    const init = () => { env.clip.step = 1; setClipMode(env.clip.trim.mode); setLoopStep(1); };
    if (pv.readyState >= 1) init(); else pv.addEventListener('loadedmetadata', init, { once: true });
  }
  function disposeClipPreview() {
    stopClipPreview();
    exitSplitStage();   // restore the stage video's visibility if we tore down on the crossfade step
    const blend = document.getElementById('clipBlend'); if (blend) blend.hidden = true;
    if (env.clip.prevVideo) { try { env.clip.prevVideo.pause(); } catch { /* ignore */ } env.clip.prevVideo.removeAttribute('src'); try { env.clip.prevVideo.load(); } catch { /* ignore */ } env.clip.prevVideo = null; }
    if (env.clip.prevVideoB) { try { env.clip.prevVideoB.pause(); } catch { /* ignore */ } env.clip.prevVideoB.removeAttribute('src'); try { env.clip.prevVideoB.load(); } catch { /* ignore */ } env.clip.prevVideoB.remove(); env.clip.prevVideoB = null; }
  }
  // re-bind the motion timeline to the current (trimmed / baked) clip + show frame 0.
  function rebindClipToTimeline() {
    if (!env.sourceVideo) return;
    env.lockVideoDuration();
    motion.playhead = 0;
    session.timelineZoom = 1; session.timelinePan = 0;
    env.filmstrip.lastSig = '';
    if (env.ensureSeededSelection()) return;         // always land with a selected kf0 (so +keyframe adds an in-between)
    env.renderTimeline();
    env.updateMotionUI();
    env.scrubVideo(0);
  }
  function hideLoopSurface() {
    document.body.classList.remove('loop-active');
    const sheet = document.getElementById('clipSheet');
    if (sheet) { sheet.hidden = true; sheet.style.top = ''; }
    const nudge = document.getElementById('clipNudge'); if (nudge) nudge.hidden = true;
  }
  function closeClipEditor(apply) {
    if (env.clip.baking) return;                      // don't tear down mid-bake (the decode video is in use)
    disposeClipPreview();
    hideLoopSurface();
    if (!apply && env.clip.backup) Object.assign(env.clip.trim, env.clip.backup);   // revert the trim/mode
    env.clip.backup = null;
    rebindClipToTimeline();
  }
  // has the user changed anything from the state at open (drives the leave-warning)?
  function loopIsDirty() {
    const b = env.clip.backup, t = env.clip.trim;
    if (!b) return false;
    return t.inT !== b.inT || t.outT !== b.outT || t.mode !== b.mode || t.slicePoint !== b.slicePoint || t.crossfadeMs !== b.crossfadeMs;
  }
  // the ONLY exit (no cancel/close buttons) — the app-bar mode picker + uploading a new
  // clip both route here. Returns true if it's OK to leave, false if the user backed out.
  function exitLoopBuilder() {
    if (env.clip.baking) return false;                               // never leave mid-bake
    if (!document.body.classList.contains('loop-active')) return true;
    if (loopIsDirty() && !window.confirm('Leave Loop Builder? Your unsaved trim / loop settings will be discarded.')) return false;
    closeClipEditor(false);
    return true;
  }
  function renderClipTrim() {
    const trim = env.clip.trim;
    const d = (env.clip.prevVideo && env.clip.prevVideo.duration) || 0;
    const inEl = document.getElementById('clipIn'), outEl = document.getElementById('clipOut'), region = document.getElementById('clipRegion');
    if (inEl) inEl.style.left = (trim.inT * 100) + '%';
    if (outEl) outEl.style.left = (trim.outT * 100) + '%';
    if (region) { region.style.left = (trim.inT * 100) + '%'; region.style.right = ((1 - trim.outT) * 100) + '%'; }
    const cutEl = document.getElementById('clipCut');
    if (cutEl) cutEl.style.left = ((trim.inT + trim.slicePoint * (trim.outT - trim.inT)) * 100) + '%';
    const lab = document.getElementById('clipDur');
    if (lab && d) lab.textContent = `${env.fmtClock((trim.outT - trim.inT) * d)} of ${env.fmtClock(d)}`;
    renderXfadeRegion();
  }
  // preview segments to play in order (looping). slice previews the REARRANGEMENT — B
  // (=[cut,out]) then A (=[in,cut]) — so the seam is visible in context (a hard cut here;
  // the bake crossfades it). Other modes preview the trimmed forward range (bounce can't
  // reverse natively, so its preview is forward — the bake adds the reverse).
  function clipPreviewSegments() {
    const trim = env.clip.trim;
    const d = (env.clip.prevVideo && env.clip.prevVideo.duration) || 1;
    const inS = trim.inT * d, outS = trim.outT * d;
    if (trim.mode === 'slice') {
      const cut = (trim.inT + trim.slicePoint * (trim.outT - trim.inT)) * d;
      return [[cut, outS], [inS, cut]];
    }
    return [[inS, outS]];
  }
  // reset=true starts the loop from the beginning; reset=false resumes from the video's
  // CURRENT position (used after a scrub release, so you can scrub forward and play on).
  function startClipPreview(reset = true) {
    const v = env.clip.prevVideo;
    if (!v) return;
    const trim = env.clip.trim;
    // Bounce can't play natively (no reverse), so drive it seek-based: a wall-clock p over
    // the bounce duration → triangle → trimmed source time, seeked (coalesced). The reverse
    // half uses backward seeks so it's choppy on long clips, but it bounces; the scrubber
    // lets you inspect the turnaround precisely.
    if (trim.mode === 'bounce') {
      try { v.pause(); } catch { /* ignore */ }
      if (reset) env.clip.bounceStart = performance.now();
      else {                                         // continue the triangle from the current frame (forward half)
        const d = v.duration || 1, range = (trim.outT - trim.inT) || 1;
        const loopMs = Math.max(400, range * d * 2 * 1000);
        const q = Math.max(0, Math.min(1, (v.currentTime / d - trim.inT) / range));
        env.clip.bounceStart = performance.now() - (q / 2) * loopMs;
      }
      const tickB = () => {
        if (!env.clip.prevVideo) return;
        const d = v.duration || 1, range = trim.outT - trim.inT;
        const loopMs = Math.max(400, range * d * 2 * 1000);
        const p = ((performance.now() - env.clip.bounceStart) % loopMs) / loopMs;
        const q = 1 - Math.abs(1 - 2 * p);                 // 0→1→0
        clipSeekTo(trim.inT + q * range);
        const ph = document.getElementById('clipPlayhead');
        if (ph) ph.style.left = ((v.currentTime / d) * 100) + '%';
        env.clip.raf = requestAnimationFrame(tickB);
      };
      env.clip.raf = requestAnimationFrame(tickB);
      return;
    }
    if (trim.mode === 'slice') { startSlicePreview(reset); return; }   // phase machine with a real seam dissolve
    const segs = clipPreviewSegments();
    if (reset) { env.clip.seg = 0; try { v.currentTime = segs[0][0]; } catch { /* ignore */ } }
    else {                                           // resume from the current frame (find its segment)
      env.clip.seg = 0;
      for (let i = 0; i < segs.length; i++) { if (v.currentTime >= segs[i][0] - 0.05 && v.currentTime < segs[i][1] + 0.05) { env.clip.seg = i; break; } }
    }
    v.play().catch(() => {});
    const tick = () => {
      if (!env.clip.prevVideo) return;
      const segs = clipPreviewSegments();           // re-read each frame so mode/cut/trim edits apply live
      if (env.clip.seg >= segs.length) env.clip.seg = 0;
      const [s, e] = segs[env.clip.seg];
      if (v.currentTime >= e - 0.03 || v.currentTime < s - 0.08) {
        env.clip.seg = (env.clip.seg + 1) % segs.length;
        try { v.currentTime = segs[env.clip.seg][0]; } catch { /* ignore */ }
      }
      const ph = document.getElementById('clipPlayhead');
      if (ph) ph.style.left = ((v.currentTime / (v.duration || 1)) * 100) + '%';
      env.clip.raf = requestAnimationFrame(tick);
    };
    env.clip.raf = requestAnimationFrame(tick);
  }

  // --- slice preview with a real seam crossfade (two-video live blend) ----------
  // Native playback of the rearranged segments (B=[cut,out] then A=[in,cut], smooth). At
  // the B→A seam, a SECOND preview video (`env.clip.prevVideoB`) plays the A-head in parallel
  // while the main video plays the B-tail, and the two are alpha-blended live onto the
  // #clipBlend overlay over the crossfade duration — smooth, no frame capture, no seek
  // pause (the fix for the seam stutter). Then the main video hands off to A at in+cfSec.
  function sliceTimes() {
    const trim = env.clip.trim;
    const v = env.clip.prevVideo, d = (v && v.duration) || 1, range = trim.outT - trim.inT;
    const inA = trim.inT * d, outA = trim.outT * d, cut = (trim.inT + trim.slicePoint * range) * d;
    const cfSec = Math.max(0.05, Math.min(trim.crossfadeMs / 1000, (outA - cut) * 0.9, (cut - inA) * 0.9));
    return { d, inA, outA, cut, cfSec };
  }
  function drawTwoVideoBlend(a) {
    const blend = document.getElementById('clipBlend');
    const v = env.clip.prevVideo, vB = env.clip.prevVideoB;
    if (!blend || !v) return;
    const W = Math.min(640, v.videoWidth || 640), sc = W / (v.videoWidth || W), H = Math.max(1, Math.round((v.videoHeight || W) * sc));
    if (blend.width !== W || blend.height !== H) { blend.width = W; blend.height = H; }
    const cx = blend.getContext('2d');
    cx.globalAlpha = 1; cx.drawImage(v, 0, 0, W, H);                       // B-tail
    if (vB && vB.readyState >= 2) { cx.globalAlpha = a; cx.drawImage(vB, 0, 0, W, H); }   // A-head
    cx.globalAlpha = 1;
  }
  function startSlicePreview(reset) {
    const v = env.clip.prevVideo, vB = env.clip.prevVideoB;
    if (!v) return;
    const blend = document.getElementById('clipBlend');
    if (reset) { env.clip.phase = 'B'; try { v.currentTime = sliceTimes().cut; } catch { /* ignore */ } if (blend) blend.hidden = true; }
    v.play().catch(() => {});
    if (vB) { try { vB.pause(); vB.currentTime = sliceTimes().inA; } catch { /* ignore */ } }   // pre-roll A-head
    const tick = () => {
      if (!env.clip.prevVideo) return;
      const { d, inA, outA, cut, cfSec } = sliceTimes();
      if (env.clip.phase === 'crossfade') {
        const a = Math.max(0, Math.min(1, (v.currentTime - (outA - cfSec)) / cfSec));
        drawTwoVideoBlend(a);
        if (a >= 1 || v.currentTime >= outA - 0.02) {
          env.clip.phase = 'A';
          if (vB) { try { vB.pause(); } catch { /* ignore */ } }
          try { v.pause(); v.currentTime = inA + cfSec; } catch { /* ignore */ }   // blend stays up, masking this seek
        }
      } else if (env.clip.phase === 'B') {
        if (vB && !vB.seeking && Math.abs(vB.currentTime - inA) > 0.05) { try { vB.currentTime = inA; } catch { /* ignore */ } }   // keep A-head pre-rolled
        if (v.currentTime >= outA - cfSec - 0.02 || v.currentTime < cut - 0.08) {
          env.clip.phase = 'crossfade';
          if (blend) blend.hidden = false;
          if (vB) { try { vB.currentTime = inA; vB.play().catch(() => {}); } catch { /* ignore */ } }
        }
      } else {                                          // 'A' — native [in+cf, cut]
        if (blend && !blend.hidden) {                   // still masking the post-crossfade seek
          if (!v.seeking && v.currentTime >= inA + cfSec - 0.06) { blend.hidden = true; v.play().catch(() => {}); }
        } else if (v.currentTime >= cut - 0.02) {       // loop back to B
          env.clip.phase = 'B'; try { v.currentTime = cut; v.play().catch(() => {}); } catch { /* ignore */ }
        }
      }
      const ph = document.getElementById('clipPlayhead');
      if (ph) ph.style.left = ((v.currentTime / d) * 100) + '%';
      env.clip.raf = requestAnimationFrame(tick);
    };
    env.clip.raf = requestAnimationFrame(tick);
  }
  function stopClipPreview() {
    if (env.clip.raf) { cancelAnimationFrame(env.clip.raf); env.clip.raf = 0; }
    if (env.clip.prevVideo) { try { env.clip.prevVideo.pause(); } catch { /* ignore */ } }
  }
  // Coalesced seek of the preview video to normalized position t (latest target wins) —
  // mirrors scrubVideo, so dragging a trim handle never floods the decoder (which made
  // the clip-editor scrubber feel much heavier than the main timeline, even on Chrome).
  function clipSeekTo(t) {
    const v = env.clip.prevVideo;
    if (!v) return;
    env.clip.seekT = t;
    if (env.clip.seeking) return;
    env.clip.seeking = true;
    (async () => {
      try {
        while (env.clip.seekT != null) {
          const target = env.clip.seekT; env.clip.seekT = null;
          await seekVideoTo(v, target * (v.duration || 1));
        }
      } finally { env.clip.seeking = false; }
    })();
  }
  function makeClipHandle(el, which) {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); el.setPointerCapture?.(e.pointerId);
      env.clip.drag = which;
      stopClipPreview();                              // hold playback while scrubbing the handle
    });
    el.addEventListener('pointermove', (e) => {
      if (env.clip.drag !== which) return;
      const trim = env.clip.trim;
      const bar = document.getElementById('clipBar');
      const r = bar.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const gap = 0.02;
      if (which === 'in') trim.inT = Math.min(t, trim.outT - gap);
      else if (which === 'out') trim.outT = Math.max(t, trim.inT + gap);
      else { const rng = (trim.outT - trim.inT) || 1; trim.slicePoint = Math.max(0.05, Math.min(0.95, (t - trim.inT) / rng)); }
      renderClipTrim();
      const handleT = which === 'in' ? trim.inT : which === 'out' ? trim.outT : (trim.inT + trim.slicePoint * (trim.outT - trim.inT));
      if (env.clip.step === 4 && env.clip.trim.mode === 'slice') {
        // split-stage (crossfade seam match): the OUT handle drives the last-before
        // frame, the IN handle the first-after frame; cut just reshapes the region
        if (which === 'out') updateSplitLeft();
        else if (which === 'in') updateSplitRight();
      } else {
        clipSeekTo(handleT);                          // coalesced seek (no decoder flood) — shows the frame under the handle
        const ph = document.getElementById('clipPlayhead');
        if (ph) ph.style.left = (handleT * 100) + '%';
      }
    });
    const up = (e) => {
      if (env.clip.drag !== which) return;
      env.clip.drag = null; el.releasePointerCapture?.(e.pointerId);
      if (!(env.clip.step === 4 && env.clip.trim.mode === 'slice')) startClipPreview();   // step 4 stays on the split-stage
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
  const byId = (id) => document.getElementById(id);
  // loop strategy: forward (trim only, non-destructive) | bounce (baked) | slice (baked seamless loop).
  // Sets the mode + behavior-button active + restarts the preview. Step-driven VISIBILITY
  // (cut handle, crossfade region, split-stage) is owned by setLoopStep, not here.
  function setClipMode(mode) {
    env.clip.trim.mode = mode;
    byId('clipSheet')?.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    const blend = byId('clipBlend'); if (blend && mode !== 'slice') blend.hidden = true;
    renderClipTrim();
    if (env.clip.raf && env.clip.prevVideo && !env.clip.drag) { stopClipPreview(); startClipPreview(); }   // re-segment a RUNNING preview for the new mode
  }

  // ---- the STEPPED FLOW (progressive disclosure) ------------------------------
  // The Loop Builder walks Trim → Behavior → [Slice point → Crossfade] → Bake. The
  // slice-only steps (3,4) drop out for trim-only/bounce; back-nav is live until bake.
  function stepSeq() {
    const m = env.clip.trim.mode;
    if (m === 'slice') return [1, 2, 3, 4, 5];
    if (m === 'bounce') return [1, 2, 5];
    return [1, 2];   // forward (trim only) — step 2 applies the trim
  }
  function loopModeLabel() { return env.clip.trim.mode === 'slice' ? 'loop' : env.clip.trim.mode; }
  function updateRail() {
    const seq = stepSeq(), step = env.clip.step;
    byId('clipSheet')?.querySelectorAll('.loop-step').forEach((b) => {
      const s = +b.dataset.step, inSeq = seq.includes(s);
      b.hidden = !inSeq;                        // slice steps drop for non-slice; step 5 drops for forward
      b.disabled = !inSeq;
      b.classList.toggle('active', s === step);
      b.classList.toggle('done', inSeq && seq.indexOf(s) < seq.indexOf(step));
    });
  }
  function loopPrimary() {
    const seq = stepSeq(), isLast = env.clip.step === seq[seq.length - 1];
    const apply = byId('clipApply'); if (!apply) return;
    apply.textContent = isLast
      ? (env.clip.trim.mode === 'forward' ? 'apply trim' : `bake ${loopModeLabel()} ✦`)
      : 'next ›';
    apply.dataset.terminal = isLast ? '1' : '';
  }
  function setLoopStep(n) {
    env.clip.step = n;
    const sheet = byId('clipSheet');
    sheet?.querySelectorAll('.loop-panel').forEach((p) => { p.hidden = +p.dataset.panel !== n; });
    const slice = env.clip.trim.mode === 'slice';
    const cutEl = byId('clipCut'); if (cutEl) cutEl.hidden = !(slice && n >= 3);
    const region = byId('clipXfadeRegion'); if (region) region.hidden = !(slice && n >= 4);
    // step 4 shows the split-stage (the seam-match preview); every other step plays normally
    if (slice && n === 4) enterSplitStage();
    else { exitSplitStage(); if (env.clip.prevVideo && !env.clip.raf && !env.clip.drag) startClipPreview(); }
    const seq = stepSeq();
    const back = byId('loopBack'); if (back) back.hidden = seq.indexOf(n) <= 0;
    hideXfadeMenu();
    updateRail(); loopPrimary(); renderClipTrim();
  }
  function goNext() { const seq = stepSeq(), i = seq.indexOf(env.clip.step); if (i >= 0 && i < seq.length - 1) setLoopStep(seq[i + 1]); }
  function goBack() { const seq = stepSeq(), i = seq.indexOf(env.clip.step); if (i > 0) setLoopStep(seq[i - 1]); }
  // the primary button: advance, or apply/bake on the terminal step
  function loopPrimaryAction() {
    const seq = stepSeq();
    if (env.clip.step === seq[seq.length - 1]) applyClip(); else goNext();
  }
  // jump straight to a rail step (only within the reached range — no skipping ahead)
  function jumpToStep(n) {
    const seq = stepSeq(); if (!seq.includes(n)) return;
    setLoopStep(n);
  }
  // a behavior choice at step 2 (changes which later steps exist)
  function chooseBehavior(mode) { setClipMode(mode); updateRail(); loopPrimary(); }

  // ---- split-stage: the crossfade seam match (last-before | first-after) ------
  // On the crossfade step, the stage splits: LEFT = the last frame before the seam
  // (frame @ outT, B's tail), RIGHT = the first frame after (frame @ inT, A's head) —
  // the two frames the crossfade must dissolve between. Dragging the OUT handle updates
  // the left, the IN handle the right, so you can hunt a smooth match (the FCP technique).
  function drawFrameTo(video, canvas) {
    if (!video || !canvas || !video.videoWidth) return;
    const W = Math.min(960, video.videoWidth), sc = W / video.videoWidth, H = Math.max(1, Math.round(video.videoHeight * sc));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    canvas.getContext('2d').drawImage(video, 0, 0, W, H);
  }
  let splitSeekA = false, splitTgtA = null, splitSeekB = false, splitTgtB = null;
  function updateSplitLeft() {   // last frame before the seam = frame @ outT (B tail end)
    const v = env.clip.prevVideo; if (!v) return;
    splitTgtA = env.clip.trim.outT * (v.duration || 1);
    if (splitSeekA) return; splitSeekA = true;
    (async () => { try { while (splitTgtA != null) { const t = splitTgtA; splitTgtA = null; await seekVideoTo(v, t); drawFrameTo(v, byId('loopSplitA')); } } finally { splitSeekA = false; } })();
  }
  function updateSplitRight() {   // first frame after the seam = frame @ inT (A head start)
    const v = env.clip.prevVideoB; if (!v) return;
    splitTgtB = env.clip.trim.inT * (v.duration || 1);
    if (splitSeekB) return; splitSeekB = true;
    (async () => { try { while (splitTgtB != null) { const t = splitTgtB; splitTgtB = null; await seekVideoTo(v, t); drawFrameTo(v, byId('loopSplitB')); } } finally { splitSeekB = false; } })();
  }
  function enterSplitStage() {
    const split = byId('loopSplit'); if (!split) return;
    stopClipPreview();
    const video = byId('clipVideo'); if (video) video.style.visibility = 'hidden';
    const blend = byId('clipBlend'); if (blend) blend.hidden = true;
    split.hidden = false;
    updateSplitLeft(); updateSplitRight();
  }
  function exitSplitStage() {
    const split = byId('loopSplit'); if (split) split.hidden = true;
    const video = byId('clipVideo'); if (video) video.style.visibility = '';
  }

  // ---- crossfade region on the bar + its contextual menu ----------------------
  function renderXfadeRegion() {
    const region = byId('clipXfadeRegion'); if (!region) return;
    const trim = env.clip.trim;
    const d = (env.clip.prevVideo && env.clip.prevVideo.duration) || 1;
    const range = trim.outT - trim.inT;
    const outA = trim.outT * d, inA = trim.inT * d, cut = (trim.inT + trim.slicePoint * range) * d;
    const cfSec = Math.max(0, Math.min(trim.crossfadeMs / 1000, (outA - cut) * 0.9, (cut - inA) * 0.9));
    const cfFrac = d ? cfSec / d : 0;
    region.style.left = ((trim.outT - cfFrac) * 100) + '%';
    region.style.width = (cfFrac * 100) + '%';
  }
  function showXfadeMenu() {
    const menu = byId('clipXfadeMenu'), region = byId('clipXfadeRegion');
    if (!menu || !region) return;
    region.classList.add('selected');
    const r = region.getBoundingClientRect();
    menu.hidden = false;
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(8, r.top - menu.offsetHeight - 8) + 'px';
  }
  function hideXfadeMenu() {
    const menu = byId('clipXfadeMenu'); if (menu) menu.hidden = true;
    byId('clipXfadeRegion')?.classList.remove('selected');
  }
  const _even = (n) => Math.max(2, Math.round(n / 2) * 2);
  // Apply: trim-only modes commit directly (non-destructive); bounce/slice BAKE a new
  // processed clip (destructive — confirmed first).
  async function applyClip() {
    if (env.clip.baking) return;
    if (env.clip.trim.mode === 'forward') { closeClipEditor(true); return; }
    const ok = window.confirm(
      `“${env.clip.trim.mode}” bakes a new processed clip and replaces the working source. This is destructive ` +
      `(your original file on disk is untouched, and you can re-upload it). Continue?`);
    if (!ok) return;
    await bakeAndApply();
  }
  // Bake the trimmed clip into a seamless loop and swap it in as the source. Reuses the
  // video EXPORT encoder (exportVideo) with a frameAt that DECODES + assembles source
  // frames: bounce = forward-then-reverse source time (no blend); slice = B2. Decode is
  // seek-based (WebCodecs decode is the future speedup), so it's one-time + shows progress.
  async function bakeAndApply() {
    const trim = env.clip.trim;
    const src = env.sourceVideo;
    if (!src) return;
    const decodeV = env.clip.prevVideo || src;
    env.clip.baking = true;
    stopClipPreview();
    const dur = decodeV.duration || src.duration || 1;
    const w = _even(src.videoWidth), h = _even(src.videoHeight);
    const cap = document.createElement('canvas'); cap.width = w; cap.height = h;
    const cctx = cap.getContext('2d');
    const fps = 30;                                 // bake fps (source-fps estimation = backlog item)
    const range = trim.outT - trim.inT, trimmedSec = range * dur;
    let durationMs, frameAt;
    // slice crossfade uses TWO monotonic readers over the same file (below); declared
    // here so the finally can close them.
    let sliceReaderA = null, sliceReaderB = null;
    if (trim.mode === 'bounce') {
      durationMs = Math.max(200, trimmedSec * 2 * 1000);   // forward + reverse
      frameAt = async (p) => {
        const q = 1 - Math.abs(1 - 2 * p);          // 0→1→0 ping-pong over the trimmed range
        await seekVideoTo(decodeV, (trim.inT + q * range) * dur);
        cctx.drawImage(decodeV, 0, 0, w, h);
        return cap;
      };
    } else if (trim.mode === 'slice') {
      // Slice: rearrange the trimmed clip [inA,outA] as B(=[cut,outA]) then A(=[inA,cut])
      // — the loop point (A end = B start = cut) is continuous; the B→A SEAM is crossfaded
      // by overlapping B's tail with A's head (the FCP technique), which shortens the loop
      // by the crossfade length.
      const inA = trim.inT * dur, outA = trim.outT * dur;
      const cut = (trim.inT + trim.slicePoint * range) * dur;
      const Bdur = outA - cut, Adur = cut - inA;
      const cfSec = Math.max(0, Math.min(trim.crossfadeMs / 1000, Bdur * 0.9, Adur * 0.9));
      const outDur = (outA - inA) - cfSec;
      const bEnd = Bdur - cfSec;                     // pure-B until here (output seconds)
      durationMs = Math.max(200, outDur * 1000);

      // TWO monotonic readers over the same file — one per segment. B covers [cut,outA]
      // as output time t goes 0→Bdur; A covers [inA,cut] as t goes bEnd→outDur — each
      // advances FORWARD ONLY within its own segment. This fixes the crossfade drop-frame
      // (a fading-OUT frame popping back at full opacity): the single-reader path seeks one
      // occluded <video> B-tail→A-head→B-tail every frame, and an occluded decoder that
      // hasn't caught up presents a STALE frame at full alpha. Monotonic readers return
      // deterministically-correct frames with no keyframe re-decode thrash — correctness
      // AND speed. Falls back to the single-element seek path when the readers can't arm.
      const url = decodeV.currentSrc || decodeV.src || env.media.sourceVideoUrl;
      try {
        sliceReaderB = await createSequentialFrameReader(url);
        sliceReaderA = sliceReaderB ? await createSequentialFrameReader(url) : null;
      } catch { sliceReaderA = sliceReaderB = null; }
      if (sliceReaderB && !sliceReaderA) { sliceReaderB.close(); sliceReaderB = null; }

      if (sliceReaderA && sliceReaderB) {
        frameAt = async (p) => {
          const t = p * outDur;
          if (t < bEnd) {                            // pure B
            cctx.globalAlpha = 1; cctx.drawImage(await sliceReaderB.frameAt(cut + t), 0, 0, w, h);
          } else if (t < Bdur) {                     // crossfade: B tail dissolves into A head
            const alpha = cfSec > 0 ? (t - bEnd) / cfSec : 1;
            cctx.globalAlpha = 1; cctx.drawImage(await sliceReaderB.frameAt(cut + t), 0, 0, w, h);
            cctx.globalAlpha = alpha; cctx.drawImage(await sliceReaderA.frameAt(inA + (t - bEnd)), 0, 0, w, h);
            cctx.globalAlpha = 1;
          } else {                                   // pure A
            cctx.globalAlpha = 1; cctx.drawImage(await sliceReaderA.frameAt(inA + (t - bEnd)), 0, 0, w, h);
          }
          return cap;
        };
      } else {
        // fallback: the proven single-element seek path (backward jumps re-decode per
        // frame, correct but slower and prone to the stale-frame pop above)
        frameAt = async (p) => {
          const t = p * outDur;
          if (t < bEnd) {                            // pure B
            await seekVideoTo(decodeV, cut + t);
            cctx.globalAlpha = 1; cctx.drawImage(decodeV, 0, 0, w, h);
          } else if (t < Bdur) {                     // crossfade: B tail dissolves into A head
            const alpha = cfSec > 0 ? (t - bEnd) / cfSec : 1;
            await seekVideoTo(decodeV, cut + t);       // B tail (outA-cfSec → outA)
            cctx.globalAlpha = 1; cctx.drawImage(decodeV, 0, 0, w, h);
            await seekVideoTo(decodeV, inA + (t - bEnd));   // A head (inA → inA+cfSec)
            cctx.globalAlpha = alpha; cctx.drawImage(decodeV, 0, 0, w, h); cctx.globalAlpha = 1;
          } else {                                   // pure A
            await seekVideoTo(decodeV, inA + (t - bEnd));
            cctx.globalAlpha = 1; cctx.drawImage(decodeV, 0, 0, w, h);
          }
          return cap;
        };
      }
    } else { env.clip.baking = false; return; }

    const prog = document.getElementById('clipProgress'), fill = document.getElementById('clipBarFill');
    const apply = document.getElementById('clipApply'), cover = document.getElementById('clipBaking');
    if (prog) prog.hidden = false;
    if (cover) cover.hidden = false;                 // hide the seeking/decoding flicker behind a "baking…" cover
    if (apply) { apply.disabled = true; apply.textContent = 'baking…'; }
    try {
      const { blob } = await exportVideo({
        frameAt, width: w, height: h, fps, durationMs, captureMode: '2d',
        onProgress: (x) => { if (fill) fill.style.width = Math.round(x * 100) + '%'; },
      });
      await applyBakedClip(blob);                   // swaps the source + re-binds the timeline
      disposeClipPreview();
      env.clip.backup = null;
      // keep the sheet up with the next-step nudge (render/save · motion · perform)
      // instead of just vanishing — the friendly "you baked a loop, now what" moment
      const nudge = document.getElementById('clipNudge'); if (nudge) nudge.hidden = false;
    } catch (e) {
      console.error('clip bake failed', e);
      alert('Could not bake the clip: ' + (e && e.message ? e.message : e));
    } finally {
      if (sliceReaderA) { try { sliceReaderA.close(); } catch { /* already closed */ } sliceReaderA = null; }
      if (sliceReaderB) { try { sliceReaderB.close(); } catch { /* already closed */ } sliceReaderB = null; }
      if (prog) prog.hidden = true;
      if (fill) fill.style.width = '0%';
      if (cover) cover.hidden = true;
      if (apply) { apply.disabled = false; }
      setClipMode(env.clip.trim.mode);               // restore the apply label
      env.clip.baking = false;
    }
  }
  // Swap a freshly-baked clip in as the working source (keeps the uploaded original in
  // `env.media.originalSource` for the export package). Resets the trim (the baked clip
  // IS the processed clip) and re-binds the motion timeline.
  async function applyBakedClip(blob) {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.loop = true; v.preload = 'auto';
    v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
    await new Promise((res, rej) => {
      v.addEventListener('loadeddata', () => res(), { once: true });
      v.addEventListener('error', () => rej(new Error('the baked clip failed to load')), { once: true });
      v.src = url;
    });
    env.stopSourceVideoPlayback();
    const old = env.sourceVideo;
    engine.setSource(v);
    env.sourceVideo = v;
    if (env.media.sourceVideoUrl) URL.revokeObjectURL(env.media.sourceVideoUrl);   // free the previous source URL (original File kept in env.media.originalSource)
    env.media.sourceVideoUrl = url;
    if (old) { try { old.pause(); old.removeAttribute('src'); old.load(); } catch { /* ignore */ } }
    env.clip.trim.inT = 0; env.clip.trim.outT = 1; env.clip.trim.mode = 'forward';        // the baked clip is the full processed clip
    const meta = document.getElementById('sourceMeta');
    if (meta) meta.children[0].textContent = `${v.videoWidth} × ${v.videoHeight}`;
    env.arrangeSlots();
    rebindClipToTimeline();
  }

  // dismiss the post-bake nudge and close the mode (the nudge actions call this
  // before switching modes / opening the export sheet).
  function closeLoopBuilderNudge() { hideLoopSurface(); }

  // SPACE = play/pause the preview (not "commit to bake"). Capture-phase so it beats the
  // focused primary button's default space-activation. No-op on the crossfade step (the
  // split-stage shows static seam frames, nothing to play).
  document.addEventListener('keydown', (e) => {
    if (!document.body.classList.contains('loop-active')) return;
    if (e.code !== 'Space' && e.key !== ' ') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault(); e.stopPropagation();
    if (env.clip.raf) stopClipPreview();
    else if (env.clip.step !== 4 && env.clip.prevVideo) startClipPreview(false);
  }, true);

  // set the crossfade (steppers / contextual menu / step-4 scrub), keeping the region
  // + both value displays live
  function setCrossfadeSec(sec) {
    env.clip.trim.crossfadeMs = Math.max(0, Math.min(3, sec)) * 1000;
    renderXfadeRegion();
    const v = (env.clip.trim.crossfadeMs / 1000).toFixed(2) + 's';
    const a = document.getElementById('clipXfade'); if (a) a.textContent = v;
    const b = document.getElementById('clipXfadeCtx'); if (b) b.textContent = v;
  }

  // Public surface used by the chrome's motion-footer wiring.
  env.openClipEditor = openClipEditor;
  env.closeLoopBuilderNudge = closeLoopBuilderNudge;
  env.closeClipEditor = closeClipEditor;
  env.applyClip = applyClip;
  env.setClipMode = setClipMode;
  env.makeClipHandle = makeClipHandle;
  env.clipSeekTo = clipSeekTo;
  env.startClipPreview = startClipPreview;
  env.stopClipPreview = stopClipPreview;
  // stepped Loop Builder flow
  env.loopPrimaryAction = loopPrimaryAction;
  env.loopBack = goBack;
  env.chooseBehavior = chooseBehavior;
  env.jumpToStep = jumpToStep;
  env.showXfadeMenu = showXfadeMenu;
  env.hideXfadeMenu = hideXfadeMenu;
  env.setCrossfadeSec = setCrossfadeSec;
  env.getCrossfadeSec = () => env.clip.trim.crossfadeMs / 1000;
  env.exitLoopBuilder = exitLoopBuilder;   // the mode picker + upload route here
  env.loopIsActive = () => document.body.classList.contains('loop-active');
}
