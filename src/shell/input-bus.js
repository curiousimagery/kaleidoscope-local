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
import { touchGesture } from '../kit/gesture-gate.js';   // B639 — a held knob/stick is a gesture too
import { createGamepadInput } from './gamepad-input.js';
import { createTrackpadInput } from './trackpad-input.js';
import { createRemoteInput } from './remote-input.js';
import qrcode from 'qrcode-generator';   // QR pairing (Daniel-approved dependency, MIT, zero-dep)
import { applyUnifiedZoom, Z_CANVAS_MIN, Z_CANVAS_MAX } from '../kit/zoom.js';
import { SLICE_MIN, SLICE_MAX } from '../engine/geometry.js';   // the one slice-scale range (B657)   // shared unified zoom — the canvas pinch routes here too
import { panDelta } from '../kit/pan.js';            // shared canvas-pan gain — the remote drag pans identically to touch
import { FORMS, getActiveForm, formPanLocked, formCanvasNorm, clampCanvasOffset } from '../engine/forms/index.js';   // pannability + the shader's effective zoom; FORMS builds the per-form mapping actions

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
// ⚠️ B624 — IS A TARGET EVEN APPLICABLE TO THE ACTIVE FORM?
//
// Daniel's question: *"square aspect and droste thickness are each unique variables that could map
// to Dpad keys so that the arrows adjust whatever form you're on. Is there any technical reason we
// can't map the same keys and just listen for the valid input based on active form?"*
//
// Two rows CAN already share a signal — `onSignal` applies every match — so it "worked" before this.
// What it also did was **silently write the inactive form's parameter**: fifty d-pad presses on
// square would walk `drosteZoom` to its ceiling behind your back, and you would find out on the next
// form switch. It also fed undo history and every motion keyframe. Working, with a side effect
// nobody would connect to the cause.
//
// The gate reuses `controls` — the array each form ALREADY declares and which already drives UI
// visibility — so there is no new configuration to keep in sync, and **the same rule that hides a
// control in the panel now silences its mapping.** `formControl` deliberately mirrors the field name
// in `shell/params.js` so the two registries read the same.
const appliesToForm = (t, s) => {
  if (t.forms) return t.forms.includes(s.form);
  if (!t.formControl) return true;
  return !!getActiveForm(s)?.controls?.includes(t.formControl);
};
const PARAM_TARGETS = [
  { key: 'sliceRotation', label: 'slice rotation', min: 0, max: 360, wrap: true, dir: '0° → 360° counterclockwise' },
  // B657 — the SHARED slice range (SLICE_MIN/SLICE_MAX, engine/geometry.js). Independent of the
  // zoom gesture's overflow cap, which is a different quantity (how far a canvas zoom-OUT may grow
  // the slice at the wall) and stays per-form.
  { key: 'sliceScale', label: 'slice scale', min: SLICE_MIN, max: SLICE_MAX, dir: 'small → large' },
  // B630 — the origin may leave the image in MIRROR mode. The mapping range resolves the same way,
  // because a bound the pointer honours and the hardware does not is exactly the divergence this
  // arc keeps paying for.
  //
  // ⚠️ B635 — BACK TO ±0.5, AND THE RANGE IS NO LONGER LOAD-BEARING. B634 squeezed this to ±0.25 as
  // an admitted mitigation, because the real bound lived inside the overlay's drag handler and
  // nothing the bus wrote ever met it — Daniel: *"using the translation control on the midi/gamepad
  // input bypasses your barrier."* The bound is now a FOLD in geometry.js, applied at each chrome's
  // render schedule, so a value written from here is canonicalised exactly like one written by a
  // finger. Nothing can be pushed off the image through this path regardless of the envelope, which
  // frees the range to be what it should have been all along: how far the knob travels.
  { key: 'sliceCx', label: 'slice position x', min: 0, max: 1, dir: 'left → right',
    resolve: (s) => (s.oobMode === 1 ? { min: -0.5, max: 1.5 } : { min: 0, max: 1 }) },
  { key: 'sliceCy', label: 'slice position y', min: 0, max: 1, dir: 'top → bottom',
    resolve: (s) => (s.oobMode === 1 ? { min: -0.5, max: 1.5 } : { min: 0, max: 1 }) },
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
    // ⚠️ B621 — `relSpan` exists because THE ABSOLUTE RANGE AND THE NUDGE SIZE ARE DIFFERENT
    // QUESTIONS on this target, and only here does the difference bite.
    //
    // Daniel: *"3-4 presses on droste does the same or less than a single press on other forms."*
    // He is right, and the factor is roughly six. A press moves `span × sens`, and the two spans
    // measure incomparable things:
    //   canvasZoom — span 3.95, so 5% = 0.198 ABSOLUTE, i.e. ~20% bigger from 1.0×.
    //   phase      — span 1 (one loop), so 5% = 0.05 of a loop. A loop is a factor of `drosteZoom`
    //                (default 2×), so that is 2^0.05 ≈ **3.5% scale**. Six times weaker.
    // The full-range span of 1 is CORRECT for `abs` — a fader should sweep exactly one seamless
    // loop — so it cannot simply be enlarged. `relSpan` scales the nudge only, leaving the fader
    // alone: 3.5 loops at 100% puts a 5% press at ~0.175 of a loop ≈ 13% scale, in the same
    // perceptual bracket as the other forms without making the fader nonsense.
    //
    // ⚠️ B623 — `geometric` fixes the OTHER half of the same complaint. Daniel: *"when zooming out
    // the amount each step zooms out becomes increasingly disproportional the further out you are."*
    // Exactly right, and it is the linear nudge again: a press adds a FIXED 0.198 to a quantity
    // that is perceived multiplicatively.
    //   at 4.0×  → 3.80   a 5% change, barely visible
    //   at 1.0×  → 0.80   a 20% change, about right
    //   at 0.25× → 0.05   an 80% change, and it slams into the floor
    // The same press is 16× more powerful at the bottom of the range than the top. A geometric
    // step is constant in the only unit that matters perceptually: each press multiplies.
    geometric: true,
    resolve: (s) => s.form === 'droste'
      ? { key: 'drosteZoomPhase', min: 0, max: 1, wrap: true, wrapPeriod: 1, relSpan: 3.5, geometric: false }
      : { key: 'canvasZoom', min: 0.05, max: 4, geometric: true } },
  // ⚠️ B655 — THE UNIFIED ZOOM AS A MAPPING TARGET. Daniel (B619, restated B654): his DualSense
  // layout only works if ONE control can drive the pair — *"there's absolutely value in being able
  // to add the third, in particular with a rotary control on a midi interface that can control both
  // seamlessly."* This was the last unfinished piece of item 1.5 stage B: `applyUnifiedZoom` was
  // shared between the canvas pinch and the remote pinch, and the HARDWARE path was never connected
  // to it, so a knob could drive `canvasZoom` or `sliceScale` but never what a pinch actually does.
  //
  // **ADDITIVE. `canvas zoom` and `slice scale` are untouched and stay the direct one-axis
  // controls** — Daniel: *"discrete slice and canvas zoom inputs are more valuable than unified zoom
  // so we don't want to get rid of them."* This is a third option, not a replacement.
  //
  // ⚠️ STEP AND RAMP ONLY, and that is a property of the model rather than a shortcut. Unified zoom
  // is defined as a multiplicative DELTA distributed across two fields, and its overflow excursions
  // are deliberately path-dependent (see kit/zoom.js). There is therefore no well-defined position →
  // (sliceScale, canvasZoom) mapping for a fader to hold: a pot resting at its maximum would keep
  // re-applying the overflow and walk the slice on its own. `deltaOnly` is what says so in the UI
  // instead of offering a mode that cannot work.
  //
  // `delta` receives the LOG step the geometric machinery already computes, so a press here is the
  // same perceived percentage as the same press on canvas zoom (identical `geoSpan`, both 0.05→4).
  { key: 'unifiedZoom', label: 'unified zoom  (canvas + slice, like a pinch)',
    min: Z_CANVAS_MIN, max: Z_CANVAS_MAX, dir: 'zoomed out → zoomed in',
    geometric: true, deltaOnly: true,
    delta: (s, logStep) => applyUnifiedZoom(s, Math.exp(logStep)) },
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
  { key: 'squareAspect', label: 'square aspect', min: 0.25, max: 4, dir: 'tall → wide', formControl: 'aspect' },
  // ⚠️ B634 — GEOMETRIC, same class as canvas zoom (B623). Daniel: *"the thicker the droste slice
  // the less a step change actually moves things visually — steps between 2.5 and 1.1 are especially
  // massive."* Exactly right: `drosteZoom` is the RATIO between successive tiers, so what you
  // perceive tracks log(drosteZoom). A fixed additive step of 0.745 (5% of the 1.1–16 span) is a
  // 68% change at 1.1 and a 4.9% change at 16 — a 14× difference in visual effect across the range.
  { key: 'drosteZoom', label: 'droste thickness', min: 1.1, max: 16, dir: 'thin → thick', formControl: 'zoom',
    geometric: true },
  { key: 'drosteSpiral', label: 'droste spiral', min: -3, max: 3, dir: 'wind left → wind right', formControl: 'spiral' },
  { key: 'drosteOffsetX', label: 'droste offset x', min: -1, max: 1, dir: 'left → right', forms: ['droste'] },
  { key: 'drosteOffsetY', label: 'droste offset y', min: -1, max: 1, dir: 'up → down', forms: ['droste'] },
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
  // ⚠️ B623 — THE PANIC BUTTONS, and they earn their place from a real use. Daniel hands the game
  // controller to audience members during a set: *"it's easy for them to make the slice massive,
  // rotate most of the overlay off canvas, etc., and not understand where the slice is or how to
  // get it back."* Every recovery affordance lived on screen, behind menus, on a machine he is not
  // standing at. A mapped reset is the difference between handing someone the controller and
  // hovering over them. Also the honest answer to "live got stuck" for the operator.
  { key: 'action:resetSlice', label: '↺ reset slice' },
  { key: 'action:resetCanvas', label: '↺ reset canvas' },
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
  // Which adapter a connected device came from, as the SIG PREFIX it emits. A connected device with
  // no mappings yet cannot have its kind inferred from `store.maps`, so it has to be asked — this is
  // what keeps the re-home (B651) from offering to hand pad mappings to a MIDI port.
  const ADAPTERS = [['midi', midi], ['pad', pads], ['tp', tp], ['mob', rem]];
  const onlineKinds = () => new Map(ADAPTERS.flatMap(([kind, a]) => a.devices().map((d) => [d.key, kind])));

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

  // ⚠️ B629 — THE MODIFIER (SHIFT) LAYER. Daniel's problem: five forms, four face buttons, and
  // left-stick-press works but is *"an unexpected input location"*.
  //
  // **Chords as literally described could not work.** If `O` alone means radial and `X + O` means
  // droste, then pressing `O` must WAIT to see whether `X` follows — every unshifted press pays a
  // detection window, which live controls cannot afford. **A HELD modifier has no such cost**, is
  // how every hardware controller solves this, and doubles every binding rather than solving forms
  // alone. Daniel approved this shape over his own straw man.
  //
  // Any row can be flagged `mod: true` — no fixed slots (his correction: four named slots is
  // overkill, and shift/ctrl/alt are only meaningful on a labelled keyboard). A flagged row routes
  // nowhere itself; it just reports held/released.
  const heldMods = new Set();
  let justLearned = null;   // see the release-swallow in onSignal (B631)
  const modSigs = () => new Set(store.maps.filter((m) => m.mod).map((m) => m.sig));
  let pendingMod = null;

  // ⚠️ B656 — A MODIFIER CHANGING STATE MUST STOP WHAT IT WAS ROUTING. Daniel, on a DualSense:
  // right-stick press as the modifier, d-pad to zoom — *"if i release the joystick BEFORE the dpad
  // press then it carries the motion forward instead of stopping."* A runaway zoom, and he read the
  // cause correctly: it is about modifiers, not about zoom.
  //
  // **A `ramp` mapping is stopped by its own release**, which arrives as value 0 and clears the rate
  // entry. But routing is decided at ARRIVAL: a shifted row is skipped once its modifier is up
  // (`m.withMod && !heldMods.has(...)`), so releasing the modifier first means **the release that
  // was going to stop the ramp is never delivered to the row that started it.** The rate loop keeps
  // integrating with nothing left that can zero it.
  //
  // The mirror case is just as real and would have been the next report: press d-pad on an
  // UNSHIFTED row, then press the modifier, and that row becomes masked by the shifted one — so its
  // release is swallowed the same way.
  //
  // So the rule is symmetric and applies on press AND release: when a modifier changes state, every
  // ramp on a signal whose routing that modifier affects is stopped. It cannot strand, and it
  // matches the model Daniel stated — both have to be held for the input to count.
  function stopRatesForMod(modSig) {
    const affected = new Set(store.maps.filter((m) => m.withMod === modSig).map((m) => m.sig));
    if (!affected.size) return;
    for (const m of store.maps) {
      if (affected.has(m.sig)) rate.delete(m.sig + '→' + m.target);
    }
  }

  function onSignal(sig, value, meta) {
    // MODIFIER BOOKKEEPING FIRST, and outside the learn branch, so a modifier is trackable even
    // while learning (that is the whole assignment mechanism below).
    const mods = modSigs();
    if (mods.has(sig)) {
      const down = value > 0.5;
      const was = heldMods.has(sig);
      if (down) heldMods.add(sig); else heldMods.delete(sig);
      if (was !== down) stopRatesForMod(sig);   // B656 — never strand a ramp whose routing just changed
      if (learnCb) {
        // HOLD the modifier and press the second control → that chord is what gets recorded.
        // Release it alone and nothing is recorded — instant in both directions, no timer.
        // (Daniel's straw man used a 3s window; a release is faster and cannot feel broken.)
        pendingMod = down ? sig : (pendingMod === sig ? null : pendingMod);
        paintActivity(sig);
        return;
      }
      paintActivity(sig);
      return;   // a modifier never drives its own target
    }
    if (learnCb) {
      if (meta.momentary && value === 0) return;   // learn on press, not release
      const cb = learnCb; learnCb = null;
      rememberDevice(meta);
      const withMod = pendingMod; pendingMod = null;
      // ⚠️ B631 — SWALLOW THIS BUTTON'S RELEASE. Learn fires on the PRESS and clears `learnCb`,
      // so the matching RELEASE arrived with learning already over and was routed as a normal
      // signal — firing the control's EXISTING mapping and flashing its row. Learning a button
      // that was already mapped therefore always triggered the old binding once, which read as
      // "it just highlights the existing mapping" and hid the prompt entirely.
      // MOMENTARY ONLY: a button has a release to swallow. A continuous control (cc, axis) may
      // never send 0, and latching on one would mute that control for the rest of the session.
      justLearned = meta.momentary ? sig : null;
      cb(sig, meta, withMod);
      return;
    }
    // the release that closes the press we just learned on — not an input, an echo
    if (justLearned === sig) { justLearned = null; if (value === 0) return; }
    // A SHIFTED row exists for this signal and its modifier is down → the unshifted rows step
    // aside. Scoped to signals that actually HAVE a shifted alternative, so holding a modifier
    // never deadens unrelated bindings (which would be the surprising version).
    const shifted = store.maps.some((m) => m.sig === sig && m.withMod && heldMods.has(m.withMod));
    let hit = false;
    for (const m of store.maps) {
      if (m.sig !== sig) continue;
      if (m.withMod && !heldMods.has(m.withMod)) continue;    // its modifier is not held
      if (!m.withMod && shifted) continue;                     // masked by the shifted binding
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
      clampCanvasOffset(state);   // B688 — the same clamp the local gesture applies (kit rule: one behaviour, both surfaces)
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
    // NOT APPLICABLE TO THIS FORM → decline, and SAY SO rather than writing a hidden parameter
    // (B624). The row dims live, which is what makes a shared d-pad legible: you can see which of
    // the two bindings is the one currently listening.
    if (!appliesToForm(t0, state)) { markInactive(m.sig, m.target); return; }
    // a SEMANTIC target (e.g. "zoom") resolves to the active form's key + range each apply, so
    // one mapping drives the right param per form (Stage 1 of the registry unification).
    const t = t0.resolve ? { ...t0, ...t0.resolve(state) } : t0;
    const span = t.max - t.min;
    // the span a NUDGE is measured against. Identical to the absolute range for every target
    // except droste's infinite zoom, where a loop is the right fader sweep but far too small a
    // press — see `relSpan` on the canvasZoom target (B621).
    const relSpan = t.relSpan ?? span;
    const sens = m.sens ?? 0.05;
    // a DISCRETE target stored as `rate` by an older rig falls back to stepping (B620). The mode
    // dropdown no longer offers rate here, but a mapping saved before that still says so, and the
    // rate loop against a snap is a stutter rather than a control.
    // a DELTA-ONLY target stored as `abs` falls back to stepping (B655) — the same shape as the
    // discrete/rate fallback below. The dropdown never offers it, but a hand-edited or
    // forward-migrated rig could still say so, and writing an absolute value would invent a state
    // field that nothing reads.
    if (m.mode === 'abs' && t.delta) m = { ...m, mode: 'rel' };
    if (m.mode === 'rate' && t.nudge) {
      const dir = Math.sign(value) * (m.invert ? -1 : 1);
      if (dir) { t.nudge(state, dir, env); env.scheduleRender?.(); env.syncControls?.(); }
      return;
    }
    if (m.mode === 'rate') {
      let d = value;
      if (m.invert) d = -d;
      rate.set(m.sig + '→' + m.target, { key: t.key, d, span: t.geometric ? geoSpan(t) * GEO_K : relSpan, sens });
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
      // ⚠️ B636 — A GEOMETRIC TARGET'S STEP IS SIZED BY ITS *LOG* SPAN. B634 sized it by the
      // arithmetic span, which is meaningless for a ratio parameter and made droste thickness far
      // WORSE, not better: `relSpan` is 14.9 there against canvas zoom's 3.95, so the same 5% press
      // came out as `exp(0.745 × 0.92) − 1` ≈ **98% per press** — every tap nearly doubling the
      // tier ratio. Daniel: *"the steps between thinner droste thickness levels result in massive
      // steps still."*
      //
      // log(max/min) is the honest span for a quantity you perceive as a ratio, and it makes the
      // step a CONSTANT PERCENTAGE everywhere in the range, which is what "proportional" means
      // here. GEO_K is re-tuned to 0.83 so canvas zoom keeps the ~20%-per-5%-press feel Daniel
      // already confirmed; droste thickness lands at ~12% per press, flat from 1.1 to 16.
      let d = (meta.momentary ? Math.sign(value) : value) * (t.geometric ? geoSpan(t) * GEO_K : relSpan) * sens;
      if (m.invert) d = -d;
      // A target that owns its own RELATIVE application takes the LOG step directly, before the
      // additive conversion below — because it is not an assignment to one field at all (B655).
      // No spring glide here: the goal would have to be an absolute value, and this target has
      // none. A pinch has no easing either, so a step reads the same as the gesture it mirrors.
      if (t.delta) {
        if (d) { t.delta(state, d, env); touchGesture(); afterParamWrite(); }
        return;
      }
      // ...then convert the log-step into the additive delta the glide below expects, so spring
      // smoothing and chained-press velocity continuity are untouched.
      if (t.geometric) d = (state[t.key] ?? 1) * (Math.exp(d) - 1);
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
    //
    // ⚠️ B636 — AND FOR A GEOMETRIC TARGET THAT SWEEP IS LOGARITHMIC. This is the half B634 missed
    // entirely: `geometric` only ever touched the `rel` branch, so a knob or fader mapped in
    // ABSOLUTE mode still walked droste thickness linearly from 1.1 to 16 — which is why Daniel
    // reported the behaviour *"seems unchanged as before the adjustment"*. It was unchanged; his
    // mapping never reached the code B634 fixed. Equal knob travel is equal RATIO now, so the thin
    // end stops lurching.
    let v01 = meta.bipolar ? (value + 1) / 2 : value;
    if (m.invert) v01 = 1 - v01;
    writeParam(t, t.geometric && t.min > 0 ? t.min * Math.exp(v01 * geoSpan(t)) : t.min + v01 * span);
  }

  function writeParam(t, v) {
    // ⚠️ B639 — EVERY WRITE FROM HARDWARE COUNTS AS "STILL MOVING". A MIDI CC knob never says it
    // is done, so there is no release to wait for; a short idle window is the honest substitute.
    //
    // Deliberately NOT scoped to slice-position targets. Over-suppressing costs nothing — the fold
    // is pixel-preserving, so postponing it changes no pixel, only which description of an
    // identical picture we hold — while under-suppressing reverses a gesture the operator is in the
    // middle of. The failure modes are not symmetric, so this errs toward the free one.
    //
    // Autoplay is unaffected and must be: `kit/drift.js` writes `state[k]` directly and never comes
    // through here, so a continuous drift can still fold. That is exactly where the fold earns its
    // keep, so a gate that swallowed it would be worse than no gate.
    touchGesture();
    if (t.wrap) { const P = t.wrapPeriod || 360; v = ((v % P) + P) % P; }
    // `unbounded` = periodic in the shader but stored raw (tiling pan). Not wrapped HERE on
    // purpose: state stays continuous so the follower / tween / autoplay never see a seam blip,
    // exactly as the local touch path already does. The uniform does the wrapping.
    else if (!t.unbounded) v = Math.max(t.min, Math.min(t.max, v));
    // a target whose assignment ISN'T `state[key] = v` supplies its own writer (segments snaps
    // and cascades). Everything downstream — render, overlay, control sync — still runs here.
    if (t.write) t.write(state, v, env);
    else state[t.key] = v;
    afterParamWrite();
  }

  // the tail every param write shares: schedule the render + overlay, and sync the controls at a
  // bounded rate. Extracted at B655 so a `delta` target (which never goes through writeParam)
  // cannot drift from it — the two would otherwise be two copies of the same four lines.
  function afterParamWrite() {
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
  // exp() rate for GEOMETRIC targets, chosen so the mid-range feel is unchanged: at canvasZoom 1.0
  // a 5% press moved 0.198 additively, and exp(0.198 × 0.92) − 1 ≈ 0.20. Same press at 1.0×, but
  // now proportional everywhere instead of 16× stronger at the bottom of the range.
  // Re-tuned from 0.92 at B636 when the step basis moved from the arithmetic span to the log span
  // (see the rel branch). Chosen to hold canvas zoom at the ~20%-per-5%-press feel Daniel confirmed.
  // ⚠️ B641 — DISPLAY NAMES ONLY. The stored values stay `abs`/`rel`/`rate`, so every saved rig
  // and every `m.mode` comparison in this file is untouched — a rename that needed a migration
  // would not be worth a clearer label.
  //
  // The old names described WHAT THE INCOMING NUMBER IS, which is the implementer's question, and
  // they hid the important distinction: `rel` and `rate` are both "relative" — one is a
  // displacement per event, the other a velocity. The new names say what the control DOES, which
  // is the operator's question: the knob SETS it, the button STEPS it, hold to RAMP it.
  const MODE_LABEL = { abs: 'set', rel: 'step', rate: 'ramp' };
  const GEO_K = 0.83;
  // The honest span for a quantity perceived as a RATIO. Falls back to the arithmetic span if a
  // future geometric target ever has a non-positive min, where log is undefined.
  const geoSpan = (t) => (t.min > 0 && t.max > 0 ? Math.log(t.max / t.min) : (t.max - t.min));
  const PINCH_ZOOM_SENS = 0.5;    // WS scale-delta → unified-zoom factor exponent. TUNE: bigger = zoomier. (3 → 1.05 → 0.5; Daniel: still too enthusiastic)
  // (PAN_GESTURE_SENS retired B611 — the pan gain is derived in kit/pan.js and shared with touch.)
  function glideBy(t, d, tau = 0.18) {
    let g = glide.get(t.key);
    if (!g) { g = { cur: state[t.key] ?? 0, vel: 0, goal: state[t.key] ?? 0, tau, last: state[t.key] ?? 0 }; glide.set(t.key, g); }
    g.goal += d;
    g.tau = tau;
    if (!t.wrap && !t.unbounded) g.goal = Math.max(t.min, Math.min(t.max, g.goal));
    startMotionLoop();
  }

  // the MOTION LOOP: rate deflections (full deflection sweeps sens × range ×
  // 2.4/s) and button-nudge glides (critically damped spring, ~0.18s response —
  // the gentle-joystick ease) integrate here; alive only while something moves.
  // ⚠️ B657 — THE STAGE-C GAP, AND IT WAS THE LAST ONE. A settling glide holds `cur` as the
  // authoritative value and writes it every frame, so for the ~0.5s a button nudge takes to settle
  // (~1s for a phone gesture) **any other input touching the same field was silently overwritten**
  // — a knob, a drag, autoplay. That is the textbook shape item 1.5 stage C names: two inputs
  // holding independent absolute position state for the same field.
  //
  // Every other holder in the system already yields correctly, which is why this survived: the rate
  // loop re-reads `state` each tick so it adopts by construction, `kit/drift.js` compares what it
  // wrote against what is there and RELOCATES its wander on a mismatch, the follower chases state,
  // and a pointer drag re-seeds on pointerdown. Only the glide assumed it was alone.
  //
  // It now uses drift's test — `last` is what actually landed after the write (read back, so a
  // wrap or a snapping `write` hook counts as ours) — and YIELDS rather than relocating: a button
  // nudge is a small finished gesture, so when another hand takes the field the honest answer is to
  // stop, not to keep pushing toward a goal nobody is asking for any more.
  const glide = new Map();       // stateKey → { cur, vel, goal, last }
  function startMotionLoop() {
    if (rateRaf) return;
    rateLastT = performance.now();
    const tick = (t) => {
      rateRaf = 0;
      const dt = Math.min(t - rateLastT, 100) / 1000;
      rateLastT = t;
      let live = false;
      // a deflected stick or a settling nudge is still moving the slice — keep the fold waiting
      // until the motion loop itself goes quiet (B639)
      if (rate.size || glide.size) touchGesture();
      for (const [k, r] of rate) {
        if (!r.d) { rate.delete(k); continue; }
        live = true;
        // B636 — a geometric target ramps by a constant RATIO per second, not a constant amount,
        // so a held deflection feels the same at the thin and thick ends of the range.
        const rt = targetOf(r.key);
        const step = r.d * r.span * r.sens * 2.4 * dt;
        if (rt?.delta) { rt.delta(state, step, env); afterParamWrite(); continue; }   // B655
        writeParam(rt, rt?.geometric ? (state[r.key] ?? 1) * Math.exp(step) : (state[r.key] ?? 0) + step);
      }
      for (const [k, g] of glide) {
        const t2 = targetOf(k);
        // another input moved this field out from under us → yield it (B657)
        if (Math.abs((state[k] ?? 0) - g.last) > 1e-6) { glide.delete(k); continue; }
        const y = g.cur - g.goal;
        if (Math.abs(y) < 1e-4 && Math.abs(g.vel) < 1e-3) { glide.delete(k); continue; }
        live = true;
        const omega = 2 / (g.tau || 0.18);   // per-entry response (buttons 0.18s, phone 0.35s)
        const decay = Math.exp(-omega * dt);
        const tmp = (g.vel + omega * y) * dt;
        g.cur = g.goal + (y + tmp) * decay;
        g.vel = (g.vel - omega * tmp) * decay;
        writeParam(t2, g.cur);
        g.last = state[k] ?? 0;   // what actually LANDED (post clamp / wrap / write hook)
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
    // the reset buttons carry their own history push, control sync and (for canvas) the droste
    // phase zeroing — firing the DOM control is what keeps all three attached.
    if (a === 'resetSlice') return void (clickEl('#sliceReset') || clickEl('#m-reset'));
    if (a === 'resetCanvas') return void (clickEl('#canvasReset') || clickEl('#m-canvas-reset'));
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
    // ALL rows on this signal, not just the first — two rows can share a button (B624), and
    // flashing only one of them would misreport which binding just acted.
    document.querySelectorAll(`[data-sig="${CSS.escape(sig)}"]`).forEach((row) => {
      row.classList.add('in-live'); setTimeout(() => row.classList.remove('in-live'), 150);
    });
  }

  // A row that DECLINED because its target does not apply to the active form. Distinct from the
  // activity flash on purpose: this is "I heard you and this is not my form", which is the honest
  // answer to a shared binding and the thing that makes the arrangement readable.
  function markInactive(sig, target) {
    if (byId('settingsSheet')?.hidden !== false) return;
    const row = document.querySelector(`[data-sig="${CSS.escape(sig)}"][data-target="${CSS.escape(target)}"]`);
    if (row) { row.classList.add('in-idle'); setTimeout(() => row.classList.remove('in-idle'), 400); }
  }

  // ---- app-bar presence: one green dot per online device ------------------------
  function renderLights() {
    const el = byId('inputLights');
    if (!el) return;
    const on = online();
    el.innerHTML = [...on.values()].map((n) => `<i title="${n} — connected"></i>`).join('');
    el.hidden = !on.size;
  }

  // ⚠️ B650 — MIGRATE A RIG WHOSE DEVICE KEY CHANGED UNDER IT. The pad key became vendor+product
  // (shell/gamepad-input.js), which renames the device half of every `pad:` signal. Mappings match
  // on exact sig equality, so without this an existing rig would simply stop binding on upgrade —
  // the exact failure the change is meant to end, arriving from the other direction.
  //
  // Runs against CONNECTED pads only and only when the old key actually has maps and the new one
  // does not, so it cannot fire twice, cannot invent a device, and cannot clobber a rig already
  // built on the new key. Silent by design: nothing about it is a decision for the operator.
  function migratePadKeys() {
    const renames = pads.renames?.();
    if (!renames?.size) return;
    let changed = false;
    for (const [old, key] of renames) {
      const from = `pad:${old}.`, to = `pad:${key}.`;
      // Match on the SIG, not on `dev` — the sig is what decides binding, so repairing from it also
      // heals a row whose `dev` drifted, and cannot miss a row that has one.
      if (!store.maps.some((m) => m.sig?.startsWith(from))) continue;
      if (store.maps.some((m) => m.sig?.startsWith(to))) continue;   // already on the new key
      for (const m of store.maps) {
        if (!m.sig?.startsWith(from)) continue;
        m.sig = to + m.sig.slice(from.length);
        m.dev = key;
        if (m.withMod?.startsWith(from)) m.withMod = to + m.withMod.slice(from.length);
      }
      if (store.devices[old]) {
        store.devices[key] = { ...store.devices[old], ...(store.devices[key] || {}) };
        delete store.devices[old];
      }
      changed = true;
    }
    if (changed) save();
  }

  // ⚠️ B651 — HAND AN OFFLINE DEVICE'S MAPPINGS TO A CONNECTED ONE. B650 made a rig portable going
  // FORWARD; it cannot rescue a file exported before it, because Chromium's old slug is truncated
  // at 40 characters before the vendor digits appear. Daniel imported such a file and got what the
  // screenshot shows: two DualSense rows, one offline holding all 24 mappings, one connected holding
  // one — *"i still have no way to use the loaded values if the system registers the loaded
  // dualsense as different hardware."*
  //
  // **Three affordances already looked like they should fix that and all three silently did
  // nothing** — rename (a display string), delete (removes the mappings with it), drag (reorders
  // within a list). That is the actual defect: the device KEY is invisible, uneditable, and the only
  // thing that matters. This is the missing verb, at the granularity the problem has — nobody is
  // dragging 24 rows one at a time.
  //
  // Restricted to the same sig prefix, because control names are not comparable across kinds: a
  // pad's `.a0` means nothing to a MIDI port that speaks `.cc1`.
  const devKind = (dev) => String(store.maps.find((m) => m.dev === dev)?.sig || '').split(':')[0];
  // Swap the DEVICE segment of a sig — `<kind>:<device>.<control>` → `<kind>:<to>.<control>`. Done
  // positionally rather than by matching `<from>`, because `m.dev` and the slug embedded in the sig
  // are not guaranteed to agree (the v1→v2 migration wrote `dev: 'unknown'` for anything non-MIDI).
  // Selecting rows by `m.dev` and rewriting by position is correct under that drift; doing either
  // by prefix match would quietly move nothing.
  const withDevice = (sig, to) => {
    const i = String(sig).indexOf(':'), j = String(sig).indexOf('.', i + 1);
    return (i < 0 || j < 0) ? sig : `${sig.slice(0, i)}:${to}${sig.slice(j)}`;
  };
  function moveDevice(from, to) {
    if (!from || !to || from === to) return;
    const moving = store.maps.filter((m) => m.dev === from);
    if (!moving.length) { alert('nothing to move — that device has no mappings.'); return; }
    const remap = new Map(moving.map((m) => [m.sig, withDevice(m.sig, to)]));   // old sig → new sig
    for (const m of moving) { m.sig = remap.get(m.sig) ?? m.sig; m.dev = to; }
    // a modifier reference points at another row's sig — follow it only if that row moved too
    for (const m of store.maps) if (m.withMod && remap.has(m.withMod)) m.withMod = remap.get(m.withMod);
    // A merge must not leave the same control bound to the same target twice. Scoped to the TARGET
    // device only — elsewhere, two rows sharing a sig is legitimate (see the duplicate-binding
    // prompt), and a global dedupe here would quietly eat rows this move never touched.
    const seen = new Set();
    store.maps = store.maps.filter((m) => {
      if (m.dev !== to) return true;
      const k = `${m.sig}→${m.target}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    delete store.devices[from];   // it existed only to hold those mappings
    save(); renderMaps(); renderLights(); paintLeds();
  }

  // ---- the inputs tab -------------------------------------------------------------
  function refreshDevices() {
    migratePadKeys();
    // remember every device we see, so it lists (offline) after disconnect
    for (const [key, name] of online()) {
      if (!store.devices[key]) { store.devices[key] = { name }; save(); }
    }
    renderLights();
    if (byId('settingsSheet')?.hidden === false) renderMaps();
    paintLeds();
  }

  let dragIdx = -1;   // store.maps index being dragged
  // ⚠️ B639 — A REAL SKELETON SLOT, NOT A LINE. Daniel: *"it would be helpful... to replace the
  // single line with a skeleton version of the row you're dragging so the rows that will be above
  // and below float out of the way proportionally."* Standard list-DnD practice, and it also fixes
  // an ambiguity the line had: the line was painted ON a row, so the actual drop target was the row
  // under the cursor rather than the gap you were aiming at. The slot IS the destination, which
  // makes the preview and the result the same object. No library — one div, sized to the row it
  // stands in for.
  let dropSlot = null;
  let dragHeight = 44;   // the dragged row's measured height, so the slot matches it exactly
  function clearDropLine() {
    dropSlot?.remove();
    dropSlot = null;
  }
  // ⚠️ B640 — THE LIST HANDLES THE DROP, NOT THE ROWS. THIS IS WHY THREE FIXES DID NOT TAKE.
  //
  // `drop` only fires on the element the pointer is actually over, and it bubbles to that
  // element's ANCESTORS. Rows are siblings of each other and of the drop slot, and `.in-maps` is a
  // flex column with a 5px `gap` — so releasing in the gap between two rows, or on the slot itself
  // (which is placed exactly where you are aiming, by construction), targets the CONTAINER. No
  // row's handler was an ancestor of that, so none ran. `document.body`'s file-drop handler caught
  // it instead, found no `dataTransfer.files`, and returned. Silence.
  //
  // **That was true of the original insertion line too**: it added `margin-top: 13px` to part the
  // rows, which opened a gap right where the operator was aiming. So every version of this feature
  // has been most likely to fail exactly where it told you to drop. B634's `setData` and B639's
  // `getData` were both real defects correctly fixed — they just were not this one.
  //
  // Moving dragover/drop to the container makes the whole list a single valid drop target and the
  // insertion point a function of pointer position, which is what it always should have been.
  function listRowsFor(wrap, dev) {
    return [...wrap.querySelectorAll('.in-map')].filter((r) => r.dataset.dev === dev);
  }
  // The row the slot goes BEFORE, or the position just past this device's last row. Never null-at-
  // end-of-list: appending past the final group would silently move the mapping into another
  // device's section, which the grouped render then undoes (looking, again, like nothing happened).
  function slotAnchor(rows, y) {
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      if (y < b.top + b.height / 2) return r;
    }
    return rows[rows.length - 1].nextSibling;
  }
  function wireListDnD(wrap) {
    // ONCE per element, not once per render: renderMaps only clears innerHTML, so the container
    // itself survives and listeners would stack on every re-render.
    if (wrap._dndWired) return;
    wrap._dndWired = true;
    wrap.addEventListener('dragover', (e) => {
      if (dragIdx < 0) return;
      const rows = listRowsFor(wrap, store.maps[dragIdx]?.dev || '');
      if (!rows.length) return;
      e.preventDefault();                       // REQUIRED, or `drop` never fires
      e.dataTransfer.dropEffect = 'move';
      showDropSlot(wrap, slotAnchor(rows, e.clientY), dragHeight);
    });
    wrap.addEventListener('dragleave', (e) => {
      if (!wrap.contains(e.relatedTarget)) clearDropLine();
    });
    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();                      // keep it away from body's file-drop handler
      // The source index rides on dataTransfer (B639): `dragend` clears the closure variable and
      // the drop-then-dragend order is not universal, so the closure cannot be trusted here.
      const carried = parseInt(e.dataTransfer.getData('text/plain'), 10);
      const from = Number.isInteger(carried) ? carried : dragIdx;
      const dev = store.maps[from]?.dev || '';
      const rows = listRowsFor(wrap, dev);
      clearDropLine();
      dragIdx = -1;
      if (from < 0 || !store.maps[from] || !rows.length) return;
      const anchor = slotAnchor(rows, e.clientY);
      let to = anchor?.dataset?.mi != null
        ? parseInt(anchor.dataset.mi, 10)
        : parseInt(rows[rows.length - 1].dataset.mi, 10) + 1;
      if (!Number.isInteger(to) || from === to || from === to - 1) return;
      const [moved] = store.maps.splice(from, 1);
      if (from < to) to--;
      store.maps.splice(to, 0, moved);
      save(); renderMaps();
    });
  }

  // `beforeEl` may legitimately be null — that means "at the end", which is what insertBefore's
  // null already does. Bailing when it would land on itself keeps dragover from re-inserting the
  // slot on every event, which would restart its transition and read as a flicker.
  function showDropSlot(parent, beforeEl, h) {
    if (!parent || beforeEl === dropSlot) return;
    if (!dropSlot) {
      dropSlot = document.createElement('div');
      dropSlot.className = 'in-drop-slot';
    }
    dropSlot.style.height = h + 'px';
    if (dropSlot.parentNode !== parent || dropSlot.nextSibling !== beforeEl) {
      parent.insertBefore(dropSlot, beforeEl);
    }
  }
  function renderMaps() {
    const wrap = byId('inMaps');
    if (!wrap) return;
    wrap.innerHTML = '';
    const on = online();
    const kinds = onlineKinds();
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
      // offline + holding mappings + a connected device of the same kind to hand them to (B651)
      const adoptable = (!on.has(dev) && nMaps)
        ? [...kinds].filter(([k, kind]) => k !== dev && kind === devKind(dev)).map(([k]) => k)
        : [];
      const devLabel = (k) => (store.devices[k]?.friendly || on.get(k) || store.devices[k]?.name || k);
      head.innerHTML = `<button class="in-chev" title="${closed ? 'expand' : 'collapse'}">${closed ? '▸' : '▾'}</button>
        <i class="in-dot${on.has(dev) ? ' on' : ''}" title="${on.has(dev) ? 'connected' : 'offline'}"></i>
        <input class="in-name" value="${(d.friendly || d.name || dev).replace(/"/g, '&quot;')}" title="device name — click to rename">
        ${adoptable.length ? `<select class="in-devmove" title="this device is offline — hand its mappings to a connected one">
          <option value="">move mappings to…</option>
          ${adoptable.map((k) => `<option value="${k}">${devLabel(k).replace(/"/g, '&quot;')}</option>`).join('')}
        </select>` : ''}
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
      head.querySelector('.in-devmove')?.addEventListener('change', (e) => {
        const to = e.target.value;
        e.target.value = '';
        if (!to) return;
        if (!window.confirm(`move ${nMaps} mapping${nMaps === 1 ? '' : 's'} onto “${devLabel(to)}”? this offline copy is removed.`)) return;
        moveDevice(dev, to);
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
    wireListDnD(wrap);   // B640 — the container owns dragover/drop (see the note there)
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
    row.dataset.target = m.target;   // B624: two rows can share a signal, so the pair identifies a row
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
    // B655 — a target whose write is a multiplicative DELTA has no position to hold, so it never
    // offers `set` (see the unified-zoom entry for why that is the model, not a gap).
    const deltaOnlyT = !!targetOf(m.target)?.deltaOnly;
    const modes = (isDelta ? ['rel'] : isDiscreteT ? (momentary ? ['rel'] : ['abs', 'rel']) : deltaOnlyT ? ['rel', 'rate'] : momentary ? ['rel', 'rate'] : ['abs', 'rel', 'rate'])
      .map((md) => `<option value="${md}"${m.mode === md ? ' selected' : ''}>${MODE_LABEL[md]}</option>`).join('');
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
      <button class="toggle in-mod${m.mod ? ' active' : ''}" title="${m.mod
        ? 'MODIFIER: hold this and press another control to reach that control\'s second binding. Drives no target of its own.'
        : 'make this a MODIFIER — hold it while learning another control to record a chord'}">mod</button>
      <select class="in-target" ${m.mod ? 'disabled' : ''} title="${m.mod ? 'a modifier drives no target of its own' : (isAction ? '' : dirTitle(m.target))}">${m.mod ? '<option>— modifier —</option>' : opts}</select>
      <select class="in-mode" ${isAction || m.mod ? 'disabled' : ''} title="${m.mod ? 'a modifier has no mode — it is held, not read' : 'set: the control&apos;s position IS the value (a knob or fader) · step: one nudge per event (a button or endless encoder) · ramp: deflection is SPEED — hold to keep moving'}">${m.mod ? '<option>—</option>' : modes}</select>
      <select class="in-sens" ${isAction || isDiscrete || m.mod ? 'disabled' : ''} title="${m.mod ? 'a modifier has no sensitivity' : (isDiscrete ? 'discrete control — one press moves to the next legal value' : 'sensitivity — step size for rel, speed for rate')}">${m.mod ? '<option>—</option>' : sens}</select>
      <button class="toggle in-inv${m.invert ? ' active' : ''}" title="invert${isAction ? '' : ' — ' + dirTitle(m.target)}">inv</button>
      ${isNote ? '<button class="in-led" title="pad LED color — tap to cycle"></button>' : '<span></span>'}
      <button class="vid-x in-del" title="remove mapping">✕</button>`;
    const ledBtn = row.querySelector('.in-led');
    const paintSwatch = () => { if (ledBtn) ledBtn.style.background = (LED_COLORS.find((c) => c.v === (m.led ?? 0)) || LED_COLORS[0]).css; };
    paintSwatch();
    // a SHIFTED row says so where the kind chip goes, so a chord is legible at a glance
    if (m.withMod) {
      const src = store.maps.find((x) => x.sig === m.withMod);
      row.querySelector('.in-kind').textContent = `+${(src?.label || 'mod').slice(0, 6)}`;
      row.querySelector('.in-kind').title = `only acts while ${src?.label || m.withMod} is held`;
    }
    row.querySelector('.in-label').addEventListener('change', (e) => { m.label = e.target.value.trim() || m.sig; save(); });
    row.querySelector('.in-mod').addEventListener('click', () => {
      m.mod = !m.mod;
      // a modifier drives nothing itself — clear the target so the row cannot half-do both
      if (m.mod) { m.target = ''; heldMods.delete(m.sig); }
      save(); renderMaps();
    });
    row.querySelector('.in-target').addEventListener('change', (e) => { m.target = e.target.value; save(); renderMaps(); });
    row.querySelector('.in-mode').addEventListener('change', (e) => { if (!m.mod) { m.mode = e.target.value; save(); } });
    row.querySelector('.in-sens').addEventListener('change', (e) => { if (!m.mod) { m.sens = parseFloat(e.target.value); save(); } });
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
    // B640 — the LIST owns the drop, so rows must be identifiable from it.
    row.dataset.dev = m.dev || '';
    row.dataset.mi = String(store.maps.indexOf(m));
    const grip = row.querySelector('.in-grip');
    grip.addEventListener('dragstart', (e) => {
      dragIdx = store.maps.indexOf(m);
      dragHeight = row.getBoundingClientRect().height;
      e.dataTransfer.effectAllowed = 'move';
      // ⚠️ B634 — setData IS REQUIRED. A drag whose dataTransfer carries no payload is not a valid
      // drag in Chromium or WebKit: `dragover` still fires (so the insertion line appeared) but
      // `drop` never does. That is Daniel's exact report — *"a line appears on the drop target but
      // on release nothing happens."* It has been missing since the reorder shipped at B278.
      try { e.dataTransfer.setData('text/plain', String(dragIdx)); } catch { /* older WebKit */ }
      row.classList.add('in-dragging');
    });
    grip.addEventListener('dragend', () => {
      row.classList.remove('in-dragging');
      clearDropLine();
      dragIdx = -1;
    });
    return row;
  }
  function dirTitle(key) {
    const t = targetOf(key);
    return t ? `${t.label}: low → high runs ${t.dir}` : '';
  }

  // ⚠️ B629 — A SECOND BINDING ON THE SAME CONTROL IS NOW REACHABLE. Learn used to see an
  // already-mapped signal and silently flash the existing row, which meant **B624's whole
  // form-gating feature had no way in**: mapping the d-pad to both square aspect and droste
  // thickness requires two rows on one signal, and the UI refused to make the second one.
  // Daniel found this immediately, which is the useful lesson — a capability with no path
  // through the UI is not shipped.
  //
  // So: ask. The prompt names the tradeoff rather than just warning, because a second binding is
  // genuinely CORRECT in two cases (per-form targets that never both apply, and a modifier chord)
  // and genuinely a mistake otherwise — two rows on one control both writing the same form's
  // params is the "several rows all claiming slice rotation" problem in a new outfit.
  function askDuplicate(sig, existing, onAdd) {
    const list = byId('inMaps');
    if (!list) return onAdd();
    document.getElementById('inDupAsk')?.remove();
    const names = existing.map((m) => targetOf(m.target)?.label || m.target || 'unassigned');
    const box = document.createElement('div');
    box.id = 'inDupAsk';
    box.className = 'in-dupask';
    box.innerHTML = `
      <div class="in-dupask-msg"><b>${(existing[0].label || sig).replace(/</g, '&lt;')}</b> is already mapped to
        <b>${names.join(', ').replace(/</g, '&lt;')}</b>.</div>
      <div class="in-dupask-note">A second binding is right when the two targets belong to <b>different forms</b>
        (only the active form's acts) or when one is behind a <b>modifier</b>. Two bindings on the same form
        will both fire and fight.</div>
      <div class="in-dupask-btns">
        <button class="toggle" id="inDupEdit">edit the existing one</button>
        <button class="primary" id="inDupAdd">add a second binding</button>
      </div>`;
    // ⚠️ B631 — INSERTED BEFORE THE LIST, NOT INSIDE IT. `.in-maps` is `max-height: 62vh;
    // overflow-y: auto`, so prepending put the prompt at the top of a SCROLLED container — with a
    // rig of any size it was simply off-screen, and Daniel reported the feature as not working.
    // A prompt you cannot see is a prompt that does not exist.
    list.parentNode.insertBefore(box, list);
    box.scrollIntoView({ block: 'nearest' });
    const close = () => box.remove();
    box.querySelector('#inDupEdit').addEventListener('click', () => {
      close();
      const row = document.querySelector(`[data-sig="${CSS.escape(sig)}"]`);
      if (row) { row.classList.add('in-live'); setTimeout(() => row.classList.remove('in-live'), 900); row.scrollIntoView({ block: 'nearest' }); }
    });
    box.querySelector('#inDupAdd').addEventListener('click', () => { close(); onAdd(); });
  }

  function setLearn(on) {
    const btn = byId('inLearn');
    if (on) {
      learnCb = (sig, meta, withMod) => {
        btn?.classList.remove('active');
        const dupes = store.maps.filter((m) => m.sig === sig && (m.withMod || null) === (withMod || null));
        const add = () => { pushMapping(sig, meta, withMod); };
        if (dupes.length) return askDuplicate(sig, dupes, add);
        add();
      };
      btn?.classList.add('active');
    } else {
      learnCb = null;
      pendingMod = null;
      btn?.classList.remove('active');
    }
  }

  function pushMapping(sig, meta, withMod) {
        store.maps.push({
          ...(withMod ? { withMod } : {}),
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
