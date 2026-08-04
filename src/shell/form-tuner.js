// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/form-tuner.js
//
// THE PER-FORM NORMALIZATION TUNER — `?tune=forms`. A dev-only panel for dialing the four
// numbers that make the forms comparable to each other, live, against real footage.
//
// WHY THIS EXISTS AT ALL. The four values below are the whole of "form slice hardening", and the
// mechanisms for all of them shipped long ago (sizeNorm B477, triangle canvasNorm B483, the zoom
// bounds B462/B509). What never shipped was a way to CHOOSE the values: they are perceptual
// judgements only Daniel can make, and every candidate cost a rebuild, which is exactly why they
// sat at first-pass guesses for thirty builds. So the useful thing to build is not better guesses,
// it is the affordance that makes tuning cost seconds instead of a build.
//
// WHY A URL FLAG AND NOT THE LAB. The Lab is a UI inventory — no engine, no source, no forms
// rendering — so tuning perceptual scale there means judging numbers with nothing to look at. You
// need the real app, real footage and the real forms. And a URL flag needs no cleanup later: it is
// unreachable without the flag, unlike a diagnostics row that eventually has to be stripped.
//
// HOW IT APPLIES. It MUTATES the form objects in the registry directly. Every consumer already
// reads through `formSizeNorm` / `formCanvasNorm` / `formZoomBounds`, so a write lands on the
// shader, the overlay geometry and the sharpness hint at once with no plumbing and no second
// source of truth to drift. Nothing is persisted: reload and you are back to the committed values,
// which is the right default for a tuner (you cannot accidentally leave the app in a tuned state).
// `copy` emits a paste-ready block of everything you changed, which is how values get committed.

import { FORMS, getActiveForm } from '../engine/forms/index.js';

// key, label, [min, max, step], default when a form declares nothing, and what you are judging.
const FIELDS = [
  ['sizeNorm', 'size norm', [0.2, 4, 0.05], 1,
    'scales the SLICE sample. Target: sliceScale 1.0 samples a comparable amount of source on every form.'],
  ['canvasNorm', 'canvas norm', [0.2, 4, 0.05], 1,
    'redefines what canvasZoom 1× MEANS for this form. Target: a form does not open absurdly dense or sparse at 1×.'],
  ['zoomCover', 'zoom cover', [1, 6, 0.1], 3,
    'how far a zoom-OUT may grow the slice once the canvas hits its wall. Target: it stops right about where the slice covers the source. Too low re-creates the zoom trap; too high lets the slice get unwieldy.'],
  ['zoomInFloor', 'zoom-in floor', [0.1, 1.5, 0.05], 0.7,
    'how far a zoom-IN may shrink the slice once the canvas hits its wall. Target: the canvas stops before it starts doing the slice control\'s job.'],
];

