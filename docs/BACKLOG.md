# backlog

Living list of things we want to do, in rough priority order within each section. When something ships, move it to `CHANGELOG.md` and remove from here.

## next up — small UI / quality refinements / known bugs

- **Slice params carry across form switches (product decision).** `sliceScale`, `sliceCx/Cy`, `sliceRotation` are global state keys, so they persist when switching forms (e.g. a large scale set on radial makes droste's annulus oversized). Long-standing shared-state behavior, not a regression. Decide: keep shared (current), make slice params per-form, or reset-the-slice-section on form switch. Daniel noted remembering values is sometimes desirable, so likely a soft default + easy reset rather than a hard reset.
- **Camera preview performance (M1 iPad).** Daniel observed ~12-15fps in live preview (felt closer to 24-30 before; a browser refresh helped, so partly runtime variance). The render path is unchanged since 0.5 — the dominant per-frame cost is the full-res camera texture upload (`engine.updateSourceFrame`; we request up to 3840×2160 in `camera.js`). High-impact lever: request/upload a lower-resolution preview stream (keep a high-res grab only at capture). Also confirm it's not a Build 69 regression via an A/B of Build 68 vs 69 on the same iPad.

- **Droste: true vanishing-point offset (per-tier rigid translation).** The Build 56/57 `drosteOffset` uses Möbius pre-composition — preserves circles but introduces in-tier distortion (slight non-conformal stretching from the generalized Lenstra) which Daniel reads as "rotation forced onto a 2D plane" rather than a true viewer-down-a-tube vanishing-point shift. The clean math: per-tier rigid translation. Each tier k has its own canvas-space center `c_k = offset · (1 − 1/zoom^k)`. Per pixel: determine tier (approximately via `floor(-log|p|/logS)`), translate canvas by `c_k`, apply standard warp on translated position. Produces undistorted concentric circles nested off-center, visible tier seams. Distinct from current Möbius offset.
- **Droste: dimensional rotation / volumetric tilt.** Daniel's "rotate within the volume" — each concentric tier projected at a different angle, as if looking at a tube from off-axis. More complex than the rigid-translation offset; potentially involves projecting source content with per-tier perspective. Lower priority; pairs with the motion shell for time-varying effects.
- **Droste: "true rotation" / pole rotation.** Lower priority per Daniel. Possible directions: post-composition Möbius applied to source `z_src` (rotates the spiral within its frame, distinct from the offset's pole movement); a joystick affordance in the settings panel that maps to whatever math we pick; or a corner-triangle gesture pattern. Strong pairing with the motion shell — animating a rotation parameter over time gives a flowing-water effect.
- **Global reset-to-defaults.** Per-form slice reset shipped in Build 56. If a "reset everything" workflow emerges in testing, add a global button (returns form selection, slice, canvas zoom/rotation, OOB mode, export settings all to defaults — keeping only the loaded source image).
- **Intel Air black-square export — needs hardware access.** Build 39 diagnostics surfaced this; Daniel doesn't have access to test. The probe currently passes (FBO complete, `clear`+`readPixels` returns the cleared color) but the actual shader render comes back all-black. Likely an Intel iGPU driver bug with large FBOs OR VRAM exhaustion on integrated GPUs. The Build 40 e2e diagnostic test now correctly catches this case (was throwing in Build 39); next time the hardware is accessible, run diagnostics + check `endToEndTest.summary.allZero` for confirmation, then design a render-validation step into the probe itself.
- **M5 Firefox 8K cap — resolved via UX (Build 40).** The M5 Max "limited to 8K" finding was Firefox's Resist Fingerprinting capping `MAX_TEXTURE_SIZE` at 8192. Not a hardware issue. Build 40 surfaces a contextual notice in the export area + augments the upload-error text. Tile-rendering workaround to exceed Firefox's cap is deferred (complex; would need either WebGPU port or multi-pass FBO composition). Leaving as deferred unless cross-browser parity becomes strategic.
- **WebGL context loss/restore.** Build 21's GPU FBO probe prevents the "framebuffer incomplete" export from triggering a context loss. If a gray screen recurs in any other scenario, add a `webglcontextlost` + `webglcontextrestored` handler pair on the preview canvas to re-init the GL state cleanly.
- **Refine segment defaults for each form.** Reconsider the canvas defaults an min/max values for each form as well as the setment defaults and ranges. This should help maintain continuity across forms.

### mobile chrome — Build 81 device-test follow-ups (2026-06-02)

From Daniel's first iPhone PWA test (installs + runs + live camera all working). Three were fixed in Build 84 (touch-rotate runaway [verify on device], flip icon, tab popover toggle); the rest:

- **Mobile landscape mode (its own build — IxD).** Currently portrait only. Landscape layout: left→right = OUTPUT, vertical divider grippy, CONTEXT (source/settings), vertical tab bar on the right. Must flip portrait↔landscape *during use without interrupting the live source feed* (so an in-place relayout, not the boot.js reload-switch — or a reload that re-acquires the camera seamlessly). Dynamic-Island padding only when rotated island-to-the-right (so the vertical tab bar clears it); detect orientation + which side the island is on. Pairs with the PWA bottom-anchor item below (both are about reclaiming screen edges).
- **PWA tab-bar bottom anchoring (iPhone).** In installed standalone the tab bar floats well above the screen bottom (the rounded-corner safe area). Daniel's idea: round the tab-bar icon hit-targets to follow the phone's corner radius so the bar can anchor at the true bottom edge. Investigate whether `env(safe-area-inset-bottom)` is being double-counted vs. genuinely needed; decide between (a) anchor at true bottom with corner-aware icon placement, or (b) keep the current safe inset. Interacts with landscape (the bar moves to the right edge there).
- **Mobile settings ordering + OOB as a canvas control + slice/canvas headings.** The mobile settings list is mis-sequenced (e.g. on Droste, composition zoom/rotation sit above spiral; "reset slice" is dumped at the very bottom). Target order for every form: form/slice settings (segments, scale, rotation, thickness, spiral, tier mirror, … as they apply) → **reset slice** button → canvas settings (composition zoom, rotation, out-of-bounds). Treat **OOB as a canvas control** sibling to comp zoom/rotation (drop its dedicated header) on **both** desktop and mobile. Give mobile the same **"slice" / "canvas" section headings** desktop uses (replacing the single generic "settings" header). Well-specified; spans mobile settings builder + desktop `index.html` OOB block.
- **Touch-rotate runaway — confirm Build 84 fix on device.** Fix shipped (fixed orbit center); couldn't reproduce remotely. If it persists, instrument pointer x/y + geom center + per-move delta during a phone rotate drag to find the real cause.

(Already tracked elsewhere, surfaced again in this test: **preserve source across a chrome switch** — still loses the live video / selected image on a mobile↔desktop resize [capability-tier follow-up]; **snap the grippy to dock at top/bottom** [UI polish]; **minimum wedge sample size ~20px clamp** [capability tier].)

## next up — new forms

These all benefit equally from the registry architecture — each is one new file in `src/engine/forms/` plus one line in the registry. Order is rough; pick whichever sounds most fun.

- **Hyperbolic Escher (circle limit).** Tessellation of the Poincaré disk model of hyperbolic geometry. Output is a circular image with shapes crowding toward the edge, like Escher's *Circle Limit* prints. Heavy lift: needs custom overlay (circular disk boundary + warped fundamental triangle) and custom controls (Schläfli tiling selector). The Droste form (Build 41) introduced the `drawOverlay` / `classifyPointer` schema hooks that this form can reuse — the engine-schema-extension lift is already done. Distinctive Escher-feel; significant aesthetic differentiation.
- **p31m wallpaper (future).** Alternate triangular tiling — same equilateral triangles as p3m1, but with mirror axes running through vertices rather than along edges. Fully seamless (passes the no-visible-seams design constraint). Visually distinct from p3m1, especially at triangle centers vs. corners. Lower priority than the above; vocabulary expansion rather than a foundational form.
- **Radial polygon-frame variation (low priority).** Cosmetic enhancement to the existing radial form: optionally render with an n-sided polygon outer boundary instead of a circular arc. Same fold math, same n-fold rotational symmetry, just a different visible frame shape. Constrained to even sides matching segment count (4-segment radial → square frame, 6 → hex frame, 8 → octagon frame, etc.) for seam compliance. May emerge organically as a side effect of tile-aware features since polygon framing relates to tileable output shapes. Not a separate form; a parameter on radial.

**Design constraint for all new forms:** No visible seams on any output. Forms without sufficient mirror symmetry (pinwheel-only patterns like p3, p6, p4, etc.) are explicitly excluded — they show seams between fold cells which breaks the kaleidoscope illusion. Glide-reflection groups (pmg, pgg) are also excluded because glide axes can produce visible discontinuities depending on source image content. Rectangular mirror groups (pmm, cmm) are excluded for a different reason — they're visually redundant with the existing square form's aspect-ratio control. With p3m1 shipped (Build 32), p31m is the only remaining wallpaper group that adds distinct visual vocabulary while reliably satisfying the seam constraint.

Pairs well with the live-camera shell. Having more forms available makes the camera shell more demoable and surfaces form-switching UX issues earlier. New forms can drop in at any time as opportunistic parallel work; they cannot destabilize other phases because each form is a self-contained file plus a registry entry.

For each new form, also fill in `tilesPerDim(state)` so the resolution hint is accurate.

## next up — capability tier

**Layering vocabulary (settled — refined to Engine / Kit / Components / Chrome).** "Shell" was conflating layers with different reuse profiles, which made each use case sound like a rebuild. It isn't:

- **Engine** (`src/engine/`) — forms, shader, gl, geometry. Pure pixels, zero DOM. Never rebuilt.
- **Kit** (`src/kit/`, `shell/state.js`, `history.js`, `params.js`) — DOM-agnostic primitives shared by every front-end: state schema, undo/redo, **snaps** (droste arms/spiral), parameter registry, tween/easing + keyframe model (to build). Plus **Host services** (composable, not UI): camera (`shell/camera.js`), render-driver loop, export (`engine.exportAt` + `shell/zip.js`). Grows over time; never rebuilt.
- **Components** (`src/components/`) — mountable UI mounted by BOTH chromes, **parameterized (e.g. touch-target size), not forked**: the **source-overlay** (draw + hit-test + the expensive proportionality/mirroring gesture math), **output gestures** (pinch/twist), and the **param-control renderer**. The source-overlay's event handling must never be reimplemented per chrome. Never rebuilt.
- **Chrome** (`src/desktop/`, `src/mobile/`) — layout, divider, tab bar, disclosure, gesture routing, mode detection. The only layer genuinely rebuilt per device.

**Two front-ends, plus a deferred third:** the **desktop chrome** (current, extended — serves desktop still, still animation, video animation, and live camera on **iPad**, which stays on the desktop chrome) and the **mobile chrome** (new — touch, phone-class viewports; serves mobile still editor, mobile camera, live capture-to-disk). Camera is a *host module* wired into both, not its own chrome. The mobile chrome opens to a **source-picker / empty** state (not camera-first); the keyframe/timeline editor is desktop/iPad only. A live MIDI/kiosk VJ surface is a possible third, shape TBD.

The single most important shared insight: **a state snapshot is the universal currency** — it powers undo today, becomes a keyframe, is the A/B endpoint for live-transition tweening, and is the captured raw-frame edit state. Build the tween primitive once; it serves live transitions, keyframe interpolation, and random-mode drift.

Sequence below leads with mobile-still because it carries zero new engine/infra risk (pure re-presentation of existing capability), it's the first consumer that validates the registry, and it makes camera a cheap follow-on. The animation track is conceptually clean but front-loads the heaviest net-new infra and is desktop-only — better second.

**Shipped — see CHANGELOG (Builds 65–80).** Phase 0 (parameter registry), Phase 0.5 (camera host + desktop/iPad wiring), the save-composition / save-package(.zip) export model, the Components extraction (snaps→Kit, `createSourceOverlay`, `createOutputGestures`, `mountRangeControl`), the full **mobile chrome** (boot/mode-detect, sticky-divider layout, SOURCE↔SETTINGS, icon tab bar with source/form popovers, live camera + capture/go-live + flip, full settings incl. stateful controls, the save sheet with the lazy max-res probe, portrait fill/fit toggle), and the **PWA** (installable, standalone, offline service worker).

**Future / follow-up:**

- **Export package layers.** Extend the package zip beyond composition + original to include the source thumbnail with the wedge overlay drawn on it, and a full-size transparent PNG of the fold geometry. The overlay is already drawn to a 2D canvas in `overlay.js` (`drawSourceOverlay`); the lift is rendering it at export resolution and adding zip entries. Pairs with tile-aware export.
- **Desktop control-widget migration.** Desktop keeps its hand-authored slider DOM; a later pass migrates it to the shared `mountRangeControl` renderer so both chromes render from one source (behavior already shared — only the markup is forked).
- **Canvas pan state (`canvasOffset`).** One-finger drag on the mobile OUTPUT is a no-op until a canvas-translate state key + shader uniform exist.
- **Mobile undo/redo.** The shared snapshot model (`shell/history.js`) makes it available; the source-overlay component exposes `onCommitStart`/`onCommitEnd` hooks.
- **Preserve source across a chrome switch.** The responsive reload carries slice/canvas params but not the source image/camera. Persist the uploaded image (blob → IndexedDB) and re-`setSource` after reload; live camera re-prompts.
- **Camera controls — platform-limited (research finding).** iOS Safari `getUserMedia` exposes only facingMode + a resolution request; zoom / lens-select (.5×/1×/tele) / EV / WB / focus and the ImageCapture API (48MP stills) are unsupported. A rich camera-settings mode (lenses, EV, WB, 48MP) needs the native Capacitor wrapper (`FOLD.md` monetization Phase 3). Build any camera UI capability-driven (`getCapabilities()`) so it lights up if more becomes available. (Note: "take still" via the `capture` file input already gets native full-res stills today.)
- **iOS file-picker redundancy.** "choose photo/file" always offers "Take Photo" on iOS (redundant with "take still"); no web way to suppress it — native-wrapper only.
- **Proper opening / first-run screen** (mobile + desktop).
- **UI polish:** refine the placeholder icons (settings/direct-manip, flip, source/form/capture glyphs), grippy-divider finesse, snap the grippy to dock at top/bottom, **real PNG app icons** for the iOS home screen (currently an SVG → iOS falls back to a screenshot).
- **Per-form default normalization.** p3m1/hex feel like much tinier samples than radial/square/droste at the same `sliceScale`. Tighten per-form defaults (likely per-form default scale + decoupling slice-param passthrough) so forms feel relatable when switching.
- **Minimum wedge sample size.** Slice scale can shrink the wedge to ~1px where the affordance UI breaks; clamp to a ~20×20px floor per form.

### animation + performance track (later, desktop-first)

- **Phase 3 — Tween/easing kit + still-animation.** Tween primitive SHIPPED (Build 82). A/B loop motion mode SHIPPED (Build 83). **Multi-keyframe timeline CORE SHIPPED (Build 87):** N-keyframe data model (`motion.keyframes`), timeline track with saved-state thumbnails + scrubber + loop bookend, add/select/delete, play/pause/loop/stepper, total duration, explicit select-to-edit write-through, discrete locked to kf0. Output toolbar (Build 86) homes undo/swap/motion. Build 88 added: + keyframe inserts-after (never overwrites) with even auto-spacing, sequential edit→add flow (add leaves nothing selected; marker-click = write-through edit), monochrome centered notches + white scrubber, settings gating (non-animatable controls dimmed/disabled in motion mode). Drag-to-retime SHIPPED (Build 90, v0.6.0), with non-destructive sequential add once retimed. **Fast-follows for the timeline:** **motion smoothing** — global easing control SHIPPED (Build 91, v0.6.1, linear↔ease blend); still pending: the richer **smooth-through spline** (Catmull-Rom for continuous velocity through keyframes, no stops at each) and **per-keyframe ease** handles. tween filmstrip SHIPPED (Build 94, v0.6.4); anchor/auto-space spacing model + affordance-hide-on-playback SHIPPED (Build 93). Still pending: pinch-zoom/pan + scale-to-fit, previous/next PiP output monitors (held loosely — large track thumbnails may suffice, esp. iPad portrait), per-segment rotation winding (+N turns), per-marker contextual menu, and **cross-form keyframe transitions** (a keyframe can be captured under a non-kf0 form via exit→change form→re-enter; playback ignores its discrete and select now renders it consistently as kf0's form, but there's no elegant way yet to author a form/segment *change* across the loop — relates to the discrete-transitions crossfade item below).

  **Revised near-term sequence (Daniel, 2026-06-02):** (1) multi-keyframe timeline → (2) **video export** → (3) **load video loops as source** → (4) gesture-record flows → (5) discrete transitions, only if a compelling case surfaces. Video export + video loops were deliberately nudged ahead of gesture flows.

  **Motion-mode + view-control home — output toolbar.** STARTED (Build 86): a top toolbar on the output area homes the non-parameter "view" controls: undo/redo (relocated from the bottom so it doesn't compete with the coming timeline), swap, and the motion toggle. **Vision (backlog):** grow this toolbar into the home for everything that isn't a setting but got squeezed into the panel — current-source display, change-source, export, build/version info — pulling that cruft out of the settings panel over time.

  **Multi-keyframe timeline — design direction (Daniel, 2026-06-02).** North star: **Procreate Dreams / latest iMovie** — uncluttered, precise, intuitive, powerful; not tiny/tedious, not cartoonish ("fun because the content is interesting, not because we picked a playful font"). Priority stories in order: add keyframes, scrub the whole animation quickly, edit/delete keyframes, realtime playback + looping, (eventually) export. Control areas:
  - **Global transport:** play/pause, step fwd/back, loop on/off, save/export, total duration (stills).
  - **Timeline track:** keyframe outputs + the tween rendered across the visible span (preview strip).
  - **Keyframe-edit lane above the track:** create/select/edit-properties/delete. Ticks + occasional timestamps for a sense of duration, but **relative keyframe position is the focus, not absolute "33s in."** Each keyframe = a tappable notch + dot; tap selects and reveals contextual options.
  - **Scrubber** drags along the track.
  - **Add-keyframe is a global control that drops at the current scrubber position** (leaning this over binding it to the scrubber).
  - **Zoom/pan:** defaults to fit the surface; pinch-zoom + two-finger pan; a global "scale to fit."
  - **Motion mode hides (or disables — open Q) the non-smooth controls** (form switch, segment/arms count, mirror toggles) so only animatable params are offered.

  **Loop model (refined).** Keyframe 0 is the start AND is rendered again at the END of the timeline as the loop-return target, so the user sets the spacing between the last authored keyframe and that return (controls tween-back duration). KF0's **wedge persists as a low-opacity ghost** (onion-skin) while authoring; the final keyframe tweens into it.

  **Rotation winding — per-segment property (refined, Daniel).** Shortest-path is sometimes correct; replaying every fiddle is not. So winding is an **explicit per-segment property**, not a global unwrap: default direct/shortest, opt-in "+N turns," plus captured winding from gesture/record mode. Each keyframe is intent to move smoothly from the previous state to this one without inadvertently reversing or replaying detours. (Revises the Build 82 always-shortest-path angle handling for the multi-keyframe model.)

  **Output comparison — PiP (refined, Daniel).** Wedge-outline onion-skin helps, but we ultimately need to compare the actual previous OUTPUT with the current: a small **picture-in-picture of the previous state** top-left of the current output, with an option for **side-by-side**. Needs rendering two states at once (stateless engine supports it via a second target). Also needed later for live-capture/Syphon (compare current output vs. adjusted next params).

  **Animation project file (JSON).** Consider including a JSON in the download package that can be re-loaded to recreate/edit an animation later.
- **Phase 3.5 — Random / live-wallpaper mode (cheap offshoot).** Generative slow parameter drift on the continuous loop + easing kit — the wedge gently pivots and properties gradually shift as a live-wallpaper-style output from a still image. "Animation without authoring"; can ship right after the tween primitive exists, before full keyframe UI.
- **Phase 4 — Video export + video-file loops.** **Video export SHIPPED (Build 96, v0.7.0):** WebCodecs `VideoEncoder` → mp4-muxer (H.264 .mp4), frame-by-frame via `engine.exportFrame` with non-square aspect (1:1/4:5/16:9), resolution (1080p/1440p/4K, FBO-capped), fps (24/30/60). **Video-export follow-ups:** global output aspect (WYSIWYG non-square preview) SHIPPED (Build 98, v0.7.2) — applies to still + video export. **Companion "how it was made" video (delighter):** an opt-in checkbox in the export sheet to also download a second video of the SOURCE with the moving wedge overlay — same fps, square, capped ~1920×1920 (usable as 1080p in either orientation), no extra settings. **Also:** MediaRecorder fallback (non-WebCodecs browsers). (Resolutions 1080p/2.5K/3K/4K/6K SHIPPED Build 97; bitrate auto ~0.1 bpp.) **Still ahead — load video loops as a source** (`<video>.src` = file) reusing the Phase 0 video plumbing; the timeline becomes media-bound; loop-lock matches first/last-frame params for looping source video.
- **Gesture-record mode (backlog; data model must support it now).** Record the continuous parameter stream while manipulating; detect return to the start ghost as the loop point; smooth (low-pass/spline) + simplify to sparse keyframes to remove jerk/pauses. A second authoring mode on the SAME tween engine — a keyframe list is just a sparse sampled curve, and both resolve to state-at-time-t, so design the timeline data model to accommodate it now. Especially valuable once Fold's live output Syphons into Arena (our output becomes a source like an iPhone camera). Sequenced after video.
- **Discrete transitions via crossfade (deferred — only if compelling).** The excluded params (form, segments, arms, oobMode, mirror toggles) can't tween as smooth geometry, but could CROSSFADE (render two states, dissolve) — most valuable for form→form. Shares the render-two-states capability with the PiP comparison. Daniel: explicitly NOT now; revisit only if the use case proves compelling after the basics (and after video).
- **Phase 5 — Live motion (mobile) + external output.** Mobile chrome gains live-transition tweening (reuses Phase 3 kit — smart ease between previous and new settings during direct manipulation) and record-to-disk (reuses Phase 3 export). **External live output** (Syphon / virtual camera into Resolume Arena) is the one piece the browser can't do natively, for *both* live camera and live video-file playback — e.g. an M1 Mac running Fold with a long source file, manipulating wedges live, Syphon → an M5 Mac running Arena projecting. Needs a native wrapper (see `FOLD.md` monetization Phase 4); out of browser scope, tracked there.
- **Deferred: Live performance shell (MIDI / kiosk).** Akai APC40 MK2 input, touch-as-primary, full-screen, no chrome. Possible third front-end (shape TBD) — the VJ performance surface, distinct from the camera-input feature.
## mobile UX exploration notes (historical — the mobile chrome shipped; kept for rationale)

Pre-build design inputs. The mobile chrome (Builds 70–80) resolved these; retained only as a record of the reasoning.

### Daniel's initial sketch

A 4-step conceptual flow for the photo-import path:

1. Add an image
2. Modify shape and properties (change image if needed)
3. Tune canvas settings
4. Export settings and save

Initial state: load image prompt. Once loaded, possible vertical split between source/wedge view and kaleidoscope preview. Realistically, can't show preview + wedge selector + settings simultaneously. Most controls likely hidden in a hamburger menu (or possibly tab bar — leaning hamburger because detailed text labels like "change image" and "export kaleidoscope" need room).

### Counter-perspective (from prior conversation, captured for discussion)

- The 4-step flow describes the *photo-import* path. The *camera-first* path probably wants a different entry: camera is already live, kaleidoscope is already on screen, the interaction is "frame the world, capture." Camera live as the default mode on mobile.
- On split-screen wedge-and-preview: consider wedge overlay drawn *on top of the live camera feed* rather than in a split. Phone is small; every pixel counts. Toggle between "wedge view" (camera + overlay, no kaleidoscope) and "kaleidoscope view" (full-screen output) with a single tap.
- On hamburger vs. tab bar: argued for tab bar because discoverability matters when showing this to friends who've never seen it; hamburger hides everything behind one tap. Counter-argument: text labels matter and tab bar may not have room.
- On controls: phone shell probably exposes form, segments, composition zoom, canvas rotation, aspect ratio (for square form). Hide advanced controls (OOB clamp/mirror/transparent modes) behind an "advanced" sheet.

### Tilt-to-rotate consideration (caveat)

Briefly considered using gyroscope for canvas rotation. Conflict: capturing a shot requires angling the device, so device-tilt-as-input would fight the primary interaction. Likely not viable. Captured as a noted-and-declined idea unless someone has a clever variant.

### Animation features on mobile

Motion shell / keyframe timeline features should be explicitly gated to larger viewports for now. Keyframe editing on a phone screen is a worse experience than on a laptop, and the camera-first phone story is complete without it.

### Before code starts

Do a divergent IxD exploration session — sketches, possibly an interactive prototype in Figma — with Daniel driving. The dual-perspective notes above are the inputs, not the answer. Produce 2–3 distinct layout/flow approaches, compare, pick one, then build.

## tile-aware features

Cluster of related capabilities for treating Fold output as tile / wallpaper content rather than standalone images. Likely to evolve from a research item to a real feature as the gallery installation concept matures (see `FOLD.md`).

- **Snap-to-tile canvas zoom.** For each form, the canvas-zoom slider has natural snap points where the output is exactly one unit cell of the form's wallpaper tiling (or an integer multiple). Identify these snap points mathematically per form, then surface them in the UI — either as hard snap behavior or as visual indicators on the slider. Daniel reports visually-repeating patterns appearing at certain canvas-zoom-out levels; initial geometric analysis suggested this was feasible for square only, but the visual evidence suggests the analysis was incomplete. Revisit with a screenshot of the working repeat pattern to make the geometry concrete.
- **Snap zoom to repeatable increments** At least the Droste form allows zoomed states that repeat. This will be helpful when we add keyframes for animation to be able to save a loopable zoom sequence by returning to a visually identical state that is technically zoomed in.
- **Tileable cell export.** Export only one unit cell of the tiling, not the full mosaic. Filename labels the tiling group. Crops to the unit cell shape: square cells from p4m, hexagonal cells from p6m, triangular cells from p3m1. Acceptance: exported cell tiles seamlessly when placed in a repeating grid.
- **Non-square tile output for snapping.** For forms with non-square fundamental domains (hex, triangle), export the actual polygon shape (transparent background outside the polygon, or vector-cropped). Enables downstream tools to snap multiple cells together — e.g., a collaborative gallery installation where visitor outputs snap into a larger hexagonal composition. Architecturally similar to tileable cell export but with alpha mask or vector boundary.

## research / speculative

- **Source video instead of source image.** Superseded by the planned video-file-input feature in the capability tier; remove this entry when that ships.

## monetization / sharing

Full narrative and rationale lives in `FOLD.md` under "monetization paths." Work items only here, in priority order:

- **Phase 1 (next): PWA + Ko-fi tip jar.** Zero new code beyond a Ko-fi link on the landing page. Audience-building. No paywall.
- **Phase 2: Walled-garden subscription brand.** Page-routing-level auth gating via a third-party platform (Patreon, Ghost with paid memberships, or similar). Parent brand candidate: `curioustools.art`. Not blocking on launch; builds on Phase 1 audience.
- **Phase 3: Native iPad app via Capacitor.** Web code as core, native shells for Pencil pressure / Files app / Photos library / share sheet / Shortcuts. Paid in App Store at $5–15. Apple Developer account ($99/yr) + 15–30% cut.
- **Phase 4 (sidebar): Native Mac wrapper for Syphon out.** Electron or Swift wrapper for direct routing into Resolume. Standalone POC spike, not main codebase. Lower priority than OS-level workarounds (OBS Virtual Camera, NDI) which work today with zero code changes.
- **Phase 5 (deferred): Photoshop PSD export.** Not a plugin. Export kaleidoscope output + original image + wedge as separate PSD layers for clean handoff.

The license choice (AGPL-3.0) preserves all of these options without locking any of them in.

## gallery installation work

Curatorial frame and full concept in `FOLD.md` under "gallery show concept." Work items only here:

- **Cloud folder I/O handshake.** Fold reads source images from a configured cloud folder, writes outputs to another configured cloud folder. Fixed paths. Clean handshake. Upload UI, moderation queue, and gallery display rotation are *not* Fold's job — they belong to a separate sibling app. This is the architecturally clean way for Fold to participate in a gallery installation without absorbing scope it shouldn't carry.
- **Guided Access kiosk compatibility verification.** Test Fold's PWA install on iPad Pro 12.9" in Guided Access fullscreen mode. Confirm gesture/touch behavior, that no UI element opens external links, that the app survives extended use without crashing. Shared concern with the Drift project's kiosk-mode backlog item; investigate in tandem.
- **Document-camera source mode.** A variation of the live-camera shell where the camera is positioned overhead pointing at a table of objects. Visitors arrange objects; the kaleidoscope responds in real time. Architecturally identical to the live-camera shell; possibly just a different default form / framing.

## developer tooling backlog

- **GitHub Actions CI:** `npm run build` on push to main, deploy preview to Vercel on PR. (Vercel handles this automatically via its GitHub integration; CI workflow is for adding `npm run lint` / `npm run typecheck` etc. when those exist.)
- **A `npm run check` script** that runs `node --check` against every JS file in `src/`. Useful as a pre-commit hook.
- **Visual regression harness.** A small node script that loads each form at default settings, exports at 1K, and diffs against a saved baseline. Catches accidental shader regressions.
- **Source-mapped production builds.** Vite does this by default, but worth verifying when we deploy.

## open architecture questions

Three former questions here are resolved by the layering vocabulary now recorded in the capability tier above (Engine / Kit / Host / chrome) — kept as brief settled notes so the reasoning isn't lost:

- **Engine input contract (→ Phase 0 spike).** The engine should accept HTMLImageElement, HTMLVideoElement, HTMLCanvasElement, ImageBitmap, and VideoFrame as a texture source, since `gl.texImage2D` natively accepts all of these. Confirm with the 30-min spike in Phase 0 before camera/video work; if it doesn't, the refactor is small.
- **Mobile is a distinct chrome (settled).** Not a responsive retrofit of the desktop chrome — a separate front-end pointed at the same engine, rendering the shared parameter registry. This is the commitment that makes the pro-and-playful product story possible (see `FOLD.md`).
- **Shared infrastructure for video sources (settled).** Camera (MediaStream), video file (`<video>.src = file`), and animated still (parameter timeline) are *host modules* over a common continuous render driver, not three separate code paths. The Phase 0.5 camera host is the first; video-file input (Phase 4) and the tween-driven timeline (Phase 3) plug into the same driver.
- **WebCodecs availability for video export (Phase 3 detail).** Prefer WebCodecs `VideoEncoder` for frame-perfect output; fall back to `MediaRecorder` if unsupported. Codec preference: mp4/h264 if available, webm/vp9 otherwise. May need to expose codec choice in advanced export settings.
