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

const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const syphon = require('./syphon-bridge');
const ndi = require('./ndi-bridge');
const trackpad = require('./trackpad-bridge');
const remote = require('./remote-input');

// A live-output shell must keep rendering when it ISN'T the focused window —
// the whole point is driving Arena while Fold broadcasts underneath. Chromium
// deprioritizes background renderers (starving rAF/timers), which paused Fold's
// playback the moment focus moved to Arena. This switch opts the renderer out
// process-wide; the per-window backgroundThrottling below covers occlusion.
app.commandLine.appendSwitch('disable-renderer-backgrounding');

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
      // Keep rAF + timers + the Page Visibility API running while blurred or
      // fully occluded (e.g. Arena fullscreen over Fold) — otherwise playback
      // and the output bus freeze the moment Fold loses focus mid-broadcast.
      backgroundThrottling: false,
    },
  });

  // Load the built web app from disk — the same dist/ deployed to the browser.
  // vite builds with base:'./' (relative asset paths), so file:// resolves cleanly
  // with no dev server. In DEV (`npm start`) dist/ is the sibling repo build; in a
  // PACKAGED app it's copied into Resources/dist (electron-builder extraResources).
  const indexHtml = app.isPackaged
    ? path.join(process.resourcesPath, 'dist', 'index.html')
    : path.join(__dirname, '..', 'dist', 'index.html');
  win.loadFile(indexHtml);

  // Detached devtools during dev only — never in a packaged build.
  if (!app.isPackaged) win.webContents.openDevTools({ mode: 'detach' });

  win.on('closed', () => { win = null; });
}

app.whenReady().then(async () => {
  // The built web app ships a PWA service worker (offline precache for the browser).
  // In Electron that causes STALE loads: a freshly rebuilt dist/ is ignored because
  // the SW keeps serving the old cached bundle, so the app is stuck on an old build
  // no matter how many times you restart. Clear the SW + Cache-API storage on each
  // launch so Electron always loads the CURRENT dist. localStorage prefs (camera
  // device, output destination) are NOT cleared.
  try {
    await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });
  } catch (e) {
    console.warn('[fold] could not clear service-worker cache', e);
  }

  // Grant renderer permission REQUESTS and CHECKS. Electron approves requests
  // by default, but Web MIDI also consults the permission CHECK handler — with
  // none set, navigator.requestMIDIAccess NEVER SETTLES (verified: it hangs,
  // which wedged the whole inputs tab in the DMG). This is our own app in a
  // trusted shell; granting everything matches the browser-with-user-consent
  // posture the web build gets.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(true));
  session.defaultSession.setPermissionCheckHandler(() => true);

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

// NDI control — Syphon's network sibling (ndi-bridge.js → the fold_ndi addon →
// the installed NDI SDK). Same arm/publish/stop shape, same invoke-backpressure
// on the frame path; `ndi:available` gates the renderer's destination row on
// whether the addon actually loaded (no SDK / no build → no NDI in the picker).
ipcMain.on('ndi:available', (e) => { e.returnValue = ndi.available(); });
ipcMain.on('ndi:start', (_e, { name } = {}) => ndi.start(name));
ipcMain.handle('ndi:frame', (_e, payload) => { ndi.publish(payload); });
ipcMain.on('ndi:stop', () => ndi.stop());

// Native trackpad gestures (Arc 6): the NSEvent monitor streams magnify/rotate
// deltas; forward them to the renderer where the control bus maps them like any
// other input device. `sendSync` availability probe runs once from the preload.
ipcMain.on('trackpad:available', (e) => { e.returnValue = trackpad.available; });
ipcMain.on('trackpad:start', (e) => {
  trackpad.start((ev) => {
    const wc = win?.webContents;
    if (wc && !wc.isDestroyed()) wc.send('trackpad:gesture', ev);
  });
});
ipcMain.on('trackpad:stop', () => trackpad.stop());

// Mobile gesture input (Arc 6): the shell hosts the LAN page + WebSocket that
// turns an iPhone/iPad into an input device; gesture deltas and connect status
// forward to the renderer where the control bus maps them.
remote.setHandlers({
  message: (msg) => {
    const wc = win?.webContents;
    if (wc && !wc.isDestroyed()) wc.send('remote:signal', msg);
  },
  status: (st) => {
    const wc = win?.webContents;
    if (wc && !wc.isDestroyed()) wc.send('remote:status', st);
  },
});
ipcMain.handle('remote:start', () => remote.start());
ipcMain.on('remote:stop', () => remote.stop());
ipcMain.on('remote:push', (_e, obj) => remote.broadcast(obj));

// Lightweight local config (user preferences — the input rig, etc.): one JSON
// file in userData. No database, session discipline intact; the renderer keeps
// localStorage as its fallback so the web build is unaffected.
const configPath = () => path.join(app.getPath('userData'), 'fold-config.json');
ipcMain.handle('config:read', () => {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return null; }
});
ipcMain.handle('config:write', (_e, obj) => {
  try { fs.writeFileSync(configPath(), JSON.stringify(obj, null, 2)); return true; }
  catch (err) { console.warn('[fold] config write failed', err); return false; }
});

// Single-window tool: closing the window ends the session on every platform.
app.on('window-all-closed', () => {
  app.quit();
});

// Make sure the Syphon server is released even if quitting while live.
app.on('will-quit', () => { syphon.stop(); ndi.stop(); trackpad.stop(); remote.stop(); });
