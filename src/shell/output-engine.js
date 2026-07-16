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

export function createOutputEngine(env) {
  let hidden = null;        // the second engine (lazy — plain-web sessions never output)
  let glCanvas = null;      // the hidden engine's GL drawing buffer (drawImage source)
  let capCanvas = null, capCtx = null;   // 2D blit target → getImageData
  let lastSource = null;    // identity of the source currently uploaded to the hidden engine

  // ---- LANE 4B TIER 1: probe-once ADAPTIVE READBACK -------------------------
  // Daniel's B362 bench (2026-07-15) overturned the folklore per-DEVICE, not
  // per-engine: iPad WebKit → readPixels 5.7ms vs getImageData 19.4ms (the old
  // corruption is gone); Safari desktop → VideoFrame(GL)+copyTo 2.7ms vs 45.5ms
  // (readPixels no help there at 42.8ms); Blink (Brave/Electron) → getImageData
  // already wins (readPixels 45ms!). So the capture path is chosen AT RUNTIME:
  // on the first bus frame, each candidate runs against the just-rendered buffer,
  // CHECKSUM-validated against getImageData (a fast-but-wrong path can never
  // win), and the fastest valid one carries the session. `?buscapture=
  // getimagedata|readpixels|videoframe` overrides for device debugging.
  // The GL→2D blit ALWAYS happens (~0.3–1ms, GPU): frame.canvas keeps feeding
  // the recorder's drawImage fast path regardless of where `pixels` came from.
  let capMode = null;        // 'getimagedata' | 'readpixels' | 'videoframe'
  let vfConvert = false;     // VideoFrame.copyTo({format:'RGBA'}) supported here
  let rpBuf = null, vfBuf = null;

  const sampleSum = (px, w, h, flip) => {   // sampled RGB checksum (row-flip-aware)
    let s = 0;
    for (let i = 0; i < 997; i++) {
      const x = (i * 7919) % w, y = (i * 6007) % h;
      const o = ((flip ? h - 1 - y : y) * w + x) * 4;
      s = (s + px[o] + px[o + 1] + px[o + 2]) % 1000000007;
    }
    return s;
  };
  const swizzleBgra = (buf, len) => {   // BGRA→RGBA in place (little-endian u32)
    const u = new Uint32Array(buf.buffer, buf.byteOffset, len >> 2);
    for (let i = 0; i < u.length; i++) {
      const v = u[i];
      u[i] = (v & 0xFF00FF00) | ((v & 0x00FF0000) >>> 16) | ((v & 0x000000FF) << 16);
    }
  };

  function readGetImageData(w, h) {
    const t = performance.now();
    const img = capCtx.getImageData(0, 0, w, h);
    return { pixels: new Uint8Array(img.data.buffer), topDown: true, readMs: performance.now() - t };
  }
  function readReadPixels(w, h) {
    const gl = hidden.glContext;
    const need = w * h * 4;
    if (!rpBuf || rpBuf.length < need) rpBuf = new Uint8Array(need);
    const t = performance.now();
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rpBuf);
    return { pixels: rpBuf.subarray(0, need), topDown: false, readMs: performance.now() - t };
  }
  async function readVideoFrame(w, h) {
    const need = w * h * 4;
    if (!vfBuf || vfBuf.length < need) vfBuf = new Uint8Array(need);
    const t = performance.now();
    const vf = new VideoFrame(glCanvas, { timestamp: 0 });
    try {
      if (vfConvert) {
        await vf.copyTo(vfBuf, { format: 'RGBA' });
      } else {
        await vf.copyTo(vfBuf);
        if (/^BGR/.test(vf.format || '')) swizzleBgra(vfBuf, need);   // sinks speak RGBA
      }
    } finally { vf.close(); }
    return { pixels: vfBuf.subarray(0, need), topDown: true, readMs: performance.now() - t };
  }

  // Runs against the CURRENT rendered buffer (renderFrameAt just rendered it).
  async function probeCapture(w, h) {
    const override = new URLSearchParams(window.location.search).get('buscapture');
    if (override === 'getimagedata' || override === 'readpixels' || override === 'videoframe') {
      if (override === 'videoframe') {
        try { const vf = new VideoFrame(glCanvas, { timestamp: 0 }); try { await vf.copyTo(new Uint8Array(w * h * 4), { format: 'RGBA' }); vfConvert = true; } finally { vf.close(); } } catch { vfConvert = false; }
      }
      capMode = override;
      console.info(`[fold] bus capture path OVERRIDDEN: ${capMode}`);
      return;
    }
    const ref = readGetImageData(w, h);
    const refSum = sampleSum(ref.pixels, w, h, false);
    let best = { mode: 'getimagedata', ms: ref.readMs };
    const report = [`getimagedata ${ref.readMs.toFixed(1)}ms`];
    try {
      let ms = 0, ok = true;
      for (let i = 0; i < 3; i++) {
        const r = readReadPixels(w, h);
        ms += r.readMs;
        if (i === 0) ok = sampleSum(r.pixels, w, h, true) === refSum;
      }
      ms /= 3;
      report.push(`readpixels ${ms.toFixed(1)}ms${ok ? '' : ' INVALID'}`);
      if (ok && ms < best.ms) best = { mode: 'readpixels', ms };
    } catch (e) { report.push(`readpixels failed (${e.message})`); }
    if (typeof VideoFrame !== 'undefined') {
      try {
        // conversion support feeds readVideoFrame's fast branch
        const vf0 = new VideoFrame(glCanvas, { timestamp: 0 });
        try {
          if (!vfBuf || vfBuf.length < w * h * 4) vfBuf = new Uint8Array(w * h * 4);
          await vf0.copyTo(vfBuf, { format: 'RGBA' });
          vfConvert = true;
        } catch { vfConvert = false; } finally { vf0.close(); }
        let ms = 0, ok = true;
        for (let i = 0; i < 3; i++) {
          const r = await readVideoFrame(w, h);
          ms += r.readMs;
          if (i === 0) ok = sampleSum(r.pixels, w, h, false) === refSum;
        }
        ms /= 3;
        report.push(`videoframe ${ms.toFixed(1)}ms${vfConvert ? ' (native RGBA)' : ' (swizzled)'}${ok ? '' : ' INVALID'}`);
        if (ok && ms < best.ms) best = { mode: 'videoframe', ms };
      } catch (e) { report.push(`videoframe failed (${e.message})`); }
    }
    capMode = best.mode;
    console.info(`[fold] bus capture probe @ ${w}×${h}: ${report.join(' · ')} → ${capMode.toUpperCase()}`);
  }

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

      // the readback — the probe-selected path (see the 4B block above): iPad
      // WebKit lands readpixels (3.4× today's), Safari desktop videoframe (17×),
      // Blink keeps getimagedata. Same rendered buffer either way.
      if (!capMode) await probeCapture(w, h);
      const r = capMode === 'readpixels' ? readReadPixels(w, h)
        : capMode === 'videoframe' ? await readVideoFrame(w, h)
        : readGetImageData(w, h);

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
