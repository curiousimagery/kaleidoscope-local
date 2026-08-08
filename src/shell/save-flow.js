// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/save-flow.js
//
// ONE save path for every file the app writes — the convergence the video-save
// audit (docs/AUDIT-video-save-ux.md) called for. Two jobs:
//
// 1. TRANSPORT (the merged downloadBlob twins): host-aware — a native shell's
//    fileSystem (Capacitor share sheet, a future Electron dialog) when it
//    reports available, else the browser download. Returns a promise so every
//    caller can await + see failures.
//
// 2. STATUS — the anxiety killer. Saving was silent on every surface (the
//    iPad's multi-second chunked write, the phone's zip composition) and
//    success was never confirmed. A small toast now says what's happening:
//    nothing for instant saves (a 400ms grace so fast downloads stay quiet),
//    "saving [name]…" for real waits, "saved ✓" naming the destination, and a
//    persistent "save failed" with a RETRY button. Self-contained styling
//    (design tokens with fallbacks) so both chromes share one component.
//
// Consumed via env.downloadBlob (desktop chrome) and the mobile chrome's
// downloadBlob — every existing caller (stills, packages, video takes, rig
// export) inherits the flow with no signature change.

// Exported for the UI Lab (lab.js renders the toast's state matrix statically).
// Daniel's field notes shaped it: NEUTRAL border in every state (the green
// outline read too loud), a small ✓/✕ glyph carries the verdict, and the pill
// sits ABOVE the mobile tab bar (offset measured at show time).
export const SAVE_TOAST_CSS = `
  .save-toast {
    position: fixed; left: 50%; transform: translateX(-50%);
    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    z-index: 2600; display: none; align-items: center; gap: 8px;
    max-width: min(86vw, 480px); padding: 7px 13px; border-radius: 999px;
    background: var(--panel-bg, rgba(28, 28, 30, 0.92));
    color: var(--text-dim, #bbb); border: 1px solid var(--panel-border, rgba(255,255,255,0.14));
    font: 11px/1.35 var(--font-ui, system-ui, sans-serif);
    box-shadow: 0 6px 24px rgba(0,0,0,0.35); backdrop-filter: blur(10px);
    pointer-events: none;
  }
  .save-toast.on { display: flex; }
  .save-toast .save-toast-glyph { font-weight: 700; }
  .save-toast.ok .save-toast-glyph { color: var(--ok, #34c759); }
  .save-toast.fail .save-toast-glyph { color: var(--danger-text, #ff453a); }
  .save-toast .save-toast-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .save-toast.fail { pointer-events: auto; }
  .save-toast button {
    all: unset; cursor: pointer; padding: 2px 10px; border-radius: 999px;
    background: var(--danger-text, #ff453a); color: #fff; font-weight: 600;
  }
  .save-toast button[hidden] { display: none; }

  /* INDETERMINATE ACTIVITY (B559). Daniel, on a 254MB take: "when i click save, there isn't any
     sort of status indicator for how long this part will take... even an indeterminent indicator
     could be helpful." The write to the share sheet has no denominator we can honestly report —
     unlike the finalize, which counts down a real encoder queue — so this says WORKING rather
     than inventing a percentage. Motion is the whole message: static text on a multi-second wait
     is indistinguishable from a hung app. */
  .save-toast .save-toast-bar {
    position: absolute; left: 0; right: 0; bottom: 0; height: 2px;
    border-radius: 0 0 999px 999px; overflow: hidden; display: none;
  }
  .save-toast.busy .save-toast-bar { display: block; }
  .save-toast .save-toast-bar::after {
    content: ''; position: absolute; top: 0; bottom: 0; width: 40%;
    background: var(--text-dim, #bbb); opacity: 0.7; border-radius: 999px;
    animation: save-toast-sweep 1.1s ease-in-out infinite;
  }
  @keyframes save-toast-sweep {
    0%   { left: -40%; }
    100% { left: 100%; }
  }
  /* honor the OS setting: a reduced-motion user gets a steady bar, not a sweeping one */
  @media (prefers-reduced-motion: reduce) {
    .save-toast .save-toast-bar::after { animation: none; left: 0; width: 100%; opacity: 0.35; }
  }
`;

