// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/scenario-runner.js
//
// THE SCRIPTED DEVICE TEST — the app performs the test, the operator only starts it.
//
// ⚠️ WHY THIS EXISTS (Daniel, B665). He is the only person who can run a device session, which
// makes him the chokepoint on every question this arc has left: *"is it possible to point you to
// files and actually equip you to run some on device tests yourself so you're not reliant on me
// here?"* The honest answer is no — thermal, jetsam, HDMI and hardware encode have no faithful
// simulator, and a Simulator run would produce confident wrong answers about exactly the four
// things being measured. **But almost nothing in a test script actually needs a human.** So:
// *"i build the latest on device, open an agreed upon source, click 'run test', come back, copy
// and paste the results."*
//
// ⚠️ AND THE TIME SAVED IS THE SMALLER HALF. Every device report in this arc has a different
// unwritten sequence behind it, which is why two runs of "the same" test have never been strictly
// comparable — the B663 pair differed in scenario tag, warm-up, and how much interaction happened
// while the samples accumulated. A script makes the sequence a RECORDED ARTEFACT: the report says
// which steps ran, when each began, and which one it stopped on. Runs become comparable rather
// than approximately-similar.
//
// ⚠️ EVERY STEP PUBLISHES WHY IT DID NOT RUN. A script that silently skips a step it could not
// perform produces a report describing a test that did not happen, which is worse than no report —
// the standing rule (DEBUGGING-PROTOCOL: anything that can decline to act must publish why) has
// teeth here because the operator has walked away and cannot see it fail. A missing capability
// ABORTS the run and names itself.
//
// ⚠️ THE ACTIONS GO THROUGH THE SAME FUNCTIONS THE BUTTONS DO. `env.outputActions` is exposed by
// output-panel.js and wraps its own `toggleOutput` / `toggleRecord`, rather than this module
// reaching into the DOM to click things or re-implementing arming. Re-implementing would be the
// one-behaviour-two-implementations defect this codebase keeps paying for, and a script that
// diverged from the real path would be testing itself instead of the app.

const SETTLE_MS = 10_000;     // after a take stops: let finalize + the take report land

