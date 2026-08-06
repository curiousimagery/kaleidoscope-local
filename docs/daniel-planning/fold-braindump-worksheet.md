# Fold: braindump worksheet

The purpose of this document is to get everything currently in your head onto a page so the gaps and contradictions become visible. It is not a deliverable. It is a raw material dump that becomes the input to the competitive scan, the interview guide, the positioning work, and the brand mark exploration.

## how to use this

**Write badly and fast.** Fragments are fine. The value is in coverage, not polish. If you find yourself composing sentences, you are going too slow.

**Do not research while answering.** If you don't know, write "don't know" and move on. The don't-knows are as informative as the answers.

**Mark confidence.** Put a tag at the end of any answer where it matters:
- `[K]` I know this, it is verified
- `[B]` I believe this, it is an assumption I would defend
- `[G]` I am guessing

**Timebox by part.** Part 1 is the longest and the most mechanical. Parts 2 and 3 are the highest value per minute. Part 4 is best done in a different sitting, ideally with a pencil in hand.

**Answer out of order.** Skip anything that stalls you. Come back or don't.

---

> ## a note on the pre-fill (Claude, 2026-08-06)
>
> Everything in a blockquote like this one is pre-filled from the codebase, `docs/FOLD.md`, `docs/BACKLOG.md`, the three voice-memo synthesis docs, and a scan of past session transcripts — not your own freewriting. Confidence tags follow the worksheet's own convention. Where nothing was found, it says so plainly rather than leaving a silent blank, so you always know what's pre-filled versus genuinely open.
>
> **Part 1 is restructured as a full capability inventory, not just Q&A.** The questions undercount what's actually built — things like the iPad-as-companion-input-surface, joystick-driven lateral pan, and conduit's negotiation layer aren't things the worksheet knew to ask about. Each subsection below answers the numbered questions inline, but the real deliverable is completeness — and a new **§1.9** at the end of Part 1 is a first-pass draft feature/tier table, explicitly a starting hypothesis for the eventual buyer-facing comparison table, not a decision.
>
> **Divergent material in Parts 3–4 is framed as complementary hypotheses still finding shape, not contradictions to resolve** — per your note that most of this thinking is loosely held.

---

# Part 1: what is actually built

The goal here is to give me enough specificity to assess where Fold is genuinely differentiated versus where it overlaps with existing tools. Your CC Kaleida correction is exactly the pattern: I can name a comparator, but only you know whether it solves the same problem. Assume I know nothing about the current build beyond the early brief.

## 1.1 The forms

1. List every symmetry form currently shipping, with the name you use for it in the UI.

> **[K]** Five forms ship, in form-picker order: **Radial**, **Square**, **Hex**, **Triangle**, **Droste**. (`src/engine/forms/index.js:23`, `FORMS = [radial, square, hex, triangle, droste]` — array order is picker order.)

2. For each form, what parameters can the user change? Give the actual control names, not the concepts.

