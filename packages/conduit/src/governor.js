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

// THE LADDER IS A RATE LADDER, NOT A RESOLUTION LADDER (B575). B568 shipped the resolution
// version and B574 measured it dead on Daniel's M1 iPad, from a single report:
//
//   preview  585×329 = 0.19 MP → 21.93 ms
//   pip      141×79  = 0.011 MP → 12.07 ms
//
// **17x fewer pixels, 55% of the cost.** A line through those two points implies ~11.5ms of FIXED
// cost per editor surface per frame plus ~54ms/MP, so a surface shrunk to nothing would still cost
// 11.5ms. A fixed per-draw cost cannot be scaled away; it can only be skipped. Daniel then A/B'd
// the resolution ladder on and off at the wall and saw no difference in steadiness either.
//
// Each rung is [primary, secondary] as a frame divisor: 2 = every other frame.
const LADDER = [[1, 1], [1, 2], [2, 4], [3, 6]];

// WHICH SURFACE IS "SECONDARY" FLIPS BY MODE, so it cannot be hardcoded by id. In still/motion the
// preview is the big view and the PiP is a thumbnail (1716×965 vs 402×226); in perform the PiP is
// the operator's main view and the preview is the small one (540×303 vs 1550×872) — both from
// Daniel's own B573 reports. Area is the honest proxy for "which one are you actually looking at".
//
// And the B574 measurement is what makes shedding the secondary worth doing at all: because the
// cost is mostly a fixed per-draw term, halving the SMALL view recovers nearly as much as halving
// the big one. We get most of the saving from the surface the operator cares least about.
const byPrimacy = (a, b) => b.mp - a.mp;

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

  // `msPerFrame > 0` excludes surfaces that cost nothing here — the slice overlay is EDITOR
  // priority but draws on its own 2D path and reports 0ms, so rate-limiting it would buy nothing
  // and could only make the overlay lag the render it annotates.
  const editorSurfaces = () => (ledger.report?.surfaces || [])
    .filter((s) => s.priority <= 30 && s.enabled && s.msPerFrame > 0)
    .sort(byPrimacy);

  function applyLevel(n) {
    const [primary, secondary] = LADDER[Math.min(n, LADDER.length - 1)] ?? LADDER[LADDER.length - 1];
    const list = editorSurfaces();
    list.forEach((s, i) => ledger.setSurfaceRate(s.id, i === 0 ? primary : secondary));
    level = n;
    return list;
  }

  // Say it in frames per second rather than divisors, because "the live view is at 15fps" is a
  // thing an operator can judge and "rate 2" is not.
  function rungText(n) {
    const [p, s] = LADDER[Math.min(n, LADDER.length - 1)];
    const t = pressure?.target ?? 0;
    const fps = (d) => (t > 0 ? `${Math.round(t / d)}fps` : `1 frame in ${d}`);
    if (n === 0) return 'full rate';
    return p === s ? `editor views at ${fps(p)}` : `main view ${fps(p)}, second view ${fps(s)}`;
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
      const [primary, secondary] = LADDER[Math.min(level, LADDER.length - 1)];
      return {
        enabled, active, level,
        rates: { primary, secondary },
        rung: rungText(level),
        // which surface it decided is the operator's main view — the decision flips by mode, so
        // a report that omitted it would be unreadable when it picked the one you disagree with
        surfaces: editorSurfaces().map((s) => `${s.id}:${s.mp}MP@${s.rate || 1}`),
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
        if (level >= LADDER.length - 1) reason = `at the bottom rung (${rungText(level)}) and still ${Math.round(shortfall * 100)}% under — the editor surfaces are not the wall here`;
        else reason = `shedding in ${Math.max(0, Math.round(cfg.sustainMs - (now - overSince)))}ms`;
        if (now - overSince >= cfg.sustainMs && level < LADDER.length - 1) {
          const list = applyLevel(level + 1);
          active = true;
          overSince = now;   // re-arm the dwell so we step one rung at a time, never two at once
          reason = `holding ${rungText(level)}${list.length ? ` (main: ${list[0].id})` : ''}`;
          notice(`${rungText(level)} — giving the broadcast the headroom (${Math.round(shortfall * 100)}% under ${target}fps)`);
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
            notice(level === 0 ? '' : rungText(level));
          }
          if (level === 0) { active = false; notice(''); }
        }
        return;
      }
      // in the dead band between the two thresholds: hold whatever we have, reset both dwells so
      // a drift back and forth across one edge cannot accumulate into a step
      overSince = 0; underSince = 0;
      reason = active
        ? `holding ${rungText(level)} — in the dead band`
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
