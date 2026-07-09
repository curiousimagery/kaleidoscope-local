// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/host.js
//
// The HOST-SERVICES interface: capabilities the browser can't provide that a
// native shell (Electron on macOS, Capacitor/WKWebView on iOS) eventually will —
// Syphon GPU output, MIDI input, native camera controls, native file round-trip.
//
// The contract: the app NEVER assumes a host capability exists. It asks
// (`if (env.host.syphon.available) …`) and degrades gracefully to the browser
// path. The web build ships `webHost` — a no-op where every service reports
// `available: false` and every method is a safe stub (returns empty values, never
// throws), so an unguarded call can't break the web app. A native shell injects
// its own object of THIS SAME SHAPE via createApp's `host` param, so the wrapper
// work later mounts against a stable interface instead of editing back into the app.
//
// This is scaffolding (Phase 4): no native implementations yet, and nothing in the
// app reads `env.host` yet — the seam is defined so future features (Syphon out,
// MIDI control, native save) and the native shells have a fixed surface to build
// against. Threaded onto `env.host` by createApp (defaults to webHost on the web).

// The web no-op host. Also the reference for the interface shape a native host
// must implement — keep native implementations structurally identical to this.
export const webHost = {
  name: 'web',

  // GPU frame output to other apps (Syphon on macOS). Native shares the WebGL
  // output as an IOSurface/Metal texture into Resolume/Arena etc. — the browser
  // has no equivalent. Primary live-output use case (BACKLOG Phase 5 / Syphon).
  syphon: {
    available: false,
    start() {},
    publish(/* frame */) {},   // push a rendered frame to the shared output
    stop() {},
  },

  // Native macOS trackpad gestures (magnify + rotate via an NSEvent monitor in
  // the Electron shell — Chromium swallows rotate). Feeds the control bus as
  // the "trackpad" input device (shell/trackpad-input.js adapter).
  trackpad: {
    available: false,
    onGesture(/* handler */) { return () => {}; },   // subscribe; returns unsubscribe
  },

  // Lightweight local config (user preferences — the input rig): a JSON file in
  // the native shell's userData. The web app keeps localStorage.
  config: {
    available: false,
    async read() { return null; },
    async write(/* obj */) { return false; },
  },

  // MIDI control input (APC40 etc.) — map controllers to params live. The Web MIDI
  // API exists in some browsers but is gated/inconsistent; the native path is the
  // reliable one. (Deferred MIDI/kiosk front-end.)
  midi: {
    available: false,
    inputs: [],                          // available input devices
    onMessage(/* handler */) { return () => {}; },   // subscribe; returns unsubscribe
  },

  // Native camera controls the browser getUserMedia can't reach (lens select,
  // EV, WB, focus, 48MP stills). Browser camera (shell/camera.js) stays the
  // fallback; this lights up only where a native shell provides it.
  nativeCamera: {
    available: false,
    async listDevices() { return []; },
    async setControls(/* { lens, ev, wb, focus } */) {},
  },

  // Native file round-trip (Save/Open dialogs, Files app, sandbox paths) beyond
  // the browser's download + <input type=file>. The web app keeps using
  // downloadBlob / the file input; a native host can offer real save targets.
  fileSystem: {
    available: false,
    async save(/* blob, suggestedName */) { return null; },
    async open(/* { accept } */) { return null; },
  },
};