export function mountFormTuner(env) {
  if (typeof window === 'undefined') return;
  if (new URLSearchParams(location.search).get('tune') !== 'forms') return;

  const { state } = env;
  const panel = document.createElement('div');
  panel.id = 'formTuner';
  panel.innerHTML = `<style>
    #formTuner { position: fixed; right: 12px; bottom: 12px; z-index: 99998; width: 300px;
      background: var(--surface-panel, #141414); border: 1px solid var(--border, #333);
      border-radius: var(--radius-md, 8px); padding: 10px 12px; font-size: 11px;
      color: var(--text-secondary, #bbb); font-family: var(--font-ui, system-ui);
      box-shadow: 0 8px 24px rgba(0,0,0,.5); }
    #formTuner.min > *:not(.ft-head) { display: none; }
    #formTuner .ft-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    #formTuner .ft-title { font-weight: 600; color: var(--text, #eee); }
    #formTuner .ft-form { margin-left: auto; color: var(--text-dim, #888); }
    #formTuner button { background: var(--surface-control, #1e1e1e); color: inherit; cursor: pointer;
      border: 1px solid var(--border, #333); border-radius: 4px; font-size: 10px; padding: 3px 7px; }
    #formTuner button:hover { color: var(--text, #eee); }
    #formTuner .ft-row { margin: 7px 0; }
    #formTuner .ft-lab { display: flex; gap: 6px; align-items: baseline; }
    #formTuner .ft-val { margin-left: auto; font-variant-numeric: tabular-nums; color: var(--text, #eee); }
    #formTuner .ft-val.dirty { color: var(--accent, #7ab8ff); }
    #formTuner input[type=range] { width: 100%; margin: 2px 0 0; }
    #formTuner .ft-why { color: var(--text-faint, #666); line-height: 1.35; margin-top: 2px; }
    #formTuner .ft-foot { display: flex; gap: 6px; margin-top: 10px; }
    #formTuner textarea { width: 100%; height: 90px; margin-top: 8px; font-family: var(--font-mono, monospace);
      font-size: 10px; background: #0d0d0d; color: #ddd; border: 1px solid var(--border, #333); border-radius: 4px; }
  </style>`;

  const head = document.createElement('div');
  head.className = 'ft-head';
  const title = document.createElement('span');
  title.className = 'ft-title'; title.textContent = 'form tuner';
  const formLbl = document.createElement('span');
  formLbl.className = 'ft-form';
  const minBtn = document.createElement('button');
  minBtn.textContent = '–';
  minBtn.addEventListener('click', () => {
    panel.classList.toggle('min');
    minBtn.textContent = panel.classList.contains('min') ? '+' : '–';
  });
  head.append(title, formLbl, minBtn);
  panel.appendChild(head);

  const rows = FIELDS.map(([key, label, [min, max, step], dflt, why]) => {
    const row = document.createElement('div'); row.className = 'ft-row';
    const lab = document.createElement('div'); lab.className = 'ft-lab';
    const name = document.createElement('span'); name.textContent = label;
    const val = document.createElement('span'); val.className = 'ft-val';
    lab.append(name, val);
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = min; slider.max = max; slider.step = step;
    const whyEl = document.createElement('div'); whyEl.className = 'ft-why'; whyEl.textContent = why;
    slider.addEventListener('input', () => {
      const form = getActiveForm(state);
      form[key] = parseFloat(slider.value);
      // every consumer reads through the accessors, so one write reaches the shader, the overlay
      // geometry and the sharpness hint together
      env.scheduleRender?.();
      env.scheduleOverlayDraw?.();
      env.syncControls?.();
      sync();
    });
    row.append(lab, slider, whyEl);
    panel.appendChild(row);
    return { key, dflt, slider, val };
  });

  const foot = document.createElement('div'); foot.className = 'ft-foot';
  const copyBtn = document.createElement('button'); copyBtn.textContent = 'copy all values';
  const resetBtn = document.createElement('button'); resetBtn.textContent = 'revert this form';
  const out = document.createElement('textarea');
  out.readOnly = true; out.hidden = true;
  foot.append(copyBtn, resetBtn);
  panel.append(foot, out);

  // Emit ONLY what differs from the default, per form, as declarations you can paste straight into
  // the form files. Printing every value would bury the two you changed in twenty you did not.
  function emit() {
    const blocks = [];
    for (const form of FORMS) {
      const lines = FIELDS
        .filter(([key, , , dflt]) => (form[key] ?? dflt) !== dflt)
        .map(([key, , , dflt]) => `  ${key}: ${round(form[key] ?? dflt)},`);
      if (lines.length) blocks.push(`// ${form.id}.js\n${lines.join('\n')}`);
    }
    return blocks.length ? blocks.join('\n\n') : '// nothing changed from the committed defaults';
  }
  const round = (n) => Math.round(n * 1000) / 1000;

  copyBtn.addEventListener('click', async () => {
    const text = emit();
    out.value = text; out.hidden = false; out.select();
    try { await navigator.clipboard.writeText(text); copyBtn.textContent = 'copied'; }
    catch { copyBtn.textContent = 'press ⌘C'; }
    setTimeout(() => { copyBtn.textContent = 'copy all values'; }, 1400);
  });

  // Snapshot what the FORM FILES declare, taken before anything is touched. Reset has to restore
  // these rather than delete the properties: deleting would drop hex back to sizeNorm 1 rather than
  // its committed 1.6, which reads as "1.6 was never there" mid-session and is exactly the kind of
  // thing that would send a tuning pass chasing a phantom.
  const ORIGINALS = new Map(FORMS.map((f) => [f.id, Object.fromEntries(FIELDS.map(([k]) => [k, f[k]]))]));

  resetBtn.addEventListener('click', () => {
    const form = getActiveForm(state);
    const orig = ORIGINALS.get(form.id) || {};
    for (const [key] of FIELDS) {
      if (orig[key] === undefined) delete form[key]; else form[key] = orig[key];
    }
    env.scheduleRender?.(); env.scheduleOverlayDraw?.(); env.syncControls?.();
    sync();
  });

  function sync() {
    const form = getActiveForm(state);
    formLbl.textContent = form.id;
    for (const r of rows) {
      const v = form[r.key] ?? r.dflt;
      r.slider.value = v;
      r.val.textContent = round(v);
      // highlight what you have CHANGED this session (vs what the form file declares), which is
      // exactly the set "copy all values" is asking you to review — not merely "differs from 1"
      const committed = (ORIGINALS.get(form.id) || {})[r.key] ?? r.dflt;
      r.val.classList.toggle('dirty', v !== committed);
    }
    if (!out.hidden) out.value = emit();
  }

  document.body.appendChild(panel);
  sync();
  env.formTunerSync = sync;   // a form switch re-points the panel at the new form
  console.info('[fold] form tuner active (?tune=forms) — values are NOT persisted; use "copy all values" to commit them');
  return { sync };
}
