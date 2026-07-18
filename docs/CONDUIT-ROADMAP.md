# conduit roadmap — what moves into the package, and when (2026-07-16)

Daniel's mandate: multiple app projects are ready to consume conduit, so the package should carry as much broadcast/output infrastructure as is technically coherent — nobody should re-solve "how do I get 30fps NDI out of a Capacitor app" or "which encoder config actually works on this device" per app. His sequencing intuition, adopted here: **harden locally first (the current gauntlet), then generalize from a healthy state.** Extraction lanes stay separate from feature work so package limitations never muddle app features.

## already in the package (engine-agnostic today)

- **output-bus** — one paced render loop, one program frame fanned to every sink, fps + diag ops.
- **engine-adapter contract** — the ONE function a consumer implements: `renderFrameAt(w, h)` → `{ pixels(RGBA), w, h, topDown, canvas?, renderMs, readMs }`.
- **commit-cell** — the single-writer committed-snapshot discipline.
- **host contract + webHost + mock-host** — named seams (`syphon` / `ndi` / `fileSystem` / `externalDisplay` / `config`), plain-web defaults.
- **sinks** — recorder (WebCodecs → mp4 with proving probes + MediaRecorder fallback + `lastResult` reporting), ndi-sink, syphon-sink, test-pattern.
- **encode.js** — codec discovery (video + audio), shared by the live recorder and Fold's offline exporter.

The handshake for a new consumer is already real: implement the adapter, pick/provide a host, `createOutputBus` + register sinks + `start()`. On plain web that's recording with zero native code.

## tier A — pure-JS moves — SHIPPED B376 (items 1 + 3; the save-transport stays app-side with the toast for now)

1. **The capture strategy** (`probe-once adaptive readback`, today in Fold's `shell/output-engine.js`): extract the probe + the three read paths + checksum validation as `conduit/capture.js`, parameterized on `{ gl, glCanvas, capCanvas }`. Fold's output-engine keeps its engine-specific render and delegates the readback. This is exactly the "detection logic no consumer should re-solve" class — the folklore-proof answer to "fastest pixels off a GL canvas on THIS device."
2. **Save transport** — the host-aware saver half of `shell/save-flow.js` (the toast/status UI stays app-side or becomes an optional component later). The `host.fileSystem` contract already lives in conduit; the transport helper belongs beside it.
3. **The FNDI frame-socket protocol** (header layout, backpressure discipline, JS-side flip) as a documented conduit module the host implementations share.

## tier B — native host packages (the real "cross the gap" work)

Fold's native transports are written app-agnostically; they move to the conduit repo as optional host packages a consumer adds per shell:

- **conduit-electron** — the Syphon + NDI N-API addons, their bridges, the IPC discipline (invoke-backpressure, independent in-flight budgets), the preload host entries. Consumer wires them into its preload/main.
- **conduit-ndi-capacitor** — the fold-ndi plugin: licensed-SDK xcframework build script (binaries never committed), localhost frame socket (reversed), async double-buffered NDI send, the drain profiler, the Info.plist local-network requirements DOCUMENTED (NSLocalNetworkUsageDescription + NSBonjourServices — the silent Arena-invisible trap).

Blocked on nothing technical; sequenced after the gauntlet so what's extracted is known-good.

## tier C — needs design before it moves

- **External display / AirPlay (iOS)**: Fold's version renders from committed STATE in a second webview (zero readback — why it flies at 4K). That render-from-state is engine-specific by nature; the conduit-able piece is the PLUMBING (UIScreen watch, window + webview management, scheme handler, hello/fps channel) with a consumer-provided view. A frame-based generic fallback is possible but re-enters the readback wall. Design decision, not a port.
- **Output window (desktop)**: same shape — plumbing generalizes, the render-from-state view is per-engine.
- **Device capability detection beyond output** (per-iPhone camera fps/format catalogs, lens matrices): that's CAPTURE domain, not broadcast — it belongs in a sibling package (Daniel names it) or an input side of conduit, decided when the second app actually needs it. Don't cram it in.

## sequencing

1. **Now**: the hardening gauntlet (recorder across engines, save-flow UX, NDI drain numbers, fast-decode verification, clip-bake two-reader adoption).
2. **Tier A** extractions (each its own contained increment; conduit repo synced per subtree push).
3. **Tier B** native packages, one shell at a time, second app onboarding as the forcing function.
4. **Tier C** design docs first, Daniel decides scope.
