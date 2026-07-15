# fold-stage

The engine-agnostic **stage layer** shared by the Fold family of apps (Fold — the still tool; Tap; future tenants). An app supplies two adapters and reuses everything here verbatim:

- **an engine adapter** ([src/engine-adapter.js](src/engine-adapter.js)) — THE contract between the stage and whatever renders. Universal tier (`engineId`, `renderFrameAt`) drives output windows, record-to-disk, and Syphon; the optional perform tier (`getState`/`applyState`/`tween`) unlocks program/preview and transitions. The stage knows nothing about kaleidoscopes — only this shape. Fold's implementation is `src/shell/fold-adapter.js` in the app repo.
- **a host** ([src/host.js](src/host.js)) — the native-services seam (`syphon`, `fileSystem`, `externalDisplay`, `ndi`, `nativeCamera`, …), each behind `.available` so the app degrades gracefully. `webHost` (exported here) is the browser no-op baseline; Electron and Capacitor shells inject their own.

## modules

| module | what it is |
| --- | --- |
| `fold-stage/commit-cell` | single-writer latest-value cell `{value, gen, t}` — the program-snapshot discipline's mechanism (payload-opaque; each app defines its own payload + commit points) |
| `fold-stage/engine-adapter` | the adapter contract (doc + `hasPerformTier`) |
| `fold-stage/host` | the host-services contract + `webHost` no-op baseline |
| `fold-stage/mock-host` | `mockSyphonHost` — exercises the broadcast path on plain web (`?mocksyphon`) |
| `fold-stage/ndi-sink` | NDI publish sink (via `host.ndi` — lights up when a shell embeds a real NDI sender) |
| `fold-stage/output-bus` | the live-output fan-out: renders committed frames through the engine adapter and feeds every registered sink at the negotiated cadence |
| `fold-stage/recorder` | record-to-disk sink (canvas/MediaRecorder + mp4 mux path lives app-side; this is the raw-frame sink) |
| `fold-stage/syphon-sink` | Syphon publish sink (via `host.syphon`) |
| `fold-stage/test-pattern` | the output view's connect-time test frame |

Import subpaths directly (`fold-stage/output-bus`) so each bundle stays lean; the barrel (`fold-stage`) exists for spikes and harnesses.

## status: in-repo package, pre-split

This package currently lives inside the Fold app repo at `packages/fold-stage`, consumed as a `file:` dependency — a deliberate intermediate step: a sibling-checkout dependency would break Vercel deploys and fresh clones, and publishing needs a remote/registry decision (Daniel's). **To split into its own repo:** copy this directory to a new repo (or `git subtree split --prefix packages/fold-stage`), push, then change the app's dependency to the git URL (`"fold-stage": "github:…"`) or a private registry. No import in the app changes — they already address the package by name.

Rendering note: this layer changes NO rendering. How a committed frame is *produced* is per-host (web = the double-render; iOS = the future WKWebView/Metal capture — Lane 4B); the stage only defines the contract and the fan-out.
