# architecture

## one-paragraph summary

The kaleidoscope is a Vite-based static web app (plain vanilla JS + GLSL, no TypeScript/build steps beyond Vite). Its engine is a WebGL2 fragment shader composed at startup from a registry of self-contained "form" modules — each module declares its own GLSL math, JS-side polygon math, per-form uniforms, slice controls, file code, and thumbnail. Adding a new symmetry pattern is one new file plus one line in the registry. The engine is source-agnostic (still image, live camera, or video file all feed `setSource`) and DOM-agnostic. On top of it sit, in layers, a **Kit** (DOM-agnostic primitives: state, tween/keyframes, snaps, params, history), reusable **Components** (source-overlay, output-gestures, param-control), and a per-device **Chrome** (desktop `main.js` or mobile `chrome.js`, selected by `boot.js`). It now does still-image editing, multi-keyframe motion animation, live-camera input, and source-VIDEO animation with a frame-accurate MP4 exporter, a navigable timeline, and a pre-animation clip editor.

## directory map

```
src/
├── boot.js                  chrome selection (phone → mobile/chrome.js; else desktop main.js; ?chrome= override)
├── main.js                  DESKTOP chrome + the app wiring — owns the env runtime container, the motion
│                            timeline, video source/scrub/playback, the clip editor, export wiring (large file)
├── version.js               VERSION + monotonic BUILD counter, footer string
├── lab.js                   UI Lab renderer — design-system gallery (tokens read live + core controls); /lab.html entry
│
├── engine/                  pure rendering — knows nothing about DOM or controls; source-agnostic
│   ├── index.js             public API: createEngine, setSource/updateSourceFrame, render, exportAt/exportFrame,
│   │                        exportFrameRaw (raw bottom-up RGBA from the FBO, for the live-output bus),
│   │                        beginCapture/captureFrame/captureFrameGL/endCapture (video-export frame path)
│   ├── gl.js                WebGL2 plumbing — context, program, uniforms, FBO probe + export, texture upload
│   ├── shader-builder.js    composes the fragment shader from the forms registry
│   ├── geometry.js          pure JS-side geometric math (mirrors of shader transforms)
│   └── forms/               REGISTRY OF SYMMETRY FORMS — each file is one form
│       ├── index.js         registry array + lookup helpers
│       ├── radial.js · square.js · hex.js · triangle.js · droste.js
│       └── _template.js     annotated stub for adding new forms
│
├── kit/                     DOM-agnostic primitives shared by every front-end
│   ├── tween.js             sampleKeyframes (velocity-continuous Catmull-Rom), lerpState, DISCRETE_KEYS
│   ├── capabilities.js      createCapabilities — probe-once per-engine profile (capture path, texture caps)
│   ├── op-ring.js           createOpRing — fixed-capacity ring buffer for runtime op-perf records (env.diag.ops)
│   └── snaps.js             droste arm/spiral snap points
│
├── components/              mountable UI mounted by BOTH chromes, parameterized not forked
│   ├── source-overlay.js    createSourceOverlay — draw + hit-test + proportionality/mirroring gesture math
│   ├── output-gestures.js   createOutputGestures — pinch/twist on the output
│   └── param-control.js     mountRangeControl — registry-driven slider (mobile-facing)
│
├── shell/                   host services + state + DOM helpers (used by the chromes)
│   ├── state.js             single state object + ephemeral session flags + the `motion` object (keyframes)
│   ├── params.js            declarative parameter registry (catalog of clean params)
│   ├── history.js           undo/redo over state snapshots
│   ├── controls.js          makeScrubField (DAW-style scrub), sliders, form picker, divider
│   ├── overlay.js           source-view mounting (still / camera / video) + overlay drawing
│   ├── camera.js            live-camera host module (getUserMedia, continuous render loop)
│   ├── video-source.js      pToMediaSec / seekVideoTo — the seek-based frame seam for video timeline binding
│   ├── video-export.js      exportVideo (WebCodecs VideoEncoder → mp4-muxer), pickVideoCodec (H.264/HEVC)
│   ├── fold-adapter.js      createFoldAdapter — Fold's implementation of the conduit engine-adapter contract
│   ├── output-panel.js      createOutputPanel — the #outputBtn + #outputSheet chrome over the output bus
│   ├── diagnostics.js       FBO/encode probes, e2e render check
│   ├── zip.js               dependency-free store-only zip (export package)
│   ├── cursors.js           pre-baked rotate-cursor SVG variants
│   ├── tokens.css           DESIGN TOKENS — primitives + semantic aliases; the editable visual surface (desktop + mobile)
│   └── styles.css           desktop styles (token-driven)
│
├── desktop/                 (desktop chrome currently lives in main.js; folder reserved)
└── mobile/                  mobile chrome (touch, phone-class viewports)
    ├── chrome.js            boot/mode-detect, sticky-divider layout, tab bar, popovers, camera, save sheet
    ├── icons.js             mobile tab-bar/glyph icons
    └── styles.css           mobile styles (token-driven; shares shell/tokens.css)

docs/                        all the long-form context lives here (HANDOFF is the rolling source of truth)

packages/
└── conduit/                 THE GENERALIZED BROADCAST-INFRASTRUCTURE PACKAGE (extracted B345 as fold-stage,
                             renamed B349) — engine-adapter contract, output bus, recorder/Syphon/NDI sinks,
                             commit-cell, host contract + webHost. Zero app assumptions; canonical repo
                             github.com/curiousimagery/conduit (subtree-synced); Fold consumes the embedded
                             copy via `file:packages/conduit` so Vercel/clones never need remote auth.
```

