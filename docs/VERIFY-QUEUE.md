# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG. Closed sessions live in `archive/VERIFY-QUEUE-b573-b597.md`.

---

# ▶ THIS SESSION (B599) — "does the DECODER skip the lap, or do we?"

**⚠️ NEEDS `npx cap sync ios` + AN XCODE BUILD.**

**iPad, ~5 minutes. One reading, no new behaviour to check.** B598's render breakdown came back clean (every render after the lap 8-15ms), which rules out the view's render and leaves one unexplained fact: **1.8 seconds of footage is missing at the lap** (`fromPts 19.4 → toPts 0.833` on a 20.4s clip). This build measures the lap inside the plugin, which is the only place that sees AVPlayerLooper swap items.

## ⚠️ SET THE SCENARIO TAG TO `hdmi-broadcast` FIRST.

## Steps

1. Broadcast an **unbaked** clip (the hold is more visible there) and let it lap **four or more times**.
2. `copy report`. **The new fields are in `srcFanOut`:** `itemSwaps`, `swapGapMs`, `maxSwapGapMs`, `swapFromPts`, `swapToPts`, `ticksNoBuffer`.

**Compare the decode's account against what JS received (`loopStall.last`):**

| reading | meaning | where the fix goes |
|---|---|---|
| `swapFromPts`/`swapToPts` ≈ the clip's end and 0, but JS shows a big skip | the decode produced the frames and **the wire dropped them** | our backpressure — `wantsFrame()` declining while both clients are busy |
| `swapFromPts`/`swapToPts` skip the same 1.8s JS sees | **AVFoundation itself loses the content at the item swap** | the looping strategy, natively |
| `swapGapMs` in the hundreds | the decoder stops producing across the swap | same, natively |
| `swapGapMs` ~33ms with content intact | the swap is clean and the loss is entirely ours | back to the JS side with a much smaller search |

3. `loopStall.recentTakeGaps` should now be **comparable to** `extJitter.loop.recentTakeGaps` — B598's app-side number was inflated by counting re-paints as arrivals, and that is fixed. **If the app now also shows ~150ms, the hold is shared** and the asymmetry I reported at B598 was my instrument's, not the app's.

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
