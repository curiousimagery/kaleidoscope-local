// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// UI Lab — a static gallery of the design system in isolation. Imports the tokens
// and the app styles, then renders every token (resolved live via getComputedStyle,
// so editing tokens.css updates the swatches AND the printed values) plus the core
// controls in their states. This is the shared visual reference Daniel reviews
// against: change one semantic token and watch every consumer here move together.
//
// No app logic. Reachable at /lab.html in dev and in the built dist/.

import './shell/tokens.css';
import './shell/styles.css';

const root = getComputedStyle(document.documentElement);
const val = (name) => root.getPropertyValue(name).trim();

// ---- tiny DOM helpers -------------------------------------------------------
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function section(title, note, body) {
  return el('section', { class: 'lab-section' }, [
    el('h2', { class: 'lab-h2', text: title }),
    note ? el('p', { class: 'lab-note', text: note }) : null,
    el('div', { class: 'lab-body' }, body),
  ]);
}

// A color swatch: the var rendered as a chip + its name + resolved value.
function swatch(name) {
  return el('div', { class: 'lab-swatch' }, [
    el('div', { class: 'lab-chip', style: `background:var(${name})` }),
    el('div', { class: 'lab-meta' }, [
      el('code', { class: 'lab-name', text: name }),
      el('code', { class: 'lab-val', text: val(name) || '—' }),
    ]),
  ]);
}

function swatchGrid(names) {
  return el('div', { class: 'lab-grid lab-grid-color' }, names.map(swatch));
}

// ---- token catalogs (the editable surface, mirrored from tokens.css) --------
const NEUTRALS = [
  '--c-neutral-950', '--c-neutral-900', '--c-neutral-850',
  '--c-neutral-800', '--c-neutral-750', '--c-neutral-700',
  '--c-neutral-650', '--c-neutral-600', '--c-neutral-550', '--c-neutral-500',
  '--c-neutral-450', '--c-neutral-400', '--c-neutral-350', '--c-neutral-250',
  '--c-neutral-200', '--c-neutral-150', '--c-neutral-100', '--c-neutral-0',
  '--c-black',
];
const ACCENTS = [
  '--c-amber-500', '--c-amber-300', '--c-green-500',
  '--c-red-600', '--c-red-500', '--c-red-400', '--c-blue-500',
];
const SEM_SURFACE = ['--bg', '--surface', '--surface-raised', '--surface-control', '--surface-hover', '--surface-overlay'];
const SEM_BORDER = ['--border', '--border-subtle', '--border-hover', '--border-strong'];
const SEM_TEXT = ['--text', '--text-bright', '--text-secondary', '--text-dim', '--text-muted', '--text-faint'];
const SEM_INTENT = ['--accent', '--ok', '--danger', '--danger-text', '--warn-text', '--info', '--focus', '--on-accent'];

const TYPE_RAMP = ['--text-2xs', '--text-xs', '--text-sm', '--text-base', '--text-md', '--text-lg', '--text-xl'];
const RADII = ['--radius-2xs', '--radius-xs', '--radius-sm', '--radius', '--radius-md', '--radius-lg', '--radius-xl', '--radius-2xl', '--radius-3xl', '--radius-full'];
const SPACING = ['--space-2', '--space-4', '--space-6', '--space-8', '--space-10', '--space-12', '--space-14', '--space-16', '--space-20', '--space-24'];

// ---- non-color token renderers ---------------------------------------------
function typeSample(name) {
  return el('div', { class: 'lab-row' }, [
    el('span', { class: 'lab-typesample', style: `font-size:var(${name})`, text: 'Fold visual symmetry' }),
    el('code', { class: 'lab-name', text: name }),
    el('code', { class: 'lab-val', text: val(name) }),
  ]);
}
function radiusSample(name) {
  return el('div', { class: 'lab-row' }, [
    el('div', { class: 'lab-radiusbox', style: `border-radius:var(${name})` }),
    el('code', { class: 'lab-name', text: name }),
    el('code', { class: 'lab-val', text: val(name) }),
  ]);
}
function spaceSample(name) {
  return el('div', { class: 'lab-row' }, [
    el('div', { class: 'lab-spacebar', style: `width:var(${name})` }),
    el('code', { class: 'lab-name', text: name }),
    el('code', { class: 'lab-val', text: val(name) }),
  ]);
}

// ---- control samples (real app classes, so they consume styles.css live) ----
function labeled(label, node) {
  return el('div', { class: 'lab-ctl' }, [el('code', { class: 'lab-name', text: label }), node]);
}
function btn(label, props = {}) {
  return el('button', { ...props, text: label });
}
function slider(props = {}) {
  return el('input', { type: 'range', min: '0', max: '100', value: '40', ...props });
}

