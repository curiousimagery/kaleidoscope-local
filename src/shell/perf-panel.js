// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/perf-panel.js
//
// THE FRAME-COST PANEL — the readout and the switchboard for conduit's perf ledger.
//
// WHAT IT IS FOR, in one line: answer "what is this app spending per frame, on what, for
// whom" on the actual device, and let each of those costs be switched off or scaled down
// while you watch the number move.
//
// WHY THE SWITCHES MATTER MORE THAN THE NUMBERS. Mobile GPUs give us no timer queries, and
// `performance.now()` around a draw call measures SUBMISSION, not execution — the GPU is
// asynchronous. So the ms column is a real but partial signal (it catches CPU-side cost and,
// when the pipeline is saturated, back-pressure) while the honest per-item cost on those
// devices is the delta you see in FPS when you turn something off. Hence: every row has a
// switch, and every render surface has a resolution ladder. The resolution stepper is the one
// Daniel asked for by name — walk each surface down until quality visibly suffers, and walk
// it up until you cannot see the improvement. Those two rungs per surface per device ARE the
// degradation ladder a governor will later drive.
//
// ENTRY POINTS, and why there are three. A URL parameter cannot reach the Capacitor builds
// (the native shell loads a fixed URL), and the native builds are exactly where the expensive
// paths live — native decode, native camera, HDMI, NDI, native record — none of which exist
// in mobile Safari. So: `?perf` on web/Electron, a diagnostics button on the desktop chrome
// (which is what iPad runs), and an inline mount inside the phone chrome's diagnostics block.
//
// NOTHING HERE CHANGES HOW THE APP BEHAVES unless you touch a switch, and nothing persists
// except a baseline you explicitly save.

import { perfFlags, PERF_FLAG_SPECS, PERF_FLAG_DEFAULTS } from './perf-flags.js';
import { wakeLockState } from '../kit/wake-lock.js';
import { sessionReport } from 'conduit/sessions';
import { panProbe } from '../kit/pan.js';
import { externalGuardState } from './external-display.js';

const BASELINE_KEY = 'foldPerfBaseline';

// The named runs, so a measurement is comparable across sessions, devices and builds instead
// of being ad hoc. Picking one before you measure is the entire discipline.
const SCENARIOS = [
  'idle-still', 'camera-live', 'video-playback',
  'recording', 'hdmi-broadcast', 'airplay-broadcast', 'ndi-broadcast',
];

// ⚠️ WHAT IS ACTUALLY RUNNING, DERIVED — because the tag above is typed by a human and has now
// invalidated two measurements. It read `idle-still` during a 4K broadcast at B609, and on
// 2026-08-19 a forty-minute run came back with the battery flat where the previous one had drained
// 22.5%/hr, **and nothing in the report could say which power path or which video path it used**:
// there was no `airplay-broadcast` option at all, so an AirPlay run was necessarily filed as HDMI.
//
// The dropdown stays authoritative (a human may be measuring something the app cannot name), but a
// disagreement is now stated in the report instead of silently corrupting the comparison. Naming
// beats blocking: a guard that refuses to export would have cost that run entirely.
function observedScenario(env) {
  if (env.outputActions?.isRecording?.()) return 'recording';
  if (env.outputActions?.isBroadcasting?.()) {
    const dest = env.outputDestId?.() || '';
    if (dest === 'ndi') return 'ndi-broadcast';
    if (dest === 'syphon') return 'syphon-broadcast';
    if (dest === 'window') return 'window-broadcast';
    // ⚠️ AND HERE IS THE HONEST LIMIT: **iOS presents an HDMI panel and an AirPlay receiver
    // identically**, as an external UIScreen. There is no API that distinguishes them, so the app
    // genuinely cannot derive which wire is in use — the hand-picked tag stays the only record of
    // it, which is exactly why `airplay-broadcast` had to be added to the list above.
    if (env.externalDisplay?.active) return 'external-broadcast';
    return 'broadcast';
  }
  if (env.live?.isLive) return 'camera-live';
  const playing = env.nativeVideo ? !env.nativeVideo.clock?.paused
    : !!(env.sourceVideo && !env.sourceVideo.paused);
  return playing ? 'video-playback' : 'idle-still';
}

// Does the hand-picked tag CONTRADICT what the app can see? Deliberately not a strict equality:
// `hdmi-broadcast` and `airplay-broadcast` are both honest labels for `external-broadcast`, and
// flagging those as a mismatch would train the reader to ignore the flag — which is worse than not
// having one. Only a genuine contradiction (tagged idle while broadcasting) is worth saying.
function scenarioMismatch(tag, observed) {
  if (tag === observed) return null;
  const externalOk = observed === 'external-broadcast'
    && (tag === 'hdmi-broadcast' || tag === 'airplay-broadcast');
  if (externalOk) return null;
  return `tagged "${tag}" while the app observed "${observed}" — treat any baseline diff across this as void`;
}

