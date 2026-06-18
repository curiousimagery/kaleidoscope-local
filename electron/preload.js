// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// electron/preload.js — injects the native host into the renderer.
//
// The app reads `window.foldHost` at startup (src/main.js host seam) and threads
// it onto `env.host`; createApp falls back to the web no-op (shell/host.js
// `webHost`) when it's absent. This preload exposes an object of THAT SAME SHAPE
// so the app sees a native host without any app-side branching. Keep it
// structurally in sync with webHost (and mock-host.js).
//
// contextIsolation is on, so the renderer never touches Node directly — every
// service crosses the bridge as a plain value or a proxied function.
//
// Increment 4: Syphon is a STUB (available:false) — there's no native module yet,
// so the honest answer is "can't broadcast," exactly like the web build. That's
// the point of `?mocksyphon`: it exercises the broadcasting UI on web. Real
// output arrives in Increment 5, which flips `available` to true and wires
// `publish` to IPC → the Syphon Metal server in the main process.

'use strict';

const { contextBridge } = require('electron');

const foldHost = {
  name: 'electron',

  // Native GPU output (Syphon). Stub until Increment 5 wires the native bridge —
  // dormant, same as web, but the seam is live so the sink drops in without
  // app changes.
  syphon: {
    available: false,
    start() {},
    publish(/* pixels, w, h */) {},
    stop() {},
  },

  // Parity stubs with webHost — not yet implemented in the shell, but present so
  // the interface shape stays whole for the app's `if (available)` guards.
  midi: {
    available: false,
    inputs: [],
    onMessage(/* handler */) { return () => {}; },
  },

  nativeCamera: {
    available: false,
    async listDevices() { return []; },
    async setControls(/* { lens, ev, wb, focus } */) {},
  },

  fileSystem: {
    available: false,
    async save(/* blob, suggestedName */) { return null; },
    async open(/* { accept } */) { return null; },
  },
};

contextBridge.exposeInMainWorld('foldHost', foldHost);

// Bring-up breadcrumb: confirms the preload ran and the host is the Electron one
// (not the webHost fallback). Visible in the detached devtools console.
console.log(`[fold-host] electron shell ready — syphon ${foldHost.syphon.available ? 'available' : 'stub'}`);
