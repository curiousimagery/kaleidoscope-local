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
import { createSurfacePoster } from 'conduit/external-surface';

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
// A thin ADAPTER over conduit's transport-neutral poster (conduit/external-surface.js):
// this owns the iOS-specific plugin lifecycle (displayChanged/externalMessage/status
// + the crash-degradation triggers + the fill/frame-aspect output-dims math); the
// conduit core owns the per-frame state stream + source-on-change + the hello/fps
// handshake. The chrome supplies WHAT to post via `opts` (getState, sourceSignature/
// buildSourcePayload, getOutputDims/getFill/getFrameAspect/getVideoSync/getTest).
function createPoster(opts) {
  let connected = false;
  let dims = null;                    // display-native { width, height }, when known
  const changeHandlers = new Set();

  // ADAPTIVE DEGRADATION ladder: each external web-process death steps the render +
  // source sizes down (Daniel's landscape pass: the view crash-looped under memory
  // pressure, each reload re-allocating into the same wall). The conduit poster tracks
  // the generation (poster.gen) — degrade() on 'crashed', resetGen() on a fresh plug.
  // Gen 0 = display-native / 4096 stills; then 1920/2048; then 1280/1280.
  const RENDER_CAPS = [Infinity, 1920, 1280];
  const SOURCE_CAPS = [4096, 2048, 1280];
  const capDims = (d, cap) => {
    const mx = Math.max(d.width, d.height);
    if (!(mx > cap)) return d;
    const s = cap / mx;
    return { width: Math.round(d.width * s), height: Math.round(d.height * s) };
  };

  // the render dims to post, given the current degradation cap (from the poster)
  function computeOutputDims(cap) {
    // the display's native resolution when known — the point of HDMI — stepped down
    // by the crash generation when memory pressure killed the view
    const native = capDims(
      (dims?.width && dims?.height) ? dims : (opts.getOutputDims?.() || { width: 1920, height: 1080 }),
      cap);
    // FILL mode (the installation case): render edge-to-edge at the display's native
    // aspect instead of honoring the canvas frame aspect.
    if (opts.getFill?.()) return native;
    // default: honor the composition's FRAME ASPECT (Daniel's iPad note: a 4:5 canvas
    // was rendering as 16:9 out there — inconsistent with the canvas/recording/save,
    // which all honor it). Fit the frame aspect inside the native pixels: full sharpness
    // at that aspect, letterboxed by the view's object-fit.
    const a = opts.getFrameAspect?.() || 0;
    if (!a) return native;
    let w = native.width, h = Math.round(native.width / a);
    if (h > native.height) { h = native.height; w = Math.round(native.height * a); }
    return { width: w, height: h };
  }

  const poster = createSurfacePoster({
    transport: {
      post: (msg) => FoldExternalDisplay.postState({ json: JSON.stringify(msg) }),
    },
    content: {
      getState: opts.getState,
      getOutputDims: ({ cap }) => computeOutputDims(cap),
      getVideoSync: opts.getVideoSync,
      getTest: opts.getTest,
      sourceSignature: opts.sourceSignature,
      buildSourcePayload: opts.buildSourcePayload,
    },
    renderCaps: RENDER_CAPS,
    sourceCaps: SOURCE_CAPS,
  });

  function emitChange(s) {
    for (const h of changeHandlers) { try { h(connected, s); } catch { /* keep others alive */ } }
  }

  FoldExternalDisplay.addListener('displayChanged', (s) => {
    connected = !!s?.connected;
    dims = connected ? { width: s.width, height: s.height } : null;
    if (!connected) poster.resetGen();        // a fresh plug gets a fresh size budget
    if (!connected && poster.active) stop();   // display yanked mid-stream: stop cleanly
    emitChange(s);
  });
  FoldExternalDisplay.addListener('externalMessage', (msg) => {
    if (!msg) return;
    if (msg.type === 'hello') {
      poster.noteHello();   // view (re)loaded — repost the source next tick
      console.info('[fold] external view ready (hello)');
    } else if (msg.type === 'fps') {
      poster.noteFps(msg.fps);
    } else if (msg.type === 'loaded') {
      // navigation finished — attach names which window path presented
      console.info('[fold] external view loaded output.html (attach:', msg.attach + ')');
    } else if (msg.type === 'loadError') {
      console.warn('[fold] external view FAILED to load output.html:', msg.error);
    } else if (msg.type === 'crashed') {
      poster.degrade();     // step render + source sizes down; repost to the fresh view
      console.warn(`[fold] external view web process died (${msg.count ?? '?'} recent) — reloading at reduced size (gen ${poster.gen})`);
    } else if (msg.type === 'crashLoop') {
      console.warn('[fold] external view crash-looped — presentation stopped; iOS mirroring takes over (unplug/replug to retry)');
      stop();
    } else if (msg.type === 'glLost') {
      console.warn('[fold] external view lost its GL context — recovering');
    } else if (msg.type === 'glRestored') {
      console.info('[fold] external view GL context restored');
    }
  });
  // seed the connection state (a display may already be attached at launch)
  FoldExternalDisplay.getStatus()
    .then((s) => { connected = !!s?.connected; dims = connected ? { width: s.width, height: s.height } : null; emitChange(s); })
    .catch(() => {});

  function start() {
    if (poster.active) return;
    poster.arm();   // armed before the async plugin start, so a stop() mid-open cancels
    FoldExternalDisplay.start()
      .then((s) => {
        console.info('[fold] external display presenting (attach:', (s?.attach || '?') + ',',
          (s?.width || '?') + 'x' + (s?.height || '?') + ')');
        poster.begin();
      })
      .catch((e) => {
        console.warn('[fold] external display start failed:', e);
        stop();
      });
  }

  function stop() {
    if (!poster.active) return;
    poster.end();
    FoldExternalDisplay.stop().catch(() => {});
  }

  return {
    start, stop,
    get active() { return poster.active; },
    get connected() { return connected; },
    get fps() { return poster.fps; },
    get renderDims() { return poster.renderDims; },
    onDisplayChange(h) { changeHandlers.add(h); return () => changeHandlers.delete(h); },
  };
}

