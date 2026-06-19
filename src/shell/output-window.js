// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/output-window.js
//
// Drives the chrome-free GPU output window (output.html / src/output-view.js): a
// SECOND engine view that renders the live program itself on the GPU at the output
// resolution. This SUPERSEDES the old CPU-paint window sink (stage/window-sink.js,
// ~5fps@4K) — instead of fanning read-back pixels to the popup, we push only the
// small `state` JSON over a same-origin BroadcastChannel and let the popup's own
// engine render it. Zero readback, smooth to 4K, pure web (works in Electron too).
//
// It presents the SAME shape the output bus's sinks do, so the destination picker
// (output-panel.js) drives it identically — but `needsBus:false`, so a window-only
// session never starts the bus's read-back loop (the popup is self-rendering). The
// bus still serves Syphon + record, which need CPU pixels.
//
// Source sync is Fold-aware (so it lives in shell/, not the engine-agnostic stage/):
//   - still image  → an ImageBitmap of the current source (set once)
//   - loaded video → the blob URL (the popup plays its own copy; loose sync, deferred)
//   - live camera  → the deviceId (the popup opens its OWN capture of that exact device)

const CHANNEL = 'fold-output';

export function createOutputWindow(env) {
  let win = null;
  let channel = null;
  let active = false;
  let raf = 0;
  let lastSourceSig = '';
  let sourcePending = false;
  let fps = 0;

  // A stable identity for the current source, so we only rebuild + re-post the
  // (potentially heavy) source payload when it actually changes.
  function sourceSignature() {
    if (env.live?.isLive) return 'cam:' + (env.liveCameraInfo?.()?.deviceId || '');
    if (env.sourceVideo && env.media?.sourceVideoUrl) return 'vid:' + env.media.sourceVideoUrl;
    const src = env.engine?.getSourceImage?.();
    if (src) return 'img:' + (src.src || src.currentSrc || env.media?.sourceFilename || '1');
    return 'none';
  }

  async function buildSourcePayload() {
    if (env.live?.isLive) {
      return { kind: 'camera', deviceId: env.liveCameraInfo?.()?.deviceId || null };
    }
    if (env.sourceVideo && env.media?.sourceVideoUrl) {
      return { kind: 'video', url: env.media.sourceVideoUrl };
    }
    const src = env.engine?.getSourceImage?.();
    if (src) {
      try { return { kind: 'image', bitmap: await createImageBitmap(src) }; }
      catch { return { kind: 'none' }; }
    }
    return { kind: 'none' };
  }

  function outputDims() {
    const bus = env.outputBus;
    return { width: bus?.width || 1920, height: bus?.height || 1080 };
  }

  async function postSource() {
    if (!channel || sourcePending) return;
    sourcePending = true;
    try {
      const payload = await buildSourcePayload();
      if (channel) channel.postMessage({ type: 'source', payload, output: outputDims() });
    } finally {
      sourcePending = false;
    }
  }

  // Push the small state JSON every frame (params + the locked output dims). This
  // covers static editing, live camera, and motion playback uniformly without
  // hooking any of their render loops. Re-posts the source only when it changes.
  function loop() {
    if (!active) return;
    if (win && win.closed) { stop(); return; }
    const sig = sourceSignature();
    if (sig !== lastSourceSig) { lastSourceSig = sig; postSource(); }
    if (channel) {
      try { channel.postMessage({ type: 'state', state: env.state, output: outputDims() }); } catch {}
    }
    raf = requestAnimationFrame(loop);
  }

  function start() {
    if (active) return;
    win = window.open('output.html', 'fold-output', 'width=1280,height=720');
    if (!win) throw new Error('output window blocked — allow pop-ups for this site');
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === 'hello') { lastSourceSig = sourceSignature(); postSource(); }
      else if (msg.type === 'fps') fps = msg.fps || 0;
    };
    active = true;
    lastSourceSig = '';   // force an initial source post on the first loop tick
    fps = 0;
    loop();
  }

  function stop() {
    active = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (channel) { try { channel.close(); } catch {} channel = null; }
    if (win && !win.closed) { try { win.close(); } catch {} }
    win = null;
    fps = 0;
  }

  return {
    id: 'window',
    supported: typeof window !== 'undefined' && typeof window.open === 'function'
      && typeof BroadcastChannel !== 'undefined',
    needsBus: false,            // self-rendering — a window-only session never runs the bus
    get active() { return active && !!win && !win.closed; },
    get fps() { return fps; },
    start,
    stop,
    publish() { /* no-op: the popup renders itself from state, not from bus frames */ },
  };
}
