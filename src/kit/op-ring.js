// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// kit/op-ring.js
//
// A tiny fixed-capacity ring buffer for runtime op-perf records — the unified
// diagnostics substrate the live-output bus (src/stage/) and future bake/export
// ops push into (env.diag.ops). Each record is a plain object describing one
// measured operation window (e.g. an op:'live-output' sample: per-frame gl /
// readback / publish timings + throughput). The diagnostics sheet reads the
// recent records back for a live readout, and the copy-diagnostics report
// embeds the whole ring as paste-ready evidence when a stutter happens.
//
// Kit layer: pure, no DOM, no engine, no chrome. Capacity-bounded so a long live
// session can't grow memory without bound; oldest records fall off the front.

export function createOpRing(capacity = 120) {
  const buf = [];
  return {
    // append a record; drop the oldest once over capacity.
    push(record) {
      buf.push(record);
      if (buf.length > capacity) buf.shift();
    },
    // a shallow copy, oldest-first — safe for callers to read/serialize.
    toArray() { return buf.slice(); },
    clear() { buf.length = 0; },
    get size() { return buf.length; },
    get capacity() { return capacity; },
  };
}
