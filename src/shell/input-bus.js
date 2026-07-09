// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/input-bus.js
//
// THE CONTROL BUS (Arc 6): one signal pool + one mapping layer between every
// physical input and the app. Adapters (midi-input, gamepad-input; trackpad
// and audio later) turn hardware events into normalized SIGNALS — a stable
// string id + a 0..1 (or ±1) value — and the bus routes them through
// user-assigned MAPPINGS onto state fields or transport actions. Nothing is
// hard-coded to any device: LEARN captures whatever control you wiggle, and
// the mapping row decides what it drives, how (absolute / relative / rate /
// trigger), over what range, inverted or not, and (for MIDI pads) which LED
// color marks it on the hardware.
//
// The bus writes env.state exactly like a hand on a slider — so the follower,
// staging, autoplay's per-field ownership (a bus write reads as "manual" and
// autoplay yields), and every broadcast compose downstream for free. A future
// audio adapter is just another signal source into the same mappings; additive
// audio-over-hand layering is a planned 'pulse' mode (offset with decay on top
// of the base value), not a v1 mode.
//
// Persistence: mappings + adapter opt-ins in localStorage (fold-inputs-v1) so
// a rig survives reload. Signal ids key on device NAME (not port id), so they
// survive reconnects and machine moves.

import { createMidiInput } from './midi-input.js';
import { createGamepadInput } from './gamepad-input.js';

const STORE_KEY = 'fold-inputs-v1';

// Mappable targets: continuous params (label + full range; wrap = angular) and
// transport ACTIONS (mode-aware dispatch below). Ranges mirror the sliders /
// follow spans; a mapping can narrow to a sub-range via lo/hi later if needed.
const PARAM_TARGETS = [
  { key: 'sliceRotation', label: 'slice rotation', min: 0, max: 360, wrap: true },
  { key: 'sliceScale', label: 'slice scale', min: 0.05, max: 3 },
  { key: 'sliceCx', label: 'slice position x', min: 0, max: 1 },
  { key: 'sliceCy', label: 'slice position y', min: 0, max: 1 },
  { key: 'canvasZoom', label: 'composition zoom', min: 0.15, max: 4 },
  { key: 'canvasRotation', label: 'canvas rotation', min: 0, max: 360, wrap: true },
  { key: 'squareAspect', label: 'square aspect', min: 0.25, max: 4 },
  { key: 'drosteZoom', label: 'droste thickness', min: 1.1, max: 16 },
  { key: 'drosteSpiral', label: 'droste spiral', min: -3, max: 3 },
  { key: 'drosteOffsetX', label: 'droste offset x', min: -1, max: 1 },
  { key: 'drosteOffsetY', label: 'droste offset y', min: -1, max: 1 },
];
const ACTION_TARGETS = [
  { key: 'action:stage', label: '⏻ stage (hold)' },
  { key: 'action:take', label: '⏻ take' },
  { key: 'action:cut', label: '⏻ cut' },
  { key: 'action:auto', label: '⏻ autoplay' },
  { key: 'action:play', label: '⏻ play / pause' },
];
// APC40 MK2 pad-LED palette (velocity = color index) — a small curated set;
// full 128-color painting can come with the tuned APC40 profile.
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

