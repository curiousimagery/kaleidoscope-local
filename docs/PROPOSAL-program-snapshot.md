# Proposal: the program-snapshot discipline (Capacitor arc, Lane 4A)

**Status:** for Daniel's approval before any code. This is the "propose before implement" checkpoint the arc plan names for Lane 4A. Nothing here is built yet.

**Scope:** a contained refactor of one existing seam (`env.programState()`). No intended behavior change for the shipping web or desktop app. It is the shared prerequisite that makes the HDMI state-stream (Lane 3) and the iOS native-capture path (Lane 4B) sound instead of racy.

---

## The conclusion first

Today every output destination (record bus, output window, live PiP, and soon HDMI / NDI / native capture) reads the live, still-mutating `state` object, each on its own render loop. It works because we patch each known leak with a bespoke lock: the motion-driven edit lock, the video seek guard, the perform follower's easing. That does not scale: the control bus already writes `state` "exactly like a hand on a slider," and every new real-time input (audio, OSC, more MIDI) adds another way for a half-finished value to leak into a broadcast, each needing its own new lock.

The proposal replaces the one-off locks with a single rule:

> **A single writer publishes an immutable, timestamped snapshot of the program look at one defined commit point per frame. Every consumer reads the last committed snapshot, never the live `state` object.**

It is cheap now and it is the thing that lets a phone or iPad broadcast out cleanly.

---

## Why this is the next lane, and why now

Three costs from the arc plan drive it:

1. **A full second render per frame.** The record bus renders the program a second time on its own offscreen engine (`shell/output-engine.js`) because the visible preview can't be commandeered every frame. That second render reads `state` on the bus's own clock.
2. **It is Apple-Silicon-shaped.** The whole `drawImage` + `getImageData` path exists to dodge the ~43ms readPixels wall on ANGLE-Metal. The native iOS path (Lane 4B) removes the readback entirely, but only if what it captures is a committed frame, not a value caught mid-edit.
3. **A two-loop shared-state bug class that is getting worse.** Independent loops sample one mutable object at an arbitrary phase relative to input. Every real-time writer we add (control bus is live; audio and OSC are on the roadmap) multiplies the ways a transient can be sampled and broadcast.

And the concrete unblock: **HDMI cannot ship without this.** A second `WKWebView` loading `output.html` will not work, because `BroadcastChannel` does not cross `WKWebView`s. The external view has to render from a committed state-stream. The committed snapshot this proposal defines *is* that stream.

---

## How it works today (precise)

**One mutable object.** `state` (params: slice, droste, warp, oob) in `shell/state.js`. `session` holds output settings. Undo/redo is cheap precisely because there is one object.

**Many writers into it:** sliders, the source-overlay drag, output-panel gestures, motion playback sampling params in every frame, autoplay drift, camera controls, and the control bus (MIDI / gamepad / trackpad / phone), which the input-bus header describes as writing `state` "exactly like a hand on a slider."

**The seam:** `env.programState()` (defined in `shell/perform-runtime.js`) returns, in precedence order:

```
perform follower snapshot  (env.performRT.followed)
  ?? motion committed loop  (env.motionStageLive())
  ?? the live working state (env.state)
```

**The consumers, each on its own clock:**

| Consumer | Reads | Loop |
| --- | --- | --- |
| Preview | `engine.render(state)` | `scheduleRender` rAF, on demand |
| Record bus | `hidden.render(programState())` in `output-engine.js` | the bus's own rAF |
| Output window | `postMessage(programState())` in `output-window.js` | its own rAF (structured-clone) |
| Live PiP (perform) | `pipEngine.render(followed)` | the perform tick |
| HDMI / NDI / native | (future) | (future) |

**The good precedents already in the tree** (this proposal generalizes them, it does not invent from scratch):

- The **perform follower** already publishes a fresh snapshot object every step (`follower.step(dt)` returns a new object; `env.performRT.followed`). It is effectively an immutable, per-frame committed look on its own clock.
- **Motion staging** already forks a committed set from the staged set; the committed loop drives every broadcast on its own clock while you edit off-air (`env.motionStageLive()`, `env.programVideo()`). That is the single-writer-commits pattern, applied to one case.

