# backlog

Living list of things we want to do, in rough priority order within each section. **This is a backlog, not a changelog** — when something ships, it moves to `CHANGELOG.md` and comes out of here. Keep historical narrative out; keep only what's still open or is genuinely useful context for open work (e.g. a "revert this when upstream merges" pointer, or a strategic framing that guides sequencing).

## ROADMAP NOTES — Daniel's broader next-steps

Collected notes on bigger next steps; cross-references to items below in [brackets].

### Motion control IxD/UI

Two control tiers to design around:

- **Occasional / global** (overflow-friendly): aspect ratio; duration; smoothing; render; ⋯ overflow (download/load motion data, clip editor).
- **Always-used, tight with the timeline:** playback (play/pause, next/prev, loop); keyframe control (add, delete, anchor); navigation (zoom in/out, fit, pan).

Address:

- **Keyboard:** delete = delete selected, space = play/pause, a quick lock/unlock; keyboardability is likely poor across the whole app (untested).
- **Shift+click** to multi-select keyframes on the timeline.
- **Ambiguous state:** the outlined "loop on" reads the same as primary buttons that stay outlined — needs unambiguous on/off [design-system button disambiguation].
- **Clip-editor edges of long clips are hard to work with** → increase the modal size proportional to the viewport.
- **"Reset workspace"** command: delete all keyframes, start fresh on the same source.
- **Exit criteria:** responsive down to a **700px mobile breakpoint**; ergonomic placement; visually scannable; appropriate hierarchy + groupings; progressive disclosure. North star: Procreate Dreams / iMovie.

### Global UI pass

Mostly proceeds on existing principles: **neutral, powerful, precise, intuitive** — the playful "portal to another world" feel comes from getting the UI *out of the way*. (Now substantially served by the design-system arc below; the remaining open pieces:)

- **General audit:** what's working/not; areas lacking polish; discoverability (missing tooltips, first-run, demo content); where WYSIWYG breaks; **WCAG accessibility check.**
- **Global style direction / brand:** possibly art-direct a theme (palette, font, type ramp, voice + tone); confirm staying **lowercase + minimal**; any iconic defining visual elements. Parallel, any-time, NOT a blocker — merges in until we start integrating detailed notes.
- **Start-from UX nits:** SVG misalignment on the slice overlay; motion not showing the actual slice area in non-square aspect ratios; don't show BOTH the reflected wedge AND the over-extended wedge; timeline/keyframe UI; keyboardability; **lost the rotation affordance on the Droste circle** (want a grippy in/extending from the circle); mobile tab-bar icons still slightly wonky.
- **Note:** assumes the **PROSUMER creative-tool** use case; a kid-friendly / party version would call for a different flavor + reduced complexity [D1 positioning].

### Live video capture with PiP overlay  [merges with "Phase 5 — Live motion + external output"]

Builds off the current/preview mobile-feed design. Build **save-to-disk first**, **Syphon** later. Realtime motion kaleidoscope sending a LIVE video signal as output; manipulate the kaleidoscope live OR preview new settings before applying; **smart tween** easing between previous and new settings even under direct manipulation. Best for VJ work (mobile → Resolume Arena); secondary use case is record-to-disk.

### Native iOS / iPadOS / macOS app capability inventory  [ties to FOLD.md monetization Phase 3/4]

Wanted: camera controls (lens, resolution, EV, WB); switch live-video → full-res still on capture; **Syphon** or **HDMI** live-out; per-device tab-bar placement. Value of native = **optimizing engines + locking the best path per platform** (only Safari handles ProRes; Safari can't use the fast 2D-canvas path so uses WebGL — pick + lock per platform). Could **gate** features (motion + forms behind a paywall; keep core radial/rectangular + live camera free) and/or gate export resolutions. Adoption may be easiest **inside an existing ecosystem**: Snapchat/IG filter; DaVinci/Premiere plugin; **especially Arena**; an **FCP plugin** (Daniel's personal want).

### Misc wishlist

- **Audio sync:** load a track (Spotify / mp3) and animate playback in time with it.

### Perf + stability cycle for motion work  [merges with export-perf items + the Chromium pass]

Focus **webmux + single-core render**; test on Chromium; identify perf/stability issues.

- **BUG: motion JSON doesn't remember aspect ratio.**

### Animation usability bugs

- **Droste seams:** spirals seem to ALWAYS seam; thickness changes seam if the value changes between keyframes. If spiral is enabled, warn or gate motion mode.
- **Change a property globally AFTER keyframes exist:** an elegant way to change a core parameter (segment count, Droste thickness) once an animation exists — note it applies across ALL keyframes, but allow it and update every keyframe. For Droste, handle turning off tier mirror etc. [relates to cross-form keyframe transitions]
- **Onion skinning** (consider).
- **Auto-keyframe on drag:** if you drag the slice without a keyframe during playback, auto-save an anchored keyframe, or require the explicit add step?

### Add SVG overlay to the download package (stills)  [see "Export package layers / geometry overlay still"]

Plus: ensure save-composition / save-package language is **consistent across mobile + desktop**.

### Alpha test / marketing research / positioning  [ties to FOLD.md monetization]

Dipping from design over to strategy + marketing: URL, landing page, pricing, positioning. Daniel's parallel lane (which audience / use case / distribution mode) — feeds D1/D3, runs alongside engineering.

### Ad hoc UX issues

- **Mobile↔desktop view switch still interrupts the source** (tried before; NOT resolved) [preserve source across a chrome switch].
- **Per-form perceived scale:** p3m1 triangle + hex feel like much tinier samples than radial/rectangle/droste; tighten per-form defaults so forms feel relatable (decouple parameter passthrough if needed).
- **Min wedge sample size:** clamp to ~20×20px (currently shrinks to ~1px and the affordance UI breaks).
- **Snap compositions to the nearest tileable size** where possible [tile-aware].
- **Mobile undo** access (two/three-finger tap?).

### Droste-specific refinements

- **Offset behavior is confusing (Daniel):** pulling the center offset down-and-left shifts the vanishing point down-left, but the SAMPLED area moves up-and-right — feels like the image is wrapped onto a SPHERE. Is this expected with the current Möbius math? Daniel's mental model: moving the vanishing point should be like looking down a TUNNEL [relates to true vanishing-point offset below].
- As canvas-side control is added: a **toggle for what the center offset does + whether it's locked**; recommend a **crosshair** affordance instead of the dot.

