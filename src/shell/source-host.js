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
import { seekVideoTo } from './video-source.js';
import { zipStore } from './zip.js';
import { createSaveFlow } from './save-flow.js';
import { getActiveForm } from '../engine/index.js';

export function createSourceHost(env) {
  const { state, session, engine } = env;
  const statusEl = document.getElementById('status');
  const exportStatusEl = document.getElementById('exportStatus');   // export feedback lives in the save modal, not the global status line
  const uploadErrorEl = document.getElementById('uploadError');

  // ============================================================================
  // image / video loading
  // ============================================================================

  function loadImage(file) {
    if (!engine) return;
    if (env.live.isLive || env.live.frozen) stopCameraMode({ keepSource: true });  // uploading exits the camera workflow
    stopSourceVideoPlayback();                          // stop a loaded video's loop before switching
    env.haltPlayback();                                 // stop motion playback before swapping the source
    env.filmstrip.lastSig = '';                         // any existing keyframe thumbs are from the old source
    env.sourceVideo = null;                            // switching to a still clears any source video
    if (env.media.sourceVideoUrl) { URL.revokeObjectURL(env.media.sourceVideoUrl); env.media.sourceVideoUrl = null; }
    const url = URL.createObjectURL(file);
    env.media.sourceFilename = (file.name || 'image').replace(/\.[^.]+$/, '');
    env.media.originalSource = { blob: file, name: file.name || 'original' };  // for export package
    const img = new Image();
    // Clear any prior upload error before attempting this load.
    if (uploadErrorEl) uploadErrorEl.textContent = '';

    img.onload = () => {
      try {
        engine.setSource(img);
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
      if (env.motionRT.active) env.rebindMotionToSource();   // already animating → re-bind keyframes to the new still
    };
    img.onerror = () => {
      if (uploadErrorEl) uploadErrorEl.textContent = 'failed to load image';
      statusEl.textContent = '';
      statusEl.classList.remove('error', 'busy', 'success');
    };
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
  function loadVideo(file, opts = {}) {
    if (!engine) return;
    // uploading a new clip while in Loop Builder resets the process — warn on unsaved
    // first (exitLoopBuilder); if the user backs out, abort the load
    if (env.loopIsActive?.() && !opts.srcUrl && !env.exitLoopBuilder?.()) return;
    if (env.live.isLive || env.live.frozen) stopCameraMode({ keepSource: true });   // uploading exits the camera workflow
    stopSourceVideoPlayback();                           // stop any previously loaded video's loop
    env.haltPlayback();                                  // stop motion playback before swapping the source
    env.filmstrip.lastSig = '';                          // any existing keyframe thumbs are from the old source
    env.clip.trim.inT = 0; env.clip.trim.outT = 1; env.clip.trim.mode = 'forward';  // a new clip starts untrimmed
    if (env.media.sourceVideoUrl) { URL.revokeObjectURL(env.media.sourceVideoUrl); env.media.sourceVideoUrl = null; }
    const url = opts.srcUrl || URL.createObjectURL(file);   // revoke on a file:// URL is a harmless no-op
    env.media.sourceVideoUrl = url;
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

    v.addEventListener('loadeddata', () => {
      loaded = true;
      try {
        engine.setSource(v);            // videoWidth is known now (a frame is decoded)
      } catch (e) {
        if (uploadErrorEl) uploadErrorEl.textContent = e.message;
        statusEl.textContent = '';
        statusEl.classList.remove('error', 'busy', 'success');
        console.error(e);
        return;
      }
      env.sourceVideo = v;              // mountSourceView mounts this element
      env.liveVideo = null;
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
      if (env.openClipEditor && !env.motionRT.active && !opts.noLoopBuilder) {
        env.openClipEditor({ fromLoad: true });   // fresh clip → skip the keyframe-shift warning
      }
      if (env.motionRT.active) {
        env.rebindMotionToSource();    // already animating → re-bind keyframes to the new clip (timeline-driven, no free-run)
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
        };
        v.play().then(() => setTimeout(park, 80))
          .catch(() => { park(); });   // autoplay refused: loadeddata decoded frame 0 — park directly
      }
    }, { once: true });

    v.addEventListener('error', async () => {
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
  function stopSourceVideoPlayback() {
    if (!env.live.isLive) stopLiveLoop();
    if (env.sourceVideo) { try { env.sourceVideo.pause(); } catch { /* ignore */ } }
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
  const CAMERA_DEVICE_KEY = 'fold.cameraDeviceId';   // last-picked camera, persisted across sessions

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
    // not enumerated devices) — skip straight to the facing default there
    const savedId = cameraIsNative ? null : localStorage.getItem(CAMERA_DEVICE_KEY);
    if (savedId) {
      try { return await camera.start({ deviceId: savedId }); }
      catch { /* device gone or busy — fall through to default */ }
    }
    return camera.start({ facingMode: DEFAULT_FACING });
  }

  // Populate / show the multi-camera picker. Device labels need permission, so this
  // runs only after a stream is live. Show the picker (replacing the front/rear flip
  // button) only when ≥2 labeled cameras exist — the desktop/installation case (a USB
  // webcam vs the built-in / iPhone Continuity cam); a single-camera device keeps flip.
  async function refreshCameraDevices() {
    const select = document.getElementById('cameraSelect');
    const flip = document.getElementById('flipBtn');
    if (!select) return;
    let devices = [];
    try { devices = await camera.listDevices(); } catch { /* enumeration unsupported */ }
    const labeled = devices.filter(d => d.label);   // unlabeled = no permission yet for that device
    const multi = labeled.length >= 2;
    // The dropdown is the camera IDENTITY while in camera (Daniel's camera-module
    // spec): always visible, current camera selected, every camera listed, "quit
    // camera" at the bottom. flip still covers the single-camera facing switch.
    select.hidden = false;
    if (flip) flip.hidden = multi;
    const activeId = camera.getDeviceId();
    select.innerHTML = '';
    for (const d of labeled) {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label;
      if (d.deviceId === activeId) opt.selected = true;
      select.appendChild(opt);
    }
    if (!labeled.length) {
      // the native camera enumerates nothing (it drives lenses, not devices) —
      // say what it IS instead of the generic placeholder (Daniel's note)
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
  async function selectCameraDevice(deviceId) {
    if (!deviceId || !env.live.isLive) return;
    try {
      const video = await camera.start({ deviceId });
      env.liveVideo = video;
      engine.setSource(camera.frameSource());
    } catch (e) {
      if (uploadErrorEl) uploadErrorEl.textContent = cameraErrorMessage(e);
      return;
    }
    localStorage.setItem(CAMERA_DEVICE_KEY, deviceId);
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
        camera.refreshFrame();      // front camera: redraw the mirrored frame
        engine.updateSourceFrame();
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
    stopSourceVideoPlayback();   // stop a loaded video's loop before the camera takes over
    if (env.media.sourceVideoUrl) { URL.revokeObjectURL(env.media.sourceVideoUrl); env.media.sourceVideoUrl = null; }
    env.media.originalSource = null;  // no captured original until the shutter fires
    statusEl.textContent = 'starting camera…';
    statusEl.classList.add('busy');
    try {
      const video = await startWithPreferredDevice();
      env.liveVideo = video;
      env.sourceVideo = null;                          // camera takes over the source view
      engine.setSource(camera.frameSource());
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
      engine.setSource(camera.frameSource());   // video (rear) or mirror canvas (front)
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
      engine.setSource(camera.frameSource());
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
      if (!v) return;
      if (env.live.frozen) {
        // picking a camera while frozen resumes live on that device
        localStorage.setItem(CAMERA_DEVICE_KEY, v);
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
  function updateSrcScrub() {
    const wrap = document.getElementById('srcScrub');
    if (!wrap) return;
    const v = env.sourceVideo;
    // shown for a video source in still mode (frame picker) AND in perform mode
    // (re-parented into the footer center as the full-size playback timeline)
    const show = !!v && !env.motionRT.active && !env.live.isLive && !env.live.frozen;
    wrap.hidden = !show;
    if (show && isFinite(v.duration) && v.duration > 0) {
      const head = document.getElementById('srcScrubHead');
      if (head) head.style.left = ((v.currentTime / v.duration) * 100) + '%';
      // no thumbs yet (e.g. the video was loaded while IN motion mode) → build them
      // now that the track is visible. rAF so layout (and module setup) are done.
      if (!wrap.querySelector('.ss-cell')) requestAnimationFrame(() => buildSrcStrip());
    }
  }
  env.updateSrcScrub = updateSrcScrub;

  // ---- footage thumbnails inside the frame picker (Daniel: the motion-timeline
  // treatment, so it reads as motion content). One ascending seek pass per video
  // load. It NEVER touches the engine texture (no updateSourceFrame), so the parked
  // frame keeps rendering while thumbs build; cancelled (gen bump) the moment the
  // user scrubs, and rebuilt on scrub end if it was cut short.
  const srcStrip = { gen: 0, dirty: false, building: false };
  async function buildSrcStrip() {
    const track = document.getElementById('srcScrub');
    const v = env.sourceVideo;
    if (srcStrip.building) return;   // single-flight (updateSrcScrub may re-trigger)
    if (!track || track.hidden || !v || !isFinite(v.duration) || v.duration <= 0) return;
    const w = track.clientWidth, h = track.clientHeight;
    if (w < 8 || h < 8) return;
    const gen = ++srcStrip.gen;
    srcStrip.dirty = false;
    srcStrip.building = true;
    const saved = v.currentTime;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const n = Math.max(4, Math.min(16, Math.round(w / h)));   // ~square cells across the track
    const cells = [];
    try {
      for (let i = 0; i < n; i++) {
        if (gen !== srcStrip.gen) { srcStrip.dirty = true; return; }
        await seekVideoTo(v, ((i + 0.5) / n) * v.duration);
        if (gen !== srcStrip.gen) { srcStrip.dirty = true; return; }
        const cw = Math.ceil((w / n) * dpr), ch = Math.ceil(h * dpr);
        const c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        c.className = 'ss-cell';
        c.style.left = (i * 100 / n) + '%';
        c.style.width = (100 / n) + '%';
        // cover-fit the frame into the cell (center crop)
        const va = (v.videoWidth || 1) / (v.videoHeight || 1), ca = cw / ch;
        let sw, sh, sx, sy;
        if (va > ca) { sh = v.videoHeight; sw = sh * ca; sx = (v.videoWidth - sw) / 2; sy = 0; }
        else { sw = v.videoWidth; sh = sw / ca; sx = 0; sy = (v.videoHeight - sh) / 2; }
        c.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, cw, ch);
        cells.push(c);
      }
      track.querySelectorAll('.ss-cell').forEach((el) => el.remove());
      for (const c of cells) track.appendChild(c);
    } finally {
      srcStrip.building = false;
      if (gen === srcStrip.gen) {
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
      await seekVideoTo(v, p * v.duration);
      engine.updateSourceFrame();
      engine.render(state);
      env.sourceOverlay.paintSourceVideo();
      env.sourceOverlay.render();
    } finally {
      srcSeekBusy = false;
    }
    if (srcSeekNext != null) { const n = srcSeekNext; srcSeekNext = null; scrubStillFrame(n); }
  }
  // drag anywhere on the mini timeline — the playhead line tracks the pointer
  // immediately; the actual frame lands via the coalesced seek.
  (function wireSrcScrub() {
    const track = document.getElementById('srcScrub');
    if (!track) return;
    let down = false;
    const at = (e) => {
      const r = track.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
      const head = document.getElementById('srcScrubHead');
      if (head) head.style.left = (p * 100) + '%';
      scrubStillFrame(p);
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
      // finish a thumb pass the scrub cut short — after the coalesced seek settles,
      // so the rebuild's seeks never race the scrub's
      if (srcStrip.dirty) setTimeout(() => { if (!srcSeekBusy && !srcStrip.building && srcStrip.dirty) buildSrcStrip(); }, 300);
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
      }
    : null;

  // Public surface used by the chrome's control/upload wiring + collaborators.
  env.loadImage = loadImage;
  env.loadVideo = loadVideo;
  env.stopSourceVideoPlayback = stopSourceVideoPlayback;
  env.startLiveLoop = startLiveLoop;
  env.doExport = doExport;
  env.exportPackage = exportPackage;
  env.downloadBlob = downloadBlob;
}
