// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/source-host.js
//
// The SOURCE host: everything that gets pixels INTO the engine and back OUT as a
// still. Three concerns that share the source-identity tuple (env.media):
//   - media loading: loadImage / loadVideo (+ stopSourceVideoPlayback)
//   - live camera: the getUserMedia host + its continuous render loop, flip,
//     capture-to-still (a HOST capability, not a separate chrome — the live
//     <video> flows into the same engine/overlay machinery as any source)
//   - still export: doExport / exportPackage (+ buildFilename, downloadBlob)
//
// Extracted from main.js (Phase 2b). Collaborators are reached via late-bound
// env handles (env.haltPlayback, env.rebindMotionToSource, env.arrangeSlots,
// env.sourceOverlay, …); the host's public surface is
// hung back on env for the chrome's control/upload wiring.

import { createCamera } from './camera.js';
import { createCameraSettings } from './camera-settings.js';
import { createCameraTouchControls } from './camera-touch.js';
import { ICONS } from '../mobile/icons.js';   // shared glyph set (camera flip)
import { seekVideoTo, createVideoElementClock } from './video-source.js';
import { zipStore } from './zip.js';
import { createSaveFlow } from './save-flow.js';
import { getActiveForm } from '../engine/index.js';
import { acquireSession, releaseSession } from 'conduit/sessions';

// The token lives on the element itself so a release cannot be aimed at the wrong one when two
// elements are briefly alive (which is precisely the state the audit found).
const SESSION_TOKEN = Symbol('foldSessionToken');

