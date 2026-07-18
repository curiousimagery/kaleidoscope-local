// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/output-window.js
//
// Drives the chrome-free GPU output window (output.html / src/output-view.js): a
// SECOND engine view that renders the live program itself on the GPU at the output
// resolution. Instead of fanning read-back pixels to the popup, we push only the
// small `state` JSON over a same-origin BroadcastChannel and let the popup's own
// engine render it. Zero readback, smooth to 4K, pure web (works in Electron too).
//
// This is now a thin ADAPTER over conduit's transport-neutral poster core
// (conduit/external-surface.js) — the SAME spine the iOS external display uses,
// with the transport swapped: a BroadcastChannel + popup here, the native bridge
// there. This module supplies the transport (popup + channel) and the Fold-specific
// content (what state/source to post). It presents the output-bus sink shape so the
// destination picker drives it identically — but `needsBus:false`, so a window-only
// session never runs the bus's readback loop (the popup is self-rendering).
//
// Source sync is Fold-aware (so it lives in shell/, not engine-agnostic conduit):
//   - still image  → an ImageBitmap of the current source (set once)
//   - loaded video → the blob URL (the popup plays its own copy; loose sync)
//   - live camera  → the deviceId (the popup opens its OWN capture of that device)

import { createSurfacePoster } from 'conduit/external-surface';

const CHANNEL = 'fold-output';

export function createOutputWindow(env) {
  let win = null;
  let channel = null;

  function outputDims() {
    const bus = env.outputBus;
    return { width: bus?.width || 1920, height: bus?.height || 1080 };
  }

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
      // include the MAIN capture's negotiated dimensions so the popup's own capture
      // of the same device lands on the same mode — a second consumer can otherwise
      // negotiate a different aspect (seen on Firefox), skewing every slice coordinate
      const size = env.engine?.getSourceSize?.() || {};
      return {
        kind: 'camera',
        deviceId: env.liveCameraInfo?.()?.deviceId || null,
        width: size.w || undefined,
        height: size.h || undefined,
      };
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

  // For a loaded-video source, slave the popup's own copy to the PROGRAM's clock.
  // While motion staging runs, the program clock is the committed copy (the popup
  // follows the on-air loop, not the edit scrubs).
  function videoSync() {
    const v = env.programVideo?.() || env.sourceVideo;
    if (!v) return null;
    return { t: v.currentTime || 0, paused: !!v.paused, rate: v.playbackRate || 1 };
  }

  const poster = createSurfacePoster({
    transport: {
      post: (msg) => { if (channel) channel.postMessage(msg); },
      isClosed: () => !!(win && win.closed),
    },
    content: {
      // programState = the COMMITTED program frame (shell/program-frame.js) — what the audience sees
      getState: () => (env.programState ? env.programState() : env.state),
      getOutputDims: () => outputDims(),   // the window has no degradation ladder — cap ignored
      getVideoSync: () => videoSync(),
      getTest: () => !!env.outputBus?.getStatus?.().testPattern,
      sourceSignature,
      buildSourcePayload,
    },
    onClosed: () => teardownTransport(),   // the user closed the popup → clean up channel + handle
  });

  function teardownTransport() {
    if (channel) { try { channel.close(); } catch { /* already closed */ } channel = null; }
    if (win && !win.closed) { try { win.close(); } catch { /* already gone */ } }
    win = null;
  }

  // the driving app is closing / navigating away — take the self-rendering popup with
  // it (it would otherwise persist starved of the state stream, replaying its last few
  // frames). win.close() is synchronous and reliable during unload — the opener may
  // always close a window it opened — where a BroadcastChannel 'close' post might not
  // deliver before teardown. Registered only while a window session is live.
  function onMainUnload() {
    if (win && !win.closed) { try { win.close(); } catch { /* already gone */ } }
  }

  function start() {
    if (poster.active) return;
    win = window.open('output.html', 'fold-output', 'width=1280,height=720');
    if (!win) throw new Error('output window blocked — allow pop-ups for this site');
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === 'hello') poster.noteHello();
      else if (msg.type === 'fps') poster.noteFps(msg.fps);
    };
    window.addEventListener('pagehide', onMainUnload);
    poster.arm();
    poster.begin();
  }

  function stop() {
    window.removeEventListener('pagehide', onMainUnload);
    poster.end();
    teardownTransport();
  }

  return {
    id: 'window',
    // needs a real popup: Capacitor has no second window at all, and iPadOS Safari
    // only opens grouped TABS (dead UI there) — with HDMI/AirPlay/NDI on the iPad a
    // "window" adds nothing anyway. Touch = maxTouchPoints (iPadOS reports "MacIntel").
    supported: typeof window !== 'undefined' && typeof window.open === 'function'
      && typeof BroadcastChannel !== 'undefined'
      && !window.Capacitor?.isNativePlatform?.()
      && !(navigator.maxTouchPoints > 1),
    needsBus: false,            // self-rendering — a window-only session never runs the bus
    get active() { return poster.active && !!win && !win.closed; },
    get fps() { return poster.fps; },
    start,
    stop,
    publish() { /* no-op: the popup renders itself from state, not from bus frames */ },
  };
}
