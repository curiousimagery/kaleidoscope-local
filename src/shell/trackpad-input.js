// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/trackpad-input.js
//
// Native trackpad adapter for the control bus (Electron shell only — the
// NSEvent monitor in the main process streams magnify/rotate deltas that
// Chromium otherwise swallows; see electron/native/trackpad). Emits DELTA
// signals — inherently relative, so mappings for this device are rel-only:
//   tp:trackpad.rotate   two-finger rotate, value = degrees/90 (a quarter
//                        turn of the fingers ≈ one full-value event; at 25%
//                        sensitivity a mapped rotation tracks ~1:1)
//   tp:trackpad.pinch    pinch, value = magnification × 2 (a full pinch
//                        sweeps ~half a mapped range at 25% sensitivity)

export function createTrackpadInput(onSignal, onDevices, host) {
  let running = false;

  return {
    supported: () => !!host?.trackpad?.available,
    active: () => running,
    init() {
      if (running || !host?.trackpad?.available) return false;
      running = true;
      host.trackpad.onGesture((ev) => {
        if (!ev) return;
        if (ev.type === 'ready') { onDevices?.(); return; }   // monitor confirmed installed
        if (ev.type === 'rotate') {
          onSignal('tp:trackpad.rotate', ev.delta / 90,
            { device: 'trackpad', deviceName: 'trackpad (native)', kind: 'gesture', label: 'two-finger rotate', momentary: false, relative: true });
        } else if (ev.type === 'magnify') {
          onSignal('tp:trackpad.pinch', ev.delta * 2,
            { device: 'trackpad', deviceName: 'trackpad (native)', kind: 'gesture', label: 'pinch', momentary: false, relative: true });
        }
      });
      onDevices?.();
      return true;
    },
    devices() { return running ? [{ key: 'trackpad', name: 'trackpad (native)' }] : []; },
  };
}
