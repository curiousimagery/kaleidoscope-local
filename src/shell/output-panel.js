// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/output-panel.js
//
// The live-output affordance in the global control area: the toolbar's #outputBtn
// (carrying a green-over-red TRAFFIC-LIGHT — green = broadcast armed, red =
// recording, the at-a-glance state visible even when collapsed) and the #outputRow,
// a solid band docked above the work row (the motion-footer pattern, top-docked).
// The row takes layout space and pushes the preview down rather than overlaying it,
// so controls + live status read on a solid surface instead of a transparent overlay.
// This is Fold's chrome over the engine-agnostic output bus (src/stage/).
//
// Surface:
//   - record to disk (the universal sink; the red "take rolling"),
//   - Syphon BROADCAST toggle + editable server name (the green "armed/live") —
//     hidden on plain web (no Syphon host), shown behind ?mocksyphon / Electron,
//   - output RESOLUTION picker (long-side tier; aspect FOLLOWS session.frameAspect),
//   - live status (resolution + fps + state), folded into the row.
//
// The bus runs whenever EITHER recording OR broadcasting is wanted (idle otherwise),
// so stopping a take doesn't tear down a live broadcast and vice-versa. Both are
// concurrent — recording a take while broadcasting is the key simultaneous case.

const TIER_DEFAULT = 1920;   // FHD long side — safe live default (never default 4K)

export function createOutputPanel(env, outputBus) {
  const byId = (id) => document.getElementById(id);
  const outputBtn = byId('outputBtn');
  const outputRow = byId('outputRow');
  const led = byId('outputLed');
  const recordBtn = byId('recordBtn');
  const broadcastBtn = byId('broadcastBtn');
  const resTiers = byId('outputResTiers');
  const resHint = byId('outputResHint');
  const nameInput = byId('serverNameInput');
  const syphonNameField = byId('syphonNameField');
  const statusEl = byId('outputStatus');
  const ledGreen = led ? led.querySelectorAll('i')[0] : null;   // broadcast
  const ledRed = led ? led.querySelectorAll('i')[1] : null;     // record

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
    resHint.textContent = tier >= 3840 ? `${w}×${h} · clean hardware only` : `${w}×${h}`;
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
      if (!wantBroadcast) stopPolling();
    } else {
      if (!hasSource()) return;
      if (!recorder.supported) { if (statusEl) statusEl.textContent = 'recording not supported in this browser'; return; }
      try {
        applyResolution();
        wantRecord = true;
        syncBusRunning();                          // ensure the bus is rendering frames
        recorder.start(outputBus.width, outputBus.height);
        startPolling();
      } catch (e) {
        wantRecord = false; syncBusRunning();
        if (statusEl) statusEl.textContent = `could not start recording: ${e.message}`;
      }
    }
    reflect();
    renderStatus();
  }

  function toggleBroadcast() {
    if (!syphonAvailable) return;
    if (wantBroadcast) {
      host.syphon.stop();
      wantBroadcast = false;
      syncBusRunning();
      if (!recorder?.recording) stopPolling();
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
    renderStatus();
  }

  // ---- status surfaces ---------------------------------------------------------
  function reflect() {
    const rec = !!recorder?.recording;
    // traffic-light on the output button (always-on glance)
    if (ledGreen) ledGreen.classList.toggle('on-green', wantBroadcast);
    if (ledRed) ledRed.classList.toggle('on-red', rec);
    if (outputBtn) outputBtn.classList.toggle('active', rec || wantBroadcast);
    // record control (red take)
    if (recordBtn) {
      recordBtn.textContent = rec ? 'stop' : 'record';
      recordBtn.classList.toggle('rec', rec);
    }
    // broadcast control (green arm) — only present with a Syphon host
    if (broadcastBtn) {
      broadcastBtn.hidden = !syphonAvailable;
      broadcastBtn.textContent = wantBroadcast ? 'stop broadcast' : 'broadcast';
      broadcastBtn.classList.toggle('armed', wantBroadcast);
    }
    if (syphonNameField) syphonNameField.hidden = !syphonAvailable;
  }

  // The live readout, folded into the row: output target + state + fps.
  function renderStatus() {
    if (!statusEl) return;
    if (!hasSource()) { statusEl.textContent = 'load a source to output'; statusEl.classList.remove('live'); return; }
    const s = outputBus.getStatus();
    const parts = [];
    if (s.broadcasting) parts.push(`◉ ${s.serverName}`);
    if (recorder?.recording) parts.push('● rec');
    if (parts.length) {
      statusEl.textContent = `${parts.join(' · ')} · ${s.width}×${s.height} · ${s.fps || '…'} fps`;
      statusEl.classList.add('live');
    } else {
      statusEl.textContent = `output ${s.width}×${s.height}`;
      statusEl.classList.remove('live');
    }
  }

  function startPolling() {
    stopPolling();
    statusTimer = setInterval(() => { reflect(); renderStatus(); }, 500);
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
    }
    applyResolution();          // keep the output target tracking the current frame aspect
    reflect();
    renderStatus();
  }

  // ---- the docked row ----------------------------------------------------------
  function setRowOpen(open) {
    if (!outputRow) return;
    outputRow.hidden = !open;
    document.body.classList.toggle('output-open', open);
    if (open) { applyResolution(); renderStatus(); }
    // the row changes the work-row height — re-fit the preview canvas after layout
    // settles, the same way the motion footer does (env handles set by the chrome).
    requestAnimationFrame(() => {
      env.resizePreviewCanvas?.();
      env.sourceOverlay?.render?.();
    });
  }
  function toggleRow() { setRowOpen(outputRow?.hidden); }

  // ---- wiring ------------------------------------------------------------------
  outputBtn?.addEventListener('click', toggleRow);
  recordBtn?.addEventListener('click', toggleRecord);
  broadcastBtn?.addEventListener('click', toggleBroadcast);

  resTiers?.querySelectorAll('button[data-tier]').forEach((b) => {
    b.addEventListener('click', () => {
      tier = parseInt(b.dataset.tier, 10) || TIER_DEFAULT;
      resTiers.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      applyResolution();
      renderStatus();
    });
  });

  nameInput?.addEventListener('input', () => outputBus.setServerName(nameInput.value));

  // expose the availability updater so the chrome can call it on source change.
  env.updateOutputUI = updateOutputUI;

  reflect();
  updateOutputUI();
}
