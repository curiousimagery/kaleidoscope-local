// shell/controls.js
//
// UI control wiring:
//   - makeScrubField: DAW-style numeric input (drag/wheel/click-to-edit) with
//     pointer-lock support for unbounded horizontal scrubbing.
//   - wireSliderWithScrub: pairs an HTML <input type="range"> with a scrub
//     field, both bound to the same state key.
//   - buildFormGrid: renders the form picker thumbnail strip from FORMS.
//   - setupDivider: draggable vertical divider with rAF-coalesced width updates.
//
// none of these reach into the engine — they only mutate state and call
// env.scheduleRender() when they need a redraw.

import { FORMS, getActiveFormIndex } from '../engine/forms/index.js';

// ===========================================================================
// scrub fields — DAW-style numeric inputs
// ===========================================================================
//
// hover: cursor becomes ew-resize. mousedown + drag past 3px threshold = scrub
// (pointer-locked so cursor never hits screen edge). mousedown + release with
// no drag = inline text edit. wheel = step. shift = fine, alt/⌘ = coarse. if
// `wrap` is set, value loops modulo wrap.

export function makeScrubField(el, opts) {
  const {
    get,
    set,
    step,
    fineStep = step / 10,
    coarseStep = step * 10,
    pxPerStep = 4,
    min = -Infinity,
    max = Infinity,
    wrap = null,
    format = (n) => String(n),
    parse = (s) => { const n = parseFloat(s); return isNaN(n) ? null : n; },
    onChange = () => {},
    onStart = null,   // optional: called once at the start of each drag/edit
    onEnd   = null,   // optional: called when the drag/edit completes
  } = opts;

  const sync = () => {
    if (el._editing) return;
    el.textContent = format(get());
  };
  el._sync = sync;
  sync();

  function activeStep(e) {
    if (e && e.shiftKey) return fineStep;
    if (e && (e.altKey || e.metaKey)) return coarseStep;
    return step;
  }

  function applyValue(v) {
    if (wrap != null) {
      v = ((v % wrap) + wrap) % wrap;
    } else {
      if (v < min) v = min;
      if (v > max) v = max;
    }
    set(v);
    sync();
    onChange();
  }

  let dragState = null;

  function endDrag(commitClick) {
    if (!dragState) return;
    const wasDragged = dragState.moved;
    el.classList.remove('scrubbing');
    if (!dragState.isTouch && document.pointerLockElement === el) {
      document.exitPointerLock();
    }
    dragState = null;
    if (commitClick && !wasDragged) {
      enterEdit();
    }
  }

  function onPointerDown(e) {
    if (el._editing) return;
    onStart?.();
    const isTouch = !!e.touches;
    if (isTouch) {
      dragState = { isTouch: true, startVal: get(), startX: e.touches[0].clientX, moved: false };
    } else {
      dragState = { isTouch: false, startVal: get(), accumulatedDx: 0, moved: false };
    }
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragState) return;

    let dx;
    if (dragState.isTouch) {
      dx = e.touches[0].clientX - dragState.startX;
    } else if (document.pointerLockElement === el) {
      dragState.accumulatedDx += e.movementX || 0;
      dx = dragState.accumulatedDx;
    } else {
      if (dragState.startX == null) dragState.startX = e.clientX;
      dx = e.clientX - dragState.startX;
    }

    if (!dragState.moved && Math.abs(dx) < 3) return;

    if (!dragState.moved) {
      dragState.moved = true;
      el.classList.add('scrubbing');
      if (!dragState.isTouch && el.requestPointerLock) {
        try {
          dragState.accumulatedDx = dx;
          el.requestPointerLock();
        } catch (_) { /* unsupported or denied */ }
      }
    }

    const stepSize = activeStep(e);
    const newVal = dragState.startVal + (dx / pxPerStep) * stepSize;
    applyValue(newVal);
    e.preventDefault();
  }

  function onPointerUp() {
    endDrag(true);
    onEnd?.();
  }

  function onPointerLockChange() {
    if (dragState && !dragState.isTouch && document.pointerLockElement !== el) {
      endDrag(false);
    }
  }
  document.addEventListener('pointerlockchange', onPointerLockChange);

  function onWheel(e) {
    if (el._editing) return;
    e.preventDefault();
    const stepSize = activeStep(e);
    const newVal = get() + (e.deltaY < 0 ? stepSize : -stepSize);
    applyValue(newVal);
  }

  function enterEdit() {
    if (el._editing) return;
    const isTouch = matchMedia('(hover: none)').matches;
    if (isTouch) {
      const raw = prompt('value:', formatRaw(get()));
      if (raw != null) {
        const n = parse(raw);
        if (n != null) applyValue(n);
      }
      return;
    }
    el._editing = true;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'scrub-input';
    input.value = formatRaw(get());
    el._origText = el.textContent;
    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.select();

    function commit() {
      const n = parse(input.value);
      cleanup();
      if (n != null) applyValue(n);
      else sync();
    }
    function cancel() {
      cleanup();
      sync();
    }
    function cleanup() {
      el._editing = false;
      el.removeChild(input);
    }
    input.addEventListener('keydown', (ke) => {
      if (ke.key === 'Enter') { ke.preventDefault(); commit(); }
      else if (ke.key === 'Escape') { ke.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
  }

  function formatRaw(v) {
    return String(Math.round(v * 1000) / 1000);
  }

  el.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);
  el.addEventListener('touchstart', onPointerDown, { passive: false });
  window.addEventListener('touchmove', onPointerMove, { passive: false });
  window.addEventListener('touchend', onPointerUp);
  el.addEventListener('wheel', onWheel, { passive: false });

  return { sync };
}

// ===========================================================================
// slider + scrub combos
// ===========================================================================

// registry of UI control syncers — each wireSliderWithScrub registers its
// syncAll function here. direct-manipulation drag handlers call this after
// mutating state so the UI stays consistent.
export function makeControlsSync() {
  const syncers = [];
  return {
    register(fn) { syncers.push(fn); },
    syncAll() { for (const fn of syncers) fn(); },
  };
}

export function wireSliderWithScrub(env, sliderId, valId, key, opts) {
  const { state, scheduleRender, controlsSync } = env;
  const {
    min, max, step, scrubStep = step, fmt,
    parse = (s) => { const n = parseFloat(s); return isNaN(n) ? null : n; },
    wrap = null,
  } = opts;

  const slider = document.getElementById(sliderId);
  const valEl  = document.getElementById(valId);

  slider.min = min;
  slider.max = max;
  slider.step = step;

  const get = () => state[key];
  const set = (v) => { state[key] = v; };

  function syncAll() {
    valEl.textContent = fmt(get());
    const sliderVal = wrap != null ? ((get() % wrap) + wrap) % wrap : get();
    slider.value = sliderVal;
  }

  // Push history at the start of a native-slider drag (fires before any input events).
  let sliderPushed = false;
  slider.addEventListener('mousedown', () => { sliderPushed = false; });
  slider.addEventListener('input', () => {
    if (!sliderPushed) { env.pushHistory?.(); sliderPushed = true; }
    set(parseFloat(slider.value));
    valEl.textContent = fmt(get());
    scheduleRender();
  });
  slider.addEventListener('touchstart', () => { env.pushHistory?.(); }, { passive: true });
  slider.addEventListener('mouseup',  () => env.updateUndoUI?.());
  slider.addEventListener('touchend', () => env.updateUndoUI?.());

  makeScrubField(valEl, {
    get, set,
    step: scrubStep,
    min: wrap != null ? -Infinity : min,
    max: wrap != null ? Infinity : max,
    wrap,
    format: fmt,
    parse,
    onStart: () => env.pushHistory?.(),
    onEnd:   () => env.updateUndoUI?.(),
    onChange: () => {
      const sliderVal = wrap != null ? ((get() % wrap) + wrap) % wrap : get();
      slider.value = sliderVal;
      scheduleRender();
    },
  });

  syncAll();
  controlsSync.register(syncAll);
  return { syncAll };
}

// ===========================================================================
// form picker
// ===========================================================================

// build the form-picker thumbnail strip. each form contributes its own SVG.
export function buildFormGrid(env) {
  const grid = document.getElementById('formGrid');
  grid.innerHTML = '';
  FORMS.forEach((form, i) => {
    const div = document.createElement('div');
    const isActive = form.id === env.state.form;
    div.className = 'form-thumb' + (isActive ? ' active' : '');
    div.innerHTML = form.thumbnail;
    div.title = form.label;
    div.dataset.formId = form.id;
    div.onclick = () => {
      env.pushHistory?.();
      env.state.form = form.id;
      grid.querySelectorAll('.form-thumb').forEach(el => {
        el.classList.toggle('active', el.dataset.formId === form.id);
      });
      env.applyFormControls();
      env.scheduleRender();
      env.updateUndoUI?.();
    };
    grid.appendChild(div);
  });
}

// show/hide slice controls based on the active form's `controls` declaration.
// 'segments' control is always present in the DOM but disabled when not
// applicable; 'aspect' control is shown/hidden.
export function applyFormControls(env) {
  const { state } = env;
  const form = FORMS.find(f => f.id === state.form);
  if (!form) return;

  const segLabel = document.getElementById('segmentsLabel');
  const segInput = document.getElementById('segments');
  const aspectLabel = document.getElementById('aspectLabel');

  const usesSegments = form.controls.includes('segments');
  if (usesSegments) {
    segLabel.classList.remove('disabled');
    segInput.disabled = false;
  } else {
    segLabel.classList.add('disabled');
    segInput.disabled = true;
  }
  aspectLabel.style.display = form.controls.includes('aspect') ? '' : 'none';
}

// ===========================================================================
// divider
// ===========================================================================

export function setupDivider(env) {
  const divider = document.getElementById('divider');
  const panel = document.getElementById('rightPanel');
  let dragging = false;
  let startX, startW;

  // rAF-coalesced width updates — at most one panel.style.width write per frame
  // regardless of event rate.
  let pendingW = null;
  let widthRafQueued = false;
  function applyPendingWidth() {
    widthRafQueued = false;
    if (pendingW != null) {
      panel.style.width = pendingW + 'px';
      pendingW = null;
    }
  }

  function startDrag(clientX) {
    dragging = true;
    startX = clientX;
    startW = panel.clientWidth;
    divider.classList.add('dragging');
    document.body.classList.add('resizing-divider');
    env.previewCanvas.style.visibility = 'hidden';
    if (env.miniCanvas) env.miniCanvas.style.visibility = 'hidden';
    document.body.style.cursor = 'col-resize';
  }

  function moveDrag(clientX) {
    if (!dragging) return;
    const dx = startX - clientX;
    const upper = Math.min(window.innerWidth * 0.5, 1600);
    pendingW = Math.max(280, Math.min(upper, startW + dx));
    if (!widthRafQueued) {
      widthRafQueued = true;
      requestAnimationFrame(applyPendingWidth);
    }
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove('dragging');
    document.body.classList.remove('resizing-divider');
    env.previewCanvas.style.visibility = '';
    if (env.miniCanvas) env.miniCanvas.style.visibility = '';
    document.body.style.cursor = '';
    requestAnimationFrame(() => {
      env.resizePreviewCanvas();
      if (env.session.isSwapped) {
        env.arrangeSlots();
      } else {
        env.scheduleOverlayDraw();
      }
    });
  }

  divider.addEventListener('mousedown', e => { startDrag(e.clientX); e.preventDefault(); });
  window.addEventListener('mousemove', e => moveDrag(e.clientX));
  window.addEventListener('mouseup', endDrag);

  divider.addEventListener('touchstart', e => { startDrag(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
  window.addEventListener('touchmove', e => { if (dragging) { moveDrag(e.touches[0].clientX); e.preventDefault(); } }, { passive: false });
  window.addEventListener('touchend', endDrag);
}
