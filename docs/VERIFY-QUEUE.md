# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG. Closed sessions live in `archive/VERIFY-QUEUE-b573-b597.md`.

---

# ▶ NO OPEN SESSION

**The arc's plan now lives in `PLAN-LIVE-READINESS.md`.** Read it before opening a new session here; it says which item is next and what "done" means for it.

**The next session is item 2's long-form run**, and it has two prerequisites that are not verification: the thermal signal, and the session audit. **Do not open a device session until those land** or the reading will not be interpretable.

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

# 🅿️ PARKED — not this session

Pulled forward one session at a time. Nothing here is blocking.

**HDMI / external display** — the stale-broadcast-at-startup mystery on iPad, the 25–45s source-switch lag, iPhone HDMI in record mode, portrait vertical squish. B549/B551/B552 built the instruments; B559 gives the view a voice. **iPad 4K HDMI itself now reads healthy (B559)**, so what remains is the startup and switching behaviour rather than throughput.

**The 4K unaccounted third** — camera vs still image at the same resolution, two reports, no rebuild. Settles H2 and names the next optimization target.

**Frame-header pass (B546)** — FH-1, FH-2 and the still-after-camera check all confirmed (B559). Remaining: the iPad video-to-display clock check.

**Behaviour confirmations** — PiP starve rules at 4K vs FHD; A/V sync across smoothing modes.

**Loop Builder** — desktop, independent of all of the above. Cancel mid-bake, back-nav during bake, iPad safe-area header collision.

**Long-standing** — B382 external-display/GL-context cluster, large-clip HDMI staging, NDI HD-vs-FHD over WiFi, Movink resolution re-verify.

Detail for any of these is in git history (`docs/VERIFY-QUEUE.md` before B553); ask and I'll bring one forward as a focused session.
