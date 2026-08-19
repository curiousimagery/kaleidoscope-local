import { formCanvasNorm } from './index.js';   // effective zoom = canvasZoom × canvasNorm (see buildPolygon)

// forms/radial.js
//
// FORM 0 — radial wedge (classic kaleidoscope).
//
// fold output is centered on +X axis: returns vector at angle in
// [-wedge/2, +wedge/2]. with sliceRotation = 0, the wedge axis points at +X
// in source-UV (i.e., "to the right of the slice center on the displayed
// image"). matches overlay polygon exactly.

export default {
  id: 'radial',
  // ✅ ZOOM EXTENTS TUNED B618 by Daniel with the ?tune=forms range sweep.
  // the wedge samples a larger ring as the canvas zooms out, so the overflow is real here.
  zoomCover: 2.0,
  zoomInFloor: 0.5,

  label: 'Radial',
  fileCode: 'r',

  thumbnail: `<svg viewBox="0 0 32 32"><g class="stroke">
    <circle cx="16" cy="16" r="12"/>
    <line x1="16" y1="4" x2="16" y2="28"/>
    <line x1="4" y1="16" x2="28" y2="16"/>
    <line x1="7.5" y1="7.5" x2="24.5" y2="24.5"/>
    <line x1="24.5" y1="7.5" x2="7.5" y2="24.5"/>
  </g></svg>`,

  controls: ['segments'],

  // ✅ TUNED B614 by Daniel against a reference source. Radial used to be the 1.0 anchor that the
  // others were normalised TO; the tuning pass moved the whole set to a larger default slice, so
  // the anchor moved with it rather than staying at 1.
  sizeNorm: 2.25,

  // one focal point by construction — pan is locked (centered) by default. See formPanLockedByDefault.
  panLockedByDefault: true,

  // ⚠️ THE PAN BOUND, AND WHY IT IS NOT THE DEFAULT ±1 (2026-08-19, Daniel: "panning is
  // proportional across all zoom levels... this seems to be true for all forms except the radial
  // wedge"). The offset is subtracted after `p /= u_canvasZoom`, so one unit of it moves content
  // by `zoom` half-canvas widths on screen — which means a FIXED bound gives a reachable travel
  // that shrinks as you zoom out. `panDelta` asks for `2/zoom` units per full-side drag, so at
  // zoom 1 one drag asks for 2.0 and the old ±1 clamped it to half, then stopped. The default
  // exists for droste, where the offset is a log-polar centre shift rather than a translation.
  //
  // `2/zoom` is the bound that makes the reachable travel CONSTANT (one canvas each way at any
  // zoom). **The `max(1, …)` is deliberate and it is a compromise:** the pure form would also
  // REDUCE reach when zoomed in past 2×, and taking away range that works today to buy tidiness
  // is not a trade worth making silently. So this only ever widens the bound, never narrows it.
  // If constant-range-at-every-zoom is what is actually wanted, drop the max — but that is a
  // product call about losing reach at high zoom, not a bug fix.
  // formCanvasNorm, not the raw slider: the shader's zoom is `canvasZoom × canvasNorm`, and using
  // the raw number here is the same desync buildPolygon guards against a few lines down.
  offsetBound: (state) => Math.max(1, 2 / Math.max(1e-4, (state.canvasZoom || 1) * formCanvasNorm(state))),

  // radial uses universal uniforms only (u_segments). no per-form uniforms.
  uniforms: {},

  // input convention: p in canvas space (after canvas rotation+zoom), spanning
  //   [-1, 1]² plus corners up to |p|=√2.
  // output convention: canvas MID-EDGES (|p|=1) fold to |output|=1 — the
  //   overlay polygon's outer arc. canvas CORNERS (|p|=√2) sample slightly past
  //   the overlay (~1.41× past the wedge tip), and the dashed amber stroke warns
  //   when this crosses the source image bounds.
  glsl: `
    vec2 foldRadial(vec2 p) {
      // no input scaling — canvas mid-edges already at |p|=1, which is what we want.
      float r = length(p);
      float theta = atan(p.y, p.x);
      float wedge = TAU / u_segments;
      // center the fold range around 0 (instead of around wedge/2). after this:
      //   t in [-wedge/2, +3*wedge/2] before mirror.
      float t = mod(theta + wedge * 0.5, wedge * 2.0) - wedge * 0.5;
      // mirror the upper half [+wedge/2, +3*wedge/2] back into [-wedge/2, +wedge/2]
      if (t > wedge * 0.5) t = wedge - t;
      return vec2(cos(t), sin(t)) * r;
    }
  `,

  // radial wedges have center-incident SPOKE edges. dragging perpendicular to
  // a spoke widens/narrows the wedge angle = adjusts segment count.
  spokeRule: 'radial',

  buildPolygon(state) {
    // arc of angle = TAU / segments. HONEST under canvas zoom (M4 criterion #2): the radial fold
    // preserves radius, so the output samples out to ~1/canvasZoom in fold space — zoom OUT
    // (canvasZoom < 1) makes the wedge sample a LARGER source ring; zoom IN shrinks it. canvasZoom=1
    // is the unit-radius baseline that was already accurate at canvas defaults. Because buildPolygon
    // is the shared geometry, the overlay + seam + hit-test + (future) SVG export all inherit this.
    // (Output ASPECT reshaping the arc per-angle is the next sub-step; this captures the zoom magnitude.)
    const wedge = (Math.PI * 2) / state.segments;
    // ⚠️ The EFFECTIVE zoom, not the raw state value: the shader renders
    // `u_canvasZoom = canvasZoom × formCanvasNorm`, so a polygon built from the raw number desyncs
    // the overlay from the render on any form declaring a canvasNorm. Invisible today only because
    // radial's norm is 1.0 — which is exactly the kind of latent mismatch that surfaces the first
    // time someone tunes this form. (B617; same class as droste's missing sizeNorm at B614.)
    const R = 1 / Math.max(0.0001, (state.canvasZoom || 1) * formCanvasNorm(state));
    const pts = [];
    pts.push({ vx: 0, vy: 0 });
    const STEPS = 16;
    for (let i = 0; i <= STEPS; i++) {
      const a = -wedge / 2 + (i / STEPS) * wedge;
      pts.push({ vx: Math.cos(a) * R, vy: Math.sin(a) * R });
    }
    return pts;
  },

  filenameSuffix(state) {
    return String(state.segments);
  },

  // tile density for resolution hint. radial fans the slice into N angular
  // wedges around the center; perceived effective linear tile count grows as
  // √(N/2) — N tiles around the perimeter, but mostly visible at the edge of
  // the output where angular sampling thins.
  tilesPerDim(state) {
    return Math.sqrt(state.segments / 2);
  },
};
