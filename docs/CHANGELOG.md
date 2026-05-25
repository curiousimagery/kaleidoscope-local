# changelog

Newest first. Format: `version (Build N) — date — summary`. Each version section captures what shipped relative to the previous version. Builds are a global monotonic counter; see `src/version.js` for the convention.

---

## v0.3.1 (Build 46) — 2026-05-25

**Droste touch/click polish.** Build 45 iPad testing surfaced seven things to tighten before adding the next feature. All of these are calibration tweaks to existing structures — no new capabilities. Vanishing-point offset is deferred to Build 47 (Daniel's call: don't risk regressions on the polish work).

- **Ring-band hit zones reduced and asymmetrized.** Daniel's "~16 px total, only a few px inside the wedge" rule applies to both ring bands and wedge boundary lines. New values: `BAND_OUT` = 14 px touch / 12 mouse (outside the annulus, where users naturally grab the ring); `BAND_IN` = 4 px touch / 2 mouse (inside the annulus body — reserves the wedge interior for `'move'`). Same asymmetric treatment for `SIDE_BAND` on the wedge boundary lines: 14 px outside the wedge angular range, 4 px inside.
- **Inside the inner ring is now exclusively `'move'`.** Added a priority-4 catch-all: `if (r <= rIn) return 'move'` runs after the ring-band scale and wedge-boundary checks but before the wedge-angular gate. So clicking anywhere inside the inner ring repositions the slice center, regardless of whether the cursor is inside the wedge angular range. (Reserves this region for the future vanishing-point handle.)
- **Touch affordances moved onto the wedge arcs.** The thickness arrow now lives on the **inner arc** at `sliceRotation` (radial direction), the scale arrow lives on the **outer arc** at `sliceRotation` (same direction), and the rotation arc lives **opposite the wedge** at `sliceRotation + π`, just past the outer ring. Build 45 had them in arbitrary "top-of-screen" or "opposite-the-seam" positions; the new placement makes the affordance live where the gesture actually applies.
- **Translucent twisted-wedge opacity reduced.** From 0.5 → 0.3. The twisted-sample preview reads as informational without competing with the solid white untwisted reference.
- **Per-wedge OOB detection.** Build 45 used `cx ± rOut < imgX | imgX + imgW` (the full outer ring's bounding box) which flagged the wedge as OOB whenever the geometric outer circle exited the image — even when the wedge itself sat entirely inside. New check samples 12 points along the outer arc, inner arc (shifted by −twist), and both log-spiral sides of the **actual** twisted wedge; OOB fires only if any sample lands outside the image rect. Full-circle case (arms=1) keeps the simple bounds check.
- **Scrub-field touch hit area enlarged.** `@media (pointer: coarse)` rules expanded for `.scrub`: min-height 28 px (was 18), padding 6/8 (was 2/4), min-width 44 px (was 36). The numeric values next to the sliders now match the slider thumb's tap-target size — Daniel reported the new sliders' touch targets feeling narrower than the existing ones; this was the scrub-field side, not the slider track.
- **Slider thumb on touch enlarged.** `width: 28px; height: 28px` (was 24×24). Adds 4 px to the tap target without crowding the slider track.
- **Code:** [src/engine/forms/droste.js](src/engine/forms/droste.js) (classifyPointer reorganized, asymmetric bands, per-wedge OOB, touch-affordance placement, twisted-wedge opacity), [src/shell/styles.css](src/shell/styles.css) (coarse-pointer scrub + slider thumb), [src/version.js](src/version.js) (Build 46).

---

## v0.3.1 (Build 45) — 2026-05-25

**Droste click/touch refresh + accurate twisted-wedge preview + wedge-mirror toggle + "thickness" rename.** Version bump for the accumulated Droste polish across Builds 41–45. Build 44 testing surfaced four things to refine: the overlay outline didn't match the actual sampled pixels at non-zero twist; the wedge-mirror behavior should be user-toggleable; the click/touch zones hadn't been updated to respect the new wedge visualization; and "zoom" was a misleading label for the inner/outer ratio control.

- **Translucent twisted-wedge overlay.** When twist ≠ 0 and arms ≥ 2, the actual sampled region in source space is drawn on top of the solid untwisted wedge as a translucent outline: outer arc unchanged, inner arc shifted by −twist, log-spiral sides connecting them (the warp `theta_src = theta + (twist/logS)·log r` accumulates exactly one tier of rotation across the radial span). The solid untwisted wedge stays as the click/touch reference + straight-line affordance; the translucent overlay is purely informational ("here are the actual pixels"). At twist=0 or arms=1 the two would coincide, so we skip the translucent layer.
- **Seam direction corrected.** The center seam previously drew from `(rIn, sliceRotation)` outward to `(rOut, sliceRotation + twist)` — same magnitude of bend as the warp but reversed direction. Now draws from `(rOut, sliceRotation)` inward to `(rIn, sliceRotation − twist)`, matching the warp exactly. The twist drag handle moves from the outer ring to the seam's inner endpoint at `(rIn, sliceRotation − twist)`, where it tracks the parameter directly. Cursor-CCW now decreases twist (because the handle's screen angle follows the cursor, and a CCW cursor means smaller screen angle = larger twist). Sign of the twist drag delta flipped to match.
- **Click/touch zones reworked.** Ring band scale hits (inner and outer) now fire only when the cursor is **inside the wedge angular range** — clicking the rings on the side opposite the wedge no longer activates scale or zoom; it just rotates. The annulus body inside the wedge now classifies as `'move'` (was falling through to `'rotate'`), so dragging anywhere within the visible wedge repositions the slice center. Outside the wedge angular range, all drags rotate. Reflects [src/engine/forms/droste.js](src/engine/forms/droste.js)'s `classifyPointer` priority order.
- **Wedge boundary lines draggable for arms count.** A new `'droste-arms'` drag mode in [src/shell/overlay.js](src/shell/overlay.js) lets the user grab the radial side lines (the wedge boundaries, visible when arms ≥ 2) and drag angularly to change the arms count. Cursor's `|angle from sliceRotation|` becomes the new halfWedge; arms = π / halfWedge, snapped to {1, 2, 4, 6, 8, 10, 12}. Twist re-snaps to the new arms count's alignment step via `env.applyArmsSnap` cascade.
- **Wedge mirror toggle (default on, experimental).** New `state.drosteWedgeMirror` plus UI toggle. When on (default): kaleidoscope-style mirror at the angular wedge boundaries — restricted to even arms, produces N/2 visible bilateral petals at non-zero twist. When off: plain angular mod — arms can be any integer in the valid set, the wedges become chiral copies with hard boundary seams. Lets Daniel A/B the bilateral-pairing aesthetic against the "true N arms with visible seams" alternative.
- **"zoom" renamed to "thickness".** The slice-panel label changes from "zoom" to "thickness" (state field, uniform, and HTML id remain `drosteZoom` for internal consistency). The user-facing meaning: the outer/inner ratio determines how wide the annulus is; "thickness" reads more accurately for the visual effect than "zoom."
- **VERSION → v0.3.1.** First minor bump since v0.3.0 shipped triangle in Build 40. Captures the Droste-arms-mirror-overlay-routing-snap suite.
- **Code:** [src/engine/forms/droste.js](src/engine/forms/droste.js) (translucent twisted-wedge draw, corrected seam direction, inner-endpoint twist handle, wedge mirror branch in GLSL + uniform, geom additions for `halfWedge` / `sliceRotationRad`, classifyPointer rework), [src/shell/overlay.js](src/shell/overlay.js) (`droste-arms` drag mode, sign flip on droste-twist), [src/shell/state.js](src/shell/state.js) (`drosteWedgeMirror`), [src/shell/controls.js](src/shell/controls.js) (wedgeMirror conditional label), [index.html](index.html) (thickness rename, wedge mirror toggle DOM), [src/main.js](src/main.js) (wedge mirror toggle wiring, `env.applyArmsSnap` export), [src/version.js](src/version.js) (v0.3.1, Build 45).

