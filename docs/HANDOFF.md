# handoff

This document is for whichever Claude session picks the project up next. **It is the rolling source of truth** for project state, recent decisions, and what's queued. Edit it as the project evolves; archive snapshots if you want history (or rely on git).

If you're a Claude reading this for the first time in a new session: read this entire doc, then `BACKLOG.md`, then skim `ARCHITECTURE.md` if relevant to what Daniel is asking about. `CHANGELOG.md` is per-version detail you usually don't need.

## who & what

Daniel Nelson is building a browser-based kaleidoscope tool for high-resolution still-image output. He's a VJ (Resolume Arena + Akai APC40 MK2), technically savvy but identifies as a non-developer. He's iterative, evidence-based, and methodical — runs builds locally, reports back specifically with what works and what doesn't, catches Claude's UI hallucinations.

He prefers **no em dashes** in his own writing; respect that in any prose Claude generates for him.

## current version

`v0.3.1 · Build 53`. The footer in the running app shows this string from `src/version.js`. When delivering a new build, increment BUILD by 1 and bump VERSION when meaningful change ships. **BUILD never resets** on version bumps — it's a global monotonic counter (see `version.js` comment).

## what's working

The full kaleidoscope app is functional and tested. Three forms (radial, square, hex), full slice + canvas controls, direct manipulation on the source overlay, export at 1K through GPU-max, all OOB modes, drag/swap/divider, scrub fields with pointer lock, slider sync.

Daniel has tested Build 19 and reports core functionality "all working great." Build 20 added docs and license. Builds 21-23 are an iPad touch pass. Build 24 adds session undo/redo: divider touch + wider hit target, coarse-pointer slider thumb sizing, overlay grip-line affordance removed, overlay two-finger pinch for slice scale + rotation + repositioning (midpoint of fingers drives position), preview canvas two-finger pinch for canvas zoom + rotation, canvas zoom min lowered to 0.15, GPU FBO size probe with 2D canvas encoding check (fixes export failures on iPad).

## current state of the architecture

Vite project, single static-site bundle. Engine in `src/engine/`, shell in `src/shell/`, single `src/main.js` entry. Forms registry pattern: each symmetry form is a self-contained module in `src/engine/forms/`. Adding a new form = one new file + one line in `forms/index.js`.

Read `ARCHITECTURE.md` if you need details on the registry, shader composition, or `env` runtime container.

## what we're doing right now

Build 53 makes a fundamental math change: **the log-shear is gone, replaced by the Lenstra conformal map.** Daniel's fresh-eyes review of Build 52 surfaced that even at the canonical "spiral" settings (arms=1, mirror=off, twist=360°), we were producing nested concentric circles instead of one unbroken spiral. Root cause: log-shear has circular tier boundaries. Lenstra's tier boundary is a log-spiral curve in canvas — that's what makes the spiral *spiral*.

Side benefits of going conformal:
- Möbius swirl now composes into a true sphere rotation (no shear distortion).
- The β=0 stability problem stays fixed: Lenstra at `c = (1, 0)` (twist=0) is exact identity — no singularity.

Also new: **canvas-side offset** (`drosteOffsetX/Y`) — the PhotoSpiralysis "shift the visible center" effect. Applied before the warp as `p ← p − (1 − |p|)·offset`, this moves each tier's ring boundary off-axis. Distinct from `drosteShift` (source-side drift, Build 52), which stays in the codebase.

Three direct-manipulation handles on the source overlay form a bullseye at zero: filled light-blue diamond (offset, innermost) inside a filled white dot (shift, middle) inside an open white ring (swirl, outermost). Hit zones priority by size: 9/14 (offset, mouse/touch) → 11/18 (shift) → 14/22 (swirl). Tight at zero; **Build 54 will add panel sliders + reset-defaults** for ergonomics.

Planned next builds:
- **Build 54:** UI — panel sliders for offset/swirl/shift, reset-to-defaults across the app, handle disambiguation.
- **Build 55+:** pole rotation (third DOF on the Möbius family).

**What Daniel needs to verify in-browser for Build 53** (Claude can't see the UI):
1. **Spiral test (canonical):** `arms=1, mirror=off, twist=360°`. Expect ONE unbroken spiral from outer ring to center — not concentric rings. If still concentric, the Lenstra math is wrong.
2. **Canvas-side offset:** drag the diamond → visible ring centers walk off-axis (PhotoSpiralysis aesthetic). Outer ring stays put.
3. **Conformal swirl:** drag the open ring → spiral pole moves with shape-preserving rotation. No more shear distortion.
4. **Mirror + offset:** check for any tier-boundary seam introduced by canvas-side offset under `drosteMirror = true` — the `(1 − |p|)` factor doesn't go to 0 at tier boundaries, so a faint seam is possible. Flag if visible.
5. Filename suffix gains `ox<XX>y<YY>` for canvas-side offset.

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
