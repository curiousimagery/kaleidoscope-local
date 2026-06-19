// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// electron/syphon-bridge.js — the native Syphon server, main-process side.
//
// Thin wrapper around node-syphon's SyphonMetalServer. The output bus (renderer)
// fans each program frame to the Syphon SINK (stage/syphon-sink.js), which sends the
// raw RGBA pixels over IPC; main.js hands them here, and this publishes them as a
// Syphon shared texture any Syphon client (Resolume Arena, VDMX, Syphon Simple
// Server) can receive.
//
// Lifecycle: the server is created when broadcast is ARMED (start, carrying the name
// from the output row) and disposed when disarmed or on quit — so "Fold" only
// appears in Arena's source list while you're actually live, not whenever the app
// is open. Adapted from the validated spike (spike/electron-syphon/syphon-server.js).

'use strict';

const { SyphonMetalServer } = require('node-syphon');

let server = null;
let lastW = 0, lastH = 0;

function start(name) {
  if (server) stop();   // recreate cleanly if already up (e.g. name changed)
  const serverName = String(name || 'Fold');
  try {
    server = new SyphonMetalServer(serverName);
    lastW = 0; lastH = 0;
    console.log(`[syphon] server "${serverName}" up — should appear in Arena's Syphon sources`);
  } catch (e) {
    console.error('[syphon] failed to create server:', e.message);
    server = null;
  }
}

// payload: { width, height, pixels, flipped } — pixels is raw RGBA from the renderer's
// output engine; `flipped` declares its row order (top-down getImageData ⇒ true).
function publish(payload) {
  if (!server || !payload) return;
  const { width, height, pixels, flipped } = payload;
  if (!width || !height || !pixels) return;

  if (width !== lastW || height !== lastH) {
    lastW = width; lastH = height;
    console.log(`[syphon] publishing ${width}×${height} (${server.hasClients ? 'client connected' : 'no clients yet'})`);
  }

  try {
    // The output engine renders via drawImage→getImageData, which yields raw RGBA in
    // TOP-DOWN (top-left screen) order, so flipped:true. Syphon's `flipped` flag
    // declares the data IS in top-left order. (The original FBO readPixels path was
    // bottom-up ⇒ flipped:false; the renderer now declares orientation per frame.)
    // VERIFY IN ARENA via the test pattern: if "TOP" is upside-down, this flag is wrong.
    server.publishImageData(
      new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      { x: 0, y: 0, width, height },
      { width, height },
      !!flipped,
    );
  } catch (e) {
    console.error('[syphon] publish error:', e.message);
  }
}

function stop() {
  if (server) {
    try { server.dispose(); } catch (e) { console.error('[syphon] dispose error:', e.message); }
    server = null;
    console.log('[syphon] server disposed');
  }
}

module.exports = { start, publish, stop };
