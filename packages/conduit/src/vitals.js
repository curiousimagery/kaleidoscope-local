// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// conduit/vitals.js
//
// THE SESSION RECORDER — a device's story over TIME, which is a different instrument from the
// frame-cost ledger and must not be folded into it.
//
// ⚠️ WHY THIS EXISTS AS ITS OWN THING (Daniel, B660). The frame ledger answers "what is this
// costing right now". The questions that actually gate the arc are curves:
//
//   - does 4K → 4K hold for ten minutes
//   - does an eight-hour exhibit degrade, and if so from what
//
// **A snapshot cannot answer either.** Copying a report at minute nine tells you what minute nine
// looked like; it cannot tell you it is worse than minute one. So this records a SESSION — an
// explicit start, a slow cadence, and a summary that survives the run — and the panel keeps its
// snapshot view unchanged beside it.
//
// Daniel's shape: *"i'd still go into the frame cost diagnostic, but to 'start a session' where we
// begin recording then shift to the workflow."* Explicit start matters for more than tidiness: it
// gives the samples a known t=0, so "40 minutes in" is a fact rather than an estimate, and it means
// the recording covers the workflow rather than the fiddling that preceded it.
//
// ⚠️ THE RIGHT NOUN FOR MEMORY IS HEADROOM, NOT FOOTPRINT. What ends a long run is the OS killing
// us, so the conserved quantity is **how much room is left before that happens** (iOS:
// `os_proc_available_memory`) — a boundary we do not own. Footprint is what we spent, which is an
// activity counter in the sense DEBUGGING-PROTOCOL warns about: it rises for good reasons and bad
// ones alike and never says how close the wall is. Record both; conclude from headroom.
//
// ⚠️ AND THERMAL IS A SET OF TRANSITIONS, NOT A LEVEL. "It went serious at 6m12s" is a finding.
// "It is serious now" is a readout. Transitions are recorded as events with timestamps so a
// degradation can be lined up against the moment the device changed state.
//
// Kit/conduit layer: no DOM, no chrome, no timers of its own beyond the sampler it is asked to
// start. The host supplies the readings; this owns the shape of the record.

// One sample every 10s. Thermal moves over minutes and memory drifts over hours, so a faster
// cadence buys resolution nobody reads and a slower one can miss a transition's onset.
const SAMPLE_MS = 10_000;

// The ring holds one hour at the sample cadence. Past that the curve decimates into the aggregates
// and the events, which is a deliberate trade: an 8h run's hour six is visible in its summary and
// its discontinuities, not as a plotted line. Stated so nobody later reads a flat tail as calm.
const RING = 360;

// Headroom below which a device is in genuine danger of being killed. iOS jetsam does not announce
// a threshold, so this is a working line rather than a measured one — it exists to make the panel
// shout before the app dies, not to model the OS.
const LOW_MEM_MB = 220;

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const mb = (bytes) => (bytes > 0 ? Math.round(bytes / 1048576) : null);

// Web memory, where a runtime exposes it. Chromium/Electron only — Safari and Firefox do not
// implement it, which is exactly why the native reading matters on the devices that matter.
function webMemory() {
  const m = (typeof performance !== 'undefined' && performance.memory) || null;
  if (!m) return null;
  return { usedMB: mb(m.usedJSHeapSize), limitMB: mb(m.jsHeapSizeLimit) };
}