## key principles

**State lives in one place.** All kaleidoscope parameters live in `src/shell/state.js` as a single object. The engine accepts state on every call rather than holding its own — this matches the original monolith's "single state object" architecture and is what lets the Motion and Perform modes record/replay/animate state (these were once imagined as separate "motion/live shells"; they're now modes in this app).

**The engine doesn't know about the DOM.** Engine modules can be imported and used in any context that has a canvas — including (eventually) a separate "motion" shell that animates parameters over time, or a "live" shell that's driven by MIDI/touch. The engine is reusable across those because it has no shell dependencies.

**Forms are self-contained.** Each form file in `src/engine/forms/` exports a single object with a fixed schema (see `_template.js`). The schema covers GLSL fold function, per-form uniforms, polygon for overlay, hit-testing spoke rule, controls list, file code for filenames, thumbnail SVG, optional `tilesPerDim` for resolution hint, and optional `filenameSuffix` for per-form parameters. The shader is composed at startup by reading the registry and concatenating each form's contribution.

**The `env` container threads shared state AND wiring through the app modules.** Rather than module-level globals, the chrome builds an `env` object that carries: `state`/`session`/`motion`; `engine`; key DOM refs; the **ephemeral runtime sub-objects** (`media`, `live`, `motionRT`, `clip`, `filmstrip`, `scrub`, `sched`, `sourcePreview`, `diag` — grouped runtime flags that are NOT the undoable `state`; `diag.ops` is the live-output op-perf ring buffer); the injectable **`host`/`capabilities`** seams; the **`outputBus`** (stage layer); and the **inter-module method handles** (`scheduleRender`, `syncControls`, `arrangeSlots`, `scrubVideo`, `loadImage`, `openClipEditor`, `updateOutputUI`, …). Each wiring module takes `env`, reads collaborators late-bound as `env.X()`, and hangs its own public surface back on `env` — so a function's *definition* can live in any module without breaking callers. This is what let the app wiring move out of `main.js` (Build 164–168) with no module-level mutable globals: `env` is both the shared-state container and the cross-module call seam.

## layering: Engine / Kit / Components / App-wiring / Chrome (the settled vocabulary)

The codebase is organized in reuse tiers, deliberately (this is the model the multi-app strategy rests on — see BACKLOG capability tier). The first four are device-agnostic and never rebuilt; only **Chrome** is rebuilt per device. (Build 168 split the former all-in-`main.js` layer into the thin **Chrome** + the device-agnostic **App-wiring** beneath it.)

