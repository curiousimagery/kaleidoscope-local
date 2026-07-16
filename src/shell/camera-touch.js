// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/camera-touch.js
//
// iPad touch controls for the NATIVE live camera in the desktop chrome — a
// faithful port of the mobile chrome's pad (Daniel: "imitate the iPhone
// implementation pretty much identically"):
//   - quick TAP on the source = tap-to-focus (+ re-meter) at that point, with
//     the focus-ring flash
//   - PRESS-HOLD (450ms, still) engages the EV/WB pad: drag Y = EV (up
//     brighter), X = WB (warm right), locked to the dominant axis on the first
//     real move (one at a time, never diagonal)
// Additive + fenced exactly like mobile: capture-phase listeners on the source
// panel, active only for the native live camera and only for TOUCH pointers
// (mouse/trackpad keep their slice-drag semantics untouched); propagation stops
// only once the hold engages, so slice manipulation is unaffected otherwise.

export function createCameraTouchControls(env, { getCamera, isNative }) {
  const panel = document.getElementById('srcPanel');
  if (!panel) return;

  const HOLD_MS = 450, MOVE_TOL = 10, PAD_AXIS_TOL = 8;
  let padActive = false, padTimer = 0, padStartX = 0, padStartY = 0;
  let padEvStart = 0, padWbStart = 0, padEvRange = null, padWbRange = null;
  let padAxis = null;   // 'ev' (vertical) | 'wb' (horizontal) — locked on first real move

  const enabled = () => isNative() && env.live.isLive;
  const point = (e) => { const t = e.touches ? e.touches[0] : e; return { x: t.clientX, y: t.clientY, n: e.touches ? e.touches.length : 1 }; };
  // the DISPLAYED camera element's rect (not the panel's) — the desktop source
  // fits with letterbox, so normalizing against the panel would skew the focus map
  const camRect = () => (env.liveVideo?.getBoundingClientRect?.() || panel.getBoundingClientRect());

  function down(e) {
    if (!enabled()) return;
    const p = point(e);
    clearTimeout(padTimer); padTimer = 0;
    if (p.n > 1) return;                 // two fingers → a pinch, not the pad
    // only WITHIN the displayed camera frame — the panel also hosts the form
    // picker and controls below the preview (Daniel set a focus point reaching
    // for the droste form); touches outside the frame are never ours
    const r = camRect();
    if (p.x < r.left || p.x > r.right || p.y < r.top || p.y > r.bottom) return;
    padStartX = p.x; padStartY = p.y;
    padTimer = setTimeout(engage, HOLD_MS);
  }

  function engage() {
    padTimer = 0;
    if (!enabled()) return;
    const camera = getCamera();
    padActive = true;
    padAxis = null;
    const caps = camera.capabilities?.() || {};
    padEvRange = caps.exposureBias && caps.exposureBias.max > caps.exposureBias.min ? caps.exposureBias : null;
    padWbRange = caps.whiteBalance?.customGainsSupported
      ? { min: caps.whiteBalance.temperatureMin || 2000, max: caps.whiteBalance.temperatureMax || 9000 } : null;
    padEvStart = camera.getExposureBias?.() || 0;
    padWbStart = camera.getWhiteBalanceTemp?.() || 5000;
    showHud(padEvStart, padWbStart, null);
  }

  function move(e) {
    if (padTimer) {                      // still waiting for the hold: a move = slice drag
      const p = point(e);
      if (Math.hypot(p.x - padStartX, p.y - padStartY) > MOVE_TOL) { clearTimeout(padTimer); padTimer = 0; }
      return;
    }
    if (!padActive) return;
    e.preventDefault(); e.stopPropagation();   // ours now — keep it off the slice overlay
    const camera = getCamera();
    const p = point(e);
    const rect = camRect();
    const dy = p.y - padStartY, dx = p.x - padStartX;
    if (!padAxis && Math.hypot(dx, dy) > PAD_AXIS_TOL) padAxis = Math.abs(dy) >= Math.abs(dx) ? 'ev' : 'wb';
    let ev = padEvStart, wb = padWbStart;
    if (padAxis === 'ev' && padEvRange) {
      ev = padEvStart + (-dy / (rect.height * 0.7)) * (padEvRange.max - padEvRange.min);   // up = brighter
      ev = Math.max(padEvRange.min, Math.min(padEvRange.max, ev));
      camera.setExposureBias(ev);
    } else if (padAxis === 'wb' && padWbRange) {
      wb = padWbStart + (dx / (rect.width * 0.7)) * (padWbRange.max - padWbRange.min);      // right = warmer
      wb = Math.max(padWbRange.min, Math.min(padWbRange.max, wb));
      camera.setWhiteBalance({ temperature: wb });
    }
    showHud(ev, wb, padAxis);
  }

  function up(e) {
    const wasTap = !!padTimer && !padActive;   // released before the hold, no drag
    clearTimeout(padTimer); padTimer = 0;
    if (padActive) { padActive = false; hud()?.classList.add('ct-hidden'); return; }
    if (wasTap && enabled() && e?.type !== 'touchcancel') tapFocus(padStartX, padStartY);
  }

  // tap-to-focus: focus (+ re-meter) at that point, flash the ring. Coordinates
  // normalize against the displayed camera element (see camRect).
  function tapFocus(clientX, clientY) {
    const camera = getCamera();
    if (!camera.setFocusPoint) return;
    const rect = camRect();
    const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    camera.setFocusPoint(nx, ny).catch(() => {});
    const pr = panel.getBoundingClientRect();
    showRing(clientX - pr.left, clientY - pr.top);
  }

  function hud() { return document.getElementById('camPadHud'); }
  function showHud(ev, wb, axis) {
    let el = hud();
    if (!el || el.parentElement !== panel) {
      el = document.createElement('div'); el.id = 'camPadHud'; panel.appendChild(el);
    }
    const evTxt = padEvRange ? `EV ${ev > 0 ? '+' : ''}${ev.toFixed(1)}` : '';
    const wbTxt = padWbRange ? `${Math.round(wb)}K` : '';
    // once an axis is locked, show only that value; before lock, show both (engaged cue)
    if (axis === 'ev') el.textContent = evTxt;
    else if (axis === 'wb') el.textContent = wbTxt;
    else el.textContent = [evTxt, wbTxt].filter(Boolean).join('  ·  ');
    el.classList.remove('ct-hidden');
  }

  function showRing(x, y) {
    let ring = document.getElementById('camFocusRing');
    if (!ring || ring.parentElement !== panel) {
      ring = document.createElement('div'); ring.id = 'camFocusRing'; panel.appendChild(ring);
    }
    ring.style.left = `${x}px`; ring.style.top = `${y}px`;
    ring.classList.remove('show'); void ring.offsetWidth; ring.classList.add('show');
  }

  // TOUCH ONLY (the iPad's hands-on layer) — mouse/trackpad keep slice semantics.
  panel.addEventListener('touchstart', down, { capture: true, passive: false });
  panel.addEventListener('touchmove', move, { capture: true, passive: false });
  panel.addEventListener('touchend', up, { capture: true });
  panel.addEventListener('touchcancel', up, { capture: true });
}
