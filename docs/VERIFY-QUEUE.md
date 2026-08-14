# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG. Closed sessions live in `archive/VERIFY-QUEUE-b573-b597.md`.

---

# ▶ THIS SESSION (B602) — one fix to confirm, and one reading only Daniel can take

**JS only. No `cap sync` needed.**

## 1. The perform playhead (30 seconds)

Perform mode, video source, press play then pause. **The playhead must stay where it is**, not jump to the start. On play it should continue from there.

## 2. ▶ THE DISCRIMINATING EXPERIMENT — a short 1080p clip

**This is the highest-value thing left and it needs no build.** Every measurement in this arc has been on one 20.4s 4K clip, so we cannot tell a fixed pipeline cost from decode work.

1. Load a **short 1080p clip** (a few seconds is fine). Broadcast, let it lap 4+ times.
2. `copy report`. **The number is `srcFanOut.swapGapMs`, against the 4K baseline of 141-150.**

| reading | meaning | consequence |
|---|---|---|
| **still ~150ms** | a fixed cost to restart delivery, independent of resolution and length | resolution is not a lever; the fix is to hide the gap, not shrink it |
| **drops proportionally (~40ms)** | it is decode work and it scales with pixels | a real lever for the first time in this arc: pre-roll at lower resolution, or accept the cost only at 4K |

**Either answer closes something.** The second would be the first genuinely new lever since B590.

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
