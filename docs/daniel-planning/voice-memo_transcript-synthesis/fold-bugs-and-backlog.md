# Fold: Bugs and Feature Backlog

Synthesized from voice memo transcripts: Andrew usability test (Jun 30), Jul 4 Bellingham drive, Jul 17 river session, Jul 20 barefoot-by-the-river session, Aug 2 family demo. Quotes are lightly cleaned for readability but kept in your voice where the texture matters.

---

## Motion & Loop Editor

- **Decision (already made, worth restating):** Loop mode and linear (non-loop) mode are both handled inside the motion editor, not as separate top-level app modes. Live Perform stays a separate top-level mode since its feature set has diverged enough to warrant it.
- **Rule (settled):** If a loaded file's first and last frame differ, infer it's not a loop. Only entering the loop editor through the cross-fade or bounce wizard switches you into loop mode with a split first/last keyframe. Trimming edges or changing fps inside the loop editor does not switch you into loop mode.
- **Feature: discoverability of the loop editor.** First time a non-loop file lands in motion mode, show a lightweight, dismissible callout pointing at the loop editor entry point (currently buried in the overflow menu). Same treatment on the way out: when the loop wizard silently switches someone into loop mode, tell them what happened and how to get back.
- **Feature: mode status indicator.** Motion editor needs a visible "linear mode" vs "loop mode" indicator, plus a clear entry point back to the loop editor. Right now this is invisible state.
- **Bug: first keyframe is deletable.** It shouldn't be. It should auto-instantiate from current state and be editable, not deletable. (Andrew's test: deleting it put the app into a stuck, buggy state mixing an old form with a new one.)
- **Bug: undo doesn't cover keyframe edits.** Undo currently only rolls back segment/wedge manipulation, not keyframe add/delete. "Key frame edits should be on the undo stack in addition to the overlay segments."
- **Bug: form picker can become hidden.** On Drosta specifically, the form picker in the right settings panel collapses out of view because that form has more settings than fit on screen. Toggling motion mode on/off while this is hidden traps people (Andrew: "I want to go back to the other form... I don't know where we were first").
- **Bug: disabled state isn't shown.** All controls disable during playback but don't render as disabled, which reads as broken rather than busy.
- **Bug: timeline disappears briefly during rerender.** Flagged as a rendering tradeoff (show stale data vs blank), needs a decision either way.
- **Bug: timeline is too small on iPad.** "It should be almost twice as big as it is."
- **Feature gap: no keyboard shortcuts.** Space to play, delete to delete a keyframe, some key (K suggested) to add one. None exist yet.
- **Open question: implicit vs explicit keyframing.** If someone drags a slider and doesn't click "add keyframe," should the edit be assumed as a new keyframe, or discarded when they move on? You've gone back and forth on this; still unresolved. Related nuance: it's possible to add a keyframe that holds no actual property change relative to the interpolated path in between. Harmless, but doesn't add anything.
- **Decision needed: segment/form lock behavior once keyframes exist.** Currently, once you have more than one keyframe, segment count and form type both lock. Two options discussed: (a) let the property still be edited but cascade the change across every keyframe, with a one-time warning ("this will apply to the whole animation, don't show me this again"), or (b) keep the hard lock. Andrew's instinct was to prefer the cascade.
- **Feature: gesture recording mode.** Currently unbuilt. Concept: instead of only interpolating the simplest path between two keyframes (e.g. a 350-degree rotation snapping back 10 degrees), a "gesture" would record the actual path you took while manipulating a segment live, without stuttering on every micro-pause. Framed as adjacent to, not replacing, slider-based keyframing.
- **Feature: source preview + motion JSON export.** Already working: exporting bundles a rendered source preview video with a custom "fold motion" JSON describing segment and timing data, so the same motion can be reapplied to a new image. Flagged concern: file size ("this is not a tiny file"), worth checking before this becomes a sharing bottleneck.
- **Note:** Frame rate is fixed at 30fps regardless of duration; no clear case yet for a 60fps toggle.
- **Bug: Drosta seam visibility.** A visible seam at the wedge intersections was patched in the main source overlay view, but the fix didn't propagate through to the actual render/export path, "duplicating that logic." Also reported separately as reappearing when certain parameters are animated. Needs one shared fix across all render paths, not a per-view patch.

