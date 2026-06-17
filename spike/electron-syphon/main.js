'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const stub = require('./syphon-stub');
const syphon = require('./syphon-server');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Fold — Syphon Spike',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the Vite dev server — run `npm run dev` in the main repo first.
  win.loadURL('http://localhost:5173');

  // Detached devtools so they don't resize the app window.
  win.webContents.openDevTools({ mode: 'detach' });

  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  syphon.init();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();   // spike: always quit on window close (no macOS menu-bar persistence)
});

app.on('will-quit', () => {
  syphon.destroy();
});

// Diagnostic: arrives every 2s from the preload setInterval.
// If you see these in the terminal but not frame lines, canvas sizing is the issue.
ipcMain.on('syphon:ping', (_event, payload) => {
  console.log('[main] ping received — IPC is working', payload.ts);
});

// Receive a captured WebGL frame from the renderer preload.
// payload: { width, height, captureMs, sendTs, buffer: ArrayBuffer }
ipcMain.on('syphon:frame', (event, payload) => {
  const recvTs = Date.now();

  // Push to real Syphon first (latency-sensitive), then log.
  syphon.publish(payload);
  const result = stub.publish(payload, recvTs);

  if (win && !win.isDestroyed() && result) {
    win.setTitle(
      `Fold — Syphon Spike  |  ${result.fps} fps @ ${payload.width}×${payload.height}` +
      `  |  capture ${result.captureMs}ms`
    );
  }
});
