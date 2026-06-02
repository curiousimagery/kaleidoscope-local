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

import { wireSliderWithScrub } from '../shell/controls.js';

export function mountRangeControl(container, param, env) {
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

  label.append(row, input);
  container.appendChild(label);

  // Shared wiring: ranges/steps/fmt/parse/snap/scrub + controlsSync registration.
  wireSliderWithScrub(env, param.sliderId, param.valId, param.key, param.opts);
  return label;
}
