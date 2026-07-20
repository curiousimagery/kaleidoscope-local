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
import { createSequentialFrameReader, probeVideoInfo } from './video-decode.js';

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
    env.clip.fmt = { res: 'source', fps: 'source', speed: 1 };   // fresh output format per clip
    env.clip.srcFps = 0;                                          // re-probe the source fps for this clip
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
    // a THIRD hidden video used only for building the thumbnail strip — seeking it never
    // disturbs the visible stage preview (fixes the "plays through the clip on load" tell)
    // and never fights the scrubber's seeks on the shared element (the scrub reliability bug).
    const vT = document.createElement('video');
    vT.muted = true; vT.playsInline = true; vT.loop = false; vT.preload = 'auto';
    vT.setAttribute('playsinline', ''); vT.setAttribute('muted', '');
    vT.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    vT.src = env.media.sourceVideoUrl;
    (document.querySelector('.clip-stage') || sheet).appendChild(vT);
    env.clip.thumbVideo = vT;
    const nudge = document.getElementById('clipNudge'); if (nudge) nudge.hidden = true;   // clear any prior post-bake nudge
    // enter the mode: the surface sits BELOW the global app bar (which stays visible +
    // gated), and the mode picker reflects "loop builder" as the active mode
    document.body.classList.add('loop-active');
    const bar = document.getElementById('outputToolbar');
    sheet.style.top = bar ? Math.round(bar.getBoundingClientRect().bottom) + 'px' : '0px';
    const ms = document.getElementById('modeSelect'); if (ms) ms.value = 'loop';
    sheet.hidden = false;
    lastThumbMode = null;   // force a fresh thumbnail build for this clip
    const init = () => { env.clip.step = 1; setClipMode(env.clip.trim.mode); setLoopStep(1); };
    if (pv.readyState >= 1) init(); else pv.addEventListener('loadedmetadata', init, { once: true });
  }
  function disposeClipPreview() {
    stopClipPreview();
    exitSplitStage();   // restore the stage video's visibility if we tore down on the crossfade step
    const blend = document.getElementById('clipBlend'); if (blend) blend.hidden = true;
    if (env.clip.prevVideo) { try { env.clip.prevVideo.pause(); } catch { /* ignore */ } env.clip.prevVideo.removeAttribute('src'); try { env.clip.prevVideo.load(); } catch { /* ignore */ } env.clip.prevVideo = null; }
    if (env.clip.prevVideoB) { try { env.clip.prevVideoB.pause(); } catch { /* ignore */ } env.clip.prevVideoB.removeAttribute('src'); try { env.clip.prevVideoB.load(); } catch { /* ignore */ } env.clip.prevVideoB.remove(); env.clip.prevVideoB = null; }
    if (env.clip.thumbVideo) { try { env.clip.thumbVideo.pause(); } catch { /* ignore */ } env.clip.thumbVideo.removeAttribute('src'); try { env.clip.thumbVideo.load(); } catch { /* ignore */ } env.clip.thumbVideo.remove(); env.clip.thumbVideo = null; }
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
        setPlayheadFrac(mediaToBarFrac(v.currentTime));
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
      setPlayheadFrac(mediaToBarFrac(v.currentTime));
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
    else {
      // resuming (e.g. space after a scrub): derive the phase from where the video actually is,
      // so a currentTime that landed in the A segment doesn't play back under a stale 'B' phase
      // (which snapped the loop back to the start). B = [cut,outA], A = [inA,cut].
      const { inA, cut } = sliceTimes();
      env.clip.phase = (v.currentTime >= cut - 0.01) ? 'B' : (v.currentTime >= inA - 0.01 ? 'A' : 'B');
      if (blend) blend.hidden = true;
    }
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
      setPlayheadFrac(mediaToBarFrac(v.currentTime));
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
    let pushed = false;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); el.setPointerCapture?.(e.pointerId);
      env.clip.drag = which; pushed = false;          // history pushes on the first actual move (a bare tap isn't an edit)
      stopClipPreview();                              // hold playback while scrubbing the handle
    });
    el.addEventListener('pointermove', (e) => {
      if (env.clip.drag !== which) return;
      if (!pushed) { env.pushHistory?.(); env.updateUndoUI?.(); pushed = true; }   // one undo step per trim/slice drag (pre-drag trim)
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
      clipSeekTo(handleT);                            // coalesced seek (no decoder flood) — shows the frame under the handle
      setPlayheadFrac(handleT);
    });
    const up = (e) => {
      if (env.clip.drag !== which) return;
      env.clip.drag = null; el.releasePointerCapture?.(e.pointerId);
      env.updateUndoUI?.();
      startClipPreview();
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
  // The Loop Builder walks Trim & behavior → [Slice point → Crossfade] → Bake. Step 1 combines
  // trimming and the loop-behavior choice; the slice-only steps (3,4) drop out for the others.
  // (Internal step ids stay 1/3/4/5 — step 2 was merged into step 1 — so the resequence/preview
  //  semantics at 4/5 are untouched; the rail relabels display numbers sequentially.)
  function stepSeq() {
    const m = env.clip.trim.mode;
    if (m === 'slice') return [1, 3, 4, 5];
    if (m === 'bounce') return [1, 5];
    return [1];   // forward (trim only) — step 1 applies the trim
  }
  function loopModeLabel() { return env.clip.trim.mode === 'slice' ? 'loop' : env.clip.trim.mode; }
  // the primary button names the CURRENT step's action (what clicking applies), not the next.
  function stepActionLabel(step) {
    switch (step) {
      case 1: return 'trim & loop';
      case 3: return 'set slice point';
      case 4: return 'set crossfade';
      default: return 'next';
    }
  }
  function updateRail() {
    const seq = stepSeq(), step = env.clip.step;
    byId('clipSheet')?.querySelectorAll('.loop-step').forEach((b) => {
      const s = +b.dataset.step, inSeq = seq.includes(s);
      b.hidden = !inSeq;                        // slice steps drop for non-slice; step 5 drops for forward
      b.disabled = !inSeq;
      b.classList.toggle('active', s === step);
      b.classList.toggle('done', inSeq && seq.indexOf(s) < seq.indexOf(step));
      if (inSeq) { const num = b.querySelector('b'); if (num) num.textContent = seq.indexOf(s) + 1; }   // sequential display number
    });
  }
  function loopPrimary() {
    const seq = stepSeq(), i = seq.indexOf(env.clip.step), isLast = i === seq.length - 1;
    const apply = byId('clipApply'); if (!apply) return;
    apply.textContent = isLast
      ? (env.clip.trim.mode === 'forward' ? 'apply trim' : `bake ${loopModeLabel()}`)
      : stepActionLabel(env.clip.step) + ' ›';
    apply.dataset.terminal = isLast ? '1' : '';
  }
  let lastThumbMode = null;
  function setLoopStep(n) {
    env.clip.step = n;
    const sheet = byId('clipSheet');
    sheet?.querySelectorAll('.loop-panel').forEach((p) => { p.hidden = +p.dataset.panel !== n; });
    const slice = env.clip.trim.mode === 'slice';
    const resequence = slice && (n === 4 || n === 5);   // crossfade AND bake preview show the reordered loop
    const preview = n === 5;                             // bake step is preview-only (no editing handles)
    // linear handles: cut ONLY on the slice-point step (3); in/out on the trim steps, hidden on
    // the resequenced steps (slice point becomes non-editable end markers) and the preview step
    const inEl = byId('clipIn'), outEl = byId('clipOut'), cutEl = byId('clipCut');
    if (inEl) inEl.hidden = resequence || preview;
    if (outEl) outEl.hidden = resequence || preview;
    if (cutEl) cutEl.hidden = !(slice && n === 3);
    const L = byId('clipSliceL'), R = byId('clipSliceR');
    if (L) L.hidden = !resequence;
    if (R) R.hidden = !resequence;
    const linRegion = byId('clipRegion'); if (linRegion) linRegion.style.display = (resequence || preview) ? 'none' : '';
    const xregion = byId('clipXfadeRegion');
    if (xregion) { xregion.hidden = !resequence; xregion.classList.toggle('static', preview); }   // draggable only on the crossfade step
    // the trim duration readout sits under the clip while trimming (step 1 + slice-point), hidden on the resequenced / preview steps
    const dur = byId('clipDur'); if (dur) dur.hidden = resequence || preview;
    // the crossfade step is now a LIVE preview (play/scrub), not a static split-stage —
    // start the mode-appropriate preview on every step
    exitSplitStage();
    if (env.clip.prevVideo && !env.clip.raf && !env.clip.drag) startClipPreview();
    // rebuild the strip only when the shown VIEW changes (full clip ↔ resequenced ↔ trimmed) —
    // a seek-heavy build shouldn't run on every next/back
    const thumbMode = resequence ? 'reseq' : (preview ? 'trimmed' : 'full');
    if (thumbMode !== lastThumbMode) { lastThumbMode = thumbMode; buildLoopThumbs(); }
    if (n === 4 && slice) env.clip.sel = null;   // start unselected (crossfade is the focus) each time you enter
    if (resequence) renderResequenceOverlays();
    renderLoopSelection();   // hides the seam bar / highlight when off the crossfade step or unselected
    if (n === 5) syncFormatControls();           // populate the output-format spec on the bake step
    renderLoopRuler();
    const seq = stepSeq();
    const back = byId('loopBack'); if (back) back.hidden = seq.indexOf(n) <= 0;
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
  function chooseBehavior(mode) {
    if (mode === env.clip.trim.mode) return;   // re-picking the active behavior is a no-op (no undo step)
    env.pushHistory?.();                        // undoable: behavior changes which later steps exist
    setClipMode(mode); updateRail(); loopPrimary();
    env.updateUndoUI?.();
  }

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
    // the seam frames are populated by buildLoopThumbs's resequence seek pass (so a
    // second seek loop never fights it on the same <video>)
  }
  function exitSplitStage() {
    const split = byId('loopSplit'); if (split) split.hidden = true;
    const video = byId('clipVideo'); if (video) video.style.visibility = '';
  }

  // ---- footage thumbnail strip + ruler (the motion-style timeline) ------------
  // Seeks the preview video across the range and paints raw FOOTAGE frames into cells
  // (Loop Builder shows the source clip, not the folded output). Linear across [0,dur]
  // for the trim steps; on the crossfade step it RESEQUENCES to B([cut,out]) then a seam
  // gap then A([in,cut]) so the loop order reads left→right with the crossfade in the
  // middle. Single-flight + cancellable (thumbGen); footage restored + preview resumed.
  let thumbGen = 0;
  async function buildLoopThumbs() {
    const strip = byId('loopThumbs'), track = byId('clipBar');
    // Seeks the DEDICATED hidden thumb video — never the visible stage preview — so the
    // strip builds silently (no visible playthrough) and never fights the scrubber's seeks.
    const vt = env.clip.thumbVideo, vp = env.clip.prevVideo;
    if (!strip || !track || !vt || !vp) return;
    if (!vt.videoWidth || !vt.duration) {   // thumb video not ready yet — retry when it is
      vt.addEventListener('loadeddata', () => buildLoopThumbs(), { once: true });
      return;
    }
    const gen = ++thumbGen;
    const resequence = isResequenced();
    const trackH = track.clientHeight || 76, trackW = track.clientWidth || 600;
    const aspect = vt.videoWidth / vt.videoHeight;
    const approxCell = Math.max(28, Math.round(trackH * aspect));
    const drawW = Math.min(200, vt.videoWidth), drawH = Math.max(1, Math.round(drawW / aspect));
    const cell = async (mediaT, w) => {
      await seekVideoTo(vt, Math.max(0, Math.min(vt.duration, mediaT)));
      if (gen !== thumbGen) return null;
      const c = document.createElement('canvas'); c.width = drawW; c.height = drawH;
      c.getContext('2d').drawImage(vt, 0, 0, drawW, drawH);
      c.style.width = w + 'px';
      return c;
    };
    const out = [], d = vt.duration, trim = env.clip.trim, range = trim.outT - trim.inT;
    if (resequence) {
      // B [cut,outA] and A [inA,cut] fill the track PROPORTIONALLY to their real durations,
      // so the seam sits at its true position (a 90/10 slice reads 90/10, not 50/50) and the
      // whole strip is one uniform time-scale.
      const g = reseqGeom();
      const bW = g.seam * trackW, aW = (1 - g.seam) * trackW;
      const bCells = Math.max(1, Math.round(bW / approxCell)), aCells = Math.max(1, Math.round(aW / approxCell));
      const bCellW = bW / bCells, aCellW = aW / aCells;
      for (let i = 0; i < bCells; i++) { const c = await cell(g.cut + (g.outA - g.cut) * (i + 0.5) / bCells, bCellW); if (gen !== thumbGen) return; if (c) out.push(c); }
      for (let i = 0; i < aCells; i++) { const c = await cell(g.inA + (g.cut - g.inA) * (i + 0.5) / aCells, aCellW); if (gen !== thumbGen) return; if (c) out.push(c); }
      // keep the split-stage seam pair current (shown WHILE dragging a crossfade seam edge):
      // last frame before the seam (@outA, B tail) | first frame after (@inA, A head)
      await seekVideoTo(vt, Math.max(0, Math.min(d, g.outA))); if (gen !== thumbGen) return; drawFrameTo(vt, byId('loopSplitA'));
      await seekVideoTo(vt, Math.max(0, Math.min(d, g.inA))); if (gen !== thumbGen) return; drawFrameTo(vt, byId('loopSplitB'));
    } else {
      // linear over the shown range: full clip for the trim steps; the TRIMMED range on the
      // bake-preview step (step 5) so it shows only what bakes, not the cut-off head/tail.
      const a = env.clip.step === 5 ? trim.inT * d : 0, b = env.clip.step === 5 ? trim.outT * d : d;
      const n = Math.max(4, Math.ceil(trackW / approxCell) + 1);
      for (let i = 0; i < n; i++) { const c = await cell(a + (b - a) * (i + 0.5) / n, approxCell); if (gen !== thumbGen) return; if (c) out.push(c); }
    }
    if (gen !== thumbGen) return;
    strip.replaceChildren(...out);
  }
  function renderLoopRuler() {
    const ruler = byId('loopRuler'), v = env.clip.prevVideo;
    if (!ruler) return;
    ruler.innerHTML = '';
    const d = (v && v.duration) || 0, w = ruler.clientWidth;
    if (!(d > 0) || w < 2) return;
    const target = Math.max(2, Math.floor(w / 90));
    const nice = [0.5, 1, 2, 5, 10, 15, 30, 60, 120];
    const step = nice.find((s) => d / s <= target) ?? Math.ceil(d / target);
    const frag = document.createDocumentFragment();
    for (let t = 0; t <= d + 1e-6; t += step) {
      const pct = (t / d) * 100;
      const tick = document.createElement('div'); tick.className = 'loop-tick'; tick.style.left = pct + '%'; frag.appendChild(tick);
      if ((d - t) > step * 0.4 || t === 0) {
        const lab = document.createElement('div'); lab.className = 'loop-tick-label'; lab.style.left = pct + '%';
        lab.textContent = env.fmtClock ? env.fmtClock(t) : t.toFixed(1) + 's'; frag.appendChild(lab);
      }
    }
    ruler.appendChild(frag);
  }
  // Resequenced-view geometry (slice, steps 4/5). B = [cut,outA] and A = [inA,cut] are laid
  // out PROPORTIONALLY to their real durations (honest — a 90/10 slice reads 90/10, not 50/50),
  // so the whole strip is a single uniform time-scale and the seam sits at its true position.
  // The crossfade overlaps cfSec of B's tail + cfSec of A's head, so it's a symmetric band of
  // half-width cfFrac centered on the seam. maxCf caps it at 90% of the shorter segment.
  function reseqGeom() {
    const v = env.clip.prevVideo, d = (v && v.duration) || 1, trim = env.clip.trim, range = trim.outT - trim.inT;
    const inA = trim.inT * d, outA = trim.outT * d, cut = (trim.inT + trim.slicePoint * range) * d;
    const Bdur = Math.max(1e-4, outA - cut), Adur = Math.max(1e-4, cut - inA), total = Bdur + Adur;
    const seam = Bdur / total;
    const maxCf = Math.min(Bdur * 0.9, Adur * 0.9, 3);
    const cfSec = Math.max(0, Math.min(trim.crossfadeMs / 1000, maxCf));
    return { d, inA, outA, cut, Bdur, Adur, total, seam, cfSec, cfFrac: cfSec / total, maxCf };
  }
  // Does the timeline show the RESEQUENCED loop (B→A) at this step? (crossfade + bake steps, slice mode)
  function isResequenced() { return env.clip.trim.mode === 'slice' && (env.clip.step === 4 || env.clip.step === 5); }
  // Map a track fraction [0,1] → a SOURCE media time, honoring what the strip currently shows:
  // full clip (trim steps) · trimmed range (bake preview of a non-slice loop) · resequenced B→A.
  function barFracToMedia(frac) {
    const v = env.clip.prevVideo, d = (v && v.duration) || 1, trim = env.clip.trim, range = trim.outT - trim.inT;
    frac = Math.max(0, Math.min(1, frac));
    if (isResequenced()) {
      const g = reseqGeom();
      return frac < g.seam ? g.cut + (g.outA - g.cut) * (frac / g.seam)
                           : g.inA + (g.cut - g.inA) * ((frac - g.seam) / (1 - g.seam));
    }
    if (env.clip.step === 5) return (trim.inT + frac * range) * d;   // trimmed-range preview
    return frac * d;                                                 // full clip
  }
  // Inverse: a source media time → the track fraction for the current view (drives the playhead
  // during playback, where currentTime advances in source time but the strip is reordered).
  function mediaToBarFrac(mediaT) {
    const v = env.clip.prevVideo, d = (v && v.duration) || 1, trim = env.clip.trim, range = trim.outT - trim.inT;
    if (isResequenced()) {
      const g = reseqGeom();
      if (mediaT >= g.cut - 1e-3) return Math.min(g.seam, g.seam * (mediaT - g.cut) / g.Bdur);       // B → [0,seam]
      return g.seam + Math.min(1 - g.seam, (1 - g.seam) * (mediaT - g.inA) / g.Adur);                 // A → [seam,1]
    }
    if (env.clip.step === 5) return range ? Math.max(0, Math.min(1, (mediaT / d - trim.inT) / range)) : 0;
    return mediaT / d;
  }
  const setPlayheadFrac = (frac) => { const ph = byId('clipPlayhead'); if (ph) ph.style.left = (frac * 100) + '%'; };

  // Scrub to a track fraction, showing the REAL frame under the cursor. On the resequenced
  // steps, when the cursor is inside the dissolve zone we blend B's tail into A's head at the
  // crossfade alpha (so scrubbing the crossfade previews the actual dissolve, not just A or B);
  // elsewhere it's a single coalesced seek. Coalesced (latest target wins) so a fast drag
  // never floods the two decoders.
  let scrubBusy = false, scrubTgt = null;
  function clipScrubToFrac(frac) {
    scrubTgt = frac;
    if (scrubBusy) return;
    scrubBusy = true;
    (async () => {
      try { while (scrubTgt != null) { const f = scrubTgt; scrubTgt = null; await doScrub(f); } }
      finally { scrubBusy = false; }
    })();
  }
  async function doScrub(frac) {
    const v = env.clip.prevVideo, vB = env.clip.prevVideoB, blend = byId('clipBlend');
    if (!v) return;
    const d = v.duration || 1, range = env.clip.trim.outT - env.clip.trim.inT;
    if (isResequenced() && range > 0) {
      const g = reseqGeom();
      const leftFrac = g.seam - g.cfFrac, rightFrac = g.seam + g.cfFrac;   // symmetric band around the true seam
      if (g.cfSec > 0 && frac >= leftFrac && frac <= rightFrac && vB) {
        const cf = rightFrac > leftFrac ? (frac - leftFrac) / (rightFrac - leftFrac) : 1;   // 0→1 across the dissolve
        const bT = g.outA - g.cfSec * (1 - cf), aT = g.inA + g.cfSec * cf;   // B tail time | A head time
        try { vB.pause(); } catch { /* ignore */ }   // in case a prior crossfade preview left it playing
        await Promise.all([seekVideoTo(v, Math.max(0, Math.min(d, bT))), seekVideoTo(vB, Math.max(0, Math.min(d, aT)))]);
        if (blend) blend.hidden = false;
        drawTwoVideoBlend(cf);
        return;
      }
    }
    if (blend) blend.hidden = true;
    await seekVideoTo(v, Math.max(0, Math.min(d, barFracToMedia(frac))));
  }
  // step 4 overlays: crossfade region straddling the seam, non-editable slice markers
  // at both ends. (Linear handles hide on step 4 — see setLoopStep.) The strip lays B and
  // A in exactly-equal halves (buildLoopThumbs), so the seam sits at a true 50%. The
  // crossfade is NOT symmetric in pixels: it overlaps cfSec of B's tail (B's time-scale)
  // on the left and cfSec of A's head (A's scale) on the right — so each edge is placed
  // from its own segment's duration. This is the honest geometry the seam drag reads/writes.
  function renderResequenceOverlays() {
    const region = byId('clipXfadeRegion'), L = byId('clipSliceL'), R = byId('clipSliceR');
    if (L) L.hidden = false;
    if (R) R.hidden = false;
    if (!region) return;
    const g = reseqGeom();   // uniform scale → the band is symmetric around the true seam
    region.style.left = ((g.seam - g.cfFrac) * 100) + '%';
    region.style.width = (2 * g.cfFrac * 100) + '%';
    region.hidden = false;
    const bar = byId('clipSeamBar'); if (bar) bar.style.left = (g.seam * 100) + '%';   // endpoint bar at the seam
    renderLoopSelection();
  }
  // The crossfade band is always the prominent, directly-draggable control. A clip can also
  // be SELECTED (sel = 'B' | 'A' | null) — its endpoint bar (at the seam, extending below the
  // track) + a highlight under the timeline appear so you can drag its edge.
  function renderLoopSelection() {
    const step4 = env.clip.step === 4 && env.clip.trim.mode === 'slice';
    const sel = env.clip.sel;   // 'B' | 'A' | null
    const active = step4 && (sel === 'B' || sel === 'A');
    const bar = byId('clipSeamBar'), hi = byId('clipSelHi');
    if (bar) { bar.hidden = !active; if (active) bar.style.left = (reseqGeom().seam * 100) + '%'; }
    if (hi) {
      if (active) {
        const g = reseqGeom();
        hi.hidden = false;
        hi.style.left = (sel === 'B' ? 0 : g.seam * 100) + '%';
        hi.style.width = ((sel === 'B' ? g.seam : 1 - g.seam) * 100) + '%';
      } else hi.hidden = true;
    }
  }
  // A TAP on the crossfade timeline: tapping the left/right clip body selects it (or toggles
  // it off if already selected); tapping the crossfade band deselects. (The endpoint bar +
  // crossfade edges are their own drag targets, excluded from the tap handler.)
  function selectLoopEntity(frac) {
    if (!(env.clip.step === 4 && env.clip.trim.mode === 'slice')) return;
    const g = reseqGeom();
    const inBand = frac >= g.seam - g.cfFrac && frac <= g.seam + g.cfFrac;
    if (inBand) env.clip.sel = null;                                    // tap the crossfade → deselect
    else { const clicked = frac < g.seam ? 'B' : 'A'; env.clip.sel = env.clip.sel === clicked ? null : clicked; }
    renderLoopSelection();
  }

  // ---- crossfade region on the bar + its contextual menu ----------------------
  function renderXfadeRegion() {
    const region = byId('clipXfadeRegion'); if (!region) return;
    if (isResequenced()) { renderResequenceOverlays(); return; }   // resequenced steps own the region
    const trim = env.clip.trim;
    const d = (env.clip.prevVideo && env.clip.prevVideo.duration) || 1;
    const range = trim.outT - trim.inT;
    const outA = trim.outT * d, inA = trim.inT * d, cut = (trim.inT + trim.slicePoint * range) * d;
    const cfSec = Math.max(0, Math.min(trim.crossfadeMs / 1000, (outA - cut) * 0.9, (cut - inA) * 0.9));
    const cfFrac = d ? cfSec / d : 0;
    region.style.left = ((trim.outT - cfFrac) * 100) + '%';
    region.style.width = (cfFrac * 100) + '%';
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
    const { w, h } = bakeDims();                     // output resolution (source, or downscaled per the format control)
    const cap = document.createElement('canvas'); cap.width = w; cap.height = h;
    const cctx = cap.getContext('2d');
    let fps = 30;                                   // bake fps — refined from the measured source fps below
    let bakeRot = 0;                                // rotation to apply to DECODED (reader) frames — see below
    // Draw a WebCodecs frame into the output canvas, applying the container rotation the
    // decoder didn't (portrait iPhone clips decode landscape + 90°). Preserves globalAlpha.
    const drawRF = (frame) => {
      if (!bakeRot) { cctx.drawImage(frame, 0, 0, w, h); return; }
      const fw = frame.displayWidth || frame.codedWidth || w, fh = frame.displayHeight || frame.codedHeight || h;
      cctx.save(); cctx.translate(w / 2, h / 2); cctx.rotate(bakeRot * Math.PI / 180);
      cctx.drawImage(frame, -fw / 2, -fh / 2, fw, fh); cctx.restore();
    };
    const range = trim.outT - trim.inT, trimmedSec = range * dur;
    const url = decodeV.currentSrc || decodeV.src || env.media.sourceVideoUrl;
    let durationMs, frameAt;
    // WebCodecs readers over the same file (below); declared here so the finally can close them.
    let sliceReaderA = null, sliceReaderB = null, bounceReader = null;
    if (trim.mode === 'bounce') {
      durationMs = Math.max(200, trimmedSec * 2 * 1000);   // forward + reverse
      // Fast decode: a monotonic reader serves the forward half at speed; the reverse half
      // still pays a keyframe re-decode per frame (GOP-reverse buffering is the deeper win,
      // filed), but through WebCodecs rather than <video> seeks. Falls back to element seeks.
      try { bounceReader = await createSequentialFrameReader(url); } catch { bounceReader = null; }
      if (bounceReader && bounceReader.fps) fps = bounceReader.fps;
      if (bounceReader) bakeRot = bounceReader.rotation || 0;
      if (bounceReader) {
        frameAt = async (p) => {
          const q = 1 - Math.abs(1 - 2 * p);        // 0→1→0 ping-pong over the trimmed range
          drawRF(await bounceReader.frameAt((trim.inT + q * range) * dur));
          return cap;
        };
      } else {
        frameAt = async (p) => {
          const q = 1 - Math.abs(1 - 2 * p);
          await seekVideoTo(decodeV, (trim.inT + q * range) * dur);
          cctx.drawImage(decodeV, 0, 0, w, h);
          return cap;
        };
      }
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
      try {
        sliceReaderB = await createSequentialFrameReader(url);
        sliceReaderA = sliceReaderB ? await createSequentialFrameReader(url) : null;
      } catch { sliceReaderA = sliceReaderB = null; }
      if (sliceReaderB && !sliceReaderA) { sliceReaderB.close(); sliceReaderB = null; }
      if (sliceReaderB && sliceReaderB.fps) fps = sliceReaderB.fps;
      if (sliceReaderB) bakeRot = sliceReaderB.rotation || 0;

      if (sliceReaderA && sliceReaderB) {
        frameAt = async (p) => {
          const t = p * outDur;
          if (t < bEnd) {                            // pure B
            cctx.globalAlpha = 1; drawRF(await sliceReaderB.frameAt(cut + t));
          } else if (t < Bdur) {                     // crossfade: B tail dissolves into A head
            const alpha = cfSec > 0 ? (t - bEnd) / cfSec : 1;
            cctx.globalAlpha = 1; drawRF(await sliceReaderB.frameAt(cut + t));
            cctx.globalAlpha = alpha; drawRF(await sliceReaderA.frameAt(inA + (t - bEnd)));
            cctx.globalAlpha = 1;
          } else {                                   // pure A
            cctx.globalAlpha = 1; drawRF(await sliceReaderA.frameAt(inA + (t - bEnd)));
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
    if (env.clip.fmt.fps !== 'source') fps = +env.clip.fmt.fps;   // fps: measured source rate, or the chosen override
    fps = Math.max(12, Math.min(60, Math.round(fps || 30)));
    durationMs = Math.max(200, durationMs / (env.clip.fmt.speed || 1));   // playback speed stretches the loop (slomo)

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
      // opinionated: drop straight into motion mode with the baked loop (Daniel's call —
      // the "what next?" interstitial is gone; motion is where you go from here)
      hideLoopSurface();
      document.getElementById('motionBtn')?.click();
      // the baked clip may change aspect (e.g. portrait) — relayout after the mode switch
      // settles so the source panel doesn't overlap the controls (Daniel's post-bake glitch)
      requestAnimationFrame(() => { env.arrangeSlots?.(); env.resizePreviewCanvas?.(); });
    } catch (e) {
      console.error('clip bake failed', e);
      alert('Could not bake the clip: ' + (e && e.message ? e.message : e));
    } finally {
      if (sliceReaderA) { try { sliceReaderA.close(); } catch { /* already closed */ } sliceReaderA = null; }
      if (sliceReaderB) { try { sliceReaderB.close(); } catch { /* already closed */ } sliceReaderB = null; }
      if (bounceReader) { try { bounceReader.close(); } catch { /* already closed */ } bounceReader = null; }
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
    else if (env.clip.prevVideo) startClipPreview(false);
  }, true);

  function syncCrossfadeDisplays() {
    const v = (env.clip.trim.crossfadeMs / 1000).toFixed(2) + 's';
    const a = byId('clipXfade'); if (a && !a._editing) a.textContent = v;
    const b = byId('clipXfadeCtx'); if (b && !b._editing) b.textContent = v;
  }
  // set the crossfade (steppers / contextual menu / step-4 scrub / seam drag), keeping
  // the region + both value displays live
  function setCrossfadeSec(sec) {
    env.clip.trim.crossfadeMs = Math.max(0, Math.min(3, sec)) * 1000;
    renderXfadeRegion();
    syncCrossfadeDisplays();
  }

  // transient white-on-black value readout, shown WHILE dragging the crossfade
  function showDragVal(text, clientX, clientY) {
    const el = byId('clipDragVal'); if (!el) return;
    el.textContent = text; el.hidden = false;
    el.style.left = clientX + 'px'; el.style.top = (clientY - 14) + 'px';
  }
  function hideDragVal() { const el = byId('clipDragVal'); if (el) el.hidden = true; }

  // Drag either edge of the crossfade region (step 4) to lengthen/shorten the crossfade.
  // The strip is a uniform time-scale (proportional B/A), so each edge maps its distance
  // from the seam directly to seconds; the two sides stay symmetric around the seam.
  function makeXfadeSeamHandle(el, side) {
    if (!el) return;
    let dragging = false, pushed = false;
    el.addEventListener('click', (e) => e.stopPropagation());   // never let a drag fall through to "select region"
    el.addEventListener('pointerdown', (e) => {
      if (!(env.clip.step === 4 && env.clip.trim.mode === 'slice')) return;
      e.preventDefault(); e.stopPropagation();
      el.setPointerCapture?.(e.pointerId);
      dragging = true; pushed = false;
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      if (!pushed) { env.pushHistory?.(); env.updateUndoUI?.(); pushed = true; }   // history on first move (pre-drag crossfade)
      const bar = byId('clipBar'); if (!bar) return;
      const r = bar.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const g = reseqGeom();
      const cf = (side === 'left' ? (g.seam - frac) : (frac - g.seam)) * g.total;   // distance from seam → seconds
      setCrossfadeSec(Math.max(0, Math.min(g.maxCf, cf)));
      showDragVal(env.getCrossfadeSec().toFixed(2) + 's crossfade', e.clientX, r.top);
    });
    const up = (e) => {
      if (!dragging) return;
      dragging = false; el.releasePointerCapture?.(e.pointerId);
      hideDragVal();
      env.updateUndoUI?.();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  // Drag the selected clip's endpoint bar: sel='B' drags the LEFT clip's end (outT, the
  // last-frame-before-seam), sel='A' drags the RIGHT clip's start (inT, first-after).
  // FREEZE-THEN-REFLOW: the layout is frozen during the drag (the bar follows the cursor via
  // the frozen scale) and only reflows on release — so the bar never chases a moving seam.
  // The split-stage shows the two seam frames live.
  function makeSeamEndpointHandle(el) {
    if (!el) return;
    let dragging = false, pushed = false, g0 = null, which = null, wasPlaying = false;
    el.addEventListener('pointerdown', (e) => {
      if (!(env.clip.step === 4 && env.clip.trim.mode === 'slice')) return;
      which = env.clip.sel; if (which !== 'B' && which !== 'A') return;   // nothing selected → nothing to drag
      e.preventDefault(); e.stopPropagation();
      el.setPointerCapture?.(e.pointerId);
      dragging = true; pushed = false; g0 = reseqGeom(); wasPlaying = !!env.clip.raf;
      enterSplitStage();   // show the seam pair live while adjusting the endpoint
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging || !g0) return;
      if (!pushed) { env.pushHistory?.(); env.updateUndoUI?.(); pushed = true; }
      const bar = byId('clipBar'); if (!bar) return;
      const r = bar.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      el.style.left = (f * 100) + '%';                                 // bar follows the cursor (frozen strip)
      const deltaSec = (f - g0.seam) * g0.total, d = g0.d, trim = env.clip.trim, minSeg = 0.15;
      if (which === 'B') {                                             // left clip's end = outA
        const newOutA = Math.max(g0.cut + minSeg, Math.min(d, g0.outA + deltaSec));
        trim.outT = newOutA / d; updateSplitLeft();
        showDragVal('clip end · ' + env.fmtClock(newOutA), e.clientX, r.top);
      } else {                                                         // right clip's start = inA
        const newInA = Math.max(0, Math.min(g0.cut - minSeg, g0.inA + deltaSec));
        trim.inT = newInA / d; updateSplitRight();
        showDragVal('clip start · ' + env.fmtClock(newInA), e.clientX, r.top);
      }
    });
    const up = (e) => {
      if (!dragging) return;
      dragging = false; el.releasePointerCapture?.(e.pointerId);
      hideDragVal(); exitSplitStage();
      lastThumbMode = null; buildLoopThumbs(); renderResequenceOverlays();   // REFLOW to the new proportions
      if (wasPlaying) startClipPreview(false);
      env.updateUndoUI?.();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  // ---- output format (preview & bake step): resolution / fps / playback speed ----------
  // The loop's own duration (pre-speed) for the current mode — drives the spec + bake length.
  function bakedLoopSeconds() {
    const trim = env.clip.trim, d = (env.clip.prevVideo && env.clip.prevVideo.duration) || 1, trimmedSec = (trim.outT - trim.inT) * d;
    if (trim.mode === 'bounce') return trimmedSec * 2;
    if (trim.mode === 'slice') { const g = reseqGeom(); return (g.outA - g.inA) - g.cfSec; }
    return trimmedSec;
  }
  // Output dimensions: source dims, optionally downscaled (never up) to a target long edge.
  function bakeDims() {
    const src = env.sourceVideo; if (!src) return { w: 2, h: 2 };
    let w = _even(src.videoWidth), h = _even(src.videoHeight);
    if (env.clip.fmt.res !== 'source') {
      const target = +env.clip.fmt.res, scale = Math.min(1, target / Math.max(w, h));
      w = _even(w * scale); h = _even(h * scale);
    }
    return { w, h };
  }
  // the effective OUTPUT fps: the chosen override, or the measured source rate (clamped 12–60)
  function outputFps() {
    const fmt = env.clip.fmt;
    if (fmt.fps !== 'source') return +fmt.fps;
    return env.clip.srcFps ? Math.max(12, Math.min(60, Math.round(env.clip.srcFps))) : 0;
  }
  function renderFormatSpec() {
    const el = byId('fmtSpec'), warnEl = byId('fmtWarn'); if (!el) return;
    const { w, h } = bakeDims(), fmt = env.clip.fmt, src = env.sourceVideo;
    const outFps = outputFps();
    const fpsTxt = outFps ? outFps + ' fps' : 'source fps';
    const sec = bakedLoopSeconds() / (fmt.speed || 1);
    const speedTxt = fmt.speed === 1 ? '' : ` · ${Math.round(fmt.speed * 100)}% slomo`;
    el.textContent = `${w} × ${h} · ${fpsTxt} · ${sec.toFixed(1)}s loop${speedTxt}`;
    // ⚠ warnings — any setting where we'd have to invent data we don't have
    const warns = [];
    if (src && fmt.res !== 'source' && +fmt.res > Math.max(src.videoWidth, src.videoHeight)) {
      warns.push(`won't upscale past source (${src.videoWidth}×${src.videoHeight})`);
    }
    const srcFps = env.clip.srcFps || 0;
    if (srcFps && outFps > srcFps * fmt.speed + 0.5) {
      warns.push(`⚠ needs frame interpolation — source is ${Math.round(srcFps)} fps, so ${Math.round(fmt.speed * 100)}% supports ~${Math.round(srcFps * fmt.speed)} fps`);
    }
    if (warnEl) { warnEl.hidden = !warns.length; warnEl.textContent = warns.join(' · '); }
  }
  // Reflect the measured source fps in the "match source" fps option so the number is visible.
  function updateFpsLabels() {
    const opt = byId('fmtFps')?.querySelector('option[value="source"]');
    if (opt) opt.textContent = env.clip.srcFps ? `match source (${Math.round(env.clip.srcFps)} fps)` : 'match source';
  }
  function syncFormatControls() {
    const r = byId('fmtRes'), f = byId('fmtFps'), s = byId('fmtSpeed');
    if (r) r.value = env.clip.fmt.res; if (f) f.value = env.clip.fmt.fps; if (s) s.value = String(env.clip.fmt.speed);
    updateFpsLabels(); renderFormatSpec();
    if (!env.clip.srcFps && env.media.sourceVideoUrl) {   // probe the real source fps once, then refresh
      probeVideoInfo(env.media.sourceVideoUrl).then((info) => {
        if (info && info.fps) { env.clip.srcFps = info.fps; updateFpsLabels(); renderFormatSpec(); }
      });
    }
  }

  // Re-derive the whole Loop Builder surface from env.clip.trim — called after an
  // undo/redo restores the trim. No-op unless the mode is active. Re-runs setLoopStep so
  // handle/region/thumbnail geometry rebuilds; if a behavior change was undone, the step
  // is clamped back into the restored mode's sequence.
  function refreshLoopBuilder() {
    if (!document.body.classList.contains('loop-active')) return;
    byId('clipSheet')?.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === env.clip.trim.mode));
    syncCrossfadeDisplays();
    const seq = stepSeq();
    let step = env.clip.step;
    if (!seq.includes(step)) { const below = seq.filter(s => s <= step); step = below.length ? below[below.length - 1] : seq[0]; }
    lastThumbMode = null;         // force the strip to rebuild from the restored trim
    setLoopStep(step);
  }

  // Regenerate the timeline when the track resizes (window resize / layout change) so cells
  // never stretch into black or get clipped — debounced, only while the mode is active.
  if (typeof ResizeObserver !== 'undefined') {
    let rzTimer = 0;
    const ro = new ResizeObserver(() => {
      if (!document.body.classList.contains('loop-active')) return;
      clearTimeout(rzTimer);
      rzTimer = setTimeout(() => { lastThumbMode = null; buildLoopThumbs(); renderLoopRuler(); renderClipTrim(); }, 150);
    });
    const bar = document.getElementById('clipBar'); if (bar) ro.observe(bar);
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
  env.setCrossfadeSec = setCrossfadeSec;
  env.getCrossfadeSec = () => env.clip.trim.crossfadeMs / 1000;
  env.makeXfadeSeamHandle = makeXfadeSeamHandle;
  env.makeSeamEndpointHandle = makeSeamEndpointHandle;
  env.selectLoopEntity = selectLoopEntity;
  env.renderFormatSpec = renderFormatSpec;
  env.refreshLoopBuilder = refreshLoopBuilder;
  env.barFracToMedia = barFracToMedia;   // scrub mapping (view-aware: full / trimmed / resequenced)
  env.clipScrubToFrac = clipScrubToFrac; // scrub that previews the dissolve inside the crossfade zone
  env.exitLoopBuilder = exitLoopBuilder;   // the mode picker + upload route here
  env.loopIsActive = () => document.body.classList.contains('loop-active');
}
