# backlog

Living list of things we want to do, in rough priority order within each section. When something ships, move it to `CHANGELOG.md` and remove from here.

## next up — small UI / quality refinements / known bugs

- **Droste: offset inner-ring center (PhotoSpiralysis-style).** Build 41 ships Droste with the inner ring concentric to the outer. PhotoSpiralysis exposes a center-offset direct manipulation that lets the inner ring sit off-axis from the outer, producing eccentric / "drifting" spirals with a distinctly different feel from the strict log-conformal warp. Needs a small offset vector (`drosteOffsetX`, `drosteOffsetY` in fold-space units) and a dedicated drag affordance (drag inside the inner disc to push the inner-ring center around). Math-wise: subtract the offset from `p` before `log()` in the fold, or treat the map as a Möbius pre-composition. Worth a small design pass before coding — the strict conformal version is mathematically pristine, the offset version is more expressive but breaks the self-similarity in a subtle way.

- **Add spinner on export.** For larger exports there is a meaningful delay after clicking export before the browser is ready to download the file. This can lead a user to question whether the export command was recieved or not and potentially click the export button several times triggering multiple duplicate downloads. A simple fix would be to immediately add a circular spinner within the button to replace the word export (which would also disable the button until done)

- **Intel Air black-square export — needs hardware access.** Build 39 diagnostics surfaced this; Daniel doesn't have access to test. The probe currently passes (FBO complete, `clear`+`readPixels` returns the cleared color) but the actual shader render comes back all-black. Likely an Intel iGPU driver bug with large FBOs OR VRAM exhaustion on integrated GPUs. The Build 40 e2e diagnostic test now correctly catches this case (was throwing in Build 39); next time the hardware is accessible, run diagnostics + check `endToEndTest.summary.allZero` for confirmation, then design a render-validation step into the probe itself.

- **M5 Firefox 8K cap — resolved via UX (Build 40).** The M5 Max "limited to 8K" finding was Firefox's Resist Fingerprinting capping `MAX_TEXTURE_SIZE` at 8192. Not a hardware issue. Build 40 surfaces a contextual notice in the export area + augments the upload-error text. Tile-rendering workaround to exceed Firefox's cap is deferred (complex; would need either WebGPU port or multi-pass FBO composition). Leaving as deferred unless cross-browser parity becomes strategic.

- **WebGL context loss/restore.** Build 21's GPU FBO probe prevents the "framebuffer incomplete" export from triggering a context loss. If a gray screen recurs in any other scenario, add a `webglcontextlost` + `webglcontextrestored` handler pair on the preview canvas to re-init the GL state cleanly.

## next up — new forms

These all benefit equally from the registry architecture — each is one new file in `src/engine/forms/` plus one line in the registry. Order is rough; pick whichever sounds most fun.

- **Hyperbolic Escher (circle limit).** Tessellation of the Poincaré disk model of hyperbolic geometry. Output is a circular image with shapes crowding toward the edge, like Escher's *Circle Limit* prints. Heavy lift: needs custom overlay (circular disk boundary + warped fundamental triangle) and custom controls (Schläfli tiling selector). The Droste form (Build 41) introduced the `drawOverlay` / `classifyPointer` schema hooks that this form can reuse — the engine-schema-extension lift is already done. Distinctive Escher-feel; significant aesthetic differentiation.

- **p31m wallpaper (future).** Alternate triangular tiling — same equilateral triangles as p3m1, but with mirror axes running through vertices rather than along edges. Fully seamless (passes the no-visible-seams design constraint). Visually distinct from p3m1, especially at triangle centers vs. corners. Lower priority than the above; vocabulary expansion rather than a foundational form.

- **Radial polygon-frame variation (low priority).** Cosmetic enhancement to the existing radial form: optionally render with an n-sided polygon outer boundary instead of a circular arc. Same fold math, same n-fold rotational symmetry, just a different visible frame shape. Constrained to even sides matching segment count (4-segment radial → square frame, 6 → hex frame, 8 → octagon frame, etc.) for seam compliance. May emerge organically as a side effect of tile-aware features since polygon framing relates to tileable output shapes. Not a separate form; a parameter on radial.

