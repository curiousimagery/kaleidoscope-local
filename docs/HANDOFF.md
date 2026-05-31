# handoff

This document is for whichever Claude session picks the project up next. **It is the rolling source of truth** for project state, recent decisions, and what's queued. Edit it as the project evolves; archive snapshots if you want history (or rely on git).

If you're a Claude reading this for the first time in a new session: read this entire doc, then `BACKLOG.md`, then skim `ARCHITECTURE.md` if relevant to what Daniel is asking about. `CHANGELOG.md` is per-version detail you usually don't need.

## who & what

Daniel Nelson is building a browser-based kaleidoscope tool for high-resolution still-image output. He's a VJ (Resolume Arena + Akai APC40 MK2), technically savvy but identifies as a non-developer. He's iterative, evidence-based, and methodical — runs builds locally, reports back specifically with what works and what doesn't, catches Claude's UI hallucinations.

He prefers **no em dashes** in his own writing; respect that in any prose Claude generates for him.

## current version

`v0.3.1 · Build 59`. The footer in the running app shows this string from `src/version.js`. When delivering a new build, increment BUILD by 1 and bump VERSION when meaningful change ships. **BUILD never resets** on version bumps — it's a global monotonic counter (see `version.js` comment).

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

Next: review the plan file with Daniel and adjust phase-2 scope.

`docs/FOLD.md` owns vision, brand, marketing narrative, monetization paths, and gallery show concept. `docs/BACKLOG.md` capability tier is reordered (live camera first, then mobile, then motion); mobile UX exploration notes, gallery installation work, and open architecture questions sections are present.

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