---

## v0.3.0 (Build 44) — 2026-05-25

**Droste UX refinements: segment slider reuse, arms=1 back, accurate wedge-arc overlay.** Build 43 testing on iPad surfaced four follow-ups: the overlay's full-circle affordance overstated the sample region (we only sample one wedge, mirrored); the previously-retired arms=1 (single chiral spiral) was missed; the dedicated arms slider felt redundant alongside segments; and the bilateral pairing inherent to wedge-mirror+twist makes "arms=N" read as N/2 visible petals.

- **Segments slider shared with radial.** The `#segments` slider DOM is now one element used by both forms, with form-aware routing: radial drives `state.segments` (range 2–48, step 2); droste drives `state.drosteArms` (valid set {1, 2, 4, 6, 8, 10, 12}, default 2). Range, step, snap function, and bound state field all shift with `state.form`. Custom wiring in [src/main.js](src/main.js) (`setupSegmentsSlider`) replaces the prior `wireSliderWithScrub` call; the standalone arms slider DOM is removed from [index.html](index.html). One fewer slider in the Droste panel; the kaleidoscope vocabulary stays consistent ("segments" works for any folding form).
- **arms=1 restored.** Single chiral spiral / Print Gallery feel. At arms=1 the wedge fold is bypassed and the warp produces the full-circle single-arm spiral that Build 41 originally shipped. The horizontal seam comes back at this setting — Daniel knows. arms ≥ 2 stay restricted to even integers (chirality-parity invariant); the slider snaps through {1, 2, 4, 6, 8, 10, 12} as the user drags. Twist snap step is `360°/N` for N≥2; at N=1 the twist slider becomes continuous (no snap).
- **Annular-wedge overlay.** The dim layer now cuts only the fundamental sample wedge (annular arc spanning `2π/arms` centered on `sliceRotation`), not the full annulus. Two radial lines connect the inner and outer arcs at the wedge boundaries. The rest of the annulus stays dim, signalling "those pixels are mirror-images of the wedge, not independently sampled." arms=1 collapses to the full-circle annulus (no boundary lines). The seam-spiral and twist-endpoint dot are unchanged.
- **State changes:** `state.drosteArms` default stays 2 (separate from `state.segments` which keeps its 12 default). The form-aware accessor handles routing; history's shallow spread captures both fields independently so undo across form switches works as before.
- **Code:** [src/engine/forms/droste.js](src/engine/forms/droste.js) (controls `'arms'` → `'segments'`, uniform extractor allows arms=1, `drawOverlay` cuts annular wedge + draws boundary lines), [index.html](index.html) (removed arms slider DOM), [src/shell/controls.js](src/shell/controls.js) (removed `'arms'` from conditional labels), [src/main.js](src/main.js) (`setupSegmentsSlider`, `armsSnapStep` / `snapTwistDeg` / `applyArmsSnap` hoisted to file scope, removed standalone arms wiring), [src/version.js](src/version.js) (Build 44).

**Known visual property** (not a bug): with arms ≥ 2 + non-zero twist, adjacent wedges are mirror-paired (the wedge fold inverts chirality at each boundary), so N wedges read visually as N/2 bilateral "petals." This is consistent with how the kaleidoscope mirror works across all the forms — radial doesn't show it because radial has no chirality to flip; Droste's twist introduces chirality which the mirror then pairs. To get N truly-chiral arms we'd have to drop the wedge mirror, which reintroduces hard seams at wedge boundaries — the very problem the even-arms restriction was designed to solve. Sweet spot Daniel found: 6+ arms with 3× zoom.

---

## v0.3.0 (Build 43) — 2026-05-25

**Droste refinements: snap-to-arms, even-only arms, log-shear math, single-seam overlay.** Build 42 closed the seam-reduction gap but Daniel's testing on iPad surfaced three follow-ups: twist still allowed arm misalignment between snap-clean values; odd arms produced a chirality-parity seam; the multi-arm seam visual was overwhelming at high arms counts. This build addresses all three.

