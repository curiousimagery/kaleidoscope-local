# handoff

This document is for whichever Claude session picks the project up next. **It is the rolling source of truth** for project state, recent decisions, and what's queued. Edit it as the project evolves; archive snapshots if you want history (or rely on git).

If you're a Claude reading this for the first time in a new session: read this entire doc, then `BACKLOG.md`, then skim `ARCHITECTURE.md` if relevant to what Daniel is asking about. `CHANGELOG.md` is per-version detail you usually don't need.

## who & what

Daniel Nelson is building a browser-based kaleidoscope tool for high-resolution still-image output. He's a VJ (Resolume Arena + Akai APC40 MK2), technically savvy but identifies as a non-developer. He's iterative, evidence-based, and methodical — runs builds locally, reports back specifically with what works and what doesn't, catches Claude's UI hallucinations.

He prefers **no em dashes** in his own writing; respect that in any prose Claude generates for him.

## current version

`v0.5.14 · Build 88`. The footer in the running app shows this string from `src/version.js`.

**Mobile follow-ups from Daniel's Build 81 device testing (2026-06-02).** The PWA installs and runs on iPhone (chrome hidden, live camera works). Build 84 fixed three issues: touch-rotate runaway (suspected fix — **needs on-device confirmation**, couldn't reproduce remotely), the broken flip icon, and the tab popover toggle. The rest are queued in `BACKLOG.md` under "mobile chrome — Build 81 device-test follow-ups": mobile landscape mode (its own build, IxD), PWA tab-bar bottom anchoring (entangled with landscape), preserve source across a chrome switch, mobile settings ordering + OOB-as-canvas + slice/canvas headings, divider dock-snap, and the overlay min-size clamp.

**Versioning policy (Daniel, Build 80):** the VERSION **patch bumps every code-shipping build** now (alongside the monotonic BUILD), so each deploy advances `X.Y.Z` → `X.Y.Z+1`; minor/major still bump for milestones. Docs-only changes bump neither. (Codified in CLAUDE.md.)

## NEXT (fresh session, Opus Max): Phase 3 — still-animation loop (desktop-first)

The mobile + PWA arc is complete. The next chapter is **animation**, starting with the still-animation loop on the desktop chrome. This is a new, architecture-heavy phase — start it in a fresh thread with full context.

**The leverage already in place:** a **state snapshot is the keyframe currency** (same shape as an undo entry / `shell/history.js`). The continuous **render-driver loop** pattern exists (mobile live loop; `engine.render(state)` is stateless). So animation = interpolate between snapshots over time and render each frame.

**Build order (each its own build):**
1. **Tween/easing primitive — `src/kit/tween.js`. SHIPPED (Build 82).** `lerpState(a, b, t, easing)` interpolates two state snapshots; `tween.js` owns the canonical field classification (params.js can't — the direct-manip-only fields and `drosteSpiral` aren't declarative). Continuous fields lerp (`sliceScale`, `sliceCx/Cy`, `sliceRotation`, `canvasZoom`, `canvasRotation`, `squareAspect`, `drosteZoom`, `drosteSpiral`, `drosteOffsetX/Y`); discrete fields hold (`form`, `segments`, `drosteArms`, `oobMode`, `drosteMirror`, `drosteWedgeMirror`); the two angles take the shortest path around 360°. Easing: `linear`/`easeIn`/`easeOut`/`easeInOut` (default). No UI; invisible build.
2. **A/B loop playback (the doc's v1). SHIPPED (Build 83).** Motion-mode toggle (canvas group) → contextual transport footer: set/jump A & B, play/pause, loop, duration scrub, scrubber track. Driven by `lerpState` over a continuous rAF loop (modeled on `startLiveLoop`); playback renders interpolated snapshots transiently (working `state`/sliders/undo untouched). Gated to a still source, mutually exclusive with the live camera. Layout: `<body>` is now a column with the existing split wrapped in `.work-row`; footer hidden == identical to before. Plan: `~/.claude/plans/we-re-ready-to-start-silly-rabin.md`.
3. **Multi-keyframe timeline footer (desktop chrome). CORE SHIPPED (Build 87) — needs Daniel's in-browser pass; fast-follows pending.** Shipped: N-keyframe data model, the timeline track with saved-state thumbnails + scrubber + loop bookend, add/select/delete, play/pause/loop/stepper, total duration, explicit select-to-edit write-through, discrete locked to kf0. **Fast-follows:** drag-to-retime, pinch-zoom/pan + scale-to-fit, prev/next PiP monitors, per-segment rotation winding, gesture-record, fuller settings gating. **IxD-sensitive — Daniel drives the timeline UI.** **Detailed design direction is captured in `BACKLOG.md`** (animation track, 2026-06-02): Procreate-Dreams/iMovie north star; control areas (global transport / timeline track / keyframe-edit lane / scrubber); **loop-bookend** model (KF0 rendered at both start and end as the loop-return); **per-segment rotation winding** (default shortest-path, opt-in +N turns — revises Build 82's always-shortest-path); **output PiP comparison** (previous state vs current); motion-mode hides non-smooth controls; add-keyframe drops at the scrubber; pinch-zoom/pan + scale-to-fit; JSON project file. **Output toolbar STARTED (Build 86):** undo/redo + swap + motion moved off the output's edges to clear the bottom for the timeline. **Revised sequence:** timeline → video export → video loops → gesture-record → (discrete transitions only if compelling).
4. **Video export host module.** WebCodecs `VideoEncoder` preferred (mp4/h264) → MediaRecorder fallback (webm/vp9). Render each interpolated frame via the FBO path (like `exportAt`) and feed the encoder. Gate to larger viewports (desktop/iPad).

