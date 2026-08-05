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

export function createPressureSource({ native = null } = {}) {
  let baseline = 0;         // best sustained frame time seen (ms)
  let windows = 0;
  let inferred = 0;
  let lastP50 = 0;

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
    // fed one sample per ledger window (the window's median frame time)
    note(p50) {
      if (!(p50 > 0)) return;
      lastP50 = p50;
      windows += 1;
      // the baseline TRACKS DOWN only: a faster window is new evidence of what this device can
      // do; a slower one is the thing we are trying to detect, so it must never raise the bar
      if (!baseline || p50 < baseline) baseline = p50;
      inferred = windows < WARM_WINDOWS ? 0 : clamp01((p50 / baseline - 1) / FULL_DRIFT);
    },

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
      return { baselineMs: Math.round(baseline * 100) / 100, lastMs: Math.round(lastP50 * 100) / 100, windows };
    },
    reset() { baseline = 0; windows = 0; inferred = 0; },
  };
}
