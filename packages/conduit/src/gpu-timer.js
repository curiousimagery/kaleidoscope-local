// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// conduit/gpu-timer.js
//
// REAL GPU TIME, where the platform will give it to us.
//
// THE PROBLEM THIS FIXES. Timing a draw call with `performance.now()` measures how long it took
// to SUBMIT the work, not how long the GPU took to do it — the API is asynchronous, so a render
// that costs 12ms of GPU time can measure as 0.2ms of CPU time. Every number the frame-cost
// ledger reports is that partial signal, which is why the switchboard (turn it off, watch the
// fps) is the method rather than the numbers. This module makes the numbers real on the
// platforms that support it, which turns "rank the surfaces by ablation" into "read the ranking
// off the panel" wherever we can.
//
// WHERE IT WORKS. `EXT_disjoint_timer_query_webgl2` is available on Chromium and Electron, and
// generally NOT on WebKit. So desktop and the Electron build get true GPU numbers; iPad and
// iPhone keep the CPU-side figure plus the switchboard. That asymmetry is exactly why the plan
// ranks work items on desktop and then CONFIRMS the ranking on device rather than measuring
// each device independently.
//
// HOW IT BEHAVES. Results are not available on the frame that issued them, so `poll()` drains
// whatever has completed since the last call and the ledger attributes it to the current window
// rather than to a specific frame. Over a one-second window that distinction does not matter.
// A "disjoint" event (the GPU was interrupted — a context switch, a power state change) makes
// every in-flight result meaningless, so we throw them away rather than report a wrong number:
// this instrument exists to stop us guessing, and a plausible-looking wrong value is worse than
// a missing one.
//
// Only ONE TIME_ELAPSED query can be active per context at a time, which the `active` guard
// enforces — a nested begin is dropped rather than throwing.

export function createGpuTimer(gl) {
  if (!gl || typeof gl.createQuery !== 'function') return null;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return null;

  const TARGET = ext.TIME_ELAPSED_EXT;
  const pending = [];   // queries issued, not yet resolved
  const pool = [];      // resolved queries, reusable
  let active = null;
  let broken = false;

  function discardAll() {
    for (const q of pending) { try { gl.deleteQuery(q); } catch { /* context may be gone */ } }
    pending.length = 0;
  }

  return {
    supported: true,

    begin() {
      if (broken || active) return;
      try {
        const q = pool.pop() || gl.createQuery();
        gl.beginQuery(TARGET, q);
        active = q;
      } catch { broken = true; active = null; }
    },

    end() {
      if (broken || !active) return;
      try {
        gl.endQuery(TARGET);
        pending.push(active);
      } catch { broken = true; }
      active = null;
    },

    // total GPU ms completed since the last call, or 0. Returns null when a disjoint event
    // invalidated the outstanding results — the caller should report nothing for that window.
    poll() {
      if (broken || !pending.length) return 0;
      try {
        // a disjoint invalidates EVERY in-flight result, not just one
        if (gl.getParameter(ext.GPU_DISJOINT_EXT)) { discardAll(); return null; }
        let ms = 0, i = 0;
        while (i < pending.length) {
          const q = pending[i];
          if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;   // FIFO: later ones can't be ready first
          ms += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;             // nanoseconds → ms
          pool.push(q);
          i += 1;
        }
        if (i) pending.splice(0, i);
        return ms;
      } catch { broken = true; return 0; }
    },

    // a lost context invalidates every query object we hold
    reset() { discardAll(); pool.length = 0; active = null; broken = false; },

    dispose() {
      discardAll();
      for (const q of pool) { try { gl.deleteQuery(q); } catch { /* gone */ } }
      pool.length = 0;
    },
  };
}
