// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// interrupt.js
//
// The shared DESTRUCTIVE-INTERRUPT confirm (M3). A small, NON-BLOCKING modal that replaces
// window.confirm — which on iOS WKWebView blocks the JS main thread (and with it the rAF render /
// live-broadcast loop), so confirming a form unlock mid-broadcast froze/paused the output (Daniel).
// Non-blocking means the render + output pipeline keeps running while the dialog is up.
//
// Reuses the video-sheet chrome (.vid-sheet backdrop + .vid-card) so it inherits the design system.
// This is also the home for the pending source-swap "keep positions / start fresh" dialog.

let current = null;   // one interrupt at a time

// confirmInterrupt({ title, body, confirmLabel, cancelLabel, onConfirm, onCancel, danger,
//                    secondaryLabel, onSecondary })
// Returns a handle with .dismiss(). onConfirm/onCancel fire on resolve. An optional SECONDARY action
// (e.g. "discard & load" beside a primary "save & load") renders a third button.
export function confirmInterrupt(opts) {
  const {
    title, body,
    confirmLabel = 'continue', cancelLabel = 'cancel',
    secondaryLabel, onSecondary,
    onConfirm, onCancel, danger = true,
  } = opts;

  if (current) current.dismiss(false);   // supersede any open interrupt

  const sheet = document.createElement('div');
  sheet.className = 'vid-sheet interrupt-sheet';
  const card = document.createElement('div');
  card.className = 'vid-card interrupt-card';

  const head = document.createElement('div');
  head.className = 'vid-head';
  const titleEl = document.createElement('span');
  titleEl.textContent = title;
  const x = document.createElement('button');
  x.className = 'vid-x'; x.type = 'button'; x.textContent = '✕'; x.title = 'cancel';
  head.append(titleEl, x);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'interrupt-body';
  bodyEl.textContent = body;

  const actions = document.createElement('div');
  actions.className = 'interrupt-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'interrupt-btn'; cancelBtn.type = 'button'; cancelBtn.textContent = cancelLabel;
  let secondaryBtn = null;
  if (secondaryLabel) {
    secondaryBtn = document.createElement('button');
    secondaryBtn.className = 'interrupt-btn interrupt-secondary';
    secondaryBtn.type = 'button'; secondaryBtn.textContent = secondaryLabel;
  }
  const okBtn = document.createElement('button');
  okBtn.className = 'interrupt-btn interrupt-confirm' + (danger ? ' danger' : '');
  okBtn.type = 'button'; okBtn.textContent = confirmLabel;
  actions.append(cancelBtn, ...(secondaryBtn ? [secondaryBtn] : []), okBtn);

  card.append(head, bodyEl, actions);
  sheet.appendChild(card);
  document.body.appendChild(sheet);

  const dismiss = (result) => {   // 'confirm' | 'secondary' | 'cancel'
    if (current !== handle) return;
    current = null;
    document.removeEventListener('keydown', onKey, true);
    sheet.remove();
    (result === 'confirm' ? onConfirm : result === 'secondary' ? onSecondary : onCancel)?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); dismiss('cancel'); }
    else if (e.key === 'Enter') { e.preventDefault(); dismiss('confirm'); }
  };
  document.addEventListener('keydown', onKey, true);
  x.addEventListener('click', () => dismiss('cancel'));
  cancelBtn.addEventListener('click', () => dismiss('cancel'));
  secondaryBtn?.addEventListener('click', () => dismiss('secondary'));
  okBtn.addEventListener('click', () => dismiss('confirm'));
  sheet.addEventListener('click', (e) => { if (e.target === sheet) dismiss('cancel'); });   // backdrop tap

  const handle = { dismiss };
  current = handle;
  okBtn.focus();
  return handle;
}
