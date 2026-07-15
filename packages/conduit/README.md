# conduit

Generalized **broadcast infrastructure**: committed program frames from ANY signal-producing engine — visual (Fold's kaleidoscope), audio-reactive signal processors, music visualizers, generative systems — fanned out to every destination: HDMI/external displays, output windows, Syphon, NDI, record-to-disk. An app supplies two adapters and reuses the conduit verbatim:

- **an engine adapter** ([src/engine-adapter.js](src/engine-adapter.js)) — THE contract between the conduit and whatever renders. Universal tier (`engineId`, `renderFrameAt`) drives output windows, record-to-disk, and Syphon/NDI; the optional perform tier (`getState`/`applyState`/`tween`) unlocks program/preview and transitions. The conduit knows nothing about kaleidoscopes — only this shape. Fold's implementation is `src/shell/fold-adapter.js` in the app repo.
- **a host** ([src/host.js](src/host.js)) — the native-services seam (`syphon`, `fileSystem`, `externalDisplay`, `ndi`, `nativeCamera`, …), each behind `.available` so the app degrades gracefully. `webHost` (exported here) is the browser no-op baseline; Electron and Capacitor shells inject their own.

First tenants: **Fold** (the still tool), **Tap**; the planned motion and live shells share it by construction.

## modules

| module | what it is |
| --- | --- |
| `conduit/commit-cell` | single-writer latest-value cell `{value, gen, t}` — the program-snapshot discipline's mechanism (payload-opaque; each app defines its own payload + commit points) |
| `conduit/engine-adapter` | the adapter contract (doc + `hasPerformTier`) |
| `conduit/host` | the host-services contract + `webHost` no-op baseline |
| `conduit/mock-host` | `mockSyphonHost` — exercises the broadcast path on plain web (`?mocksyphon`) |
| `conduit/ndi-sink` | NDI publish sink (via `host.ndi` — lights up when a shell embeds a real NDI sender) |
| `conduit/output-bus` | the live-output fan-out: renders committed frames through the engine adapter and feeds every registered sink at the negotiated cadence |
| `conduit/recorder` | record-to-disk sink (canvas/MediaRecorder + mp4 mux path lives app-side; this is the raw-frame sink) |
| `conduit/syphon-sink` | Syphon publish sink (via `host.syphon`) |
| `conduit/test-pattern` | the output view's connect-time test frame |

Import subpaths directly (`conduit/output-bus`) so each bundle stays lean; the barrel (`conduit`) exists for spikes and harnesses.

## the two-home model (canonical repo + embedded copy)

The canonical standalone repo is **github.com/curiousimagery/conduit** (private). Fold embeds the package at `packages/conduit` and consumes it as a `file:` dependency — deliberately, so Vercel deploys and fresh clones never need remote auth for a private git dependency. The embedded copy is the working copy; publish changes to the canonical repo with:

```sh
git subtree push --prefix packages/conduit git@github.com:curiousimagery/conduit.git main
```

Second tenants (Tap, …) consume the canonical repo directly (`"conduit": "github:curiousimagery/conduit"`; their installs authenticate as Daniel, or the repo goes public when that's decided). If the repo is ever made public or published to a registry, Fold can switch its one dependency line to match — no import changes either way. NOTE: the bare name `conduit` exists on the public npm registry (an unrelated legacy package) — if registry publishing ever happens, scope it (`@curiousimagery/conduit`) and update the dependency keys then.

Rendering note: this layer changes NO rendering. How a committed frame is *produced* is per-host (web = the double-render; iOS = the future WKWebView/Metal capture — Lane 4B); the conduit only defines the contract and the fan-out.
