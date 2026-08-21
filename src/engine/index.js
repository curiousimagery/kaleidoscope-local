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

import { createGLContext, uploadTexture, updateTexture, createPlanarUploader, renderToCanvas, renderToFBO, probeMaxFBOSize } from './gl.js';
import { acquireSession } from 'conduit/sessions';
import { FORMS, FORMS_BY_ID, getActiveForm, getActiveFormIndex } from './forms/index.js';
import { sliceVecToSourceUV } from './geometry.js';
import { createGpuTimer } from 'conduit/gpu-timer';

export { FORMS, FORMS_BY_ID, getActiveForm, getActiveFormIndex };
export { sliceVecToSourceUV, polygonRadiusAt, pointInPolygon } from './geometry.js';

// create an engine bound to a single canvas. the canvas is used both for
// preview rendering and as the GL context owner — exports go to a separate
// FBO so the canvas isn't disturbed.
// `perf` is an optional collaborator from the frame-cost ledger (conduit/perf-ledger):
// { skip, begin(), end() }. It hooks render() — the one place every caller funnels through —
// so a surface can be measured and (via `skip`) switched off without any call site knowing.
// ⚠️ EVERY LIVE ENGINE, SO A RECOVERY CAN REACH ALL OF THEM (2026-08-19).
//
// The break-glass session reset rebuilt `main.js`'s PREVIEW engine and nothing else. But this app
// runs up to three GL contexts in-process — preview, the output/bus engine, and the live PiP — and
// Daniel's report of it "not working anymore" came from **perform mode**, where the surface he was
// looking at is the PiP's context, which the reset never touched. A recovery that rebuilds one of
// three contexts is indistinguishable from a recovery that does nothing, from the seat.
//
// Weak refs are not used deliberately: engines in this app are never discarded (see the session
// audit), so a plain list cannot leak anything that was not already permanent.
const ENGINES = [];
export function allEngines() { return ENGINES.slice(); }