**Decisions settled with Daniel (2026-06-02):** (1) **A/B prove-out first**, then generalize to a multi-keyframe list later; (2) **discrete params locked for the whole loop** (only continuous fields animate); (3) **loop = a toggle that tweens the end back to the start** (no manual loop-lock, no ping-pong). Default easing `easeInOut`. Still open for the multi-keyframe build: the timeline UI (Daniel drives), output aspect/fps for video export. **Verify:** a 2-keyframe loop interpolates smoothly and loops seamlessly. Full Phase 3/3.5/4/5 framing is in BACKLOG ("animation + performance track") and the plan doc `~/.claude/plans/i-d-like-to-think-parsed-sloth.md`. When delivering a new build, increment BUILD by 1 and bump VERSION when meaningful change ships. **BUILD never resets** on version bumps — it's a global monotonic counter (see `version.js` comment).

## what's working

The full kaleidoscope app is functional and tested. Three forms (radial, square, hex), full slice + canvas controls, direct manipulation on the source overlay, export at 1K through GPU-max, all OOB modes, drag/swap/divider, scrub fields with pointer lock, slider sync.

Daniel has tested Build 19 and reports core functionality "all working great." Build 20 added docs and license. Builds 21-23 are an iPad touch pass. Build 24 adds session undo/redo: divider touch + wider hit target, coarse-pointer slider thumb sizing, overlay grip-line affordance removed, overlay two-finger pinch for slice scale + rotation + repositioning (midpoint of fingers drives position), preview canvas two-finger pinch for canvas zoom + rotation, canvas zoom min lowered to 0.15, GPU FBO size probe with 2D canvas encoding check (fixes export failures on iPad).

## current state of the architecture

Vite project, single static-site bundle. Engine in `src/engine/`, shell in `src/shell/`, single `src/main.js` entry. Forms registry pattern: each symmetry form is a self-contained module in `src/engine/forms/`. Adding a new form = one new file + one line in `forms/index.js`.

Read `ARCHITECTURE.md` if you need details on the registry, shader composition, or `env` runtime container.

## what we're doing right now

Build 57 addresses five follow-ups from Build 56 testing:

