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

export function gatherDiagnostics(engine, state) {
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
  report.endToEndTest = runEndToEndTest(engine, state, verbose.chosen);

  return report;
}

function runEndToEndTest(engine, state, size) {
  if (!engine.getSourceImage()) {
    return { skipped: true, reason: 'no source image loaded; load an image and re-run to test the render path' };
  }
  try {
    // Use a smaller test size for speed if size is large.
    const testSize = Math.min(size, 4096);
    const result = engine.renderToFBOForDiagnostics(state, testSize);
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

export function showDiagnosticPanel(engine, state) {
  if (panelEl) { panelEl.remove(); panelEl = null; }
  const report = gatherDiagnostics(engine, state);
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
  btn.addEventListener('click', () => showDiagnosticPanel(engine, getState()));
  diagEl.appendChild(document.createElement('br'));
  diagEl.appendChild(btn);

  // Auto-open if ?diag is in the URL.
  if (new URLSearchParams(window.location.search).has('diag')) {
    setTimeout(() => showDiagnosticPanel(engine, getState()), 50);
  }
}