export function createSaveFlow({ host = null } = {}) {
  let toast = null, glyph = null, label = null, retryBtn = null, bar = null, hideTimer = 0;

  function ensureToast() {
    if (toast) return;
    const style = document.createElement('style');
    style.textContent = SAVE_TOAST_CSS;
    document.head.appendChild(style);
    toast = document.createElement('div');
    toast.className = 'save-toast';
    glyph = document.createElement('span');
    glyph.className = 'save-toast-glyph';
    label = document.createElement('span');
    label.className = 'save-toast-label';
    retryBtn = document.createElement('button');
    retryBtn.textContent = 'retry';
    bar = document.createElement('div');
    bar.className = 'save-toast-bar';
    toast.append(glyph, label, retryBtn, bar);
    document.body.appendChild(toast);
  }

  // kind: 'busy' | 'ok' | 'fail'; onRetry only for 'fail'; ttl auto-hides
  function show(kind, text, { onRetry = null, ttl = 0 } = {}) {
    ensureToast();
    clearTimeout(hideTimer);
    toast.className = `save-toast on ${kind}`;
    glyph.textContent = kind === 'ok' ? '✓' : kind === 'fail' ? '✕' : '';
    glyph.hidden = kind === 'busy';
    label.textContent = text;
    retryBtn.hidden = !onRetry;
    retryBtn.onclick = onRetry;
    // Clear the mobile tab bar when one exists (the toast must sit ABOVE it).
    //
    // THE TOAST WAS INVISIBLE IN LANDSCAPE (Daniel, B552). In portrait the tab bar is a short
    // horizontal strip and its height is the right offset. In LANDSCAPE it becomes a full-height
    // column down the right edge — so `offsetHeight` is nearly the whole viewport, and using it
    // as a bottom offset launched the toast clean off the top of the screen. He stopped a take,
    // saw no status for 20 seconds, rotated to portrait and found the success toast already
    // showing. **That silently masked every status message we ship, including B550's new
    // finalize progress** — which is why the 4K take appeared to report nothing.
    //
    // A bar that is taller than it is wide is a side rail: it needs horizontal clearance, not
    // vertical. Measure the axis that actually applies.
    const tb = document.getElementById('m-tabbar');
    const rail = tb && tb.offsetHeight > tb.offsetWidth;   // column layout = landscape rail
    toast.style.bottom = tb && tb.offsetHeight && !rail
      ? `calc(${tb.offsetHeight + 12}px + env(safe-area-inset-bottom, 0px))`
      : '';
    // in the rail case, shift the centred pill left of the bar instead of above it
    toast.style.transform = rail
      ? `translateX(calc(-50% - ${Math.round(tb.offsetWidth / 2)}px))`
      : '';
    if (ttl) hideTimer = setTimeout(hide, ttl);
  }
  function hide() {
    clearTimeout(hideTimer);
    if (toast) toast.classList.remove('on');
  }

  // → destination tag: 'share' (the sheet IS the confirmation surface) or 'downloads'
  async function transport(blob, name) {
    const fs = host && host.fileSystem;
    if (fs && fs.available) {
      await fs.save(blob, name);
      return 'share';
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return 'downloads';
  }

  async function save(blob, name) {
    let pending = true;
    // instant saves stay silent — the toast only appears for a real wait
    const grace = setTimeout(() => { if (pending) show('busy', `saving ${name}…`); }, 400);
    try {
      const dest = await transport(blob, name);
      pending = false;
      clearTimeout(grace);
      show('ok', dest === 'downloads' ? `saved to Downloads ✓ ${name}` : `saved ✓ ${name}`, { ttl: 4000 });
      return true;
    } catch (e) {
      pending = false;
      clearTimeout(grace);
      show('fail', `save failed — ${name}`, { onRetry: () => { hide(); save(blob, name); } });
      throw e;   // callers that track saved-state (the phone's unsaved-take guard) still see it
    }
  }

  // `status` opens the same toast for non-save waits the user should see honestly
  // (finalizing a take, developing a full-res still). Same states, same surface —
  // one status language app-wide. `dismiss` clears a busy status once the wait ends.
  return { save, status: show, dismiss: hide };
}
