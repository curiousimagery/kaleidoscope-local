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
      const ok = ndi.publish(frame.pixels, frame.w, frame.h, !!frame.topDown);
      const now = performance.now();
      if (!winStart) winStart = now;
      if (ok !== false) sent++;
      if (now - winStart >= 1000) {
        fps = Math.round((sent * 10000) / (now - winStart)) / 10;
        sent = 0; winStart = now;
      }
    },
  };
}
