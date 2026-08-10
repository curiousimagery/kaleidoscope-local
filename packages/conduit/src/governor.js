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

import { PRIORITY } from './perf-ledger.js';

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
// Each rung is [primary, secondary] as a frame divisor: 2 = every other frame. **0 means OFF.**
//
// The last rung starves the second view rather than running it at 5fps, which is Daniel's call
// (B575): "the pip at our lowest 5fps might be more distracting than helpful." B528 found the same
// floor from the other direction on the phone PiP — below about 10Hz a monitor stops reading as
// live and starts reading as broken. **An honest "paused to protect the broadcast" beats a picture
// that looks like a fault.** It also frees a whole 4K source texture and uploader in the app
// process, which matters more for the GPU-process crash than it does for frame rate.
const LADDER = [[1, 1], [1, 2], [2, 4], [3, 0]];

// WHICH SURFACE IS "SECONDARY" FLIPS BY MODE, so it cannot be hardcoded by id. In still/motion the
// preview is the big view and the PiP is a thumbnail (1716×965 vs 402×226); in perform the PiP is
// the operator's main view and the preview is the small one (540×303 vs 1550×872) — both from
// Daniel's own B573 reports. Area is the honest proxy for "which one are you actually looking at".
//
// And the B574 measurement is what makes shedding the secondary worth doing at all: because the
// cost is mostly a fixed per-draw term, halving the SMALL view recovers nearly as much as halving
// the big one. We get most of the saving from the surface the operator cares least about.
const byPrimacy = (a, b) => b.mp - a.mp;

// How much bigger a challenger must be before it takes over as the main view. Daniel's B575
// layout had preview at 0.39MP and pip at 0.37MP, so a 5% difference was deciding which surface
// gets protected — one panel resize away from flipping mid-broadcast and visibly swapping the two
// views' frame rates. A margin makes the choice sticky; it does not need to be large.
const HANDOVER_MARGIN = 1.2;

