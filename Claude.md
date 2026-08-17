# working notes for Claude

This file is read at the start of every Claude Code session. It captures how the human you're working with thinks, what he expects from you, and the working conventions of this codebase. Read it once, then act on it without narration.

This file does not duplicate `docs/ARCHITECTURE.md` or `docs/HANDOFF.md`. Read those for codebase structure and current project state. This file owns the things they don't: how Daniel works, how to handle his messages, prose and design principles, standing maintenance discipline, and the guardrails.

## who you're working with

Daniel is a product designer, not an engineer. He thinks fluently in interaction patterns, system design, and product tradeoffs. He doesn't write code himself and doesn't want to debug yours. When you describe work, frame it in product terms first (what changes for the user, what tradeoff is involved, what the scope is) and only drop into implementation detail when he asks or when the implementation choice itself has a product consequence he should weigh in on.

Fold is ONE app with three modes — Still (this kaleidoscope), Motion, and Perform. (Early notes called Motion and Perform the "motion shell" and "live shell" and imagined them as separate apps; they're now modes that exist inside Fold. If you see that archaic language anywhere, it means the modes.) The forward-looking multi-app story is **conduit**: a shared infrastructure package (device/browser capability detection, rendering, and broadcast — recording, Syphon, NDI, AirPlay/HDMI, external-window) that OTHER consumer apps piggyback on so we never rebuild that plumbing per app. Those consumers are real and coming (zoetrope, tap, music visualizers, mini-games, mobile cameras). Decisions here cascade to them. When something is worth doing once-and-shared in conduit rather than twice-and-divergent, flag it.

## standing maintenance after any code change

Every code change that ships requires four updates. Before committing any code change, confirm each one is done:

- [ ] `src/version.js` BUILD counter incremented (monotonic, never resets) AND the VERSION patch bumped by one (`X.Y.Z` → `X.Y.Z+1`) on every code-shipping build. The minor/major still bump for milestones when called for; the patch increments every deploy that touches code. Docs-only changes bump neither.
- [ ] `docs/CHANGELOG.md` entry added under a new version block (one per build, since the patch bumps every build).
- [ ] `docs/HANDOFF.md` updated if the change affects current state, known issues, or what the next session should pick up. The "what's working" and "what we're doing right now" sections go stale fastest.
- [ ] `docs/BACKLOG.md` updated if a backlog item was shipped (move it to CHANGELOG and remove from BACKLOG) or a new item was discovered.

If any of the four cannot be confirmed, do not commit. Address what's missing first.

If the change is docs-only (no code touched), none of the above applies.

## execution conventions

**Plan mode is a tool constraint, not a behavioral one.** Even when not in plan mode, if a request involves new patterns, architectural choices, or anything spanning more than two files, propose the approach in prose first and wait for a yes before editing. Single-file targeted fixes that follow existing patterns can proceed directly.

**Surface non-obvious choices before committing to them.** Which file something belongs in, whether to extract a helper, naming, what counts as "done." Daniel is quick to course-correct and prefers a 30-second checkpoint over a refactor.

## debugging discipline (read `docs/DEBUGGING-PROTOCOL.md` before any investigation)

A forensic review at B575 found that ~11 investigations in this arc measured something semantically adjacent to the phenomenon, and that roughly a third of device sessions went to questions a `grep` would have answered. The protocol doc owns the detail. These are the parts that are non-negotiable and must survive into every session:

**⚖️ FIRST, PICK THE TIER (B609). The protocol is not always-on, and applying it everywhere costs more velocity than it buys.** `DEBUGGING-PROTOCOL.md` §0 owns this. Two questions decide it: *can you directly observe the thing you are changing*, and *what does being wrong cost?*

- **Tier 3 — just work.** Local, visible, verifiable by looking. Most UI, refactors, single-file fixes, input and layout work. **No ceremony. Batch freely.** If you would know it was wrong by looking at the screen, you are here.
- **Tier 2 — name two things.** Architectural or multi-file, but locally verifiable. Name the uncertainty state and the stopping rule. Nothing else.
- **Tier 1 — everything below applies.** Being wrong costs a device session. **Invisible quantities**: frame timing, audio, thermal, memory, GPU.

**The protocol governs the INVESTIGATION, not the FIX** — once the cause is known, building the fix is ordinary work.

**Tier 1 rules:**

- **Name the uncertainty state before proposing anything: A** (don't know what) **/ B** (know what, not why) **/ C** (know why, not which lever) **/ D** (enough evidence, no stopping rule). **In state A the only legal move is instrumentation, never a fix.** State D is the invisible one: it feels productive.
- **The wrong-noun test.** Before shipping an instrument, complete: *"this counts X, which equals what I care about only if ___ holds."* Activity counters (batches, chunks, calls, render counts) may ride along; they may never conclude. Prefer a **conserved quantity** that must survive the boundary.
- **State the five-line pre-flight in the response**, not just internally. Goal + exit criterion; uncertainty state; Class 1 resolved?; what the measurement cannot distinguish; the stopping rule. **Writing it in the response is also what makes it survive compaction.**

**At EVERY tier, because they are free:**

- **Class 1 vs Class 2 — this is a SPEED rule, not a caution rule.** Class 1 = "does our code do what we think" (resolved by reading code or one local run). Class 2 = "what does the platform do" (needs a device). **Never spend a device session on a Class 1 question.**
- **Anything that can decline to act must publish why.** An absence is not evidence.

## codebase conventions you must internalize

Read `docs/ARCHITECTURE.md` before working on anything you haven't worked on recently. The architecture doc is authoritative for: forms registry, engine/shell separation, state location, the `env` runtime container, GLSL composition, and the slot/divider mechanics. Don't restate any of that here; just follow it.

**⚠️ THERE ARE TWO CHROMES AND THEY SHARE NO `env`.** `src/main.js` (desktop, which iPad runs) and `src/mobile/chrome.js` (phone) each build their own `env` object and wire their own controls. **A helper added to one does not exist in the other.** This single fact has produced seven bugs in this arc, four of them found only by a device session or a live show, and every one of them was invisible on the machine it was written on.

So, whenever you touch anything both chromes use:

- **A function injected into shared code must take everything it needs as arguments.** If a shared module calls a callback you passed in, that callback cannot rely on closing over one chrome's variables. **Why it matters:** the chrome whose shape happens to match keeps working, so the bug only appears on the *other* one — and often silently, because callers guard these paths. B627 was exactly this: `resetSliceState` called an injected `applyArmsSnap()` with no arguments, which suited the desktop wrapper and threw in the mobile chrome, and the iPhone quietly never centred its slice for four builds.
- **Never give a local wrapper the same name as the shared function it wraps.** Same name plus different signature is what makes the above invisible in review. Suffix it (`applyArmsSnapLocal`), and hand shared code the shared function.
- **When you fix something in one chrome, grep the other for the same behaviour before you call it done.** "Verified on desktop" is not verified.

**⚠️ AND IT IS NOT ONLY THE TWO CHROMES (B638).** `src/components/source-overlay.js` builds its own private `view` object — its comment says it *"replaces the global desktop `env`"* — so there are at least THREE env-shaped objects in play, and a flag set on one is invisible to the others. B638 was exactly this: a gate written as `env.overlayDragging` held at the drag site (component view) and silently did nothing at the render site (chrome env), which is worse than not having it. **Before writing `env.someFlag` in shared code, ask which object the CALLER will be holding.** A fact about the one shared surface — is a gesture in flight, is a drag active — is usually module-global, and belongs in a module variable that every caller sees regardless of which env it passes. If you do put it on `env`, it must be set on every env that will be asked about it.

When a value or behaviour genuinely needs to exist in both, prefer moving it to `kit/` or `engine/` and importing it, over writing it twice. `kit/pan.js` and `engine/geometry.js` `resetSliceState` are the pattern.

Two specific rules worth flagging because violating them costs hours:

- **Don't put backticks inside a form's `glsl` string.** It's a JS template literal and a backtick inside breaks parsing silently. If a future form's GLSL needs a backtick, escape it carefully or restructure the surrounding string.
- **Single state object means undo/redo is cheap.** If you're touching state mutations, consider whether the change should integrate with the history stack rather than bypass it.

## verifying UI work (B631, after this happened twice in three builds)

**Verifying the mechanism is not verifying the feature.** Two shipped increments in a row had correct logic and no working path through the UI: B624's per-form mapping could not be reached because learn refused to create a second binding, and B629's prompt for that was inserted into a scrolled container where it rendered off-screen. Both tested fine as code and were broken as features.

So, before calling any UI change done:

- **Walk the user's actual path**, not the code path. Click what they would click, in the state they would be in.
- **Render it in a REALISTIC state** — a full mapping list, a real rig, a long source name. Empty-state correctness hides overflow, scroll and truncation bugs.
- **Ask what happens on the second interaction**, not just the first: the release after a press, the reopen, the same control twice.

## UI Lab discipline

The UI Lab (`lab.html` / `src/lab.js`) is the living inventory of the app's UI surface. Two standing rules so it never becomes whack-a-mole:

- **Before adding any new component, style, or visual pattern, check the Lab first** for an existing component/token/text-style that already covers it. Reuse beats invention; the Lab exists to surface exactly this.
- **Every new component or style that ships in app code lands in the Lab in the same increment** — with its state matrix (hover/active/disabled/error variants), rendered from the real classes/CSS, not a copy. A component that isn't in the Lab doesn't exist as far as the design system is concerned.
- **Every new `?url` parameter lands in the Lab's URL-parameter cheat sheet (`LINK_PARAMS` in `src/lab.js`) in the same increment.** That sheet is the only index of them; an unlisted param is undiscoverable.

## on-device diagnostics

Daniel tests the Capacitor builds on a physical iPhone and iPad. **He does not run Safari Web Inspector**, and reading `console.*` output means attaching Xcode. So:

- **Anything you add for him to read must reach the exported report** (the frame-cost panel's `copy report`). That is the channel every device reading in this project has actually arrived through. Console output is a bonus, never the only route.
- **Publish, don't just log.** The established shape is `conduit/recorder.js`'s `reportAudio()` → `env.lastAudioReport` → `shell/perf-panel.js`'s export. Follow it.
- **Cover fallback paths too** — a take rescued by a fallback must not read as a failure, or the report aims the next build in the wrong direction.

`docs/DEVICE-TESTING.md` has the full instructions for all three channels and the Xcode filter strings. Two builds were spent guessing at a bug whose evidence existed but was unreadable; treat an uncollectable diagnostic as no diagnostic.

## prose style

- Code comments explain *why*, not *what*. The code shows what.
- When writing explanations to Daniel, lead with the conclusion and follow with the reasoning. He's a senior reader; he'll ask for more if he wants it.

## things you'll be tempted to do that you shouldn't (without asking first)

These aren't blanket prohibitions. They're things Claude Code is tempted to do silently or opportunistically that Daniel needs to weigh in on before they happen.

- **Don't refactor opportunistically inside an unrelated change.** If you spot something worth restructuring or cleaning up while doing other work, *do not* fold it into the current change silently. Surface it as a separate proposal with the tradeoff: what would improve, what the scope of the change would be, what the risk is. Daniel may not know to ask for cleanups he can't articulate in code terms, so proactive flagging is welcome — just don't bundle it into unrelated work.

- **Don't infer urgency.** If something looks broken in a way Daniel didn't mention, flag it. Don't fix it silently as part of an unrelated change.

- **Don't add libraries without asking.** This project is plain Vite + vanilla JS + GLSL on purpose. If you genuinely need a new dependency, surface it as a question first with the reasoning.

- **Don't introduce build steps without asking.** No TypeScript, no linters, no preprocessors unless requested. If you think one would help, propose it; don't add it.

- **Don't write tests for code that doesn't have tests yet.** Test infrastructure is a deliberate future decision; don't set the precedent in a feature commit. Propose it as its own piece of work.

- **Don't assume Daniel sees what you describe.** He's caught Claude hallucinating UI elements before, in this project and others. When describing the running app, browser dev tools, or any external UI, be tentative and defer to what he actually sees on screen.

- **Don't add "Co-Authored-By" lines to commit messages.** No acknowledgment of Claude in commit history. If Daniel wants to acknowledge collaboration, that goes in README.md, not in git log.

The pattern: proactive proposals are welcome, silent expansions of scope are not. When in doubt, pause and ask.