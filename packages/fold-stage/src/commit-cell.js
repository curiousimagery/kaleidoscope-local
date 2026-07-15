// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// stage/commit-cell.js
//
// The COMMIT CELL — the mechanism half of the program-snapshot discipline
// (Capacitor arc, Lane 4A). A single-writer, latest-value container: the app
// commits an immutable value ("this look is now the program"), and every
// consumer reads the last committed frame { value, gen, t } on its own clock.
// `gen` is a monotonic generation counter that bumps only when the committed
// value actually changes (per the app-supplied equality), so consumers can
// cheaply detect change; `t` marks when that look went on air.
//
// Engine-agnostic on purpose — `value` is OPAQUE to this file (it knows
// nothing about kaleidoscopes). This is the piece the shared stage/ package
// exports; Fold's instance is the PROGRAM FRAME (shell/program-frame.js,
// value = the param snapshot). A future tenant commits whatever its
// presentable look is, and a signal-heavy tool can run a SECOND cell with a
// different payload (an OSC bundle, an audio-analysis frame). What this is
// deliberately NOT: an audio-rate signal path — it is a control-rate
// commitment point, once per presentable look.
//
// Contract: the writer hands commit() a value it will never mutate again
// (the app snapshots before committing); readers treat frame.value as
// immutable. Enforced by convention, not Object.freeze (the cheap-copy call).

export function createCommitCell({ equals = null } = {}) {
  let frame = { value: null, gen: 0, t: 0 };

  return {
    // Commit a new presentable value. If it equals the current one (per the
    // app's equality), the existing frame stands — gen doesn't bump and t
    // keeps marking when this LOOK went on air, so an unchanged look is
    // never republished as new.
    commit(value) {
      if (frame.gen && equals && equals(frame.value, value)) return frame;
      frame = { value, gen: frame.gen + 1, t: performance.now() };
      return frame;
    },
    // The last committed frame. Consumers on any clock read this; one that
    // cached frame.gen can skip its work when gen hasn't moved.
    read() { return frame; },
  };
}