---

## Segment, Slice, and Origin Manipulation

- **Feature: infinite zoom in Drosta**, planned, extend to the hyperbolic sphere form when it's added.
- **Idea: lateral traverse pan** across a tiled output, not just centered zoom. Theoretically applicable even to non-tiling forms like radial wedge.
- **Bug/polish: segment touch targets** need tightening; fat-fingering the segment count is still common even after earlier work on this.
- **Bug: segment-count drag direction inconsistency.** Reported as sometimes inverting relative to finger direction. Worth checking whether it should be measured as absolute up/down motion vs. relative toward/away from the slice.
- **Decision needed: origin/center lock defaults.** Should default to locked and excluded from auto-parameter capture across motion, live, and still modes. Currently inconsistent per form. Aug 2 note: center lock should be a universal parameter across all forms (not just Drosta and radial wedge), though possibly with different default lock states per form.
- **Idea: origin-past-edge behavior.** When the origin is dragged near the canvas edge, the "yellowed" reflected region that extends beyond canvas is unclear. Proposed fix: instead of clamping the origin at the edge, let it push through and swap roles with its reflection (whichever half stays on-canvas becomes the new primary/origin). Flagged as conceptually elegant but untested for clarity in practice.
- **Open question: Drosta default state.** Currently starts as a single unmirrored full circle, which hides wedge-mirroring from new users. Considered defaulting to a quarter-wedge instead, matching how other forms self-teach through their defaults. Tension: locking wedges by default makes the full-circle mode hard to discover. Possibly Drosta and radial wedge need different default lock states (Drosta better unlocked, radial wedge better locked), but this is a hypothesis, not tested.
- **Idea: cross-form value normalization.** Parameter scale differs wildly between forms (triangle/hex render tiny at the same slider values that make radial wedge/Drosta/rectangle huge). If values carry over when switching forms, they should scale proportionally rather than transfer literally.

---

## Camera & Capture (Mobile)

- **Bug: broken state after downloading a photo in live-camera mode.** After capturing and downloading a still from the mobile live-camera view, returning to the app leaves the output panel in a failed/frozen state that doesn't recover without force-quitting. Reproducible; previously thought fixed once already.
- **Feature: hardware button capture.** Users instinctively reach for the iPhone action button or volume rocker to capture (Sylvia, in the Aug 2 demo, went straight for the action button and left the app). Worth checking how ProCamera-style apps bind these.
- **UX: capture flow needs a much louder cue.** The pause-then-capture flow is not obvious even to people who've been told about it. Wants something closer to an explicit "hold still," a 3-2-1 countdown, and a visible flash/confirmation on capture.
- **UX: 49MP default is overkill and unexplained.** Resolution numbers (2K/4K/6K) mean nothing to non-technical users without a concrete size reference, e.g. "big enough for a postcard" vs. "big enough to cover a wall."
- **UX: EV vs. white balance gesture confusion.** Adjustments to one sometimes register as the other.
- **Idea: "magic mirror" / big camera mode.** Double-tapping the output to fully hide the source panel and use the live camera as a full-screen "see the world differently" view. When the slice is physically visible/oriented in real life, the separate source preview panel becomes redundant. Flagged as a potentially fundamental shift for the mobile experience, not just a toggle.
- **Note: PWA vs. Safari.** Double-tap-to-zoom in mobile Safari interferes with in-canvas interaction. Worth checking whether running as a PWA sidesteps this without introducing new problems.

---

## Save & Export

