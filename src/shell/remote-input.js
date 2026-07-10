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
import { drawSourceOverlay } from './overlay.js';

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
  // The phone can't hover, so it needs the PERSISTENT touch affordances the
  // iPad build shows (droste's arms handle, scale arrows, rotate arcs). Rather
  // than porting the affordance drawing, the desktop renders the REAL overlay
  // for the phone: borrow the overlay drawer against an offscreen canvas with
  // touch styling forced on (env.forceTouchAffordances — the same swap trick
  // as the source-preview export; synchronous, so live draws can't collide)
  // and ship it as a PNG. Pixel-exact affordances for every form, free.
  let ovParent = null, ovCanvas = null;
  function overlayFrame(sa) {
    const view = env.sourceOverlay?.view;
    if (!view?.sourceOverlayCanvas || !env.engine?.getSourceImage?.()) return null;
    const W2 = 480, H2 = Math.round(480 / (sa || 1));
    if (!ovParent) {
      ovParent = document.createElement('div');
      ovParent.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none';
      ovCanvas = document.createElement('canvas');
      ovParent.appendChild(ovCanvas);
      document.body.appendChild(ovParent);
    }
    ovParent.style.width = W2 + 'px';
    ovParent.style.height = H2 + 'px';
    const saved = {
      canvas: view.sourceOverlayCanvas, hover: view.hoverMode,
      force: view.forceTouchAffordances, stroke: view.overlayStrokeScale,
      fingers: view.remoteFingers,
    };
    view.sourceOverlayCanvas = ovCanvas;
    view.hoverMode = null;
    view.forceTouchAffordances = true;
    view.overlayStrokeScale = 1;
    view.remoteFingers = null;        // the fingers are literally on the phone — don't bake them in
    try { drawSourceOverlay(view); }
    finally {
      view.sourceOverlayCanvas = saved.canvas; view.hoverMode = saved.hover;
      view.forceTouchAffordances = saved.force; view.overlayStrokeScale = saved.stroke;
      view.remoteFingers = saved.fingers;
    }
    try { return ovCanvas.toDataURL('image/png'); } catch { return null; }
  }

  let pushTimer = 0, lastPushSig = '', wasGhostsLive = false;
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
    // the onion-skin trail animates INDEPENDENTLY of state — while ghosts are
    // live, re-render every tick so the phone's trail fades/follows like the
    // desktop's (a sig-gated PNG froze it at full strength — Daniel's note)
    const ghostsLive = !!env.sourceOverlay?.view?.performGhosts?.length;
    if (sig === lastPushSig && !ghostsLive && !wasGhostsLive) return;
    wasGhostsLive = ghostsLive;   // one extra render AFTER they clear wipes the trail
    lastPushSig = sig;
    msg.ov = geo ? overlayFrame(geo.sa) : null;
    host.remote.push(msg);
  }
  function setStreaming(on) {
    if (on && !pushTimer) { lastPushSig = ''; pushTimer = setInterval(pushState, 100); }
    else if (!on && pushTimer) { clearInterval(pushTimer); pushTimer = 0; }
  }

  // ---- finger echo into the DESKTOP panels ------------------------------------
  // REGISTRATION IS BORROWED, NEVER RE-DERIVED: the overlay publishes the image
  // rect it ACTUALLY drew on `sourceOverlayCanvas._geom` (wrap-local), and the
  // interaction code reads the same numbers — so echo, touch replay, and the
  // real overlay agree by construction (re-deriving from aspect/fit assumptions
  // is what put Daniel's fingers under the wrong panel). Slice + canvas fingers
  // live in ONE store with per-zone ownership: a slice repaint can't clear
  // canvas fingers and vice versa (the interleaved-clear flicker).
  let fingerFadeT = 0;
  const fingers = { slice: [], canvas: [], canvasAr: 1 };
  function sliceImageRect() {
    const c = env.sourceOverlay?.view?.sourceOverlayCanvas;
    const g = c?._geom;
    const wrap = c?.parentElement;
    if (!g || !wrap || !g.imgW) return null;
    const wr = wrap.getBoundingClientRect();
    if (!wr.width) return null;
    return { x: wr.left + g.imgX, y: wr.top + g.imgY, w: g.imgW, h: g.imgH };
  }

  let canvasFadeT = 0;
  function updateFingers(zone, pts, ar) {
    fingers[zone] = pts || [];
    if (zone === 'canvas' && ar) fingers.canvasAr = ar;
    repaintFingers();
    // stale-frame guard: a dropped stream clears the zone's fingers
    clearTimeout(canvasFadeT);
    if (fingers.canvas.length) {
      canvasFadeT = setTimeout(() => { fingers.canvas = []; repaintFingers(); }, 700);
    }
  }
  // canvas-zone dots live on a small overlay GLUED to the preview canvas (a
  // sibling in its parent, synced to its offset box) — parent-relative
  // coordinates, so the window-fixed drift class can't reach it either. The
  // dots appear over the OUTPUT panel and nowhere else.
  let cvOverlay = null;
  function repaintFingers() {
    const pc = env.previewCanvas;
    if (!pc || !pc.parentElement) return;
    if (!cvOverlay || cvOverlay.parentElement !== pc.parentElement) {
      cvOverlay?.remove();
      cvOverlay = document.createElement('canvas');
      cvOverlay.style.cssText = 'position:absolute;pointer-events:none;z-index:5';
      if (getComputedStyle(pc.parentElement).position === 'static') pc.parentElement.style.position = 'relative';
      pc.parentElement.appendChild(cvOverlay);
    }
    const w = pc.clientWidth, h = pc.clientHeight;
    if (!w || !h) return;
    cvOverlay.style.left = pc.offsetLeft + 'px';
    cvOverlay.style.top = pc.offsetTop + 'px';
    cvOverlay.style.width = w + 'px';
    cvOverlay.style.height = h + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cvOverlay.width !== Math.round(w * dpr)) { cvOverlay.width = Math.round(w * dpr); cvOverlay.height = Math.round(h * dpr); }
    const ctx = cvOverlay.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!fingers.canvas.length) return;
    // aspect-true: the phone's canvas-zone shape, centered in the preview
    const az = fingers.canvasAr || 1;
    let rw = w, rh = rw / az;
    if (rh > h) { rh = h; rw = rh * az; }
    const rx = (w - rw) / 2, ry = (h - rh) / 2;
    const r = Math.max(5, rw * 0.022);
    for (const [u, v] of fingers.canvas) {
      ctx.beginPath(); ctx.arc(rx + u * rw, ry + v * rh, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
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
    const r = sliceImageRect();
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
    // the finger echo is drawn INSIDE the overlay's own draw pass (same ctx,
    // same geometry — it cannot disagree with the outline)
    if (view) {
      view.remoteFingers = (all || []).map(([, u, v]) => [u, v]);
      env.sourceOverlay?.scheduleDraw?.();
      clearTimeout(fingerFadeT);
      if (view.remoteFingers.length) {
        fingerFadeT = setTimeout(() => { view.remoteFingers = null; env.sourceOverlay?.scheduleDraw?.(); }, 700);
      }
    }
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
        if (msg.t === 'f') { updateFingers('canvas', (msg.p || []).map(([, u, v]) => [u, v]), msg.az); return; }
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
        if (!clientCount) {
          fingers.canvas = []; repaintFingers();
          const view = env.sourceOverlay?.view;
          if (view?.remoteFingers) { view.remoteFingers = null; env.sourceOverlay?.scheduleDraw?.(); }
        }
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