export function createInputBus(env) {
  const { state } = env;
  const byId = (id) => document.getElementById(id);

  // ---- persistence ----------------------------------------------------------
  let store = { v: 1, maps: [], midi: false, pad: false };
  try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && s.v === 1) store = s; } catch { /* fresh */ }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* private mode */ } };

  // ---- adapters --------------------------------------------------------------
  const midi = createMidiInput(onSignal, refreshDevices);
  const pads = createGamepadInput(onSignal, refreshDevices);

  // ---- signal routing ---------------------------------------------------------
  let learnCb = null;            // armed learn: the next signal is captured, not applied
  let lastSyncT = 0;             // throttle the control-panel resync (autoplay's pattern)
  const rate = new Map();        // signal → deflection, for rate-mode integration
  let rateRaf = 0, rateLastT = 0;

  function onSignal(sig, value, meta) {
    if (learnCb) {
      // buttons/pads learn on PRESS only; a release must not re-capture
      if (meta.momentary && value === 0) return;
      const cb = learnCb; learnCb = null;
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

  function targetOf(key) { return PARAM_TARGETS.find((t) => t.key === key); }

  function applyMapping(m, value, meta) {
    if (m.target.startsWith('action:')) {
      if (value > 0.5) fireAction(m.target.slice(7));    // press edge (adapters emit edges)
      return;
    }
    const t = targetOf(m.target);
    if (!t) return;
    const span = t.max - t.min;
    if (m.mode === 'rate') {
      // deflection drives velocity (game-stick natural mode) — integrated below
      let d = value;                                     // −1..1
      if (m.invert) d = -d;
      rate.set(m.sig + '→' + m.target, { key: t.key, d, span, wrap: t.wrap });
      startRateLoop();
      return;
    }
    if (m.mode === 'rel') {
      // relative encoder: adapters hand a signed step in `value` (±n/64)
      let d = value * span * 0.5;
      if (m.invert) d = -d;
      writeParam(t, (state[t.key] ?? 0) + d);
      return;
    }
    // absolute: 0..1 (bipolar axes fold to 0..1) across the full target range
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

  // rate-mode integration: its own light rAF, alive only while any stick is
  // deflected past the deadzone (adapters already deadzone; 0 clears the entry)
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
        const tgt = targetOf(r.key);
        writeParam(tgt, (state[r.key] ?? 0) + r.d * r.span * 0.6 * dt);   // full deflection ≈ 60% of range per second
      }
      if (live) rateRaf = requestAnimationFrame(tick);
    };
    rateRaf = requestAnimationFrame(tick);
  }

  // transport actions dispatch to whichever mode owns them right now — the
  // same buttons the keyboard shortcuts press (disabled buttons no-op)
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

  // ---- LED paint (MIDI note signals only) -------------------------------------
  function paintLeds() {
    for (const m of store.maps) {
      if (m.led == null) continue;
      const p = midi.parseNoteSig(m.sig);
      if (p) midi.sendNote(p.device, p.ch, p.note, m.led);
    }
  }
  function paintActivity(sig) {
    // the sheet's rows flash on hardware activity — the "which knob is this" read
    if (byId('inputSheet')?.hidden !== false) return;   // sheet closed — skip the query
    const row = document.querySelector(`[data-sig="${CSS.escape(sig)}"]`);
    if (row) { row.classList.add('in-live'); setTimeout(() => row.classList.remove('in-live'), 150); }
  }

  // ---- the admin sheet ---------------------------------------------------------
  function refreshDevices() {
    const list = byId('inDevices');
    if (!list) return;
    const devs = [...midi.devices(), ...pads.devices()];
    list.innerHTML = devs.length
      ? devs.map((d) => `<div class="in-dev">● ${d}</div>`).join('')
      : '<div class="in-dev none">no devices detected — connect MIDI (Chromium/Electron) or press a button on a game controller</div>';
    paintLeds();   // a (re)connect repaints the mapped pads
  }

  function renderMaps() {
    const wrap = byId('inMaps');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!store.maps.length) {
      wrap.innerHTML = '<div class="in-dev none">no mappings yet — press “+ map”, then move the hardware control you want to assign</div>';
      return;
    }
    store.maps.forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'in-map';
      row.dataset.sig = m.sig;
      const isNote = !!midi.parseNoteSig(m.sig);
      const opts = [
        '<optgroup label="parameters">',
        ...PARAM_TARGETS.map((t) => `<option value="${t.key}"${m.target === t.key ? ' selected' : ''}>${t.label}</option>`),
        '</optgroup><optgroup label="transport">',
        ...ACTION_TARGETS.map((t) => `<option value="${t.key}"${m.target === t.key ? ' selected' : ''}>${t.label}</option>`),
        '</optgroup>',
      ].join('');
      const modes = ['abs', 'rel', 'rate'].map((md) => `<option value="${md}"${m.mode === md ? ' selected' : ''}>${md}</option>`).join('');
      row.innerHTML = `
        <span class="in-sig" title="${m.sig}">${m.label || m.sig}</span>
        <select class="in-target">${opts}</select>
        <select class="in-mode" ${m.target.startsWith('action:') ? 'disabled' : ''}>${modes}</select>
        <button class="toggle in-inv${m.invert ? ' active' : ''}" title="invert">inv</button>
        ${isNote ? `<button class="in-led" title="pad LED color"></button>` : '<span></span>'}
        <button class="vid-x in-del" title="remove mapping">✕</button>`;
      const ledBtn = row.querySelector('.in-led');
      const paintSwatch = () => { if (ledBtn) ledBtn.style.background = (LED_COLORS.find((c) => c.v === (m.led ?? 0)) || LED_COLORS[0]).css; };
      paintSwatch();
      row.querySelector('.in-target').addEventListener('change', (e) => { m.target = e.target.value; save(); renderMaps(); });
      row.querySelector('.in-mode').addEventListener('change', (e) => { m.mode = e.target.value; save(); });
      row.querySelector('.in-inv').addEventListener('click', (e) => { m.invert = !m.invert; e.target.classList.toggle('active', m.invert); save(); });
      ledBtn?.addEventListener('click', () => {
        const i2 = LED_COLORS.findIndex((c) => c.v === (m.led ?? 0));
        m.led = LED_COLORS[(i2 + 1) % LED_COLORS.length].v;
        paintSwatch(); save(); paintLeds();
      });
      row.querySelector('.in-del').addEventListener('click', () => {
        if (m.led != null) { const p = midi.parseNoteSig(m.sig); if (p) midi.sendNote(p.device, p.ch, p.note, 0); }
        store.maps.splice(i, 1); save(); renderMaps();
      });
      wrap.appendChild(row);
    });
  }

  function setLearn(on) {
    const btn = byId('inLearn');
    if (on) {
      learnCb = (sig, meta) => {
        btn?.classList.remove('active');
        if (store.maps.some((m) => m.sig === sig)) { renderMaps(); return; }   // already mapped — the row flash locates it
        store.maps.push({
          sig, label: meta.label || sig,
          target: meta.momentary ? 'action:take' : 'sliceRotation',
          mode: meta.bipolar ? 'rate' : 'abs',
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

  async function openSheet() {
    byId('inputSheet').hidden = false;
    // adapters start on first open (MIDI permission prompts once; both opt-ins
    // persist so a saved rig re-arms on every future load without the sheet)
    if (!midi.active()) { store.midi = await midi.init(); save(); }
    if (!pads.active()) { pads.init(); store.pad = true; save(); }
    refreshDevices();
    renderMaps();
  }
  function closeSheet() { setLearn(false); byId('inputSheet').hidden = true; }

  function wire() {
    byId('inputBtn')?.addEventListener('click', openSheet);
    byId('inClose')?.addEventListener('click', closeSheet);
    byId('inputSheet')?.addEventListener('click', (e) => { if (e.target === byId('inputSheet')) closeSheet(); });
    byId('inLearn')?.addEventListener('click', () => setLearn(!learnCb));
    // a saved rig re-arms silently at boot (the permission grant is remembered)
    if (store.midi) midi.init().then(() => { refreshDevices(); paintLeds(); });
    if (store.pad) pads.init();
  }
  wire();
}