### Strategic forks & build-order

**Three upstream forks gate big chunks of downstream work:**

- **D1 — Positioning** (prosumer ↔ kid-friendly $.99 ↔ tiered). Gates Global-UI style direction, marketing/pricing, the free-vs-paid model. Does NOT gate engine work or ergonomic IxD.
- **D2 — Native wrapper** (PWA-only ↔ native universal ↔ stays web). Gates Syphon, advanced camera, per-platform codec locking, HDMI — and how much web-UI polish is safe before a possible native redo.
- **D3 — Distribution** (standalone ↔ Snapchat/IG filter ↔ NLE plugin ↔ photo). The **core engine is shared under all of them**; only the shell differs — parallel *bets* on one engine, chosen per D1.

**Key leverage insight:** the **core engine + the tween/keyframe/realtime model is the shared asset under EVERY distribution path.** Investing there pays off regardless of how D1/D2/D3 resolve. So engine/realtime work + the parallel bug/ergonomics/hardening tracks are the safest momentum now; style-branding, Syphon, and plugin paths benefit from settling D1/D2 first.

**Parallel tracks (no cross-dependency, run anytime):** motion-control IxD; the bug/polish cluster; hardening (OPFS long-render, Firefox color/orientation, Chromium perf/stability). **Sequential chains:** realtime live-video (web, smart-tween) → save-to-disk → [D2] → Syphon/camera/codec-locking/HDMI; source-fps hint → frame interpolation → sub-25% speeds; Global UI Figma audit → [D1 style] → itemized fixes / icon suite.

**Daniel's lean:** engine/perf hardening is the least-ambiguous primary track; UI/brand + alpha-test/market research are parallel non-blocking lanes; gesture-record + live-tween build ON the hardening (best after the motion-controls IxD cleanup).

### Native wrapper / Syphon — does going native FORK the code? (settled: NO)