1. **Source Y-flip fixed globally** in `toSourceUV` — invisible on mirror-symmetric forms, visibly corrects Droste at arms=1 (no more upside-down output).
2. **Export spinner now visible** — removed `setBusy()/clearBusy()` from `doExport` since the fullscreen busy overlay was covering the button's spinner.
3. **Combined diamond + dot into one handle.** Removed `drosteShiftX/Y` state and `u_drosteShift` uniform. The diamond's parameter (`drosteOffsetX/Y`) now drives both the Möbius pre-composition AND the source-side per-tier drift simultaneously. One handle, two effects.
4. **Wedge mirror at arms=1: GLSL no-op + UI hidden.** Removed the Build 54 tier-parity theta mirror block. The wedge-mirror row is hidden from the slice panel when `state.drosteArms === 1` (it's meaningful only at arms ≥ 2).
5. **Smooth spiral seam preview** — when spiral > 0 at arms=1, a smooth log-spiral curve traces the tier-0/tier-1 seam in the source overlay (80 line segments, no jagged silhouette).

Planned next builds:
- **Build 58+:** true vanishing-point offset (per-tier rigid translation; no in-tier distortion). Backlog. "Dimensional rotation" (volumetric tilt where each tier projects at a different angle) backlog.

**What Daniel needs to verify in-browser for Build 57**:

1. **Y-flip fix at default state** (Droste, arms=1, spiral=0, mirror on): upload a clock image. Numbers should appear right-side-up (12 at top), no longer mirrored.
2. **Other forms unchanged**: switch to radial/square/hex/triangle. Outputs should look the same as Build 56 (the Y-flip is invisible under kaleidoscope mirror symmetry).
3. **Export spinner**: click export. Button shows spinner + disabled state; status text below says `rendering …`. **No** fullscreen busy overlay.
4. **Combined offset**: drag the diamond. Expect both the spiral pole shift (rings nest off-center) AND deeper-tier source content drift toward the offset direction. Single handle, no separate dot.
5. **Wedge mirror toggle**: at arms=1, the wedge-mirror row should be HIDDEN. Increase segments to 2+, the row reappears.
6. **Spiral preview**: at arms=1, spiral=1, a smooth log-spiral curve overlays the source thumbnail showing the tier seam. Adjust spiral slider, curve updates smoothly.

Still pending from prior builds: Intel Air investigation (blocked on hardware access). Triangle form still pending production review of `TRI_SIZE`, `tilesPerDim`, and Build 37 fold-transform side effects.

**Strategic sequencing session (2026-05-31):** worked through the multi-version architecture with Daniel and rewrote the `BACKLOG.md` capability tier. Key outcome — "shell" was conflating four layers (Engine / Kit / Host / chrome); only the front-end chrome is genuinely rebuilt per use case, everything below is shared and composed. There are **two front-ends** (desktop, extended; mobile, new) plus a deferred MIDI/kiosk third. Camera is a host module wired into both. The agreed build order is Phase 0 (parameter registry + texture-source spike) → 0.5 (camera host + desktop/iPad wiring) → 1 (mobile still-editor chrome) → 2 (camera in mobile) → 3 (tween kit + still-animation) → 3.5 (random/live-wallpaper) → 4 (video-file animation) → 5 (live motion + Syphon external output). See the `BACKLOG.md` capability tier for the full reasoning.

**Phase 0 — parameter registry: SHIPPED (Build 65).** `src/shell/params.js` is the declarative catalog; the 6 clean sliders (`scale`, `compZoom`, `sliceRot`, `aspect`, droste `zoom`, `canvasRot`) now wire from it via a loop over `DECLARATIVE_PARAM_IDS` through the unchanged `wireSliderWithScrub()`. Stateful controls (segments form-routing, arms-aware spiral fmt+snap, mirror/wedge-mirror/OOB toggles) stay bespoke with catalog-only `PARAMS` entries. No behavioral change intended.

**What Daniel needs to verify in-browser for Build 65:** the registry refactor should be invisible. Exercise every slice + canvas slider (scale, rotation, composition zoom, aspect on square, thickness/spiral on droste, canvas rotation) — ranges, scrub fields, formats (`×`, `°`, p/q spiral fractions), and undo/redo should behave exactly as Build 64. Confirm form-switch show/hide and the droste toggles still work, and that export is unchanged.

**Phase 0.5 — live camera (host capability): SHIPPED (Build 66).** Camera wired into the desktop/iPad chrome. The engine now accepts a `<video>` source (`setSource`/`updateSourceFrame`/`getSourceSize`/`clearSource` in `engine/index.js`; `updateTexture` in `gl.js`); `src/shell/camera.js` is the host module; `main.js` adds the continuous live loop + camera UI; `overlay.js` mounts the live `<video>` in the source view. Capture = freeze + save both (raw + kaleidoscope), stay editable. This also satisfied the Phase 0 texture-source spike (video works as a real source).

**What Daniel needs to verify in-browser for Build 66** (camera path is build-clean but unverified by Claude — getUserMedia needs a real browser + permission):
1. **Start camera:** click "use camera" (allow permission). Live kaleidoscope should animate from the rear camera; the wedge overlay sits on the live feed in the side slot and is draggable.
2. **Controls live:** form switch, segments/scale/rotation, composition zoom etc. all affect the live output in real time.
3. **Flip:** "flip" switches front/rear; front preview is mirrored.
4. **Capture:** "capture" downloads TWO files (the kaleidoscope at the chosen export size + `…-raw.png` at native res), freezes the frame as the editable still, and stops the camera — you can then fine-tune and re-export normally.
5. **Stop:** "stop" returns to the empty placeholder.
6. **iPad:** confirm the whole flow on iPad (the intended capture surface). Needs https (or localhost) — a LAN IP without https will show a secure-context error.

**Build 67 — fixes from Daniel's first iPad camera test (the camera works great on iPad — big milestone).** Addressed: version string (now v0.4.0), front-camera sampling the mirror-opposite side (texture now mirrored to match preview), captured thumbnail disappearing (blob URL kept alive + `env.liveVideo` handle), export spinner regression (double rAF), and capture no longer auto-saves. New capture/export model: **capture freezes the frame as the editable still and saves nothing; the first export saves the unmodified original (raw frame) alongside the kaleidoscope; later exports of the same source save only the kaleidoscope.** Desktop now defaults to the front camera (mirrored); iPad keeps rear default.

**Needs Daniel's re-verification on iPad + desktop:** front-camera sampling now matches the wedge position; captured thumbnail persists and stays editable; export shows the spinner and (first time after a capture) downloads two files; desktop opens the front camera mirrored. Watch the two-file export for browser "multiple downloads" prompts.

**Build 68 — export rework + overlay refinements (Daniel's pre-mobile cleanup).** Export is now two buttons: "export composition" (single file) and "export package (.zip)" (composition + unmodified original in one zip — replaces the Build 67 two-download approach that Safari collapsed to one file). New dependency-free `src/shell/zip.js` (store-only, validated with `unzip -t`). Square form draws one affordance cluster (top edge + right edge + top-right corner + rotate beyond the right edge) instead of all 8; hit-testing unchanged. Rhombus scale band trimmed to a thin interior (4px) + 16px exterior so the interior is mostly a move target.

**Needs Daniel's re-verification:** square shows only the one cluster and rotates cleanly; rhombus has room to move vs scale at small sizes; "export package" produces a valid zip on Safari/iPad with both files; "export composition" is a clean single download.

**Next phase: 1+2 — Components extraction → mobile chrome + camera (IN PROGRESS, approved 2026-06-01).** Refined layer model is now **Engine / Kit / Components / Chrome**: the mobile chrome is NOT a duplicate UI — it mounts the SAME components desktop uses, parameterized not forked. The expensive source-overlay event/proportionality/mirroring math must never be reimplemented per chrome.

Sequence: **(a) extraction pass first**, behavior-preserving, with the current build (incl. **iPad live camera**) as a byte-identical oracle — move snaps to `src/kit/snaps.js`; extract `src/components/source-overlay.js` (`createSourceOverlay(ctx) → {render, destroy}`) and have desktop `main.js` consume it; extract output gestures (`setupPreviewGestures`) to `src/components/output-gestures.js`; extract a registry-driven `mountRangeControl` to `src/components/param-control.js` (mobile-facing; desktop slider DOM stays static this pass). **(b) mobile chrome:** `src/boot.js` mode-detect (phone → mobile, else desktop incl. iPad; `?chrome=` override), `src/mobile/chrome.js` (OUTPUT top + CONTEXT panel bottom + fat sticky grippy divider; context flips SOURCE↔SETTINGS; bottom tab bar with SOURCE/FORM popovers, contextual capture toggle, EXPORT sheet). **Decisions:** mobile opens to **source-picker/empty** (not camera-first); divider has a **soft center detent only**; one-finger output drag is **no-op v1**. **(c) PWA** via vite-plugin-pwa (authorized); verify `getUserMedia` in iOS standalone on Tardigrade.

Full plan in `~/.claude/plans/i-d-like-to-think-parsed-sloth.md`. The export-package zip remains the seam for overlay/geometry export layers (BACKLOG).

**Mobile chrome: at parity + PWA (Builds 70–80).** Core + live camera + icon tab bar (source/form popovers, capture/go-live, flip) + full settings (incl. stateful segments/spiral/mirror toggles + OOB) + the save sheet (diagnostics/format/size/save-package/save-composition + lazy 8192 `probeMaxFBOSize` + res hint) + portrait fill/fit toggle + **PWA** (vite-plugin-pwa: manifest, offline SW, iOS standalone metas, `public/fold-icon.svg`). **On-device verification still needed:** (1) installed standalone hides Safari chrome and the tab bar sits clean; (2) **does `getUserMedia` work in an installed iOS standalone PWA** (historically fragile); (3) real PNG app icons (SVG icon → iOS home-screen falls back to a screenshot). PWA `base` is relative (`./`) — if the SW misregisters on deploy, switch to `/`. Mobile undo/redo stays out of scope. Remaining roadmap is the animation track (Phase 3+, desktop-first) in BACKLOG. Below is the earlier Build-70 detail:

**Mobile chrome status (Build 70):** first increment shipped — the still-editor core. `src/boot.js` selects chrome (phone → `src/mobile/chrome.js`; iPad/desktop → `src/main.js`, unchanged). Mobile mounts the shared components (`createSourceOverlay`, `createOutputGestures`, `mountRangeControl`) in a two-region + sticky-divider layout with a SOURCE/SETTINGS context flip and a minimal tab bar (upload/form/export). **Test it:** load with `?chrome=mobile` in a narrow window, or on a phone — upload an image, drag the wedge (move/twist/pinch), flip to SETTINGS and adjust sliders, cycle the form, export. **Confirm desktop + iPad still load normally through boot (behavior unchanged).** Next increment: camera wiring + SOURCE/FORM popovers + EXPORT sheet + stateful settings controls, then PWA. This is IxD-sensitive — Daniel should react to the layout before it's built out further.

**Extraction pass status (Build 69):** Steps A–C done and building clean — `src/kit/snaps.js` (droste snaps), `src/components/source-overlay.js` (`createSourceOverlay`, desktop consumes it), `src/components/output-gestures.js` (`createOutputGestures`, desktop consumes it). The `overlay.js` drawing/hit-test/gesture bodies are UNCHANGED — only desktop wiring moved — so the intent is byte-identical behavior. **Claude could only build-check; Daniel must verify byte-identical on desktop + iPad before the mobile chrome builds on these:** every overlay gesture (move/scale/rotate/segments/square edge+corner/droste ratio+arms+offset/two-finger pinch), output pinch/twist, form switch, swap, divider resize, undo/redo, export, AND the full iPad live-camera flow (start/flip/capture/package) — all should match Build 68 exactly. Step D (registry-driven `mountRangeControl`) is deferred into the mobile-chrome step (it's mobile-only, can't be verified byte-identical on desktop).

`docs/FOLD.md` owns vision, brand, marketing narrative, monetization paths, and gallery show concept. `docs/BACKLOG.md` capability tier now carries the layered vocabulary and the Phase 0–5 sequence; mobile UX exploration notes, gallery installation work, and open architecture questions sections are present.

## decisions locked in

- **License:** AGPL-3.0, copyright Daniel Nelson. The author retains rights to commercial licensing. This was chosen over MIT to discourage forking-as-competitor while keeping the code openly viewable.
- **Repo:** public.
- **Build counter convention:** monotonic global, never resets on version bump.
- **Docs structure:** `README.md` at root, `docs/HANDOFF.md` `BACKLOG.md` `CHANGELOG.md` `ARCHITECTURE.md`.
- **Form ID is a string** (not numeric index) everywhere. Don't reintroduce numeric form indexing.
- **The `env` runtime container** is the seam between shell modules. Don't add module-level mutable globals; thread state through `env` instead.

## decisions deferred

- **"Scale to tile" canvas zoom snap.** Build 19 conceptual analysis concluded it's feasible only for square output, but Daniel reports visually-repeating patterns appearing at certain zoom-out levels and wants to revisit. Deferred until someone has time to investigate with screenshots. See `BACKLOG.md`.
- **Monetization approach.** Full narrative and phased plan now in `docs/FOLD.md` under "monetization paths." The AGPL license preserves all options.

## what to avoid

- **Don't reset BUILD when bumping VERSION.** It's a monotonic global counter. Read the comment in `src/version.js` if unsure.
- **Don't put backticks inside form GLSL strings.** The `glsl` field in form modules is a JS template literal; a backtick inside breaks parsing silently. The original monolith had a long-running bug from this. (Mentioned in `ARCHITECTURE.md` too.)
- **Don't assume Daniel sees what you describe.** He's caught Claude hallucinating UI elements before (e.g. a "Clip" transport mode option that didn't exist in his Resolume version, in another project). When describing Resolume / Vercel / VS Code UI, be tentative and defer to what he actually sees on screen.
- **Don't introduce new mutable module-level state in shell modules.** Thread it through `env` instead. The `_windowHandlers` and `_overlayDrawPending` patterns from the original monolith have already been ported to env-based equivalents.

## environment / hardware

- M1 Max MacBook Pro
- 500GB WD Black NVMe SSD (USB 3) — used as project drive in some VJ workflows; not relevant to kaleidoscope but noted because it came up
- Akai APC40 MK2 — relevant only for the future "live shell"
- iPad — primary touch target post-deploy, untested until on a public URL
- Browser: Chrome primary

## context from prior sessions worth preserving

Daniel was learning Resolume in parallel with the early kaleidoscope work, and there's a separate `drift` project (a video-art PWA) that shares some architectural DNA but is unrelated functionally. The handoff for Drift mentions "plans to open-source on GitHub" but no license was actually picked there — kaleidoscope is the first of his projects to land on AGPL-3.0 explicitly.

If Daniel asks Claude to look at Drift or Zoetrope (another project of his), they're available in the project knowledge as separate handoff docs.
