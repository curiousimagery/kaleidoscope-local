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

import { setMicTrimHint, getMicTrimHint, MIC_TARGET_PEAK, MIC_MAX_GAIN, MIC_MIN_GAIN } from 'conduit/recorder';

const TIER_DEFAULT = 1920;            // FHD long side — safe live default (never 4K)
const DEST_KEY = 'fold.outputDestination';

// THE MIC INPUT PATH (B558 → B566). Bare `audio: true` opts into echo cancellation, noise
// suppression and automatic gain control — tuned for calls, and audibly wrong for a recording.
// `ideal` rather than `exact` so a platform that cannot honour a flag still returns a track.
//
// On iOS these flags do not merely toggle processing: they select the input PATH. The iPhone's raw
// path is healthy (`peak` 2.82). The iPad's is ~-52dBFS. Same code, same constraints, opposite
// outcomes — which is why this is a per-input choice and never a device rule (CAPABILITIES §1:
// probe, never classify). Mirrors the phone chrome's RAW_MIC, which stays on `raw`.
//
// SETTLED B568: `raw` everywhere. Daniel ran all three modes on iPad — raw is best, balanced
// beats voice, and raw with a large trim is the best-sounding option there. The three-way picker
// existed to answer that question; keeping it afterwards would be shipping our A/B rig as a user
// setting. WebKit note worth keeping: `getSettings()` reports only `echoCancellation` on iOS —
// `noiseSuppression` and `autoGainControl` are absent, so two of these three can never be verified.
const rawMicAudio = (devId) => {
  const base = { echoCancellation: { ideal: false }, noiseSuppression: { ideal: false }, autoGainControl: { ideal: false } };
  return (devId && devId !== 'default') ? { deviceId: { exact: devId }, ...base } : base;
};



