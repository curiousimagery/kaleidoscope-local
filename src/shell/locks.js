// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// locks.js
//
// Per-control lock state (M3 guardrails). A "lock" guards a control from accidental or
// disruptive edits. TWO kinds live under ONE padlock visual:
//   - TOGGLEABLE (session locks): the user clicks the padlock to unlock. Default per mode
//     (still / motion). Unlocking a motion-structural control opts into changes that apply
//     to the WHOLE animation — the timeline holds discrete settings at keyframe 0, so a
//     change is global by construction (no separate "apply to all" step).
//   - CONTEXTUAL (auto): locked by the current situation, NOT user-unlockable — cleared by
//     changing the context (stop broadcasting / pause playback).
//
// Locks are SESSION-EPHEMERAL: `session.locks` holds user overrides and resets each session.
// It's a flat map so it can later be lifted to persisted user prefs unchanged (not yet).

import { ICONS } from '../mobile/icons.js';

// TWO lock CATEGORIES (they can overlap on one control):
//
//   FAT-FINGER — direct-manipulation gestures that are easy to trigger by accident (the radial
//   segment spokes). ALWAYS lockable (the padlock is present in every mode), DEFAULT UNLOCKED —
//   a pure opt-in. Locking one just guards the gesture; it doesn't restructure anything.
//
//   STRUCTURAL — settings pinned to keyframe 0 / global output framing, so a change applies to
//   the WHOLE animation. Auto-locked (DEFAULT LOCKED) in a locking context — a MOTION authoring
//   context with ≥1 manual keyframe (keyframeCount ≥ 2, matching canEditDiscrete) OR whenever
//   output is live, in ANY mode. Unlocked in still / motion-before-first-manual-kf / idle perform.
//   Unlocking (with a warning) applies the change everywhere.
//
// A control that is BOTH (segments) shows the padlock in every mode: default unlocked as a
// fat-finger opt-in, default locked once the structural context kicks in.
const FAT_FINGER = new Set(['segments']);
const STRUCTURAL = new Set(['segments', 'spiral', 'mirror', 'wedgeMirror', 'oobMode', 'form', 'frameAspect']);
// These can't change while output is LIVE (they're tied to the encoder's dimensions), so during
// broadcast/record they're a contextual lock — not user-unlockable (stop output to change).
const ENCODER_TIED = new Set(['frameAspect']);

const WHY = {
  structural: 'locked — this applies to the whole animation. unlock to change it across every keyframe.',
  fatFinger:  'locked to prevent accidental drags. unlock to adjust.',
  resolution: 'locked while broadcasting. stop the output to change resolution.',
  aspect:     'locked while broadcasting. stop the output to change the frame aspect.',
};

// The current lock state of a control.
//   ctx = { session, motionActive, keyframeCount, outputLive }
//   returns { locked, lockable, unlockable, why }. `lockable:false` = padlock HIDDEN (the
//   control is freely editable in this context — keep the surface clean).
export function lockState(ctx, key) {
  const { session, motionActive, keyframeCount = 0, outputLive = false } = ctx;

  // center offset: NO padlock anymore — its manual gesture is governed by the two-toggle on the
  // offset row (session.offsetManual, default false = the diamond can't be dragged). This returns
  // only the ENFORCEMENT signal the overlay reads; lockable:false = no padlock is injected.
  if (key === 'drosteOffset') {
    return { locked: !(session.offsetManual), lockable: false };
  }

  // resolution: only ever a broadcast-contextual lock (not structural, not user-unlockable)
  if (key === 'outputRes') {
    return outputLive ? { locked: true, lockable: true, unlockable: false, why: WHY.resolution }
                      : { locked: false, lockable: false };
  }

  const structuralCtx = (motionActive && keyframeCount >= 2) || outputLive;   // the locking context
  const structuralLock = STRUCTURAL.has(key) && structuralCtx;
  const lockable = FAT_FINGER.has(key) || structuralLock;
  if (!lockable) return { locked: false, lockable: false };   // freely editable here → no padlock

  // encoder-tied dims (aspect) can't change while output is live → hard contextual lock
  if (ENCODER_TIED.has(key) && outputLive) {
    return { locked: true, lockable: true, unlockable: false, why: WHY.aspect };
  }

  const override = session.locks && session.locks[key];
  const locked = override !== undefined ? override : structuralLock;   // default: locked iff structural context
  const why = structuralLock ? WHY.structural : WHY.fatFinger;
  return { locked, lockable: true, unlockable: true, why: locked ? why : 'unlocked — click to lock' };
}

// Flip a toggleable lock for the session (writes the explicit override).
export function setLock(session, key, locked) {
  if (!session.locks) session.locks = {};
  session.locks[key] = locked;
}

// ---- the padlock glyph — sourced from the canonical ICONS set (so it lives in the icon
// inventory, not as a one-off here). lock = closed, lockOpen = open shackle. --------------
export const LOCK_ICON = { locked: ICONS.lock, unlocked: ICONS.lockOpen };

// Build a padlock toggle button bound to `key`. Reads env.isLocked(key), renders the right
// glyph + state class + tooltip, and on click flips the lock (only when unlockable) then
// calls onChange so the host can re-sync the affected control's disabled state.
export function makeLockToggle(env, key, onChange, confirmUnlock) {
  const btn = document.createElement('button');
  btn.className = 'lock-toggle';
  btn.dataset.lockKey = key;
  const sync = () => {
    const st = env.isLocked ? env.isLocked(key) : { locked: false, lockable: false };
    btn.hidden = st.lockable === false;   // not lockable in this mode → no padlock at all
    if (btn.hidden) return;
    btn.classList.toggle('locked', !!st.locked);
    btn.classList.toggle('contextual', st.locked && !st.unlockable);
    btn.innerHTML = st.locked ? LOCK_ICON.locked : LOCK_ICON.unlocked;
    btn.title = st.why || (st.locked ? 'locked' : 'unlocked — click to lock');
    // a contextual lock isn't clickable (clear the context instead)
    btn.disabled = st.locked && !st.unlockable;
  };
  btn.addEventListener('click', () => {
    const st = env.isLocked ? env.isLocked(key) : { locked: false };
    if (!st.unlockable) return;                 // contextual — no-op
    if (st.locked && confirmUnlock && !confirmUnlock()) return;   // unlocking a disruptive control → confirm first
    env.setLock?.(key, !st.locked);
    sync();
    onChange && onChange();
  });
  btn.sync = sync;
  sync();
  return btn;
}
