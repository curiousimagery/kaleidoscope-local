// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// mobile/icons.js — inline SVG icons for the mobile chrome tab bar + menus.
// Monochrome, stroke = currentColor (so a parent's color drives them; the live
// record dot turns red in the source menu, monochrome in the tab bar). These are
// functional placeholders — icon polish is a tracked backlog item.

export const ICONS = {
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.2"/></svg>`,
  record: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>`,
  // Google Material "switch camera"-style camera glyph (Daniel-supplied), recolored to
  // currentColor. Normalized to a 0 0 24 24 viewBox (the rest of the set) by wrapping the
  // 960-unit path in a scale+translate — renders identically, just on-grid.
  captureCam: `<svg viewBox="0 0 24 24" fill="currentColor"><g transform="scale(0.025) translate(0 960)"><path d="M480-576h296q-22-66-70.5-116.5T592-769L480-576Zm-83 48 148-256q-17-2-33-5t-32-3q-54 0-103.5 18.5T285-723l112 195Zm-225 96h225L249-689q-40 43-60.5 97T168-480q0 13 1 25t3 23Zm196 241 112-193H184q23 66 70 117t114 76Zm112 23q53 0 102.5-18t92.5-51L563-432 415-176q16 2 32 5t33 3Zm231-103q38-43 59.5-96.5T792-480q0-12-1-24t-3-24H563l148 257ZM480-480Zm0 384q-80 0-150-30t-122-82q-52-52-82-122T96-480q0-80 30-149.5t82-122Q260-804 330-834t150-30q80 0 149.5 30t122 82.5Q804-699 834-629.5T864-480q0 80-30 150t-82.5 122q-52.5 52-122 82T480-96Z"/></g></svg>`,
  photo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5L5 19"/></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 11l5 5 5-5"/><path d="M5 20h14"/></svg>`,
  // camera flip — Daniel-supplied shape (arrowheads NOT touching the arc ends),
  // normalized to the 0 0 24 24 grid + currentColor via a centring transform (his
  // 18×14 art → scaled 1.3 about its centre; stroke 1.5×1.3 ≈ 2 to match the set).
  // FALLBACK (old): two arcs `M6.36 9.95 A6 6 0 0 1 18 12` + `M16.2 10.2 L18 12 L19.8 10.2`
  //   + `M17.64 14.05 A6 6 0 0 1 6 12` + `M7.8 13.8 L6 12 L4.2 13.8`, stroke-width 2.
  flip: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><g transform="translate(12 12) scale(1.3) translate(-9.02 -7.03)"><path d="M6.48298 2.68826C7.24746 2.24113 8.11642 2.00373 9.00205 2.00004C9.88767 1.99636 10.7586 2.22652 11.5268 2.66727C12.2949 3.10803 12.9331 3.74375 13.3769 4.51019C13.8206 5.27663 14.0542 6.14663 14.054 7.03226V8.07126M11.397 11.4693C10.6304 11.8797 9.77043 12.0843 8.90112 12.0633C8.0318 12.0422 7.1828 11.7961 6.43695 11.3491C5.69111 10.902 5.0739 10.2692 4.64556 9.51246C4.21722 8.7557 3.99238 7.90083 3.99298 7.03126V5.79426"/><path d="M11.833 6.47727L14.055 8.69927L16.278 6.47727M6.21499 7.58627L3.99299 5.36427L1.76999 7.58627"/></g></svg>`,
  // stop / freeze — pairs with the filled record dot (filled shape, not line-art)
  stop: `<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2.5" fill="currentColor"/></svg>`,
  sliders: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="9" cy="8" r="2.4" fill="currentColor"/><circle cx="15" cy="16" r="2.4" fill="currentColor"/></svg>`,
  target: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="2.2"/><path d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21"/></svg>`,
  expand: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>`,
  contract: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5"/></svg>`,
  // undo / redo / swap — real SVG icons replacing the unicode ← → ⇄ in the desktop bar
  // (Build 221, first attempts — Daniel may replace with authored SVGs). 2px round strokes
  // to match the set.
  undo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h11a5 5 0 0 1 0 10H8"/><path d="M7 6 4 9l3 3"/></svg>`,
  redo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 9H9a5 5 0 0 0 0 10h7"/><path d="M17 6l3 3-3 3"/></svg>`,
  swap: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13"/><path d="M14 5l3 3-3 3"/><path d="M20 16H7"/><path d="M10 13l-3 3 3 3"/></svg>`,
};
