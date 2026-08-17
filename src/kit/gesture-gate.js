// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// kit/gesture-gate.js
//
// ONE SHARED FACT: is some input still actively moving the slice?
//
// The slice fold (engine/geometry.js) re-expresses the slice as its own reflection once it stops
// being visible. Doing that MID-GESTURE reverses the direction the shape travels for the rest of
// the stroke, which Daniel called out twice — first for pointer drags (B636), then for the gamepad
// joystick (B639): *"when translating the slice location using a gamepad joystick the switch still
// occurs mid-push causing the direction to reverse."*
//
// **That second report is a real gap, not a missing special case.** B636 asked the wrong question —
// "is a pointer down" — when the question that matters is "is an input still moving this". A held
// joystick is a gesture in exactly the sense that matters; it simply arrives as a stream of
// discrete writes instead of pointer events. So the gate generalises rather than growing an
// exception per device.
//
// TWO KINDS OF INPUT, because there are genuinely two:
//
//   HOLDS — inputs with a real beginning and end (a pointer drag, a held button). They bracket
//           themselves, and must, because a finger resting motionless mid-drag emits no events at
//           all and any idle timer would expire underneath it.
//   TOUCHES — inputs with no end event. A MIDI CC knob just stops sending; nothing announces the
//           last turn. These keep a short idle window alive instead.
//
// ⚠️ THE IDLE WINDOW IS DELIBERATELY GENEROUS AND OVER-SUPPRESSING IS SAFE HERE. The fold is
// pixel-preserving, so delaying it changes nothing the audience can see — it only postpones which
// description of an identical picture we hold. Folding too EARLY reverses a live gesture, which the
// operator feels immediately. The two failure modes are not symmetric, so the window is sized for
// the one that costs something.
//
// ⚠️ AND IT LIVES IN A MODULE, NOT ON `env` — that is B638's lesson made structural. The same gate
// written as `env.overlayDragging` held at one call site and silently did nothing at the other,
// because the overlay component and the chrome hold different `env` objects. A fact about the one
// shared surface belongs somewhere every caller can see regardless of what it is holding.
//
// Kit layer: no DOM, no chrome, no timers of its own — callers drive it.

const holds = new Set();
let lastTouch = 0;

// How long after the last write from a source that cannot say "I'm done" we keep treating the
// input as live. Long enough to bridge the gap between two turns of a knob or two frames of a
// held joystick; short enough that the fold still lands promptly once you let go.
export const IDLE_MS = 220;

// An input with a real beginning and end. `id` is any stable token — reuse it to release.
export function holdGesture(id) { holds.add(id); }
export function releaseGesture(id) { holds.delete(id); }

// An input with no end event: extend the idle window.
export function touchGesture() { lastTouch = (typeof performance !== 'undefined' ? performance.now() : Date.now()); }

// True while anything is still moving. Callers that must never be permanently blocked should note
// that holds are explicit — see clearGestures.
export function gestureSettling(idleMs = IDLE_MS) {
  if (holds.size) return true;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  return now - lastTouch < idleMs;
}

// Panic release. A hold whose owner is torn down (an overlay re-mount mid-drag never delivers the
// pointerup that would release it) would otherwise suppress the fold for the rest of the session
// with nothing said — the "anything that can decline to act must publish why" rule, answered here
// by making it unable to strand in the first place.
export function clearGestures() { holds.clear(); lastTouch = 0; }
