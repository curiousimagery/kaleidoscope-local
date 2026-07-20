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

## tier B — native host packages — SHIPPED B377 (conduit/hosts/{capacitor-ndi, electron-ndi}, both shells build-verified)

Fold's native transports are written app-agnostically; they move to the conduit repo as optional host packages a consumer adds per shell:

- **conduit-electron** — the Syphon + NDI N-API addons, their bridges, the IPC discipline (invoke-backpressure, independent in-flight budgets), the preload host entries. Consumer wires them into its preload/main.
- **conduit-ndi-capacitor** — the fold-ndi plugin: licensed-SDK xcframework build script (binaries never committed), localhost frame socket (reversed), async double-buffered NDI send, the drain profiler, the Info.plist local-network requirements DOCUMENTED (NSLocalNetworkUsageDescription + NSBonjourServices — the silent Arena-invisible trap).

Blocked on nothing technical; sequenced after the gauntlet so what's extracted is known-good.

## who consumes conduit (terminology, settled 2026-07-18)

Fold is ONE app with three modes — Still / Motion / Perform. (Early docs called Motion and Perform the "motion shell" / "live shell" and imagined separate apps; they're modes now. Motion and Perform already broadcast through conduit.) The extraction's SOLE purpose is to generalize Fold's broadcast/capability/render infrastructure so **other consumer apps** — zoetrope, tap, future music visualizers, mini-games, mobile cameras — piggyback on it instead of rebuilding device detection, rendering, and broadcast each time. The test of "engine-agnostic" is that it works for a three.js scene and an SVG zoetrope, not just Fold's kaleidoscope engine.

## tier C — needs design before it moves (design doc: `docs/CONDUIT-TIER-C.md`)

- **External surface (iOS external display / AirPlay + desktop output window), UNIFIED — poster core SHIPPED B382.** `conduit/external-surface.js` → `createSurfacePoster({ transport, content })` now owns the shared spine (per-frame state stream, source-on-change, hello/fps handshake, arm/begin/end lifecycle, degradation ladder); Fold's `output-window.js` (BroadcastChannel+popup transport) and `external-display.js` (Capacitor plugin transport + crash-degradation + fill/frame-aspect dims) are thin adapters. Transport-neutral: render-from-state is the only shipped pattern (`output-view.js` is the reference); frame-push stays a consumer choice over the same transport with NO conduit fallback. **Remaining:** conduit-repo README/contract docs; device regression-verify (output window / iPad external display / AirPlay).
- **Device capability detection beyond output — CAPTURE DOMAIN, deferred to vNext.** DEFERRED by decision (Daniel, 2026-07-18): our immediate consumers (zoetrope, tap, visualizers) don't take camera input, and designing a capability catalog with zero camera-consumers is guessing at a contract. **When a camera-consuming app arrives**, this sibling package (input side of conduit) would carry, lifted from Fold's `native-camera.js` + `FoldNativeCameraPlugin.swift` + `yuv-renderer.js`: the per-device **camera capability catalog** (lenses incl. virtual, per-lens resolutions + max fps, still photo sizes, EV/WB/zoom ranges + lens-switchover factors, stabilization modes, focus support, Deep Fusion/quality prioritization); the **pipeline-safe fps governor** (`peakThroughput`/`safeFps` — excluding the device's peak resolution×fps combo that crashes the webview); the **still-vs-video format selection**; and the **frame-ingest path** (biplanar YUV over a localhost socket → the YUV→RGB WebGL blit). It's the mirror image of the broadcast domain (enumerate + drive a device's cameras and get frames IN, vs get composed frames OUT). Named + scoped when the first camera-consumer is real. Flagged as vNext in the design doc.

## sequencing

1. **Now**: the hardening gauntlet (recorder across engines, save-flow UX, NDI drain numbers, fast-decode verification, clip-bake two-reader adoption).
2. **Tier A** extractions (each its own contained increment; conduit repo synced per subtree push).
3. **Tier B** native packages, one shell at a time, second app onboarding as the forcing function.
4. **Tier C** design docs first, Daniel decides scope.
