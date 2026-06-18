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
// Increment 5: Syphon is LIVE. `available:true`, and start/publish/stop send over
// IPC to the Syphon Metal server in the main process (electron/syphon-bridge.js).
// The renderer's output bus drives this through stage/syphon-sink.js; the sink only
// forwards while broadcast is armed, so the hot publish path (a full RGBA frame
// crossing the process boundary) runs only when you're actually live.

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Tracks the armed state on this side too: a belt-and-suspenders gate so a stray
// publish can't send a frame when no server is up (the sink is the primary gate).
let syphonStarted = false;
// Backpressure: at most ONE frame on the wire to main at a time (see publish).
let frameInFlight = false;

const foldHost = {
  name: 'electron',

  // Native GPU output (Syphon) → IPC → SyphonMetalServer in main. Created when
  // armed (start, carrying the editable name), torn down on stop.
  syphon: {
    available: true,
    start(name) {
      syphonStarted = true;
      frameInFlight = false;
      ipcRenderer.send('syphon:start', { name: name || 'Fold' });
    },
    // pixels: a Uint8Array (raw bottom-up RGBA) from the renderer; structured-cloned
    // across IPC. Orientation (the Syphon flipped flag) is the bridge's concern.
    //
    // BACKPRESSURE IS MANDATORY HERE. The renderer produces frames faster than main
    // can upload them to Syphon, and `ipcRenderer.send` would QUEUE every frame's
    // ~15MB payload without bound — the heap blows up (the out-of-memory we hit). So
    // `invoke` + an in-flight flag caps it to one frame on the wire: while main is
    // still publishing the previous frame, new frames are DROPPED, not buffered.
    // Dropping is correct for live output — Arena only ever wants the freshest frame,
    // never a backlog (a backlog is just latency you can't see past anyway).
    publish(pixels, width, height) {
      if (!syphonStarted || frameInFlight) return;
      frameInFlight = true;
      ipcRenderer.invoke('syphon:frame', { width, height, pixels })
        .catch(() => {})
        .finally(() => { frameInFlight = false; });
    },
    stop() {
      syphonStarted = false;
      frameInFlight = false;
      ipcRenderer.send('syphon:stop');
    },
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
