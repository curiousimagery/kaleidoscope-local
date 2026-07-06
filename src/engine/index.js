// engine/index.js
//
// public API for the kaleidoscope rendering engine. callers (the still-image
// shell, future motion shell, future live shell) interact only with this
// module; internal modules (gl, shader-builder, geometry, forms) are
// implementation detail.
//
// usage:
//   const engine = createEngine({ canvas });
//   engine.setSource(imageElement);          // upload texture, store aspect
//   engine.render(state);                    // draw to canvas at its current size
//   const blob = await engine.exportAt(state, 4096, 'png');  // FBO render → blob
//
// the engine is STATELESS w.r.t. kaleidoscope parameters — it accepts a state
// object on every call. this matches the "single state object" architectural
// principle from the original code: state lives in one place, owned by the
// shell, passed to the engine on demand.

import { createGLContext, uploadTexture, updateTexture, renderToCanvas, renderToFBO, probeMaxFBOSize } from './gl.js';
import { FORMS, FORMS_BY_ID, getActiveForm, getActiveFormIndex } from './forms/index.js';
import { sliceVecToSourceUV } from './geometry.js';

export { FORMS, FORMS_BY_ID, getActiveForm, getActiveFormIndex };
export { sliceVecToSourceUV, polygonRadiusAt, pointInPolygon } from './geometry.js';

