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
import { applyUnifiedZoom } from '../kit/zoom.js';   // shared unified zoom — the canvas pinch routes here too
import { panDelta } from '../kit/pan.js';            // shared canvas-pan gain — the remote drag pans identically to touch
import { FORMS, getActiveForm, formPanLocked, formCanvasNorm } from '../engine/forms/index.js';   // pannability + the shader's effective zoom; FORMS builds the per-form mapping actions

const STORE_KEY = 'fold-inputs-v1';

// Does the ACTIVE form tile? A lattice period means canvasOffset is periodic (and so unbounded);
// its absence means canvasOffset is a centre shift and must stay bounded. See the pan targets.
const latticePeriodOf = (s) => getActiveForm(s)?.latticePeriod?.(s) || null;

// Mappable targets: continuous params (full slider range; wrap = angular) and
// transport ACTIONS. `dir` names the low → high direction for the invert read.
//
// `write` (B619) — the escape hatch for a param whose assignment is NOT `state[key] = v`.
// Segments is the first: it routes by form, snaps to legal values, and cascades into the spiral
// snap and every motion keyframe. Routing it through the slider's own setter is what stops the
// hardware path and the pointer path from drifting apart.
const SET_SEGMENTS = (_state, v, env) => env.setSegments?.(v);

// ⚠️ B620 — A SNAPPED CONTROL CANNOT BE NUDGED BY A PERCENTAGE OF ITS RANGE. `nudge` is how a
// DISCRETE target steps: one press, one legal value, sensitivity irrelevant.
//
// Daniel's B620 report: *"the control works but it is wonky: i have to tap 2x or 4x to get it to
// change. radial wedge works as expected: droste segments does not."* That is the generic rel-mode
// arithmetic (`span × sens`) meeting a snap, and the two form ranges explain the split exactly:
//   radial — span 46, 5% → 2.3, snaps to the next even number. One press, one step. Looks fine.
//   droste — span 11, 5% → 0.55, and `Math.round(v/2)*2` swallows it. **The first press does
//            nothing at all**; the glide accumulates until the second or fourth crosses a boundary.
// A bigger sens would paper over droste and make radial jump four segments at a time. There is no
// percentage that is right for both, because the quantity is not continuous.
//
// So step to the NEXT LEGAL VALUE, using the form's own snap as the authority rather than
// re-deriving the legal set here (droste's is 1, 2, 4, 6 … 12 — irregular at the bottom, which is
// exactly the kind of thing a duplicated table gets wrong later).
const NUDGE_SEGMENTS = (state, dir, env) => {
  const cur = env.segmentsValue?.() ?? 0;
  const r = env.segmentsRange?.() || { min: 1, max: 48, step: 1 };
  // walk outward until the snap actually lands somewhere new, so an irregular ladder still
  // advances by exactly one rung per press. Bounded by the range, so it always terminates.
  for (let i = 1; i <= Math.ceil((r.max - r.min) / (r.step || 1)) + 1; i++) {
    const probe = cur + dir * i * (r.step || 1);
    if (probe < r.min || probe > r.max) break;
    env.setSegments?.(probe);
    if ((env.segmentsValue?.() ?? cur) !== cur) return;
  }
  env.setSegments?.(cur);   // already at the end of the ladder — restore, don't drift
};
const PARAM_TARGETS = [
  { key: 'sliceRotation', label: 'slice rotation', min: 0, max: 360, wrap: true, dir: '0° → 360° counterclockwise' },
  { key: 'sliceScale', label: 'slice scale', min: 0.05, max: 5, dir: 'small → large' },   // the slice control's OWN max (independent of the zoom gesture's Z_SLICE_COVER overflow cap)
  { key: 'sliceCx', label: 'slice position x', min: 0, max: 1, dir: 'left → right' },
  { key: 'sliceCy', label: 'slice position y', min: 0, max: 1, dir: 'top → bottom' },
  // SEMANTIC "zoom" — one mapping point that RESOLVES to the active form's zoom control, so a
  // single knob works across forms (droste → infinite zoom, else composition zoom) and existing
  // hardware never needs reprogramming on a form switch (Daniel). `resolve(state)` returns the
  // per-form key + range; applyMapping/writeParam use it. (Stage 1 of the registry unification.)
  // ⚠️ B620 — RENAMED FROM THE BARE "zoom", which was genuinely ambiguous next to `slice scale` and
  // cost Daniel a testing round. He mapped "zoom" expecting the slice to resize, saw the overlay
  // move on radial and not on square/hex/triangle/droste, and reasonably read that as a bug.
  //
  // It is not one, and the asymmetry is worth keeping straight: **radial's `buildPolygon` genuinely
  // depends on canvasZoom** (its wedge extent is `1 / (canvasZoom × canvasNorm)`, see radial.js), so
  // the region it samples really does change when you zoom the canvas. The tiling forms' cells do
  // not — a lattice is translation- and scale-symmetric in the way that matters here — so their
  // overlays correctly stay put. **Same input, two honest answers, because the forms differ.**
  // The label now says which control this is, so the expectation is set before the test.
  { key: 'canvasZoom', label: 'canvas zoom  (droste: infinite zoom)', min: 0.05, max: 4, dir: 'zoomed out → zoomed in',
    resolve: (s) => s.form === 'droste'
      ? { key: 'drosteZoomPhase', min: 0, max: 1, wrap: true, wrapPeriod: 1 }
      : { key: 'canvasZoom', min: 0.05, max: 4 } },
  { key: 'canvasRotation', label: 'canvas rotation', min: 0, max: 360, wrap: true, dir: '0° → 360°' },
  // TILING PAN. `abs` maps a fader across ±2 units (~one lattice period); REL/RATE drift it.
  //
  // ⚠️ B611 — THE ±2 USED TO BE A HARD WALL, AND ON A TILEABLE FORM THAT IS WRONG. A lattice form
  // loops forever by construction (the shader wraps the offset mod the period), so an accumulating
  // gesture must be allowed to accumulate. Clamping it produced Daniel's "edge": pan left on
  // rectangle, zoom out, keep going, and you hit a wall you cannot cross — while panning back
  // right still works, because you are pinned at the min. The LOCAL touch path never had this,
  // since it writes state directly and only the uniform wraps; the two surfaces disagreed.
  //
  // So it resolves per form: UNBOUNDED where a lattice makes it periodic, and bounded to ±1 where
  // it does not. On radial/droste this is not a tiling pan at all but a CENTRE shift — and in
  // droste specifically a log-polar centre, where a large value squeezes the field into a thin
  // annulus (the B611 blow-up). ±1 is the range droste itself declares for `drosteOffsetX/Y`.
  { key: 'canvasOffsetX', label: 'pan x', min: -2, max: 2, dir: 'left → right',
    resolve: (s) => (latticePeriodOf(s) ? { unbounded: true } : { min: -1, max: 1 }) },
  { key: 'canvasOffsetY', label: 'pan y', min: -2, max: 2, dir: 'up → down',
    resolve: (s) => (latticePeriodOf(s) ? { unbounded: true } : { min: -1, max: 1 }) },
  { key: 'squareAspect', label: 'square aspect', min: 0.25, max: 4, dir: 'tall → wide' },
  { key: 'drosteZoom', label: 'droste thickness', min: 1.1, max: 16, dir: 'thin → thick' },
  { key: 'drosteSpiral', label: 'droste spiral', min: -3, max: 3, dir: 'wind left → wind right' },
  { key: 'drosteOffsetX', label: 'droste offset x', min: -1, max: 1, dir: 'left → right' },
  { key: 'drosteOffsetY', label: 'droste offset y', min: -1, max: 1, dir: 'up → down' },
  // INFINITE ZOOM phase — cyclic like rotation, but its period is 1 (not 360), so it carries
  // an explicit wrapPeriod. Pinch over the canvas maps here in droste (see the pinch mapping).
  // kept as a target so targetOf() (the pinch reroute) resolves it, but HIDDEN from the mapping
  // dropdown — the semantic "zoom" above is the one mapping point for infinite zoom.
  { key: 'drosteZoomPhase', label: 'infinite zoom', min: 0, max: 1, wrap: true, wrapPeriod: 1, dir: 'zoom loop', hidden: true },
  // SEGMENTS — B619. The most performable discrete control in the app had no hardware route at
  // all. Form-routed like the slider it shadows (radial → segments 2..48, droste → arms 1..12),
  // and it writes through `env.setSegments` rather than the generic state writer because the
  // value snaps and cascades (see setupSegmentsSlider). `write` is the escape hatch for exactly
  // this shape: a param whose assignment is not `state[key] = v`.
  { key: 'segments', label: 'segments', min: 2, max: 48, dir: 'few → many', discrete: true,
    resolve: (s) => (s.form === 'droste'
      ? { key: 'drosteArms', min: 1, max: 12 }
      : { key: 'segments', min: 2, max: 48 }),
    write: SET_SEGMENTS, nudge: NUDGE_SEGMENTS },
  // the droste half of the semantic `segments` above. Present so targetOf() can resolve the
  // RESOLVED key — the rate loop and the glide spring both look their target back up by
  // `t.key`, so a resolve that returns a key with no entry here would write nowhere. Same
  // reason `drosteZoomPhase` exists as a hidden entry beside the semantic `zoom`.
  { key: 'drosteArms', label: 'droste arms', min: 1, max: 12, dir: 'few → many', hidden: true,
    discrete: true, write: SET_SEGMENTS, nudge: NUDGE_SEGMENTS },
];
const ACTION_TARGETS = [
  { key: 'action:stage', label: '⏻ stage (hold)' },
  { key: 'action:take', label: '⏻ take' },
  { key: 'action:cut', label: '⏻ cut' },
  { key: 'action:auto', label: '⏻ autoplay' },
  { key: 'action:play', label: '⏻ play / pause' },
  // FORM SELECTION — B619. Previously unmappable, which for a live rig was the largest single
  // gap on the mapping screen: you could reshape a form from hardware but never change it.
  // Both shapes are offered because both are real rig layouts: an encoder or a pair of buttons
  // steps through, and a pad grid gets one pad per form (the APC40 case).
  { key: 'action:formNext', label: '◈ next form' },
  { key: 'action:formPrev', label: '◈ previous form' },
  // ⚠️ B620 — ALT-TAB FOR FORMS, and the answer to Daniel's "left stick press to get back to radial
  // doesn't feel good". A TOGGLE between two named forms would need a default ("which one do I go to
  // first?"), and picking one makes the button asymmetric. **Last-form has no default to pick.**
  // Whatever you were on before, go back — so if you are working radial ↔ droste it toggles those,
  // and if you wander to hex it toggles hex ↔ wherever you came from, with no reprogramming. One
  // button, no mode to remember, and the pair follows what you are actually doing.
  { key: 'action:formLast', label: '◈ last form (toggle back)' },
  ...FORMS.map((f) => ({ key: 'action:form:' + f.id, label: '◈ form: ' + f.label.toLowerCase() })),
  // DROSTE TOGGLES + OOB — cycles rather than absolute values, because the thing on the other
  // end of a mapping is a momentary pad. Each fires the existing DOM control, so the snap
  // cascade, keyframe commit, undo entry, and button highlight all still happen exactly once.
  { key: 'action:mirror', label: '◈ droste mirror' },
  { key: 'action:wedgeMirror', label: '◈ droste wedge mirror' },
  { key: 'action:oob', label: '◈ out of bounds (cycle)' },
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
    // CANVAS PINCH on a NON-droste form → route through the SHARED unified zoom (kit/zoom.js) so the
    // slice-first-then-canvas trap fix reaches the remote/MIDI/gamepad pinch too — the iPad gesture
    // surface used to write canvasZoom directly and bypass it. Direct-apply (the additive path's
    // glideBy jitter-smoothing isn't wired here yet — tune sensitivity / add glide if it reads jerky).
    if (!overSrc && kind === 'pinch' && state.form !== 'droste') {
      // route through the SHARED unified zoom, GLIDED through the spring so bursty WS pinch events read
      // smoothly (Daniel: jerky). Apply the zoom to the current glide GOALS, then ease state toward them.
      // PINCH_ZOOM_SENS scales the WS scale-delta into a multiplicative factor — TUNE on-device.
      const gS = glide.get('sliceScale'), gZ = glide.get('canvasZoom');
      const goalS = gS?.goal ?? state.sliceScale, goalZ = gZ?.goal ?? state.canvasZoom;
      const shadow = { sliceScale: goalS, canvasZoom: goalZ };
      applyUnifiedZoom(shadow, Math.exp(value * PINCH_ZOOM_SENS));
      glideBy(targetOf('sliceScale'), shadow.sliceScale - goalS, REMOTE_GLIDE_TAU);
      glideBy(targetOf('canvasZoom'), shadow.canvasZoom - goalZ, REMOTE_GLIDE_TAU);
      return;
    }
    // CANVAS two-finger PAN from the phone gesture surface (mob canvas dragx/dragy). The overOut
    // map below only had rotate + pinch, so this DROPPED the pan — "records a tiny pinch but not
    // the pan" (Daniel). Route drag → canvasOffset through the SHARED pan transform (kit/pan.js),
    // on pannable forms only. NOTE: x and y arrive as SEPARATE signals, so each is rotation-
    // compensated independently — exact at 0°, mildly skewed when the canvas is rotated (the local
    // touch path gets both axes in one event and is exact; acceptable for the remote surface).
    if (!overSrc && (kind === 'dragx' || kind === 'dragy') && panDrivableNow()) {
      // B611 — MERGED WITH DIRECT MANIPULATION. The remote sends travel as a fraction of ITS OWN
      // short side, which is exactly the unit `panDelta` takes, so the phone and the app's own
      // canvas now run the identical gain and the same 1/zoom. The old `× 3` (remote-input) and
      // `PAN_GESTURE_SENS × 1.2` (here) were two hand-tuned constants covering for a missing zoom
      // term; both are gone. Any device of any size now honours one contract: drag across the
      // short side of the surface you are touching, content travels the short side of the canvas.
      const [dx, dy] = kind === 'dragx'
        ? panDelta(value, 0, state.canvasRotation, effZoom())
        : panDelta(0, value, state.canvasRotation, effZoom());
      glideBy(targetOf('canvasOffsetX'), dx, REMOTE_GLIDE_TAU);
      glideBy(targetOf('canvasOffsetY'), dy, REMOTE_GLIDE_TAU);
      return;
    }
    const key = overSrc
      ? { rotate: 'sliceRotation', pinch: 'sliceScale', dragx: 'sliceCx', dragy: 'sliceCy' }[kind]
      : { rotate: 'canvasRotation', pinch: (state.form === 'droste' ? 'drosteZoomPhase' : 'canvasZoom') }[kind];
    const t = key && targetOf(key);
    if (!t) return;
    // slice rotation is negated: the overlay's Y-flip means screen-clockwise
    // fingers must DECREASE sliceRotation to turn the wedge with them (the
    // same flip the desktop two-finger handler applies — Daniel felt the
    // inversion immediately). Canvas rotation reads correctly unflipped.
    const v2 = (overSrc && kind === 'rotate') ? -value : value;
    const d = v2 * (t.max - t.min) * 0.25;
    // phone deltas GLIDE (the ~0.18s spring): WS delivery arrives in
    // micro-bursts, and direct writes read as jerks in the staged panel.
    // Local gestures (trackpad) stay direct — no network jitter to hide.
    if (sig.startsWith('mob:')) glideBy(t, d, REMOTE_GLIDE_TAU);
    else writeParam(t, (state[t.key] ?? 0) + d);
  }

  function flashDevice(dev) {
    if (!dev || byId('settingsSheet')?.hidden !== false) return;
    const dot = document.querySelector(`.in-devhead[data-dev="${CSS.escape(dev)}"] .in-dot`);
    if (dot) { dot.classList.add('hot'); setTimeout(() => dot.classList.remove('hot'), 160); }
  }

  // Resolve semantic / per-form targets at the SINGLE lookup point, so every consumer — stored
  // mappings, the contextual gesture path, and the motion loop — sees the same per-form range and
  // bounds. Before B611 only `applyMapping` resolved, so a gesture-driven pan still met the flat
  // ±2 wall even though the active form was periodic. That divergence WAS Daniel's pan "edge".
  const targetOf = (key) => {
    const t = PARAM_TARGETS.find((x) => x.key === key);
    return t && t.resolve ? { ...t, ...t.resolve(state) } : t;
  };
  const effZoom = () => state.canvasZoom * formCanvasNorm(state);   // what the shader actually uses
  // pannable = tileable (has a lattice period) OR radial (pans via canvasOffset, no lattice).
  // Mirrors main.js / mobile chrome's ctx.panDrivable — a candidate for the shared helper when
  // the "one fn per input axis" hardening lands (the same duplication kit/pan.js just resolved).
  const panDrivableNow = () => !formPanLocked(state);

  function applyMapping(m, value, meta) {
    if (!m.target) return;   // learned but not yet assigned — inert, and its row says so
    if (m.target.startsWith('action:')) {
      if (value > 0.5) fireAction(m.target.slice(7));
      return;
    }
    const t0 = targetOf(m.target);
    if (!t0) return;
    // a SEMANTIC target (e.g. "zoom") resolves to the active form's key + range each apply, so
    // one mapping drives the right param per form (Stage 1 of the registry unification).
    const t = t0.resolve ? { ...t0, ...t0.resolve(state) } : t0;
    const span = t.max - t.min;
    const sens = m.sens ?? 0.05;
    // a DISCRETE target stored as `rate` by an older rig falls back to stepping (B620). The mode
    // dropdown no longer offers rate here, but a mapping saved before that still says so, and the
    // rate loop against a snap is a stutter rather than a control.
    if (m.mode === 'rate' && t.nudge) {
      const dir = Math.sign(value) * (m.invert ? -1 : 1);
      if (dir) { t.nudge(state, dir, env); env.scheduleRender?.(); env.syncControls?.(); }
      return;
    }
    if (m.mode === 'rate') {
      let d = value;
      if (m.invert) d = -d;
      rate.set(m.sig + '→' + m.target, { key: t.key, d, span, sens });
      startRateLoop();
      return;
    }
    if (m.mode === 'rel') {
      // DISCRETE targets step one legal value per event and ignore sens entirely (B620). A
      // percentage of the range is meaningless against a snap — see NUDGE_SEGMENTS.
      if (t.nudge) {
        // `Math.sign(value)` and NOT `value || 1`: a momentary button sends 1 on press and 0 on
        // RELEASE, so coercing 0 to a direction would step twice per tap. Same guard the
        // continuous branch below gets from its `if (!d) return`.
        const dir = Math.sign(value) * (m.invert ? -1 : 1);
        if (dir) t.nudge(state, dir, env);
        env.scheduleRender?.();
        env.sourceOverlay?.scheduleDraw?.();
        env.syncControls?.();
        return;
      }
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
      // phone gesture signals glide too — same network-jitter cover as the
      // contextual path (a mapping must not feel worse than the default)
      if (meta.momentary || m.sig.startsWith('mob:')) {
        glideBy(t, d, m.sig.startsWith('mob:') ? REMOTE_GLIDE_TAU : 0.18);
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
    if (t.wrap) { const P = t.wrapPeriod || 360; v = ((v % P) + P) % P; }
    // `unbounded` = periodic in the shader but stored raw (tiling pan). Not wrapped HERE on
    // purpose: state stays continuous so the follower / tween / autoplay never see a seam blip,
    // exactly as the local touch path already does. The uniform does the wrapping.
    else if (!t.unbounded) v = Math.max(t.min, Math.min(t.max, v));
    // a target whose assignment ISN'T `state[key] = v` supplies its own writer (segments snaps
    // and cascades). Everything downstream — render, overlay, control sync — still runs here.
    if (t.write) t.write(state, v, env);
    else state[t.key] = v;
    env.scheduleRender?.();
    env.sourceOverlay?.scheduleDraw?.();
    const now = performance.now();
    if (now - lastSyncT > 250) { lastSyncT = now; env.syncControls?.(); }
  }

  // nudge a param through the critically damped spring instead of writing it
  // directly — button steps and remote gesture deltas share this (velocity
  // continuity across chained nudges). tau is PER SOURCE: button nudges keep
  // the snappy 0.18s; phone gestures get a longer response (Daniel's call —
  // a touch of capture latency beats WS-burst choppiness in the staged panel).
  const REMOTE_GLIDE_TAU = 0.35;
  const PINCH_ZOOM_SENS = 0.5;    // WS scale-delta → unified-zoom factor exponent. TUNE: bigger = zoomier. (3 → 1.05 → 0.5; Daniel: still too enthusiastic)
  // (PAN_GESTURE_SENS retired B611 — the pan gain is derived in kit/pan.js and shared with touch.)
  function glideBy(t, d, tau = 0.18) {
    let g = glide.get(t.key);
    if (!g) { g = { cur: state[t.key] ?? 0, vel: 0, goal: state[t.key] ?? 0, tau }; glide.set(t.key, g); }
    g.goal += d;
    g.tau = tau;
    if (!t.wrap && !t.unbounded) g.goal = Math.max(t.min, Math.min(t.max, g.goal));
    startMotionLoop();
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
      for (const [k, g] of glide) {
        const t2 = targetOf(k);
        const y = g.cur - g.goal;
        if (Math.abs(y) < 1e-4 && Math.abs(g.vel) < 1e-3) { glide.delete(k); continue; }
        live = true;
        const omega = 2 / (g.tau || 0.18);   // per-entry response (buttons 0.18s, phone 0.35s)
        const decay = Math.exp(-omega * dt);
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
  // B619 — every non-transport action fires the EXISTING DOM control rather than writing state.
  // That is deliberate: a form switch resets canvas pan, carries the box centre, rewrites motion
  // keyframes, and refreshes the form-aware sliders; the droste toggles re-snap the spiral. All of
  // that lives on the click handler. Reproducing it here is how the two paths would drift.
  const clickEl = (sel) => { const el = document.querySelector(sel); if (el && !el.disabled) { el.click(); return true; } return false; };
  // remembered across form changes however they were made (hardware, the picker, a preset), because
  // it is sampled at fire time from the CURRENT form rather than tracked at the switch site. That
  // keeps `formLast` honest even when the switch did not come through this module.
  let prevForm = null;
  function fireFormAction(a) {
    const go = (id) => {
      if (!id || id === state.form) return true;   // already there — do not record a self-toggle
      prevForm = state.form;
      return clickEl(`.form-thumb[data-form-id="${CSS.escape(id)}"]`);
    };
    if (a.startsWith('form:')) return go(a.slice(5));
    if (a === 'formLast') return go(prevForm || 'radial');   // first press with no history falls back to radial
    if (a !== 'formNext' && a !== 'formPrev') return false;
    const i = FORMS.findIndex((f) => f.id === state.form);
    const n = FORMS.length;
    // wraps both ways, so a single button can walk the whole set
    return go(FORMS[(((a === 'formNext' ? i + 1 : i - 1) % n) + n) % n].id);
  }
  function fireAction(a) {
    if (a === 'mirror') return void clickEl(`#mirrorToggle button[data-mirror="${state.drosteMirror ? '0' : '1'}"]`);
    if (a === 'wedgeMirror') return void clickEl(`#wedgeMirrorToggle button[data-wedgemirror="${state.drosteWedgeMirror ? '0' : '1'}"]`);
    if (a === 'oob') return void clickEl(`#oobModes button[data-oob="${((state.oobMode | 0) + 1) % 3}"]`);
    if (fireFormAction(a)) return;
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
      `<option value=""${m.target ? '' : ' selected'}>— pick a target —</option>`,
      '<optgroup label="parameters">',
      ...PARAM_TARGETS.filter((t) => !t.hidden || m.target === t.key).map((t) => `<option value="${t.key}"${m.target === t.key ? ' selected' : ''}>${t.label}</option>`),
      '</optgroup><optgroup label="transport">',
      ...ACTION_TARGETS.map((t) => `<option value="${t.key}"${m.target === t.key ? ' selected' : ''}>${t.label}</option>`),
      '</optgroup>',
    ].join('');
    // abs is position-is-value — meaningless for momentary controls, so they
    // omit it; gesture signals are pure deltas, so they're rel by definition
    const isDelta = m.kind === 'gesture' || m.kind === 'touch' || m.sig.startsWith('tp:') || m.sig.startsWith('mob:');
    // DISCRETE targets drop `rate` (B620): the rate loop integrates a velocity into the field every
    // frame, which against a snap is a stuttering ramp rather than a control. `abs` stays — a fader
    // across the legal range is a legitimate way to drive segments — and `rel` is the button case.
    const isDiscreteT = !!targetOf(m.target)?.discrete;
    const modes = (isDelta ? ['rel'] : isDiscreteT ? (momentary ? ['rel'] : ['abs', 'rel']) : momentary ? ['rel', 'rate'] : ['abs', 'rel', 'rate'])
      .map((md) => `<option value="${md}"${m.mode === md ? ' selected' : ''}>${md}</option>`).join('');
    // B620 — a DISCRETE target steps one legal value per press, so a percentage here would be a
    // lie. Daniel: *"segments shouldn't be a percentage, they're abs integers."* The column shows
    // what actually happens instead of an inert control.
    const isDiscrete = isDiscreteT;
    const sens = isDiscrete
      ? '<option>1 step</option>'
      : SENS_OPTS.map((s) => `<option value="${s}"${(m.sens ?? 0.05) === s ? ' selected' : ''}>${Math.round(s * 100)}%</option>`).join('');
    row.innerHTML = `
      <span class="in-grip" draggable="true" title="drag to reorder">≡</span>
      <span class="in-kind">${KIND_CHIP[m.kind] || (isNote ? 'pad' : m.sig.split('.')[1]?.[0] === 'a' ? 'stick' : m.sig.includes('.cc') ? 'cc' : 'btn')}</span>
      <input class="in-name in-label" value="${(m.label || m.sig).replace(/"/g, '&quot;')}" title="${m.sig} — click to rename">
      <select class="in-target" title="${isAction ? '' : dirTitle(m.target)}">${opts}</select>
      <select class="in-mode" ${isAction ? 'disabled' : ''} title="abs: position is the value · rel: nudge per event · rate: deflection is speed">${modes}</select>
      <select class="in-sens" ${isAction || isDiscrete ? 'disabled' : ''} title="${isDiscrete ? 'discrete control — one press moves to the next legal value' : 'sensitivity — step size for rel, speed for rate'}">${sens}</select>
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
          // B619 — LEARN NOW LANDS UNASSIGNED. It used to default to `sliceRotation` (or take),
          // which is silently wrong in a way that compounds: every knob you touch while learning
          // lands on the same target, so a rig built in one pass has several rows all claiming
          // slice rotation and all fighting each other, and nothing on screen says so. An empty
          // target is inert until you pick one, which is the only honest default.
          target: '',
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
