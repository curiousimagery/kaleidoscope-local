// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/external-display.js
//
// HDMI / EXTERNAL DISPLAY output (Capacitor iOS/iPadOS): drives the
// fold-external-display plugin, which presents the chrome-free output view
// (output.html) on the connected external screen. The SIBLING of
// shell/output-window.js with the transport swapped — instead of a popup +
// BroadcastChannel, the per-frame state message rides the plugin bridge
// (evaluateJavaScript into the external WKWebView), and the state posted is the
// COMMITTED program frame (shell/program-frame.js) — exactly the state-stream
// the arc plan called for. Zero readback: the external view renders the program
// itself on the GPU at the display's native resolution.
//
// TWO CONSUMERS, ONE POSTER CORE (Daniel's UX calls):
//   - createExternalDisplaySink(env): the DESKTOP-CHROME destination (iPad +
//     any Capacitor build of the full app) — joins the output panel's picker
//     as { id:'hdmi', needsBus:false }, auto-SELECTED on plug-in but armed by
//     the existing start button.
//   - createExternalDisplayAutoconnect(opts): the MOBILE-CHROME behavior
//     (iPhone) — no destinations UI there; one display, one intent: plug in
//     and the program presents + streams, unplug and it stops.
//
// Source parity, per kind (the transport can only carry JSON):
//   - still image  → a JPEG data URL (capped long edge; ImageBitmap can't
//                    cross the bridge) — re-posted only on source change
//   - live camera  → the deviceId + negotiated dims; the external view opens
//                    its OWN capture of that device (the proven output-window
//                    pattern). Whether iOS allows the second concurrent capture
//                    is DEVICE-PENDING — if it refuses, the follow-up is a
//                    second client on the native camera's frame socket.
//   - loaded video → not yet supported across webviews (a blob URL is
//                    per-context); the external view shows an honest hint.
//
// This module is DYNAMICALLY imported by each chrome only on Capacitor, so
// @capacitor/core stays out of the web bundle (the native-camera pattern; a
// static registerPlugin inside a lazy module is the proven-on-device shape).

import { registerPlugin } from '@capacitor/core';

const FoldExternalDisplay = registerPlugin('FoldExternalDisplay');

// serialize a drawable source (img / canvas / video frame) to a JPEG data URL —
// capped so the one-time bridge post stays sane (the external view renders at
// display res; 4096 keeps zoom crops sharp)
export function sourceToDataUrl(src, cap = 4096) {
  const w = src.naturalWidth || src.videoWidth || src.width || 0;
  const h = src.naturalHeight || src.videoHeight || src.height || 0;
  if (!w || !h) return null;
  const s = Math.min(1, cap / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9);
}

// ---- the poster core --------------------------------------------------------
// Owns the plugin lifecycle + the per-frame state stream; the chrome supplies
// WHAT to post: getState (the committed program look), sourceSignature/
// buildSourcePayload (source sync), getOutputDims/getVideoSync/getTest.
function createPoster(opts) {
  let active = false;
  let raf = 0;
  let lastSourceSig = '';
  let sourcePending = false;
  let fps = 0;
  let connected = false;
  let dims = null;                    // display-native { width, height }, when known
  const changeHandlers = new Set();

  function emitChange(s) {
    for (const h of changeHandlers) { try { h(connected, s); } catch { /* keep others alive */ } }
  }

  FoldExternalDisplay.addListener('displayChanged', (s) => {
    connected = !!s?.connected;
    dims = connected ? { width: s.width, height: s.height } : null;
    if (!connected && active) stop();   // display yanked mid-stream: stop cleanly
    emitChange(s);
  });
  FoldExternalDisplay.addListener('externalMessage', (msg) => {
    if (!msg) return;
    if (msg.type === 'hello') {
      lastSourceSig = '';   // view (re)loaded — repost the source next tick
      console.info('[fold] external view ready (hello)');
    } else if (msg.type === 'fps') {
      fps = msg.fps || 0;
    } else if (msg.type === 'loaded') {
      // navigation finished — attach names which window path presented
      console.info('[fold] external view loaded output.html (attach:', msg.attach + ')');
    } else if (msg.type === 'loadError') {
      console.warn('[fold] external view FAILED to load output.html:', msg.error);
    }
  });
  // seed the connection state (a display may already be attached at launch)
  FoldExternalDisplay.getStatus()
    .then((s) => { connected = !!s?.connected; dims = connected ? { width: s.width, height: s.height } : null; emitChange(s); })
    .catch(() => {});

  function outputDims() {
    // the display's native resolution when known — the point of HDMI
    const native = (dims?.width && dims?.height)
      ? dims
      : (opts.getOutputDims?.() || { width: 1920, height: 1080 });
    // honor the composition's FRAME ASPECT (Daniel's iPad note: a 4:5 canvas
    // was rendering as 16:9 out there — inconsistent with the canvas/recording/
    // save, which all honor it). Fit the frame aspect inside the native pixels:
    // full sharpness at that aspect, letterboxed by the view's object-fit.
    // A "fill the display" option is a cheap follow-up if wanted.
    const a = opts.getFrameAspect?.() || 0;
    if (!a) return native;
    let w = native.width, h = Math.round(native.width / a);
    if (h > native.height) { h = native.height; w = Math.round(native.height * a); }
    return { width: w, height: h };
  }

  function post(msg) {
    return FoldExternalDisplay.postState({ json: JSON.stringify(msg) });
  }

  async function postSource() {
    if (sourcePending) return;
    sourcePending = true;
    try {
      const payload = await opts.buildSourcePayload();
      await post({ type: 'source', payload, output: outputDims() });
    } catch (e) {
      console.warn('[fold] external display source post failed:', e);
    } finally {
      sourcePending = false;
    }
  }

  // the per-frame state stream: the committed program look + the video clock +
  // the test-pattern flag — the message shape output-view already consumes
  function loop() {
    if (!active) return;
    const sig = opts.sourceSignature();
    if (sig !== lastSourceSig) { lastSourceSig = sig; postSource(); }
    post({
      type: 'state',
      state: opts.getState(),
      output: outputDims(),
      video: opts.getVideoSync?.() || null,
      test: !!opts.getTest?.(),
    }).catch(() => {});
    raf = requestAnimationFrame(loop);
  }

  function start() {
    if (active) return;
    active = true;
    lastSourceSig = '';
    fps = 0;
    FoldExternalDisplay.start()
      .then((s) => {
        console.info('[fold] external display presenting (attach:', (s?.attach || '?') + ',',
          (s?.width || '?') + 'x' + (s?.height || '?') + ')');
        if (active) loop();
      })
      .catch((e) => {
        console.warn('[fold] external display start failed:', e);
        stop();
      });
  }

  function stop() {
    if (!active) return;
    active = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    fps = 0;
    FoldExternalDisplay.stop().catch(() => {});
  }

  return {
    start, stop,
    get active() { return active; },
    get connected() { return connected; },
    get fps() { return fps; },
    onDisplayChange(h) { changeHandlers.add(h); return () => changeHandlers.delete(h); },
  };
}

