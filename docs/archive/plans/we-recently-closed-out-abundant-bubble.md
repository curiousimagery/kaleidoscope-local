# Arc plan — "Flows, Guardrails & Tiling"

## Context

We're closing in on a feature-complete V1. The last arc shipped output modalities (NDI, HDMI/AirPlay) and turned the clip editor into a full Loop Builder (B385–B396). What we've *never* done is a disciplined pass on **sensible defaults, contextual guardrails, and how users move between modes** — so the app has accumulated confusing flows (a motion clip force-fed into the loop wizard; a trim that dumps you back into a still; slice gestures that change segment count by accident) even as the surface has grown.

This arc fixes that discipline gap **and** uses the same work to lay reusable rails for the next creative surface. Scope was set with Daniel:

- **Center of gravity:** Flows & Guardrails first (doubles as V1 hardening), then Tiling + SVG overlays on those rails.
- **Tile builder:** a **builder surface invoked from Still** (a contextual/interstitial surface), reusing the three-panel `.stage-split`, *not* a new top-level mode. This is the sequencing seam the future companion/gallery app will reuse.
- **One ride-along capability:** Droste **infinite zoom**. Frame interpolation, perform multi-clip crossfade, and audio-reactivity are **deferred** (details captured in BACKLOG, not built this arc).