export function createEngine({ canvas, maxProbeSize, perf = null, label = 'engine' }) {
  let glCtx = createGLContext(canvas, { maxProbeSize });
  // ⚠️ Registered HERE and not in createGLContext, because `reinitGL` calls that again on the same
  // canvas and a canvas only ever has ONE context — re-registering there would count a recovery as
  // a new resource. Session audit 2026-08-19: nothing released a GL context and nothing counted one.
  acquireSession('gl', label);
  let sourceTexture = null;
  let sourceImage = null;     // HTMLImageElement OR HTMLVideoElement (live camera)
  let sourceAspect = 1;
  let sourceW = 0, sourceH = 0;  // resolved pixel size (natural* for img, video* for video)
  let capturePrevSize = null;    // preview canvas size snapshot during a video-capture session
  let captureCanvas = null, captureCtx = null;   // 2D blit target → VideoFrame source (Safari-safe)
  let planar = null;             // lazily-built planar uploader (native decode → this context)
  let planarFrame = null;        // provider: () => wire frame | null, installed by the shell
  let planarCap = 0;             // source-detail cap (long edge) for the planar texture
  let lastReinitWhy = '';        // B703 — why the last context restore's element re-upload failed, if it did
  // HOW MANY TIMES THIS CONTEXT HAS DIED AND COME BACK (B580). A context loss is invisible from
  // the report — it heals, the app keeps rendering, and the only trace was a `console.warn` on a
  // device where we cannot read the console. It is also the trigger for the planar-drop bug above,
  // so a report showing degraded source cost needs to say whether a restore happened.
  let glGeneration = 0;
  let elideElementUploads = false;  // <video> identity gate (B559) — off until the shell opts in
  let lastElementTime = -1;         // last uploaded currentTime; -1 = nothing uploaded yet
  let gpuTimer;                  // undefined = not probed yet, null = unsupported here

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
      // the planar uploader owns its own texture once a native frame has landed; the
      // element texture stays the fallback (and the pre-first-frame render)
      sourceTexture: (planar && planar.width > 0) ? planar.texture : sourceTexture,
      sourceAspect,
      formIndex: getActiveFormIndex(state),
      outputAspect: 1,   // overridden per render target (square preview = 1; FBO = w/h)
    };
  }

  const engine = {
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
      planar = null;                                 // ...and so did its FBO + blit program
      gpuTimer = undefined;                          // ...and every outstanding timer query
      // RE-UPLOADING IS NOT A SOURCE SWAP, AND setSource CANNOT TELL THE DIFFERENCE (B580).
      //
      // `setSource` retires the planar provider by design — a genuinely new source must not keep
      // feeding on the old decode's planes. But this call means "re-upload the SAME source", and
      // routing it through setSource therefore **silently deleted the planar path on every context
      // restore**, permanently dropping the engine onto `native-video.js`'s 1280 RGB preview
      // canvas: the cross-context readback B518/B541 removed, back per frame, at a sixth of the
      // resolution. That is Daniel's dark source/stage panels, and the report signature every time
      // was `source: 1280×720 · from canvas · native decode` with no `planar`.
      //
      // It fires exactly where he saw it, because attaching a 4K external display drops every GL
      // context in the app (see the B382 cluster): **starting the broadcast caused the loss, and
      // the recovery caused the damage.** Reopening the source healed it because the attach path
      // re-installs the provider.
      const keepPlanar = planarFrame, keepCap = planarCap;
      glGeneration++;
      // ⚠️ B703 — `finally`, BECAUSE THE RE-UPLOAD IS THE PART THAT CAN FAIL. `setSource` throws on
      // a zero-size element (a preview canvas mid mode switch) and on a source past the fresh
      // context's `maxTextureSize`. Restoring the provider outside the try means a failed element
      // re-upload can no longer take the planar path down with it — which, with the guard moved in
      // `updateSourceFrame`, is what lets the picture come back on its own.
      let reinitWhy = '';
      try {
        if (sourceImage) this.setSource(sourceImage);  // re-upload; aspect re-derives
      } catch (e) {
        // NOT rethrown when planes can still carry the picture: on the native path the element is
        // only a dimension carrier. Recorded either way — a recovery that silently half-failed is
        // the thing that made B609 take four builds to find.
        reinitWhy = String(e?.message || e);
        if (!keepPlanar) throw e;
      } finally {
        // the uploader itself is gone with the context and is recreated lazily on the next frame
        if (keepPlanar) { planarFrame = keepPlanar; planarCap = keepCap; }
      }
      lastReinitWhy = reinitWhy;
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
      // a new source retires any planar provider — the shell re-installs it right
      // after when the new source is itself a native decode (source-host attach)
      planarFrame = null;
      if (planar) { planar.dispose(); planar = null; }
      sourceTexture = uploadTexture(glCtx.gl, source, sourceTexture);
      lastElementTime = -1;   // a new source invalidates the frame-identity comparison
      sourceImage = source;
      sourceAspect = w / h;
      sourceW = w; sourceH = h;
    },

    // re-upload the current source's latest frame into the existing texture.
    // for a live <video> source the shell calls this each render tick. no-op
    // for a still image (the frame never changes) and while a video has no
    // decoded frame yet (readyState < HAVE_CURRENT_DATA).
    // Returns TRUE when new pixels actually reached the texture. Callers use it to skip a render
    // that would be identical to the last one — a 60Hz loop over a 30fps camera otherwise draws
    // every frame twice (B542). `false` means "the texture still holds what it held".
    updateSourceFrame() {
      // ⚠️ B703 — THE PLANAR PATH MUST NOT BE GATED ON ELEMENT-PATH STATE. THIS WAS A DEADLOCK.
      //
      // The guard used to sit above this block as `if (!sourceTexture || !sourceImage) return false`.
      // Both are ELEMENT-path concepts. A native decode feeding raw planes needs NEITHER: the
      // planar uploader builds and owns its own texture, and the render already prefers it (see
      // `sourceTexture: (planar && planar.width > 0) ? planar.texture : sourceTexture` above).
      //
      // **How it deadlocks.** `reinitGL` sets `sourceTexture = null` and `planar = null`, then
      // re-uploads the element. If that re-upload throws — a zero-size preview canvas mid mode
      // switch, or a source past the fresh context's `maxTextureSize` — `sourceTexture` stays null.
      // The guard then refuses to run, so `planar` is never rebuilt, so `planar.width` is never
      // above zero, so the render falls back to `sourceTexture`, which is null. **Nothing can ever
      // recover it, and the socket keeps delivering frames the whole time.**
      //
      // That is exactly the B609 signature, and it is the one reading the B584 instrument was built
      // to separate: `offered 222, took 222, skipped 0` at `0.0 in/s` with a frozen picture means
      // the frames reached us and we failed to use them. **Our bug, JS side** — which is what that
      // rule said from the beginning.
      //
      // Moving the guard BELOW the planar block is the whole fix: the planar path becomes
      // self-healing (it rebuilds its uploader on the next frame off the wire, whatever happened to
      // the element), and the element path keeps the guard it actually needs.
      // PLANAR FIRST. When a native decode is feeding this engine, its frames are raw
      // YUV planes sitting in CPU memory — uploading them here beats sampling whatever
      // canvas some other context painted them onto (see gl.js createPlanarUploader).
      // A null frame means "nothing new off the wire yet": fall through, so the very
      // first render still gets the element that setSource uploaded.
      if (planarFrame) {
        const frame = planarFrame();
        if (frame) {
          if (!planar) planar = createPlanarUploader(glCtx.gl);
          planar.upload(frame, planarCap);
          sourceAspect = frame.width / frame.height;
          sourceW = frame.width; sourceH = frame.height;
          return true;
        }
        // nothing new off the wire: the frame already in the planar texture stands.
        // Falling through here would re-upload the ELEMENT — which on this path is the
        // preview canvas, i.e. exactly the cross-context readback we came to delete.
        if (planar && planar.width > 0) return false;
      }
      // The ELEMENT path, and the guard that genuinely belongs to it (B703).
      if (!sourceTexture || !sourceImage) return false;
      if (sourceImage.readyState !== undefined && sourceImage.readyState < 2) return false;
      // THE <video> ELEMENT PATH — where desktop, Electron and mobile web live (B559).
      //
      // The planar path above knows when a frame is new because the socket tells it. An element
      // does not, so this used to upload unconditionally: a 30fps clip against a 60Hz loop pushed
      // every frame into the texture TWICE, and on WebKit "consume a video element as an image
      // source" is precisely the family of operations this arc found expensive four times over.
      //
      // `currentTime` is the identity signal that works everywhere. rVFC would be more precise but
      // is a per-frame callback registration we would have to own across seeks, source swaps and
      // context loss; the timestamp is already sitting there and moves exactly when a new frame is
      // presented. A paused video reports the same time forever, which is the correct answer: its
      // texture genuinely still holds what it held.
      //
      // Behind a flag and OFF by default. The take path, the external display and the bus all
      // consume this function's return value, and all three are carrying changes from B549-B558
      // that have not been read on desktop or iPad yet. Shipping this ON would mean a problem
      // found there could belong to either build, which is the one thing worth avoiding.
      if (elideElementUploads && sourceImage.currentTime !== undefined) {
        const t = sourceImage.currentTime;
        if (t === lastElementTime && lastElementTime !== -1) return false;
        lastElementTime = t;
      }
      updateTexture(glCtx.gl, sourceImage, sourceTexture);
      return true;
    },

    // Opt in to the <video> identity gate above. Set by the shell from the perf switchboard so
    // the flag stays a measuring stage rather than the engine growing a permanent config surface.
    // Idempotent by design — the shells call it every frame, and resetting the comparison on an
    // unchanged value would defeat the gate entirely.
    setElementUploadElision(on) {
      const next = !!on;
      if (next === elideElementUploads) return;
      elideElementUploads = next;
      lastElementTime = -1;
    },

    // Install (or clear, with null) a planar frame provider. The shell keeps calling
    // setSource with a real drawable for bookkeeping — dimensions, aspect, and the
    // `getSourceImage()` truthiness the rest of the app treats as "there is a source";
    // this only changes WHERE the per-frame pixels come from. `cap` bounds the source
    // texture's long edge, which is the graceful-degradation lever for slower hardware.
    //
    // The element texture stays allocated alongside the planar one: it is what renders
    // until the first frame lands, and what the engine falls back to the moment the
    // provider is removed (source swap, detach, context loss).
    setPlanarSource(provider, cap = 0) {
      planarFrame = provider || null;
      planarCap = cap || 0;
      if (!provider && planar) { planar.dispose(); planar = null; }
    },
    setPlanarCap(cap) { planarCap = cap || 0; },
    get planarActive() { return !!(planarFrame && planar && planar.width > 0); },
    // B703 — an element re-upload that failed during a context restore. Empty when the last
    // restore was clean. Rides the exported report because a half-failed recovery is invisible
    // otherwise, and console is not a channel that reaches the device (see DEVICE-TESTING.md).
    get lastReinitWhy() { return lastReinitWhy; },
    // 0 = this context has never been lost. Rides the frame-cost report (B580).
    get glGeneration() { return glGeneration; },

    // current source element (for shell use — showing dimensions, mounting
    // source view). may be an <img> or a live <video>.
    getSourceImage() { return sourceImage; },
    getSourceAspect() { return sourceAspect; },
    getSourceSize() { return { w: sourceW, h: sourceH }; },

    // drop the current source so the shell returns to its empty state. the GL
    // texture is left allocated (cheap, reused on the next setSource); render()
    // still guards on sourceTexture, but the shell guards on getSourceImage()
    // and won't call render once this is null.
    clearSource() {
      sourceImage = null; sourceW = 0; sourceH = 0;
      planarFrame = null;
      if (planar) { planar.dispose(); planar = null; }
    },

    // render to the canvas. caller is responsible for sizing the canvas
    // before calling. no-op if no source texture is loaded.
    render(state) {
      if (!sourceTexture) return;
      if (perf && perf.skip) return;   // switched off at the ledger — the canvas holds its last frame
      perf?.begin();
      // TRUE GPU TIME where the platform offers it (Chromium/Electron). Created on first render
      // rather than at construction because the ledger hook can be attached later, and because a
      // session that never opens the panel should never allocate query objects.
      if (perf?.gpu && gpuTimer === undefined) gpuTimer = createGpuTimer(glCtx.gl) || null;
      gpuTimer?.begin();
      const ctx = buildCtx(state);
      renderToCanvas(glCtx, state, ctx, canvas.width, canvas.height);
      gpuTimer?.end();
      perf?.end();
      if (gpuTimer && perf?.gpu) {
        // results land a frame or two later, so this reports whatever finished since last time;
        // null means a disjoint event made the outstanding results meaningless
        const ms = gpuTimer.poll();
        if (ms) perf.gpu(ms);
      }
    },

    // let the shell attach/replace the ledger hook after construction (the output bus builds
    // its engine lazily, long after the ledger exists)
    setPerf(p) { perf = p || null; },

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
      const sizeNorm = form.sizeNorm ?? 1;   // effective slice = sliceScale × per-form perceived-size norm
      return state.sliceScale * sizeNorm * sourceMin * tilesPerDim * SOFTENING / compZoom;
    },
  };
  engine.label = label;
  ENGINES.push(engine);
  return engine;
}
