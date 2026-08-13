// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/broadcast-ceiling.js
//
// WHAT THIS DEVICE ACTUALLY SUSTAINED, per destination and resolution tier — learned by running,
// not declared in a table.
//
// WHY LEARNED RATHER THAN CLASSIFIED. The resolution hint has been carrying a hardcoded "clean
// hardware only" beside the 4K tier since before any of it was measured, which is a guess wearing
// the clothes of a spec. CAPABILITIES §1's rule is to probe: an M3 iPad may sustain a tier an M1
// cannot, and deciding by device name is the mistake that rule exists to prevent. This is the
// probe, and it costs nothing because the broadcast IS the experiment.
//
// WHY THE MEDIAN AND NOT THE BEST. Judder is a variance phenomenon (B576), so the best window of a
// run is exactly the reading that would flatter a tier that stutters. The median of the run is what
// the operator watched.
//
// WHY IT PERSISTS. The reading is a property of the device and the display, not of the session, and
// the operator needs it BEFORE starting the broadcast — which is the only moment the resolution is
// changeable, since `locks.js` freezes the tier while output is live (deliberately: a downstream
// consumer like Resolume Arena scales its composition to the incoming frame size, so changing it
// mid-show is worse than a low frame rate — Daniel, B583).

const KEY = 'foldBroadcastCeiling-v1';
// Below this many one-second samples a run says nothing. Broadcast start is a transient the
// governor already has to dwell through; a reading taken across it would libel the tier.
const MIN_SAMPLES = 8;
// Ignore the first samples of a run for the same reason.
const WARMUP = 4;
// How close to the source rate counts as "this tier holds". 0.9 of 30 is 27/s, which is the point
// Daniel's own A/B stopped calling the picture uneven.
const HOLDS = 0.9;

const load = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
  catch { return {}; }
};
const save = (store) => {
  try { localStorage.setItem(KEY, JSON.stringify(store)); }
  catch { /* private mode — the reading is a nicety, never a dependency */ }
};
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

export function createBroadcastCeiling() {
  let store = load();
  let run = null;   // { key, delivered: [], source: [] }

  const keyOf = (destination, tier) => `${destination}:${tier}`;

  // Commit whatever the current run has, if it has enough to say anything. Called on stop and
  // periodically during a long run, so a session that ends by crashing still leaves its reading —
  // and a crash mid-broadcast is exactly the case where the reading matters most.
  function commit() {
    if (!run || run.delivered.length < MIN_SAMPLES) { run = null; return; }
    const delivered = median(run.delivered);
    const source = median(run.source);
    if (!(delivered > 0 && source > 0)) { run = null; return; }
    const prev = store[run.key];
    store[run.key] = {
      delivered: Math.round(delivered),
      source: Math.round(source),
      samples: run.delivered.length + (prev?.samples || 0),
      at: Date.now(),
    };
    save(store);
    run = null;
  }

  return {
    // One call per ledger window while a broadcast is live. `delivered` is NEW PICTURES on the
    // display and `source` is what the decode produced — the same pair the governor acts on, and
    // deliberately not the app's own fps, which B571 and B576 both caught moving the opposite way.
    note({ destination, tier, delivered, source }) {
      if (!destination || !(tier > 0) || !(delivered > 0) || !(source > 0)) return;
      const key = keyOf(destination, tier);
      if (!run || run.key !== key) { commit(); run = { key, delivered: [], source: [], seen: 0 }; }
      run.seen++;
      if (run.seen <= WARMUP) return;
      run.delivered.push(delivered);
      run.source.push(source);
      // checkpoint every half minute of samples so a crash does not cost the reading
      if (run.delivered.length % 30 === 0) {
        const held = run;
        commit();
        run = { ...held, delivered: [...held.delivered], source: [...held.source] };
      }
    },

    // The broadcast stopped (or the destination/tier changed under us).
    stop() { commit(); },

    get(destination, tier) { return store[keyOf(destination, tier)] || null; },

    // The HIGHEST tier this device has been measured holding on this destination. Returns null when
    // we have never seen one hold, which is a real answer and must not read as "4K is fine".
    bestHolding(destination, tiers) {
      let best = null;
      for (const t of tiers) {
        const r = store[keyOf(destination, t)];
        if (r && r.delivered >= r.source * HOLDS && (!best || t > best.tier)) best = { tier: t, ...r };
      }
      return best;
    },

    holds(r) { return !!(r && r.delivered >= r.source * HOLDS); },
    all() { return { ...store }; },
    forget() { store = {}; run = null; save(store); },
  };
}