**The one-off locks this replaces:**

- `isMotionDriven()` -> `editLocked` in `main.js`: blocks slice editing during playback/scrub so a doomed edit does not leak into Syphon ("the wedge jumps in Syphon").
- The video **seek guard** in `output-engine.js` / `perform-runtime.js`: holds the last texture upload through a seek so stray decoder frames do not flicker the broadcast.

---

## The core problem, named precisely

It is **not** torn reads. JavaScript is single-threaded, and each `render(state)` reads the object synchronously, so no consumer ever sees a half-written object.

It is **temporal and semantic.** Each consumer loop samples the shared mutable state at an arbitrary phase relative to when inputs mutate it, so it can publish a value the app itself considers transient and not yet presentable:

- a manual edit made during motion playback that the next animation tick will clobber,
- an intermediate decoder frame while a video seek resolves,
- (tomorrow) an audio- or OSC-driven value caught between two writers before per-field arbitration settles.

Every one of those today gets its own suppression bolted on at the input side. The rule below moves the correctness to one place: what gets *published* is always a look the app has committed to.

---

## The proposed contract

**One published snapshot** on `env`:

```
env.programFrame = {
  params,   // a plain copy of the presentable param look (what state was at commit)
  gen,      // monotonic counter; bumps only when the committed look changes
  t,        // commit timestamp (performance.now)
  video,    // the audience video clock {t, paused, rate} (folds in videoSync/programVideo)
}
```

**One writer:** `env.commitProgram()`. It computes the presentable look using the exact precedence `programState()` uses today (follower ?? motion committed ?? state), snapshots it, bumps `gen` when it differs, and assigns `env.programFrame`. It is called at one defined point per frame (below).

**Back-compat during migration:** `env.programState()` stays, but becomes a thin accessor returning `env.programFrame.params`. So nothing breaks the moment the writer lands; consumers migrate to reading `programFrame` one at a time.

### The commit point

The app already has a natural "this look is coherent now" moment: the authoritative state advance each frame. Commit sits right after it, per driver:

- **Still mode:** after an input applies (the `scheduleRender` frame that renders the preview). The preview render and the commit see the same look, so every broadcast matches the preview exactly.
- **Motion playback / scrub:** after the animation samples `state` for the frame. The committed look is the sampled animation state, never the about-to-be-clobbered manual edit. **This is what lets us delete the edit lock as an input lock** (see decision 2).
- **Perform:** after `follower.step`, commit the followed snapshot. This is essentially already happening; we formalize it as the same call.
- **Autoplay drift:** after `drift.tick` writes `state`, commit.

The snapshot governs **params only.** Source-pixel freshness (camera / video re-upload) stays the separate concern each consumer already handles via `updateSourceFrame`; the seek guard stays exactly where it is. Cleanly separating "which params" from "which pixels" is what keeps the change contained.

### What each consumer becomes

| Consumer | Today | After |
| --- | --- | --- |
| Record bus (`output-engine.js`) | `hidden.render(programState())` | `hidden.render(env.programFrame.params)` |
| Output window (`output-window.js`) | posts `programState()` every tick | posts `programFrame`; may skip when `gen` is unchanged and the source is static (fewer redundant posts) |
| Output view (`output-view.js`, the popup) | renders `latestState` on message | unchanged shape; now only ever receives committed frames |
| Live PiP (perform) | reads `followed` | reads `programFrame.params` for consistency (optional; same value) |
| HDMI external view (future) | n/a | renders `programFrame` posted into the second `WKWebView`: this is the state-stream |
| NDI / native capture (future) | n/a | captures the committed frame, no state race by construction |

### What the one-off locks become

