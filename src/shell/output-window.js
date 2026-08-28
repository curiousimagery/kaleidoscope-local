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
// TWO SINKS, ONE CORE:
//   - createOutputWindow(env): the universal FLOATING output window (id:'window') —
//     a normal popup, available on any web/Electron build.
//   - createExternalDisplayWindow(env): the DESKTOP HDMI/projector output (id:'hdmi')
//     — the SAME popup, but Electron repositions it FULLSCREEN on the connected
//     external display (main.js setWindowOpenHandler keys on the window name). Only
//     registered in Electron with a display capability; mirrors the iPad Capacitor
//     HDMI destination's picker UX (auto-select on connect, resolution readout).
//
// Source sync is Fold-aware (so it lives in shell/, not engine-agnostic conduit):
//   - still image  → an ImageBitmap of the current source (set once)
//   - loaded video → the blob URL (the popup plays its own copy; loose sync)
//   - live camera  → the deviceId (the popup opens its OWN capture of that device)

import { createSurfacePoster } from 'conduit/external-surface';
import { perfFlags } from './perf-flags.js';

const CHANNEL = 'fold-output';

// ---- Fold-specific content (shared by both window sinks) --------------------
// A stable identity for the current source, so we only rebuild + re-post the
// (potentially heavy) source payload when it actually changes.
function sourceSignature(env) {
  // the Loop Builder owns the source while it's open — the window shows a text card
  // instead of the program, and releases its own decoder (see buildSourcePayload)
  if (env.loopIsActive?.()) return 'loop:' + (env.clip?.baking ? 'bake' : 'edit');
  if (env.live?.isLive) return 'cam:' + (env.liveCameraInfo?.()?.deviceId || '');
  // ⚠️ B773 — THE HDR FLAG RIDES THE SIGNATURE, the same mechanism the iPad's tone uses (B764).
  // The popup runs its OWN engine in its OWN document, so `allEngines()` in this document does not
  // reach it and `env.reapplyEngineMeta()` cannot either. Re-posting the payload is the only
  // channel there is, and changing the signature is what triggers a re-post — without this, the
  // toggle would only take effect on the next source load.
  if (env.sourceVideo && env.media?.sourceVideoUrl) {
    return 'vid:' + env.media.sourceVideoUrl + (perfFlags.hdrViaCanvas ? ':hdrcanvas' : '');
  }
  const src = env.engine?.getSourceImage?.();
  if (src) return 'img:' + (src.src || src.currentSrc || env.media?.sourceFilename || '1');
  return 'none';
}

