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
  drosteOffsetX: 0,     // droste form only: combined center-offset parameter.
  drosteOffsetY: 0,     // drives BOTH (a) canvas-side Möbius pre-composition
                        // M(p) = (p−a)/(1−conj(a)·p) — disc automorphism that
                        // shifts the spiral pole to canvas position a while
                        // keeping the unit circle fixed and mapping each tier
                        // ring to another circle (PhotoSpiralysis off-center
                        // rings), and (b) source-side per-tier drift —
                        // z_src += u_drosteOffset · (1 − r/r_src) — deeper
                        // tiers' source content drifts toward `a`. one handle.
  canvasZoom: 1.0,
  canvasRotation: 0,
  oobMode: 1,           // 0=clamp, 1=mirror, 2=transparent. mirror is default.
};

// ad-hoc "session" flags that aren't part of the kaleidoscope-defining state
// but are scoped to this run. kept separate from `state` so a save/restore of
// kaleidoscope parameters doesn't pull in UI ephemera.
export const session = {
  exportFormat: 'jpg',
  exportSize: '4096',
  isSwapped: false,   // sibling panels mirrored (source right of output) — see stage-split
  frameAspect: 1,     // output frame aspect (width/height): 1 = square, 0.8 = 4:5, 16/9 = 16:9.
                      // a global output-framing choice (not animated); reshapes the preview
                      // canvas (WYSIWYG) and is inherited by still + video export.
  stageSrcPct: 32,    // source panel's share of the stage split (percent). Output-dominant
                      // by default (the artwork is the show); the stage divider drags it.
  performResponse: 0.35,  // perform-mode transition speed (the follower's response, seconds):
                      // ~0 = instant, bigger = slower easing of the live output toward edits.
  performVideoSpeed: 1,   // perform-mode source playback rate (a video source loops while
                      // performing; presets 50–200%, separate from motion's retime).
  performLayout: 'pip',   // where the LIVE view lives in perform: 'pip' (docked over the
                      // stage — the practical default) or 'three' (a third sibling panel).
  performAutoPace: 0.5,     // autoplay: how often a new destination is initiated
  performAutoRange: 0.3,    // autoplay guardrail: max normalized distance from each field's home
  performAutoVariety: 0.6,  // autoplay breadth: how many fields wander at once
  performAutoSmooth: 0.65,  // autoplay motion smoothing: the wander spring's response (bigger = silkier)
                      // (defaults = Daniel's 2026-07-09 calibration, remapped to mid-slider)
  stageLivePct: 32,   // the live panel's share of the stage split in the three-panel
                      // layout (percent; the live divider drags it).
  hdmiFill: false,    // external display (HDMI): false = fit the canvas frame aspect
                      // (WYSIWYG with recording/save, letterboxed), true = fill the
                      // display edge-to-edge at its native aspect (installation mode).
};

// motion-mode authoring data (Phase 3 — multi-keyframe still-animation;
// desktop/iPad only). kept OUT of `state` on purpose: a keyframe IS a {...state}
// snapshot, so the captured snapshots can't live inside the thing they snapshot.
// parallel to `session`, threaded via env.motion. reset on reload (not carried
// across a responsive chrome switch — motion is desktop-only).
export const motion = {
  keyframes: [],      // [{ t: 0..1, snap, thumb, anchored }], sorted by t. keyframe 0
                      // (t=0) is the start AND the loop-return target. `anchored` =
                      // hand-positioned (fixed t); non-anchored keyframes auto-space
                      // evenly between the anchors.
  durationMs: 30000,  // total animation length (the full 0..1 span)
  loop: true,         // close the cycle by tweening the last keyframe back to kf0
  smoothing: 0,       // 0..1 motion smoothing degree. Velocity-continuity through
                      // keyframes is ALWAYS on (Catmull-Rom baseline); this extra
                      // amount relaxes jaggy keyframe values toward a smoother path
                      // (0 = exact keyframes, higher = more fudging). See sampleAt.
  playing: false,
  playhead: 0,        // 0..1 scrubber position
  selected: -1,       // index of the selected (editable) keyframe, or -1
  videoSpeed: 1,      // VIDEO sources only: playback-speed multiplier (0.25=¼× slow-mo,
                      // 2=2× fast). The locked durationMs = nativeDurationMs / videoSpeed,
                      // so the timeline + export stretch/compress the clip. Stills set
                      // durationMs directly and ignore this.
};
