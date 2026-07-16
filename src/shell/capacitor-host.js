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

import { webHost } from 'conduit/host';

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

    // HDMI / external display: the fold-external-display plugin presents the
    // chrome-free output view on a second UIScreen. The seam only flags
    // availability — the sink module (shell/external-display.js, lazy-loaded by
    // each chrome) drives the plugin directly, per the native-camera precedent.
    externalDisplay: {
      ...webHost.externalDisplay,
      available: true,
    },

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

    // NDI network output — the fold-ndi plugin owns the Vizrt sender; frames
    // stream to it over a localhost frame socket (the native-camera transport
    // REVERSED: the webview produces, native consumes). publish() is the hot
    // path: one header+pixels copy per frame, and bufferedAmount is the
    // backpressure gate — a stalled socket drops frames instead of queueing
    // (Arena only ever wants the freshest frame; a backlog is just latency).
    ndi: (() => {
      let plugin = null;         // lazily registered (keeps @capacitor/core lazy-loadable)
      let ws = null, wsReady = false, gen = 0;
      const HEADER = 16;
      return {
        ...webHost.ndi,
        available: true,
        start(name) {
          const myGen = ++gen;
          wsReady = false;
          import('@capacitor/core').then(({ registerPlugin }) => {
            if (myGen !== gen) return;
            if (!plugin) plugin = registerPlugin('FoldNdi');
            return plugin.start({ name: name || 'Fold' });
          }).then((res) => {
            if (!res || myGen !== gen) return;
            ws = new WebSocket(`ws://127.0.0.1:${res.port}`);
            ws.binaryType = 'arraybuffer';
            ws.onopen = () => { if (myGen === gen) wsReady = true; };
            ws.onclose = () => { if (myGen === gen) wsReady = false; };
            console.info('[fold] NDI sender up (frame socket :' + res.port + ')');
          }).catch((e) => console.warn('[fold] NDI start failed:', e));
        },
        publish(pixels, width, height, topDown) {
          if (!wsReady || !ws) return;
          if (ws.bufferedAmount > width * height * 8) return;   // ~2 frames on the wire max
          const buf = new ArrayBuffer(HEADER + pixels.byteLength);
          const dv = new DataView(buf);
          dv.setUint32(0, 0x464E4449, false);   // "FNDI"
          dv.setUint32(4, width, true);
          dv.setUint32(8, height, true);
          dv.setUint32(12, 1, true);   // always top-down on the wire (flip below)
          const out = new Uint8Array(buf, HEADER);
          if (topDown) {
            out.set(pixels);
          } else {
            // Bottom-up frames (the readPixels capture path Tier 1 selects on the
            // iPad) are flipped HERE, folded into the copy this path already pays —
            // never on the native side, where a second full-frame pass sits on the
            // socket's DRAIN and every ms costs delivered fps.
            const stride = width * 4;
            for (let y = 0; y < height; y++) {
              out.set(pixels.subarray((height - 1 - y) * stride, (height - y) * stride), y * stride);
            }
          }
          try { ws.send(buf); } catch { /* socket died mid-send; onclose flips wsReady */ }
        },
        stop() {
          gen++;
          wsReady = false;
          try { ws?.close(); } catch { /* already closed */ }
          ws = null;
          if (plugin) plugin.stop().catch(() => {});   // the source leaves the network
        },
      };
    })(),

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
