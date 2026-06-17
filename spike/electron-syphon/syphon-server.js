'use strict';

// syphon-server.js — thin wrapper around node-syphon's SyphonOpenGLServer.
//
// Replaces the stub: receives RGBA pixel buffers from the preload IPC handler
// and publishes them as a Syphon shared texture that any Syphon client
// (Syphon Simple Server, Resolume Arena, VDMX, etc.) can receive.
//
// The server appears in Syphon's server directory under the name "Fold".
// Open Syphon Simple Server (free) or Arena to confirm frames are arriving.

const { SyphonMetalServer } = require('node-syphon');

let server = null;
let lastWidth = 0;
let lastHeight = 0;

function init() {
  try {
    server = new SyphonMetalServer('Fold');
    console.log('[syphon] server created:', server.name);
    console.log('[syphon] description:', JSON.stringify(server.description));
    console.log('[syphon] open Arena — "Fold" should appear as a Syphon source');
  } catch (e) {
    console.error('[syphon] FAILED to create server:', e.message);
    console.error('[syphon] stack:', e.stack);
    server = null;
  }
}

// publish() is called from the ipcMain frame handler.
// payload: { buffer: ArrayBuffer, width, height, ... }
function publish(payload) {
  if (!server) return;

  const { buffer, width, height } = payload;

  if (width !== lastWidth || height !== lastHeight) {
    lastWidth = width;
    lastHeight = height;
    console.log(`[syphon] publishing ${width}×${height}  (${server.hasClients ? 'client connected' : 'no clients yet'})`);
  }

  // getImageData returns RGBA top-to-bottom. Syphon expects bottom-to-top
  // by default (OpenGL convention), so pass flipped:true to tell receivers
  // the data is in image/screen coordinate order (origin top-left).
  const pixels = new Uint8ClampedArray(buffer);

  try {
    server.publishImageData(
      pixels,
      { x: 0, y: 0, width, height },
      { width, height },
      true   // flipped: our data is top-to-bottom (screen coords)
    );
  } catch (e) {
    console.error('[syphon] publish error:', e.message);
  }
}

function destroy() {
  if (server) {
    server.dispose();
    server = null;
    console.log('[syphon] server disposed');
  }
}

module.exports = { init, publish, destroy };
