// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/output-engine.js
//
// The output bus's RENDER SURFACE — a hidden, second engine instance that lets the
// live-output path beat the readback wall. The bus used to render the program to an
// FBO and pull it back with readPixels (~43ms/frame at 1080p on ANGLE-Metal — the
// entire cost). Daniel's benchmark proved `drawImage` GL→2D + `getImageData` is ~9×
// faster, but that fast path needs the program on a REAL GL canvas drawing buffer
// (drawImage can't read an FBO), and we can't commandeer the visible preview every
// frame. So we give the bus its own offscreen engine and render there.
//
// This is the exact shape the GPU output window already ships (src/output-view.js, a
// second createEngine at 120fps) — applied in-document. Lives in shell/ (not stage/)
// because the source-sync is Fold-aware; the stage layer stays engine-agnostic.
//
// Source-sync is trivial in-document: the hidden engine shares the SAME source element
// the preview uses (env.engine.getSourceImage() returns the current <img>/<video>/
// camera frame-source in every case), and texImage2D reads from any GL context — so
// no second camera/video like the cross-document popup. We re-setSource only when the
// element reference changes, and re-upload each frame for a live source (camera/video)
// since the main app's render loops keep that shared element's pixels fresh.

import { createEngine } from '../engine/index.js';
import { createAdaptiveCapture } from 'conduit/capture';
import { PRIORITY } from 'conduit/perf-ledger';
import { perfFlags } from './perf-flags.js';
import { watchGLContext } from './gl-watch.js';

