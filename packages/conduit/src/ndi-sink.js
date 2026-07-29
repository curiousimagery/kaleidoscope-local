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

  // FIXED-CADENCE PACING — Daniel's ethernet A/B proved the NDI stutter is WiFi-TRANSPORT-bound
  // (smooth on ethernet, halting on WiFi), not render/pipeline. The B471 AIMD attempt was a NO-OP:
  // the native send is async (NDIlib_send_send_video_async_v2) and never blocks — Daniel's [FoldNdi]
  // profile shows send-wait 0.0ms — so host.publish() never returns false, the drop signal AIMD
  // needed. JS also can't SEE the WiFi backpressure: it happens on the far side of the NDI SDK, past
  // a localhost socket that never fills. Reactive pacing had nothing to react to.
  //
  // The real lever is an HONEST, EVEN cadence that MATCHES what the sender DECLARES. Both native
  // hosts declare 30fps (frame_rate 30000/1000) while we were feeding ~40–60 — a receiver told 30
  // and fed 40 fights its own frame-sync clock; ethernet's abundant bandwidth + low jitter masks it,
  // WiFi's jitter compounds it into visible stutter. Pacing to a steady target that matches the
  // declaration gives NDI exactly what it expects: even frames, aligned timecodes, bandwidth that
  // fits WiFi. Sender-agnostic (helps iPhone + iPad + Electron). `?ndifps=N` tunes it for diagnosis:
  // if a lower target proportionally smooths WiFi it's BANDWIDTH-bound; if it doesn't it's
  // latency/jitter (WiFi power-save) and the fix is wired/receiver-side. Default 30 = the native
  // declaration (other values want the native frame_rate updated to match for a fully clean stream).
  const TARGET_FPS = (() => {
    const q = typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('ndifps')) : NaN;
    return q >= 1 && q <= 120 ? q : 30;
  })();
  const MIN_GAP = 1000 / TARGET_FPS;   // ms between sends — evenly decimates a faster render to the target
  let nextT = 0;                       // performance.now() time the next paced send is due

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
      nextT = 0;                       // first publish resyncs the schedule to the current clock
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
      // PACE to the target cadence — before the next scheduled send, drop this interstitial frame
      // (Arena only ever wants the FRESHEST frame, so skipping is free; the next tick sends the
      // latest render). An even 30 reads far smoother over WiFi than a bursty 40 the receiver was
      // never told to expect.
      if (now < nextT) return;
      nextT += MIN_GAP;
      if (nextT < now) nextT = now + MIN_GAP;   // fell a period behind (source hiccup / first frame) → resync, no catch-up burst
      ndi.publish(frame.pixels, frame.w, frame.h, !!frame.topDown);
      sent++;
      if (!winStart) winStart = now;
      if (now - winStart >= 1000) {
        fps = Math.round((sent * 10000) / (now - winStart)) / 10;
        // breadcrumb: the paced delivery fps against the target — should sit at ~TARGET_FPS on any
        // link. If WiFi still stutters at a steady 30, it's latency/jitter, not rate (try ?ndifps=24).
        console.info(`[fold] NDI paced ${fps}fps (target ${TARGET_FPS})`);
        sent = 0; winStart = now;
      }
    },
  };
}
