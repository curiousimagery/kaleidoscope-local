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

  // ⚠️ THE PAN BOUND — AND IT MUST NOT DEPEND ON ZOOM. Two builds to get here, so both are recorded.
  //
  // B683 replaced the flat ±1 with `max(1, 2/zoom)`. That fixed the reported symptom (a full-side
  // drag at zoom 1 asked for 2.0, got clamped to 1.0, and stopped dead half way) **and introduced
  // a worse one.** Daniel, B688: *"if i zoom out, pan to an off centered position, and then zoom
  // into an off center corner, zoom drifts me toward the center and pan shudders back and forth
  // and won't move me in any direction."*
  //
  // Both halves follow from a bound that SHRINKS as you zoom in:
  //   • **the drift** — an offset that was legal at zoom 0.5 is out of range at zoom 4, so the
  //     render clamps it and the picture slides toward centre with no input at all;
  //   • **the dead pan** — the STATE still holds the out-of-range value, so a pan adds to a number
  //     the shader clamps straight back, and nothing on screen moves.
  //
  // `u_canvasOffset` is the source-space position of the screen CENTRE (screen p → p/zoom → minus
  // O), which is already zoom-independent: zooming does not change what sits in the middle.
  // **So its bound has no business changing with zoom either.**
  //
  // 2.0 so a full-side drag at 1x exactly reaches the edge — twice the old ±1, which is what the
  // original complaint was about. Zoomed further out one drag still crosses the whole range, and
  // that is inherent to a bounded pan rather than a bug: at low zoom the screen shows more source,
  // so screen-proportional dragging covers it faster.
  offsetBound: () => 2,

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
