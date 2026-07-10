// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/input-bus.js
//
// THE CONTROL BUS (Arc 6): one signal pool + one mapping layer between every
// physical input and the app. Adapters (midi-input, gamepad-input; trackpad,
// mobile-gesture, and audio later) turn hardware events into normalized
// SIGNALS — a stable string id + a 0..1 (or ±1) value — and the bus routes
// them through user-assigned MAPPINGS onto state fields or transport actions.
// Nothing is hard-coded to any device: LEARN captures whatever you wiggle.
//
// The admin lives in the settings sheet's INPUTS tab: mappings grouped by
// DEVICE (green/gray status dot per device; a friendly rename on both devices
// and individual controls), per-row target / mode (abs·rel·rate) / sensitivity
// / invert / pad-LED color, drag-to-reorder, and a rig save/load (JSON
// download; localStorage carries the rig across sessions regardless). One
// green dot per ONLINE device also shows in the app bar beside the gear.
//
// The bus writes env.state exactly like a hand on a slider — the follower,
// staging, autoplay's per-field ownership, and every broadcast compose
// downstream for free. A future audio adapter is one more signal source into
// the same mappings; additive audio-over-hand layering is a planned 'pulse'
// mode (decaying offsets on top of the base), not a v1 mode.

import { createMidiInput } from './midi-input.js';
import { createGamepadInput } from './gamepad-input.js';
import { createTrackpadInput } from './trackpad-input.js';
import { createRemoteInput } from './remote-input.js';
import qrcode from 'qrcode-generator';   // QR pairing (Daniel-approved dependency, MIT, zero-dep)

const STORE_KEY = 'fold-inputs-v1';

// Mappable targets: continuous params (full slider range; wrap = angular) and
// transport ACTIONS. `dir` names the low → high direction for the invert read.
const PARAM_TARGETS = [
  { key: 'sliceRotation', label: 'slice rotation', min: 0, max: 360, wrap: true, dir: '0° → 360° counterclockwise' },
  { key: 'sliceScale', label: 'slice scale', min: 0.05, max: 3, dir: 'small → large' },
  { key: 'sliceCx', label: 'slice position x', min: 0, max: 1, dir: 'left → right' },
  { key: 'sliceCy', label: 'slice position y', min: 0, max: 1, dir: 'top → bottom' },
  { key: 'canvasZoom', label: 'composition zoom', min: 0.15, max: 4, dir: 'zoomed out → zoomed in' },
  { key: 'canvasRotation', label: 'canvas rotation', min: 0, max: 360, wrap: true, dir: '0° → 360°' },
  { key: 'squareAspect', label: 'square aspect', min: 0.25, max: 4, dir: 'tall → wide' },
  { key: 'drosteZoom', label: 'droste thickness', min: 1.1, max: 16, dir: 'thin → thick' },
  { key: 'drosteSpiral', label: 'droste spiral', min: -3, max: 3, dir: 'wind left → wind right' },
  { key: 'drosteOffsetX', label: 'droste offset x', min: -1, max: 1, dir: 'left → right' },
  { key: 'drosteOffsetY', label: 'droste offset y', min: -1, max: 1, dir: 'up → down' },
];
const ACTION_TARGETS = [
  { key: 'action:stage', label: '⏻ stage (hold)' },
  { key: 'action:take', label: '⏻ take' },
  { key: 'action:cut', label: '⏻ cut' },
  { key: 'action:auto', label: '⏻ autoplay' },
  { key: 'action:play', label: '⏻ play / pause' },
];
const SENS_OPTS = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5];
// APC40 MK2 pad-LED palette (velocity = color index) — a curated set; full
// 128-color painting comes with the tuned APC40 profile.
const LED_COLORS = [
  { v: 0, label: 'off', css: '#333' },
  { v: 3, label: 'white', css: '#eee' },
  { v: 5, label: 'red', css: '#e33' },
  { v: 9, label: 'orange', css: '#e83' },
  { v: 13, label: 'yellow', css: '#dd3' },
  { v: 21, label: 'green', css: '#3c3' },
  { v: 37, label: 'cyan', css: '#3cc' },
  { v: 45, label: 'blue', css: '#36e' },
  { v: 53, label: 'purple', css: '#93e' },
];
// signal-kind chips: what the hardware control physically is (from the
// adapter's read; a MIDI cc can't distinguish knob from fader — 'cc' is honest)
const KIND_CHIP = { cc: 'cc', pad: 'pad', stick: 'stick', btn: 'btn', gesture: 'tp', touch: 'tap' };

