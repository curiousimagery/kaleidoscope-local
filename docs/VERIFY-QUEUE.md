# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG.

---

# ✅ LAST SESSION CLEARED (B559, Daniel) — the desktop/iPad take path survived

**Electron:** short take clean, 4:48 take at real 4K clean with audio in sync, save near-instant on an M5 Max, record-during-Syphon-broadcast fine, output window fine. **iPad:** still capture fine, three takes recorded and played back fine, **HDMI healthy — `42 fps ON THE DISPLAY · 29 new/s` against a 30fps camera, matching the app's own 41.3fps.** That is B549's fix confirmed on device and it closes the OPFS-on-desktop risk.

**Two findings came out of it**, both filed in BACKLOG, neither a regression from B553-B559: iPad take audio is very quiet (the missing gain stage), and the `elideElementUploads` A/B was unmeasurable as I wrote it (see the entry — my instruction was wrong, and the desktop claim is withdrawn).

# ▶ THIS SESSION — "does the mic sound right now, and what is the iPad's mic actually doing?"

**iPad first (where the problem was), then one iPhone check.** `npm run build && npx cap sync ios`, Xcode rebuild. **~10 minutes.**

## What we're trying to find out

B560 added the gain stage B558 owed: a trim measured once while the mic arms, into a limiter. Two questions, and the second one outlives the first.

## Steps — iPad

1. **Enable the mic and watch the meter.** → does it now move meaningfully when you speak, instead of barely registering? (The meter runs the same chain as the recorder, so what you see is what the take gets.)
2. **Record a short take (~30s), talking normally. Save and play it back.** → is it at a usable level? Does it sound natural, or does it breathe/pump the way the old AGC did? **Pumping is the failure mode to listen for** — the trim is set once and frozen, so it should not.
3. **`copy report`** → paste. `micRawPeak`, `micGain`, `peak` and `trackState.label`.
4. **If you can, one more take with the iPad oriented differently or from further away** — different `trackState.label` across takes would mean iOS is switching mic ELEMENTS, which the trim compensates for but does not fix.

## Steps — iPhone

5. **One short take, talking normally.** → unchanged from B559? It should be: a healthy input calibrates to exactly 1x. **`copy report`** and confirm `micGain` is 1 and `peak` is now at or under 1.0 rather than 2.82.

## What counts as success

Meter moves, iPad take is usable, iPhone take is unchanged, and nothing pumps.

## What I can't see and need from you

- **Whether it pumps.** No number will tell me this; the whole design rests on it not happening.
- **`micRawPeak` + `micGain` + `trackState.label` from the iPad.** This is the pair that finally separates a quiet MIC from a quiet ROOM from the wrong mic being SELECTED — the question the trim papers over rather than answers.

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
