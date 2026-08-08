# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG.

---

# ✅ LAST SESSION CLEARED (B559, Daniel) — the desktop/iPad take path survived

**Electron:** short take clean, 4:48 take at real 4K clean with audio in sync, save near-instant on an M5 Max, record-during-Syphon-broadcast fine, output window fine. **iPad:** still capture fine, three takes recorded and played back fine, **HDMI healthy — `42 fps ON THE DISPLAY · 29 new/s` against a 30fps camera, matching the app's own 41.3fps.** That is B549's fix confirmed on device and it closes the OPFS-on-desktop risk.

**Two findings came out of it**, both filed in BACKLOG, neither a regression from B553-B559: iPad take audio is very quiet (the missing gain stage), and the `elideElementUploads` A/B was unmeasurable as I wrote it (see the entry — my instruction was wrong, and the desktop claim is withdrawn).

# ▶ THIS SESSION — "is the iPad mic fixed, and is it sensitivity or selection?"

> **⚠️ NEEDS BUILD 563 OR LATER. B562 broke app startup** (a `ReferenceError` at module evaluation — upload and camera selection were both dead). If you are on B562, nothing below will work. Rebuild first.
>
> **Also new in B563 and worth a glance while you are here:** the Loop Builder header should now clear the iOS status bar in both orientations, and a camera session should report a real `target` / `shortfall` in the perf panel instead of `0`.

**iPad first, then one iPhone check.** `npm run build && npx cap sync ios`, Xcode rebuild. **~10 minutes.**

## What we're trying to find out

**Automatic calibration is gone.** Your report named exactly why: `micRawPeak 0.00552` is about -45dBFS, which is your AC unit, not your voice — so B561 calibrated on room tone, computed 32x, and applied it 2.4s in. That is the jump you heard. Deciding "is this speech" from a short listen is the part that cannot be done reliably, so we stopped trying.

The gain is now **a slider you set, with an `auto` button that measures at the moment you press it** — while you are talking. And the raw mic level is on screen at all times, because that number is the whole diagnosis.

## Steps — iPad

**Step 1 is the important one. Do it before recording anything.**

1. **Open the output panel, select the mic, and just watch the readout while you talk.** It reads `1.0× · raw 0.031`. **Tell me what the raw number does when you speak at a normal level.**
   - Rises to ~0.05 or more → the mic is fine and this is purely a gain problem, now solvable with the slider.
   - Stays near 0.005 even while talking → **the mic is genuinely near-dead**, no amount of gain fixes that honestly, and the cause is mic SELECTION or the iOS audio session. Completely different problem, and worth knowing before I build anything else.
2. **Talk at a normal level and press `auto`.** → does the gain jump to something sensible and the L/R bars come alive?
3. **Nudge the slider if `auto` overshot or undershot.** The bars should sit around two-thirds on speech peaks.
4. **Record a short take (~30s) and play it back.** → usable at normal iPad volume?
5. **`copy report`** → this should now actually contain an `audio` block on iPad (it never has before; that bug is fixed). I want `micRawPeak`, `micGain`, `peak`, `trackState.label`.

## Steps — iPhone

6. **One short take at the default 1x, talking normally.** Should be back to how it sounded at B559 — no jump partway in — with `micGain: 1` and `peak` at or under 1.0 instead of 2.82.

## What counts as success

The raw readout responds to your voice, the slider gets the iPad to a usable level, and the iPhone is back to sounding right with no mid-take jump.

## What I can't see and need from you

- **What the raw number does when you talk on the iPad.** Everything downstream depends on it, and it is the thing I have been guessing at for three builds.
- **Whether the iPhone take still jumps.** It should not — the default is 1x and nothing adapts.

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
