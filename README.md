# kaleidoscope

A browser-based kaleidoscope tool for generating high-resolution kaleidoscope images from photos. Built fresh, inspired by [kaleidoscope24.com](http://kaleidoscope24.com/) but targeting up to 8K square output (16K on capable GPUs) for large-format prints.

## what it does

Upload an image. Pick a symmetry form (radial wedge, square mirror tile, hex mirror tile). Adjust the slice region, segments, rotation, zoom. Drag directly on the source image to position, scale, or rotate the slice. Export at 1K, 2K, 4K, 8K, or your GPU's max texture size.

WebGL2 fragment shader rendering. FBO-based export so the preview canvas stays untouched. Direct manipulation on the source overlay (move / scale / rotate / segments / square-edge / square-corner gestures). Out-of-bounds modes: clamp, mirror, transparent.

## status

Pre-1.0. The three core forms work, the export pipeline works, the UI is stable. Several more transforms (Droste, hyperbolic, polygonal radial, wallpaper groups) are queued in the backlog. Touch support is in place but iPad-specific testing happens once this is on a public URL.

## running locally

```bash
npm install
npm run dev
```

Then open http://localhost:5173. The dev server reloads on file changes.

To build a static bundle for deployment:

```bash
npm run build
```

Output goes to `dist/`. It's a static site — no server runtime needed; deploy anywhere that serves files.

## architecture (short version)

The engine is a registry of self-contained "form" modules. Each form lives in `src/engine/forms/` and declares everything about itself — its GLSL fold function, per-form uniforms, polygon vertices for the overlay, hit-testing rules, file code, thumbnail. The shader is composed at startup by stitching together every form's contribution. Adding a new form is one new file plus one line in the registry.

For deeper detail see [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## license

AGPL-3.0. See [LICENSE](./LICENSE).

The author retains rights to commercial licensing. If you want to use this code in a closed-source or commercial context, contact the author.

## acknowledgments

Built with [Vite](https://vitejs.dev/), WebGL2, and a lot of conversations with Claude.
