// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// params.js
//
// The parameter registry: the single declarative catalog of every adjustable
// kaleidoscope control — what it is, which state field it drives, which form
// (if any) gates its visibility, and (for the clean sliders) the exact opts
// `wireSliderWithScrub` needs. This is Kit-layer data: it has no DOM and no
// rendering. The desktop chrome wires the declarative entries directly from
// here; a second chrome (mobile) reads the same catalog to lay out its own
// controls without re-hand-wiring ranges, steps, and formats.
//
// Two classes of control, deliberately kept distinct:
//
//   declarative === true  — a plain slider whose `opts` are pure data with
//   self-contained fmt/parse. Wired in main.js by looping DECLARATIVE_PARAM_IDS
//   through `wireSliderWithScrub(env, sliderId, valId, key, opts)`.
//
//   declarative === false — a stateful / form-aware control whose behavior
//   reads or cascades into other state (segments form-routing; the arms-aware
//   spiral fmt + snap; the mirror / wedge-mirror / OOB toggles). These keep
//   their bespoke wiring in main.js; the entry here is catalog metadata only
//   so the registry stays a complete description for any chrome to enumerate.
//
// `scope` groups controls semantically: 'slice' (the wedge/source-side
// controls), 'canvas' (composition), 'output' (export-affecting modes).
// `formControl` mirrors the string a form lists in its own `controls: [...]`
// array (see src/engine/forms/*.js); null means the control is universal and
// always present. Visibility gating itself still lives in applyFormControls()
// — this field just records the relationship so the catalog is self-describing.

// shared parsers (kept identical to the former inline literals in main.js)
const parseTimes = (s) => {
  const cleaned = s.replace(/[×x*]/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
};
const parseDegrees = (s) => {
  const cleaned = s.replace(/°/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
};
const parsePlain = (s) => {
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
};

export const PARAMS = {
  // --- form-routed / stateful: catalog-only, bespoke wiring in main.js -------

  // shared DOM element; key routes by form (radial → segments, droste →
  // drosteArms) with form-specific range + snap. See setupSegmentsSlider().
  segments: {
    id: 'segments', label: 'segments', type: 'range', scope: 'slice',
    sliderId: 'segments', valId: 'segVal',
    key: null, dynamicKey: true,
    keysByForm: { radial: 'segments', droste: 'drosteArms' },
    formControl: 'segments', declarative: false,
  },

  // tiers-per-turn; fmt reads drosteArms for p/q display, snap cascades via
  // applyArmsSnap(). See the bespoke wireSliderWithScrub call in main.js.
  spiral: {
    id: 'spiral', label: 'spiral', type: 'range', scope: 'slice',
    sliderId: 'spiral', valId: 'spiralVal', key: 'drosteSpiral',
    formControl: 'spiral', declarative: false,
  },

  mirror: {
    id: 'mirror', label: 'mirror', type: 'toggle', scope: 'slice',
    toggleId: 'mirrorToggle', key: 'drosteMirror',
    formControl: 'mirror', declarative: false,
  },

  // wedge-mirror row is additionally hidden at arms=1 (see syncWedgeMirrorToggle).
  wedgeMirror: {
    id: 'wedgeMirror', label: 'wedge mirror', type: 'toggle', scope: 'slice',
    toggleId: 'wedgeMirrorToggle', key: 'drosteWedgeMirror',
    formControl: 'wedgeMirror', declarative: false,
  },

  // clamp / mirror / transparent — values 0 / 1 / 2 on state.oobMode.
  oobMode: {
    id: 'oobMode', label: 'out of bounds', type: 'enum', scope: 'output',
    groupId: 'oobModes', key: 'oobMode',
    values: [
      { value: 0, label: 'clamp' },
      { value: 1, label: 'mirror' },
      { value: 2, label: 'transparent' },
    ],
    formControl: null, declarative: false,
  },

  // --- declarative sliders: wired straight from `opts` ----------------------

  scale: {
    id: 'scale', label: 'scale', type: 'range', scope: 'slice',
    sliderId: 'scale', valId: 'scaleVal', key: 'sliceScale',
    formControl: null, declarative: true,
    opts: {
      min: 0.05, max: 3, step: 0.005, scrubStep: 0.01,
      fmt: v => v.toFixed(2) + '×',
      parse: parseTimes,
    },
  },

  sliceRot: {
    id: 'sliceRot', label: 'rotation', type: 'range', scope: 'slice',
    sliderId: 'sliceRot', valId: 'sliceRotVal', key: 'sliceRotation',
    formControl: null, declarative: true,
    opts: {
      min: 0, max: 360, step: 0.5, scrubStep: 1,
      fmt: v => v.toFixed(1) + '°',
      parse: parseDegrees,
      wrap: 360,
    },
  },

  aspect: {
    id: 'aspect', label: 'aspect', type: 'range', scope: 'slice',
    sliderId: 'aspect', valId: 'aspectVal', key: 'squareAspect',
    formControl: 'aspect', declarative: true,
    opts: {
      min: 0.25, max: 4, step: 0.01, scrubStep: 0.02,
      fmt: v => v.toFixed(2),
      parse: parsePlain,
    },
  },

  // labeled "thickness" in the UI (outer/inner ratio per tier).
  zoom: {
    id: 'zoom', label: 'thickness', type: 'range', scope: 'slice',
    sliderId: 'zoom', valId: 'zoomVal', key: 'drosteZoom',
    formControl: 'zoom', declarative: true,
    opts: {
      min: 1.1, max: 16, step: 0.05, scrubStep: 0.05,
      fmt: v => v.toFixed(2) + '×',
      parse: parseTimes,
    },
  },

  compZoom: {
    id: 'compZoom', label: 'composition zoom', type: 'range', scope: 'canvas',
    sliderId: 'compZoom', valId: 'compZoomVal', key: 'canvasZoom',
    formControl: null, declarative: true,
    opts: {
      min: 0.15, max: 4, step: 0.01, scrubStep: 0.05,
      fmt: v => v.toFixed(2) + '×',
      parse: parseTimes,
    },
  },

  canvasRot: {
    id: 'canvasRot', label: 'rotation', type: 'range', scope: 'canvas',
    sliderId: 'canvasRot', valId: 'canvasRotVal', key: 'canvasRotation',
    formControl: null, declarative: true,
    opts: {
      min: 0, max: 360, step: 0.5, scrubStep: 1,
      fmt: v => v.toFixed(1) + '°',
      parse: parseDegrees,
      wrap: 360,
    },
  },
};

// The clean sliders the desktop chrome wires by looping over this list. Order
// is irrelevant to behavior (each registers an independent syncer + listeners).
export const DECLARATIVE_PARAM_IDS =
  Object.keys(PARAMS).filter(id => PARAMS[id].declarative);
