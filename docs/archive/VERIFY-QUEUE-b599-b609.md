# archived — closed verification sessions, B599 → B609 (archived B658)

> **Cold store.** Closed sessions lifted out of `VERIFY-QUEUE.md` at B658 during the item-3
> documentation cleanup. Everything here is answered, and every answer lives in a document that is
> actually read before work starts:
>
> - **B609's three answers** (upload drain, the 64MB budget, the inverted bake pattern) are
>   reproduced in `../PLAN-LIVE-READINESS.md` §1, along with the GL-context-loss confound rescued
>   from here at B658.
> - **B599-B608 — the loop hold** is `../BROADCAST-DELIVERY.md` §6a, which is a better record than
>   these one-liners: eight dead hypotheses each with its instrument, the fix, and two budget traps.
> - **The two instrument defects** (`loopCache.coveredMs` under-reporting, the `scenario` tag) are in
>   `../PLAN-LIVE-READINESS.md` §1 as work for the next native build.
>
> Earlier closed sessions: `VERIFY-QUEUE-b382-b476.md`, `VERIFY-QUEUE-b573-b597.md`.

---

# ✅ CLOSED (B609) — all three questions answered. Do not extend this session.

- **The upload drain holds.** Multiple clip loads across three sessions, no `NO NATIVE DECODE`.
- **The minimum viable 4K budget is 64MB, the current default.** `heldMB 59`, 5 frames, `firstPts 0`; the wall's worst lap gap was 52ms against a 33ms interval, a 19ms overhang on one frame. At 256MB it was 42ms. **Four times the memory buys 10ms on one frame per lap.**
- **The bake pattern INVERTED.** Not "first attempt fails" but **"the second bake within a session fails"** — two fresh-session first bakes succeeded. Points at something a completed bake does not release. **Confound to separate next time: a GL context loss happened between the good bake and the bad one. Do a second bake in a session where nothing was lost.**

**Two instrument defects found by this session, fix in the next native build:**
- `loopCache.coveredMs` measures the span between first and last cached pts, so it under-reports real coverage by one frame interval and `why` advises raising a budget that is already sufficient.
- The report's `scenario` tag read `idle-still` during a 4K broadcast.

**And one finding that is not verification but a root cause** — see BACKLOG: the source-loss reading fired the B584 instrument for the first time on the branch it was built to separate (`offered 222 · took 222 · skipped 0` with a frozen picture and `GL CONTEXT RESTORED ×1`). **The frames reached us and we failed to use them.**

# 🅿️ PREVIOUS SESSION (B608) — 4K + FHD loops VERIFIED SEAMLESS. 64MB arm void (no native decode).

# 🅿️ PREVIOUS SESSION (B607) — 4K VERIFIED SEAMLESS at 256MB. FHD seamless at 64MB. Loop hold CLOSED.

# 🅿️ PREVIOUS SESSION (B606) — panel note readable ✓; FHD loop VERIFIED SEAMLESS ✓; 4K still stalls (cache started at 0.115).

# 🅿️ PREVIOUS SESSION (B605) — cache shipped but fed nothing (`lastReplayFrames: 0`); panel note found unreadable on device.

# 🅿️ PREVIOUS SESSION (B604) — bake seek + [panel]/[report] convention; loop-gap investigation CLOSED.

# 🅿️ PREVIOUS SESSION (B603) — ANSWERED: FHD `swapGapMs` 141/150, identical to 4K. The loop gap is a FIXED cost; resolution is not a lever.

# 🅿️ PREVIOUS SESSION (B602) — perform playhead FIXED (verified). FHD experiment VOID: it ran on the <video> fallback.

# 🅿️ PREVIOUS SESSION (B601) — "is rewinding one item cheaper than swapping items?" — ANSWERED: a tie. 141 vs 150; ~150ms is the platform floor for resuming at zero by any route.

# 🅿️ PREVIOUS SESSION (B600) — "does reusing the video output close the 150ms lap?" — ANSWERED: no. 150 against 150; priming was not the cost.

# 🅿️ PREVIOUS SESSION (B599) — "does the DECODER skip the lap, or do we?" — ANSWERED: the decode's own item swap, 141-150ms, content skipped equals the stall.

Detail in `CHANGELOG.md` B599/B600 and `BACKLOG.md`.

# 🅿️ NEXT UP after this — pick one

1. **The sustained-capture run** — exit criterion #5, the arc's last unmet goal, and the first device reading of B542's `renderElide`.
2. **The combos audit** (exit criteria #1 + #2) — mostly decisions now, not measurements: relabel the source-vs-take controls honestly and gate the combinations we have already measured as undeliverable.
3. **The input-mapping cluster** — controller/MIDI across forms, joystick 45° offset, gesture/joystick handoff, droste zoom leak. A BUILD pass with verification attached, not a test session.

