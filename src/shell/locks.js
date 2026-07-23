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

// Toggleable lock defaults per mode. `still: null` = not lockable in still (freely editable
// there — the change is harmless off the timeline); a boolean = lockable, with that default
// state. Everything is lockable + locked-by-default in motion.
export const TOGGLEABLE_LOCKS = {
  segments:     { still: false, motion: true },   // fat-finger (still, once tuned) + structural (motion)
  drosteOffset: { still: false, motion: true },   // fat-finger only — does NOT seam
  spiral:       { still: null,  motion: true },   // structural: seams if animated, applies everywhere
  mirror:       { still: null,  motion: true },
  wedgeMirror:  { still: null,  motion: true },
  oobMode:      { still: null,  motion: true },
  form:         { still: null,  motion: true },   // most disruptive — restructures the whole animation
};

const WHY = {
  structural: 'locked — this applies to the whole animation. unlock to change it across every keyframe.',
  offset:     'locked — easy to nudge by accident. unlock to adjust.',
  resolution: 'locked while broadcasting. stop the broadcast to change resolution.',
  aspect:     'locked during playback. pause to change the canvas aspect.',
};

function toggleableWhy(key) {
  return key === 'drosteOffset' ? WHY.offset : WHY.structural;
}

// The current lock state of a control.
//   ctx = { session, motionActive, playing, broadcasting }
//   returns { locked, lockable, unlockable, why }. `lockable:false` = the padlock should be
//   HIDDEN here (the control isn't lockable in this mode — e.g. spiral/oob in still).
export function lockState(ctx, key) {
  // contextual auto-locks first (can't be toggled — clear the context instead)
  if (key === 'outputRes' && ctx.broadcasting) return { locked: true, lockable: true, unlockable: false, why: WHY.resolution };
  if (key === 'frameAspect' && ctx.playing)    return { locked: true, lockable: true, unlockable: false, why: WHY.aspect };

  const def = TOGGLEABLE_LOCKS[key];
  if (!def) return { locked: false, lockable: false };
  const modeDefault = ctx.motionActive ? def.motion : def.still;
  if (modeDefault === null) return { locked: false, lockable: false };   // not lockable in this mode → hide padlock
  const override = ctx.session.locks && ctx.session.locks[key];
  const locked = override !== undefined ? override : modeDefault;
  return { locked, lockable: true, unlockable: true, why: locked ? toggleableWhy(key) : 'unlocked — click to lock' };
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
export function makeLockToggle(env, key, onChange) {
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
    env.setLock?.(key, !st.locked);
    sync();
    onChange && onChange();
  });
  btn.sync = sync;
  sync();
  return btn;
}
