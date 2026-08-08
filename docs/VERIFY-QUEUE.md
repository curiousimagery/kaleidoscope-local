# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG.

---

# ✅ LAST SESSION CLEARED (B559, Daniel) — the desktop/iPad take path survived

**Electron:** short take clean, 4:48 take at real 4K clean with audio in sync, save near-instant on an M5 Max, record-during-Syphon-broadcast fine, output window fine. **iPad:** still capture fine, three takes recorded and played back fine, **HDMI healthy — `42 fps ON THE DISPLAY · 29 new/s` against a 30fps camera, matching the app's own 41.3fps.** That is B549's fix confirmed on device and it closes the OPFS-on-desktop risk.

**Two findings came out of it**, both filed in BACKLOG, neither a regression from B553-B559: iPad take audio is very quiet (the missing gain stage), and the `elideElementUploads` A/B was unmeasurable as I wrote it (see the entry — my instruction was wrong, and the desktop claim is withdrawn).

# ▶ THIS SESSION — "does the governor help, and did the arc's changes hold on iPad?"

**iPad, ~15 minutes.** `npm run build && npx cap sync ios`, Xcode rebuild. **Needs B568.**

## What we're trying to find out

Two things at once, which is the point: the **governor** is new and unproven, and **iPad broadcast + NDI have not been touched since the hardening changes** this arc made to the poster, the bus teardown and the frame header.

## Steps — HDMI broadcast

1. **Start a 4K→4K HDMI broadcast and leave it running for a minute or two.** Watch for a toast reading `preview at 75% — giving the broadcast the headroom (N% under 30fps)`.
   - **Does the display get smoother when it fires?** That is the whole question.
   - **Does the preview degradation read as acceptable, or as broken?** Your 75/50 rungs were measured on staged preview, not on a live broadcast.
   - **Does it oscillate?** Stepping down, recovering, stepping down again within a few seconds would mean the hysteresis is too tight. Tell me if you see it flapping.
2. **Stop the broadcast.** → does the preview return to full resolution?
3. **`copy report`** during the broadcast — I want `pressure.shortfall`, `pressure.target`, and the `scale` on the `preview` and `pip` rows.

## Steps — NDI (untouched this arc)

4. **Start an NDI broadcast on iPad and watch it in Arena or another receiver.** Nothing here has been re-tested since the poster elision, the `failOutput` teardown fix, and the frame-header unification. **I have no expectations to set — this is a "did we break it" pass.**
5. **If NDI runs, note the frame rate on the receiver** against what the output panel says. The panel now labels which surface it means.
6. **Try record + NDI together**, which is the pairing that broke on HDMI at D3.

## Steps — audio (quick confirm)

7. **The mic row should now show only `gain` + `auto`** — the raw/balanced/voice picker is gone, raw is hardcoded.
8. **Adjust the gain DURING a take.** → the recording should now follow it (it did not before). Ramped, so it should sound like a fader move rather than a jump.

## What I can't see and need from you

- **Whether the governor helps or just makes the preview worse.** No number decides this; if the display does not visibly improve when it fires, the rule is wrong and should come out.
- **Whether it oscillates.** The dead band is a guess (shed above 25% under, restore below 10%) and this is the first time it has run anywhere.
- **Whether NDI still works at all.**

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
