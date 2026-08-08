// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// conduit/pressure.js
//
// THE PRESSURE SOURCE — one normalized 0..1 "how much trouble is this device in", with
// interchangeable inputs, so that whatever eventually acts on it never has to care where the
// number came from.
//
// WHY THE SEAM EXISTS BEFORE ANY CONSUMER DOES. iOS hands us a real thermal reading
// (`ProcessInfo.processInfo.thermalState`: nominal / fair / serious / critical, plus a change
// notification). THE WEB HAS NO THERMAL API AT ALL, so every other runtime has to INFER
// pressure from sustained frame-time drift. Those two signals must be interchangeable by
// construction or we end up with two governors that disagree — hence one module, two inputs,
// and a `source` label so a readout can always say which one is talking.
//
// It is deliberately shipped INERT: for now the only consumer is a display. That is precisely
// how we find out whether the inferred signal actually tracks the native one, BEFORE anything
// starts degrading the app based on it. A governor that acts on an unvalidated signal is worse
// than no governor.
//
// THE INFERRED SIGNAL, and its honest limits. We hold the BEST sustained frame time seen after
// a warm-up as the baseline, then read drift away from it. This catches the shape thermal
// throttling actually has ("smooth, then slows down"), and it deliberately does NOT catch a
// device that was slow from the first frame — that is a capability problem, not a pressure
// problem, and conflating them would make a weak device permanently read as overheating.

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

// iOS thermalState, mapped onto the same 0..1 scale as the inferred signal.
const NATIVE_LEVELS = { nominal: 0, fair: 0.33, serious: 0.7, critical: 1 };

// Drift needed to read as full pressure: frame time at 2x the baseline is as bad as we model.
// Below WARM_WINDOWS samples we are still learning the baseline and report nothing.
const FULL_DRIFT = 1.0;
const WARM_WINDOWS = 5;

// THE TARGET RATE, and why drift alone was not enough (B559).
//
// Pressure answers "is this device getting slower at the thing it is already doing". That is the
// right question for thermal, and it is the WRONG question twice over on its own:
//
//   FALSE ALARM — a 30fps take on a device that idled at 60 doubles p50 by DESIGN. Nothing is
//   wrong; we asked for half the frames. Without a declared target, that reads as 100% drift, and
//   B551's device pass duly reported `critical` on a take running at a correct 31.7fps.
//
//   FALSE ALL-CLEAR — a device that is throttled for the WHOLE window learns its baseline from
//   throttled frames, so drift is zero and it reads `nominal`. Daniel's B558 report caught this
//   exactly: 13.3fps on a live 4K camera immediately after a long take, pressure 0.14 `nominal`.
//
// Both are fixed by knowing how many frames we were actually trying to produce:
//   - the drift reference is FLOORED at the target frame time, so hitting the target is never drift;
//   - `shortfall` reports the absolute gap to target, which is the capability signal drift cannot be.
//
// They are deliberately two numbers. Pressure is "getting worse"; shortfall is "not good enough".
// A device that is honestly too slow should read high shortfall and zero pressure, and a governor
// wants to respond to those differently: shed work for shortfall, back off for pressure.
//
// `target` is 0 (unknown) until a shell declares one — never inferred from the display rate,
// because "renders per second" and "distinct frames per second" stopped being the same number
// once B542 began eliding identical renders.

