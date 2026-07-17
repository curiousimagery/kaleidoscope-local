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

export function createSaveFlow({ host = null } = {}) {
  let toast = null, label = null, retryBtn = null, hideTimer = 0;

  function ensureToast() {
    if (toast) return;
    const style = document.createElement('style');
    style.textContent = `
      .save-toast {
        position: fixed; left: 50%; transform: translateX(-50%);
        bottom: calc(16px + env(safe-area-inset-bottom, 0px));
        z-index: 2600; display: none; align-items: center; gap: 10px;
        max-width: min(86vw, 480px); padding: 9px 14px; border-radius: 999px;
        background: var(--panel-bg, rgba(28, 28, 30, 0.92));
        color: var(--text, #eee); border: 1px solid var(--panel-border, rgba(255,255,255,0.14));
        font: 12px/1.35 var(--font-ui, system-ui, sans-serif);
        box-shadow: 0 6px 24px rgba(0,0,0,0.35); backdrop-filter: blur(10px);
        pointer-events: none;
      }
      .save-toast.on { display: flex; }
      .save-toast .save-toast-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .save-toast.ok { border-color: var(--ok, #34c759); }
      .save-toast.fail { border-color: var(--error, #ff453a); pointer-events: auto; }
      .save-toast button {
        all: unset; cursor: pointer; padding: 2px 10px; border-radius: 999px;
        background: var(--error, #ff453a); color: #fff; font-weight: 600;
      }
      /* all:unset strips the UA's [hidden]{display:none} — restore it, or the
         retry button haunts SUCCESS toasts (Daniel's iPhone confusion) */
      .save-toast button[hidden] { display: none; }
    `;
    document.head.appendChild(style);
    toast = document.createElement('div');
    toast.className = 'save-toast';
    label = document.createElement('span');
    label.className = 'save-toast-label';
    retryBtn = document.createElement('button');
    retryBtn.textContent = 'retry';
    toast.append(label, retryBtn);
    document.body.appendChild(toast);
  }

  // kind: 'busy' | 'ok' | 'fail'; onRetry only for 'fail'; ttl auto-hides
  function show(kind, text, { onRetry = null, ttl = 0 } = {}) {
    ensureToast();
    clearTimeout(hideTimer);
    toast.className = `save-toast on ${kind === 'busy' ? '' : kind}`;
    label.textContent = text;
    retryBtn.hidden = !onRetry;
    retryBtn.onclick = onRetry;
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

  return { save };
}
