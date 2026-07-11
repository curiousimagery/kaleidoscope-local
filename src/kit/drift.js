// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// kit/drift.js
//
// AUTOPLAY ("drift") — extracted VERBATIM from perform-runtime.js (B296) so the
// mobile record-video mode drives the same wander without a fork. Auto is
// ANOTHER PAIR OF HANDS ON THE SAME STAGE: a per-field wander writes
// destinations into `state` exactly like user input, and whatever follower
// chases that state (desktop perform's live view, mobile's recorded output)
// needs zero special-casing. MANUAL INPUT ACCUMULATES PER FIELD (B299, replacing
// the original back-off-and-cooldown): a mismatch means a hand moved the field,
// and the hand RELOCATES the wander — the spring frame shifts by the manual
// delta and keeps breathing, so a gesture never reads as an interruption.
//
// Dials (all 0..1, read live from `session`): performAutoPace (time between
// destination picks), performAutoRange (how far picks reach), performAutoVariety
// (how many fields wander at once), performAutoSmooth (the per-field spring's
// response). Tuning history: pace/smoothing curves recentered on Daniel's
// calibration round; framing fields tempered (canvas zoom + rotation were
// "more enthusiastic than expected").
//
// Kit layer: no DOM, no chrome, no timers — the caller owns the clock and the
// on/off gate. createAutoDrift({ state, session }) → { tick(now, dt), reset() }.
// reset() re-homes every field at the current look (call it on each re-arm).

import { CONTINUOUS_KEYS, ANGULAR_KEYS, angDelta } from './tween.js';
import { FOLLOW_SPANS } from './follow.js';

const ANGULAR = new Set(ANGULAR_KEYS);
const wrap360 = (v) => ((v % 360) + 360) % 360;

const AUTO_BOUNDS = {   // guardrails: destinations never leave these (rotation wraps freely)
  sliceScale: [0.25, 2.6], sliceCx: [0.15, 0.85], sliceCy: [0.15, 0.85],
  canvasZoom: [0.45, 2.4], squareAspect: [0.45, 2.4],
  drosteZoom: [1.4, 9], drosteSpiral: [-3, 3],
  drosteOffsetX: [-0.55, 0.55], drosteOffsetY: [-0.55, 0.55],
};
// FRAMING fields are tempered — they wander a fraction of the range and stay
// anchored to their autoplay-start home; the slice is the show, the canvas is
// the frame.
const AUTO_TEMPER = { canvasZoom: 0.3, canvasRotation: 0.25 };

