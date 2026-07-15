// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// stage/mock-host.js
//
// A MOCK native host for `?mocksyphon` — lets us exercise the live-output bus's
// active/broadcasting path on plain web, with no Electron and no native module.
// Structurally identical to shell/host.js `webHost` (the reference shape a real
// host must match), but `syphon.available` is TRUE and `publish` is a counting
// no-op. So the output panel shows the broadcasting state, the resolution/name
// controls light up, fps reports, and the op ring fills — all without rendering
// anywhere. The real Syphon sink (Electron) registers against this same seam in a
// later increment; until then the mock just proves the UI + telemetry path.
//
// Self-contained on purpose (no shell import) so the stage layer stays free of
// shell dependencies. Keep it structurally in sync with webHost.

export const mockSyphonHost = {
  name: 'mock-syphon',

  syphon: {
    available: true,
    published: 0,                 // frames "published" (counted, not rendered)
    start() { this.published = 0; },
    publish(/* frame */) { this.published++; },
    stop() {},
  },

  midi: {
    available: false,
    inputs: [],
    onMessage(/* handler */) { return () => {}; },
  },

  nativeCamera: {
    available: false,
    async listDevices() { return []; },
    async setControls(/* { lens, ev, wb, focus } */) {},
  },

  fileSystem: {
    available: false,
    async save(/* blob, suggestedName */) { return null; },
    async open(/* { accept } */) { return null; },
  },
};
