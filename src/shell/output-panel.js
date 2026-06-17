// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/output-panel.js
//
// The live-output affordance in the global control area: the toolbar's #outputBtn,
// a persistent output-status readout pinned top-right (#broadcastStatus, the mirror
// of the source/input details top-left), and an anchored controls DROPDOWN
// (#outputPopover) rather than a modal — so the status stays in context while you
// edit. This is Fold's chrome over the engine-agnostic output bus (src/stage/): the
// surface talks to the bus, the bus talks to the engine adapter.
//
// Increment 3 surface:
//   - record to disk (the universal sink; works on every browser),
//   - Syphon BROADCAST toggle + editable name — dormant on plain web, active behind
//     ?mocksyphon (the mock host) and, later, the Electron host. The actual Syphon
//     sink registers in a later increment; here the broadcast toggle just runs the
//     bus and reflects host.syphon.available,
//   - output RESOLUTION picker (long-side tier; the aspect FOLLOWS the composition
//     frame, session.frameAspect — so a 16:9 comp outputs 16:9, not square).
//
// The bus runs whenever EITHER recording OR broadcasting is wanted (idle otherwise),
// so stopping a recording doesn't tear down an active broadcast and vice-versa.

const TIER_DEFAULT = 1920;   // FHD long side — safe live default (never default 4K)

