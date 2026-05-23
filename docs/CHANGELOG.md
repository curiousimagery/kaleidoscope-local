# changelog

Newest first. Format: `version (Build N) — date — summary`. Each version section captures what shipped relative to the previous version. Builds are a global monotonic counter; see `src/version.js` for the convention.

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