export function createInputBus(env) {
  const { state } = env;
  const byId = (id) => document.getElementById(id);

  // ---- persistence -----------------------------------------------------------
  // v2: devices registry (friendly names, offline display) + per-map sens/label.
  let store = { v: 2, devices: {}, maps: [], midi: false, pad: false };
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.v === 2) store = s;
    else if (s && s.v === 1) {
      // v1 → v2: derive device keys, seed sensitivity. v1 GAMEPAD signals keyed
      // on gp.index (unstable across reconnects) — dropped; re-learn takes seconds
      // and the new ids survive replugging. MIDI ids were already name-stable.
      store.maps = (s.maps || []).filter((m) => !/^pad:\d+\./.test(m.sig)).map((m) => ({
        sens: m.mode === 'rate' ? 0.25 : 0.05, ...m,
        dev: (/^midi:([a-z0-9-]+)\./.exec(m.sig) || [])[1] || 'unknown',
      }));
      store.midi = !!s.midi; store.pad = !!s.pad;
    }
  } catch { /* fresh */ }
  const save = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* private mode */ }
    // native shell: mirror the rig into the userData config file (survives
    // storage clears + travels with the app; localStorage stays the web path)
    env.host?.config?.available && env.host.config.write({ inputs: store });
  };

  // ---- adapters ----------------------------------------------------------------
  const midi = createMidiInput(onSignal, refreshDevices);
  const pads = createGamepadInput(onSignal, refreshDevices);
  const tp = createTrackpadInput(onSignal, refreshDevices, env.host);   // Electron shell only
  const rem = createRemoteInput(onSignal, refreshDevices, env.host, env);   // Electron shell only
  const online = () => new Map([...midi.devices(), ...pads.devices(), ...tp.devices(), ...rem.devices()].map((d) => [d.key, d.name]));

  // ---- signal routing ------------------------------------------------------------
  let learnCb = null;
  let lastSyncT = 0;
  const rate = new Map();        // sig→target → deflection, for rate integration
  let rateRaf = 0, rateLastT = 0;

  function rememberDevice(meta) {
    if (!meta?.device) return;
    const d = store.devices[meta.device];
    if (!d) { store.devices[meta.device] = { name: meta.deviceName || meta.device }; save(); }
    else if (meta.deviceName && d.name !== meta.deviceName) { d.name = meta.deviceName; save(); }
  }

  function onSignal(sig, value, meta) {
    if (learnCb) {
      if (meta.momentary && value === 0) return;   // learn on press, not release
      const cb = learnCb; learnCb = null;
      rememberDevice(meta);
      cb(sig, meta);
      return;
    }
    let hit = false;
    for (const m of store.maps) {
      if (m.sig !== sig) continue;
      hit = true;
      applyMapping(m, value, meta);
    }
    if (hit) paintActivity(sig);
    flashDevice(meta.device || (sig.split(':')[1] || '').split('.')[0]);
    // UNMAPPED gesture signals work CONTEXTUALLY by default (Daniel's natural
    // expectation): over the source panel they drive the slice, over the
    // output/live panel the canvas. Mapping a gesture signal takes over.
    if (!hit && (sig.startsWith('tp:') || sig.startsWith('mob:'))) contextualGesture(sig, value);
  }

  // last pointer position — the hover context for unmapped trackpad gestures
  const mouse = { x: -1, y: -1 };
  document.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
  function contextualGesture(sig, value) {
    let overSrc = false, overOut = false;
    if (sig.startsWith('mob:')) {
      overSrc = sig.includes('.slice.');       // the phone's zones ARE the context
      overOut = sig.includes('.canvas.');
    } else {
      const el = mouse.x >= 0 ? document.elementFromPoint(mouse.x, mouse.y) : null;
      overSrc = !!el?.closest('#srcPanel');
      overOut = !!el?.closest('#outPanel, #livePanel');
    }
    if (!overSrc && !overOut) return;
    const kind = sig.slice(sig.lastIndexOf('.') + 1);   // rotate | pinch | dragx | dragy
    const key = overSrc
      ? { rotate: 'sliceRotation', pinch: 'sliceScale', dragx: 'sliceCx', dragy: 'sliceCy' }[kind]
      : { rotate: 'canvasRotation', pinch: 'canvasZoom' }[kind];
    const t = key && targetOf(key);
    if (!t) return;
    writeParam(t, (state[t.key] ?? 0) + value * (t.max - t.min) * 0.25);
  }

  function flashDevice(dev) {
    if (!dev || byId('settingsSheet')?.hidden !== false) return;
    const dot = document.querySelector(`.in-devhead[data-dev="${CSS.escape(dev)}"] .in-dot`);
    if (dot) { dot.classList.add('hot'); setTimeout(() => dot.classList.remove('hot'), 160); }
  }

  const targetOf = (key) => PARAM_TARGETS.find((t) => t.key === key);

  function applyMapping(m, value, meta) {
    if (m.target.startsWith('action:')) {
      if (value > 0.5) fireAction(m.target.slice(7));
      return;
    }
    const t = targetOf(m.target);
    if (!t) return;
    const span = t.max - t.min;
    const sens = m.sens ?? 0.05;
    if (m.mode === 'rate') {
      let d = value;
      if (m.invert) d = -d;
      rate.set(m.sig + '→' + m.target, { key: t.key, d, span, sens });
      startRateLoop();
      return;
    }
    if (m.mode === 'rel') {
      // one event = one nudge of sensitivity × range (buttons send 1; encoders
      // send signed fractions) — sens is the whole step-size story
      let d = (meta.momentary ? Math.sign(value) : value) * span * sens;
      if (m.invert) d = -d;
      if (!d) return;
      // a BUTTON nudge eases like a gentle joystick (Daniel: an abrupt jump
      // reads wrong for scale steps) — the step becomes a spring GOAL; the
      // motion loop glides there with velocity continuity, so repeated presses
      // chain smoothly. Continuous rel sources (encoders, gestures) already
      // arrive as smooth event streams and write straight through.
      if (meta.momentary) {
        let g = glide.get(t.key);
        if (!g) { g = { cur: state[t.key] ?? 0, vel: 0, goal: state[t.key] ?? 0 }; glide.set(t.key, g); }
        g.goal += d;
        if (!t.wrap) g.goal = Math.max(t.min, Math.min(t.max, g.goal));
        startMotionLoop();
      } else {
        writeParam(t, (state[t.key] ?? 0) + d);
      }
      return;
    }
    // absolute: position IS the value across the target's full range
    let v01 = meta.bipolar ? (value + 1) / 2 : value;
    if (m.invert) v01 = 1 - v01;
    writeParam(t, t.min + v01 * span);
  }

  function writeParam(t, v) {
    if (t.wrap) v = ((v % 360) + 360) % 360;
    else v = Math.max(t.min, Math.min(t.max, v));
    state[t.key] = v;
    env.scheduleRender?.();
    env.sourceOverlay?.scheduleDraw?.();
    const now = performance.now();
    if (now - lastSyncT > 250) { lastSyncT = now; env.syncControls?.(); }
  }

  // the MOTION LOOP: rate deflections (full deflection sweeps sens × range ×
  // 2.4/s) and button-nudge glides (critically damped spring, ~0.18s response —
  // the gentle-joystick ease) integrate here; alive only while something moves.
  const glide = new Map();       // stateKey → { cur, vel, goal }
  function startMotionLoop() {
    if (rateRaf) return;
    rateLastT = performance.now();
    const tick = (t) => {
      rateRaf = 0;
      const dt = Math.min(t - rateLastT, 100) / 1000;
      rateLastT = t;
      let live = false;
      for (const [k, r] of rate) {
        if (!r.d) { rate.delete(k); continue; }
        live = true;
        writeParam(targetOf(r.key), (state[r.key] ?? 0) + r.d * r.span * r.sens * 2.4 * dt);
      }
      const omega = 2 / 0.18;
      const decay = Math.exp(-omega * dt);
      for (const [k, g] of glide) {
        const t2 = targetOf(k);
        const y = g.cur - g.goal;
        if (Math.abs(y) < 1e-4 && Math.abs(g.vel) < 1e-3) { glide.delete(k); continue; }
        live = true;
        const tmp = (g.vel + omega * y) * dt;
        g.cur = g.goal + (y + tmp) * decay;
        g.vel = (g.vel - omega * tmp) * decay;
        writeParam(t2, g.cur);
      }
      if (live) rateRaf = requestAnimationFrame(tick);
    };
    rateRaf = requestAnimationFrame(tick);
  }
  const startRateLoop = startMotionLoop;   // rate entries share the loop

  // transport actions press the same buttons the keyboard does, mode-aware
  function fireAction(a) {
    const perform = !!env.performRT?.active;
    const map = {
      stage: perform ? 'pfHold' : 'mfStage',
      take: perform ? 'pfTake' : 'stgTake',
      cut: perform ? 'pfCut' : 'stgCut',
      auto: 'pfAuto',
      play: perform ? 'pfPlay' : 'mfPlay',
    };
    const btn = byId(map[a]);
    if (btn && !btn.disabled && !btn.hidden) btn.click();
  }

  // ---- LED paint (MIDI note signals) -------------------------------------------
  function paintLeds() {
    for (const m of store.maps) {
      if (m.led == null) continue;
      const p = midi.parseNoteSig(m.sig);
      if (p) midi.sendNote(p.device, p.ch, p.note, m.led);
    }
  }
  function paintActivity(sig) {
    if (byId('settingsSheet')?.hidden !== false) return;
    const row = document.querySelector(`[data-sig="${CSS.escape(sig)}"]`);
    if (row) { row.classList.add('in-live'); setTimeout(() => row.classList.remove('in-live'), 150); }
  }

  // ---- app-bar presence: one green dot per online device ------------------------
  function renderLights() {
    const el = byId('inputLights');
    if (!el) return;
    const on = online();
    el.innerHTML = [...on.values()].map((n) => `<i title="${n} — connected"></i>`).join('');
    el.hidden = !on.size;
  }

  // ---- the inputs tab -------------------------------------------------------------
  function refreshDevices() {
    // remember every device we see, so it lists (offline) after disconnect
    for (const [key, name] of online()) {
      if (!store.devices[key]) { store.devices[key] = { name }; save(); }
    }
    renderLights();
    if (byId('settingsSheet')?.hidden === false) renderMaps();
    paintLeds();
  }

  let dragIdx = -1;   // store.maps index being dragged
  const clearDropLine = () => document.querySelectorAll('.in-drop-before, .in-drop-after')
    .forEach((el) => el.classList.remove('in-drop-before', 'in-drop-after'));
  function renderMaps() {
    const wrap = byId('inMaps');
    if (!wrap) return;
    wrap.innerHTML = '';
    const on = online();
    const devKeys = [...new Set([...Object.keys(store.devices), ...store.maps.map((m) => m.dev)])].filter(Boolean);
    if (!devKeys.length) {
      wrap.innerHTML = '<div class="in-dev none">no devices yet — connect MIDI (Chromium/Electron) or press a button on a game controller, then “+ map”</div>';
      renderPairing(wrap);
      return;
    }
    for (const dev of devKeys) {
      const d = store.devices[dev] || { name: dev };
      const head = document.createElement('div');
      head.className = 'in-devhead';
      const nMaps = store.maps.filter((m) => m.dev === dev).length;
      const closed = !!d.closed;
      head.dataset.dev = dev;
      head.innerHTML = `<button class="in-chev" title="${closed ? 'expand' : 'collapse'}">${closed ? '▸' : '▾'}</button>
        <i class="in-dot${on.has(dev) ? ' on' : ''}" title="${on.has(dev) ? 'connected' : 'offline'}"></i>
        <input class="in-name" value="${(d.friendly || d.name || dev).replace(/"/g, '&quot;')}" title="device name — click to rename">
        <span class="in-devcount">${nMaps ? `${nMaps} mapping${nMaps === 1 ? '' : 's'}` : ''}</span>
        <span class="in-devstate">${on.has(dev) ? 'connected' : 'offline'}</span>
        <button class="vid-x in-devdel" title="remove this device and its mappings">✕</button>`;
      head.querySelector('.in-chev').addEventListener('click', () => {
        (store.devices[dev] ??= { name: dev }).closed = !closed;
        save(); renderMaps();
      });
      head.querySelector('.in-name').addEventListener('change', (e) => {
        (store.devices[dev] ??= { name: dev }).friendly = e.target.value.trim();
        save();
      });
      head.querySelector('.in-devdel').addEventListener('click', () => {
        if (nMaps && !window.confirm(`Remove ${d.friendly || d.name || dev} and its ${nMaps} mapping${nMaps === 1 ? '' : 's'}?`)) return;
        for (const m of store.maps) {   // unpaint any LEDs it owned
          if (m.dev === dev && m.led != null) { const pn = midi.parseNoteSig(m.sig); if (pn) midi.sendNote(pn.device, pn.ch, pn.note, 0); }
        }
        store.maps = store.maps.filter((m) => m.dev !== dev);
        delete store.devices[dev];
        save(); renderMaps(); renderLights();
      });
      wrap.appendChild(head);
      if (!closed) store.maps.forEach((m, i) => { if (m.dev === dev) wrap.appendChild(mapRow(m, i)); });
    }
    renderPairing(wrap);
  }

  // "+ add this iPhone/iPad" — the mobile gesture surface pairs from HERE (it
  // is a device beside the APC and the DualSense, not a mode). The shell hosts
  // the page; the URL shown is the whole pairing step.
  function renderPairing(wrap) {
    if (!rem.supported()) return;
    const el = document.createElement('div');
    el.className = 'in-pair';
    if (!rem.active()) {
      el.innerHTML = '<button class="toggle" id="inAddMobile">＋ add an iPhone / iPad (gesture input)</button>';
      el.querySelector('#inAddMobile').addEventListener('click', async () => {
        store.remote = true; save();
        await rem.init();
        renderMaps();
      });
    } else {
      const n = rem.clients();
      el.innerHTML = `<div class="in-pair-row"><canvas class="in-qr"></canvas><div>
        <div class="in-pair-url">scan, or open on the phone:<br><b>${rem.url() || '…'}</b></div>
        <div class="in-pair-state">${n ? `${n} connected — move a finger on the phone, then “+ map”` : 'waiting for the phone… (same wifi)'}</div>
      </div></div>`;
      drawQR(el.querySelector('.in-qr'), rem.url());
    }
    wrap.appendChild(el);
  }
  function drawQR(canvas, text) {
    if (!canvas || !text) return;
    try {
      const qr = qrcode(0, 'M');   // auto version, medium EC
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount(), cell = 4, quiet = 3;
      const size = (n + quiet * 2) * cell;
      canvas.width = size; canvas.height = size;
      canvas.style.width = canvas.style.height = Math.min(148, size) + 'px';
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#000';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
      }
    } catch { canvas.remove(); }   // over-long URL etc. — the text stays
  }

  function mapRow(m, i) {
    const row = document.createElement('div');
    row.className = 'in-map';
    row.dataset.sig = m.sig;
    const isNote = !!midi.parseNoteSig(m.sig);
    const momentary = /\.(n|b)\d/.test(m.sig);
    const isAction = m.target.startsWith('action:');
    const opts = [
      '<optgroup label="parameters">',
      ...PARAM_TARGETS.map((t) => `<option value="${t.key}"${m.target === t.key ? ' selected' : ''}>${t.label}</option>`),
      '</optgroup><optgroup label="transport">',
      ...ACTION_TARGETS.map((t) => `<option value="${t.key}"${m.target === t.key ? ' selected' : ''}>${t.label}</option>`),
      '</optgroup>',
    ].join('');
    // abs is position-is-value — meaningless for momentary controls, so they
    // omit it; gesture signals are pure deltas, so they're rel by definition
    const isDelta = m.kind === 'gesture' || m.kind === 'touch' || m.sig.startsWith('tp:') || m.sig.startsWith('mob:');
    const modes = (isDelta ? ['rel'] : momentary ? ['rel', 'rate'] : ['abs', 'rel', 'rate'])
      .map((md) => `<option value="${md}"${m.mode === md ? ' selected' : ''}>${md}</option>`).join('');
    const sens = SENS_OPTS.map((s) => `<option value="${s}"${(m.sens ?? 0.05) === s ? ' selected' : ''}>${Math.round(s * 100)}%</option>`).join('');
    row.innerHTML = `
      <span class="in-grip" draggable="true" title="drag to reorder">≡</span>
      <span class="in-kind">${KIND_CHIP[m.kind] || (isNote ? 'pad' : m.sig.split('.')[1]?.[0] === 'a' ? 'stick' : m.sig.includes('.cc') ? 'cc' : 'btn')}</span>
      <input class="in-name in-label" value="${(m.label || m.sig).replace(/"/g, '&quot;')}" title="${m.sig} — click to rename">
      <select class="in-target" title="${isAction ? '' : dirTitle(m.target)}">${opts}</select>
      <select class="in-mode" ${isAction ? 'disabled' : ''} title="abs: position is the value · rel: nudge per event · rate: deflection is speed">${modes}</select>
      <select class="in-sens" ${isAction ? 'disabled' : ''} title="sensitivity — step size for rel, speed for rate">${sens}</select>
      <button class="toggle in-inv${m.invert ? ' active' : ''}" title="invert${isAction ? '' : ' — ' + dirTitle(m.target)}">inv</button>
      ${isNote ? '<button class="in-led" title="pad LED color — tap to cycle"></button>' : '<span></span>'}
      <button class="vid-x in-del" title="remove mapping">✕</button>`;
    const ledBtn = row.querySelector('.in-led');
    const paintSwatch = () => { if (ledBtn) ledBtn.style.background = (LED_COLORS.find((c) => c.v === (m.led ?? 0)) || LED_COLORS[0]).css; };
    paintSwatch();
    row.querySelector('.in-label').addEventListener('change', (e) => { m.label = e.target.value.trim() || m.sig; save(); });
    row.querySelector('.in-target').addEventListener('change', (e) => { m.target = e.target.value; save(); renderMaps(); });
    row.querySelector('.in-mode').addEventListener('change', (e) => { m.mode = e.target.value; save(); });
    row.querySelector('.in-sens').addEventListener('change', (e) => { m.sens = parseFloat(e.target.value); save(); });
    row.querySelector('.in-inv').addEventListener('click', (e) => { m.invert = !m.invert; e.target.classList.toggle('active', m.invert); save(); });
    ledBtn?.addEventListener('click', () => {
      const c = LED_COLORS.findIndex((x) => x.v === (m.led ?? 0));
      m.led = LED_COLORS[(c + 1) % LED_COLORS.length].v;
      paintSwatch(); save(); paintLeds();
    });
    row.querySelector('.in-del').addEventListener('click', () => {
      if (m.led != null) { const p = midi.parseNoteSig(m.sig); if (p) midi.sendNote(p.device, p.ch, p.note, 0); }
      store.maps.splice(store.maps.indexOf(m), 1); save(); renderMaps();
    });
    // drag-to-reorder. The affordance is an INSERTION LINE: neighbors part a
    // little and an accent line marks where the row will land (above or below
    // the hovered row by cursor half) — not an outline on the hovered row.
    const grip = row.querySelector('.in-grip');
    grip.addEventListener('dragstart', (e) => {
      dragIdx = store.maps.indexOf(m);
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('in-dragging');
    });
    grip.addEventListener('dragend', () => {
      row.classList.remove('in-dragging');
      clearDropLine();
      dragIdx = -1;
    });
    row.addEventListener('dragover', (e) => {
      if (dragIdx < 0) return;
      e.preventDefault();
      const before = e.offsetY < row.offsetHeight / 2;
      if (!row.classList.contains(before ? 'in-drop-before' : 'in-drop-after')) {
        clearDropLine();
        row.classList.add(before ? 'in-drop-before' : 'in-drop-after');
      }
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const before = row.classList.contains('in-drop-before');
      clearDropLine();
      let to = store.maps.indexOf(m) + (before ? 0 : 1);
      if (dragIdx < 0 || dragIdx === to || dragIdx === to - 1) { dragIdx = -1; return; }
      const [moved] = store.maps.splice(dragIdx, 1);
      if (dragIdx < to) to--;
      store.maps.splice(to, 0, moved);
      dragIdx = -1; save(); renderMaps();
    });
    return row;
  }
  function dirTitle(key) {
    const t = targetOf(key);
    return t ? `${t.label}: low → high runs ${t.dir}` : '';
  }

  function setLearn(on) {
    const btn = byId('inLearn');
    if (on) {
      learnCb = (sig, meta) => {
        btn?.classList.remove('active');
        if (store.maps.some((m) => m.sig === sig)) { renderMaps(); return; }   // already mapped — its row flashes to locate it
        store.maps.push({
          sig, dev: meta.device || 'unknown', kind: meta.kind,
          label: meta.label || sig,
          target: meta.momentary ? 'action:take' : 'sliceRotation',
          mode: meta.relative ? 'rel' : meta.momentary ? 'rel' : meta.bipolar ? 'rate' : 'abs',
          sens: meta.relative || meta.bipolar ? 0.25 : 0.05,
          invert: false,
          ...(midi.parseNoteSig(sig) ? { led: 21 } : {}),
        });
        save(); renderMaps(); paintLeds();
      };
      btn?.classList.add('active');
    } else {
      learnCb = null;
      btn?.classList.remove('active');
    }
  }

  // ---- rig save / load (JSON) ------------------------------------------------------
  function saveRig() {
    const blob = new Blob([JSON.stringify({ format: 'fold-rig', v: 2, devices: store.devices, maps: store.maps }, null, 2)], { type: 'application/json' });
    env.downloadBlob?.(blob, 'fold-rig.json');
  }
  function loadRig(text) {
    let o;
    try { o = JSON.parse(text); } catch { return alert('not valid JSON'); }
    if (o?.format !== 'fold-rig' || !Array.isArray(o.maps)) return alert('not a Fold rig file');
    store.devices = o.devices || {};
    store.maps = o.maps;
    save(); renderMaps(); paintLeds();
  }

  // ---- wiring --------------------------------------------------------------------
  function wire() {
    byId('settingsBtn')?.addEventListener('click', () => {
      // render FIRST — the sheet must never sit behind an adapter's async init
      // (requestMIDIAccess wedged indefinitely in the un-handled Electron shell
      // and took the whole inputs tab with it: no rows, no learn, no gamepad
      // polling). Adapters start in the background and refresh when ready,
      // with a timeout guard so a pathological hang can't wedge anything.
      refreshDevices();
      renderMaps();
      if (!pads.active()) { pads.init(); store.pad = true; save(); }
      if (tp.supported() && !tp.active()) tp.init();
      if (!midi.active()) {
        Promise.race([midi.init(), new Promise((r) => setTimeout(() => r(false), 4000))])
          .then((ok) => { if (ok) { store.midi = true; save(); refreshDevices(); renderMaps(); } });
      }
    });
    byId('settingsClose')?.addEventListener('click', () => setLearn(false));
    byId('inLearn')?.addEventListener('click', () => setLearn(!learnCb));
    byId('inSaveRig')?.addEventListener('click', saveRig);
    byId('inLoadRig')?.addEventListener('click', () => byId('inRigFile')?.click());
    byId('inRigFile')?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0]; e.target.value = '';
      if (f) loadRig(await f.text());
    });
    // a saved rig re-arms silently at boot (the permission grant is remembered);
    // the native trackpad needs no permission, so it simply arms when the shell
    // provides it. In the native shell the userData config file is authoritative
    // over localStorage (it survives storage clears) — adopt it, then arm.
    const boot = () => {
      if (store.midi) midi.init().then(refreshDevices);
      if (store.pad) { pads.init(); renderLights(); }
      if (tp.supported()) { tp.init(); renderLights(); }
      if (store.remote && rem.supported()) rem.init();
    };
    if (env.host?.config?.available) {
      env.host.config.read().then((cfg) => {
        if (cfg?.inputs?.v === 2) store = cfg.inputs;
        boot();
      }).catch(boot);
    } else {
      boot();
    }
  }
  wire();
}
