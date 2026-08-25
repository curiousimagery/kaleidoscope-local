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
// Same CSS as raw source TEXT (Vite ?raw = the verbatim file, identical to what Node
// reads) — parsed as a string for the usage cross-reference, with NO dependency on the
// browser CSSOM (document.styleSheets / .sheet.cssRules was returning nothing). The parser
// is validated in Node against these same files (scripts can't run, but see the build notes).
import tokensText from './shell/tokens.css?raw';
import stylesText from './shell/styles.css?raw';
import mobileText from './mobile/styles.css?raw';
import { ICONS } from './mobile/icons.js';
import { FORMS } from './engine/forms/index.js';
import { rotateCursorForAngle, scaleCursorForAngle } from './shell/cursors.js';
import { afScaleArrow, afRotationArc } from './shell/overlay.js';
import { discoverTokens, groupTokens } from './lab-tokens.js';
import { SAVE_TOAST_CSS } from './shell/save-flow.js';
import { LOCK_ICON } from './shell/locks.js';

const root = getComputedStyle(document.documentElement);
const val = (name) => root.getPropertyValue(name).trim();

// ---- live usage cross-reference --------------------------------------------
// Scan the loaded stylesheets and build token -> [selectors that consume it].
// Computed from the real CSS (zero maintenance, always accurate). Lab-internal
// selectors (.lab*) are excluded so the Lab doesn't count its own usage. This is
// the CSS half of the cross-reference; JS-referenced icons carry a grepped usage
// map (see ICON_USAGE) — a fuller automatic JS scan would need a build step.
const USAGE = new Map();
// Pure-string CSS parser — no CSSOM. Extracts innermost `selector { decls }` rules
// (the /[^{}]+{[^{}]*}/ pattern skips @media wrappers and matches the rule INSIDE them),
// then for each declaration records which token it consumes. Same code path runs in
// Node, so it's validatable without a browser. Exported for the Node test.
function parseUsage(cssText, usage = new Map()) {
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, '');   // strip comments
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(css)) !== null) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    if (!sel || sel.startsWith('@') || /\.lab/.test(sel)) continue;
    for (const decl of m[2].split(';')) {
      const ci = decl.indexOf(':');
      if (ci < 0) continue;
      const prop = decl.slice(0, ci).trim();
      const value = decl.slice(ci + 1);
      for (const vm of value.matchAll(/var\((--[a-z0-9-]+)/gi)) {
        const t = vm[1];
        if (!usage.has(t)) usage.set(t, new Set());
        usage.get(t).add(`${sel} · ${prop}`);
      }
    }
  }
  return usage;
}
function buildUsageIndex() {
  parseUsage(`${tokensText}\n${stylesText}\n${mobileText}`, USAGE);
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
// Token catalogs are no longer hand-listed — they're auto-discovered from tokens.css at build
// time (see lab-tokens.js: discoverTokens + groupTokens + TOKEN_GROUPS). A new token in
// tokens.css appears on its own; anything no group claims lands in the "unfiled" drift bucket.

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
function fontSample(name) {
  return sampleRow(el('span', { class: 'lab-typesample', style: `font-family:var(${name})`, text: 'Fold visual symmetry' }), name);
}
function plainSample(name) {
  // control/state tokens (durations, opacities, hit size, focus ring) — no single visual; the
  // value + usage columns carry it. A neutral chip keeps the row aligned with the others.
  return sampleRow(el('span', { class: 'lab-plainchip' }), name);
}

// ---- auto-discovered token sections ----------------------------------------
// Each TOKEN_GROUPS group renders with its declared `render` kind; the discovery + assignment is
// the Node-tested logic in lab-tokens.js. Empty groups are skipped; the unfiled bucket only shows
// when something drifted (a token no rule claimed).
const TOKEN_RENDERERS = { swatch, type: typeSample, radius: radiusSample, space: spaceSample, font: fontSample, plain: plainSample };
function tokenSection(g) {
  const render = TOKEN_RENDERERS[g.render] || plainSample;
  const body = g.render === 'swatch'
    ? el('div', { class: 'lab-grid lab-grid-color' }, g.tokens.map(render))
    : el('div', { class: 'lab-list' }, g.tokens.map(render));
  return section(g.id, g.title, g.note, [body]);
}
function unfiledSection(names) {
  return section('unfiled', `Unfiled tokens (${names.length})`,
    'Tokens no group rule claimed — they still render + count usage here, but file them into a TOKEN_GROUPS rule in lab-tokens.js (or rename) so they land in the right place. This is the drift flag; it should normally be empty.',
    [el('div', { class: 'lab-list' }, names.map((n) => sampleRow(el('span', { class: 'lab-flag lab-flag-warn', text: 'unfiled' }), n)))]);
}

// ---- ICON INVENTORY ---------------------------------------------------------
// Accurate usage, grepped from the codebase (all ICONS are consumed only by
// mobile/chrome.js today — the desktop bar is text-based).
const ICON_USAGE = {
  plus: 'mobile · source tab (no source)',
  folder: 'mobile · source = file',
  camera: 'mobile · source = still; "take still"',
  record: 'mobile · source = live; "go live" (turns red)',
  captureCam: '',   // now UNUSED (capture/freeze switched to the stop icon, Build 222)
  pause: 'mobile · record/pause live toggle (pause = frozen still; replaced the stop square)',
  photo: 'mobile · "choose photo / file"',
  download: 'mobile · save tab',
  flip: 'mobile · flip-camera button',
  sliders: 'mobile · source/settings toggle',
  target: 'mobile · settings-active toggle state',
  expand: 'mobile + desktop · fit toggle (→ fill; desktop source panel since Build 246)',
  contract: 'mobile + desktop · fit toggle (→ cover)',
  undo: 'desktop · undo button (replaced unicode ←, Build 221)',
  redo: 'desktop · redo button (replaced unicode →, Build 221)',
  swap: 'desktop · swap source/output (replaced unicode ⇄, Build 221)',
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
      el('button', { class: 'ot-btn ot-icon lab-icon-btn', html: svg }),
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
  // undo / redo / swap are now real SVG icons (Build 221) — see the App-glyphs grid above.
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
  const appIconCard = (src, sizes, name, note) => el('div', { class: 'lab-appicon-card' }, [
    el('div', { class: 'lab-appicon-previews' }, sizes.map((s) =>
      el('div', { class: 'lab-appicon-cell' }, [
        el('img', { src, width: String(s), height: String(s) }),
        el('code', { class: 'lab-val', text: `${s}px` }),
      ]))),
    el('div', { class: 'lab-appicon-meta' }, [
      el('code', { class: 'lab-name', text: name }),
      el('div', { class: 'lab-note', text: note }),
    ]),
  ]);
  const appIcons = el('div', { class: 'lab-stack', style: 'width:100%;gap:12px' }, [
    appIconCard('/fold-icon.svg', [16, 24, 48, 96], 'public/fold-icon.svg', 'PWA / installed app / apple-touch-icon. The full mark.'),
    appIconCard('/favicon.svg', [16, 24, 32], 'public/favicon.svg', 'Browser-tab favicon (own home; = the mark for now). At 16px this detailed mark may not read — drop a SIMPLIFIED variant here.'),
    appIconCard('/fold-icon.svg', [32, 64, 128], 'electron/build/icon.png', 'macOS DMG / app icon — now wired into npm run dist (electron-builder mac.icon). Shown via the shared mark (the .png is not web-served). Drop your Apple Icon Composer 1024px PNG or .icns here to replace; usually wants a background/treatment.'),
  ]);

  return section('icons', 'Icons', 'Every glyph on its real surface, with grepped usage and auto-flagged problems (hardcoded fills, off-grid viewBoxes, orphans). The ICONS set is mobile-chrome only — the desktop bar is text/unicode glyphs (below), which is why the responsive icon/overflow pattern is a tracked gap.', [
    el('h3', { class: 'lab-h3', text: 'App glyphs · mobile/icons.js' }),
    el('div', { class: 'lab-grid lab-grid-icon' }, glyphs),
    el('h3', { class: 'lab-h3', text: 'Button glyphs · desktop chrome (unicode placeholders → want real icons)' }),
    el('div', { class: 'lab-grid lab-grid-icon' }, btnGlyphs),
    el('h3', { class: 'lab-h3', text: 'Form thumbnails · engine/forms (idle + active)' }),
    el('div', { class: 'lab-grid lab-grid-icon' }, thumbs),
    el('h3', { class: 'lab-h3', text: 'App icons · PWA / favicon / DMG (separate homes, shared mark for now)' }),
    appIcons,
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
function scaleCursorTile(theta, label) {
  const css = scaleCursorForAngle(theta);
  const src = 'data:image/svg+xml,' + encodeURIComponent(cursorSvg(css));
  return el('div', { class: 'lab-cursor', style: `cursor:${css}` }, [
    el('div', { class: 'lab-cursor-stage' }, [el('img', { src, width: '32', height: '32' })]),
    el('code', { class: 'lab-name', text: label }),
  ]);
}
function cursorsSection() {
  const TAU = Math.PI * 2;
  const rotates = [];
  for (let i = 0; i < 16; i++) rotates.push(rotateCursorTile((i / 16) * TAU));
  const scales = [[0, '↔ ew'], [Math.PI / 4, '⤡ nwse'], [Math.PI / 2, '↕ ns'], [3 * Math.PI / 4, '⤢ nesw']].map(([t, l]) => scaleCursorTile(t, l));
  return section('cursors', 'Cursors', 'Desktop mouse affordances for segment manipulation, all in ONE normalized style (Build 226): a thin BLACK outline with a WHITE line on top, 32px, matched stroke weight. Rotate = a rotation arc with tangent arrowheads (the design from Daniel’s art, drawn in our stroked style at normal size); scale = a matching double-arrow (replaced the OS resize cursors). Shown as images + live on hover. Sanity-check the rotate orientation on screen.', [
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
  // Droste center-offset handle: filled diamond (from droste.js drawOverlay, r=5),
  // now WHITE (was light-blue #aadcff) — distinct from the center dot by shape.
  const dx = cx - 16, dy = cy + 13, dr = 5;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(dx, dy - dr); ctx.lineTo(dx + dr, dy); ctx.lineTo(dx, dy + dr); ctx.lineTo(dx - dr, dy);
  ctx.closePath(); ctx.fill();
  return el('div', { class: 'lab-aff' }, [
    el('div', { class: 'lab-aff-stage' }, [canvas]),
    el('code', { class: 'lab-name', text: 'scale arrows (edge + corner) · rotate arc · white center dot (move) · blue Droste offset diamond' }),
  ]);
}
function affordancesSection() {
  return section('affordances', 'Affordances', 'The on-canvas gesture affordances for slice manipulation, drawn from the REAL, ACTIVELY-USED primitives in shell/overlay.js (afScaleArrow / afRotationArc / center dot — 8 call sites; the rotate ARC is distinct from the rotate CURSOR and both ship). Shown around a reference slice because the primitives only read in context. The full touch composite (move / segment-spoke / square-edge / droste-arm handles in drawTouchAffordances) is form-specific and needs a geometry harness to render standalone — a follow-on. Known gaps from BACKLOG to design against here: the LOST Droste rotation handle (want a grippy extending from the circle), a crosshair instead of the dot for the Droste offset, and the min-wedge ~20px clamp where the affordance UI breaks. (The Droste offset diamond was off-token light-blue #aadcff — now unified to white, Build 219.)', [
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
// two-line segmented button specimen (.m-seg-btn.two-line), matching buildCamSeg's
// stacked variant: a primary label over a small descriptor line.
function twoLineSeg(label, sub, active) {
  const b = el('button', { class: 'm-seg-btn two-line' + (active ? ' active' : '') });
  b.innerHTML = `<span class="m-seg-main">${label}</span><span class="m-seg-sub">${sub}</span>`;
  return b;
}
// icon+text specimen (.ot-icontext): glyph svg string + label, matching how
// updateCameraUI composes the real record/pause toggle.
function iconTextBtn(glyphSvg, label) {
  const b = el('button', { class: 'ot-btn ot-icontext' });
  b.innerHTML = glyphSvg + label;
  return b;
}
// icon-only specimen (.ot-btn.ot-icon): the app-bar gear pattern
function iconOnlyBtn(glyphSvg) {
  const b = el('button', { class: 'ot-btn ot-icon' });
  b.innerHTML = glyphSvg;
  return b;
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
    // B587, restyled B588: marks the FULL-QUALITY tier for the current job among the output
    // resolutions. A star, not a dot, and not green — green is the live/broadcasting/online signal
    // everywhere else in this app and reads as a state this is not (Daniel).
    matrixRow('Toggle · .is-native (full-quality tier for the job)', [
      ['.toggle.is-native', btnEl('toggle is-native', '4K')],
      ['+ .active', btnEl('toggle is-native active', '4K')],
      ['+ :disabled', btnEl('toggle is-native', '4K', { disabled: 1 })],
      ['(plain, for contrast)', btnEl('toggle', 'QHD')],
    ]),
    matrixRow('Bar · .ot-btn', [
      ['.ot-btn', btnEl('ot-btn', 'ot-btn')],
      ['.active', btnEl('ot-btn active', 'active')],
      ['.band-open', btnEl('ot-btn band-open', 'band-open')],
      [':disabled', btnEl('ot-btn', 'disabled', { disabled: 1 })],
      // icon-ONLY variant (first consumer: the settings gear): a 40px square
      // with the glyph flex-centered — padding hacks under min-width left the
      // block svg lopsided (8px left / 12px right on the gear, Build 290 fix).
      ['.ot-icon', iconOnlyBtn('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></svg>')],
    ]),
    // the standard ICON+TEXT pattern (first consumer: the camera record/pause
    // toggle): a compact 12px glyph carries the state color, text stays neutral.
    matrixRow('Icon+text · .ot-icontext', [
      ['record (frozen)', iconTextBtn('<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="var(--danger)"/></svg>', 'record')],
      ['pause (live)', iconTextBtn('<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1.5" width="3" height="9" rx="1" fill="currentColor"/><rect x="7" y="1.5" width="3" height="9" rx="1" fill="currentColor"/></svg>', 'pause')],
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
    // two-line variant: a primary label + a small descriptor (the still-capture
    // resolution/quality toggle — "12MP / fast capture" vs "49MP / deep fusion")
    matrixRow('Mobile · .m-seg-btn.two-line', [
      ['.two-line', twoLineSeg('12MP', 'fast capture', false)],
      ['.two-line.active', twoLineSeg('49MP', 'deep fusion', true)],
    ]),
    // mobile icon-only recipe (.m-icon-btn = the .ot-icon counterpart; the
    // class centers, the chrome is per-consumer — shown with #m-flip's)
    matrixRow('Mobile · .m-icon-btn', [
      ['.m-icon-btn (#m-flip chrome)', (() => {
        const b = el('button', { class: 'm-icon-btn', style: 'width:40px;height:40px;border-radius:var(--radius-lg);border:1px solid var(--border);background:rgba(20,20,20,0.85);color:var(--text)' });
        b.innerHTML = ICONS.flip;
        return b;
      })()],
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

// The save-flow toast (shell/save-flow.js) — every file the app writes speaks
// through it, both chromes. Rendered here from the REAL exported CSS, statically
// pinned (in the app it's fixed above the tab bar / bottom edge). States per
// Daniel's field notes: quiet under 400ms; busy while a real write runs; ✓
// success (neutral border, glyph carries the verdict); ✕ failure with RETRY.
function saveToastSection() {
  if (!document.getElementById('lab-save-toast-css')) {
    const s = document.createElement('style');
    s.id = 'lab-save-toast-css';
    s.textContent = SAVE_TOAST_CSS;
    document.head.appendChild(s);
  }
  // `position:static` for the specimen, but the sweep bar is absolutely positioned inside the
  // pill — so the pin has to keep a containing block or the bar escapes to the page.
  const pin = 'position:relative;transform:none;display:flex;pointer-events:auto';
  const sample = (kind, glyph, text, retry) => el('div', { class: `save-toast on ${kind}`, style: pin }, [
    ...(glyph ? [el('span', { class: 'save-toast-glyph', text: glyph })] : []),
    el('span', { class: 'save-toast-label', text }),
    ...(retry ? [el('button', { text: 'retry' })] : []),
    el('div', { class: 'save-toast-bar' }),
  ]);
  return section('save-toast', 'Save toast', 'The one save-status surface (shell/save-flow.js, exported CSS — these are the real classes). Silent for instant saves (400ms grace); "saving…" only during real waits (the iPad chunked share-sheet write, zip composition); success names the destination; failure is persistent with RETRY. Positions fixed bottom-center, above the mobile tab bar. BUSY carries an indeterminate sweep (B559) — the share-sheet write has no honest denominator, so it says working rather than inventing a percentage.', [
    el('div', { class: 'lab-stack' }, [
      labeled('busy (saving…) — indeterminate sweep', sample('busy', null, 'saving fold-take-20260717.mp4…', false)),
      labeled('success', sample('ok', '✓', 'saved to Downloads ✓ fold-take-20260717.mp4', false)),
      labeled('failure + retry', sample('fail', '✕', 'save failed — fold-take-20260717.mp4', true)),
    ]),
  ]);
}

function componentsSection() {
  const sliders = el('div', { class: 'lab-stack' }, [
    labeled('input[type=range]', el('label', { class: 'slider' }, [slider()])),
    labeled('disabled', el('label', { class: 'slider disabled' }, [slider({ disabled: '' })])),
    // No new component/CSS — the LOOPING variant (droste infinite zoom) is the same .slider
    // driven by wireLoopingSlider: a RELATIVE wrapping drag so the thumb circles far-right →
    // far-left at the repeat point (a native range pins at the edges; static can't show it).
    labeled('.slider · looping (jog) variant', el('label', { class: 'slider' }, [slider({ value: '55' })])),
    // MIC INPUT GAIN (B562) — no new control type, just the .slider composed with a bare panel
    // button and a tabular readout. In the Lab because the READOUT is the load-bearing part: two
    // automatic-calibration attempts failed invisibly, and showing the raw mic level beside the
    // gain is what made the third attempt diagnosable. Pattern worth reusing: when an automatic
    // decision can be wrong, show the input it decided from.
    labeled('.op-gain · mic input gain (output panel)', el('div', { class: 'output-pop' }, [
      el('div', { class: 'op-row op-gain' }, [
        el('span', { class: 'op-meter-lab', text: 'gain' }),
        el('label', { class: 'slider' }, [slider({ value: '12', min: '1', max: '32' })]),
        el('button', { type: 'button', text: 'auto' }),
        el('span', { class: 'op-gain-read', text: '12.0× · raw 0.031' }),
      ]),
    ])),
    // GOVERNOR NOTICE (B568) — not a new component. The governor speaks through the save toast,
    // because the alternative is inventing a second status surface for the same job, which is the
    // scattered-status problem the audit exists to fix. Specimened here so the wording lives
    // somewhere reviewable: it always names the REASON, never just the fact.
    labeled('governor degrade notice (uses .save-toast busy)', el('div', { class: 'save-toast on busy', style: 'position:relative;transform:none;display:flex;pointer-events:auto' }, [
      el('span', { class: 'save-toast-label', text: 'preview at 75% — giving the broadcast the headroom (34% under 30fps)' }),
      el('div', { class: 'save-toast-bar' }),
    ])),
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
    el('h3', { class: 'lab-h3', text: 'Pan joystick · .pan-joy (canvas translation — velocity; DRIFT toggle latches motion on release; canvas-proportional dot field may exceed the circle). Two forms: tiling/radial pan ("pan", .drifting glow) and the droste center-offset variant (no label; .disabled while `manual` is off or an animation drives the state).' }),
    el('div', { class: 'lab-row' }, [
      el('div', { class: 'pan-joy-row', style: 'max-width:170px' }, [
        el('div', { class: 'row' }, [el('span', { class: 't-label', text: 'pan' }), el('span', { class: 'pan-joy-btns' }, [
          el('button', { class: 'pan-joy-drift active', text: 'drift' }),
          el('button', { class: 'pan-joy-recenter', text: 'recenter' }),
        ])]),
        el('div', { class: 'pan-joy drifting' }, [
          el('div', { class: 'pan-joy-rect', style: 'width:124px;height:90px' }),
          el('div', { class: 'pan-joy-origin' }),
          el('div', { class: 'pan-joy-dot', style: 'transform: translate(48px, -30px)' }),
          el('div', { class: 'pan-joy-handle', style: 'transform: translate(14px, 9px)' }),
        ]),
      ]),
      el('div', { class: 'pan-joy-row disabled', style: 'max-width:170px' }, [
        el('div', { class: 'row' }, [el('span', {}), el('span', { class: 'pan-joy-btns' }, [
          el('button', { class: 'pan-joy-drift', text: 'drift' }),
          el('button', { class: 'pan-joy-recenter', text: 'recenter' }),
        ])]),
        el('div', { class: 'pan-joy' }, [
          el('div', { class: 'pan-joy-rect', style: 'width:124px;height:90px' }),
          el('div', { class: 'pan-joy-origin' }),
          el('div', { class: 'pan-joy-dot' }),
          el('div', { class: 'pan-joy-handle' }),
        ]),
      ]),
    ]),
  ]);
}

// ---- FUNCTIONAL TEXT STYLES -------------------------------------------------
// The composed text roles in the app (heading / label / value / caption / status /
// meta / …), parsed from the CSS. Same "collapse the diffs" goal as the raw size +
// color tokens, one level up: these are the candidate NAMED text styles.
function txtRow(node, label, spec) {
  return el('div', { class: 'lab-textrow' }, [
    el('div', { class: 'lab-text-sample' }, [node]),
    el('div', { class: 'lab-text-meta' }, [
      el('code', { class: 'lab-name', text: label }),
      el('code', { class: 'lab-val', text: spec }),
    ]),
  ]);
}
const tc = (cls, sample) => el('div', { class: cls, text: sample });   // direct-class specimen
function textGroup(title, rows) {
  return [el('h3', { class: 'lab-h3', text: title }), el('div', { class: 'lab-textlist' }, rows)];
}
function textStylesSection() {
  return section('textstyles', 'Text styles', 'Every functional text role in the app, parsed from the CSS. The PROPOSED named set (.t-*, now in styles.css — additive, nothing consumes it yet) is the consolidation target; below it is the current sprawl it replaces. --text-sm (11px) alone is reused by ~12 roles in different colors, the lowercase "heading" pattern recurs at 11px AND 10px, and desktop↔mobile labels drift (12px vs 13px). Tooltips are NOT here — they are native browser title= tooltips, unstyled (a gap). Tune the .t-* values, then migrate the sprawl onto them (a parity step).', [
    ...textGroup('★ Proposed named set (.t-* — the target)', [
      txtRow(tc('t-heading', 'segment'), '.t-heading', '11px · --text-dim · 500 · lowercase · ls .08em'),
      txtRow(tc('t-title', 'export video'), '.t-title', '13px · --text · 500'),
      txtRow(tc('t-label', 'out of bounds'), '.t-label', '12px · --text-dim'),
      txtRow(tc('t-value', '128'), '.t-value', '11px · --text-secondary · tabular'),
      txtRow(tc('t-caption', 'resolution'), '.t-caption', '10px · --text-muted · lowercase · ls .06em'),
      txtRow(tc('t-hint', 'clean hardware only'), '.t-hint', '11px · --text-dim'),
      txtRow(tc('t-meta', '1920×1080 · mp4'), '.t-meta', '11px · --text-dim · tabular'),
      txtRow(tc('t-status', 'live camera'), '.t-status', '11px · --text-muted'),
      txtRow(tc('t-status success', 'saved'), '.t-status.success', '→ --ok (.error/.busy too)'),
      txtRow(tc('t-mono', 'v0.10.35 · Build 217'), '.t-mono', 'mono · 11px · --text-dim'),
    ]),
    el('h3', { class: 'lab-h3', style: 'margin-top:24px', text: 'Current sprawl (what the named set replaces)' }),
    ...textGroup('Headings / titles', [
      txtRow(el('div', { class: 'group', style: 'border:none;padding:0;gap:0' }, [el('h2', { text: 'segment' })]), '.group h2', '11px · --text-dim · 500 · lowercase · ls .08em'),
      txtRow(tc('vid-head', 'export video'), '.vid-head', '13px · --text · 500'),
      txtRow(el('div', { class: 'placeholder' }, [el('strong', { text: 'kaleidoscope' })]), '.placeholder strong', '14px · --text-dim · 500 · block'),
    ]),
    ...textGroup('Labels', [
      txtRow(tc('field-label', 'out of bounds'), '.field-label', '12px · --text-dim'),
      txtRow(el('label', { class: 'slider', style: 'gap:0' }, ['segments']), 'label.slider', '12px · --text-dim'),
      txtRow(tc('m-control-row', 'rotation'), '.m-control-row (mobile)', '13px · --text-dim — note: 12 vs 13 drift'),
    ]),
    ...textGroup('Values (numeric, tabular)', [
      txtRow(el('label', { class: 'slider', style: 'gap:0' }, [el('span', { class: 'val', text: '128' })]), 'label.slider .val', '11px · --text-secondary · tabular'),
      txtRow(el('div', { class: 'res-hint' }, [el('span', { class: 'num', text: '1920×1080' })]), '.res-hint .num', '10px · --c-neutral-200 · tabular'),
    ]),
    ...textGroup('Captions / hints', [
      txtRow(tc('setting-label', 'resolution'), '.setting-label', '10px · --text-muted · lowercase · ls .06em'),
      txtRow(tc('res-hint', 'clean hardware only'), '.res-hint', '10px · --text-dim'),
      txtRow(tc('browser-notice', 'Firefox caps WebGL at 8K'), '.browser-notice', '11px · --text-dim'),
      txtRow(tc('m-sheet-cap', 'save'), '.m-sheet-cap (mobile)', '11px · --text-dim · lowercase · ls .06em'),
    ]),
    ...textGroup('Status / feedback', [
      txtRow(tc('status', 'live camera'), '.status', '11px · --text-muted'),
      txtRow(tc('status error', 'codec not supported'), '.status.error', '→ --danger-text'),
      txtRow(tc('status busy', 'encoding…'), '.status.busy', '→ --warn-text'),
      txtRow(tc('status success', 'saved'), '.status.success', '→ --ok'),
      txtRow(tc('upload-error', 'could not read file'), '.upload-error', '11px · --danger-text'),
    ]),
    ...textGroup('Meta', [
      txtRow(tc('source-meta', 'photo.jpg · 4032×3024'), '.source-meta', '11px · --text-muted · tabular'),
      txtRow(tc('vid-meta', '1920×1080 · mp4'), '.vid-meta', '11px · --text-dim · tabular'),
      txtRow(tc('clip-meta', 'drag handles to trim'), '.clip-meta', '12px · --text-dim'),
      txtRow(tc('mf-time', '0:04'), '.mf-time', '9px · --c-neutral-400'),
      txtRow(tc('mf-time total', '1:20'), '.mf-time.total', '→ --c-neutral-250'),
    ]),
    ...textGroup('Mono / version / diag', [
      txtRow(tc('ot-version', 'v0.10.34 · Build 216'), '.ot-version', 'mono · 11px · --text-dim'),
      txtRow(tc('version-badge', 'Build 216'), '.version-badge', 'mono · 10px · --text-faint'),
    ]),
    ...textGroup('Empty states', [
      txtRow(tc('empty-msg', 'no image loaded'), '.empty-msg', '12px · --text-faint'),
      txtRow(el('div', { class: 'placeholder' }, ['upload an image to begin']), '.placeholder', '14px · --text-faint · lh 1.6'),
    ]),
  ]);
}

// ---- BUILDING BLOCKS (base, reused pieces) ----------------------------------
function ledBtn(label, greenOn, redOn) {
  const led = el('span', { class: 'ot-led' }, [
    el('i', { class: greenOn ? 'on-green' : '' }),
    el('i', { class: redOn ? 'on-red' : '' }),
  ]);
  const btn = el('button', { class: 'ot-btn' }, ['output', led]);
  return stateCell(btn, label);
}
function buildingBlocksSection() {
  // grippy resize handles (desktop .divider + mobile #m-divider, real ::before grips)
  const deskGrip = el('div', { class: 'divider', style: 'position:relative;height:90px' });
  const mobGrip = el('div', { id: 'm-divider', style: 'position:relative;width:160px' });
  // traffic-light LED states (the stacked dots on #outputBtn)
  const leds = el('div', { class: 'lab-matcells' }, [
    ledBtn('off', false, false),
    ledBtn('broadcast (.on-green)', true, false),
    ledBtn('record (.on-red)', false, true),
    ledBtn('both', true, true),
  ]);
  // separators
  const seps = el('div', { class: 'lab-stack', style: 'width:260px' }, [
    el('div', { style: 'border-bottom:1px solid var(--border-subtle);padding-bottom:8px;width:100%', text: '--border-subtle (panel/group)' }),
    el('div', { style: 'border-bottom:1px solid var(--border);padding-bottom:8px;width:100%', text: '--border (default rule)' }),
  ]);
  return section('blocks', 'Building blocks', 'Base reused pieces below the components: the grippy resize handles (desktop ::before line vs mobile ::before bar — different treatments), the traffic-light LED (the stacked dots on the output button) in its states, and the separator/rule weights.', [
    el('div', { class: 'lab-cols' }, [
      el('div', {}, [el('h3', { class: 'lab-h3', text: 'Grippy · desktop .divider' }), deskGrip]),
      el('div', {}, [el('h3', { class: 'lab-h3', text: 'Grippy · mobile #m-divider' }), mobGrip]),
    ]),
    el('h3', { class: 'lab-h3', text: 'Traffic-light LED · #outputBtn .ot-led' }),
    leds,
    el('h3', { class: 'lab-h3', text: 'Separators' }),
    seps,
  ]);
}

// ---- COMPOSITES -------------------------------------------------------------
function mfMarker(leftPct, stateCls) {
  return el('div', { class: `mf-marker ${stateCls}`, style: `left:${leftPct}%` }, [
    el('canvas', { width: '40', height: '40' }),
    el('div', { class: 'mf-pin' }),
  ]);
}
function compositesSection() {
  // timeline: track + keyframe markers in their states + playhead
  const timeline = el('div', { class: 'mf-track', style: 'position:relative;height:72px' }, [
    mfMarker(12, ''),
    mfMarker(32, 'anchored'),
    mfMarker(52, 'selected'),
    mfMarker(72, 'selected anchored'),
    mfMarker(90, 'ghost'),
    el('div', { class: 'mf-playhead', style: 'left:44%' }),
  ]);
  // clip-editor bar: region + trim handles + blue slice point + playhead
  const clip = el('div', { class: 'clip-bar', style: 'position:relative;margin:0' }, [
    el('div', { class: 'clip-region', style: 'left:22%;width:46%' }),
    el('div', { class: 'clip-handle', style: 'left:22%' }),
    el('div', { class: 'clip-handle', style: 'left:68%' }),
    el('div', { class: 'clip-handle cut', style: 'left:45%' }),
    el('div', { class: 'clip-playhead', style: 'left:55%' }),
  ]);
  // modals — desktop renders the FULL treatment (backdrop dim + blur + centered card)
  // over faux content; mobile differs (centered panel, grip, radius 16, lighter backdrop).
  const vidCard = el('div', { class: 'vid-card' }, [
    el('div', { class: 'vid-head' }, ['render video', el('button', { class: 'vid-x', text: '✕' })]),
    el('div', { class: 'vid-meta', text: '1920×1080 · mp4 · h.264' }),
    el('button', { class: 'primary', style: 'margin-top:8px', text: 'render' }),
  ]);
  const desktopModal = el('div', { class: 'lab-modal-demo' }, [
    el('div', { class: 'lab-modal-behind' }, [
      el('div', { class: 't-heading', text: 'segment' }),
      el('button', { class: 'ot-btn', style: 'margin-top:8px', text: 'output' }),
      el('div', { class: 't-meta', style: 'margin-top:10px', text: 'photo.jpg · 4032×3024' }),
    ]),
    el('div', { class: 'vid-sheet', style: 'position:absolute' }, [vidCard]),
  ]);
  // destructive-interrupt confirm (shell/interrupt.js) — NON-blocking; replaced window.confirm
  // (which froze the rAF/broadcast loop on iOS). Reuses .vid-card on the .vid-sheet backdrop.
  const interruptCard = el('div', { class: 'vid-card interrupt-card' }, [
    el('div', { class: 'vid-head' }, [el('span', { text: 'replace current clip?' }), el('button', { class: 'vid-x', text: '✕' })]),
    el('div', { class: 'interrupt-body', text: 'loading a new source replaces the clip you’re working on, including its animation. save it first if you want to keep it.' }),
    el('div', { class: 'interrupt-actions' }, [
      el('button', { class: 'interrupt-btn', text: 'cancel' }),
      el('button', { class: 'interrupt-btn interrupt-secondary', text: 'discard and load new' }),
      el('button', { class: 'interrupt-btn interrupt-confirm', text: 'save current and load new' }),
    ]),
  ]);
  const interruptDemo = el('div', { class: 'lab-modal-demo' }, [
    el('div', { class: 'lab-modal-behind' }, [el('div', { class: 't-heading', text: 'form' })]),
    el('div', { class: 'vid-sheet', style: 'position:absolute' }, [interruptCard]),
  ]);
  const mSheet = el('div', { class: 'm-sheet-panel', style: 'position:static;transform:none;max-height:none' }, [
    el('div', { class: 'm-sheet-grip' }),
    el('div', { class: 'm-sheet-cap', text: 'save' }),
    el('div', { class: 'm-sheet-status', text: 'saved ✓' }),
  ]);
  // Loop Builder interstitial chrome (Build 404–405 · fullscreen, app bar hidden).
  // NET-NEW in D2: the header (.loop-header/.loop-title/.loop-close) + the step rail
  // (.loop-rail/.loop-step across done/active/plain/disabled). The access button that
  // opens it reuses the existing .ot-btn (shown for context, not a new class).
  const loopAccessBtn = el('button', { class: 'ot-btn', text: 'loop builder' });
  const loopHeader = el('header', { class: 'loop-header', style: 'width:min(420px,100%)' }, [
    el('span', { class: 'loop-title', text: 'loop builder' }),
    el('button', { class: 'loop-close', title: 'close',
      html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' }),
  ]);
  const loopStep = (n, label, kind) => el('button',
    { class: 'loop-step' + (kind && kind !== 'disabled' ? ' ' + kind : ''), ...(kind === 'disabled' ? { disabled: '' } : {}) },
    [el('b', { text: n }), el('span', { text: label })]);
  const loopRail = el('aside', { class: 'loop-rail', style: 'width:max-content' }, [
    loopStep('1', 'trim & loop', 'done'),
    loopStep('3', 'slice point', 'active'),
    loopStep('4', 'crossfade', ''),
    loopStep('5', 'preview & bake', 'disabled'),
  ]);
  // Per-control LOCK (M3) — the net-new padlock affordance, from the REAL .lock-toggle
  // classes + LOCK_ICON glyphs. Two behaviors under one visual: toggleable (unlocked ↔
  // locked, click to flip) and contextual (auto, not clickable). Shown standalone + in a row.
  const lockBtn = (kind) => {
    const cls = 'lock-toggle' + (kind === 'unlocked' ? '' : kind === 'contextual' ? ' locked contextual' : ' locked');
    const b = el('button', { class: cls, title: kind, html: kind === 'unlocked' ? LOCK_ICON.unlocked : LOCK_ICON.locked });
    if (kind === 'contextual') b.disabled = true;
    return b;
  };
  const lockRow = (locked) => el('div', { class: 'row has-lock' + (locked ? ' locked-row' : '') }, [
    el('span', { text: 'segments' }), el('span', { class: 'val', text: '12' }), lockBtn(locked ? 'locked' : 'unlocked'),
  ]);
  const lockRowsBox = el('div', { class: 'panel-popover', style: 'position:static;display:block;width:220px;padding:10px 12px' }, [lockRow(false), lockRow(true)]);
  // form-picker lock — padlock in a header ABOVE the thumbs (never overlaps a form); scrim +
  // inert grid only while locked (B424: moved off the thumbs, was covering droste). Persistent so
  // you can re-lock: the header padlock shows whenever the form is lockable, locked or not.
  const formLockDemo = (locked) => {
    const head = el('div', { class: 'form-lock-head has-lock', style: 'width:150px' }, [
      el('button', { class: 'lock-toggle' + (locked ? ' locked' : ''),
        title: locked ? 'locked — applies to the whole animation' : 'unlocked — click to lock',
        html: locked ? LOCK_ICON.locked : LOCK_ICON.unlocked }),
    ]);
    const grid = el('div', { class: 'form-grid' + (locked ? ' form-locked' : ''),
      style: 'position:relative;display:grid;grid-template-columns:repeat(3,1fr);gap:6px;width:150px' });
    for (let i = 0; i < 3; i++) grid.appendChild(el('div', { class: 'form-thumb' + (i === 0 ? ' active' : ''),
      style: 'aspect-ratio:1;background:var(--surface-control);border:1px solid var(--border-subtle);border-radius:var(--radius-sm)' }));
    return el('div', {}, [head, grid]);
  };
  // droste center-offset TWO-TOGGLE (manual + autoplay, both default off) — replaced the padlock (B423).
  const offsetToggleDemo = el('div', { class: 'panel-popover', style: 'position:static;display:block;width:220px;padding:10px 12px' }, [
    el('label', { class: 'slider' }, [
      el('div', { class: 'row' }, [el('span', { text: 'center offset' })]),
      el('div', { class: 'row offset-sub-row' }, [el('span', { class: 'offset-sub', text: 'manual' }),
        el('div', { class: 'row-buttons' }, [el('button', { class: 'toggle active', text: 'off' }), el('button', { class: 'toggle', text: 'on' })])]),
      el('div', { class: 'row offset-sub-row' }, [el('span', { class: 'offset-sub', text: 'autoplay' }),
        el('div', { class: 'row-buttons' }, [el('button', { class: 'toggle active', text: 'off' }), el('button', { class: 'toggle', text: 'on' })])]),
    ]),
  ]);
  return section('composites', 'Composites', 'Higher-order assemblies. Keyframe markers shown across their states (auto/hollow-pin · anchored/filled-pin · selected/amber · ghost), the clip-editor range (amber trim region + handles + the blue slice-point + white playhead), and the modals. The desktop modal is shown with its FULL treatment — the .vid-sheet backdrop (dim rgba(10,10,10,0.6) + blur(3px)) over faux content, the centered .vid-card (radius 10, border, no drop-shadow — it relies on the backdrop for separation). Mobile differs: a bottom-ish centered .m-sheet-panel (radius 16, grip handle, lighter dim .5). This desktop↔mobile modal divergence (corner radius, backdrop, shadow approach) is a consolidation candidate. The Loop Builder interstitial (D2) is a THIRD modal treatment — a fullscreen surface (app bar hidden) with its own header/close/step-rail chrome that shares none of the .vid-card or .m-sheet vocabulary; its .loop-close X and .loop-step numbered rail are net-new here, and the three-way modal divergence is itself a flag.', [
    el('h3', { class: 'lab-h3', text: 'Timeline · .mf-track + keyframe marker states + .mf-playhead' }),
    el('div', { class: 'lab-bar-wrap' }, [timeline]),
    el('h3', { class: 'lab-h3', text: 'Clip-editor range · .clip-bar (region / handles / blue cut / playhead)' }),
    el('div', { class: 'lab-bar-wrap' }, [clip]),
    el('h3', { class: 'lab-h3', text: 'Destructive-interrupt confirm · .interrupt-card (non-blocking; replaced window.confirm — it froze the broadcast loop on iOS)' }),
    el('div', { class: 'lab-row' }, [interruptDemo]),
    el('h3', { class: 'lab-h3', text: 'Modal · desktop full treatment (backdrop dim + blur) ↔ mobile panel' }),
    el('div', { class: 'lab-cols' }, [
      el('div', {}, [el('div', { class: 'lab-name', style: 'margin-bottom:8px', text: '.vid-sheet + .vid-card · radius 10 · blur 3px · dim .6' }), desktopModal]),
      el('div', {}, [el('div', { class: 'lab-name', style: 'margin-bottom:8px', text: '.m-sheet-panel · radius 16 · grip · dim .5' }), mSheet]),
    ]),
    el('h3', { class: 'lab-h3', text: 'Loop Builder interstitial · header + step rail (fullscreen surface, app bar hidden)' }),
    el('div', { class: 'lab-cols' }, [
      el('div', {}, [el('div', { class: 'lab-name', style: 'margin-bottom:8px', text: 'access · .ot-btn (reused, opens the surface)' }), loopAccessBtn]),
      el('div', {}, [el('div', { class: 'lab-name', style: 'margin-bottom:8px', text: '.loop-header · .loop-title + .loop-close (X hover live)' }), loopHeader]),
      el('div', {}, [el('div', { class: 'lab-name', style: 'margin-bottom:8px', text: '.loop-rail · .loop-step done/active/plain/disabled' }), loopRail]),
    ]),
    el('h3', { class: 'lab-h3', text: 'Per-control lock · .lock-toggle (M3 guardrails) — fat-finger (default off, always) + structural (default locked in context) + contextual (auto, not clickable)' }),
    el('div', { class: 'lab-row', style: 'gap:24px;align-items:flex-end;flex-wrap:wrap' }, [
      el('div', {}, [el('div', { class: 'lab-name', style: 'margin-bottom:6px', text: 'unlocked (hover)' }), lockBtn('unlocked')]),
      el('div', {}, [el('div', { class: 'lab-name', style: 'margin-bottom:6px', text: '.locked' }), lockBtn('locked')]),
      el('div', {}, [el('div', { class: 'lab-name', style: 'margin-bottom:6px', text: '.contextual (auto, not clickable)' }), lockBtn('contextual')]),
      el('div', {}, [el('div', { class: 'lab-name', style: 'margin-bottom:6px', text: 'in .row.has-lock (unlocked / .locked-row)' }), lockRowsBox]),
    ]),
    el('h3', { class: 'lab-h3', text: 'Form-picker lock · persistent corner padlock (always, to re-lock) + scrim only while locked' }),
    el('div', { class: 'lab-row', style: 'gap:24px;align-items:flex-end;flex-wrap:wrap' }, [
      el('div', {}, [el('div', { class: 'lab-name', style: 'margin-bottom:6px', text: 'unlocked (faint corner padlock)' }), formLockDemo(false)]),
      el('div', {}, [el('div', { class: 'lab-name', style: 'margin-bottom:6px', text: '.form-locked (scrim + bright padlock)' }), formLockDemo(true)]),
    ]),
    el('h3', { class: 'lab-h3', text: 'Droste center-offset · two toggles (manual + autoplay, both default off) — replaced its padlock' }),
    el('div', { class: 'lab-row', style: 'gap:24px;align-items:flex-start;flex-wrap:wrap' }, [offsetToggleDemo]),
  ]);
}

// ---- CROSS-DEVICE STATES (reused, handled inconsistently across chromes) -----
// The record-video PiP monitor, rendered from the REAL #m-pip markup and classes (mobile
// styles.css is imported above), so these specimens track the app rather than describe it.
// Absolute positioning and the corner classes are neutralised for display only — everything
// else is the shipping treatment.
function pipSection() {
  // position/corner rules stay id-scoped (they are layout, not treatment); everything visual is
  // shared with the app by selector, so these specimens cannot drift from the shipping look.
  const SHIM = 'position:relative;width:150px';

  // a REAL canvas, because `#m-pip canvas, .m-pip canvas` and the starved `visibility:hidden`
  // rule both key on the element — a div stand-in would silently miss them
  function fauxCanvas() {
    const c = el('canvas', { width: '160', height: '160' });
    const g = c.getContext('2d').createLinearGradient(0, 0, 160, 160);
    g.addColorStop(0, '#2b4a6f'); g.addColorStop(0.55, '#7a4a86'); g.addColorStop(1, '#c86a4a');
    const ctx = c.getContext('2d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 160, 160);
    return c;
  }

  function pip({ label, rec, starved, warn }) {
    return el('div', { class: `m-pip${starved ? ' pip-starved' : ''}${warn ? ' pip-warn' : ''}`, style: SHIM }, [
      fauxCanvas(),
      el('div', { class: 'm-pip-msg', text: warn ? 'monitor pauses during 4K capture' : 'preview unavailable while capturing at 4K' }),
      el('span', { class: 'm-pip-label' }, [
        el('i', { class: `m-pip-dot${rec ? ' rec' : ''}` }),
        el('span', { text: label }),
      ]),
    ]);
  }

  const cell = (title, node, note) => el('div', {}, [
    el('div', { class: 'lab-name', style: 'margin-bottom:8px', text: title }),
    node,
    note ? el('div', { class: 'lab-note', style: 'margin-top:6px', text: note }) : null,
  ]);

  return section('pip', 'PiP monitor (record video)',
    'The corner monitor in record-video mode. The big panel is the immediate PREVIEW; the PiP shows the followed OUTPUT — what is actually being recorded — and the two swap (labels follow). '
    + 'STARVED is a governor state, not an error: at a 4K source each PiP consume costs so much that ten per second saturate the frame budget (14 Pro: 11.0fps with the monitor at 10Hz vs 11.4 with it off), so at 4K the monitor cannot be rationed, only removed. '
    + 'The surface deliberately STAYS so the record/broadcast dot keeps its home and the explanation sits where the content was, instead of a toast that has to be caught. '
    + 'WARNED is the state before that one (B555): while a 4K source is selected but nothing is capturing yet, the monitor stays LIVE and carries a quiet caption saying it will pause. Daniel hit the starve with no forenotice and called it "unexpected and potentially concerning" — the surprise was the problem, not the starving. '
    + 'Two gaps this surfaces. (1) The dot is one flat --danger for BOTH recording and broadcasting, so the two live states are indistinguishable at a glance — a disambiguation target. '
    + '(2) The component was styled entirely by ID (#m-pip, #m-pip-msg, #m-pip-dot), which made it impossible to specimen without copying its CSS. The visual rules now accept the class form too, from ONE declaration each, so these are the shipping styles rather than a duplicate that drifts. Only the corner/safe-area positioning stays id-scoped, since that is layout rather than treatment. Worth applying the same rule to any other id-styled component.', [
      el('div', { class: 'lab-cols' }, [
        cell('live · output', pip({ label: 'output' }), '10Hz on iOS — a monitor does not need program parity'),
        cell('live · recording', pip({ label: 'output', rec: true }), '#m-pip-dot.rec'),
        cell('live · swapped', pip({ label: 'preview' }), 'big panel becomes OUTPUT; labels trade places'),
        cell('warned · 4K armed, not capturing', pip({ label: 'output', warn: true }), '.pip-warn — picture stays LIVE, caption over it'),
        cell('starved · 4K capture', pip({ label: 'output', rec: true, starved: true }), '.pip-starved — canvas visibility:hidden, #m-pip-msg shown'),
      ]),
    ]);
}

function crossDeviceStatesSection() {
  const deskOutput = el('div', { class: 'lab-state-stage', style: 'flex-direction:column;align-items:center;gap:6px;padding:20px;min-width:200px' }, [
    el('div', { class: 'placeholder' }, [el('strong', { text: 'kaleidoscope' }), 'upload an image to begin']),
    el('div', { class: 'status', text: 'load an image to start' }),
  ]);
  const mobOutput = el('div', { class: 'lab-state-stage', style: 'padding:20px;min-width:200px;color:var(--text-dim);font-size:var(--text-lg)', text: 'tap + to add a source' });
  const deskSource = el('div', { class: 'side-display-wrap', style: 'aspect-ratio:auto;min-height:90px;height:90px' }, [
    el('div', { class: 'empty-msg', text: 'no image loaded' }),
  ]);
  const mobSource = el('div', { class: 'lab-state-stage', style: 'padding:20px;min-width:200px;color:var(--text-dim);font-size:var(--text-base)', text: '(mobile source slot)' });
  return section('states', 'Cross-device states', 'Reused states that are NOT strictly components but are handled inconsistently across the two chromes — worth comparing side by side. Note desktop alone already carries THREE different empty messages: the placeholder "kaleidoscope / upload an image to begin", the status caption "load an image to start", and the side "no image loaded" — different wording, color (--text-faint vs --text-dim vs --text-muted), and size. A consolidation target.', [
    el('h3', { class: 'lab-h3', text: 'Empty output · desktop ↔ mobile' }),
    el('div', { class: 'lab-cols' }, [
      el('div', {}, [el('div', { class: 'lab-name', style: 'margin-bottom:8px', text: 'desktop · .placeholder + .status' }), deskOutput]),
      el('div', {}, [el('div', { class: 'lab-name', style: 'margin-bottom:8px', text: 'mobile · #m-empty' }), mobOutput]),
    ]),
    el('h3', { class: 'lab-h3', text: 'Empty source · desktop ↔ mobile' }),
    el('div', { class: 'lab-cols' }, [
      el('div', {}, [el('div', { class: 'lab-name', style: 'margin-bottom:8px', text: 'desktop · .side-display-wrap .empty-msg' }), deskSource]),
      el('div', {}, [el('div', { class: 'lab-name', style: 'margin-bottom:8px', text: 'mobile' }), mobSource]),
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
      'Run to make the shippable installer. Sequence: (1) rebuilds the web app (dist/), (2) packages it with electron-builder, (3) re-applies the leak-fixed node-syphon, (4) names the file from src/version.js. Output: electron/release/Fold Live-<version>-arm64.dmg. NOTE: arm64 (Apple Silicon) only + unsigned, so Gatekeeper warns on first open (right-click → Open). The app icon comes from electron/build/icon.png (electron-builder mac.icon) — a placeholder for now; drop a real 1024px PNG or .icns there to replace it.'],
    ['xattr -cr "/Applications/Fold Live.app"', 'install on ANOTHER Mac: clear the quarantine flag',
      'Run once in Terminal after copying the app out of the DMG on a different machine. The app is unsigned, so macOS quarantines a downloaded copy and may claim it is "damaged" — this strips the quarantine attribute so it launches. Not needed on the Mac that built the DMG. Also safe to delete everything in electron/release/ at any time: DMGs, .blockmap files (differential-update metadata we do not use), builder-debug.yml, and mac-arm64/ are ALL regenerable build artifacts — the installed app in /Applications and your rigs in userData are untouched.'],
  ] },
  { group: 'Capacitor / iOS  ·  device + signing walkthrough in docs/DISTRIBUTION.md', items: [
    ['npm install', 'first-time setup (also pulls the Capacitor deps)',
      'Run once after cloning or when deps change. Installs node_modules (gitignored) including @capacitor/* + the native plugins. The iOS Swift Package deps resolve separately on the first Xcode build. The one-time signing + per-device setup (Developer Mode, trust, dev team) is in docs/DISTRIBUTION.md → "running on a device".'],
    ['npm run cap:sync', 'rebuild the web app + copy it into the iOS project',
      'THE every-time loop: run whenever you change web code (src/), then press Run (⌘R) in Xcode. It is `vite build` + `cap sync ios` — recompiles dist/, copies it into ios/App/App/public, refreshes the plugin list. It does NOT open Xcode, touch signing, or build the native app (Xcode does the native compile + install on Run). Contrast with the INITIAL build, which additionally does the one-time signing + device-trust setup (see DISTRIBUTION.md).'],
    ['npm run ios', 'build + sync + open Xcode',
      'Convenience = `vite build` + `cap sync ios` + opens ios/App/App.xcodeproj. Use it to start a session with the project open. Then pick your device in the toolbar and Run.'],
    ['npm run cap:open', 'just open the iOS project in Xcode',
      'Opens ios/App/App.xcodeproj without rebuilding — use when dist/ is already current.'],
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
// ---- URL-parameter cheat sheet (sibling of the CLI one) ---------------------
// Every `?param` the app reads, grepped from the source rather than remembered — there are ten
// across eight files and no other index of them. Keep this in step when you add one: the whole
// point is that it is the single place to look, so an unlisted param may as well not exist.
const LINK_PARAMS = [
  { group: 'Chrome + panels  ·  the ones you reach for', items: [
    ['?chrome=mobile', 'force the MOBILE chrome on any device',
      'The one most often misremembered as "?mobile=true". Preview the phone UI on desktop without resizing the window. `?chrome=desktop` forces the other way (useful on a phone). Without it, mobile is chosen only for a genuine phone-class device: coarse pointer AND short side < 600px, so iPad stays on desktop chrome and a narrowed desktop window no longer swaps (that reload used to drop the loaded source). See boot.js.'],
    ['?diag', 'auto-open the diagnostics panel on load',
      'Same panel as the settings gizmo, opened for you ~50ms after boot. Handy when you are chasing something that happens during startup and do not want to spend the first seconds clicking. See shell/diagnostics.js.'],
    ['?tune=forms', 'live per-form normalization tuner (bottom-right)',
      'Sliders for the four numbers that make the forms comparable to each other — sizeNorm (scales the slice sample), canvasNorm (redefines what canvasZoom 1x means), and the two zoom-overflow bounds (zoomCover / zoomInFloor). Follows whichever form is active. Values apply LIVE by mutating the form registry, so the shader, the overlay geometry and the sharpness hint all move together — and nothing is persisted, so a reload returns you to the committed values. "copy all values" emits a paste-ready block of only what you changed, per form, which is how a tuning session gets committed. Dev-only; see shell/form-tuner.js.'],
    ['?perf', 'frame-cost panel: what each surface costs, with switches',
      'The readout and switchboard for conduit\'s perf ledger. Lists every registered render surface with its dimensions, megapixels and measured ms per frame, plus fps, frame-time p50/p95, total MP per frame and a thermal/load pressure reading. Each row has an ON/OFF switch and (where the surface can be scaled) a resolution ladder, because mobile GPUs give no timer queries — the honest per-item cost there is the fps delta when you switch something off. Every switch is also a candidate degradation lever, so this doubles as the prototype of the ladder. Where the platform supports GPU timer queries (Chromium and Electron, generally not WebKit) each row leads with TRUE GPU time and shows the CPU figure in parentheses; on WebKit there is one number and no false precision. A second section carries the OPTIMIZATION SWITCHES — each behavior-changing optimization we have shipped, switchable back off so its worth can be measured rather than assumed. Save a BASELINE per named scenario and the rows show deltas against it, which is how a render-path change gets checked for regressions. Nothing persists except a baseline you save. **START SESSION (B660)** turns it into a RECORDER: the panel\'s other numbers are instantaneous, so they can say what minute nine looked like but never that it is worse than minute one. A session gives the samples a known t=0 and keeps running while the panel is closed, sampling thermal state, memory HEADROOM (what is left before the OS kills us \u2014 the number that decides whether a long run survives, as against footprint, which only says what we spent), fps and frame cost every 10s. It carries a glanceable warning line with the REASONS it is warning, because during an eight-hour run nobody is reading JSON. **RUN SCENARIO (B665)** turns it into a SCRIPTED TEST: pick a named script (T2 hands-off, T3 recording-priority A/B, T7 warm long run) and the app drives the whole sequence \u2014 session, broadcast, takes, waits \u2014 while the operator walks away. The panel line shows the current step and the countdown, because the run outlives the operator\'s attention and the device is the only surface they can read. Actions go through the SAME functions the output panel\'s own buttons call (`env.outputActions`), never a re-implementation, and a script whose capabilities this chrome lacks refuses to start BY NAME rather than skipping steps silently. The run lands in `copy report` under `scenarioRun`, aborted runs included \u2014 an aborted run is a finding, and it names the step it stopped on. See shell/scenario-runner.js. The record lands in `copy report` under `vitals` \u2014 a sibling key, not a second report, because the export is the only diagnostic channel that demonstrably works. See conduit/vitals.js. Also reachable as "frame cost panel" in the desktop diagnostics section (the only way in on iPad, since a URL param cannot reach a Capacitor build) and as "show frame cost" inside the phone chrome\'s diagnostics block. See shell/perf-panel.js + conduit/perf-ledger.js.'],
    ['?probe=motion', 'arm the runaway-motion probe (droste infinite-zoom hunt)',
      'Samples the state fields a droste runaway could live in — canvasOffsetX/Y (droste\'s log-polar centre), drosteZoomPhase, drosteOffsetX/Y, and canvasZoom (which sets the pan gain at 2/canvasZoom) — plus the perform follower\'s own spring internals for the same fields. The number it exists to produce is `quietMovingMs`: how long a value spent travelling while every known writer was idle (autoplay off, no pointers down, no joystick latched). Anything above a few frames of that names the culprit outright, and `verdict` says which field in one line. It exists because the investigation reached a contradiction that no further code reading can settle: with everything idle no writer CAN move those fields, and follow.js provably settles against constant state, yet the motion is real — so either a writer was missed or the moving quantity is not the one we assumed, and the follower row separates those two. Read-only: never writes state, never touches the render path, and allocates nothing unless the param is present. Output rides the frame-cost panel\'s "copy report" (the console is not a channel we have on device). See kit/motion-probe.js.'],
    ['?fold=live', 'fold the slice CONTINUOUSLY instead of on gesture release',
      'The geometry flip (B635) re-expresses the slice as its own reflection once it stops being visible, so the copy you can see is always the primary one. This param controls WHEN. `?fold=live` folds the moment the threshold is crossed, mid-drag — which means the slice reverses direction under a moving finger for the rest of the stroke. The default (`release`, or simply omitting the param) waits until the gesture ends, keeping one frame of reference for the whole stroke. Both render identically at every instant — the fold is pixel-preserving — so this changes only when the OUTLINE settles its identity. The gate applies to pointer/touch drags only: knobs, encoders, autoplay and the tween have no release, so they always fold live. Added so the two can be compared in one build. See shell/overlay.js normalizeSliceMirror.'],
    ['?inputdebug', 'show the live input-event HUD (bottom-left)',
      'A read-only overlay logging pointer/touch/wheel/gesture events as they arrive — how many touches the OS is actually reporting, and whether a trackpad is sending wheel+ctrl or real gesture events. This is what settles "is multi-touch even reaching us" questions on the Movink / Sidecar rigs. Not part of the shipped UX. See shell/input-debug.js.'],
  ] },
  { group: 'Broadcast + capture  ·  A/B switches for device debugging', items: [
    ['?mocksyphon', 'pretend a Syphon host exists on plain web',
      'Registers a mock native host so the broadcast destination picker, arming, and the output bus can be exercised in an ordinary browser with no Electron shell. Nothing actually leaves the machine. See main.js.'],
    ['?recorder=mediarecorder', 'force the fallback recording engine',
      'Default is `auto`, which picks the conduit WebCodecs recorder where available. Forcing MediaRecorder is the A/B when a recording comes out stuttery or wrongly sized on a specific device. See the recorder sink registration in main.js.'],
    ['?buscapture=videoframe', 'force the output bus\'s GPU→CPU readback mode',
      'Accepts `getimagedata`, `readpixels` or `videoframe`. The bus normally PROBES all three at startup and keeps the fastest, because the winner is per-device rather than per-browser (see the browser-engine notes in BACKLOG). Force one when you want to measure a specific path or when the probe picks badly. See conduit/capture.js.'],
    ['?capture=gl', 'force the video-export frame source',
      'Accepts `2d`, `bitmap` or `gl`. Defaults to `gl` on WebKit (far faster wrapping the WebGL canvas straight into a VideoFrame) and `2d` on Firefox/Chromium. A safety hatch if an older iOS device hangs on the WebGL-direct path. See kit/capabilities.js. **A Capacitor build has no URL bar**, so the same A/B is also a perf-panel toggle there: `render: 2D capture instead of GL` (B742).'],
    ['?ndiwire=rgba', 'force the old full-RGBA NDI wire',
      'NDI now sends UYVY (half the bytes). This forces the previous full-RGBA wire for A/B. The blue cast that once kept UYVY opt-in was a readback channel-order bug (iPad readPixels returns B,G,R,A), fixed at the capture layer. The active wire logs itself when the sender starts. See shell/capacitor-host.js.'],
    ['?ndifps=15', 'tune the NDI publish-rate target (1-120, default 30)',
      'The adaptive governor paces sends; this sets its target. The diagnostic value: if a LOWER target smooths WiFi proportionally, the problem is bandwidth; if it does not, it is latency/jitter (WiFi power-save) and the fix is wired or receiver-side. Values other than 30 want the native frame_rate declaration updated to match for a fully clean stream. See conduit/ndi-sink.js.'],
  ] },
  { group: 'Build-time gates', items: [
    ['?edition=pro', 'override the edition gate at runtime',
      'Edition is normally a BUILD-time choice (`VITE_FOLD_EDITION`, or a native shell\'s build env, defaulting to `web`). This overrides it in the browser so edition-gated features can be exercised without a rebuild. See kit/capabilities.js.'],
  ] },
  { group: 'Related: localStorage switches  ·  not URL params, same class of thing', items: [
    ['foldNativeVideoCap', 'source detail for the native video decode (0 / 2560 / 1920 / 1280)',
      'Bounds the long edge of the engine\'s source texture; 0 = native. The decode and the frame socket stay full-res either way, so this trades detail for fill rate. Has a real toggle in settings → diagnostics ("source detail"), so you rarely need to set it by hand.'],
    ['foldLoopCacheMB', 'memory the native decode may hold for the loop head (0 / 32 / 64 / 128 / 256, default 64)',
      'A lap costs a fixed ~150ms of no frames — measured identically at 4K and FHD, so it is a pipeline restart cost rather than decode work. These cached head frames fill it. A 4K frame is ~12.4MB, so 64MB buys about 5 frames; 0 disables the cache and is the A/B control arm. Toggle in settings → diagnostics ("loop cache"), and it applies LIVE so a budget can be compared mid-loop.'],
    ['foldHdmiVideoUncap', 'lift the 1080p-over-HDMI guard for video sources ("1" / "0")',
      'Also a toggle in settings → diagnostics ("4K/QHD over HDMI"). Largely historical now that the single native decode removed the second decoder that made the guard necessary.'],
    ['foldNdiClockVideo', 'NDI clock_video ("0" disables; default on)',
      'Toggle in settings → diagnostics. Left on by default after the iPad NDI A/B.'],
    ['foldBroadcastCeiling-v2', 'LEARNED, not a switch: what this device sustained per destination + ACTUAL render size',
      'Written by broadcast-ceiling.js once a second while broadcasting, and read back into the output panel\'s resolution hint before the next one starts ("measured here: 20 of 30fps · QHD held 29"). Median of the run, not the best window, because judder is a variance phenomenon and the best window flatters a tier that stutters. Delete the key to make the app forget and re-measure; it also rides the frame-cost report as `broadcastCeiling`.'],
  ] },
];

function cheatSheetModal(title, groups) {
  const rows = [];
  for (const { group, items } of groups) {
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
      el('div', { class: 'lab-h2', text: title }),
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

// ---- inputs & settings (the Arc 6 control-bus surface) ----------------------
// STATIC specimens of the settings-sheet vocabulary; input-bus.js renders the
// real thing. Kept in sync BY HAND with renderMaps/mapRow markup — if a class
// or column changes there, update here (the Lab is the fragmentation detector,
// so a drifted specimen is itself the signal).
function inMapRowEl(kindChip, label, target, mode, opts = {}) {
  const row = el('div', { class: 'in-map' + (opts.cls ? ' ' + opts.cls : '') });
  row.innerHTML = `
    <span class="in-grip" title="drag to reorder">≡</span>
    <span class="in-kind">${kindChip}</span>
    <input class="in-name in-label" value="${label}">
    <button class="toggle in-mod${opts.mod ? ' active' : ''}">mod</button>
    <select class="in-target"${opts.mod ? ' disabled' : ''}><option>${target}</option></select>
    <select class="in-mode"${opts.noMode || opts.mod ? ' disabled' : ''}><option>${mode}</option></select>
    <select class="in-sens"${opts.noMode || opts.mod ? ' disabled' : ''}><option>${opts.sens || '5%'}</option></select>
    <button class="toggle in-inv${opts.inv ? ' active' : ''}">inv</button>
    ${opts.led ? `<button class="in-led" style="background:${opts.led}"></button>` : '<span></span>'}
    <button class="vid-x in-del">✕</button>`;
  return row;
}
// `move` renders the B651 re-home picker — the real app shows it ONLY on an offline device that
// still holds mappings while a connected device of the same kind exists.
function inDevHeadEl(name, on, count, closed = false, move = null) {
  const head = el('div', { class: 'in-devhead' });
  head.innerHTML = `<button class="in-chev">${closed ? '▸' : '▾'}</button>
    <i class="in-dot${on ? ' on' : ''}"></i>
    <input class="in-name" value="${name}">
    ${move ? `<select class="in-devmove"><option>move mappings to…</option><option>${move}</option></select>` : ''}
    <span class="in-devcount">${count}</span>
    <span class="in-devstate">${on ? 'connected' : 'offline'}</span>
    <button class="vid-x in-devdel">✕</button>`;
  return head;
}
function inLightsEl(n) {
  const s = el('span', { class: 'in-lights' });
  for (let i = 0; i < n; i++) s.appendChild(el('i'));
  return s;
}
// the remote finger echo, drawn with the REAL styles (overlay.js
// drawRemoteFingers / remote-input.js repaintFingers use these exact values)
function fingerEchoCard() {
  const c = el('canvas');
  c.width = 240; c.height = 120;
  c.style.cssText = 'width:240px;height:120px;background:var(--surface-control);border:1px solid var(--border);border-radius:6px';
  const x = c.getContext('2d');
  for (const [px, py, r] of [[70, 60, 13], [150, 48, 13]]) {
    x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2);
    x.fillStyle = 'rgba(255,255,255,0.12)'; x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 1.5; x.stroke();
  }
  return c;
}
// B629 — the inline duplicate-binding prompt. Shown when LEARN captures a control that already has
// a mapping: the choice belongs in the list you are looking at, so it is not a modal.
function inDupAskEl() {
  const box = el('div', { class: 'in-dupask' });
  box.innerHTML = `
    <div class="in-dupask-msg"><b>d-pad up</b> is already mapped to <b>square aspect</b>.</div>
    <div class="in-dupask-note">A second binding is right when the two targets belong to <b>different forms</b>
      (only the active form's acts) or when one is behind a <b>modifier</b>. Two bindings on the same form
      will both fire and fight.</div>
    <div class="in-dupask-btns">
      <button class="toggle">edit the existing one</button>
      <button class="primary">add a second binding</button>
    </div>`;
  return box;
}
function inputsSection() {
  const tabs = el('div', { class: 'set-tabs' }, [
    el('button', { class: 'toggle', text: 'about' }),
    el('button', { class: 'toggle active', text: 'inputs' }),
    el('button', { class: 'toggle', text: 'diagnostics' }),
  ]);
  const devices = el('div', { class: 'in-maps', style: 'max-height:none' }, [
    inDevHeadEl('APC40 mkII', true, '2 mappings'),
    inMapRowEl('cc', 'top knob 1', 'slice rotation', 'step', { inv: 1 }),
    inMapRowEl('pad', 'clip stop 3', '⏻ take', 'step', { noMode: 1, led: '#3c3' }),
    inDevHeadEl('DualSense', false, '1 mapping', true),
    // B651 — the state an imported pre-B650 rig lands in: an OFFLINE device holding every mapping
    // beside a connected one of the same hardware. The picker is the only way out of it, so the
    // specimen shows the confusing case (two identically named rows) rather than a tidy one.
    inDevHeadEl('DualSense Wireless Controller', false, '24 mappings', true, 'DualSense Wireless Controller'),
  ]);
  // B639 — the drop preview is a SKELETON SLOT sized to the row being dragged, not a 2px line.
  // Rendered from the real class so it cannot drift from the shipped component.
  const dragging = el('div', { class: 'in-maps', style: 'max-height:none' }, [
    inMapRowEl('stick', 'left stick x', 'slice position x', 'ramp', { cls: 'in-dragging' }),
    el('div', { class: 'in-drop-slot', style: 'height:34px' }),
    inMapRowEl('tp', 'trackpad rotate', 'slice rotation', 'step'),
  ]);
  // B624/B629 states: a row that DECLINED because its target does not apply to the active form,
  // a MODIFIER row, and the SHIFTED row that only acts while that modifier is held.
  const states = el('div', { class: 'in-maps', style: 'max-height:none' }, [
    inMapRowEl('btn', 'd-pad up', 'square aspect', 'step', { sens: '1 step' }),
    inMapRowEl('btn', 'd-pad up', 'droste thickness', 'step', { cls: 'in-idle' }),
    inMapRowEl('btn', 'x / square', '— modifier —', 'step', { mod: 1 }),
    inMapRowEl('+x / sq', 'b / circle', '◈ form: droste', 'step', { noMode: 1 }),
    inMapRowEl('btn', 'right bumper', '— pick a target —', 'step'),
  ]);
  return section('inputs-surface', 'Inputs & settings (control bus)',
    'The settings-sheet vocabulary from the Arc 6 input surface, as static specimens (input-bus.js renders the real, wired version — these are hand-synced copies, so drift here means the specimen needs updating). The mapping row is a 10-column grid: grip · kind chip · editable name · MOD toggle · target · mode · sensitivity · invert · LED swatch (pads only) · remove. (It was 9 columns until B629 added the modifier toggle.) Device headers carry the presence dot (var(--ok), the same token as the output traffic light), the editable device name, and the collapse chevron \u2014 plus, on an OFFLINE device that still holds mappings while a connected device of the same kind exists, the B651 \u201cmove mappings to\u2026\u201d picker that re-homes them (the only repair for a rig imported with a device key this browser does not produce). The presence lights beside the app-bar gear stack in pairs like the output LEDs. Finger echo circles are drawn by the overlay itself (slice zone) and a glued sibling canvas (output panel) with the styles shown. The rig persists to localStorage fold-inputs-v1 everywhere + fold-config.json in userData under Electron.', [
    el('div', { class: 'lab-matrix' }, [
      matrixRow('Sheet tabs · .set-tabs', [['.toggle / .active', tabs]]),
      matrixRow('Presence lights · .in-lights', [
        ['1 device', inLightsEl(1)],
        ['2 devices', inLightsEl(2)],
        ['5 devices', inLightsEl(5)],
      ]),
      matrixRow('Finger echo (remote)', [['rgba(255,255,255,.12) fill / .35 stroke', fingerEchoCard()]]),
    ]),
    el('div', { class: 'lab-note', text: 'Device groups + mapping rows (states: connected/offline header, pad row with LED swatch, action row with mode disabled):' }),
    devices,
    el('div', { class: 'lab-note', text: 'Drag-reorder states: .in-dragging dims the moving row, and .in-drop-slot is a skeleton the exact height of the row being dragged, so the neighbours part by the space the row will actually occupy (B639 — the previous 2px insertion line showed WHERE but not HOW MUCH, and was painted on a neighbouring row rather than in the gap you were aiming at):' }),
    dragging,
    el('div', { class: 'lab-note', text: 'Per-form + modifier states (B624/B629). Row 1 and row 2 share ONE control: only the one whose target belongs to the active form acts, and the other dims (.in-idle) for 400ms so you can see which is listening. Row 3 is a MODIFIER — flagged with .in-mod.active, it drives no target of its own so target/mode/sens are disabled. Row 4 is the SHIFTED binding it unlocks; its kind chip reads +<modifier> instead of the signal kind. Row 5 is a freshly learned row, which lands unassigned (B619) rather than defaulting to a live parameter:' }),
    states,
    el('div', { class: 'lab-note', text: 'Duplicate-binding prompt (.in-dupask). LEARN shows this inline at the top of the mapping list when the captured control is already mapped — not a modal, because the decision is about the list you are looking at. It names when a second binding is CORRECT rather than only warning:' }),
    inDupAskEl(),
  ]);
}

// ---- compose the page -------------------------------------------------------
function build() {
  buildUsageIndex();   // scan the loaded CSS so each token can show its consumers
  // Auto-discover every token straight from tokens.css and bucket it (Node-tested in lab-tokens.js).
  const { groups, unfiled } = groupTokens(discoverTokens(tokensText));
  const content = el('div', { class: 'lab-main' }, [
    el('header', { class: 'lab-header' }, [
      el('h1', { class: 'lab-h1', text: 'Fold · UI Lab' }),
      el('p', { class: 'lab-note', text: 'The design system in isolation, a visual inventory, and a usage instrument. Token sections are auto-discovered from tokens.css — add a token there and it appears here with a live value + usage count (no edit to the Lab). Every value is read live; the n× badge lists where each token is consumed (click to expand). A 0× badge means an unused token (a candidate to cut); the "unfiled" section, if present, flags a token no group rule has claimed yet.' }),
    ]),
    ...groups.filter((g) => g.tokens.length).map(tokenSection),
    unfiled.length ? unfiledSection(unfiled) : null,
    textStylesSection(),
    iconsSection(),
    cursorsSection(),
    affordancesSection(),
    componentsSection(),
    saveToastSection(),
    inputsSection(),
    buildingBlocksSection(),
    compositesSection(),
    pipSection(),
    crossDeviceStatesSection(),
  ]);

  // if introspection found nothing (e.g. opened over file://), explain it
  if (USAGE.size === 0) content.insertBefore(usageBanner(), content.children[1]);

  // build the sticky nav from the sections actually present
  const navItems = [...content.querySelectorAll('.lab-section')].map((s) =>
    el('a', { class: 'lab-navlink', href: `#${s.id}`, text: s.querySelector('.lab-h2').textContent }));
  const cliModal = cheatSheetModal('CLI cheat sheet', CLI_COMMANDS);
  const cliBtn = el('button', { class: 'lab-cli-open', text: '⌘ CLI cheat sheet' });
  cliBtn.addEventListener('click', () => { cliModal.hidden = false; });
  const urlModal = cheatSheetModal('URL parameter cheat sheet', LINK_PARAMS);
  const urlBtn = el('button', { class: 'lab-cli-open', text: '? URL parameters' });
  urlBtn.addEventListener('click', () => { urlModal.hidden = false; });
  const nav = el('nav', { class: 'lab-nav' }, [
    el('div', { class: 'lab-nav-title', text: 'Fold · Lab' }),
    ...navItems,
    el('div', { class: 'lab-nav-foot' }, [cliBtn, urlBtn]),
  ]);

  document.body.appendChild(el('div', { class: 'lab' }, [nav, content]));
  document.body.appendChild(cliModal);
  document.body.appendChild(urlModal);
}

// ---- lab-only layout (NOT part of the design system) ------------------------
const labStyle = document.createElement('style');
labStyle.textContent = `
  /* the app's desktop min-width floor sets html{overflow-x:auto} (styles.css @media pointer:fine),
     which makes html a scroll container (overflow-y computes to auto) and swallows wheel/trackpad
     scroll in the Lab. Return html to normal document flow so the viewport scrolls natively. */
  html { overflow: visible !important; height: auto !important; min-width: 0 !important; }
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
  .lab-usage-row { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--text-secondary); white-space: normal; overflow-wrap: anywhere; line-height: 1.5; }
  .lab-usage[hidden] { display: none; }                 /* class display:flex would otherwise beat [hidden] */
  .lab-row .lab-usebadge { justify-self: start; }       /* don't stretch across the grid track */
  .lab-list { display: flex; flex-direction: column; gap: 2px; }
  .lab-row { display: grid; grid-template-columns: 220px 150px 70px auto; align-items: center; gap: 16px; padding: 4px 0; }
  .lab-typesample { color: var(--text); white-space: nowrap; }
  .lab-radiusbox { width: 56px; height: 32px; background: var(--surface-control); border: 1px solid var(--border-strong); }
  .lab-spacebar { height: 16px; background: var(--accent); border-radius: var(--radius-xs); }
  .lab-plainchip { display: inline-block; width: 40px; height: 16px; background: var(--surface-control); border: 1px solid var(--border-subtle); border-radius: var(--radius-xs); }
  .lab-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 32px; }
  .lab-stack { display: flex; flex-direction: column; gap: 14px; align-items: flex-start; }
  .lab-ctl { display: flex; flex-direction: column; gap: 6px; width: 100%; }
  /* icons */
  .lab-grid-icon { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .lab-icon { display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface); }
  .lab-icon-previews { display: flex; align-items: center; gap: 10px; min-height: 44px; }
  .lab-icon-tile { width: 24px; height: 24px; color: var(--text); display: inline-flex; }
  .lab-icon-tile svg, .lab-icon-btn svg { width: 24px; height: 24px; display: block; }
  /* (no centering shim here — the specimen rides the REAL .ot-icon variant, so
     the Lab shows the truth; a shim was masking the off-center app buttons) */
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
  /* composites: give the full-width bars (timeline / clip) a bounded stage */
  .lab-bar-wrap { width: 420px; max-width: 100%; padding: 16px; background: var(--surface); border-radius: var(--radius-md); }
  /* modal demo: real backdrop dim + blur over faux content, scoped to a box */
  .lab-modal-demo { position: relative; height: 240px; overflow: hidden; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); }
  .lab-modal-behind { padding: 16px; height: 100%; }
  .lab-modal-demo .vid-sheet { inset: 0; }
  /* functional text styles */
  .lab-textlist { display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px; }
  .lab-textrow { display: grid; grid-template-columns: 280px 1fr; align-items: center; gap: 20px; padding: 5px 0; border-bottom: 1px solid var(--border-subtle); }
  .lab-text-sample { min-width: 0; }
  .lab-text-meta { display: flex; flex-direction: column; gap: 1px; }
  /* app icon (own full-width row, not the icon grid) */
  .lab-appicon-card { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; padding: 16px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface); }
  .lab-appicon-previews { display: flex; align-items: flex-end; gap: 18px; }
  .lab-appicon-cell { display: flex; flex-direction: column; align-items: center; gap: 4px; color: var(--text); }
  .lab-appicon-meta { flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: 4px; }
  /* file:// usage banner */
  .lab-banner { margin: 16px 0; padding: 10px 14px; border: 1px solid rgba(232, 200, 112, 0.4); background: rgba(232, 200, 112, 0.1); border-radius: var(--radius-md); font-size: var(--text-sm); color: var(--warn-text); line-height: 1.5; }
  .lab-banner code { font-family: var(--font-mono); color: var(--text); }
  /* nav footer + the cheat-sheet buttons (CLI, URL parameters) */
  .lab-nav-foot { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 6px; }
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
