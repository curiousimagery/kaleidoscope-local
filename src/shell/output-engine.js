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

export function createOutputEngine(env) {
  let hidden = null;        // the second engine (lazy — plain-web sessions never output)
  let glCanvas = null;      // the hidden engine's GL drawing buffer (drawImage source)
  let capCanvas = null, capCtx = null;   // 2D blit target → getImageData
  let lastSource = null;    // identity of the source currently uploaded to the hidden engine

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
    try {
      hidden = createEngine({ canvas });               // a SECOND WebGL2 context
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
    });
    // A second context-loss surface (we already handle the preview's). Log it so a
    // black output is never silent; the bus stops on render failure regardless.
    glCanvas.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault();
      console.warn('[fold] WebGL context LOST (output engine)');
    });
    glCanvas.addEventListener('webglcontextrestored', () => {
      console.warn('[fold] WebGL context RESTORED (output engine)');
      try { hidden.reinitGL(); }   // rebuild the GPU resources, not just the source
      catch (e) { console.warn('[fold] output engine GL reinit failed', e); }
      lastSource = null;   // force a re-upload onto the restored context
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
    const w = src.naturalWidth || src.videoWidth || src.width || 0;
    const h = src.naturalHeight || src.videoHeight || src.height || 0;
    const cur = hidden.getSourceSize();   // dims currently uploaded to the hidden engine
    if (src !== lastSource || (w && h && (w !== cur.w || h !== cur.h))) {
      try {
        hidden.setSource(src);     // records sourceAspect from the live dims; throws if not ready
        lastSource = src;
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
    const vid = src.tagName === 'VIDEO' ? src : null;
    if (env.live?.isLive || (vid && !vid.seeking)) {
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
      // getimagedata. Same rendered buffer either way.
      const r = await cap.read(w, h);

      // pixels: RGBA; orientation declared by topDown (readpixels is bottom-up —
      // every sink already honors the flag). canvas: the blitted top-down copy
      // for the recorder's drawImage path, valid regardless of pixel source.
      return {
        pixels: r.pixels,
        w, h,
        topDown: r.topDown,
        renderMs, readMs: r.readMs,
        canvas: capCanvas,
      };
    },
  };
}