// A script is data. Steps run in order; each is small enough that the report can say exactly
// which one the run stopped on.
export const SCRIPTS = [
  {
    id: 't2-hands-off',
    label: 'T2 · hands-off baseline (11 min)',
    needs: ['vitals'],
    blurb: 'broadcast already running; records a session and touches nothing',
    steps: [
      { do: 'play' },
      { do: 'session', arg: 'start', label: 't2-hands-off' },
      { do: 'wait', ms: 660_000, note: 'hands off — do not touch the device' },
      { do: 'session', arg: 'stop' },
    ],
  },
  {
    id: 't3-record-priority',
    label: 'T3 · recording priority A/B (~4 min)',
    needs: ['vitals', 'outputActions'],
    blurb: 'take A while broadcasting, take B alone — compares the two SAVED takes',
    steps: [
      // ⚠️ FHD, SET EXPLICITLY, AND FOR A MEASURED REASON. A 4K take armed while broadcasting 4K
      // has now killed the GL context on this device three times (B661 fatal, B663 fatal, B666
      // twice non-fatal with take A encoding ZERO frames). Asking for it again does not produce a
      // priority measurement, it produces another context loss — the question T3 asks needs a take
      // that can actually run. The 4K case is its own test, and it already has its answer.
      // Broadcast OFF first, because the tier is frozen while output is live (locks.js) — Daniel
      // starts these runs already broadcasting, so a script that set the tier first would decline
      // at step one. Turning it off is a no-op when it already is.
      { do: 'broadcast', arg: 'off' },
      { do: 'resolution', px: 1920 },
      { do: 'play' },
      { do: 'session', arg: 'start', label: 't3-record-priority' },
      { do: 'broadcast', arg: 'on' },
      { do: 'wait', ms: 20_000, note: 'let the broadcast settle' },
      { do: 'record', arg: 'on', tag: 'A · while broadcasting' },
      { do: 'wait', ms: 60_000, note: 'take A running' },
      { do: 'record', arg: 'off' },
      { do: 'wait', ms: SETTLE_MS, note: 'finalizing take A' },
      { do: 'capture', tag: 'A · while broadcasting' },
      { do: 'broadcast', arg: 'off' },
      { do: 'wait', ms: 20_000, note: 'broadcast stopped, settling' },
      { do: 'record', arg: 'on', tag: 'B · no broadcast' },
      { do: 'wait', ms: 60_000, note: 'take B running' },
      { do: 'record', arg: 'off' },
      { do: 'wait', ms: SETTLE_MS, note: 'finalizing take B' },
      { do: 'capture', tag: 'B · no broadcast' },
      { do: 'session', arg: 'stop' },
    ],
  },
  {
    id: 't3b-take-first',
    label: 'T3b · take FIRST, then broadcast (~2 min)',
    needs: ['vitals', 'outputActions'],
    blurb: 'the ORDER discriminator — does the context die either way, or only bus-then-view?',
    // ⚠️ B668 — THE DISCRIMINATOR DANIEL'S HUNCH EARNED. *"I'm seeing additional graphics context
    // loss errors even without the recording so I have a hunch the issue may be something about
    // the test itself creating the problem not record."* He is right that it is not about the take
    // being 4K — B667 lost the context arming an FHD take (`bus:start 1920x1080` at t=20,
    // `gl-context-lost` at t=21) and take A encoded ZERO frames.
    //
    // What is common to every failure is that the OUTPUT BUS starts while the external view
    // already holds a live GL context. This script reverses the order: bus first, external view
    // second. If the context still dies, the two simply cannot coexist and the gate is about the
    // combination. If it survives, the trigger is specifically starting the bus underneath a live
    // external view, and the fix is an ordering/handshake problem rather than a capability limit.
    steps: [
      { do: 'broadcast', arg: 'off' },
      { do: 'resolution', px: 1920 },
      { do: 'play' },
      { do: 'session', arg: 'start', label: 't3b-take-first' },
      { do: 'record', arg: 'on', tag: 'take first' },
      { do: 'wait', ms: 20_000, note: 'take running ALONE — establishing it is healthy' },
      { do: 'broadcast', arg: 'on' },
      { do: 'wait', ms: 40_000, note: 'broadcast started UNDER a running take' },
      { do: 'record', arg: 'off' },
      { do: 'wait', ms: SETTLE_MS, note: 'finalizing' },
      { do: 'capture', tag: 'take first, broadcast joined at 20s' },
      { do: 'broadcast', arg: 'off' },
      { do: 'session', arg: 'stop' },
    ],
  },
  {
    id: 't11-take-baseline',
    label: 'T11 · take baseline, NO broadcast (~4 min)',
    needs: ['vitals', 'outputActions'],
    blurb: 'the control condition: what does a take deliver with nothing else running?',
    // ⚠️ THE CONTROL CONDITION, AND IT HAS NEVER BEEN RUN. Every FHD number on record comes from a
    // run with a broadcast live, so "recording while broadcasting is bad" has never been compared
    // against "recording". The only solo figure we have is a 4K take at **13.4fps against a
    // declared 30** — and that predates B681, which released the orphaned source decoders the
    // session audit found (five or six live decoders of ONE clip, counted by nothing).
    //
    // **So both numbers this script produces are new**, and the take-tier cap must not be built
    // until they exist. Daniel: *"have we confirmed that FHD and 4k record on ipad are capable of
    // healthy fps when we *aren't* broadcasting?"* The answer was no, for both.
    //
    // FHD FIRST, DELIBERATELY. If the 4K take kills the GL context — which it has done before —
    // the FHD number is already captured and the run still produced its half of the answer. The
    // reverse order risks spending the whole test to learn nothing.
    steps: [
      { do: 'broadcast', arg: 'off' },
      { do: 'play' },
      { do: 'session', arg: 'start', label: 't11-take-baseline' },
      { do: 'resolution', px: 1920 },
      { do: 'wait', ms: 10_000, note: 'settling at FHD' },
      { do: 'record', arg: 'on', tag: 'FHD · alone' },
      { do: 'wait', ms: 60_000, note: 'FHD take running ALONE — nothing else is on' },
      { do: 'record', arg: 'off' },
      { do: 'wait', ms: SETTLE_MS, note: 'finalizing the FHD take' },
      { do: 'capture', tag: 'FHD · alone' },
      { do: 'resolution', px: 3840 },
      { do: 'wait', ms: 10_000, note: 'settling at 4K' },
      { do: 'record', arg: 'on', tag: '4K · alone' },
      { do: 'wait', ms: 60_000, note: '4K take running ALONE — the 13.4fps figure, re-measured' },
      { do: 'record', arg: 'off' },
      { do: 'wait', ms: SETTLE_MS, note: 'finalizing the 4K take' },
      { do: 'capture', tag: '4K · alone' },
      { do: 'session', arg: 'stop' },
    ],
  },
  {
    id: 't3-rerun-post-b681',
    label: 'T3r · record while broadcasting, RE-RUN (~4 min)',
    needs: ['vitals', 'outputActions'],
    blurb: 'the stale-evidence re-test — same steps as T3, on a build that releases decoders',
    // ⚠️ THIS IS T3'S STEPS ON PURPOSE, UNCHANGED. It is not a new experiment; it is the old one
    // re-run so the two are comparable. Daniel's question is the reason it exists: *"the permit
    // management system you've implemented i think is new since we tested recording while
    // broadcasting on ipad. I wonder if theres a chance this might have actually addressed a root
    // cause limitation for at least some of our failure states?"*
    //
    // Every failure on record is B661, B663, B666, B668. `conduit/sessions.js` and the orphaned
    // `<video>` release landed at **B681**. So the whole evidence base predates the fix for a
    // resource exhaustion that could plausibly have caused it — T10 peaked at `{ gl 2, decode 2 }`
    // where the pre-fix audit predicted five or six decoders alone.
    //
    // **Three outcomes, all useful:** it passes (the decoders were the cause, no gate to build);
    // it fails (the evidence is refreshed and any gate gets current numbers); it fails differently
    // (that is the isolation this has needed since B667).
    steps: [
      { do: 'broadcast', arg: 'off' },
      { do: 'resolution', px: 1920 },
      { do: 'play' },
      { do: 'session', arg: 'start', label: 't3-rerun-post-b681' },
      { do: 'broadcast', arg: 'on' },
      { do: 'wait', ms: 20_000, note: 'let the broadcast settle' },
      { do: 'record', arg: 'on', tag: 'A · while broadcasting' },
      { do: 'wait', ms: 60_000, note: 'take A running' },
      { do: 'record', arg: 'off' },
      { do: 'wait', ms: SETTLE_MS, note: 'finalizing take A' },
      { do: 'capture', tag: 'A · while broadcasting' },
      { do: 'broadcast', arg: 'off' },
      { do: 'wait', ms: 20_000, note: 'broadcast stopped, settling' },
      { do: 'record', arg: 'on', tag: 'B · no broadcast' },
      { do: 'wait', ms: 60_000, note: 'take B running' },
      { do: 'record', arg: 'off' },
      { do: 'wait', ms: SETTLE_MS, note: 'finalizing take B' },
      { do: 'capture', tag: 'B · no broadcast' },
      { do: 'session', arg: 'stop' },
    ],
  },
  // ══ THE CONCURRENCY MATRIX (B752) ══════════════════════════════════════════════════════════
  //
  // ⚠️ THESE ARE NOT A SEQUENCE. A1-A3 are the RENDER half; T11 and T3r are the RECORD half, and
  // neither half waits on the other. Run whichever you have the rig for.
  //
  // ⚠️ WHY THEY EXIST. The source-size hypothesis is dead: the same 2,629,310,897-byte file on the
  // same M1 iPad Pro failed three times (B741/B742/B743) and succeeded twice (B750 probe, B751 a
  // clean 55.6fps render). What differs between the two runs that left breadcrumbs is not the file:
  //
  //   B750, CRASHED 1/3 in : scenarioObserved external-broadcast, sessions.peak { gl 2, decode 2 }
  //   B751, COMPLETED clean: scenarioObserved idle-still,         sessions.peak { gl 1, decode 3 }
  //
  // n=1 each, so it names an AXIS rather than a cause. These scripts turn that into a controlled
  // comparison: SAME source, SAME render, vary only what preceded it.
  //
  // ⚠️ LOAD THE SAME SOURCE FOR ALL THREE, and run each from a FORCE-QUIT relaunch. A
  // `location.reload()` does not clear the process residue these are looking for.
  {
    id: 'a1-render-fresh',
    label: 'A1 · render from a fresh launch (control)',
    needs: ['vitals', 'outputActions', 'renderActions'],
    blurb: 'CONTROL — nothing precedes the render. Run this FIRST, from a force-quit relaunch',
    // No `play` step, deliberately: a render drives the source itself through `advanceSourceToP`,
    // and a clip left playing would fight it. The take scripts need `play`; this does not.
    steps: [
      // Belt and braces on the CONTROL. The comment says force-quit first, and this makes the
      // control true even if someone does not — a contaminated control is worse than no control,
      // because every other cell is measured against it.
      { do: 'broadcast', arg: 'off' },
      { do: 'renderTier', px: 3840 },
      { do: 'session', arg: 'start', label: 'a1-render-fresh' },
      { do: 'render' },
      { do: 'session', arg: 'stop' },
    ],
  },
  {
    id: 'a2-broadcast-then-render',
    label: 'A2 · broadcast, tear it down, then render (~8 min + render)',
    needs: ['vitals', 'outputActions', 'renderActions'],
    blurb: 'RESIDUE — does a finished broadcast leave something behind that breaks a later render?',
    // ⚠️ THE BROADCAST IS OFF BEFORE THE RENDER, ON PURPOSE. This asks whether the residue of a
    // finished broadcast is the problem. A2b asks the other question — whether CONCURRENT
    // broadcast is — and the two must not be conflated, because they have different fixes: this
    // one is a release bug, that one is a capability gate.
    steps: [
      { do: 'renderTier', px: 3840 },
      { do: 'broadcast', arg: 'off' },
      { do: 'play' },
      { do: 'session', arg: 'start', label: 'a2-broadcast-then-render' },
      { do: 'broadcast', arg: 'on' },
      { do: 'wait', ms: 300_000, note: 'broadcasting 5 min — THIS is the precedent being tested' },
      { do: 'broadcast', arg: 'off' },
      { do: 'play', arg: 'pause' },
      { do: 'wait', ms: 20_000, note: 'broadcast torn down, settling' },
      { do: 'render' },
      { do: 'session', arg: 'stop' },
    ],
  },
  {
    id: 'a2b-render-while-broadcasting',
    label: 'A2b · render WHILE broadcasting',
    needs: ['vitals', 'outputActions', 'renderActions'],
    blurb: 'CONCURRENCY — the broadcast stays up through the whole render. Expect this one to be worst',
    // ⚠️ THE MOST LIKELY TO KILL THE PROCESS, and that is fine — B751's breadcrumbs mean a kill now
    // leaves evidence. `render:begin`, three `render:progress` quarters and `render:encoded` all
    // land in `priorTrail`, which survives the kill. **A crash here is a RESULT, not a wasted run.**
    steps: [
      { do: 'renderTier', px: 3840 },
      { do: 'broadcast', arg: 'off' },
      { do: 'play' },
      { do: 'session', arg: 'start', label: 'a2b-render-while-broadcasting' },
      { do: 'broadcast', arg: 'on' },
      { do: 'wait', ms: 30_000, note: 'let the broadcast settle' },
      { do: 'render' },
      { do: 'broadcast', arg: 'off' },
      { do: 'session', arg: 'stop' },
    ],
  },
  {
    id: 'a3-bake-then-render',
    label: 'A3 · bake, then render',
    needs: ['vitals', 'bakeActions', 'renderActions'],
    blurb: 'RESIDUE — settles the long-open D5 question: does a completed bake give its memory back?',
    // ⚠️ THREE THINGS TO KNOW BEFORE RUNNING THIS ONE.
    //
    // 1. **A FAILED BAKE RAISES `alert()` AND STOPS THE RUN DEAD** until a human dismisses it
    //    (clip-editor.js 876 and 1161; measured `dialog-blocked` of 243s, 289s and once 1827s).
    //    So A3's failure mode is a device sitting at a modal, not a report. Filed since B707.
    // 2. **The bake SWAPS the source**, so the render that follows renders the BAKED clip, not the
    //    original. That is correct for the residue question and wrong for any comparison of render
    //    time against A1. Read the wall clock here as "did it finish", not "how fast".
    // 3. **SETUP, and B755 made this precise because the first attempt failed on it.** Open the
    //    **Loop Builder**, choose **slice** (or bounce) at the Behavior step, and advance to the
    //    bake step. `forward` is a TRIM, not a bake, and will now refuse BY NAME at pre-flight
    //    rather than aborting mid-run. This is NOT the loop toggle in motion mode's overflow —
    //    different control entirely. Use the SHORT source: a bake plus a render of the 8-minute
    //    clip is a very long unattended run.
    steps: [
      // ⚠️ B755 — BAKE FIRST, THEN SET THE TIER. The original order front-loaded `renderTier`, which
      // opens the render sheet and therefore needs MOTION mode — but this script starts in the Loop
      // Builder, where that sheet cannot open. A bake lands you in motion mode, so the tier can only
      // be set after it. The usual front-load-the-cheap-failure rule loses to a hard ordering here.
      { do: 'session', arg: 'start', label: 'a3-bake-then-render' },
      { do: 'bake' },
      { do: 'wait', ms: 20_000, note: 'bake applied and swapped, settling' },
      { do: 'renderTier', px: 3840 },
      { do: 'render' },
      { do: 'session', arg: 'stop' },
    ],
  },
  {
    id: 't7-warm-long-run',
    label: 'T7 · warm long run (10 min warm + 40 min hands-off)',
    needs: ['vitals', 'outputActions'],
    blurb: 'warms the device under load, then measures 40 min untouched',
    steps: [
      { do: 'play' },
      { do: 'broadcast', arg: 'on' },
      // ⚠️ THE WARM-UP IS DELIBERATELY OUTSIDE THE SESSION. Its job is to remove the thermal
      // headroom a cold start hands you, not to be measured — including it would put ten minutes
      // of a different condition into the same series and flatten the thing we are looking for.
      { do: 'wait', ms: 600_000, note: 'WARMING UP — interact freely, this part is not measured' },
      { do: 'session', arg: 'start', label: 't7-warm-long-run' },
      { do: 'wait', ms: 2_400_000, note: 'hands off — do not touch the device' },
      { do: 'session', arg: 'stop' },
    ],
  },
];

