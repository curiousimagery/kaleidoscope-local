# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG. Closed sessions live in `archive/VERIFY-QUEUE-b573-b597.md`.

---

# ▶ THIS SESSION (B603) — the FHD experiment, re-run on the right code path

**⚠️ NEEDS `npx cap sync ios` + AN XCODE BUILD.**

## ⚠️ CHECK THIS BEFORE TRUSTING ANY MEASUREMENT, EVERY TIME

Look at the `source` row in the frame-cost panel. **It must say `planar · native decode · ~30 in/s`.**
If it says `from <video>` or `⚠ NO NATIVE DECODE: …`, the run is on the fallback path and **nothing in that report can be compared to any other report.** That is what happened to B602's FHD run.

## The re-run

1. **Load the SAME 1:23 FHD loop.** Confirm the source row says `native decode`.
2. Broadcast, let it lap 4+ times.
3. `copy report`. **The number is `srcFanOut.swapGapMs`, against the 4K baseline of 141-150.**

| reading | meaning | consequence |
|---|---|---|
| **still ~150ms** | a fixed cost to restart delivery, independent of resolution | resolution is not a lever; the gap has to be filled, not shrunk |
| **drops to ~40ms** | it scales with pixels | first new lever since B590 |

4. **If it falls back to `<video>` again**, send the report anyway — `nativeAttach.why` names the stage and that is its own finding. B603 fixed one way this can happen; if it recurs there is a second.

## Also confirm (30 seconds, since B603 touched the load path)

5. Load a 4K clip. The source panel shows the **first** frame, and the source row says `native decode`.

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
