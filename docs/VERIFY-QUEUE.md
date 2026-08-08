# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG.

---

# ✅ LAST SESSION CLEARED (B559, Daniel) — the desktop/iPad take path survived

**Electron:** short take clean, 4:48 take at real 4K clean with audio in sync, save near-instant on an M5 Max, record-during-Syphon-broadcast fine, output window fine. **iPad:** still capture fine, three takes recorded and played back fine, **HDMI healthy — `42 fps ON THE DISPLAY · 29 new/s` against a 30fps camera, matching the app's own 41.3fps.** That is B549's fix confirmed on device and it closes the OPFS-on-desktop risk.

**Two findings came out of it**, both filed in BACKLOG, neither a regression from B553-B559: iPad take audio is very quiet (the missing gain stage), and the `elideElementUploads` A/B was unmeasurable as I wrote it (see the entry — my instruction was wrong, and the desktop claim is withdrawn).

# ▶ THIS SESSION — "is the iPad mic fixed, and is it sensitivity or selection?"

**iPad first, then one iPhone check.** `npm run build && npx cap sync ios`, Xcode rebuild. **~10 minutes.**

## What we're trying to find out

B560's calibration ran at the instant recording started, so it always measured a silent room and never engaged. B561 moves it to the **level meter**, which is open while you are setting up and therefore actually hears you talk.

**There is now a readout under the meter** (`N× · raw peak M`). That is the single most useful thing on screen: it says both what the mic delivered and what we did about it, so a failure is visible instead of silent.

## Steps — iPad

1. **Open the output panel, select the mic, and talk normally for a few seconds.** → does the readout under the meter move off `—` and show a multiplier? → do the L/R bars now move meaningfully?
   - **Tell me the two numbers it settles on.** If the multiplier reads `32.0×` it hit the ceiling and the input is quieter still, which is itself the answer.
2. **Record a short take (~30s) talking normally. Save and play it back.** → usable level at normal iPad volume?
3. **Listen for the level moving on its own** — background noise swelling up in the gaps between words, or your voice ducking as you get louder. That is what the old AGC did and what this is designed not to do. It should sound steady.
4. **`copy report`** → `micRawPeak`, `micGain`, `peak`, `trackState.label`.
5. **One more take from further away, or holding the iPad differently.** → does `trackState.label` change between takes? A different label means iOS is switching mic ELEMENTS, which the trim compensates for but does not fix.

## Steps — iPhone

6. **One short take, talking normally.** Should be unchanged: a healthy input calibrates to 1x. Confirm `micGain` is 1 and `peak` is now at or under 1.0 rather than 2.82.

## What counts as success

The readout shows a real multiplier, the iPad take is usable, the iPhone take is unchanged, and the level does not move on its own.

## What I can't see and need from you

- **The two numbers under the meter on the iPad.** If this fails again, that pair says which part failed — and I would rather stop guessing.
- **Whether the level moves on its own.** No number shows this and the whole design rests on it not happening.

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
