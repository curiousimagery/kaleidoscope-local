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
import './mobile/styles.css';   // so mobile component specimens (.m-*) render correctly
// Same CSS as raw source text (Vite ?inline) — parsed for the usage cross-reference
// through a stylesheet we own, which is reliably readable everywhere (document.styleSheets
// introspection was returning nothing depending on how the styles were injected).
import tokensText from './shell/tokens.css?inline';
import stylesText from './shell/styles.css?inline';
import mobileText from './mobile/styles.css?inline';
import { ICONS } from './mobile/icons.js';
import { FORMS } from './engine/forms/index.js';
import { rotateCursorForAngle, scaleCursorForAngle } from './shell/cursors.js';
import { afScaleArrow, afRotationArc } from './shell/overlay.js';

const root = getComputedStyle(document.documentElement);
const val = (name) => root.getPropertyValue(name).trim();

// ---- live usage cross-reference --------------------------------------------
// Scan the loaded stylesheets and build token -> [selectors that consume it].
// Computed from the real CSS (zero maintenance, always accurate). Lab-internal
// selectors (.lab*) are excluded so the Lab doesn't count its own usage. This is
// the CSS half of the cross-reference; JS-referenced icons carry a grepped usage
// map (see ICON_USAGE) — a fuller automatic JS scan would need a build step.
const USAGE = new Map();
function walkRules(rules) {
  for (const rule of rules) {
    if (rule.cssRules) { walkRules(rule.cssRules); continue; }   // @media / @supports
    const sel = rule.selectorText;
    if (!rule.style || !sel || /\.lab/.test(sel)) continue;
    for (let i = 0; i < rule.style.length; i++) {
      const prop = rule.style[i];
      const v = rule.style.getPropertyValue(prop);
      for (const m of v.matchAll(/var\((--[a-z0-9-]+)/gi)) {
        const t = m[1];
        if (!USAGE.has(t)) USAGE.set(t, new Set());
        USAGE.get(t).add(`${sel} · ${prop}`);
      }
    }
  }
}
function buildUsageIndex() {
  // Parse the app CSS source text through a stylesheet we create and own, so
  // cssRules is reliably readable (dev, built http, and file://).
  const tmp = document.createElement('style');
  tmp.textContent = `${tokensText}\n${stylesText}\n${mobileText}`;
  (document.head || document.documentElement).appendChild(tmp);
  try {
    if (tmp.sheet && tmp.sheet.cssRules) walkRules(tmp.sheet.cssRules);
  } catch (e) { /* leave USAGE empty; the banner explains */ }
  tmp.remove();
}
function usageList(name) {
  const s = USAGE.get(name);
  return s ? [...s] : [];
}
// a clickable "n×" badge that toggles an on-demand list of consumers (no inline bloat)
function usageNode(name) {
  const uses = usageList(name);
  const detail = el('div', { class: 'lab-usage', hidden: '' },
    uses.length ? uses.map((u) => el('code', { class: 'lab-usage-row', text: u }))
                : [el('div', { class: 'lab-note', text: 'no consumers found in app CSS' })]);
  const badge = el('button', { class: `lab-usebadge${uses.length ? '' : ' lab-usebadge-zero'}`, text: `${uses.length}×` });
  badge.addEventListener('click', () => { detail.hidden = !detail.hidden; });
  return { badge, detail };
}

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

// A color swatch: the var rendered as a chip + its name + resolved value + usage.
function swatch(name) {
  const u = usageNode(name);
  return el('div', { class: 'lab-swatch' }, [
    el('div', { class: 'lab-chip', style: `background:var(${name})` }),
    el('div', { class: 'lab-meta' }, [
      el('div', { class: 'lab-swatch-head' }, [el('code', { class: 'lab-name', text: name }), u.badge]),
      el('code', { class: 'lab-val', text: val(name) || '—' }),
    ]),
    u.detail,
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
function sampleRow(preview, name) {
  const u = usageNode(name);
  return el('div', {}, [
    el('div', { class: 'lab-row' }, [
      preview,
      el('code', { class: 'lab-name', text: name }),
      el('code', { class: 'lab-val', text: val(name) }),
      u.badge,
    ]),
    u.detail,
  ]);
}
function typeSample(name) {
  return sampleRow(el('span', { class: 'lab-typesample', style: `font-size:var(${name})`, text: 'Fold visual symmetry' }), name);
}
function radiusSample(name) {
  return sampleRow(el('div', { class: 'lab-radiusbox', style: `border-radius:var(${name})` }), name);
}
function spaceSample(name) {
  return sampleRow(el('div', { class: 'lab-spacebar', style: `width:var(${name})` }), name);
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

// Text/unicode glyphs that function AS icons inside buttons (in index.html today —
// placeholders that should become real icons). label = the desired direction.
const BUTTON_GLYPHS = [
  ['←', 'ot-btn', '#undoBtn · undo — wants a looped undo arrow, not a plain ←'],
  ['→', 'ot-btn', '#redoBtn · redo — wants a looped redo arrow'],
  ['⇄', 'ot-btn', '#swapBtn · swap source/output — wants proper swap arrows'],
  ['save ▸', 'ot-btn', '#openExportBtn · the ▸ caret (also clip ▸ / render ▸) = "opens a sheet"'],
  ['＋ keyframe', 'mf-btn mf-add', '#mfAdd · add keyframe (＋ glyph)'],
  ['‹‹', 'mf-btn', '#mfPrev · previous keyframe'],
  ['››', 'mf-btn', '#mfNext · next keyframe'],
];
function glyphCard(glyph, cls, note) {
  return el('div', { class: 'lab-icon' }, [
    el('div', { class: 'lab-icon-previews' }, [el('button', { class: cls, text: glyph })]),
    el('div', { class: 'lab-note lab-icon-usage', text: note }),
  ]);
}

function iconsSection() {
  const glyphs = Object.entries(ICONS).map(([name, svg]) => iconCard(name, svg));
  const thumbs = FORMS.map(formThumbCard);
  const btnGlyphs = BUTTON_GLYPHS.map(([g, c, n]) => glyphCard(g, c, n));
  const appIcon = el('div', { class: 'lab-appicon-card' }, [
    el('div', { class: 'lab-appicon-previews' }, [16, 24, 48, 96].map((s) =>
      el('div', { class: 'lab-appicon-cell' }, [
        el('img', { src: '/fold-icon.svg', width: String(s), height: String(s) }),
        el('code', { class: 'lab-val', text: `${s}px` }),
      ]))),
    el('div', { class: 'lab-appicon-meta' }, [
      el('code', { class: 'lab-name', text: 'public/fold-icon.svg' }),
      el('div', { class: 'lab-note', text: 'The PWA / app icon. GAPS the Lab surfaced: (1) no <link rel="icon"> favicon exists at all; (2) the DMG app icon differs from this mark; (3) at 16px (favicon size) this detailed mark may not read — a simplified favicon variant is likely needed.' }),
    ]),
  ]);

  return section('icons', 'Icons', 'Every glyph on its real surface, with grepped usage and auto-flagged problems (hardcoded fills, off-grid viewBoxes, orphans). The ICONS set is mobile-chrome only — the desktop bar is text/unicode glyphs (below), which is why the responsive icon/overflow pattern is a tracked gap.', [
    el('h3', { class: 'lab-h3', text: 'App glyphs · mobile/icons.js' }),
    el('div', { class: 'lab-grid lab-grid-icon' }, glyphs),
    el('h3', { class: 'lab-h3', text: 'Button glyphs · desktop chrome (unicode placeholders → want real icons)' }),
    el('div', { class: 'lab-grid lab-grid-icon' }, btnGlyphs),
    el('h3', { class: 'lab-h3', text: 'Form thumbnails · engine/forms (idle + active)' }),
    el('div', { class: 'lab-grid lab-grid-icon' }, thumbs),
    el('h3', { class: 'lab-h3', text: 'App icon' }),
    appIcon,
  ]);
}

// ---- CURSOR INVENTORY -------------------------------------------------------
// rotateCursorForAngle returns a CSS cursor: url("data:image/svg+xml;utf8,<svg…>") 16 16, move.
// Extract the SVG so we can render it as an <img> (re-encoded for a valid img src),
// and apply the real cursor string so hovering shows the actual pointer.
function cursorSvg(cssCursor) {
  const m = cssCursor.match(/data:image\/svg\+xml;utf8,(.+?)"\)/);
  return m ? m[1] : '';
}
function rotateCursorTile(theta) {
  const css = rotateCursorForAngle(theta);
  const src = 'data:image/svg+xml,' + encodeURIComponent(cursorSvg(css));
  return el('div', { class: 'lab-cursor', style: `cursor:${css}` }, [
    el('div', { class: 'lab-cursor-stage' }, [el('img', { src, width: '32', height: '32' })]),
    el('code', { class: 'lab-name', text: `${Math.round((theta * 180) / Math.PI)}°` }),
  ]);
}
function scaleCursorTile(name) {
  return el('div', { class: 'lab-cursor', style: `cursor:${name}` }, [
    el('div', { class: 'lab-cursor-stage lab-cursor-hover', text: 'hover' }),
    el('code', { class: 'lab-name', text: name }),
  ]);
}
function cursorsSection() {
  const TAU = Math.PI * 2;
  const rotates = [];
  for (let i = 0; i < 16; i++) rotates.push(rotateCursorTile((i / 16) * TAU));
  const scales = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'].map(scaleCursorTile);
  return section('cursors', 'Cursors', 'Desktop mouse affordances for segment manipulation. The 16 baked rotate variants (shell/cursors.js — CSS can’t rotate a cursor, so they’re pre-generated SVGs) shown as images + live on hover; the 4 scale cursors are standard CSS resize cursors (hover to see). Backlog flags this surface as "inconsistent/sloppy cursors" — this is where we judge + redraw them as a set.', [
    el('h3', { class: 'lab-h3', text: 'Rotate · 16 angle-indexed variants' }),
    el('div', { class: 'lab-grid lab-grid-cursor' }, rotates),
    el('h3', { class: 'lab-h3', text: 'Scale · CSS resize cursors' }),
    el('div', { class: 'lab-grid lab-grid-cursor' }, scales),
  ]);
}

// ---- AFFORDANCE INVENTORY ---------------------------------------------------
// Rendered from the REAL draw primitives exported from shell/overlay.js (no
// divergent reproduction), and IN CONTEXT around a reference slice — the bare
// primitives are illegible in isolation because they only mean something relative
// to the slice they act on (a short rotation arc, a perpendicular scale arrow).
function sliceContextCanvas() {
  const W = 260, H = 190, dpr = 2;
  const canvas = el('canvas', { width: String(W * dpr), height: String(H * dpr), style: `width:${W}px;height:${H}px` });
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const cx = W / 2, cy = H / 2 + 6, s = 34;
  // reference slice (a square) so the affordances read in context
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(cx - s, cy - s, 2 * s, 2 * s);
  // the REAL affordance primitives, positioned like the live overlay does
  afScaleArrow(ctx, cx, cy - s, 0, -1, 0.95, 2);                   // scale · top edge
  afScaleArrow(ctx, cx + s, cy, 1, 0, 0.95, 2);                    // scale · right edge
  afScaleArrow(ctx, cx + s, cy - s, Math.SQRT1_2, -Math.SQRT1_2, 0.95, 2); // scale · corner (diagonal)
  afRotationArc(ctx, cx, cy, -Math.PI / 2, s * 1.414 + 18, 0.95, 2); // rotate · arc above
  ctx.fillStyle = '#fff';                                           // center handle (dot) — move whole slice
  ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
  // Droste center-offset handle: filled blue diamond (from droste.js drawOverlay —
  // fill rgba(170,220,255), r=5). Note: this blue is NOT the --info token (#4aa3ff).
  const dx = cx - 16, dy = cy + 13, dr = 5;
  ctx.fillStyle = 'rgba(170, 220, 255, 1)';
  ctx.beginPath();
  ctx.moveTo(dx, dy - dr); ctx.lineTo(dx + dr, dy); ctx.lineTo(dx, dy + dr); ctx.lineTo(dx - dr, dy);
  ctx.closePath(); ctx.fill();
  return el('div', { class: 'lab-aff' }, [
    el('div', { class: 'lab-aff-stage' }, [canvas]),
    el('code', { class: 'lab-name', text: 'scale arrows (edge + corner) · rotate arc · white center dot (move) · blue Droste offset diamond' }),
  ]);
}
function affordancesSection() {
  return section('affordances', 'Affordances', 'The on-canvas gesture affordances for slice manipulation, drawn from the REAL, ACTIVELY-USED primitives in shell/overlay.js (afScaleArrow / afRotationArc / center dot — 8 call sites; the rotate ARC is distinct from the rotate CURSOR and both ship). Shown around a reference slice because the primitives only read in context. The full touch composite (move / segment-spoke / square-edge / droste-arm handles in drawTouchAffordances) is form-specific and needs a geometry harness to render standalone — a follow-on. Known gaps from BACKLOG to design against here: the LOST Droste rotation handle (want a grippy extending from the circle), a crosshair instead of the dot for the Droste offset, and the min-wedge ~20px clamp where the affordance UI breaks. Also: the Droste offset diamond is drawn in #aadcff, which is OFF-TOKEN (not --info #4aa3ff) — a color to reconcile.', [
    sliceContextCanvas(),
  ]);
}

// ---- control samples (real app classes) -------------------------------------
function labeled(label, node) {
  return el('div', { class: 'lab-ctl' }, [el('code', { class: 'lab-name', text: label }), node]);
}
function btn(label, props = {}) { return el('button', { ...props, text: label }); }
function slider(props = {}) { return el('input', { type: 'range', min: '0', max: '100', value: '40', ...props }); }

// state-matrix cell: a component on a realistic surface + its class label
function stateCell(node, label) {
  return el('div', { class: 'lab-state' }, [
    el('div', { class: 'lab-state-stage' }, [node]),
    el('code', { class: 'lab-name', text: label }),
  ]);
}
function btnEl(cls, text, opts = {}) {
  const p = { text };
  if (cls) p.class = cls;
  if (opts.disabled) p.disabled = '';
  if (opts.id) p.id = opts.id;
  return el('button', p);
}
function matrixRow(family, cells) {
  return el('div', { class: 'lab-matrow' }, [
    el('div', { class: 'lab-matlabel', text: family }),
    el('div', { class: 'lab-matcells' }, cells.map(([lbl, node]) => stateCell(node, lbl))),
  ]);
}

function buttonMatrix() {
  return el('div', { class: 'lab-matrix' }, [
    matrixRow('Neutral · button', [
      ['button', btnEl('', 'Button')],
      ['.primary', btnEl('primary', 'Primary')],
      ['.toggle.active', btnEl('toggle active', 'Toggle on')],
      ['.reset', btnEl('reset', 'Reset')],
      [':disabled', btnEl('', 'Disabled', { disabled: 1 })],
    ]),
    matrixRow('Bar · .ot-btn', [
      ['.ot-btn', btnEl('ot-btn', 'ot-btn')],
      ['.active', btnEl('ot-btn active', 'active')],
      ['.band-open', btnEl('ot-btn band-open', 'band-open')],
      [':disabled', btnEl('ot-btn', 'disabled', { disabled: 1 })],
    ]),
    matrixRow('Motion · .mf-btn', [
      ['.mf-btn', btnEl('mf-btn', 'mf-btn')],
      ['.mf-toggle.active', btnEl('mf-btn mf-toggle active', 'loop on')],
      ['.mf-add', btnEl('mf-btn mf-add', 'add')],
      [':disabled', btnEl('mf-btn', 'disabled', { disabled: 1 })],
    ]),
    matrixRow('Intent (id+class)', [
      ['#recordBtn.rec', btnEl('ot-btn rec', '● rec', { id: 'recordBtn' })],
      ['#broadcastBtn.armed', btnEl('ot-btn armed', '◉ live', { id: 'broadcastBtn' })],
    ]),
    matrixRow('Mobile · .m-seg-btn', [
      ['.m-seg-btn', btnEl('m-seg-btn', 'seg')],
      ['.active', btnEl('m-seg-btn active', 'seg on')],
      [':disabled', btnEl('m-seg-btn', 'seg', { disabled: 1 })],
    ]),
  ]);
}

function menusPair() {
  const mf = el('div', { class: 'mf-menu', style: 'position:static' }, [
    el('button', { text: 'Duplicate keyframe' }),
    el('button', { text: 'Delete keyframe' }),
    el('button', { text: 'Reset workspace' }),
  ]);
  const mm = el('div', { class: 'm-menu', style: 'position:static' }, [
    el('button', { class: 'm-menu-item', html: `<span class="m-menu-icon m-icon-record">${ICONS.record}</span> live camera` }),
    el('button', { class: 'm-menu-item', html: `<span class="m-menu-icon">${ICONS.camera}</span> take still` }),
    el('button', { class: 'm-menu-item current', html: `<span class="m-menu-icon">${ICONS.photo}</span> choose photo / file` }),
  ]);
  return el('div', { class: 'lab-cols' }, [
    el('div', {}, [el('h3', { class: 'lab-h3', text: '.mf-menu · desktop (radius 8, 13px)' }), mf]),
    el('div', {}, [el('h3', { class: 'lab-h3', text: '.m-menu · mobile (radius 12, 15px, bordered items)' }), mm]),
  ]);
}

function componentsSection() {
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
  return section('components', 'Components', 'Real app classes in a state matrix. (:hover/:active are live on hover; the class-based states below are static so collisions are visible at a glance.) NOTE the over-variation this surfaces: SIX distinct "emphasis/selected" treatments — .primary (fill), .toggle.active, .ot-btn.active, .band-open, .mf-toggle.active, .mf-add — several outlined and near-identical, which is why a "loop on" toggle reads like a primary button. And desktop↔mobile button/menu divergence (two menu implementations, different radii/type). These are the reduce-variation + disambiguation targets.', [
    el('h3', { class: 'lab-h3', text: 'Button state matrix' }),
    buttonMatrix(),
    el('h3', { class: 'lab-h3', text: 'Menus · desktop ↔ mobile (divergence)' }),
    menusPair(),
    el('div', { class: 'lab-cols', style: 'margin-top:18px' }, [
      el('div', {}, [el('h3', { class: 'lab-h3', text: 'Sliders' }), sliders]),
      el('div', {}, [el('h3', { class: 'lab-h3', text: 'Fields' }), fields]),
    ]),
  ]);
}

// ---- CLI cheat sheet (the Lab is the one surface where Daniel is the only
// consumer, so dev tooling fits here) ----------------------------------------
const CLI_COMMANDS = [
  { group: 'Develop', items: [
    ['npm run dev', 'start the local dev server, then open the URLs below',
      'Run while you are working. Starts Vite on http://localhost:5173 with hot-reload — edits to src/ appear instantly, no build step. Serves both the app (/) and this Lab (/lab.html) straight from source. Leave it running; Ctrl+C stops it. Writes nothing to disk. (If it says the port is in use, an old dev server is already running — just open that one.)'],
    ['npm run build', 'compile the web app → dist/',
      'Run before packaging a DMG or deploying the website. Bundles src/ into static production files in dist/ (hashed JS/CSS + index.html + lab.html). Does NOT make a DMG by itself. Overwrites dist/ each run; ~1s.'],
    ['npm run preview', 'serve the built dist/ over http to check it',
      'Run after npm run build to view the real production bundle. Serves dist/ on a local http port. Use this (not double-clicking dist files) whenever you need the Lab usage cross-reference — file:// blocks reading the CSS, http does not. Read-only; does not rebuild.'],
    ['npm run check', 'syntax-check every JS file',
      'Run before committing to catch typos fast. Runs node --check across the src JS and prints "all syntax checks pass" or the first error. No output files; does not run the app.'],
  ] },
  { group: 'Electron / DMG  ·  run from the electron/ folder', items: [
    ['cd electron && npm install', 'first-time setup for the desktop build',
      'Run once after cloning, or when the electron deps change. Installs Electron + node-syphon into electron/node_modules; a postinstall hook then patches node-syphon\'s memory leak (swaps in a vendored fixed binary). Required before npm start or npm run dist will work.'],
    ['cd electron && npm start', 'run the desktop app locally (no packaging)',
      'Run to test the Mac app + Syphon output to Arena. Launches Electron loading the ALREADY-BUILT dist/ — so run npm run build first if you changed web code. Opens a window; close it to stop. Fast iteration without making a DMG.'],
    ['cd electron && npm run dist', 'produce the installable DMG',
      'Run to make the shippable installer. Sequence: (1) rebuilds the web app (dist/), (2) packages it with electron-builder, (3) re-applies the leak-fixed node-syphon, (4) names the file from src/version.js. Output: electron/release/Fold Live-<version>-arm64.dmg. NOTE: arm64 (Apple Silicon) only + unsigned, so Gatekeeper warns on first open (right-click → Open). The app icon is currently the DEFAULT Electron icon — we do not ship a custom .icns yet (see BACKLOG).'],
  ] },
  { group: 'Open in the browser', items: [
    ['http://localhost:5173/', 'the app',
      'Open while npm run dev is running to use Fold itself.'],
    ['http://localhost:5173/lab.html', 'this UI Lab',
      'Open while npm run dev (or npm run preview) is running. The usage cross-reference needs this http URL, not a file:// path.'],
  ] },
];
function copyBtn(text) {
  const b = el('button', { class: 'lab-copy', text: 'copy' });
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); b.textContent = 'copied'; }
    catch { b.textContent = 'press ⌘C'; }
    setTimeout(() => { b.textContent = 'copy'; }, 1200);
  });
  return b;
}
function cheatSheetModal() {
  const rows = [];
  for (const { group, items } of CLI_COMMANDS) {
    rows.push(el('div', { class: 'lab-cli-group', text: group }));
    for (const [cmd, note, detail] of items) {
      rows.push(el('div', { class: 'lab-cli-row' }, [
        el('code', { class: 'lab-cli-cmd', text: cmd }),
        copyBtn(cmd),
        el('div', { class: 'lab-cli-note' }, [
          el('div', { class: 'lab-cli-note-short', text: note }),
          detail ? el('div', { class: 'lab-cli-detail', text: detail }) : null,
        ]),
      ]));
    }
  }
  const card = el('div', { class: 'lab-cli-card' }, [
    el('div', { class: 'lab-cli-head' }, [
      el('div', { class: 'lab-h2', text: 'CLI cheat sheet' }),
      el('button', { class: 'lab-cli-x', text: '✕' }),
    ]),
    ...rows,
  ]);
  const modal = el('div', { class: 'lab-cli-modal', hidden: '' }, [el('div', { class: 'lab-cli-backdrop' }), card]);
  const close = () => { modal.hidden = true; };
  card.querySelector('.lab-cli-x').addEventListener('click', close);
  modal.querySelector('.lab-cli-backdrop').addEventListener('click', close);
  return modal;
}
function usageBanner() {
  return el('div', { class: 'lab-banner' }, [
    'Usage cross-reference is empty — the app CSS could not be parsed. This is unexpected (it reads from the bundled source text); worth flagging.',
  ]);
}

// ---- compose the page -------------------------------------------------------
function build() {
  buildUsageIndex();   // scan the loaded CSS so each token can show its consumers
  const content = el('div', { class: 'lab-main' }, [
    el('header', { class: 'lab-header' }, [
      el('h1', { class: 'lab-h1', text: 'Fold · UI Lab' }),
      el('p', { class: 'lab-note', text: 'The design system in isolation, a visual inventory, and a usage instrument. Every value is read live from tokens.css; the n× badge on each token lists where it is actually consumed (click to expand). A 0× badge means an unused token — a candidate to cut.' }),
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
    cursorsSection(),
    affordancesSection(),
    componentsSection(),
  ]);

  // if introspection found nothing (e.g. opened over file://), explain it
  if (USAGE.size === 0) content.insertBefore(usageBanner(), content.children[1]);

  // build the sticky nav from the sections actually present
  const navItems = [...content.querySelectorAll('.lab-section')].map((s) =>
    el('a', { class: 'lab-navlink', href: `#${s.id}`, text: s.querySelector('.lab-h2').textContent }));
  const modal = cheatSheetModal();
  const cliBtn = el('button', { class: 'lab-cli-open', text: '⌘ CLI cheat sheet' });
  cliBtn.addEventListener('click', () => { modal.hidden = false; });
  const nav = el('nav', { class: 'lab-nav' }, [
    el('div', { class: 'lab-nav-title', text: 'Fold · Lab' }),
    ...navItems,
    el('div', { class: 'lab-nav-foot' }, [cliBtn]),
  ]);

  document.body.appendChild(el('div', { class: 'lab' }, [nav, content]));
  document.body.appendChild(modal);
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
  .lab-swatch-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .lab-name { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-secondary); }
  .lab-val { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); }
  /* usage cross-reference */
  .lab-usebadge { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--text-dim); background: var(--surface-control); border: 1px solid var(--border); border-radius: var(--radius-full); padding: 1px 7px; cursor: pointer; flex: none; }
  .lab-usebadge:hover { color: var(--text); border-color: var(--border-hover); }
  .lab-usebadge-zero { color: var(--warn-text); border-color: rgba(232, 200, 112, 0.4); }
  .lab-usage { margin-top: 6px; padding: 8px; background: var(--bg); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); display: flex; flex-direction: column; gap: 2px; }
  .lab-usage-row { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lab-usage[hidden] { display: none; }                 /* class display:flex would otherwise beat [hidden] */
  .lab-row .lab-usebadge { justify-self: start; }       /* don't stretch across the grid track */
  .lab-list { display: flex; flex-direction: column; gap: 2px; }
  .lab-row { display: grid; grid-template-columns: 220px 150px 70px auto; align-items: center; gap: 16px; padding: 4px 0; }
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
  /* cursors + affordances */
  .lab-grid-cursor { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; }
  .lab-cursor, .lab-aff { display: flex; flex-direction: column; gap: 6px; align-items: center; }
  .lab-cursor-stage, .lab-aff-stage { width: 96px; height: 64px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); background: var(--c-neutral-450); }
  .lab-cursor-stage img { display: block; }
  .lab-cursor-hover { font-size: var(--text-xs); color: var(--c-neutral-950); }
  .lab-aff-stage { width: auto; height: auto; padding: 14px; background: var(--c-neutral-500); display: inline-block; }
  /* component state matrix */
  .lab-matrix { display: flex; flex-direction: column; gap: 4px; }
  .lab-matrow { display: grid; grid-template-columns: 150px 1fr; align-items: center; gap: 16px; padding: 8px 0; border-bottom: 1px solid var(--border-subtle); }
  .lab-matlabel { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-dim); }
  .lab-matcells { display: flex; flex-wrap: wrap; gap: 10px; }
  .lab-state { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
  .lab-state-stage { padding: 8px; background: var(--surface); border-radius: var(--radius-sm); display: flex; align-items: center; }
  /* app icon (own full-width row, not the icon grid) */
  .lab-appicon-card { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; padding: 16px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface); }
  .lab-appicon-previews { display: flex; align-items: flex-end; gap: 18px; }
  .lab-appicon-cell { display: flex; flex-direction: column; align-items: center; gap: 4px; color: var(--text); }
  .lab-appicon-meta { flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: 4px; }
  /* file:// usage banner */
  .lab-banner { margin: 16px 0; padding: 10px 14px; border: 1px solid rgba(232, 200, 112, 0.4); background: rgba(232, 200, 112, 0.1); border-radius: var(--radius-md); font-size: var(--text-sm); color: var(--warn-text); line-height: 1.5; }
  .lab-banner code { font-family: var(--font-mono); color: var(--text); }
  /* nav footer + CLI cheat sheet */
  .lab-nav-foot { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-subtle); }
  .lab-cli-open { width: 100%; text-align: left; background: var(--surface-control); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--text-secondary); font-size: var(--text-xs); padding: 8px 10px; cursor: pointer; }
  .lab-cli-open:hover { color: var(--text); border-color: var(--border-hover); }
  .lab-cli-modal[hidden] { display: none; }
  .lab-cli-modal { position: fixed; inset: 0; z-index: 200; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .lab-cli-backdrop { position: absolute; inset: 0; background: rgba(10, 10, 10, 0.6); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
  .lab-cli-card { position: relative; width: 680px; max-width: 100%; max-height: 86vh; overflow: auto; background: var(--surface-raised); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px 20px 20px; }
  .lab-cli-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .lab-cli-x { background: transparent; border: none; color: var(--text-dim); font-size: var(--text-lg); cursor: pointer; }
  .lab-cli-x:hover { color: var(--text-bright); }
  .lab-cli-group { font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); margin: 16px 0 6px; }
  .lab-cli-row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 8px 12px; padding: 6px 0; border-bottom: 1px solid var(--border-subtle); }
  .lab-cli-cmd { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text); overflow: auto; }
  .lab-cli-note { grid-column: 1 / -1; }
  .lab-cli-note-short { font-size: var(--text-xs); color: var(--text-muted); }
  .lab-cli-detail { font-size: var(--text-2xs); color: var(--text-dim); line-height: 1.55; margin-top: 4px; }
  .lab-copy { background: var(--surface-control); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-dim); font-size: var(--text-2xs); font-family: var(--font-mono); padding: 3px 9px; cursor: pointer; }
  .lab-copy:hover { color: var(--text); border-color: var(--border-hover); }
`;
document.head.appendChild(labStyle);

build();
