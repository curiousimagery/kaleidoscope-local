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
import { memBegin, memHold, memRelease, memReport } from './mem-ledger.js';
import { readHostVitals, onGLRestored } from './gl-watch.js';
import { seekVideoTo } from './video-source.js';
import { createSequentialFrameReader, probeVideoInfo, openSharedSource, sourceGateReport, sourceGateFor } from './video-decode.js';
import { acquireSession, releaseSession } from 'conduit/sessions';

// The Loop Builder holds THREE decoders of the same clip while it is open (visible preview,
// hidden A-head for the seam crossfade, hidden thumbnail strip). All three are justified and none
// of them was counted anywhere before the 2026-08-19 session audit.
const clipTokens = [];

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
    // ⚠️ B714 — `pv` COMES BACK OUT. B711 extracted this block into `mountClipPreviews` and left the
    // `pv.readyState` wait below referencing a variable that had moved into the function — a
    // ReferenceError that threw AFTER `sheet.hidden = false`, so the Loop Builder opened with
    // `env.clip.step` never initialised and `setLoopStep(1)` never called. That is Daniel's
    // *"opens to a weird trim state with a next button that doesn't do anything"*, and clicking
    // `trim & loop` fixed it because that calls `setLoopStep` directly.
    //
    // **`npm run check` cannot catch this** — an undefined identifier is valid syntax and fails only
    // at runtime. What catches it is the rule already in CLAUDE.md: *walk the user's actual path.*
    // I extracted a block and never opened the Loop Builder afterwards.
    const pv = mountClipPreviews();
    const nudge = document.getElementById('clipNudge'); if (nudge) nudge.hidden = true;   // clear any prior post-bake nudge
    // open the surface as a fullscreen INTERSTITIAL: the app bar is hidden while it's open
    // (body.loop-active), so there's no mode-switching or new uploads mid-edit. The header
    // X / cancel are the only way out. (It began as a dialog; this returns to that model.)
    document.body.classList.add('loop-active');
    sheet.hidden = false;
    lastThumbMode = null;   // force a fresh thumbnail build for this clip
    const init = () => { env.clip.step = 1; setClipMode(env.clip.trim.mode); setLoopStep(1); };
    if (pv.readyState >= 1) init(); else pv.addEventListener('loadedmetadata', init, { once: true });
  }
  // ⚠️ B711 — MOUNTING THE PREVIEWS IS ITS OWN OPERATION, BECAUSE A BAKE HAS TO GIVE THEM BACK.
  //
  // The Loop Builder holds THREE `<video>` decoders for its whole session — the visible stage
  // preview, a hidden A-head for the crossfade blend, and a hidden one for the thumbnail strip —
  // and the bake then opens its own on top. `docs/temp/8-23-contextLoss-clipBake.json` caught the
  // result: `sessions.peak.decode: 7`, with all three still live 255s in, and a 4K bake dying at
  // ~85% with `Decoding task did not complete`.
  //
  // **Shedding them for the duration of a bake is free, not a tradeoff.** The stage is behind the
  // full-screen `baking…` cover the entire time, so nothing is looking at any of the three. That is
  // why there is no capability gate here and no chip table (Daniel asked whether a more capable
  // chip should keep them): on the most capable hardware imaginable the answer is still that these
  // decoders are doing nothing during a bake. **A tradeoff you can decline entirely is not one.**
  function mountClipPreviews() {   // returns the stage preview element — `openClipEditor` waits on it
    const sheet = document.getElementById('clipSheet');
    const pv = document.getElementById('clipVideo');
    pv.muted = true; pv.playsInline = true; pv.loop = false;
    pv.src = env.media.sourceVideoUrl;
    env.clip.prevVideo = pv;
    clipTokens.push(acquireSession('decode', 'loop builder: preview'));
    // a second, hidden-but-decoding preview video: plays the A-head during the seam
    // crossfade so the two streams can be alpha-blended live (smooth, no capture).
    const vB = document.createElement('video');
    vB.muted = true; vB.playsInline = true; vB.loop = false; vB.preload = 'auto';
    vB.setAttribute('playsinline', ''); vB.setAttribute('muted', '');
    vB.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    vB.src = env.media.sourceVideoUrl;
    (document.querySelector('.clip-stage') || sheet).appendChild(vB);
    env.clip.prevVideoB = vB;
    clipTokens.push(acquireSession('decode', 'loop builder: A-head crossfade'));
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
    clipTokens.push(acquireSession('decode', 'loop builder: thumbnail strip'));
    return pv;
  }

  // Release all three, reversibly. Same release idiom as `disposeClipPreview` — pause,
  // removeAttribute('src'), load() — which is the one `archive/SESSION-AUDIT.md` documents and the
  // only one that actually frees an element's decode pipeline. Dropping the reference does not.
  function shedClipPreviews() {
    if (!clipTokens.length) return false;      // already shed; nothing to give back later
    releaseClipPreviewElements();
    return true;
  }

  // Give them back, and make the panels that depend on them rebuild. `lastThumbMode = null` is what
  // forces the strip to redraw — without it the thumbnails stay blank after a bake, which is very
  // close to the stale-thumbnail bug Daniel reported on 2026-08-21.
  function restoreClipPreviews() {
    if (clipTokens.length) return;             // never double-mount
    if (!env.media.sourceVideoUrl) return;     // nothing to point at
    mountClipPreviews();
    lastThumbMode = null;
    const pv = env.clip.prevVideo;
    const after = () => { try { buildLoopThumbs(); renderClipTrim(); } catch { /* the sheet may be closing */ } };
    if (pv && pv.readyState >= 1) after();
    else pv?.addEventListener('loadedmetadata', after, { once: true });
  }

  function releaseClipPreviewElements() {
    stopClipPreview();
    exitSplitStage();   // restore the stage video's visibility if we tore down on the crossfade step
    const blend = document.getElementById('clipBlend'); if (blend) blend.hidden = true;
    if (env.clip.prevVideo) { try { env.clip.prevVideo.pause(); } catch { /* ignore */ } env.clip.prevVideo.removeAttribute('src'); try { env.clip.prevVideo.load(); } catch { /* ignore */ } env.clip.prevVideo = null; }
    if (env.clip.prevVideoB) { try { env.clip.prevVideoB.pause(); } catch { /* ignore */ } env.clip.prevVideoB.removeAttribute('src'); try { env.clip.prevVideoB.load(); } catch { /* ignore */ } env.clip.prevVideoB.remove(); env.clip.prevVideoB = null; }
    if (env.clip.thumbVideo) { try { env.clip.thumbVideo.pause(); } catch { /* ignore */ } env.clip.thumbVideo.removeAttribute('src'); try { env.clip.thumbVideo.load(); } catch { /* ignore */ } env.clip.thumbVideo.remove(); env.clip.thumbVideo = null; }
    while (clipTokens.length) releaseSession(clipTokens.pop());
  }

  function disposeClipPreview() {
    releaseClipPreviewElements();
  }
  // re-bind the motion timeline to the current (trimmed / baked) clip + show frame 0.
  function rebindClipToTimeline() {
    if (!env.sourceVideo) return;
    env.lockVideoDuration();
    motion.playhead = 0;
    session.timelineZoom = 1; session.timelinePan = 0;
    env.filmstrip.lastSig = '';
    // Opened from PERFORM: the motion timeline still re-homes (above), but perform owns
    // the transport there — re-home its loop/ruler/thumbs instead of scrubbing the source
    // to frame 0 and parking it, which would stop the program mid-set.
    if (env.performRT?.active) { env.refreshPerformTrim?.(); return; }
    if (env.ensureSeededSelection()) return;         // always land with a selected kf0 (so +keyframe adds an in-between)
    env.renderTimeline();
    env.updateMotionUI();
    env.scrubVideo(0);
  }
  // Where the Loop Builder hands you back. It opened OVER a mode, so it should return
  // you to that mode: landing in motion after a trim you started from perform is a mode
  // switch nobody asked for, and it left perform showing the untrimmed clip (Daniel,
  // B491). Trim-only and bake share this tail.
  function returnFromLoopBuilder() {
    if (env.performRT?.active) {
      env.refreshPerformSource?.();   // a bake swapped the element; identity-guarded, so trim-only is a no-op
      env.refreshPerformTrim?.();
    } else {
      // opinionated (Daniel's original call): from still, motion is where you go next
      document.getElementById('motionBtn')?.click();
    }
    // a baked clip may change aspect (e.g. portrait) — relayout after the mode settles
    // so the source panel doesn't overlap the controls
    requestAnimationFrame(() => { env.arrangeSlots?.(); env.resizePreviewCanvas?.(); });
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
    if (env.clip.baking) {
      // Still never leave mid-bake — the decoders are in use, and tearing down under them
      // is the B495 wedge. But "can't leave yet" is not the same as "your button is dead":
      // ask the bake to stop, say so, and let its own unwind (which closes every reader)
      // put us back. Pressing cancel again while it winds down is harmless.
      env.clip.cancelBake = true;
      const btn = document.getElementById('clipCancel');
      if (btn) { btn.textContent = 'cancelling…'; btn.disabled = true; }
      const cover = document.getElementById('clipBaking');
      if (cover) cover.textContent = 'cancelling…';
      return false;
    }
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
  // ⚠️ B733 — REPAINT THE STRIP AFTER A GL RESTORE. NOTHING ELSE WILL.
  //
  // `buildLoopThumbs()` runs only when the shown VIEW changes (`thumbMode !== lastThumbMode`), which
  // is correct — it is seek-heavy and must not run on every next/back. But a context loss does not
  // change the view, so after a restore the guard is satisfied and the strip stays black while every
  // other surface comes back. **The invalidate-and-rebuild idiom already exists here** for exactly
  // this class of staleness (after a bake, and on undo); it simply had no path from a GL restore.
  //
  // Guarded on the sheet being open: a restore while the Loop Builder is closed has nothing to
  // repaint, and `buildLoopThumbs` seeks a hidden video that only exists while it is mounted.
  onGLRestored(() => {
    const sheet = document.getElementById('clipSheet');
    if (!sheet || sheet.hidden) return;
    lastThumbMode = null;                       // force the rebuild past its view-change guard
    try { setLoopStep(env.clip.step); } catch { /* a repaint must never break a recovery */ }
  });

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
    // step 1 uses the loop-mode buttons AS the advance action; other steps use the primary button
    const modeChoice = byId('loopModeChoice'), applyBtn = byId('clipApply');
    if (modeChoice) modeChoice.hidden = n !== 1;
    if (applyBtn) applyBtn.hidden = n === 1;
    updateRail(); loopPrimary(); renderClipTrim(); updatePlayButton();
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
  // step 1: picking a loop mode IS the advance action — set the mode, then apply (trim-only) or
  // advance into that mode's next step. Removes the "click next without choosing" trap.
  function chooseAndAdvance(mode) {
    if (mode !== env.clip.trim.mode) { env.pushHistory?.(); setClipMode(mode); updateRail(); loopPrimary(); env.updateUndoUI?.(); }
    loopPrimaryAction();
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
    if (env.clip.trim.mode === 'forward') {
      // trim-only is non-destructive, but it still produces MOTION content — so from a
      // STILL we land in the motion editor, consistent with the bounce/slice bake paths
      // below. From PERFORM we stay in perform (returnFromLoopBuilder decides).
      // closeClipEditor(true) keeps the trim + rebinds the timeline first.
      closeClipEditor(true);
      returnFromLoopBuilder();
      return;
    }
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
    env.clip.cancelBake = false;   // armed by the cancel button; checked per encoded frame
    stopClipPreview();
    const dur = decodeV.duration || src.duration || 1;
    // ⚠️ B712 — THESE RUN BEFORE ANY DECODER IS OPENED. THEY DID NOT, AND THAT WAS MY BUG.
    //
    // B707, B710 and B711 all put their guards beside the `baking…` cover — which reads like the
    // start of the bake and is not. **The three WebCodecs readers are created ~140 lines EARLIER**
    // (`bounceReader`, `sliceReaderA/B`), so every one of those guards ran after the thing it was
    // meant to gate. `docs/temp/8-23-contextLoss-clipBake-02.json` shows it plainly:
    // **`sessions.peak.decode: 7`, unchanged by B711's shed.** The previews were still held when
    // the bake's own decoders were allocated, so the shed freed nothing that mattered.
    //
    // A pre-flight that runs after take-off is not a pre-flight. Everything that must happen before
    // the bake acquires hardware now lives here, above `bakeDims()`.
    // ⚠️ B707 — CHECK THE CONTEXT BEFORE STARTING, NOT ONLY PER FRAME.
    //
    // B705's per-frame guard worked exactly as designed and reported `graphics context lost at
    // frame 1 of 2635` (`docs/temp/8-21-26-contextLoss-05.json`). **Frame 1 means the context was
    // already dead when the bake began** — so the honest fix is upstream: a bake that cannot
    // possibly succeed should not open seven decoders, configure an encoder and put a modal on
    // screen before finding out. Refuse by name and let the operator retry once it recovers.
    if (env.engine?.glContext?.isContextLost()) {
      env.vitals?.mark('bake-refused', { why: 'gl-lost' });
      alert('Cannot bake right now: the graphics context is recovering. Try again in a moment.');
      env.clip.baking = false;
      return;
    }
    // ⚠️ B713 — B710's DEGRADED-SOURCE REFUSAL IS REMOVED. IT GATED THE WRONG SUBSYSTEM.
    //
    // B710 refused a bake when `env.nativeVideo && !engine.planarActive`, reasoning that a bake off
    // the planar path would capture the 1280 preview canvas. **The bake does not read the engine at
    // all.** It reads the FILE, through `createSequentialFrameReader(url)` — WebCodecs over demuxed
    // samples, a path with no connection to the engine's texture, the planar provider, or the frame
    // socket. `planarActive` describes whether the ENGINE is currently uploading planes for the
    // on-screen preview. It says nothing about what a bake can read.
    //
    // The cost was Daniel's, not a hypothetical: **`bake-refused · degraded-source` twice, on a
    // source the diagnostic panel simultaneously reported as being on the native path**
    // (`docs/temp/8-23-contextLoss-clipBake-03.json`), after 8m55s of build, upload and setup that
    // never reached the test. A guard that blocks a working operation is worse than no guard.
    //
    // **And it invalidates B710's explanation of the grey bake**, which claimed the bake had
    // captured the degraded preview canvas. That cannot happen by this path, so the grey output has
    // no established cause and is back to open. What protects against it is B711's OUTPUT check,
    // which is the right shape anyway: it validates the RESULT rather than predicting from a
    // signal in another subsystem, and it can only reject a bad bake — never block a good one.
    // ⚠️ B714 — B711's PREVIEW SHED IS REVERTED. IT TORE DOWN THE ELEMENT THE BAKE READS FROM.
    //
    // `decodeV` is captured above as `env.clip.prevVideo` — **the stage preview element** — and the
    // bake's fallback `frameAt` seeks it directly whenever the WebCodecs readers are unavailable.
    // `shedClipPreviews()` calls `removeAttribute('src')` + `load()` on exactly that element, so on
    // the fallback path the bake was seeking a video with no source: no progress, no frames, and a
    // cancel that could not land because nothing was awaiting anything. **That is Daniel's desktop
    // report — *"bake loop on desktop isn't showing the progress bar at all... cancel button now
    // says cancelling but can't"*.**
    //
    // **And the hypothesis it served no longer holds.** B711 shed the previews to relieve decoder
    // pressure; the failure has since proved DETERMINISTIC at a fixed timestamp (81.470s, twice),
    // which is a property of the clip's GOP structure, not of how many decoders are open. It was
    // also never confirmed to reduce `sessions.peak.decode` at all (B712 found the shed ran after
    // the readers were allocated).
    //
    // **So it is a change with two shipped regressions, an unproven benefit, and a premise that has
    // since weakened.** Reverted rather than tuned. `mountClipPreviews` / `shedClipPreviews` /
    // `restoreClipPreviews` stay — the extraction itself is sound and `disposeClipPreview` now
    // shares one release idiom — but nothing calls the shed during a bake.
    const shed = false;

    const { w, h } = bakeDims();                     // output resolution (source, or downscaled per the format control)
    // B728 — everything the bake allocates from here is attributed to this operation, and the
    // high-water mark resets so a second bake in one session is measured on its own terms.
    memBegin('bake');
    let bakeTiming = null, bakeOutBytes = null;
    let lastQuarter = 0;
    const crumb = (kind, extra) => {
      try {
        const v = readHostVitals();
        env.vitals?.mark(kind, { ...bakeShape, ...(extra || {}),
          availableMB: v?.availableMB ?? null, thermal: v?.thermal ?? null,
          heapMB: (() => { try { return memReport().heldMB; } catch { return null; } })() });
      } catch { /* an instrument must never break the work */ }
    };
    // ⚠️ B730 — THE DEVICE-WIDE BASELINE. Without a BEFORE there is no delta, and the absolute is
    // meaningless: iOS keeps memory productively occupied, so "free" is small and noisy at rest.
    // This is the only reading that can see the WKWebView content and GPU processes, and until now
    // it was stamped ONLY on a context loss — so a bake that SUCCEEDED reported nothing about the
    // processes we are blind to, which is exactly the run we most wanted it from.
    const devBefore = (() => { try { return readHostVitals(); } catch { return null; } })();
    const cap = document.createElement('canvas'); cap.width = w; cap.height = h;
    const capId = memHold('capture-canvas', w * h * 4);
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
    // B742 — the File we already hold, but ONLY if it is the file this url names. See openSharedSource.
    const srcBlob = (url && url === env.media.sourceVideoUrl) ? env.media.sourceVideoBlob : null;
    let durationMs, frameAt;
    // WebCodecs readers over the same file (below); declared here so the finally can close them.
    let sliceReaderA = null, sliceReaderB = null, bounceReader = null, sliceSource = null;

    // ⚠️⚠️ B758 — HARVEST AND RELEASE MUST HAPPEN BEFORE THE SWAP, NOT AFTER IT.
    //
    // This used to live only in the `finally`, which runs AFTER `applyBakedClip`. So the swap — the
    // single largest GPU allocation in the whole operation, installing a freshly baked clip and
    // re-uploading its textures — ran while **every VideoDecoder this bake opened was still holding
    // its surface pool**. On a 4K bake that is the moment the device runs out of room:
    //
    //     4K bake, FAILED  : deviceFreeMB 153 -> 127 at the loss, then 4x gl-context-lost
    //     FHD bake, PASSED : deviceFreeMB 934 -> 177, no loss at all
    //     our own footprint: 39-48MB in BOTH. This was never our process being too big.
    //
    // Both bakes encoded every frame (`bake:encoded` fired in the failing one too). **The bake was
    // never broken; the swap after it was**, and it was starved of GPU memory by resources this
    // function was going to release two lines later.
    //
    // Idempotent on purpose: the success path calls it before the swap, and the `finally` calls it
    // again on every path so an error still releases everything exactly once.
    let bakeReleased = false;
    const harvestAndRelease = () => {
      if (bakeReleased) return;
      bakeReleased = true;
    try {
      // ⚠️ B720 — A TIMEOUT OUTRANKS EVERYTHING. THIS SORT DISCARDED THE ONLY READING THAT MATTERED.
      //
      // B716 ranked the readers by `decoded` and took the largest. In `8-24-contextLoss-clipBake-03.json`
      // the bake FAILED at 30.982s having decoded **9** frames — and the report recorded
      // `decoded: 113, timedOut: false` from the OTHER reader, because 113 > 9. **The instrument
      // built to explain the failure preferred a healthy number over the failing one**, twice,
      // and the finding survived only because the error text reached Daniel's screen.
      //
      // Rank by failure first, cost second. A reading that timed out is the reading.
      const all = [sliceReaderA, sliceReaderB, bounceReader]
        .map((r) => { try { return r?.worstTarget?.() || null; } catch { return null; } })
        .filter(Boolean);
      const worst = all
        .slice()
        .sort((x, y) => (Number(y.timedOut) - Number(x.timedOut)) || (y.decoded - x.decoded))[0] || null;
      // B721 — `holes` across ALL readers, not just the one that won the sort. The sort answers
      // "what was the worst target"; this answers "did the timeline-hole rule fire at all", and
      // the reader that bridged a hole is usually not the reader that struggled.
      const holes = all.reduce((n, r) => n + (r.holes || 0), 0);
      // ⚠️ B728 — READ THE LEDGER BEFORE THE READERS CLOSE, for the same reason `worstTarget` is
      // read here: closing first throws the number away on exactly the runs that matter. `heldMB`
      // is deliberately captured BOTH now and after the closes below, because the difference
      // between them is the whole residue question (D2 died at frame 1 where D3, from a fresh
      // launch, encoded all 6,387 frames).
      const memBefore = memReport();
      // ⚠️ B724 — A BAKE WITH NO READER MUST STILL PUBLISH, OR THE LAST ONE'S NUMBER STANDS IN FOR IT.
      //
      // `env.bakeDecode` is a single slot. When no WebCodecs reader arms, nothing was written and
      // **the previous bake's reading stayed in the report**, timestamped and plausible. Daniel's
      // 47:45 FHD bake (`8-24-arrayBufferError-longFHDclip.json`) failed with an allocation error
      // and shipped a `bakeDecode` describing the 4K clip he had baked an hour earlier — right
      // down to `srcW 3840`, on a 1920-wide source. Only the `at` timestamp gave it away.
      //
      // Readers fail to arm for reasons that matter: **over `maxBytes` (1.5GB), and that file was
      // 4.94GB**, an unsupported codec, or a demux that found no samples. Every one of those means
      // the bake silently took the per-frame element-seek fallback, which is exactly the thing the
      // next reader most needs to know. An absence is not evidence, and here it was worse than
      // absent — it was someone else's evidence.
      if (!all.length) {
        // B738 — the gate now names the exact refusal instead of listing what it might have been.
        // B763 — the gate FOR THIS SOURCE, not whichever attempt wrote the slot last.
        const gate = (() => {
          try { return sourceGateFor(env.media?.sourceVideoUrl); } catch { return null; }
        })();
        const why = !env.media?.sourceVideoUrl ? 'no source url'
          : gate?.why
            || (gate?.stale ? `no WebCodecs reader armed, and ${gate.why || 'the gate is about another source'}`
              : 'no WebCodecs reader armed, and the gate armed cleanly — the failure is downstream of it');
        env.bakeDecode = { ...bakeShape, reader: 'element-seek fallback', why, srcGate: gate,
                           timing: bakeTiming, outBytes: bakeOutBytes, at: new Date().toISOString() };
        env.vitals?.mark('bake-decode-none', { ...bakeShape, why, srcGate: gate });
      }
      if (worst) {
        // B719's reasoning still stands and is why `bakeShape` exists; it is now captured before
        // the bake rather than recomputed here. See its comment for why the late read was wrong.
        const shape = bakeShape;
        // B738 — `srcGate` rides along on the SUCCESS path too. The cap that let a source through
        // is as much a part of the reading as the cap that stopped one, and it carries the
        // `fileBytes` the ledger's `peakMB` has to be compared against.
        const gate = (() => { try { return sourceGateReport(); } catch { return null; } })();
        env.bakeDecode = { ...worst, ...shape, holes, mem: memBefore, srcGate: gate,
                           timing: bakeTiming, outBytes: bakeOutBytes, at: new Date().toISOString() };
        env.vitals?.mark('bake-decode-worst', { ...worst, ...shape, holes, mem: memBefore, srcGate: gate });
      }
    } catch { /* never let an instrument break a teardown */ }
    if (sliceReaderA) { try { sliceReaderA.close(); } catch { /* already closed */ } sliceReaderA = null; }
    if (sliceReaderB) { try { sliceReaderB.close(); } catch { /* already closed */ } sliceReaderB = null; }
    if (bounceReader) { try { bounceReader.close(); } catch { /* already closed */ } bounceReader = null; }
    if (sliceSource) { try { sliceSource.close(); } catch { /* already closed */ } sliceSource = null; }
    try { memRelease(capId); } catch { /* never let an instrument break a teardown */ }
    };

    if (trim.mode === 'bounce') {
      durationMs = Math.max(200, trimmedSec * 2 * 1000);   // forward + reverse
      // Fast decode: a monotonic reader serves the forward half at speed; the reverse half
      // still pays a keyframe re-decode per frame (GOP-reverse buffering is the deeper win,
      // filed), but through WebCodecs rather than <video> seeks. Falls back to element seeks.
      try { bounceReader = await createSequentialFrameReader(url, { blob: srcBlob }); } catch { bounceReader = null; }
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
      // ⚠️ B732 — ONE FETCH, ONE DEMUX, TWO READERS. THIS IS THE 33% CUT.
      //
      // Both readers walk the SAME file; only their decoder, queue and cursor differ. Opening them
      // separately fetched and demuxed it twice, and the four-machine gauntlet measured the cost:
      // `peakMB` 2143.2 with `sample-table` 1404.2 and `frames-held: 0` at the peak — **the
      // high-water mark landed during the SECOND demux, before a single frame was decoded.**
      //
      // The source is closed in the `finally` alongside the readers; it is refcounted, so the sample
      // table survives until the last reader lets go however the bake exits.
      try {
        sliceSource = await openSharedSource(url, { blob: srcBlob });
        sliceReaderB = sliceSource ? sliceSource.createReader() : null;
        sliceReaderA = sliceReaderB ? sliceSource.createReader() : null;
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

    // ⚠️ B722 — SNAPSHOT WHAT WE ARE ABOUT TO BAKE, HERE. THE `finally` READS IT TOO LATE.
    //
    // B719 attached the trim to the reading so two runs could be checked for comparability instead
    // of remembered. It read `trim` in the teardown — but a SUCCESSFUL bake calls `applyBakedClip`
    // first, and that resets `env.clip.trim` to `{ inT: 0, outT: 1, mode: 'forward' }` because the
    // baked clip is now the whole source. `trim` is held by reference, so the harvest recorded the
    // POST-bake state.
    //
    // **It is self-refuting, and that is how it was caught: `mode: 'forward'` never bakes at all**
    // (`applyClip` commits a forward trim directly and returns), so a report claiming a bake ran in
    // forward mode is describing a state that came into being afterwards. Both of Daniel's B721
    // passes say `forward / inT 0 / outT 1`, and none of those three values can be trusted.
    //
    // The failure path was always accurate, since `applyBakedClip` never runs — which is the worst
    // possible split: **the instrument told the truth about failures and lied about successes**, so
    // any A/B between a failing run and a passing one compared a real trim against a reset one.
    const bakeShape = {
      inT: +(trim.inT ?? 0).toFixed(4),
      outT: +(trim.outT ?? 1).toFixed(4),
      mode: trim.mode,
      slicePoint: trim.mode === 'slice' ? +(trim.slicePoint ?? 0.5).toFixed(4) : undefined,
      crossfadeMs: trim.mode === 'slice' ? trim.crossfadeMs : undefined,
      frames: (durationMs && fps) ? Math.max(2, Math.round((durationMs / 1000) * fps)) : undefined,
      durationMs: durationMs ? Math.round(durationMs) : undefined,
      fps: fps || undefined,
      srcW: w, srcH: h,
      // B731 — the media's own identity, so two reports can be checked for "same clip" at a glance
      // rather than by noticing that a derived memory figure differs.
      ...(() => {
        const r = sliceReaderB || sliceReaderA || bounceReader;
        if (!r) return {};
        return { codec: r.codec, srcBytes: r.fileBytes, mbps: r.mbps };
      })(),
    };

    const prog = document.getElementById('clipProgress'), fill = document.getElementById('clipBarFill');
    const apply = document.getElementById('clipApply'), cover = document.getElementById('clipBaking');
    // ⚠️ B717 — RESTORED. B712 lifted the bake's pre-flight guards above `bakeDims()` and the span
    // it moved SWALLOWED these two lines, which sat between the guards and the shed. They were then
    // dropped when the guards were removed from the old position — so from B712 to B716 a bake ran
    // with **no "baking…" cover and a live, re-clickable apply button**. Daniel, 2026-08-24:
    // *"the baking mask is no longer showing over the preview while baking."*
    //
    // The lesson is about the edit, not the code: **I moved a span defined by two anchors without
    // reading what sat between them.** A block lifted by index is not a block understood.
    if (cover) cover.hidden = false;                 // hide the seeking/decoding flicker behind a "baking…" cover
    if (apply) { apply.disabled = true; apply.textContent = 'baking…'; }
    if (prog) prog.hidden = false;
    try {
      crumb('bake:begin');
      const { blob, timing } = await exportVideo({
        frameAt, width: w, height: h, fps, durationMs, captureMode: '2d',
        onProgress: (x) => {
          if (fill) fill.style.width = Math.round(x * 100) + '%';
          // B751 — see motion-runtime: a jetsam runs no JS, so the only forensics are the crumbs
          // written WHILE the bake runs. Two iPad Air bakes died leaving an empty trail.
          const q = Math.floor(x * 4);
          if (q > lastQuarter && q < 4) { lastQuarter = q; crumb('bake:progress', { pct: q * 25 }); }
        },
        // A BAKE MUST BE ABANDONABLE. It used to run to completion no matter what: the
        // cancel button routed to exitLoopBuilder, which refuses while `baking` is set, so
        // it silently did nothing — and a 6:39 crossfaded clip projects to ~25 minutes
        // (Daniel, B505). exportVideo has always taken `shouldCancel` and checks it per
        // frame; the bake simply never passed one. The refusal to tear down mid-bake was
        // right (readers are in use); the missing piece was a way to ask it to stop.
        shouldCancel: () => env.clip.cancelBake,
        // B705 — a bake is the longest single GL job the app runs, so it is the most likely to be
        // alive when a context dies. Failing at a named frame is the difference between "the bake
        // failed" and a number that says how far it got.
        glLost: () => !!env.engine?.glContext?.isContextLost(),
      });
      crumb('bake:encoded');
      bakeTiming = timing || null;                 // B744 — the stage split, published not consoled
      bakeOutBytes = blob?.size ?? null;
      // ⭐ B758 — RELEASE BEFORE THE SWAP. See `harvestAndRelease` above: holding the decoders across
      // `applyBakedClip` is what killed the GL contexts on every 4K bake.
      harvestAndRelease();
      await applyBakedClip(blob, { w, h });         // swaps the source + re-binds the timeline
      disposeClipPreview();
      env.clip.backup = null;
      hideLoopSurface();
      returnFromLoopBuilder();                      // back to the mode you came from (motion from still)
    } catch (e) {
      if (e?.code === 'cancelled') {
        // the user's own decision, not a failure — unwind quietly and leave them in the
        // Loop Builder with their settings intact, exactly where they were
        console.info('[fold] clip bake cancelled');
      } else {
        // B705 — as in motion-runtime: the alert is gone the moment it is dismissed, and a bake
        // that dies with the app leaves only what reached `priorTrail`.
        if (e?.code === 'gl-lost' || e?.code === 'encoder-stopped') env.vitals?.mark('export-aborted', { why: e.code, frame: e.frame, frames: e.frames, state: e.state, job: 'bake' });
        console.error('clip bake failed', e);
        // ⚠️ B707 — A MODAL BLOCKS THE MAIN THREAD, AND THAT CORRUPTED A MEASUREMENT.
        //
        // In `8-21-26-contextLoss-05.json` the preview's context appeared to take **86.8s and then
        // 101.4s** to come back, against 982ms-2.3s everywhere else. That is not the GPU. `alert()`
        // pauses the event loop until it is dismissed, so both the restore event and B705's own
        // 3-second `gl-restore-timeout` were stuck behind Daniel reading a dialog — which is also
        // why no timeout was marked. **Every timestamp after a modal is delivery time, not event
        // time.** Marking the gap is what makes the trail readable; a reader cannot infer it.
        const tDialog = Date.now();
        alert('Could not bake the clip: ' + (e && e.message ? e.message : e));
        const blockedMs = Date.now() - tDialog;
        if (blockedMs > 250) env.vitals?.mark('dialog-blocked', { ms: blockedMs, where: 'bake-error' });
      }
    } finally {
      // EVERY reader this bake opened, on EVERY exit path. bounceReader was missing here,
      // so a failed bounce bake left a VideoDecoder holding the hardware and the immediate
      // retry died at ~0s until the app was restarted (Daniel, B495).
      // ⚠️ B716 — HARVEST THE MEASUREMENT BEFORE CLOSING THE READERS THAT HOLD IT.
      //
      // `worstTarget()` lives on the reader, so closing first would throw the number away on
      // exactly the runs that matter. Published to `env.bakeDecode` so the frame-cost export can
      // carry it — Daniel does not run Web Inspector, and an uncollectable diagnostic is no
      // diagnostic (`DEVICE-TESTING.md`).
      harvestAndRelease();
      // The balance sheet AFTER every release this bake knows how to perform. **Non-zero here means
      // we are still holding references** — a bug we can fix. Zero here while the next bake still
      // dies early means the residue is GC latency or engine-side, which is a different fix.
      try {
        const after = memReport();
        const devAfter = (() => { try { return readHostVitals(); } catch { return null; } })();
        // The delta is the measurement. `attributedMB` is what our ledger claims; the difference
        // between that and the device-wide movement is the blind spot — decoder surface pools, GL
        // textures, the encoder's own buffers — measured rather than assumed.
        const dev = (devBefore && devAfter) ? {
          freeBeforeMB: devBefore.deviceFreeMB, freeAfterMB: devAfter.deviceFreeMB,
          reclaimBeforeMB: devBefore.deviceReclaimableMB, reclaimAfterMB: devAfter.deviceReclaimableMB,
          footprintBeforeMB: devBefore.footprintMB, footprintAfterMB: devAfter.footprintMB,
          thermalBefore: devBefore.thermal, thermalAfter: devAfter.thermal,
          // B738 — `os_proc_available_memory`, the per-process jetsam headroom. It is the ONE
          // reading the capability ladder is derived from, and until now it was cached and never
          // published beside the bake it governed.
          availableBeforeMB: devBefore.availableMB, availableAfterMB: devAfter.availableMB,
        } : { why: devBefore || devAfter ? 'only one end of the delta was available' : 'host vitals never reported (web/Electron)' };
        env.bakeMem = { ...after, device: dev, at: new Date().toISOString() };
        env.vitals?.mark('bake-mem', { ...after, device: dev });
      } catch { /* noop */ }
      // ⚠️ B711 — GIVE THE PREVIEWS BACK BEFORE ANYTHING ELSE IN THE TEARDOWN.
      //
      // Daniel, B700: *"is there an elegant way to pick them back up if someone cancels a bake and
      // goes back? can the loop builder self-detect a failure state mid-bake to be able to restore
      // previews?"* This `finally` is that answer, and it is the elegant version precisely because
      // it does NOT try to detect anything: **every exit from a bake runs it — completed, thrown,
      // cancelled, refused — so there is no failure state left to detect.** A restore keyed on
      // "did it fail" would need to enumerate the ways it can fail, and the two that cost us
      // builds this month (a synchronous encoder throw, a context loss inside an await) are both
      // ways nobody enumerated.
      //
      // On the SUCCESS path `applyBakedClip` has already swapped the source, so re-mounting points
      // the previews at the NEW clip, which is what the operator should see next.
      if (shed) restoreClipPreviews();
      if (prog) prog.hidden = true;
      if (fill) fill.style.width = '0%';
      if (cover) cover.hidden = true;
      if (apply) { apply.disabled = false; }
      if (cover) cover.textContent = 'baking…';      // reset the label the cancel path rewrote
      const cbtn = document.getElementById('clipCancel');
      if (cbtn) { cbtn.textContent = 'cancel'; cbtn.disabled = false; }
      setClipMode(env.clip.trim.mode);
      // ⚠️ B707 — AND THE LABEL IS `loopPrimary`'s, NOT `setClipMode`'s. The comment here claimed
      // setClipMode restored the apply label; it does not — it toggles mode chips and re-renders
      // the trim. So after a failed bake the button read "baking…" forever while being fully
      // clickable, and Daniel pressed it again (`8-21-26-contextLoss-05.json` session): a control
      // that lies about what it will do, on the one action that costs minutes.
      loopPrimary();                                 // THIS is what restores the apply label
      env.clip.baking = false;
      env.clip.cancelBake = false;
    }
  }
  // Swap a freshly-baked clip in as the working source (keeps the uploaded original in
  // `env.media.originalSource` for the export package). Resets the trim (the baked clip
  // IS the processed clip) and re-binds the motion timeline.
  // ⚠️ B711 — THE SWAP IS DESTRUCTIVE, SO IT VALIDATES FIRST. (Daniel, 2026-08-23: *"the output
  // from a bake should only replace the source when it has baked successfully."*)
  //
  // **The subtlety is that "successfully" cannot mean "did not throw."** The bake that destroyed
  // his clip COMPLETED — it ran to the end, produced a real mp4, reported success, and the mp4 was
  // grey, because the engine had fallen off the planar path onto a stalled 1280 preview canvas. An
  // exception-based definition of success would have let it through exactly as before.
  //
  // So the output is checked against what was ASKED for. B710 guards the input (refuse to bake a
  // degraded source) and this guards the output; either alone leaves a hole, because the source can
  // degrade *during* a four-minute bake as easily as before one.
  async function applyBakedClip(blob, expect = null) {
    // ⚠️ B740 — READ THE MODE BEFORE THE RESET BELOW, the same late-read trap B722 fixed. Line
    // `env.clip.trim.mode = 'forward'` further down means anything asking afterwards gets 'forward'
    // for every bake, which is exactly the shape of the bug that made B719's check invert.
    const bakedMode = env.clip.trim.mode;
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.loop = true; v.preload = 'auto';
    v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
    try {
      await new Promise((res, rej) => {
        v.addEventListener('loadeddata', () => res(), { once: true });
        v.addEventListener('error', () => rej(new Error('the baked clip failed to load')), { once: true });
        v.src = url;
      });
      // Encoders may round to even dimensions, so allow a couple of pixels — but a bake of the
      // 1280 preview against a 3840 request is off by thousands, which is the case that matters.
      if (expect && expect.w && expect.h
          && (Math.abs(v.videoWidth - expect.w) > 2 || Math.abs(v.videoHeight - expect.h) > 2)) {
        throw new Error(`the baked clip came out ${v.videoWidth}×${v.videoHeight}, not ${expect.w}×${expect.h}`
                      + ' — the source was not being read at full resolution, so the original has been kept');
      }
    } catch (e) {
      // ⚠️ LEAVE THE ORIGINAL ALONE. Nothing above this point has touched `env.sourceVideo`, so
      // failing here is genuinely non-destructive — the operator keeps the clip they had.
      URL.revokeObjectURL(url);
      try { v.removeAttribute('src'); v.load(); } catch { /* ignore */ }
      env.vitals?.mark('bake-rejected', { why: e?.message || String(e), w: v.videoWidth, h: v.videoHeight });
      throw e;
    }
    env.stopSourceVideoPlayback();
    const old = env.sourceVideo;
    // planar-handback-ok — the baked clip's OWN decode is attached ~15 lines below (see the
    // comment there); the old decode is still running the clip we just replaced, so re-installing
    // its planes here is precisely the hybrid B595 removed.
    engine.setSource(v);
    env.sourceVideo = v;
    env.tagSourceVideo?.(v, 'baked clip');   // the bake mints its own element; keep it counted
    if (env.media.sourceVideoUrl) URL.revokeObjectURL(env.media.sourceVideoUrl);   // free the previous source URL (original File kept in env.media.originalSource)
    env.media.sourceVideoUrl = url;
    env.media.sourceVideoBlob = blob;   // the baked bytes are now the working clip (see media.sourceVideoBlob)
    if (old) { try { old.pause(); old.removeAttribute('src'); old.load(); } catch { /* ignore */ } env.untagSourceVideo?.(old); }
    env.clip.trim.inT = 0; env.clip.trim.outT = 1; env.clip.trim.mode = 'forward';        // the baked clip is the full processed clip
    // THE BAKED CLIP NEEDS ITS OWN DECODE. Everything above swapped the <video>; on iOS
    // the thing that actually carries the picture is the native decode, and it is still
    // running the clip we just replaced. Detach unconditionally (so a failed re-attach
    // can never leave the old decode driving the new source) then hand the baked bytes
    // over exactly as a file load does — including its "preparing the clip for native
    // playback…" status, which is the affordance Daniel expected to see here.
    env.detachNativeVideo?.();
    // the bake cover is still up at this point (bakeAndApply clears it in its finally),
    // so say what we are doing rather than leaving "baking…" on screen through a step
    // that can take as long as the bake did on a long 4K clip
    const cover = document.getElementById('clipBaking');
    if (cover) cover.textContent = 'preparing the loop for playback…';
    await env.attachNativeVideo?.(v, { name: 'loop.mp4' });
    const meta = document.getElementById('sourceMeta');
    if (meta) meta.children[0].textContent = `${v.videoWidth} × ${v.videoHeight}`;
    env.arrangeSlots();
    rebindClipToTimeline();
    // ⚠️ B740 — ASSERT LOOP-NESS FOR THE TWO MODES THAT GUARANTEE IT, AND ONLY THOSE.
    //
    // Daniel, 2026-08-24: *"coming back from the loop builder and opening in motion, it wasn't able
    // to autodetect that my source loops now."* `applyBakedClip` swaps `env.sourceVideo` directly
    // and never runs `source-host.js`'s post-load sequence, so `detectLoopFromFrames` →
    // `setLoopClip` never fired and motion kept the old clip's answer.
    //
    // A `slice` or `bounce` bake is seamless BY CONSTRUCTION — a bounce ends where it starts, and a
    // slice is the whole point of the operation — so this ASSERTS rather than re-running a frame
    // comparison that could only agree with us. **`forward` is a trim, not a loop** (its button even
    // reads *"apply trim"*), and asserting there would be a new bug replacing an old one.
    if (bakedMode === 'slice' || bakedMode === 'bounce') env.setLoopClip?.(true);
  }

  // dismiss the post-bake nudge and close the mode (the nudge actions call this
  // before switching modes / opening the export sheet).
  function closeLoopBuilderNudge() { hideLoopSurface(); }

  // ---- transport (play/pause + jump), for touch (no keyboard) and space --------
  function updatePlayButton() { const b = byId('loopPlay'); if (b) b.textContent = env.clip.raf ? 'pause' : 'play'; }
  function toggleLoopPlayback() {
    if (env.clip.raf) stopClipPreview();
    else if (env.clip.prevVideo) startClipPreview(false);
    updatePlayButton();
  }
  // meaningful markers on the CURRENT timeline view (as track fractions): loop ends + trim
  // handles + slice cut on the linear steps; loop ends + seam + crossfade edges on the reseq.
  function loopEventFracs() {
    const trim = env.clip.trim, evs = [0, 1];
    if (isResequenced()) {
      const g = reseqGeom();
      evs.push(g.seam, g.seam - g.cfFrac, g.seam + g.cfFrac);
    } else {
      evs.push(trim.inT, trim.outT);
      if (trim.mode === 'slice') evs.push(trim.inT + trim.slicePoint * (trim.outT - trim.inT));
    }
    return [...new Set(evs.map((f) => Math.max(0, Math.min(1, f))))].sort((a, b) => a - b);
  }
  function loopJump(dir) {
    const v = env.clip.prevVideo; if (!v) return;
    stopClipPreview(); updatePlayButton();
    const cur = mediaToBarFrac(v.currentTime), evs = loopEventFracs();
    let target = dir > 0 ? evs.find((f) => f > cur + 0.004) : evs.filter((f) => f < cur - 0.004).pop();
    if (target == null) target = dir > 0 ? evs[evs.length - 1] : evs[0];
    clipScrubToFrac(target);
    setPlayheadFrac(target);
  }

  // SPACE = play/pause the preview (not "commit to bake"). Capture-phase so it beats the
  // focused primary button's default space-activation.
  document.addEventListener('keydown', (e) => {
    if (!document.body.classList.contains('loop-active')) return;
    if (e.code !== 'Space' && e.key !== ' ') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault(); e.stopPropagation();
    toggleLoopPlayback();
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
  // ⚠️ B752 — THE SCRIPTED-RUN SEAM FOR BAKE. Same rule as `env.outputActions` and
  // `env.renderActions`: wrap the real function, never re-implement it.
  //
  // ⚠️ IT DOES NOT SET THE MODE, AND THAT IS DELIBERATE. Choosing a behaviour goes through
  // `chooseBehavior`, which drives loop-builder rail UI that may not be mounted when a script runs.
  // Driving UI that might not exist is the re-implementation defect this seam exists to avoid, so
  // the verb bakes with whatever mode is set and REPORTS it instead. Set the mode by hand first.
  //
  // ⚠️⚠️ AND THE ONE THING THAT WILL STALL AN UNATTENDED RUN: a failed bake raises `alert()`
  // (lines 876 and 1161), which blocks JavaScript until a human dismisses it. Measured
  // `dialog-blocked` of 243s, 289s and once 1827s. **A scripted bake that fails does not report a
  // failure, it stops the device at a modal until the operator returns.** Filed since B707 as the
  // worst operator-facing defect in the arc; named here because the runner's whole premise is
  // walking away.
  // ⚠️ B755 — `forward` IS NOT A BAKE, AND THE FIRST SCRIPTED RUN FOUND THAT THE HARD WAY.
  // Daniel's A3 aborted at step 3 with *"it declined in forward mode and published no reason"*.
  // The message was right and the REFUSAL WAS TOO LATE: forward is trim-only, `bakeAndApply` handles
  // only `slice` and `bounce`, and this file already says so at the B719 note further down. A
  // precondition knowable at step zero must be checked at step zero (B666's rule).
  const BAKEABLE_MODES = ['slice', 'bounce'];
  env.bakeActions = {
    bakeableModes: BAKEABLE_MODES.slice(),
    available: () => !!env.sourceVideo && BAKEABLE_MODES.includes(env.clip.trim?.mode),
    // Why it is not available, in the operator's words rather than a boolean.
    why: () => (!env.sourceVideo ? 'no source video loaded'
      : !BAKEABLE_MODES.includes(env.clip.trim?.mode)
        ? `the Loop Builder is in "${env.clip.trim?.mode || 'no'}" mode, which is a trim and not a bake`
          + ` — choose slice or bounce in the Loop Builder first`
        : null),
    isBaking: () => !!env.clip.baking,
    mode: () => env.clip.trim?.mode || null,

    async run() {
      if (env.clip.baking) return { ok: false, why: 'a bake is already running' };
      if (!env.sourceVideo) return { ok: false, why: 'no source video loaded' };
      const mode = env.clip.trim?.mode || null;
      if (!BAKEABLE_MODES.includes(mode)) return { ok: false, why: env.bakeActions.why() };

      // ⚠️⚠️ B756 — I PICKED THE WRONG NOUN AT B752, AND DANIEL'S FIRST A3 RUN PROVED IT.
      //
      // B752 used "did `env.bakeDecode.at` change" as the success test, reasoning that only a bake
      // which actually ran reaches the teardown that stamps it. **The teardown runs on EVERY exit
      // path** — its own comment three hundred lines down says so explicitly: *"every exit from a
      // bake runs it — completed, thrown, context loss"*. So a bake that raised `alert('Could not
      // bake the clip')` reported `ok: true` with a tidy `mode: slice, holes: 0`.
      //
      // That is the wrong-noun test failing exactly as DEBUGGING-PROTOCOL describes: the quantity
      // counted ("the teardown ran") equals the thing cared about ("the bake produced a clip") only
      // if the teardown is success-only, and it never was.
      //
      // **The right conserved quantity is the SOURCE SWAP.** A successful bake ends in
      // `applyBakedClip`, which installs the new clip as the source; a failed one never gets there.
      // Both checks are kept, because they distinguish three outcomes rather than two:
      //   teardown never ran        -> declined before starting
      //   teardown ran, no swap     -> the bake FAILED (and has raised a modal)
      //   teardown ran, source swap -> success
      const before = env.bakeDecode?.at || null;
      const srcBefore = env.sourceVideo?.currentSrc || env.sourceVideo?.src || null;
      const t0 = performance.now();
      try { await bakeAndApply(); }
      catch (e) { return { ok: false, why: `the bake threw: ${e?.message || e}` }; }

      const d = env.bakeDecode || null;
      const wallSec = +((performance.now() - t0) / 1000).toFixed(1);
      const srcAfter = env.sourceVideo?.currentSrc || env.sourceVideo?.src || null;
      const detail = {
        mode, wallSec,
        srcPx: d?.srcW ? `${d.srcW}x${d.srcH}` : null,   // B756 — bakeDecode has srcW/srcH, never w/h
        reader: d?.reader || (d ? 'webcodecs' : null),
        holes: d?.holes ?? null,
        peakMB: d?.mem?.peakMB ?? null,
        heldMB: d?.mem?.heldMB ?? null,
      };
      if (!d || d.at === before) {
        return { ...detail, ok: false, why: `the bake returned without reaching its teardown — it declined in "${mode}" mode and published no reason` };
      }
      if (srcAfter && srcAfter === srcBefore) {
        // ⚠️ The operator is looking at `alert('Could not bake the clip: …')` RIGHT NOW, and the
        // script is blocked behind it. Say that, because the run's own log is the only place this
        // will be legible afterwards.
        return { ...detail, ok: false,
                 why: 'the bake ran to its teardown but never swapped the source in — it FAILED,'
                    + ' and has raised a modal that blocks the rest of the run until it is dismissed' };
      }
      return { ...detail, ok: true, why: d.why || null };
    },
  };

  // stepped Loop Builder flow
  env.loopPrimaryAction = loopPrimaryAction;
  env.loopBack = goBack;
  env.chooseBehavior = chooseBehavior;
  env.chooseAndAdvance = chooseAndAdvance;
  env.jumpToStep = jumpToStep;
  env.setCrossfadeSec = setCrossfadeSec;
  env.getCrossfadeSec = () => env.clip.trim.crossfadeMs / 1000;
  env.makeXfadeSeamHandle = makeXfadeSeamHandle;
  env.makeSeamEndpointHandle = makeSeamEndpointHandle;
  env.selectLoopEntity = selectLoopEntity;
  env.renderFormatSpec = renderFormatSpec;
  env.toggleLoopPlayback = toggleLoopPlayback;
  env.loopJump = loopJump;
  env.refreshLoopBuilder = refreshLoopBuilder;
  env.barFracToMedia = barFracToMedia;   // scrub mapping (view-aware: full / trimmed / resequenced)
  env.clipScrubToFrac = clipScrubToFrac; // scrub that previews the dissolve inside the crossfade zone
  env.exitLoopBuilder = exitLoopBuilder;   // the mode picker + upload route here
  env.loopIsActive = () => document.body.classList.contains('loop-active');
}
