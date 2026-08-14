# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG. Closed sessions live in `archive/VERIFY-QUEUE-b573-b597.md`.

---

# ▶ THIS SESSION (B605) — "does the head cache fill the lap?"

**⚠️ NEEDS `npx cap sync ios` + AN XCODE BUILD.**

**iPad, ~10 minutes.** The knob is live, so this is one sitting and several arms.

**[panel]** = on screen in the frame-cost panel. **[report]** = only in `copy report`.

## ⚠️ BEFORE TRUSTING ANY MEASUREMENT, EVERY TIME

**[panel]** The `source` row must read `planar · native decode · ~30 in/s`. If it says `from <video>` or `⚠ NO NATIVE DECODE`, that report cannot be compared to any other.

## The control is `loop cache` in settings → diagnostics

**[panel]** A cycling button: `64MB → 128MB → 256MB → off → 32MB`. **It applies immediately** — no reload, no clip re-load. Raising it lets the cache top up on the next lap; lowering it trims at once.

## Part 1 — does it work at all (FHD first, where the budget is generous)

1. Broadcast a **looping FHD clip**, let it lap 4+ times at the default **64MB**.
2. **Watch the loop point. The hold should be gone.**
3. **[report]** `srcFanOut.loopCache` — `coveredMs` should be **≥ `swapGapMs`** (~150) and `why` should read `covering the lap`.

## Part 2 — the A/B, same sitting

4. **[panel]** Set `loop cache: off`. Keep looping. **The hold should come straight back.** That is the control arm and it proves the cache is what changed.
5. **[panel]** Back to `64MB`. It should disappear again within a lap or two (the cache refills as the head plays).

## Part 3 — 4K, where the budget is tight

6. Load a **4K** clip, broadcast, lap 4+ times at **64MB**.
7. **[report]** Read `loopCache.coveredMs` against `swapGapMs`, and `why`.
   - `covering the lap` → done at 4K too.
   - `partial fill — Nms of a 150ms lap` → **[panel]** raise to `128MB`, keep looping, read again.
8. **Tell me how it LOOKS at each budget, not just what the numbers say.** A partial fill should read as a much shorter hitch; the question is whether it still reads as a defect.

## ⚠️ Watch for the thing that would make this a bad trade

9. **At 128MB and 256MB on a 4K clip, watch for a graphics context loss or the app being killed.** That is the jetsam risk and it is the reason the default is conservative. If it happens, drop back to 64MB and tell me — the cache is not worth a lost context mid-set.

## Part 4 — the behaviours the cache could plausibly break

10. **Scrub during playback** on a looping clip — the replay is meant to abandon on a seek, so scrubbing should feel exactly as before.
11. **Pause across the loop point** — a paused clip should not lap at all.
12. **Move the slice through the loop point** while broadcasting. **This should be unaffected** — the cache holds source footage, not rendered output, so the kaleidoscope keeps animating live. If the look freezes at the lap, the design assumption is wrong and I need to know immediately.

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
