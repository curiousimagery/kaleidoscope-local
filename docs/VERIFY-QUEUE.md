# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG. Closed sessions live in `archive/VERIFY-QUEUE-b573-b597.md`.

---

# ▶ THIS SESSION (B601) — "is rewinding one item cheaper than swapping items?"

**⚠️ NEEDS `npx cap sync ios` + AN XCODE BUILD.**

**iPad, ~8 minutes, one sitting, both arms.** B599 measured the loop hold as AVFoundation's item swap (141-150ms). B600 killed the cheap explanation: reusing the video output changed nothing. This tests the real alternative.

## ⚠️ SET THE SCENARIO TAG TO `hdmi-broadcast` FIRST. Start COLD.

## The A/B — the flag is `video: loop by seeking, not by item swap` in the frame-cost panel

**⚠️ The flag is read when the decode starts, so RELOAD THE CLIP after flipping it.** Nothing persists across an app restart.

1. **Arm A (flag OFF, shipped behaviour).** Load an unbaked 4K clip, broadcast, let it lap 4+ times. `copy report`.
2. **Flip the flag ON. Reload the same clip.** Broadcast, lap 4+ times. `copy report`.
3. Keep the slice the same in both arms and do not resize anything between them.

**The number is `srcFanOut.swapGapMs` (and `maxSwapGapMs`). B599/B600 baseline: 141-150.**

| arm B reading | meaning | next |
|---|---|---|
| **~33ms** | the item swap was the whole hold | make `loopBySeek` the default and delete AVPlayerLooper from this path |
| **still ~150** | a precise seek costs the same as a swap | neither mechanism is cheap; the answer is to hide the gap, not remove it (hold the last frame deliberately, or pre-roll) |
| **worse than 150** | the seek flush is the more expensive of the two | keep AVPlayerLooper, and the hold is a platform cost we design around |

4. **Also watch, in arm B specifically:** does play/pause still behave, and does the clip still loop at all? The rewind now decides whether to resume, so a paused clip must stay paused at the loop point.
5. `loopStall.recentTakeGaps` and `extJitter.loop.recentTakeGaps` should track `swapGapMs` in both arms. They agreed at B599 and B600; if they stop agreeing, the instruments have diverged and the arm comparison is void.

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
