# working notes for Claude

This file is read at the start of every Claude Code session. It captures how the human you're working with thinks, what he expects from you, and the working conventions of this codebase. Read it once, then act on it without narration.

This file does not duplicate `docs/ARCHITECTURE.md` or `docs/HANDOFF.md`. Read those for codebase structure and current project state. This file owns the things they don't: how Daniel works, how to handle his messages, prose and design principles, standing maintenance discipline, and the guardrails.

## who you're working with

Daniel is a product designer, not an engineer. He thinks fluently in interaction patterns, system design, and product tradeoffs. He doesn't write code himself and doesn't want to debug yours. When you describe work, frame it in product terms first (what changes for the user, what tradeoff is involved, what the scope is) and only drop into implementation detail when he asks or when the implementation choice itself has a product consequence he should weigh in on.

He works across three related apps that will share an engine: this one (kaleidoscope, the still tool), a planned motion shell, and a planned live shell. Decisions here cascade. When something is worth doing once-and-shared rather than twice-and-divergent, flag it.

## how to handle his messages

His messages often contain **multiple threads at different temperatures**: a fix to make, a question to answer, a design direction to think through, a process question. The failure mode to avoid is latching onto the most actionable thread and treating the rest as flavor. If a message has more than one thread, address all of them. If you can't address all of them well in one response, say so up front and ask which to handle first rather than picking silently.

When a message is exploratory ("what do you think about...", "how would we...", "I'm wondering if..."), default to discussion, not edits. He'll tell you when he wants code. If a message mixes "fix this" with "think about that," do the fix and respond in prose to the think-about-that, in the same turn. Don't write code for the exploratory parts unless he says so.

When he asks for your input on a design or scope decision, give him a recommendation, not a menu. He's better served by "here's what I'd do and why, with the alternative noted" than by "here are five options, you decide."

## execution conventions

**Sequencing within a single prompt.** When he asks for two related features in one turn, do them sequentially with a commit and verification gate between, not in parallel. Tell him what you verified before moving on. If the second feature reveals a problem with the first, stop and report rather than working around it.

**Plan mode is a tool constraint, not a behavioral one.** Even when not in plan mode, if a request involves new patterns, architectural choices, or anything spanning more than two files, propose the approach in prose first and wait for a yes before editing. Single-file targeted fixes that follow existing patterns can proceed directly.

**Surface non-obvious choices before committing to them.** Which file something belongs in, whether to extract a helper, naming, what counts as "done." Daniel is quick to course-correct and prefers a 30-second checkpoint over a refactor.

## standing maintenance after any code change

Every code change that ships includes:

- A one-line entry appended to `docs/CHANGELOG.md` under the current version block. Bump the version block when the change is release-worthy on its own.
- An update to `docs/HANDOFF.md` if the change affects current state, known issues, or what the next session should pick up. The "what's working" and "what we're doing right now" sections are the ones that go stale fastest.
- An update to `docs/BACKLOG.md` if you've shipped something that was on it (move it to changelog and remove from backlog) or learned something worth parking as a future thread.
- An increment of the BUILD counter in `src/version.js`. BUILD is monotonic and never resets on version bump. See the comment in that file if you're unsure.

If you're not changing code (e.g., a docs-only edit, a discussion turn), none of the above applies.

## codebase conventions you must internalize

Read `docs/ARCHITECTURE.md` before working on anything you haven't worked on recently. The architecture doc is authoritative for: forms registry, engine/shell separation, state location, the `env` runtime container, GLSL composition, and the slot/divider mechanics. Don't restate any of that here; just follow it.

Two specific rules worth flagging because violating them costs hours:

- **Don't put backticks inside a form's `glsl` string.** It's a JS template literal and a backtick inside breaks parsing silently. If a future form's GLSL needs a backtick, escape it carefully or restructure the surrounding string.
- **Single state object means undo/redo is cheap.** If you're touching state mutations, consider whether the change should integrate with the history stack rather than bypass it.

## design and UX principles

These are working principles, not code facts. They're how Daniel decides; matching them keeps proposals on his wavelength.

- **iPad and touch are first-class surfaces, not retrofits.** When adding any interactive UI, think through both the mouse cursor story and the touch story before writing the first line. Touch targets are 44pt minimum.
- **Direct manipulation over chrome.** When a value can be edited by dragging the thing it controls, prefer that over adding another slider. Existing examples: drag the slice overlay to position, drag the boundary to scale, drag outside to rotate.
- **Affordances are minimal and earned.** Don't add an indicator for every possible gesture. One affordance per category (one for scale, one for rotate, one for segments-on-radial), at low opacity, only on touch surfaces.
- **Stroke language carries information.** Polygon stroke highlights signal hover state on desktop; dashed amber signals OOB. Reuse this vocabulary rather than introducing parallel signals.
- **The body of the wedge is for the image.** The center is the busiest visual area. Don't put UI chrome there.

## prose style

- No em dashes. Replace with periods, commas, or parentheses depending on what's actually right.
- No superlatives ("amazing," "perfect," "incredible") in commit messages or code comments. They age badly.
- Code comments explain *why*, not *what*. The code shows what.
- When writing explanations to Daniel, lead with the conclusion and follow with the reasoning. He's a senior reader; he'll ask for more if he wants it.

## things you'll be tempted to do that you shouldn't

- **Don't infer urgency.** If something looks broken in a way he didn't mention, flag it. Don't fix it silently as part of an unrelated change.
- **Don't refactor opportunistically.** If a function looks ugly but isn't part of the requested change, leave it. He'll ask when he wants cleanup.
- **Don't add libraries.** This project is plain Vite + vanilla JS + GLSL on purpose. If you genuinely need a new dependency, surface it as a question first.
- **Don't introduce build steps.** No TypeScript, no linters, no preprocessors unless he asks.
- **Don't write tests for code that doesn't have tests yet.** Test infrastructure is a deliberate future decision; don't set the precedent in a feature commit.
- **Don't assume Daniel sees what you describe.** He's caught Claude hallucinating UI elements before, in this project and others. When describing the running app, browser dev tools, or any external UI, be tentative and defer to what he actually sees on screen.

## when in doubt

Ask. A 30-second clarification beats a 30-minute revert.