// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/mem-ledger.js
//
// ⚠️ B728 — WHAT WE ALLOCATE, BY FUNCTION, BECAUSE NOTHING ELSE CAN SEE THE PROCESS THAT DIES.
//
// The bake's memory lives in the WKWebView CONTENT process and its frames live in the WebKit GPU
// process. **We can read neither.** The native plugin's two numbers are both about the host process
// (`task_info(mach_task_self_)` and `os_proc_available_memory()`), which sits at ~39MB while a bake
// is being killed for memory, and no refinement of them will ever reach the other processes. WebKit
// exposes no per-process web memory API: `performance.memory` is Chromium-only and
// `measureUserAgentSpecificMemory()` needs cross-origin isolation and is not in Safari.
//
// So this measures the one thing we CAN know exactly: **every large allocation we ourselves make.**
// It is arithmetic, not a probe, and it works identically on every platform — which is the property
// that makes cross-device comparison possible at all. For an identical job the estimate should be
// identical everywhere; only the ceiling differs. That separation is what turns a pile of pass/fail
// outcomes into a computed gate.
//
// ⚠️ IT IS A LOWER BOUND AND MUST BE READ AS ONE. It counts what we hold, not what the engine
// allocates around it (decoder surface pools, GL textures, the encoder's own buffers, GC latency).
// **The gap between this and a device-wide reading is the measurement of the blind spot** — which is
// exactly why B729 adds the device-wide number rather than trusting this one alone.
//
// ⚠️ AND IT DOES NOT GATE ANYTHING YET, DELIBERATELY. Its first job is to say which term dominates.
// Modelling before measuring is how the last four hypotheses in this arc went wrong.
//
// Module-global, not on `env`: three env-shaped objects exist in this app (B638) and a fact about
// what the one process is holding must be visible to every caller whichever one it holds.

const live = new Map();     // id → { cat, bytes }
let byCat = new Map();      // cat → bytes currently held
let held = 0;               // sum of `live`
let peak = 0;               // high-water mark since the last memBegin
let peakCat = null;         // the breakdown AT the peak, not at the end — see below
let tag = null, startedAt = 0;
let nextId = 1;

function recompute() {
  byCat = new Map();
  held = 0;
  for (const { cat, bytes } of live.values()) {
    byCat.set(cat, (byCat.get(cat) || 0) + bytes);
    held += bytes;
  }
  if (held > peak) {
    peak = held;
    // ⚠️ SNAPSHOT THE BREAKDOWN AT THE PEAK. A breakdown read at teardown describes what survived,
    // not what cost the most — and "what survived" is the question the RESIDUE work asks, which is
    // a different question with a different answer. Recording only the final state is how a report
    // ends up describing the calm after the failure.
    peakCat = Object.fromEntries(byCat);
  }
}

// Start attributing to a named operation and reset the high-water mark.
export function memBegin(name) {
  tag = name; startedAt = Date.now();
  peak = held; peakCat = Object.fromEntries(byCat);
}

// Claim `bytes` under `cat`. Returns a handle; keep it and release it.
export function memHold(cat, bytes) {
  const id = nextId++;
  live.set(id, { cat, bytes: Math.max(0, bytes | 0) });
  recompute();
  return id;
}

// Re-state a handle's size. For things that GROW (the muxer's output buffer, a frame queue),
// which is most of what actually kills a bake.
export function memGrow(id, bytes) {
  const e = live.get(id);
  if (!e) return;
  e.bytes = Math.max(0, bytes | 0);
  recompute();
}

export function memRelease(id) {
  if (live.delete(id)) recompute();
}

// ⚠️ RELEASING A HANDLE IS A CLAIM ABOUT OUR CODE, NOT ABOUT THE HEAP. It says we dropped the
// reference; whether WebKit collected it is a separate question this cannot answer. **`heldAfter`
// in the report is what makes the difference visible**: a bake that ends with a non-zero `held` is
// leaking references, and one that ends at zero and still fails the NEXT time is a GC or
// engine-side residue problem. Those need opposite fixes, and the arc has already lost builds to
// guessing which.
export function memReport() {
  return {
    tag,
    sinceMs: startedAt ? Date.now() - startedAt : null,
    peakMB: +(peak / 1048576).toFixed(1),
    heldMB: +(held / 1048576).toFixed(1),
    peakBy: Object.fromEntries(Object.entries(peakCat || {}).map(([k, v]) => [k, +(v / 1048576).toFixed(1)])),
    openHandles: live.size,
  };
}