- **Twist math switched from Lenstra c-multiplier to log-shear.** Build 42's conformal `c = (1−φ)·1 + φ·cPG` had a side effect: the actual rotation accumulated per tier depended on zoom (at zoom=2 with twist=±360° you only got ~±4.5° per tier, almost imperceptible), and the natural N-arm closure values fell outside the slider range. Replaced with a non-conformal log-shear: `theta_new = theta + (twist_rad / logS) · log r`, `logr_new = log r` unchanged. Now `twist_rad` is exactly the rotation accumulated over one tier — independent of zoom. Trade-off: shapes get slightly sheared along the spiral (not conformal), but in the kaleidoscope context with mirror folds it reads as "the picture is twisted by twist°/tier," which is what the slider label promises. `u_drosteC` dropped; `u_drosteTwist` restored as a `1f`.
- **Twist snaps to 360°/arms.** Both the slider's native step and the scrub field's parse path now round to multiples of `360°/drosteArms`. Arms=8 snaps at 0, ±45, ±90, …, ±360. Arms=2 snaps at 0, ±180, ±360. New `snap` and `onSet` options on `wireSliderWithScrub` carry this through. The same snap function is exposed via `env.snapDrosteTwist` so the overlay's seam-drag handler in `overlay.js` snaps too.
- **Arms restricted to even integers (default 2, range 2–12 step 2).** Matches the radial form's segments convention. The wedge-fold's mirror parity is consistent around the full circle only when N is even; odd N produced a visible "connection" seam where the parity flipped. Default changed from 1 to 2 — the "single-arm Print Gallery" look is gone for now, but at twist=0 with arms=2 the visual is still essentially concentric Droste with a horizontal mirror axis. When `drosteArms` changes, `state.drosteTwist` re-snaps to a valid step for the new arms count and the twist slider's native step updates.
- **Single-seam overlay.** Drawing N seam spirals at arms=8 read as visual noise; reduced to a single seam at `sliceRotation` plus one endpoint dot. The N-arm symmetry is implied by the wedge fold rather than literally drawn. Hit-testing checks only the primary endpoint — dragging it adjusts `drosteTwist`, which the wedge fold then propagates to all arms uniformly.
- **Filename suffix unchanged structurally** (`z…t…a…m…`), but values now reflect the snapped twist and even arms.
- **Code:** [src/engine/forms/droste.js](src/engine/forms/droste.js) (GLSL log-shear, single seam, single endpoint hit-test, uniform rename), [src/shell/state.js](src/shell/state.js) (drosteArms default 2), [src/shell/controls.js](src/shell/controls.js) (`snap` + `onSet` options on `wireSliderWithScrub`, slider thumb bounces to snapped position on input), [src/main.js](src/main.js) (`snapTwistDeg`, `applyArmsSnap`, exposed via `env.snapDrosteTwist`), [src/shell/overlay.js](src/shell/overlay.js) (snap in droste-twist drag), [index.html](index.html) (arms slider min/step/default), [src/version.js](src/version.js) (Build 43).

---

## v0.3.0 (Build 42) — 2026-05-25