**An open architectural thread this arc must resolve:** the Loop Builder is *currently both* a dedicated top-level mode **and** a contextual flow entered on motion load — which is inconsistent with the tile-builder-as-surface direction. Part of this arc is deciding whether to demote the Loop Builder to an interstitial/modal surface so "builders" read as contextual across the board (Daniel's lean). That decision reshapes the motion-flow work, so it's front-loaded into a design checkpoint (Movement 1).

Intended outcome: the shipping flows become opinionated and safe, and we end the arc with three reusable rails — **intent-routing** (detect → route → set defaults), **geometry-truth** (one source of truth for the slice/tile shape), and the **contextual builder surface** — that the tiling work and the future companion app both ride.

The reserved backlog home for the spine is [BACKLOG.md:143](../../Code/kaleidoscope-local/docs/BACKLOG.md#L143) ("App-wide mode-transition guardrails + opinionated flows · ▶ DEFERRED"). Some sub-decisions are already made there (e.g. [BACKLOG.md:116](../../Code/kaleidoscope-local/docs/BACKLOG.md#L116): segment- and form-change-after-keyframes = "allow with warning").

---

## Scope at a glance

**In this arc**
- **UX/flow strategy** (design checkpoint): the intent-capture model (how/when we learn "is this a loop?" / "loop or bounce?") + the Loop-Builder mode-vs-surface decision.
- Motion-flow guardrails: trim→motion fix, wizard escape CTA, open-motion-file routing, linear (non-loop) motion editor, bounce playback (motion + perform), motion-defaults-to-16:9.
- Slice/gesture parameter discipline: lockable segment count + Droste offset (default locked) with unlock toggle + tighter segment hit-target; autoplay exclusions; seam-prone props locked in animation; hard restrictions → warning gates (as the shared destructive-interrupt pattern).
- Droste **infinite zoom** (rides the Droste parameter work).
- Geometry-truth: honest slice overlay across canvas aspect ratios.
- SVG export overlays: (a) slice-region-over-source, (b) repeatable-shape edge outline.
- **Tile builder** surface over Still (single tile | repeating grid), **rectangle first**, then hex/triangle; snap-to-tile zoom.

**Deferred (capture new details in BACKLOG, don't build)**
- Frame interpolation (loop editor + motion slomo) — home [BACKLOG.md:159](../../Code/kaleidoscope-local/docs/BACKLOG.md#L159).
- Perform multi-clip crossfade (3–7 source slots, retain slice, crossfade source underneath, live-gesture-only) — new item under Fold Live.
- Audio-reactivity (FFT/signal → params) — homes [BACKLOG.md:62-63](../../Code/kaleidoscope-local/docs/BACKLOG.md#L62).
- Companion/gallery app (hex/triangle honeycomb, meditation grid) — Strategic/gallery.
- Shader / other live-source input — cross-ref Syphon input [BACKLOG.md:80](../../Code/kaleidoscope-local/docs/BACKLOG.md#L80).
- The pure hardening/perf cluster (Safari camera-starve, Firefox export, Chromium untested) — stays parallel; not this arc's focus.

---

## Sequencing (movements)

Each build-movement decomposes into shippable builds; every build does the four-part maintenance ritual (see Cross-cutting). Later movements (5–6) get their own detailed sub-plan when reached — they depend on Movement 4 landing.

### Movement 0 — Backlog curation (docs-only kickoff)
Fold the new specifics from this conversation into BACKLOG.md before building: refine the deferred items (perform multi-clip = "retain slice overlay, crossfade source underneath, 3–7 slots, live-gesture-only"; companion app's two use-cases; shader-input note), and stub the in-scope items under their families so the arc's builds have homes. Docs-only → no version bump.

### Movement 1 — UX strategy & flow architecture (design checkpoint · no code)  ·  ✓ RESOLVED 2026-07-20
Decisions (with Daniel):
- **Intent-capture = infer + opt-in override.** On motion-file load, do NOT auto-open the wizard. Open straight into the correct editor with an inferred default; expose playback intent as a single reversible chip (loop ↔ bounce); "make a seamless loop" is an opt-in action, not a forced step. **Principle: infer a sensible default, interrupt only for the decision that changes routing, and make every such choice reversible in one tap.**
- **Inferred default = linear / play-as-is** (arbitrary uploads usually aren't seamless loops; loop authoring is the opt-in). True loop auto-detection (first/last-frame compare) is a later enhancement, NOT a gate for this arc — default + let the user flip it.
- **Loop Builder = contextual surface, not a top-level mode.** Demote it from the mode list to an opt-in modal/interstitial surface invoked from Still/Motion (and the "make a seamless loop" action) — consistent with the tile builder; makes "pre-looped content forced into the wizard" impossible by construction. New access point = the opt-in CTA (removed from the top-level mode menu).

Implications carried into Movement 2: the load→infer→route flow replaces the auto-open-wizard behavior (source-host.js:162); the trim→motion fix + escape CTA still apply; the mode menu loses its Loop Builder entry.

### Movement 2 — Motion-flow guardrails
Make opening/routing a motion file opinionated and consistent, per the Movement 1 decisions.

**Locked architecture (2026-07-21): realtime NEVER reverses video.** Motion and perform only ever play FORWARD loops. **Bounce is a baked artifact only** — bake a bounce (the loop builder's existing forward→reverse→forward-loop path) to get bounce anywhere; there is NO realtime bounce toggle. Un-baked non-loop content loops with an honest visible restart; loop-detection + the UX-tail nudges guide the user to bake, and that visible jump is itself the self-correcting signal. (Rationale: realtime video reverse = per-GOP ~0.5–2GB at 4K + a second bursty decode workload on the live pipeline + a fragile subsystem in the app's most cross-browser-sensitive layer; baking sidesteps all of it with better quality and no ceiling.)

Builds: **A** (done) → **C** motion loop/linear authoring → **D** auto-detect + route + Loop-Builder demotion; **B** (perform declutter) and **E** (16:9 default) are independent small polish that slot anywhere; **tail** = informational nudges.

- **Build A — Trim→motion fix** (SHIPPED B397 ✓): the trim-only branch [clip-editor.js:714](../../Code/kaleidoscope-local/src/shell/clip-editor.js#L714) commits and returns without switching modes; mirror the bake tail [clip-editor.js:858](../../Code/kaleidoscope-local/src/shell/clip-editor.js#L858) (`hideLoopSurface(); motionBtn.click()` + relayout) so a trimmed clip lands in the motion editor, not a still.
- **Build B — Perform declutter (small, independent).** With no realtime bounce toggle, this is just decluttering: move the PiP/view (PiP↔panel) selector into a new **"⋯" overflow menu** (Daniel: the selector is "totally unnecessary" in the main band) — a button to the **right of the transition-speed slider**, **outlined button style matching motion**, opening a **popover list**; initially only the view selector lives in it. Transition + playback speed stay put. New component (overflow button + popover) → UI Lab. (The Loop Builder access button moved to Build D; the nudge to the tail.)
- **Build C — Motion loop-vs-linear authoring (SHIPPED B399 ✓).** Repurpose `motion.loop`: motion playback **always loops** (forward); the toggle now means "**is this clip a loop**" — loop-clip (endpoints tied to the loop point, via kf0-return + discrete-lock at tween.js:157 and motion-runtime.js:197/466/666) vs. linear-clip (independent endpoints, for authoring genuine non-loop animations). **Status = an explicit "is this a loop" on/off control** (primary-intent framing) with the consequence shown as lightweight secondary text — there is NO realtime bounce. Pre-bake, a linear clip loops with an honest visible restart; the nudge points to baking for a smooth bounce. Switching enforces/frees first&last keyframe matching; manual override allowed. **Persist `isLoop` in the motion JSON** (`motionToJSON`) so clips carry loop-ness onto the deck/stage — bundle with the filed "motion JSON doesn't remember aspect" fix as one JSON-completeness pass.
- **Build D — Auto loop-detection + infer/route + Loop Builder demotion.** (D1 detection + open-into-motion routing SHIPPED B401 ✓ — desktop/iPad; `LOOP_MATCH_THRESHOLD`=10 needs real-clip calibration; mobile load flow unchanged. D2 = Loop Builder demotion from the mode menu + modal chrome (X-close / cancel / header) + dedicated access button between the mode switcher and undo/redo in motion + perform — SHIPPED B404 ✓; UI Lab specimens for the header + button still to land.) Detect loop-ness by comparing first vs. last frame (non-match → not a loop: new uploads + trim-only path; match → loop: some uploads + all baked bounce/crossfade output). Seed the "is this a loop" state from it (overridable); motion routes to linear vs. loop authoring accordingly. **Demote the Loop Builder from the top-level mode menu to a contextual surface**, accessed by a dedicated **Loop Builder button between the mode switcher and undo/redo, in both motion and perform** (also the bake path the nudges point to). Baking a bounce/loop from any mode returns to the originating mode with the clip now detected as a loop. (Replaces the auto-open-wizard on load, source-host.js:162.)
- **Build E — Motion defaults to 16:9** (+ sensible-defaults pass): set `session.frameAspect = 16/9` at motion entry (mode handler main.js:1177-1201), *only if the user hasn't explicitly chosen*, mirrored in motion-runtime + mobile.
- **Tail (late-arc) — informational call-outs.** When the app infers or auto-changes something, surface a small learnable nudge: non-loop content → nudge toward baking a loop/bounce in the Loop Builder (the honest visible restart on un-baked linear content is itself the self-correcting signal); after baking, announce the clip is now treated as a loop. Ties to the systematic destructive-interrupts / tooltips design-system items.

### Movement 3 — Slice/gesture parameter discipline (+ Droste infinite zoom)
Stop accidental edits; make animation seam-safe; soften hard restrictions.
- **Per-param lock:** new `env.isLocked(key)` riding the existing editability seam beside `canEditDiscrete()` (main.js:274), threaded into the overlay (source-overlay.js:56-61). Lock map lives on `session`/`env.locks` (state is flat-global, not per-form). **Default-locked: segment count + Droste center offset**, with an unlock toggle in segment settings (new component → UI Lab).
- **Tighter segment hit-target:** lower the generous `SPOKE_BAND_OUT_*` constants ([overlay.js:34](../../Code/kaleidoscope-local/src/shell/overlay.js#L34)) and the droste-arms bands (droste.js:664-665).
- **Autoplay exclusions + honor locks:** single chokepoint `fields()` at [drift.js:48](../../Code/kaleidoscope-local/src/kit/drift.js#L48) — filter out Droste offset + spiral, and drop any locked key.
- **Seam-prone props locked in animation** (default): seam-creating Droste props don't tween/animate by default; ties to the filed Droste-seams gate ([BACKLOG.md:115](../../Code/kaleidoscope-local/docs/BACKLOG.md#L115)).
- **Warning gates instead of hard restrictions** (decision already made, [BACKLOG.md:116](../../Code/kaleidoscope-local/docs/BACKLOG.md#L116)): loosen the CSS `body.motion` lock (styles.css:1141-1145) and add gates at the form switch (controls.js:306), segments slider (main.js:562), and overlay discrete bail (overlay.js:1207). "Apply to all keyframes" = write into every `motion.keyframes[i].snap`. Build as the **shared destructive-interrupt pattern** ([BACKLOG.md:185](../../Code/kaleidoscope-local/docs/BACKLOG.md#L185)), not one-off `window.confirm`s, and land it in the Lab.
- **Droste infinite zoom** (ride-along): animate `canvasZoom` across exactly one factor-of-`drosteZoom` interval — the render is periodic under radial scaling by `drosteZoom` (math at droste.js:170-176), so it loops seamlessly. Cleanest with offset centered — which the default-locked offset above reinforces. Shares the "zoom snap-point" concept with tiling's snap-to-tile zoom (Movement 6).

### Movement 4 — Geometry truth (the bridge to tiling)
Make the slice overlay honest across canvas aspect ratios — the foundation the SVG + tile work builds on.
- The overlay is drawn **entirely in source space** and never reads `session.frameAspect` (overlay.js:75,193-194,222), so rotating output aspect doesn't reshape the wedge — the filed dishonesty ([BACKLOG.md:30](../../Code/kaleidoscope-local/docs/BACKLOG.md#L30), [:346](../../Code/kaleidoscope-local/docs/BACKLOG.md#L346)). Fix: clip/intersect the drawn region against the output-frame crop derived from `frameAspect` (inverse of the shader's `u_outputAspect` transform, shader-builder.js:150-152), reusing the existing `oobLeft/Right/Top/Bottom` machinery.
- One source of truth to preserve: `form.buildPolygon(state)` + `sliceVecToSourceUV` ([engine/geometry.js:19](../../Code/kaleidoscope-local/src/engine/geometry.js#L19)) feed the live overlay, the SVG export, the tile outline, and the tile-builder preview — do the honesty fix here so all four inherit it.

### Movement 5 — SVG export overlays
Add vector layers to the download package (labeled seam already exists: "future layers (overlay thumbnail, geometry map)").
- **(a) Slice-region-over-source SVG:** the per-vertex UV path already computed every frame in `drawSourceOverlay`; emit it as an SVG path scaled to true source pixels. Raster precedent: `renderSourcePreviewFrame` (motion-runtime.js:145). Caveat: the saved full-res original is *uncropped*, so scale against true source aspect ([BACKLOG.md:317](../../Code/kaleidoscope-local/docs/BACKLOG.md#L317)).
- **(b) Repeatable-shape edge SVG:** the fundamental-domain outline in *output* space — net-new (backlog "non-square tile output" [:238](../../Code/kaleidoscope-local/docs/BACKLOG.md#L238)); depends on Movement 6's output-space tile geometry. **Rectangle first** (simplest outline), then hex/triangle.
- **Assembly:** add SVG blob entries at the two `zipStore` call sites (source-host.js:735-738, motion-runtime.js:2107-2125). Backlog item: [BACKLOG.md:247](../../Code/kaleidoscope-local/docs/BACKLOG.md#L247).

### Movement 6 — Tile builder (surface over Still)
A focused contextual surface invoked from Still: **single tile | repeating interlocking grid**.
- **Rectangle first.** Rectangle (`square` form, p4m) already exposes its tile size as a uniform (`squareAspect`, square.js:24-29) — nothing to promote — so it's the fastest form to dial the whole builder in on. Then extend to hex/triangle by **promoting the hardcoded `HEX_SIZE`/`TRI_SIZE` GLSL constants to per-form uniforms** (same `square.js` template). Only rectangle/hex/triangle are tileable (radial/droste are not).
- **UI:** reuse the `.stage-split` sibling-panel system (already documented "third-panel-ready": DOM index.html:174-250, CSS styles.css:40-108, layout main.js:329-472), each panel its own small engine instance (the `pipEngine` pattern, perform-runtime.js:60). Two render targets: fundamental cell + full grid. The full-grid render *already exists* — folding into the fundamental cell **is** the interlocking mirror-tiled output. Framing (modal/interstitial vs. panel) follows the Movement 1 decision.
- **Snap-to-tile zoom** ([BACKLOG.md:236](../../Code/kaleidoscope-local/docs/BACKLOG.md#L236)): output = one unit cell / integer multiple; shares the zoom-snap concept with Droste infinite zoom.
- Feeds Movement 5(b) — output-space tile outline geometry.

---

## Cross-cutting obligations

- **Four-part maintenance per shippable build** (per CLAUDE.md): `version.js` BUILD++ and VERSION patch++; CHANGELOG entry; HANDOFF update; BACKLOG move/add. Per-increment, not batched.
- **Cross-platform coverage.** Plan *and* verify each feature, as applicable, across the full target matrix; each build must name which targets it affects and the verify step must cover them:
  - **Mobile web** — iPhone + iPad in Mobile Safari.
  - **Desktop web** — Brave, Firefox, Safari (Brave is our Blink/Chromium check — Chromium export is *wholly untested*).
  - **Capacitor builds** — iPhone + iPad.
  - **Desktop Electron** build.
  - Not every feature touches every target (e.g. the tile builder is desktop/iPad-first; overlay locks matter most on touch) — but the affected set is named, not assumed.
- **UI Lab discipline:** every new component/style lands in the Lab in the same increment — the **segment-lock toggle + lock icon/mark** (relates to the "locked keyframe pin" note, [BACKLOG.md:196](../../Code/kaleidoscope-local/docs/BACKLOG.md#L196)), the **destructive-interrupt / warning-gate pattern**, and the **tile-builder panels**. Check the Lab for existing coverage before inventing.
- **Conduit lens:** the geometry-truth source-of-truth, the intent-routing pattern, and the contextual builder surface are all candidates to be built once-and-shared rather than Fold-specific — flag if a clean extraction seam appears (esp. for the companion/gallery app).
- **Verify-queue debt:** Loop Builder B395/B396 are "untested by Claude" (docs/VERIFY-QUEUE.md). Movement 2 touches the same wizard, so device-verify those touchpoints as it lands.

---

## Verification

Movement 1 is a design checkpoint — its "verification" is documented decisions + Daniel sign-off, no app to drive. For every build-movement, drive the real app (via the `run` skill) and observe behavior (via the `verify` skill) across the affected slice of the cross-platform matrix above — Daniel is the source of truth for on-screen behavior.

- **M2:** load a video → trim-only → land in the motion editor (not a still); open a pre-looped clip → the intent moment behaves per the M1 strategy + skipping is frictionless; non-loop clip → linear editor (first/last can differ) + bounce playback in perform; enter motion cold → 16:9 default (explicit aspect choice respected).
- **M3:** drag segment count / Droste offset → locked by default + unlock toggle works + tighter target; autoplay on Droste → offset/spiral don't wander; change segments/form mid-animation → warning gate (not a hard block) + "apply to all keyframes" writes through; Droste + animate canvasZoom → seamless zoom loop. (Touch targets checked on iPad + iPhone.)
- **M4:** rotate 1:1 / 16:9 / 9:16 → the overlay wedge reshapes to reflect the actual output crop.
- **M5:** export a still package → zip contains the slice-over-source SVG aligned to the original; export from a tileable form → shape-outline SVG matches output (rectangle first).
- **M6:** open the tile builder from Still on rectangle (then hex/triangle) → single-tile and grid panels track; adjust tile size → grid density changes; snap-to-tile zoom → output = one clean unit cell.
- **Cross-browser/platform:** exercise each new surface across its named targets (mobile Safari iPhone/iPad, Brave/Firefox/Safari desktop, Capacitor iPhone/iPad, Electron); flag anything that needs the deferred hardening lane.
