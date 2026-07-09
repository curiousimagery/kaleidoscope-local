// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// electron/trackpad-bridge.js — loads the native NSEvent gesture addon
// (native/trackpad) and hands its magnify/rotate stream to main.js. Missing or
// unbuilt addon degrades to available:false (the web app never sees a trackpad
// device and nothing else changes).

'use strict';

let addon = null;
if (process.platform === 'darwin') {
  try {
    addon = require('./native/trackpad/build/Release/fold_trackpad.node');
  } catch (e) {
    console.warn('[fold] trackpad addon unavailable (run: npx node-gyp rebuild in native/trackpad):', e.message);
  }
}

let running = false;

module.exports = {
  available: !!addon,
  start(cb) {
    if (!addon || running) return;
    running = true;
    addon.start(cb);
  },
  stop() {
    if (!addon || !running) return;
    running = false;
    addon.stop();
  },
};
