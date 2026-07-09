// shell/controls.js
//
// UI control wiring:
//   - makeScrubField: DAW-style numeric input (drag/wheel/click-to-edit) with
//     pointer-lock support for unbounded horizontal scrubbing.
//   - wireSliderWithScrub: pairs an HTML <input type="range"> with a scrub
//     field, both bound to the same state key.
//   - buildFormGrid: renders the form picker thumbnail strip from FORMS.
//   - setupStageDivider: the stage split's draggable divider (rAF-coalesced).
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
    // optional: snap(v) → snapped v. wraps set() so any path (slider drag,
    // scrub drag, scrub text edit) lands on a snapped value. snap can read
    // state to compute the snap step dynamically.
    snap = null,
    // optional: called after any set. side-effects can mutate other state.
    onSet = null,
  } = opts;

  const slider = document.getElementById(sliderId);
  const valEl  = document.getElementById(valId);

  slider.min = min;
  slider.max = max;
  slider.step = step;

  const get = () => state[key];
  const set = (v) => {
    state[key] = snap ? snap(v) : v;
    if (onSet) onSet();
  };

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
    // when snap is active, bounce the thumb to the snapped position.
    if (snap) slider.value = get();
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
      // form-aware sliders (segments routes to drosteArms vs state.segments)
      // need to refresh their displayed value + range after a form switch.
      env.syncControls?.();
      env.scheduleRender();
      env.updateUndoUI?.();
    };
    grid.appendChild(div);
  });
}

// show/hide slice controls based on the active form's `controls` declaration.
// 'segments' is always in the DOM (disabled when inactive); per-form controls
// (aspect, zoom, twist) are shown/hidden via display.
export function applyFormControls(env) {
  const { state } = env;
  const form = FORMS.find(f => f.id === state.form);
  if (!form) return;

  const segLabel = document.getElementById('segmentsLabel');
  const segInput = document.getElementById('segments');
  const usesSegments = form.controls.includes('segments');
  if (usesSegments) {
    segLabel.classList.remove('disabled');
    segInput.disabled = false;
  } else {
    segLabel.classList.add('disabled');
    segInput.disabled = true;
  }

  // per-form conditional sliders: [controlKey, labelElementId]
  const conditionalLabels = [
    ['aspect',      'aspectLabel'],
    ['zoom',        'zoomLabel'],
    ['spiral',      'spiralLabel'],
    ['mirror',      'mirrorLabel'],
    ['wedgeMirror', 'wedgeMirrorLabel'],
  ];
  for (const [key, labelId] of conditionalLabels) {
    const el = document.getElementById(labelId);
    if (el) el.style.display = form.controls.includes(key) ? '' : 'none';
  }
}

// ===========================================================================
// divider — the right-panel divider is GONE (Arc 2b dissolved the panel into
// the per-panel control stacks); setupStageDivider below is the one divider.
// ===========================================================================

