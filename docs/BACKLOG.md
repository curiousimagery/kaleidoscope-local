# backlog

Living list of **incomplete / pending work**, grouped by **surface / family**. **This is a backlog, not a changelog** — when something ships it moves to `CHANGELOG.md` and comes out of here. Historical reasoning + shipped detail live in `ARCHIVE.md`, `CHANGELOG.md`, and git.

**Conventions:**
- **▶ NEXT** marks an item on the active arc's critical path; NEXT items float to the top of their group.
- Items are roughly **stack-ranked within each group** (top = higher priority / more ready).
- Bugs + quick wins are consolidated at the top as a running triage.

> Cleaned 2026-07-18 (Daniel's ask): shipped items pruned, kept pending-only, stack-ranked within themes. Pre-cleanup version in git history.

---

## ▶ known bugs & quick wins (triage)

### Open bugs (running list)

- **[HIGH — breakage] Safari: the output window's camera STARVES the main app.** With a live-camera source, the popup opens its OWN `getUserMedia` of the same device; Safari allows only ONE consumer → the main app goes black, no auto-recovery. Lean fix: **frame-push fallback for the camera source** — the main app (sole owner) sends camera frames to the popup over the channel (only the camera frame, downscalable; stills/video stay zero-copy). Also fixes no-auto-recovery. (Chromium/Firefox allow multiple handles — unaffected.) Pairs with the perform arc.
- **[HIGH] Firefox video export stutters — output unusable.** Editor PLAYBACK is smooth; the exported file stutters (frame pacing / dropped-or-duplicated frames). Correctness, not throughput. Belongs with the Firefox color/orientation hardening pass (Gecko seek/decode + VideoFrame-timestamp during export). Brave/Safari reference-correct.
- **[HIGH — parked, 2 fixes failed; instrument before more] Mobile: output preview black after the save handoff.** PWA — return from save → source preserved but output BLACK, stays black even loading a new source; only app relaunch recovers. Mobile web — "view image" opens the JPG as a page, back → both source + output lost. Tried B230 (contextlost/restored + reinitGL) + B234 (cache WEBGL_lose_context) — neither recovers. Key clue: a new source still renders black → the restore path likely never runs. Next levers: (a) **instrument** via remote Safari inspector (do lost/restored events fire across the save cycle?); (b) scope the `pagehide` loseContext to real navigation (skip on our own save/view click); (c) recreate the canvas + engine outright on return; (d) different web "view image" handoff. Related: live-camera full reset = the page-discard item under Sources.
- **[MED] Firefox: the output window runs ~1 fps.** Safari ~60 HD / ~30 4K fine; Firefox ~1. Likely Gecko throttling the popup's rAF when unfocused, or a slow 2nd GL context. Investigate `document.hidden` on a 2nd monitor; try setTimeout/OffscreenCanvas to dodge the throttle. Worst case: "use Chromium/Safari for the output window."
- **[MED — edge case] Timeline doesn't update after returning to motion from a camera still.** Repro: still → add keyframes → switch to a CAMERA still (capture) → re-enter motion → timeline doesn't update; a different still IMAGE updates fine. Suspect: `captureFrame` sets the source via `engine.setSource(img)` directly and skips the motion-rebind step `loadImage` runs (`env.rebindMotionToSource` / `renderTimeline`) — compare the two paths.
- **[MED → likely resolved B244, verify iPad] Motion footer must never shrink the timeline.** Arc 3 made the timeline `flex:1` between fixed clusters. Confirm on iPad portrait, then drop.
- **[MEDIUM] Phone PWA: safe-area below the tab bar doubles up.** Installed standalone — the bottom safe-area inset looks applied twice (`env(safe-area-inset-bottom)` double-counted). **Treat as ONE safe-area investigation with the "PWA tab-bar bottom anchoring" item.** Needs live device inspection; honor OS insets verbatim.
- **[MODERATE-LOW] Filmstrip/scrub thumbnails go muddy during rapid keyframe+scrub on a long clip.** Self-resolves once activity settles. Root: seek-per-cell filmstrip build captures before a cold decoder presented the frame; rapid scrub cancels builds mid-flight. No clean no-tradeoff fix (rVFC avoided on the occluded `<video>`). Levers: decoder warming on load; buffered marker-thumb commit; small decoded-frame cache.
- **[LOW–MED] Edge seams where a segment slice meets the canvas edge (certain video files).** A thin border seam the fold mirrors. Proposed: opt-in **edge-inset crop toggle** (sample a few px in from the source edge).
- **[LOW–MED] Source-panel corner seams unjoined in VIDEO EXPORT.** The B223/224 corner-join fix (closed path + `lineJoin:round`) landed in the live overlay but the exported "how it was made" source-preview still draws unjoined corners — apply the same closed-path join to the export path.
- **[LOW] Save-resolution hint ("Sharp output up to ~XK") under-reports.** Ignores canvas aspect; `tilesPerDim` may under-count perceived repeats. An order-of-magnitude SWAG hint — make it aspect-aware + re-derive tilesPerDim per form when revisited. Needs a mis-estimating case to trace.
- **[LOW] Wide preview pins to the TOP of the main area (all engines).** A 16:9 comp floats up with dead space below. Needs live computed-style inspection of `.slot-content`/`.preview-canvas`; don't ship a blind fix.
- **[LOW] Radial wedge outer arc isn't strictly honest.** The sampled area extends beyond the drawn arc, especially on non-square canvases. Draw the true extent or mark approximate; audit `engine/geometry.js` vs the overlay draw.
- **[BUG] Motion JSON doesn't remember aspect ratio.**
- **[LOW, park until reproducible]** Cursor affordances intermittently missing (Firefox cold-start); PWA live-camera vertical ~2× stretch (mobile, self-corrected); assorted Firefox UI quirks (fold into the Firefox pass).
- **On-add keyframe thumb still on `readPixels` (desktop Safari).** Can flash corrupt before the 600ms debounce corrects it; move `fillThumb`→`exportFrame` off readPixels if bothersome. (Still-export `exportAt` also uses readPixels — same escape if a corrupt still ever appears.)
- **Intel Air black-square export — needs hardware access.** Probe passes (FBO complete) but the render is all-black; likely Intel iGPU driver bug with large FBOs. Run diagnostics + check `endToEndTest.summary.allZero` next time the hardware's accessible; design a render-validation step into the probe.
- **Camera preview performance (M1 iPad).** ~12–15fps in live preview; dominant cost is the full-res camera texture upload (up to 3840×2160). Lever: request/upload a lower-res preview stream, keep high-res only at capture.

### Quick wins / cheap optimizations

- **Inputs tab: say what works HERE.** State per-adapter support for the current browser: Web MIDI = Chromium-only (DMG always works); Brave shields block Gamepad API + Web MIDI (shields-down fixes); iPhone/iPad gesture + QR pairing need the desktop DMG (LAN server lives in Electron). One capability line per adapter (they expose `supported()`) + a "use the Mac app for X" pointer.
- **Add a 150% speed preset to the Loop Builder format control** (`fmtSpeed`; speeding up never needs interpolation — free now). The resolution/fps/speed format controls shipped B394 on the Preview & bake step.
- **Source-fps warning in the Loop Builder format spec** — the spec (`renderFormatSpec`) shows the effective loop; add a warn when the chosen speed drops effective fps below ~15 (the "this will judder without interpolation" hint). Cheap interim before frame interpolation.
- **Output band declutter:** remove the horizontal rule between the global bar and the output sub-band; drop the redundant idle resolution readout.
- **Test-pattern: add a moving element** (sweep or counter) so a frozen pipe doesn't look like a working one.
- **Drop the real assets:** Daniel drops a 16px-legible favicon (`public/favicon.svg`) + the Apple Icon Composer app-icon (`electron/build/icon.png`); homes wired + shown in the Lab.
- **Hide (don't disable) settings that don't apply to the current form** (e.g. no segments row on hex). Cheap standalone if reached before the per-panel control stacks.
- **Still-mode frame picker thumbs: re-render on resize** (cells stretch after big divider drags; add a debounced rebuild — the build is already cancellable + single-flight).
- **Dead CSS: `.camera-live-row`** (styles.css ~436) references a layout the camera controls no longer use. Confirm nothing renders it, then delete.

---

## Fold Live — perform mode & live output

> The active program was the UX-restructure → perform program (arcs 0–7). Arcs 0–5 core + the mode/timeline/staging/autoplay/control-bus work SHIPPED (see CHANGELOG). Remaining pending below.

### Perform autoplay ("drift") — open tails
- **Discrete variety tier** — form/segment changes on a long randomized cadence (deferred until the continuous feel is dialed).
- **Auto keeps drifting a STAGED look** (deferred variant).
- Remaining dial-in constants (momentum probabilities, sweep floor, coverage exponent, pace curve, smoothing tau) in `perform-runtime.js` `autoPick`/`autoTick`.

### Control bus — open tails (Arc 6)
- ▶ **APC40 MK2 default profile** — allocate the physical zone WITH Daniel + full-zone LED painting as the connected cue (he held his APC mapping until rig-save existed — now unblocked).
- **Additive 'pulse' mapping mode** — physical inputs SET the base value, audio/onset signals ADD decaying offsets (Resolume value+animator model); the bus already allows multiple signals per field, pulse is one more mode + a per-field offset ledger.
- **Audio adapter** — Web Audio AnalyserNode → RMS/onset/tempo signals into the same mappings (pulse-mode default). No native code.
- **Node-based mapping canvas** — adopt **Drawflow** (MIT, zero-dep) as a visual skin over the same rig JSON when the audio adapter lands (inputs left, params/actions right, mappings as wires). List view stays for quick edits. Confirm the dependency at build time.
- **Generalized user-config JSON** — one portable `{v, inputs, prefs, ...}` doc all features read/write (the input bus migrates onto it); carries "don't show again" flags, defaults, UI dispositions, per-venue profiles. Electron mirrors to userData; web = localStorage + download/import.
- **Keyboard-device capture** (XP-Pen ACK05, TourBox-as-keyboard) — needs a capture-scope design so bindings don't fight app shortcuts. TourBox Elite HID = a WebHID adapter; ESP32 = class-compliant USB-MIDI (works with the existing adapter unmodified).
- **Per-mapping curve/smoothing knobs** (the row model reserves them); **mapping profiles** (save/load named rigs per venue).

### Mobile gesture-input surface — open tails (SHIPPED v1 B281–B283)
- Full touch-manipulation of the overlay ON the phone (grab edges/corners/handles like the desktop overlay — port `classifyPointer` + affordance hit-testing over the WS; today's zone gestures cover move/scale/rotate without handles).
- Duplicated-slider layouts; multi-phone support (server accepts N clients; signals need per-client ids).

### NDI / external-display broadcast — open
- **iPhone NDI broadcast from record-video** (Daniel's idea, wants a design pass): an "NDI broadcast" affordance beside record video — the phone as a standalone symmetry camera feeding Arena (native camera → followed program look → NDI over WiFi). Pieces exist since B356 (`host.ndi` is universal); missing = the mobile chrome's frame feed (record canvas → `host.ndi.publish` per tick) + toggle UI + a perf pass. Sequence after the iPad NDI throughput pass.
- **Electron HDMI/AirPlay external-display parity** — a "display" destination that opens the chrome-free output window fullscreen on a chosen display (macOS treats HDMI/AirPlay as normal displays; `screen.getAllDisplays()` gives labels). Rides the output-window sink + a small placement IPC; no new rendering.

### Perform-mode input — controller mapping (define WITH Daniel)
macOS gives browsers no multi-touch (Movink/Sidecar register as one pointer; only trackpad pinch = `wheel`+ctrl, SHIPPED). So perform input on the Mac rig = **MIDI (APC40) + Gamepad** mapped to slice params (rotary→angle, slider→scale, XY→position). The exact mapping is undefined — define it at the kickoff (his hardware, his assignments). Bigger touch targets on the Movink = the touch-target-scaling item. True multi-touch = run Fold ON the iPad (confirm `?inputdebug` shows `touches=2`).

### Syphon INPUT — Arena as a live source (Electron)
Receive Arena's program output INTO Fold as a source, kaleidoscope it, publish back out — Fold becomes a live effect in the Arena chain. `node-syphon` exposes the client/directory side. Perf: same readback consideration as output (CPU ~HD-viable). Seam: `host.syphon.listSources()` + `.subscribe(name)`; wire as a source type. Strong pairing with the perform arc.

### Mobile perform (Arc 7)
Output-live always a PiP on mobile. Core: record video with the live camera + AUDIO + the realtime effect + follow-ramp smoothing (recorder captureStream adds an audio track). Reuse the desktop ghost/echo. External live-out from mobile needs the native wrapper.

### Output window — cross-browser + follow-ups
(Safari camera-starve + Firefox ~1fps are in the triage.)
- **The output window PERSISTS after the main app closes** ("kindof cool") — could be formalized as an **exhibit / kiosk mode** (a "detach" action). Note: B383 made the *desktop popup* close-with-app; this is about a deliberate detach option.
- Confirm **`BroadcastChannel` across Electron BrowserWindows** (web path verified).

### Syphon output — open levers
- **Resolution** — 720p/HD is the practical perform default (4K readback = 33MB/frame).
- **IOSurface/native** — the true zero-readback fix and the web-tech ceiling (ties to the native wrapper). The output WINDOW already sidesteps readback (render-from-state).
- **Live server rename while broadcasting** — updates the label but not the live server (next arm); a true live rename = dispose+recreate (Arena blip). Gate behind a confirm if wanted.
- **Benchmark the hidden-engine capture path on M1 Max** — the 9× speedup + render-bound numbers were measured on M5 Max; confirm a generation/tier down. The diagnostics benchmark button already does this.

### Live record-to-disk — open tail
Long-render memory → OPFS streaming (under Export & rendering) now applies to live takes too (the mp4 assembles in memory).

---

## Motion editor & animation

### Motion timeline — remaining IxD tails
- **Shift+click** to multi-select keyframes.
- **"Reset workspace"** — delete all keyframes, start fresh on the same source.
- **G = +gesture** shortcut (reserved until the capability lands); quick lock/unlock key; app-wide keyboardability untested.
- **Editable duration for a VIDEO source** — treat a duration edit as an implicit speed change, clamped to 0.25×–2× (duration + speed as two views of one control). Needs incremental (non-preset) speeds.
- **Exit criteria** for the rework: responsive to a 700px breakpoint; ergonomic; scannable; progressive disclosure. North star: Procreate Dreams / iMovie.

### Motion editor — design direction (north star reference)
Procreate Dreams / latest iMovie — uncluttered, precise, powerful. Priority stories: add keyframes → scrub fast → edit/delete → realtime playback + loop → export. Open IxD refinement (Daniel drives, pixel-level): prev/next stepper ergonomics; loop on/off legibility (ties to button disambiguation); keyframe-marker + scrubber precision. **Output comparison PiP** — compare actual previous OUTPUT with current (needs rendering two states; also for live-capture/Syphon; held loosely — large track thumbnails may suffice).

### Animation usability
- **Droste seams:** spirals seem to always seam; thickness changes seam if the value changes between keyframes. If spiral is enabled, warn or gate motion mode.
- **Global property change after keyframes exist — DECIDED (allow it):** segment change applies to ALL keyframes behind a warning w/ "don't show again"; form-type change during motion also allowed with a DESTRUCTIVE warning (default CTA = cancel). [relates to cross-form transitions]
- **Onion skinning** (consider, beyond the current ghost).
- **Auto-keyframe on drag:** if you drag the slice without a keyframe during playback, auto-save an anchored keyframe, or require the explicit add?

### Open animation threads
- ▶ **Bounce PLAYBACK mode in motion** (DIRECTED) — drop a linear clip, trim, play BOUNCE with keyframes. Playback becomes loop / bounce / once (the ⋯ loop toggle grows a third option; distinct from the clip-bake bounce — this is playback-time ping-pong, no re-encode). Time runs 0→1→0; video seeks mirror. Check the loop-fork (kf0 return) at the ends. **Needed in BOTH perform and non-looped motion** (see mode-guardrails).
- **Stage-changes open tails** (core shipped B273–B276): two-decoder drift on very long synced staging (add a periodic nudge only if reported); slider write-through dots the marker only on next render; **edit-during-staged-playback** = autoplay's per-field ownership pattern (design once, shared with the perform-from-a-looping-motion hybrid).
- **Per-keyframe ease handles** for deliberate holds/finer control.
- **Per-segment rotation winding (+N turns)** — explicit per-segment property (default direct/shortest, opt-in "+N turns", plus captured winding), not a global unwrap. The winding data model exists (context-menu affordance away).
- **+gesture retro-capture** (DIRECTED, after stage changes) — make the gesture FIRST, then tap G to record what you just did (no arming). Real work is RESET HYGIENE: the accumulator resets on every non-manual state write + re-bases after ~800ms stillness.
- **Cross-form keyframe transitions** — a keyframe captured under a non-kf0 form; no elegant way yet to author a form/segment change across the loop [relates to discrete crossfade].
- **Random / live-wallpaper mode** — generative slow drift on the continuous loop; "animation without authoring", ships on the tween primitive.
- **Discrete transitions via crossfade** (deferred, only if compelling) — form/segments/arms/oob/mirror can't tween but could CROSSFADE (render two states, dissolve); most valuable form→form. Shares render-two-states with PiP.
- **Taubin (shape-preserving) smoothing** (low pri) — smooth jaggedness without shrinking motion amplitude. Current Laplacian feels good; not urgent.
- **Tween-band visible-window refinement** — the band only renders the visible window (gap on pan/zoom until idle). Levers: edge buffer; retain rendered cells + fill gaps; opportunistic off-view render. A footage-frame cache makes it cheap.
- **[TRIAGE — needs repro] Gesture keyframe: editing the final position after save briefly broke playback** (tick-tock instead of full spin). Suspects: finish-flow in-flight commit; write-through autosave colliding with `kf.wind`; spline near a wound segment. Get the exact step order; instrument before fixing.
- **Smoothed translation-PATH capture** (+gesture tail, lower pri) — record the take's spatial path, shape the tween as one smooth arc honoring the destination; pairs with per-keyframe ease.

### Loop Builder (was clip editor)
The full stepped mode shipped + iterated B385–B396 (see CHANGELOG); device/desktop verification is in VERIFY-QUEUE. Remaining forward-facing work:
- ▶ **Spit-and-polish UI refinement** (Daniel's stated next phase) — interaction-feel tuning across the stepped flow, the thumbnail timeline, seam drag, and split reference.
- **Tiny-A-segment interaction:** with honest proportions a 90/10 slice makes the right clip only ~10% of the track — grabbable but small. Daniel's zoom idea (focus a ~30s window, 15s either side of the seam) is the fallback if the proportional strip proves too tight.
- **Bounce bake — GOP-reverse buffering** (the deeper speedup). Bounce runs on the WebCodecs reader (forward half fast) but the reverse half re-decodes from the keyframe per frame (O(N²) within a GOP). Fix: when playing a GOP backward, decode it forward ONCE into a bounded buffer and serve in reverse, evicting per GOP. Bounds memory to one GOP; makes reverse ~linear. Lives in `video-decode.js`.
- **Safari crossfade-PREVIEW stall.** Playing through the seam in the in-editor slice preview stalls a moment on Safari — the seek-based two-video handoff (`startSlicePreview`: pause + backward-seek `v` to `inA+cfSec`) hits Safari seek latency. The BAKE is unaffected (WebCodecs). Fix: swap the primary/secondary `<video>` roles at the seam instead of seeking, or drive the preview off the reader. Preview-only, Safari-only.
- **A dedicated perform-mode access point** (the mode menu reaches Loop Builder from anywhere; perform has no overflow menu).
- **Bake tails:** no mid-bake cancel; bounce preview is forward-only; shared-demux memory optimization (two readers fetch the same file twice — see Export lane).

### App-wide mode-transition guardrails + opinionated flows  ·  ▶ DEFERRED — its own arc after Loop Builder closes (PLAN item 5, moved here 2026-07-20)
Once Loop Builder is a mode, make moving between Still / Motion / Perform / Loop-builder opinionated + safe (destructive-interrupt pattern as the mechanism):
- **Keyframe-shift warning** — SHIPPED B386 (entering Loop Builder with existing keyframes warns). Extend the pattern to the other transitions.
- **Open-a-motion-file routing** — on opening a motion file, detect whether it's a loop and ask; route to Loop Builder vs plain motion.
- **A simplified NON-LOOP variation of the motion editor** — no split first/last keyframe. Pairs with the routing (looped → loop builder + split-keyframe editor; non-looped → the simplified one).
- **Bounce PLAYBACK mode** — see Open animation threads (needed in both perform + non-looped motion).

### Conduit vNext — capture-domain detection (DEFERRED by decision)
Until a camera-consuming conduit app exists (zoetrope/tap/visualizers don't take camera input). Full scope in [archive/CONDUIT-TIER-C.md](archive/CONDUIT-TIER-C.md) "vNext" + [archive/CONDUIT-ROADMAP.md](archive/CONDUIT-ROADMAP.md). A sibling package (the input/capture side) lifted from `native-camera.js` + `FoldNativeCameraPlugin.swift` + `yuv-renderer.js`: per-device camera capability catalog, pipeline-safe fps governor, still-vs-video format selection, YUV frame-socket ingest. Named + scoped when the first camera-consumer is real.

---

## Export & rendering hardening  ·  parallel lane (lower priority)

(Firefox export stutter [HIGH] is in the triage. Secondary to the perform arc; pick up on a real export wall or a change-of-pace. **Frame interpolation is the one net-new creative capability** — jumps up if live slow-mo matters during perform.)

- **Frame interpolation — wanted sooner (Daniel confirmed); now COUPLED to the Loop Builder output-format speed control (SHIPPED B394).** The bake speed control (100/50/25%) works cleanly when the source fps has headroom (120fps → 25% is smooth) but on a 30fps source, 25% is currently **totally unusable** and 50% is choppy — each source frame repeats. Interpolation (blend first, optical-flow later) is what would make sub-source-fps slomo *workable for some content*. **When this lands it must plug into the Loop Builder bake** (`clip-editor.js` bakeAndApply — the `durationMs /= speed` path): interpolate the in-between frames the speed control currently duplicates, and drive it from the same `env.clip.fmt.speed` / source-fps relationship. Also relevant to any future motion-render slomo. Cheap interim already partly done: the format spec shows the effective loop; a sub-15-effective-fps warning is still worth adding.
- **Long-render MEMORY → OPFS streaming + worker.** `fastStart:'in-memory'` accumulates all chunks until finalize; long/high-res risks OOM. Move encode+mux to a Worker writing OPFS (`createSyncAccessHandle`), stream to disk, abort = terminate + delete. Required before 10-min 4K is safe. **Also covers the live record-to-disk sink.**
- **Variable framerate / non-30fps source hardening** (higher-risk, deferred). 60fps showed slower scrub + an out-of-sync trim keyframe. Estimate source fps (rVFC delta), robust exact-frame seeking at higher rates, footage-frame cache. Low urgency while 30fps is baseline.
- **Unreasonable-render detection.** A 16:9 6K@30 from a 130MB JPG stalls indefinitely. Warn/guard when frames × output-pixels is extreme, before starting. Tie to abort robustness (X can't interrupt a single stuck frame).
- **Huge-source keyframe slowness.** Saving keyframes on a 130MB source lags (texture upload / per-render sampling); downscaling is the workaround.
- **Shared-demux memory optimization for the clip bake** (filed B384). The slice two-reader fetches the file TWICE (2× compressed in memory). A `video-decode.js` refactor — split `demuxFile(url)→{samples,config}` from `createReader({samples,config})`, keep `createSequentialFrameReader` as a wrapper — halves it. Do it if large-clip bakes OOM; not urgent.
- **Bounce clip-bake render acceleration** (deferred PERF). Bounce's reverse pass is backward; the monotonic-forward reader can't help without extra machinery. Candidates: a bounded ring cache of recently-decoded frames, or decode the forward pass once to OPFS and read backward. Pure speedup, no correctness stake. Only if bounce bakes feel slow.
- **iPhone-`.mov` color/rotation pass (Gecko-specific).** (a) Washed-out OUTPUT color on Safari + Firefox — WebGL texture colorspace/range in the video upload (`UNPACK_COLORSPACE_CONVERSION_WEBGL` / limited-vs-full-range / HDR). (b) Firefox 90° CCW rotation on all video loads + aspect squish on iPhone clips — read rotation metadata + normalize. Brave + Safari reference-correct. (Includes the Firefox export-stutter triage item.)
- **Firefox cold-start scrub/playback lag** (deferred, self-clears). Levers: warm the decoder on load; small decoded-frame cache; rVFC readiness gate.
- **Render throughput ceiling = the native wrapper.** Export is single-thread CPU/color-bound, scales with output pixels; Safari ~render-bound via WebGL-direct VideoFrame (~130fps@4K), Brave/Firefox on the 2D path. **Chromium export remains UNTESTED.** True multi-core/hardware encode = native.
- **WebGPU rendering port** (large, shared across apps) — raises texture-size caps (incl. the Firefox 8K still-export cap), enables tiled >hardware-max, helps the realtime/Syphon endgame.
- **6K/8K video — remainder is non-HEVC browsers.** >4K routes through HEVC (hardware on Apple Silicon via Safari); Firefox/Chrome lack HEVC encode. Future: AV1 encode (slow), WebCodecs demuxer/tiled path, or WebGPU.
- **ProRes limitation (browser).** `<video>` decodes ProRes only on Safari; WebCodecs can't broadly. (Desktop app solved via B378 avconvert transcode; browser path unchanged.) Options if it blocks in-browser: require Safari, document transcode-first, or native.
- **AV1 encode; audio passthrough** (v1 is muted).
- **PWA stale cache.** An installed iPad PWA served an old build from its cached SW. Verify prompt SW updates / versioned precache.

---

## Design system & UI Lab

Design-system layer (tokens → components → compositions → interaction patterns) + the UI Lab (the fragmentation detector for all three surfaces). NOT React/Plasmic — plain Vite + vanilla JS + GLSL. Running app + design system are the source of truth, not Figma.

- ▶ **Button-emphasis disambiguation.** SIX "emphasis/selected" treatments (`.primary` fill + 5 outlined) → the "loop on reads like a primary" ambiguity. Collapse to an unambiguous on/off + primary vocabulary. Context radii drift (4 / 6 / 8). Substrate under the perform loop on/off + transport controls.
- **Ingest the Arc 6 settings/inputs surface into the Lab** (audited B290 — gap is real). ~27 new classes (`.set-tabs`, `.in-card`, `.in-map`, `.in-devhead`, `.in-lights`, `.in-kind` chips, `.in-pair`/`.in-qr`) with zero Lab specimens. One focused build: specimens + a stray-literal pass, before the audio adapter + Drawflow rounds build on them.
- **Tokenize spacing.** `--space-*` exists but stylesheets use literal padding/gap/margin (reads 0× in the Lab). Adopt per-surface (leave layout-coupled values literal). **Reduce the sprawl toward a smaller intentional set; base-8 is ONE experiment to try on the app bar with open hands, not a commitment.**
- **Systematic tooltips** — across controls, describing each + shortcuts. Decide native `title=` vs a styled token-driven tooltip first.
- **Systematic destructive interrupts (interaction pattern).** One shared confirm treatment wherever data would be lost (form change after motion edits, leaving Loop Builder unsaved, all-keyframes property changes), with "don't show again" where appropriate. Replaces the interim `window.confirm`s.
- **Touch-target scaling for hybrid/large-panel contexts** (Movink ~7" — scale with panel size). The interaction-patterns/control-states layer. (The actual Movink fix.)
- **The deferred app-bar IxD batch** is the natural FIRST composition to migrate once we lean on the system (hardcoded CSS would be throwaway).

### Cleanup punch-list (none blocking; tackle with the surface they live on)
- **Cursors / affordances.** Lost Droste rotation grippy + crosshair-vs-dot for the offset; the min-wedge ~20px clamp where the affordance UI breaks.
- **Text.** Migrate ~25 sprawled text rules onto the named `.t-*` set (parity step).
- **Empty / similar states.** 3+ empty messages with different wording/color/size → unify; other reused states inconsistent desktop↔mobile.
- **Modals.** desktop↔mobile divergence (radius 10 vs 16, backdrop, shadow) → one treatment.
- **Radii.** off-grid 1/3/6/10 → fewer, per-surface.
- **Assets (remaining).** Daniel drops the real favicon + Apple app-icon (homes wired in the Lab).
- **Keyframe pin (open Daniel input).** Reads as a triangular notch; lean to FILL the notch on all keyframes + a different mark for locked.
- **Mobile `target` icon** (settings ↔ source) — unintuitive; needs a better concept.

**Affordance SVG workflow (durable):** Daniel authors his own SVGs; we integrate. When he hands one over, **clarify the mode** (redraw in our style vs integrate as-authored) — don't assume. Don't proactively rewrite the procedural-canvas→SVG affordance generation.

### Global control-area follow-ups
- **Controls default to DROPDOWN MENUS** (direction, DEFERRED — don't block the core sequence). Output/broadcast clusters → dropdowns not expand bands; the `#outputRow`/`#canvasRow` bands get superseded when their surfaces are next touched.
- **Source info shown in too many places.** Filename+resolution appear top-left AND under the source panel — keep only the source panel's; add DURATION for motion data. Same in the output band (resolution shows twice — mostly fixed B353; verify).
- **Canvas controls → a dropdown over the output** (mobile still pending; desktop relocated into `#canvasRow`).
- **Source/output swap control relocation** — move next to the divider (icon button over the source image).
- **Responsive + icon overflow pass** — icon+text → icon-only → "…" overflow when compact, for the output row + global bar.
- **iPad-landscape 34px-hack bugs (2, tackle together at the device):** ~30px unwanted top margin on the global app bar, and the right-panel extra top space — both the `@media (coarse, landscape)` 34px hack misfiring. Needs on-device tuning.
- **Broader aspect ratios / canvas reset** — mostly SHIPPED (B245/B246); any remaining per-surface polish.

---

## Engine, forms & tile-aware

### New forms (each = one file in `src/engine/forms/` + a registry line)
- **"None" / passthrough form** (Daniel sees real value) — source straight through (zoom/rotation/aspect still apply), or a simple mirror. Cheap; useful as a broadcast-the-source mode + debugging reference.
- **Hyperbolic Escher (circle limit).** Poincaré-disk tessellation. Heavy: custom overlay (disk boundary + warped triangle) + Schläfli selector. Reuses Droste's overlay/classifyPointer hooks. Distinctive; strong differentiation.
- **p31m wallpaper.** Alternate triangular tiling (mirror axes through vertices not edges). The only remaining wallpaper group adding distinct seam-compliant vocabulary. Lower priority.
- **Radial polygon-frame variation** (low pri) — optional n-sided polygon outer boundary on radial (even sides matching segments). May emerge from tile-aware work; not a separate form.

**Constraint for all new forms:** no visible seams (pinwheel/glide-reflection/rectangular-mirror groups excluded). Fill `tilesPerDim(state)` for an accurate resolution hint.

### Droste math directions (pair with Motion mode)
- **True vanishing-point offset (per-tier rigid translation)** — replace the Möbius pre-composition (which introduces in-tier stretch) with per-tier rigid translation (`c_k = offset·(1 − 1/zoom^k)`). Daniel's model: moving the vanishing point should feel like a TUNNEL, not rotating a sphere.
- **Dimensional rotation / volumetric tilt** — each tier projected at a different angle (tube off-axis). Per-tier perspective; more complex.
- **"True rotation" / pole rotation** (lower pri) — post-composition Möbius; strong motion pairing (flowing-water effect).
- **Offset affordance** — a toggle for what the center offset does + whether it's locked; a crosshair instead of the dot.

### Per-form behavior + defaults
- **Per-form perceived scale normalization** — p3m1/hex feel tinier than radial/rectangle/droste at the same `sliceScale`; tighten per-form defaults so forms feel relatable when switching.
- **Droste seam divider line** (Daniel) — at arms=1 there's no rotation tell on desktop; draw a divider where the segment meets itself (also a draggable segment-count affordance, the radial-spoke-drag equivalent).
- **Minimum wedge sample size** — clamp to ~20×20px per form (currently shrinks to ~1px where the affordance UI breaks).
- **Slice params across form switches** — `sliceScale/Cx/Cy/rotation` are global so they persist (a large radial scale makes droste oversized). Decide: keep shared, per-form, or reset-on-switch. Likely a soft default + easy reset.
- **Global reset-to-defaults** — if a "reset everything" workflow emerges (form/slice/zoom/rotation/OOB → defaults, keep the source).

### Tile-aware features (evolve from research as the gallery concept matures)
- **Snap-to-tile canvas zoom** — natural snap points per form where output = one unit cell (or integer multiple). Revisit the math with a working-repeat screenshot.
- **Tileable cell export** — export one unit cell, crop to the fundamental-domain shape (square/hex/triangle); cells tile seamlessly.
- **Non-square tile output** — export the actual polygon shape (transparent/vector-cropped) for downstream snapping (gallery composition).
- **Snap compositions to the nearest tileable size.**

---

## Sources, input & capability tier

- **Sources universal across modes** (direction). Every source (still/video/live camera) in every mode as far as possible. Still mode on a video = a mini timeline scrubber to pick the frame (no autoplay/transport). Live camera in motion = valid with realtime/staged transitions.
- **Preserve source across a chrome switch / iOS page discard.** The responsive reload carries slice/canvas params but not the source image/camera. Persist the uploaded image (blob → IndexedDB) + re-`setSource` after reload; live camera re-prompts. (Also the native fix for the mobile-save blackout on web.)
- **Export package layers: composition JSON + vector overlay SVG.** Save-menu package checkboxes: composition JSON (recreate the output from the source — the still analogue of motion JSON) + vector overlay SVG (wedge/geometry sized to the SOURCE). Overlay math is in `overlay.js`; the lift is rendering geometry at export res + zip entries. Pairs with tile-aware export. Keep save-composition/save-package language consistent mobile↔desktop.
- **Canvas pan state (`canvasOffset`).** One-finger drag on the mobile OUTPUT is a no-op until a canvas-translate state key + shader uniform exist.
- **Desktop control-widget migration** — desktop keeps hand-authored slider DOM; migrate to the shared `mountRangeControl` (behavior already shared; only markup forked).
- **Proper opening / first-run screen** (mobile + desktop).
- **Audio sync (wishlist)** — load a track, animate playback in time with it.
- **iOS file-picker redundancy** — "choose photo/file" always offers "Take Photo" (redundant); native-wrapper-only to suppress.

---

## Mobile & PWA

- **Mobile landscape — on-device validation + IxD polish.** In-place relayout shipped; pending: Daniel's device validation (camera-survives-rotation, island clearance, divider drag) + IxD polish (vertical tab-bar button sizing, popover anchoring, full-bleed corner-hugging).
- **PWA tab-bar bottom anchoring (iPhone).** In installed standalone the bar floats above the true bottom (corner safe area). Round the hit-targets to follow the corner radius. **Same safe-area investigation as the triage "doubles up" bug.** Also: snap the grippy to dock top/bottom.
- **Mobile undo/redo.** The shared snapshot model makes it available; access gesture TBD (two/three-finger tap?).

---

## Cross-browser & platform

- **Chromium test pass (Chrome/Edge/Brave) — NOT yet done.** Blink is the untested third engine. Scrutinize: readPixels from an FBO (correct AND fast for `exportAt`/diagnostics?); VideoFrame from a WebGL canvas (WebCodecs path + H.264 levels); `gl.finish()`, `preserveDrawingBuffer:true` cost, pointer-event coalescing, `premultipliedAlpha:false` + 2D color management; multi-download vs zip; `dvh`, `accent-color`, the SW.
- **WebGL context loss/restore (general).** If a gray screen recurs anywhere, add a `webglcontextlost`/`restored` handler pair on the preview canvas. (Also the fix path for the PWA-save blackout.)

---

## Native wrapper & Syphon (distribution)

> The Capacitor arc delivered its outcome (native iPhone/iPad, native camera, HDMI/AirPlay/NDI on all three shells, conduit extracted). Remaining pending below; device-verify items live in `VERIFY-QUEUE.md`.

### iPhone field pass — the stabilization lane
- ▶ **Record quality + reliability (1080p).** Pixelation/compression artifacts, stop sometimes not stopping after ~2min, save sometimes failing — WebKit-MediaRecorder pathologies; the phone chrome is the LAST MediaRecorder consumer. **Fix = port the conduit WebCodecs recorder into the mobile record path** (explicit bitrate → quality; no captureStream → reliability). Device-paired increment (delicate-path rule).
- **Still capture fidelity** (latency + feedback REWORKED B380–B381). Remaining device-paired: brightness DARKENS on capture; alignment shifts slightly on camera switch (`STABILIZATION_CROP` calibration). Idea: a "3·2·1" countdown before the shot (opt-in — avoids button-press shake).
- **8K still save consistently fails (iPhone).** Likely FBO/memory ceiling (probe passes, real export dies). Fix: a REAL allocation test, or an honest per-device cap (see below).
- **Composition at the selected 4K tier** — the 4K tier applies to the source capture; the composition records at the 1080 upscale target. Honoring 4K = render the output at 2160 short side during the take (an fps tradeoff to measure on-device).
- **Thermal / sustained load** — devices run hot. A `thermalState` host seam, frame governors under pressure, idle-render elision, honest sustained-fps tiers.

### Per-device-category SAFE export ceilings
Build a conservative table (phone / iPad / desktop × memory class) of what each can SAVE safely — seed from real crashes (iPhone 17 Pro: 8K dies, 6K ok pending verify). Longer term: a TILED export (render in strips, memory-bounded, no ceiling).

### ⏸ PARKED gnarly pair (documented, not chased)
Both contained (no cascade risk). Full logs in `docs/temp/`.
- **iPad record ~19fps** — the B374 probe worked; remaining cost is deeper in WebKit's encode/copy path. Long-term = the Tier-3 native-capture class; not worth speculative surgery.
- **iOS NDI blue cast + flicker** — `wire: RGBA` confirmed; the cast is real on RGBA. Lead: colors were Arena-correct through B360; B363 switched capture to raw readPixels (bypasses color management, P3 vs sRGB). A/B: a persisted `?buscapture` override or the test pattern's known colors. Flicker: NDI rides the WiFi AP (DSL-era router suspect) — A/B on hotspot/ethernet.

### iPad NDI drain ceiling (MEASURED — WebSocket transport is the wall)
The native drain is idle; frames arrive 50ms apart. WebKit's WS send moves 8.3MB/frame at ~165MB/s, so FHD delivers ~20fps. **Levers:** (a) **GPU RGBA→UYVY** (halve the bytes → ~40fps headroom; UYVY wire built B372 but reverted for the blue cast — pairs with the color investigation above); (b) fetch-POST unmasked transport (uncertain gain); (c) HD tier ≈ 30fps+ meanwhile. USB-C ethernet is the rig answer.

### HDMI external-display follow-ups (core SHIPPED B331–B334)
- **Video sources across webviews** — blob URLs are per-context; write the clip to cache + serve through the plugin's `fold-ext://` asset scheme.
- **Desktop screen enumeration** (Window Management API labels — Chromium only) for placing the output window on a named display.
- **Small external-display status indicator** in the mobile chrome (console-only today).
- **[edge] iPad front-ultra-wide initial-load 90° rotation** — iPad only, that lens only, initial load only; switching cameras corrects it. May become moot if the native camera owns iPad capture.

### Video save UX convergence — open tails (core SHIPPED B370)
- Device-verify the iPhone .zip package path.
- Desktop parallel-source recording (a product decision — memory cost of a second 4K take) before the package option exists on desktop.
- Migrate stills' `exportStatus` line to the save-flow voice (stills show BOTH today).

### AirPlay OLED tearing/stutter — WATCH
Apple TV → OLED showed slight tearing even at 30fps+; not re-reproduced. Validate next AirPlay session; suspect the external view's render pacing vs the TV refresh, not throughput.

### Native camera → iPad/desktop chrome (core SHIPPED B339–B344)
- **48MP still-on-freeze for the desktop chrome** (freeze currently grabs the preview-res frame).
- **iPad Capacitor: tap-to-focus + WB/EV press-hold gestures** on the source panel (port the mobile pad — gated to touch + native camera).
- **Electron**: the honest desktop set is resolution + fps (WB/EV/torch don't apply). Full native depth = the iPhone-as-camera lane below.
- Device-verify: iPad native rows + a macOS webcam's res/fps.

### iPhone as a capture device for desktop
Pair the phone via the settings→inputs QR/LAN path; it shows up by name in the Electron camera dropdown, owning its AVCaptureSession (lens/EV/WB/48MP/**stabilization**). Video rides a WebRTC peer connection LAN-local (phone's native-camera canvas → captureStream → RTCPeerConnection → desktop `<video>` → setSource). Daniel's sharpener: Continuity Camera already lists the iPhone but loses the native capture features — the gap is CONTROL, not connection. Sequence after the iPad gear; pairs with NDI-out ("Fold nodes on a LAN").

### Camera polish follow-ups (post-stability)
- **Stabilization crop vs the SVG overlay package** — the saved full-res original is UNcropped; the planned overlay-.SVG-over-source must scale/position against the true source aspect.
- **Capture feedback honesty** (mostly addressed B380) — verify the white flash / status rides the actual capture moment on device.

### node-syphon leak — REVERT when released
Fix merged upstream (issue #45, PR #46) but NOT released on npm (still 1.5.0, the leaking binary). Stay on the vendored `electron/vendor/node-syphon/syphon.node` + the postinstall patch. Re-check when npm shows >1.5.0: bump the dep, drop the hook + vendor dir, verify with the memory profiler + an Arena hop. Do it alongside the next Electron packaging round.

### Capacitor arc — remaining tails
- **iOS safe-area / tab-bar polish** — the two iPad-landscape 34px-hack bugs + native-vs-PWA bottom inset (native portrait reads single-counted, so "doubling" looks PWA-specific).
- **Record-at-named-resolution mobile integration** — desktop records at the output-bus resolution; the mobile record path is the gap (delicate; device-gated). Overlaps the conduit-recorder port above.

### Distribution gating (needs the $99 Apple Developer account)
Full reference: `docs/DISTRIBUTION.md`. Code-signing + notarization (so the DMG runs elsewhere) + a universal (x86_64+arm64) binary (gated on a universal node-syphon build — currently arm64-only). Revisit when distribution to other machines is the goal.

---

## Strategic / roadmap

### Strategic forks (gate big downstream chunks)
- **D1 — Positioning** (prosumer ↔ kid-friendly ↔ tiered). Gates global-UI style, pricing, free-vs-paid. Not engine/IxD.
- **D2 — Native wrapper** (PWA-only ↔ native universal ↔ web). Gates Syphon, advanced camera, codec-locking, HDMI.
- **D3 — Distribution** (standalone ↔ filter ↔ NLE plugin ↔ photo). The core engine is shared under all — parallel bets on one engine, chosen per D1.

**Leverage insight:** the core engine + tween/keyframe/realtime model is the shared asset under EVERY path — investing there pays off regardless. Parallel tracks (no cross-dependency): motion IxD; the bug/polish cluster; hardening. Sequential chains: realtime live-video → save-to-disk → [D2] → Syphon/camera/HDMI; source-fps hint → interpolation → sub-25% speeds; UI audit → [D1 style] → itemized fixes.

### Shared `stage/`/conduit — native track (the structural fix)
The web track shipped (conduit extracted, B345/B349; external-surface B382). The **native track** (WKWebView + Metal-backed IOSurface, owned by the wrapper) is the one path that structurally removes the double-render — it captures the WebView's displayed frame directly, no second render, no state race, by construction. Unbuilt; needs its own spike. Belongs paired with the web track because it lives entirely in the wrapper: ANY web app hosted this way inherits it (Fold, zoetrope, future) with zero per-app native work. Not gating anything today; revisit when a second app needs Syphon output, or 4K/heavy-shader perf actually bites. **Also filed (Daniel):** once conduit stabilizes, extract `packages/conduit` OUT to `~/Code/conduit` (sibling repo, canonical clone) — solve the deploy question then (a `file:../conduit` dep breaks Vercel; pair with going public or a scoped registry publish).

### Native capability inventory / brand / positioning (parallel, any-time)
- **Native app capability inventory** [FOLD.md monetization 3/4] — camera controls, live→still-on-capture, Syphon/HDMI out, per-device tab placement, per-platform codec locking; possible feature/resolution gating; adoption inside an ecosystem (Snapchat/IG filter, DaVinci/Premiere/FCP plugin, Arena).
- **Global UI / brand pass** — general audit (polish, discoverability, WYSIWYG breaks, WCAG); style/brand direction (palette/font/voice; confirm lowercase + minimal). Start-from nits: slice-overlay SVG misalignment; motion not showing the slice area in non-square aspects; don't show both the reflected + over-extended wedge; keyboardability; mobile tab-bar icons.
- **Alpha test / marketing / positioning** [FOLD.md] — URL, landing page, pricing, audience/use-case/distribution. Feeds D1/D3.

---

## monetization / sharing

Full narrative in `FOLD.md`. Priority order:
- **Phase 1 (next): PWA + Ko-fi tip jar.** A Ko-fi link on the landing page. Audience-building, no paywall.
- **Phase 2: Walled-garden subscription** — page-routing auth via a third-party platform (Patreon/Ghost). Parent-brand candidate `curioustools.art`.
- **Phase 3: Native iPad app via Capacitor.** App Store $5–15; Apple Developer $99/yr.
- **Phase 4 (sidebar): Native Mac wrapper for Syphon out** (into Resolume) — unsigned local DMG SHIPPED; distribution gating above.
- **Phase 5 (deferred): Photoshop PSD export** (output + original + wedge as layers).
- **Audio in the consumer "wonder" share** — the one real audio case (record a clip with the effect + source audio to share). Far down; keep the recorder free of video-only assumptions.

## gallery installation work

Curatorial frame in `FOLD.md`.
- **Cloud folder I/O handshake** — read source images from a configured cloud folder, write outputs to another. Upload UI/moderation/rotation belong to a sibling app, not Fold.
- **Guided Access kiosk verification** — PWA on iPad Pro 12.9" in Guided Access fullscreen (gesture behavior, no external-link escapes, survives extended use). Shared with the Drift kiosk backlog.
- **Document-camera source mode** — overhead camera at a table of objects; architecturally identical to the live-camera shell (a different default form / framing).

## developer tooling backlog

- **GitHub Actions CI** — `npm run build` on push to main; a workflow for lint/typecheck when those exist.
- **Visual regression harness** — load each form at defaults, export at 1K, diff against a baseline. Catches shader regressions.
- **Source-mapped production builds** — Vite does this; verify on deploy.

## open architecture questions (settled notes)

- **Engine input contract** — accepts HTMLImage/Video/Canvas / ImageBitmap / VideoFrame as a texture source.
- **Mobile is a distinct chrome** — a separate front-end on the same engine, not a responsive retrofit.
- **Shared infrastructure for video sources** — camera / video file / animated still are host modules over one continuous render driver, not three code paths.
- **WebCodecs for video export** — prefer `VideoEncoder`, fall back to `MediaRecorder`; mp4/h264 if available, webm/vp9 otherwise.
