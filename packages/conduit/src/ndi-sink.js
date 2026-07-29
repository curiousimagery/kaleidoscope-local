// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// stage/ndi-sink.js
//
// The NDI output sink — fans each program frame to the native host's NDI sender
// (host.ndi) so Resolume Arena / OBS / any NDI receiver on the LAN lists the app
// as a network video source, like a camera. The wireless sibling of the Syphon
// sink and structurally identical to it: engine-agnostic, armed/disarmed around
// start/stop so an idle sink stops frames at a boolean (publish is the hot path —
// on any host each forwarded frame is a ~MBs copy toward the native bridge).
//
// Only registered when host.ndi.available. NDI itself is a proprietary native
// SDK over UDP/multicast (browsers can't speak it), so `available` stays false
// until a shell embeds a real sender (Electron addon / Capacitor plugin) — the
// honesty rule: no destination appears in any picker that can't actually emit.

export function createNdiSink(host) {
  const ndi = host && host.ndi;
  let active = false;

  // DELIVERED fps — the honest number. The bus's fps counts rendered frames,
  // but a host may drop at its backpressure gate (the iPad's frame socket:
  // bus 29fps, wire 20fps — Daniel's [FoldNdi] profile). A host that returns
  // `false` from publish() declares the drop; anything else counts as sent.
  let sent = 0, winStart = 0, fps = 0;

  // ADAPTIVE PACING — Daniel's ethernet A/B proved the NDI stutter is WiFi-TRANSPORT-bound (smooth
  // on ethernet, halting on WiFi), not render/pipeline. Firing every rendered frame overruns WiFi's
  // fluctuating capacity in BURSTS (buffer fills → the host drops → visible stall). Instead we hold
  // an EVEN inter-frame GAP the wire can sustain — a steady 30 reads far smoother than a bursty 54.
  // AIMD, biased for MARGIN: a backpressure DROP (host publish() → false) widens the gap FAST
  // (congested → back off); sustained success narrows it SLOWLY (probe back toward the render rate).
  // On ethernet the gap collapses to ~0 (full rate); on WiFi it settles just under capacity so
  // delivery is smooth. Sender-agnostic (helps iPhone + iPad). All knobs TUNABLE.
  const GAP_MAX = 60;    // ms — never pace slower than ~16fps (below this NDI isn't worth it)
  const GAP_UP = 4;      // ms added per drop (fast additive increase — leave headroom for WiFi jitter)
  const GAP_DOWN = 0.5;  // ms shaved per PROBE_OK run (slow multiplicative-ish decrease → keeps margin)
  const PROBE_OK = 20;   // consecutive delivered frames before probing faster (~0.5–0.7s)
  let gap = 0, lastT = 0, okRun = 0;

  return {
    id: 'ndi',
    supported: !!(ndi && ndi.available),
    get active() { return active; },
    get fps() { return fps; },

    // Arm: bring up the native NDI sender (carrying the editable source name from
    // the output row — what receivers list on the network) and begin forwarding.
    start(name) {
      if (!ndi) return;
      ndi.start(name);
      sent = 0; winStart = 0; fps = 0;
      gap = 0; lastT = 0; okRun = 0;   // re-probe capacity each session (network may differ)
      active = true;
    },

    // Disarm: stop forwarding and tear the sender down (the source leaves the
    // network list when you're no longer live).
    stop() {
      if (!ndi) return;
      active = false;
      ndi.stop();
    },

    // Hot path. Raw RGBA straight from the bus; orientation is declared by
    // frame.topDown exactly as the Syphon bridge expects (the native side maps
    // it to NDI's line stride / flipped semantics).
    publish(frame) {
      if (!active || !ndi) return;
      const now = performance.now();
      // PACE: hold the sustainable cadence — drop this interstitial frame (Arena only ever wants
      // the FRESHEST frame, so skipping is free; the next paced tick sends the latest render).
      if (now - lastT < gap) return;
      lastT = now;
      const ok = ndi.publish(frame.pixels, frame.w, frame.h, !!frame.topDown);
      if (ok === false) {
        gap = Math.min(GAP_MAX, gap + GAP_UP);   // congested → back off
        okRun = 0;
      } else {
        sent++;
        if (++okRun >= PROBE_OK) { gap = Math.max(0, gap - GAP_DOWN); okRun = 0; }   // probe faster
      }
      if (!winStart) winStart = now;
      if (now - winStart >= 1000) {
        fps = Math.round((sent * 10000) / (now - winStart)) / 10;
        // breadcrumb: the paced fps + converged gap (0ms = full render rate / ethernet; a settled
        // positive gap = WiFi capacity found). Shows the governor working in the Xcode console.
        console.info(`[fold] NDI paced ${fps}fps · gap ${gap.toFixed(1)}ms`);
        sent = 0; winStart = now;
      }
    },
  };
}
