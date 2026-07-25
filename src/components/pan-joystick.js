// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// components/pan-joystick.js
//
// A VELOCITY joystick for 2D canvas translation (TILING PAN — repeating-movements ②). Push
// the handle from center → the pattern pans that way while held (speed = push distance);
// release → the handle springs back to center and motion STOPS. A separate POSITION DOT shows
// where you are within the tile (offset mod the form's lattice period), wrapping pacman.
// A recenter button zeros the offset.
//
// Offset is stored UNWRAPPED (canvasOffsetX/Y; the shader wraps it), so this simply integrates
// velocity into the offset each frame while held. Self-contained DOM component; the caller owns
// placement and (form-)gating. Mirrors the wiring shape of the other controls (pushHistory /
// controlsSync). createPanJoystick(env, opts) → { root, syncAll }.

const SPEED = 1.6;   // offset units / second at full deflection

export function createPanJoystick(env, opts = {}) {
  const { keyX = 'canvasOffsetX', keyY = 'canvasOffsetY', periodOf = () => null, speed = SPEED } = opts;
  const { state, scheduleRender, controlsSync } = env;

  const root = document.createElement('div');
  root.className = 'pan-joy-row';
  root.id = 'panJoyRow';
  root.innerHTML = `
    <div class="row"><span>pan</span><button type="button" class="pan-joy-recenter">recenter</button></div>
    <div class="pan-joy">
      <div class="pan-joy-origin"></div>
      <div class="pan-joy-dot"></div>
      <div class="pan-joy-handle"></div>
    </div>`;
  const pad     = root.querySelector('.pan-joy');
  const handle  = root.querySelector('.pan-joy-handle');
  const dot     = root.querySelector('.pan-joy-dot');
  const recenter = root.querySelector('.pan-joy-recenter');

  // handle deflection, normalized to a unit disc (0 = centered = no motion).
  let hx = 0, hy = 0, dragging = false, raf = 0, lastT = 0;
  const radius = () => pad.getBoundingClientRect().width / 2 || 1;

  function setHandle(nx, ny) {
    const mag = Math.hypot(nx, ny);
    if (mag > 1) { nx /= mag; ny /= mag; }          // circular clamp
    hx = nx; hy = ny;
    handle.style.transform = `translate(${hx * radius()}px, ${hy * radius()}px)`;
  }
  function centerHandle() { hx = 0; hy = 0; handle.style.transform = 'translate(0,0)'; }

  // dot = offset mod period, mapped so offset 0 → CENTER (aligned with the origin marker) and
  // the far edge wraps pacman. centeredFrac ∈ [-0.5, 0.5).
  function positionDot() {
    const period = periodOf();
    if (!period) { dot.style.transform = 'translate(0,0)'; return; }
    const cf = (v, p) => (p > 0 ? ((((v / p) + 0.5) % 1) + 1) % 1 - 0.5 : 0);
    const r = radius();
    dot.style.transform = `translate(${cf(state[keyX] || 0, period[0]) * 2 * r}px, ${cf(state[keyY] || 0, period[1]) * 2 * r}px)`;
  }

  function tick(now) {
    raf = 0;
    const dt = Math.min(now - lastT, 100) / 1000;
    lastT = now;
    if (hx || hy) {
      state[keyX] = (state[keyX] || 0) + hx * speed * dt;
      state[keyY] = (state[keyY] || 0) + hy * speed * dt;
      positionDot();
      scheduleRender();
    }
    if (dragging || hx || hy) raf = requestAnimationFrame(tick);
  }
  function startTick() { if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(tick); } }

  function padVec(e) {
    const rect = pad.getBoundingClientRect();
    return [(e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2),
            (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2)];
  }

  pad.addEventListener('pointerdown', (e) => {
    dragging = true;
    pad.setPointerCapture?.(e.pointerId);
    env.pushHistory?.();
    handle.style.transition = 'none';        // follow the finger 1:1 while dragging (no lag)
    const [nx, ny] = padVec(e); setHandle(nx, ny);
    startTick();
    e.preventDefault();
  });
  pad.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const [nx, ny] = padVec(e); setHandle(nx, ny);
    e.preventDefault();
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    pad.releasePointerCapture?.(e.pointerId);
    handle.style.transition = '';  // re-enable the CSS spring, then recenter → it eases home
    centerHandle();                // hx/hy = 0 → motion stops immediately
    env.updateUndoUI?.();
  };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);

  recenter.addEventListener('click', () => {
    env.pushHistory?.();
    state[keyX] = 0; state[keyY] = 0;
    positionDot(); scheduleRender(); env.updateUndoUI?.();
  });

  function syncAll() { positionDot(); }
  syncAll();
  controlsSync?.register(syncAll);
  return { root, syncAll };
}
