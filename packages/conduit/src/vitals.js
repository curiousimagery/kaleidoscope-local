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

// ⚠️ B661 — THE FLIGHT RECORDER. Daniel's first real run ended in a hard kill: 4K clip, 4K
// broadcast, autoplay, gamepad — then *"as soon as i tried to start recording is when it died
// basically instantly"*, black, unrecoverable without a reload. His question is the right one:
// *"is there a good way to capture fatal crashes like this since it seems that your report output
// relies on a more or less stable session?"*
//
// **It did, and that is a defect in the instrument, not a limit of the situation.** A recorder that
// only survives an orderly stop cannot report the failures worth reporting — and on this arc the
// fatal ones are the whole question. Everything held in memory dies with the process.
//
// So the session WRITES THROUGH on every sample and every event, and carries a `clean` flag that is
// only set on an orderly stop. On the next launch an unclean record is recovered and surfaced. The
// last breadcrumb before the silence names the operation that killed it, which for Daniel's crash
// is the difference between "it died" and "it died arming a second encode session while already
// broadcasting 4K".
//
// Kept deliberately small (TAIL samples, not the full ring) because it is written every 10s to
// synchronous storage, and because the minutes before death are the ones that matter.
const TAIL = 30;              // ~5 minutes at the sample cadence
const STORE_KEY = 'fold-vitals-last';
// ⚠️ B662 — BREADCRUMBS ARE ALWAYS ON, SESSIONS ARE NOT. Daniel: *"to clarify i still need to start
// a session to capture yes?"* — and under B661 the answer was yes for breadcrumbs too, which is
// the wrong answer. A crash does not wait for you to have armed the recorder, and requiring an
// operator to predict which action will be fatal is exactly the instrument failing at its job.
//
// So the last few risky operations are kept in their own always-on ring, written on every mark
// whether or not a session exists. It is twelve short objects; it costs nothing and it means the
// question "what was it doing when it died" always has an answer.
const TRAIL_KEY = 'fold-vitals-trail';
const TRAIL = 12;

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const mb = (bytes) => (bytes > 0 ? Math.round(bytes / 1048576) : null);

// Web memory, where a runtime exposes it. Chromium/Electron only — Safari and Firefox do not
// implement it, which is exactly why the native reading matters on the devices that matter.
function webMemory() {
  const m = (typeof performance !== 'undefined' && performance.memory) || null;
  if (!m) return null;
  return { usedMB: mb(m.usedJSHeapSize), limitMB: mb(m.jsHeapSizeLimit) };
}

// Synchronous, survives a process kill, present in every runtime we ship. Deliberately NOT the
// Capacitor Preferences API: that is async, and an async write is exactly the one that does not
// land when the process is about to die.
const store = {
  read() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { return null; } },
  write(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* full / private mode */ } },
  clear() { try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ } },
};

// What the LAST run left behind, read once at construction. `clean: false` means the process went
// away without an orderly stop — a crash, a jetsam kill, or a force-quit, and the record cannot
// tell those apart on its own. The breadcrumbs can.
export function recoverLastSession() {
  const prev = store.read();
  if (!prev || prev.clean) return null;
  return prev;
}

