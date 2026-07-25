// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// components/param-control.js
//
// Registry-driven control renderer: builds the DOM for a declarative PARAMS
// entry and wires it via the SHARED behavior (`wireSliderWithScrub` +
// `makeScrubField` + `controlsSync` + kit snaps). The mobile chrome renders its
// settings list from this; desktop keeps its hand-authored markup this pass and
// migrates to this renderer later (see BACKLOG). Behavior is identical either
// way — only the markup authoring differs.
//
//   mountRangeControl(container, paramEntry, env) → labelElement
//
// `paramEntry` is a declarative PARAMS entry (has sliderId, valId, key, label,
// opts). `env` is the chrome's runtime container (state, scheduleRender,
// controlsSync, pushHistory?, updateUndoUI?). The built elements use the
// param's sliderId/valId so wireSliderWithScrub finds them by id, exactly as on
// desktop.

import { wireSliderWithScrub, wireLoopingSlider } from '../shell/controls.js';

function buildControlDom(container, param, inputClass) {
  const label = document.createElement('label');
  label.className = 'm-control';
  label.id = param.sliderId + 'Label';

  const row = document.createElement('div');
  row.className = 'm-control-row';
  const name = document.createElement('span');
  name.className = 'm-control-name';
  name.textContent = param.label;
  const val = document.createElement('span');
  val.className = 'm-control-val scrub';
  val.id = param.valId;
  row.append(name, val);

  const input = document.createElement('input');
  input.type = 'range';
  input.id = param.sliderId;
  if (inputClass) input.className = inputClass;

  label.append(row, input);
  container.appendChild(label);
  return label;
}

export function mountRangeControl(container, param, env) {
  const label = buildControlDom(container, param);
  // Shared wiring: ranges/steps/fmt/parse/snap/scrub + controlsSync registration.
  wireSliderWithScrub(env, param.sliderId, param.valId, param.key, param.opts);
  return label;
}

// Same DOM, wired as a LOOPING (jog) slider — for cyclic params (droste infinite zoom)
// whose thumb must circle back rather than pin at the edges. `.m-loop-slider` gets
// touch-action:none so the relative wrapping drag owns the touch (no native range fight).
export function mountLoopingControl(container, param, env) {
  const label = buildControlDom(container, param, 'm-loop-slider');
  wireLoopingSlider(env, param.sliderId, param.valId, param.key, param.opts);
  return label;
}