// `delivered` is the signal this rule should always have used and could not measure until B577:
// how many NEW PICTURES actually reach the audience, against how many the source is producing.
// Governing on APP fps is what B571's consequence 2 warned about — Daniel's own walk showed the
// app's number and the wall moving in OPPOSITE directions, so a rule watching only the app can
// degrade the product while reporting success. It returns null when there is no external surface
// to measure (Syphon, NDI, a plain take), and the app-side shortfall stays the fallback there.
export function createGovernor({ ledger, pressure, isBroadcasting, delivered = null, onNotice = null, opts = {} } = {}) {
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
  const governed = new Set();    // ids we have set a rate on, so we can always put them back
  const starved = new Set();     // ...and the ones we switched OFF, tracked separately so we never
                                 // re-enable something the operator turned off by hand
  let primaryId = '';            // the sticky main view (see HANDOVER_MARGIN)
  let signal = 'app';            // which shortfall we are acting on: 'display' or 'app'

  // MEMBERSHIP IS BY PRIORITY, NOT BY COST (B576). B575 filtered on `msPerFrame > 0` to keep the
  // slice overlay out, and that made membership FLICKER: the overlay draws only during a gesture,
  // so it entered the governed set mid-drag, took the secondary rate, and then dropped out of the
  // filter and was never reset — Daniel's report shows it stuck at `rate: 6` with `calls: 0`.
  //
  // `PRIORITY.EDITOR` exactly is a structural test that cannot flicker. The overlay is DECOR and is
  // now excluded permanently, which is also the honest answer: its 2D draw path does not consult
  // `perf.skip`, so a rate on it changes nothing except the report. Governing it means teaching
  // that path to check first (its own comment already says "the lever here is WHEN it draws").
  // `|| starved.has(id)` is not optional. A surface we switched OFF reports `enabled: false`, so
  // filtering on `enabled` alone would drop it from the very list the reset path walks — the exact
  // coupling that left three surfaces throttled at B575.
  const candidates = () => (ledger.report?.surfaces || [])
    .filter((s) => s.priority === PRIORITY.EDITOR && (s.enabled || starved.has(s.id)))
    .sort(byPrimacy);

  // Sticky main view, so a near-tie cannot hand over on a rounding difference.
  function ordered() {
    const list = candidates();
    if (list.length < 2) { primaryId = list[0]?.id || ''; return list; }
    const held = list.find((s) => s.id === primaryId);
    if (held && list[0].mp < held.mp * HANDOVER_MARGIN) return [held, ...list.filter((s) => s !== held)];
    primaryId = list[0].id;
    return list;
  }

  // EVERY SURFACE WE HAVE EVER TOUCHED, so the reset path cannot depend on the same query that
  // decided to touch it. That coupling is what left three surfaces throttled with the governor
  // reporting `level: 0, rates {1,1}` (B575).
  function applyLevel(n) {
    const [primary, secondary] = LADDER[Math.min(n, LADDER.length - 1)] ?? LADDER[LADDER.length - 1];
    const list = ordered();
    const keep = new Set(list.map((s) => s.id));
    for (const id of [...governed]) {
      if (keep.has(id)) continue;
      ledger.setSurfaceRate(id, 1);
      governed.delete(id);
    }
    list.forEach((s, i) => {
      const r = i === 0 ? primary : secondary;
      if (r === 0) {
        // starve, not slow. `setSurfaceEnabled` is the existing actuator; we only ever undo what
        // WE turned off, so a surface the operator switched off by hand stays off.
        if (!starved.has(s.id)) { ledger.setSurfaceEnabled(s.id, false); starved.add(s.id); }
      } else {
        if (starved.has(s.id)) { ledger.setSurfaceEnabled(s.id, true); starved.delete(s.id); }
        ledger.setSurfaceRate(s.id, r);
      }
      if (n > 0) governed.add(s.id); else governed.delete(s.id);
    });
    level = n;
    return list;
  }

  // Say it in frames per second rather than divisors, because "the live view is at 15fps" is a
  // thing an operator can judge and "rate 2" is not.
  function rungText(n) {
    const [p, s] = LADDER[Math.min(n, LADDER.length - 1)];
    const t = pressure?.target ?? 0;
    const fps = (d) => (d === 0 ? 'PAUSED' : t > 0 ? `${Math.round(t / d)}fps` : `1 frame in ${d}`);
    if (n === 0) return 'full rate';
    if (s === 0) return `main view ${fps(p)}, second view PAUSED`;
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
        // reports the ACTUAL rate off the report row, not the rate we believe we set — the B575
        // bug was precisely those two disagreeing, so the readout must not read from intent
        surfaces: candidates().map((s) => `${s.id}:${s.mp}MP@${s.rate || 1}${s.id === primaryId ? ' (main)' : ''}`),
        governing: [...governed],
        reason,
        // WHICH shortfall the decision came from. Without it, a governor holding steady is
        // ambiguous between "the display is fine" and "we could not measure the display".
        signal,
        starved: [...starved],
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
      // WHAT REACHES THE AUDIENCE OUTRANKS WHAT THE APP MANAGED (B581). `delivered` compares new
      // pictures ON THE DISPLAY against frames the source produced; when there is no external
      // surface it returns null and the app-side shortfall stands.
      let d = null;
      try { d = delivered?.(); } catch { d = null; }
      const useDisplay = !!(d && d.expected > 0 && d.shown >= 0);
      signal = useDisplay ? 'display' : 'app';
      const shortfall = useDisplay
        ? Math.max(0, Math.min(1, 1 - d.shown / d.expected))
        : (pressure?.shortfall ?? 0);
      const target = useDisplay ? Math.round(d.expected) : (pressure?.target ?? 0);

      // No broadcast, or no declared target to be short OF, means nothing to govern. Releasing on
      // "no target" matters: an undeclared rate is not evidence of health, and holding surfaces
      // down on a signal we cannot compute would be degrading the app for an unknown reason.
      if (!broadcasting) { reason = 'no live output — nothing to protect'; this.release(); return; }
      if (!(target > 0)) { reason = 'no declared frame rate to be short of'; this.release(); return; }

      if (shortfall > cfg.shedAbove) {
        underSince = 0;
        // NOTHING TO SHED IS ITS OWN ANSWER (B576). B575 advanced `level` whether or not
        // `applyLevel` had anything to act on, so with both editor surfaces switched off by hand
        // the governor walked itself 3 → 0 against an empty list and then reported full rate while
        // three surfaces were still throttled. A governor whose own state can drift from the world
        // is worse than none, because its state is the diagnostic.
        if (!candidates().length) {
          reason = 'no editor surfaces to shed — they are already off, and the shortfall is elsewhere';
          this.release();
          return;
        }
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
    // Full restore. Resets from the `governed` SET rather than from a fresh query, so a surface
    // that has since been disabled, resized to nothing or stopped costing anything still gets put
    // back. Idempotent.
    release() {
      overSince = 0; underSince = 0;
      if (!active && level === 0 && !governed.size && !starved.size) return;
      for (const id of governed) ledger.setSurfaceRate(id, 1);
      for (const id of starved) ledger.setSurfaceEnabled(id, true);
      governed.clear();
      starved.clear();
      level = 0;
      active = false;
      notice('');
    },
  };
}