export function createVitals({ pressure = null, ledger = null, native = null, outputs = null } = {}) {
  let session = null;   // null = not recording
  let timer = 0;
  const crashed = recoverLastSession();   // captured before anything can overwrite it
  // the previous run's breadcrumbs, whether or not it had a session. Read once, same reason.
  const priorTrail = (() => { try { return JSON.parse(localStorage.getItem(TRAIL_KEY) || 'null'); } catch { return null; } })();
  const trail = [];

  // `native()` is the host seam — the iOS plugin's thermal + memory reading when one exists, null
  // everywhere else. Absent is a legitimate answer and is recorded as such: a run with no native
  // reading must not look like a run that was nominal throughout.
  const readNative = () => { try { return native?.() || null; } catch { return null; } };
  // ⚠️ 2026-08-19 — THE WALL'S OWN RATE, WHICH IS THE NUMBER DANIEL'S RUBRIC IS ACTUALLY ABOUT.
  // *"Dropping to poor fps in app is acceptable but dropping broadcast fps warrants a warning."*
  // Every series so far has recorded the APP's fps, and the two are decoupled — the governor
  // proved it by shedding every editor surface without moving the delivered rate, and a run has
  // held 29-of-30 on the wall while the app sat at 12fps. **So the criterion we intend to gate on
  // has never once been recorded as a time series.** A report copied after a run cannot recover it
  // either: by then the broadcast is off and the external surface reads 0x0.
  const readOutputs = () => { try { return outputs?.() || null; } catch { return null; } };

  function sample(reason = 'tick') {
    if (!session) return null;
    const t = Math.round((nowMs() - session.t0) / 1000);
    // ⚠️ 2026-08-19 — THE INSTRUMENT MUST KNOW WHEN IT WAS NOT MEASURING. Daniel's second T7 ran
    // 40 minutes and recorded 217 samples that were BYTE-FOR-BYTE IDENTICAL — fps 26.8, frameP50
    // 35, unaccounted 26.32, wallFps 19.6, availMB 5025 — because the iPad slept, the render loop
    // stopped, and every sample copied the same frozen `ledger.report`. Read as a series it says
    // "rock steady for forty minutes". **It was asleep.** Only the native values moved, because
    // the plugin's push timer kept running.
    //
    // This is the defect class the project keeps hunting: an instrument that cannot tell
    // "nothing changed" from "nothing was measured". Two independent tells, both free:
    //   • the ledger hands back the SAME OBJECT until it flushes a new window, so identity is an
    //     exact staleness test that needs no cooperation from the ledger;
    //   • our own timer drifting past its period means the process was throttled or suspended.
    const r0 = ledger?.report || null;
    const stale = !!(r0 && r0 === session.lastReport);
    session.lastReport = r0;
    const sinceLast = session.lastSampleAt ? nowMs() - session.lastSampleAt : 0;
    session.lastSampleAt = nowMs();
    // 1.5x the period is well clear of ordinary timer jitter and unambiguous about a suspension.
    if (sinceLast > SAMPLE_MS * 1.5) {
      event('suspended', { gapSec: Math.round(sinceLast / 1000), expectedSec: SAMPLE_MS / 1000 });
      session.suspendedMs = (session.suspendedMs || 0) + sinceLast - SAMPLE_MS;
    }
    if (stale) session.staleSamples = (session.staleSamples || 0) + 1;
    const nat = readNative();
    const out = readOutputs();
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
      // B668 — the sustained-run limit that is not a frame rate. Falling over hours means the
      // supply cannot keep up with the draw, which ends an exhibit for reasons fps never shows.
      batteryPct: nat?.batteryPct ?? null,
      power: nat?.power ?? null,
      // new pictures per second ON THE DISPLAY — not frames we sent, not frames we rendered
      wallFps: out?.wallFps ?? null,
      broadcasting: out?.broadcasting ?? null,
      recording: out?.recording ?? null,
      wallW: out?.wallW ?? null,
      wallH: out?.wallH ?? null,
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
    if (!stale) { track('fps', s.fps); track('frameP50', s.frameP50); track('wallFps', s.wallFps); }
    track('availMB', s.availMB);
    track('footprintMB', s.footprintMB);
    track('webUsedMB', s.web?.usedMB);
    track('batteryPct', s.batteryPct);
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
    // ⚠️ A STALE SAMPLE IS RECORDED BUT NEVER AGGREGATED. Feeding a frozen reading into min/max/last
    // is what turned a sleeping device into a flat, healthy-looking curve.
    if (stale) s.stale = true;
    if (reason !== 'tick') s.reason = reason;
    persist();
    return s;
  }

  // Events are unbounded because they are discontinuities and each one is the thing you came to
  // find. They are also tiny. A run that drops nothing records nothing here.
  //
  // ⚠️ B661 — AN EVENT PERSISTS IMMEDIATELY, not on the next sample. The whole point of a
  // breadcrumb is that it survives what happens next, and "what happens next" can be a kill three
  // milliseconds later — which is roughly what Daniel saw when he armed a recording.
  function event(kind, detail = {}) {
    // the always-on trail first, so it records even with no session running
    const crumb = { at: new Date().toISOString(), kind, ...detail };
    trail.push(crumb);
    if (trail.length > TRAIL) trail.shift();
    try { localStorage.setItem(TRAIL_KEY, JSON.stringify(trail)); } catch { /* full / private mode */ }
    if (!session) return;
    session.events.push({ t: Math.round((nowMs() - session.t0) / 1000), kind, ...detail });
    persist();
  }

  // The durable tail. Small on purpose: written synchronously every 10s and on every breadcrumb,
  // and the minutes before death are the ones worth keeping.
  function persist() {
    if (!session) return;
    store.write({
      clean: false,
      label: session.label || undefined,
      startedAt: session.startedAt,
      durationSec: Math.round((nowMs() - session.t0) / 1000),
      samples: session.samples,
      agg: session.agg,
      thermalMs: Object.keys(session.thermalMs).length ? session.thermalMs : undefined,
      events: session.events,
      lastBreadcrumb: session.events.length ? session.events[session.events.length - 1] : null,
      tail: session.ring.slice(-TAIL),
    });
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
      // the ONLY place `clean` is set. Anything that skips this path — a crash, a jetsam kill, a
      // force-quit — leaves the record marked unclean, which is exactly what makes it findable.
      store.write({ clean: true, endedAt: new Date().toISOString(), ...done, series: undefined, tail: done.series.slice(-TAIL) });
      session = null;
      return done;
    },

    // ⚠️ THE PREVIOUS RUN, IF IT DIED. Null when the last session stopped cleanly or there was
    // none. This is the crash report: aggregates, every event, the last five minutes of samples,
    // and `lastBreadcrumb` — the operation in flight when the process went away.
    get crashed() { return crashed; },
    // What the app was DOING last time, session or not. Present even when the previous run ended
    // cleanly — a clean exit after a wedged UI still leaves the useful trail.
    get priorTrail() { return priorTrail?.length ? priorTrail : null; },
    // ⚠️ 2026-08-19 — THIS RUN'S BREADCRUMBS, WHICH THE REPORT COULD NOT SEE.
    // `priorTrail` is read from storage ONCE at construction, so it is always the PREVIOUS run.
    // Every crumb written during the current run went to `trail`, which nothing exported. The
    // consequence, and Daniel found it by asking: **a report copied right after an error was the
    // one report that could not contain the error.** `gl-context-lost` has been marked since B660
    // and had never once appeared in a report at the time it mattered. The mark was fine; the
    // window onto it was missing.
    get trail() { return trail.length ? trail.slice() : null; },
    clearCrashed() { store.clear(); try { localStorage.removeItem(TRAIL_KEY); } catch { /* ignore */ } },

    // Anything the app knows is notable — a GL context loss, a take starting, a source swap, an
    // OS memory warning arriving through the host. Callers should NOT gate these on "is it
    // recording": an absent session drops them silently and that is the correct behaviour.
    mark: event,

    // The glanceable verdict. Deliberately coarse — this drives a line in the panel that has to be
    // readable at a glance from across a room, not a diagnosis. `reasons` is what makes it
    // actionable rather than ominous.
    warning() {
      const reasons = [];
      // A run that has lost a fifth of its opening frame rate is degrading, whatever the cause.
      // Shared by the thermal reason above so "serious" and "falling" cannot disagree.
      const fadingFps = () => {
        const f = session?.agg?.fps;
        return !!(f && f.first > 0 && f.last < f.first * 0.8);
      };
      // ⚠️ ALWAYS READ LIVE, never the last sample. A glanceable warning that is up to one sample
      // period stale while recording — and live when idle — would mean two different things
      // depending on a mode the reader cannot see. The trend reasons below are the only ones that
      // legitimately come from the session, because a trend is not a thing you can read instantly.
      const nat = readNative() || {};
      // ⚠️ 2026-08-19 — `serious` ALONE IS NOT A FINDING ON THIS HARDWARE, and T7 proved it. The
      // M1 iPad sat at thermal `serious` for the ENTIRE 40-minute hands-off run — 100% of samples —
      // while fps went 20.0 → 20.4 and the wall went 21.7 → 20.8. **Dead flat.** A warning that
      // fires for forty minutes of a perfectly healthy run is noise, and noise in the one glanceable
      // channel we have on device is worse than silence: the operator learns to ignore the line
      // that is supposed to interrupt them.
      //
      // So `critical` always speaks, and `serious` only speaks when the run is ALSO losing frames.
      // Level plus trend, which is the pair that actually means something.
      if (nat.thermal === 'critical') reasons.push('thermal critical');
      else if (nat.thermal === 'serious' && fadingFps()) reasons.push('thermal serious + fps falling');
      if (nat.availableMB != null && nat.availableMB < LOW_MEM_MB) reasons.push(`${nat.availableMB}MB headroom`);
      if (pressure && pressure.value >= 0.7) reasons.push(`pressure ${pressure.label} (${pressure.source})`);
      if (session) {
        const bad = session.events.filter((e) => e.kind === 'gl-context-lost' || e.kind === 'memory-warning');
        if (bad.length) reasons.push(`${bad.length} × ${bad.length === 1 ? bad[0].kind : 'device event'}`);
        // a run that has lost a fifth of its opening frame rate is degrading, whatever the cause
        const f = session.agg.fps;
        if (fadingFps()) reasons.push(`fps ${f.first} → ${f.last}`);
        // ⚠️ 2026-08-19 — LOSING CHARGE WHILE PLUGGED IN. Daniel predicted this ceiling before any
        // instrument could see it: *"it's charging and outputting power at about the same rate even
        // when mostly idling, so one limit in our sustained thermal scenario will be if we can't
        // charge as fast as we output power."* Measured across three runs: 85% → 80% → 75% in ~58
        // minutes, `power: charging` throughout. **An exhibit that ends this way shows nothing at
        // all in the fps series — it just stops**, which is why this belongs in the glanceable line
        // and not only in the export. A trend reason, so it legitimately comes from the session.
        const b = session.agg.batteryPct;
        if (b && b.last < b.first && nat.power === 'charging') {
          reasons.push(`battery ${b.first}% → ${b.last}% WHILE CHARGING`);
        }
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
        // ⚠️ HOW MUCH OF THIS RUN WAS REAL. A run with stale samples or a suspension is not a
        // shorter run — it is a run whose curve lies unless the reader knows.
        staleSamples: session.staleSamples || undefined,
        suspendedSec: session.suspendedMs ? Math.round(session.suspendedMs / 1000) : undefined,
        measuredWhy: session.staleSamples
          ? `${session.staleSamples} of ${session.samples} samples repeated a frozen reading — the app was suspended or the render loop stopped; those samples are EXCLUDED from the aggregates`
          : undefined,
        agg: session.agg,
        thermalMs: Object.keys(session.thermalMs).length ? session.thermalMs : undefined,
        events: session.events,
        series: session.ring,
      };
    },
  };
}
