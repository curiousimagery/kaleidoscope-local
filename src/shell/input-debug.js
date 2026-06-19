// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/input-debug.js
//
// A tiny, opt-in on-screen input readout for diagnosing the hybrid touch/pen/
// cursor matrix (Movink USB-C touchscreen, Sidecar iPad, desktop Safari/Firefox).
// Enabled with ?inputdebug. It captures (window, capture phase) the pointer/touch/
// gesture/wheel events that decide whether our two-finger slice gesture can work,
// and shows the last several plus the PEAK simultaneous pointer/touch count — so we
// can tell, per device + browser, whether multi-touch even reaches the browser, or
// the OS collapses it to a single pointer / the trackpad fires gesture/wheel events.
// Read-only and removable; not part of the shipped UX.

export function mountInputDebug() {
  if (typeof window === 'undefined') return;
  if (!new URLSearchParams(location.search).has('inputdebug')) return;

  const box = document.createElement('div');
  box.style.cssText = [
    'position:fixed', 'left:8px', 'bottom:8px', 'z-index:99999',
    'max-width:48vw', 'max-height:42vh', 'overflow:hidden',
    'background:rgba(0,0,0,0.82)', 'color:#7fffd4',
    'font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace',
    'padding:8px 10px', 'border-radius:6px', 'pointer-events:none',
    'white-space:pre-wrap', 'backdrop-filter:blur(4px)',
  ].join(';');
  document.body.appendChild(box);

  const lines = [];
  const activePointers = new Set();
  let peakPointers = 0, peakTouches = 0;

  function render() {
    box.textContent =
      `input-debug · peak pointers=${peakPointers} touches=${peakTouches}\n` +
      lines.join('\n');
  }
  function log(s) {
    lines.unshift(s);
    if (lines.length > 12) lines.pop();
    render();
  }

  function onPointer(e) {
    if (e.type === 'pointerdown') activePointers.add(e.pointerId);
    if (e.type === 'pointerup' || e.type === 'pointercancel') activePointers.delete(e.pointerId);
    peakPointers = Math.max(peakPointers, activePointers.size);
    if (e.type !== 'pointermove') log(`${e.type} ${e.pointerType} id=${e.pointerId} active=${activePointers.size}`);
  }
  function onTouch(e) {
    peakTouches = Math.max(peakTouches, e.touches.length);
    if (e.type !== 'touchmove') log(`${e.type} touches=${e.touches.length}`);
    else if (e.touches.length >= 2) log(`touchmove touches=${e.touches.length}`);
  }
  function onGesture(e) {
    log(`${e.type} scale=${(e.scale ?? 0).toFixed(2)} rot=${(e.rotation ?? 0).toFixed(0)}`);
  }
  function onWheel(e) {
    if (e.ctrlKey) log(`wheel ctrl=true dy=${e.deltaY.toFixed(0)} (trackpad pinch)`);
  }

  const opts = { capture: true, passive: true };
  ['pointerdown', 'pointerup', 'pointercancel', 'pointermove'].forEach((t) => window.addEventListener(t, onPointer, opts));
  ['touchstart', 'touchend', 'touchcancel', 'touchmove'].forEach((t) => window.addEventListener(t, onTouch, opts));
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => window.addEventListener(t, onGesture, opts));
  window.addEventListener('wheel', onWheel, opts);

  log('on — interact with the slice; report what appears');
}