async function buildSourcePayload(env) {
  // SUSPEND THE BROADCAST FOR THE LOOP BUILDER (Daniel: nothing worth broadcasting
  // happens in there). On iPad this is a memory fix — a 4K bake alongside a 4K external
  // render restarted the app — and on desktop it's the same honest behavior for free.
  if (env.loopIsActive?.()) {
    const name = env.media?.sourceFilename || 'this clip';
    return {
      kind: 'notice',
      text: env.clip?.baking ? `baking ${name} in Loop Builder…` : `editing ${name} in Loop Builder`,
    };
  }
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
    // ⚠️ B773 — COLOUR HAS TO TRAVEL WITH THE URL. Daniel, B772: *"it works great for motion and
    // perform modes in app but doesn't seem to be reaching the broadcast output."* Correct, and
    // the reason is structural: this payload named a file and nothing else, so the popup's engine
    // fell back to `DEFAULT_COLOR` (BT.709 SDR) for an HDR clip and never heard about the flag.
    //
    // ⚠️ `color` is here to let the popup's `isHDR()` gate answer, NOT to run a transform — this
    // path has no planar blitter, so the 2D-canvas detour is the only correction available. That
    // is why `tone` is deliberately absent: it lives in the blitter and would do nothing here.
    // The external-display sibling carries tone because its payload IS the planar path.
    return { kind: 'video', url: env.media.sourceVideoUrl,
             color: env.sourceColor || null, hdrViaCanvas: !!perfFlags.hdrViaCanvas };
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
function videoSync(env) {
  // motion staging's committed copy is its own element and stays one; otherwise the
  // program clock IS the source clock (env.sourceClock), which is a <video> today and
  // a native single decode under S3-A — the popup follows either without knowing which.
  const stgV = env.programVideo?.();
  if (stgV) return { t: stgV.currentTime || 0, paused: !!stgV.paused, rate: stgV.playbackRate || 1 };
  const c = env.sourceClock;
  if (!c?.present) return null;
  return { t: c.time || 0, paused: !!c.paused, rate: c.rate || 1 };
}

// ---- the shared window driver -----------------------------------------------
// Builds a sink around window.open + a BroadcastChannel poster. `opts` supplies
// what differs between the floating window and the fullscreen external display:
//   windowName  — the window.open target name (Electron keys placement on it)
//   getDims     — () → { width, height } the popup renders at
//   onExtChange — optional (cb) => unsubscribe for external-display connect events
function createWindowSink(env, opts) {
  const { id, windowName, getDims, features = 'width=1280,height=720', onExtChange } = opts;
  let win = null;
  let channel = null;

  const poster = createSurfacePoster({
    transport: {
      post: (msg) => { if (channel) channel.postMessage(msg); },
      isClosed: () => !!(win && win.closed),
    },
    content: {
      // programState = the COMMITTED program frame (shell/program-frame.js) — what the audience sees
      getState: () => (env.programState ? env.programState() : env.state),
      getOutputDims: () => getDims(),   // the window has no degradation ladder — cap ignored
      getVideoSync: () => videoSync(env),
      getTest: () => !!env.outputBus?.getStatus?.().testPattern,
      sourceSignature: () => sourceSignature(env),
      buildSourcePayload: () => buildSourcePayload(env),
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
  // frames). win.close() is synchronous and reliable during unload.
  function onMainUnload() {
    if (win && !win.closed) { try { win.close(); } catch { /* already gone */ } }
  }

  function start() {
    if (poster.active) return;
    win = window.open('output.html', windowName, features);
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

  const sink = {
    id,
    needsBus: false,            // self-rendering — a window-only session never runs the bus
    get active() { return poster.active && !!win && !win.closed; },
    get fps() { return poster.fps; },
    start,
    stop,
    publish() { /* no-op: the popup renders itself from state, not from bus frames */ },
  };
  // external-display sinks expose onDisplayChange so the output panel auto-selects on
  // connect + shows a live resolution readout + stops on unplug (the iPad HDMI UX).
  if (onExtChange) sink.onDisplayChange = onExtChange;
  return sink;
}

// ---- the universal floating output window (id:'window') ---------------------
export function createOutputWindow(env) {
  const outputDims = () => {
    const bus = env.outputBus;
    return { width: bus?.width || 1920, height: bus?.height || 1080 };
  };
  const sink = createWindowSink(env, {
    id: 'window',
    windowName: 'fold-output',
    features: 'width=1280,height=720',
    getDims: outputDims,
  });
  // needs a real popup: Capacitor has no second window at all, and iPadOS Safari
  // only opens grouped TABS (dead UI there). Touch = maxTouchPoints (iPadOS reports "MacIntel").
  sink.supported = typeof window !== 'undefined' && typeof window.open === 'function'
    && typeof BroadcastChannel !== 'undefined'
    && !window.Capacitor?.isNativePlatform?.()
    && !(navigator.maxTouchPoints > 1);
  return sink;
}

// ---- desktop HDMI / external-display output (id:'hdmi') ---------------------
// The SAME window, but Electron repositions it fullscreen on the external display.
// Requires the host's `displays` capability (electron/preload.js → main.js screen
// API). Renders at the display's native pixels so a projector fills sharply.
export function createExternalDisplayWindow(env) {
  const displays = env.host?.displays;
  let cur = displays?.get?.() || null;   // { connected, width, height } | null

  // Fit the composition's frame aspect inside the display's native pixels (letterboxed by
  // output.html), OR fill edge-to-edge when the HDMI-fill toggle is on — mirrors the iPad
  // Capacitor computeOutputDims so the two HDMI paths behave identically.
  const extDims = () => {
    const w = cur?.width || 1920, h = cur?.height || 1080;
    if (env.session?.hdmiFill) return { width: w, height: h };
    const a = env.session?.frameAspect || 0;
    if (!a) return { width: w, height: h };
    let ow = w, oh = Math.round(w / a);
    if (oh > h) { oh = h; ow = Math.round(h * a); }
    return { width: ow, height: oh };
  };

  const sink = createWindowSink(env, {
    id: 'hdmi',
    windowName: 'fold-output-ext',   // main.js setWindowOpenHandler places THIS name fullscreen on the external display
    features: 'width=1280,height=720',
    getDims: extDims,
    onExtChange: (cb) => {
      if (!displays?.onChanged) return () => {};
      return displays.onChanged((info) => { cur = info; cb(!!info?.connected, info); });
    },
  });
  sink.supported = !!(displays && displays.get);
  Object.defineProperty(sink, 'connected', { get: () => !!cur?.connected });
  // multi-display (Electron): expose the connected displays + which one is targeted, and
  // let the panel retarget. `cur` refreshes via onExtChange, so these stay current; the
  // host places the output window on the chosen display at the next open.
  sink.externalDisplays = () => cur?.displays || [];
  sink.currentDisplayId = () => cur?.targetId ?? null;
  sink.setExternalDisplay = (id) => { displays?.setTarget?.(id); };
  // guard start on a real display (matches the iPad HDMI sink) — else window.open with no external
  // screen just makes a floating popup on the main display, which reads as broken.
  const baseStart = sink.start;
  sink.start = () => {
    if (!cur?.connected) throw new Error('no external display detected — connect a monitor or projector first');
    baseStart();
  };
  return sink;
}
