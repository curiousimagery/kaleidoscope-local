// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/remote-input.js
//
// Mobile gesture adapter for the control bus (Electron shell only — the main
// process hosts the LAN page + WebSocket; see electron/remote-input.js and
// remote-page.html). The phone surface is TWO ZONES (slice / canvas):
//
//   SIGNALS IN — delta gestures per zone, rel-only, trackpad-scaled:
//     mob:mobile.<zone>.dragx/.dragy   drag, value = travel/minDim × 3
//     mob:mobile.<zone>.pinch          pinch, value = scale delta × 2
//     mob:mobile.<zone>.rotate         rotate, value = degrees / 90
//   (unmapped, the bus applies them contextually: slice zone → the slice,
//    canvas zone → the canvas — the phone works with zero setup)
//
//   STATE OUT — this adapter streams the desktop's ACTUAL slice geometry to
//   the phone (~10Hz, on change): the active form's real outline polygons in
//   source-UV space (rectangle for square, wedge for radial, annulus for
//   droste — position/rotation/scale all true) plus canvas rotation/zoom so
//   the phone's crosshair-and-circles affordance MOVES with the values.
//
//   FINGERS — the phone streams touch positions; they paint as low-opacity
//   circles over the DESKTOP's corresponding panel (slice-zone touches over
//   the source panel in true UV registration, canvas-zone touches over the
//   output preview) — eyes stay on the desktop, per Daniel's spec.

import { getActiveForm } from '../engine/forms/index.js';
import { sliceVecToSourceUV } from '../engine/geometry.js';

export function createRemoteInput(onSignal, onDevices, host, env) {
  let running = false;
  let clientCount = 0;
  let name = 'iPhone / iPad';
  let url = null;

  const meta = (label) => ({ device: 'mobile', deviceName: `${name} (gesture)`, kind: 'touch', label, momentary: false, relative: true });

  // ---- state stream: the real slice outline + canvas pose --------------------
  function slicePolysUV() {
    const st = env.state;
    const engine = env.engine;
    if (!engine?.getSourceImage?.()) return null;
    const sa = engine.getSourceAspect();
    const form = getActiveForm(st);
    const paths = form.ghostPaths ? form.ghostPaths(st)
      : form.buildPolygon ? [form.buildPolygon(st)] : [];
    const polys = paths.map((pts) => pts.map((p) => {
      const { dx, dy } = sliceVecToSourceUV(p.vx, p.vy, st, sa);
      return [+(st.sliceCx + dx).toFixed(4), +(st.sliceCy + dy).toFixed(4)];
    }));
    return { polys, sa: +sa.toFixed(4) };
  }
  let pushTimer = 0, lastPushSig = '';
  function pushState() {
    const geo = slicePolysUV();
    const st = env.state;
    const msg = {
      t: 'st',
      rot: +(st.canvasRotation ?? 0).toFixed(2),
      zoom: +(st.canvasZoom ?? 1).toFixed(3),
      ...(geo || {}),
    };
    const sig = JSON.stringify(msg);
    if (sig === lastPushSig) return;
    lastPushSig = sig;
    host.remote.push(msg);
  }
  function setStreaming(on) {
    if (on && !pushTimer) { lastPushSig = ''; pushTimer = setInterval(pushState, 100); }
    else if (!on && pushTimer) { clearInterval(pushTimer); pushTimer = 0; }
  }

  // ---- finger echo into the DESKTOP panels ------------------------------------
  // Phone finger positions arrive zone-tagged: slice-zone fingers in source-UV
  // (registered to the same rect the polygons live in, so "just right of the
  // wedge" lands just right of the wedge), canvas-zone fingers zone-normalized.
  let fingerCanvas = null, fingerFadeT = 0;
  function panelRect(which) {
    if (which === 'slice') {
      const view = env.sourceOverlay?.view;
      const c = view?.sourceOverlayCanvas;
      if (!c) return null;
      const r = c.getBoundingClientRect();
      if (!r.width) return null;
      // the displayed IMAGE rect inside the wrap (overlay.js imageRect math)
      const sa = env.engine?.getSourceAspect?.() || 1;
      const cover = view.fit === 'cover';
      const wrapAspect = r.width / r.height;
      let w, h;
      if ((sa > wrapAspect) !== cover) { w = r.width; h = r.width / sa; }
      else { h = r.height; w = r.height * sa; }
      return { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, w, h };
    }
    const c = env.previewCanvas;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  }
  function paintFingers(pts) {
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
      for (const [zone, nx, ny] of pts) {
        const r = panelRect(zone === 0 ? 'slice' : 'canvas');
        if (!r) continue;
        const x = r.x + nx * r.w, y = r.y + ny * r.h;
        ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2);   // ~finger-pad size (Daniel: 140px read as a giant cursor)
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }
    clearTimeout(fingerFadeT);
    if (pts && pts.length) fingerFadeT = setTimeout(() => paintFingers([]), 600);
  }

  // ---- RAW slice-zone touches → synthetic TouchEvents on the desktop's own
  // source overlay. The phone relays id + UV; we map into the displayed image
  // rect and replay through setupSourceInteraction's real handlers — move,
  // outside-drag rotate, the two-finger rigid-body (rotate+scale+reposition at
  // once), every affordance — with EXACT desktop-touch parity and zero
  // duplicated interaction code. No pointer capture in that path, so synthetic
  // events are safe; identifiers offset so they can never collide with real
  // touches on a touch-screen desktop.
  function dispatchSliceTouch(kind, changed, all) {
    const view = env.sourceOverlay?.view;
    const wrap = view?.sourceOverlayCanvas?.parentElement;
    const r = panelRect('slice');
    if (!wrap || !r || typeof Touch !== 'function') return;
    const toTouch = ([id, u, v]) => new Touch({
      identifier: 9000 + id,
      target: wrap,
      clientX: r.x + u * r.w,
      clientY: r.y + v * r.h,
    });
    let touches, changedT;
    try { touches = (all || []).map(toTouch); changedT = (changed || []).map(toTouch); }
    catch { return; }
    const type = kind === 's' ? 'touchstart' : kind === 'm' ? 'touchmove' : 'touchend';
    try {
      wrap.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches, targetTouches: touches, changedTouches: changedT,
      }));
    } catch { /* TouchEvent constructor unsupported — overlay stays view-only */ }
    // the finger echo rides the same registration (slice fingers = zone 0 UV)
    paintFingers((all || []).map(([, u, v]) => [0, u, v]));
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
        if (msg.t === 'hi') { name = msg.name || name; onDevices?.(); pushState(); return; }
        if (msg.t === 'f') { paintFingers(msg.p); return; }
        if (msg.t === 'tt') { dispatchSliceTouch(msg.k, msg.c, msg.a); return; }
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
        setStreaming(clientCount > 0);
        if (!clientCount) paintFingers([]);
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