export function createSourceHost(env) {
  const { state, session, engine } = env;
  const statusEl = document.getElementById('status');
  const exportStatusEl = document.getElementById('exportStatus');   // export feedback lives in the save modal, not the global status line
  const uploadErrorEl = document.getElementById('uploadError');

  // ============================================================================
  // image / video loading
  // ============================================================================

  // ⚠️ B630 — THE SOURCE-SWAP TRACE. Daniel, mid-show: a live camera ran ~10 minutes, he picked a
  // file, and **nothing happened — no error, no visible attempt to load** — recoverable only by
  // killing and relaunching the app. It has happened once, so it may well be a slippery repro; the
  // point of this is that we do not need to catch it live. Every attempt records its phase and
  // every exit records a REASON, so `copy report` after the next occurrence names the step it died
  // on. This is the standing rule (anything that can decline to act must publish why) applied to
  // the one path where a silent decline costs a performance.
  const SWAP_LOG_MAX = 12;
  env.sourceSwapLog = [];
  function swapTrace(phase, detail) {
    const e = { t: new Date().toISOString().slice(11, 23), phase, ...(detail || {}) };
    env.sourceSwapLog.push(e);
    if (env.sourceSwapLog.length > SWAP_LOG_MAX) env.sourceSwapLog.shift();
    return e;
  }
  // A DEAD END IS THE ONE OUTCOME THE OPERATOR MUST SEE. Anything that stops the swap without
  // producing a source says so next to the upload control, and names the report as the way to
  // hand it over — the message is useless if it only reaches a console nobody attaches to.
  function swapFailed(reason, hint) {
    swapTrace('failed', { reason });
    if (uploadErrorEl) {
      uploadErrorEl.textContent = `could not load that source: ${reason}.${hint ? ' ' + hint : ''} `
        + 'Open diagnostics → frame cost → "copy report" and send it — the trace of this attempt is in it.';
    }
    console.warn('[fold] source swap failed:', reason);
  }
  env.swapFailed = swapFailed;

  function loadImage(file) {
    swapTrace('loadImage:start', { name: file?.name, type: file?.type, size: file?.size,
      live: !!env.live?.isLive, frozen: !!env.live?.frozen, hasVideo: !!env.sourceVideo });
    if (!engine) return swapFailed('the render engine is not available');
    if (env.live.isLive || env.live.frozen) stopCameraMode({ keepSource: true });  // uploading exits the camera workflow
    releaseSourceVideo();                               // release the outgoing decoder before switching
    env.haltPlayback();                                 // stop motion playback before swapping the source
    env.filmstrip.lastSig = '';                         // any existing keyframe thumbs are from the old source
    env.sourceVideo = null;                            // switching to a still clears any source video
    env.detachNativeVideo?.();                         // release the single native decode
    if (env.media.sourceVideoUrl) { URL.revokeObjectURL(env.media.sourceVideoUrl); env.media.sourceVideoUrl = null; }
    env.media.sourceVideoBlob = null;
    const url = URL.createObjectURL(file);
    env.media.sourceFilename = (file.name || 'image').replace(/\.[^.]+$/, '');
    env.media.originalSource = { blob: file, name: file.name || 'original' };  // for export package
    const img = new Image();
    // Clear any prior upload error before attempting this load.
    if (uploadErrorEl) uploadErrorEl.textContent = '';

    // A WATCHDOG, because the reported symptom is that NEITHER callback fires. If the decode
    // neither loads nor errors within this window the attempt is silently dead, which is exactly
    // what Daniel saw — and without this nothing would ever record that fact.
    let settled = false;
    const watchdog = setTimeout(() => {
      if (settled) return;
      swapFailed('the image never finished decoding (no load and no error in 8s)',
        'This is the silent hang from the B630 report.');
    }, 8000);

    img.onload = () => {
      settled = true; clearTimeout(watchdog);
      swapTrace('loadImage:decoded', { w: img.naturalWidth, h: img.naturalHeight });
      try {
        engine.setSource(img);
        env.centerSliceInSource?.();      // B615: new source → centre the form's box, orient to its long edge
      } catch (e) {
        // Engine throws with a descriptive message (e.g. "image too large for
        // GPU: 18000×18000 (max 16384×16384 on this device)"). Surface near
        // the upload control (not the export status pane) so it's actually
        // discoverable. When the cap is a Firefox RFP limit and not a real
        // hardware constraint, append a hint to try Safari.
        let msg = e.message;
        if (env.capabilities.firefoxTextureCapped && /too large/i.test(msg)) {
          msg += ' Firefox limits WebGL to 8K — try Safari for full-size images on Apple Silicon.';
        }
        swapTrace('failed', { reason: 'engine.setSource threw', message: e.message });
        if (uploadErrorEl) uploadErrorEl.textContent = msg;
        statusEl.textContent = '';
        statusEl.classList.remove('error', 'busy', 'success');
        console.error(e);
        return;
      }

      document.getElementById('sourceMeta').children[0].textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
      document.getElementById('sourceMeta').children[1].textContent = file.name;
      document.getElementById('swapBtn').disabled = false;

      // the source panel's meta line is the ONE home for source info (Arc 2c dedup) —
      // the top-left caption stays empty for resting state, carrying only transients/errors
      statusEl.textContent = '';
      statusEl.classList.remove('error', 'busy');
      if (uploadErrorEl) uploadErrorEl.textContent = '';

      env.updateSrcScrub?.();
      env.updateMotionUI();   // re-enable motion mode for a still (it's gated off for video sources)
      env.arrangeSlots();
      if (env.motionRT.active) env.rebindMotionToSource();          // already animating → re-bind keyframes to the new still
      else if (env.performRT?.active) env.refreshPerformSource?.();  // performing → swap source in place, no mode change
    };
    img.onerror = () => {
      settled = true; clearTimeout(watchdog);
      // "failed to load image" alone told the operator nothing they could act on or hand over.
      swapFailed('the browser could not decode the file', `Format reported as "${file?.type || 'unknown'}".`);
      statusEl.textContent = '';
      statusEl.classList.remove('error', 'busy', 'success');
    };
    swapTrace('loadImage:decoding');
    img.src = url;
  }

  // Load a source VIDEO (Build 133). Mirrors loadImage, but the source is a paused
  // <video> the engine samples like any other texture source (it already accepts a
  // <video> — the live camera uses the same path). This first increment loads the
  // video and kaleidoscopes its FIRST frame as a static source (full slice/canvas
  // editing works on it like a still). Binding it to the motion timeline (scrub +
  // keyframes over the moving footage) is the next increment.
  // opts.srcUrl: play from this URL instead of an object URL of `file` — the
  // native-transcode retry path (the ORIGINAL file stays the package's
  // originalSource; the transcoded temp movie is just what the engine plays).
  // A clip "reads as a loop" when its first and last frames are nearly identical. Loops built
  // by slicing between frames are NOT pixel-identical, so we compare a 32×32 downscale and
  // allow a tolerance (LOOP_MATCH_THRESHOLD = a per-channel mean abs difference, 0..255).
  // Decode on a throwaway hidden <video>: PRIME the decoder first (a never-played video paints
  // blank on the first drawImage on Blink → every clip would read black-vs-real = "not a loop")
  // and wait for each seeked frame to actually PRESENT (requestVideoFrameCallback). Returns
  // true/false, or null if the capture looked unreliable (caller keeps the current default).
  const LOOP_MATCH_THRESHOLD = 28;   // calibrated on real clips: loops read ~2, non-loops ~80 (2026-07-21)
  async function detectLoopFromFrames(srcUrl, inT, outT) {
    const dv = document.createElement('video');
    dv.muted = true; dv.playsInline = true; dv.preload = 'auto';
    dv.setAttribute('muted', ''); dv.setAttribute('playsinline', '');
    dv.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    dv.src = srcUrl;
    const probeToken = acquireSession('decode', 'loop-detect probe');
    document.body.appendChild(dv);
    // resolve on the next PRESENTED frame (rVFC is exact; a timeout is the fallback)
    const nextFrame = () => new Promise((res) => {
      let done = false;
      if (dv.requestVideoFrameCallback) dv.requestVideoFrameCallback(() => { done = true; res(); });
      setTimeout(() => { if (!done) res(); }, dv.requestVideoFrameCallback ? 150 : 90);
    });
    try {
      await new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('timeout')), 5000);
        dv.addEventListener('loadeddata', () => { clearTimeout(to); res(); }, { once: true });
        dv.addEventListener('error', () => { clearTimeout(to); rej(new Error('load')); }, { once: true });
      });
      const dur = (isFinite(dv.duration) && dv.duration) ? dv.duration : 0;
      if (!dur) return null;
      try { await dv.play(); await nextFrame(); dv.pause(); } catch { /* muted autoplay is usually allowed */ }
      const cvs = document.createElement('canvas'); cvs.width = 32; cvs.height = 32;
      const ctx = cvs.getContext('2d', { willReadFrequently: true });
      const grab = async (sec) => {
        await seekVideoTo(dv, Math.max(0, Math.min(dur - 0.01, sec)));
        await nextFrame();                     // wait for the seeked frame to actually present
        ctx.drawImage(dv, 0, 0, 32, 32);
        return ctx.getImageData(0, 0, 32, 32).data;
      };
      const first = await grab(inT * dur + 0.03);
      const last = await grab(outT * dur - 0.05);
      const lum = (d) => { let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4 * 3); };
      let sum = 0;
      for (let i = 0; i < first.length; i += 4) {
        sum += Math.abs(first[i] - last[i]) + Math.abs(first[i + 1] - last[i + 1]) + Math.abs(first[i + 2] - last[i + 2]);
      }
      if (lum(first) < 2 && lum(last) < 2) return null;   // both frames black → capture unreliable, abstain
      return (sum / (first.length / 4 * 3)) < LOOP_MATCH_THRESHOLD;
    } catch { return null; }
    finally {
      try { dv.pause(); } catch { /* ignore */ }
      dv.removeAttribute('src'); try { dv.load(); } catch { /* ignore */ } dv.remove();
      releaseSession(probeToken);
    }
  }
  function loadVideo(file, opts = {}) {
    if (!engine) return;
    // uploading a new clip while in Loop Builder resets the process — warn on unsaved
    // first (exitLoopBuilder); if the user backs out, abort the load
    if (env.loopIsActive?.() && !opts.srcUrl && !env.exitLoopBuilder?.()) return;
    // ⚠️ B646 — THE VIDEO PATH HAD NO TRACE AND NO WATCHDOG. B630 built both and wired them to
    // `loadImage` only, so the claim that the swap trace covered "picker → guard → decode" was true
    // for stills and false for clips. Daniel's dead end — *"switching from live camera back to a
    // video source won't load the video"* — is on THIS path, which is why his report stops at
    // `guard:discard-then-load` with nothing after it. An uncollectable diagnostic is no
    // diagnostic; that was the whole lesson of B630 and half the code missed it.
    //
    // `wasLive` is recorded because the reported repro always comes FROM the camera, and
    // `keepSource: true` deliberately leaves the camera's last frame standing as the source — so a
    // silent failure here looks exactly like "nothing happened" rather than like a broken source.
    const wasLive = !!(env.live.isLive || env.live.frozen);
    swapTrace('loadVideo:start', { name: file?.name, type: file?.type, size: file?.size, wasLive });
    if (env.live.isLive || env.live.frozen) stopCameraMode({ keepSource: true });   // uploading exits the camera workflow
    releaseSourceVideo();                                // release any previously loaded video's decoder
    env.detachNativeVideo?.();                           // a new clip means a new native decode
    env.haltPlayback();                                  // stop motion playback before swapping the source
    env.filmstrip.lastSig = '';                          // any existing keyframe thumbs are from the old source
    env.clip.trim.inT = 0; env.clip.trim.outT = 1; env.clip.trim.mode = 'forward';  // a new clip starts untrimmed
    if (env.media.sourceVideoUrl) { URL.revokeObjectURL(env.media.sourceVideoUrl); env.media.sourceVideoUrl = null; }
    const url = opts.srcUrl || URL.createObjectURL(file);   // revoke on a file:// URL is a harmless no-op
    env.media.sourceVideoUrl = url;
    // the bytes behind that URL, for consumers that need to size/slice the clip
    // without materializing it (external-display staging). A transcoded file://
    // URL isn't backed by this File, so don't claim it is.
    env.media.sourceVideoBlob = opts.srcUrl ? null : file;
    env.media.sourceFilename = (file.name || 'video').replace(/\.[^.]+$/, '');
    env.media.originalSource = { blob: file, name: file.name || 'original' };   // for export package
    if (uploadErrorEl) uploadErrorEl.textContent = '';

    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.loop = true; v.preload = 'auto';
    v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
    // no browser PiP toggle over the source (Firefox overlays one — see camera.js)
    v.disablePictureInPicture = true;
    v.setAttribute('disablepictureinpicture', '');
    let loaded = false;
    // The one outcome that previously left NO trace: the decode neither loads nor errors. Same
    // 8-second budget the image path uses, and the same visible failure, so a hung clip reports
    // itself instead of looking like a no-op.
    const decodeWatchdog = setTimeout(() => {
      if (loaded) return;
      swapTrace('loadVideo:timeout', { readyState: v.readyState, networkState: v.networkState, wasLive });
      swapFailed('the video never finished decoding', 'Try a different file or re-encode it as H.264 mp4.');
    }, 8000);

    v.addEventListener('loadeddata', () => {
      loaded = true;
      clearTimeout(decodeWatchdog);
      swapTrace('loadVideo:loadeddata', { w: v.videoWidth, h: v.videoHeight, dur: +(v.duration || 0).toFixed(2) });
      try {
        engine.setSource(v);            // videoWidth is known now (a frame is decoded)
        env.centerSliceInSource?.();    // B615: new source → centre the form's box, orient to its long edge
      } catch (e) {
        swapTrace('failed', { reason: 'engine.setSource threw', message: e.message });
        if (uploadErrorEl) uploadErrorEl.textContent = e.message;
        statusEl.textContent = '';
        statusEl.classList.remove('error', 'busy', 'success');
        console.error(e);
        return;
      }
      swapTrace('loadVideo:source-set', { w: v.videoWidth, h: v.videoHeight });
      tagSourceVideo(v, `source clip: ${file?.name || 'clip'}`);
      env.sourceVideo = v;              // mountSourceView mounts this element
      env.liveVideo = null;
      attachNativeVideo(v, file);       // iOS: hand PLAYBACK to the single native decode (no-op elsewhere)
      const meta = document.getElementById('sourceMeta');
      // motion data carries DURATION beside the dims (Daniel's spec); meta is the one home
      const dur = isFinite(v.duration) ? ` · ${v.duration.toFixed(1)}s` : '';
      meta.children[0].textContent = `${v.videoWidth} × ${v.videoHeight}${dur}`;
      meta.children[1].textContent = file.name;
      document.getElementById('swapBtn').disabled = false;
      statusEl.textContent = '';
      statusEl.classList.remove('error', 'busy');
      env.updateMotionUI();            // motion mode stays gated off for a video (until timeline binding)
      env.arrangeSlots();              // mounts the <video> into the source slot
      // STILL MODE NO LONGER AUTOPLAYS (Arc 2c, Daniel's universal-sources direction):
      // the mini scrubber under the source picks the frame to work with. One catch —
      // a paused, NEVER-PLAYED video does not paint on Blink/Gecko — so nudge it:
      // play muted, pause after the first frames present, land parked at t=0.
      // motion content lands in the Loop Builder first (Daniel's flow): a fresh video
      // load auto-opens it so trimming/looping is the natural first step. Desktop only
      // (env.openClipEditor is undefined on mobile), and not while an animation is
      // already running (don't yank a mid-motion source swap into a modal), and not
      // when the caller opts out.
      if (env.motionRT.active) {
        env.rebindMotionToSource();    // already animating → re-bind keyframes to the new clip (timeline-driven, no free-run)
        // a source SWAP while already in motion still re-detects loop-ness for the new clip and
        // updates the "is this a loop" toggle (no enterMotion — we're already in motion).
        if (env.openClipEditor && !opts.noLoopBuilder) {
          detectLoopFromFrames(url, env.clip.trim.inT, env.clip.trim.outT).then((isLoop) => {
            if (isLoop != null) env.setLoopClip?.(isLoop);
          });
        }
      } else if (env.performRT?.active) {
        // SWAP source while PERFORMING — do NOT change mode or park the clip (either stacks the
        // motion panel onto perform and interrupts playback — Daniel's bug). Perform's own handler
        // re-homes the timeline + restarts the loop with the new source; the UI stays put ("change
        // sources from anywhere and have the UI stay unchanged").
        env.refreshPerformSource?.();
      } else {
        const park = async () => {
          // Blink only rasterizes a frame for drawImage/texImage2D after a seek
          // that actually MOVES the clock; an occluded, never-presented video
          // otherwise paints BLACK (the Brave/Electron first-load blank panel).
          // The old branch keyed on v.played.length, which proved unreliable
          // (blocked autoplay can still leave played ranges → seek-to-0 landed
          // ~at currentTime → no-op → blank; reproduced + verified in Electron
          // with autoplay-policy=user-gesture-required). So: (1) a GUARANTEED-
          // REAL seek — pick a park target ≥5ms away from wherever the clock
          // sits; (2) VERIFY the paint and retry with a fresh real seek if the
          // panel still reads blank (self-healing whatever the cause; capped,
          // so a genuinely black opening frame settles after 3 tries).
          const parkSeek = async () => {
            const target = Math.abs(v.currentTime - 0.01) < 0.005 ? 0.03 : 0.01;
            await seekVideoTo(v, target);
          };
          // THE ACTUAL ROOT CAUSE (found instrumenting the DMG): the park was
          // RACING buildSrcStrip — updateSrcScrub schedules the thumbnail pass
          // at loadeddata, so two drivers seeked one <video> concurrently,
          // resolving each other's 'seeked' waits; every paint landed mid-seek
          // (blank), and the strip's final restore-to-start repainted nothing.
          // Serialize: the park yields all seeking to a building strip — the
          // strip's finally-block now restores AND re-presents as the last
          // writer (see buildSrcStrip); the park seeks only when it's alone.
          try {
            v.pause();
            if (!srcStrip.building) await parkSeek();
          } catch { /* keep whatever frame presented */ }
          const present = () => {
            engine.updateSourceFrame();
            engine.render(state);
            env.sourceOverlay.paintSourceVideo();
          };
          present();
          for (let i = 0; i < 3 && !srcStrip.building && env.sourceOverlay.sourceVideoBlank?.(); i++) {
            try { await seekVideoTo(v, 0.05 + i * 0.05); await parkSeek(); } catch { break; }
            present();
          }
          env.sourceOverlay.render();
          env.updateSrcScrub?.();
          requestAnimationFrame(() => buildSrcStrip());   // footage thumbs into the frame picker (layout is ready)
          // D1 routing: fresh motion content opens STRAIGHT into the motion editor with an
          // inferred loop/linear default (first-vs-last-frame detection). The Loop Builder is
          // opt-in now — no longer force-opened on load. Desktop/iPad only (env.openClipEditor).
          if (env.openClipEditor && !opts.noLoopBuilder) {
            const isLoop = await detectLoopFromFrames(url, env.clip.trim.inT, env.clip.trim.outT);
            if (isLoop != null) env.setLoopClip?.(isLoop);
            env.enterMotion?.();
          }
        };
        v.play().then(() => setTimeout(park, 80))
          .catch(() => { park(); });   // autoplay refused: loadeddata decoded frame 0 — park directly
      }
    }, { once: true });

    v.addEventListener('error', async () => {
      clearTimeout(decodeWatchdog);
      swapTrace('loadVideo:error', { code: v.error?.code, message: v.error?.message, afterLoad: loaded, wasLive });
      if (loaded) {
        // a decode hiccup AFTER the clip already loaded (seen on some Firefox .mov) —
        // not a codec-support problem, so don't blame ProRes. (Firefox .mov decode
        // robustness is a tracked, deferred issue.)
        console.warn('source video decode error after load', v.error);
        return;
      }
      // Chromium can't decode this codec — but the HOST may (Electron: macOS's
      // avconvert reads anything AVFoundation does, ProRes above all, and
      // hands back hardware HEVC the engine plays). One-time per import; the
      // original file stays the export package's originalSource.
      const md = env.host?.mediaDecoder;
      if (md?.available && !opts.srcUrl) {
        const srcPath = md.pathForFile?.(file);
        if (srcPath) {
          statusEl.textContent = 'converting with the native decoder…';
          statusEl.classList.add('busy');
          try {
            const out = await md.transcode(srcPath);
            statusEl.textContent = '';
            statusEl.classList.remove('busy');
            console.info(`[fold] native transcode: ${file.name} → ${out.url}`);
            loadVideo(file, { srcUrl: out.url });
            return;
          } catch (e) {
            statusEl.textContent = '';
            statusEl.classList.remove('busy');
            console.warn('[fold] native transcode failed:', e);
          }
        }
      }
      if (uploadErrorEl) uploadErrorEl.textContent = 'could not load this video — the browser may not support its codec (ProRes works only in Safari and the desktop app). Try an H.264 or HEVC .mp4/.mov.';
      statusEl.textContent = '';
      statusEl.classList.remove('error', 'busy', 'success');
    });

    v.src = url;
  }

  // Stop a loaded source video's render loop + pause it. When the camera is live it
  // owns the loop, so leave it alone in that case (its own lifecycle stops it).
  //
  // ⚠️ THIS PAUSES. IT DOES NOT RELEASE, AND IT MUST NOT — `motion-runtime.js` calls it on entry
  // to motion mode precisely to stop the free-run loop while the timeline keeps driving the SAME
  // element. Releasing here would destroy the source on a mode switch. Swapping sources wants
  // `releaseSourceVideo` below instead.
  function stopSourceVideoPlayback() {
    if (!env.live.isLive) stopLiveLoop();
    if (env.sourceVideo) { try { env.sourceVideo.pause(); } catch { /* ignore */ } }
  }

  // Give the decoder back. Call this on any path that is DONE with the current source video.
  //
  // ⚠️ SESSION AUDIT 2026-08-19 — THE SWAP PATHS USED TO ONLY `pause()`, AND THAT IS NOT A RELEASE.
  // A paused <video> at readyState 4 still holds its decode pipeline; dropping the reference does
  // not free it, `innerHTML = ''` in mountSourceView only DETACHES it, and revoking the object URL
  // does nothing to an element that already loaded it. So every source swap left the outgoing 4K
  // decoder alive for an unbounded time.
  //
  // **And the overlap was not merely deferred to the GC.** `loadVideo` sets the incoming element's
  // `src` and does not reassign `env.sourceVideo` until that element's `loadeddata` fires, so the
  // OUTGOING decoder was guaranteed to still be live for the whole decode of the INCOMING one.
  // Two 4K decode sessions, every swap, landing exactly at the transition where the GL context
  // losses actually happen — they cluster at onsets, not under accumulated load (T7 held forty
  // unbroken minutes at thermal `serious` with zero events).
  //
  // The three-call idiom is not new: it is already written six times in this codebase
  // (clip-editor ×4, detectLoopFromFrames, stage-source's `end`). It was missing on the one path
  // the user hits constantly.
  function releaseSourceVideo() {
    stopSourceVideoPlayback();
    const v = env.sourceVideo;
    if (!v) return;
    try { v.removeAttribute('src'); } catch { /* ignore */ }
    try { v.load(); } catch { /* ignore */ }   // the call that actually tears the pipeline down
    releaseSession(v[SESSION_TOKEN]);
    v[SESSION_TOKEN] = 0;
  }

  // Adopt an element built elsewhere as the source video, so its decode is counted like any other.
  // The Loop Builder's bake mints its own <video> and assigns `env.sourceVideo` directly; without
  // this the registry would under-count after every bake, and an under-count reads as "we are
  // fine", which is the one thing an instrument must never say by omission.
  function tagSourceVideo(v, label) {
    if (v) v[SESSION_TOKEN] = acquireSession('decode', label);
  }
  // The other half: a caller that released an element itself (the bake) hands it back here so the
  // count follows the element rather than assuming every release goes through `releaseSourceVideo`.
  function untagSourceVideo(v) {
    if (!v) return;
    releaseSession(v[SESSION_TOKEN]);
    v[SESSION_TOKEN] = 0;
  }

  // ============================================================================
  // live camera (Phase 0.5 — camera host module wired into the desktop/iPad chrome)
  // ============================================================================
  //
  // The camera is a HOST capability, not a separate chrome: getUserMedia gives a
  // live <video> that flows into the SAME engine + source-view + wedge-overlay
  // machinery as a still image. The only structural addition is a continuous
  // render loop (the still path is render-on-demand). Capture freezes the frame
  // as a normal editable still; nothing is saved automatically — the original is
  // saved alongside the kaleidoscope on the first export (see doExport).

  // The web camera by default; swapped for the NATIVE camera (AVCaptureSession —
  // EV/WB/lens/48MP + the HDMI frame relay) on first camera entry when the host
  // offers it (Capacitor iPad). Lazy import so the desktop web bundle never
  // carries @capacitor/core; interface-compatible by design, so every call site
  // below works on either. `let` because the swap replaces the instance.
  let camera = createCamera();
  let cameraIsNative = false;
  async function ensureNativeCamera() {
    if (cameraIsNative || !env.host?.nativeCamera?.available) return;
    const m = await import('./native-camera.js');
    camera = m.createNativeCamera();
    cameraIsNative = true;
    console.info('[fold] native camera path active (desktop chrome)');
  }
  // ONE place the camera becomes the engine's source, so the planar hand-off can never be
  // attached at some entry points and missed at others (go-live, device pick, flip, and the
  // lens/resolution re-acquire all land here).
  //
  // B549: this is B518's fix, which the PHONE got and the iPad never did. The desktop chrome
  // swaps in the native camera on Capacitor but only ever called `setSource`, so the engine kept
  // sampling the camera's own WebGL canvas cross-context — Daniel's iPad measured **15.47ms per
  // frame to upload a 0.79MP texture**, against 1.91ms for an 8.29MP 4K source on the iPhone.
  // Ten times fewer pixels at eight times the cost is the round-trip signature, not a size cost.
  //
  // setSource FIRST — it records the aspect and gives the engine a valid element for the frames
  // before the first plane arrives — then hand over the planes. Re-attaching on every acquisition
  // matters: each restart is a NEW socket, so a reader bound to the old one would sit at
  // "nothing new" forever and the source would freeze.
  function attachCameraSource() {
    engine.setSource(camera.frameSource());
    if (cameraIsNative && camera.planeReader) engine.setPlanarSource(camera.planeReader(), 0);
    else engine.setPlanarSource(null);
  }

  const CAMERA_DEVICE_KEY = 'fold.cameraDeviceId';   // last-picked camera, persisted across sessions
  const CAMERA_FACING_KEY = 'fold.cameraFacing';     // last-used lens — a resume must return to it

  // Default facing by device. Touch devices (iPad) default to the rear camera
  // ("frame the world"); desktops have no real rear camera and want the front
  // (mirrored, selfie-intuitive) by default.
  const DEFAULT_FACING =
    matchMedia('(pointer: coarse)').matches ? 'environment' : 'user';

  // Start the camera, preferring the last-picked device when it's still present.
  // A stale/blocked deviceId (the cam was unplugged, or is in use) throws
  // OverconstrainedError/NotReadableError → fall back to the default facing.
  async function startWithPreferredDevice() {
    await ensureNativeCamera();
    // saved web deviceIds mean nothing to the native camera (it drives lenses,
    // not enumerated devices) — skip straight to the facing preference there
    const savedId = cameraIsNative ? null : localStorage.getItem(CAMERA_DEVICE_KEY);
    if (savedId) {
      try { return await camera.start({ deviceId: savedId }); }
      catch { /* device gone or busy — fall through to default */ }
    }
    // LAST-CHOSEN FACING BEATS THE DEVICE DEFAULT (B564, Daniel). Pausing a front-camera
    // session and resuming it came back on the REAR lens, because the native path has no saved
    // deviceId to honour and fell through to DEFAULT_FACING every time. Un-pausing is a resume,
    // not a fresh start: it must return to the lens you were on. The device default now applies
    // only to a genuinely first run.
    let facing = DEFAULT_FACING;
    try { facing = localStorage.getItem(CAMERA_FACING_KEY) || DEFAULT_FACING; } catch { /* private mode */ }
    try { return await camera.start({ facingMode: facing }); }
    catch { return camera.start({ facingMode: DEFAULT_FACING }); }
  }
  // Remember the lens whenever one is actually running, so flip / picker / first-run all persist
  // through the same path rather than each remembering separately.
  function rememberFacing() {
    try {
      const f = camera.getFacing?.();
      if (f) localStorage.setItem(CAMERA_FACING_KEY, f);
    } catch { /* private mode */ }
  }

  // Populate / show the multi-camera picker. Device labels need permission, so this
  // runs only after a stream is live. Show the picker (replacing the front/rear flip
  // button) only when ≥2 labeled cameras exist — the desktop/installation case (a USB
  // webcam vs the built-in / iPhone Continuity cam); a single-camera device keeps flip.
  // ⚠️ B685 — TWO SHAPES, AND B684 BROKE THIS BY CHANGING ONE OF THEM.
  //
  // The web camera's `listDevices()` returns `{ deviceId, label }`. The native one returned a
  // hardcoded `[]` until B684 taught it to enumerate — and it returns `{ id, label, kind, ... }`.
  // This function read `d.deviceId`, which is `undefined` on every native row, so each option got
  // the value `"undefined"` and **every selection re-acquired the default camera.** Daniel: *"if i
  // try to select the camera from this list it will always actually pick the back ultra wide."*
  // My mistake, and the avoidable kind: I grepped the callers of the function I renamed and not of
  // the one whose CONTRACT I changed, which is the same class of error either way.
  //
  // ⚠️ AND THE LIST ITSELF WAS WRONG, per Daniel's spec: this menu is the CAMERA, the gear holds
  // that camera's sub-options. iOS enumerates every built-in lens as its own AVCaptureDevice
  // (back, back ultra wide, front, front TrueDepth…), so passing them straight through offered six
  // top-level "cameras" that are really one camera with lenses. The built-ins collapse to a single
  // entry here; front/rear and lens live in the gear where they belong, and hide when an external
  // camera is selected because they mean nothing for it.
  function cameraChoices(devices) {
    if (!cameraIsNative) {
      // unlabeled = no permission yet for that device
      return devices.filter((d) => d.label).map((d) => ({ id: d.deviceId, label: d.label }));
    }
    const ext = devices.filter((d) => d.kind && d.kind !== 'builtin');
    // '' is the built-in path (native-camera's setDevice reads it as "pick by facing/lens")
    return [{ id: '', label: 'built-in' }, ...ext.map((d) => ({ id: d.id, label: d.label || d.kind }))];
  }

  async function refreshCameraDevices() {
    const select = document.getElementById('cameraSelect');
    const flip = document.getElementById('flipBtn');
    if (!select) return;
    let devices = [];
    try { devices = await camera.listDevices(); } catch { /* enumeration unsupported */ }
    const choices = cameraChoices(devices);
    // ⚠️ B687 — THE SELECTED CAMERA CAN BE UNPLUGGED, AND THE APP HAS TO NOTICE.
    // Daniel: *"after removing the USB camera and returning to the built in, we lose our ability to
    // switch front/back and select lens."* Nothing cleared `deviceId`, so it kept naming a camera
    // that was no longer on the bus — and every gate that asks "is an external camera selected?"
    // kept answering yes. The built-in's own controls stayed hidden on a device that WAS the
    // built-in. **A stale selection is worse than no selection: it silently disables real controls.**
    const activeNow = camera.getDeviceId?.() || '';
    if (activeNow && !choices.some((c) => c.id === activeNow)) {
      try { await camera.setDevice(''); attachCameraSource(); } catch { /* falls through to the list */ }
    }
    const multi = choices.length >= 2;
    // The dropdown is the camera IDENTITY while in camera (Daniel's camera-module
    // spec): always visible, current camera selected, every camera listed, "quit
    // camera" at the bottom. flip still covers the single-camera facing switch.
    select.hidden = false;
    if (flip) flip.hidden = multi;
    const activeId = camera.getDeviceId?.() || '';
    select.innerHTML = '';
    for (const d of choices) {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.label;
      if (d.id === activeId) opt.selected = true;
      select.appendChild(opt);
    }
    if (!choices.length) {
      const opt = document.createElement('option');
      opt.value = ''; opt.textContent = cameraIsNative ? 'iPad native' : 'camera'; opt.selected = true;
      select.appendChild(opt);
    }
    const sep = document.createElement('option');
    sep.disabled = true; sep.textContent = '────────';
    select.appendChild(sep);
    const quit = document.createElement('option');
    quit.value = '__quit'; quit.textContent = 'quit camera';
    select.appendChild(quit);
  }

  // Picker change: re-acquire that exact camera, persist the choice, re-source.
  // ⚠️ `deviceId` may legitimately be '' on the NATIVE path — that is the built-in entry, and
  // `setDevice('')` is how you get back to it. So the guard tests for live, not for truthiness.
  async function selectCameraDevice(deviceId) {
    if (deviceId == null || !env.live.isLive) return;
    try {
      if (cameraIsNative) {
        // native takes an AVFoundation uniqueID and re-acquires internally (same shape as setLens)
        await camera.setDevice(deviceId);
        env.liveVideo = camera.getVideo?.() || env.liveVideo;
      } else {
        env.liveVideo = await camera.start({ deviceId });
      }
      attachCameraSource();
    } catch (e) {
      if (uploadErrorEl) uploadErrorEl.textContent = cameraErrorMessage(e);
      return;
    }
    if (!cameraIsNative) localStorage.setItem(CAMERA_DEVICE_KEY, deviceId);
    setCameraMeta('live camera');
    updateCameraUI();
    refreshCameraDevices();
    env.arrangeSlots();   // remount picks up the (possibly different) mirror + aspect
  }

  // continuous render driver — runs only while the camera is live. each tick
  // refreshes the (possibly mirrored) frame, re-uploads it, renders, and redraws
  // the overlay.
  function startLiveLoop() {
    if (env.live.active) return;
    env.live.active = true;
    const tick = () => {
      if (!env.live.active) return;
      if (engine) {
        // measured as its own surface (see the phone chrome for the reasoning): the camera path
        // is in the BASELINE of every live session, so if it is expensive nothing else can be cheap
        env.perfSource?.refresh.begin();
        camera.refreshFrame();      // front camera: redraw the mirrored frame
        env.perfSource?.refresh.end();
        env.perfSource?.upload.begin();
        engine.updateSourceFrame();
        env.perfSource?.upload.end();
        engine.render(state);
        // (mini-canvas 2D copy removed — the sibling panels show both real views)
        env.sourceOverlay.paintSourceVideo();   // loaded source video → its 2D preview canvas (no-op otherwise)
      }
      env.sourceOverlay.render();
      env.live.raf = requestAnimationFrame(tick);
    };
    env.live.raf = requestAnimationFrame(tick);
  }
  function stopLiveLoop() {
    env.live.active = false;
    if (env.live.raf) { cancelAnimationFrame(env.live.raf); env.live.raf = 0; }
  }

  function cameraErrorMessage(e) {
    if (e && e.name === 'NotAllowedError') return 'camera permission denied — allow access and try again';
    if (e && e.name === 'NotFoundError') return 'no camera found on this device';
    return 'could not start camera: ' + (e && e.message ? e.message : 'unknown error');
  }

  function setCameraMeta(label) {
    // web camera hands a <video> (videoWidth); the native camera hands its RGB
    // canvas (width) — without the fallback the dims cell stayed "—" and the
    // meta read as a dangling "— live camera" (Daniel's iPad note)
    const v = camera.getVideo();
    const w = v ? (v.videoWidth || v.width || 0) : 0;
    const h = v ? (v.videoHeight || v.height || 0) : 0;
    const meta = document.getElementById('sourceMeta');
    if (w) meta.children[0].textContent = `${w} × ${h}`;
    meta.children[1].textContent = label;
  }

  function updateCameraUI() {
    // The camera button swaps for the in-camera group while live OR frozen. Upload
    // PERSISTS through live camera (sits leftmost, beside that group) so you can switch
    // to an image/video without first quitting the camera — which would clear the source
    // and tear down a live broadcast. loadImage/loadVideo already exit camera with
    // keepSource:true, so the source (and the broadcast) survive the switch.
    const inCamera = env.live.isLive || env.live.frozen;
    document.getElementById('cameraBtn').style.display = inCamera ? 'none' : '';
    document.getElementById('uploadBtn').style.display = '';
    document.getElementById('cameraLive').style.display = inCamera ? 'flex' : 'none';
    // shutter = the capture/live toggle (the mobile pattern) as an icon+text
    // button. Daniel's copy (2026-07-15): live shows PAUSE BARS + "capture"
    // (pressing it captures this frame), frozen shows the GREEN DOT + "live
    // camera" (pressing it goes back live; green = live, red = record-to-disk).
    // The glyph carries the state color; the text stays the button's normal color.
    const shutter = document.getElementById('shutterBtn');
    if (shutter) {
      shutter.innerHTML = env.live.frozen
        ? '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="var(--ok)"/></svg>live camera'
        : '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1.5" width="3" height="9" rx="1" fill="currentColor"/><rect x="7" y="1.5" width="3" height="9" rx="1" fill="currentColor"/></svg>capture';
      shutter.title = env.live.frozen ? 'live camera — resume the feed' : 'capture — freeze this frame';
    }
    // flip is an ICON button (the mobile camera-menu glyph); on the NATIVE path
    // it moves INTO the camera-settings menu (top row — Daniel: the iPhone
    // camera-menu position), so the toolbar button hides there. Nothing to flip
    // while frozen either.
    const flip = document.getElementById('flipBtn');
    if (flip) {
      if (!flip.dataset.icon) { flip.innerHTML = ICONS.flip; flip.classList.add('ot-icon'); flip.dataset.icon = '1'; }
      flip.title = camera.isFront() ? 'switch to the rear camera' : 'switch to the front camera';
      flip.style.display = (env.live.frozen || cameraIsNative) ? 'none' : '';
    }
    camSettings.refresh();  // gear shows only while live + something is adjustable
    env.updateMotionUI();   // motion mode is disabled while the camera is live
  }

  async function startCameraMode() {
    if (!engine) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (uploadErrorEl) uploadErrorEl.textContent = 'camera needs a secure context (https or localhost)';
      return;
    }
    if (uploadErrorEl) uploadErrorEl.textContent = '';
    releaseSourceVideo();        // release the loaded video's decoder before the camera takes over
    env.detachNativeVideo?.();
    if (env.media.sourceVideoUrl) { URL.revokeObjectURL(env.media.sourceVideoUrl); env.media.sourceVideoUrl = null; }
    env.media.sourceVideoBlob = null;
    env.media.originalSource = null;  // no captured original until the shutter fires
    statusEl.textContent = 'starting camera…';
    statusEl.classList.add('busy');
    try {
      const video = await startWithPreferredDevice();
      env.liveVideo = video;
      env.sourceVideo = null;                          // camera takes over the source view
      rememberFacing();       // whatever lens we actually landed on is the one to resume to (B564)
      attachCameraSource();
    } catch (e) {
      env.liveVideo = null;
      statusEl.textContent = '';
      statusEl.classList.remove('busy');
      if (uploadErrorEl) uploadErrorEl.textContent = cameraErrorMessage(e);
      console.error(e);
      return;
    }
    statusEl.classList.remove('busy');
    statusEl.textContent = '';   // the meta line under the source carries "live camera" (Arc 2c dedup)
    env.live.isLive = true;
    env.live.frozen = false;   // (re)entering live — also the "record" half of the pause/record toggle
    env.media.sourceFilename = 'camera';
    setCameraMeta('live camera');
    document.getElementById('swapBtn').disabled = false;
    updateCameraUI();
    refreshCameraDevices();   // now that permission is granted, labels are available
    env.arrangeSlots();
    startLiveLoop();
  }

  // stop the camera. by default returns to the empty placeholder (cancel path);
  // pass { keepSource: true } when another source is about to take over (upload).
  function stopCameraMode({ keepSource = false } = {}) {
    stopLiveLoop();
    camera.stop();
    // RELEASE THE PLANES BEFORE ANYTHING ELSE BECOMES THE SOURCE. `updateSourceFrame` consults
    // the planar provider first and, when its socket has gone quiet, holds the last uploaded
    // plane rather than falling through to the element — so a reader left attached across a
    // source change means the new source never reaches the texture and the panel shows the last
    // camera frame forever. That is the B541 dark-source bug, and `keepSource:true` (the upload
    // path) would walk straight into it, so this runs before the early return, not after.
    try { engine.setPlanarSource(null); } catch { /* engine may be mid-reinit */ }
    env.live.isLive = false;
    env.live.frozen = false;
    env.liveVideo = null;
    updateCameraUI();
    if (keepSource) return;
    engine.clearSource();
    const meta = document.getElementById('sourceMeta');
    meta.children[0].textContent = '—';
    meta.children[1].textContent = '—';
    document.getElementById('swapBtn').disabled = true;
    statusEl.textContent = '';
    statusEl.classList.remove('busy', 'success', 'error');
    env.arrangeSlots();
  }

  async function flipCamera() {
    if (!env.live.isLive) return;
    try {
      const video = await camera.flip();
      env.liveVideo = video;
      rememberFacing();       // a resume must come back to the lens you flipped to (B564)
      attachCameraSource();   // video (rear) or mirror canvas (front)
    } catch (e) {
      if (uploadErrorEl) uploadErrorEl.textContent = cameraErrorMessage(e);
      return;
    }
    setCameraMeta('live camera');
    updateCameraUI();
    refreshCameraDevices();          // keep the picker selection in sync after a flip
    env.arrangeSlots();              // remount picks up the mirror transform + aspect
  }

  // A settings change that RESTARTS the stream (lens / resolution / frame rate —
  // a format change, like flip): run the op, then re-point the engine at the
  // (possibly new) frame source. The camera-settings gear drives this.
  async function reacquireCamera(op) {
    if (!env.live.isLive) return;
    try {
      const video = await op();
      if (video) env.liveVideo = video;
      attachCameraSource();
    } catch (e) {
      if (uploadErrorEl) uploadErrorEl.textContent = cameraErrorMessage(e);
      return;
    }
    setCameraMeta('live camera');
    updateCameraUI();
    env.arrangeSlots();              // remount picks up any changed mirror/aspect
  }

  // the camera-settings gear (desktop/iPad chrome) — capability-driven rows;
  // lifecycle ownership stays here (reacquireCamera above re-points the engine).
  const camSettings = createCameraSettings(env, {
    getCamera: () => camera,
    isNative: () => cameraIsNative,
    reacquire: reacquireCamera,
  });

  // iPad hands-on layer: tap-to-focus + the EV/WB press-hold pad on the source
  // panel (touch-only, native live camera only — the mobile pad ported verbatim).
  createCameraTouchControls(env, {
    getCamera: () => camera,
    isNative: () => cameraIsNative,
  });

  // grab the current camera frame into a canvas at native resolution. mirrored
  // to match the front-camera preview so the saved frame is what the user saw.
  function captureLiveFrame() {
    // the web camera hands a <video> (videoWidth); the native camera hands its
    // RGB canvas (width) — accept either
    const video = camera.getVideo();
    const w = video ? (video.videoWidth || video.width || 0) : 0;
    const h = video ? (video.videoHeight || video.height || 0) : 0;
    if (!w || !h) return null;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d');
    // the native camera bakes the selfie mirror into its canvas (mirrorsInSource)
    // — mirroring again here would double-flip the freeze
    if (camera.isFront() && !camera.mirrorsInSource) { cx.translate(w, 0); cx.scale(-1, 1); }
    cx.drawImage(video, 0, 0, w, h);
    return c;
  }

  // The merged save path (transport + saving/saved/failed status) lives in
  // save-flow.js — both chromes consume the same service, so every file the
  // app writes speaks one language. Kept as a named function so env.downloadBlob
  // and the local call sites read unchanged.
  const saveFlow = createSaveFlow({ host: env.host });
  // published so anything that needs to SAY something transient can use the one status surface
  // rather than inventing another (the governor's degrade notice, B568). Daniel's rule from the
  // scattered-status audit: a panel is for controls, a toast is for status.
  env.saveFlow = saveFlow;
  function downloadBlob(blob, name) {
    return saveFlow.save(blob, name);
  }

  // pause (the shutter's freeze half): freeze the current frame as the new editable
  // still and release the camera hardware — but stay IN the camera workflow (frozen):
  // the dropdown + a red record button remain, and record re-acquires the preferred
  // device. Nothing is saved automatically — the raw frame is stashed as the pending
  // original and written out, with the kaleidoscope, on the first export.
  function captureFrame() {
    const frame = captureLiveFrame();
    if (!frame) return;
    stopLiveLoop();
    camera.stop();
    // same release as stopCameraMode — the frozen still below is a plain element, and a live
    // plane reader would out-rank it and keep the panel showing the feed's last frame
    try { engine.setPlanarSource(null); } catch { /* engine may be mid-reinit */ }
    env.live.isLive = false;
    env.live.frozen = true;
    env.liveVideo = null;
    updateCameraUI();

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    env.media.sourceFilename = `camera-${ts}`;

    frame.toBlob(blob => {
      if (!blob) return;
      env.media.originalSource = { blob, name: `${env.media.sourceFilename}-original.png` };
      // keep the URL alive — the source view paints it via background-image.
      if (env.media.captureObjectURL) URL.revokeObjectURL(env.media.captureObjectURL);
      env.media.captureObjectURL = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        engine.setSource(img);                            // frozen still source
        document.getElementById('sourceMeta').children[0].textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
        document.getElementById('sourceMeta').children[1].textContent = `${env.media.sourceFilename}.png`;
        document.getElementById('swapBtn').disabled = false;
        statusEl.textContent = 'captured — export to save';
        statusEl.classList.remove('busy', 'error', 'success');
        env.arrangeSlots();
      };
      img.src = env.media.captureObjectURL;
    }, 'image/png');
  }

  function wireCamera() {
    document.getElementById('cameraBtn').addEventListener('click', startCameraMode);
    // the shutter is a record/pause toggle: live → freeze; frozen → go live again
    document.getElementById('shutterBtn').addEventListener('click', () => {
      if (env.live.isLive) captureFrame();
      else if (env.live.frozen) startCameraMode();
    });
    document.getElementById('flipBtn').addEventListener('click', flipCamera);
    document.getElementById('cameraSelect').addEventListener('change', (e) => {
      const v = e.target.value;
      if (v === '__quit') {
        // quit while live tears down to the placeholder (the old stop button);
        // quit while frozen just leaves the camera workflow — the frozen still
        // stays as the editable source.
        if (env.live.isLive) stopCameraMode();
        else { env.live.frozen = false; updateCameraUI(); }
        return;
      }
      // ⚠️ '' IS A REAL CHOICE ON THE NATIVE PATH — it is the built-in entry. Testing truthiness
      // here would make "go back to the built-in camera" the one option that silently did nothing.
      if (v == null) return;
      if (!cameraIsNative && !v) return;
      if (env.live.frozen) {
        // picking a camera while frozen resumes live on that device
        if (!cameraIsNative) localStorage.setItem(CAMERA_DEVICE_KEY, v);
        startCameraMode();
        return;
      }
      selectCameraDevice(v);
    });
    // a cam plugged/unplugged mid-session re-evaluates whether to show the picker.
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', () => {
        if (env.live.isLive) refreshCameraDevices();
      });
    }
  }

  // ============================================================================
  // still export
  // ============================================================================

  async function doExport(sizeArg) {
    if (!engine || !engine.getSourceImage()) {
      exportStatusEl.textContent = 'load an image first';
      exportStatusEl.classList.add('error');
      return;
    }

    // resolve size for status messaging
    const cap = engine.diagnostics.maxFBOSize;
    let size = sizeArg === 'max' ? cap : Math.min(parseInt(sizeArg, 10), cap);

    exportStatusEl.textContent = `rendering ${size}×${size}...`;
    exportStatusEl.classList.remove('error');
    exportStatusEl.classList.add('busy');
    // (no setBusy here — the export button's own spinner + this status text are
    // the feedback path; the fullscreen busy overlay would cover the button.)
    // Double rAF so the spinner + status actually PAINT before the synchronous
    // FBO render/readPixels in exportAt blocks the main thread (a single rAF runs
    // its callback before paint, so the spinner never showed — Build 66 regression).
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    let result;
    try {
      result = await engine.exportAt(state, sizeArg, session.exportFormat, undefined, session.frameAspect);
    } catch (e) {
      exportStatusEl.textContent = e.message;
      exportStatusEl.classList.add('error');
      exportStatusEl.classList.remove('busy');
      // restore preview render
      engine.render(state);
      console.error(e);
      return;
    }

    const { blob, size: sz, renderMs, readMs, encodeMs } = result;
    downloadBlob(blob, buildFilename(sz));

    // restore preview render
    engine.render(state);

    exportStatusEl.textContent = `saved ${sz}×${sz} • ${session.exportFormat} • render ${renderMs.toFixed(0)}ms • read ${readMs.toFixed(0)}ms • encode ${encodeMs.toFixed(0)}ms • ${(blob.size / 1024 / 1024).toFixed(1)}MB`;
    exportStatusEl.classList.remove('busy');
    exportStatusEl.classList.add('success');
    setTimeout(() => exportStatusEl.classList.remove('success'), 2500);
  }

  // "export package" — one .zip containing the composition + the unmodified
  // original. A single download (sidesteps the Safari multiple-downloads block),
  // and the seam for future layers (overlay thumbnail, geometry map). See
  // BACKLOG; for now: composition + original only.
  async function exportPackage() {
    if (!engine || !engine.getSourceImage()) {
      exportStatusEl.textContent = 'load an image first';
      exportStatusEl.classList.add('error');
      return;
    }
    const cap = engine.diagnostics.maxFBOSize;
    const size = session.exportSize === 'max' ? cap : Math.min(parseInt(session.exportSize, 10), cap);
    exportStatusEl.textContent = `packaging ${size}×${size}...`;
    exportStatusEl.classList.remove('error');
    exportStatusEl.classList.add('busy');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    let result;
    try {
      result = await engine.exportAt(state, session.exportSize, session.exportFormat, undefined, session.frameAspect);
    } catch (e) {
      exportStatusEl.textContent = e.message;
      exportStatusEl.classList.add('error');
      exportStatusEl.classList.remove('busy');
      engine.render(state);
      console.error(e);
      return;
    }

    const files = [{ name: buildFilename(result.size), blob: result.blob }];
    if (env.media.originalSource) files.push({ name: env.media.originalSource.name, blob: env.media.originalSource.blob });
    const zipBlob = await zipStore(files);
    downloadBlob(zipBlob, `${env.media.sourceFilename}-package-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`);

    engine.render(state);
    exportStatusEl.textContent = `saved package • ${files.length} files • ${(zipBlob.size / 1024 / 1024).toFixed(1)}MB`;
    exportStatusEl.classList.remove('busy');
    exportStatusEl.classList.add('success');
    setTimeout(() => exportStatusEl.classList.remove('success'), 2500);
  }

  function buildFilename(size) {
    const form = getActiveForm(state);
    const f = form.fileCode;
    const formSuffix = form.filenameSuffix ? form.filenameSuffix(state) : '';
    const sliceR = ((state.sliceRotation % 360) + 360) % 360 | 0;
    const canvasR = ((state.canvasRotation % 360) + 360) % 360 | 0;
    const sliceS = Math.round(state.sliceScale * 100);
    const compZ = Math.round(state.canvasZoom * 100);
    const cx = Math.round(state.sliceCx * 1000).toString().padStart(3, '0');
    const cy = Math.round(state.sliceCy * 1000).toString().padStart(3, '0');
    const oob = ['c', 'm', 't'][state.oobMode];
    const ext = session.exportFormat === 'jpg' ? 'jpg' : 'png';
    return `${env.media.sourceFilename}-${f}${formSuffix}-sr${sliceR}-cr${canvasR}-ss${sliceS}-cz${compZ}-xy${cx}${cy}-${oob}-${size}.${ext}`;
  }

  // Wire the camera buttons now (the chrome no longer calls wireCamera directly).
  wireCamera();

  // ---- still-mode frame scrubber (Arc 2c) -----------------------------------
  // A video source in still mode parks paused; this mini timeline under the source
  // picks the frame to work with (no transport by design). Latest-wins seek
  // coalescing so dragging never floods the decoder (the scrubVideo pattern).
  // WHAT THE MINI TIMELINE SPANS — one source of truth, shared with perform-runtime.
  // In still mode it's the frame PICKER, so it spans the whole file (pick any frame).
  // In perform it's the performance TIMELINE, so it spans the TRIMMED range: the Loop
  // Builder's "trim only" is non-destructive but it is real, and a bar that ignored it
  // made an applied trim look like it hadn't applied at all (Daniel, B491 — motion
  // showed the trimmed clip while perform played and displayed the full length).
  function srcScrubSpan() {
    const d = env.sourceClock?.duration || 0;
    if (!d) return null;
    if (!env.performRT?.active) return { d, inSec: 0, outSec: d, span: d };
    const t = env.clip?.trim || {};
    const inSec = Math.max(0, Math.min(d, (t.inT ?? 0) * d));
    const outSec = Math.max(inSec + 0.05, Math.min(d, (t.outT ?? 1) * d));
    return { d, inSec, outSec, span: outSec - inSec };
  }
  env.srcScrubSpan = srcScrubSpan;

  // the strip's IDENTITY: which clip, over which range. Thumbs are stale the moment
  // either changes.
  function srcStripSig() {
    const s = srcScrubSpan();
    if (!s) return '';
    return `${env.media.sourceVideoUrl || ''}|${s.inSec.toFixed(3)}|${s.outSec.toFixed(3)}`;
  }

  function updateSrcScrub() {
    const wrap = document.getElementById('srcScrub');
    if (!wrap) return;
    const v = env.sourceVideo;
    // shown for a video source in still mode (frame picker) AND in perform mode
    // (re-parented into the footer center as the full-size playback timeline)
    const show = !!v && !env.motionRT.active && !env.live.isLive && !env.live.frozen;
    wrap.hidden = !show;
    if (show && isFinite(v.duration) && v.duration > 0) {
      const s = srcScrubSpan();
      const head = document.getElementById('srcScrubHead');
      // THE CLOCK, NOT THE ELEMENT (B602). On the native path the `<video>` is parked for
      // authoring and never advances, so reading `v.currentTime` here snapped the playhead to
      // wherever the element was left — the head of the clip. Perform's tick sets this from
      // `clock.time` while playing and is correct; `toggleVideoPlayback` then calls this on
      // PAUSE and overwrote it. Hence Daniel, B601: "the playhead jumps to the beginning when
      // paused; on play it resumes in the correct position." Same shape as the several other
      // places that had to stop believing the element once the decode became the clock.
      const now = env.sourceClock?.present ? env.sourceClock.time : v.currentTime;
      if (head && s) head.style.left = (Math.max(0, Math.min(1, (now - s.inSec) / s.span)) * 100) + '%';
      // Rebuild the footage thumbs whenever that identity changes — a new clip, or a new
      // trim range. This used to fire ONLY when the track had no cells at all, so a Loop
      // Builder trim/bake left the OLD clip's thumbnails sitting there until a mode round
      // trip happened to re-place the track and rebuild by side effect (Daniel's stale-
      // thumbnails-in-perform report). rAF so layout (and module setup) are done.
      const sig = srcStripSig();
      if (sig && (sig !== srcStrip.sig || !wrap.querySelector('.ss-cell')) && !srcStrip.queued) {
        srcStrip.queued = true;
        requestAnimationFrame(() => { srcStrip.queued = false; buildSrcStrip(); });
      }
    }
  }
  env.updateSrcScrub = updateSrcScrub;

  // ---- footage thumbnails inside the frame picker (Daniel: the motion-timeline
  // treatment, so it reads as motion content). One ascending seek pass per video
  // load. It NEVER touches the engine texture (no updateSourceFrame), so the parked
  // frame keeps rendering while thumbs build; cancelled (gen bump) the moment the
  // user scrubs, and rebuilt on scrub end if it was cut short.
  // ONE decoder, one seeker. While the native decode owns the clip, seeking the parked
  // `<video>` wakes a SECOND 4K hardware decode session next to it and the two starve each
  // other — Daniel's B500 session: 3 minutes for the footage thumbnails, ~1 minute for the
  // preview to catch up after a scrub, playback advancing a frame at a time. iOS has a
  // small number of concurrent 4K decode sessions and we were asking for two.
  //
  // So on the native path every still comes from AVAssetImageGenerator (already there for
  // staging) and the `<video>` is never seeked at all. It stays loaded purely so overlay
  // geometry keeps reading real dimensions.
  // `tolerance` is how exact the frame has to be, in seconds. Thumbnails pass a loose one
  // (a filmstrip cell doesn't care which frame of the surrounding second it gets) because
  // exact extraction from a long 4K clip is most of the cost AND it competes with the
  // player for the hardware decoder. A scrub preview keeps the tight default.
  async function stillAt(sec, maxPx = 1280, tolerance = 0.05) {
    if (env.nativeVideo) {
      const mod = await import('./native-video.js').catch(() => null);
      const img = await mod?.nativeStillAt?.(sec, maxPx, tolerance);
      if (img) return img;
      return null;                     // no fallback to <video>: that's the contention
    }
    const v = env.sourceVideo;
    if (!v) return null;
    await seekVideoTo(v, sec);
    return v;
  }
  env.stillAt = stillAt;

  const srcStrip = { gen: 0, dirty: false, building: false, sig: '', queued: false };
  async function buildSrcStrip() {
    const track = document.getElementById('srcScrub');
    const v = env.sourceVideo;
    if (srcStrip.building) {
      // a pass is running for a DIFFERENT clip/range — cancel it and retry when it unwinds
      if (srcStripSig() !== srcStrip.sig) { srcStrip.gen++; srcStrip.dirty = true; }
      return;                        // single-flight (updateSrcScrub may re-trigger)
    }
    if (!track || track.hidden || !v || !isFinite(v.duration) || v.duration <= 0) return;
    const w = track.clientWidth, h = track.clientHeight;
    if (w < 8 || h < 8) return;
    const span = srcScrubSpan();
    if (!span) return;
    const gen = ++srcStrip.gen;
    srcStrip.sig = srcStripSig();    // claimed only once we're actually building it
    srcStrip.dirty = false;
    srcStrip.building = true;
    const saved = v.currentTime;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const n = Math.max(4, Math.min(16, Math.round(w / h)));   // ~square cells across the track
    const cells = [];
    try {
      for (let i = 0; i < n; i++) {
        if (gen !== srcStrip.gen) { srcStrip.dirty = true; return; }
        const frame = await stillAt(span.inSec + ((i + 0.5) / n) * span.span, 640, 0.5);   // a thumbnail cell: exactness is worthless, speed is not
        if (!frame) return;
        if (gen !== srcStrip.gen) { srcStrip.dirty = true; return; }
        const cw = Math.ceil((w / n) * dpr), ch = Math.ceil(h * dpr);
        const c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        c.className = 'ss-cell';
        c.style.left = (i * 100 / n) + '%';
        c.style.width = (100 / n) + '%';
        // cover-fit the frame into the cell (center crop)
        const fw = frame.videoWidth || frame.naturalWidth || frame.width || 1;
        const fh = frame.videoHeight || frame.naturalHeight || frame.height || 1;
        const va = fw / fh, ca = cw / ch;
        let sw, sh, sx, sy;
        if (va > ca) { sh = fh; sw = sh * ca; sx = (fw - sw) / 2; sy = 0; }
        else { sw = fw; sh = sw / ca; sx = 0; sy = (fh - sh) / 2; }
        c.getContext('2d').drawImage(frame, sx, sy, sw, sh, 0, 0, cw, ch);
        cells.push(c);
      }
      track.querySelectorAll('.ss-cell').forEach((el) => el.remove());
      for (const c of cells) track.appendChild(c);
    } finally {
      srcStrip.building = false;
      if (gen === srcStrip.gen && !env.nativeVideo) {
        try { await seekVideoTo(v, saved); } catch { /* keep whatever frame presented */ }
        // The strip is the LAST WRITER on the video's clock during a load — a
        // parked still-mode source must be re-presented after the restore, or
        // the panel keeps whatever mid-seek (blank) frame the racing park drew
        // (the Brave/DMG first-load blank panel's true fix). Verify + one
        // forced re-seek if the paint still reads blank.
        if (!env.motionRT.active && v.paused && engine && engine.getSourceImage()) {
          const present = () => {
            engine.updateSourceFrame();
            engine.render(state);
            env.sourceOverlay.paintSourceVideo();
            env.sourceOverlay.render();
          };
          present();
          if (env.sourceOverlay.sourceVideoBlank?.()) {
            try { await seekVideoTo(v, saved + 0.08); await seekVideoTo(v, Math.abs(saved - 0.01) < 0.005 ? 0.03 : 0.01); } catch { /* keep */ }
            present();
          }
        }
      } else if (srcStrip.dirty) {
        // this pass was cancelled for a newer clip/range — pick the new one up now that
        // the decoder is free (the scrub's own retry only fires on pointerup)
        srcStrip.sig = '';
        setTimeout(() => { if (!srcStrip.building && srcStrip.dirty) buildSrcStrip(); }, 60);
      }
    }
  }

  env.buildSrcStrip = buildSrcStrip;   // perform re-parents the timeline → rebuild thumbs at the new width

  let srcSeekBusy = false, srcSeekNext = null;
  async function scrubStillFrame(p) {
    const v = env.sourceVideo;
    if (!v || !isFinite(v.duration) || v.duration <= 0) return;
    if (srcStrip.building) { srcStrip.gen++; srcStrip.dirty = true; }   // a scrub owns the decoder — cancel the thumb pass
    if (srcSeekBusy) { srcSeekNext = p; return; }
    srcSeekBusy = true;
    try {
      const s = srcScrubSpan();                       // perform scrubs within the trim; still mode over the whole file
      const sec = s ? s.inSec + p * s.span : p * v.duration;
      // the SOURCE CLOCK owns the playhead — on the native path seeking the parked
      // `<video>` here moved nothing the viewer can see and woke a second 4K decoder
      // (Daniel, B501: "scrubbing the ruler in perform mode doesn't update source or
      // staged position")
      if (env.nativeVideo) {
        await env.sourceClock.seekSettled(sec);
        env.nativeVideo.refreshFrame();
      } else {
        await seekVideoTo(v, sec);
      }
      engine.updateSourceFrame();
      engine.render(state);
      env.sourceOverlay.paintSourceVideo();
      env.sourceOverlay.render();
    } finally {
      srcSeekBusy = false;
    }
    if (srcSeekNext != null) { const n = srcSeekNext; srcSeekNext = null; scrubStillFrame(n); }
  }
  // ⚠️ B654 — THE ONE SCRUB ENTRY POINT. Daniel on B653's perform ruler: *"scrubbing on the
  // timeline in perform updates near instantly and scrubbing via the ruler pauses a beat before
  // updating. it doesn't seem like there should need to be any gap in perf parity."*
  //
  // He is right, and there was no reason for a gap except that B653 wrote its OWN seek instead of
  // calling this one. `scrubStillFrame` is not just `clock.seek` — it **coalesces latest-wins** so a
  // drag never queues a backlog of seeks, uses `seekSettled` + `refreshFrame` on the native path,
  // cancels a running thumb pass that would fight it, and repaints the engine and overlay
  // synchronously. A bare `seek()` per pointermove has none of that, which is exactly a beat of lag.
  //
  // So the scrub is exported as ONE function taking a normalised position, and every surface that
  // scrubs the source calls it. This is the project's standing rule (a behaviour needed in two
  // places moves to a shared home rather than being written twice) applied to the thing that just
  // broke it.
  env.scrubSourceTo = (p) => {
    const q = Math.max(0, Math.min(1, p));
    const head = document.getElementById('srcScrubHead');
    if (head) head.style.left = (q * 100) + '%';   // the playhead tracks the pointer immediately
    scrubStillFrame(q);                            // the frame lands via the coalesced seek
  };
  // a scrub owns the decoder — let a surface finish the thumb pass it interrupted
  env.scrubSourceSettle = () => {
    if (srcStrip.dirty) setTimeout(() => { if (!srcSeekBusy && !srcStrip.building && srcStrip.dirty) buildSrcStrip(); }, 300);
  };

  // drag anywhere on the mini timeline — the playhead line tracks the pointer
  // immediately; the actual frame lands via the coalesced seek.
  (function wireSrcScrub() {
    const track = document.getElementById('srcScrub');
    if (!track) return;
    let down = false;
    const at = (e) => {
      const r = track.getBoundingClientRect();
      env.scrubSourceTo((e.clientX - r.left) / Math.max(1, r.width));
    };
    track.addEventListener('pointerdown', (e) => {
      down = true;
      track.setPointerCapture?.(e.pointerId);
      at(e);
      e.preventDefault();
    });
    track.addEventListener('pointermove', (e) => { if (down) at(e); });
    const up = (e) => {
      down = false;
      track.releasePointerCapture?.(e.pointerId);
      env.scrubSourceSettle();   // finish a thumb pass the scrub cut short (shared with the ruler)
    };
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
  })();

  // The live camera's current device + facing, for the output window to open its OWN
  // capture of the same physical camera (in-sync, zero per-frame transfer). Null when
  // the camera isn't live. `stream` (the native camera's frame-socket info: port,
  // mirror, acquisition gen) is how the HDMI external view joins the SAME frames as
  // a second socket client — the only live-camera path that works across webviews.
  env.liveCameraInfo = () => env.live.isLive
    ? {
        deviceId: camera.getDeviceId(),
        facing: camera.getFacing(),
        stream: camera.streamInfo?.() || null,
        // The rate the OS actually granted — the only honest denominator for "are we keeping up"
        // (B563). Both camera implementations are asked, since the native plugin reports a target
        // fps while the getUserMedia path reports it in the track's settings. 0 = we do not know,
        // which pressure reads as "declare no target" rather than assuming one.
        frameRate: Math.round(camera.getFrameRate?.() || camera.settings?.().frameRate || 0),
      }
    : null;

  // Public surface used by the chrome's control/upload wiring + collaborators.
  env.loadImage = loadImage;
  // ---- S3-A stage 3: hand PLAYBACK to the single native decode (iOS only) --------
  // The `<video>` above still loads and still owns AUTHORING — overlay geometry, the
  // footage thumbnails, the Loop Builder's decodes, loop detection. What moves is the
  // thing that costs: the PLAYING decoder. The clip is streamed to the plugin over the
  // upload socket, decoded once natively, and both webviews sample that one stream —
  // so the `<video>` here goes PARKED (paused) and the external view stops decoding
  // entirely (output-view.js's `video-native` branch).
  //
  // Capability-gated end to end: `createNativeVideoSource` returns null rather than
  // throwing on any failure, and everything below simply doesn't happen — leaving the
  // proven `<video>` path exactly as it was.
  // EVERY EXIT SAYS WHY (B597). This function has seven ways to decline and all of them
  // used to be silent returns, so "the native decode is not running" reached Daniel as the
  // absence of the words `native decode` in the source note and nothing else. The B596
  // post-bake failure presented as a dark panel with a healthy-looking report; the reason
  // existed only in a console he cannot read on a Capacitor device.
  //
  // `null` = attached fine. Anything else rides the source note AND the exported report.
  function noteAttach(why) {
    env.nativeAttach = why ? { why, at: new Date().toISOString() } : null;
    if (why) console.warn(`[fold] native video not attached: ${why}`);
    return null;
  }
  async function attachNativeVideo(v, file) {
    // AWAITED, because the teardown purges the staging directory this is about to write
    // into — ours, and any that an earlier caller left running
    await detachNativeVideo();
    await pendingTeardown;
    const blob = env.media.sourceVideoBlob;
    if (!blob) return noteAttach('no blob for this source (a file:// or transcoded path) — staying on <video>');
    let mod;
    try { mod = await import('./native-video.js'); } catch { return noteAttach('native-video module is not bundled on this platform'); }
    if (!mod.nativeVideoAvailable()) return noteAttach('native video decode is iOS-only');
    if (env.sourceVideo !== v) return noteAttach('a newer source landed while the module loaded');
    statusEl.textContent = 'preparing the clip for native playback…';
    statusEl.classList.add('busy');
    const src = await mod.createNativeVideoSource(env, blob, { name: file?.name || 'clip.mp4' });
    statusEl.textContent = '';
    statusEl.classList.remove('busy');
    if (!src) return noteAttach(`the decode did not start — ${mod.getNativeStartError?.() || 'reason not recorded'}`);
    if (env.sourceVideo !== v) { src.stop(); return noteAttach('the source was swapped while the clip was uploading'); }
    noteAttach(null);
    env.nativeVideo = src;
    env.sourceClock = src.clock;                          // motion + perform now drive the native player
    // PAUSE ONLY, DELIBERATELY: the <video> is authoring-only from here but must stay loaded for
    // the Loop Builder, and its decode session stays registered because it is genuinely still held.
    // (Not routed through stopSourceVideoPlayback — that also stops the live render loop, which
    // this path needs running.)
    try { v.pause(); } catch { /* ignore */ }
    // setSource still takes the preview canvas — it is what carries dimensions, aspect,
    // and the `getSourceImage()` truthiness the rest of the app reads as "there is a
    // source". setPlanarSource then redirects the PER-FRAME pixels to the decode's own
    // planes, which is what removes the cross-context readback (B504). Order matters:
    // setSource retires any planar provider, so it has to come first.
    try {
      engine.setSource(src.frameSource());
      engine.setPlanarSource(src.planeProvider, src.cap);
      engine.updateSourceFrame();
    } catch { /* not ready */ }
    env.nativeStageSource = () => mod.createNativeStageSource(env);
    // ADOPT THE POSITION THE APP IS ALREADY PARKED AT (B600).
    //
    // `attachNativeVideo` is fired without await from loadVideo, so the rest of the load runs
    // to completion — including the scrub that parks the timeline at the head — and the decode
    // then attaches behind it and paints whichever frame it happened to produce. The `<video>`
    // is the authoring clock and it holds the truth, so the decode takes its position rather
    // than asserting one. Daniel, B599: "the image in the source panel is now incorrect at
    // first; scrubbing corrects it" — the scrub was re-asserting what this now does directly.
    //
    // seekSettled pumps refreshFrame while it waits, so the preview canvas lands on the same
    // frame rather than holding the stale one until the next render.
    try { await src.clock.seekSettled(Math.max(0, v.currentTime || 0)); } catch { /* the fallback is a stale first frame, not a broken one */ }
    console.info(`[fold] native video decode active on port ${src.port} — <video> parked for authoring`);
    // RE-SYNC PERFORM AFTER THE HAND-OFF (B608). `refreshPerformSource` runs during loadVideo,
    // which does not await this function, so it syncs against the `<video>` and then the native
    // decode attaches behind it — parked, because B595 parks a freshly loaded clip. Perform was
    // left showing the previous clip's transport state over a clock that was not running: the new
    // clip sat paused while the button read "pause", and pressing it started playback (Daniel,
    // B607). It is identity-guarded, so this is a no-op unless the source really changed.
    env.refreshPerformSource?.();
    env.scheduleRender?.();
  }
  // THE INVARIANT IS GLOBAL, not per-caller: no clip may be staged while a teardown is in
  // flight, because the teardown purges the staging directory. Most callers detach as a
  // fire-and-forget step long before the matching attach (a new clip load detaches at the
  // top of loadVideo and attaches ~40 lines later), so making only `attachNativeVideo`'s
  // own detach awaitable would close the bake's race and leave the load's open.
  let pendingTeardown = Promise.resolve();
  // Returns a promise so a caller that is about to STAGE A NEW CLIP can wait for the
  // teardown (which purges the staging directory) to finish first.
  function detachNativeVideo() {
    const src = env.nativeVideo;
    if (!src) return Promise.resolve();
    env.nativeVideo = null;
    env.nativeStageSource = null;
    env.sourceClock = videoElementClock;
    // HAND THE ENGINE BACK, or the fallback is not intact (B597). Clearing the planar
    // provider left the engine still pointed at the decode's PREVIEW CANVAS — which
    // nothing paints once the receiver is stopped. On the success path the re-attach
    // immediately re-pointed it and hid this; on the failure path the engine sat on a
    // dead canvas and the panel went black with no error anywhere. That is Daniel's B596
    // "the staged panel goes dark". `stgStopVideo` has always done exactly this restore.
    try {
      if (env.sourceVideo) { engine.setSource(env.sourceVideo); engine.updateSourceFrame(); }
      else engine.setPlanarSource(null);
    } catch { /* engine may be mid-reinit */ }
    try { pendingTeardown = src.stop() || Promise.resolve(); } catch { pendingTeardown = Promise.resolve(); }
    return pendingTeardown;
  }
  env.detachNativeVideo = detachNativeVideo;
  // A BAKE PRODUCES A NEW CLIP, so it needs the same native hand-off a loaded file gets
  // (B595). Without it `applyBakedClip` left a hybrid nobody could reason about: the
  // engine and `env.sourceVideo` pointed at the baked element while `env.nativeVideo`
  // and `env.sourceClock` still served the PRE-BAKE decode, and `setSource` had retired
  // the planar provider on its way through — so the source panel went dark, the clock
  // reported the old clip's duration, and the broadcast kept showing the old footage.
  env.attachNativeVideo = attachNativeVideo;

  env.loadVideo = loadVideo;
  // THE source clock (S3-A stage 2): the one handle motion + perform ask for time
  // through, resolved live so a source swap or a Loop Builder bake can't leave it
  // driving a dead element. Stage 3 swaps this for the native-decode implementation
  // when the plugin is available, and falls back to exactly this object when it isn't.
  const videoElementClock = createVideoElementClock(() => env.sourceVideo);
  env.sourceClock = videoElementClock;
  env.stopSourceVideoPlayback = stopSourceVideoPlayback;
  env.releaseSourceVideo = releaseSourceVideo;
  env.tagSourceVideo = tagSourceVideo;
  env.untagSourceVideo = untagSourceVideo;
  env.startLiveLoop = startLiveLoop;
  env.doExport = doExport;
  env.exportPackage = exportPackage;
  env.downloadBlob = downloadBlob;
}