export function createOutputPanel(env, outputBus) {
  const byId = (id) => document.getElementById(id);
  const outputBtn = byId('outputBtn');
  const popover = byId('outputPopover');
  const closeBtn = byId('outputClose');
  const recordBtn = byId('recordBtn');
  const broadcastBtn = byId('broadcastBtn');
  const opBroadcast = byId('opBroadcast');
  const resTiers = byId('outputResTiers');
  const resHint = byId('outputResHint');
  const nameInput = byId('serverNameInput');
  const outputStatus = byId('outputStatus');       // transient messages (errors) in the popover
  const broadcastStatus = byId('broadcastStatus'); // persistent live readout in the global bar

  const recorder = outputBus.getSink('disk');
  const host = env.host;
  const syphonAvailable = !!(host && host.syphon && host.syphon.available);

  let tier = TIER_DEFAULT;
  let wantRecord = false;
  let wantBroadcast = false;
  let statusTimer = 0;

  // ---- output resolution: long-side tier × the composition frame aspect --------
  // Mirrors engine.exportAt's aspect math, so the live output matches the comp.
  function computeDims() {
    const a = (env.session && env.session.frameAspect) || 1;
    let w, h;
    if (a >= 1) { w = tier; h = Math.round(tier / a); }
    else { h = tier; w = Math.round(tier * a); }
    return { w, h };
  }
  function applyResolution() {
    // Never resize the bus mid-session (it would resize the recorder's canvas /
    // a live broadcast underneath). The picker + frame-aspect tracking apply on the
    // next start; the hint always shows the configured target.
    if (!outputBus.running) {
      const { w, h } = computeDims();
      outputBus.setResolution({ width: w, height: h });
    }
    renderResHint();
  }
  function renderResHint() {
    if (!resHint) return;
    const { w, h } = computeDims();
    let txt = `${w}×${h}`;
    if (tier >= 3840) txt += ' · clean hardware only';
    resHint.textContent = txt;
  }

  // ---- bus lifecycle: run while recording OR broadcasting ----------------------
  function syncBusRunning() {
    const need = wantRecord || wantBroadcast;
    if (need && !outputBus.running) outputBus.start();
    else if (!need && outputBus.running) outputBus.stop();
  }

  function hasSource() { return !!(env.engine && env.engine.getSourceImage()); }

  function toggleRecord() {
    if (!recorder) return;
    if (recorder.recording) {
      recorder.stop();
      wantRecord = false;
      syncBusRunning();
      stopPolling();
    } else {
      if (!hasSource()) return;
      if (!recorder.supported) { if (outputStatus) outputStatus.textContent = 'recording is not supported in this browser'; return; }
      try {
        applyResolution();
        wantRecord = true;
        syncBusRunning();                          // ensure the bus is rendering frames
        recorder.start(outputBus.width, outputBus.height);
        startPolling();
        if (outputStatus) outputStatus.textContent = '';
      } catch (e) {
        wantRecord = false; syncBusRunning();
        if (outputStatus) outputStatus.textContent = `could not start recording: ${e.message}`;
      }
    }
    reflect();
    renderBroadcastStatus();
  }

  function toggleBroadcast() {
    if (!syphonAvailable) return;
    if (wantBroadcast) {
      host.syphon.stop();
      wantBroadcast = false;
      syncBusRunning();
      if (!wantRecord) stopPolling();
    } else {
      if (!hasSource()) return;
      applyResolution();
      outputBus.setServerName(nameInput ? nameInput.value : 'Fold');
      host.syphon.start();
      wantBroadcast = true;
      syncBusRunning();
      startPolling();
    }
    reflect();
    renderBroadcastStatus();
  }

  // ---- status surfaces ---------------------------------------------------------
  function reflect() {
    const rec = !!recorder?.recording;
    if (outputBtn) outputBtn.classList.toggle('active', rec || wantBroadcast);
    if (recordBtn) {
      recordBtn.textContent = rec ? 'stop recording' : 'record to disk';
      recordBtn.classList.toggle('active', rec);
    }
    if (broadcastBtn) {
      broadcastBtn.hidden = !syphonAvailable;
      broadcastBtn.textContent = wantBroadcast ? 'stop broadcasting' : 'start broadcasting';
      broadcastBtn.classList.toggle('active', wantBroadcast);
    }
    if (opBroadcast) {
      const live = wantBroadcast;
      opBroadcast.classList.toggle('live', live);
      opBroadcast.textContent = syphonAvailable
        ? (live ? `broadcast: ${outputBus.getStatus().serverName} ◉` : 'broadcast: ready')
        : 'broadcast: dormant (web build)';
    }
  }

  // The persistent top-right readout: output target + live state + fps.
  function renderBroadcastStatus() {
    if (!broadcastStatus) return;
    if (!hasSource()) { broadcastStatus.textContent = ''; broadcastStatus.classList.remove('live'); return; }
    const s = outputBus.getStatus();
    const parts = [];
    if (s.broadcasting) parts.push(`◉ ${s.serverName}`);
    if (recorder?.recording) parts.push('● rec');
    if (parts.length) {
      broadcastStatus.textContent = `${parts.join(' · ')} · ${s.width}×${s.height} · ${s.fps || '…'} fps`;
      broadcastStatus.classList.add('live');
    } else {
      broadcastStatus.textContent = `output ${s.width}×${s.height}`;
      broadcastStatus.classList.remove('live');
    }
  }

  function startPolling() {
    stopPolling();
    statusTimer = setInterval(() => { reflect(); renderBroadcastStatus(); }, 500);
  }
  function stopPolling() { if (statusTimer) { clearInterval(statusTimer); statusTimer = 0; } }

  // gate the toolbar button on a loaded source; called by the chrome on source/
  // layout change (alongside motion). A running output can't outlive its source.
  function updateOutputUI() {
    const ok = hasSource();
    if (outputBtn) outputBtn.disabled = !ok;
    if (!ok && (recorder?.recording || wantBroadcast)) {
      if (recorder?.recording) recorder.stop();
      if (wantBroadcast && syphonAvailable) host.syphon.stop();
      wantRecord = false; wantBroadcast = false;
      syncBusRunning();
      stopPolling();
      if (popover) popover.hidden = true;
    }
    applyResolution();          // keep the output target tracking the current frame aspect
    reflect();
    renderBroadcastStatus();
  }

  // ---- the anchored dropdown ---------------------------------------------------
  function positionPopover() {
    if (!popover || !outputBtn) return;
    const r = outputBtn.getBoundingClientRect();
    popover.style.top = `${Math.round(r.bottom + 6)}px`;
    popover.style.right = `${Math.round(window.innerWidth - r.right)}px`;
  }
  function openPopover() {
    if (!popover) return;
    applyResolution();          // reflect any frame-aspect change since last open
    positionPopover();
    popover.hidden = false;
    reflect();
  }
  function closePopover() { if (popover) popover.hidden = true; }
  function togglePopover() { if (popover?.hidden) openPopover(); else closePopover(); }

  // ---- wiring ------------------------------------------------------------------
  outputBtn?.addEventListener('click', togglePopover);
  closeBtn?.addEventListener('click', closePopover);
  recordBtn?.addEventListener('click', toggleRecord);
  broadcastBtn?.addEventListener('click', toggleBroadcast);

  resTiers?.querySelectorAll('button[data-tier]').forEach((b) => {
    b.addEventListener('click', () => {
      tier = parseInt(b.dataset.tier, 10) || TIER_DEFAULT;
      resTiers.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      applyResolution();
      renderBroadcastStatus();
    });
  });

  nameInput?.addEventListener('input', () => outputBus.setServerName(nameInput.value));

  // close the dropdown on an outside click (the button toggles itself; its own
  // click is excluded so toggling open doesn't immediately re-close).
  document.addEventListener('click', (e) => {
    if (!popover || popover.hidden) return;
    if (popover.contains(e.target) || outputBtn?.contains(e.target)) return;
    closePopover();
  });
  window.addEventListener('resize', () => { if (popover && !popover.hidden) positionPopover(); });

  // expose the availability updater so the chrome can call it on source change.
  env.updateOutputUI = updateOutputUI;

  reflect();
  updateOutputUI();
}
