// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// conduit/governor.js
//
// THE FIRST THING THAT ACTS ON THE MEASUREMENTS. The perf ledger has been able to see for a
// dozen builds and has never been allowed to do anything; `PRIORITY.DECOR → EDITOR → PROGRAM →
// CAPTURE` has been declared since B512 and nothing consulted it. This does.
//
// WHAT IT IS FOR, in Daniel's words (B566): while broadcasting, "we'd rather allocate the iPad
// resources to the broadcast than the pip which is redundant to the external display anyway."
// Measured stakes on his M1 iPad at 4K: `preview render` 14.36ms + `pip render` 9.91ms = 24.3ms
// of a 44ms frame, against 4.14ms to upload the entire 8.29MP source. The editor surfaces ARE
// the wall.
//
// WHY IT IS MEASURED RATHER THAN A BLANKET RULE. The obvious alternative — always hide the PiP
// during any broadcast — was considered and rejected for two reasons:
//
//   1. **It breaks the case it is meant to help.** "The PiP is redundant to the external display"
//      is true for HDMI and FALSE for Syphon and NDI, where there is no second screen in the room
//      and the PiP is the operator's only view of the program. A blanket rule blinds the operator
//      exactly where they can least afford it.
//   2. **It is classification, and this project's rule is to probe.** An M3 iPad Pro may run both
//      comfortably. Deciding by fiat that nobody can is the mistake CAPABILITIES §1 exists to
//      prevent, and the one this arc has been burned by repeatedly.
//
// THE INPUT IS `shortfall`, NOT `pressure`. That distinction is the whole reason B559 split them.
// Pressure means "getting worse" — a thermal signal, relative to a learned baseline, and
// structurally blind to a device that has been slow the entire time. Shortfall means "not good
// enough", absolute against the rate we declared we were trying to hit. **A governor that sheds
// work must act on the second.** Acting on drift would degrade a device that is struggling
// steadily and ignore it once it settled into struggling.
//
// IT ONLY EVER TOUCHES EDITOR-PRIORITY SURFACES. The declared order is the contract: what the
// audience looks at is never sacrificed for what the operator looks at. If shedding every editor
// surface is not enough, the honest answer is a capability statement, not a degraded broadcast.

const DEFAULTS = {
  // How far under target we tolerate before shedding. 0.25 = running at 75% of the declared rate.
  shedAbove: 0.25,
  // …and where we consider it recovered. The gap between these two IS the hysteresis: without it
  // a surface that is stepped down improves the number, which restores it, which degrades the
  // number again — a visible oscillation, and the failure mode most likely to make this feel
  // broken rather than helpful.
  restoreBelow: 0.1,
  // Sustained, not instantaneous. A single slow window is a hiccup (a gesture, a source swap, a
  // GC pause); two seconds of it is a condition. Prevents the governor firing on the transient
  // spike that starting a broadcast itself produces.
  sustainMs: 2000,
  // Same dwell on the way back, so recovery is not twitchy either.
  recoverMs: 4000,
};

// The ladder every editor surface walks, worst-last. Daniel measured these rungs on iPad staged
// preview (B516): 75% barely noticeable, 50% the usable floor, 25% reserved as an honest "not at
// full resolution" distress signal rather than a quality rung.
const LADDER = [1, 0.75, 0.5, 0.35];

