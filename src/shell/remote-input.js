// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/remote-input.js
//
// Mobile gesture adapter for the control bus (Electron shell only — the main
// process hosts the LAN page + WebSocket; see electron/remote-input.js and
// remote-page.html). The phone emits DELTA gestures, so mappings are rel-only,
// with the same feel-tuned scaling as the native trackpad:
//   mob:mobile.dragx / .dragy   one-finger drag, value = travel / minDim × 3
//   mob:mobile.pinch            two-finger pinch, value = scale delta × 2
//   mob:mobile.rotate           two-finger rotate, value = degrees / 90
// The device reads connected while any phone holds the socket; its name comes
// from the page's hello (iPhone / iPad).

export function createRemoteInput(onSignal, onDevices, host) {
  let running = false;
  let clientCount = 0;
  let name = 'iPhone / iPad';
  let url = null;

  const meta = (label) => ({ device: 'mobile', deviceName: `${name} (gesture)`, kind: 'touch', label, momentary: false, relative: true });

  return {
    supported: () => !!host?.remote?.available,
    active: () => running,
    clients: () => clientCount,
    url: () => url,
    async init() {
      if (running || !host?.remote?.available) return false;
      running = true;
      host.remote.onSignal((msg) => {
        if (!msg) return;
        if (msg.t === 'hi') { name = msg.name || name; onDevices?.(); return; }
        if (msg.t === 'd') {
          if (msg.x) onSignal('mob:mobile.dragx', msg.x * 3, meta('drag x'));
          if (msg.y) onSignal('mob:mobile.dragy', msg.y * 3, meta('drag y'));
        } else if (msg.t === 'p') {
          onSignal('mob:mobile.pinch', msg.v * 2, meta('pinch'));
        } else if (msg.t === 'r') {
          onSignal('mob:mobile.rotate', msg.v / 90, meta('two-finger rotate'));
        }
      });
      host.remote.onStatus((st) => {
        clientCount = st?.clients || 0;
        onDevices?.();
      });
      const res = await host.remote.start();
      url = res?.url || null;
      onDevices?.();
      return true;
    },
    devices() {
      return running && clientCount > 0 ? [{ key: 'mobile', name: `${name} (gesture)` }] : [];
    },
  };
}
