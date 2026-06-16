// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// shell/app.js
//
// createApp — the app-wiring MOUNT POINT (Phase 2d).
//
// The chrome (src/main.js for desktop/iPad; a future Electron/Capacitor/live shell)
// builds `env` with its engine, DOM refs, schedulers, source-overlay, and layout
// handles already attached. It then calls createApp(env, { host, capabilities }) to
// (1) thread the injectable runtime seams onto env and (2) mount the shared app
// wiring — clip editor, source host, motion runtime — in one place. Both chromes
// mount the SAME wiring through this one call, so native shells reuse it verbatim;
// they only inject their own `host` (native services) and `capabilities` (engine
// profile). This is the seam the native-wrapper work mounts against.
//
// `host` (Phase 4 — shell/host.js + webHost no-op) and `capabilities` (Phase 3 —
// kit/capabilities.js) are threaded here as injectable params. Until those phases
// land they default to null and nothing reads them yet — the seam is in place so
// the wrapper work mounts against a stable interface instead of editing back into
// the app.

import { createClipEditor } from './clip-editor.js';
import { createSourceHost } from './source-host.js';
import { createMotionRuntime } from './motion-runtime.js';

export function createApp(env, { host = null, capabilities = null } = {}) {
  // Injectable runtime seams. Native shells pass real implementations; the web
  // build leaves them null (Phase 3/4 provide a browser capability profile +
  // a no-op web host). Attached to env so any wiring module can query + degrade.
  env.host = host;
  env.capabilities = capabilities;

  // Mount the shared app wiring onto env. Each createX defines its functions and
  // hangs its public surface on env; cross-module calls are late-bound through
  // env, so the only ordering that matters is "all mounted before user input"
  // (creation does no cross-module calls). Order mirrors the dependency reading:
  // clip + source set handles motion's wiring references, motion sets handles
  // clip + source call back into.
  createClipEditor(env);     // #clipSheet trim/bounce/slice + bake
  createSourceHost(env);     // media load + camera (wires its buttons) + still export
  createMotionRuntime(env);  // motion core + timeline + filmstrip + video-export sheet

  return env;
}
