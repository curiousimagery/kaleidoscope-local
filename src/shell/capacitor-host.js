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
import { buildFrameMessage, frameWireBytes } from 'conduit/frame-wire';

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

    // DEVICE VITALS — thermal + memory headroom off the fold-device-vitals plugin.
    //
    // ⚠️ THE WHOLE DESIGN OF THIS BLOCK IS THE ASYNC/SYNC MISMATCH. Capacitor plugin
    // calls are Promises; conduit/vitals.js reads `native()` synchronously inside its
    // sampler and immediately dereferences the result. Hand it a Promise and every
    // field is undefined, the report says `nativeReadings: false`, and that is exactly
    // what a MISSING plugin looks like — a silent failure wearing the clothes of the
    // problem it was built to solve. So: refresh asynchronously, read from cache.
    //
    // No timer. `read()` kicks a refresh when the cache is older than REFRESH_MS and
    // returns immediately, so polling exists only while something is actually asking —
    // and thermal transitions arrive as pushes regardless, which is the reading whose
    // onset matters. The first read after boot returns null and the second is warm.
    vitals: (() => {
      const REFRESH_MS = 4000;    // under vitals.js's 10s cadence, so a sample is never a cycle behind
      const STALE_MS = 30000;     // past this the cache is not a reading, it is a memory
      const RETRY_MS = 5000;      // after a failed read, back off rather than retry on every call
      const CALL_MS = 3000;       // a bridge call that never settles must not wedge the poller
      let last = null;            // { ...snapshot, at }
      let inFlight = false;
      let failedAt = 0;
      // ⚠️ B664 — THE SEAM PUBLISHES WHY IT HAS NOTHING. B663's first device run came back with
      // `nativeReadings: true` and native values on exactly THREE samples out of 56 — the three
      // following a thermal push. The pushes worked; `read()` never landed once in nine minutes,
      // and the report could not say whether it was throwing, hanging, or resolving empty, because
      // a failed refresh left `last` null and said nothing. That is the project's own rule broken
      // in the instrument that cites it: anything that can decline to act must publish why.
      const seam = { attempts: 0, resolved: 0, empty: 0, errors: 0, timeouts: 0, pushes: 0, pingOk: undefined,
                     lastError: null, lastOkAt: null, lastPushAt: null, loaded: false };
      let plugin = null;
      let listeners = [];
      const emit = (kind, reading) => { for (const fn of listeners) { try { fn(kind, reading); } catch { /* a bad listener is not our problem */ } } };

      async function load() {
        if (plugin) return plugin;
        const { registerPlugin } = await import('@capacitor/core');
        plugin = registerPlugin('FoldDeviceVitals');
        // Pushes update the cache directly, which is why a device that goes `serious`
        // between two reads is recorded at the moment it happened rather than up to
        // four seconds later.
        try {
          plugin.addListener('thermalChanged', (r) => { last = r; seam.pushes++; seam.lastPushAt = Date.now(); emit('thermal', r); });
          plugin.addListener('memoryWarning', (r) => { last = r; seam.pushes++; seam.lastPushAt = Date.now(); emit('memory-warning', r); });
          // B666 — the periodic push. This is now the PRIMARY channel; `read()` is kept wired and
          // instrumented so the pull's failure stays visible rather than being papered over.
          plugin.addListener('vitals', (r) => { last = r; seam.pushes++; seam.lastPushAt = Date.now(); });
        } catch (e) { seam.lastError = `addListener: ${e?.message || e}`; }
        seam.loaded = true;
        // One trivial round trip, once, purely to separate "every bridge call to this plugin
        // hangs" from "something about `read`". Its answer is the next report's, not this run's.
        try { plugin.ping().then(() => { seam.pingOk = true; }).catch((e) => { seam.pingOk = `rejected: ${e?.message || e}`; }); }
        catch (e) { seam.pingOk = `threw: ${e?.message || e}`; }
        setTimeout(() => { if (seam.pingOk === undefined) seam.pingOk = 'never settled'; }, 5000);
        return plugin;
      }

      async function refresh() {
        if (inFlight) return;
        if (failedAt && Date.now() - failedAt < RETRY_MS) return;
        inFlight = true;
        seam.attempts++;
        try {
          const p = load().then((pl) => pl.readVitals());
          // The race is the point: a bridge call that never settles would otherwise leave
          // `inFlight` true forever and silently disable polling for the rest of the run —
          // one of the three candidate explanations for B663's device result, and the only
          // one that is a bug in THIS file regardless of which turns out to be true.
          const r = await Promise.race([
            p,
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), CALL_MS)),
          ]);
          if (r && r.at) { last = r; seam.resolved++; seam.lastOkAt = Date.now(); failedAt = 0; }
          else { seam.empty++; seam.lastError = `resolved without .at: ${JSON.stringify(r)?.slice(0, 120)}`; failedAt = Date.now(); }
        } catch (e) {
          if (String(e?.message) === 'timeout') seam.timeouts++; else seam.errors++;
          seam.lastError = `read: ${e?.message || e}`;
          failedAt = Date.now();
        } finally { inFlight = false; }
      }

      return {
        available: true,
        read() {
          const age = last?.at ? Date.now() - last.at : Infinity;
          if (age > REFRESH_MS) refresh();          // fire and forget; this call still returns now
          if (!last) return null;
          // ⚠️ DECLINE RATHER THAN LIE. A wedged refresh must not read as a calm device.
          if (age > STALE_MS) return null;
          return { ...last, ageMs: Math.round(age) };
        },
        // B675 — the native screen hold. `read()` hangs on this plugin (see the seam counters) but
        // `ping` proved distinctly-named methods are fine, so this uses the same short round trip.
        async setIdleTimerDisabled(on) {
          try {
            const r = await (await load()).setIdleTimerDisabled({ disabled: !!on });
            return !!r?.disabled;
          } catch { return false; }
        },
        onEvent(fn) {
          listeners.push(fn);
          refresh();                                 // a subscriber implies someone is watching
          return () => { listeners = listeners.filter((f) => f !== fn); };
        },
        // Read by the perf panel's export. Names the seam's own health so a run with no native
        // numbers says WHICH failure it was instead of looking like a missing plugin.
        diagnostics() {
          return { ...seam, ageMs: last?.at ? Date.now() - last.at : null,
                   why: seam.resolved ? null
                      : seam.timeouts ? 'read() never settles — bridge call hangs'
                      : seam.errors ? 'read() rejects — see lastError'
                      : seam.empty ? 'read() resolves without a payload'
                      : seam.attempts ? 'refresh in flight, no result yet'
                      : 'refresh never attempted' };
        },
      };
    })(),

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

    // NDI network output — the conduit-ndi-capacitor plugin owns the Vizrt sender; frames
    // stream to it over a localhost frame socket (the native-camera transport
    // REVERSED: the webview produces, native consumes). publish() is the hot
    // path: one header+pixels copy per frame, and bufferedAmount is the
    // backpressure gate — a stalled socket drops frames instead of queueing
    // (Arena only ever wants the freshest frame; a backlog is just latency).
    ndi: (() => {
      let plugin = null;         // lazily registered (keeps @capacitor/core lazy-loadable)
      let ws = null, wsReady = false, gen = 0;
      // Wire format + packing live in conduit/frame-wire.js (the FNDI protocol is package
      // infrastructure now). UYVY 4:2:2 is now the DEFAULT wire — it halves the bytes, and
      // WebKit's WebSocket send is the measured throughput wall (FHD RGBA ~20fps; UYVY ~2×).
      // The blue cast that kept UYVY opt-in was a channel-order bug in the readback (iPad's
      // readPixels returns B,G,R,A), now caught + swizzled at the capture layer
      // (conduit/capture.js), so UYVY packs from correct RGBA. `?ndiwire=rgba` forces the old
      // full-RGBA wire for A/B; the wire logs itself at sender start.
      const uyvyWire = new URLSearchParams(window.location.search).get('ndiwire') !== 'rgba';
      return {
        ...webHost.ndi,
        available: true,
        start(name) {
          const myGen = ++gen;
          wsReady = false;
          import('@capacitor/core').then(({ registerPlugin }) => {
            if (myGen !== gen) return;
            if (!plugin) plugin = registerPlugin('FoldNdi');
            // clockVideo: the diagnostic A/B toggle (settings → diagnostics). Default ON now
            // (Daniel's call — helped iPhone; iPad NDI is WiFi-jitter-bound either way). Off only
            // when explicitly set to '0'. Keep in sync with the diagnostics toggle read in main.js.
            const clockVideo = (() => { try { return localStorage.getItem('foldNdiClockVideo') !== '0'; } catch { return true; } })();
            return plugin.start({ name: name || 'Fold', clockVideo });
          }).then((res) => {
            if (!res || myGen !== gen) return;
            ws = new WebSocket(`ws://127.0.0.1:${res.port}`);
            ws.binaryType = 'arraybuffer';
            ws.onopen = () => { if (myGen === gen) wsReady = true; };
            ws.onclose = () => { if (myGen === gen) wsReady = false; };
            // wire breadcrumb: disambiguates a stale device build from a real
            // color bug (the blue-cast investigation — RGBA should not shift)
            console.info(`[fold] NDI sender up (frame socket :${res.port}) · wire: ${uyvyWire ? 'UYVY' : 'RGBA'}`);
          }).catch((e) => console.warn('[fold] NDI start failed:', e));
        },
        // → false when the frame was DROPPED (socket down / backpressure gate),
        //   true when it went to the wire — the ndi-sink counts delivered fps from this
        publish(pixels, width, height, topDown) {
          if (!wsReady || !ws) return false;
          if (ws.bufferedAmount > frameWireBytes(width, height, { uyvy: uyvyWire }) * 2) return false;   // ~2 frames on the wire max
          const buf = buildFrameMessage(pixels, width, height, topDown, { uyvy: uyvyWire });
          try { ws.send(buf); } catch { return false; /* socket died mid-send; onclose flips wsReady */ }
          return true;
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
