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

Forward-facing planning now lives in `../BACKLOG.md` (the inventory, themed + stack-ranked) and `../HANDOFF.md` (rolling state). Codebase structure is `../ARCHITECTURE.md`; the long historical record is `../ARCHIVE.md`.