- **Engine** (`src/engine/`) — forms, shader, gl, geometry. Pure pixels, zero DOM, source-agnostic (`setSource` accepts an HTMLImageElement, HTMLVideoElement, or canvas; `updateSourceFrame` re-uploads the current frame). Never rebuilt per device.
- **Kit** (`src/kit/`, plus `shell/state.js`, `params.js`, `history.js`) — DOM-agnostic primitives shared by every front-end: the single state schema, undo/redo, the parameter registry, droste snaps, the **tween/keyframe model** (`kit/tween.js`), and the **capability profile** (`kit/capabilities.js` — probe-once per-engine table: capture path, texture caps, Firefox cap; the home for per-platform feature locking). Plus host services (`shell/camera.js`, `shell/video-source.js`, `shell/video-export.js`, `shell/zip.js`). Grows over time; never rebuilt.
- **Components** (`src/components/`) — UI mounted by BOTH chromes, parameterized (touch-target size, etc.) not forked: `createSourceOverlay` (the expensive draw + hit-test + proportionality/mirroring gesture math — never reimplement per chrome), `createOutputGestures`, `mountRangeControl`.
- **Stage** (the `conduit` PACKAGE, `packages/conduit/` — EXTRACTED Build 345, RENAMED Build 349 (Daniel: the name communicates generalized broadcast infrastructure, not a Fold-branded tool); was `src/stage/` since Build 175) — the ENGINE-AGNOSTIC live-output layer. "One program frame, many sinks": `createOutputBus` runs a paced loop that renders ONE frame at the chosen output resolution through an **engine adapter** and fans it to registered sinks (record-to-disk, Syphon, the external/output views). The only coupling to an engine is the two-tier **engine-adapter contract** (`conduit/engine-adapter`): universal `renderFrameAt(w,h) → Frame` (every engine), perform-tier `getState/applyState/tween` (engines with addressable state). The stage knows NOTHING about kaleidoscopes — a second tenant (Tap, a zoetrope builder, an audio-viz) supplies its own adapter and reuses the stage verbatim; the second-tenant gate that justified extraction is met (Tap). The package also owns `commit-cell` (the program-snapshot mechanism, payload-opaque) and the **host-services contract** (`conduit/host`, with the `webHost` no-op baseline). It lives in-repo as a `file:packages/conduit` dependency (Vercel-safe, offline-safe); its CANONICAL standalone repo is github.com/curiousimagery/conduit (private), synced via `git subtree push --prefix packages/conduit conduit main` — second tenants consume the repo, Fold keeps the embedded copy. Fold's adapter is `shell/fold-adapter.js` (app-side, so the package stays Fold-free), and Fold's chrome over the bus is `shell/output-panel.js` (the `#outputBtn` + `#outputSheet`).
- **App wiring** (`src/shell/app.js` + `clip-editor.js` + `source-host.js` + `motion-runtime.js`) — the device-agnostic application logic that sits *beneath* the chrome: `createSourceHost` (media load + live camera + still export), `createClipEditor` (the trim/bounce/slice sheet + bake), `createMotionRuntime` (sampling/playback/keyframes/timeline/filmstrip/scrub/retime/video-export sheet). Each is a `createX(env)` that mounts onto `env`; `createApp(env, { host, capabilities })` mounts all three in one call and threads the injectable native seams. A chrome builds `env` (engine + DOM + schedulers + layout handles) then calls `createApp` — so each chrome (desktop, mobile, Electron) mounts the SAME wiring without forking it. (Extracted from `main.js` in Build 164–168; before that it was one ~2,600-line file.)
- **Chrome** (`src/main.js` = desktop/iPad; `src/mobile/chrome.js` = phone) — *only* layout/divider/tab-bar/slots/control-wiring/undo + the engine+env+overlay construction; the app wiring above is mounted via `createApp`. The only layer genuinely rebuilt per device. `src/boot.js` picks the chrome (phone → mobile, else desktop; `?chrome=` override). **iPad stays on the desktop chrome** (it hosts the keyframe/timeline editor, which is desktop/iPad-only). (The phone chrome `mobile/chrome.js` has its own lighter wiring and does not yet mount `createApp` — a future convergence.)

