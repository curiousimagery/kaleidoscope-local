// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/output-panel.js
//
// The live-output affordance in the global control area: the toolbar's #outputBtn
// (a green-over-red traffic-light — green = broadcasting, red = recording) and the
// #outputRow band. Fold's chrome over the engine-agnostic output bus (src/stage/).
//
// Multi-destination output model: a single-select DESTINATION picker lists the
// detected, available output surfaces (external window everywhere; Syphon when the
// Electron host provides it; NDI/HDMI slot in here later), and an independent
// START/STOP drives broadcasting to the selected one. You STOP to change destination
// (the picker locks while live); the last selection is retained (localStorage) for
// one-tap restart. Record-to-disk is a SEPARATE, concurrent control (record a take
// while broadcasting). The test pattern swaps the program for a reference frame.

const TIER_DEFAULT = 1920;            // FHD long side — safe live default (never 4K)
const DEST_KEY = 'fold.outputDestination';

export function createOutputPanel(env, outputBus) {
  const byId = (id) => document.getElementById(id);
  const outputBtn = byId('outputBtn');
  const led = byId('outputLed');
  const recordBtn = byId('recordBtn');
  const broadcastBtn = byId('broadcastBtn');     // repurposed: start/stop output
  const destEl = byId('outputDest');             // destination picker container
  const testPatternBtn = byId('testPatternBtn');
  const frameAspect = byId('frameAspect');
  const resTiers = byId('outputResTiers');
  const resHint = byId('outputResHint');
  const nameInput = byId('serverNameInput');
  const syphonNameField = byId('syphonNameField');
  const statusEl = byId('outputStatus');
  const ledGreen = led ? led.querySelectorAll('i')[0] : null;   // broadcast
  const ledRed = led ? led.querySelectorAll('i')[1] : null;     // record
  const recAudioEl = byId('recAudio');

  const recorder = outputBus.getSink('disk');

  // audio-source picker: enumerate mics into the select (labels only appear
  // once some permission has been granted — generic names until then), keep
  // the choice in session, refresh on focus + device changes. "none" records
  // video only (the long-standing behavior stays the default).
  async function refreshMics() {
    if (!recAudioEl || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const mics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      const cur = (env.session && env.session.recordAudioDevice) || '';
      recAudioEl.innerHTML = '<option value="">none</option>' +
        mics.map((m, i) => `<option value="${m.deviceId}">${(m.label || `microphone ${i + 1}`).replace(/</g, '&lt;')}</option>`).join('');
      recAudioEl.value = [...recAudioEl.options].some((o) => o.value === cur) ? cur : '';
    } catch { /* keep "none" */ }
  }
  recAudioEl?.addEventListener('change', () => { if (env.session) env.session.recordAudioDevice = recAudioEl.value; });
  recAudioEl?.addEventListener('focus', refreshMics);
  try { navigator.mediaDevices?.addEventListener?.('devicechange', refreshMics); } catch { /* optional */ }
  refreshMics();

  // Detected destinations, in display order. A sink is offered only if it's registered
  // (Syphon only on a native host) and reports supported.
  const DEST_DEFS = [
    { id: 'window', label: 'output window' },
    { id: 'syphon', label: 'Syphon' },
    { id: 'ndi', label: 'NDI', title: 'publish the program as an NDI source on the network (Arena/OBS list it like a camera)' },
  ];
  const destinations = DEST_DEFS
    .map((d) => ({ ...d, sink: outputBus.getSink(d.id) }))
    .filter((d) => d.sink && d.sink.supported !== false);

  let tier = TIER_DEFAULT;
  let wantRecord = false;
  let broadcasting = false;             // is the selected destination live
  let testOn = false;
  let statusTimer = 0;

  // last-used destination (retained across sessions), else first available
  let destination = (() => {
    let saved = null;
    try { saved = localStorage.getItem(DEST_KEY); } catch {}
    if (saved && destinations.some((d) => d.id === saved)) return saved;
    return destinations[0]?.id || null;
  })();
  const selectedDest = () => destinations.find((d) => d.id === destination) || null;

  // ---- output resolution: long-side tier × the composition frame aspect ---------
  function computeDims() {
    const a = (env.session && env.session.frameAspect) || 1;
    let w, h;
    if (a >= 1) { w = tier; h = Math.round(tier / a); }
    else { h = tier; w = Math.round(tier * a); }
    return { w, h };
  }
  function applyResolution() {
    if (!outputBus.running) {           // never resize mid-session
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

  // ---- bus lifecycle: run while recording OR a bus-consuming destination is live --
  function syncBusRunning() {
    // the output-window destination self-renders (needsBus:false), so a window-only
    // session never starts the bus's read-back loop. Recording or Syphon do need it.
    const destNeedsBus = broadcasting && selectedDest()?.sink.needsBus !== false;
    const need = wantRecord || destNeedsBus;
    if (need && !outputBus.running) outputBus.start();
    else if (!need && outputBus.running) outputBus.stop();
  }

  function hasSource() { return !!(env.engine && env.engine.getSourceImage()); }
  function canArm() { return hasSource() || testOn; }   // test pattern needs no source

  // Frame aspect sets the OUTPUT resolution, which the bus locks while running — so
  // disable it while outputting (otherwise changing it silently does nothing). Zoom/
  // rotation/OOB stay live (they re-render each frame and DO update downstream).
  function lockAspect(locked) {
    if (!frameAspect) return;
    frameAspect.classList.toggle('locked', locked);
    frameAspect.title = locked
      ? 'frame aspect is locked while recording or broadcasting — stop output to change it'
      : '';
  }

  // the mic behind the audio picker, held for the recording session
  let recMicStream = null;
  function stopRecMic() {
    recMicStream?.getTracks().forEach((t) => t.stop());
    recMicStream = null;
  }
  async function toggleRecord() {
    if (!recorder) return;
    if (recorder.recording) {
      recorder.stop();
      stopRecMic();
      wantRecord = false;
      syncBusRunning();
      if (!broadcasting) stopPolling();
    } else {
      if (!canArm()) return;
      if (!recorder.supported) { if (statusEl) statusEl.textContent = 'recording not supported in this browser'; return; }
      // the audio picker: acquire the chosen mic first (async); denial or
      // failure degrades to video-only rather than blocking the take
      let micTrack = null;
      const devId = recAudioEl?.value;
      if (devId) {
        try {
          recMicStream = await navigator.mediaDevices.getUserMedia({ audio: devId === 'default' ? true : { deviceId: { exact: devId } } });
          micTrack = recMicStream.getAudioTracks()[0] || null;
        } catch {
          recMicStream = null;
          if (statusEl) statusEl.textContent = 'microphone unavailable — recording video only';
        }
      }
      try {
        applyResolution();
        wantRecord = true;
        syncBusRunning();
        recorder.start(outputBus.width, outputBus.height, micTrack);
        startPolling();
      } catch (e) {
        wantRecord = false; syncBusRunning(); stopRecMic();
        if (statusEl) statusEl.textContent = `could not start recording: ${e.message}`;
      }
    }
    reflect();
    renderStatus();
  }

  // Start/stop output to the SELECTED destination (independent of recording).
  function toggleOutput() {
    const dest = selectedDest();
    if (broadcasting) {
      dest?.sink.stop();
      broadcasting = false;
      syncBusRunning();
      if (!recorder?.recording) stopPolling();
    } else {
      if (!dest || !canArm()) return;
      try {
        applyResolution();
        const name = nameInput ? nameInput.value : 'Fold';
        if (dest.id === 'syphon') outputBus.setServerName(name);
        // Syphon AND NDI are named sources (what Arena/OBS list); others ignore it
        const named = dest.id === 'syphon' || dest.id === 'ndi';
        dest.sink.start(named ? name : undefined);   // may throw (e.g. popup blocked)
        broadcasting = true;
        syncBusRunning();
        startPolling();
      } catch (e) {
        broadcasting = false; syncBusRunning();
        if (statusEl) statusEl.textContent = e.message || 'could not start output';
      }
    }
    reflect();
    renderStatus();
  }

  function selectDestination(id) {
    if (broadcasting) return;             // stop to change destination
    if (!destinations.some((d) => d.id === id)) return;
    destination = id;
    try { localStorage.setItem(DEST_KEY, id); } catch {}
    reflect();
    renderStatus();
  }

  function buildDestPicker() {
    if (!destEl) return;
    destEl.innerHTML = '';
    for (const d of destinations) {
      const b = document.createElement('button');
      b.className = 'toggle';
      b.dataset.dest = d.id;
      b.textContent = d.label;
      b.title = d.title || (d.id === 'window'
        ? 'a clean output window you can drag to a second display and fullscreen'
        : 'broadcast to Syphon (Resolume Arena, VDMX, …)');
      b.addEventListener('click', () => selectDestination(d.id));
      destEl.appendChild(b);
    }
  }

  // Late destination registration — native destination modules load async (the
  // HDMI / external-display sink on Capacitor), after this panel has already
  // built its picker. Adds the destination, restores a saved selection that
  // pointed at it, and — when the sink reports display changes — auto-selects on
  // plug-in (connecting a display IS the intent to output there; Daniel's call)
  // and cleans up the broadcasting state on disconnect (the sink already stopped
  // itself; without this the panel would still read "live").
  env.addOutputDestination = ({ id, label, title }) => {
    const sink = outputBus.getSink(id);
    if (!sink || sink.supported === false || destinations.some((d) => d.id === id)) return;
    destinations.push({ id, label, title, sink });
    let saved = null;
    try { saved = localStorage.getItem(DEST_KEY); } catch {}
    if (!destination || (saved === id && !broadcasting)) destination = id;
    if (typeof sink.onDisplayChange === 'function') {
      sink.onDisplayChange((connected, info) => {
        // the row carries a live resolution readout while connected — iOS exposes
        // no display NAME, so pixels are the meaningful identity (Daniel's call)
        const d = destinations.find((x) => x.id === id);
        if (d) {
          d.label = connected && info?.width ? `${label} · ${info.width}×${info.height}` : label;
          buildDestPicker();
        }
        if (connected && !broadcasting) selectDestination(id);
        if (!connected && broadcasting && destination === id) {
          broadcasting = false;
          syncBusRunning();
          if (!recorder?.recording) stopPolling();
          if (statusEl) statusEl.textContent = 'external display disconnected';
        }
        reflect();
        renderStatus();
      });
    }
    buildDestPicker();
    reflect();
    renderStatus();
  };

  // ---- status surfaces ----------------------------------------------------------
  function reflect() {
    const rec = !!recorder?.recording;
    const armable = canArm();
    if (ledGreen) ledGreen.classList.toggle('on-green', broadcasting);
    if (ledRed) ledRed.classList.toggle('on-red', rec);
    if (outputBtn) outputBtn.classList.toggle('active', rec || broadcasting);

    if (recordBtn) {
      // red dot beside "record" (Daniel's color-semantics parity with mobile:
      // red = record, green = live); recording flips to a plain "stop"
      recordBtn.innerHTML = rec
        ? 'stop'
        : '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="var(--danger)"/></svg>record';
      recordBtn.classList.toggle('rec', rec);
      recordBtn.disabled = !armable && !rec;
    }

    // destination picker: reflect selection; lock while broadcasting (stop to change)
    if (destEl) {
      destEl.querySelectorAll('button[data-dest]').forEach((b) => {
        b.classList.toggle('active', b.dataset.dest === destination);
        b.disabled = broadcasting;
      });
    }

    // start/stop output control (green when live)
    if (broadcastBtn) {
      broadcastBtn.hidden = destinations.length === 0;
      broadcastBtn.textContent = broadcasting ? 'stop' : 'start';
      broadcastBtn.classList.toggle('armed', broadcasting);
      broadcastBtn.disabled = (!armable && !broadcasting) || destinations.length === 0;
    }

    // server name only when Syphon is the selected destination
    // the editable source name applies to both network/IPC destinations (Syphon + NDI)
    if (syphonNameField) syphonNameField.hidden = !(destination === 'syphon' || destination === 'ndi');

    // fill-display toggle only when the external display is the destination
    const fillField = byId('hdmiFillField');
    if (fillField) {
      fillField.hidden = destination !== 'hdmi';
      byId('hdmiFillBtn')?.classList.toggle('active', !!env.session?.hdmiFill);
    }

    // resolution + frame aspect both set the output size, which is fixed for the
    // session once output starts (the bus locks it; the window reads it at open) —
    // disable them while live so a mid-session change can't silently do nothing.
    const sizeLocked = outputBus.running || broadcasting;
    lockAspect(sizeLocked);
    if (resTiers) resTiers.querySelectorAll('button').forEach((b) => { b.disabled = sizeLocked; });
  }

  function renderStatus() {
    if (!statusEl) return;
    if (!canArm()) { statusEl.textContent = 'load a source (or use the test pattern) to output'; statusEl.classList.remove('live'); return; }
    const s = outputBus.getStatus();
    const parts = [];
    if (broadcasting) {
      const d = selectedDest();
      parts.push(`◉ ${d ? d.label : 'output'}${d && d.id === 'syphon' ? ` (${s.serverName})` : ''}`);
    }
    if (recorder?.recording) parts.push('● rec');
    if (s.testPattern) parts.push('▦ test pattern');
    if (parts.length) {
      // the self-rendering window measures its own GPU fps; the bus measures the
      // read-back fps for Syphon/record. Prefer the live destination's own number.
      const fps = (broadcasting && selectedDest()?.sink.fps) || s.fps;
      statusEl.textContent = `${parts.join(' · ')} · ${s.width}×${s.height} · ${fps || '…'} fps`;
      statusEl.classList.add('live');
    } else {
      statusEl.textContent = `output ${s.width}×${s.height}`;
      statusEl.classList.remove('live');
    }
  }

  // The bus stopped itself on a render failure (e.g. the output engine couldn't create
  // its second GL context) — tear down our side cleanly and surface the reason, so the
  // broadcast/record doesn't just die silently with the controls still lit.
  function failOutput(message) {
    if (recorder?.recording) { recorder.stop(); stopRecMic(); }
    if (broadcasting) selectedDest()?.sink.stop();
    wantRecord = false; broadcasting = false;
    syncBusRunning();
    stopPolling();
    reflect();
    if (statusEl) { statusEl.textContent = `output stopped: ${message}`; statusEl.classList.remove('live'); }
  }

  function startPolling() {
    stopPolling();
    statusTimer = setInterval(() => {
      // bus render failure: it needs the bus (record or a bus-consuming destination)
      // but the bus reported an error and stopped → surface it and reset.
      const err = outputBus.getStatus().error;
      const neededBus = wantRecord || (broadcasting && selectedDest()?.sink.needsBus !== false);
      if (err && neededBus && !outputBus.running) { failOutput(err); return; }

      // the user may have closed the output window directly — reconcile our state.
      const d = selectedDest();
      if (broadcasting && d && d.sink.active === false) {
        broadcasting = false;
        syncBusRunning();
        if (!recorder?.recording) stopPolling();
      }
      reflect();
      renderStatus();
    }, 500);
  }
  function stopPolling() { if (statusTimer) { clearInterval(statusTimer); statusTimer = 0; } }

  // Called by the chrome on source/layout change. The output band is reachable
  // whenever output is possible; arming is gated on canArm() (source or test pattern).
  // A running output that loses its only frame source is stopped.
  function updateOutputUI() {
    if (outputBtn) outputBtn.disabled = !(hasSource() || recorder?.supported || destinations.length);
    if (!canArm() && (recorder?.recording || broadcasting)) {
      if (recorder?.recording) { recorder.stop(); stopRecMic(); }
      if (broadcasting) selectedDest()?.sink.stop();
      wantRecord = false; broadcasting = false;
      syncBusRunning();
      stopPolling();
    }
    applyResolution();
    reflect();
    renderStatus();
  }

  // ---- wiring -------------------------------------------------------------------
  // The #outputRow band's open/close is owned by the chrome's wireBarBands; this
  // module owns the band's CONTENT; the chrome calls env.refreshOutputBand on open.
  env.refreshOutputBand = () => { applyResolution(); renderStatus(); };

  buildDestPicker();
  recordBtn?.addEventListener('click', toggleRecord);
  broadcastBtn?.addEventListener('click', toggleOutput);

  testPatternBtn?.addEventListener('click', () => {
    testOn = !testOn;
    outputBus.setTestPattern(testOn);
    testPatternBtn.classList.toggle('active', testOn);
    updateOutputUI();
  });

  resTiers?.querySelectorAll('button[data-tier]').forEach((b) => {
    b.addEventListener('click', () => {
      tier = parseInt(b.dataset.tier, 10) || TIER_DEFAULT;
      resTiers.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      applyResolution();
      renderStatus();
    });
  });

  nameInput?.addEventListener('input', () => outputBus.setServerName(nameInput.value));

  // fill-display: live-toggleable even mid-broadcast (the poster recomputes the
  // output dims per tick and the external view resizes on the next message)
  byId('hdmiFillBtn')?.addEventListener('click', () => {
    if (env.session) env.session.hdmiFill = !env.session.hdmiFill;
    reflect();
  });

  env.updateOutputUI = updateOutputUI;

  reflect();
  updateOutputUI();
}
