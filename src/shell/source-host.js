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
// env.drawMiniKaleidoscope, env.sourceOverlay, …); the host's public surface is
// hung back on env for the chrome's control/upload wiring.

import { createCamera } from './camera.js';
import { zipStore } from './zip.js';
import { getActiveForm } from '../engine/index.js';

export function createSourceHost(env) {
  const { state, session, engine } = env;
  const statusEl = document.getElementById('status');
  const uploadErrorEl = document.getElementById('uploadError');

  // ============================================================================
  // image / video loading
  // ============================================================================

  function loadImage(file) {
    if (!engine) return;
    if (env.live.isLive) stopCameraMode({ keepSource: true });  // uploading exits live mode
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
        if (env.isFirefoxCappedAt8K(engine) && /too large/i.test(msg)) {
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

      statusEl.textContent = `loaded ${img.naturalWidth}×${img.naturalHeight}`;
      statusEl.classList.remove('error', 'busy');
      if (uploadErrorEl) uploadErrorEl.textContent = '';

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
  function loadVideo(file) {
    if (!engine) return;
    if (env.live.isLive) stopCameraMode({ keepSource: true });   // uploading exits live mode
    stopSourceVideoPlayback();                           // stop any previously loaded video's loop
    env.haltPlayback();                                  // stop motion playback before swapping the source
    env.filmstrip.lastSig = '';                          // any existing keyframe thumbs are from the old source
    env.clip.trim.inT = 0; env.clip.trim.outT = 1; env.clip.trim.mode = 'forward';  // a new clip starts untrimmed
    if (env.media.sourceVideoUrl) { URL.revokeObjectURL(env.media.sourceVideoUrl); env.media.sourceVideoUrl = null; }
    const url = URL.createObjectURL(file);
    env.media.sourceVideoUrl = url;
    env.media.sourceFilename = (file.name || 'video').replace(/\.[^.]+$/, '');
    env.media.originalSource = { blob: file, name: file.name || 'original' };   // for export package
    if (uploadErrorEl) uploadErrorEl.textContent = '';

    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.loop = true; v.preload = 'auto';
    v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
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
      meta.children[0].textContent = `${v.videoWidth} × ${v.videoHeight}`;
      meta.children[1].textContent = file.name;
      document.getElementById('swapBtn').disabled = false;
      const dur = isFinite(v.duration) ? ` · ${v.duration.toFixed(1)}s` : '';
      statusEl.textContent = `loaded ${v.videoWidth}×${v.videoHeight}${dur}`;
      statusEl.classList.remove('error', 'busy');
      env.updateMotionUI();            // motion mode stays gated off for a video (until timeline binding)
      env.arrangeSlots();              // mounts the <video> into the source slot
      // Play it muted-on-loop and drive the kaleidoscope from it each frame — the
      // same continuous path the live camera uses. A playing video paints reliably
      // across engines (a paused, never-played one does NOT on Blink/Gecko), and the
      // preview + output stay in sync. Timeline-driven scrub/keyframes replace this
      // free-run in the next increment.
      if (env.motionRT.active) {
        env.rebindMotionToSource();    // already animating → re-bind keyframes to the new clip (timeline-driven, no free-run)
      } else {
        v.play().catch(() => {});      // muted playback is allowed; ignore autoplay rejection
        startLiveLoop();
      }
    }, { once: true });

    v.addEventListener('error', () => {
      if (loaded) {
        // a decode hiccup AFTER the clip already loaded (seen on some Firefox .mov) —
        // not a codec-support problem, so don't blame ProRes. (Firefox .mov decode
        // robustness is a tracked, deferred issue.)
        console.warn('source video decode error after load', v.error);
        return;
      }
      if (uploadErrorEl) uploadErrorEl.textContent = 'could not load this video — the browser may not support its codec (ProRes works only in Safari). Try an H.264 or HEVC .mp4/.mov.';
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

  const camera = createCamera();

  // Default facing by device. Touch devices (iPad) default to the rear camera
  // ("frame the world"); desktops have no real rear camera and want the front
  // (mirrored, selfie-intuitive) by default.
  const DEFAULT_FACING =
    matchMedia('(pointer: coarse)').matches ? 'environment' : 'user';

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
        if (session.isSwapped) env.drawMiniKaleidoscope();
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
    const v = camera.getVideo();
    const meta = document.getElementById('sourceMeta');
    if (v && v.videoWidth) meta.children[0].textContent = `${v.videoWidth} × ${v.videoHeight}`;
    meta.children[1].textContent = label;
  }

  function updateCameraUI() {
    document.getElementById('cameraBtn').style.display = env.live.isLive ? 'none' : '';
    document.getElementById('uploadBtn').style.display = env.live.isLive ? 'none' : '';
    document.getElementById('cameraLive').style.display = env.live.isLive ? 'flex' : 'none';
    // flip button labels the camera it switches TO.
    const flip = document.getElementById('flipBtn');
    if (flip) flip.textContent = camera.isFront() ? 'rear' : 'front';
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
      const video = await camera.start(DEFAULT_FACING);
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
    statusEl.textContent = 'live camera';
    env.live.isLive = true;
    env.media.sourceFilename = 'camera';
    setCameraMeta('live camera');
    document.getElementById('swapBtn').disabled = false;
    updateCameraUI();
    env.arrangeSlots();
    startLiveLoop();
  }

  // stop the camera. by default returns to the empty placeholder (cancel path);
  // pass { keepSource: true } when another source is about to take over (upload).
  function stopCameraMode({ keepSource = false } = {}) {
    stopLiveLoop();
    camera.stop();
    env.live.isLive = false;
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
    env.arrangeSlots();              // remount picks up the mirror transform + aspect
  }

  // grab the current camera frame into a canvas at native resolution. mirrored
  // to match the front-camera preview so the saved frame is what the user saw.
  function captureLiveFrame() {
    const video = camera.getVideo();
    if (!video || !video.videoWidth) return null;
    const w = video.videoWidth, h = video.videoHeight;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d');
    if (camera.isFront()) { cx.translate(w, 0); cx.scale(-1, 1); }
    cx.drawImage(video, 0, 0, w, h);
    return c;
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }

  // shutter: freeze the current frame as the new editable still and stop the
  // camera. Nothing is saved automatically — the raw frame is stashed as the
  // pending original and written out, with the kaleidoscope, on the first export.
  function captureFrame() {
    const frame = captureLiveFrame();
    if (!frame) return;
    stopLiveLoop();
    camera.stop();
    env.live.isLive = false;
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
    document.getElementById('shutterBtn').addEventListener('click', captureFrame);
    document.getElementById('flipBtn').addEventListener('click', flipCamera);
    document.getElementById('stopCameraBtn').addEventListener('click', () => stopCameraMode());
  }

  // ============================================================================
  // still export
  // ============================================================================

  async function doExport(sizeArg) {
    if (!engine || !engine.getSourceImage()) {
      statusEl.textContent = 'load an image first';
      statusEl.classList.add('error');
      return;
    }

    // resolve size for status messaging
    const cap = engine.diagnostics.maxFBOSize;
    let size = sizeArg === 'max' ? cap : Math.min(parseInt(sizeArg, 10), cap);

    statusEl.textContent = `rendering ${size}×${size}...`;
    statusEl.classList.remove('error');
    statusEl.classList.add('busy');
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
      statusEl.textContent = e.message;
      statusEl.classList.add('error');
      statusEl.classList.remove('busy');
      // restore preview render
      engine.render(state);
      console.error(e);
      return;
    }

    const { blob, size: sz, renderMs, readMs, encodeMs } = result;
    downloadBlob(blob, buildFilename(sz));

    // restore preview render
    engine.render(state);

    statusEl.textContent = `saved ${sz}×${sz} • ${session.exportFormat} • render ${renderMs.toFixed(0)}ms • read ${readMs.toFixed(0)}ms • encode ${encodeMs.toFixed(0)}ms • ${(blob.size / 1024 / 1024).toFixed(1)}MB`;
    statusEl.classList.remove('busy');
    statusEl.classList.add('success');
    setTimeout(() => statusEl.classList.remove('success'), 2500);
  }

  // "export package" — one .zip containing the composition + the unmodified
  // original. A single download (sidesteps the Safari multiple-downloads block),
  // and the seam for future layers (overlay thumbnail, geometry map). See
  // BACKLOG; for now: composition + original only.
  async function exportPackage() {
    if (!engine || !engine.getSourceImage()) {
      statusEl.textContent = 'load an image first';
      statusEl.classList.add('error');
      return;
    }
    const cap = engine.diagnostics.maxFBOSize;
    const size = session.exportSize === 'max' ? cap : Math.min(parseInt(session.exportSize, 10), cap);
    statusEl.textContent = `packaging ${size}×${size}...`;
    statusEl.classList.remove('error');
    statusEl.classList.add('busy');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    let result;
    try {
      result = await engine.exportAt(state, session.exportSize, session.exportFormat, undefined, session.frameAspect);
    } catch (e) {
      statusEl.textContent = e.message;
      statusEl.classList.add('error');
      statusEl.classList.remove('busy');
      engine.render(state);
      console.error(e);
      return;
    }

    const files = [{ name: buildFilename(result.size), blob: result.blob }];
    if (env.media.originalSource) files.push({ name: env.media.originalSource.name, blob: env.media.originalSource.blob });
    const zipBlob = await zipStore(files);
    downloadBlob(zipBlob, `${env.media.sourceFilename}-package.zip`);

    engine.render(state);
    statusEl.textContent = `saved package • ${files.length} files • ${(zipBlob.size / 1024 / 1024).toFixed(1)}MB`;
    statusEl.classList.remove('busy');
    statusEl.classList.add('success');
    setTimeout(() => statusEl.classList.remove('success'), 2500);
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

  // Public surface used by the chrome's control/upload wiring + collaborators.
  env.loadImage = loadImage;
  env.loadVideo = loadVideo;
  env.stopSourceVideoPlayback = stopSourceVideoPlayback;
  env.startLiveLoop = startLiveLoop;
  env.doExport = doExport;
  env.exportPackage = exportPackage;
  env.downloadBlob = downloadBlob;
}