**Design system** (`src/shell/tokens.css` + the UI Lab at `lab.html`/`src/lab.js`, added Builds 205-208) is a cross-cutting CSS-custom-property layer, NOT a reuse tier. Two tiers: raw `--c-*` PRIMITIVES (neutral ramp + accents + type/radii/spacing scales) feed SEMANTIC aliases (`--bg`/`--surface`/`--text-dim`/`--accent`/`--ok`/`--danger`/`--touch-target`/…). Defined once in `tokens.css` (linked in `index.html` before the chrome styles, so it reaches desktop AND mobile via the shared `<head>` that boot.js leaves intact) and consumed by both `shell/styles.css` and `mobile/styles.css`. Edit a semantic token once and every consumer (both chromes plus the Lab) moves together. The **UI Lab** (`/lab.html`) renders every token live via `getComputedStyle` plus the core controls in their states: the shared visual reference, and the "edit once" proof. The full token map, the working loop, and the responsive/touch-target rules live in `DESIGN.md`.

**Why this matters for native (a recurring question):** because the Engine + Kit + Components are the bulk of the app and are device-agnostic, a NATIVE wrapper (Electron on macOS, Capacitor/WKWebView on iOS) reuses 100% of this code — it adds only a thin native shell + native modules (Syphon, camera). A wrapper does NOT fork the UI/IxD; only a full SwiftUI+Metal rewrite would, and that is not required for Syphon/camera. So the single web codebase stays the source of truth; native is a shell. (See HANDOFF + BACKLOG for the Electron-Syphon-spike plan.)