- **NO fork, if we use a WRAPPER.** Electron (macOS) and Capacitor/WKWebView (iOS/iPadOS/macOS) both RUN the existing web app — reusing Engine/Kit/Components/Chrome as-is. "Native" = a thin shell + native modules (Syphon, camera, HDMI). Only a full SwiftUI+Metal rewrite would fork, and that's NOT required. **Polishing the web app now is not wasted.**
- **The architectural-prep arc is DONE (Builds 164–170):** the wiring is split from the desktop chrome; a runtime-capability layer (`kit/capabilities.js`) and host-services seam (`shell/host.js` + `webHost` no-op) exist. A native wrapper mounts the same code via `createApp(env, { host: nativeHost, capabilities: nativeCaps })` — no fork. Next native step = the Electron+Syphon spike (implements `host.syphon`).
- **The real technical unknown was getting WebGL output INTO Syphon efficiently — answered by the spike (`spike/electron-syphon/`):** the CPU readback path (`drawImage` + `getImageData`) is viable on Apple Silicon (unified memory; no GPU texture sharing needed). `node-syphon`'s `SyphonMetalServer` works in Electron's main process (the OpenGL server doesn't, GPU process isolation). Resolume confirmed "Electron - Fold" as a live source. Viable on M1+ at 1920²; 4K 16:9 has margin only on clean hardware/M1 Pro+; Intel unlikely. Real integration should drive Syphon from the engine's FBO export path, not the display canvas.

## next up — small UI / quality refinements / known bugs

### Open bugs

- **[MODERATE-LOW] Filmstrip/scrub thumbnails go muddy/torn during rapid keyframe+scrub on a long clip.** Repro: open a longer video (6–10 min), enter motion, rapidly add/adjust keyframes AND scrub at once; marker thumbnails + tween-strip cells show partially-decoded frames; **self-resolves once activity settles.** Root cause: the seek-per-cell filmstrip build (`motion-runtime.js buildFilmstripVideo`) captures before a cold/slow decoder has presented the seeked frame; rapid scrub cancels builds mid-flight and marker thumbs draw in-place (vs the atomic tween cells), so partials linger. **No clean no-tradeoff fix** (rVFC is avoided on the occluded source `<video>` — can hang). Levers when we invest: (a) decoder warming on load; (b) buffered marker-thumb commit (offscreen, swap in on completed build); (c) a small decoded-frame cache. Low priority.
- **[LOW] Wide preview pins to the TOP of the main area (all engines).** A 16:9 comp with output in the main slot floats up with dead space below, on Safari/Firefox/Brave/Electron. Build 198 fixed Safari's separate "doesn't honor the aspect" symptom but not the top-float. Not visible from the CSS (the chain *should* center) — needs **live computed-style inspection** of `.slot-content` + `.preview-canvas` heights/offsets. Don't ship a blind fix.
- **[HIGH] Firefox video export stutters — output unusable.** Editor PLAYBACK is smooth on Firefox, but the exported file stutters (frame pacing / dropped-or-duplicated frames). Output *correctness*, not throughput. Belongs with the Firefox color/orientation hardening pass (Gecko seek/decode + VideoFrame-timestamp during export). Brave/Safari are reference-correct.
- **[MEDIUM] Motion footer must NEVER shrink the timeline (iPad).** With the playback-speed controls present (video source), the footer crams and the timeline scrubber shrinks below a usable touch-target/legibility size. **Desired:** WRAP the motion controls to a second row, keep the timeline full-size always. Pure footer flex-layout fix; pairs with the motion-controls IxD pass.
- **[LOW–MED] Edge seams where a segment slice meets the canvas edge (certain video files).** A thin border seam the fold then mirrors. Proposed: an optional **edge-inset crop toggle** (sample a few px in from the source edge). Opt-in so it doesn't crop sources that don't need it.
- **[LOW] Cursor affordances intermittently not showing (Firefox; not reproducible).** Most likely Gecko cold-start flakiness; the gates would *show* affordances on an undefined read, not hide them. Park until reproducible.
- **[LOW] PWA live-camera vertical aspect ~2× stretch (mobile; self-corrected, not reproducible).** Park until reproducible.
- **[MEDIUM] Phone PWA: safe-area below the tab bar doubles up.** In the installed standalone PWA, the space below the tab bar looks like the bottom safe-area inset is applied twice (`env(safe-area-inset-bottom)` likely double-counted in `mobile/styles.css`/`chrome.js`). **Pairs with the "PWA tab-bar bottom anchoring" item below — treat as ONE safe-area investigation (top + bottom inset behavior), attack together.** Needs live device inspection. Honor OS insets verbatim; don't pixel-match device geometry.
- **[MED–HIGH] Phone PWA: saving a still/composition leaves the app, and returning loses the output preview.** The save/share hands off to iOS; on return the WebGL preview is blank — almost certainly **WebGL context loss while backgrounded** with no restore-repaint. Fix = the **WebGL context loss/restore** handlers (`webglcontextlost`/`restored` on the preview canvas → re-init GL + repaint current `state`). Mobile-chrome save flow.
- **Slice params carry across form switches (product decision, not a bug).** `sliceScale`/`sliceCx/Cy`/`sliceRotation` are global state, so they persist across form switches (a large scale on radial makes droste's annulus oversized). Decide: keep shared, make per-form, or reset-the-slice-section on switch. Daniel: remembering values is sometimes desirable → likely a soft default + easy reset.
- **Camera preview performance (M1 iPad).** ~12–15fps observed in live preview (felt 24–30 before; a refresh helped → partly runtime variance). Dominant cost is the full-res camera texture upload (we request up to 3840×2160). Lever: request/upload a lower-res preview stream, keep high-res only at capture.
- **Intel Air black-square export — needs hardware access.** The probe passes (FBO complete) but the shader render comes back all-black; likely an Intel iGPU driver bug with large FBOs or VRAM exhaustion. The Build 40 e2e diagnostic catches it — next time the hardware is accessible, run diagnostics + check `endToEndTest.summary.allZero`, then design a render-validation step into the probe.
- **WebGL context loss/restore (general).** If a gray screen recurs in any scenario, add a `webglcontextlost`/`webglcontextrestored` handler pair on the preview canvas to re-init GL cleanly. (Also the fix path for the PWA-save blackout above.)
- **On-add keyframe thumb still on `readPixels` (desktop Safari).** The filmstrip is on the readback-free `drawImage` path (Build 120), but the instant on-add/edit thumb (`fillThumb`→`exportFrame`→`readPixels`) can still flash corrupt before the 600ms debounce corrects it. If bothersome, move `fillThumb` off readPixels too. (Still-export `exportAt` also uses `readPixels` — if a corrupt still export ever appears on desktop Safari, same readback bug, same drawImage escape.)
- **6K/8K video — remainder is non-HEVC browsers.** >4K routes through HEVC (hardware on Apple Silicon via Safari); Firefox/Chrome lack HEVC encode → those tiers stay disabled there. Future routes: AV1 encode (slow), a WebCodecs demuxer/tiled path, or a WebGPU port.

### Droste math directions (future, pair with motion shell)

- **True vanishing-point offset (per-tier rigid translation).** The current `drosteOffset` uses Möbius pre-composition (preserves circles but introduces in-tier non-conformal stretch Daniel reads as "rotation forced onto a 2D plane"). Clean math: per-tier rigid translation — each tier k has center `c_k = offset·(1 − 1/zoom^k)`; per pixel determine tier, translate, apply standard warp. Undistorted off-center concentric circles, visible tier seams.
- **Dimensional rotation / volumetric tilt.** Each concentric tier projected at a different angle (looking at a tube off-axis). More complex; per-tier perspective.
- **"True rotation" / pole rotation.** Lower priority. Post-composition Möbius on source `z_src`, or a joystick/corner-gesture affordance mapping to whatever math we pick. Strong motion-shell pairing (animating gives a flowing-water effect).
- **Global reset-to-defaults.** Per-form slice reset shipped (Build 56). If a "reset everything" workflow emerges, add a global button (form/slice/zoom/rotation/OOB/export → defaults, keep the loaded source).
- **Refine segment + canvas defaults per form** to maintain continuity across forms.

### mobile chrome — device-test follow-ups

- **Mobile landscape — on-device validation + IxD polish pending.** The in-place relayout shipped (Build 103; `#m-root` flips column↔row, live camera survives rotation, Dynamic Island handled via `env(safe-area-inset-right)`). Pending: (a) Daniel's on-device validation (camera-survives-rotation, island clearance CW vs CCW, divider drag, centering); (b) IxD polish — vertical tab-bar button sizing, source/form popover anchoring near the tab bar, full-bleed corner-hugging option. Pairs with the PWA bottom-anchor item.
- **PWA tab-bar bottom anchoring (iPhone).** In installed standalone the tab bar floats above the screen bottom (rounded-corner safe area). Idea: round the tab-bar hit-targets to follow the phone's corner radius so the bar anchors at the true bottom. **Same safe-area investigation as the "phone PWA safe-area doubles up" bug above — do together.** Interacts with landscape (the bar moves to the right edge there). (Also re-surfaced in testing: **preserve source across a chrome switch**, **snap the grippy to dock at top/bottom**, **min wedge ~20px clamp**.)

## next up — new forms

Each is one new file in `src/engine/forms/` plus one registry line. Order is rough; pick whichever sounds most fun.

- **Hyperbolic Escher (circle limit).** Tessellation of the Poincaré disk. Circular image with shapes crowding the edge (Escher's *Circle Limit*). Heavy lift: custom overlay (disk boundary + warped fundamental triangle) + custom controls (Schläfli tiling selector). The Droste form's `drawOverlay`/`classifyPointer` schema hooks are reusable. Distinctive Escher feel; significant differentiation.
- **p31m wallpaper.** Alternate triangular tiling — same equilateral triangles as p3m1 but mirror axes through vertices not edges. Fully seamless. Visually distinct at triangle centers vs corners. Vocabulary expansion; lower priority.
- **Radial polygon-frame variation (low priority).** A parameter on radial: optional n-sided polygon outer boundary instead of a circular arc (even sides matching segment count for seam compliance). May emerge from tile-aware work. Not a separate form.

**Design constraint for all new forms:** No visible seams. Pinwheel-only groups (p3/p6/p4) are excluded (cell seams break the illusion); glide-reflection groups (pmg/pgg) excluded (glide-axis discontinuities); rectangular mirror groups (pmm/cmm) excluded (redundant with the square form). With p3m1 shipped, p31m is the only remaining wallpaper group adding distinct vocabulary while satisfying the seam constraint. For each new form, fill in `tilesPerDim(state)` so the resolution hint is accurate.

## next up — capability tier

**Layering vocabulary (settled — Engine / Kit / Components / Chrome).** Engine (`src/engine/`) = forms/shader/gl/geometry, pure pixels, never rebuilt. Kit (`src/kit/`, `shell/state.js`/`history.js`/`params.js`) = DOM-agnostic primitives (state schema, undo/redo, snaps, param registry, tween/keyframe model) + host services (camera, render driver, export). Components (`src/components/`) = mountable UI shared by both chromes, **parameterized not forked** (source-overlay draw+hit-test+gesture math, output gestures, param-control renderer). Chrome (`src/desktop/`, `src/mobile/`) = layout/divider/tab-bar/disclosure/gesture-routing — the only layer rebuilt per device. **A state snapshot is the universal currency** — it powers undo, becomes a keyframe, is the A/B endpoint for live-transition tweening, and is the captured raw-frame edit state. Build the tween primitive once; it serves live transitions, keyframe interpolation, and random-mode drift.

**Future / follow-up:**

- **Export package layers / geometry overlay still.** Extend the package zip to include (a) the source thumbnail with the wedge overlay drawn on it, and (b) a **still showing the geometry treatment** (fold lines for the active form) rendered at output resolution as SVG or transparent PNG — the still parallel to the video's "how it was made" clip. Overlay math is in `overlay.js` (`drawSourceOverlay`); the lift is rendering geometry at export resolution + zip entries. Pairs with tile-aware export.
- **Desktop control-widget migration.** Desktop keeps hand-authored slider DOM; a later pass migrates it to the shared `mountRangeControl` (behavior already shared; only markup is forked).
- **Canvas pan state (`canvasOffset`).** One-finger drag on the mobile OUTPUT is a no-op until a canvas-translate state key + shader uniform exist.
- **Mobile undo/redo.** The shared snapshot model makes it available; the source-overlay exposes `onCommitStart`/`onCommitEnd`.
- **Preserve source across a chrome switch.** The responsive reload carries slice/canvas params but not the source image/camera. Persist the uploaded image (blob → IndexedDB) and re-`setSource` after reload; live camera re-prompts.
- **Camera controls — platform-limited.** iOS Safari `getUserMedia` exposes only facingMode + a resolution request; zoom/lens-select/EV/WB/focus and ImageCapture (48MP) are unsupported → need the native Capacitor wrapper. Build any camera UI capability-driven (`getCapabilities()`) so it lights up if more becomes available.
- **iOS file-picker redundancy.** "choose photo/file" always offers "Take Photo" on iOS (redundant with "take still"); no web way to suppress — native-wrapper only.
- **Proper opening / first-run screen** (mobile + desktop).
- **Per-form default normalization.** p3m1/hex feel like much tinier samples than radial/square/droste at the same `sliceScale`; tighten per-form defaults (default scale + decoupled passthrough).
- **Minimum wedge sample size.** Clamp to a ~20×20px floor per form (currently shrinks to ~1px where the affordance UI breaks).

### animation + performance track — open threads

(The multi-keyframe timeline, smoothing, tween filmstrip, pinch-zoom/pan, video export, video-file source, clip editor, and retime/speed are all SHIPPED — see CHANGELOG. Open tails:)

- **Per-keyframe ease handles** for deliberate holds/finer control (and per-segment rotation winding, below). Current Catmull-Rom smoothing + the "smoothing degree" control are the baseline.
- **Taubin (shape-preserving) smoothing — explore (low pri).** Current Laplacian smoothing relaxes loop amplitude toward the anchor as cranked; a Taubin λ|μ pass would smooth jaggedness WITHOUT shrinking the motion. Optional mode or default. Not urgent — current smoothing feels good.
- **Per-segment rotation winding (+N turns).** Explicit per-segment property (default direct/shortest, opt-in "+N turns", plus captured winding from gesture-record), not a global unwrap. Each keyframe = intent to move smoothly from the previous state without inadvertently reversing/replaying detours.
- **Output comparison — PiP.** A small picture-in-picture of the previous OUTPUT top-left of the current, with a side-by-side option. Needs rendering two states at once (the stateless engine supports it). Also needed for live-capture/Syphon. (Held loosely — large track thumbnails may suffice, esp. iPad portrait.)
- **Cross-form keyframe transitions.** A keyframe can be captured under a non-kf0 form (exit→change form→re-enter); playback ignores its discrete and renders it as kf0's form. No elegant way yet to author a form/segment *change* across the loop [relates to discrete-transitions crossfade].
- **Random / live-wallpaper mode.** Generative slow parameter drift on the continuous loop — the wedge gently pivots, properties gradually shift, as a live-wallpaper output from a still. "Animation without authoring"; ships on the tween primitive, before full keyframe UI.
- **Frame interpolation — wanted sooner (Daniel confirmed).** At 30fps source, 25% is unusable and 50% is a bit choppy (readable slow-mo floor ~50%). Interpolation (blend first, optical-flow later) unblocks sub-25% speeds; can bake. Cheap interim: a **Tier-1 source-fps hint** (show est. source fps + warn when a preset drops effective fps below ~15). Also **add 150%** now (speeding up never needs interpolation).
- **Variable framerate / non-30fps source hardening (higher-risk, deferred).** All tuning has been on 30fps. A 60fps clip showed slower scrub/thumbnail fill (2× frames + heavier exact-time seeks, Gecko especially) and an out-of-sync start/end keyframe after trim (parked for a repro). Treat as a hardening pass: estimate source fps (rVFC delta), robust exact-frame seeking at higher rates, reduce seek load (footage-frame cache), re-test trim→rebuild→loop-bookend. Low urgency while 30fps is the baseline.
- **Long-render MEMORY → OPFS streaming + worker.** `fastStart:'in-memory'` accumulates all encoded chunks until finalize; long/high-res renders risk OOM. Move encode+mux to a **Worker** writing to **OPFS** (`createSyncAccessHandle`, cross-browser), stream to disk, download the disk-backed file; abort = terminate worker + delete temp. Required before 10-min 4K is safe. Buys responsiveness + memory, NOT throughput. **Also covers the live record-to-disk sink** (`stage/recorder.js` accumulates compressed chunks in a JS array until stop) — MediaRecorder → OPFS is the natural fit (write each `ondataavailable` chunk straight to a sync handle).
- **Render throughput ceiling = the native wrapper.** Export is single-thread CPU/color-conversion-bound and scales with OUTPUT pixels; Safari was fixed to ~render-bound via WebGL-direct `VideoFrame` (≈130fps @4K), but true fast/multi-core/hardware encode is the native wrapper. Brave/Firefox stay on the 2D path. **Chromium export remains UNTESTED.**
- **Unreasonable-render detection.** A 16:9 6K @30 from a 130MB JPG stalls indefinitely (FBO/memory). Warn/guard when frames × output-pixels (or source size) is extreme, before starting. Tie to abort robustness (the X cancels a normal render but can't interrupt a single stuck frame; aborting always preserves keyframes).
- **Huge-source keyframe slowness.** Saving keyframes on a 130MB source lags (texture upload / per-render sampling); downscaling is the current workaround.
- **PWA stale cache.** An installed iPad PWA served an old build from its cached service worker. Verify the SW updates promptly / the precache is versioned.
- **WebCodecs `VideoDecoder` + `mp4box.js` demuxer (NEW dependency — needs approval).** The future fast-bake / fast-decode path (~2× on long renders where the codec decodes) for the clip-bake + video export. Decode-by-playback was shelved (≈3× FF/Chromium-only, Safari encode-bound). Cleanly isolated as an alternate `advanceSourceToP` — same cost later as now.
- **iPhone-`.mov` color/rotation pass (Gecko-specific).** (a) Washed-out color in the OUTPUT on Safari + Firefox — a WebGL texture colorspace/range issue in the video upload (investigate `UNPACK_COLORSPACE_CONVERSION_WEBGL` / limited-vs-full-range YUV→RGB / HDR). (b) Firefox applies a 90° CCW rotation to ALL video loads + an aspect squish on iPhone clips (Gecko handles rotation/pixel-aspect metadata differently) — read the rotation metadata and normalize. Brave + Safari are reference-correct.
- **ProRes limitation.** Browser `<video>` decodes ProRes only on Safari; WebCodecs can't broadly either. Matters for the FCP→Fold→Resolume workflow. Options if it blocks: require Safari for ProRes, document a transcode-first step, or native wrapper. Not a core blocker (most sources are H.264/HEVC).
- **WebGPU rendering port (large, shared across the three apps).** Raises texture-size caps (incl. the Firefox 8K still-export cap), enables tiled >hardware-max, helps the realtime/Syphon endgame.
- **AV1 encode; audio passthrough** (v1 is muted); **in/out trim** (subsumed by the clip editor).
- **Clip editor — deferred polish.** Trim/bounce/slice are feature-complete. Remaining: seek-based decode slow on long clips (WebCodecs-decode speedup); 30fps bake (source-fps estimation); no mid-bake cancel; live preview shows a hard seam cut vs the baked blend (the two-video crossfade preview is in for dial-in); bounce preview forward-only.
- **Tween-band visible-window refinement (assess feasibility).** The band only renders thumbnails for the VISIBLE window (gap on pan/zoom until idle re-render). Evaluate: (a) a slight buffer beyond the edges; (b) retain previously-rendered cells and only fill new gaps; (c) opportunistic off-view render when resources allow. A footage-frame cache (keyed by time) makes (b)/(c) cheap.
- **Firefox cold-start scrub/playback lag (deferred).** First interactions on a long clip show transient warm-up (stale-frame flash mid-drag; 1–2s lag) that self-resolve after ~a minute. Gecko JIT + cold decoder. Levers if annoying: warm the decoder on load, a tiny decoded-frame cache, or an rVFC readiness gate. Low priority (clears itself).
- **Gesture-record mode (data model must support it now).** Record the continuous parameter stream while manipulating; detect return to the start ghost as the loop point; smooth + simplify to sparse keyframes. A second authoring mode on the SAME tween engine. Especially valuable once Fold's live output Syphons into Arena. Sequenced after video.
- **Discrete transitions via crossfade (deferred — only if compelling).** Excluded params (form, segments, arms, oobMode, mirror toggles) can't tween but could CROSSFADE (render two states, dissolve) — most valuable for form→form. Shares the render-two-states capability with PiP. Explicitly NOT now.
- **Phase 5 — Live motion (mobile) + external output.** Mobile chrome gains live-transition tweening (reuses the tween kit) + record-to-disk. **External live output** (Syphon / virtual camera into Arena) is the one piece the browser can't do natively, for both live camera and live video-file playback — needs a native wrapper (FOLD.md Phase 4).
- **Deferred: Live performance shell (MIDI / kiosk).** Akai APC40 MK2 + Gamepad input, touch-as-primary, full-screen, no chrome. Possible third front-end (shape TBD) — the VJ performance surface, distinct from the camera-input feature. [See perform-mode input below.]

## tile-aware features

Treat Fold output as tile / wallpaper content rather than standalone images. Likely to evolve from research to feature as the gallery installation concept matures (see `FOLD.md`).

- **Snap-to-tile canvas zoom.** Per form, the canvas-zoom slider has natural snap points where the output is exactly one unit cell (or an integer multiple). Identify these mathematically per form, surface as hard snaps or slider indicators. Initial analysis suggested square-only, but visual evidence (repeating patterns at certain zoom-out levels) says the analysis was incomplete — revisit with a screenshot of the working repeat.
- **Snap zoom to repeatable increments.** At least Droste allows zoomed states that repeat — helpful for saving a loopable zoom sequence by returning to a visually identical (but technically zoomed) state.
- **Tileable cell export.** Export one unit cell of the tiling, not the full mosaic; filename labels the group; crop to the unit cell shape (square from p4m, hex from p6m, triangle from p3m1). Acceptance: cells tile seamlessly in a repeating grid.
- **Non-square tile output for snapping.** For non-square fundamental domains (hex, triangle), export the actual polygon shape (transparent outside / vector-cropped) so downstream tools can snap cells together — e.g. a gallery installation where visitor outputs snap into a larger hexagonal composition.

## monetization / sharing

Full narrative in `FOLD.md`. Work items, priority order:

- **Phase 1 (next): PWA + Ko-fi tip jar.** A Ko-fi link on the landing page. Audience-building, no paywall.
- **Phase 2: Walled-garden subscription brand.** Page-routing auth gating via a third-party platform (Patreon, Ghost, etc.). Parent brand candidate `curioustools.art`. Builds on Phase 1.
- **Phase 3: Native iPad app via Capacitor.** Web core, native shells for Pencil pressure / Files / Photos / share sheet / Shortcuts. App Store $5–15. Apple Developer ($99/yr) + 15–30% cut.
- **Phase 4 (sidebar): Native Mac wrapper for Syphon out.** Electron wrapper into Resolume. Spike + end-to-end proof complete; unsigned local DMG SHIPPED (`npm run dist` in `electron/`). **Still deferred (needs the $99 account):** code-signing + notarization (so the DMG runs on another machine without right-click→Open) and a **universal (x86_64+arm64) binary** (gated on a universal node-syphon build too — currently arm64-only). Revisit when distribution to other machines is the goal.
- **Phase 5 (deferred): Photoshop PSD export.** Export output + original + wedge as separate PSD layers.
- **Audio in the consumer "wonder" share.** The live-output path is video-only by design (Syphon/HDMI carry video; Arena owns audio). The one real audio case is the **Wonder-mode consumer flow** (record a clip with the effect baked in to SHARE, expecting source audio). Far down the list. No corner: the recorder's `captureStream` can add an audio track later — just keep the recorder free of hardcoded "video-only" assumptions.

The license choice (AGPL-3.0) preserves all of these without locking any in.

## gallery installation work

Curatorial frame in `FOLD.md`. Work items:

- **Cloud folder I/O handshake.** Fold reads source images from a configured cloud folder, writes outputs to another. Fixed paths, clean handshake. Upload UI, moderation, and gallery rotation belong to a separate sibling app, not Fold.
- **Guided Access kiosk compatibility verification.** Test the PWA install on iPad Pro 12.9" in Guided Access fullscreen: gesture/touch behavior, no UI element opens external links, survives extended use. Shared concern with the Drift project's kiosk backlog — investigate in tandem.
- **Document-camera source mode.** A live-camera-shell variation with the camera overhead pointing at a table of objects; visitors arrange objects, the kaleidoscope responds. Architecturally identical to the live-camera shell; possibly just a different default form / framing.

## developer tooling backlog

- **Cross-browser test pass on a Chromium browser (Chrome/Edge/Brave) — NOT yet tested.** We've tested WebKit + Gecko and hit several engine divergences; Blink is the third major engine. Scrutinize, with symptoms we've seen: **`readPixels` from an FBO** (WebKit corrupt under churn → escaped via drawImage; Gecko slow → removed per-frame readback; verify Blink's is correct AND fast for `exportAt`/diagnostics); **`VideoFrame` from a WebGL canvas** (WebKit hung → 2D-canvas drawImage source; confirm Blink's WebCodecs path + H.264 levels/`isConfigSupported`); **`gl.finish()` reliability**, **`preserveDrawingBuffer:true`** per-frame cost (Gecko penalty), **pointer-event coalescing** (Gecko fires far more pointermoves); **`premultipliedAlpha:false`** + 2D-canvas color management (the Safari tint history). Also confirm multi-download vs zip, `dvh` layout, `accent-color`, and the SW on Chromium.
- **GitHub Actions CI:** `npm run build` on push to main, deploy preview to Vercel on PR (Vercel handles this already; a CI workflow is for adding lint/typecheck when those exist).
- **Visual regression harness.** A small node script that loads each form at default settings, exports at 1K, and diffs against a saved baseline. Catches accidental shader regressions.
- **Source-mapped production builds.** Vite does this by default; verify on deploy.

### Global control-area UI follow-ups (Fold Live era)

The coherent control inventory + locked decisions live in `docs/CONTROLS.md`. Open items (the app-bar restructure shipped; these are the refinements — do them together, they interact):

- **Source/live-status overlay clutters the preview.** With the status caption (`#status`) now the only thing floating over the output, it feels out of place — move it into the bar / the source (left) group rather than float over the image.
- **Resolution shown twice in the output band.** The floated-right `.or-status` duplicates the picker's `#outputResHint` when idle — drop the redundant idle dims BUT keep the live state/fps it carries while recording/broadcasting.
- **Remove the horizontal rule between the bar and the output sub-band** — visual noise without hierarchy.
- **Canvas controls → a dropdown over the output, not an in-flow band** (reverses the band approach for canvas specifically; the output band stays in-flow). **Desktop relocated** the canvas `.group` into `#canvasRow`; **mobile still pending** (a settings button opposite the flip-camera control — mobile rebuilds its own body).
- **iPad landscape ~30px unwanted vertical margin on the global app bar.** The `@media (coarse, landscape) .main-slot { padding-top: 34px }` (clearing Safari's compact tab bar) adds ~30px unwanted margin — same class as the slice-settings / right-panel issue. Needs on-device tuning (can't verify blind). **Same family as the iPad-landscape right-panel-top-space bug — both are the coarse+landscape 34px hack misfiring; tackle together at the device.**
- **Source/output swap control relocation.** Its toolbar home no longer makes sense — move next to the **divider**, possibly an icon button over the source image(s).
- **Responsive + icon overflow pass.** Add icons + breakpoints so the output row + global bar resize gracefully: **icon+text as space allows → icon-only → "…" overflow** when very compact.
- **Future consideration — does the right panel need to be persistent?** Explore a simpler source/output split-screen with settings called up on demand (a structural rethink; park, don't action without a planning pass).

### iPad-landscape right-panel extra top space (cosmetic, landscape only)

In iPad Safari **landscape**, the right panel's content (form-picker row) sits below the output toolbar with extra space above; portrait is correct. Build 174 set `.right-panel { padding-top: 34px }` + `.output-toolbar { top: 50px }`; the CSS math checks out and there's no conflicting rule, yet on-device it's still pushed down → Safari-landscape-specific, not obvious from CSS. **Next step: inspect on-device** (Safari Web Inspector) — read the computed top of `#outputToolbar` and `.form-row`, reconcile. Hypotheses: the compact landscape tab bar / `env(safe-area-inset-top)` interacting with the `.right-panel` scroll container vs the abs-positioned toolbar. **Same coarse+landscape 34px-hack family as the app-bar margin item above.** Low severity.

## design system + UI Lab — open follow-ups

The token foundation + UI Lab + control standardization shipped (Builds 205–218). **Decided: NOT React/Plasmic** — Fold stays plain Vite + vanilla JS + GLSL; the investment is a design-system layer (tokens → components → compositions → interaction patterns) + a UI Lab. **The running app + design system are the source of truth, NOT a Figma artifact**; Figma / Claude Design are upstream *inputs* that can feed tokens, never a runtime renderer.

The Lab is the home for future polish, and the **fragmentation detector for all three shells** (its usage cross-reference flags `0×`/unfiled tokens). Open work:

- **Tokenize spacing.** The `--space-*` scale exists in tokens.css but the stylesheets still use literal padding/gap/margin (reads `0×` in the Lab). Adopt it the same parity way, leaving layout-coupled values literal (e.g. `.ms-stage` 24px, tied to canvas-fit math). **The broader intent: reduce the current sprawl of spacing/sizing variants toward a smaller, more intentional set. Base-8 is ONE experiment to try on the app bar with open hands — not a direction or commitment.** Normalize PER-SURFACE as we refine (it's a visual change, not parity), not a blind global snap.
- **The deferred app-bar IxD batch is the natural FIRST composition to migrate** once we lean on the system (see "Global control-area UI follow-ups"). Doing it in hardcoded CSS would be throwaway.
- **Lab token auto-discovery (proposed code increment).** Parse `tokensText` for every `--name:` and group by prefix so new color/type tokens appear without hand-editing the catalog arrays; surface any ungrouped token in an "unfiled" bucket (drift flag). Directly serves the "new variants get picked up programmatically" goal + the motion-class scenario. Also fold in the one stale `npm run dist` cheat-sheet line (says "default Electron icon" — we wired `mac.icon`). A `lab.js` change → its own build stamp.
- **Touch-target scaling for hybrid/large-panel contexts** (Movink ~7" effective — scale with panel size, or threshold above a few hundred px). Lands in the interaction-patterns / control-states layer. (This is the actual Movink fix — see hybrid-input below.)

### Design-system cleanup inventory (the punch-list)

"Collapse the diffs / fix the rough edges" tasks the Lab surfaced. None blocking; tackle alongside the surface they live on. (DONE items removed — these are what's left.)

- **Cursors / affordances.** The LOST Droste rotation grippy + crosshair-vs-dot for the offset; the min-wedge ~20px clamp where the affordance UI breaks. (Cursor restyle, camera-flip icon, Droste-diamond off-token color, slice-outline corner-join all DONE; rotate cursors redrawn Build 226.)
- **Buttons.** SIX distinct "emphasis/selected" treatments (`.primary` fill + 5 outlined: `.toggle.active`, `.ot-btn.active`, `.band-open`, `.mf-toggle.active`, `.mf-add`) → the "loop on reads like a primary" ambiguity; collapse to an unambiguous on/off + primary vocabulary. Context radii drift (button 4 / ot-btn,mf-btn 6 / mobile 8).
- **Text.** Migrate the ~25 sprawled text rules onto the named `.t-*` set (defined Build 218; migration is the parity step). Tooltips are native `title=` (unstyled) — decide keep-native vs a styled tooltip.
- **Empty / similar states.** 3+ empty messages (placeholder / status / side + mobile) with different wording, color, size → unify. Other reused states handled inconsistently desktop↔mobile.
- **Modals.** desktop↔mobile divergence (radius 10 vs 16, backdrop dim/blur, no card shadow) → reconcile into one treatment.
- **Radii.** off-grid 1/3/6/10 → fewer, per-surface (part of the reduce-variation intent above).
- **Assets (remaining).** Daniel drops the real 16px-legible favicon (`public/favicon.svg`) + the Apple Icon Composer app-icon (`electron/build/icon.png`). The homes + drop instructions are wired and shown in the Lab's app-icon section.
- **Keyframe pin (open Daniel input).** The pin reads as a triangular notch flush on the square's top. Locked-vs-auto representation: lean to FILL the notch on all keyframes + a different mark for locked.
- **Mobile `target` icon** (settings ↔ source) — unintuitive; needs a better concept.

**Affordance SVG workflow (durable agreement):** Daniel authors his own replacement SVGs; we RECEIVE and integrate them. Do NOT proactively rewrite how affordances are generated (procedural canvas → SVG) — breaking-change risk in a core UI surface for little gain. When Daniel hands over an SVG, treat it as design intent and redraw it in our normalized style at that point (see `DESIGN.md` "extending onto new shells").

## perform mode & live output

### Perform-mode input — controller-driven, not gesture (settled)

**macOS gives browsers no multi-touch.** Diagnostic (Brave + Sidecar, `?inputdebug`): `peak pointers=1 touches=0` — neither the Wacom Movink nor Sidecar delivers multi-touch; touch registers as a single `mouse` pointer. A macOS platform limit (Chromium/Electron + Safari don't fire TouchEvents on macOS), not our code. The only multi-finger event is the **trackpad pinch as `wheel`+`ctrlKey` (scale only)** — SHIPPED (scales `sliceScale` over source, `canvasZoom` over output); desktop Safari also fires `gesturestart/change/end` with scale+rotation. So the iPad-style combined gesture is impossible on a Mac touchscreen.

**Consequence:** perform-mode input on the Mac/Syphon rig must be **MIDI (Akai APC40) + game controller (Gamepad API)** mapped to slice params — rotary→angle, slider→scale, joystick/XY→position. Both Web MIDI and Gamepad API are web/Electron-native (no native module — confirm Web MIDI in Electron with a 30-min spike). Pairs with smart-tween (controller moves ease between states).

**Still open:** Safari `gesturechange` → rotate (Safari-only bonus); a synthetic Chromium rotate mapping (e.g. shift+pinch) if wanted. **Bigger touch targets on the Movink** (~7" effective) = the touch-target-scaling item in the design-system layer.

**True multi-touch = run Fold ON the iPad directly** (Safari/PWA, mobile chrome), not Sidecar. Confirm with `?inputdebug` on the iPad (expect `touches=2`).

### Output window — cross-browser bugs (open)

- **[HIGH — breakage] Safari: the output window's camera STARVES the main app.** When the source is the live camera, the popup opens its OWN `getUserMedia` of the same device, and Safari allows only ONE consumer → it hands the device to the popup and the MAIN app goes black. Recovery is NOT automatic (left paused; Daniel must click Safari's paused-camera icon → Resume; with both open, Resume ping-pongs the device). **Next-up code task.** Leaning fix (a): **frame-push fallback for the camera source** — the main app (sole owner) sends camera frames to the popup over the channel (per-frame transfer, only the camera frame, downscalable; stills/video stay zero-copy). Also fixes the no-auto-recovery. (Chromium/Firefox allow multiple handles — unaffected.)
- **[MED] Firefox: the output window runs ~1 fps.** Safari ~60 HD / ~30 4K (fine); Firefox ~1. Likely Gecko throttling the popup's `requestAnimationFrame` when not focused, or a slow 2nd GL context. Investigate: is `document.hidden` false on a 2nd monitor? Does a `setTimeout`/`OffscreenCanvas` loop dodge the throttle? Worst case document "use Chromium/Safari for the output window."
- **[LOW] Test-pattern button is inert during output-window broadcast.** The pattern is a BUS feature; the window self-renders and ignores it. Lean (a): **make the window honor it** (actually useful for projector/gallery alignment) — render the pattern when a `testPattern` flag is set.
- **[feature?] The output window PERSISTS after the main app closes** ("kindof cool"). An independent window (own engine + camera + channel) freezing on its last params. Could be formalized as an **exhibit / kiosk mode** (set up, then close the controller). Decide later: embrace (a "detach" action) or tear down on opener close.
- **Output-window follow-ups:** confirm **`BroadcastChannel` across Electron BrowserWindows** (web path verified); the live camera opens a 2nd `getUserMedia` to the same device — fine on macOS/Chromium/WebKit, watch for a browser that refuses it.
- **[LOW] Firefox: assorted UI quirks** (un-itemized — first Firefox look in many builds). Fold into the broader Firefox pass; itemize when revisited.

### Syphon output — open levers

**Measured (Daniel, M-series, 1920×1080): `render 0 + read ~44 + publish ~2.3 ms` (~20fps via the legacy preview-canvas path).** The GPU→CPU `readPixels` was 100% of the cost, so backpressure / zero-copy IPC / single-render / async-PBO all save ~nothing. **A faster readback method SHIPPED (Build 199):** the live bus renders through a SEPARATE offscreen engine (`shell/output-engine.js`) whose `drawImage(GL→2D)→getImageData` path is ~9× faster than `readPixels` on Blink, and never touches the preview canvas. **Remaining levers:** (1) **resolution** — 720p/HD is the practical perform default (4K readback = 33MB/frame); (2) **IOSurface/native** — the true zero-readback fix and the genuine web-tech ceiling (ties to the native wrapper). The output WINDOW already sidesteps readback entirely (4K@120) for the display path. **Live server rename while broadcasting:** editing the name mid-broadcast updates the label but not the live server (takes effect on next arm); a true live rename = dispose+recreate, which makes Arena drop/re-find (a visible blip) — deferred, gate behind a confirm if wanted.

### Output calibration / test pattern (shipped — one possible follow-up)

The `test pattern` toggle publishes a known reference frame (corners/orientation/border/circle/color bars), runs without a source (pre-show pipe check). **Possible follow-up:** a moving/animated element (sweep or counter) so a frozen pipe doesn't look identical to a working one.

### Live record-to-disk sink — fast capture path

NOT urgent (the recorder is a UX stand-in for Syphon, not the live output path). It runs ~11–12fps and lags motion playback because it uses the slow path (`exportFrameRaw`→`renderToFBO`→CPU Y-flip→`putImageData`→MediaRecorder, while the preview renders a 2nd pass). Fix: give the sink the engine's fast render-to-canvas + `drawImage` path (the video exporter's `beginCapture/captureFrame`). Tension with the bus's one-frame-many-sinks model: Syphon needs the raw CPU buffer, the recorder wants a canvas — so the bus offers both representations from one render, or the recorder renders its own pass. Smaller/aspect-correct output resolution already raises record fps.

## native wrapper / Syphon — node-syphon leak (RESOLVED, revert pending)

**RESOLVED (Build 185).** node-syphon@1.5.0's native `SyphonMetalServer.publishImageData` leaked ~14.2MB/frame (allocated a Metal texture per call, never released — the fix was a commented-out TODO right there). We forked + patched `MetalServer.mm` (local texture + `addCompletedHandler` release, mirroring the correct `PublishSurfaceHandle`), built the addon with node-gyp + Command Line Tools (N-API, no full Xcode), and carry it as a **vendored binary** `electron/vendor/node-syphon/syphon.node` applied by the postinstall hook `electron/scripts/patch-node-syphon.cjs`. Profiler-flat (~110MB across 400 publishes) + Arena-confirmed. node-syphon is GPL-3.0+ (compatible with Fold's AGPL). **Upstream PR open: [benoitlahoz/node-syphon#46](https://github.com/benoitlahoz/node-syphon/pull/46) (Closes #45).**

**REVERT when #46 merges + releases:** bump `node-syphon` in `electron/package.json`, delete the hook line + `electron/vendor/`. **Deferred:** a universal (x86_64+arm64) binary at packaging time (arm64-only now; ties to electron-builder signing).

## open architecture questions (settled notes)

Kept brief so the reasoning isn't lost:

- **Engine input contract.** The engine accepts HTMLImageElement / HTMLVideoElement / HTMLCanvasElement / ImageBitmap / VideoFrame as a texture source (`gl.texImage2D` natively accepts all).
- **Mobile is a distinct chrome.** Not a responsive retrofit — a separate front-end on the same engine, rendering the shared parameter registry. This is what makes the pro-and-playful product story possible.
- **Shared infrastructure for video sources.** Camera (MediaStream), video file (`<video>.src`), and animated still (parameter timeline) are *host modules* over a common continuous render driver, not three code paths.
- **WebCodecs for video export.** Prefer `VideoEncoder` for frame-perfect output; fall back to `MediaRecorder` if unsupported. Codec: mp4/h264 if available, webm/vp9 otherwise.
