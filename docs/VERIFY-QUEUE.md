# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG. Closed sessions live in `archive/VERIFY-QUEUE-b573-b597.md`.

---

# ▶ THIS SESSION (B608) — one fix, and one number worth pinning down

**⚠️ NEEDS `npx cap sync ios` + AN XCODE BUILD.** **The loop hold is CLOSED and verified — nothing to re-prove.**

**[panel]** = on screen. **[report]** = only in `copy report`.

## 1. Perform transport on a source swap (1 minute)

1. In perform with a clip **playing**, load a different clip.
2. **It should start playing, and the play/pause button must match.** B607: it loaded paused while the button read "pause", and pressing pause started it.
3. Do it once more with the first clip **paused** — the button must still match whatever actually happens.

## 2. The minimum viable 4K budget (worth pinning before the default is trusted)

**⚠️ Reload the clip between arms.** Setting the budget to 0 discards the head, and a clip's head is only produced on its opening pass — that is why B607's sweep looked like a memory curve when it was not.

4. **[panel]** Set `loop cache: 128MB`. **Load the 4K clip fresh.** Broadcast, lap 4+ times.
5. **[report]** `loopCache.firstPts` must be ~0 and `heldMB` should read ~94. **Is the loop seamless at 128?**
6. If yes, repeat at **64MB** from a fresh load. 64 is below the ~94MB the window needs, so expect a partial fill — **the question is whether a partial fill still reads as acceptable**, since that is the safer default.

## 3. Anything about the app being under memory strain

7. Note **anything** that smells like memory during these runs: a bake failing, a graphics context loss, the app restarting. **That is now the open thread, not the loop.**

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
