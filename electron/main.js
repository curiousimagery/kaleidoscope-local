// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// electron/main.js — Fold Live shell, main process.
//
// The Electron wrapper exists for ONE reason the browser can't serve: native
// live output (Syphon → Resolume/Arena) and, later, a second output-only window.
// It is a thin shell — it loads the SAME built web app (dist/) that ships to the
// browser, unchanged, and injects native host-services through the preload
// (window.foldHost, matching shell/host.js `webHost`). The app degrades to the
// web path when a service isn't available, so this wrapper adds capability
// without forking behavior.
//
// Increment 5: the host seam is live — the preload's syphon.start/publish/stop
// arrive here over IPC and drive the native SyphonMetalServer (syphon-bridge.js),
// so Fold's program frames reach Resolume Arena.

'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const syphon = require('./syphon-bridge');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Fold Live',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // renderer can't reach Node; host crosses via contextBridge
      nodeIntegration: false,
    },
  });

  // Load the built web app from disk — the same dist/ deployed to the browser.
  // vite builds with base:'./' (relative asset paths), so file:// resolves cleanly
  // with no dev server. Build it first: `npm run build` in the repo root.
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Detached so devtools don't resize the app window. Handy for verifying
  // window.foldHost during bring-up; revisit before any distributable build.
  win.webContents.openDevTools({ mode: 'detach' });

  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Syphon control from the renderer (via preload IPC). The server is created on
// arm (carrying the editable name), fed one frame per publish, torn down on stop.
ipcMain.on('syphon:start', (_e, { name } = {}) => syphon.start(name));
// `handle` (not `on`): publishImageData runs synchronously, so resolving the invoke
// only after it returns gives the renderer true backpressure — it can't outrun main
// and pile frames up in the IPC queue (the OOM fix; see preload.js publish()).
ipcMain.handle('syphon:frame', (_e, payload) => { syphon.publish(payload); });
ipcMain.on('syphon:stop', () => syphon.stop());

// Single-window tool: closing the window ends the session on every platform.
app.on('window-all-closed', () => {
  app.quit();
});

// Make sure the Syphon server is released even if quitting while live.
app.on('will-quit', () => { syphon.stop(); });
