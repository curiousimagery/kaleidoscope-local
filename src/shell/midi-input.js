// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/midi-input.js
//
// Web MIDI adapter for the control bus (Chromium browsers + Electron; Safari/
// Firefox have no Web MIDI — the sheet's device list says so by staying empty).
// Emits normalized signals:
//   midi:<device>.cc<ch>.<num>   value 0..1            (control change)
//   midi:<device>.n<ch>.<note>   value = velocity/127   (note on/off; momentary)
// <device> is a slug of the port NAME (stable across reconnects, unlike port
// ids). sendNote() paints pad LEDs on the matching OUTPUT port (APC40 MK2:
// velocity = palette color index).

const slug = (name) => String(name || 'midi').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function createMidiInput(onSignal, onDevices) {
  let access = null;

  function wire() {
    if (!access) return;
    for (const input of access.inputs.values()) {
      input.onmidimessage = (e) => {
        const [st, d1, d2] = e.data;
        const type = st & 0xf0, ch = st & 0x0f;
        const dev = slug(input.name);
        if (type === 0xb0) {
          onSignal(`midi:${dev}.cc${ch}.${d1}`, d2 / 127, { label: `${input.name} cc${d1}`, momentary: false });
        } else if (type === 0x90 || type === 0x80) {
          const v = type === 0x80 ? 0 : d2 / 127;   // note-off (or vel 0) = release
          onSignal(`midi:${dev}.n${ch}.${d1}`, v > 0 ? 1 : 0, { label: `${input.name} pad ${d1}`, momentary: true });
        }
      };
    }
    onDevices?.();
  }

  return {
    active: () => !!access,
    async init() {
      if (access) return true;
      if (!navigator.requestMIDIAccess) return false;
      try {
        access = await navigator.requestMIDIAccess({ sysex: false });
      } catch { return false; }   // denied / unavailable — the bus stays gamepad-only
      access.onstatechange = wire;
      wire();
      return true;
    },
    devices() {
      if (!access) return [];
      const names = new Set();
      for (const i of access.inputs.values()) if (i.state === 'connected') names.add(i.name);
      return [...names];
    },
    // note-signal introspection for LED paint: midi:<device>.n<ch>.<note>
    parseNoteSig(sig) {
      const m = /^midi:([a-z0-9-]+)\.n(\d+)\.(\d+)$/.exec(sig);
      return m ? { device: m[1], ch: +m[2], note: +m[3] } : null;
    },
    sendNote(device, ch, note, vel) {
      if (!access) return;
      for (const out of access.outputs.values()) {
        if (slug(out.name) !== device || out.state !== 'connected') continue;
        try { out.send([0x90 | ch, note, vel & 0x7f]); } catch { /* port closing */ }
      }
    },
  };
}
