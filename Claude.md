# working notes for Claude

This file is read at the start of every Claude Code session. It captures how the human you're working with thinks, what he expects from you, and the working conventions of this codebase. Read it once, then act on it without narration.

This file does not duplicate `docs/ARCHITECTURE.md` or `docs/HANDOFF.md`. Read those for codebase structure and current project state. This file owns the things they don't: how Daniel works, how to handle his messages, prose and design principles, standing maintenance discipline, and the guardrails.

## who you're working with

Daniel is a product designer, not an engineer. He thinks fluently in interaction patterns, system design, and product tradeoffs. He doesn't write code himself and doesn't want to debug yours. When you describe work, frame it in product terms first (what changes for the user, what tradeoff is involved, what the scope is) and only drop into implementation detail when he asks or when the implementation choice itself has a product consequence he should weigh in on.

He works across three related apps that will share an engine: this one (kaleidoscope, the still tool), a planned motion shell, and a planned live shell. Decisions here cascade. When something is worth doing once-and-shared rather than twice-and-divergent, flag it.

## standing maintenance after any code change

Every code change that ships requires four updates. Before committing any code change, confirm each one is done:

- [ ] `src/version.js` BUILD counter incremented. BUILD is monotonic and never resets on version bump. See the comment in `version.js` if unsure.
- [ ] `docs/CHANGELOG.md` entry added under the current version block. Bump the version block when the change is release-worthy on its own.
- [ ] `docs/HANDOFF.md` updated if the change affects current state, known issues, or what the next session should pick up. The "what's working" and "what we're doing right now" sections go stale fastest.
- [ ] `docs/BACKLOG.md` updated if a backlog item was shipped (move it to CHANGELOG and remove from BACKLOG) or a new item was discovered.

If any of the four cannot be confirmed, do not commit. Address what's missing first.

If the change is docs-only (no code touched), none of the above applies.

## execution conventions

**Plan mode is a tool constraint, not a behavioral one.** Even when not in plan mode, if a request involves new patterns, architectural choices, or anything spanning more than two files, propose the approach in prose first and wait for a yes before editing. Single-file targeted fixes that follow existing patterns can proceed directly.

**Surface non-obvious choices before committing to them.** Which file something belongs in, whether to extract a helper, naming, what counts as "done." Daniel is quick to course-correct and prefers a 30-second checkpoint over a refactor.

## codebase conventions you must internalize

Read `docs/ARCHITECTURE.md` before working on anything you haven't worked on recently. The architecture doc is authoritative for: forms registry, engine/shell separation, state location, the `env` runtime container, GLSL composition, and the slot/divider mechanics. Don't restate any of that here; just follow it.

Two specific rules worth flagging because violating them costs hours:

- **Don't put backticks inside a form's `glsl` string.** It's a JS template literal and a backtick inside breaks parsing silently. If a future form's GLSL needs a backtick, escape it carefully or restructure the surrounding string.
- **Single state object means undo/redo is cheap.** If you're touching state mutations, consider whether the change should integrate with the history stack rather than bypass it.

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

The pattern: proactive proposals are welcome, silent expansions of scope are not. When in doubt, pause and ask.