// ---- desktop chrome: the destination-picker sink (iPad) ----------------------
export function createExternalDisplaySink(env) {
  const poster = createPoster({
    getState: () => (env.programState ? env.programState() : env.state),
    getFrameAspect: () => env.session?.frameAspect || 1,
    getOutputDims: () => {
      const bus = env.outputBus;
      return { width: bus?.width || 1920, height: bus?.height || 1080 };
    },
    getVideoSync: () => {
      const v = env.programVideo?.() || env.sourceVideo;
      if (!v) return null;
      return { t: v.currentTime || 0, paused: !!v.paused, rate: v.playbackRate || 1 };
    },
    getTest: () => !!env.outputBus?.getStatus?.().testPattern,
    sourceSignature: () => {
      if (env.live?.isLive) return 'cam:' + (env.liveCameraInfo?.()?.deviceId || '');
      if (env.sourceVideo && env.media?.sourceVideoUrl) return 'vid:' + env.media.sourceVideoUrl;
      const src = env.engine?.getSourceImage?.();
      if (src) return 'img:' + (src.src || src.currentSrc || env.media?.sourceFilename || '1');
      return 'none';
    },
    async buildSourcePayload() {
      if (env.live?.isLive) {
        const size = env.engine?.getSourceSize?.() || {};
        return {
          kind: 'camera',
          deviceId: env.liveCameraInfo?.()?.deviceId || null,
          width: size.w || undefined,
          height: size.h || undefined,
        };
      }
      if (env.sourceVideo && env.media?.sourceVideoUrl) {
        return { kind: 'unsupported', reason: 'video sources on the external display are coming — use a still or the live camera for now' };
      }
      const src = env.engine?.getSourceImage?.();
      if (src) {
        try {
          const dataUrl = sourceToDataUrl(src);
          if (dataUrl) return { kind: 'image', dataUrl };
        } catch { /* fall through */ }
      }
      return { kind: 'none' };
    },
  });

  return {
    id: 'hdmi',
    supported: true,
    needsBus: false,            // self-rendering — never starts the bus's readback loop
    get active() { return poster.active; },
    get fps() { return poster.fps; },
    get connected() { return poster.connected; },
    // the output panel wires this: auto-select on plug-in, clean stop on yank
    onDisplayChange: poster.onDisplayChange,
    start() {
      if (!poster.connected) throw new Error('no external display detected — connect HDMI first');
      poster.start();
    },
    stop: poster.stop,
    publish() { /* no-op: the external view renders itself from state, not bus frames */ },
  };
}

// ---- mobile chrome: autoconnect (iPhone) --------------------------------------
// One display, one intent (Daniel's call): plug in → present + stream, unplug →
// stop. The chrome supplies the program accessor + source payloads; onStatus
// gets (connected, streaming) for any status chrome it wants to show.
export function createExternalDisplayAutoconnect(opts) {
  const poster = createPoster(opts);
  const sync = (connected) => {
    if (connected && !poster.active) poster.start();
    opts.onStatus?.(connected, poster.active);
  };
  poster.onDisplayChange(sync);
  return {
    get active() { return poster.active; },
    get connected() { return poster.connected; },
    stop: poster.stop,
  };
}
