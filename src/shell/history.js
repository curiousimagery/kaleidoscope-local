// shell/history.js
//
// Session-scoped undo/redo for the kaleidoscope state object.
//
// Model: two stacks (undo + redo). Each entry is a shallow copy of state
// (all values are primitives so shallow is sufficient). Push is called at
// the START of each user-initiated interaction, capturing pre-action state.
// Undo pops from undoStack, saves current state to redoStack. Redo is the
// inverse. Any new push clears the redo stack.
//
// The stacks are plain arrays capped at MAX entries each. Oldest entries
// fall off the undo stack when the cap is reached.

const MAX = 100;

const undoStack = [];
const redoStack = [];

// Capture the current state. Call this at the START of any user interaction
// that mutates state (drag, scrub, form switch, etc.).
export function push(stateCopy) {
  undoStack.push(stateCopy);
  if (undoStack.length > MAX) undoStack.shift();
  redoStack.length = 0;
}

// Restore the most recent pre-action snapshot. Returns true if applied.
export function undo(state) {
  if (undoStack.length === 0) return false;
  redoStack.push({ ...state });
  Object.assign(state, undoStack.pop());
  return true;
}

// Re-apply the most recently undone action. Returns true if applied.
export function redo(state) {
  if (redoStack.length === 0) return false;
  undoStack.push({ ...state });
  Object.assign(state, redoStack.pop());
  return true;
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
