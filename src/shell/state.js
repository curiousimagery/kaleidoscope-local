// shell/state.js
//
// the single state object — all parameters that control the kaleidoscope live
// here. structured so that future undo/redo, save/restore, and motion-mode
// parameter recording can all hang off the same primitive.
//
// `form` is a STRING id (e.g. 'radial', 'square', 'hex') rather than the legacy
// numeric index. forms are addressed by id everywhere; the engine resolves
// string → form module via the registry. this means adding a new form doesn't
// shift existing form indices and break old session URLs / filenames / etc.

export const state = {
  form: 'radial',
  segments: 12,
  sliceCx: 0.5,
  sliceCy: 0.5,
  sliceScale: 1.0,      // BIGGER value = BIGGER slice = covers more of source
  sliceRotation: 0,     // degrees, can be any value (loops modulo 360)
  squareAspect: 1.0,    // square form only: cell width/height ratio.
                        // area-preserving normalization (W=√aspect, H=1/√aspect).
  drosteZoom: 2.0,      // droste form only: outer/inner radius ratio = scale per tier.
                        // 2.0 means each spiral turn halves; range ~1.1 to 16.
  drosteSpiral: 0,      // droste form only: spiral tightness in TIERS PER CANVAS TURN.
                        // 0 = no spiral (concentric Droste). 1 = one tier per turn
                        // (Print-Gallery feel). range 0..6. snaps to multiples of
                        // 1/drosteArms (or 2/drosteArms when drosteMirror is on,
                        // since odd values misalign at the canvas seam with mirror).
  drosteMirror: true,   // droste form only: when true, tier transitions reflect
                        // instead of teleporting — eliminates the source-side wrap seam.
  drosteArms: 1,        // droste form only: integer from {1, 2, 4, 6, 8, 10, 12}. arms=1
                        // bypasses the wedge fold (single chiral spiral). arms ≥ 2
                        // fold θ into a 1/N wedge with mirror at wedge edges (when
                        // drosteWedgeMirror is on). even-only matches segments parity.
  drosteWedgeMirror: true,  // droste form only: when true, the angular wedge fold
                            // reflects at boundaries (kaleidoscope feel). when false,
                            // plain mod (N chiral arms with hard boundary seams).
  drosteShiftX: 0,      // droste form only: per-tier SOURCE-side drift. each
  drosteShiftY: 0,      // recursive tier's source sample drifts by a constant
                        // amount toward the shift direction. canvas rings stay
                        // concentric; the content within them drifts.
  drosteOffsetX: 0,     // droste form only: Möbius pre-composition parameter in
  drosteOffsetY: 0,     // canvas space (a disc automorphism). moves the spiral
                        // pole to canvas position a = (offsetX, offsetY) while
                        // keeping the unit circle fixed and mapping each tier
                        // ring (a circle in canvas) to another circle.
                        // PhotoSpiralysis off-center-rings aesthetic.
  canvasZoom: 1.0,
  canvasRotation: 0,
  oobMode: 0,           // 0=clamp, 1=mirror, 2=transparent. clamp is default.
};

// ad-hoc "session" flags that aren't part of the kaleidoscope-defining state
// but are scoped to this run. kept separate from `state` so a save/restore of
// kaleidoscope parameters doesn't pull in UI ephemera.
export const session = {
  exportFormat: 'jpg',
  exportSize: '4096',
  isSwapped: false,
};