// The STAGE divider between the sibling source/output panels (Arc 2a): drags the
// split ratio (session.stageSrcPct, a percent) via the --stage-src-pct CSS var —
// rAF-coalesced like the panel divider above. Swap mirrors the panels with
// row-reverse, so the drag direction mirrors too.
export function setupStageDivider(env) {
  const divider = document.getElementById('stageDivider');
  const split = document.getElementById('stageSplit');
  if (!divider || !split) return;
  let dragging = false, startX = 0, startPct = 32, splitW = 1, dir = 1;
  let skel = null;   // gray skeleton standing in for the (hidden, pixel-sized) preview mid-drag

  // The preview canvas is pixel-sized and can't track the CSS panels mid-drag, so it
  // hides — the SKELETON shows what size the output will land at: a gray box, fit to
  // the output panel at the frame aspect, re-fit every coalesced frame (Daniel's nit).
  function sizeSkeleton() {
    if (!skel) return;
    // measure the content WRAP (flex-basis 0 = the true free space), matching
    // resizePreviewCanvas — the whole panel includes the meta/control rows
    const panel = document.getElementById('outPanel');
    const p = panel?.querySelector('.slot-content') || panel;
    if (!p) return;
    const cw = p.clientWidth - 16, ch = p.clientHeight - 16;
    const a = env.session.frameAspect || 1;
    let w, h;
    if (cw / ch >= a) { h = Math.max(160, ch); w = h * a; }
    else { w = Math.max(160, cw); h = w / a; }
    skel.style.width = Math.round(w) + 'px';
    skel.style.height = Math.round(h) + 'px';
  }

  let pendingPct = null;
  let rafQueued = false;
  function applyPending() {
    rafQueued = false;
    if (pendingPct != null) {
      split.style.setProperty('--stage-src-pct', pendingPct + '%');
      pendingPct = null;
      sizeSkeleton();   // reading clientWidth after the var write reflects the new split
    }
  }

  function startDrag(clientX) {
    dragging = true;
    startX = clientX;
    startPct = env.session.stageSrcPct || 32;
    splitW = split.clientWidth || 1;
    dir = env.session.isSwapped ? -1 : 1;
    divider.classList.add('dragging');
    document.body.classList.add('resizing-divider');
    // display (not visibility): the hidden canvas must give up its flex space so the
    // skeleton centers where the canvas will be
    env.previewCanvas.style.display = 'none';
    const wrap = env.previewCanvas.parentElement;
    if (wrap) {
      skel = document.createElement('div');
      skel.className = 'canvas-skeleton';
      wrap.appendChild(skel);
      sizeSkeleton();
    }
    document.body.style.cursor = 'col-resize';
  }

  function moveDrag(clientX) {
    if (!dragging) return;
    const dPct = ((clientX - startX) / splitW) * 100 * dir;
    const pct = Math.round(Math.max(15, Math.min(70, startPct + dPct)) * 10) / 10;
    env.session.stageSrcPct = pct;
    pendingPct = pct;
    if (!rafQueued) { rafQueued = true; requestAnimationFrame(applyPending); }
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove('dragging');
    document.body.classList.remove('resizing-divider');
    if (skel) { skel.remove(); skel = null; }
    env.previewCanvas.style.display = 'block';
    document.body.style.cursor = '';
    requestAnimationFrame(() => env.arrangeSlots());   // refit the source box + preview to the new split
  }

  divider.addEventListener('mousedown', e => { startDrag(e.clientX); e.preventDefault(); });
  window.addEventListener('mousemove', e => moveDrag(e.clientX));
  window.addEventListener('mouseup', endDrag);

  divider.addEventListener('touchstart', e => { startDrag(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
  window.addEventListener('touchmove', e => { if (dragging) { moveDrag(e.touches[0].clientX); e.preventDefault(); } }, { passive: false });
  window.addEventListener('touchend', endDrag);
}

// The LIVE divider (perform, Arc 5): sizes the third (live) panel in the
// three-panel layout via --stage-live-pct / session.stageLivePct. It shows in
// BOTH perform layouts — in PiP it sits at the far edge, and pulling it out
// OPENS the three-panel view (Daniel's grippy way back). Dragging the panel
// below ~300px shows a hint and AUTO-DOCKS back to the PiP on release. Mirrors
// setupStageDivider's mechanics (rAF-coalesced, skeleton stand-in for the
// pixel-sized preview).
export function setupLiveDivider(env) {
  const divider = document.getElementById('liveDivider');
  const split = document.getElementById('stageSplit');
  const panel = document.getElementById('livePanel');
  const hint = document.getElementById('liveSmallHint');
  if (!divider || !split || !panel) return;
  const DOCK_PX = 300;   // narrower than this is unusable as a panel — back to the PiP
  const SNAP_PX = 24;    // within this of even staged/live sizes, lock a true 50/50 split
  let dragging = false, startX = 0, startPct = 32, splitW = 1, dir = -1;
  let contentW = 1, eqPct = 0;   // flex-basis % resolves against the CONTENT box
  let skel = null;

  function sizeSkeleton() {
    if (!skel) return;
    const p = document.getElementById('outPanel')?.querySelector('.slot-content');
    if (!p) return;
    const cw = p.clientWidth - 16, ch = p.clientHeight - 16;
    const a = env.session.frameAspect || 1;
    let w, h;
    if (cw / ch >= a) { h = Math.max(160, ch); w = h * a; }
    else { w = Math.max(160, cw); h = w / a; }
    skel.style.width = Math.round(w) + 'px';
    skel.style.height = Math.round(h) + 'px';
  }

  let pendingPct = null, rafQueued = false;
  function applyPending() {
    rafQueued = false;
    if (pendingPct != null) {
      split.style.setProperty('--stage-live-pct', pendingPct + '%');
      pendingPct = null;
      sizeSkeleton();
      if (hint) hint.hidden = panel.clientWidth >= DOCK_PX;
    }
  }

  function startDrag(clientX) {
    dragging = true;
    startX = clientX;
    splitW = split.clientWidth || 1;
    // the live panel sits on the FAR side: dragging toward the center grows it
    dir = env.session.isSwapped ? 1 : -1;
    if ((env.session.performLayout || 'pip') !== 'three') {
      // the far-edge grippy in PiP layout: pulling it out opens the panel from zero
      env.session.stageLivePct = 2;
      split.style.setProperty('--stage-live-pct', '2%');   // before the panel shows (no 32% flash)
      env.setPerformLayout?.('three');
    }
    startPct = env.session.stageLivePct || 32;
    // the 50/50 reference: the live pct at which staged and live panels are even
    // (the source pct is fixed during this drag, so it's a constant)
    const cs = getComputedStyle(split);
    contentW = splitW - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const dcs = getComputedStyle(divider);
    const divTot = 2 * (divider.offsetWidth + (parseFloat(dcs.marginLeft) || 0) + (parseFloat(dcs.marginRight) || 0));
    const srcPx = document.getElementById('srcPanel')?.offsetWidth || 0;
    eqPct = ((contentW - srcPx - divTot) / 2 / contentW) * 100;
    divider.classList.add('dragging');
    document.body.classList.add('resizing-divider');
    env.previewCanvas.style.display = 'none';
    const wrap = env.previewCanvas.parentElement;
    if (wrap) {
      skel = document.createElement('div');
      skel.className = 'canvas-skeleton';
      wrap.appendChild(skel);
      sizeSkeleton();
    }
    document.body.style.cursor = 'col-resize';
  }

  function moveDrag(clientX) {
    if (!dragging) return;
    const dPct = ((clientX - startX) / splitW) * 100 * dir;
    let pct = Math.round(Math.max(2, Math.min(60, startPct + dPct)) * 10) / 10;
    // snap point (Daniel): within ~24px of even staged/live sizes, lock 50/50
    if (eqPct > 0 && Math.abs((pct - eqPct) / 100 * contentW) < SNAP_PX) {
      pct = Math.round(eqPct * 10) / 10;
    }
    env.session.stageLivePct = pct;
    pendingPct = pct;
    if (!rafQueued) { rafQueued = true; requestAnimationFrame(applyPending); }
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove('dragging');
    document.body.classList.remove('resizing-divider');
    if (skel) { skel.remove(); skel = null; }
    env.previewCanvas.style.display = 'block';
    document.body.style.cursor = '';
    if (hint) hint.hidden = true;
    if (panel.clientWidth < DOCK_PX) {
      // released unusably small — auto-dock to the PiP; the pct resets so the
      // next open lands at a usable size
      env.session.stageLivePct = 32;
      split.style.setProperty('--stage-live-pct', '32%');
      env.setPerformLayout?.('pip');
    } else {
      requestAnimationFrame(() => env.arrangeSlots());
    }
  }

  divider.addEventListener('mousedown', e => { startDrag(e.clientX); e.preventDefault(); });
  window.addEventListener('mousemove', e => moveDrag(e.clientX));
  window.addEventListener('mouseup', endDrag);

  divider.addEventListener('touchstart', e => { startDrag(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
  window.addEventListener('touchmove', e => { if (dragging) { moveDrag(e.touches[0].clientX); e.preventDefault(); } }, { passive: false });
  window.addEventListener('touchend', endDrag);
}
