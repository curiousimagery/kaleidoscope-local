// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// boot.js
//
// Chrome selection. The mobile chrome targets phone-class viewports; iPad and
// desktop stay on the desktop chrome (iPad is the live-camera capture surface
// and its short side is ≥ 768). `?chrome=mobile|desktop` overrides for testing.
//
// Desktop runs unchanged: importing `./main.js` executes it exactly as before
// (this file only changes which module loads, not how the desktop chrome works).

const params = new URLSearchParams(location.search);
const override = params.get('chrome');

// Mobile chrome when the window is narrow (< 700px — covers narrowed desktop
// windows and phones in portrait) OR any coarse-pointer device whose short side
// is < 600px (covers phones in landscape too). iPad (short side ≥ 768) stays on
// the desktop chrome. Evaluated at load — resizing across the breakpoint needs a
// reload to switch.
const narrow = window.innerWidth < 700;
const phoneClass =
  matchMedia('(pointer: coarse)').matches &&
  Math.min(window.innerWidth, window.innerHeight) < 600;

const useMobile = override === 'mobile' || (override !== 'desktop' && (narrow || phoneClass));

if (useMobile) {
  // Drop the desktop stylesheet (a static <link> in the shared index.html) so its
  // `body { display: flex }` split-layout doesn't squeeze the mobile chrome into a
  // narrow column. At boot time it's the only stylesheet present — the mobile
  // chrome's own CSS is injected later when chrome.js imports it. (Done here, by
  // element, because Vite strips the id we'd otherwise target.)
  document.querySelectorAll('link[rel="stylesheet"]').forEach((l) => l.remove());
  import('./mobile/chrome.js');
} else {
  import('./main.js');
}
