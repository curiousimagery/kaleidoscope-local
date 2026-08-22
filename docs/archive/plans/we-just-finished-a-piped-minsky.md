# SUPERSEDED (2026-07-17) — the plan now lives in the repo at `docs/PLAN.md`

This arc completed its outcome (native iPhone/iPad builds, native camera depth, HDMI/AirPlay/NDI broadcast on all three shells, conduit extracted with its own repo). Per Daniel's consolidation ask, the single prioritized plan is **`docs/PLAN.md`** (gauntlet loop → stabilization+perf → save/UX tails → conduit extraction → parked). Supporting: `docs/HANDOFF.md` (state), `docs/BACKLOG.md` (inventory), `docs/CONDUIT-ROADMAP.md` (extraction map). Do not extend this file — edit `docs/PLAN.md`. Historical arc content kept below for reference.

---

# Capacitor Arc — native iPhone / iPad builds (historical)

## Context

The live-performance spine is complete (still · motion · perform · staged transitions · video staging · control bus · mobile record video, B252–B299). This arc takes Fold native on iOS/iPadOS via Capacitor. The web app already anticipates it: `host.js` reserves the native seams, `capabilities.js` names Capacitor-WKWebView as a runtime, and the Electron wrapper proves a native shell reuses 100% of Engine/Kit/Components/Chrome behind `createApp(env, { host, capabilities })`.

**Outcome:** a repo-resident Capacitor pipeline (zero UI fork); polished iOS geometry; full-resolution camera controls with high-res still-on-pause (the highest-impact lever); HDMI/AirPlay/NDI broadcast so a phone/iPad is a **standalone activation broadcasting out** (art-installation framing); recording at named resolutions (1080p/4K/standard); native file/photo integration.