export function createPressureSource({ native = null, target = 0 } = {}) {
  let baseline = 0;         // best sustained frame time seen (ms) FOR THE CURRENT WORKLOAD
  let windows = 0;
  let inferred = 0;
  let lastP50 = 0;
  let workload = null;      // what the app was doing when the baseline was learned
  // `target` may be a number or a resolver. The resolver form exists for shells whose render is
  // on-demand rather than a continuous loop (main.js schedules renders; it has no tick to push
  // from), so the ledger's own window pulls it instead.
  const targetFn = typeof target === 'function' ? target : null;
  let targetFps = !targetFn && target > 0 ? target : 0;

  function applyTarget(fps) {
    const next = fps > 0 ? fps : 0;
    if (next === targetFps) return;
    targetFps = next;
    baseline = 0; windows = 0; inferred = 0;
  }

  function nativeValue() {
    if (!native) return null;
    let s;
    try { s = native(); } catch { return null; }
    if (s == null) return null;
    if (typeof s === 'number') return clamp01(s);
    const v = NATIVE_LEVELS[String(s).toLowerCase()];
    return v === undefined ? null : v;
  }

  return {
    // Fed one sample per ledger window: the window's median frame time, plus a description of
    // WHAT THE APP WAS DOING (megapixels rendered per frame).
    //
    // THE WORKLOAD KEY IS NOT OPTIONAL, and B514's device pass is why. Without it the baseline
    // was simply the fastest frame time ever seen, so an idle still at 120fps set an 8.3ms bar
    // and the moment Daniel started a 4K Syphon broadcast — a genuine, deliberate 3x increase in
    // work — the signal read CRITICAL on a cold machine. That is not a pressure reading, it is a
    // workload change wearing a pressure reading's clothes, and a governor acting on it would
    // have degraded the app for doing exactly what the user asked.
    //
    // So the baseline is per-workload: a material change in how much we are rendering re-learns
    // it. Pressure then means what it should — "this device is getting slower AT THE THING IT IS
    // ALREADY DOING" — which is the shape thermal throttling actually has.
    note(p50, workloadKey = 0) {
      if (!(p50 > 0)) return;
      lastP50 = p50;
      if (targetFn) { let t; try { t = targetFn(); } catch { t = 0; } applyTarget(t); }
      // >15% change in rendered megapixels is a different job, not the same job getting slower
      const changed = workload === null
        || (workloadKey > 0 && workload > 0 && Math.abs(workloadKey - workload) / workload > 0.15)
        || (workloadKey > 0) !== (workload > 0);
      if (changed) { workload = workloadKey; baseline = 0; windows = 0; inferred = 0; }
      windows += 1;
      // within one workload the baseline TRACKS DOWN only: a faster window is new evidence of
      // what this device can do; a slower one is the thing we are trying to detect
      if (!baseline || p50 < baseline) baseline = p50;
      // hitting the rate we ASKED for is not drift, however far it sits from the fastest frame
      // this device has ever managed at some other job
      const ref = targetFps > 0 ? Math.max(baseline, 1000 / targetFps) : baseline;
      inferred = windows < WARM_WINDOWS ? 0 : clamp01((p50 / ref - 1) / FULL_DRIFT);
    },

    // What rate the app is TRYING to hit right now. A change re-learns the baseline, because
    // asking for half the frames is a different job — the same reasoning as the workload key.
    setTarget: applyTarget,
    get target() { return targetFps; },

    // 0..1, how far BELOW the declared target we are actually running. Absolute, not relative:
    // this is the number that stays honest on a device that has been slow the entire time.
    // 0 when no target is declared, because there is then nothing to fall short of.
    get shortfall() {
      if (!(targetFps > 0) || !(lastP50 > 0)) return 0;
      const targetMs = 1000 / targetFps;
      return clamp01((lastP50 - targetMs) / targetMs);
    },
    // the rate we are actually sustaining, so a readout never has to recompute it from p50
    get fps() { return lastP50 > 0 ? Math.round(1000 / lastP50) : 0; },

    get value() {
      const n = nativeValue();
      return n === null ? inferred : Math.max(n, inferred);
    },
    // which input is actually driving the number, so a readout can never mislead about it
    get source() { return nativeValue() === null ? 'inferred' : 'native+inferred'; },
    get label() {
      const v = this.value;
      if (windows < WARM_WINDOWS && nativeValue() === null) return 'warming up';
      if (v < 0.15) return 'nominal';
      if (v < 0.45) return 'fair';
      if (v < 0.8) return 'serious';
      return 'critical';
    },
    get detail() {
      return {
        baselineMs: Math.round(baseline * 100) / 100,
        lastMs: Math.round(lastP50 * 100) / 100,
        windows, workload,
      };
    },
    reset() { baseline = 0; windows = 0; inferred = 0; workload = null; },
  };
}
