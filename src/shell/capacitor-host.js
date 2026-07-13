// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/capacitor-host.js
//
// The Capacitor implementation of the shell/host.js host-services shape — the iOS
// sibling of Electron's `window.foldHost`. Capacitor's model is "JS calls native
// plugins", so this WRAPS plugins in the exact interface the app already programs
// against (`env.host.*`), so the app never learns it's native — it just finds more
// services `available`. Plugins are DYNAMIC-imported inside the methods, so the
// plain web bundle never loads them (they resolve only in the native runtime).
//
// Starts with the services that ride FIRST-PARTY plugins: native file save/share
// (Filesystem + Share) and the portable config store (Preferences). The custom-
// plugin services — externalDisplay (HDMI), nativeCamera, ndi — inherit the webHost
// no-op here until their Swift plugins land, so the app degrades gracefully and this
// file is where each one gets wired as it ships.

import { webHost } from './host.js';

// Blob → base64 (Filesystem.writeFile wants base64 string data).
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export function createCapacitorHost() {
  return {
    ...webHost,
    name: 'capacitor',

    // Native file round-trip. save() writes the blob into the app cache, then opens
    // the iOS SHARE SHEET (Save to Files / Save to Photos / AirDrop / share apps) —
    // the native equivalent of the browser download. This also SIDESTEPS the parked
    // "output goes black after the save handoff" bug on native: there's no download
    // navigation to background/discard the page and lose the WebGL context. Returns
    // the file URI (the file persists in cache even if the user dismisses the sheet).
    fileSystem: {
      ...webHost.fileSystem,
      available: true,
      async save(blob, suggestedName) {
        const [{ Filesystem, Directory }, { Share }] = await Promise.all([
          import('@capacitor/filesystem'),
          import('@capacitor/share'),
        ]);
        const path = suggestedName || `fold-${Date.now()}`;
        // Write in chunks. A whole-blob base64 (readAsDataURL) builds a string ~1.33×
        // the file, then ships it over the JS→native bridge in one call — fine for a
        // small still, but a video blob (tens–hundreds of MB) silently fails there.
        // 3MB slices are a multiple of 3 bytes, so each slice's base64 has no interior
        // padding and the decoded chunks concatenate cleanly via appendFile.
        const CHUNK = 3 * 1024 * 1024;
        let uri = null;
        for (let offset = 0, first = true; first || offset < blob.size; offset += CHUNK, first = false) {
          const data = await blobToBase64(blob.slice(offset, offset + CHUNK));
          if (first) { uri = (await Filesystem.writeFile({ path, data, directory: Directory.Cache })).uri; }
          else if (data) { await Filesystem.appendFile({ path, data, directory: Directory.Cache }); }
          if (blob.size === 0) break;
        }
        try {
          await Share.share({ title: suggestedName || 'Fold', url: uri });
        } catch { /* user dismissed the sheet — the file still exists in cache */ }
        return uri;
      },
      // The browser <input type=file> works inside WKWebView, so open() stays the
      // webHost no-op (the app keeps using the file input); a native Photos/Files
      // picker can fill this in later if the web picker proves insufficient.
    },

    // Native camera capability gate. The actual AVCaptureSession + controls live in
    // shell/native-camera.js (which the mobile chrome instantiates in place of the
    // getUserMedia camera when this is available); this just signals the seam is live.
    nativeCamera: {
      ...webHost.nativeCamera,
      available: true,
    },

    // Portable user config (the rig + preferences) — @capacitor/preferences is a
    // native key-value store surviving relaunch, the iOS sibling of Electron's
    // userData JSON. Same `fold-config` key shape as the web store, for clean
    // migration between surfaces (BACKLOG: generalized user-config JSON).
    config: {
      ...webHost.config,
      available: true,
      async read() {
        const { Preferences } = await import('@capacitor/preferences');
        const { value } = await Preferences.get({ key: 'fold-config' });
        try { return value ? JSON.parse(value) : null; } catch { return null; }
      },
      async write(obj) {
        const { Preferences } = await import('@capacitor/preferences');
        await Preferences.set({ key: 'fold-config', value: JSON.stringify(obj) });
        return true;
      },
    },
  };
}