// ---- desktop chrome: the destination-picker sink (iPad) ----------------------
export function createExternalDisplaySink(env) {
  const poster = createPoster({
    getState: () => (env.programState ? env.programState() : env.state),
    getFrameAspect: () => env.session?.frameAspect || 1,
    getFill: () => !!env.session?.hdmiFill,
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
      if (env.live?.isLive) {
        // native: the acquisition gen rides the signature (a re-acquire restarts
        // the frame socket — the external receiver must rebuild); web: static
        const info = env.liveCameraInfo?.();
        return info?.stream
          ? `cam:native:${info.facing || ''}:${info.stream.gen ?? 0}`
          : 'cam:web';
      }
      if (env.sourceVideo && env.media?.sourceVideoUrl) return 'vid:' + env.media.sourceVideoUrl;
      const src = env.engine?.getSourceImage?.();
      if (src) return 'img:' + (src.src || src.currentSrc || env.media?.sourceFilename || '1');
      return 'none';
    },
    async buildSourcePayload({ sourceCap = 4096 } = {}) {
      if (env.live?.isLive) {
        // NATIVE camera (Capacitor iPad): the external view joins the frame
        // socket as a second client — the same frames the iPad previews, no
        // second capture. (A second getUserMedia of one camera is a device-
        // proven dead end on iOS: granted, then both captures starve.)
        const info = env.liveCameraInfo?.();
        if (info?.stream) {
          return { kind: 'native-camera', port: info.stream.port, mirror: info.stream.mirror };
        }
        return { kind: 'unsupported', reason: 'live camera over HDMI needs the native camera — stills broadcast fine' };
      }
      if (env.sourceVideo && env.media?.sourceVideoUrl) {
        return { kind: 'unsupported', reason: 'video sources on the external display are coming — use a still or the live camera for now' };
      }
      const src = env.engine?.getSourceImage?.();
      if (src) {
        try {
          const dataUrl = sourceToDataUrl(src, sourceCap);
          if (dataUrl) return { kind: 'image', dataUrl };
        } catch { /* fall through */ }
      }
      return { kind: 'none' };
    },
  });

  // publish the connected display's native dims on env — chrome that wants them
  // (the frame-aspect 'display' option matches the composition to the destination)
  poster.onDisplayChange((connected, s) => {
    env.externalDisplayDims = connected && s?.width ? { width: s.width, height: s.height } : null;
    env.externalDisplayDimsChanged?.();
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
  const sync = (connected, s) => {
    if (connected && !poster.active) poster.start();
    opts.onStatus?.(connected, poster.active);
    // the display's native dims, for the chrome's frame-aspect 'display' option
    opts.onDims?.(connected && s?.width ? { width: s.width, height: s.height } : null);
  };
  poster.onDisplayChange(sync);
  return {
    get active() { return poster.active; },
    get connected() { return poster.connected; },
    stop: poster.stop,
  };
}
