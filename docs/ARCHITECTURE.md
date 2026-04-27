# architecture

## one-paragraph summary

The kaleidoscope is a Vite-based static web app. Its engine is a WebGL2 fragment shader composed at startup from a registry of self-contained "form" modules — each module declares its own GLSL math, JS-side polygon math, per-form uniforms, slice controls, file code, and thumbnail. Adding a new symmetry pattern is one new file plus one line in the registry. The UI shell layers on top of the engine via a runtime container `env` that's threaded through the shell modules; the engine itself knows nothing about DOM or controls.

## directory map

```
src/
├── main.js                  entry — wires engine + shell, owns env runtime container
├── version.js               VERSION + monotonic BUILD counter, footer string
│
├── engine/                  pure rendering — knows nothing about DOM or controls
│   ├── index.js             public API: createEngine(), render, exportAt, suggestResolution
│   ├── gl.js                WebGL2 plumbing — context, program, uniforms, FBO export
│   ├── shader-builder.js    composes the fragment shader from forms registry
│   ├── geometry.js          pure JS-side geometric math (mirrors of shader transforms)
│   └── forms/               REGISTRY OF SYMMETRY FORMS — each file is one form
│       ├── index.js         registry array + lookup helpers
│       ├── radial.js        radial wedge (classic kaleidoscope, n-fold)
│       ├── square.js        p4m wallpaper, with rectangular cells
│       ├── hex.js           p6m wallpaper
│       └── _template.js     annotated stub for adding new forms
│
└── shell/                   UI — owns DOM, state mutation, user input
    ├── state.js             single state object + ephemeral session flags
    ├── styles.css           extracted from the original monolith
    ├── controls.js          scrub fields, sliders, form picker, divider
    ├── overlay.js           source overlay drawing, hit-testing, drag dispatch
    └── cursors.js           pre-baked rotate-cursor SVG variants

docs/                        all the long-form context lives here
```

## key principles

**State lives in one place.** All kaleidoscope parameters live in `src/shell/state.js` as a single object. The engine accepts state on every call rather than holding its own — this matches the original monolith's "single state object" architecture and supports future motion/live shells that may want to record/replay/animate state.

**The engine doesn't know about the DOM.** Engine modules can be imported and used in any context that has a canvas — including (eventually) a separate "motion" shell that animates parameters over time, or a "live" shell that's driven by MIDI/touch. The engine is reusable across those because it has no shell dependencies.

**Forms are self-contained.** Each form file in `src/engine/forms/` exports a single object with a fixed schema (see `_template.js`). The schema covers GLSL fold function, per-form uniforms, polygon for overlay, hit-testing spoke rule, controls list, file code for filenames, thumbnail SVG, optional `tilesPerDim` for resolution hint, and optional `filenameSuffix` for per-form parameters. The shader is composed at startup by reading the registry and concatenating each form's contribution.

**The `env` container threads shared state through shell modules.** Rather than module-level globals, `main.js` builds an `env` object that carries `state`, `engine`, key DOM refs, hover state, and the inter-module method handles (`scheduleRender`, `syncControls`, `arrangeSlots`, etc.). Shell modules accept `env` as a parameter. This keeps wiring readable while avoiding mutable module-level state.

## adding a new form

1. Copy `src/engine/forms/_template.js` to a new file (e.g. `droste.js`)
2. Fill in the schema fields:
   - `id`, `label`, `fileCode` — identity + UI labels
   - `thumbnail` — 32×32 SVG with `class="stroke"` group for theming
   - `controls` — which slice controls to show: `'segments'`, `'aspect'`, etc.
   - `uniforms` — any per-form GLSL uniforms with extractor functions
   - `glsl` — the fold function as a string (function name must be `fold${Capitalized}`)
   - `spokeRule` — `'radial'` / `'hex'` / `'none'` for hit-test behavior
   - `buildPolygon(state)` — vertices for the overlay
   - optional: `tilesPerDim(state)`, `filenameSuffix(state)`
3. Import and append to `FORMS` in `src/engine/forms/index.js`
4. Done. The form picker, slider gating, hit-testing, export filenames, and shader composition all pick up the new form automatically.

The form schema's escape hatch for forms whose math doesn't fit the polygon-based overlay (e.g. Droste's spiral, hyperbolic Escher's circle limit) is the `buildPolygon` field — it can return any vertex array, including non-polygonal approximations like sampled curves. Beyond that, more exotic overlays can be supported by extending the schema with a custom `drawOverlay` function in the future. We haven't needed that yet.

## the GLSL composition story (and why it's fragile)

The shader is built by string concatenation in `engine/shader-builder.js`:

```
COMMON_PREAMBLE
  + per-form uniform declarations (deduplicated)
  + each form's fold function (concatenated)
  + main() with switch on u_formIndex
```

Each form's `glsl` field is a JS template literal. **Watch for backticks inside form GLSL**. The original monolith had a long-running bug where backticks in a GLSL string broke the JS parser silently. If a future form needs a backtick in its GLSL, escape it carefully or use a different quoting strategy. The project's debugging history (the `v0.0.4`-era CHANGELOG line about "shader-based rendering") references this.

`gl.js` looks up uniform locations once at init via `collectAllUniformNames()`, then on every render iterates `collectUniformSpecs()` to push values. Per-form uniforms that the GLSL compiler optimizes out have null locations; those are silently skipped.

## the swap, the divider, the slot management

The "main slot" is the large viewport area. The "side slot" is the panel-top thumbnail box. By default the kaleidoscope preview is in main and the source-image overlay is in side. The swap button toggles them. The mini-canvas that shows the kaleidoscope when swapped is a 2D-canvas copy of the WebGL preview canvas (drawn via `ctx.drawImage`).

The divider drag uses rAF coalescing for the panel-width updates and hides both canvas-pixel surfaces (`previewCanvas`, `miniCanvas`) during the drag because they're sized in pixels and lag CSS-scaled containers by a frame or two during the gesture.

## things that aren't here yet but are coming

See [BACKLOG.md](./BACKLOG.md) for the running list. Highlights:

- More forms: Droste, hyperbolic, polygonal radial (n-fold polygons), wallpaper-group transforms beyond p4m and p6m
- Motion shell: animate parameters over time, MP4/GIF export
- Live shell: MIDI/touch input, full-screen kiosk mode
- A real PWA manifest and offline support
- "Scale to tile" snap (deferred — see backlog for the geometry investigation)