**The mount seam is in place (Builds 164–170).** A wrapper reuses the web app and calls `createApp(env, { host, capabilities })`, injecting its own **host services** (the `conduit/host` interface — `syphon`/`midi`/`nativeCamera`/`fileSystem`/`externalDisplay`/`ndi`; the web build passes `webHost`, a no-op that reports everything unavailable; moved into the conduit package in Build 345) and **capability profile** (`kit/capabilities.js`). The app queries (`env.host.syphon.available`, `env.capabilities.capturePath`) and degrades — it never assumes a native capability or re-sniffs the engine inline. So native-capability work implements the host interface per shell (`shell/capacitor-host.js`, Electron's injected `window.foldHost`) instead of editing back into the app.

## motion: keyframes, tween, the timeline

State for animation lives in `motion` (in `shell/state.js`): `keyframes: [{ t: 0..1, snap, thumb, anchored }]`, `durationMs`, `loop`, `smoothing`, `playing`, `playhead`, `selected`, `videoSpeed`. A **keyframe's `snap` is a full state snapshot** — the universal currency that also powers undo and (future) live-transition tweening.

- `kit/tween.js` `sampleKeyframes(list, p, {smoothing, loop})` is velocity-continuous Catmull-Rom: motion flows THROUGH keyframes (no per-keyframe stutter), loop-aware (periodic seam), angle-unwrapped. `DISCRETE_KEYS` (form, segments, arms, mirror toggles, oobMode) don't interpolate — they lock to keyframe 0. `smoothing` (0..1) Laplacian-relaxes jaggy interior keyframe values.
- In `main.js`: `sampleAt(p)` = the interpolated state at p (discrete locked to kf0); `addKeyframe` (context-aware: a selected keyframe → auto-spaced in-between capturing the INTERPOLATED value; nothing selected → anchored at the scrubber); `applyAutoSpacing` (non-anchored keyframes even-space between anchors); the **timeline view transform** below.
- **Timeline view transform (zoom/pan/fit):** ephemeral `session.timelineZoom`/`timelinePan`. Markers + ruler are positioned by ZOOM only (`zPct`) and PANNED via a CSS layer transform (`applyPan` on `#mfMarkers`/`#mfRuler`/`#mfStrip`), so following the playhead / two-finger scroll just slides a transform — no per-frame DOM rebuild. The playhead lives in the track itself (absolute, via `tToPct`). `relayoutTimeline` (rebuild) is only for zoom/structural changes; pan-only uses `applyPan`. The tween-strip band is a row of aspect-locked square `.mf-cell` thumbnails covering the visible window (rebuilt debounced, seek-per-cell for video).

## video as a source: the seek-based frame seam

The engine is already video-capable (the live camera uses `setSource(<video>)`). Source-VIDEO animation binds the timeline to the clip's own time. The whole thing reduces to ONE async primitive: put the right decoded frame for normalized `p` onto the texture, then render/capture as usual.

- `shell/video-source.js`: `pToMediaSec(video, p, clip)` maps `p` → media seconds, scaled into the trim range `[clip.inT, clip.outT]`; `seekVideoTo(video, sec)` resolves on the `'seeked'` event + a safety timeout (deliberately NOT `requestVideoFrameCallback` — the occluded source `<video>` may never present to the compositor, so rVFC can hang).
- `main.js`: `advanceSourceToP(p)` = `seekVideoTo` + `updateSourceFrame`; `scrubVideo(p)` coalesces seeks (latest-wins) so dragging never floods the decoder; `startVideoPlayback` uses the `<video>` as the master clock (plays within the trim range, derives `p` from `currentTime`, samples params, renders). Params (`sampleAt`) and source-time are independent functions of `p`.
- **Browser-engine gotchas (hard-won):** desktop Safari's FBO `readPixels` returns corrupt "blue cells" → the filmstrip/thumbnails use the readback-free capture path (`beginCapture`/`captureFrame`, GL→2D `drawImage`). Per-frame `VideoFrame`-from-canvas is ~177ms on Safari (the export bottleneck) vs ~5ms elsewhere → export wraps the WebGL canvas directly on WebKit (`captureFrameGL`), 2D-canvas elsewhere (`defaultCaptureMode`). Firefox lacks rVFC, applies a 90° rotation to all videos, and is slow at seeks. Blink is still under-tested for the video path.

## video export + the clip bake

- `shell/video-export.js`: `exportVideo({ frameAt, ... })` renders frame-by-frame through WebCodecs `VideoEncoder` → mp4-muxer. `pickVideoCodec` gates resolution per codec (H.264 ≤4K, HEVC >4K where the device can encode) so the UI only offers what works. For a video source, `frameAt` is async and `await`s `advanceSourceToP` per output frame (frame-accurate). Companion "how it was made" source-preview video + motion-JSON bundle into a `.zip` (`shell/zip.js`).
- **The clip editor** (pre-animation, in `main.js`, a sheet `#clipSheet`): trim + a seamless-loop mode (trim / bounce / slice). Bounce/slice **bake** a processed clip (the seek-based `frameAt` decodes + assembles source frames → `exportVideo` → swap the baked blob in as the source). The in-editor previews are smooth: scrubber, seek-driven bounce, and a **two-video live crossfade** (a second hidden preview `<video>` plays the A-head alongside the main B-tail, alpha-blended on `#clipBlend`). Bake is seek-based (fine for short loops; a WebCodecs `VideoDecoder` + demuxer is the deferred fast path — needs a new dependency). The bake/render share the in-memory muxer → OPFS streaming is the deferred fix for 10-min/4K.

## adding a new form

1. Copy `src/engine/forms/_template.js` to a new file (e.g. `droste.js`)
2. Fill in the schema fields:
   - `id`, `label`, `fileCode` — identity + UI labels
   - `thumbnail` — 32×32 SVG with `class="stroke"` group for theming
   - `controls` — which slice controls to show: `'segments'`, `'aspect'`, etc.
   - `uniforms` — any per-form GLSL uniforms with extractor functions
   - `glsl` — the fold function as a string (function name must be `fold${Capitalized}`)
   - `spokeRule` — `'radial'` / `'hex'` / `'none'` for hit-test behavior
   - `buildPolygon(state)` — vertices for the overlay
   - optional: `tilesPerDim(state)`, `filenameSuffix(state)`
3. Import and append to `FORMS` in `src/engine/forms/index.js`
4. Done. The form picker, slider gating, hit-testing, export filenames, and shader composition all pick up the new form automatically.

The form schema's escape hatch for forms whose math doesn't fit the polygon-based overlay (e.g. Droste's spiral, hyperbolic Escher's circle limit) is the `buildPolygon` field — it can return any vertex array, including non-polygonal approximations like sampled curves. Beyond that, more exotic overlays can be supported by extending the schema with a custom `drawOverlay` function in the future. We haven't needed that yet.

## the GLSL composition story (and why it's fragile)

The shader is built by string concatenation in `engine/shader-builder.js`:

```
COMMON_PREAMBLE
  + per-form uniform declarations (deduplicated)
  + each form's fold function (concatenated)
  + main() with switch on u_formIndex
```

Each form's `glsl` field is a JS template literal. **Watch for backticks inside form GLSL**. The original monolith had a long-running bug where backticks in a GLSL string broke the JS parser silently. If a future form needs a backtick in its GLSL, escape it carefully or use a different quoting strategy. The project's debugging history (the `v0.0.4`-era CHANGELOG line about "shader-based rendering") references this.

`gl.js` looks up uniform locations once at init via `collectAllUniformNames()`, then on every render iterates `collectUniformSpecs()` to push values. Per-form uniforms that the GLSL compiler optimizes out have null locations; those are silently skipped.

## design and UX principles

These are working principles, not code facts. They're how Daniel decides; matching them keeps proposals on his wavelength.

- **iPad and touch are first-class surfaces, not retrofits.** When adding any interactive UI, think through both the mouse cursor story and the touch story before writing the first line. Touch targets are 44pt minimum.
- **Direct manipulation over chrome.** When a value can be edited by dragging the thing it controls, prefer that over adding another slider. Existing examples: drag the slice overlay to position, drag the boundary to scale, drag outside to rotate.
- **Affordances are minimal and earned.** Don't add an indicator for every possible gesture. One affordance per category (one for scale, one for rotate, one for segments-on-radial), at low opacity, only on touch surfaces.
- **Stroke language carries information.** Polygon stroke highlights signal hover state on desktop; dashed amber signals OOB. Reuse this vocabulary rather than introducing parallel signals.
- **The body of the wedge is for the image.** The center is the busiest visual area. Don't put UI chrome there.

## the swap, the divider, the slot management

The "main slot" is the large viewport area. The "side slot" is the panel-top thumbnail box. By default the kaleidoscope preview is in main and the source-image overlay is in side. The swap button toggles them. The mini-canvas that shows the kaleidoscope when swapped is a 2D-canvas copy of the WebGL preview canvas (drawn via `ctx.drawImage`).

The divider drag uses rAF coalescing for the panel-width updates and hides both canvas-pixel surfaces (`previewCanvas`, `miniCanvas`) during the drag because they're sized in pixels and lag CSS-scaled containers by a frame or two during the gesture.

## things that aren't here yet but are coming

The big arcs since this doc was first written are now SHIPPED: the Droste + triangle forms; the **mobile chrome** + PWA (installable, offline); the **camera host**; the Components/Kit extraction; the **motion shell** (multi-keyframe timeline, velocity-continuous tween, MP4 export); **source-video animation** (load → scrub/keyframe/play over footage → frame-accurate export, navigable timeline, retime); and the **clip editor** (trim/bounce/slice bake + smooth previews).

`HANDOFF.md` is the rolling source of truth for current state + what's queued (read it first). `BACKLOG.md` carries the detailed running list + the roadmap/dependency analysis. Current highlights of what's next (see those docs for detail + sequencing):

- **Engine/perf hardening** (Daniel's least-ambiguous next): webmux + single-core render, Chromium pass, frame interpolation + slower speeds, OPFS long-render-to-disk for 10-min/4K, Firefox color/orientation.
- **Real-time live-video kaleidoscope** (smart-tween on setting change) → save-to-disk → Syphon (via an Electron/native wrapper — the reuse story is in the layering section above).
- **+gesture record** + per-segment rotation winding (capture intended movement, not nearest path).
- Motion-controls IxD + a global UI/brand pass (positioning-gated); more forms (hyperbolic, polygonal radial, p31m); "scale to tile" snap.
- Native wrapper(s) and distribution bets (standalone / Snapchat-IG filter / NLE plugin) — all reuse the shared engine.
