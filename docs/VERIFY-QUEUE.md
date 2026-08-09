# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG.

---

# ▶ THIS SESSION (B572) — "does the governor fire now, and does the take survive?"

**iPad, ~10 minutes. Needs B572.** Two blocking bugs are fixed; both need one run to confirm.

## What changed and why it never worked before

- **The governor was switched off by the frame-cost panel.** `ledger.onReport` was a single slot and the panel overwrote the governor's handler — so it was disabled exactly when you were watching for it. Your last report proves the rule was right and never ran: `target: 30, shortfall: 0.41` with `preview` and `pip` still at `scale: 1`.
- **The lost take** was `decoderConfig` present but `colorSpace` missing; mp4-muxer dereferences through it. BT.709 defaults are supplied now.

## Steps

1. **4K → 4K HDMI broadcast, frame-cost panel OPEN.** Within a few seconds of the shortfall going past ~25%, expect `preview` and `pip` `scale` to step down in the panel, and a status message naming the reason.
   - **The honest question is whether it HELPS.** Your manual walk said scaling did nothing at 4K (`preview render` 16.53ms at 0.38MP — the cost is sampling the 8.29MP texture, not writing pixels). **I expect it to fire and NOT help.** If so, the ladder is confirmed as the wrong actuator and the redesign is the next build.
2. **Start a take during that broadcast.** → does it now save instead of dying with `null is not an object`?
   - Expect **video only** and a message saying so — a mic would interrupt the program (B570).
   - The source/stage panels going dark is a **separate, unfixed** bug (D3's `capture: null`), so it may still happen. Note whether it does.
3. **`copy report`** during the broadcast and after the take.

## What I can't see and need from you

- **Whether `scale` actually moves in the panel.** That is the whole confirmation.
- **Whether the display improves when it does.** If not, say so plainly — the ladder comes out rather than gets tuned.
- **Whether the take saves.**

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
