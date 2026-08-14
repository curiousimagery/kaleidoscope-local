# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG. Closed sessions live in `archive/VERIFY-QUEUE-b573-b597.md`.

---

# ▶ THIS SESSION (B600) — "does reusing the video output close the 150ms lap?"

**⚠️ NEEDS `npx cap sync ios` + AN XCODE BUILD.**

**iPad, ~5 minutes.** B599 answered whose the hold is: the decode's own item swap, 141-150ms, measured natively. This tests the one cheap explanation for it.

## ⚠️ SET THE SCENARIO TAG TO `hdmi-broadcast` FIRST.

## Part 1 — the load frame (regression from B599)

1. Load a 4K clip. **The source panel must show the first frame** — scrubbing should not change it.

## Part 2 — the lap

2. Broadcast an **unbaked** clip, let it lap **four or more times**. Watch the hold.
3. `copy report`. **The number is `srcFanOut.swapGapMs`, against B599's 141 / max 150.**

| reading | meaning | next |
|---|---|---|
| **`swapGapMs` drops to ~33ms** | output priming WAS the hold | done; the fix is shipped |
| **`swapGapMs` still ~150** | the cost is AVFoundation's item swap itself | stop swapping items: one item, `actionAtItemEnd = .none`, seek to zero on end |
| **`swapRecoveries` > 0** | the reused output stalled and the watchdog rebuilt it | reuse is not safe; revert that half and go straight to the single-item loop |

**⚠️ If the picture freezes permanently at the first lap, that is the reuse failing and the watchdog not catching it. Say so and I will revert it immediately.**

4. `loopStall.recentTakeGaps` and `extJitter.loop.recentTakeGaps` should track `swapGapMs` in both directions. They agreed at B599 (91-162 and 136-157 against a native 141), so a drop there and not here would mean the instruments have diverged.

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