export function createAutoDrift({ state, session }) {
  let f = {};
  let roll = 0;

  function fields() {
    return CONTINUOUS_KEYS.filter((k) => {
      if (k.startsWith('droste')) return state.form === 'droste';
      if (k === 'squareAspect') return state.form === 'square';
      return true;
    });
  }
  function field(k, now) {
    let F = f[k];
    if (!F) {
      const v = state[k] ?? 0;
      F = f[k] = { cur: v, vel: 0, home: v, dest: v, dir: 0, pickT: now + Math.random() * 800, active: false };
    }
    return F;
  }
  // destination picks carry INTENT (Daniel's tuning round): momentum (mostly
  // keep traveling the same way — fewer startling reversals, more full
  // rotations) and a coverage bias (the slice leans toward looks that cover
  // MORE of the source: scale picks lean high, position picks stay near home).
  function pick(k, F, now) {
    const range = (session.performAutoRange ?? 0.3) * (AUTO_TEMPER[k] || 1);
    if (k === 'canvasRotation') {
      // framing rotation OSCILLATES around home instead of walking — the
      // momentum walk belongs to the slice (full rotations are the show there)
      F.dest = F.home + (Math.random() * 2 - 1) * range * 360;
    } else if (ANGULAR.has(k)) {
      const dir = F.dir || (Math.random() < 0.5 ? -1 : 1);
      const keep = Math.random() < 0.78 ? dir : -dir;
      const sweep = (0.25 + 0.75 * Math.random()) * range * 360;   // never a micro-nudge
      F.dest = F.cur + keep * sweep;
      F.dir = keep;
    } else {
      const span = FOLLOW_SPANS[k] || 1;
      let r = Math.random() * 2 - 1;
      if (k === 'sliceScale') r = 1 - 2 * Math.pow(Math.random(), 1.7);      // leans large (coverage)
      else if (k === 'sliceCx' || k === 'sliceCy') r *= Math.random();       // leans home (keeps big slices on-image)
      else if (F.dir && Math.random() < 0.65) r = Math.abs(r) * F.dir;       // momentum
      let d = F.home + r * range * span;
      const b = AUTO_BOUNDS[k];
      if (b) {
        // the guardrail bounds AUTO's wandering, never the user: if a manual
        // edit homed the field outside them, the window stretches to include it
        d = Math.max(Math.min(b[0], F.home), Math.min(Math.max(b[1], F.home), d));
      }
      F.dir = Math.sign(d - F.cur) || F.dir;
      F.dest = d;
    }
    // pace curve recentered on Daniel's calibration (his found-good sat at the
    // old slider's floor): default (50%) ≈ 5.2s between picks, floor ≈ 15s,
    // ceiling ≈ 1.5s
    const pace = session.performAutoPace ?? 0.5;
    F.pickT = now + (1500 + Math.pow(1 - pace, 2) * 14800) * (0.6 + Math.random() * 0.8);
  }
  function tick(now, dt) {
    const flds = fields();
    if (now >= roll) {
      // variety: how many fields wander at once (a fresh weighted subset)
      const variety = session.performAutoVariety ?? 0.5;
      const count = Math.max(1, Math.round(flds.length * (0.15 + 0.85 * variety)));
      const set = new Set([...flds].sort(() => Math.random() - 0.5).slice(0, count));
      for (const k of flds) field(k, now).active = set.has(k);
      roll = now + 5000 + Math.random() * 5000;
    }
    // the glide is a critically damped SPRING per field (smoothing = its
    // response): velocity stays CONTINUOUS across destination changes, so a
    // new pick never jerks and an opposite pick decelerates through zero
    // instead of snapping into reverse — the honest in-auto smoothing.
    // smoothing recentered the same way (his found-good was ~90% of the old
    // curve): default (65%) ≈ the feel he liked, ceiling reaches silkier still
    const smooth = session.performAutoSmooth ?? 0.65;
    const tau = 0.4 + Math.pow(smooth, 1.3) * 5.0;
    const omega = 2 / tau;
    const dts = Math.min(dt, 100) / 1000;
    const decay = Math.exp(-omega * dts);
    for (const k of flds) {
      const F = field(k, now);
      const live = state[k] ?? 0;
      // MANUAL INPUT ACCUMULATES (Daniel's arc-close re-frame of manual-wins):
      // auto writes exact values, so any external change is a hand — and the
      // hand RELOCATES the wander instead of interrupting it. Shift the whole
      // spring frame (current, home, destination — velocity untouched) by the
      // hand's delta and keep breathing: while a drag is live the hand is
      // authoritative each frame (its write lands after ours and the next
      // shift absorbs it), and on release the wander continues seamlessly from
      // the new placement — no cooldown, no visible pause. The guardrails
      // already stretch to include a home outside them (see pick()).
      const delta = ANGULAR.has(k)
        ? angDelta(wrap360(F.cur), wrap360(live))
        : live - F.cur;
      if (Math.abs(delta) > (ANGULAR.has(k) ? 1e-4 : (FOLLOW_SPANS[k] || 1) * 1e-6)) {
        F.cur += delta; F.home += delta; F.dest += delta;
      }
      if (!F.active) { F.cur = live; F.vel = 0; F.home = live; F.dest = live; continue; }
      if (now >= F.pickT) pick(k, F, now);
      const y = F.cur - F.dest;
      const tmp = (F.vel + omega * y) * dts;
      F.cur = F.dest + (y + tmp) * decay;
      F.vel = (F.vel - omega * tmp) * decay;
      if (ANGULAR.has(k)) {
        // re-base a long drift toward 0 so unwrapped values never grow unbounded
        if (Math.abs(F.cur) > 7200) { const s = 360 * Math.floor(F.cur / 360); F.cur -= s; F.dest -= s; }
        state[k] = wrap360(F.cur);
      } else {
        state[k] = F.cur;
      }
    }
  }
  function reset() { f = {}; roll = 0; }
  return { tick, reset };
}
