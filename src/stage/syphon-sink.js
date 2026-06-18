// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// stage/syphon-sink.js
//
// The Syphon output sink — fans each program frame to the native host's Syphon
// server (host.syphon) so Resolume Arena / VDMX / any Syphon client receives Fold's
// live output. Engine-agnostic (knows nothing about kaleidoscopes): a bus sink like
// recorder.js, the difference being it pushes to a native shared texture (across the
// Electron renderer→main boundary) instead of a MediaRecorder.
//
// Gating matters because publish is the hot path and, on the Electron host, each
// forwarded frame is a ~MBs copy across the process boundary. So the sink only
// forwards while ARMED: start()/stop() arm/disarm AND bring the native Syphon
// server up/down (via the host), and publish early-returns when idle. During a
// record-only session the bus still fans frames here, but they stop at a boolean —
// no copy, no IPC. (The host's preload re-checks the armed flag too; this is the
// first gate, the one that actually saves the copy.)
//
// Only registered when host.syphon.available (the Electron shell). Plain web and the
// ?mocksyphon path that reports unavailable never see it; the broadcast control in
// the output panel is gated on the same availability.

export function createSyphonSink(host) {
  const syphon = host && host.syphon;
  let active = false;

  return {
    id: 'syphon',
    supported: !!(syphon && syphon.available),
    get active() { return active; },

    // Arm: bring up the native server (carrying the editable name from the output
    // row) and begin forwarding frames on the next bus tick.
    start(name) {
      if (!syphon) return;
      syphon.start(name);
      active = true;
    },

    // Disarm: stop forwarding and tear the native server down (so "Fold" leaves
    // Arena's source list when you're no longer live).
    stop() {
      if (!syphon) return;
      active = false;
      syphon.stop();
    },

    // Hot path. Raw bottom-up RGBA straight from the bus; the host/bridge owns
    // orientation (Syphon's flipped flag) and the process hop.
    publish(frame) {
      if (!active || !syphon) return;
      syphon.publish(frame.pixels, frame.w, frame.h);
    },
  };
}