**Droste seam-reduction + twist=0 bug fix.** Build 41 testing surfaced a hysteresis-flavored bug (slider at 0 didn't visually equal "no spiral") plus three families of seams in the rendered output. This build addresses both via a math reparameterization and two new per-form controls.

- **Twist reparameterized to fix the bug.** The Build 41 GLSL parameterized `α = (logS + iβ)/iβ` — singular at β=0 with a near-singular region just above the threshold, which is why the slider near zero felt undefined. Replaced with a linear interpolation in the complex multiplier `c`: `c = (1−φ)·1 + φ·cPG` where `φ = twist / 360°` and `cPG = 2πi/(logS + 2πi)`. At twist=0 the warp is pure identity (concentric Droste); at twist=360° it's classic Print Gallery; smoothly interpolated everywhere in between. Still conformal at every twist value. The hysteresis disappears as a side effect — no branch, no singular neighborhood. JS computes `c` per render and pushes one `uniform vec2 u_drosteC`; `u_drosteTwist` no longer appears in the shader (state field stays for overlay drawing).
- **Tier mirror (new control, default on).** Replaces the radius mod-reduction with a triangle-wave reflection: tier transitions reflect radially rather than teleporting from inner-ring back to outer-ring. The "type-i" wrap seam (where the picture's outer-ring content meets its inner-ring content) disappears at the cost of alternating tier parity. Toggle in the slice panel; on by default since the default visual reads much cleaner. Composes cleanly with the global `oobMode == mirror` (both are isometries; can stack to produce parity-flipped corners at OOB tiers — a "huh" moment, not a bug).
- **Spiral arms (new control, default 1).** Integer 1–12. Before the conformal warp, θ is folded into a 1/N angular wedge with mirror at the wedge boundaries — same recipe as `radial.js`. Result: N identical spiral arms with mirror seams between them. The "type-ii" angular alignment failure and "type-iii" arm-edge seam are reduced (the wedge boundaries are mirror axes, not visible jumps). Arms × twist are independent — twist stays continuous; at commensurate values (multiples of 2π·k/N) the arms close exactly, and at intermediate values the mirror hides the small alignment offset.
- **Multi-arm seam overlay.** `drawOverlay` now draws N log-spiral seam previews (one per arm) and `classifyPointer` hit-tests all N seam endpoint dots. Dragging any endpoint adjusts twist.
- **Filename suffix expanded.** `z{zoom×100}t{±degrees}a{arms}m{mirror}` — e.g. `z200t045a03m1` = zoom 2.00, twist +45°, arms 3, mirror on. Old `z…t…` filenames remain consistent.
- **Code:** [src/engine/forms/droste.js](src/engine/forms/droste.js) (fold math rewrite, new uniforms `u_drosteC` `u_drosteMirror` `u_drosteArms`, multi-arm seam drawing + hit-test, filenameSuffix, tilesPerDim), [src/shell/state.js](src/shell/state.js) (`drosteMirror`, `drosteArms`), [index.html](index.html) (arms slider + mirror toggle DOM), [src/shell/controls.js](src/shell/controls.js) (`applyFormControls` gating for new control keys), [src/main.js](src/main.js) (slider + toggle wiring, sync registration for undo), [src/version.js](src/version.js) (Build 42).

---

## v0.3.0 (Build 41) — 2026-05-24

**Droste spiral form (initial cut).** Fifth form: a logarithmic-conformal Droste warp (Lenstra & de Smit), producing recursive picture-within-a-picture spirals. The source overlay is bespoke — concentric inner/outer rings define the sample annulus, with a log-spiral seam line previewing the angular wrap. Two new parameters: `zoom` (outer/inner ratio = scale per spiral tier) and `twist` (degrees per tier; 0 = pure concentric Droste, ±360 = one full extra turn per tier). All four overlay manipulations are direct: drag outer ring = scale (existing `sliceScale`), drag inner ring = zoom, drag the seam endpoint dot = twist, drag outside the outer ring = rotate. Two-finger pinch works as on the other forms.

- **New form file:** `src/engine/forms/droste.js`. Per-pixel cost (1 log + 1 exp + a couple multiplies + a mod) is cheaper than hex's axial-coord rounding; 4K preview runs comfortably. The fold function returns `z_src` in the same isotropic fold-space convention the polygon forms use, so the engine's `toSourceUV` aspect correction lands the annulus visually-circular on non-square sources without any per-form path needed.
- **Schema extension (additive):** two new optional fields on the form module — `drawOverlay(env, ctx, geom)` and `classifyPointer(env, x, y, isTouch, geom)`. Forms whose sample region isn't a polygon (Droste's annulus, future hyperbolic disc) own their overlay drawing and hit-testing entirely. Polygon forms (radial, square, hex, triangle) are unchanged — the existing path runs when these hooks are absent. The architecture doc anticipated this escape hatch since v0.0.5; this is the first form that needs it.
- **State additions:** `state.drosteZoom` (default 2.0; range 1.1–16) and `state.drosteTwist` (default 0°; range ±360°). Hidden behind the form's `controls: ['zoom', 'twist']` declaration, so the sliders only appear when Droste is the active form.
- **New env field:** `env.hoverHandle` — a form-specific hover-handle discriminator that lets Droste distinguish inner-ring hover from outer-ring hover for stroke highlighting. Other forms ignore it.
- **New drag modes:** `'droste-ratio'` (inner-ring radial drag adjusts `drosteZoom` with the same relative `r/startR` feel as outer-ring scale) and `'droste-twist'` (angular drag from the seam endpoint adjusts `drosteTwist`, with the seam endpoint tracking the cursor for immediate visual feedback).
- **Filename suffix:** `z{zoom×100}t{±degrees, 3-digit padded, m prefix for negative}` (e.g. `z200t045`, `z350tm120`).
- **Code:** `src/engine/forms/droste.js` (new, ~280 lines), `src/engine/forms/index.js` (1 line), `src/shell/state.js` (2 fields), `src/shell/overlay.js` (drawOverlay + classifyPointer dispatch in `drawSourceOverlay`/`classifyPointer`, new drag-mode branches in `onMove`/`onDown`, hoverHandle tracking), `src/shell/controls.js` (`applyFormControls` extended to handle new control keys), `index.html` (zoom + twist slider DOM), `src/main.js` (slider wiring + `env.hoverHandle` init), `src/version.js` (Build 41).

---

## v0.3.0 (Build 40) — 2026-05-24

**Version bump + Firefox-aware UX + upload error positioning.** Triangle wallpaper form (p3m1, shipped across Builds 32-38) is a meaningful new visual capability — comparable in scope to v0.2.0's session undo/redo. Marking the milestone with a minor version bump. Also: a cluster of UX improvements informed by Build 39's diagnostic data.

- **VERSION bumped to v0.3.0.** Triangle wallpaper form is the v0.3.0 headline.
- **Firefox detection + WebGL-cap notice.** Build 39 diagnostics confirmed the M5 Max's "8K limit" mystery: Firefox's Resist Fingerprinting (RFP) is active by default and caps `MAX_TEXTURE_SIZE` at 8192 — a browser-level limit, not a hardware constraint. (Safari on the same M5 correctly reports 16384.) When Firefox is detected AND the max texture is 8K, the export controls now show a small notice: "Firefox limits WebGL textures to 8K. For higher-resolution export on Apple Silicon, try Safari." Safari/Chrome/Edge see nothing.
- **"Image too large" error augmented for Firefox.** When upload fails with the engine's `image too large for GPU` message AND Firefox-RFP is detected, the message now also reads "Firefox limits WebGL to 8K — try Safari for full-size images on Apple Silicon." On Safari with the same overflow, the message stays as-is (since the cap is then a real API ceiling, not a browser limitation).
- **Upload errors moved to a discoverable location** (BACKLOG item closed). The "image too large", "failed to load image", and "unsupported format" errors used to appear in the `#status` element down by the export button — far from where the user clicked. New `#uploadError` element is inserted right below the upload button. Auto-clears on the next upload attempt. The `#status` element continues to handle export-related status.
- **End-to-end diagnostic test bug fixed.** The Build 39 e2e test was synchronously destructuring a Promise (forgot to `await renderToFBOForDiagnostics`), so it always threw `"undefined is not an object"` instead of running. Now correctly awaits. Diagnostic JSON's `endToEndTest.summary.allZero` is the canary we'll use when the Intel Air becomes accessible to test the "probe passes but render goes black" case.
- **Diagnostic button shows "running..." state** during the async report generation. Disables the button while in-flight to avoid double-clicks.
- **Code:** `src/main.js` (Firefox detection, notice, error rerouting), `index.html` (uploadError div), `src/shell/styles.css` (uploadError + browser-notice classes), `src/shell/diagnostics.js` (async fix + button busy state), `src/version.js` (v0.3.0, Build 40).

---

## v0.2.0 (Build 39) — 2026-05-24

**GPU capability diagnostics surface.** Tooling to gather per-device data about WebGL capability detection. Daniel observed inconsistent results across devices (M5 reports ~8K max export vs M1's ~16K despite similar specs; vintage Intel Air's probe passes but actual export goes black). Build 39 adds a diagnostic panel that exposes everything needed to identify which probe step is mis-firing on each platform.

- **Always-on basic info expansion** in the existing `#diag` element: now also shows the unmasked GPU renderer (via `WEBGL_debug_renderer_info` when available) and `devicePixelRatio` alongside the existing texture/FBO sizes.
- **Run diagnostics button** appended to the diagnostics group. Click to open a full-screen modal panel showing:
  - WebGL version, vendor, renderer (masked + unmasked), max parameters
  - User agent, screen/viewport dims, DPR
  - Per-step FBO probe results for every candidate size (16K, 8K, 4K, 2K) — granular pass/fail for each step (`texImage2D`, `framebufferStatus`, `readPixels`, 2D canvas create, 2D canvas pixel round-trip) so we can see WHICH check is failing at WHICH size
  - End-to-end render+sample test that actually renders through the shader and samples 4 pixel positions plus computes average RGB — catches the "probe passes but export renders black" case
  - Full JSON report (copy-to-clipboard button + selectable textarea fallback for Safari iOS)
- **URL param `?diag`** auto-opens the panel on load — useful when remote-debugging on iPad or other devices without easy devtools access.
- **New module:** `src/shell/diagnostics.js`. **New verbose probe:** `probeMaxFBOSizeVerbose(gl, maxTextureSize)` in `src/engine/gl.js`. **Engine API expansion:** `engine.glContext` (raw GL handle) and `engine.renderToFBOForDiagnostics(state, size)` exposed for diagnostic use.
- **No behavior change** to the existing probe or the chosen `maxFBOSize` — the verbose probe is a parallel implementation, not a replacement. Build 39 is data-gathering tooling; fixes will be planned separately once the cross-device data is in.

---

## v0.2.0 (Build 38) — 2026-05-24

**Hit-test fix for triangle's apex-incident edges.** In Build 37, the rhombus's two apex-incident edges (top-left and bottom-left) appeared as scale arrows but didn't actually fire scale on drag. They fell through to `'move'` mode instead. Root cause: `classifyPointer` measures "distance from the polygon's outer angular boundary," which for a polygon with the slice center at a vertex misses any edge interior to the polygon's angular range. The two apex-incident rhombus edges are *inside* the 60° apex cone, not at its boundary, so they were never within the scale band as measured by the standard logic.

- Added a per-edge perpendicular-distance check in `classifyPointer` (after `polygonRadiusAt`, before CASE A): for any form with `spokeRule: 'none'` AND the slice center coinciding with a polygon vertex, any edge within `SCALE_OUT` perpendicular distance fires `'scale'`. Guarded by `!outsideAngular` so dragging outside the polygon still triggers rotate via CASE B.
- Square is unaffected — its slice center is at the polygon's geometric center (not a vertex), so the `sliceCenterAtVertex` guard fails. Radial and hex are unaffected — they don't use `spokeRule: 'none'`.
- Code: `src/shell/overlay.js` (added ~17 lines in `classifyPointer`).

---

## v0.2.0 (Build 37) — 2026-05-23

**Triangle default-size and orientation tuning for cross-form consistency.** The Build 36 rhombus was correct but visually inconsistent with the other forms — significantly smaller and tilted at 30° while radial and hex sit horizontally. Build 37 makes the triangle's overlay match radial/hex defaults.

- **Rhombus now horizontal.** Fold output rotated by -30° in GLSL (`vec2(cos(t - PI/6), sin(t - PI/6))`), so the long diagonal sits along +X and the rhombus is symmetric across the horizontal axis. Same apex-on-left, wedge-opens-right convention as radial and hex. Kaleidoscope output content rotates by -30° as a consequence.
- **Rhombus matches radial extent.** Fold output magnitude scaled by √3 in GLSL (`r * SQRT3 / TRI_SIZE`), so the far 60° corner now sits at magnitude 1 — same left-to-right reach as radial's polygon (= 0.5 of image width at default `sliceScale`). Kaleidoscope tiles now show √3× more source content per tile; compensate with `sliceScale` if needed.
- **buildPolygon updated** to match the new fold output: corners at `(0, 0)`, `(0.5, -√3/6)`, `(1, 0)`, `(0.5, √3/6)`.
- **`spokeRule: 'hex'` → `'none'`.** All 4 edges are now scale targets. The apex-incident edges (top-left and bottom-left, touching the slice center) can be dragged to scale just like the outer edges.
- **Affordance arrows moved to the 2 topmost edges.** Previously on the two outer edges (top-right + bottom-right after the rotation), which sat close together and overlapped at small sizes. Now on the top-left + top-right edges, which are farther apart geometrically. Selected by sorting all edges by midpoint y and taking the 2 with smallest y.
- **`overlay.js` `drawSourceOverlay`** now treats `spokeRule: 'none'` forms uniformly — all edges go to `outerEdges` regardless of geometric incidence to slice center — so the rhombus's apex-incident edges highlight during scale-drag (previously only outer edges highlighted, leaving the apex-incident edges visually dead during interaction).
- **Code:** `src/engine/forms/triangle.js` (fold output transform + polygon + spokeRule + comments), `src/shell/overlay.js` (edge-split logic + triangle affordance branch).

---

## v0.2.0 (Build 36) — 2026-05-23

**Triangle polygon is the rhombus sample region.** Build 35's full-equilateral-triangle overlay with an internal wedge indicator was based on a wrong analysis of the fold output shape. The actual fold output range is a **60-120 rhombus** (not a 60° pie slice with constant outer radius) — the fold's mirror axes sit 30° offset from the canvas triangle's altitudes, so the max output magnitude varies with fold angle (1/3 at the wedge boundaries, √3/3 at the wedge midline). Build 36 replaces the triangle overlay with this rhombus directly.

- **`buildPolygon`** returns the 4 rhombus corners: `(0,0)`, `(1/3, 0)`, `(1/2, √3/6)`, `(1/6, √3/6)`. The slice center sits at the apex (the `(0,0)` corner), same anchor point as Build 34/35 — no kaleidoscope output change.
- **`spokeRule: 'hex'`** restored. The two apex-incident edges are wedge legs (visual artifacts, not cell boundaries); scale only fires on the two outer edges. Hit-testing for "drag outside the polygon to rotate" is handled by the existing radial-fallback code path.
- **`buildSampleRegion` removed** — the main polygon IS the sample region now. The `buildSampleRegion` plumbing in `overlay.js` is kept as a dormant extension point for any future form whose visual shape differs from its sample region.
- **Affordances** updated: 2 scale arrows on the two outer edge midpoints (perpendicular outward), 1 rotation arc above the topmost vertex. Matches square's "2 of 4 edges shown" convention.
- **Fold function GLSL unchanged.** Kaleidoscope output is byte-identical to Build 35.
- **Code:** `src/engine/forms/triangle.js` (polygon + spokeRule + buildSampleRegion removed), `src/shell/overlay.js` (triangle affordance branch iterates `outerEdges` instead of all edges).

---

## v0.2.0 (Build 35) — 2026-05-22

**Triangle sample-region indicator.** The displayed equilateral triangle is a useful interaction zone but doesn't accurately represent what the kaleidoscope actually samples — the fold output is a 60° wedge that occupies roughly 1/6 of the triangle area and pokes out of the triangle on one side. Build 35 adds an indicator showing the true sample region inside (and partially outside) the triangle.

- **New form-schema field:** `buildSampleRegion(state)` (optional). When a form implements it, the overlay treats the result as a secondary "actual sample region" polygon, drawn alongside the main polygon. Used only by triangle for now; other forms don't need it because their main polygon already equals the fold output range.
- **Triangle:** implements `buildSampleRegion` returning the 60° wedge polygon (apex at slice center, opening 60° in fold space, magnitude up to √3/3). Resolution of 16 arc segments matches radial.js.
- **Overlay rendering:** `drawSourceOverlay` now cuts the dim-background hole for the UNION of the main polygon and the sample region (so the wedge's poke-out beyond the triangle reveals additional source image). Outlines: the main triangle keeps its current style; the sample wedge gets a subtler 1px white outline at 0.7 opacity (informational, not competing with the interactive frame).
- **What stays the same:** interactions (drag edges, drag-outside-to-rotate), touch affordances, hit-testing, OOB indicator, fold function. The kaleidoscope output is byte-identical to Build 34.
- **Code:** `src/engine/forms/triangle.js` (+`buildSampleRegion`), `src/shell/overlay.js` (sample-region computation + union hole-cut + outline).

---

## v0.2.0 (Build 34) — 2026-05-22

**Triangle interaction refinements.** Mental model shifted from wedge-with-apex-at-center (hex-style) to centered-polygon (square-style). Same fold math, same visual affordance language, different polygon geometry and hit-test behavior.

- **Polygon centered.** `buildPolygon` now returns a full equilateral triangle with the centroid at the slice center, apex up on screen. Vertices at circumradius √3/3 to match the fold's natural output scale. Slice origin (the white dot) is now at the visual center of the triangle.
- **All three edges are scale targets.** `spokeRule` changed from `'hex'` to `'none'`. The hit-test logic now treats any edge as a scalable cell boundary (previously only the far edge fired scale).
- **Rotation outside the polygon.** Press-and-drag outside the triangle rotates, matching square's behavior. The previous "outside angular range" model only worked because the wedge didn't span 360° around the slice center.
- **Affordance placement.** New `triangle` branch in `drawTouchAffordances`: three scale arrows perpendicular to each edge midpoint, one rotation arc above the topmost vertex (matches square's "arc above the top edge" convention but uses the apex as the anchor since triangle has no horizontal top edge).
- **Code:** `src/engine/forms/triangle.js` (`buildPolygon` + `spokeRule`), `src/shell/overlay.js` (new triangle branch in `drawTouchAffordances`).

---

## v0.2.0 (Build 33) — 2026-05-22

**Hotfix for Build 32:** triangle form was non-functional in production because the GLSL fold function used a local variable named `centroid`, which is a reserved interpolation qualifier keyword in GLSL ES 3.00. Shader compilation failed, cascading to a broken engine init (upload button and form thumbnails stopped rendering). Renamed the variable to `triCenter` in `src/engine/forms/triangle.js`. No behavior change; only a naming fix to satisfy the GLSL ES 3.00 parser.

---

## v0.2.0 (Build 32) — 2026-05-22

**Triangle wallpaper form (p3m1).** Fourth form in the registry, joining radial, square (p4m), and hex (p6m). Completes the trio of regular wallpaper tilings (square, hex, triangle).

- **Fold math:** D3 fold (3-fold rotation + mirror) around each triangle's centroid. Tiles the plane with alternating "up" and "down" equilateral triangles via a rhombus unit cell. Fold continuity at triangle edges is automatic because edges are mirror axes in p3m1.
- **Overlay:** equilateral triangle wedge with apex at slice center, opening 60°. Far edge is the cell boundary where scale gestures fire; the two apex-incident sides are visual-only via `spokeRule: 'hex'`.
- **Thumbnail:** single equilateral triangle with three altitudes shown — matches the on-canvas wedge shape.
- **Code:** new `src/engine/forms/triangle.js`, one-line registry addition in `src/engine/forms/index.js`. No engine, schema, or overlay changes needed; the form-registry architecture absorbed the new form purely additively.
- Tuning: `TRI_SIZE = 0.6` mirrors hex's tile-density choice; `tilesPerDim = 2.4` is a starting guess for the resolution hint. Both may want adjustment after production review.

---

## v0.2.0 (Build 31) — 2026-04-27

**Affordance geometry precision + pinch highlight fix.**

- **Scale arrows (radial + hex):** placed at the outer boundary using `polygonRadiusAt`, which intersects the polygon path. Previously the arrow floated at an interior point.
- **Arc gap (all forms):** formula changed to `max(R+20, maxVertexDist+16)`, making clearance size-adaptive.
- **Square arc:** moved to above the top edge center (24px gap from edge midpoint), avoiding collision with the scale arrow.
- **Corner arrow (square):** centered on vertex with no additional offset.
- **Rotation arc (all forms):** now bidirectional, with arrowheads at both ends.
- **Pinch highlight:** pinch no longer activates all affordances simultaneously. Outline highlights are drag-mode-aware (`strokeEdges`) and clear on gesture release via `scheduleOverlayDraw` in `onUp`.
- Code: `src/shell/overlay.js` (126 lines changed).

---

## v0.2.0 (Build 30) — 2026-04-27

**Touch affordance geometry fixes + active-state feedback.** Ten issues from post-Build-29 iPad QA.

- **Universal — arc gap** (Issue 1): rotation arc radius changed from `outerPt.d + 10` to `outerPt.d + 20`, giving ~20px of clear space between the arc and the shape edge.
- **Universal — line length** (Issue 2): scale arrow shaft lengthened from 14px to 28px total (`HALF` 7→14); arrowheads now have clear spacing from the shape edge.
- **Universal — active state** (Issue 3): new `env.overlayDragMode` field (set in `onDown`, cleared in `onUp`) drives per-affordance highlighting. Active affordance renders at 100% opacity + 2.5px stroke; inactive affordances dim to 25% during a gesture. Drag modes map: `rotate`/`pinch` → rotation arc, `scale`/`square-edge`/`pinch` → scale arrows, `segments`/`pinch` → spoke lines, `square-corner`/`pinch` → corner arrow.
- **Radial — jitter fixed** (Issues 4, 5): replaced max-distance vertex selection with centroid of all outer edge midpoints. Centroid is the average of all 16 arc-segment midpoints → a stable bisector point that doesn't jump between frames. Scale arrow now placed at the midpoint between center and outer centroid (along the axis of symmetry).
- **Hex — rotation arc placement** (Issue 6): same centroid approach; hex has one outer edge, so centroid = stable outer edge midpoint, not a corner.
- **Square — rotation arc flickering + jitter** (Issue 7): switched from max-distance vertex (all 4 corners equidistant → jumps) to `screenPts[1]` (always the top-right corner in the shape's own folded-space coordinate system → moves smoothly with rotation).
- **Square — corner scale arrow** (Issue 8): new diagonal bidirectional arrow at `screenPts[1] + 8px outward`, oriented along the corner-to-center diagonal. Active when `dragMode === 'square-corner'`.
- **Square — two edge handles** (Issue 9): replaced single outermost-edge midpoint with two fixed edge handles: top edge (`screenPts[0..1]`) and right edge (`screenPts[1..2]`), both visible simultaneously regardless of shape orientation.
- **Landscape layout** (Issue 10): reduced right-panel landscape padding from 34px to 16px.
- Code: `drawTouchAffordances` refactored into two path (square vs wedge) with extracted `afScaleArrow` and `afRotationArc` helpers.

---

## v0.2.0 (Build 29) — 2026-04-27

**Persistent touch affordances.** Three per-form indicators drawn on the source overlay on touch devices only (60% opacity at rest, 25% during active drag).

- **Scale arrow** (all forms): bidirectional arrow perpendicular to the outermost edge midpoint. Signals the outer boundary is draggable for scale.
- **Rotation arc** (all forms): short 22° curved arc with arrowhead just outside the outermost corner, in the zone where the rotate hit region lives.
- **Spoke double-line** (radial only): two thin parallel lines along one spoke edge (20–68% of its length), hinting that dragging near a spoke edge adjusts segment count.

Indicators live in `drawTouchAffordances()` in `src/shell/overlay.js`, called from `drawSourceOverlay` after the polygon outline and center dot. `env.overlayDragging` is set/cleared in `onDown`/`onUp` and used to fade affordances during drag. No changes to hit-testing or existing stroke-highlight feedback.

---

## v0.2.0 (Build 24) — 2026-04-27

**Session undo/redo.** 100-step snapshot history for the kaleidoscope state object.

- New `src/shell/history.js`: two-stack model (undoStack + redoStack). Each entry is a shallow copy of state (all values are primitives). `push` captures pre-action state; `undo` pops undo stack and saves current state to redo stack; `redo` is inverse. New push clears the redo stack.
- Capture points (one push per user interaction, at interaction START): overlay single-touch and pinch drags (`onDown`), native slider (`mousedown` / `touchstart`), scrub field drag (`onPointerDown` via new `onStart` callback), form switch (`buildFormGrid` onclick), OOB mode button, preview canvas pinch (`touchstart`).
- `env.pushHistory()` convenience method on the shared runtime container; `env.updateUndoUI()` keeps button states in sync.
- Keyboard: Cmd+Z undo, Cmd+Shift+Z redo.
- Touch UI: `←` / `→` button pair, 44px targets, absolutely positioned at bottom-center of the preview area (thumb-reachable on iPad). Greyed when at stack boundary.
- Version bumped to v0.2.0 -- undo/redo is a meaningful new surface area, not a patch.

---

## v0.1.2 (Builds 21-23) — 2026-04-27

**iPad touch pass.** Two rounds of improvements based on live iPad testing. No new forms; all changes are touch UX and export reliability.

**Build 23 — pinch pivot fix:**
- Overlay two-finger pinch now uses a proper rotation-around-pivot transform (`apex_new = currentMidUV + R(Δθ) × (startApex - startMidUV)`). Previously rotation and translation were applied independently, which caused wedge shapes to orbit their off-screen apex tip rather than rotating naturally under the fingers. Rectangle forms were unaffected (their apex IS at the visual center), but radial and hex wedges felt disconnected. Now all three forms track correctly during combined scale + rotate + move gestures.

**Build 22 — export probe + pinch refinements:**
- GPU FBO probe now also tests the 2D canvas encoding path. Creates a canvas at each candidate size, writes one pixel, and reads it back. If the browser silently fails (Safari canvas encoding limit), the probe falls back to a smaller size. This is the second line of defense that catches the case where the GPU FBO is fine but `toBlob` would fail.
- Canvas zoom minimum lowered from 0.25 to 0.15 (slider, scrub field, and pinch gesture clamp all updated).
- Overlay two-finger pinch now drives all three transforms simultaneously: spread = slice scale, twist = slice rotation, midpoint movement = slice position. The origin point is no longer locked during pinch.

**Build 21 — touch infrastructure:**
- Divider resize now responds to touch. Mouse and touch handlers share `startDrag`/`moveDrag`/`endDrag` helpers. Hit target widened to ~30px via `::after` pseudo-element.
- Slider thumbs enlarged on coarse-pointer (touch) devices via `@media (pointer: coarse)`: thumb grows from 12px to 24px, row height to 44px.
- Removed the "grip line + rotation dots" touch affordance from the source overlay. It was confusing and only indicated one of several interactive zones. Persistent control-point affordances are deferred to a future session (see BACKLOG).
- Overlay two-finger pinch: scale + rotate the slice. Single-finger drag behavior unchanged.
- Preview canvas two-finger pinch: zoom and rotate the canvas composition. Wired to `canvasZoom` and `canvasRotation` state; slider values update in sync.
- GPU FBO probe (first pass): at engine init, tests each candidate export size (16384, 8192, 4096, 2048) with `checkFramebufferStatus` + `gl.clear` + single-pixel `readPixels`. Stores `diagnostics.maxFBOSize` separately from `diagnostics.maxTextureSize`. Export cap and status messages use `maxFBOSize`. Diagnostics readout shows both values.

---

## v0.1.1 (Build 20) — 2026-04-27

**Github + Vercel readiness.** No engine changes. This build prepares the project for hosting on GitHub and deployment to Vercel.

- Added `LICENSE` (AGPL-3.0, copyright Daniel Nelson)
- Added SPDX headers to entry files (`main.js`, `version.js`)
- Added `README.md` for GitHub viewers
- Added `docs/` folder with `ARCHITECTURE.md`, `CHANGELOG.md`, `BACKLOG.md`, `HANDOFF.md`
- Build counter convention changed: BUILD is now a monotonic global counter that never resets on version bumps. Previous convention reset BUILD to 1 on each version bump; that lost the "how many iterations total" signal.

## v0.1.0a (Build 19) — 2026-04-27

**Four small fixes after first round of testing.**

- Square corner cursor stays diagonal regardless of cell aspect ratio (was: bug where wide rectangles got near-horizontal cursors at the corners). Fix uses sign-based quadrant angle instead of geometric angle.
- Resolution hint formula refactored: per-form `tilesPerDim()` slot on form modules, plus a global 0.5 perceptual softening multiplier. Daniel's calibration test (1080p × square × sliceScale 2 × zoom 1) now reports ~2.1K (was ~3.3K).
- Default export format changed from PNG to JPG (slight compression usually preferred over lossless given the bilinear interpolation already happening in the render).
- Oversized images now throw a clear error pre-upload instead of silently rendering black. The engine pre-checks `gl.MAX_TEXTURE_SIZE` and reports the actual GPU limit.

## v0.1.0a (Build 18) — 2026-04-26/27

**Engine extraction + Vite project.** The original ~3050-line single-file `kaleidoscope.html` was decomposed into a Vite project with a "wide engine" + forms-registry architecture.

- New project structure: `src/engine/`, `src/engine/forms/`, `src/shell/`, single `src/main.js` entry
- Forms registry pattern: each symmetry form is a self-contained module declaring GLSL fold function, per-form uniforms, polygon builder, spoke rule, controls list, file code, thumbnail, filename suffix
- Shader composed at startup by stitching together every form's contribution
- `state.form` changed from numeric index to string id (e.g. `'radial'`, `'square'`, `'hex'`) — future-proofs against form-order changes
- Build counter introduced: `v0.1.0a · Build 1` shown in diagnostics footer
- No behavior changes — pure refactor

## v0.0.x (Builds 1–17) — through April 2026

**Pre-extraction monolith.** All in a single `kaleidoscope.html` file. Rough mapping of changelog entries to builds (some entries may have spanned multiple iterations):

- v0.0.17 — hex spoke-edge scale fix; resolution hint heuristic dialed back
- v0.0.16 — rotate cursor polish; square cursor decoupling; right-panel max-width raised; divider drag rAF-coalescing; resolution hint introduced
- v0.0.15 — square aspect ratio added; rectangular cells; corner/edge drag for non-uniform vs uniform scale; aspect encoded in filename
- v0.0.14 — direct manipulation syncs slider/scrub display back to state; overlay redraw rAF-coalescing; miniCanvas hidden during divider drag; hit zones reworked
- v0.0.13 — rotate hot zone extended to spoke-adjacent regions on radial wedges; rotate cursor redrawn (filled-triangle arrowheads); polygon stroke brightens in scale/rotate hover
- v0.0.12 — export resolution uncapped from source dims (bounded only by `gl.MAX_TEXTURE_SIZE`); 8K + max buttons; rotate cursor angle-aware (16 pre-generated SVG variants)
- v0.0.11 — direct manipulation on slice overlay (move/scale/rotate); cursor changes signal mode on mouse; touch-only visible handles
- v0.0.10 — Pointer Lock API for scrub fields; button hierarchy pass (toggle selections recede so Export reads as the only CTA)
- v0.0.9 — scrub fields on all numeric controls; rotation dials retired; explicit Export button; resize-vector lag fixed
- v0.0.8 — mirror sampling formula corrected (was using complement triangular wave); mirror reflection visualizations clipped to image rect
- v0.0.7 — canvas mid-edge → overlay tip convention; mirror reflection visualization in overlay when wedge crosses image bounds
- v0.0.6 — per-form input normalization inside fold functions; default OOB changed to clamp; dashed amber stroke for OOB wedges; compact form picker
- v0.0.5 — wedge-range fix in foldRadial; rotation matrix convention pinned down; imgDiv + transparent overlay canvas to defeat `.main-slot canvas` background rule
- v0.0.4 — shader-based rendering; FBO export; slot abstraction
- v0.0.3 — three forms (radial / square / hex); slice + canvas attributes