function controlsSection() {
  // Buttons
  const buttons = el('div', { class: 'lab-stack' }, [
    labeled('button (base)', btn('Button')),
    labeled('button.primary', btn('Primary', { class: 'primary' })),
    labeled('button.toggle.active', btn('Toggle on', { class: 'toggle active' })),
    labeled('button.reset', btn('Reset', { class: 'reset' })),
    labeled('button:disabled', btn('Disabled', { disabled: '' })),
    labeled('.ot-btn', btn('ot-btn', { class: 'ot-btn' })),
    labeled('.ot-btn.active', btn('ot-btn active', { class: 'ot-btn active' })),
    labeled('.mf-btn', btn('mf-btn', { class: 'mf-btn' })),
  ]);

  // Slider — default + disabled (touch sizing changes under pointer:coarse)
  const sliders = el('div', { class: 'lab-stack' }, [
    labeled('input[type=range]', el('label', { class: 'slider' }, [slider()])),
    labeled('disabled', el('label', { class: 'slider disabled' }, [slider({ disabled: '' })])),
  ]);

  // Scrub + text input
  const fields = el('div', { class: 'lab-stack' }, [
    labeled('.scrub', el('span', { class: 'scrub', text: '128' })),
    labeled('.scrub.scrubbing', el('span', { class: 'scrub scrubbing', text: '128' })),
    labeled('.scrub-input', el('input', { class: 'scrub-input', value: '128' })),
    labeled('.text-input', el('input', { class: 'text-input', value: 'Fold' })),
  ]);

  // Form thumb (uses an inline SVG with the .stroke convention)
  const thumbSvg = '<svg viewBox="0 0 32 32"><circle class="stroke" cx="16" cy="16" r="11"/></svg>';
  const thumbs = el('div', { class: 'form-grid' }, [
    el('button', { class: 'form-thumb', html: thumbSvg }),
    el('button', { class: 'form-thumb active', html: thumbSvg }),
  ]);

  return section(
    'Controls',
    'Rendered with the real app classes — they consume styles.css live. As the slider / buttons / scrub are standardized onto tokens (Increment 4), this is where parity gets verified.',
    [
      el('div', { class: 'lab-cols' }, [
        el('div', {}, [el('h3', { class: 'lab-h3', text: 'Buttons' }), buttons]),
        el('div', {}, [el('h3', { class: 'lab-h3', text: 'Sliders' }), sliders, el('h3', { class: 'lab-h3', text: 'Form picker' }), labeled('.form-thumb', thumbs)]),
        el('div', {}, [el('h3', { class: 'lab-h3', text: 'Fields' }), fields]),
      ]),
    ],
  );
}

// ---- compose the page -------------------------------------------------------
function build() {
  const lab = el('div', { class: 'lab' }, [
    el('header', { class: 'lab-header' }, [
      el('h1', { class: 'lab-h1', text: 'Fold · UI Lab' }),
      el('p', { class: 'lab-note', text: 'The design system in isolation. Every value is read live from tokens.css — edit a token and watch its swatch and consumers move together.' }),
    ]),

    section('Primitives · neutral ramp', 'Raw palette, dark → light. Faithful to today’s values (a few near-duplicate darks exist — consolidating is a separate, conscious cleanup).', [swatchGrid(NEUTRALS)]),
    section('Primitives · accents', 'Two record reds exist today (--c-red-600 desktop, --c-red-500 mobile) — flagged for unification.', [swatchGrid(ACCENTS)]),

    section('Semantic · surfaces', 'What CSS consumes for backgrounds. Edit these, not the primitives.', [swatchGrid(SEM_SURFACE)]),
    section('Semantic · borders', null, [swatchGrid(SEM_BORDER)]),
    section('Semantic · text', null, [swatchGrid(SEM_TEXT)]),
    section('Semantic · intent', 'Accent / state colors.', [swatchGrid(SEM_INTENT)]),

    section('Type · size ramp', `Sans: ${val('--font-sans')}`, [el('div', { class: 'lab-list' }, TYPE_RAMP.map(typeSample))]),
    section('Radii', null, [el('div', { class: 'lab-list' }, RADII.map(radiusSample))]),
    section('Spacing', null, [el('div', { class: 'lab-list' }, SPACING.map(spaceSample))]),

    controlsSection(),
  ]);

  document.body.appendChild(lab);
}

// ---- lab-only layout (NOT part of the design system) ------------------------
const labStyle = document.createElement('style');
labStyle.textContent = `
  body { overflow: auto !important; height: auto !important; display: block !important; user-select: text; }
  .lab { max-width: 1100px; margin: 0 auto; padding: 32px 24px 96px; color: var(--text); }
  .lab-header { margin-bottom: 32px; }
  .lab-h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
  .lab-h2 { font-size: var(--text-md); font-weight: 600; color: var(--text); margin-bottom: 4px; text-transform: none; letter-spacing: 0; }
  .lab-h3 { font-size: var(--text-sm); color: var(--text-dim); margin: 16px 0 10px; text-transform: uppercase; letter-spacing: 0.06em; }
  .lab-note { font-size: var(--text-sm); color: var(--text-muted); line-height: 1.5; max-width: 70ch; }
  .lab-section { padding: 20px 0; border-top: 1px solid var(--border-subtle); }
  .lab-body { margin-top: 14px; }
  .lab-grid-color { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
  .lab-swatch { display: flex; flex-direction: column; gap: 6px; }
  .lab-chip { height: 56px; border-radius: var(--radius-md); border: 1px solid var(--border); }
  .lab-meta { display: flex; flex-direction: column; gap: 1px; }
  .lab-name { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-secondary); }
  .lab-val { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); }
  .lab-list { display: flex; flex-direction: column; gap: 4px; }
  .lab-row { display: grid; grid-template-columns: 220px 160px 1fr; align-items: center; gap: 16px; padding: 4px 0; }
  .lab-typesample { color: var(--text); white-space: nowrap; }
  .lab-radiusbox { width: 56px; height: 32px; background: var(--surface-control); border: 1px solid var(--border-strong); }
  .lab-spacebar { height: 16px; background: var(--accent); border-radius: var(--radius-xs); }
  .lab-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 32px; }
  .lab-stack { display: flex; flex-direction: column; gap: 14px; align-items: flex-start; }
  .lab-ctl { display: flex; flex-direction: column; gap: 6px; width: 100%; }
`;
document.head.appendChild(labStyle);

build();
