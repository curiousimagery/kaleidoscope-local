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
