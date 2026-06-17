// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/output-panel.js
//
// The live-output affordance in the global control area: the toolbar's #outputBtn
// and its contextual surface (#outputSheet), mirroring how #motionBtn reveals the
// motion footer and how the export/diagnostics sheets work. This is Fold's chrome
// over the engine-agnostic output bus (src/stage/) — the button + sheet talk to
// the bus; the bus talks to the engine adapter.
//
// Increment 2 content: record-to-disk start/stop + a live fps readout. The bus
// feeds per-frame op records into env.diag.ops (surfaced in the diagnostics sheet).
// Later increments grow this surface: a broadcasting indicator (Increment 3), an
// output resolution/aspect picker, and an editable server name.
//
// Open/close of #outputSheet is handled by wireGlobalSheets (consistent with the
// other sheets); this module owns the record control, the fps readout, and the
// toolbar button's enabled/active state.

export function createOutputPanel(env, outputBus) {
  const byId = (id) => document.getElementById(id);
  const outputBtn = byId('outputBtn');
  const recordBtn = byId('recordBtn');
  const statusEl = byId('outputStatus');
  const recorder = outputBus.getSink('disk');

  let statusTimer = 0;

  function fmtStatus() {
    const s = outputBus.getStatus();
    if (recorder?.recording) return `recording · ${s.width}×${s.height} · ${s.fps || '…'} fps`;
    return `idle · output ${s.width}×${s.height}`;
  }

  function renderStatus() {
    if (statusEl) statusEl.textContent = fmtStatus();
  }

  function startStatusPolling() {
    stopStatusPolling();
    statusTimer = setInterval(renderStatus, 500);
  }
  function stopStatusPolling() {
    if (statusTimer) { clearInterval(statusTimer); statusTimer = 0; }
  }

  function reflectButton() {
    const rec = !!recorder?.recording;
    if (outputBtn) outputBtn.classList.toggle('active', rec);
    if (recordBtn) {
      recordBtn.textContent = rec ? 'stop recording' : 'record to disk';
      recordBtn.classList.toggle('active', rec);
    }
  }

  // gate the toolbar button on a loaded source (record needs frames to render);
  // called by the chrome whenever the source/layout changes (alongside motion).
  function updateOutputUI() {
    const hasSource = !!(env.engine && env.engine.getSourceImage());
    if (outputBtn) outputBtn.disabled = !hasSource;
    // a running record can't outlive its source — stop if the source went away
    if (!hasSource && recorder?.recording) toggleRecord();
    reflectButton();
  }

  function toggleRecord() {
    if (!recorder) return;
    if (recorder.recording) {
      recorder.stop();
      outputBus.stop();              // Increment 2: the disk sink is the only consumer
      stopStatusPolling();
    } else {
      if (!env.engine || !env.engine.getSourceImage()) return;   // nothing to render
      if (!recorder.supported) {
        if (statusEl) statusEl.textContent = 'recording is not supported in this browser';
        return;
      }
      try {
        outputBus.start();           // begin rendering frames at output resolution
        recorder.start(outputBus.width, outputBus.height);
        startStatusPolling();
      } catch (e) {
        outputBus.stop();
        if (statusEl) statusEl.textContent = `could not start recording: ${e.message}`;
      }
    }
    reflectButton();
    renderStatus();
  }

  recordBtn?.addEventListener('click', toggleRecord);

  // refresh the readout each time the sheet is opened (shows idle resolution).
  outputBtn?.addEventListener('click', renderStatus);

  // expose the availability updater so the chrome can call it on source change.
  env.updateOutputUI = updateOutputUI;

  updateOutputUI();
  renderStatus();
}
