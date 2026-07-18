// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// conduit/hosts/electron-ndi/bridge.cjs — the NDI sender, Electron main-process side.
//
// The network sibling of syphon-bridge.js: the output bus (renderer) fans each
// program frame to the NDI sink (conduit/ndi-sink), which sends the raw RGBA
// pixels over IPC; main.js hands them here, and this publishes them as an NDI
// source any receiver on the LAN (Resolume Arena, OBS, another Fold node) lists
// like a camera.
//
// The native addon (ndi.c beside this file, raw N-API) links the locally installed Vizrt
// NDI SDK (/Library/NDI SDK for Apple — a licensed install, Daniel's download).
// Loaded lazily and guarded: if the addon isn't built or the SDK is absent,
// `available` reports false and the app never shows the NDI destination —
// the honesty rule, no dead UI.
//
// Lifecycle mirrors Syphon: the sender exists only while broadcast is ARMED
// (start carries the editable source name), so "Fold" appears on the network
// only while you're actually live.

'use strict';

let ndi = null;
try {
  ndi = require('./build/Release/fold_ndi.node');
} catch (e) {
  console.log('[ndi] addon not available (node-gyp rebuild in conduit/hosts/electron-ndi against the installed NDI SDK):', e.message);
}

let started = false;
let lastW = 0, lastH = 0;

function available() { return !!ndi; }

function start(name) {
  if (!ndi) return;
  const sourceName = String(name || 'Fold');
  started = ndi.start(sourceName);
  lastW = 0; lastH = 0;
  console.log(started
    ? `[ndi] source "${sourceName}" up — should appear in Arena's NDI sources`
    : '[ndi] failed to create the NDI sender');
}

// payload: { width, height, pixels, flipped } — raw RGBA from the renderer's
// output engine; `flipped` true = top-down rows (getImageData). NDI wants
// top-down, so the addon row-flips only the legacy bottom-up case.
function publish(payload) {
  if (!ndi || !started || !payload) return;
  const { width, height, pixels, flipped } = payload;
  if (!width || !height || !pixels) return;
  if (width !== lastW || height !== lastH) {
    lastW = width; lastH = height;
    console.log(`[ndi] publishing ${width}×${height}`);
  }
  try {
    ndi.publish(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height, !!flipped);
  } catch (e) {
    console.error('[ndi] publish failed:', e.message);
  }
}

function stop() {
  if (!ndi) return;
  started = false;
  try { ndi.stop(); } catch { /* already down */ }
  console.log('[ndi] source down');
}

module.exports = { available, start, publish, stop };
