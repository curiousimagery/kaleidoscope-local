# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG. Closed sessions live in `archive/VERIFY-QUEUE-b573-b597.md`.

---

# ▶ THIS SESSION (B606) — "can you read the panel, and does the cache feed anything?"

**⚠️ NEEDS `npx cap sync ios` + AN XCODE BUILD.**

**iPad, ~6 minutes.**

**[panel]** = on screen. **[report]** = only in `copy report`.

## 1. The panel is readable now (10 seconds, and it unblocks everything else)

**[panel]** Every surface's note is now its **own wrapped line** under the row, in full. The `source` row should read the whole of `from canvas · planar · native decode · 30 in/s`. **Tell me if it is still cut off** — that line is how you check the path before any measurement, and it has never once been readable on the iPad.

## 2. Does the cache feed anything

1. Broadcast a looping clip (FHD is fine), **[panel]** `loop cache: 64MB`, lap 4+ times.
2. **[report]** `srcFanOut.loopCache`. **The number that matters is `lastReplayFrames`** — B605 read **0**, which is why nothing changed.
   - **`lastReplayFrames` 4-5** → the replay is feeding. Then judge the loop by eye.
   - **still 0** → `why`, `firstPts` and `lastPts` now say what is in the cache and it will be diagnosable from one report.
3. **[report]** `extJitter.loop.recentTakeGaps` against B605's 140-150. **That is the outcome measure**; `lastReplayFrames` only says the mechanism ran.
4. **[panel]** Toggle `loop cache: off` and back, still looping, and say whether the loop point looks different between the two.

## 3. The Loop Builder stall — no fix yet, one question

The slice-preview stall is filed and neither recent change is implicated. **If you get a chance: does it also stall on the crossfade STEP (step 4), or only on the bake-preview step (step 5)?** That narrows it a long way.

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
