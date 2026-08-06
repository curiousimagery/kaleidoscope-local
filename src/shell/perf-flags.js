// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/perf-flags.js
//
// BEHAVIOR FLAGS for the optimizations that changed how the app works — each one live-toggleable
// so it can be A/B'd against itself on real hardware instead of argued about.
//
// WHY THESE EXIST. Build 513's cuts were justified by reasoning, not measurement: in each case
// the work provably produced an identical result, so skipping it cannot change what you see.
// That reasoning is sound but it is not evidence, and two of the three (the overlay ones) were
// shipped precisely because Daniel wanted the numbers on them. A flag makes the A/B a two-tap
// operation on the device instead of a pair of builds.
//
// They are NOT user settings and never will be. They default to the shipped behavior (all
// optimizations ON) and are reachable only from the frame-cost panel. Nothing persists: a reload
// returns to the shipped behavior, so the app cannot be left in a de-optimized state by accident.
//
// A flag that proves its optimization worthless should be DELETED along with the optimization —
// this file is a measuring stage, not a permanent configuration surface.

// The shipping resolution ladder, from Daniel's on-device judgement (B516/B517). 50% and 35%
// are DELIBERATELY absent: 50 "lives in that uncanny 'something is off' zone", which is the worst
// possible place for a degradation to sit — visible enough to distract, ambiguous enough to read
// as a broken output rather than a deliberate one. So the ladder is a step nobody notices (75)
// and a step everybody notices ON PURPOSE (25, which reads as honest system status: "this is not
// pushing full resolution"). Nothing in between to be misread.
export const QUALITY_LADDER = [1, 0.75, 0.25];

export const perfFlags = {
  // draw the slice overlay only when something it draws actually changed (B513). OFF = redraw
  // on every call, which is the pre-B513 behavior: every frame of camera preview and playback.
  overlayGated: true,

  // cap the overlay canvas at 2x device pixels (B513), matching every other canvas. OFF = the
  // raw device ratio, which on a 3x phone is 2.25x the pixels for the same vector line work.
  overlayDprCap: true,

  // skip the broadcast bus's render + GPU readback when the program is provably unchanged
  // (B513). The frame is still PUBLISHED either way; this only elides producing it.
  busElide: true,

  // skip posting an identical state message to a self-rendering external view (B513), subject
  // to the heartbeat floor. OFF = post every frame, the pre-B513 behavior.
  posterElide: true,
};

// the switchboard entries the frame-cost panel renders — id, label, and what each one means when
// you turn it OFF (which is the direction you are testing)
export const PERF_FLAG_SPECS = [
  ['overlayGated', 'overlay: draw only on change', 'off = redraw every frame (pre-B513)'],
  ['overlayDprCap', 'overlay: cap at 2x pixels', 'off = raw device pixel ratio'],
  ['busElide', 'bus: skip render when unchanged', 'off = render + read back every frame'],
  ['posterElide', 'external: skip identical posts', 'off = post state every frame'],
];