export function createOutputPanel(env, outputBus) {
  const byId = (id) => document.getElementById(id);

  // The self-rendering destinations (external display, output window) draw in ANOTHER PROCESS,
  // so we can never time them from here — but their pixels are usually the single largest item
  // in the frame (up to 8.3MP at 4K), and leaving them out of the accounting would understate
  // the load by more than everything else combined. Registered as a `remote` surface: it
  // contributes megapixels and reports the view's own measured fps, and honestly shows no ms.
  // every sink the bus knows about, plus the external display when it runs outside the bus
  // (the iPad HDMI path self-renders and never registers as a bus sink)
  const activeSinks = () => {
    const out = [];
    for (const id of outputBus.getStatus().sinks) { const s = outputBus.getSink(id); if (s) out.push(s); }
    if (env.externalDisplay) out.push(env.externalDisplay);
    return out;
  };

  const remoteSurface = env.perf?.surface({
    id: 'external', label: 'external display (other process)', serves: 'program',
    priority: 70, remote: true, scaleLadder: [1],
    // Ask EVERY registered sink whether it is self-rendering right now, rather than routing
    // through the currently-selected destination. B514's iPad run reported this surface as 0x0
    // while an 8.3-megapixel external view was live — the biggest single item in the frame,
    // invisible — because on that path the selection indirection did not resolve to the sink.
    // A sink that exposes live `renderDims` IS an active surface, whatever the picker says.
    size: () => {
      for (const s of activeSinks()) {
        const d = s?.renderDims;
        if (d && d.width > 0 && d.height > 0) return { w: d.width, h: d.height };
      }
      return { w: 0, h: 0 };
    },
    // THE FPS MEASURED ON THE DISPLAY, which is a different number from ours and the only one
    // that describes the broadcast. This surface reported dimensions and nothing else, so an
    // external view rendering at 10fps was indistinguishable from one rendering at 60 while the
    // app's own loop truthfully reported 46 (B549). A remote surface with no throughput reading
    // is a surface we cannot debug.
    note: () => {
      for (const s of activeSinks()) {
        const d = s?.renderDims;
        if (!(d && d.width > 0)) continue;
        const f = s?.fps || 0;
        const sf = s?.srcFps;
        if (!f) return 'awaiting first fps report';
        // THE EVENNESS VERDICT (B577). Two rates that match on average can still judder, which is
        // exactly what B576 proved: `28 fps ON THE DISPLAY · 28 new/s` with severe judder. So the
        // note carries the SPREAD of the interval between renders that showed a NEW picture. An
        // even 28fps and a bursty 28fps are the same average and a different product.
        //
        // The threshold is a ratio, not a constant, because the honest interval depends on the
        // source rate: p95 beyond ~1.6x p50 means roughly one in twenty new frames waits more than
        // half again as long as the typical one, which is where a swing starts being visible.
        // CHECK THE LEVEL BEFORE THE SPREAD (B578). B577 shipped this comparing only p95 against
        // p50, and it printed `even (new frame 182/187ms)` for a display putting **six new
        // pictures a second** on the wall while 30 arrived. A steady 6fps is perfectly even and
        // completely broken. The level is the first question; the spread only matters after it.
        const j = s?.jitter;
        let even = '';
        if (j?.fresh?.p50 > 0) {
          const { p50, p95 } = j.fresh;
          const want = sf > 0 ? 1000 / sf : 0;   // the interval if every arriving frame were shown
          const shown = Math.round(1000 / p50);
          if (want > 0 && p50 > want * 1.8) {
            even = ` · ⚠ ONLY ~${shown} NEW PICTURES/s ON SCREEN (one every ${p50}ms) — ${sf} arrive and most are never shown`;
          } else if (p95 > p50 * 1.6) {
            even = ` · ⚠ UNEVEN: new picture every ${p50}ms typical, ${p95}ms at p95`;
          } else {
            even = ` · steady (new picture ${p50}/${p95}ms)`;
          }
        }
        // RENDER rate and ARRIVAL rate, because they diverge and that divergence IS the bug:
        // a view re-drawing the same frame reports a healthy fps while the picture sits still.
        if (typeof sf === 'number' && sf >= 0) {
          return sf < f / 2
            ? `${f} fps drawn · ⚠ only ${sf} NEW frames/s — the picture is stalling, not the renderer${even}`
            : `${f} fps ON THE DISPLAY · ${sf} new/s${even}`;
        }
        return `${f} fps ON THE DISPLAY${even}`;
      }
      return '';
    },
  }) || null;
  if (remoteSurface) env.perfSurfaces.external = remoteSurface;
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
  // a generic/absent OS label gets a DEVICE-AWARE name ("iPad mic" beats
  // "microphone 1" — Daniel's note); real labels (USB interfaces, etc.) pass through
  const builtinMicName = /iPhone/.test(navigator.userAgent) ? 'iPhone mic'
    : (/iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform))) ? 'iPad mic'
    : 'built-in mic';
  function micLabel(raw, i, count) {
    const generic = !raw || /^(microphone|default)(\s*\d+)?$/i.test(raw.trim());
    if (!generic) return raw;
    return count > 1 ? `${builtinMicName} ${i + 1}` : builtinMicName;
  }
  async function refreshMics() {
    if (!recAudioEl || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const mics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      // BEFORE mic permission, browsers enumerate audioinputs with EMPTY deviceId
      // AND label — rendering those as pickable entries made a phantom mic whose
      // value ('') was indistinguishable from "none": no meter, no audio at record
      // (Daniel's Brave + iPad sessions). Offer an explicit arming option instead;
      // picking it prompts for permission, then this re-runs with real ids + names
      // (Electron shows full names because its shell auto-grants the permission).
      const usable = mics.filter((m) => m.deviceId);
      if (!usable.length) {
        recAudioEl.innerHTML = '<option value="">none</option>' +
          (mics.length ? '<option value="__enable">enable microphone…</option>' : '');
        recAudioEl.value = '';
        return;
      }
      const cur = (env.session && env.session.recordAudioDevice) || '';
      recAudioEl.innerHTML = '<option value="">none</option>' +
        usable.map((m, i) => `<option value="${m.deviceId}">${micLabel(m.label, i, usable.length).replace(/</g, '&lt;')}</option>`).join('');
      recAudioEl.value = [...recAudioEl.options].some((o) => o.value === cur) ? cur : '';
    } catch { /* keep "none" */ }
  }
  recAudioEl?.addEventListener('change', async () => {
    if (recAudioEl.value === '__enable') {
      // one-time grant: ask for the default mic, release it immediately (the
      // permission persists), then rebuild the picker with real devices
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
      } catch { recAudioEl.value = ''; return; }
      await refreshMics();
      const first = [...recAudioEl.options].find((o) => o.value && o.value !== '__enable');
      recAudioEl.value = first ? first.value : '';
    }
    if (env.session) env.session.recordAudioDevice = recAudioEl.value;
    syncMicMeter();
  });
  recAudioEl?.addEventListener('focus', refreshMics);
  try { navigator.mediaDevices?.addEventListener?.('devicechange', refreshMics); } catch { /* optional */ }
  refreshMics();

  // ---- mic level meters: live L/R feedback while a mic is selected AND the menu
  // is open (Daniel: proof the chosen mic is working). The capture exists only
  // while the menu is visible — no lingering mic indicator once it closes; the
  // meter's own rAF tears everything down when the menu hides or 'none' is picked.
  let meterStream = null, meterCtx = null, meterRaf = 0;
  function stopMicMeter() {
    if (meterRaf) { cancelAnimationFrame(meterRaf); meterRaf = 0; }
    meterStream?.getTracks().forEach((t) => t.stop());
    meterStream = null;
    try { meterCtx?.close(); } catch { /* already closed */ }
    meterCtx = null;
    const wrap = byId('micMeter');
    if (wrap) wrap.hidden = true;
    const gRow = byId('micGainRow');
    if (gRow) gRow.hidden = true;
  }
  // OPENING A PANEL MUST NEVER STOP THE PROGRAM (B569, Daniel — blocking).
  //
  // The meter opens its own `getUserMedia` whenever this menu is visible with a mic selected. On
  // iOS acquiring an audio input changes the AVAudioSession category, which **interrupts video
  // playback** — so simply opening the output panel paused the clip, mid-broadcast, and the only
  // way back was stopping the broadcast and setting the mic to `none`. Daniel hit this on every
  // NDI and HDMI attempt; it blocked the whole verification pass.
  //
  // The meter is a SETUP affordance: its job is proving the mic works and dialling the gain before
  // you record. It is not worth interrupting a live program for, so while something is playing or
  // broadcasting it does not auto-acquire. The row says why, and offers the acquisition as an
  // explicit action for anyone who accepts the interruption.
  //
  // NOTE this does not fix the underlying audio-session conflict — a take started mid-broadcast
  // still acquires a mic and will still interrupt. That needs the native plugin to configure a
  // category where capture and playback coexist, and is filed. This removes the accidental case,
  // which is the one that fires without the user asking for anything.
  const programIsLive = () => {
    try {
      if (env.outputBus?.getStatus?.().running) return true;
      if (env.externalDisplay?.active) return true;
      const v = env.sourceVideo;
      if (v && !v.paused && !v.ended) return true;
      if (env.nativeVideo && env.motionRT?.playing) return true;
    } catch { /* a probe that throws must not block the meter */ }
    return false;
  };
  let meterForced = false;   // the user explicitly asked, so honour it until the menu closes

  // The deferred state: gain row visible, meter bars hidden, and an explicit way in.
  function showMeterDeferred() {
    const wrap = byId('micMeter');
    if (wrap) wrap.hidden = true;
    const gRow = byId('micGainRow');
    if (gRow) gRow.hidden = false;
    const readEl = byId('micGainRead');
    if (readEl) readEl.textContent = 'meter paused while live';
    const autoEl = byId('micGainAuto');
    if (autoEl) {
      autoEl.textContent = 'check';
      autoEl.title = 'open the level meter now — on iOS this briefly interrupts playback';
      autoEl.disabled = false;
      autoEl.onclick = () => { meterForced = true; syncMicMeter(); };
    }
  }

  async function syncMicMeter() {
    const row = byId('outputRow');
    const wrap = byId('micMeter');
    const devId = recAudioEl?.value;
    if (!devId || !row || row.hidden || !navigator.mediaDevices?.getUserMedia) { stopMicMeter(); meterForced = false; return; }
    if (meterStream) return;   // already metering
    if (programIsLive() && !meterForced) { showMeterDeferred(); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: rawMicAudio(devId) });
    } catch {
      // an enumerated id can be stale/foreign on WKWebView — fall back to the default mic
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch { stopMicMeter(); return; }
    }
    // the menu may have closed (or the pick changed) while the permission was pending
    if (row.hidden || recAudioEl.value !== devId) { stream.getTracks().forEach((t) => t.stop()); return; }
    meterStream = stream;
    meterCtx = new (window.AudioContext || window.webkitAudioContext)();
    // WKWebView creates AudioContexts SUSPENDED — without the resume the analysers
    // read flat zero and the bars never move (Daniel's iPad pass)
    try { meterCtx.resume?.(); } catch { /* already running */ }
    const rawSrc = meterCtx.createMediaStreamSource(stream);
    // THE METER MUST SHOW WHAT WILL BE RECORDED (B560). Daniel read a near-dead meter on the iPad
    // and correctly predicted a quiet take. Since the recorder trims and limits (recorder.js
    // `startMicTap`), a meter on the RAW input would say "almost nothing" about a take that comes
    // back at a healthy level — an instrument that disagrees with the thing it measures is worse
    // than no instrument. Same chain, same constants, so what you see is what you get.
    const meterTrim = new GainNode(meterCtx, { gain: getMicTrimHint() });
    const meterLimiter = new DynamicsCompressorNode(meterCtx, {
      threshold: -1.5, knee: 0, ratio: 20, attack: 0.003, release: 0.25,
    });
    rawSrc.connect(meterTrim); meterTrim.connect(meterLimiter);
    const src = meterLimiter;

    // THE GAIN CONTROL (B562), and why automatic calibration is gone.
    //
    // Two automatic attempts failed in opposite directions. B560 measured at record start and
    // always caught silence. B561 fixed the trigger and then fired on ROOM TONE — Daniel's report
    // reads `micRawPeak 0.00552`, about -45dBFS, which is an air conditioner rather than a voice.
    // It computed 32x and applied it 2.4s into the take: the audible jump he heard.
    //
    // **Deciding "is this speech" from a short listen is the hard part**, and getting it wrong is
    // bad both ways. `auto` dissolves the question instead of answering it: it calibrates against
    // what the mic hears AT THE MOMENT IT IS PRESSED, and the user presses it while talking. There
    // is no "when do we measure" any more, because the press IS the measurement.
    //
    // The slider is the primary control and always available, because two failed guesses is enough
    // evidence that this needs a knob.
    const gainEl = byId('micGain');
    const gainReadEl = byId('micGainRead');
    const gainAutoEl = byId('micGainAuto');
    if (gainAutoEl) { gainAutoEl.textContent = 'auto'; gainAutoEl.title = 'set the gain from what the mic hears right now — talk at a normal level and press'; }
    // raw peak tracked continuously — what `auto` reads, and what tells a quiet ROOM from a quiet MIC
    const cal = new AnalyserNode(meterCtx, { fftSize: 2048 });
    rawSrc.connect(cal);
    const cbuf = new Float32Array(cal.fftSize);
    let recentRaw = 0;
    const applyGain = (g, { persist = true } = {}) => {
      const v = Math.min(MIC_MAX_GAIN, Math.max(MIC_MIN_GAIN, g));
      try { meterTrim.gain.setTargetAtTime(v, meterCtx.currentTime, 0.08); }
      catch { meterTrim.gain.value = v; }
      setMicTrimHint(v);
      if (gainEl) gainEl.value = String(v);
      if (gainReadEl) gainReadEl.textContent = `${v.toFixed(1)}×`;
      // survives a RELAUNCH, not just a reload: on iPad this is the difference between a usable
      // default and re-dialling every session, and Daniel's verdict is that raw + a big trim is
      // the best-sounding option there (B567)
      if (persist) { try { localStorage.setItem('fold.micGain', String(v)); } catch { /* private mode */ } }
    };
    let savedGain = 0;
    try { savedGain = +localStorage.getItem('fold.micGain') || 0; } catch { /* private mode */ }
    applyGain(savedGain || getMicTrimHint() || 1, { persist: false });
    if (gainEl) gainEl.oninput = () => applyGain(+gainEl.value);
    if (gainAutoEl) {
      gainAutoEl.onclick = () => {
        // measure a fresh 600ms window rather than a lifetime peak: the user is talking NOW, and a
        // running maximum would be polluted by whatever slammed the mic ten minutes ago
        let peak = 0;
        const t0 = performance.now();
        const listen = () => {
          if (!meterStream) return;
          cal.getFloatTimeDomainData(cbuf);
          for (let i = 0; i < cbuf.length; i += 4) { const v = Math.abs(cbuf[i]); if (v > peak) peak = v; }
          if (performance.now() - t0 < 600) { setTimeout(listen, 30); return; }
          if (peak > 0.002) applyGain(MIC_TARGET_PEAK / peak);
          if (gainReadEl) gainReadEl.textContent = `${(+gainEl.value).toFixed(1)}× · heard ${peak.toFixed(3)}`;
          gainAutoEl.textContent = 'auto';
          gainAutoEl.disabled = false;
        };
        gainAutoEl.textContent = 'listening…';
        gainAutoEl.disabled = true;
        listen();
      };
    }
    // keep `recentRaw` fresh so the readout can always answer "is the mic hearing anything at all"
    const trackRaw = () => {
      if (!meterStream) { try { rawSrc.disconnect(cal); } catch {} return; }
      cal.getFloatTimeDomainData(cbuf);
      let p = 0;
      for (let i = 0; i < cbuf.length; i += 4) { const v = Math.abs(cbuf[i]); if (v > p) p = v; }
      recentRaw = Math.max(p, recentRaw * 0.85);   // decaying peak-hold, so it follows the room
      // THE RAW LEVEL IS ALWAYS ON SCREEN. It is the one number that separates "the mic hears
      // nothing" from "the gain is wrong", and not having it is why this took three builds.
      if (gainReadEl && !gainAutoEl?.disabled) {
        gainReadEl.textContent = `${(+(gainEl?.value || 1)).toFixed(1)}× · raw ${recentRaw.toFixed(3)}`;
      }
      setTimeout(trackRaw, 200);
    };
    setTimeout(trackRaw, 200);
    const stereo = (stream.getAudioTracks()[0]?.getSettings?.().channelCount || 1) >= 2;
    const anL = meterCtx.createAnalyser(); anL.fftSize = 512;
    const anR = meterCtx.createAnalyser(); anR.fftSize = 512;
    if (stereo) {
      const split = meterCtx.createChannelSplitter(2);
      src.connect(split);
      split.connect(anL, 0); split.connect(anR, 1);
    } else {
      src.connect(anL); src.connect(anR);   // mono: both bars show the one channel
    }
    if (wrap) wrap.hidden = false;
    const gRow = byId('micGainRow');
    if (gRow) gRow.hidden = false;
    const buf = new Uint8Array(anL.fftSize);
    const lEl = byId('micMeterL'), rEl = byId('micMeterR');
    const peak = (an) => {
      an.getByteTimeDomainData(buf);
      let m = 0;
      for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i] - 128); if (v > m) m = v; }
      return Math.min(1, m / 110);   // slight headroom so speech reads visibly
    };
    const tick = () => {
      if (!meterStream) return;
      if (!row || row.hidden || recAudioEl.value !== devId) { stopMicMeter(); return; }
      if (lEl) lEl.style.width = Math.round(peak(anL) * 100) + '%';
      if (rEl) rEl.style.width = Math.round(peak(anR) * 100) + '%';
      meterRaf = requestAnimationFrame(tick);
    };
    meterRaf = requestAnimationFrame(tick);
  }

  // Detected destinations, in display order. A sink is offered only if it's registered
  // (Syphon only on a native host) and reports supported.
  const DEST_DEFS = [
    { id: 'window', label: 'output window' },
    { id: 'syphon', label: 'Syphon' },
    { id: 'ndi', label: 'NDI', title: 'publish the program as an NDI source on the network (Arena/OBS list it like a camera)' },
  ];
  const destinations = DEST_DEFS
    .map((d) => ({ ...d, baseLabel: d.label, sink: outputBus.getSink(d.id) }))
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
  // iPad caps VIDEO over HDMI to 1080p (the GPU-memory guard), so offering higher tiers is dishonest
  // — they're disabled + the hint says so. True ONLY for the iPad HDMI destination with a video source
  // (Electron HDMI + stills/camera are uncapped and render at full native resolution).
  // the diagnostics "4K/QHD over HDMI" escape hatch lifts this guard for on-device testing
  function hdmiUncapOn() {
    try { return localStorage.getItem('foldHdmiVideoUncap') === '1'; } catch { return false; }
  }
  function videoHdmiCapped() {
    return !hdmiUncapOn() && destination === 'hdmi' && !!env.sourceVideo && !!window.Capacitor?.isNativePlatform?.();
  }
  // true when the tiers are unlocked for testing on the path that's normally capped
  function videoHdmiUncapped() {
    return hdmiUncapOn() && destination === 'hdmi' && !!env.sourceVideo && !!window.Capacitor?.isNativePlatform?.();
  }
  function renderResHint() {
    if (!resHint) return;
    if (videoHdmiCapped()) { resHint.textContent = 'video over HDMI renders at 1080p on iPad (memory guard)'; return; }
    if (videoHdmiUncapped()) { resHint.textContent = '⚠ testing: 4K/QHD over HDMI may lose the graphics context (~30s) — break-glass resets'; return; }
    const { w, h } = computeDims();
    const base = tier >= 3840 ? `${w}×${h} · clean hardware only` : `${w}×${h}`;
    // NDI over Wi-Fi is jitter-bound (Daniel's iPad + iPhone A/B: bursty regardless of settings).
    // Surface the honest caution inline whenever NDI is selected; Ethernet is the smooth path.
    if (destination === 'ndi') { resHint.textContent = `${base} · ⚠ NDI over Wi-Fi can stutter — Ethernet for smooth playback`; return; }
    resHint.textContent = base;
  }

  // ---- bus lifecycle: run while recording OR a bus-consuming destination is live --
  // is the program output live (broadcasting or recording)? drives the M3 contextual locks
  // on resolution + aspect (they can't change while output is live).
  env.isOutputLive = () => broadcasting || wantRecord;
  // BUS output = fixed-size streams (recording, or a bus-consuming broadcast dest like NDI/Syphon)
  // where the frame aspect can't change mid-stream. A SELF-RENDERING dest (HDMI/AirPlay/output-window,
  // needsBus:false) re-letterboxes from state, so aspect stays adjustable there — this is the signal
  // locks.js uses to keep aspect unlockable over HDMI while hard-locking it for recording/NDI/Syphon.
  env.isBusOutputLive = () => wantRecord || (broadcasting && selectedDest()?.sink.needsBus !== false);

  function syncBusRunning() {
    // the output-window destination self-renders (needsBus:false), so a window-only
    // session never starts the bus's read-back loop. Recording or Syphon do need it.
    const destNeedsBus = broadcasting && selectedDest()?.sink.needsBus !== false;
    const need = wantRecord || destNeedsBus;
    if (need && !outputBus.running) outputBus.start();
    else if (!need && outputBus.running) outputBus.stop();
    env.syncLocks?.();   // output-live changed → refresh the resolution/aspect contextual padlocks
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
  // After stop, the take finalizes/saves asynchronously — watch the sink's
  // lastResult so a failed take is never silent (the pre-B368 failure mode:
  // fps counted fine, stop produced nothing, nobody said a word).
  let takeWatch = 0;
  let takeNote = '';
  function watchTakeResult() {
    clearInterval(takeWatch);
    const t0 = Date.now();
    // STATUS BELONGS TO THE TOAST, NOT THE PANEL (B567, Daniel). "saving take…" and "take saved ✓"
    // were being said twice on iPad — once here and once in the save toast — because this note
    // predates the toast and nobody removed it when the toast started carrying the same events.
    // It only became visible now that the toast reliably reaches iPad (B552 fixed it vanishing in
    // landscape, B562 gave it motion). Daniel's rule: a panel is for controls, a toast is for
    // status. So the transient half goes.
    //
    // The FAILURE note stays. It is a persistent condition worth showing beside the record control,
    // and the toast's fail state only covers save-TRANSPORT failures — a take that dies during
    // encode never reaches it.
    takeNote = '';
    renderStatus();
    takeWatch = setInterval(() => {
      const r = recorder.lastResult;
      if (r) {
        clearInterval(takeWatch);
        takeNote = r.ok ? '' : `take FAILED: ${r.error}`;
      } else if (Date.now() - t0 > 30_000) {
        clearInterval(takeWatch);
        takeNote = 'take still saving… (check the console if nothing arrives)';
      }
      renderStatus();
    }, 400);
  }

  async function toggleRecord() {
    if (!recorder) return;
    if (recorder.recording) {
      recorder.stop();
      stopRecMic();
      wantRecord = false;
      syncBusRunning();
      if (!broadcasting) stopPolling();
      watchTakeResult();
    } else {
      if (!canArm()) return;
      if (!recorder.supported) { if (statusEl) statusEl.textContent = 'recording not supported in this browser'; return; }
      // the audio picker: acquire the chosen mic first (async); denial or
      // failure degrades to video-only rather than blocking the take
      let micTrack = null;
      const devId = recAudioEl?.value;
      // THE BROADCAST OUTRANKS THE TAKE'S AUDIO (B570, Daniel's call). Acquiring a mic on iOS
      // changes the AVAudioSession category and interrupts playback — so starting a take while
      // broadcasting would stop the program the audience is watching in order to add sound to a
      // file nobody is watching yet. **Record silent instead, and say so plainly.**
      //
      // This is the priority ladder applied to a resource that is not a render surface: CAPTURE
      // yields to PROGRAM when they genuinely cannot coexist. The proper fix is an audio session
      // where they can (native plugin, filed); until then this is the honest behaviour rather than
      // a surprise mid-show.
      const liveProgram = programIsLive();
      if (devId && liveProgram) {
        if (statusEl) statusEl.textContent = 'recording VIDEO ONLY — a mic would interrupt the live output';
        env.saveFlow?.status?.('busy', 'recording without audio — the mic would interrupt the broadcast', { ttl: 5000 });
      } else if (devId) {
        try {
          recMicStream = await navigator.mediaDevices.getUserMedia({ audio: rawMicAudio(devId) });
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
        await recorder.start(outputBus.width, outputBus.height, micTrack);
        clearInterval(takeWatch);
        takeNote = '';
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
    destinations.push({ id, label, baseLabel: label, title, sink });
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
      // Gecko: record is DISABLED with an honest hint (Daniel's field pass — the
      // button silently did nothing on Firefox, and even a working take would be
      // WebM; endless engine-specific debugging isn't worth it there)
      const gecko = env.capabilities?.isGecko;
      recordBtn.disabled = gecko || (!armable && !rec);
      if (gecko) recordBtn.title = 'recording is unreliable in Firefox — use Safari, Chrome, or the desktop app';
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

    // external-display picker (Electron multi-display): a sub-selector shown ONLY when more
    // than one display is connected — the single 'hdmi' destination stays intact; this just
    // chooses which screen it lands on, each option labeled by its resolution.
    const dispField = byId('hdmiDisplayField');
    const dispSel = byId('hdmiDisplay');
    if (dispField && dispSel) {
      const hdmiSink = destinations.find((d) => d.id === 'hdmi')?.sink;
      const list = (destination === 'hdmi' && hdmiSink?.externalDisplays?.()) || [];
      dispField.hidden = !(destination === 'hdmi' && list.length > 1);
      if (!dispField.hidden) {
        const curId = hdmiSink.currentDisplayId?.();
        dispSel.innerHTML = list
          .map((d) => `<option value="${d.id}">HDMI / AirPlay · ${d.width}×${d.height}</option>`)
          .join('');
        if (curId != null) dispSel.value = String(curId);
        dispSel.disabled = broadcasting;   // stop to change display, like the destination itself
      }
    }

    // RESOLUTION is fixed for the session once ANY output starts (bus + window read it at open).
    // Frame ASPECT is only hard-fixed for a BUS output (recording / NDI / Syphon) — over a self-
    // rendering dest (HDMI/AirPlay/window) it re-letterboxes from the state stream, so the M3
    // padlock governs it (unlockable). Don't disable it here in that case, or the padlock unlock
    // can't re-enable it (Daniel's iPad double-lock bug).
    const resLocked = outputBus.running || broadcasting;
    lockAspect(env.isBusOutputLive());
    const capVideo = videoHdmiCapped();   // iPad HDMI + video → tiers above 1080p are dishonest
    if (resTiers) resTiers.querySelectorAll('button').forEach((b) => {
      b.disabled = resLocked || (capVideo && Number(b.dataset.tier) > 1920);
    });
    renderResHint();   // reflect the video-cap hint when destination/source changes
  }

  function renderStatus() {
    if (!statusEl) return;
    statusEl.classList.remove('status', 'error', 'success', 'busy');   // takeNote styling never leaks into other states
    if (!canArm()) { statusEl.textContent = 'load a source (or use the test pattern) to output'; statusEl.classList.remove('live'); return; }
    const s = outputBus.getStatus();
    const parts = [];
    const d = selectedDest();
    if (broadcasting) {
      // the BASE name (the destination row already carries the display's pixel
      // readout — repeating it here made "HDMI · 3840×2160 3840×3840", Daniel's
      // double-resolution confusion); named network sources append their name
      const named = d && (d.id === 'syphon' || d.id === 'ndi');
      parts.push(`◉ ${d ? d.baseLabel : 'output'}${named ? ` (${nameInput?.value || s.serverName})` : ''}`);
    }
    if (recorder?.recording) parts.push('● rec');
    if (s.testPattern) parts.push('▦ test pattern');
    if (parts.length) {
      // a self-rendering destination (the external display, the output window)
      // reports its OWN render size + GPU fps — the bus numbers describe the
      // read-back pipeline, which isn't what's on the wall
      const dims = (broadcasting && d?.sink.renderDims) || s;
      const remoteFps = broadcasting ? (d?.sink.fps || 0) : 0;
      const fps = remoteFps || s.fps;
      // SAY WHICH SURFACE THE NUMBER DESCRIBES (B565, Daniel). During a 4K HDMI broadcast this
      // line read a healthy 29-32 while the frame-cost panel read 21.6 — and BOTH were correct.
      // A self-rendering external view draws from the frame socket on its own clock, so it can
      // legitimately outrun the app's editor loop; they are two renderers, not one number and a
      // lie. **But a bare "fps" in the output panel reads as "the app's frame rate", and that is
      // the dishonesty** — the label was missing, not the measurement.
      //
      // So: name the remote surface, and append the app's own rate whenever it is materially
      // lower, because that gap is the thing worth noticing (the editor is struggling while the
      // wall looks fine, which is exactly the iPad's editor-surface wall).
      const appFps = Math.round(env.perf?.report?.fps || 0);
      const fpsText = remoteFps
        ? `${remoteFps} fps on display${appFps && appFps < remoteFps * 0.9 ? ` · app ${appFps}` : ''}`
        : `${fps || '…'} fps`;
      statusEl.textContent = `${parts.join(' · ')} · ${dims.width}×${dims.height} · ${fpsText}`;
      statusEl.classList.add('live');
    } else if (takeNote) {
      // the last take's fate outlives the poll loop's rewrites until something
      // real replaces it (recording again, broadcasting) — styled like every
      // other status readout (small + verdict-colored), not the big gray line
      statusEl.textContent = takeNote;
      statusEl.classList.remove('live');
      statusEl.classList.add('status', /FAILED/.test(takeNote) ? 'error' : /saved/.test(takeNote) ? 'success' : 'busy');
    } else {
      // idle: no dims echo — the resolution hint two rows up already says it
      // (the "resolution shown twice" BACKLOG item)
      statusEl.textContent = '';
      statusEl.classList.remove('live');
    }
  }

  // The bus stopped itself on a render failure (e.g. the output engine couldn't create
  // its second GL context) — tear down our side cleanly and surface the reason, so the
  // broadcast/record doesn't just die silently with the controls still lit.
  // `all` = the break-glass reset, which really does mean everything. A BUS failure does not:
  // it may only tear down what the bus was actually carrying.
  //
  // D3 (Daniel, iPad + 4K HDMI): with a self-rendering broadcast live, pressing record started
  // the bus for the recorder, the bus failed, and this stopped BOTH — killing an HDMI broadcast
  // that never touched the bus (`needsBus:false`, it renders from state in another process).
  // The display went gray while the panel still read 60fps, because the render loop genuinely
  // was healthy; only the thing being torn down was unrelated to the failure.
  function failOutput(message, all = false) {
    if (recorder?.recording) { recorder.stop(); stopRecMic(); }
    const dest = selectedDest();
    const destUsedBus = dest?.sink.needsBus !== false;
    if (broadcasting && (all || destUsedBus)) { dest?.sink.stop(); broadcasting = false; }
    wantRecord = false;
    syncBusRunning();
    if (!broadcasting) stopPolling();
    reflect();
    if (statusEl) {
      // name what actually stopped, so a surviving broadcast does not read as a dead one
      statusEl.textContent = broadcasting
        ? `recording stopped: ${message} — the broadcast is still live`
        : `output stopped: ${message}`;
      if (!broadcasting) statusEl.classList.remove('live');
    }
  }

  // Break-glass hook (env.resetSession): release ALL output cleanly — stops the recorder + broadcast,
  // which tears down the external view (its second GL context + video decoder are the iPad-HDMI
  // memory-pressure source). Callable when things are wedged, without touching the render loop.
  env.stopAllOutput = (reason) => failOutput(reason || 'output stopped', true);

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
  env.refreshOutputBand = () => { applyResolution(); renderStatus(); syncMicMeter(); };

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

  // display picker → retarget which external display presents (main places the window there
  // at the next open, so this only takes effect while NOT broadcasting — the selector is
  // disabled when live). ids are Electron numeric display ids.
  byId('hdmiDisplay')?.addEventListener('change', (e) => {
    const hdmiSink = destinations.find((d) => d.id === 'hdmi')?.sink;
    hdmiSink?.setExternalDisplay?.(Number(e.target.value));
    reflect();
  });

  env.updateOutputUI = updateOutputUI;

  reflect();
  updateOutputUI();
}
