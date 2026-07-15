// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/program-frame.js
//
// THE PROGRAM FRAME — Fold's instance of the commit cell (stage/commit-cell.js):
// the single published snapshot of "the look the audience sees". It replaces the
// old pattern where every output consumer (record bus, output window, live PiP,
// future HDMI / NDI / native capture) read the live mutable `state` on its own
// loop and correctness leaned on one-off locks. The rule now: ONE writer commits
// an immutable param snapshot at a defined point per frame; consumers read
// committed frames only.
//
// WHO the presentable look is — the exact precedence env.programState() has
// always had (it moved here from perform-runtime): perform's follower snapshot
// ?? motion staging's committed loop ?? the working state.
//
// WHEN it commits — two regimes:
//   · AUTOMATION OWNS THE FRAME (motion playback/scrub, perform, staging, the
//     take blend): those loops call env.commitFrame() right after producing the
//     frame's look. A read between ticks returns the last committed frame —
//     never a manual transient the automation is about to clobber. (Today the
//     motion edit lock also blocks such transients upstream; the discipline no
//     longer depends on it.)
//   · MANUAL MODES (everything else): with no automation owning the state, the
//     live look IS the program by definition — dragging a slider moves the
//     broadcast, always has, must keep doing so. Reads commit on demand, so
//     manual edits reach every consumer with zero added latency and a missed
//     commit point can never freeze a broadcast.
//
// The frame governs PARAMS only. Source-pixel freshness (camera/video texture
// upload, the seek guard) stays each consumer's separate concern — that split
// is what keeps this contained. Undo/redo is untouched: the frame is a
// read-side copy, never a second source of truth; restoring state simply
// republishes on the next commit.

import { createCommitCell } from '../stage/commit-cell.js';

// param snapshots are flat (numbers / strings / booleans), so shallow equality
// is exact — this is what keeps gen meaning "the look actually changed"
function paramsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

export function createProgramFrame(env) {
  const cell = createCommitCell({ equals: paramsEqual });

  // the presentable look: perform's follower first, then motion staging's
  // committed loop (stays on-air while keyframes are edited off-air), else
  // the working state
  function presentable() {
    if (env.performRT?.active && env.performRT.followed) return env.performRT.followed;
    const staged = env.motionStageLive?.();
    return staged || env.state;
  }

  // true while an automation loop owns the frame's look — those loops are the
  // commit points, and a read must NOT re-commit (it could catch a manual
  // transient in `state` mid-tick)
  function automationOwned() {
    return !!(env.performRT?.active
      || env.motionStageLive?.()
      || (env.motionRT?.active && (env.motion?.playing || env.motionRT.scrubbing)));
  }

  function commitFrame() {
    return cell.commit({ ...presentable() });
  }

  // the committed frame { value, gen, t } — value is the param snapshot
  function programFrame() {
    if (!automationOwned()) commitFrame();
    return cell.read();
  }

  env.commitFrame = commitFrame;
  env.programFrame = programFrame;
  // the accessor every output consumer already calls — same signature, but it
  // now returns the COMMITTED look instead of a live reference
  env.programState = () => programFrame().value;
}