const CSS = `
#perfPanel { font: 11px/1.4 var(--font-ui, system-ui); color: var(--text-secondary, #bbb); }
/* floating so it can stay up WHILE the app is being used — the measurement is meaningless if
   reading it requires covering the thing you are measuring (which is what mounting it inside
   the phone's save sheet did) */
#perfPanel.floating { position: fixed; right: 12px; bottom: 12px; z-index: 99997; width: 340px;
  max-width: calc(100vw - 24px); max-height: 62vh; overflow-y: auto;
  background: var(--surface-panel, #141414); border: 1px solid var(--border, #333);
  border-radius: var(--radius-md, 8px); padding: 10px 12px; box-shadow: 0 8px 24px rgba(0,0,0,.5); }
/* keep clear of the phone's home indicator / safe area */
@supports (padding: env(safe-area-inset-bottom)) {
  #perfPanel.floating { bottom: calc(12px + env(safe-area-inset-bottom)); }
}
#perfPanel.floating.min { max-height: none; overflow: visible; }
#perfPanel.floating.min > *:not(.pf-head) { display: none; }
#perfPanel .pf-cap { border-bottom: 0; padding-top: 10px; }
#perfPanel .pf-head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
#perfPanel .pf-title { font-weight: 600; color: var(--text, #eee); }
#perfPanel button { background: var(--surface-control, #1e1e1e); color: inherit; cursor: pointer;
  border: 1px solid var(--border, #333); border-radius: 4px; font: inherit; font-size: 10px; padding: 3px 7px; }
#perfPanel button:hover { color: var(--text, #eee); }
#perfPanel button.off { opacity: .45; text-decoration: line-through; }
#perfPanel select { background: var(--surface-control, #1e1e1e); color: inherit; font: inherit;
  font-size: 10px; border: 1px solid var(--border, #333); border-radius: 4px; padding: 2px 4px; }
#perfPanel .pf-top { display: flex; gap: 10px; flex-wrap: wrap; padding: 6px 0; border-bottom: 1px solid var(--border, #333); }
#perfPanel .pf-stat b { color: var(--text, #eee); font-variant-numeric: tabular-nums; }
#perfPanel .pf-stat.warn b { color: var(--warn, #e2b04a); }
#perfPanel .pf-stat.bad b { color: var(--danger, #e2685a); }
/* full-width sentence inside the wrapping stat row — a title tooltip is not a channel on iPad */
#perfPanel .pf-why { flex-basis: 100%; color: var(--text-faint, #666); }
#perfPanel .pf-why.bad { color: var(--danger, #e2685a); }
#perfPanel .pf-why.warn { color: var(--warn, #e0a33a); }
/* B660 — the session button reads as ARMED while recording, because the one failure mode of an
   explicit session is forgetting it is running (or forgetting it is not). */
#perfPanel .pf-rec { color: var(--danger, #e2685a); border-color: var(--danger, #e2685a); }
#perfPanel .pf-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,.05); }
#perfPanel .pf-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#perfPanel .pf-name em { font-style: normal; color: var(--text-faint, #666); }
/* THE NOTE GETS ITS OWN LINE (B606). It lived inside .pf-name, which is nowrap + ellipsis, so on
   the iPad's panel width it was truncated to about six characters — "progra…" — and the rest was
   reachable only through a title tooltip, which is unhoverable on a touch device. So the single
   most diagnostic line in the panel ("planar · native decode · 30 in/s", "NO NATIVE DECODE: …")
   has never once been readable on the device it exists for (Daniel, B605). */
#perfPanel .pf-note { flex-basis: 100%; margin: -2px 0 4px 34px; font-size: 11px; line-height: 1.35;
  color: var(--text-faint, #888); white-space: normal; overflow-wrap: anywhere; }
#perfPanel .pf-note.warn { color: var(--c-warn, #e8b339); }
#perfPanel .pf-num { font-variant-numeric: tabular-nums; color: var(--text, #eee); min-width: 42px; text-align: right; white-space: nowrap; }
#perfPanel .pf-num.pf-wide { min-width: 108px; }
#perfPanel .pf-delta { font-variant-numeric: tabular-nums; min-width: 40px; text-align: right; font-size: 10px; }
#perfPanel .pf-delta.up { color: var(--danger, #e2685a); }
#perfPanel .pf-delta.down { color: var(--ok, #6ac47a); }
#perfPanel .pf-pass { padding-left: 12px; color: var(--text-faint, #666); }
#perfPanel .pf-foot { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
#perfPanel textarea { width: 100%; height: 120px; margin-top: 8px; font: 10px/1.35 var(--font-mono, monospace);
  background: #0d0d0d; color: #ddd; border: 1px solid var(--border, #333); border-radius: 4px; }
`;

const pct = (a, b) => (b > 0 ? ((a - b) / b) * 100 : 0);

