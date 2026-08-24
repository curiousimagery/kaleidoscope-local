# archived planning docs

Design records and arc-specific plans whose work has SHIPPED. Kept for history, not forward reference. All still-open residuals were migrated to `../BACKLOG.md` before archiving (2026-07-20, closing out the Capacitor/Loop-Builder arc).

| doc | what it planned | status | residuals (now in BACKLOG) |
| --- | --- | --- | --- |
| `PLAN.md` | the Capacitor arc's single prioritized plan | arc delivered | P1 perf lane (still-capture fidelity, thermal, iPhone record, iPad NDI UYVY), the parked gnarly pair, P4 pointers — all in BACKLOG |
| `PROPOSAL-4B-native-capture.md` | the readback/capture perf sequence | shipped B363–B367 | IOSurface/native-capture (Tier 3) parked — BACKLOG "IOSurface/native" + "native track" |
| `CONDUIT-ROADMAP.md` | the conduit extraction map (tiers A/B/C) | shipped B345–B383 | capture-domain detection (vNext) — BACKLOG; extract-to-sibling-repo note — BACKLOG |
| `CONDUIT-TIER-C.md` | external-surface (transport-neutral) design | shipped B382/B383 | capture-domain vNext (as above) |
| `PROPOSAL-program-snapshot.md` | the single-writer commit-cell discipline (Lane 4A) | shipped B330 | none open |
| `AUDIT-video-save-ux.md` | the save-flow convergence audit | shipped B370 | Firefox export stutter, desktop parallel-source — BACKLOG |

## added in the B704 cleanup (2026-08-21)

Daniel's read: **`HANDOFF.md` had pivoted into a second, unintentional `BACKLOG.md`** while CHANGELOG
was kept dutifully current. These moved out so the live docs hold current state and open work only.
**Nothing was archived until its load-bearing content was confirmed to live somewhere that gets
read** — each file's header lists what was rescued and where it went.

| doc | what it is | why it moved |
| --- | --- | --- |
| `HANDOFF-builds-607-704.md` | the phase 2 rolling narrative, newest-first | HANDOFF was 1,305 lines and had begun contradicting itself — a red "PICK UP HERE" block sat 90 lines below the note saying B704 had fixed it. Now 159 lines |
| `VERIFY-QUEUE-b658-b704.md` | the "where is the ceiling" session — T2/T3/T7/T8/T9/T10/T11 | Every T-item is answered. **T10 met the arc's exit criterion.** The live file now says NO OPEN SESSION rather than showing answered tests as pending |
| `BACKLOG-resolved-b599-b704.md` | 20 items closed with no open tail, 322 lines | BACKLOG is what you read to find open work. Reasoning that still constrains future work was moved into the CODE first |
| `SESSION-AUDIT.md` | what hardware sessions the app holds and who releases them | A completed Class 1 investigation. Every finding shipped: B681, B699, B703 |
| `CONTROLS.md` | the June 2026 controls / capabilities / I/O inventory | Never updated after Build 178, ~520 builds of drift, and its status column is wrong on many rows. Its locked UI decisions were rescued into `DESIGN.md` |
| `ARCHIVE-reasoning.md` | the cold store of historical reasoning (was `../ARCHIVE.md`) | It opened with *"skip this file by default"* while sitting beside the docs you read first |
| `plans/` | Claude Code plan-mode documents, copied out of `~/.claude/plans/` | **That folder is outside the repo and not version-controlled, and one plan has already been lost** — `CONTROLS.md` cited it as "the durable program spec." See `plans/README.md` |

---

Forward-facing planning now lives in `../PLAN-LIVE-READINESS.md` (the sequence and its dependencies),
`../BACKLOG.md` (the inventory, themed + stack-ranked) and `../HANDOFF.md` (current state, and it is
meant to stay short). Codebase structure is `../ARCHITECTURE.md`; the long historical record is
`ARCHIVE-reasoning.md`.

## added in the B737 cleanup (2026-08-24)

| doc | what it is | why it moved |
|---|---|---|
| `HANDOFF-builds-705-737.md` | the memory-ceiling arc, newest-first | `HANDOFF.md` had gone 809 lines with **eleven "SUPERSEDED" blocks** — the same drift Daniel called out at B704, one arc later. Now 256 lines. Its header carries a one-table summary of what the arc established, so the detail is optional reading |
