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

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINED (ASYNC) READBACK — the fourth mode, and the one that wins on architecture
// rather than on a stopwatch.
//
// THE MEASUREMENT THAT MOTIVATED IT (Daniel's Electron gauntlet, B514-B516): broadcasting a 4K
// program cost 21.3ms per frame in readback alone, against 0.6ms to RENDER it and under 0.6ms
// for every editor surface in the app COMBINED. It is ~1.9GB/s, dead linear in pixels, and it is
// the single largest cost on every device that broadcasts.
//
// Most of that is not COPYING, it is WAITING. `gl.readPixels` into a JS array is synchronous: it
// flushes the pipeline, blocks until the GPU has finished the frame, and only then transfers. So
// the main thread sits idle through work that the hardware could have been doing in the background.
//
// The fix is standard GL practice, available in WebGL2 and not previously used here: read into a
// PIXEL_PACK_BUFFER (a GPU-side destination, so `readPixels` returns immediately), drop a fence,
// and collect the bytes on a LATER frame once that fence has signalled. The transfer still costs
// what it costs; the main thread simply stops standing still for it.
//
// THE TRADE, made explicitly by Daniel: one frame of added latency (~33ms at 30fps). His call, and
// his reasoning is the better one — "choppy playback is always a dealbreaker for live performance,
// so starting with smooth playback helps us find the honest limit of how instantaneous we can get
// while maintaining fps and resolution." Note the delay is CONSTANT, not variable, so frame
// INTERVALS are unchanged and a recording cannot drift from it.
//
// WHY IT IS NOT CHOSEN BY THE PROBE. The probe times one read against the just-rendered buffer,
// which is exactly the situation this mode cannot win: measured that way it is a blocking read
// plus bookkeeping. Its advantage only exists across frames. So it is chosen on architecture when
// supported and validated, and the fallbacks stay probe-chosen. `?buscapture=` still overrides,
// and `preferAsync` lets a consumer A/B it at runtime.
const RING = 3;   // in-flight reads; 2 suffices for one-frame pipelining, 3 absorbs a slow frame
const ASYNC_MISS_LIMIT = 30;   // consecutive frames with nothing ready before we give up on it

function createAsyncReader(gl, tag) {
  if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return null;
  const ring = [];     // { pbo, sync, bytes, w, h }
  let out = null;
  let broken = false;

  function dispose() {
    for (const e of ring) {
      try { if (e.sync) gl.deleteSync(e.sync); gl.deleteBuffer(e.pbo); } catch { /* context gone */ }
    }
    ring.length = 0;
  }

  function issue(w, h) {
    const bytes = w * h * 4;
    const pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
    // offset form: the destination is the BOUND buffer, so this returns without stalling
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);   // leaving it bound would break every other readPixels
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();   // without this the fence may never be submitted, so it could never signal
    ring.push({ pbo, sync, bytes, w, h });
  }

  // Collect the OLDEST in-flight read if its fence has signalled, else null.
  //
  // POLL ONLY, never a timed wait. WebGL2 caps `clientWaitSync`'s timeout at
  // MAX_CLIENT_WAIT_TIMEOUT_WEBGL, which many implementations report as ZERO — a nonzero timeout
  // there is an INVALID_OPERATION, not a wait. So the only portable question is "is it done yet",
  // asked once per frame. That is also the shape we want: never block the main thread, which is
  // the entire point of the exercise.
  function collect() {
    const e = ring[0];
    if (!e) return null;
    const status = gl.clientWaitSync(e.sync, gl.SYNC_FLUSH_COMMANDS_BIT, 0);
    if (status === gl.TIMEOUT_EXPIRED) return null;
    if (status === gl.WAIT_FAILED) { dispose(); broken = true; return null; }
    ring.shift();
    try {
      if (!out || out.length < e.bytes) out = new Uint8Array(e.bytes);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, e.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out, 0, e.bytes);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      return { pixels: out.subarray(0, e.bytes), w: e.w, h: e.h };
    } catch { broken = true; return null; }
    finally { try { gl.deleteSync(e.sync); gl.deleteBuffer(e.pbo); } catch { /* gone */ } }
  }

  // PROBE ONLY: wait for the fence, bounded by wall clock, YIELDING between polls.
  //
  // The yield is the whole point and a busy-loop here does not work. In Chromium the GL context
  // lives in a separate process and a sync object's signalled state reaches us through the
  // renderer's event loop — so spinning on `clientWaitSync` without ever returning to that loop
  // can burn the entire budget and never observe the fence signal, which reads downstream as
  // "the pipelined path produced no frame" and quietly disqualifies it.
  //
  // Yielding is safe here specifically because the caller is awaiting us: no new frame is
  // rendered in the gap, and the drawing buffer is preserved, so the pixels still correspond to
  // the reference the checksum was taken from. Runs exactly once per session.
  async function collectPrimed(maxMs = 500) {
    const until = performance.now() + maxMs;
    for (;;) {
      const r = collect();
      if (r || broken) return r;
      if (performance.now() > until) return null;
      await new Promise((res) => setTimeout(res, 1));
    }
  }

  return {
    get broken() { return broken; },
    get depth() { return ring.length; },
    get full() { return ring.length >= RING; },
    collectPrimed,
    // A size change invalidates everything in flight — those buffers hold the OLD dimensions and
    // handing them to a sink expecting the new ones is a garbled frame, not a stale one.
    resize() { dispose(); },
    issue, collect, dispose,
    tag,
  };
}

