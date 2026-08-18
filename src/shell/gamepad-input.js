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
// <device> is derived from gp.id — STABLE across reconnects and connect order
// (gp.index is not), so saved mappings keep working. Controllers exposing the
// 'standard' mapping get human control names out of the box.
//
// ⚠️ B650 — THE DEVICE KEY IS VENDOR+PRODUCT, NOT THE RAW NAME. Daniel saved a DualSense rig
// out of Electron and loaded it into Firefox web, and nothing bound. **`gp.id` is
// browser-specific BY SPEC** and the two engines disagree about everything except the numbers:
//
//   Chromium  DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)
//   Gecko     054c-0ce6-DualSense Wireless Controller
//
// Mappings match on exact `m.sig` equality (shell/input-bus.js), so a different slug means a
// different signal name means no match — and no amount of renaming helps, because the editable
// name is a display string and the KEY was never editable. Keying on the vendor+product pair
// makes a rig portable across engines and machines by construction. When neither shape parses we
// fall back to the old slug, so an exotic controller is no worse off than it was.
const DEADZONE = 0.15;
const slug = (name) => String(name || 'controller').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const VP_PAREN = /vendor:\s*([0-9a-f]{4})\D+product:\s*([0-9a-f]{4})/i;   // Chromium / Electron
const VP_LEAD = /^([0-9a-f]{4})-([0-9a-f]{4})-/i;                        // Gecko, and WebKit HID
export function padKey(id) {
  const s = String(id || '');
  const m = VP_PAREN.exec(s) || VP_LEAD.exec(s);
  return m ? `${m[1].toLowerCase()}-${m[2].toLowerCase()}` : slug(s);
}
// Display name. Strips Chromium's parenthetical AND Gecko's leading vendor-product, so the same
// controller reads the same in both engines instead of "DualSense Wireless Controlle" in one and
// "054c-0ce6-DualSense Wireless" in the other — which is how Daniel noticed the split.
const shortName = (id) => String(id || 'controller').replace(/\s*\(.*$/, '').replace(VP_LEAD, '').slice(0, 28);

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

  // ⚠️ B650 — TWO IDENTICAL CONTROLLERS ARE MERGED, NOT RACED. Daniel, on the vendor+product key:
  // *"if they shared a device key would they both just necessarily have to use the same mapping?
  // that actually feels like a benefit that forces them to sync."* He is right that they share, and
  // **they already did** — `gp.id` carries no serial, so two DualSenses were the same slug before
  // this change too. What they did NOT do is merge: each pad emitted the same signal name with its
  // own value every frame, so `emit`'s change filter passed both and the bus saw a 60Hz alternation
  // between two controllers instead of one shared control. That is a latent bug this fixes, not a
  // cost the new key introduces.
  //
  // Merge rule, per shared key: a button is DOWN if any unit holds it, and an axis takes the
  // largest deflection by magnitude. Both mean "either controller drives it", and neither lets a
  // resting stick at 0 fight one that is being pushed.
  const agg = new Map();   // device key → { name, std, axes[], btns[] }

  function poll() {
    if (!running) return;
    const padsList = navigator.getGamepads ? navigator.getGamepads() : [];
    agg.clear();
    for (const gp of padsList) {
      if (!gp || !gp.connected) continue;
      const dev = padKey(gp.id);
      let a = agg.get(dev);
      if (!a) agg.set(dev, a = { name: shortName(gp.id), std: gp.mapping === 'standard', axes: [], btns: [] });
      gp.axes.forEach((raw, i) => {
        const v = Math.abs(raw) < DEADZONE ? 0 : Math.sign(raw) * (Math.abs(raw) - DEADZONE) / (1 - DEADZONE);
        const prev = a.axes[i];   // explicit, not `|| 0` — a first pad resting at 0 must still WRITE
        if (prev === undefined || Math.abs(v) > Math.abs(prev)) a.axes[i] = v;
      });
      gp.buttons.forEach((b, i) => { if (b.pressed) a.btns[i] = 1; else a.btns[i] ??= 0; });
    }
    for (const [dev, a] of agg) {
      const { name, std } = a;
      a.axes.forEach((v, i) => {
        emit(`pad:${dev}.a${i}`, Math.round((v || 0) * 500) / 500,
          { device: dev, deviceName: name, kind: 'stick', label: (std && STD_AXES[i]) || `axis ${i}`, bipolar: true, momentary: false });
      });
      a.btns.forEach((v, i) => {
        emit(`pad:${dev}.b${i}`, v,
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
      const out = new Map();   // dedupe: two identical controllers are ONE device row (see poll)
      const padsList = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of padsList) if (gp && gp.connected) out.set(padKey(gp.id), shortName(gp.id));
      return [...out].map(([key, name]) => ({ key, name }));
    },
    // legacy key → canonical key, for connected pads whose key CHANGED at B650. This is what lets
    // an existing rig migrate itself in place rather than silently stopping (input-bus.js). Only
    // rescues rigs saved by THIS engine — a rig exported from another browser before B650 carries a
    // slug with no vendor/product in it at all (Chromium's is truncated at 40 chars long before the
    // numbers), so there is nothing in it to match on. Re-export from the updated app instead.
    renames() {
      const out = new Map();
      const padsList = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of padsList) {
        if (!gp || !gp.connected) continue;
        const key = padKey(gp.id), old = slug(gp.id);
        if (old !== key) out.set(old, key);
      }
      return out;
    },
  };
}
