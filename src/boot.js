// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// boot.js
//
// Chrome selection + responsive switching. The mobile chrome targets phone-class
// or narrow viewports; iPad and wide desktop stay on the desktop chrome.
// `?chrome=mobile|desktop` overrides for testing.
//
// Desktop runs unchanged: importing `./main.js` executes it exactly as before.

import { state, session } from './shell/state.js';

const params = new URLSearchParams(location.search);
const override = params.get('chrome');

// Mobile ONLY for a genuine phone-class device: a coarse-pointer device whose short
// side is < 600px (phones in either orientation). iPad (short side ≥ 768) stays desktop.
// A fine-pointer desktop window dragged narrow NO LONGER swaps — that reload dropped the
// loaded source (boot.js can't cheaply carry the footage across; see the min-width floor
// in styles.css, which lets the desktop layout scroll horizontally instead of collapsing).
// Use ?chrome=mobile to preview the mobile chrome on desktop.
function computeUseMobile() {
  if (override === 'mobile') return true;
  if (override === 'desktop') return false;
  return matchMedia('(pointer: coarse)').matches &&
    Math.min(window.innerWidth, window.innerHeight) < 600;
}

// Restore params carried across a responsive chrome switch (one-shot — a normal
// refresh still resets to defaults, so desktop behavior is unchanged). The loaded
// image is not carried (can't serialize cheaply); the slice/canvas params are.
const carried = sessionStorage.getItem('fold-chrome-switch');
if (carried) {
  sessionStorage.removeItem('fold-chrome-switch');
  try {
    const o = JSON.parse(carried);
    Object.assign(state, o.state);
    Object.assign(session, o.session);
  } catch { /* ignore malformed */ }
}

const useMobile = computeUseMobile();
if (useMobile) {
  // Drop the desktop stylesheet (static <link> in the shared index.html) so its
  // split-layout body rules don't constrain the mobile chrome. At boot it's the
  // only stylesheet present; the mobile chrome's CSS loads when chrome.js imports it.
  document.querySelectorAll('link[rel="stylesheet"]').forEach((l) => l.remove());
  import('./mobile/chrome.js');
} else {
  import('./main.js');
}

// Responsive switch: when the viewport crosses the breakpoint, persist params and
// reload into the other chrome. (A true in-place swap would need teardown the
// desktop chrome doesn't support; a reload is simple and robust. Debounced.)
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (computeUseMobile() !== useMobile) {
      sessionStorage.setItem('fold-chrome-switch', JSON.stringify({ state, session }));
      location.reload();
    }
  }, 300);
});