- **The motion edit lock:** today it blocks the *input* so a transient never enters `state`. Under the rule, even if a transient enters `state`, the commit publishes the animation-sampled look, so no broadcast ever sees the transient. The lock becomes optional (decision 2).
- **The seek guard:** unchanged. It is a source-pixel concern, orthogonal to the param snapshot.

---

## Interplay with the things we must not break

**Undo/redo (the single-state-object rule).** The snapshot is a read-side copy of the presentable look. It never feeds back into `state` and never touches the history stack. Undo/redo keeps mutating `state`; the next commit republishes the restored look. We are not adding a second source of truth, only a published read-copy of the one we have. This respects the "single state object means undo/redo is cheap" rule in CLAUDE.md.

**"Manual wins per field" (the drift / control-bus contract).** Per-field arbitration between competing real-time writers happens *before* commit, in the input and drift layer where it already lives. The snapshot is just the final committed look, so it composes with per-field ownership rather than competing with it. This is exactly why input-bus can keep writing `state` "like a hand on a slider" and get correct broadcasts for free.

---

## Blast radius and sequencing

**Contained.** Only four files reference the seam today (`output-engine.js`, `output-window.js`, `perform-runtime.js`, `motion-runtime.js`). The change is: add the writer and `programFrame` (a small `shell/program-frame.js`, or a few lines in `main.js`'s scheduler plus the runtime loops), point the writer at the right commit points, migrate the four consumers, then decide the edit lock's fate.

**Order within the arc (unchanged from the plan):** A first (this), then C (extract `stage/` + the host seam to its own repo, a dedicated session), then B rides the Capacitor arc as the iOS native-capture path. A is the shared prerequisite: extracting or natively capturing a racy contract would just propagate the race.

**What A unblocks immediately:**
- Lane 3 HDMI: post `programFrame` into the external `WKWebView` view. That is the state-stream `BroadcastChannel` cannot carry across web views.
- Lane 4B iOS native capture and NDI out: both capture the committed frame.

---

## Verification plan (no device needed for A)

A is pure web / shared code, so it is fully verifiable in this environment:

- `vite build` clean.
- A render-equivalence check: drive `state` through a scripted sequence (a slider ramp, a slice drag path, a short motion play), and assert that `programFrame.gen` bumps once per committed look and that `programFrame.params` matches what the preview rendered at each commit. This is the same shape as the token-parity harness used to prove Builds 206-208 were visually neutral: prove the change is behavior-neutral before trusting it.
- Confirm the record bus and output window produce the same look as the preview across that sequence.

Device verification returns at B, not A.

---

## Decision points for you (the checkpoints)

1. **Commit granularity.** Commit on every state-advance frame (simplest, unconditional), or only when a "coherent" gate says so? *My recommendation: every state-advance frame. The presentable-vs-transient distinction is handled by where the commit sits per driver, not by a gate.*
2. **The motion edit lock.** Keep it as an input lock (the local preview also refuses the doomed edit, current feel preserved), or relax it and let the snapshot alone keep broadcasts correct (the local preview would then show a scrub you can make that the animation immediately overwrites)? *My recommendation: keep it for now. The snapshot makes broadcasts correct regardless, so the lock becomes belt-and-suspenders we can relax later once you have hands-on time.*
3. **Immutability mechanism.** `Object.freeze` the snapshot (guards against an accidental write, tiny cost) or a plain fresh copy (cheaper)? *My recommendation: a fresh shallow copy in production; freeze only in a dev build if we ever want the guard.*
4. **Where the writer lives.** A few lines threaded into `main.js`'s scheduler and the runtime loops, or a small `shell/program-frame.js` module that owns `programFrame`, the commit, and the perform/staging precedence? *My recommendation: the small module. It is the seam Lane 4C extracts later, so giving it a home now pays for itself.*
5. **Naming.** `programFrame` / `commitProgram`. Fine, or align to vocabulary you prefer?

---

## What I will not do without your yes

Implement it. This document is the checkpoint. On approval I will build it on a branch, one commit, with the four-part standing maintenance and the render-equivalence check above, and report back before touching anything downstream (HDMI / native capture).
