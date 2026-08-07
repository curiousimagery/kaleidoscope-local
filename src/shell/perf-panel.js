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

import { perfFlags, PERF_FLAG_SPECS } from './perf-flags.js';

const BASELINE_KEY = 'foldPerfBaseline';

// The named runs, so a measurement is comparable across sessions, devices and builds instead
// of being ad hoc. Picking one before you measure is the entire discipline.
const SCENARIOS = [
  'idle-still', 'camera-live', 'video-playback',
  'recording', 'hdmi-broadcast', 'ndi-broadcast',
];

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
#perfPanel .pf-row { display: flex; align-items: center; gap: 6px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,.05); }
#perfPanel .pf-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#perfPanel .pf-name em { font-style: normal; color: var(--text-faint, #666); }
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

  const foot = document.createElement('div'); foot.className = 'pf-foot';
  const saveBtn = document.createElement('button'); saveBtn.textContent = 'save baseline';
  const clearBtn = document.createElement('button'); clearBtn.textContent = 'clear';
  const copyBtn = document.createElement('button'); copyBtn.textContent = 'copy report';
  const out = document.createElement('textarea'); out.readOnly = true; out.hidden = true;
  foot.append(saveBtn, clearBtn, copyBtn);
  panel.append(foot, out);

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
      ua: navigator.userAgent, report: ledger.report, baseline,
      // THE CONSOLE IS NOT A CHANNEL WE ACTUALLY HAVE (B532). Reading console output on a
      // Capacitor device needs Safari Web Inspector attached; the exported report is the path
      // that demonstrably works, because it is how every reading in this arc arrived. Any
      // diagnostic that only prints to console is a diagnostic we cannot collect, which is how
      // the silent-take bug survived two builds of confident guessing.
      audio: env.lastAudioReport || null,
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
    top.innerHTML = '';
    const fpsCls = r.fps >= 50 ? '' : r.fps >= 25 ? 'warn' : 'bad';
    const fpsStat = stat('fps', r.fps || '…', fpsCls);
    fpsStat.appendChild(deltaEl(r.fps, baseline?.fps, true));
    top.append(
      fpsStat,
      stat('frame', `${r.frameMs.p50}/${r.frameMs.p95}ms`),
      stat('MP/frame', r.mpPerFrame || 0),
    );
    if (r.pressure) {
      const p = r.pressure;
      const cls = p.value < 0.15 ? '' : p.value < 0.45 ? 'warn' : 'bad';
      top.append(stat('pressure', `${p.label} (${p.source})`, cls));
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

    rows.innerHTML = '';
    const baseById = new Map((baseline?.surfaces || []).map((s) => [s.id, s]));
    for (const s of r.surfaces) {
      const row = document.createElement('div'); row.className = 'pf-row';

      const onBtn = document.createElement('button');
      onBtn.textContent = s.enabled ? 'on' : 'off';
      onBtn.classList.toggle('off', !s.enabled);
      onBtn.addEventListener('click', () => { ledger.setSurfaceEnabled(s.id, !s.enabled); paint(ledger.report); });

      const name = document.createElement('span');
      name.className = 'pf-name';
      // the note says WHICH PATH this surface took, which is what turns a cost into a cause
      const note = s.note ? ` · ${s.note}` : '';
      name.innerHTML = `${s.label} <em>${s.serves} · ${s.w}×${s.h}${note}</em>`;
      if (s.note) name.title = s.note;

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
      for (const [key] of PERF_FLAG_SPECS) perfFlags[key] = true;
      ledger.enabled = false;
      env.scheduleOverlayDraw?.();
      env.scheduleRender?.();
      panel.remove();
      onClose?.();
    },
  };
  return api;
}