export function mountPerfPanel(env, { container = null, onClose = null } = {}) {
  const ledger = env.perf;
  if (!ledger) return null;

  const panel = document.createElement('div');
  panel.id = 'perfPanel';
  if (!container) panel.classList.add('floating');
  const style = document.createElement('style');
  style.textContent = CSS;
  panel.appendChild(style);

  // ---- header --------------------------------------------------------------
  const head = document.createElement('div');
  head.className = 'pf-head';
  const title = document.createElement('span');
  title.className = 'pf-title'; title.textContent = 'frame cost';
  const scenarioSel = document.createElement('select');
  for (const s of SCENARIOS) {
    const o = document.createElement('option'); o.value = s; o.textContent = s; scenarioSel.appendChild(o);
  }
  const pauseBtn = document.createElement('button');
  pauseBtn.textContent = 'pause';
  pauseBtn.addEventListener('click', () => {
    ledger.enabled = !ledger.enabled;
    pauseBtn.textContent = ledger.enabled ? 'pause' : 'resume';
  });
  head.append(title, scenarioSel, pauseBtn);
  if (!container) {
    const minBtn = document.createElement('button');
    minBtn.textContent = '–';
    minBtn.addEventListener('click', () => {
      panel.classList.toggle('min');
      minBtn.textContent = panel.classList.contains('min') ? '+' : '–';
    });
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.title = 'close (restores every switch and resolution)';
    closeBtn.addEventListener('click', () => api.destroy());
    head.append(minBtn, closeBtn);
  }
  panel.appendChild(head);

  // ---- draggable ------------------------------------------------------------
  // It has to move: it sits bottom-right, which is exactly where the broadcast sheet lives, and
  // whichever one is on top makes the other unusable (Daniel, B515). Drag by the header, clamp
  // into the viewport so it can never be thrown off-screen, and remember where it was left —
  // repositioning it on every open would be its own small tax on a measurement session.
  const POS_KEY = 'foldPerfPanelPos';
  function placeAt(x, y) {
    const w = panel.offsetWidth || 320, h = panel.offsetHeight || 200;
    const cx = Math.max(4, Math.min(window.innerWidth - w - 4, x));
    const cy = Math.max(4, Math.min(window.innerHeight - h - 4, y));
    panel.style.left = cx + 'px';
    panel.style.top = cy + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    return { x: cx, y: cy };
  }
  if (!container) {
    let dragging = false, offX = 0, offY = 0;
    head.style.cursor = 'grab';
    head.style.touchAction = 'none';   // so a drag on the header is not stolen by page scrolling
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, select')) return;   // the controls keep working
      const r = panel.getBoundingClientRect();
      dragging = true; offX = e.clientX - r.left; offY = e.clientY - r.top;
      head.setPointerCapture(e.pointerId);
      head.style.cursor = 'grabbing';
      e.preventDefault();
    });
    head.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      placeAt(e.clientX - offX, e.clientY - offY);
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      head.style.cursor = 'grab';
      try { head.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      const r = panel.getBoundingClientRect();
      try { localStorage.setItem(POS_KEY, JSON.stringify({ x: r.left, y: r.top })); } catch { /* private mode */ }
    };
    head.addEventListener('pointerup', endDrag);
    head.addEventListener('pointercancel', endDrag);
    // a remembered position from a bigger window must still land on screen in a smaller one
    window.addEventListener('resize', () => {
      if (panel.style.left) placeAt(parseFloat(panel.style.left), parseFloat(panel.style.top));
    });
  }

  const top = document.createElement('div'); top.className = 'pf-top';
  const rows = document.createElement('div');
  panel.append(top, rows);

  // ---- baseline ------------------------------------------------------------
  // A saved baseline is what turns this from a live curiosity into regression detection: run
  // the same named scenario after a change and the deltas say whether you paid for it.
  const deviceKey = () => `${navigator.platform || 'x'}|${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`;
  const slot = () => `${BASELINE_KEY}:${deviceKey()}:${scenarioSel.value}`;
  function loadBaseline() {
    try { return JSON.parse(localStorage.getItem(slot()) || 'null'); } catch { return null; }
  }
  let baseline = loadBaseline();
  scenarioSel.addEventListener('change', () => { baseline = loadBaseline(); paint(ledger.report); });

  // the last finished session, kept so `copy report` still carries it after you press stop —
  // otherwise the run you just completed vanishes at the moment you go to report it
  let lastSession = null;
  const fmtDur = (sec) => (sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, '0')}` : `${Math.floor(sec / 3600)}h${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}`);

  const foot = document.createElement('div'); foot.className = 'pf-foot';
  const saveBtn = document.createElement('button'); saveBtn.textContent = 'save baseline';
  const clearBtn = document.createElement('button'); clearBtn.textContent = 'clear';
  const copyBtn = document.createElement('button'); copyBtn.textContent = 'copy report';
  const out = document.createElement('textarea'); out.readOnly = true; out.hidden = true;

  // ⚠️ B660 — START A SESSION, THEN GO AND WORK. Daniel's shape: *"i'd still go into the frame cost
  // diagnostic, but to 'start a session' where we begin recording then shift to the workflow."*
  //
  // The button is the whole point of the instrument. The panel's other numbers are instantaneous —
  // copying a report at minute nine says what minute nine looked like and cannot say it is worse
  // than minute one. A session gives the samples a known t=0 and keeps recording while the panel is
  // closed, which is the only way the long-run questions get answered.
  const vitals = env.vitals || null;

  // ⚠️ B665 — THE SCRIPTED RUN. Daniel is the only person who can run a device session, which makes
  // him the chokepoint on every open question in this arc. Almost nothing in a test script needs a
  // human: the app can drive the sequence and the report can carry which steps ran. See
  // shell/scenario-runner.js for why the actions go through the real controls.
  const runner = env.scenarioRunner || null;
  let crashDismissed = false;
  const crashNote = document.createElement('div');
  crashNote.className = 'pf-why bad'; crashNote.hidden = true;
  crashNote.style.cursor = 'pointer';
  crashNote.title = 'click to dismiss — it stays in the exported report either way';
  crashNote.addEventListener('click', () => { crashDismissed = true; vitals?.clearCrashed?.(); paintSession(); });
  const sessBtn = document.createElement('button');
  const sessNote = document.createElement('div'); sessNote.className = 'pf-why';
  function paintSession() {
    if (!vitals) { sessBtn.hidden = true; sessNote.hidden = true; return; }
    // ⚠️ B661 — A RECOVERED CRASH OUTRANKS EVERYTHING ELSE IN THIS PANEL. The previous run died
    // without an orderly stop, and the operator is the only one who can say what they were doing.
    // Shown until dismissed, and carried in the export regardless, because the whole reason it
    // exists is that the session it describes could not report itself.
    const c = vitals.crashed;
    if (c && !crashDismissed) {
      crashNote.hidden = false;
      const bc = c.lastBreadcrumb;
      crashNote.textContent = `⚠ previous session ended UNCLEANLY after ${fmtDur(c.durationSec || 0)}`
        + (bc ? ` · last op: ${bc.kind} @ ${fmtDur(bc.t)}` : ' · no breadcrumb')
        + (c.agg?.availMB ? ` · headroom ${c.agg.availMB.last}MB` : '')
        + ' — in the report as `crashed`';
    } else {
      crashNote.hidden = true;
    }
    const on = vitals.recording;
    sessBtn.textContent = on ? `stop session · ${fmtDur(vitals.elapsedSec)}` : 'start session';
    sessBtn.classList.toggle('pf-rec', on);
    // ⚠️ THE GLANCEABLE STATE (Daniel asked for it explicitly). During an 8-hour run nobody is
    // reading JSON, so the panel has to say "something changed" from across a room — and it has to
    // say WHY, or it is just an ominous colour. `reasons` is what makes it actionable.
    const w = vitals.warning?.();
    sessNote.className = 'pf-why' + (w ? (w.level === 'bad' ? ' bad' : ' warn') : '');
    sessNote.textContent = w ? `⚠ ${w.reasons.join(' · ')}`
      : on ? `recording · ${vitals.report()?.samples || 0} samples`
      : 'records thermal, memory headroom and frame cost over time';
    sessNote.hidden = false;
  }
  sessBtn.addEventListener('click', () => {
    if (!vitals) return;
    if (vitals.recording) { lastSession = vitals.stop(); } else { vitals.start(scenarioSel.value); lastSession = null; }
    paintSession();
  });
  // The script picker + one button. Reuses the panel's existing control classes — no new
  // component, so nothing new is owed to the UI Lab beyond the panel's own description.
  const runSel = document.createElement('select');
  const runBtn = document.createElement('button');
  const runNote = document.createElement('div'); runNote.className = 'pf-why';
  if (runner) {
    for (const sc of runner.scripts) {
      const o = document.createElement('option');
      o.value = sc.id; o.textContent = sc.label; runSel.append(o);
    }
    runner.onChange(() => paintRun());
  } else {
    runSel.hidden = true; runBtn.hidden = true; runNote.hidden = true;
  }
  function paintRun() {
    if (!runner) return;
    const st = runner.state;
    const on = runner.running;
    runBtn.textContent = on ? 'stop run' : 'run scenario';
    runBtn.classList.toggle('pf-rec', on);
    runSel.disabled = on;
    // ⚠️ PROGRESS HAS TO BE READABLE ON THE DEVICE, not in a console (DEVICE-TESTING.md). The
    // operator walks away and comes back; the panel is the only surface that can tell them whether
    // the run is mid-flight, finished, or stopped on a step it could not perform.
    const sc = runner.scripts.find((x) => x.id === runSel.value);
    runNote.className = 'pf-why' + (st?.outcome === 'aborted' ? ' bad' : st?.outcome === 'complete' ? ' warn' : '');
    runNote.textContent = st
      ? `${st.label} · step ${st.index + 1}/${st.total} · ${st.note}${st.remainSec ? ` · ${fmtDur(st.remainSec)} left` : ''}`
      : (sc?.blurb || 'runs a scripted device test end to end');
    runNote.hidden = false;
  }
  runBtn.addEventListener('click', () => {
    if (!runner) return;
    if (runner.running) { runner.stop(); paintRun(); return; }
    const r = runner.start(runSel.value);
    if (!r.ok) { runNote.className = 'pf-why bad'; runNote.textContent = `⚠ ${r.why}`; runNote.hidden = false; return; }
    paintRun();
  });
  paintRun();

  foot.append(saveBtn, clearBtn, copyBtn, sessBtn);
  panel.append(foot, crashNote, sessNote, runSel, runBtn, runNote, out);

  saveBtn.addEventListener('click', () => {
    baseline = { ...ledger.report, savedAt: new Date().toISOString(), scenario: scenarioSel.value };
    try { localStorage.setItem(slot(), JSON.stringify(baseline)); } catch { /* private mode */ }
    saveBtn.textContent = 'saved';
    setTimeout(() => { saveBtn.textContent = 'save baseline'; }, 1200);
    paint(ledger.report);
  });
  clearBtn.addEventListener('click', () => {
    try { localStorage.removeItem(slot()); } catch { /* private mode */ }
    baseline = null; paint(ledger.report);
  });
  copyBtn.addEventListener('click', async () => {
    const text = JSON.stringify({
      build: env.buildLabel || '', scenario: scenarioSel.value, device: deviceKey(),
      // ⚠️ The tag is hand-picked; this is what the app OBSERVED. When they disagree, believe this
      // one, and treat any baseline diff across the mismatch as void.
      scenarioObserved: observedScenario(env),
      scenarioMismatch: scenarioMismatch(scenarioSel.value, observedScenario(env)) || undefined,
      // ⚠️ WHAT NO INSTRUMENT CAN ANSWER, said out loud so the next reader does not spend a run
      // finding out: iOS reports HDMI and AirPlay identically. The tag is the only record of the
      // wire, and of the power path, which nothing observes at all.
      scenarioUnverifiable: observedScenario(env) === 'external-broadcast'
        ? 'HDMI vs AirPlay is not distinguishable from inside the app — the tag is the only record'
        : undefined,
      ua: navigator.userAgent, report: ledger.report, baseline,
      // THE CONSOLE IS NOT A CHANNEL WE ACTUALLY HAVE (B532). Reading console output on a
      // Capacitor device needs Safari Web Inspector attached; the exported report is the path
      // that demonstrably works, because it is how every reading in this arc arrived. Any
      // diagnostic that only prints to console is a diagnostic we cannot collect, which is how
      // the silent-take bug survived two builds of confident guessing.
      audio: env.lastAudioReport || null,
      // B660 — THE SESSION, when one is running or has just finished. A sibling key rather than a
      // second report, because `copy report` is the only channel that demonstrably works (see the
      // note above) and a second button is one more thing to forget. Carries the trajectory the
      // frame ledger structurally cannot: aggregates, every discontinuity as a timestamped event,
      // and the last hour of samples.
      vitals: (env.vitals?.recording ? env.vitals.report() : lastSession) || undefined,
      // B661 — the PREVIOUS run, if it died. Always exported when present, never gated on the
      // panel being open or the note being dismissed: the session this describes could not report
      // itself, which is the entire reason the record exists.
      // ⚠️ B664 — the seam's own health, always exported. B663 shipped a native reading that
      // landed on 3 of 56 samples and the report could not say why; a null column has to be
      // able to distinguish "no plugin" from "plugin present, read path broken".
      // B665 — WHICH TEST THIS REPORT IS OF. Every device report before this had a different
      // unwritten sequence behind it, which is why two runs of "the same" test were never strictly
      // comparable. An aborted run is exported too: an aborted run is a finding.
      scenarioRun: env.scenarioRunner?.report?.() || undefined,
      wakeLock: wakeLockState(),
      vitalsSeam: env.host?.vitals?.diagnostics?.() || undefined,
      crashed: env.vitals?.crashed || undefined,
      // B662 — the previous run's breadcrumbs even if it had no session running. A crash does not
      // wait for the recorder to be armed.
      priorTrail: env.vitals?.priorTrail || undefined,
      // THIS run's breadcrumbs. Without it the report copied immediately after a failure was the
      // one report that could not describe the failure (2026-08-19).
      trail: env.vitals?.trail || undefined,
      // ⚠️ HOW MANY HARDWARE SESSIONS ARE HELD RIGHT NOW. The session audit could say what the code
      // CAN hold; only this can say what a run DID hold when it fell over — which is the number a
      // computed capability gate has to key on instead of a device table.
      sessions: sessionReport(),
      // B692 — the pan probe. Null unless a pan actually ran this session. Three builds have tried
      // to fix radial pan by reasoning; this is the measurement that separates the candidates.
      pan: panProbe() || undefined,
      // B619 — WHICH FIELD IS STILL MOVING, AND WAS ANYTHING ALLOWED TO MOVE IT. Armed by
      // `?probe=motion`; absent otherwise. Built for the droste infinite-zoom loop, where four
      // mechanisms have been eliminated by reading and the investigation reached a contradiction:
      // no writer can run, the follower provably settles, and the motion is still real. `verdict`
      // names the offending field outright, and `quietMovingMs` is the number that matters —
      // time a value spent travelling while every known writer was idle.
      motion: env.motionProbe?.report?.() || undefined,
      // B625 — SLICE GEOMETRY, always on. Daniel's iPhone still shows the pre-B619 default slice
      // after a full rebuild + cap sync, and the two live explanations are indistinguishable from
      // here: either the centring is not running on his device, or it IS running and the result
      // still overflows because the box is wider than a portrait source. Simulated on desktop the
      // box centre lands at 0.500 for every form, so the code is right and the question is what the
      // DEVICE actually holds. Three numbers settle it — `boxC` at 0.5 means centring ran.
      // B626 — a re-placement that FAILED. It is caught so it can never abort camera acquisition,
      // which means without this line it would fail completely silently.
      // B703 — a context restore whose element re-upload failed. Empty on a clean restore. This is
      // the half-failure that made the B609 freeze take four builds: the recovery reported success,
      // the picture never came back, and the reason went only to a console nobody attaches to.
      reinitWhy: env.engine?.lastReinitWhy || undefined,
      // B716 — the most expensive single frame the last bake's reader had to serve.
      // **Compare `decoded` across platforms before `ms`**: `decoded` is the clip's own GOP work
      // and must be the same everywhere; `ms` is only how fast this machine did it.
      // ⚠️ B718 — READ IT LATE. Two reports carried `bakeDecode: null` while the vitals trail held
      // the reading, which means this value was resolved before the bake ran. Reading through a
      // getter defers it to export time; the trail stays the durable copy either way.
      bakeDecode: (env.bakeDecode ? { ...env.bakeDecode } : undefined),
      // B706 — a deferred element re-upload. `reinitWhy` says what failed; these say whether it
      // has since healed. Pending with a rising try count is the forever-black case.
      reuploadPending: env.engine?.reuploadPending || undefined,
      reuploadTries: env.engine?.reuploadTries || undefined,
      sliceError: env.lastSliceError || undefined,
      // B630 — the last few SOURCE-SWAP attempts, each phase with a reason on every exit. Built for
      // Daniel's mid-show dead end (live camera ~10min, picked a file, nothing happened, app restart
      // required). A slippery repro does not have to be caught live if the attempt records itself.
      sourceSwap: env.sourceSwapLog?.length ? env.sourceSwapLog : undefined,
      slice: (() => {
        try {
          const s = env.state, a = env.engine?.getSourceAspect?.() || 0;
          const c = env.formBoxCenter?.(s, a);
          return {
            form: s.form, sourceAspect: +a.toFixed(4), frameAspect: +(env.session?.frameAspect ?? 0).toFixed(4),
            sliceRotation: s.sliceRotation, sliceScale: s.sliceScale,
            origin: [+s.sliceCx.toFixed(4), +s.sliceCy.toFixed(4)],
            // B635 — the fold's two outputs. `mirror` is the slice's handedness (−1 = this axis has
            // been reflected back onto the image); `sampleC`/`sampleHalf` is the box the fold
            // actually bounds, which is the SAMPLED region and differs from `boxC` on droste. A
            // device report showing a slice that looks misplaced is answered by these two lines:
            // if mirror is ±1 and sampleC is on the image, the fold did its job and the complaint
            // is about placement, not about the bound.
            mirror: [s.sliceMirrorX === -1 ? -1 : 1, s.sliceMirrorY === -1 ? -1 : 1],
            sampleC: (() => { const k = env.sliceBoxCenter?.(s, a); return k ? [+k.x.toFixed(4), +k.y.toFixed(4)] : null; })(),
            sampleHalf: (() => { const k = env.sliceBoxCenter?.(s, a); return k ? [+k.halfW.toFixed(4), +k.halfH.toFixed(4)] : null; })(),
            boxC: c ? [+c.x.toFixed(4), +c.y.toFixed(4)] : null,
            boxHalf: c ? [+c.halfW.toFixed(4), +c.halfH.toFixed(4)] : null,
            // >1 means the slice is WIDER than the source and must overflow however it is placed
            boxVsSource: c ? +(2 * Math.max(c.halfW, c.halfH)).toFixed(3) : null,
          };
        } catch (e) { return { error: String(e && e.message || e) }; }
      })(),
      // the external view's own warnings/errors, which reach no console we can read (B559).
      // Omitted entirely when empty so a report from a session with no HDMI stays uncluttered.
      extLogs: env.externalDisplay?.logs?.length ? env.externalDisplay.logs : undefined,
      // THE VIEW'S INTERVAL DISTRIBUTIONS (B577). The surface note carries the `fresh` verdict as
      // a sentence; this carries both distributions as numbers, because `draw` is what LOCALIZES
      // the burst. Bursty draws mean the app's post cadence is irregular (upstream of the view);
      // even draws with bursty `fresh` mean the two streams — state posts and socket frames — are
      // interleaving badly, which is a different bug with a different fix.
      extJitter: env.externalDisplay?.jitter || undefined,
      // THE CONTROL, read from the APP's client on the same socket (B579). `extJitter.arrive`
      // showed the view receiving frames in 2ms bursts; if this one reads ~33ms at the same
      // moment, the producer is sending evenly and the burst is the view's own blocked event
      // loop. Two clients, one socket, one of them starving: that comparison is the proof.
      srcArrive: env.nativeVideo?.arrivalSpread?.() || undefined,
      // a decoder refusing frames is the loudest thing a report can carry — it explains an inert
      // scrubber, a dead transport and a frozen picture all at once (B570)
      decodeError: env.nativeDecodeError?.() || undefined,
      // BOTH ENDS OF THE FRAME WIRE (B584). `srcSocket` is our client's own view (open/closed, how
      // long since a frame, how many times it has been dropped and rejoined). `srcFanOut` is the
      // NATIVE server's account of who it offered each frame to and who took it, polled over the
      // Capacitor bridge rather than the frame socket — so it still answers when that socket is
      // the thing that failed. The pair settles a question no single-sided count can: whether a
      // frozen app was passed over by the fan-out, reaped by its stall watchdog, or handed frames
      // it then failed to use. At B583 all three looked identical from JS.
      // STATE POSTS SENT VS ELIDED (B591). `ownClock:true` means the view holds a frame socket and
      // identical state is safely skippable; a high `elided` beside healthy delivery is the fix
      // working. `ownClock:false` with a clip playing means we are back to posting every frame.
      extPosts: env.externalDisplay?.posts || undefined,
      // THE LOOP-RESTART HOLD, instrumented (B593). See native-frame-receiver.noteClock: a small
      // `last.gapMs` means the decoder never stopped and the hold is on our side; a large one
      // means it did and the fix is native. This is the reading that decides which.
      loopStall: env.nativeVideo?.loopStall?.() || undefined,
      // WHY THERE IS NO NATIVE DECODE (B597). Present ONLY when the attach declined, and it
      // names which of the seven exits was taken. Without it, a fallback and a decode that
      // was never attempted produce the identical report: no `loopStall`, no `srcSocket`,
      // no `srcFanOut`, and a `from <video>` tag that could mean either.
      nativeAttach: env.nativeAttach || undefined,
      // WHY the external 1080p memory guard did or did not apply. It declining silently is what
      // made a re-armed crash indistinguishable from a healthy configuration (2026-08-19).
      extGuard: externalGuardState() || undefined,
      srcSocket: env.nativeVideo?.socketState?.() || undefined,
      srcFanOut: env.nativeVideo?.fanOut || undefined,
      // WHAT THIS DEVICE HAS BEEN MEASURED SUSTAINING, per destination + resolution tier (B585).
      // Accumulates across sessions, so a report carries the device's whole history of what held
      // and what did not — which is the evidence the honest-limit label is built from.
      broadcastCeiling: env.broadcastCeiling?.all?.() || undefined,
      // WHAT THE GOVERNOR THINKS IT IS DOING (B573). Its only observable was an absence — surfaces
      // that did not move — and an absence looks identical whether the rule declined to act, was
      // never subscribed, or was reading a broadcast probe that returned false. Three builds, three
      // of those, each found by reasoning rather than by reading. `reason` ends that.
      governor: env.governor?.state || null,
    }, null, 2);
    out.value = text; out.hidden = false; out.select();
    try { await navigator.clipboard.writeText(text); copyBtn.textContent = 'copied'; }
    catch { copyBtn.textContent = 'press ⌘C'; }
    setTimeout(() => { copyBtn.textContent = 'copy report'; }, 1400);
  });

  // ---- painting ------------------------------------------------------------
  function stat(label, value, cls = '') {
    const el = document.createElement('span');
    el.className = 'pf-stat ' + cls;
    el.innerHTML = `${label} <b>${value}</b>`;
    return el;
  }

  function deltaEl(current, base, invert = false) {
    const el = document.createElement('span');
    el.className = 'pf-delta';
    if (base == null || !isFinite(base) || base === 0) return el;
    const d = pct(current, base);
    if (Math.abs(d) < 3) { el.textContent = '·'; return el; }
    // "up" is bad for cost and good for fps, so callers say which way is which
    const worse = invert ? d < 0 : d > 0;
    el.classList.add(worse ? 'up' : 'down');
    el.textContent = `${d > 0 ? '+' : ''}${Math.round(d)}%`;
    return el;
  }

  function paint(r) {
    paintSession();   // B660 — the elapsed clock and the warning line refresh with everything else
    paintRun();       // B665 — and the scripted run's step + countdown with them
    top.innerHTML = '';
    // fps is graded against the DECLARED TARGET where there is one. The old fixed 50/25 cut
    // points silently assumed 60, so a take running at a correct 30 read amber and a 4K camera
    // limping at 13 against a 30fps source read the same red as a 24fps one (B559).
    const tgt = r.pressure?.target || 0;
    const fpsCls = tgt > 0
      ? (r.fps >= tgt * 0.9 ? '' : r.fps >= tgt * 0.6 ? 'warn' : 'bad')
      : (r.fps >= 50 ? '' : r.fps >= 25 ? 'warn' : 'bad');
    // SAY WHOSE FPS THIS IS (Daniel, B583: "the general top left fps [should] honestly declare
    // what it is and isn't"). It is the APP's own render loop and nothing more. B571 and B576 both
    // caught this number and the picture on the wall moving in OPPOSITE directions, so an
    // unqualified "fps" beside a live broadcast invites exactly the wrong conclusion. The
    // broadcast's own rates get their own stats below.
    //
    // AND A FROZEN SOURCE OVERRIDES IT ENTIRELY (B584). A high app fps beside a dead source is the
    // single most misleading pair in this panel: Daniel's B583 freeze reported 42.5fps, its BEST
    // number of the session, because an unfed frame is cheap. A rate that is measuring re-renders
    // of one still picture must not be printed as though it were throughput.
    const sock = env.nativeVideo?.socketState?.() || null;
    const stalled = sock && sock.msSinceFrame >= 0 && sock.msSinceFrame >= 700;
    const fpsStat = stalled
      ? stat('app fps', `${r.fps || '…'} · SOURCE FROZEN`, 'bad')
      : stat('app fps', tgt > 0 ? `${r.fps || '…'}/${tgt}` : (r.fps || '…'), fpsCls);
    fpsStat.appendChild(deltaEl(r.fps, baseline?.fps, true));
    top.append(
      fpsStat,
      stat('frame', `${r.frameMs.p50}/${r.frameMs.p95}ms`),
      stat('MP/frame', r.mpPerFrame || 0),
    );
    // WHAT THE AUDIENCE ACTUALLY GETS, at the top of the panel rather than buried in a surface
    // note. Daniel asked for a place to see the display's real counts; until now the delivered
    // rate existed only inside the external surface's note string, where he found it disagreeing
    // with the live panel and had no way to tell which one was lying (it was the note).
    const ext = env.externalDisplay;
    const freshP50 = ext?.active ? (ext.jitter?.fresh?.p50 || 0) : 0;
    if (freshP50 > 0) {
      const delivered = Math.round(1000 / freshP50);
      const src = ext.srcFps > 0 ? ext.srcFps : 0;
      const dCls = src > 0 ? (delivered >= src * 0.9 ? '' : delivered >= src * 0.6 ? 'warn' : 'bad') : '';
      top.append(stat('on the display', src > 0 ? `${delivered}/${src} new/s` : `${delivered} new/s`, dCls));
      if (ext.fps > 0) top.append(stat('ext drawn', `${ext.fps}/s`));
    }
    if (r.pressure) {
      const p = r.pressure;
      const cls = p.value < 0.15 ? '' : p.value < 0.45 ? 'warn' : 'bad';
      top.append(stat('pressure', `${p.label} (${p.source})`, cls));
      // SHORTFALL IS NOT PRESSURE and the panel must not let them be confused. A device that has
      // been slow the whole window reads nominal pressure forever (drift from a throttled
      // baseline is zero); this is the row that still tells the truth about it.
      if (p.target > 0 && p.shortfall > 0.1) {
        const sCls = p.shortfall > 0.5 ? 'bad' : 'warn';
        // named for its subject too, now that a display-side number sits beside it (B583)
        top.append(stat('app shortfall', `${Math.round(p.shortfall * 100)}% under ${p.target}fps`, sCls));
      }
    }
    // THE GOVERNOR, ON SCREEN. Daniel: "in lieu of being able to actually see and interact with
    // the governor" — he has had to infer its behaviour from surfaces that did not move, which is
    // no evidence at all. Always shown while a program is live, including when it is deciding NOT
    // to act, because "decided we're fine" and "was never running" must not look the same.
    const g = env.governor?.state;
    if (g && (g.active || g.broadcasting === true || !g.ticking)) {
      const cls = !g.ticking ? 'bad' : g.active ? 'warn' : '';
      top.append(stat('governor', !g.ticking ? 'NOT TICKING' : g.active ? g.rung : 'watching', cls));
      const why = document.createElement('div');
      why.className = 'pf-why' + (g.ticking ? '' : ' bad');
      why.textContent = g.ticking ? g.reason : 'nothing is calling tick() — the governor is not subscribed';
      top.append(why);
    }

    // TIME THE LEDGER CANNOT SEE. Only alarming when the frame is ALSO slow: a 33ms frame with
    // 4ms of work is a source capped at 30fps behaving correctly, not a hidden cost. A big gap on
    // a frame that is missing its target means the expensive thing is not on the list below.
    if (r.unaccountedMs > 0) {
      const slow = r.frameMs.p50 > 20;
      const share = r.frameMs.p50 ? r.unaccountedMs / r.frameMs.p50 : 0;
      const cls = !slow ? '' : share > 0.6 ? 'bad' : share > 0.3 ? 'warn' : '';
      top.append(stat('unmeasured', `${r.unaccountedMs}ms`, cls));
    }

    // LAST TAKE'S AUDIO, on screen (B537). It was already in the export, but the verdict is only
    // written when a take ENDS — so every report copied mid-take read `recording…` and the answer
    // never reached anyone. A row that is simply visible after the take removes that trap.
    const a = env.lastAudioReport;
    if (a && !a.live) {
      const ok = a.verdict === 'ok';
      const el = stat('last take audio', ok ? `ok · peak ${a.peak ?? '?'}` : a.verdict, ok ? '' : 'bad');
      el.title = JSON.stringify(a, null, 2);   // long-press / hover for the full block
      top.append(el);
    }

    rows.innerHTML = '';
    const baseById = new Map((baseline?.surfaces || []).map((s) => [s.id, s]));
    for (const s of r.surfaces) {
      const row = document.createElement('div'); row.className = 'pf-row';

      // ⚠️ B660 — A TOGGLE NOTHING HONOURS IS WORSE THAN NO TOGGLE. Daniel: *"see if there are
      // some fields in there that we can at least hide for now to make it more usable."*
      //
      // `source` is the confirmed case, already on the liars list: only `engine/index.js` checks
      // `perf.skip`, which covers the RENDER surfaces. The source path calls `.pass()` for TIMING
      // and no consumer ever reads its enabled flag, so switching it off changed the label and
      // nothing else — and an A/B run against a lever that does not move is worse than no A/B,
      // because it produces a confident null.
      //
      // Disabled rather than deleted: the ROW is the most valuable line in the panel (it is the
      // 4K upload cost), and it must keep reporting. Only the control that lies goes away, and it
      // says why on hover rather than vanishing without explanation.
      const skipHonoured = s.id !== 'source';
      const onBtn = document.createElement('button');
      onBtn.textContent = s.enabled ? 'on' : 'off';
      onBtn.classList.toggle('off', !s.enabled);
      if (!skipHonoured) {
        onBtn.disabled = true;
        onBtn.title = 'no consumer honours this surface\u2019s skip flag \u2014 switching it off would change the label and nothing else';
      } else {
        onBtn.addEventListener('click', () => { ledger.setSurfaceEnabled(s.id, !s.enabled); paint(ledger.report); });
      }

      const name = document.createElement('span');
      name.className = 'pf-name';
      // the note says WHICH PATH this surface took, which is what turns a cost into a cause
      // a governed surface renders every Nth frame, which changes what the ms column MEANS —
      // without this the reader sees a cost drop and no reason for it
      const rate = s.rate > 1 ? ` · ⏱ 1 in ${s.rate}` : '';
      name.innerHTML = `${s.label} <em>${s.serves} · ${s.w}×${s.h}${rate}</em>`;

      const ms = document.createElement('span');
      ms.className = 'pf-num';
      // GPU time is the truer number where we have it, so it LEADS and the CPU figure follows in
      // parentheses. Where we do not (WebKit), there is only one number and no false precision.
      ms.textContent = s.gpuMsPerFrame > 0
        ? `${s.gpuMsPerFrame}ms gpu (${s.msPerFrame} cpu)`
        : `${s.msPerFrame}ms`;
      if (s.gpuMsPerFrame > 0) ms.classList.add('pf-wide');

      const compareCurrent = s.gpuMsPerFrame > 0 ? s.gpuMsPerFrame : s.msPerFrame;
      const base = baseById.get(s.id);
      const compareBase = base && (base.gpuMsPerFrame > 0 ? base.gpuMsPerFrame : base.msPerFrame);
      row.append(onBtn, name, ms, deltaEl(compareCurrent, compareBase));
      // wrapped, full width, below the numbers — see the .pf-note rule for why this is not
      // squeezed onto the same line any more
      if (s.note) {
        const noteEl = document.createElement('div');
        noteEl.className = 'pf-note' + (s.note.includes('⚠') ? ' warn' : '');
        noteEl.textContent = s.note;
        row.appendChild(noteEl);
      }

      if (s.scaleLadder && s.scaleLadder.length > 1) {
        const scaleBtn = document.createElement('button');
        const label = () => `${Math.round(s.scale * 100)}%`;
        scaleBtn.textContent = label();
        scaleBtn.title = 'step this surface down the resolution ladder';
        scaleBtn.addEventListener('click', () => {
          const i = s.scaleLadder.indexOf(s.scale);
          const next = s.scaleLadder[(i + 1) % s.scaleLadder.length];
          ledger.setSurfaceScale(s.id, next);
          paint(ledger.report);
        });
        row.appendChild(scaleBtn);
      }
      rows.appendChild(row);

      // passes only earn a line once a surface has more than one — until a post-process or a
      // scene layer exists, a single "render" child would be pure noise
      if (s.passes.length > 1) {
        for (const p of s.passes) {
          const pr = document.createElement('div');
          pr.className = 'pf-row pf-pass';
          const pn = document.createElement('span'); pn.className = 'pf-name'; pn.textContent = p.id;
          const pm = document.createElement('span'); pm.className = 'pf-num'; pm.textContent = `${p.msPerFrame}ms`;
          pr.append(pn, pm);
          rows.appendChild(pr);
        }
      }
    }

    // BEHAVIOR FLAGS — the A/B switches for optimizations that changed how the app works. These
    // are not surfaces (they have no size and no cost of their own); they are the shipped
    // optimizations, each switchable back off so its value can be measured rather than assumed.
    if (PERF_FLAG_SPECS.length) {
      const cap = document.createElement('div');
      cap.className = 'pf-row pf-cap';
      cap.innerHTML = '<span class="pf-name"><em>optimizations — switch off to measure what each is worth</em></span>';
      rows.appendChild(cap);
      for (const [key, label, offMeaning] of PERF_FLAG_SPECS) {
        const row = document.createElement('div'); row.className = 'pf-row';
        const b = document.createElement('button');
        b.textContent = perfFlags[key] ? 'on' : 'off';
        b.classList.toggle('off', !perfFlags[key]);
        b.addEventListener('click', () => {
          perfFlags[key] = !perfFlags[key];
          // several of these change what a surface DRAWS, and the change-gate would otherwise
          // hold the old pixels until something else moved — so force everything to repaint
          env.scheduleOverlayDraw?.();
          env.sourceOverlay?.scheduleDraw?.();
          env.scheduleRender?.();
          // the capture path is decided ONCE per session, so flipping it has to invalidate that
          // decision or the switch would appear to do nothing until a reload
          if (key === 'asyncReadback') env.resetBusCapture?.();
          paint(ledger.report);
        });
        const n = document.createElement('span');
        n.className = 'pf-name';
        n.innerHTML = `${label} <em>${offMeaning}</em>`;
        row.append(b, n);
        rows.appendChild(row);
      }
    }

    // THE GOVERNOR'S OWN OFF SWITCH (B574). Daniel's read of B573 was "the display reports LOWER
    // fps but feels steadier" — plausible, and unprovable while the only way to compare is to
    // rebuild. It belongs here rather than in PERF_FLAG_SPECS because it reads live state off
    // `env.governor` rather than the flags object, and switching it off must RELEASE what it is
    // holding rather than merely stop stepping (the setter already does).
    if (env.governor) {
      const row = document.createElement('div'); row.className = 'pf-row';
      const b = document.createElement('button');
      const on = env.governor.enabled;
      b.textContent = on ? 'on' : 'off';
      b.classList.toggle('off', !on);
      b.addEventListener('click', () => { env.governor.enabled = !env.governor.enabled; paint(ledger.report); });
      const n = document.createElement('span');
      n.className = 'pf-name';
      n.innerHTML = 'governor <em>off = editor surfaces stay at full size under pressure</em>';
      row.append(b, n);
      rows.appendChild(row);
    }

    for (const o of r.oneShots) {
      const row = document.createElement('div'); row.className = 'pf-row';
      const n = document.createElement('span');
      n.className = 'pf-name'; n.innerHTML = `${o.id} <em>one-shot ×${o.calls}</em>`;
      const m = document.createElement('span'); m.className = 'pf-num'; m.textContent = `${o.ms}ms`;
      row.append(n, m);
      rows.appendChild(row);
    }
    if (!out.hidden) out.value = JSON.stringify(ledger.report, null, 2);
  }

  ledger.onReport(paint);
  ledger.enabled = true;
  paint(ledger.report);

  (container || document.body).appendChild(panel);
  if (!container) {
    // restore last position AFTER mounting, so offsetWidth/Height are real and the clamp works
    try {
      const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) placeAt(p.x, p.y);
    } catch { /* no saved position */ }
  }
  console.info('[fold] frame-cost panel active — switches and resolution steppers change behavior live; nothing persists but a saved baseline');

  const api = {
    el: panel,
    paint,
    // RESTORE EVERYTHING on close. A switched-off surface stays off until something turns it
    // back on, and the panel is the only thing that can — so closing it while the preview is
    // cut would leave a dark panel with no visible cause and no way back short of a reload.
    // Same for the optimization flags: closing must never leave the app de-optimized.
    destroy() {
      for (const s of ledger.report.surfaces) {
        if (!s.enabled) ledger.setSurfaceEnabled(s.id, true);
        if (s.scale !== 1) ledger.setSurfaceScale(s.id, 1);
      }
      for (const [key] of PERF_FLAG_SPECS) perfFlags[key] = PERF_FLAG_DEFAULTS[key];
      ledger.enabled = false;
      env.scheduleOverlayDraw?.();
      env.scheduleRender?.();
      panel.remove();
      onClose?.();
    },
  };
  return api;
}