> **[K]**
> - **Radial** (`forms/radial.js`) — `segments` (label "segments"). Pan-locked by default (has a focal point).
> - **Square** (`forms/square.js`) — `aspect` (label "aspect", 0.25–4, step 0.01). Not pan-locked by default.
> - **Hex** (`forms/hex.js`) — no form-specific controls. Pan-locked by default even though it tiles — a deliberate call documented at `forms/index.js:63-69`: it reads as radiating from a center despite being a wallpaper group.
> - **Triangle** (`forms/triangle.js`) — no form-specific controls. Not pan-locked by default. Folds around the centroid (deliberately richer than strict p3m1 — folding around vertices was rejected because it puts the seam somewhere that isn't a true mirror axis, see `triangle.js:9-11`).
> - **Droste** (`forms/droste.js`) — by far the most elaborate: `segments` (routes to `drosteArms`), `zoom` (labeled **"thickness"** in the UI — outer/inner radius ratio, 1.1–16×), `spiral` (tiers-per-turn), `mirror` (toggle, tier-boundary reflect vs. wrap), `wedgeMirror` (toggle, hidden at arms=1), `infiniteZoom` (a looping [0,1) phase slider that *replaces* composition zoom for this form). Plus two direct-manipulation-only params with no slider: `drosteOffsetX/Y` (the blue-diamond Möbius/source-drift handle) and `drosteZoomPhase`.
> - **Universal controls** (all forms): `scale` (label "scale"), `sliceRot` (label "rotation"), `compZoom` (label "composition zoom" — hidden on Droste in favor of `infiniteZoom`), `canvasRot` (label "rotation"), `oobMode` (label "out of bounds": clamp / mirror / transparent, default mirror).
> - **Note on control-name normalization:** parameter scale differs wildly between forms — triangle/hex render tiny at slider values that make radial/Droste/rectangle huge. Flagged in the voice memos as an unresolved normalization gap, not yet fixed.

3. Which forms do people gravitate toward, and which ones sit unused?

> **[B]** Radial wedge is explicitly described (GTM voice memo) as "the strongest 'wow' moment and the reason people get hooked." Which forms sit unused: **no source found — open.**

4. Which form was hardest to get right, and what was hard about it?

> **[B]** Droste, by inference: bespoke `drawOverlay`/`classifyPointer` (not the shared polygon-overlay path every other form uses), non-conformal log-shear math with a documented seam/twist trade-off, and the most-reworked parameter history of any form (see Q5). This is circumstantial, not your stated answer — **what specifically was hard is open.**

5. Are there forms you have built but not shipped, or built and removed? Why?

> **[K]** No full symmetry *form* has been removed. Several Droste *parameters* were built, then removed during iteration: `drosteSwirl` (a separate Möbius rotation control, removed Build 56 — "mathematically a single control split confusingly into two"), `drosteShift` (a shift-dot handle, merged into the offset diamond), and a classical-vs-generalized "Lenstra mode" toggle (removed once the generalized Lenstra map was committed). A form-schema field `buildSampleRegion` was also fully removed once "the main polygon IS the sample region."

6. What forms are on the list to build next, and what is the ordering logic?

> **[K]** Two named next-forms candidates in `BACKLOG.md:303-304`: a **hyperbolic/Poincaré-disk circle-limit form** (flagged "distinctive; strong differentiation," but heavy — needs a custom disk-boundary overlay + Schläfli selector, and is ALU-bound with cost that varies by its own parameters, unlike every current form) and a **p31m wallpaper form** (lower priority). No stated ordering logic beyond the differentiation note — **open.**

## 1.2 Seamlessness and output quality

This is the area I most suspect is your real moat and the area I understand least.

7. What exactly happens at a mirror boundary in your implementation? Describe it as if to another developer.

> **[K]** Each fold function (`foldRadial`, `foldSquare`, `foldHex`, `foldTriangle`, `foldDroste`) maps every canvas pixel into a folded 2D vector inside one fundamental domain via reflection math (mod + abs — e.g. `square.js:36-46`: `cell = abs(fract(q*0.5)*2.0-1.0) - 0.5`). This is continuous by construction for the four polygon forms: the mirror axes ARE the cell boundaries the fold reflects across, so there's no seam in the geometry itself — the boundary is exactly where a true mirror axis is.

8. What does "seamless" mean concretely in your build? What artifact are you eliminating that other tools produce?

> **[K]** At the *source-sampling* boundary specifically: `sampleSource(uv)` (`shader-builder.js:98-109`). When `oobMode` is "mirror" (the default), an out-of-bounds UV coordinate folds back into `[0,1]` via a triangular-wave formula, so the source texture tiles losslessly at its own edges — a fold sample landing past the source image's border reflects the source back on itself instead of hitting a hard clamp/repeat edge. That hard edge is exactly the artifact the other two `oobMode`s (clamp, transparent) DO produce, and presumably what other tools default to.

9. What does the feathering control actually do, and what problem did it exist to solve?

> **[K]** **No feathering control exists in the codebase.** A repo-wide search returns zero hits outside this worksheet itself. Worth a direct question to yourself: is this misremembered, was it removed at some point without a changelog trace, or is it a feature you've wanted to build but haven't? **Open.**

10. How does the output hold up under extreme zoom into the source? Where does it fall apart?

> **[G]** No source material on this specifically. Reasoning from the known pipeline: bilinear filtering with no mipmap pyramid (see Q11) means zooming *in* past native source resolution should just go soft/blurry (ordinary upsampling limits, not a fold-specific failure); zooming *out* to see many repeats could alias without mipmaps/anisotropic filtering. This is inference, not a tested answer — **open, worth actually checking.**

11. Anti-aliasing and sampling: what is the strategy, and what is the failure mode?

> **[K]** Bilinear only — `TEXTURE_MIN_FILTER`/`MAG_FILTER` set to `LINEAR`, no mipmaps, anywhere in the pipeline. The WebGL2 context is created with **`antialias: false`** (`gl.js:26-30`) — no MSAA. No supersampling/downsample pass exists in the render path (preview, still export, or per-frame video export all render directly at target resolution). No mention of moiré/aliasing mitigation appears in any doc — this reads as an **undocumented gap**, not a deliberate choice, and is worth confirming.

12. Where do seams still appear? Under what conditions?

> **[K]** Currently open items from `BACKLOG.md`: edge seams where a segment slice meets the canvas edge on certain video files (a thin border seam the fold mirrors; proposed fix is an opt-in edge-inset crop). Source-panel corner seams unjoined specifically in the exported "how it was made" preview video (fixed in the live overlay, not yet in export). Animating Droste's `spiral` between motion keyframes creates an uncaught seam — the fix was making spiral a structural/discrete (non-tweenable) parameter, same treatment as segment count. Droste's own non-conformal log-shear warp is a deliberate trade-off: shapes shear slightly along the spiral in exchange for twist behaving independently of zoom; `drosteMirror` exists specifically to eliminate a "type-i source-side wrap seam" at the cost of alternating tier parity when off.

13. Take three named tools you have personally used (k24, FCP's kaleidoscope, Adobe Capture, whatever else). For each, what specifically does Fold do that it does not?

> **[B]** No tool-by-tool breakdown found anywhere. The closest material is FOLD.md's origin story: you discovered kaleidoscopes in Adobe Capture, then again in FCP for VJ work; when you went looking for a dedicated tool you found "mostly antiquated terrible options and one pretty-okay web app" you used until you hit its limits — kludgy UX, **3K max output resolution**, visible seams, feature clutter unrelated to kaleidoscopes. That's a real, usable data point but it's not the tool-by-tool comparison the question wants. **Open for the specific breakdown.**

## 1.3 The source-region interaction

The "photoshoot within an image" idea lives or dies here.

14. Describe the interaction model for moving, rotating, and scaling the source region. On desktop. On touch. Are they the same mental model?

> **[K]** `src/components/source-overlay.js` wraps `src/shell/overlay.js`. Desktop: `mousedown`/`mousemove`/`mouseup` + `wheel` (with `ctrlKey` used to detect a trackpad pinch, since macOS has no true multi-touch). Touch: native `touchstart`/`touchmove`/`touchend`/`touchcancel` on the same canvas; two-finger touch pinch drives scale+rotate+move simultaneously via a proper rotation-around-pivot transform. A `classifyPointer` hit-test (form-specific for Droste, shared polygon-edge logic for the other four) resolves each pointer-down into a mode: move / scale / rotate / form-specific extras (Droste offset, arms, ratio). Same mental model across desktop and touch — the difference is input mechanics, not concept. `IS_TOUCH = matchMedia('(hover: none)').matches` gates whether persistent on-canvas affordance graphics (rotation arcs, radial arrows) render at all; desktop relies on cursor shape + hover instead.
>
> **A second, entirely separate interaction surface not asked about here: the iPad/iPhone companion.** A phone or iPad can pair with a **desktop Electron session** over the LAN (hand-rolled WebSocket+HTTP server, QR-code pairing with a per-session token) and drive the *same* source-region manipulation remotely. It's genuinely bidirectional: the phone sends touch-zone gestures (a "slice" zone and a "canvas" zone, auto-detected by orientation), and the desktop streams back the live slice-outline geometry plus a rendered copy of its own overlay affordances (~10Hz) so the phone's on-screen crosshairs track the real geometry exactly — no reimplementation of overlay drawing on the phone side. Slice-zone touches are replayed as synthetic `TouchEvent`s dispatched directly onto the desktop's real interaction handlers, giving full parity (move, outside-drag rotate, two-finger rigid-body rotate+scale+reposition) with zero duplicated logic. There's also a "finger echo" — raw phone touch positions painted as low-opacity circles over the corresponding desktop panel, so a performer's eyes can stay on the desktop screen. Fully shipped, in daily use. (`electron/remote-input.js`, `src/shell/remote-input.js`, `src/shell/input-bus.js`)
>
> **A third interaction surface: thumb-joystick lateral pan.** A reusable velocity-joystick component (`src/components/pan-joystick.js`) — push the handle off-center, the pattern pans that direction at a speed proportional to push distance, with an explicit latch/drift toggle (release either springs back to center-and-stop, or leaves the pan drifting continuously). It's mounted **twice** per session on tileable forms: once for canvas/tiling pan, once (inverted) for Droste's Möbius-center offset — two independent thumb joysticks can be on screen simultaneously. Wraps seamlessly against each tileable form's hand-derived lattice period (square, hex, triangle each declare an exact `latticePeriod()` in canvas space) so the joystick's position dot wraps "pacman"-style within one tile, and `recenter` snaps to the nearest lattice multiple rather than sweeping back through accumulated drift. Also mappable from a physical gamepad's thumbsticks via the Gamepad API. Progressive-disclosure gated — the joystick row only appears while pan is unlocked for the active form, via a per-form padlock override.

15. What visual feedback shows the user where the source region is and what it will produce?

> **[K]** A dimmed background outside the sampled polygon/annulus, a solid white stroke on the boundary (brightens on hover/drag), and a **dashed amber stroke + amber-tinted mirror-reflection preview** whenever the sampled region crosses outside the source image's bounds — the app's general "out of bounds" visual vocabulary. Droste additionally shows a log-spiral seam-preview curve when spiral ≠ 0.

16. How long does it take a user to go from one output to a meaningfully different output? Seconds? Clicks?

> **No source found — open.**

17. Is there any way to browse, sample, or randomize source regions, or is it purely manual?

> **[K]** No. Confirmed by codebase search — purely manual, no browse/sample/randomize feature anywhere.

18. Can a user return to a previous configuration? Undo, history, saved states, presets?

> **[K]** Undo/redo: a simple two-stack model, capped at 100 entries, pushed at the start of every user-initiated interaction (drag, scrub, form switch, keyframe op, trim/slice edit). **Session-scoped only** — plain in-memory arrays, lost on tab close or crash, not persisted. No parameter-preset ("save a look") feature exists anywhere — the closest analogs are motion **keyframes** (each one a full state snapshot) and the motion-JSON export bundle, neither of which is a general still-image preset system.

## 1.4 Resolution, export, and color

19. What is the maximum output resolution in practice, on what hardware, and how long does a max-res export take?

> **[K]** Device-probed, not fixed: `probeMaxFBOSize` actually renders to FBOs at candidate sizes (16384 down to 2048) and keeps the largest that succeeds — up to **16384×16384** on capable desktop hardware. Mobile is deliberately more conservative for memory safety: initializes at a 4096 probe cap, lazily re-probes to 6144 after first open, explicitly **not** 8192 — the FBO probe test passes at 8K but real export at that size was found to crash iOS via memory jetsam. **Export time at max resolution: no measured number found — open.**

20. What file formats can you export? Bit depth?

> **[K]** Stills: **PNG and JPG only**, via `canvas.toBlob`. Video: **MP4** — H.264 for ≤4K, HEVC above 4K where the device can encode it. Every texture and readback in the entire pipeline is **8-bit `UNSIGNED_BYTE` RGBA** — no half-float/float path exists anywhere. No PSD/TIFF/EXR or higher-bit-depth export.

21. Is there any color management? ICC profiles, wide gamut, working color space?

> **[K]** **None.** Zero hits repo-wide for `colorSpace`, `sRGB`, `ICC`, `wide gamut`, `P3`/`display-p3`, or any color-management term. `docs/CONTROLS.md:31` lists "Color range / colorspace" as a **planned, not-yet-built** item, explicitly tied to a known, unresolved "iPhone washed-out" color bug.

22. Does the export path preserve the source image's color characteristics, or does it round-trip through sRGB 8-bit?

> **[K]** Round-trips through whatever the browser/WebGL implicitly does — standard sRGB, 8-bit, no ICC handling anywhere.

23. Is there any metadata written into the output? You mentioned filenames encoding settings. Is that still true?

> **[K]** No EXIF or provenance-metadata writing code exists anywhere in the export path — bare PNG/JPG/MP4 blobs. **If "filenames encoding settings" was ever true, it isn't currently** — worth a direct correction or confirmation from you, since this reads as either stale memory or a feature that quietly didn't ship.

24. Batch anything? Multiple exports, multiple crops, multiple forms from one setup?

> **[K]** Not built. Exports are strictly one at a time.

## 1.5 Motion

25. What parameters are keyframable? All of them, or a subset?

> **[K]** A subset, explicitly split in `kit/tween.js`: **Continuous/interpolated** — `sliceScale`, `sliceCx`, `sliceCy`, `sliceRotation`, `squareAspect`, `drosteZoom`, `drosteOffsetX/Y`, `canvasZoom`, `canvasRotation`, `drosteZoomPhase`, `canvasOffsetX/Y` (rotation keys interpolate along the shortest angular path). **Discrete/locked-to-keyframe-0** — `form`, `segments`, `drosteArms`, `oobMode`, `drosteMirror`, `drosteWedgeMirror`, `drosteSpiral` (deliberately demoted from continuous because animating it seams, see Q12).

26. What does the animation editor let you do that a generic keyframe editor would not?

> **[K]** Sampling is **velocity-continuous Catmull-Rom** through keyframes — motion flows *through* a keyframe rather than easing to a stop at it, with an optional Laplacian smoothing pass and loop-aware periodic velocity across the seam. Non-anchored keyframes auto-space between hand-placed ones. And distinctively: exporting bundles a rendered source-preview video **with** a "fold motion" JSON describing segment/timing data, so the motion itself can be reapplied to a *different* source image later — a real differentiator, though the file size is flagged internally as "not tiny," a possible future sharing bottleneck.

27. How do you get a seamless loop? Is that automatic, manual, or not solved?

> **[K]** For ordinary still-image motion: **manual**, via a cross-fade or bounce wizard that switches you into loop mode with a split first/last keyframe — not automatic. For **Droste specifically, there's a genuinely automatic mechanism**: `drosteZoomPhase` sweeps [0,1), exploiting that the log-radius fold is scale-periodic, so one full sweep wraps with zero seam. Preconditions: offset must be centered, spiral must be 0 for a pure zoom — spiral introduces a residual per-loop source rotation that isn't yet compensated ("not yet wired; needs an on-device sign check").

28. What are the video export options: format, codec, resolution, frame rate, duration limits?

> **[K]** Format fixed at MP4. Codec auto-picked (H.264 ≤4K, HEVC >4K). Resolution tiers offered in UI: 1080p, 2.5K, 3K, 4K, 6K, 8K — each gated live per-device by codec support and the probed FBO ceiling. FPS: 24 / 30 / 60. Duration: clamped 500ms–10 minutes for still-based motion; **locked to the clip's own length** (non-editable) when the source is video. Requires WebCodecs (Chrome, or Safari/iPadOS 16+).

29. Can you import video as a source? What formats, and does it handle ProRes?

> **[K]** Yes, fully built — a loaded/recorded video clip can be scrubbed, keyframed, and played over its own timeline; export is frame-accurate. A full **Loop Builder** editing mode (trim / bounce / slice-with-crossfade) bakes a raw clip into a seamless loop and drops the result straight into motion mode. ProRes **decode** is iOS WebKit only, per `DISTRIBUTION.md`.

30. What is the render time for, say, a 10-second 4K loop?

> **No specific number found — open.** Important adjacent fact, though: video export is documented as **CPU/single-core-bound in-browser** — a code comment records that `hardwareAcceleration: 'prefer-hardware'` was tried and made "zero measurable difference on Safari — 8K HEVC stayed ~1fps on a single pegged core." The conclusion on record is that real multi-core/hardware-encode throughput is a native-wrapper concern the current pure-web export path can't reach.

31. Is there any procedural or generative motion, or is it purely keyframe-driven? (LFOs, noise, drift)

> **[K]** Yes, but it lives in **Perform mode, not the Motion/keyframe editor** — `createAutoDrift` (`kit/drift.js`): each continuous field gets a critically-damped spring wandering toward randomly re-picked destinations, tunable via pace/range/variety/smoothness. Per-field guardrail bounds and a default-excluded set (seam-prone Droste/offset params) prevent seam-triggering auto-wander unless opted in. Functionally a procedural-drift system, but it's a spring/random-walk, not a literal LFO/noise primitive you can drop onto a Motion-editor track.

## 1.6 Live and camera

32. What is the actual measured latency from camera to output? On which device?

> **No headline number found anywhere — open.** Real, documented latency *engineering* exists around it: pipelined readback costs one explicit, deliberately-accepted frame of constant latency in exchange for smoothness.

33. What resolution does the live camera path run at, and what is the frame rate ceiling?

> **[K]** `getUserMedia` requests up to 3840×2160 "ideal" by default. Native (Capacitor) path additionally exposes discrete presets: 1080p default streaming, with 1080p/QHD/4K record-mode tiers and 12/48MP still-mode sensor sizes.

34. Front and rear camera, multiple cameras, external cameras? Capture cards?

> **[K]** Front/rear supported, plus device-ID–pinned camera selection (a picker); front camera is mirrored to match preview convention. **No simultaneous multi-camera compositing.** No capture-card support found anywhere.

35. What is currently working for output: Syphon, NDI, virtual camera, HDMI, AirPlay? What is shipped versus prototyped?

> **[K]**
> - **Syphon** — real, native-backed, **Electron/macOS only** (macOS-only technology, no iOS equivalent).
> - **NDI** — real and native-backed on **both** Electron (native addon) and Capacitor/iOS (compiled Swift `.xcframework`) — this is more built than `docs/DISTRIBUTION.md`'s older "not yet added" note suggests; that note is stale.
> - **Virtual camera** — not found anywhere in the codebase. Not built.
> - **HDMI** — real and shipping, both Capacitor/iPadOS (native external-display plugin) and Electron desktop (second-monitor output window).
> - **AirPlay** — prototyped/planned only; `DISTRIBUTION.md` frames it as "try the pure web spike first, native fallback only if it disqualifies."
>
> **Underneath all five, conduit runs a genuinely negotiated capability-detection layer, not a static list:** every native shell must satisfy a shared host-capability contract (`packages/conduit/src/host.js`), and the web build's host is an all-`false` no-op so nothing can misfire on plain web. Detection is never speculative — NDI's `available()` on Electron is a literal "does the native addon actually load" check; **a destination never appears in the picker unless the SDK/addon genuinely loaded.** There's also an adaptive **pixel-readback prober** that times and checksum-validates several GPU→CPU paths per device on first use and picks the fastest one that's actually *correct* (it caught and auto-corrects an iPad WebKit R/B channel-swap bug that had been silently shipping a blue cast to NDI/Syphon output). Shared codec negotiation (`pickVideoCodec`/`pickAudioCodec`) keeps the live recorder and the offline exporter from ever disagreeing. Per-destination mechanics are individually tuned: NDI uses fixed-cadence pacing against a declared frame rate because WiFi jitter (not bandwidth) is the real bottleneck; iOS NDI transport is a distinct binary wire protocol over a localhost WebSocket with a hard-drop (not queue) backpressure policy, since a live-video receiver only wants the freshest frame; HDMI/AirPlay/output-window use an entirely different, zero-readback architecture — a **second engine instance** rendering from a streamed state JSON rather than reading back finished pixels — with an adaptive resolution-degradation ladder on iOS that steps down automatically under repeated memory-pressure crashes.

36. What MIDI mapping exists today? How deep does it go?

> **[K]** Web MIDI (Chromium/Electron only — no Web MIDI in Safari/Firefox). Normalizes both CC and note-on/off into a generic signal-bus format, device-slugged so mappings survive reconnects, with LED feedback support (APC40 MK2-aware — velocity maps to palette color index, matching your own controller). This now sits inside a broader **Control Bus** (an active "Arc 6" build): one normalized signal pool unifying MIDI, Gamepad API input, native trackpad gestures, and the iPad-companion gestures behind a single LEARN-based mapping admin sheet — per-mapping mode (absolute/relative/rate), sensitivity, invert, drag-to-reorder, and a save/load JSON "rig" that persists across sessions. A "control bus spec v2" (unifying six currently hand-maintained control-metadata lists into one descriptor per parameter) is an active, in-progress hardening pass — see Q49.

37. Any audio reactivity today, or is that entirely forward-looking?

> **[K]** Not built as visual-parameter reactivity. The only audio-related code is capture/passthrough for **live recording** (an AudioWorklet mic tap, AAC/Opus-encoded, muxed into recorded takes) — audio in, not audio driving visuals. An additive "pulse" mode (a physical control sets a base value, audio onsets add decaying offsets on top) is planned but explicitly unshipped.

38. What is the DMX build doing?

> **[K]** Nothing — no DMX code exists anywhere in the codebase, and it isn't a named BACKLOG item either.

39. What happens if something goes wrong mid-performance? Does it recover, freeze, or crash?

> **[K]** No true crash-recovery/autosave exists. There's a narrow mechanism that carries `state`+`session` (not the loaded source image, not undo history, not motion keyframes) across an intentional chrome-switch reload via `sessionStorage` — explicitly *not* crash recovery. This has been flagged as a real **data-loss bug**: losing the source image across an unwanted reload. Partially mitigated (a "never auto-switch chrome on a fine-pointer device" fix shipped); the full fix (persisting the source itself) is still open. Separately, a confirmed, reproducible crash-like state exists today: downloading a photo while in live-camera mode can leave the output panel frozen, not recoverable without a force-quit — and this is a **regression**, previously believed fixed once already.

40. Could this run unattended for eight hours? What would break first?

> **[B]** Thermal/sustained-load is explicitly self-documented as an **unsolved, actively-acknowledged problem** — the current build arc is framed around it directly: "say honestly what we cannot deliver; declare a priority order for who yields first." iOS has a real thermal-state API to react to; the web/desktop path has none, and must infer pressure from frame-time drift instead — a real cross-platform capability gap. Also relevant: GPU context loss has been observed on iPad HDMI + video-source combinations under memory pressure (mitigated by capping video-source resolution over HDMI, not eliminated). **My best guess for "what breaks first" is thermal throttling/frame-rate collapse on mobile, and memory pressure on the external-display path — but this is inference, not a tested answer.**

## 1.7 Platform matrix

41. What actually runs where today? Web, Electron on Mac, Capacitor on iPad, Capacitor on iPhone. Which of those are real builds versus intentions?

> **[K]** All four are real, shipped, and in active use — none are just intentions:
> | Shell | Status |
> |---|---|
> | Web (PWA, Vercel) | Shipped, installable, offline-capable |
> | Electron (macOS) | Shipped — real DMG builds exist, **currently unsigned** |
> | Capacitor iPad | Shipped, active device testing — runs the **desktop chrome** (it hosts the keyframe/timeline editor, which is desktop/iPad-only) |
> | Capacitor iPhone | Shipped, active device testing — runs the lighter **mobile chrome**, which doesn't yet mount the same app-init path as desktop (a noted future convergence) |
>
> Chrome selection is runtime, not build-time — the mobile chrome triggers only for a genuinely coarse-pointer device under 600px short side; everything else, including iPad, gets desktop chrome. **Android has not been tested at all** — flagged twice in the voice memos as an open gap with zero findings.

42. Which features are platform-locked, and why?

> **[K]** Syphon: Electron/macOS only (native tech constraint). NDI: Electron + Capacitor/iOS, not plain web. HDMI-out: Capacitor iOS/iPadOS + Electron desktop, not web. MIDI: Chromium-family browsers + Electron only (no Web MIDI API in Safari/Firefox). Native camera controls (EV/WB/lens/48MP still): Capacitor iOS only. HEVC >4K encode: Apple-Silicon-only. ProRes decode: iOS WebKit only. WebCodecs `VideoEncoder`: requires iOS 16.4+ — gates video export/recording entirely below that OS version.

43. Where does performance differ meaningfully by platform?

> **[B]** Mobile is deliberately capped lower than desktop for memory safety (4096→6144 FBO probe ceiling vs. up to 16384 on desktop; export resolution similarly conservative). iPad's timeline UI has been reported as undersized (a UX complaint, not strictly a perf one). Beyond these — **open.**

44. What is the minimum viable device, and where does it start to feel bad?

> **No explicit statement found anywhere — open.** Hard technical floors that do exist: WebGL2 is a non-negotiable engine requirement; a secure context is required for camera access; WebCodecs is required for any video export or recording (which is what actually gates iOS to 16.4+ as a practical floor).

## 1.8 The moat questions

45. Name the three hardest technical problems you solved. Not the most time-consuming, the hardest.

> **No explicit answer found anywhere — open, genuinely yours to write.** If it helps as raw material (not a substitute for your own answer): the pieces that read as the most mathematically/engineering dense across all the research are the Droste log-shear/Möbius spiral math with its automatic infinite-zoom mechanism, the seamless mirror-fold source-sampling trick, and conduit's adaptive per-device readback negotiation (the checksum-validated prober that auto-detects things like the iPad channel-swap bug). That's my inference from code density, not your lived account of what was actually *hard*.

46. Which of those would a competent developer with an LLM reproduce in a weekend, and which would take them months?

> **Open — depends on your answer to Q45.**

47. What do you know about this problem space that took you a year to learn?

> **Open.**

48. Is there anything in the build that you would be genuinely unhappy to see copied?

> **Open.**

49. What is currently fragile or held together with tape, that a buyer would discover in week two?

> **[K]** This is the best-sourced question in Part 1 — pulling together everything self-documented across `BACKLOG.md`, `ARCHITECTURE.md`, `HANDOFF.md`, and the voice memos:
> - **The GLSL string-composition mechanism itself** — the shader is built by raw JS template-literal concatenation; a documented historical bug class is a stray backtick in a form's GLSL string silently breaking the parser. Uniforms the compiler optimizes away get null locations and are silently skipped, with no surfaced error.
> - **Control-registry fragmentation** — a single control is described across ~6 hand-maintained lists keyed by raw state name (UI params, input-mapping targets, tween continuous/discrete/angular keys, follow spans, autoplay bounds/exclusions, shader uniforms, state defaults). Adding a control means touching several; a miss fails silently. A real, cited bug: the Droste infinite-zoom follower went backward for a while because one param was in the tween list but not flagged cyclic. A "control bus spec v2" unification is proposed and in progress, explicitly flagged as needing a dedicated hardening pass.
> - **Live-video/external-display under memory pressure** — iPad HDMI + video source has produced GPU context loss (app wedges, "could not recover") under sustained load; root cause is running a second full WebGL context + second video decoder at native resolution. Mitigated (capped resolution, and a newer shared-single-decode native architecture landing in stages) but not fully closed as of the last documented pass.
> - **Thermal/sustained-load is an actively unsolved problem**, not a bug — no thermal API exists on the web/desktop path at all; pressure is inferred from frame-time drift.
> - **The Droste seam-fix-duplication bug** — a visible seam at wedge intersections was patched in the live source-overlay view, but the fix never propagated to the actual render/export path (duplicated logic), and separately reappears when certain parameters are animated. This is exactly the kind of parallel/duplicated-code bug a technical buyer doing diligence would flag.
> - **Video export is architecturally CPU-bound** in the browser — hardware acceleration measured zero improvement on Safari; real throughput needs a native wrapper, which doesn't exist yet.
> - **Electron DMGs are currently unsigned** — a real distribution-friction risk (Gatekeeper will warn/block on other people's machines), not a code risk, but a "week two" discovery all the same.
> - **Android is completely untested** — zero findings, flagged twice as an open gap. A significant platform-diligence risk given Fold's positioning implies a broad audience.
> - Smaller but real: fat-fingerable segment touch targets persisting despite earlier fixes; inconsistent per-form center/origin-lock defaults; undo not covering keyframe add/delete; a confirmed iCloud save-location bug (writing to Documents instead of Downloads) that has already caused one real-world "did I lose my captures" scare in the field.

---

## 1.9 Draft feature / tier comparison table (new — not asked for by the worksheet, but the actual deliverable behind Part 1)

> This is a **first-pass hypothesis**, built by pulling every capability found above into one table with an illustrative tier suggestion — not a decision. Tier names below borrow loosely from the voice-memo pricing discussion (Entry/Free, Studio, Motion, Live Performance) precisely because that naming is itself unsettled (see Part 3) — treat the tier column as "which bucket does this feel like it belongs in," not a commitment. The point is to see the **whole shipped surface in one place** so the chunking decision can be made deliberately rather than piecemeal.

| Capability | Shipped? | Lives in | Illustrative tier | Notes |
|---|---|---|---|---|
| Square / Triangle / Hex (tileable forms) | Shipped | Still | **Free / Entry** | Simple, tile-clean, good onboarding forms |
| Radial wedge | Shipped | Still | **Free / Entry** (segment count possibly locked) | The named "wow" form per voice memo — strong case for keeping free/cheap to drive top-of-funnel |
| Droste | Shipped | Still | **Studio** | Most complex form; matches voice-memo pricing model's own placement |
| Hyperbolic / p31m forms | Not built | — | **Studio** (once built) | Named next per BACKLOG; hyperbolic flagged as strong differentiation |
| 49MP capture | Shipped (currently default for everyone) | Still/camera | **Studio** *(open decision)* | Flagged in voice memo as "overkill and unexplained" at current default — a real gating decision, not yet made |
| Max-resolution export tiers (up to 16K desktop / 6K mobile) | Shipped | Still | Split by device already; **software tier gate is open** | Device already gates hardware ceiling; whether a *paid* tier gates below that ceiling is undecided |
| Undo/history (100-step, session-only) | Shipped | All | **Free / Entry** | Core usability, hard to justify gating |
| Motion / keyframe editor | Shipped | Motion | **Motion add-on** | Matches voice-memo pricing model directly |
| Droste infinite zoom | Shipped | Motion/Still | Bundled with Droste (**Studio**) | Automatic seamless loop is a real differentiator worth naming explicitly in marketing, not just bundling silently |
| Video-as-source / Loop Builder | Shipped | Motion | **Motion add-on** | |
| Procedural drift / autoplay (spring-based) | Shipped | Perform only | **Live Performance** | Currently Perform-exclusive; could also read as a Motion-tier feature if repositioned |
| Perform mode hold/take/cut + ghost trail | Shipped | Perform | **Live Performance** | |
| MIDI input (Control Bus) | Shipped | All, but MIDI itself is Chromium/Electron-only | **Live Performance** | Platform-locked regardless of tier (no Web MIDI in Safari/Firefox) |
| iPad-as-companion-gesture-surface | Shipped | Requires desktop Electron app | **Open — is this a core desktop feature or a premium add-on?** | Genuinely unclear which bucket this belongs in; it's differentiated enough to be worth naming on its own rather than folding silently into "Motion" or "Live" |
| Gamepad / thumbstick lateral pan | Shipped | Still/Perform | **Open** | Same ambiguity as above — a real capability with no obvious tier home yet |
| Syphon out | Shipped, Electron/macOS only | Live | **Live Performance** | Distribution-path question is separate and open — see Part 3 (Gumroad vs. App Store) |
| NDI out | Shipped, Electron + iOS | Live | **Live Performance** | Works under either distribution path, unlike Syphon |
| HDMI / output-window out | Shipped, Electron + iOS | Live/gallery | **Open — broader than VJ use** | Used for gallery/installation contexts too (see FOLD.md's gallery concept, and the "standalone activation" framing in the appendix) — may not belong exclusively in a "Live Performance" bucket |
| AirPlay out | Prototyped only | — | — | Not shipped; no tier decision needed yet |
| Virtual camera out | Not built | — | — | Not shipped |
| Multi-clip source staging / clip queue | Not built (planned) | Perform | **Live Performance** (once built) | Real maturity gap vs. Perform mode itself, which is shipped |
| Batch export | Not built | — | **Studio/Pro** (if built) | Not shipped anywhere currently |
| Color management / ICC / wide gamut | Not built | — | — | Currently a gap, not a gate — affects all tiers equally until built |
| Android support | Not built/tested | — | — | Zero findings; a real due-diligence risk regardless of tier structure |

---

# Part 2: what you have already observed

This is the section that will pay the most immediate dividends. You have been running informal research for months. Extracting it is cheaper than running new sessions.

## 2.1 The roster

50. List every person who has used it, with: their name, what they do, what device they were on, roughly how long they spent, and whether you were watching.

> **[K]** Named subjects across the voice memos (device/duration/watching status is often not fully specified in the source — flagged where thin):
> - **Andrew** — usability test, 2026-06-30. Deep engagement with the motion/loop editor specifically; the most detailed single-session account in the memos. Device/duration not specified — **open**.
> - **Dad** — family demo, 2026-08-02. Reaction moved quickly into practical/commercial territory.
> - **Peregrine** (nephew) and **Sylvia** (niece) — same 2026-08-02 family demo. Spontaneously played with taking Droste-effect photos of each other.
> - **Winston** — a Live Nation event producer, met performing at Fremont Fridays. Reacted strongly; half-joked you should get a lawyer.
> - **Libya** — river session, 2026-07-17. Gave the "cool, but what do I actually do with this" reaction that seeded the companion/collage app idea.
> - **Shawna** — field-tested while hiking, 2026-08-02 (Hannigan Pass). Associated with the iCloud save-location scare.
> - You yourself, testing in the field the same day.
>
> Device, exact duration, and whether you were actively watching are **not consistently recorded** for most of these — worth filling in from memory while it's still fresh.

51. Which of them asked to use it again? Which of them actually did?

> **No source found — open.**

52. Which of them have you not followed up with, and why not?

> **No source found — open.**

## 2.2 The first sixty seconds

53. For each person: what did they do first, without prompting?

> **[K] (one data point):** Sylvia's first, unprompted move to capture a photo was reaching for the iPhone's hardware action button, not the in-app capture flow. **Everyone else — open.**

54. Did they reach for the camera or for an existing image? Was that a choice they made, or did the interface decide for them?

> **No source found — open.**

55. How long until their first output that they seemed happy with?

> **No source found — open.**

56. How long until their first output that made them react audibly?

> **No source found — open.**

57. Did anyone produce something ugly and stop? What happened right before that?

> **No source found — open.**

## 2.3 The light-up moment

58. Describe, as concretely as you can, the moment someone lit up. What was on screen? What had they just done?

> **[B] (closest available data point):** Peregrine and Sylvia's spontaneous back-and-forth taking Droste photos of each other is explicitly called out in the GTM memo as "a good real-world example of the gift/casual/mass-market use case working as intended" — close to a light-up description, but not a single concretely narrated moment. **Open for the fuller account.**

59. Was it the same moment for different people, or different moments?

> **No source found — open.**

60. Was it the image, the motion, the manipulation, or the surprise?

> **[B]** Radial wedge is named as "the strongest wow moment" in general — suggesting *the manipulation revealing an unexpected image* is the driver, at least for that form. **Not confirmed as a specific observed moment — open.**

61. Did anyone light up more than once in a session, or was it a single peak?

> **No source found — open.**

62. Did the reaction decay within the session? How long did they keep going?

> **No source found — open.**

## 2.4 The stuck moments

63. What are the top three places people get stuck, ranked by frequency?

> **[K] (raw material, not pre-ranked — ranking is yours to do):** From Andrew's session — deleting the first keyframe put the app into a stuck, mixed-state (old form + new form). The Droste form-picker can be pushed off-screen (more settings than fit), and toggling motion mode while it's hidden traps people with no visible way back — Andrew's own words: *"I want to go back to the other form... I don't know where we were first."* Disabled controls during playback don't render as visibly disabled, reading as broken rather than busy. EV vs. white-balance mobile-capture gestures get confused for each other. The iCloud Documents-vs-Downloads save bug caused a genuine "did I lose everything" scare for both you and Shawna in the field.

64. What are the top three places people get stuck, ranked by how badly it derails them? (These lists are usually different, and the difference is important.)

> **[K] (same raw material as above — you'll need to do the actual re-ranking):** By derailment severity, the Droste form-picker trap and the iCloud save scare read as the most severe (real confusion/panic, not just friction); the EV/WB gesture confusion and non-disabled-looking controls read as lower-severity but higher-frequency annoyances.

65. What did you find yourself explaining out loud, every single time?

> **No source found — open.**

66. Which control did people misinterpret? What did they think it did?

> **[K]** EV adjustment and white-balance adjustment were confused for each other during mobile capture — people adjusted one thinking they were adjusting the other.

67. Did anyone break something, produce a black screen, or get into a state they could not get out of?

> **[K]** Yes, twice with named causes: Andrew's deleted-first-keyframe stuck state (mixed old/new form), and the confirmed, reproducible frozen-output-panel state after downloading a photo in live-camera mode (not recoverable without a force-quit).

## 2.5 The discovery loop

This tests your load-bearing differentiator directly.

68. Did anyone, unprompted, move the source region and realize they could get many different outputs from one image? How many out of how many?

> **No explicit count found — open.** No anecdote in the sourced material directly confirms this "aha" moment happening for anyone by name.

69. If they did, what tipped them off? If they didn't, what did they do instead?

> **[K] (the closest and most important data point in Part 2):** Libya's reaction is really a *did-not-land* signal for exactly this question — quoted directly: *"It's cool that you can make this stuff, but what do I do with it? I don't want to just fill up my camera roll with kaleidoscope photos. I'm not making photo prints, I'm not doing an art show, I'm not a VJ."* She didn't find the open-ended source-region remixing compelling on its own; she wanted a *destination* for the output — this reaction is what seeded the companion/collage app idea in the appendix below. Worth sitting with directly: this is evidence the discovery loop's payoff may not be self-evident to everyone, even when the mechanic itself works.

70. Did anyone go back to a source image they had already used, to get something else out of it?

> **No source found — open.**

71. Did anyone bring their own image? Whose idea was that?

> **No source found — open.**

## 2.6 What they said

Vocabulary mining. This directly feeds positioning copy.

72. Write down the exact words people used to describe what they were seeing. Not paraphrases. Their words.

> **[K] — direct quotes on record:**
> - Libya: *"It's cool that you can make this stuff, but what do I do with it? I don't want to just fill up my camera roll with kaleidoscope photos. I'm not making photo prints, I'm not doing an art show, I'm not a VJ."*
> - Andrew: *"I want to go back to the other form... I don't know where we were first."* Also, on undo: *"Key frame edits should be on the undo stack in addition to the overlay segments."*
> - Your own self-assessment (useful as vocabulary for the brand-voice question in Part 4): *"I'm not good at selling it... I need to be more proud and assertive of what the magic is."*
> - Also on record, from `FOLD.md`'s own marketing narrative (not a user quote, but verbatim language you've already committed to preserving): *"It felt like a photoshoot within each image. The process of making these images itself is as captivating as the images themselves."* / *"Motion implicitly suggests emergence or collapse. Familiar creatures become alien, plants become creatures. Cute becomes uncanny. Ordinary becomes majestic. Everything awakens a sense of newness."*

73. What did they compare it to? "It's like ___."

> **No source found — open.**

74. What did they call the thing they made?

> **No source found — open.**

75. What did they call the software, or the action they were performing?

> **No source found — open.**

76. Did anyone use the word "kaleidoscope" unprompted? Did anyone use it in a way that felt limiting?

> **No source found — genuinely open.** Worth noting: none of the sourced material records anyone using the word "kaleidoscope" at all, prompted or not — either it wasn't tracked, or it's a real data gap worth closing deliberately next time you run a session.

## 2.7 The tells

77. Did anyone ask "can I ___?" Write down every one of those questions. That list is your roadmap.

> **[K]** Libya's reaction is effectively an implicit "can I do something with this output" ask — it became the companion/collage-grid feature idea. Sylvia's reach for the hardware capture button is effectively a "can I just use the button" tell. **No other explicit "can I ___?" quotes found — likely more exist in memory than got written down.**

78. Did anyone ask to save, send, or share? What did they want to do with the output?

> **[B]** Implied rather than quoted: save-flow friction is reported as a real UX complaint (redundant confirmations, the native iOS share sheet not handling multi-file saves gracefully) — which only surfaces as a complaint if people were genuinely trying to save/share and hitting resistance. **No direct quotes of the request itself — open.**

79. Did anyone ask what it costs, or when they could get it, or whether they could have it now?

> **No source found — open.**

80. Did anyone ask if it could do something for a specific project of theirs? What was the project?

> **[B]** Winston's reaction (a Live Nation producer sensing "real potential") and Andrew/Dad's independent convergence on the art-vs-software fork (Part 3) are adjacent to this but aren't literal "can it do X for my project" asks. **Open for the specific case.**

81. Whose reaction surprised you?

> **[B]** Winston's — a Live Nation event producer independently sensing real commercial potential and half-joking about needing a lawyer reads as a genuine, validating surprise in the source material's framing.

82. Whose reaction disappointed you, or was more muted than you expected?

> **No source found — open.**

83. Did anyone politely disengage? What do you think actually happened there?

> **No source found — open.**

---

# Part 3: positioning, pricing, and packaging

Forced choices. The point is not to be right. The point is to commit to something specific enough to be wrong about.

> **[K] — the master framework this whole part maps onto:** `docs/BACKLOG.md` already names three "strategic forks" gating major downstream work, referenced nowhere in this worksheet directly:
> - **D1 — Positioning** (prosumer ↔ kid-friendly ↔ tiered). Gates global-UI style, pricing, free-vs-paid.
> - **D2 — Native wrapper** (PWA-only ↔ native universal ↔ web). Gates Syphon, advanced camera, codec-locking, HDMI.
> - **D3 — Distribution** (standalone ↔ filter ↔ NLE plugin ↔ photo-app). The engine is shared under every path — these are parallel bets on one core, chosen per D1.
>
> Worth reading the rest of Part 3 through this lens rather than as unrelated questions — most of what follows is really D1/D3 material.

## 3.1 The one sentence

84. Complete, in one sentence, no clauses: "Fold is ___."

> **No single settled sentence found — open.** Closest existing material: `FOLD.md`'s canonical landing copy — *"A playground for visual symmetry."*

85. Now complete it for a photographer who has never heard of it.

> **Open.**

86. Now for a festival production designer.

> **Open.**

87. Now for someone's mother.

> **Open.**

88. Are those four the same product? If not, which one is the real one?

> **Open — this is close to the "pro-and-playful tension" `FOLD.md` explicitly names as a feature, not a problem: "I built the engine I needed for professional print work, and the same engine happens to deliver a moment of wonder when you point a phone camera at a tree."**

## 3.2 Segments, ranked four ways

Take your segment list (Explorer, Photographer, Pattern designer, Motion designer, VJ, Event producer, Museum, Educator, Artist, plus anyone else you want to add). Rank them separately on each of these. Do not try to make the rankings agree.

> **[B] — GTM memo names segments using different labels than this worksheet's own list, worth reconciling deliberately rather than silently:** mass-market "wonder" app (phone-first, casual/gift); prosumer creative tool (existing photo/video workflow); motion/animation package (keyframe/loop tooling as a distinct upsell); live-performance/VJ tool ("your own primary use case," but technically gated outside the App Store — see D2/D3); premium commissioned-content client work (a services business, explicitly *not* a Fold SKU — see 3.4); fine-art/licensing route (gallery shows, prints, direct licensing, without necessarily selling the tool at all).

89. **Conviction**: which do you most believe will pay?

> **Open.**

90. **Access**: which can you reach fastest, through people you already know?

> **[B]** VJ/live-performance reads as highest on access — it's named as "your own primary use case" with an existing network (Fremont Fridays, Winston).

91. **Revenue per customer**: which is worth the most?

> **[B]** The premium commissioned-content path has real numbers attached (see 3.5) but is explicitly a services business, not a Fold SKU — worth keeping separate in your ranking rather than conflating the two.

92. **Effort to serve**: which requires the least new work to satisfy?

> **Open.**

93. Now look at where the rankings diverge. Where a segment is high on conviction and low on access, that is a marketing problem. High on revenue and low on effort is where you start. Write one sentence on what the divergences tell you.

> **Open — the actual ranking work above needs to happen first.**

## 3.3 The narrowing

94. If you could only serve one segment for the next three years, which one, and what would you cut?

> **[K] — this is genuinely the richest material in Part 3.** Two people independently reached the same fork: Andrew and Dad **both, separately**, landed on differentiating as an artist doing exceptional symmetry work and licensing/selling that work directly to partners and events — versus building and selling the tool itself. Your own response on record treats these as **non-exclusive**: run your own gallery shows/print sales while keeping the underlying software "closer to your chest," letting the fine-art side build reputation without requiring the tool to be public. Worth naming plainly: this is a real, live, unresolved tension — not a settled hybrid, since the worksheet's forced-choice framing (what happens if the two paths *conflict directly*) hasn't actually been answered by the hybrid description on record.

95. Which segment are you most emotionally attached to for reasons that are not strategic? Be honest.

> **Open.**

96. Which segment on the list is there because it sounded good in a brainstorm rather than because you have evidence?

> **Open.**

## 3.4 What Fold is not

97. Write ten sentences beginning "Fold is not ___." Include at least three that hurt a little.

> **[K] — one is already firmly on record, stated identically and independently in two separate voice memos (creative-life-notes and fold-gtm-positioning), which is stronger than a single opinion:** **"Fold is not a commissioned-content service."** The commissioned-work business model (musician/client collaborations) is explicitly classified as a separate creative-services offering, not a Fold feature or SKU. **The other nine — open, genuinely yours.**

98. What would you refuse to build even if a paying customer asked?

> **Open.**

99. What feature request have you already received that you decided against? Why?

> **No source found — open.**

## 3.5 Price

100. What is the most you have personally paid for a piece of creative software, and what convinced you?

> **Open.**

101. What software do you pay for monthly right now, and which of those do you resent?

> **[B]** Procreate/Procreate Dreams is referenced repeatedly as a pricing-psychology touchstone — specifically your own reaction that you won't pay more for a tool you don't already trust the value of. Worth confirming whether that's a "pay and don't resent" or a hesitation case for you specifically.

102. Name the price you would charge if you were certain nobody would balk.

> **Open.**

103. Name the price at which you would be embarrassed to charge more.

> **Open.**

104. If Fold were free forever, what would you regret?

> **Open.**

105. If Fold were $299 and sold 200 copies a year, would that be a success or a failure to you? Why?

> **[B]** Your own stated philosophy leans generous/volume over per-unit extraction: *"If I have a million people who hit me five bucks, that's cool."* Worth testing that instinct directly against this specific $299/200-copies framing rather than assuming it answers the question.

> **[K] — real numbers already on the table, presented as two live, competing philosophies (not a settled answer), per your framing that this thinking is loosely held:**
> - **Model A (generous/bundled):** Entry ~$3.99 (tileable forms, radial wedge with segment count locked, magic-mirror mode, iPhone/iPad) → Studio ~$10 total/~$6 upgrade (Droste, hyperbolic once built, tile/pattern editor, 49MP capture, desktop app) → Motion add-on ~$20 (keyframe animator, autoplay, HDMI out — "mainly relevant on iPad and desktop") → Live Performance tier (audio reactivity, MIDI, Syphon/NDI — structurally tied to non-App-Store distribution regardless of price, though see the D3 note below).
> - **Model B (stricter split):** a simpler hard split by Still/Motion/Live, explicitly noted in the source material as "neither is a decision yet."
> - **A specific, worked commissioned-content pencil (business model, not a Fold SKU — see 3.4):** roughly $10k/month plus hardware/drive costs plus a couple thousand for occasional hired help, landing around $25k–$35k total per project.
> - **A firm, confidently-stated answer buried in the pricing discussion, worth surfacing on its own:** the **iPad app should stay in the free tier** — quoted directly, *"the bigger screen, being able to touch both of the pictures, that's where it's at."* This reads as more settled than the rest of the pricing discussion around it.

## 3.6 The exclusivity question

106. Name a specific capability you would keep out of every shipping build and reserve for your own work. If you can't name one, that tells you something.

> **[B]** No single *capability* has been named for this — what's on record instead is reserving an entire *practice* (fine art / gallery work) rather than one feature (see Q94's Fork). Worth flagging that this is a different-shaped answer than the question is actually asking for — the question wants one feature, not a whole practice.

107. In three years, what percentage of your working time do you want spent on software versus on your own installations and prints?

> **Open.**

108. If those two paths conflicted directly, and you had to choose, which do you choose?

> **[K] — genuinely unresolved, worth naming as such rather than papering over with the hybrid answer:** the material on record describes a way to avoid choosing (parallel tracks), not an answer to what happens under direct conflict. This question is still open on its own terms.

109. What is the smallest amount of money that would make the software path worth continuing?

> **Open.**

## 3.7 Kill criteria

110. What would you need to see in the next six months to stop working on this?

> **Open.**

111. What is the most likely reason this doesn't work, in your honest assessment?

> **Open.**

112. Who is most likely to build a competitive version, and how long would it take them?

> **Open.**

---

> **On distribution specifically (D3), one open strategic question worth naming here rather than letting it hide inside "Live Performance tier" packaging above:** Gumroad-style direct distribution (a DMG sold outside the App Store) remains a genuinely viable path *specifically for live-performance use* — but **App Store sandbox gating for Syphon has never actually been tested**, so treat "Syphon can't ship in the sandbox" as an untested assumption, not a confirmed fact. Meanwhile, NDI routed to a local Resolume Arena instance already reads as a genuinely good experience today, on either distribution path. So the real open question isn't "which is technically possible" — it's **how strategically important the live-VJ-artist segment is as an early-adopter wedge**, and whether Syphon's quality edge over NDI is large enough to justify a separate distribution path just for that segment. That's a segment-prioritization call (3.2/3.3), not a technical one.

---

# Part 4: brand and visual identity

Best done in a separate sitting, with a sketchbook nearby. Some of these are deliberately oblique.

## 4.1 Name and architecture

113. `foldworlds.com` is settled. Is the product called Fold, or Fold Worlds? What do you say out loud when someone asks what you're working on?

> **[K] — direct correction, this is fact, not a leaning:** the product is called **"Fold."** `foldworlds.com` is the app-homepage domain, `curiouswizardry.com` is your developer homepage, and `curiousimagery.com` is your personal artist/VJ/photography identity — three separate, deliberately distinct things. `docs/FOLD.md`'s own "brand architecture" section independently confirms this: **Fold is its own product brand**, with Curious Imagery as the creator credit on its landing page, not nested inside it. The worksheet's own premise in this question is slightly off and worth updating.

114. Does "Worlds" change the promise? Your own copy already says "worlds within worlds," so it may be coherent. Say why, or say it's just a URL.

> **[B]** Given Q113's correction, this reads less like an open naming question and more like: "worlds within worlds, activate wonder" (see Q142) is a tagline/copy fragment that happens to echo the `foldworlds.com` domain name, not evidence the product itself is meant to be called "Fold Worlds." Worth confirming that reading is right.

115. What is the relationship between Fold and Curious Imagery, stated in one sentence a stranger would understand?

> **[K]** Already answered in `FOLD.md`: Fold is its own product brand; Curious Imagery is the creator credit linked from Fold's landing page. Curious Imagery's audience can discover Fold; Fold's audience can discover the artist behind it.

116. If Fold succeeds and Curious Imagery stays small, are you okay with that? What about the reverse?

> **Open.**

117. Are the SKU names real names or placeholders? Wonder, Studio, Live. Do you like them?

> **[K] — two passes at this exist, not one settled answer:** this worksheet assumes "Wonder/Studio/Live." The GTM voice memo instead uses "Entry/Studio/Motion add-on/Live Perform" — four buckets, and "Entry" rather than "Wonder." Only "Studio" matches cleanly between the two. Worth treating these as two drafts of the same underlying idea to reconcile or pick between, not as one being wrong.

## 4.2 Voice

You currently have two voices in your own writing, and they are not the same brand.

- **Voice A** (canonical landing copy): "A playground for visual symmetry. Find the patterns hiding inside any image." Quiet, spacious, gallery-adjacent, confident.
- **Voice B** (the Pete pitch): "Garbage on the ground becomes a cathedral... Take your friends on a psychedelic journey while stone cold sober... scales from a fun party trick to a full mindfuck. How deep do you want to go?" Loud, transgressive, festival, funny.

Both are good writing. They imply different colors, different type, different price points, and different customers.

> **[K] — both voices are now traceable to a single source, `docs/FOLD.md`, with dates:** Voice A is the doc's "canonical" landing-page copy. Voice B is the "Pete pitch" — written 2026-06-25 for a specific semi-structured alpha-test outreach to a friend of a friend, alongside a separate, more measured "descriptive copy for alpha test" disclaimer paragraph in the same doc. Both are genuinely yours, written for different purposes, not a contradiction to resolve — this is exactly the "complementary hypotheses" case.

118. Which one is true? Not which one is more appropriate. Which one is you.

> **Open — genuinely yours to answer.** One data point worth weighing: your own self-critique on record — *"I'm not good at selling it... I need to be more proud and assertive of what the magic is"* — arguably gestures toward wanting more of Voice B's confidence somewhere, without settling which voice is canonical.

119. Can the other one survive as a secondary register, and where would it live? (Social? Onboarding? Nowhere?)

> **Open.**

120. Which voice does a $250 event license want to hear? Which does a $6 App Store impulse buy want to hear?

> **Open.**

121. Write one sentence in each voice describing the same feature. Look at them side by side.

> **Open.**

## 4.3 Adjectives

122. Five adjectives Fold should be.

> **No source found — open.**

123. Five adjectives Fold should never be. (Include the ones you're afraid of.)

> **No source found — open.**

124. For each of your five positive adjectives, name a brand that already owns it. If they all point at the same brand, you are describing that brand, not yours.

> **Open — depends on Q122.**

## 4.4 Company it keeps

125. If Fold were a physical object in a well-curated shop, what object is it, and what does it cost?

> **Open.**

126. What five brands, of any kind, would you want Fold shelved next to?

> **[B]** Two brands recur across the source material as genuine reference points, though neither is stated as a direct "shelved next to" answer: **Procreate** (referenced repeatedly, both as a mirroring-tool comparator and a pricing-psychology touchstone — you clearly think about it closely) and **LightBurn** (referenced specifically as a business-model/licensing analog for the VJ/live-performance tier, not a visual-identity one). **Snapseed** is also referenced once, but as a UX model for a graceful multi-export save flow, not a brand-identity aspiration. Worth treating these as raw material, not a finished five-brand list.

127. What three brands would you be unhappy to be mistaken for?

> **Open.**

128. Name a piece of software whose visual identity you admire and would not copy. Why wouldn't you copy it?

> **Open.**

## 4.5 Color

129. What color is forbidden? (The obvious trap for a kaleidoscope brand is the rainbow gradient. Say whether you agree.)

> **No source found — open.**

130. Does the brand palette need to sit under the output, or beside it? Your actual output is wildly, unpredictably colorful. That is an argument for a near-neutral brand.

> **No source found — open.**

131. Is there a color you have unconsciously used across your existing work? Check your VJ output, your prints, your site.

> **No source found — open.**

132. Dark UI or light UI, and is that a brand decision or a tool decision?

> **[B]** The app itself currently runs a dark-first design-token system (`tokens.css`) — worth noting this describes the *tool's* current state, which may or may not be the same answer as the *brand's* intended direction the question is actually asking about.

## 4.6 The mark

133. List every surface the mark must survive: App Store icon, favicon, monochrome, embroidered, projected, printed small on a postcard, animated. Which of these is the hardest constraint?

> **No source found — open.**

134. In an App Store grid, what will Fold's icon sit next to? What do those icons look like? What is the shape of the gap?

> **No source found — open.**

135. Does the mark need to be legible as "symmetry," or can it be a form that only makes sense once you know the product?

> **No source found — open.**

136. Should the mark be symmetrical? (My position: no. A perfectly radial mark will read as generic in the category. Argue with me.)

> **No source found — open.**

137. Does the mark move? If you had one second of animation, what does it do?

> **No source found — open.**

138. From the noun list I sent: which three territories do you want to sketch first, and which one do you already secretly dislike?

> **No source found — open** (the referenced noun list isn't in any reviewed doc).

## 4.7 Type

139. What typefaces are you drawn to, unprompted?

> **No source found — open.**

140. Is the wordmark lowercase, and does that decision come from taste or from your existing UI convention? (Your app UI uses lowercase labels.)

> **[K]** Confirmed: the app UI convention is genuinely lowercase — `docs/CLAUDE.md`'s own working notes reference "confirm lowercase + minimal" as part of a planned brand pass, and `docs/BACKLOG.md`'s "Global UI / brand pass" item names the same open confirmation. So this is a real, live open decision, not yet settled even internally.

141. Does the wordmark need to work as "fold" alone, "foldworlds" as one word, or both?

> **[B]** Given Q113's correction (the product is "Fold," `foldworlds.com` is just a domain), this likely resolves to "fold" alone needing to work — but worth confirming directly rather than assuming.

## 4.8 The imagined artifact

142. Describe the launch page as if it already exists. What is above the fold? What is the first thing that moves?

> **[K] — a strong existing draft, from `FOLD.md`'s marketing narrative beat list:** lead with the tagline *"worlds within worlds, activate wonder,"* opening on spectacular high-resolution results (a nebula-type image named specifically) before drilling into the loving detail of individual controls (the joystick pan, EV, tap-to-focus). The full 10-beat marketing narrative in `FOLD.md` (origin story → why kaleidoscopes are different → the commissioned Canvas/*Interrupt the Loop* project → the discovery that became the product → why you built it yourself → the build framed honestly → what it is → "it's not about specs" → the invitation) is effectively a first draft of this page's structure already, complete with verbatim quotes marked for preservation.

143. Describe the App Store screenshot set. Five images. What is each one?

> **No source found — open**, though the "nebula" reference and the family-demo Droste photos (Peregrine/Sylvia) are candidate visual reference points.

144. Describe the one image you would use if you could only ever show one.

> **No source found — open.**

---

# Part 5: after the dump

Once this is written, three things fall out of it:

- The **don't-knows** become the competitive scan brief and the technical to-do list.
- The **contradictions** become the interview guide. Every place your answers disagree with each other is a place where a user can break the tie.
- The **commitments** become the straw man: one page of positioning, pricing, and packaging stated as fact, which is the thing you put in front of people to be wrong about.

Bring it back messy. Do not clean it up first.

---

# Part 6: doesn't map above

Material surfaced during pre-fill that doesn't fit any question in Parts 1–4 — captured here rather than forced or dropped. Each item is sourced so it's traceable later.

**Conduit as a multi-app platform strategy.** Fold is explicitly the first of several planned apps sharing common infrastructure (`packages/conduit`, README confirms a real, separate repo with Fold and a second app, "Tap," as named consumers). Past sessions also discuss a third: a zoetrope-style app taking MIDI-driven character positions over looping SVG backgrounds. This is a real platform bet, not speculation — conduit's ownership boundary (mechanism/policy vs. consumer choice/UI) has already been worked out. *(Source: `packages/conduit/README.md`; session transcript `ae08eee8`, 2026-07-15 and 2026-07-18.)*

**"Honeycomb" — a companion app concept.** Named once in a backlog-edit summary: a tiling/honeycomb-pattern companion app serving two use cases — the gallery-show concept already in `FOLD.md`, plus a **personal-meditation** use case not documented anywhere else. Mentioned exactly once; reads as an idea captured in passing, not fleshed out — worth a deliberate follow-up if it's still live for you. *(Source: session transcript `8e2391f1`, 2026-07-21.)*

**The "standalone activation" installation framing.** A specific positioning phrase describing HDMI/AirPlay/NDI-broadcasting phone/iPad hardware as reading like a self-contained *art-installation piece* when running untethered — distinct from, but complementary to, the already-documented kiosk/gallery-show UX work. *(Source: session transcript `ae08eee8`, 2026-07-15, quoted inside a saved plan file.)*

**A recurring, never-explicitly-named design principle: never show a misleading result.** Shows up repeatedly across build history as a real constraint that shaped decisions — rejecting a cheap shader-based camera-preview cheat in favor of real native capture because "the shader grade genuinely is a cheat"; refusing to silently downsample a 48MP capture request; flagging the radial-wedge overlay for showing a smaller sampled area than actually used as "not honest" (tracked as its own backlog item); and a general stated principle that a misleading preview is a worse failure than visible degradation. This functions like an unwritten brand value and may be worth codifying explicitly in `FOLD.md` or a design-principles doc. *(Source: session transcripts `179a2756`, `ae08eee8`, `8e2391f1`, `3179182f`, various dates 2026-07-11 through 2026-08-06.)*

**A Gumroad-vs-App-Store distribution/output-routing comparison.** Beyond the strategic framing already placed in Part 3, a concrete technical comparison exists: Syphon reads best on a Gumroad-distributed DMG (likely blocked in the App Store sandbox, though untested); NDI-to-localhost works on either distribution path and is the sandbox-safe fallback; a future CoreMediaIO virtual camera is flagged as "the strategic option" if App Store-native cross-app routing needs to be first-class later. *(Source: session transcript `8e2391f1`, 2026-07-30.)*

**Shader-engine / marketplace idea.** A Procreate-brush-engine-style layer of built-in and user-created/sellable shaders, connected to the tile/pattern builder and laser-etching prep workflows. Doesn't fit Part 1 (unbuilt) or Part 3 (it's a platform/ecosystem idea, not a customer segment). *(Source: `fold-gtm-positioning.md`.)*

**Hardware/manufacturing partnership ideas.** Certification-style "works with X" partnerships (xTool and other laser cutters, dye cutters, UV printers) and interior-design/wallpaper/dropship tile-manufacturing channel ideas. Doesn't map to any Part 3 segment question — these are channel/partnership plays, not customer segments. *(Source: `fold-gtm-positioning.md`.)*

**Founder motivation / mission material.** From `creative-life-notes.md`: reflections tying the "service to beauty... childlike wonder" framing to reading *This Here Flesh*, plus process notes about prototyping in Claude/Fable before moving to VS Code, and a broader unaddressed "open meta-request" for a cross-project synthesis comparing Drift/Fathom/Zoetrope/Fold/"Tend" as a body of work. The worksheet has no slot for founder-motivation material, but it's some of the highest-signal "why this, why you" content found in any source reviewed — worth a deliberate home (possibly a preamble to Part 3, or its own document) rather than staying buried in a voice-memo transcript. *(Source: `creative-life-notes.md`.)*