export function createVitals({ pressure = null, ledger = null, native = null } = {}) {
  let session = null;   // null = not recording
  let timer = 0;

  // `native()` is the host seam — the iOS plugin's thermal + memory reading when one exists, null
  // everywhere else. Absent is a legitimate answer and is recorded as such: a run with no native
  // reading must not look like a run that was nominal throughout.
  const readNative = () => { try { return native?.() || null; } catch { return null; } };

  function sample(reason = 'tick') {
    if (!session) return null;
    const t = Math.round((nowMs() - session.t0) / 1000);
    const nat = readNative();
    // pressure exposes getters (value / label / source), not a snapshot method
    const p = pressure ? { level: pressure.value, label: pressure.label, source: pressure.source } : null;
    const r = ledger?.report || null;
    const s = {
      t,
      fps: r?.fps ?? null,
      frameP50: r?.frameMs?.p50 ?? null,
      frameP95: r?.frameMs?.p95 ?? null,
      unaccountedMs: r?.unaccountedMs ?? null,
      pressure: p,
      thermal: nat?.thermal ?? null,
      // headroom first — it is the number that decides whether the run survives
      availMB: nat?.availableMB ?? null,
      footprintMB: nat?.footprintMB ?? null,
      web: webMemory(),
    };
    session.ring.push(s);
    if (session.ring.length > RING) session.ring.shift();
    session.samples++;

    // aggregates, kept incrementally so an 8h run costs no more to summarise than a 30s one
    const agg = session.agg;
    const track = (key, v) => {
      if (v == null || !isFinite(v)) return;
      const a = (agg[key] ??= { first: v, min: v, max: v, last: v });
      if (v < a.min) a.min = v;
      if (v > a.max) a.max = v;
      a.last = v;
    };
    track('fps', s.fps);
    track('frameP50', s.frameP50);
    track('availMB', s.availMB);
    track('footprintMB', s.footprintMB);
    track('webUsedMB', s.web?.usedMB);
    if (s.pressure?.level != null) track('pressure', s.pressure.level);

    // time spent at each thermal level, which is what an exhibit post-mortem actually wants
    if (s.thermal) session.thermalMs[s.thermal] = (session.thermalMs[s.thermal] || 0) + SAMPLE_MS;

    // ⚠️ A THRESHOLD CROSSING IS AN EVENT, not a value to be noticed later in a table. Recorded
    // once per crossing rather than per sample, so a long run near the line does not bury the
    // moment it crossed under three hundred identical rows.
    if (s.availMB != null) {
      const low = s.availMB < LOW_MEM_MB;
      if (low !== session.lowMem) {
        session.lowMem = low;
        event(low ? 'memory-low' : 'memory-recovered', { availMB: s.availMB });
      }
    }
    if (s.thermal && s.thermal !== session.lastThermal) {
      event('thermal', { from: session.lastThermal, to: s.thermal });
      session.lastThermal = s.thermal;
    }
    if (reason !== 'tick') s.reason = reason;
    return s;
  }

  // Events are unbounded because they are discontinuities and each one is the thing you came to
  // find. They are also tiny. A run that drops nothing records nothing here.
  function event(kind, detail = {}) {
    if (!session) return;
    session.events.push({ t: Math.round((nowMs() - session.t0) / 1000), kind, ...detail });
  }

  return {
    get recording() { return !!session; },
    get elapsedSec() { return session ? Math.round((nowMs() - session.t0) / 1000) : 0; },

    start(label = '') {
      if (session) return session;
      session = {
        label, startedAt: new Date().toISOString(), t0: nowMs(),
        ring: [], events: [], agg: {}, thermalMs: {}, samples: 0,
        lastThermal: readNative()?.thermal ?? null, lowMem: false,
      };
      sample('start');
      timer = setInterval(() => sample('tick'), SAMPLE_MS);
      return session;
    },

    stop() {
      if (!session) return null;
      sample('stop');
      clearInterval(timer); timer = 0;
      const done = this.report();
      session = null;
      return done;
    },

    // Anything the app knows is notable — a GL context loss, a take starting, a source swap, an
    // OS memory warning arriving through the host. Callers should NOT gate these on "is it
    // recording": an absent session drops them silently and that is the correct behaviour.
    mark: event,

    // The glanceable verdict. Deliberately coarse — this drives a line in the panel that has to be
    // readable at a glance from across a room, not a diagnosis. `reasons` is what makes it
    // actionable rather than ominous.
    warning() {
      const reasons = [];
      // ⚠️ ALWAYS READ LIVE, never the last sample. A glanceable warning that is up to one sample
      // period stale while recording — and live when idle — would mean two different things
      // depending on a mode the reader cannot see. The trend reasons below are the only ones that
      // legitimately come from the session, because a trend is not a thing you can read instantly.
      const nat = readNative() || {};
      if (nat.thermal === 'serious' || nat.thermal === 'critical') reasons.push(`thermal ${nat.thermal}`);
      if (nat.availableMB != null && nat.availableMB < LOW_MEM_MB) reasons.push(`${nat.availableMB}MB headroom`);
      if (pressure && pressure.value >= 0.7) reasons.push(`pressure ${pressure.label} (${pressure.source})`);
      if (session) {
        const bad = session.events.filter((e) => e.kind === 'gl-context-lost' || e.kind === 'memory-warning');
        if (bad.length) reasons.push(`${bad.length} × ${bad.length === 1 ? bad[0].kind : 'device event'}`);
        // a run that has lost a fifth of its opening frame rate is degrading, whatever the cause
        const f = session.agg.fps;
        if (f && f.first > 0 && f.last < f.first * 0.8) reasons.push(`fps ${f.first} → ${f.last}`);
      }
      return reasons.length ? { level: reasons.length > 1 ? 'bad' : 'warn', reasons } : null;
    },

    report() {
      if (!session) return null;
      return {
        label: session.label || undefined,
        startedAt: session.startedAt,
        durationSec: Math.round((nowMs() - session.t0) / 1000),
        samples: session.samples,
        sampleEverySec: SAMPLE_MS / 1000,
        // ⚠️ SAY WHEN THE CURVE IS INCOMPLETE. Past RING the tail is summary only, and a reader who
        // does not know that will read a short series as a short run.
        ringCoversSec: Math.min(session.samples, RING) * (SAMPLE_MS / 1000),
        truncated: session.samples > RING || undefined,
        nativeReadings: session.ring.some((s) => s.thermal != null || s.availMB != null) || false,
        agg: session.agg,
        thermalMs: Object.keys(session.thermalMs).length ? session.thermalMs : undefined,
        events: session.events,
        series: session.ring,
      };
    },
  };
}
