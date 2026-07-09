// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/gamepad-input.js
//
// Gamepad API adapter for the control bus (pure web — DualSense / Xbox /
// Nimbus / most HID controllers; supported in every engine incl. Safari and
// Firefox). Polls in its own light rAF (the API is poll-only) and emits on
// CHANGE:
//   pad:<device>.a<i>   axes, value −1..1 (bipolar; deadzoned, 0 on release)
//   pad:<device>.b<i>   buttons, 1 on press / 0 on release (momentary)
// <device> is a slug of gp.id — STABLE across reconnects and connect order
// (gp.index is not), so saved mappings keep working. Controllers exposing the
// 'standard' mapping get human control names out of the box.

const DEADZONE = 0.15;
const slug = (name) => String(name || 'controller').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const shortName = (id) => String(id || 'controller').replace(/\s*\(.*$/, '').slice(0, 28);

// the W3C 'standard' gamepad layout — friendly defaults for learn
const STD_AXES = ['left stick x', 'left stick y', 'right stick x', 'right stick y'];
const STD_BTNS = ['a / cross', 'b / circle', 'x / square', 'y / triangle',
  'left bumper', 'right bumper', 'left trigger', 'right trigger',
  'select', 'start', 'left stick press', 'right stick press',
  'd-pad up', 'd-pad down', 'd-pad left', 'd-pad right', 'home', 'touchpad'];

export function createGamepadInput(onSignal, onDevices) {
  let running = false;
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
      const dev = slug(gp.id), name = shortName(gp.id);
      const std = gp.mapping === 'standard';
      gp.axes.forEach((raw, i) => {
        const v = Math.abs(raw) < DEADZONE ? 0 : Math.sign(raw) * (Math.abs(raw) - DEADZONE) / (1 - DEADZONE);
        emit(`pad:${dev}.a${i}`, Math.round(v * 500) / 500,
          { device: dev, deviceName: name, kind: 'stick', label: (std && STD_AXES[i]) || `axis ${i}`, bipolar: true, momentary: false });
      });
      gp.buttons.forEach((b, i) => {
        emit(`pad:${dev}.b${i}`, b.pressed ? 1 : 0,
          { device: dev, deviceName: name, kind: 'btn', label: (std && STD_BTNS[i]) || `button ${i}`, momentary: true });
      });
    }
    requestAnimationFrame(poll);
  }

  window.addEventListener('gamepadconnected', () => onDevices?.());
  window.addEventListener('gamepaddisconnected', () => onDevices?.());

  return {
    active: () => running,
    init() { if (running) return; running = true; requestAnimationFrame(poll); },
    devices() {
      const out = [];
      const padsList = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of padsList) if (gp && gp.connected) out.push({ key: slug(gp.id), name: shortName(gp.id) });
      return out;
    },
  };
}
