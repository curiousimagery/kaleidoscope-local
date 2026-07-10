// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/remote-input.js
//
// Mobile gesture adapter for the control bus (Electron shell only — the main
// process hosts the LAN page + WebSocket; see electron/remote-input.js and
// remote-page.html). The phone surface is TWO ZONES (slice / canvas — Daniel's
// spec) and emits DELTA gestures, so mappings are rel-only, scaled like the
// native trackpad's:
//   mob:mobile.<zone>.dragx/.dragy   one-finger drag, value = travel/minDim × 3
//   mob:mobile.<zone>.pinch          two-finger pinch, value = scale delta × 2
//   mob:mobile.<zone>.rotate         two-finger rotate, value = degrees / 90
// The phone also streams its FINGER POSITIONS ('f'), painted here as
// low-opacity circles over the DESKTOP app — the whole point is seeing where
// your fingers are while your eyes stay on the desktop output.

export function createRemoteInput(onSignal, onDevices, host) {
  let running = false;
  let clientCount = 0;
  let name = 'iPhone / iPad';
  let url = null;

  const meta = (label) => ({ device: 'mobile', deviceName: `${name} (gesture)`, kind: 'touch', label, momentary: false, relative: true });

  // ---- the desktop finger overlay -------------------------------------------
  // A fixed, non-interactive canvas over the whole window. Phone coordinates
  // arrive normalized with the phone's aspect; they map into a centered,
  // aspect-true rect so the geometry of your hand reads honestly.
  let fingerCanvas = null, fingerFadeT = 0;
  function paintFingers(pts, ar) {
    if (!fingerCanvas) {
      fingerCanvas = document.createElement('canvas');
      fingerCanvas.style.cssText = 'position:fixed;inset:0;z-index:420;pointer-events:none';
      document.body.appendChild(fingerCanvas);
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    if (fingerCanvas.width !== w * dpr) { fingerCanvas.width = w * dpr; fingerCanvas.height = h * dpr; }
    const ctx = fingerCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (pts && pts.length) {
      // centered aspect-fit rect for the phone's surface
      const a = ar || 0.5;
      let rw = w * 0.92, rh = rw / a;
      if (rh > h * 0.92) { rh = h * 0.92; rw = rh * a; }
      const rx = (w - rw) / 2, ry = (h - rh) / 2;
      for (const [nx, ny] of pts) {
        const x = rx + nx * rw, y = ry + ny * rh;
        ctx.beginPath(); ctx.arc(x, y, 36, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.09)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }
    // stale-frame guard: if the stream stops mid-touch (wifi drop), clear
    clearTimeout(fingerFadeT);
    if (pts && pts.length) fingerFadeT = setTimeout(() => paintFingers([], ar), 600);
  }

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
        if (msg.t === 'f') { paintFingers(msg.p, msg.ar); return; }
        const z = msg.z === 'slice' ? 'slice' : 'canvas';
        if (msg.t === 'd') {
          if (msg.x) onSignal(`mob:mobile.${z}.dragx`, msg.x * 3, meta(`${z} drag x`));
          if (msg.y) onSignal(`mob:mobile.${z}.dragy`, msg.y * 3, meta(`${z} drag y`));
        } else if (msg.t === 'p') {
          onSignal(`mob:mobile.${z}.pinch`, msg.v * 2, meta(`${z} pinch`));
        } else if (msg.t === 'r') {
          onSignal(`mob:mobile.${z}.rotate`, msg.v / 90, meta(`${z} rotate`));
        }
      });
      host.remote.onStatus((st) => {
        clientCount = st?.clients || 0;
        if (!clientCount) paintFingers([], 1);   // phone gone — clear the overlay
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
