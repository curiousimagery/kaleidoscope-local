// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// conduit/capture.js
//
// Probe-once ADAPTIVE READBACK — the answer to "what is the fastest way to get
// pixels off a GL canvas on THIS device", extracted from Fold's output engine
// (4B Tier 1) so no conduit consumer re-solves it. The 2026-07 device bench
// overturned years of folklore per-DEVICE, not per-engine: iPad WebKit wants
// readPixels (5.7ms vs 19.4 getImageData; the old corruption is gone), Safari
// desktop wants VideoFrame+copyTo (2.7ms vs 45.5), Blink wants getImageData
// (readPixels is 45ms THERE). So the path is chosen AT RUNTIME: on the first
// read, each candidate runs against the just-rendered buffer, CHECKSUM-
// validated against getImageData (a fast-but-wrong path can never win), and
// the fastest valid one carries the session. Folklore ages out — never
// hardcode a winner.
//
// The consumer renders + blits (GL → 2D capCtx) each frame BEFORE calling
// read(): the blit is the recorder's canvas fast lane AND the probe's
// reference. readPixels frames come back BOTTOM-UP (topDown:false — the Frame
// contract's flag); VideoFrame BGRA converts via copyTo({format:'RGBA'})
// where supported, else an in-place u32 swizzle.

// Sampled CHANNEL-AWARE checksum (row-flip-aware). Weights R/G/B distinctly so a channel
// PERMUTATION changes the signature — a plain R+G+B sum is invariant to channel order, which let a
// device whose readPixels returns B,G,R,A (WebKit iPad) silently WIN the probe and ship a blue cast
// to NDI/Syphon (the raw bytes were declared RGBA). `swapRB` computes the signature as if R and B
// were swapped, so the probe can detect that exact case and correct it. (fixes the parked iOS NDI
// "blue cast".)
const sampleSig = (px, w, h, flip, swapRB = false) => {
  let s = 0;
  for (let i = 0; i < 997; i++) {
    const x = (i * 7919) % w, y = (i * 6007) % h;
    const o = ((flip ? h - 1 - y : y) * w + x) * 4;
    const r = px[swapRB ? o + 2 : o], b = px[swapRB ? o : o + 2];
    s = (s + r * 3 + px[o + 1] * 5 + b * 7) % 1000000007;
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

// createAdaptiveCapture({ gl, glCanvas, capCtx, override, tag })
//   gl       — the WebGL(2) context the program renders on
//   glCanvas — its canvas (VideoFrame source)
//   capCtx   — a 2D context the consumer blits each frame into (the reference)
//   override — force a mode: 'getimagedata' | 'readpixels' | 'videoframe'
//   tag      — console-log prefix (defaults to '[conduit]')
// → { read(w, h) → Promise<{ pixels, topDown, readMs }>, get mode() }
export function createAdaptiveCapture({ gl, glCanvas, capCtx, override = null, tag = '[conduit]' }) {
  let capMode = null;        // 'getimagedata' | 'readpixels' | 'videoframe'
  let vfConvert = false;     // VideoFrame.copyTo({format:'RGBA'}) supported here
  let rpSwizzle = false;     // this device's readPixels returns B,G,R,A → swizzle back to RGBA
  let rpBuf = null, vfBuf = null;

  function readGetImageData(w, h) {
    const t = performance.now();
    const img = capCtx.getImageData(0, 0, w, h);
    return { pixels: new Uint8Array(img.data.buffer), topDown: true, readMs: performance.now() - t };
  }
  function readReadPixels(w, h) {
    const need = w * h * 4;
    if (!rpBuf || rpBuf.length < need) rpBuf = new Uint8Array(need);
    const t = performance.now();
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rpBuf);
    if (rpSwizzle) swizzleBgra(rpBuf, need);   // channel-order fix detected at probe time
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

  // Runs against the CURRENT rendered+blitted buffer.
  async function probe(w, h) {
    if (override === 'getimagedata' || override === 'readpixels' || override === 'videoframe') {
      if (override === 'videoframe') {
        try { const vf = new VideoFrame(glCanvas, { timestamp: 0 }); try { await vf.copyTo(new Uint8Array(w * h * 4), { format: 'RGBA' }); vfConvert = true; } finally { vf.close(); } } catch { vfConvert = false; }
      }
      capMode = override;
      console.info(`${tag} capture path OVERRIDDEN: ${capMode}`);
      return;
    }
    const ref = readGetImageData(w, h);
    const refSig = sampleSig(ref.pixels, w, h, false);
    let best = { mode: 'getimagedata', ms: ref.readMs };
    const report = [`getimagedata ${ref.readMs.toFixed(1)}ms`];
    try {
      let ms = 0, ok = true;
      for (let i = 0; i < 3; i++) {
        const r = readReadPixels(w, h);   // rpSwizzle starts false; the i===0 read is raw
        ms += r.readMs;
        if (i === 0) {
          // channel-aware validation: accept as-is, or accept WITH an R↔B swizzle if that's
          // the only difference (WebKit iPad's readPixels returns B,G,R,A → the blue cast).
          if (sampleSig(r.pixels, w, h, true) === refSig) ok = true;
          else if (sampleSig(r.pixels, w, h, true, true) === refSig) { ok = true; rpSwizzle = true; }
          else ok = false;
        }
      }
      ms /= 3;
      report.push(`readpixels ${ms.toFixed(1)}ms${rpSwizzle ? ' (R↔B fixed)' : ''}${ok ? '' : ' INVALID'}`);
      if (ok && ms < best.ms) best = { mode: 'readpixels', ms };
      else if (!ok) rpSwizzle = false;   // not chosen / invalid → don't carry a stray swizzle
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
          if (i === 0) ok = sampleSig(r.pixels, w, h, false) === refSig;
        }
        ms /= 3;
        report.push(`videoframe ${ms.toFixed(1)}ms${vfConvert ? ' (native RGBA)' : ' (swizzled)'}${ok ? '' : ' INVALID'}`);
        if (ok && ms < best.ms) best = { mode: 'videoframe', ms };
      } catch (e) { report.push(`videoframe failed (${e.message})`); }
    }
    capMode = best.mode;
    console.info(`${tag} capture probe @ ${w}×${h}: ${report.join(' · ')} → ${capMode.toUpperCase()}`);
  }

  return {
    get mode() { return capMode; },
    async read(w, h) {
      if (!capMode) await probe(w, h);
      return capMode === 'readpixels' ? readReadPixels(w, h)
        : capMode === 'videoframe' ? await readVideoFrame(w, h)
        : readGetImageData(w, h);
    },
  };
}