export function createOutputEngine(env) {
  let hidden = null;        // the second engine (lazy — plain-web sessions never output)
  let surface = null, readItem = null;   // ledger registration (created with the engine)
  let glCanvas = null;      // the hidden engine's GL drawing buffer (drawImage source)
  let capCanvas = null, capCtx = null;   // 2D blit target → getImageData
  let lastSource = null;    // identity of the source currently uploaded to the hidden engine
  let lastW = 0, lastH = 0; // ...and the dims it had then (the camera reuses one element across renegotiation)

  // LANE 4B TIER 1 — probe-once adaptive readback. The strategy (and the bench
  // history that shaped it) lives in conduit/capture.js now, extracted so every
  // conduit consumer inherits the per-DEVICE answer; this engine just renders,
  // blits, and asks. `?buscapture=` still overrides for device debugging.
  let cap = null;           // created after ensure() (needs the GL context)

  // Lazy: created on the first frame the bus actually renders. The bus only runs for
  // record/Syphon (output-panel.js syncBusRunning), so a session that never outputs
  // pays nothing — no second GL context, no offscreen canvases.
  function ensure() {
    if (hidden) return;
    const canvas = document.createElement('canvas');   // never added to the DOM
    // CAPTURE priority: this is the recording / broadcast itself, so it yields last or never.
    // No resolution ladder either — degrading THIS is degrading the deliverable, which is the
    // opposite of the whole point (the editor surfaces exist to be spent first).
    surface = env.perf?.surface({
      id: 'bus', label: 'record / broadcast bus', serves: 'program', priority: PRIORITY.CAPTURE,
      size: () => ({ w: canvas.width, h: canvas.height }),
      scaleLadder: [1],
      // WHICH readback path actually won. Without this, a readback time that did not improve is
      // ambiguous between "the pipelined path is running and did not help" and "the pipelined
      // path lost the probe and never ran" — two findings with opposite conclusions. The console
      // logs the probe once at startup; this keeps the answer visible for the whole session.
      // `cap` null means the readback probe never resolved — the bus is registered but was never
      // able to run. Daniel's D3 report read a bare `capture: null`, which was the truth and
      // said nothing: it is the difference between "running badly" and "never started", and only
      // the second one explains a broadcast dying. Say which, in the report, since that is the
      // only diagnostic channel that reaches a device.
      // ⚠️ A ZERO HERE HAS TWO MEANINGS AND THE REPORT MUST SAY WHICH (B668). With a STILL source
      // the idle elision skips the render AND the readback and republishes the cached frame, so
      // `calls: 0` is the honest answer — the bus really did nothing. That was indistinguishable
      // from a broken counter, and it cost three builds of reading "the take is slow" as
      // starvation. Naming the elision turns the zero into an answer.
      note: () => {
        if (!cap) return 'NOT STARTED — readback path never resolved';
        const e = env.outputBus?.elision;
        const elided = e && e.frames > 0 && e.reused >= e.frames
          ? ' · ELIDING: the program is static, every frame republished (render + readback correctly skipped)'
          : e && e.reused > 0 ? ` · eliding ${e.reused}/${e.frames} frames (static program)` : '';
        return `capture: ${cap.mode || 'probing'}${elided}`;
      },
    }) || null;
    if (surface) { env.perfSurfaces.bus = surface; readItem = surface.pass('readback'); }
    try {
      hidden = createEngine({ canvas, perf: surface?.enginePerf('render'), label: 'output/bus engine' });   // a SECOND WebGL2 context
    } catch (e) {
      // The browser couldn't give us another GL context (context limit, GPU fault,
      // WebGL2 unsupported). Throw a clear, surfaceable reason — the bus catches it,
      // stops, and exposes it via getStatus().error so the output panel can tell the
      // user why the broadcast/record didn't start, instead of dying silently.
      throw new Error('could not start the live-output engine (a second GL context failed): ' + (e.message || e));
    }
    glCanvas = canvas;
    capCanvas = document.createElement('canvas');
    capCtx = capCanvas.getContext('2d');
    cap = createAdaptiveCapture({
      gl: hidden.glContext, glCanvas, capCtx,
      override: new URLSearchParams(window.location.search).get('buscapture'),
      tag: '[fold] bus',
      // the pipelined-readback A/B (perf-flags.js). Read at probe time, and `reset()` below is
      // what lets the switch take effect mid-session instead of only on reload.
      preferAsync: () => perfFlags.asyncReadback,
    });
    env.resetBusCapture = () => cap?.reset();
    // A second context-loss surface (we already handle the preview's). Log it so a
    // black output is never silent; the bus stops on render failure regardless.
    // ⚠️ B695 — A CONSOLE WARNING IS NOT A DIAGNOSTIC HERE. Daniel does not run Safari Web
    // Inspector, so until this build a context loss on the surface that FEEDS THE RECORDING AND
    // THE BROADCAST was invisible in the only channel that reaches him. The preview has marked
    // since B660; this one, which matters more during a show, did not.
    // B705 — through the shared watcher. ⚠️ Behaviour change worth knowing: the re-upload reset
    // below used to run even when `reinitGL` THREW, forcing a re-upload onto a context that had
    // just failed to rebuild. It now runs only on a verified-usable restore.
    watchGLContext({
      canvas: glCanvas,
      surface: 'output',
      mark: (kind, detail) => env.vitals?.mark(kind, detail),
      rebuild: () => hidden.reinitGL(),   // rebuild the GPU resources, not just the source
      glOf: () => hidden.glContext,
      whyOf: () => hidden?.lastReinitWhy || null,   // B767 — the rebuild's own account, into the trail
      onRestored: () => { lastSource = null; lastW = 0; lastH = 0; },   // force a re-upload
    });
  }

  // Keep the hidden engine's texture pointed at the same source as the preview, with
  // the right ASPECT. Reference identity covers new elements (still upload, video load).
  // But the camera reuses ONE <video>/mirror-canvas element across device switches AND
  // resolution renegotiation (camera.js ensureVideo), so the reference can stay the same
  // while the dimensions change — and setSource is what records sourceAspect. If we only
  // re-uploaded on a reference change, the hidden engine would keep a STALE aspect and
  // the output would stretch (the preview is fine because the main engine re-setSources
  // on every camera switch). So also re-setSource when the source's dimensions change.
  function syncSource(src) {
    // A filmstrip build BORROWS the preview engine's source, one thumbnail at a time.
    // Following it here would broadcast the thumbnails; hold the last upload instead.
    // (True on the <video> path too, where the build seeks the shared element — it just
    // became visible on the native path, where each cell is a whole setSource.)
    if (env.filmstrip?.busy) return;
    const w = src.naturalWidth || src.videoWidth || src.width || 0;
    const h = src.naturalHeight || src.videoHeight || src.height || 0;
    // track the ELEMENT's dims here rather than asking the engine for them: on the
    // planar path the engine records the true SOURCE size (3840×2160) while the element
    // it was handed is the bounded preview canvas, so comparing the two would re-upload
    // every single frame and tear the planar provider down with it
    if (src !== lastSource || (w && h && (w !== lastW || h !== lastH))) {
      try {
        hidden.setSource(src);     // records sourceAspect from the live dims; throws if not ready
        // the native decode's preview canvas is small on purpose — this engine feeds
        // recording / Syphon / NDI, so give it the full-res planes instead
        if (env.nativeVideo && src === env.nativeVideo.frameSource()) {
          hidden.setPlanarSource(env.nativeVideo.planeReader(), env.nativeVideo.cap);
          env.applyEngineMeta?.(hidden);   // B762 — colour AND rotation; the bus IS the broadcast
        }
        lastSource = src; lastW = w; lastH = h;
      } catch {
        // not ready this frame (rare — the preview already validated the source);
        // leave lastSource so we retry next frame, and render whatever's uploaded.
      }
    }
    // A live source (camera / loaded video) changes every frame; re-upload the
    // current frame from the shared element. A still uploads once (above) and holds.
    //
    // BUT skip a video that's mid-seek: this loop runs continuously (unlike the
    // render-on-demand preview), so without the guard it uploads every intermediate
    // frame the decoder presents WHILE a seek resolves — which on pause/scrub of a
    // long clip flickers the broadcast through stray timestamps before settling. The
    // preview only renders the SETTLED frame (after the 'seeked' await in scrubVideo);
    // holding our last upload until v.seeking clears matches that. Covers the loop-
    // around seek during playback too. The live camera (not a <video> src) is exempt.
    // The seek guard reads the element we're ACTUALLY uploading (src can be the
    // staging fork's committed copy, whose seeks are independent of env.sourceVideo).
    // The native decode's frames arrive on a CANVAS, not a <video> — so neither branch
    // of the old test matched and this engine froze on its first frame, which is the
    // output bus (record / Syphon / NDI) showing a still of a playing clip. It has no
    // seek state of its own to guard against: the shared decode is already settled by
    // the time a frame is on the wire.
    const vid = src.tagName === 'VIDEO' ? src : null;
    if (env.live?.isLive || env.nativeVideo || (vid && !vid.seeking)) {
      if (env.nativeVideo) hidden.setPlanarCap(env.nativeVideo.cap);   // the toggle applies live
      hidden.updateSourceFrame();
    }
  }

  return {
    // Universal-tier render for the bus. Renders the live program to the hidden GL
    // canvas at w×h, then drawImage→getImageData (TOP-DOWN). Throws when there is no
    // source so the bus stops quietly (its frame() catch).
    async renderFrameAt(w, h) {
      ensure();
      // programVideo = the footage the AUDIENCE sees (motion staging's committed
      // copy, on its own clock); otherwise the shared source element as always
      const src = env.programVideo?.() || env.engine?.getSourceImage?.();
      if (!src) throw new Error('no source loaded');
      syncSource(src);

      if (glCanvas.width !== w || glCanvas.height !== h) { glCanvas.width = w; glCanvas.height = h; }
      if (capCanvas.width !== w || capCanvas.height !== h) { capCanvas.width = w; capCanvas.height = h; }

      // render + GPU blit GL→2D. The blit stays on EVERY path (~0.3–1ms): it
      // hands the recorder its frame.canvas fast path and is the reference the
      // probe validates against.
      // programState = the COMMITTED program frame (shell/program-frame.js): what
      // the audience sees, published by the single writer at the frame's commit
      // point — never a live reference an automation loop is about to clobber.
      const t0 = performance.now();
      hidden.render(env.programState ? env.programState() : env.state);
      capCtx.drawImage(glCanvas, 0, 0);
      const renderMs = performance.now() - t0;

      // the readback — the probe-selected path (conduit/capture.js): iPad
      // WebKit lands readpixels, Safari desktop videoframe, Blink keeps
      // getimagedata. Same rendered buffer either way. Measured as its own PASS because it
      // is a different KIND of cost from the render (a GPU→CPU transfer, historically the
      // most expensive single thing in the app) and the two want separate answers.
      readItem?.begin();
      const r = await cap.read(w, h);
      readItem?.end();

      // pixels: RGBA; orientation declared by topDown (readpixels is bottom-up —
      // every sink already honors the flag). canvas: the blitted top-down copy
      // for the recorder's drawImage path, valid regardless of pixel source.
      return {
        pixels: r.pixels,
        w, h,
        topDown: r.topDown,
        // true when `pixels` come from an earlier frame than `canvas` (the pipelined readback
        // path — conduit/capture.js). Pixel sinks are then one frame behind the canvas sink by a
        // CONSTANT amount, so intervals are unchanged and nothing drifts.
        delayed: !!r.delayed,
        renderMs, readMs: r.readMs,
        canvas: capCanvas,
      };
    },
  };
}
