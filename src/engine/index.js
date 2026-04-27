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

import { createGLContext, uploadTexture, renderToCanvas, renderToFBO } from './gl.js';
import { FORMS, FORMS_BY_ID, getActiveForm, getActiveFormIndex } from './forms/index.js';
import { sliceVecToSourceUV } from './geometry.js';

export { FORMS, FORMS_BY_ID, getActiveForm, getActiveFormIndex };
export { sliceVecToSourceUV, polygonRadiusAt, pointInPolygon } from './geometry.js';

// create an engine bound to a single canvas. the canvas is used both for
// preview rendering and as the GL context owner — exports go to a separate
// FBO so the canvas isn't disturbed.
export function createEngine({ canvas }) {
  const glCtx = createGLContext(canvas);
  let sourceTexture = null;
  let sourceImage = null;     // HTMLImageElement, kept for naturalWidth/Height
  let sourceAspect = 1;

  // build the ctx object for setUniforms — refreshed on every render call
  // because formIndex depends on state.form.
  function buildCtx(state) {
    return {
      sourceTexture,
      sourceAspect,
      formIndex: getActiveFormIndex(state),
    };
  }

  return {
    // diagnostic info — renderer name, max texture size. used by the shell to
    // populate the diagnostics group.
    diagnostics: glCtx.diagnostics,

    // upload an image element as the source texture. the image must be fully
    // loaded (img.naturalWidth > 0) — caller is responsible for waiting on
    // img.onload before calling this.
    //
    // pre-checks dimensions against GPU max texture size and throws a clear
    // error if too large. (without this check, very large images don't always
    // throw at texImage2D — instead they get silently truncated by the GPU
    // and the kaleidoscope renders solid black. detected during build 2 with
    // 18K × 18K images that loaded as <img> but failed to render.)
    setSource(image) {
      const maxTex = glCtx.diagnostics.maxTextureSize;
      const w = image.naturalWidth, h = image.naturalHeight;
      if (w > maxTex || h > maxTex) {
        throw new Error(`image too large for GPU: ${w}×${h} (max ${maxTex}×${maxTex} on this device)`);
      }
      sourceTexture = uploadTexture(glCtx.gl, image, sourceTexture);
      sourceImage = image;
      sourceAspect = w / h;
    },

    // current source image (for shell use — showing dimensions, mounting source view).
    getSourceImage() { return sourceImage; },
    getSourceAspect() { return sourceAspect; },

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
    async exportAt(state, sizeArg, format = 'png', quality = 0.95) {
      if (!sourceTexture) throw new Error('no source loaded');
      const cap = glCtx.diagnostics.maxFBOSize;
      let size;
      if (sizeArg === 'max') size = cap;
      else { size = parseInt(sizeArg, 10); if (size > cap) size = cap; }

      const ctx = buildCtx(state);
      const { pixels, renderMs, readMs } = await renderToFBO(glCtx, state, ctx, size);

      // copy into 2D canvas, flipped Y (WebGL is bottom-up vs canvas top-down).
      const t2 = performance.now();
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = size;
      exportCanvas.height = size;
      const ctx2d = exportCanvas.getContext('2d');
      const imgData = ctx2d.createImageData(size, size);
      const stride = size * 4;
      for (let y = 0; y < size; y++) {
        const srcOffset = (size - 1 - y) * stride;
        const dstOffset = y * stride;
        imgData.data.set(pixels.subarray(srcOffset, srcOffset + stride), dstOffset);
      }
      ctx2d.putImageData(imgData, 0, 0);

      const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
      const q = format === 'jpg' ? quality : undefined;

      const blob = await new Promise((resolve, reject) => {
        exportCanvas.toBlob((b) => {
          if (!b) reject(new Error(`export failed at ${size}×${size}`));
          else resolve(b);
        }, mime, q);
      });
      const encodeMs = performance.now() - t2;

      return { blob, size, renderMs, readMs, encodeMs };
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
      if (!sourceImage) return null;
      const sourceMin = Math.min(sourceImage.naturalWidth, sourceImage.naturalHeight);
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