export function createGovernor({ ledger, pressure, isBroadcasting, onNotice = null, opts = {} } = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  let enabled = true;
  let level = 0;                 // 0 = untouched; each step walks LADDER one rung down
  let overSince = 0, underSince = 0;
  let active = false;            // are we currently holding anything down?
  let lastNotice = '';
  // WHY THE LAST TICK DID NOTHING. Three builds have now shipped a governor that silently no-opped
  // for three DIFFERENT reasons (undeclared target B571, a clobbered subscription B572, a false
  // broadcast probe B573), and each cost a device session to find because the only observable was
  // an absence. A rule that decides not to act must say so out loud, in the exported report.
  let reason = 'not started';
  let lastTick = 0;

  const editorSurfaces = () => (ledger.report?.surfaces || []).filter((s) => s.priority <= 30 && s.enabled);

  function applyLevel(n) {
    const scale = LADDER[Math.min(n, LADDER.length - 1)] ?? LADDER[LADDER.length - 1];
    for (const s of editorSurfaces()) {
      // a surface with a single-rung ladder has declared itself unscalable — respect that rather
      // than forcing a scale its actuator will ignore
      if (!s.scaleLadder || s.scaleLadder.length < 2) continue;
      ledger.setSurfaceScale(s.id, scale);
    }
    level = n;
  }

  function notice(text) {
    if (text === lastNotice) return;
    lastNotice = text;
    try { onNotice?.(text); } catch { /* a chrome that cannot show it must not break the loop */ }
  }

  return {
    get enabled() { return enabled; },
    set enabled(v) {
      enabled = !!v;
      if (!enabled && active) this.release();
    },
    get level() { return level; },
    get active() { return active; },

    // The readout that rides the exported frame-cost report. `reason` is the whole point: it is
    // the difference between "the governor decided the app is fine" and "the governor has been
    // switched off by a predicate that reads the wrong object", which are indistinguishable from
    // the outside and have both happened.
    get state() {
      return {
        enabled, active, level,
        scale: LADDER[Math.min(level, LADDER.length - 1)],
        reason,
        broadcasting: (() => { try { return !!isBroadcasting?.(); } catch { return 'probe threw'; } })(),
        target: pressure?.target ?? 0,
        shortfall: Math.round((pressure?.shortfall ?? 0) * 100) / 100,
        shedAbove: cfg.shedAbove,
        ticking: lastTick > 0 && (Date.now() - lastTick) < 5000,
      };
    },

    // Called once per ledger window. Deliberately pull-based rather than a subscription: the
    // ledger already runs a rAF and a second timer would be a second thing to get wrong.
    tick(now) {
      lastTick = Date.now();
      if (!enabled) { reason = 'disabled'; return; }
      let broadcasting = false;
      try { broadcasting = !!isBroadcasting?.(); }
      catch (e) { reason = `broadcast probe threw: ${e?.message || e}`; return; }
      const shortfall = pressure?.shortfall ?? 0;
      const target = pressure?.target ?? 0;

      // No broadcast, or no declared target to be short OF, means nothing to govern. Releasing on
      // "no target" matters: an undeclared rate is not evidence of health, and holding surfaces
      // down on a signal we cannot compute would be degrading the app for an unknown reason.
      if (!broadcasting) { reason = 'no live output — nothing to protect'; this.release(); return; }
      if (!(target > 0)) { reason = 'no declared frame rate to be short of'; this.release(); return; }

      if (shortfall > cfg.shedAbove) {
        underSince = 0;
        if (!overSince) overSince = now;
        if (level >= LADDER.length - 1) reason = `at the bottom rung (${Math.round(LADDER[level] * 100)}%) and still ${Math.round(shortfall * 100)}% under — the ladder is not the answer here`;
        else reason = `shedding in ${Math.max(0, Math.round(cfg.sustainMs - (now - overSince)))}ms`;
        if (now - overSince >= cfg.sustainMs && level < LADDER.length - 1) {
          applyLevel(level + 1);
          active = true;
          overSince = now;   // re-arm the dwell so we step one rung at a time, never two at once
          const pct = Math.round(LADDER[level] * 100);
          reason = `holding editor surfaces at ${pct}%`;
          notice(`preview at ${pct}% — giving the broadcast the headroom (${Math.round(shortfall * 100)}% under ${target}fps)`);
        }
        return;
      }

      if (active && shortfall < cfg.restoreBelow) {
        overSince = 0;
        if (!underSince) underSince = now;
        reason = `recovering in ${Math.max(0, Math.round(cfg.recoverMs - (now - underSince)))}ms`;
        if (now - underSince >= cfg.recoverMs) {
          underSince = now;
          if (level > 0) {
            applyLevel(level - 1);
            notice(level === 0 ? '' : `preview at ${Math.round(LADDER[level] * 100)}%`);
          }
          if (level === 0) { active = false; notice(''); }
        }
        return;
      }
      // in the dead band between the two thresholds: hold whatever we have, reset both dwells so
      // a drift back and forth across one edge cannot accumulate into a step
      overSince = 0; underSince = 0;
      reason = active
        ? `holding at ${Math.round(LADDER[level] * 100)}% — in the dead band`
        : `keeping up (${Math.round(shortfall * 100)}% under, sheds above ${Math.round(cfg.shedAbove * 100)}%)`;
    },

    // Full restore — broadcast stopped, governor disabled, or teardown. Idempotent.
    release() {
      overSince = 0; underSince = 0;
      if (!active && level === 0) return;
      applyLevel(0);
      active = false;
      notice('');
    },
  };
}
