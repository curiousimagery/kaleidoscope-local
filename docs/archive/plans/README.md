# archived arc plans

**Why this folder exists.** Claude Code writes plan-mode documents to `~/.claude/plans/`, which is
**outside this repository and not under version control.** They are auto-named ("we-just-finished-a-
piped-minsky") and nothing prevents one from being deleted or overwritten. At least one already has
been: `CONTROLS.md` cited `in-our-last-thread-splendid-sparkle.md` as *"the durable program spec"*
and **that file no longer exists.**

Daniel, 2026-08-21: *"the plan files you've created feel like they should be captured as durable
reference and if this folder isn't a safe place for them we should make a point to add them to
docs/archive/plans."*

**Filenames are kept exactly as written** so an old reference elsewhere in the docs still resolves.
The table below is the translation from auto-name to subject.

**These are historical.** The living plan is `docs/PLAN-LIVE-READINESS.md`. Nothing here is a to-do.

| file | subject | written | status |
|---|---|---|---|
| `we-just-finished-a-piped-minsky.md` | Native iPhone/iPad builds, native camera depth, HDMI/AirPlay/NDI, conduit extraction | 2026-07-17 | **Superseded by its own header** — points at `docs/PLAN.md`, since archived |
| `we-recently-closed-out-abundant-bubble.md` | Arc plan, "Flows, Guardrails & Tiling" — defaults, contextual guardrails, mode transitions | 2026-07-21 | Closed. M2/M3 shipped B449 |
| `shared-socket-video-conduit.md` | Sub-plan: single native decode feeding both webviews, to kill the iPad double-decode jetsam crash | 2026-07-31 | **Shipped.** The socket path this app runs on today |
| `shared-socket-video-s3a.md` | Sub-plan: wiring the S2 native producer in so native decode owns the motion clock | 2026-07-31 | **Shipped** (design A, greenlit by Daniel 2026-07-31) |
| `thermal-and-frame-cost-audit.md` | Frame-cost audit and proposed path for thermal / sustained load. **432 lines, the substantial one** | 2026-08-05 | Largely executed. Its successor is `PLAN-LIVE-READINESS.md` item 6 + `BROADCAST-DELIVERY.md` |
| `in-this-session-i-expressive-ripple.md` | Pre-filling the Fold braindump worksheet with known knowns, for positioning/packaging work | 2026-08-06 | Feeds `docs/daniel-planning/fold-braindump-worksheet.md` |

## keeping this current

**Copy a plan file in here when its arc closes**, the same way a closed planning doc gets archived.
The command is `cp ~/.claude/plans/<file>.md docs/archive/plans/` plus a row in the table above.
This is a snapshot, not a sync — if a plan is still being edited, the copy here will lag.
