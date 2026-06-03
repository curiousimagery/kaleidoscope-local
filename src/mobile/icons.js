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
  // Google Material "switch camera"-style camera glyph (Daniel-supplied), recolored to currentColor.
  captureCam: `<svg viewBox="0 -960 960 960" fill="currentColor"><path d="M480-576h296q-22-66-70.5-116.5T592-769L480-576Zm-83 48 148-256q-17-2-33-5t-32-3q-54 0-103.5 18.5T285-723l112 195Zm-225 96h225L249-689q-40 43-60.5 97T168-480q0 13 1 25t3 23Zm196 241 112-193H184q23 66 70 117t114 76Zm112 23q53 0 102.5-18t92.5-51L563-432 415-176q16 2 32 5t33 3Zm231-103q38-43 59.5-96.5T792-480q0-12-1-24t-3-24H563l148 257ZM480-480Zm0 384q-80 0-150-30t-122-82q-52-52-82-122T96-480q0-80 30-149.5t82-122Q260-804 330-834t150-30q80 0 149.5 30t122 82.5Q804-699 834-629.5T864-480q0 80-30 150t-82.5 122q-52.5 52-122 82T480-96Z"/></svg>`,
  photo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5L5 19"/></svg>`,
  aperture: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3l4.6 8M21 12h-9.2M19.6 16.8L12 12M12 21l-4.6-8M3 12h9.2M4.4 7.2L12 12"/></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 11l5 5 5-5"/><path d="M5 20h14"/></svg>`,
  // two half-circle arcs forming a ring, with arrowheads at the 3-o'clock (down)
  // and 9-o'clock (up) ends — vertical arrows, like the iOS camera-flip glyph.
  flip: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12 A6 6 0 0 1 18 12"/><path d="M15.5 9.5 L18 12 L20.5 9.5"/><path d="M18 12 A6 6 0 0 1 6 12"/><path d="M8.5 14.5 L6 12 L3.5 14.5"/></svg>`,
  sliders: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="9" cy="8" r="2.4" fill="#121212"/><circle cx="15" cy="16" r="2.4" fill="#121212"/></svg>`,
  target: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="2.2"/><path d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21"/></svg>`,
  expand: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>`,
  contract: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5"/></svg>`,
};
