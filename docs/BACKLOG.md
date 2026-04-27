# backlog

Living list of things we want to do, in rough priority order within each section. When something ships, move it to `CHANGELOG.md` and remove from here.

## next up — small UI / quality refinements

- **"Image too large" error placement.** Currently the GPU-too-large error surfaces in the export-area status pane, far from the upload action. Should appear as a toast near the upload button, or inline directly under it. The engine already throws a descriptive message; this is purely a presentation move.

## next up — new forms

These all benefit equally from the registry architecture — each is one new file in `src/engine/forms/` plus one line in the registry. Order is rough; pick whichever sounds most fun.

- **Polygonal radial (n-fold polygons).** Generalization of radial wedge where the outer boundary is a polygon (triangle, pentagon, hexagon-as-radial, etc.) instead of an arc. Some math overlap with existing radial.
- **Droste spiral.** Logarithmic-conformal map; the recursive picture-within-a-picture effect made famous by Escher's Print Gallery. Outside the polygon-overlay model — needs custom overlay (concentric guide circles).
- **Hyperbolic Escher (circle limit).** Tessellation of the Poincaré disk. Also needs custom overlay.
- **Wallpaper groups beyond p4m / p6m.** Triangle (p3m1), more complex symmetries.

For each new form, also fill in `tilesPerDim(state)` so the resolution hint is accurate.

## next up — capability tier

- **Motion shell.** A separate entry point that shares the engine but adds parameter-animation timeline + MP4 / GIF / video-loop export. Forms-registry already supports this; engine is shell-agnostic.
- **Live shell.** Kiosk mode for installations. MIDI input (Akai APC40 MK2), touch-as-primary, full-screen, no chrome. Same engine.
- **PWA manifest + offline cache.** Add proper `manifest.json` and a service worker so the app works offline once loaded. iPad install-to-homescreen story.

## research / speculative

- **"Scale to tile" snap on canvas zoom.** Initial conceptual analysis: feasible for square only, math doesn't work for hex (square-output × hexagonal periods = no integer solutions) or radial (rotational not translational symmetry, so no wallpaper tile). User reports that *visually* repeating patterns appear at certain canvas-zoom-out levels though, and wants to revisit this — may be missing something in the analysis. Not deferred to "never," just deferred to "not until we have more eyes on the geometry." When revisiting, start with a screenshot of the working repeat pattern to make the geometry concrete.

- **"Pro" output options.** Tile-aware export that produces seamlessly tileable wallpaper images regardless of the natural geometry (might involve more complex re-rendering, not just zoom-snap). Adjacent to the above.

- **Source video instead of source image.** The motion shell's logical extension. Kaleidoscope each frame independently and either render in real time or export an MP4 loop.

## developer tooling backlog

- **GitHub Actions CI:** `npm run build` on push to main, deploy preview to Vercel on PR. (Vercel handles this automatically via its GitHub integration; CI workflow is for adding `npm run lint` / `npm run typecheck` etc. when those exist.)
- **A `npm run check` script** that runs `node --check` against every JS file in `src/`. Useful as a pre-commit hook.
- **Visual regression harness.** A small node script that loads each form at default settings, exports at 1K, and diffs against a saved baseline. Catches accidental shader regressions.
- **Source-mapped production builds.** Vite does this by default, but worth verifying when we deploy.

## monetization / sharing — exploratory

(These are speculative and don't need code work yet, but parking the threads here so we can come back to them.)

- **Patreon-style membership gating.** User has expressed interest in a "garden of creative projects" where a paid membership tier gets sign-in access to a collection of small apps. Patreon, Buy Me a Coffee with member posts, or Ghost with paid memberships all handle the auth + payment without us writing a backend. Would happen at the page-routing level, not inside individual apps.
- **Mac App Store wrapper.** WKWebView or Tauri/Electron shell around the static build, sold for a one-time price. Apple handles paywall + receipt validation. Probably 1-2 sessions of work to set up.
- **Web paywall.** Stripe + auth + a backend gating "pro" features (4K+ export, more forms, etc.). Significantly more infra work than the other two options. Not recommended as a first step.

The license choice (AGPL-3.0) preserves all of these options without locking any of them in.