// createAdaptiveCapture({ gl, glCanvas, capCtx, override, tag, preferAsync })
//   gl        — the WebGL(2) context the program renders on
//   glCanvas  — its canvas (VideoFrame source)
//   capCtx    — a 2D context the consumer blits each frame into (the reference)
//   override  — force a mode: 'getimagedata' | 'readpixels' | 'videoframe' | 'async'
//   tag       — console-log prefix (defaults to '[conduit]')
//   preferAsync — () => bool. When true (default) and the pipelined path validates, it wins
//                 without being timed; see the note above. Re-read on reset().
// → { read(w, h) → Promise<{ pixels, topDown, readMs }>, get mode(), reset() }
export function createAdaptiveCapture({ gl, glCanvas, capCtx, override = null, tag = '[conduit]', preferAsync = null }) {
  let capMode = null;        // 'getimagedata' | 'readpixels' | 'videoframe' | 'async'
  let vfConvert = false;     // VideoFrame.copyTo({format:'RGBA'}) supported here
  let rpSwizzle = false;     // this device's readPixels returns B,G,R,A → swizzle back to RGBA
  let rpBuf = null, vfBuf = null;
  let asyncReader = null;
  let asyncW = 0, asyncH = 0;
  let asyncMisses = 0;   // consecutive frames the pipeline had nothing ready (see read())
  // WHY the pipelined path is not in use, surfaced through `mode` so a readback time that did not
  // improve is never ambiguous between "it ran and did not help" and "it never ran". B520's device
  // run reported `capture: videoframe` with no visible reason, which cost a round of guessing.
  let asyncWhyNot = '';

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

  // ONE pipelined frame. Issues this frame's read, then collects the OLDEST outstanding one —
  // which, at steady state, is the previous frame's, whose fence signalled long ago, so the
  // collect returns essentially instantly. That is the whole trick: the wait has already
  // happened, in the background, while we were doing something else.
  //
  // The blocking collect on the first frame (or the first after a resize) is deliberate: nothing
  // is in flight yet, so there is nothing to pipeline against, and blocking once beats handing a
  // sink a null frame it has no contract for. It also makes the returned frame correspond to the
  // buffer just rendered, which is what the probe's checksum needs.
  // `primed` (probe only) awaits the fence; the steady-state path never waits and returns null
  // when nothing is ready yet, which read() covers with a one-frame synchronous fallback.
  function readAsync(w, h) {
    const t = performance.now();
    if (w !== asyncW || h !== asyncH) { asyncReader.resize(); asyncW = w; asyncH = h; }
    if (!asyncReader.full) asyncReader.issue(w, h);
    const r = asyncReader.collect();
    if (!r) return null;
    if (rpSwizzle) swizzleBgra(r.pixels, r.pixels.length);
    return { pixels: r.pixels, topDown: false, readMs: performance.now() - t, delayed: true };
  }
  async function readAsyncPrimed(w, h) {
    const t = performance.now();
    if (w !== asyncW || h !== asyncH) { asyncReader.resize(); asyncW = w; asyncH = h; }
    if (!asyncReader.full) asyncReader.issue(w, h);
    const r = await asyncReader.collectPrimed();
    if (!r) return null;
    if (rpSwizzle) swizzleBgra(r.pixels, r.pixels.length);   // same channel-order fix as readPixels
    // bottom-up, exactly like the synchronous readPixels it replaces. `delayed` says these pixels
    // are from an EARLIER frame than the one just rendered — which matters because the consumer's
    // blitted canvas (the recorder's fast path) is current, so the two are one frame apart. Both
    // are internally consistent and neither drifts; a sink that needs them to agree must use one
    // or the other, not both.
    return { pixels: r.pixels, topDown: false, readMs: performance.now() - t, delayed: true };
  }

  // Runs against the CURRENT rendered+blitted buffer.
  async function probe(w, h) {
    if (override === 'async') {
      asyncReader = createAsyncReader(gl, tag);
      if (asyncReader) { capMode = 'async'; console.info(`${tag} capture path OVERRIDDEN: async (pipelined readback)`); return; }
      console.warn(`${tag} async capture unavailable (needs WebGL2) — falling through to the probe`);
    }
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

    // THE PIPELINED PATH, chosen last and on ARCHITECTURE rather than on the stopwatch above —
    // a single timed read is precisely the case it cannot win (see the note at the top). It has
    // to VALIDATE, though: this priming read blocks, so it produces pixels for the same buffer
    // the reference came from, and the checksum catches a driver that returns garbage or the
    // wrong channel order exactly as it does for every other path.
    if (preferAsync ? preferAsync() : true) {
      const reader = createAsyncReader(gl, tag);
      if (reader) {
        asyncReader = reader; asyncW = 0; asyncH = 0;
        try {
          const r = await readAsyncPrimed(w, h);
          // rpSwizzle may already be set from the readPixels probe; if it was NOT chosen there,
          // re-derive it here, since a PBO read has the same channel-order behavior
          let ok = !!r && sampleSig(r.pixels, w, h, true) === refSig;
          if (r && !ok && !rpSwizzle && sampleSig(r.pixels, w, h, true, true) === refSig) { rpSwizzle = true; ok = true; }
          if (ok && !reader.broken) {
            capMode = 'async';
            report.push('async VALID → chosen (pipelined; not timed here — its win is across frames)');
          } else {
            asyncWhyNot = r ? 'checksum mismatch' : 'fence never signalled';
            report.push(`async REJECTED (${asyncWhyNot})`);
            reader.dispose(); asyncReader = null;
          }
        } catch (e) {
          asyncWhyNot = e.message;
          report.push(`async failed (${e.message})`);
          reader.dispose(); asyncReader = null;
        }
      } else {
        asyncWhyNot = 'needs WebGL2';
        report.push('async unsupported (needs WebGL2)');
      }
    } else {
      asyncWhyNot = 'switched off';
    }
    console.info(`${tag} capture probe @ ${w}×${h}: ${report.join(' · ')} → ${capMode.toUpperCase()}`);
  }

  return {
    // the chosen path, and when it is NOT the pipelined one, why not — the panel shows this
    get mode() { return capMode + (capMode !== 'async' && asyncWhyNot ? ` (async: ${asyncWhyNot})` : ''); },
    // Re-probe from scratch. The A/B switch for the pipelined path needs this: the mode is
    // decided once per session, so flipping the preference has to invalidate that decision.
    reset() {
      if (asyncReader) { asyncReader.dispose(); asyncReader = null; }
      capMode = null; asyncW = 0; asyncH = 0; rpSwizzle = false; asyncMisses = 0; asyncWhyNot = '';
    },
    async read(w, h) {
      if (!capMode) await probe(w, h);
      if (capMode === 'async') {
        const r = readAsync(w, h);
        if (r) { asyncMisses = 0; return r; }
        // Nothing ready THIS frame. That is normal and expected on the first frame after a start
        // or a resolution change (nothing is in flight yet to collect), so cover it with one
        // synchronous read rather than handing the sinks a null they have no contract for.
        //
        // Persistent misses are a different thing — a driver whose fences never signal would
        // silently pay BOTH costs every frame, which is worse than either path alone. So count
        // them, and after a run of them give up on the pipeline for the session and say so.
        if (++asyncMisses >= ASYNC_MISS_LIMIT) {
          console.warn(`${tag} pipelined readback never completed in ${ASYNC_MISS_LIMIT} frames — falling back to readpixels`);
          asyncWhyNot = 'stalled at runtime';
          if (asyncReader) { asyncReader.dispose(); asyncReader = null; }
          capMode = 'readpixels';
        } else if (asyncReader?.broken) {
          console.warn(`${tag} pipelined readback failed — falling back to readpixels`);
          asyncWhyNot = 'failed at runtime';
          asyncReader.dispose(); asyncReader = null;
          capMode = 'readpixels';
        } else {
          return readReadPixels(w, h);   // this frame only; the pipeline keeps filling
        }
      }
      return capMode === 'readpixels' ? readReadPixels(w, h)
        : capMode === 'videoframe' ? await readVideoFrame(w, h)
        : readGetImageData(w, h);
    },
  };
}
