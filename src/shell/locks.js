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

// STRUCTURAL controls apply to the whole animation (they're pinned to keyframe 0 / are global
// output framing), so they lock in a MOTION authoring context once there's ≥1 manual keyframe
// (keyframeCount ≥ 2, matching canEditDiscrete) OR whenever output is live — in ANY mode. They
// are UNLOCKED in still, in motion before the first manual keyframe, and in idle perform, so
// setting up defaults stays friction-free. Unlock (with a warning) applies the change everywhere.
const STRUCTURAL = new Set(['segments', 'spiral', 'mirror', 'wedgeMirror', 'oobMode', 'form', 'frameAspect']);
// These can't change while output is LIVE (they're tied to the encoder's dimensions), so during
// broadcast/record they're a contextual lock — not user-unlockable (stop output to change).
const ENCODER_TIED = new Set(['frameAspect']);

const WHY = {
  structural: 'locked — this applies to the whole animation. unlock to change it across every keyframe.',
  offset:     'locked — easy to nudge by accident. unlock to adjust.',
  resolution: 'locked while broadcasting. stop the output to change resolution.',
  aspect:     'locked while broadcasting. stop the output to change the frame aspect.',
};
function toggleableWhy(key) { return key === 'drosteOffset' ? WHY.offset : WHY.structural; }

// The current lock state of a control.
//   ctx = { session, motionActive, keyframeCount, outputLive }
//   returns { locked, lockable, unlockable, why }. `lockable:false` = padlock HIDDEN (the
//   control is freely editable in this context — keep the surface clean).
export function lockState(ctx, key) {
  const { session, motionActive, keyframeCount = 0, outputLive = false } = ctx;

  // resolution: only ever a broadcast-contextual lock (not structural, not user-unlockable)
  if (key === 'outputRes') {
    return outputLive ? { locked: true, lockable: true, unlockable: false, why: WHY.resolution }
                      : { locked: false, lockable: false };
  }

  if (STRUCTURAL.has(key)) {
    const motionLock = motionActive && keyframeCount >= 2;   // after the first MANUAL keyframe
    if (!(motionLock || outputLive)) return { locked: false, lockable: false };   // editable → no padlock
    if (ENCODER_TIED.has(key) && outputLive) {
      return { locked: true, lockable: true, unlockable: false, why: WHY.aspect };   // hard-locked during output
    }
    const override = session.locks && session.locks[key];
    const locked = override !== undefined ? override : true;   // default locked in the locking context
    return { locked, lockable: true, unlockable: true, why: locked ? toggleableWhy(key) : 'unlocked — click to lock' };
  }

  // center offset: fat-finger opt-in (does NOT seam) — always available in Droste, default UNLOCKED.
  if (key === 'drosteOffset') {
    const override = session.locks && session.locks[key];
    const locked = override !== undefined ? override : false;
    return { locked, lockable: true, unlockable: true, why: locked ? WHY.offset : 'unlocked — click to lock' };
  }

  return { locked: false, lockable: false };
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
