// shell/history.js
//
// Session-scoped undo/redo for the kaleidoscope state object PLUS the
// keyframe slice of `motion`.
//
// Model: two stacks (undo + redo). Each entry is { state, motion }: a shallow
// copy of state (all values are primitives so shallow is sufficient) and a
// snapshot of the keyframe-interaction slice of `motion` — keyframes (per-kf
// copy; the thumb canvas rides by REFERENCE, it redraws on the debounced
// filmstrip rebuild), selection, playhead. Duration/loop/smoothing stay OUT of
// history: they're control-owned settings with their own UI sync, not
// keyframe interactions.
//
// Push is called at the START of each user-initiated interaction, capturing
// pre-action state — including every keyframe op (add / delete / retime-drag /
// anchor-toggle / motion-JSON load), so undo walks timeline work the same as
// param edits. Undo pops from undoStack, saves current state to redoStack.
// Redo is the inverse. Any new push clears the redo stack.
//
// The stacks are plain arrays capped at MAX entries each. Oldest entries
// fall off the undo stack when the cap is reached.

const MAX = 100;

const undoStack = [];
const redoStack = [];

function snapshotMotion(motion) {
  return {
    keyframes: motion.keyframes.map(k => ({ t: k.t, anchored: k.anchored, thumb: k.thumb, snap: { ...k.snap }, ...(k.wind ? { wind: { ...k.wind } } : {}) })),
    selected: motion.selected,
    playhead: motion.playhead,
  };
}

// The Loop Builder's trim/slice/crossfade settings (all primitives) ride history
// too, so trim-endpoint / slice-location / crossfade / behavior edits are undoable.
// Restored in place (Object.assign) so the many refs to env.clip.trim stay valid.
function capture(state, motion, clip) {
  return { state: { ...state }, motion: snapshotMotion(motion), clip: clip ? { ...clip } : null };
}

function apply(entry, state, motion, clip) {
  Object.assign(state, entry.state);
  // fresh per-kf objects so later live edits can't reach back into a stack entry
  motion.keyframes = entry.motion.keyframes.map(k => ({ ...k, snap: { ...k.snap } }));
  motion.selected = entry.motion.selected;
  motion.playhead = entry.motion.playhead;
  if (entry.clip && clip) Object.assign(clip, entry.clip);
}

// Capture the current state + motion (+ clip trim). Call this at the START of any
// user interaction that mutates any of them (drag, scrub, form switch, keyframe op,
// trim/slice/crossfade/behavior edit…).
export function push(state, motion, clip) {
  undoStack.push(capture(state, motion, clip));
  if (undoStack.length > MAX) undoStack.shift();
  redoStack.length = 0;
}

// Restore the most recent pre-action snapshot. Returns true if applied.
export function undo(state, motion, clip) {
  if (undoStack.length === 0) return false;
  redoStack.push(capture(state, motion, clip));
  apply(undoStack.pop(), state, motion, clip);
  return true;
}

// Re-apply the most recently undone action. Returns true if applied.
export function redo(state, motion, clip) {
  if (redoStack.length === 0) return false;
  undoStack.push(capture(state, motion, clip));
  apply(redoStack.pop(), state, motion, clip);
  return true;
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