// create an engine bound to a single canvas. the canvas is used both for
// preview rendering and as the GL context owner — exports go to a separate
// FBO so the canvas isn't disturbed.
export function createEngine({ canvas, maxProbeSize }) {
  let glCtx = createGLContext(canvas, { maxProbeSize });
  let sourceTexture = null;
  let sourceImage = null;     // HTMLImageElement OR HTMLVideoElement (live camera)
  let sourceAspect = 1;
  let sourceW = 0, sourceH = 0;  // resolved pixel size (natural* for img, video* for video)
  let capturePrevSize = null;    // preview canvas size snapshot during a video-capture session
  let captureCanvas = null, captureCtx = null;   // 2D blit target → VideoFrame source (Safari-safe)

  // a source is an <img> (naturalWidth), a <video> (videoWidth), or a <canvas>
  // (width — used for the mirrored front-camera frame). resolve to pixel
  // dimensions either way so the rest of the engine is source-agnostic.
  function sourceDims(source) {
    return {
      w: source.naturalWidth || source.videoWidth || source.width || 0,
      h: source.naturalHeight || source.videoHeight || source.height || 0,
    };
  }

  // build the ctx object for setUniforms — refreshed on every render call
  // because formIndex depends on state.form.
  function buildCtx(state) {
    return {
      sourceTexture,
      sourceAspect,
      formIndex: getActiveFormIndex(state),
      outputAspect: 1,   // overridden per render target (square preview = 1; FBO = w/h)
    };
  }

  return {
    // diagnostic info — renderer name, max texture size. used by the shell to
    // populate the diagnostics group.
    diagnostics: glCtx.diagnostics,

    // Re-probe the max exportable FBO size with a higher cap, LAZILY (e.g. when
    // the mobile save sheet opens) — init keeps a low cap so phones don't attempt
    // huge allocations on load. This allocates a large FBO, so call on user action.
    // Updates diagnostics.maxFBOSize (so exportAt honors the higher limit) and
    // returns it.
    probeExportMax(cap) {
      const s = probeMaxFBOSize(glCtx.gl, glCtx.diagnostics.maxTextureSize, cap);
      glCtx.diagnostics.maxFBOSize = Math.max(glCtx.diagnostics.maxFBOSize, s);
      return glCtx.diagnostics.maxFBOSize;
    },

    // raw WebGL2 context handle. exposed for the diagnostic surface, which
    // queries additional capability parameters and re-runs the FBO probe
    // with per-step reporting. NOT for general consumption by shell code —
    // forms and overlay should go through render()/exportAt() instead.
    glContext: glCtx.gl,

    // Rebuild every GPU-side resource on the SAME canvas after a context
    // loss/restore cycle (program, buffers, FBO probe) and re-upload the current
    // source. The engine object, its canvas, and the exposed glContext all stay
    // reference-stable — getContext on the same canvas returns the restored SAME
    // context object — so callers holding references (components, env) need no
    // rewiring. Call from a `webglcontextrestored` handler; calling while the
    // context is still lost fails shader compilation.
    reinitGL() {
      const fresh = createGLContext(canvas, { maxProbeSize });
      // shells captured `engine.diagnostics` at init — keep that object as the one
      // identity: refresh its values in place, point the new ctx at it.
      fresh.diagnostics = Object.assign(this.diagnostics, fresh.diagnostics);
      glCtx = fresh;
      sourceTexture = null;                          // the old handle died with the context
      if (sourceImage) this.setSource(sourceImage);  // re-upload; aspect re-derives
    },

    // run the same end-to-end render path as exportAt, but stop after readPixels
    // and return the raw pixel buffer + size + render timings. Used by the
    // diagnostic surface to verify that the chosen FBO size produces non-black
    // output from the actual shader (catches the "probe passes but export
    // returns black" case seen on some hardware).
    renderToFBOForDiagnostics(state, size) {
      if (!sourceTexture) throw new Error('no source loaded');
      const ctx = buildCtx(state);
      return renderToFBO(glCtx, state, ctx, size);
    },

    // upload an image element as the source texture. the image must be fully
    // loaded (img.naturalWidth > 0) — caller is responsible for waiting on
    // img.onload before calling this.
    //
    // pre-checks dimensions against GPU max texture size and throws a clear
    // error if too large. (without this check, very large images don't always
    // throw at texImage2D — instead they get silently truncated by the GPU
    // and the kaleidoscope renders solid black. detected during build 2 with
    // 18K × 18K images that loaded as <img> but failed to render.)
    setSource(source) {
      const maxTex = glCtx.diagnostics.maxTextureSize;
      const { w, h } = sourceDims(source);
      if (!w || !h) throw new Error('source has no dimensions yet');
      if (w > maxTex || h > maxTex) {
        throw new Error(`image too large for GPU: ${w}×${h} (max ${maxTex}×${maxTex} on this device)`);
      }
      sourceTexture = uploadTexture(glCtx.gl, source, sourceTexture);
      sourceImage = source;
      sourceAspect = w / h;
      sourceW = w; sourceH = h;
    },

    // re-upload the current source's latest frame into the existing texture.
    // for a live <video> source the shell calls this each render tick. no-op
    // for a still image (the frame never changes) and while a video has no
    // decoded frame yet (readyState < HAVE_CURRENT_DATA).
    updateSourceFrame() {
      if (!sourceTexture || !sourceImage) return;
      if (sourceImage.readyState !== undefined && sourceImage.readyState < 2) return;
      updateTexture(glCtx.gl, sourceImage, sourceTexture);
    },

    // current source element (for shell use — showing dimensions, mounting
    // source view). may be an <img> or a live <video>.
    getSourceImage() { return sourceImage; },
    getSourceAspect() { return sourceAspect; },
    getSourceSize() { return { w: sourceW, h: sourceH }; },

    // drop the current source so the shell returns to its empty state. the GL
    // texture is left allocated (cheap, reused on the next setSource); render()
    // still guards on sourceTexture, but the shell guards on getSourceImage()
    // and won't call render once this is null.
    clearSource() { sourceImage = null; sourceW = 0; sourceH = 0; },

    // render to the canvas. caller is responsible for sizing the canvas
    // before calling. no-op if no source texture is loaded.
    render(state) {
      if (!sourceTexture) return;
      const ctx = buildCtx(state);
      renderToCanvas(glCtx, state, ctx, canvas.width, canvas.height);
    },

    // FBO export. returns a Promise<Blob> for the requested format.
    // sizeArg can be a number or the string 'max' (uses the probed max FBO
    // size — the largest square FBO the driver can actually complete).
    // format is 'png' | 'jpg'. quality applies to JPG only.
    //
    // throws on framebuffer-incomplete (e.g. requested size exceeds GPU limits).
    async exportAt(state, sizeArg, format = 'png', quality = 0.95, aspect = 1) {
      if (!sourceTexture) throw new Error('no source loaded');
      const cap = glCtx.diagnostics.maxFBOSize;
      let longSide;
      if (sizeArg === 'max') longSide = cap;
      else { longSide = parseInt(sizeArg, 10); if (longSide > cap) longSide = cap; }

      // the size tier is the LONG side; the short side follows the frame aspect (w/h).
      let w, h;
      if (aspect >= 1) { w = longSide; h = Math.round(longSide / aspect); }
      else { h = longSide; w = Math.round(longSide * aspect); }
      if (Math.max(w, h) > cap) { const s = cap / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }

      const ctx = buildCtx(state);
      const { pixels, renderMs, readMs } = await renderToFBO(glCtx, state, ctx, w, h);

      // copy into 2D canvas, flipped Y (WebGL is bottom-up vs canvas top-down).
      const t2 = performance.now();
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = w;
      exportCanvas.height = h;
      const ctx2d = exportCanvas.getContext('2d');
      const imgData = ctx2d.createImageData(w, h);
      const stride = w * 4;
      for (let y = 0; y < h; y++) {
        const srcOffset = (h - 1 - y) * stride;
        imgData.data.set(pixels.subarray(srcOffset, srcOffset + stride), y * stride);
      }
      ctx2d.putImageData(imgData, 0, 0);

      const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
      const q = format === 'jpg' ? quality : undefined;

      const blob = await new Promise((resolve, reject) => {
        exportCanvas.toBlob((b) => {
          if (!b) reject(new Error(`export failed at ${w}×${h}`));
          else resolve(b);
        }, mime, q);
      });
      const encodeMs = performance.now() - t2;

      return { blob, size: longSide, w, h, renderMs, readMs, encodeMs };
    },

    // render a single animation frame at w×h into a provided 2D canvas context
    // (Y-flipped to top-down). used by the video exporter once per frame; reuses
    // the same FBO path as exportAt, with non-square aspect handled by the shader.
    async exportFrame(state, w, h, outCtx2d) {
      if (!sourceTexture) throw new Error('no source loaded');
      const ctx = buildCtx(state);
      const { pixels } = await renderToFBO(glCtx, state, ctx, w, h);
      const imgData = outCtx2d.createImageData(w, h);
      const stride = w * 4;
      for (let y = 0; y < h; y++) {
        const src = (h - 1 - y) * stride;
        imgData.data.set(pixels.subarray(src, src + stride), y * stride);
      }
      outCtx2d.putImageData(imgData, 0, 0);
    },

    // raw-RGBA FBO capture for the live-output bus (src/stage/). Runs the same
    // FBO render path as exportFrame/exportAt but STOPS at readPixels and returns
    // the raw buffer — no 2D-canvas copy, no Y-flip, no encode. Sinks that want
    // top-down (a recorder's 2D canvas) flip per-sink; sinks that take bottom-up
    // (Syphon with flipped:true) hand the buffer straight through. Timings pass
    // through so the output bus can push per-frame op records to env.diag.
    //
    // returns: Promise<{ pixels: Uint8Array (bottom-up RGBA), w, h, renderMs, readMs }>
    exportFrameRaw(state, w, h) {
      if (!sourceTexture) throw new Error('no source loaded');
      const ctx = buildCtx(state);
      return renderToFBO(glCtx, state, ctx, w, h);
    },

    // --- video-capture session -------------------------------------------------
    // The fast multi-frame path: render straight to the GL canvas at output size,
    // then GPU-blit it into a 2D canvas (`drawImage`) that the caller wraps in a
    // VideoFrame. Avoids the per-frame, single-core CPU cost that throttled export
    // (NO readPixels / CPU Y-flip / putImageData — drawImage is a GPU copy and
    // handles the flip). We hand the VideoFrame a 2D canvas, NOT the WebGL canvas
    // directly: Safari/iPadOS is unreliable building a VideoFrame from a WebGL
    // canvas (esp. with premultipliedAlpha:false), which hung iPad export. The GL
    // canvas IS the live preview canvas, so we snapshot + restore its size; the
    // caller hides the preview during the session and re-renders after endCapture().
    beginCapture(w, h) {
      if (!sourceTexture) throw new Error('no source loaded');
      const cv = glCtx.gl.canvas;
      capturePrevSize = { w: cv.width, h: cv.height };
      cv.width = w; cv.height = h;
      captureCanvas = document.createElement('canvas');
      captureCanvas.width = w; captureCanvas.height = h;
      captureCtx = captureCanvas.getContext('2d');
    },
    captureFrame(state) {
      const cv = glCtx.gl.canvas;
      renderToCanvas(glCtx, state, buildCtx(state), cv.width, cv.height);
      captureCtx.drawImage(cv, 0, 0);   // GPU blit GL→2D (Safari-safe VideoFrame source)
      return captureCanvas;
    },
    // EXPERIMENT (Build 130): return the GL canvas directly, skipping the GL→2D
    // blit, so the caller can wrap it in a VideoFrame straight from WebGL. This
    // was the Build-112 path (fast) that hung iPadOS in Build 115, so it's a
    // desktop-only probe to find whether the 2D-canvas copy is what makes
    // Safari's VideoFrame construction slow (~177ms/frame at 4K).
    captureFrameGL(state) {
      const cv = glCtx.gl.canvas;
      renderToCanvas(glCtx, state, buildCtx(state), cv.width, cv.height);
      return cv;
    },
    endCapture() {
      if (!capturePrevSize) return;
      const cv = glCtx.gl.canvas;
      cv.width = capturePrevSize.w; cv.height = capturePrevSize.h;
      capturePrevSize = null;
      captureCanvas = null; captureCtx = null;
    },

    // resolution hint — heuristic suggesting the largest output where ~1 source
    // pixel maps to ~1 output pixel given current settings. lives in the engine
    // because it depends on form-specific tile-density math.
    //
    // formula:
    //   suggested = sourceMin × sliceScale × tilesPerDim / canvasZoom × softening
    // where:
    //   tilesPerDim is form-specific (defined by each form module's tilesPerDim()).
    //     this is the linear count of distinct sample-tiles that fit across one
    //     output axis at canvasZoom=1.
    //   softening is a perceptual multiplier — the theoretical 1:1-sampling
    //     output overshoots what reads as "sharp" in practice (calibrated against
    //     daniel's eye, build 2: 1080p source × square form at slicScale 2 ×
    //     zoom 1 = ~2K perceived sharp; theoretical was ~3.4K → softening ~0.5).
    //     if the over-optimism turns out to vary by form we'd split this per-form.
    suggestResolution(state) {
      if (!sourceImage || !sourceW || !sourceH) return null;
      const sourceMin = Math.min(sourceW, sourceH);
      const form = getActiveForm(state);
      // each form provides its own tilesPerDim function. fallback to 1 if a
      // form module hasn't defined one yet (won't happen for shipped forms).
      const tilesPerDim = form.tilesPerDim ? form.tilesPerDim(state) : 1;
      const compZoom = Math.max(0.01, state.canvasZoom);
      const SOFTENING = 0.5;
      return state.sliceScale * sourceMin * tilesPerDim * SOFTENING / compZoom;
    },
  };
}