**Design constraint for all new forms:** No visible seams on any output. Forms without sufficient mirror symmetry (pinwheel-only patterns like p3, p6, p4, etc.) are explicitly excluded — they show seams between fold cells which breaks the kaleidoscope illusion. Glide-reflection groups (pmg, pgg) are also excluded because glide axes can produce visible discontinuities depending on source image content. Rectangular mirror groups (pmm, cmm) are excluded for a different reason — they're visually redundant with the existing square form's aspect-ratio control. With p3m1 shipped (Build 32), p31m is the only remaining wallpaper group that adds distinct visual vocabulary while reliably satisfying the seam constraint.

Pairs well with the live-camera shell. Having more forms available makes the camera shell more demoable and surfaces form-switching UX issues earlier. New forms can drop in at any time as opportunistic parallel work; they cannot destabilize other phases because each form is a self-contained file plus a registry entry.

For each new form, also fill in `tilesPerDim(state)` so the resolution hint is accurate.

## next up — capability tier

Reordered to reflect mobile-camera-first priority. The live camera shell is the primary mobile experience and the wonder-delivery moment that motivates much of the product narrative (see `FOLD.md` for the full framing). Live + mobile come before motion.

- **Live still-image capture shell (camera-first).** New entry point that takes the camera feed as the kaleidoscope source. `getUserMedia` → upload video frame as texture each rAF tick → render through existing shader pipeline. Shutter UI captures both the kaleidoscope output at full FBO resolution and the raw camera frame at native resolution. Wedge overlay drawn on the live camera view, draggable on touch. Form selection, segment count, basic controls accessible without leaving the camera view. Architecture gate: verify the engine accepts any `TexImageSource` (HTMLVideoElement specifically) before starting; if not, that's a small refactor first.

- **Mobile responsive shell with thoughtful IxD pass.** A mobile-optimized shell, separate from the desktop shell, sharing the engine. Camera-first as the default mode; photo-import as a secondary path. Progressive disclosure of controls. **This phase needs hands-on direction from Daniel before code starts** — see the "mobile UX exploration notes" section below for dual-perspective input captured from prior conversations.

- **Motion shell.** Parameter-animation timeline + video loop export. First version: A/B two-state with crossfade controls (simpler, ships faster, matches VJ mental model). Multi-keyframe horizontal timeline is a v2 of this feature. Export via WebCodecs (preferred) or MediaRecorder (fallback). Loop integrity: first-frame state == last-frame state, enforced via UI toggle.

- **Video file input → kaleidoscope loop output.** Reuses live-camera shell plumbing but with `<video>.src` = file rather than MediaStream. Combines with motion shell's keyframe timeline so kaleidoscope parameters can animate over the video's duration. Same WebCodecs export pipeline.

- **Live performance shell (MIDI / kiosk).** Akai APC40 MK2 input, touch-as-primary, full-screen, no chrome. Same engine. Separate from the live camera shell above — this is the VJ performance surface, not the camera-input feature.

- **PWA manifest + offline cache.** Proper `manifest.json` and service worker so the app works offline once loaded. iPad install-to-homescreen story. Plumbing for the iPad-app-via-Capacitor path (see `FOLD.md` monetization Phase 3).

## mobile UX exploration notes

Captured here as inputs for the design session that should precede the mobile responsive shell build. Two perspectives are intentionally preserved because the right approach isn't settled — divergent design exploration with Daniel driving should produce 2–3 distinct layout/flow approaches, then pick one.

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

- **Engine input contract: does the engine accept any `TexImageSource`?** The engine should accept HTMLImageElement, HTMLVideoElement, HTMLCanvasElement, ImageBitmap, and VideoFrame as a texture source, since `gl.texImage2D` natively accepts all of these. Verify this is the case before starting the live-camera shell. If not, the refactor should be small.

- **Shell separation discipline for mobile.** The mobile shell should be a *distinct shell* pointed at the same engine, not a responsive retrofit of the desktop shell. Same as the planned motion and live shells. This is the architectural commitment that makes the pro-and-playful product story possible (see `FOLD.md`).

- **Shared infrastructure for video sources.** Live camera (MediaStream), video file (`<video>.src = file`), and animated still image (parameter timeline) should share infrastructure rather than being three separate code paths. After the live-camera shell ships, refactor as needed so this stays true when video file input and motion shell join.

- **WebCodecs availability for video export.** When the motion shell ships, prefer WebCodecs `VideoEncoder` for frame-perfect output; fall back to `MediaRecorder` if not supported. Codec preference: mp4/h264 if available, webm/vp9 otherwise. May need to expose codec choice in advanced export settings.
