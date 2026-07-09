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
  const online = () => new Map([...midi.devices(), ...pads.devices(), ...tp.devices()].map((d) => [d.key, d.name]));

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
      if (d) writeParam(t, (state[t.key] ?? 0) + d);
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

  // rate-mode integration: alive only while something is deflected. Full
  // deflection sweeps sens × range × 2.4 per second (sens 25% ≈ 60%/s).
  function startRateLoop() {
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
      if (live) rateRaf = requestAnimationFrame(tick);
    };
    rateRaf = requestAnimationFrame(tick);
  }

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
      return;
    }
    for (const dev of devKeys) {
      const d = store.devices[dev] || { name: dev };
      const head = document.createElement('div');
      head.className = 'in-devhead';
      head.innerHTML = `<i class="in-dot${on.has(dev) ? ' on' : ''}" title="${on.has(dev) ? 'connected' : 'offline'}"></i>
        <input class="in-name" value="${(d.friendly || d.name || dev).replace(/"/g, '&quot;')}" title="device name — click to rename">
        <span class="in-devstate">${on.has(dev) ? 'connected' : 'offline'}</span>`;
      head.querySelector('.in-name').addEventListener('change', (e) => {
        (store.devices[dev] ??= { name: dev }).friendly = e.target.value.trim();
        save();
      });
      wrap.appendChild(head);
      store.maps.forEach((m, i) => { if (m.dev === dev) wrap.appendChild(mapRow(m, i)); });
    }
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
    const isDelta = m.kind === 'gesture' || m.sig.startsWith('tp:');
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
    byId('settingsBtn')?.addEventListener('click', async () => {
      // adapters start on first open (MIDI permission prompts once; opt-ins
      // persist so a saved rig re-arms at boot with no sheet visit)
      if (!midi.active()) { store.midi = await midi.init(); save(); }
      if (!pads.active()) { pads.init(); store.pad = true; save(); }
      if (tp.supported() && !tp.active()) tp.init();
      refreshDevices();
      renderMaps();
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
