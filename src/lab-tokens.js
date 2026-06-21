// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// lab-tokens.js — token AUTO-DISCOVERY for the UI Lab.
//
// The Lab used to render hand-listed token arrays (NEUTRALS, SEM_TEXT, RADII, …) that had to
// be edited by hand every time tokens.css gained a token. This instead DISCOVERS every custom
// property declared in tokens.css straight from the source text and assigns each to a curated
// group, so a NEW token shows up on its own — in its group if a rule claims it, else in the
// "unfiled" bucket (the drift flag). Add a token to tokens.css and it appears in the Lab with a
// live value + usage count, no edit here. New CATEGORIES still need one manual TOKEN_GROUPS rule
// (the title/render/predicate); after that, variants matching the rule are automatic.
//
// Pure string logic — no DOM, no CSS import — so the SAME code path runs in Node and is
// validatable headless (the rendering in lab.js is what can't be headless-checked). Predicates
// are NAME-based, not value-based, so they work on the raw text without resolving var() refs.
// Groups are ordered; first match wins.

export const TOKEN_GROUPS = [
  { id: 'primitives', title: 'Primitives · neutral ramp', render: 'swatch',
    note: 'Raw palette, dark → light. Post-collapse set (each step ≥6 apart). Auto-discovered from tokens.css.',
    match: (n) => /^--c-(neutral|black|white)/.test(n) },
  { id: 'accents', title: 'Primitives · accents', render: 'swatch',
    note: 'Hue primitives. Record red = --danger (--c-red-600); the old mobile variant #e8504a was removed (0 consumers).',
    match: (n) => /^--c-/.test(n) },
  { id: 'surfaces', title: 'Semantic · surfaces', render: 'swatch',
    note: 'What CSS consumes for backgrounds. Edit these, not the primitives.',
    match: (n) => n === '--bg' || /^--surface/.test(n) },
  { id: 'borders', title: 'Semantic · borders', render: 'swatch', note: null,
    match: (n) => /^--border/.test(n) },
  { id: 'text', title: 'Semantic · text', render: 'swatch',
    note: 'Text + element-fill colors. (The numeric size ramp is under Type.)',
    match: (n) => n === '--text' || /^--text-(bright|secondary|dim|muted|faint)\b/.test(n)
      || n === '--fill-bright' || n === '--on-accent' },
  { id: 'intent', title: 'Semantic · intent', render: 'swatch', note: 'Accent / state colors.',
    match: (n) => /^--accent$|^--ok$|^--danger|^--warn|^--info$|^--focus$/.test(n) },
  { id: 'type', title: 'Type · size ramp', render: 'type', note: null,
    match: (n) => /^--text-(2xs|xs|sm|base|md|lg|xl|2xl|3xl|4xl)$/.test(n) },
  { id: 'font', title: 'Type · families', render: 'font', note: null,
    match: (n) => /^--font/.test(n) },
  { id: 'radii', title: 'Radii', render: 'radius', note: null,
    match: (n) => /^--radius/.test(n) },
  { id: 'spacing', title: 'Spacing', render: 'space',
    note: 'The scale exists; stylesheet adoption is an in-progress follow-up (many read 0×).',
    match: (n) => /^--space/.test(n) },
  { id: 'control', title: 'Control / state', render: 'plain',
    note: 'Durations, opacities, hit size, focus ring. (Surfaced by auto-discovery — these were not listed before.)',
    match: (n) => /^--(touch-target|focus-ring|disabled-opacity|dur)/.test(n) },
];

// Every `--name:` DECLARATION in the source, in document order, deduped. Comments are stripped
// first so a hex inside a comment can't masquerade as a token; `var(--x)` USAGES aren't matched
// (no trailing colon). A re-declaration (e.g. --touch-target in a @media block) keeps the first.
export function discoverTokens(cssText) {
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const names = [];
  const seen = new Set();
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
    if (!seen.has(m[1])) { seen.add(m[1]); names.push(m[1]); }
  }
  return names;
}

// Assign each discovered token to the first group whose predicate claims it; anything unclaimed
// falls into `unfiled` — a new token that needs a TOKEN_GROUPS rule (or a rename). The drift flag;
// normally empty.
export function groupTokens(names) {
  const groups = TOKEN_GROUPS.map((g) => ({ ...g, tokens: [] }));
  const unfiled = [];
  for (const n of names) {
    const g = groups.find((gr) => gr.match(n));
    if (g) g.tokens.push(n); else unfiled.push(n);
  }
  return { groups, unfiled };
}