- **Bug (confirmed, root cause identified):** Saved packages (mirrored composition + source image) were writing to the iCloud **Documents** folder instead of the iCloud **Downloads** folder you expected. This caused a real scare in the field, testing with Shawna, of thinking captures were lost when they weren't.
- **UX: save flow has too many redundant confirmations.** Currently: tap save in-app, tap save again in the app's own sheet, then confirm again in the native iOS share sheet, which doesn't auto-close afterward.
- **Idea: rework export around an "ingredients" checklist** rather than the native multi-file share sheet, which doesn't handle consecutive multi-file saves well on iOS. Concept: list out what's available to save (still, output, SVG overlay, source video + audio) with a description per item, save each individually, and mark each with a completed checkmark once saved. Referenced Snapseed as a model for a save flow that handles multiple export options gracefully.

---

## Still Mode: Tile & Pattern Builder (new marquee feature)

- **Feature: tile/pattern mode.** Applies to the inherently tileable forms only (rectangle, triangle, hexagon). Two output types: (1) a single cut tile as PNG (transparent) or JPEG, with a companion SVG describing the vector edge for physical cutting; (2) a "zoomed out" preview showing the pattern repeating edge to edge.
- **Open question: discoverability, same shape as the loop problem.** Should tile mode be a persistent, always-visible control, or something surfaced only when we detect a tileable canvas state (with a hint, similar to the loop nudge)? Leaning toward the hint-based approach rather than cluttering the UI by default.
- **Idea: canvas zoom snap points.** Canvas zoom should be able to snap to tileable increments. Add a view toggle to preview a single tile unit vs. the fully repeated pattern.
- **Open question: edge treatment for laser-cut use cases.** Should the exported tile carry full mirrored content across the whole shape, or should it expose the literal (pre-mirror) edge? Matters for laser cutting where someone wants a single clean tile with a visible edge, not something mid-mirror.

---

## Companion / Social Layer (new concept, from the Jul 17 river session)

Framed as the answer to a real problem raised by Libya after seeing an early demo: "It's cool that you can make this stuff, but what do I do with it? I don't want to just fill up my camera roll with kaleidoscope photos. I'm not making photo prints, I'm not doing an art show, I'm not a VJ."

- **Feature: personal collage/grid canvas.** Built on the same tileable-forms infrastructure as the pattern builder above. Users drop individual saved tile compositions into a persistent grid over time, e.g. a small daily-commute ritual of noticing and capturing one composition. Technical dependency: the existing PNG/JPEG output plus companion SVG overlay, placed at a grid coordinate.
- **Feature: shared/social variant.** A small group (sibling group chat was the example) each contributes tiles to a shared grid, discovering what others add. Suggested soft rate limit (1 to 3 additions per person per day) to avoid noise.
- **Dependency flagged:** meaningful storage/sync at any real scale likely needs an Apple Developer account with provisioned iCloud storage. Not yet scoped past that.

---

## Live Perform Mode

- **Idea: clip/stage queue.** Ability to "clear the deck" and send a whole pre-built motion package (JSON + source, the same pairing already used for export) into a queue for live performance. Implies a need for save files/workspaces and referencing media across sessions that don't yet exist; framed as a natural extension of the motion JSON + source pairing you already have, not new file infrastructure.
- **Open question: manual override during a pre-programmed sequence.** If you physically override a running sequence during a live set, should it drift back to the programmed sequence automatically, or stay overridden until manually reset? A settable "autoplay-after" vs. "manual-after" mode was floated but not decided.

---

## Cross-Platform

- **To-do: Android has not been tested at all.** Flagged twice as an open gap, no findings yet.

---

## Related, Not Yet Built: Procreate-Style Live Drawing Integration

Concept: apply Fold's symmetry engine in real time on top of a freehand drawing surface, similar to Procreate's canvas mirroring but with Fold's full symmetry math. Technical mechanism envisioned as mirroring only the canvas content (no toolbars/UI) into Fold as a live source, possibly via an AirPlay-style feed. This has both a technical/backlog dimension (source input type) and a partnership dimension; see the GTM doc for the pitch angle.
