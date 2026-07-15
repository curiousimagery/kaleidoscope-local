// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/external-display.js
//
// The HDMI / EXTERNAL DISPLAY destination (Capacitor iOS/iPadOS): drives the
// fold-external-display plugin, which presents the chrome-free output view
// (output.html) on the connected external screen. The SIBLING of
// shell/output-window.js with the transport swapped — instead of a popup +
// BroadcastChannel, the per-frame state message rides the plugin bridge
// (evaluateJavaScript into the external WKWebView), and the state posted is the
// COMMITTED program frame (env.programState — shell/program-frame.js), which is
// exactly the state-stream the arc plan called for. Zero readback: the external
// view renders the program itself on the GPU at the display's resolution.
//
// Source parity, per kind (the transport can only carry JSON):
//   - still image  → a JPEG data URL (capped long edge; ImageBitmap can't cross
//                    the bridge) — re-posted only on source change
//   - live camera  → the deviceId + negotiated dims; the external view opens its
//                    OWN capture of that device (the proven output-window
//                    pattern). Whether iOS allows the second concurrent capture
//                    is DEVICE-PENDING — if it refuses, the follow-up is a
//                    second client on the native camera's frame socket.
//   - loaded video → not yet supported across webviews (a blob URL is
//                    per-context); the external view shows an honest hint.
//                    Follow-up: write the clip to cache and serve it through the
//                    plugin's asset scheme.
//
// Registered as an outputBus sink `{ id:'hdmi', needsBus:false }` (self-
// rendering, like the output window — a broadcast-only session never runs the
// bus's readback loop) and surfaced in the destination picker via
// env.addOutputDestination. This module is DYNAMICALLY imported by main.js only
// on Capacitor, so @capacitor/core stays out of the web bundle (the
// native-camera.js pattern; the static registerPlugin import inside a lazy
// module is the proven-on-device shape).

import { registerPlugin } from '@capacitor/core';

const FoldExternalDisplay = registerPlugin('FoldExternalDisplay');

export function createExternalDisplaySink(env) {
  let active = false;
  let raf = 0;
  let lastSourceSig = '';
  let sourcePending = false;
  let fps = 0;
  let connected = false;
  let dims = null;                    // { width, height } of the display, when known
  const changeHandlers = new Set();

  function emitChange(s) {
    for (const h of changeHandlers) { try { h(connected, s); } catch { /* keep others alive */ } }
  }

  FoldExternalDisplay.addListener('displayChanged', (s) => {
    connected = !!s?.connected;
    dims = connected ? { width: s.width, height: s.height } : null;
    if (!connected && active) stop();   // display yanked mid-broadcast: stop cleanly
    emitChange(s);
  });
  FoldExternalDisplay.addListener('externalMessage', (msg) => {
    if (!msg) return;
    if (msg.type === 'hello') lastSourceSig = '';   // view (re)loaded — repost the source next tick
    else if (msg.type === 'fps') fps = msg.fps || 0;
  });
  // seed the connection state (a display may already be attached at launch)
  FoldExternalDisplay.getStatus()
    .then((s) => { connected = !!s?.connected; dims = connected ? { width: s.width, height: s.height } : null; emitChange(s); })
    .catch(() => {});

  // ---- source sync (output-window.js's rules, JSON-serializable payloads) ----
  function sourceSignature() {
    if (env.live?.isLive) return 'cam:' + (env.liveCameraInfo?.()?.deviceId || '');
    if (env.sourceVideo && env.media?.sourceVideoUrl) return 'vid:' + env.media.sourceVideoUrl;
    const src = env.engine?.getSourceImage?.();
    if (src) return 'img:' + (src.src || src.currentSrc || env.media?.sourceFilename || '1');
    return 'none';
  }

  async function buildSourcePayload() {
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
        // serialize to a JPEG data URL — capped so the one-time bridge post stays
        // sane (the external view renders at display res; 4096 keeps zoom crops sharp)
        const w = src.naturalWidth || src.videoWidth || src.width || 0;
        const h = src.naturalHeight || src.videoHeight || src.height || 0;
        if (!w || !h) return { kind: 'none' };
        const s = Math.min(1, 4096 / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * s));
        c.height = Math.max(1, Math.round(h * s));
        c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
        return { kind: 'image', dataUrl: c.toDataURL('image/jpeg', 0.9) };
      } catch { return { kind: 'none' }; }
    }
    return { kind: 'none' };
  }

  function outputDims() {
    // render at the DISPLAY's native resolution when known (that's the whole
    // point of HDMI out); fall back to the bus's configured output size
    if (dims?.width && dims?.height) return dims;
    const bus = env.outputBus;
    return { width: bus?.width || 1920, height: bus?.height || 1080 };
  }

  function videoSync() {
    const v = env.programVideo?.() || env.sourceVideo;
    if (!v) return null;
    return { t: v.currentTime || 0, paused: !!v.paused, rate: v.playbackRate || 1 };
  }

  function post(msg) {
    return FoldExternalDisplay.postState({ json: JSON.stringify(msg) });
  }

  async function postSource() {
    if (sourcePending) return;
    sourcePending = true;
    try {
      const payload = await buildSourcePayload();
      await post({ type: 'source', payload, output: outputDims() });
    } catch (e) {
      console.warn('[fold] external display source post failed:', e);
    } finally {
      sourcePending = false;
    }
  }

  // the per-frame state stream: the committed program frame + the video clock +
  // the test-pattern flag — the same message shape output-view already consumes
  function loop() {
    if (!active) return;
    const sig = sourceSignature();
    if (sig !== lastSourceSig) { lastSourceSig = sig; postSource(); }
    post({
      type: 'state',
      state: env.programState ? env.programState() : env.state,
      output: outputDims(),
      video: videoSync(),
      test: !!env.outputBus?.getStatus?.().testPattern,
    }).catch(() => {});
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    if (!active) return;
    active = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    fps = 0;
    FoldExternalDisplay.stop().catch(() => {});
  }

  return {
    id: 'hdmi',
    supported: true,
    needsBus: false,            // self-rendering — never starts the bus's readback loop
    get active() { return active; },
    get fps() { return fps; },
    get connected() { return connected; },
    // the output panel wires this: auto-select on plug-in, clean stop on yank
    onDisplayChange(h) { changeHandlers.add(h); return () => changeHandlers.delete(h); },
    start() {
      if (!connected) throw new Error('no external display detected — connect HDMI first');
      active = true;
      lastSourceSig = '';
      fps = 0;
      FoldExternalDisplay.start()
        .then(() => { if (active) loop(); })
        .catch((e) => {
          console.warn('[fold] external display start failed:', e);
          stop();
        });
    },
    stop,
    publish() { /* no-op: the external view renders itself from state, not bus frames */ },
  };
}
