// shell/diagnostics.js
//
// Diagnostic surface for GPU capability detection. Generates a structured
// JSON report covering platform info, WebGL parameters, per-step probe
// results, and an end-to-end render verification — all the data we need to
// understand why the FBO probe lands on different sizes across devices
// (M5 reports 8K, M1 reports 16K, etc.).
//
// Triggered by the "Run diagnostics" button or `?diag` URL param. Renders a
// modal panel showing the report and offering a clipboard-copy action.
//
// This is developer/testing tooling, not a user-facing feature. Once the
// underlying detection bugs are fixed, this surface can stay (for future
// hardware) or be removed.

import { probeMaxFBOSizeVerbose } from '../engine/gl.js';
import { VERSION, BUILD } from '../version.js';

// ---------------------------------------------------------------------------
// Data collection
// ---------------------------------------------------------------------------

export async function gatherDiagnostics(engine, state) {
  const gl = engine.glContext;
  const dbgExt = gl.getExtension('WEBGL_debug_renderer_info');

  const report = {
    build: `${VERSION} Build ${BUILD}`,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    platform: {
      devicePixelRatio: window.devicePixelRatio || 1,
      screen: `${window.screen.width}x${window.screen.height}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    },
    webgl: {
      version: gl.getParameter(gl.VERSION),
      shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      renderer: gl.getParameter(gl.RENDERER),
      vendor: gl.getParameter(gl.VENDOR),
      rendererUnmasked: dbgExt ? gl.getParameter(dbgExt.UNMASKED_RENDERER_WEBGL) : null,
      vendorUnmasked: dbgExt ? gl.getParameter(dbgExt.UNMASKED_VENDOR_WEBGL) : null,
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      maxViewportDims: Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS)),
      maxColorAttachments: gl.getParameter(gl.MAX_COLOR_ATTACHMENTS),
      maxDrawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS),
    },
    initialProbe: {
      maxTextureSize: engine.diagnostics.maxTextureSize,
      chosenMaxFBOSize: engine.diagnostics.maxFBOSize,
    },
  };

  // Re-run the FBO probe with per-step reporting.
  const verbose = probeMaxFBOSizeVerbose(gl, engine.diagnostics.maxTextureSize);
  report.probeSteps = verbose.candidates;
  report.probeChosen = verbose.chosen;
  report.probeMatchesInitial = verbose.chosen === engine.diagnostics.maxFBOSize;

  // End-to-end render+sample test at the chosen size. Only runs if a source
  // image is loaded (otherwise we can't validate the actual shader path).
  report.endToEndTest = await runEndToEndTest(engine, state, verbose.chosen);

  return report;
}

async function runEndToEndTest(engine, state, size) {
  if (!engine.getSourceImage()) {
    return { skipped: true, reason: 'no source image loaded; load an image and re-run to test the render path' };
  }
  try {
    // Use a smaller test size for speed if size is large.
    const testSize = Math.min(size, 4096);
    const result = await engine.renderToFBOForDiagnostics(state, testSize);
    const { pixels } = result;

    // Sample several positions and report values. If the export pipeline is
    // returning all-zero pixels (the Intel Air "black square" case), this will
    // show it clearly.
    const samples = [];
    const positions = [
      [Math.floor(testSize * 0.1),  Math.floor(testSize * 0.1)],
      [Math.floor(testSize * 0.5),  Math.floor(testSize * 0.5)],
      [Math.floor(testSize * 0.9),  Math.floor(testSize * 0.5)],
      [Math.floor(testSize * 0.5),  Math.floor(testSize * 0.9)],
    ];
    for (const [x, y] of positions) {
      const i = (y * testSize + x) * 4;
      samples.push({
        pos: [x, y],
        rgba: [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]],
      });
    }

    // Compute summary stats over the whole buffer.
    let nonZero = 0;
    let sumR = 0, sumG = 0, sumB = 0;
    const step = 256; // sample every 256th pixel for speed
    for (let i = 0; i < pixels.length; i += step * 4) {
      sumR += pixels[i];
      sumG += pixels[i + 1];
      sumB += pixels[i + 2];
      if (pixels[i] > 0 || pixels[i + 1] > 0 || pixels[i + 2] > 0) nonZero++;
    }
    const sampleCount = Math.floor(pixels.length / (step * 4));
    const avgR = (sumR / sampleCount).toFixed(1);
    const avgG = (sumG / sampleCount).toFixed(1);
    const avgB = (sumB / sampleCount).toFixed(1);
    const nonZeroPct = ((nonZero / sampleCount) * 100).toFixed(1);

    const allZero = sumR === 0 && sumG === 0 && sumB === 0;
    return {
      skipped: false,
      testSize,
      renderMs: result.renderMs.toFixed(1),
      readMs: result.readMs.toFixed(1),
      samples,
      summary: { avgRGB: [avgR, avgG, avgB], nonZeroPct: `${nonZeroPct}%`, allZero },
      result: allZero ? 'FAIL: all sampled pixels are black' : 'PASS',
    };
  } catch (e) {
    return { skipped: false, result: `THREW: ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
// On-screen panel
// ---------------------------------------------------------------------------

let panelEl = null;

export async function showDiagnosticPanel(engine, state) {
  if (panelEl) { panelEl.remove(); panelEl = null; }
  const report = await gatherDiagnostics(engine, state);
  const json = JSON.stringify(report, null, 2);

  panelEl = document.createElement('div');
  panelEl.id = 'diagnosticPanel';
  panelEl.style.cssText = `
    position: fixed; inset: 24px; z-index: 9999;
    background: #1a1a1a; color: #ddd;
    border: 1px solid #444; border-radius: 6px;
    font-family: ui-monospace, Menlo, Monaco, "Courier New", monospace;
    font-size: 11px; line-height: 1.4;
    display: flex; flex-direction: column;
    overflow: hidden;
  `;

  const header = document.createElement('div');
  header.style.cssText = `
    padding: 12px 16px; border-bottom: 1px solid #333;
    display: flex; align-items: center; gap: 8px;
    background: #222;
  `;
  header.innerHTML = `<strong style="color: #fff;">GPU diagnostics</strong>
    <span style="color: #888;">— ${report.build} on ${report.platform.viewport} (DPR ${report.platform.devicePixelRatio})</span>
    <span style="flex: 1;"></span>`;

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'copy json';
  copyBtn.style.cssText = `
    background: #2a4a2a; color: #fff; border: 1px solid #4a6a4a;
    padding: 4px 12px; border-radius: 3px; cursor: pointer; font: inherit;
  `;
  copyBtn.addEventListener('click', async () => {
    const okText = 'copied!';
    const failText = 'select text below + copy manually';
    try {
      await navigator.clipboard.writeText(json);
      copyBtn.textContent = okText;
      setTimeout(() => { copyBtn.textContent = 'copy json'; }, 2000);
    } catch {
      copyBtn.textContent = failText;
      // Select the text in the textarea for manual copy
      const ta = panelEl.querySelector('textarea');
      if (ta) { ta.focus(); ta.select(); }
    }
  });

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'close';
  closeBtn.style.cssText = `
    background: #333; color: #ddd; border: 1px solid #555;
    padding: 4px 12px; border-radius: 3px; cursor: pointer; font: inherit;
  `;
  closeBtn.addEventListener('click', () => {
    panelEl.remove();
    panelEl = null;
  });

  header.appendChild(copyBtn);
  header.appendChild(closeBtn);
  panelEl.appendChild(header);

  // Summary at the top — quick-read highlights without diving into JSON.
  const summary = document.createElement('div');
  summary.style.cssText = `padding: 12px 16px; border-bottom: 1px solid #333; background: #1f1f1f;`;
  const probeRows = report.probeSteps.map(s => {
    const cells = [
      `${s.size}`.padStart(5),
      s.gpuTexImage,
      s.gpuFBStatus,
      s.gpuReadPixels,
      s.canvasCreate,
      s.canvasRoundTrip,
    ];
    const winner = s.size === report.probeChosen ? ' ← chosen' : '';
    return `${cells.join(' │ ')}${winner}`;
  }).join('\n');

  let e2eSummary = '';
  if (report.endToEndTest.skipped) {
    e2eSummary = `end-to-end test: ${report.endToEndTest.reason}`;
  } else {
    e2eSummary = `end-to-end test @ ${report.endToEndTest.testSize}²: ${report.endToEndTest.result}\n` +
      `  avg RGB ${report.endToEndTest.summary?.avgRGB?.join(', ') ?? '—'} | nonzero ${report.endToEndTest.summary?.nonZeroPct ?? '—'} | render ${report.endToEndTest.renderMs}ms + read ${report.endToEndTest.readMs}ms`;
  }

  summary.innerHTML = `<pre style="margin: 0; white-space: pre-wrap; color: #ccc;">renderer: ${escapeHTML(report.webgl.rendererUnmasked || report.webgl.renderer)}
unmasked vendor: ${escapeHTML(report.webgl.vendorUnmasked || report.webgl.vendor)}
WebGL version: ${escapeHTML(report.webgl.version)}
MAX_TEXTURE_SIZE: ${report.webgl.maxTextureSize}
MAX_RENDERBUFFER_SIZE: ${report.webgl.maxRenderbufferSize}
MAX_VIEWPORT_DIMS: ${report.webgl.maxViewportDims.join('×')}

probe (size │ gpuTex │ gpuFB │ gpuRead │ canvasCreate │ canvasRoundTrip):
${escapeHTML(probeRows)}

${escapeHTML(e2eSummary)}</pre>`;
  panelEl.appendChild(summary);

  // Full JSON in a scrollable textarea for inspection / manual selection.
  const ta = document.createElement('textarea');
  ta.value = json;
  ta.readOnly = true;
  ta.style.cssText = `
    flex: 1; min-height: 0;
    width: 100%; box-sizing: border-box;
    background: #111; color: #aaa; border: 0; padding: 12px 16px;
    font: inherit; resize: none; outline: none;
  `;
  panelEl.appendChild(ta);

  document.body.appendChild(panelEl);
}

function escapeHTML(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Mount: wire up button + URL param auto-open
// ---------------------------------------------------------------------------

// Readback benchmark — settles whether the live-output readback (the Syphon/record
// bottleneck) is beatable IN-BROWSER. Renders w×h two ways and compares the GPU→CPU
// read: (A) renderToFBO + readPixels (what the output bus does today; ~44ms on
// ANGLE-Metal), vs (B) render to the canvas + drawImage GL→2D + getImageData (the
// engine's fast capture path, ~20× faster than readPixels on WebKit — Blink unknown).
// If B wins big, an offscreen-canvas refactor of the bus is worth it; if not, the
// readback wall is real and we accept the resolution constraint / go native.
// LANE 4B CAPTURE BENCHMARK — measures every candidate live-output readback path
// on the RUNNING device so the capture decision is made from data, not folklore
// (the folklore being device-real but dated: readPixels corrupts on WebKit,
// VideoFrame(GL canvas) hung iPadOS at Build 115). Paths, in run order:
//   A  readPixels from the FBO (the legacy export path) + a checksum vs B —
//      re-validates the corruption story on current iOS
//   B  drawImage GL→2D + getImageData — TODAY'S live-output path (the baseline
//      the bus, recorder, NDI and Syphon all pay per frame)
//   D  createImageBitmap(GL canvas) — transport-only timing (no pixel access)
//   C1 VideoFrame(2D capture canvas) → copyTo — the "Safari-safe" WebCodecs source
//   C2 VideoFrame(GL canvas direct) → copyTo — the fast candidate, LAST + console
//      breadcrumbed (it froze iPadOS once; if the app hangs here, that's confirmed)
// Checksums sample RGB across the frame (row-flip-aware for bottom-up A) so a
// fast-but-corrupt path can never win.
export async function benchmarkReadback(engine, getState, w = 1920, h = 1080, iters = 15) {
  const state = getState();
  if (!engine || !engine.getSourceImage()) return 'load a source first, then benchmark';
  const lines = [`capture bench @ ${w}×${h} (avg ${iters}):`];
  const sum = (px, flip) => {   // sampled RGB checksum; flip=true reads bottom-up rows
    let s = 0;
    for (let i = 0; i < 997; i++) {
      const x = (i * 7919) % w, y = (i * 6007) % h;
      const row = flip ? (h - 1 - y) : y;
      const o = (row * w + x) * 4;
      s = (s + px[o] + px[o + 1] + px[o + 2]) % 1000000007;
    }
    return s;
  };

  // A — readPixels (FBO)
  console.log('[bench] A readPixels…');
  let aRead = 0, aSum = null;
  try {
    await engine.exportFrameRaw(state, w, h);   // warm
    for (let i = 0; i < iters; i++) {
      const r = await engine.exportFrameRaw(state, w, h);
      aRead += r.readMs;
      if (i === 0 && r.pixels) aSum = sum(r.pixels, true);   // bottom-up
    }
    aRead /= iters;
  } catch (e) { aRead = -1; lines.push(`A readPixels FAILED: ${e.message}`); }

  // B — drawImage + getImageData (the shipping path)
  console.log('[bench] B getImageData…');
  let bDraw = 0, bRead = 0, bSum = null;
  engine.beginCapture(w, h);
  try {
    engine.captureFrame(state);   // warm
    for (let i = 0; i < iters; i++) {
      const t0 = performance.now();
      const cv = engine.captureFrame(state);            // render + drawImage GL→2D
      const t1 = performance.now();
      const img = cv.getContext('2d').getImageData(0, 0, w, h);
      bDraw += t1 - t0; bRead += performance.now() - t1;
      if (i === 0) bSum = sum(img.data, false);
    }
    bDraw /= iters; bRead /= iters;
    lines.push(`B getImageData = ${bRead.toFixed(1)}ms (+ render/blit ${bDraw.toFixed(1)}ms) — TODAY'S PATH`);
    if (aRead >= 0) {
      lines.push(`A readPixels   = ${aRead.toFixed(1)}ms — checksum ${aSum === bSum ? 'MATCHES (corruption gone?)' : 'MISMATCH (corruption confirmed)'}`);
    }

    // D — createImageBitmap (transport timing only)
    console.log('[bench] D createImageBitmap…');
    try {
      const gl = engine.glContext.canvas;
      let dMs = 0;
      for (let i = 0; i < iters; i++) {
        engine.captureFrameGL(state);
        const t0 = performance.now();
        (await createImageBitmap(gl)).close();
        dMs += performance.now() - t0;
      }
      lines.push(`D createImageBitmap = ${(dMs / iters).toFixed(1)}ms (transport only, no pixels)`);
    } catch (e) { lines.push(`D createImageBitmap FAILED: ${e.message}`); }

    // C1 / C2 — VideoFrame → copyTo (the WebCodecs candidates)
    const copyBench = async (label, srcFor) => {
      console.log(`[bench] ${label} — if the app FREEZES here, the WebKit VideoFrame hang is confirmed for this source`);
      try {
        let ms = 0, fmt = '?', cSum = null, buf = null;
        for (let i = 0; i < iters; i++) {
          const src = srcFor();
          const t0 = performance.now();
          const vf = new VideoFrame(src, { timestamp: 0 });
          fmt = vf.format;
          try {
            const size = vf.allocationSize();
            if (!buf || buf.byteLength < size) buf = new Uint8Array(size);
            await vf.copyTo(buf);
            ms += performance.now() - t0;
            // RGBA/RGBX layouts checksum-compare directly; BGRA reports format only
            if (i === 0 && /^RGB/.test(fmt || '')) cSum = sum(buf, false);
          } finally { vf.close(); }
        }
        const chk = cSum == null ? `format ${fmt} (no RGB checksum)` : (cSum === bSum ? 'checksum MATCHES' : 'checksum MISMATCH');
        lines.push(`${label} = ${(ms / iters).toFixed(1)}ms — ${chk} · format ${fmt}`);
      } catch (e) { lines.push(`${label} FAILED: ${e.message}`); }
    };
    if (typeof VideoFrame !== 'undefined') {
      await copyBench('C1 VideoFrame(2D canvas)+copyTo', () => engine.captureFrame(state));
      await copyBench('C2 VideoFrame(GL canvas)+copyTo', () => engine.captureFrameGL(state));
    } else {
      lines.push('C VideoFrame unsupported on this engine');
    }
  } finally {
    engine.endCapture();
  }
  const out = lines.join('\n');
  console.log('[bench]\n' + out);
  return out;
}

export function wireDiagnosticButton(engine, getState) {
  const diagEl = document.getElementById('diag');
  if (!diagEl) return;

  // Append a Run diagnostics button below the existing diag text.
  const btn = document.createElement('button');
  btn.textContent = 'run diagnostics';
  btn.style.cssText = `
    margin-top: 6px; padding: 4px 8px; font-size: 11px;
    background: #2a2a2a; color: #ddd; border: 1px solid #444;
    border-radius: 3px; cursor: pointer; font-family: inherit;
  `;
  btn.addEventListener('click', async () => {
    const originalText = btn.textContent;
    btn.textContent = 'running...';
    btn.disabled = true;
    try {
      await showDiagnosticPanel(engine, getState());
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });
  diagEl.appendChild(document.createElement('br'));
  diagEl.appendChild(btn);

  // Readback benchmark button + its result line (the perf spike).
  const benchBtn = document.createElement('button');
  benchBtn.textContent = 'benchmark readback';
  benchBtn.style.cssText = btn.style.cssText + 'margin-left:6px;';
  const benchOut = document.createElement('pre');
  benchOut.style.cssText = 'white-space:pre-wrap; font:11px/1.4 ui-monospace,monospace; color:#7fffd4; margin:6px 0 0;';
  benchBtn.addEventListener('click', async () => {
    benchBtn.textContent = 'benchmarking…'; benchBtn.disabled = true;
    try { benchOut.textContent = await benchmarkReadback(engine, getState); }
    catch (e) { benchOut.textContent = 'benchmark failed: ' + e.message; }
    finally { benchBtn.textContent = 'benchmark readback'; benchBtn.disabled = false; }
  });
  diagEl.appendChild(benchBtn);
  diagEl.appendChild(benchOut);

  // Auto-open if ?diag is in the URL.
  if (new URLSearchParams(window.location.search).has('diag')) {
    setTimeout(() => { showDiagnosticPanel(engine, getState()); }, 50);
  }
}