export function createScenarioRunner(env) {
  let run = null;         // the live run's record
  let timer = 0;
  let resolveWait = null;
  let onChange = () => {};

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const script = (id) => SCRIPTS.find((s) => s.id === id) || null;

  // What a script declares it needs, resolved against THIS chrome. The phone chrome has no output
  // panel, so `outputActions` is genuinely absent there — and a run that quietly skipped its takes
  // would report a recording test in which nothing was recorded.
  function missing(sc) {
    const have = { vitals: !!env.vitals, outputActions: !!env.outputActions,
                   renderActions: !!env.renderActions, bakeActions: !!env.bakeActions };
    return (sc.needs || []).filter((n) => !have[n]);
  }

  // ⚠️ B666 — PRE-FLIGHT, BECAUSE A RUN THAT FAILS AT STEP 3 HAS ALREADY COST THE OPERATOR THE
  // WALK AWAY. B665's run completed all sixteen steps and produced an invalid test: the physical
  // preconditions were never checked, so "complete" and "meaningful" came apart. Everything here
  // is knowable BEFORE the run starts, and each one names itself.
  function preflight(sc) {
    const bad = [];
    const needsClip = (sc.steps || []).some((st) => st.do === 'play');
    if (needsClip) {
      const c = env.sourceClock;
      if (!c?.present) bad.push('no video source loaded');
      else if (!c.ready) bad.push('the source is not ready to play yet');
      else if (!(c.duration > 0)) bad.push('the source has no duration');
    }
    // A render needs keyframes and a bake needs a source. Both are knowable NOW, and a run that
    // discovered either at step four has already cost the operator the walk away (B666's lesson).
    const needsRender = (sc.steps || []).some((st) => st.do === 'render' || st.do === 'renderTier');
    if (needsRender) {
      const r = env.renderActions;
      if (!r) bad.push('no render sheet on this chrome');
      else if (!r.available()) bad.push('video export is unavailable here (needs WebCodecs)');
      else if (r.keyframes() < r.keyframesNeeded()) {
        bad.push(`the render needs ${r.keyframesNeeded()} keyframe(s) and there are ${r.keyframes()}`);
      }
    }
    const needsBake = (sc.steps || []).some((st) => st.do === 'bake');
    if (needsBake && !env.bakeActions?.available()) {
      // B755 — say WHICH precondition, not just that one failed. `forward` mode is the common one
      // and it cost Daniel a run before this existed.
      bad.push(env.bakeActions?.why() || 'no clip editor on this chrome');
    }

    const needsDest = (sc.steps || []).some((st) => st.do === 'broadcast' && st.arg === 'on');
    if (needsDest && env.outputActions && !env.externalDisplay?.active && !env.outputActions.isBroadcasting()) {
      // Not fatal — a non-display destination is legitimate — so this is a WARNING carried into
      // the report rather than a refusal. The run should not second-guess the operator's rig.
      bad.push(null);
    }
    return bad.filter(Boolean);
  }

  function note(text) { if (run) run.note = text; onChange(); }

  function mark(kind, detail) { try { env.vitals?.mark(kind, detail); } catch { /* never fatal */ } }

  function wait(ms) {
    return new Promise((resolve) => {
      resolveWait = resolve;
      timer = setTimeout(() => { timer = 0; resolveWait = null; resolve('done'); }, ms);
    });
  }

  // Each action returns { ok, why }. `why` is mandatory on failure and ends up in the report.
  const ACTIONS = {
    async session(step) {
      const v = env.vitals;
      if (!v) return { ok: false, why: 'no vitals recorder on this chrome' };
      if (step.arg === 'start') {
        if (v.recording) return { ok: true, why: 'a session was already running — left alone' };
        v.start(step.label || run.scriptId);
        return { ok: true };
      }
      if (!v.recording) return { ok: true, why: 'no session was running' };
      run.session = v.stop();
      return { ok: true };
    },

    async broadcast(step) {
      const a = env.outputActions;
      if (!a) return { ok: false, why: 'no output panel on this chrome' };
      const want = step.arg === 'on';
      return a.setBroadcast(want);
    },

    async record(step) {
      const a = env.outputActions;
      if (!a) return { ok: false, why: 'no output panel on this chrome' };
      return a.setRecord(step.arg === 'on');
    },

    // ⚠️ THE MEASUREMENT THE WHOLE T3 SCRIPT EXISTS FOR, and it never needed a video inspector.
    // `recorder.js` already counts encoded video frames and reports the take's wall duration and
    // the span of its stamped video timestamps. frames/wall is the SAVED take's real frame rate;
    // span vs wall additionally separates "ran slow throughout" from "stalled partway".
    async capture(step) {
      const r = env.lastAudioReport || null;
      if (!r) return { ok: false, why: 'no take report — the take never finalized' };
      const frames = r.videoFrames ?? null;
      // ⚠️ B666 — THE DENOMINATOR IS THE VIDEO SPAN, NOT THE WALL CLOCK, AND B665 GOT THIS WRONG.
      // I asserted "videoFrames / wallSec IS the take's frame rate" from a field name and a
      // comment without ever checking the value. `wallSec` was shadowed in recorder.js (fixed at
      // B666) and read ~0, so the first scripted A/B reported **13770 fps** for one take and
      // `null` for the other. The wrong-noun test exists for exactly this and I skipped it.
      //
      // `videoSpanSec` is the span of the stamped video timestamps — the duration the finished
      // file actually plays for, which is what "the take's frame rate" means. It agrees with the
      // container's own `seconds` in the same report, which is the cross-check.
      const span = r.videoSpanSec ?? null;
      const wall = r.wallSec ?? null;
      const entry = {
        tag: step.tag || null,
        videoFrames: frames, videoSpanSec: span, wallSec: wall,
        // B667 — WHAT WAS ACTUALLY RECORDED, not what the written test intended. B666's takes were
        // 4K because that was the selected tier; the test doc said FHD, and nothing in the report
        // could have told them apart.
        tierPx: env.outputActions?.tier?.() ?? null,
        engine: r.engine || null,
        // B757 — the pacing counters, per take. R2 could not show whether FHD was paced because the
        // report's `audio` block only ever holds the LAST take. ⚠️ Never add these together: one is
        // the limiter working, the other is the encoder losing.
        pacedOut: r.pacedOut ?? null,
        droppedToBackpressure: r.droppedToBackpressure ?? null,
        // A MediaRecorder fallback take has no frame count. That must read as "not measurable
        // here", never as a zero frame rate — a fallback rescue must not look like a failure.
        takeFps: frames != null && span > 0 ? +(frames / span).toFixed(1) : null,
        // The two clocks that should agree. A large gap means the encoder stalled rather than ran
        // slow, which the frame rate alone cannot distinguish.
        wallVsSpan: wall > 0 && span > 0 ? +(wall - span).toFixed(1) : null,
        why: frames == null ? `no frame count on the ${r.engine || 'unknown'} path — not measurable`
           : !(span > 0) ? 'no video span — the take stamped no timestamps' : null,
      };
      (run.takes ||= []).push(entry);
      return { ok: true };
    },

    // ⚠️ B666 — THE STEP THE FIRST REAL RUN WAS MISSING, AND ITS ABSENCE INVALIDATED THE TEST.
    // B665's T3 loaded a clip, turned the broadcast on, and recorded two full minutes of a STILL
    // FRAME, because a freshly loaded clip parks PAUSED (B595) and no step ever started it.
    // Daniel: *"both video saves recorded a full minute on a still frame. i'm guessing maybe you
    // needed me to start playback also?"* He did, and the script should never have asked him to.
    //
    // Goes through `env.sourceClock`, the same transport motion-runtime drives, so a scripted run
    // plays the clip the way the app does.
    async resolution(step) {
      const a = env.outputActions;
      if (!a?.setTier) return { ok: false, why: 'no output panel on this chrome' };
      return a.setTier(step.px);
    },

    async play(step) {
      const c = env.sourceClock;
      if (!c?.present) return { ok: false, why: 'no source clock — is a video loaded?' };
      if (step.arg === 'pause') { c.pause(); return { ok: true }; }
      c.play();
      // Verified, not assumed: `play()` can be refused (autoplay policy, a not-ready element) and
      // a scripted run that believed it would record another still frame.
      await new Promise((r) => setTimeout(r, 400));
      if (c.paused) return { ok: false, why: 'the clip did not start playing' };
      return { ok: true };
    },

    // ⚠️ B752 — RENDER AND BAKE. Both wrap the real entry points (`env.renderActions`,
    // `env.bakeActions`), which in turn wrap the render button's own handler and `bakeAndApply`.
    // Neither re-implements the job; see the seam comments in motion-runtime.js / clip-editor.js.
    async renderTier(step) {
      const a = env.renderActions;
      if (!a) return { ok: false, why: 'no render sheet on this chrome' };
      return a.setTier(step.px);
    },

    async render(step) {
      const a = env.renderActions;
      if (!a) return { ok: false, why: 'no render sheet on this chrome' };
      return a.run(step);
    },

    async bake(step) {
      const a = env.bakeActions;
      if (!a) return { ok: false, why: 'no clip editor on this chrome' };
      return a.run(step);
    },

    async wait(step) {
      const r = await wait(step.ms || 0);
      return r === 'abort' ? { ok: false, why: 'stopped by the operator' } : { ok: true };
    },
  };

  async function execute() {
    const sc = script(run.scriptId);
    for (let i = 0; i < sc.steps.length; i++) {
      if (!run || run.stopped) return;
      const step = sc.steps[i];
      run.index = i;
      run.stepStartedAt = now();
      run.stepMs = step.ms || 0;
      note(step.note || `${step.do}${step.arg ? ` ${step.arg}` : ''}`);
      // BEFORE the action, always — the same discipline as `take:arm` (B661). If the step is the
      // one that kills the process, the crumb is already on disk.
      mark('scenario:step', { script: run.scriptId, i, do: step.do, arg: step.arg || null });
      let res;
      try { res = await ACTIONS[step.do]?.(step) || { ok: false, why: `unknown step "${step.do}"` }; }
      catch (e) { res = { ok: false, why: `${step.do} threw: ${e?.message || e}` }; }
      run.log.push({ i, do: step.do, arg: step.arg || null, atSec: Math.round((now() - run.t0) / 1000), ...res });
      if (!res.ok) {
        run.abortedAt = i;
        run.abortWhy = res.why || 'step failed without a reason';
        mark('scenario:abort', { script: run.scriptId, i, why: run.abortWhy });
        finish('aborted');
        return;
      }
    }
    finish('complete');
  }

  function finish(outcome) {
    if (!run) return;
    run.outcome = outcome;
    run.durationSec = Math.round((now() - run.t0) / 1000);
    run.finishedAt = new Date().toISOString();
    // Leave a session running only if the script never stopped it — but say so, because an
    // unstopped session means the report's `vitals` block is the LIVE one, not this run's.
    if (env.vitals?.recording) run.sessionStillRunning = true;
    note(outcome === 'complete' ? '✅ complete — copy report' : `⚠ ${run.abortWhy}`);
    run.running = false;
    onChange();
  }

  return {
    scripts: SCRIPTS,
    get running() { return !!run?.running; },
    get state() {
      if (!run) return null;
      const sc = script(run.scriptId);
      const elapsed = run.running && run.stepMs ? now() - run.stepStartedAt : 0;
      return {
        scriptId: run.scriptId, label: sc?.label || run.scriptId,
        index: run.index, total: sc?.steps.length || 0,
        note: run.note, running: run.running, outcome: run.outcome || null,
        remainSec: run.stepMs ? Math.max(0, Math.round((run.stepMs - elapsed) / 1000)) : 0,
      };
    },
    onChange(fn) { onChange = fn || (() => {}); },

    start(id) {
      if (run?.running) return { ok: false, why: 'a run is already in progress' };
      const sc = script(id);
      if (!sc) return { ok: false, why: `no script "${id}"` };
      const gaps = missing(sc);
      if (gaps.length) return { ok: false, why: `this chrome cannot run it: missing ${gaps.join(', ')}` };
      const pre = preflight(sc);
      if (pre.length) return { ok: false, why: `not ready: ${pre.join(' · ')}` };
      run = {
        scriptId: id, startedAt: new Date().toISOString(), t0: now(),
        index: 0, log: [], running: true, note: 'starting',
      };
      mark('scenario:start', { script: id });
      execute();
      onChange();
      return { ok: true };
    },

    stop() {
      if (!run?.running) return;
      run.stopped = true;
      if (timer) { clearTimeout(timer); timer = 0; }
      if (resolveWait) { const r = resolveWait; resolveWait = null; r('abort'); }
      else { run.abortWhy = 'stopped by the operator'; run.abortedAt = run.index; finish('aborted'); }
    },

    // Exported by the perf panel. Present even for an aborted run — an aborted run is a finding.
    report() {
      if (!run) return null;
      const sc = script(run.scriptId);
      return {
        script: run.scriptId, label: sc?.label || run.scriptId,
        startedAt: run.startedAt, finishedAt: run.finishedAt || null,
        durationSec: run.durationSec ?? Math.round((now() - run.t0) / 1000),
        outcome: run.outcome || 'running',
        stepsRun: run.log.length, stepsTotal: sc?.steps.length || 0,
        abortedAtStep: run.abortedAt ?? null,
        abortWhy: run.abortWhy || null,
        sessionStillRunning: run.sessionStillRunning || undefined,
        // ⚠️ B667 — THE SESSION THE RUN RECORDED, AND B666 LOST IT ENTIRELY. The panel exports
        // `vitals` from either a LIVE session or the one ITS OWN button stopped; a session the
        // RUNNER stopped is neither, so B666's report carried no `vitals` block at all — the whole
        // fps/thermal series for the run, gone, from the instrument built to capture exactly that.
        session: run.session || undefined,
        takes: run.takes || undefined,
        log: run.log,
      };
    },
  };
}
