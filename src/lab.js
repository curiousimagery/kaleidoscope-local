// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// UI Lab — the design system in isolation, AND a visual inventory + usage instrument.
// Imports the tokens and the app styles, then renders every token (resolved live via
// getComputedStyle) plus the icon/cursor/affordance inventory and the core controls.
// This is the shared visual reference Daniel reviews against, and the surface where
// over-variation, sloppy iconography, ambiguous states, and gaps become visible.
//
// No app logic. Reachable at /lab.html in dev and in the built dist/.

import './shell/tokens.css';
import './shell/styles.css';
import { ICONS } from './mobile/icons.js';
import { FORMS } from './engine/forms/index.js';

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

function section(id, title, note, body) {
  return el('section', { class: 'lab-section', id }, [
    el('h2', { class: 'lab-h2', text: title }),
    note ? el('p', { class: 'lab-note', text: note }) : null,
    el('div', { class: 'lab-body' }, body),
  ]);
}

function chip(text, kind) {
  return el('span', { class: `lab-flag lab-flag-${kind || 'info'}`, text });
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

// ---- token catalogs (mirrored from tokens.css) ------------------------------
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
const SEM_TEXT = ['--text', '--text-bright', '--text-secondary', '--text-dim', '--text-muted', '--text-faint', '--fill-bright', '--on-accent'];
const SEM_INTENT = ['--accent', '--ok', '--danger', '--danger-text', '--warn-text', '--info', '--focus'];

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

// ---- ICON INVENTORY ---------------------------------------------------------
// Accurate usage, grepped from the codebase (all ICONS are consumed only by
// mobile/chrome.js today — the desktop bar is text-based).
const ICON_USAGE = {
  plus: 'mobile · source tab (no source)',
  folder: 'mobile · source = file',
  camera: 'mobile · source = still; "take still"',
  record: 'mobile · source = live; "go live" (turns red)',
  captureCam: 'mobile · capture tab / shutter',
  photo: 'mobile · "choose photo / file"',
  aperture: '',   // not referenced anywhere
  download: 'mobile · save tab',
  flip: 'mobile · flip-camera button',
  sliders: 'mobile · source/settings toggle',
  target: 'mobile · settings-active toggle state',
  expand: 'mobile · fit toggle (→ fill)',
  contract: 'mobile · fit toggle (→ cover)',
};

// auto-detect sloppy-iconography problems from the raw SVG markup
function iconIssues(svg) {
  const out = [];
  const hexes = [...new Set([...svg.matchAll(/#[0-9a-f]{3,8}/gi)].map((m) => m[0]))];
  if (hexes.length) out.push(`hardcoded color ${hexes.join(' ')}`);
  const vb = (svg.match(/viewBox="([^"]+)"/) || [])[1];
  if (vb && vb !== '0 0 24 24') out.push(`off-grid viewBox ${vb}`);
  return out;
}

function iconCard(name, svg) {
  const usage = ICON_USAGE[name];
  const issues = iconIssues(svg);
  const flags = [];
  if (usage === '') flags.push(chip('orphan · unused', 'warn'));
  for (const i of issues) flags.push(chip(i, 'warn'));

  return el('div', { class: 'lab-icon' }, [
    // the glyph at design size on the control surface, plus in a real .ot-btn
    el('div', { class: 'lab-icon-previews' }, [
      el('span', { class: 'lab-icon-tile', html: svg }),
      el('button', { class: 'ot-btn lab-icon-btn', html: svg }),
    ]),
    el('code', { class: 'lab-name', text: name }),
    el('div', { class: 'lab-note lab-icon-usage', text: usage || 'not referenced in code' }),
    flags.length ? el('div', { class: 'lab-flags' }, flags) : null,
  ]);
}

function formThumbCard(form) {
  return el('div', { class: 'lab-icon' }, [
    el('div', { class: 'lab-icon-previews' }, [
      el('button', { class: 'form-thumb', html: form.thumbnail }),
      el('button', { class: 'form-thumb active', html: form.thumbnail }),
    ]),
    el('code', { class: 'lab-name', text: form.id }),
    el('div', { class: 'lab-note lab-icon-usage', text: 'desktop + mobile · form picker' }),
  ]);
}

function iconsSection() {
  const glyphs = Object.entries(ICONS).map(([name, svg]) => iconCard(name, svg));
  const thumbs = FORMS.map(formThumbCard);
  const appIcon = el('div', { class: 'lab-icon' }, [
    el('div', { class: 'lab-icon-previews lab-appicon' }, [
      el('img', { src: '/fold-icon.svg', width: '24', height: '24' }),
      el('img', { src: '/fold-icon.svg', width: '48', height: '48' }),
      el('img', { src: '/fold-icon.svg', width: '96', height: '96' }),
    ]),
    el('code', { class: 'lab-name', text: 'fold-icon.svg' }),
    el('div', { class: 'lab-note lab-icon-usage', text: 'app icon / PWA / favicon · a DELIVERABLE, not just a reference' }),
  ]);

  return section('icons', 'Icons', 'Every glyph rendered on its real surface, with grepped usage and auto-flagged problems (hardcoded fills, off-grid viewBoxes, orphans). The ICONS set is mobile-chrome only today — the desktop bar is text, which is why the responsive icon/overflow pattern is a tracked gap.', [
    el('h3', { class: 'lab-h3', text: 'App glyphs · mobile/icons.js' }),
    el('div', { class: 'lab-grid lab-grid-icon' }, glyphs),
    el('h3', { class: 'lab-h3', text: 'Form thumbnails · engine/forms (idle + active)' }),
    el('div', { class: 'lab-grid lab-grid-icon' }, thumbs),
    el('h3', { class: 'lab-h3', text: 'App icon' }),
    el('div', { class: 'lab-grid lab-grid-icon' }, [appIcon]),
  ]);
}

// ---- control samples (real app classes) -------------------------------------
function labeled(label, node) {
  return el('div', { class: 'lab-ctl' }, [el('code', { class: 'lab-name', text: label }), node]);
}
function btn(label, props = {}) { return el('button', { ...props, text: label }); }
function slider(props = {}) { return el('input', { type: 'range', min: '0', max: '100', value: '40', ...props }); }

function controlsSection() {
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
  const sliders = el('div', { class: 'lab-stack' }, [
    labeled('input[type=range]', el('label', { class: 'slider' }, [slider()])),
    labeled('disabled', el('label', { class: 'slider disabled' }, [slider({ disabled: '' })])),
  ]);
  const fields = el('div', { class: 'lab-stack' }, [
    labeled('.scrub', el('span', { class: 'scrub', text: '128' })),
    labeled('.scrub.scrubbing', el('span', { class: 'scrub scrubbing', text: '128' })),
    labeled('.scrub-input', el('input', { class: 'scrub-input', value: '128' })),
    labeled('.text-input', el('input', { class: 'text-input', value: 'Fold' })),
  ]);
  return section('controls', 'Controls', 'Rendered with the real app classes — they consume the live styles. (A full state-matrix component gallery is a planned increment of this arc.)', [
    el('div', { class: 'lab-cols' }, [
      el('div', {}, [el('h3', { class: 'lab-h3', text: 'Buttons' }), buttons]),
      el('div', {}, [el('h3', { class: 'lab-h3', text: 'Sliders' }), sliders]),
      el('div', {}, [el('h3', { class: 'lab-h3', text: 'Fields' }), fields]),
    ]),
  ]);
}

// ---- compose the page -------------------------------------------------------
function build() {
  const content = el('div', { class: 'lab-main' }, [
    el('header', { class: 'lab-header' }, [
      el('h1', { class: 'lab-h1', text: 'Fold · UI Lab' }),
      el('p', { class: 'lab-note', text: 'The design system in isolation, and a visual inventory. Every value is read live from tokens.css — edit a token and watch its swatch and consumers move together.' }),
    ]),
    section('primitives', 'Primitives · neutral ramp', 'Raw palette, dark → light. Post-collapse set (each step ≥6 apart).', [swatchGrid(NEUTRALS)]),
    section('accents', 'Primitives · accents', 'Two record reds (--c-red-600 desktop, --c-red-500 mobile) now both resolve to --danger.', [swatchGrid(ACCENTS)]),
    section('surfaces', 'Semantic · surfaces', 'What CSS consumes for backgrounds. Edit these, not the primitives.', [swatchGrid(SEM_SURFACE)]),
    section('borders', 'Semantic · borders', null, [swatchGrid(SEM_BORDER)]),
    section('text', 'Semantic · text', null, [swatchGrid(SEM_TEXT)]),
    section('intent', 'Semantic · intent', 'Accent / state colors.', [swatchGrid(SEM_INTENT)]),
    section('type', 'Type · size ramp', `Sans: ${val('--font-sans')}`, [el('div', { class: 'lab-list' }, TYPE_RAMP.map(typeSample))]),
    section('radii', 'Radii', null, [el('div', { class: 'lab-list' }, RADII.map(radiusSample))]),
    section('spacing', 'Spacing', null, [el('div', { class: 'lab-list' }, SPACING.map(spaceSample))]),
    iconsSection(),
    controlsSection(),
  ]);

  // build the sticky nav from the sections actually present
  const navItems = [...content.querySelectorAll('.lab-section')].map((s) =>
    el('a', { class: 'lab-navlink', href: `#${s.id}`, text: s.querySelector('.lab-h2').textContent }));
  const nav = el('nav', { class: 'lab-nav' }, [
    el('div', { class: 'lab-nav-title', text: 'Fold · Lab' }),
    ...navItems,
  ]);

  document.body.appendChild(el('div', { class: 'lab' }, [nav, content]));
}

// ---- lab-only layout (NOT part of the design system) ------------------------
const labStyle = document.createElement('style');
labStyle.textContent = `
  body { overflow: auto !important; height: auto !important; display: block !important; user-select: text; }
  .lab { display: flex; align-items: flex-start; gap: 24px; max-width: 1180px; margin: 0 auto; padding: 0 24px; color: var(--text); }
  .lab-nav { position: sticky; top: 0; align-self: flex-start; max-height: 100vh; overflow: auto; width: 150px; flex: none; padding: 24px 0; display: flex; flex-direction: column; gap: 2px; }
  .lab-nav-title { font-size: var(--text-xs); font-family: var(--font-mono); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }
  .lab-navlink { font-size: var(--text-sm); color: var(--text-dim); text-decoration: none; padding: 3px 0; }
  .lab-navlink:hover { color: var(--text); }
  .lab-main { flex: 1; min-width: 0; padding-bottom: 96px; }
  .lab-header { padding: 32px 0 8px; }
  .lab-h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
  .lab-h2 { font-size: var(--text-md); font-weight: 600; color: var(--text); margin-bottom: 4px; text-transform: none; letter-spacing: 0; }
  .lab-h3 { font-size: var(--text-sm); color: var(--text-dim); margin: 18px 0 10px; text-transform: uppercase; letter-spacing: 0.06em; }
  .lab-note { font-size: var(--text-sm); color: var(--text-muted); line-height: 1.5; max-width: 72ch; }
  .lab-section { padding: 20px 0; border-top: 1px solid var(--border-subtle); scroll-margin-top: 16px; }
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
  /* icons */
  .lab-grid-icon { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .lab-icon { display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface); }
  .lab-icon-previews { display: flex; align-items: center; gap: 10px; min-height: 44px; }
  .lab-icon-tile { width: 24px; height: 24px; color: var(--text); display: inline-flex; }
  .lab-icon-tile svg, .lab-icon-btn svg { width: 24px; height: 24px; display: block; }
  .lab-icon-btn { display: inline-flex; align-items: center; justify-content: center; }
  .lab-appicon { align-items: flex-end; }
  .lab-icon-usage { font-size: var(--text-xs); min-height: 2.6em; }
  .lab-flags { display: flex; flex-wrap: wrap; gap: 4px; }
  .lab-flag { font-size: var(--text-2xs); font-family: var(--font-mono); padding: 2px 6px; border-radius: var(--radius-xs); }
  .lab-flag-warn { background: rgba(255, 90, 90, 0.14); color: var(--danger-text); border: 1px solid rgba(255, 90, 90, 0.3); }
  .lab-flag-info { background: var(--surface-control); color: var(--text-dim); }
`;
document.head.appendChild(labStyle);

build();
