// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/camera-settings.js
//
// The desktop/iPad camera-settings popover — the gear beside the camera picker.
// CAPABILITY-DRIVEN by design (the mobile cam-menu discipline): a row appears
// only when the CURRENT camera actually reports the control, so nothing shows
// where the platform can't honor it. Two capability sources:
//   - the NATIVE camera (Capacitor): lens / still resolution / EV / WB — the
//     AVCaptureSession surface getUserMedia can't reach
//   - the WEB camera (desktop browser / Electron): resolution + frame rate from
//     getCapabilities() — the honest macOS set. WebKit on iPad also reports
//     zoom/torch, which appear automatically when present.
// Content rebuilds on every open (fresh values); camera lifecycle ownership
// stays in source-host — `reacquire` re-points the engine after any switch
// that restarts the stream (lens / resolution / frame rate).

export function createCameraSettings(env, { getCamera, isNative, reacquire }) {
  const btn = document.getElementById('camSettingsBtn');
  const pop = document.getElementById('camPopover');
  if (!btn || !pop) return { refresh: () => {} };

  // join the shared panel-popover system (anchoring, close-on-outside-click,
  // Escape all live there) — wirePanelPopovers consumes this queue at init.
  (env.pendingPopovers ||= []).push({ btn, pop, onOpen: rebuild, onClose: stopWbPoll });

  // session-scoped web-camera intent: a getUserMedia re-acquire needs the WHOLE
  // ask each time (an fps change must not silently reset a chosen resolution).
  const chosen = { width: null, height: null, fps: null };

  // the gear shows only while LIVE and there's something to adjust — a webcam
  // that reports nothing adjustable keeps the toolbar clean.
  function refresh() {
    const show = env.live.isLive && (isNative() || buildWebRows(getCamera()).length > 0);
    btn.style.display = show ? '' : 'none';
    if (!show && !pop.hidden) { pop.hidden = true; btn.classList.remove('open'); stopWbPoll(); }
  }

  function rebuild() {
    stopWbPoll();
    pop.innerHTML = '';
    const camera = getCamera();
    const rows = isNative() ? buildNativeRows(camera) : buildWebRows(camera);
    for (const r of rows) pop.appendChild(r);
  }

  // ---- native camera (Capacitor) --------------------------------------------

  function buildNativeRows(camera) {
    const rows = [];
    // camera (facing) — the flip toggle lives at the TOP of this menu (Daniel:
    // the iPhone camera-menu position), replacing the toolbar flip button on
    // the native path. flip() resets EV/WB by construction (per-sensor gains).
    if (camera.flip) {
      rows.push(segRow('camera', [{ id: 'environment', label: 'rear' }, { id: 'user', label: 'front' }],
        camera.isFront?.() ? 'user' : 'environment',
        () => reacquire(() => camera.flip()).then(rebuild)));
    }
    // lens — rear only, and only when the device has more than one. a lens
    // change re-acquires AND resets EV/WB (per-sensor gains don't carry).
    const lenses = camera.getLenses?.() || [];
    if (!camera.isFront?.() && lenses.length > 1) {
      rows.push(segRow('lens', lenses, camera.getLens(), (id) =>
        reacquire(() => camera.setLens(id)).then(rebuild)));
    }
    // still resolution — STILL-CAPTURE context only (in perform the camera is a
    // live source, not a capture rig — Daniel's iPad note); GPU-gated like mobile
    // (the engine samples the still at FULL res, so the ceiling is the real GL
    // max texture size). no re-acquire: it only sizes the next capture.
    const stillContext = !env.performRT?.active && !env.motionRT?.active;
    const maxTex = env.engine?.diagnostics?.maxTextureSize || 4096;
    const stills = stillContext
      ? (camera.getStillResolutions?.() || []).filter((r) => r.width <= maxTex && r.height <= maxTex)
      : [];
    if (stills.length) {
      if (!stills.some((r) => r.id === camera.getStillResolution())) {
        camera.setStillResolution(stills[stills.length - 1].id);   // drop to the largest allowed
      }
      rows.push(segRow('still resolution', stills, camera.getStillResolution(),
        (id) => { camera.setStillResolution(id); rebuild(); }));
    }
    // EV / WB — per what the physical lens reports
    const caps = camera.capabilities?.() || {};
    const ev = caps.exposureBias;
    if (ev && ev.max > ev.min) {
      rows.push(sliderRow('exposure', ev.min, ev.max, 0.1, camera.getExposureBias(),
        (v) => (v > 0 ? '+' : '') + v.toFixed(1), (v) => camera.setExposureBias(v)));
    }
    const wb = caps.whiteBalance;
    if (wb && wb.customGainsSupported) rows.push(wbRow(camera, wb));
    return rows;
  }

  // white balance: ONE always-visible Kelvin slider (the mobile pattern). In auto
  // it tracks the live settled temperature (polled while the popover is open);
  // dragging commits to manual; clicking the value returns to auto.
  let wbPollTimer = null;
  function stopWbPoll() { if (wbPollTimer) { clearInterval(wbPollTimer); wbPollTimer = null; } }
  function wbRow(camera, wb) {
    const label = document.createElement('label');
    label.className = 'slider';
    const row = document.createElement('div'); row.className = 'row';
    const name = document.createElement('span'); name.textContent = 'white balance';
    const val = document.createElement('span'); val.className = 'val';
    val.style.cursor = 'pointer';
    val.title = 'click to return to auto';
    const setVal = (t, auto) => { val.textContent = `${Math.round(t)}K${auto ? ' · auto' : ''}`; };
    setVal(camera.getWhiteBalanceTemp() || 5000, camera.getWhiteBalanceMode() === 'auto');
    val.addEventListener('click', () => {
      if (camera.getWhiteBalanceMode() === 'auto') return;
      camera.setWhiteBalance({ mode: 'auto' });
      rebuild();                                       // back to auto (restarts the poll)
    });
    row.append(name, val);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = wb.temperatureMin || 2500; input.max = wb.temperatureMax || 8000;
    input.step = 50; input.value = camera.getWhiteBalanceTemp() || 5000;
    input.addEventListener('input', () => {
      stopWbPoll();                                    // a drag commits to manual
      camera.setWhiteBalance({ temperature: +input.value });
      setVal(+input.value, false);
    });
    label.append(row, input);
    if (camera.getWhiteBalanceMode() === 'auto') {
      const tick = async () => {
        if (camera.getWhiteBalanceMode() !== 'auto' || pop.hidden) { stopWbPoll(); return; }
        const t = await camera.readWhiteBalanceTemp?.();
        if (t && camera.getWhiteBalanceMode() === 'auto') { input.value = t; setVal(t, true); }
      };
      tick();
      wbPollTimer = setInterval(tick, 600);
    }
    return label;
  }

  // ---- web camera (getUserMedia) ---------------------------------------------

  const WEB_RES = [
    { id: '720', label: '720p', width: 1280, height: 720 },
    { id: '1080', label: '1080p', width: 1920, height: 1080 },
    { id: '1440', label: 'QHD', width: 2560, height: 1440 },
    { id: '2160', label: '4K', width: 3840, height: 2160 },
  ];

  // re-acquire the web stream with the full session intent (resolution AND fps),
  // pinned to the current device so the switch never lands on a different camera.
  function webRestart(camera, patch) {
    Object.assign(chosen, patch);
    const opts = {};
    const id = camera.getDeviceId();
    if (id) opts.deviceId = id; else opts.facingMode = camera.getFacing();
    if (chosen.width) { opts.width = chosen.width; opts.height = chosen.height; }
    if (chosen.fps) opts.fps = chosen.fps;
    return reacquire(() => camera.start(opts)).then(rebuild);
  }

  function buildWebRows(camera) {
    const rows = [];
    let caps = {}, settings = {};
    try { caps = camera.capabilities?.() || {}; settings = camera.controls?.() || {}; } catch { /* no track */ }
    // resolution — only presets the track's reported ceiling can hold; the active
    // segment is whichever preset the NEGOTIATED mode actually landed on (honest:
    // asking for 4K on a 1080p webcam highlights 1080p).
    if (caps.width?.max && caps.height?.max) {
      const list = WEB_RES.filter((r) => r.width <= caps.width.max && r.height <= caps.height.max);
      if (list.length > 1) {
        const cur = list.reduce((best, r) =>
          Math.abs(r.height - (settings.height || 0)) < Math.abs(best.height - (settings.height || 0)) ? r : best, list[0]);
        rows.push(segRow('resolution', list, cur.id, (id) => {
          const r = WEB_RES.find((x) => x.id === id);
          webRestart(camera, { width: r.width, height: r.height });
        }));
      }
    }
    // frame rate — offered only when the track reports 60 is reachable
    if ((caps.frameRate?.max || 0) >= 60) {
      const curFps = Math.round(settings.frameRate || 30) >= 45 ? '60' : '30';
      rows.push(segRow('frame rate', [{ id: '30', label: '30fps' }, { id: '60', label: '60fps' }], curFps,
        (id) => webRestart(camera, { fps: +id })));
    }
    // zoom / torch — live constraint applies (no re-acquire); present on iPad
    // Safari's rear camera, absent on macOS
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
      rows.push(sliderRow('zoom', caps.zoom.min, caps.zoom.max, caps.zoom.step || 0.1,
        settings.zoom ?? caps.zoom.min, (v) => v.toFixed(1) + '×', (v) => camera.applyControls({ zoom: v })));
    }
    if (caps.torch) {
      rows.push(segRow('torch', [{ id: 'off', label: 'off' }, { id: 'on', label: 'on' }],
        settings.torch ? 'on' : 'off',
        (id) => { camera.applyControls({ torch: id === 'on' }); rebuild(); }));
    }
    return rows;
  }

  // ---- row builders (the panel-popover's own control classes) ----------------

  function segRow(title, items, currentId, onPick) {
    const label = document.createElement('label');
    label.className = 'slider';
    label.style.marginBottom = '10px';
    label.innerHTML = `<div class="row"><span>${title}</span></div>`;
    const row = document.createElement('div');
    row.className = 'row-buttons';
    for (const item of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'toggle' + (item.id === currentId ? ' active' : '');
      b.textContent = item.label;
      b.addEventListener('click', () => { if (item.id !== currentId) onPick(item.id); });
      row.appendChild(b);
    }
    label.appendChild(row);
    return label;
  }

  function sliderRow(title, min, max, step, value, fmt, onInput) {
    const label = document.createElement('label');
    label.className = 'slider';
    label.style.marginBottom = '10px';
    const row = document.createElement('div'); row.className = 'row';
    const name = document.createElement('span'); name.textContent = title;
    const val = document.createElement('span'); val.className = 'val'; val.textContent = fmt(value);
    row.append(name, val);
    const input = document.createElement('input');
    input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value;
    input.addEventListener('input', () => { const v = +input.value; val.textContent = fmt(v); onInput(v); });
    label.append(row, input);
    return label;
  }

  return { refresh };
}
