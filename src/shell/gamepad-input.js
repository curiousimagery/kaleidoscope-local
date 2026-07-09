// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/gamepad-input.js
//
// Gamepad API adapter for the control bus (pure web — Xbox / Nimbus / most
// HID controllers, every browser). Polls in its own light rAF (the Gamepad API
// is poll-only) and emits on CHANGE:
//   pad:<index>.a<i>   axes, value −1..1 (bipolar; deadzoned, 0 on release)
//   pad:<index>.b<i>   buttons, 1 on press / 0 on release (momentary)

const DEADZONE = 0.15;

export function createGamepadInput(onSignal, onDevices) {
  let raf = 0, running = false;
  const last = new Map();   // signal → last emitted value

  function emit(sig, v, meta) {
    if (last.get(sig) === v) return;
    last.set(sig, v);
    onSignal(sig, v, meta);
  }

  function poll() {
    if (!running) return;
    const padsList = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of padsList) {
      if (!gp || !gp.connected) continue;
      gp.axes.forEach((raw, i) => {
        const v = Math.abs(raw) < DEADZONE ? 0 : Math.sign(raw) * (Math.abs(raw) - DEADZONE) / (1 - DEADZONE);
        emit(`pad:${gp.index}.a${i}`, Math.round(v * 500) / 500, { label: `${gp.id.slice(0, 24)} axis ${i}`, bipolar: true, momentary: false });
      });
      gp.buttons.forEach((b, i) => {
        emit(`pad:${gp.index}.b${i}`, b.pressed ? 1 : 0, { label: `${gp.id.slice(0, 24)} btn ${i}`, momentary: true });
      });
    }
    raf = requestAnimationFrame(poll);
  }

  window.addEventListener('gamepadconnected', () => onDevices?.());
  window.addEventListener('gamepaddisconnected', () => onDevices?.());

  return {
    active: () => running,
    init() { if (running) return; running = true; raf = requestAnimationFrame(poll); },
    devices() {
      const out = [];
      const padsList = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of padsList) if (gp && gp.connected) out.push(gp.id.slice(0, 40));
      return out;
    },
  };
}