**Structure (Daniel's calls):** ONE arc, native value front-loaded, shared infrastructure + hardening tailed. Camera is the highest lever (above HDMI). Broadcast priority HDMI → AirPlay → NDI. Gating is cross-shell (native-capability vs edition/tier), a lightweight seam decided early. Work lands on branch `capacitor-arc`, one commit per verified increment.

## Status — as of B304 (2026-07-12), ON DEVICE ✅

Shipped + committed on `capacitor-arc` (8+ commits off main), and **confirmed running on device** (iPad Pro 12.9" M1 + iPhone 17 Pro build/install from Xcode; camera live on both; native save → share sheet bypasses the lost-WebGL-context bug):

- **B300** bootstrap (committed to main by Daniel) + the cross-shell `EDITION` gating seam.
- **B301 (v0.15.0)** camera-control layer (`camera.js` capabilities/controls/applyControls) + `externalDisplay`/`ndi` host seams.
- **B302 (v0.15.1)** the Capacitor host substrate (`shell/capacitor-host.js`) — native file save/share + preferences via first-party plugins; iPad save routed through it.
- **B303 (v0.15.2)** host wired into the mobile chrome → native save on the phone too.
- Info.plist camera/mic/photo usage strings (required on device).
- **B304 (v0.15.3)** on-device dev-workflow docs: `docs/DISTRIBUTION.md` ("running on a device" + signing/TestFlight/gating reference + native-plugin authoring pattern) and the UI Lab CLI cheat sheet Capacitor group.

**Verification ceiling (this environment):** no headless browser + no camera in the simulator → camera/MediaRecorder/WebGL-runtime flows are build-verifiable only; runtime verification happens on Daniel's devices (the on-device swimlane). Do NOT deep-edit the delicate mobile record path or build camera UI blind.

## Cross-cutting principles (hold)

- Native capability behind `env.host.*.available`; degrade gracefully; web keeps `webHost`.
- Gating: two axes — native capability (`host.*`) and edition/tier (`EDITION` in `capabilities.js`, default everything-on). Not a paywall; the seam.
- First-party `@capacitor/*` plugins pre-cleared; third-party/native SDKs (e.g. NDI) ask first.
- Standing maintenance (version/changelog/handoff/backlog) per shippable increment.

## Lanes forward

### Lane 1 — On-device testing swimlane (Daniel-driven, Claude supports)

Daniel runs builds from Xcode on his devices (primary: iPad Pro 12.9" + iPhone 17 Pro; smaller form factors later in polish mode). Claude supplies diagnostics + fixes. Workflow durable in `DISTRIBUTION.md`. TestFlight (over-the-air, no 7-day expiry, external testers) unlocks with the $99 account.

### Lane 2 — Camera (highest lever): spike → UX → native

Sequenced per "cheap first, then spike," and camera access is platform/iOS-version-specific so **map it before designing UX**:

1. **Capability spike (NEXT, cheap):** a `getCapabilities()`/`getSettings()` diagnostic log so Daniel's next device run (via Safari Web Inspector) reveals exactly what iOS WKWebView exposes (zoom/torch/focus + ranges). The `camera.js` layer already surfaces these.
2. **Cheap-path gear UX:** a camera-settings gear consuming the layer, showing only controls the platform reports. Built WITH device feedback (don't build the popover blind).
3. **Native camera plugin (`host.nativeCamera`):** EV/WB/lens-select + full-res still-on-pause (AVCapturePhotoOutput) — the part getUserMedia can't reach. Rides the frame-bridge (Lane 4/B). Co-implemented on device.

### Lane 3 — Broadcast: HDMI → AirPlay → NDI

- **HDMI (`host.externalDisplay`, top priority):** the plugin shell (UIScreen notifications + a second UIWindow) is straightforward; the REAL question is frame delivery. A second WKWebView loading `output.html` will NOT work — `BroadcastChannel` doesn't cross WKWebViews. Answer: the external view renders from a committed STATE STREAM (reuse `src/output-view.js`'s render-from-state), not a captured frame. Cheap, no readback, no second capture. Depends on Lane 4/A (immutable snapshots) for the state stream.
- **AirPlay (broadcast #2): SHIPPED B346** — rides the external-display path (an AirPlay screen raises the same UIScreen.didConnect; overscan compensation + 'display' copy added). The web spike is superseded (BACKLOG someday-note). Device-pending: Apple TV pass.
- **NDI (broadcast #3): app side SHIPPED B347** (fold-stage/ndi-sink + destination row + wiring, all behind host.ndi.available — inert until a sender exists). GATED: the Vizrt NDI SDK is Daniel's registration/license/download. Greenlight → Electron sender first, then a fold-ndi Capacitor plugin (frame egress measured; frame-socket-reversed as fallback). Plan in BACKLOG.

### Lane 4 — The stage/ package: A → B → C (the architectural thread)

Prompted by the readPixels/double-render history. The current double-render is a workaround with three real costs (a full second render/frame; Apple-Silicon-specific; a two-loop shared-state bug class that worsens as real-time DSP/OSC inputs write into render state). Fable's discipline + the native path address it. **A must precede B and C** (extracting or capturing a racy contract just propagates the bug).

- **A — DISCIPLINE (do first, in Fold; Claude writes the seam-change proposal for Daniel's approval BEFORE implementing).** Turn the program-state seam (`programState()` and the `stage/` engine-adapter contract) into an **immutable, timestamped snapshot published by a single writer at a defined commit point**; every consumer (preview loop, capture loop, output window, future native capture) reads committed frames only. Replaces the one-off slice-drag lock with a rule. Cheap now, essential before more real-time inputs land. Contained refactor of an existing seam.
- **B — Fold's FUNCTIONAL WIN (native capture, per host).** The shared package is a *contract*, not a capture method; each host plugs in HOW it produces the committed frame: web = the double-render (unavoidable), iOS = WKWebView + Metal/IOSurface capture (no second render, no state race by construction), Electron = its own native capture (separate future work — NOT automatic from the iOS work). B is what actually delivers "share the canvas, no re-render," per platform. In-arc, iOS B is the NDI/HDMI-frame enabler (the frame-bridge spike), co-implemented on device.
- **C — EXTRACT to its own git repo, consumed by Fold + tap.** The "second tenant" gate is now MET (tap is a real project with a consumer lined up), so extraction is justified (not speculative). Pull `stage/` + `shell/host.js` into a standalone repo (private npm/git dependency), consume from Fold, then tap. Do it as a **dedicated session** right after A, parallel to the Capacitor device work so it doesn't crowd the arc. C alone changes NO rendering — it's the sharing mechanism; A makes it sound, B is the perf.

**Sequencing:** A first (in Fold) → C → B rides the Capacitor arc as the iOS native-capture / NDI path. A SHIPPED B330; **C SHIPPED B345** — the `fold-stage` package at `packages/fold-stage` (stage/ + host.js + commit-cell; consumed by name via file: dependency; the repo split to its own remote = Daniel's naming/home decision, then one dependency-line change). B remains (the iOS Metal/IOSurface capture — now also the NDI-egress enabler).

### Lane 5 — Tail / device-pending (documented in DISTRIBUTION.md)

Record-at-named-resolution mobile integration (delicate record path — desktop already records at the output-bus resolution; mobile is the gap; device-verify), iOS landscape safe-area polish (headless sim rotation blocked), distribution/store prep + the edition gating map (positioning-gated, D1).

## Critical files & seams

- Bootstrap: `capacitor.config.json`, committed `ios/` (SPM), `npm run cap:sync`/`ios`.
- Seams: `shell/host.js` (`externalDisplay`/`ndi` added; `nativeCamera`/`fileSystem` wired), `kit/capabilities.js` (`EDITION`/`isNative`), `shell/capacitor-host.js`.
- Reuse: `output.html`+`src/output-view.js`+`stage/output-bus.js` (broadcast/state-stream), `shell/output-engine.js` (offscreen render pattern), `stage/recorder.js`, `shell/camera.js`.
- Native plugins (local npm packages per the DISTRIBUTION.md pattern): external-display, native camera, NDI.

## Verification

- Web/shared: `vite build`; the record-resolution engine in a browser (when built).
- Native: `xcodebuild` BUILD SUCCEEDED + sim boot (static) here; **runtime on Daniel's devices** (Lane 1) — camera controls, external display, NDI, share-sheet save, safe-area geometry.
- Each increment ships with the four-part standing maintenance.
