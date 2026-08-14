# verification queue — archive, Builds 573-597

Closed sessions, newest first. Split out of `VERIFY-QUEUE.md` at B599 (Daniel: the queue should hold the current session and future-facing notes, nothing else). Results that mattered are in `CHANGELOG.md`; this is the record of what was asked and in what order.

---

# 🅿️ PREVIOUS SESSION (B597) — "does the bake survive, and can we finally get a loop reading?"

**⚠️ NEEDS `npx cap sync ios` + AN XCODE BUILD.** Two Swift files changed.

**iPad, ~8 minutes.** B596's loop instrument returned `null` because the native decode had fallen over before it could read anything. This build fixes the falling over. **Part 3 is the measurement B596 was supposed to produce.**

## ⚠️ SET THE SCENARIO TAG TO `hdmi-broadcast` FIRST.

## Part 1 — load and broadcast-start

1. Load a 4K clip. **Watch for the hunting.** It should now settle on one frame instead of stepping through a few.
2. Still paused, connect the display and start the broadcast.
3. **The wall must show the SAME frame as the output panel** — B596 primed it with the wrong one.

## Part 2 — bake while broadcasting (the B596 failure)

4. Still broadcasting, bake the clip into a seamless loop.
5. **It must come back on the native decode.** The tell is in the source note: it should read `planar · native decode · ~30 in/s`, **not** `from <video>`.
6. **If it does fall back, the note now says why** — `⚠ NO NATIVE DECODE: …` naming the stage. Send the report; that line is the whole diagnosis.
7. The staged panel must not go dark.

## Part 3 — the loop hold, localized (carried from B596, never read)

8. Let the baked loop run **four or more times** while broadcasting. Watch the hold.
9. `copy report`. Compare **`loopStall`** (the app's receiver) with **`extJitter.loop`** (the external view's own receiver, the one driving the display). In each, `last.gapMs` against `last.takeGapMs`:

| reading | meaning |
|---|---|
| both gaps small, in both receivers | nothing holds at the frame boundary and the hold is param-side, not picture-side |
| `takeGapMs` large in `extJitter.loop` | the wall received frames and did not draw them. Fix is in `output-view.js` |
| `takeGapMs` large in `loopStall` only | the app's engine stalls and the wall is fine — so what you are seeing is the iPad preview |
| `takeGapMs` large in **both** | a shared cause, which points at the GPU process the two webviews share |

**10. Tell me which surface holds — the iPad preview, the external display, or both.** One sentence, and it halves the search.

**If `extJitter.loop` is `null` again**, the external view is not on the native path and part 2 did not hold. That reading is still useful; send it.

# 🅿️ PREVIOUS SESSION (B596) — "where between the socket and the screen does the loop hold live?"

**⚠️ NEEDS `npx cap sync ios` + AN XCODE BUILD.** The Swift plugin changed.

**iPad, ~6 minutes.** One fix and one measurement. B595's loop mechanism was falsified by its own counter, so this build does not propose a new cause — it localizes the one we have.

## ⚠️ SET THE SCENARIO TAG TO `hdmi-broadcast` FIRST.

## Part 1 — the blank wall on broadcast start (regression from B595)

Parking the player on load was right, and it exposed this: a client joining a **paused** source got nothing, because the decode only pushes on a new pixel buffer. The socket now hands a joiner the current picture.

1. Motion mode, 4K clip loaded, **paused**. Connect the display, start the broadcast.
2. **The wall must show the parked frame immediately** — not blank, and not playing.
3. Scrub. It follows. Play/pause still behave.

## Part 2 — the loop hold, localized

4. Broadcast the baked loop, let it loop **four or more times**, watch the hold.
5. `copy report`. **Two fields now, and comparing them is the whole point:** `loopStall` (the app's receiver) and **`extJitter.loop` (the external view's own receiver, which is the one driving the display).**

**How to read it. In each, compare `last.gapMs` against `last.takeGapMs`:**

| reading | meaning |
|---|---|
| `gapMs` small, `takeGapMs` small, **in both** | nothing holds at the boundary and the hold is not where we have been looking at all |
| `gapMs` small, `takeGapMs` **large** in `extJitter.loop` | the wall received the frames and did not draw them. Fix is in `output-view.js` |
| `gapMs` small, `takeGapMs` **large** in `loopStall` only | the APP's engine stalls at the wrap and the wall is fine. Then what you are seeing is the iPad preview, not the broadcast |
| `takeGapMs` large in **both** | a shared cause, which points at the GPU process both webviews share |
| `taken1s` well below 30 | confirms a sustained stall rather than a one-frame hiccup |

**6. Tell me which surface holds — the iPad preview, the external display, or both.** The table above can distinguish them, but your eyes are faster and it costs you one sentence.

# 🅿️ PREVIOUS SESSION (B595) — "three root causes, found by reading — do the fixes hold?"

**iPad, ~10 minutes.** All three came out of code, not measurement, so this session is confirmation rather than investigation. **Do the parts in order — part 3 is only meaningful once part 2 works.**

## ⚠️ SET THE SCENARIO TAG TO `hdmi-broadcast` FIRST.

## Part 1 — the autoplay (root cause: the clip was playing from load)

The native player was started playing so the first frame could arrive, and nothing ever paused it again. It is now parked after its first frame.

1. Load a 4K clip in motion mode. **Do not press play.**
2. Connect the external display, start the broadcast. **The wall must hold on the first frame, not play.**
3. Scrub the motion timeline. On release the wall follows the scrub and **stays parked**.
4. Press play — the wall follows. Pause — it holds. Motion ↔ perform round trip, both directions.
5. **The one thing this could plausibly break:** the clip never producing a first frame and falling back to `<video>`. If the source panel shows footage and the report's `source` note says `native decode`, that did not happen.

## Part 2 — the bake (root cause: the baked clip never got its own decode)

The bake swapped the `<video>` and left the **pre-bake** decode driving the broadcast, with no planes flowing at all.

6. Loop Builder → slice → bake a seamless loop.
7. **You should now see "preparing the clip for native playback…"** after the bake completes. That message is the fix.
8. **The source panel must show the baked footage, not go dark.**
9. Check the clip length reads as the *baked* length (a slice bake is shorter than the original by the crossfade).

**This matters beyond the panel:** your B594 loop test ran against the pre-bake clip, so it could not have told us anything about the bake.

## Part 3 — the loop hold (root cause: we rewound a clip that was already looping)

Our tick seeked back to the trim in-point at every lap. On a full-range trim AVPlayerLooper had already wrapped it, and the seek opened a 120ms window during which perform's tick skips **everything** — four frames at 30fps.

10. Broadcast the baked loop and let it loop **at least four times**. Watch for the hold.
11. `copy report`. **The field is `loopStall`, and it now has `rewinds`, `suppressed` and `why`.**

**How to read it. Every outcome is informative, which is the point:**

| reading | meaning |
|---|---|
| `suppressed` ≈ `wraps`, **hold gone** | confirmed and fixed — the redundant seek was the hold |
| `suppressed` ≈ `wraps`, **hold remains** | the seek is gone but something else holds the picture; the next look is the planar upload across a backwards pts |
| `rewinds` ≈ `wraps` | we genuinely own the wrap (a trimmed range) — the settle window is gone but the seek still costs |
| **both 0** | our rewind never fired. My mechanism was wrong and the hold is elsewhere entirely |

`why` says which branch was taken, so a zero is never ambiguous.

# 🅿️ PREVIOUS SESSION (B593) — "does the wall follow the operator, and whose gap is the loop hold?"

**iPad, ~8 minutes.** Two fixes and one new instrument.

## ⚠️ SET THE SCENARIO TAG TO `hdmi-broadcast` FIRST. Your last three reports were tagged `idle-still`.

## Part 1 — the pause regression

1. Motion mode, **paused**, start the broadcast. **The wall must hold, not play.**
2. Press play. The wall follows. Pause again. It holds.
3. **Scrub while paused.** The wall should follow within ~250ms (the heartbeat). **If it does not follow at all, tell me** — that is the one thing this fix could plausibly break.
4. Perform mode: hold, take, cut. All should behave as before.

## Part 2 — the loop hold (the instrument)

5. Let a 4K clip loop **at least three times** while broadcasting, watching for the hold you described.
6. `copy report`. The new field is **`loopStall`**.

**How to read it, and this decides where the fix goes:**

- **`last.gapMs` near 30-50ms** → the decoder never stopped. Frames arrived on time and **we** failed to show them. Fix is ours, in JS.
- **`last.gapMs` in the hundreds** → the native looper genuinely stalls across the wrap. Fix is in the Swift plugin.
- **`after1s` well below 30** → confirms a real delivery stall rather than a single-frame hiccup.

`wraps` should equal the number of loops you watched. **If it stays 0 while the clip visibly loops, the instrument is wrong and nothing else here counts.**

## Also fixed, no action needed

The learned ceiling no longer records while the source has fallen off the planar path — your GL-context-loss run had overwritten a healthy 29 with a broken 20.

# 🅿️ PREVIOUS SESSION (B592) — "read the counter that was missing"

**iPad, ~4 minutes.** No behaviour change. B591's `extPosts` counter never reached the report on your path; this makes it visible so the panels-off case can be diagnosed instead of guessed at.

## ⚠️ SET THE SCENARIO TAG TO `hdmi-broadcast` FIRST.

## Steps

1. 4K → 4K HDMI, moderate slice, broadcast ~20s. `copy report`. **`extPosts` should now be present** with `ownClock: true`.
2. **Switch both editor panels off** (the run that gave 15/s). `copy report`.
3. If you can, do one run **in perform with playback running** and one **in motion paused**, and say which was which — the elision behaves differently depending on whether the state genuinely changes each frame, and that is the thing to distinguish.

## What each shape means

- **`elided` >> `sent`** → elision is engaging; if delivery is still low the cause is elsewhere.
- **`elided` ≈ 0 with a clip playing** → the state genuinely differs every frame. Then the question is which field is changing, and that is the next instrument.
- **`ownClock: false`** → the predicate is wrong and B591 never applied at all.

# 🅿️ PREVIOUS SESSION (B591) — "does quieting the state stream give back the frames?" — 🏆 29 of 30 delivered at full 4K (best of the arc) with the app at 19.8fps. Panels-off case still open; the counter was missing.

**iPad, ~5 minutes.** One change: identical state is no longer posted every frame when the view has its own frame socket.

## ⚠️ SET THE SCENARIO TAG TO `hdmi-broadcast` FIRST. Cold start, fixed slice.

## Steps

1. 4K → 4K HDMI, default slice, broadcast ~30s. `copy report`.
2. **The new field is `extPosts`.** Expect `ownClock: true` and `elided` climbing well above `sent`. **If `ownClock` is false with a clip playing, the predicate is wrong and nothing else here counts.**
3. **Now switch both editor panels off again** — the run that dropped you to 18/s. `copy report`.
   - **Pass: delivery stays near 26/s instead of falling.** That was the whole point.
4. **Watch the wall for a few seconds with the panels off.** The state stream is now nearly silent on that path; the picture must still move normally.

## The one thing that would mean I got the predicate wrong

**A clip that plays in the app but freezes on the external display.** That is the 10fps-over-HDMI failure this elision caused once before. The 250ms heartbeat should prevent a full freeze, so the symptom would be a choppy ~4fps wall rather than a still. **Report it immediately if you see anything like it and I will revert the predicate, not tune it.**

# 🅿️ PREVIOUS SESSION (B590) — "does the broadcast beat its own clock now?" — PASSED. Big slice: app 10.8fps, delivery 24/s. Decoupled.

**iPad, ~10 minutes. This one decides whether the 4K arc continues or closes.**

## ⚠️ SET THE SCENARIO TAG TO `hdmi-broadcast` FIRST. Cold start, and keep the slice FIXED across all arms (the B589 protocol — it is what made the last comparison readable).

## Part 1 — the decoupling (the whole point)

1. Force-quit, reopen, 4K source → 4K HDMI, **default slice**. Broadcast ~30s. `copy report`.
2. **The number that decides it: `external` note's NEW PICTURES/s versus `report.fps`.**
   - **Delivery ~30/s while app fps sits at ~25** → **it worked.** They are decoupled and item 1 closes.
   - **Delivery still equals app fps** → the app-frame story is wrong. **Say so and we stop here and move to the source-switch cluster.** No further proposals on this thread.
3. **Now make the slice big enough that app fps drops hard.** `copy report`.
   - **The interesting case:** app fps falls and **delivery holds near 30**. That is the product inversion — the operator's editor gets slower, the audience does not.

## Part 2 — the suspect futility result (same session, no code)

4. Still under the heavy slice, use the frame-cost panel to **turn the live and staged surfaces off by hand**. Watch the external note.
   - B583/B584 concluded shedding these does not help, but **both were measured hot with a big slice across time** — the same setup that produced the false QHD result. This is the controlled re-test.

## Watch for

**Staleness on a hard cut.** Frames can now be drawn with params up to one app-frame (~40ms) old. Continuous motion should look identical; a hard cut is where a seam would show. **If you see one, describe it — that is a real cost of this change, not a bug to hide.**

# 🅿️ PREVIOUS SESSION (B589) — "does the panel show the resolution it actually picked?" — VERIFIED (Daniel: "new defaults verified").

**iPad, ~2 minutes. No broadcast needed.** B588's smart default was working; you just could not see it. Two display bugs, no behaviour change underneath.

## Steps

1. **Force-quit Fold, reconnect the display, reopen.** With HDMI selected, **4K should be highlighted AND starred** — the star and the selection should agree. At B588 the star said 4K and the highlight said FHD.
2. **Switch the destination to Syphon or NDI.** The highlight should move to the **source's** resolution (4K for your clip).
3. **Tap FHD by hand, then switch destinations back and forth.** It should stay on FHD — a hand-picked tier outranks the default for the session.

## No re-run of the resolution A/B

**It is settled.** Your controlled pair gave 26/s and a 39ms draw interval at BOTH QHD and 4K. Resolution is free on this path in both directions, and your slice-size callout is what made that readable.

# 🅿️ PREVIOUS SESSION (B588) — "is the variable the resolution, or the clock?" — ANSWERED: neither. Controlled cold-start pair showed 4K and QHD identical (26/s, 39ms). B587's QHD-worse result was the enlarged slice plus a hot session.

**iPad, ~12 minutes.** The B587 A/B produced a decisive answer AND a reason to distrust it. This run separates the two. **Do the arms in this order; the order is the experiment.**

## ⚠️ SET THE SCENARIO TAG TO `hdmi-broadcast` FIRST, and again before saving any baseline.

## Part 1 — the defaults and the star (1 minute)

1. Open the output panel with HDMI selected. **4K should already be picked**, with a small **white star** on it. The green dot is gone.
2. Switch the destination to Syphon or NDI. **The tier should jump to the SOURCE's resolution** (4K for your clip).

## Part 2 — the reversed A/B (the actual point)

**Cold start: force-quit Fold and reopen it, so the device is in the same state the last run started from.**

3. **QHD FIRST.** Broadcast ~30 seconds. `copy report`.
4. **Then 4K.** Broadcast ~30 seconds. `copy report`.

## How to read it

Last time the second arm was worse. If that happens again **with the resolutions swapped**, the variable is TIME, not resolution:

- **4K (second) now worse than QHD (first)** → **it is the clock.** Every A/B this arc has run is suspect, and we need a warm-up-and-settle protocol before any further comparison counts.
- **4K (second) still better than QHD (first)** → the B587 result holds cleanly. Pixels are not the currency, resolution is closed, and the architecture conversation is next.

**Also worth noting in each report:** `preview render` ms. It went 11.68 → 13.08 → 16.30 last session at identical size. **If it climbs again the same way, that alone is the finding.**

# 🅿️ PREVIOUS SESSION (B587) — "does picking a resolution finally change the picture?" — RAN. QHD confirmed at `w: 2560`; delivery got WORSE (23→20/s). Pixel hypothesis closed, with a time confound to rule out.

**iPad, ~10 minutes.** This is both the honesty fix and, at last, the real 4K-vs-QHD experiment.

## ⚠️ SET THE SCENARIO TAG TO `hdmi-broadcast` FIRST, and again before saving any baseline.

## Steps

1. **Open the output panel with HDMI selected, not broadcasting.** Expect a **green dot on the 4K tier** (your display's own size) and the hint to end `display is 3840×2160 ●`.
2. **Pick 4K. Broadcast ~20s. `copy report`.** Check `external` reads `w: 3840`.
3. **Stop. Pick QHD. Broadcast ~20s. `copy report`.** **Check `external` now reads `w: 2560` — if it still says 3840 the change did not take and everything below is void.**
4. **Compare `extJitter.fresh.p50` between the two**, and look at the wall during the QHD run.

## What each outcome means

- **QHD delivers materially more new pictures/s** → pixels are the currency, the GPU-contention story holds, and you have a real quality-versus-smoothness choice to make (and to label).
- **QHD delivers the same ~23/s** → **pixels are NOT the currency.** That kills the last version of the resolution hypothesis and leaves the three-context 4K upload as the remaining explanation, which is the architecture conversation.

**Both answers are worth the run.** The second is arguably more valuable, because it is the one that would stop us reaching for resolution again.

## Also worth a glance

Your first broadcast after updating will be **FHD by default**, which is a behaviour change: HDMI used to ignore the tier and render at display-native. If that reads as "why is my broadcast soft", say so — the fix is the default, not the mechanism.

# 🅿️ PREVIOUS SESSION (B586) — "can you actually see the reading now?"

**iPad, ~3 minutes.** B585's text existed but was invisible on your configuration, and its stored readings were mislabelled. Both fixed. **Frame rate is unchanged; nothing here makes anything faster.**

## ⚠️ SET THE SCENARIO TAG TO `hdmi-broadcast` FIRST.

## Steps

1. **Open the output panel with HDMI selected.** The hint should now read something like `renders 3840×2160 — the display's own size · this tier (1920×1080) applies to recording, NDI and Syphon`. **The break-glass testing warning should no longer be the whole sentence** — it appends at the end if it appends at all.
2. **Broadcast 4K → 4K HDMI for ~20 seconds, stop, reopen the panel.** The hint should gain `⚠ measured here: 23 of 30fps · a lower tier may hold`.
3. `copy report`. `broadcastCeiling` should now hold **one** key, `hdmi:3840`. Your old `hdmi:2560` entry is gone on purpose: it was a 4K run filed under the wrong name.

## Do NOT bother re-running the QHD comparison

**It cannot work yet.** The tier does not reach the HDMI path at all, which is why your A/B showed nothing. Running it again would just re-measure 4K under a different label.

# 🅿️ PREVIOUS SESSION (B585) — "does the panel tell the truth about what this device can do?" — PARTIAL: the ceiling learned and persisted correctly, but the hint was invisible and the QHD arm never ran.

**iPad, ~6 minutes.** No native rebuild needed (B584's already covers it). Nothing about frame rate changes in this build; it only changes what the panel *says*.

## ⚠️ SET THE SCENARIO TAG TO `hdmi-broadcast` FIRST, and again before saving any baseline.

## Steps

1. **Open the output panel before broadcasting.** At the 4K tier the hint should read `3840×2160 · not measured here yet · 4K asks the most of the GPU`. **The old hardcoded `clean hardware only` should be gone.**
2. **Broadcast 4K → 4K HDMI for at least 15 seconds**, then stop. (It needs 8 samples past a 4-second warm-up before it will commit a reading.)
3. **Reopen the panel at 4K.** It should now read something like `⚠ measured here: 20 of 30fps · a lower tier may hold`.
4. **Switch to QHD, broadcast 15 seconds, stop.** Then look at the 4K tier again: if QHD held, the advice should name it — `· QHD held 29`.
   - **This is also the answer to the resolution question itself.** Whatever QHD measures is the real cost/benefit of dropping a tier on your hardware, and you will be looking at the wall while it happens, which is the part I cannot measure.
5. `copy report` — `broadcastCeiling` carries every reading it has accumulated.

## What it will not do

**It never changes the resolution for you.** The tier stays locked while output is live (that has always been true) and the text is only advice. On Syphon/NDI it also warns that the size is what downstream sees.

# 🅿️ PREVIOUS SESSION (B584) — "when the app freezes, which side stopped?" — NO REPRO in two attempts; instrument is in place, closed as watched.

**⚠️ NEEDS A NATIVE REBUILD: `npx cap sync ios`, then build in Xcode.** The Swift plugin gained a `frameStats` method; without the rebuild `srcFanOut` will be absent from the report and this session cannot answer its question.

**iPad, ~5 minutes plus however long the freeze takes to reappear.** This build adds no fix, only instruments. **Nothing here is expected to behave differently** except that a frozen source is now loud.

## ⚠️ SET THE SCENARIO TAG TO `hdmi-broadcast` FIRST, and again before saving any baseline.

## Steps

1. **Load a 4K clip, start the broadcast, and watch the app panels.** This is the repro attempt; it hit once in three tries at B583.
2. **If the panels freeze:** the panel header should read **`app fps NN · SOURCE FROZEN`** in red, and the source note should lead with `⚠ SOURCE STALLED N.Ns — socket <state>, offered N, took N, skipped N`. **`copy report` immediately.** That report answers the question by itself.
3. **If it does not freeze:** `copy report` from a healthy broadcast anyway. `srcFanOut` on a HEALTHY session is worth as much — it should show why both clients see ~25/s while the decoder makes 30/s, which is the standing delivery ceiling.
4. If you see `⚠ SOCKET REJOINED ×N` at any point, that is B584 catching a close that used to be permanent and silent. **Worth reporting even though nothing looked wrong.**

## What the report will say

`srcFanOut.clients[].offered` vs `taken`, per client:

- **equal, picture frozen** → frames reached us and we failed to use them. Our bug, JS side.
- **`skipped` climbing** → the native fan-out is passing us over because our previous 12.4MB send is still in flight. Contention.
- **`reaped` above 0, or `srcSocket.state: closed`** → we were dropped by the 6s stall watchdog.

Three different fixes, and at B583 all three looked identical.

# 🅿️ PREVIOUS SESSION (B583) — "does it give the panels back when shedding isn't working?"

**iPad, ~6 minutes. Needs B583.** Everything else from your B582 pass held.

## ⚠️ SET THE SCENARIO TAG TO `hdmi-broadcast` FIRST, and again before saving any baseline.

## Steps

1. 4K → 4K HDMI in perform. Widen the slice until the governor walks down to the bottom rung and the live panel pauses.
2. **Wait ~4 more seconds without touching anything.** Expect the reason to read `checking whether shedding bought anything (NNNNms)` and then, if it did not, **both panels come back on their own** with `shedding every editor view did not move the delivered rate (NN% under before, NN% after) — panels restored`.
   - **This is the pass condition, and it looks like the governor giving up.** It is: it ran the experiment, got a negative, and stopped charging you for it.
   - If shedding IS buying something on your device, it stays down instead. Also a pass — the report says which happened.
3. **`copy report` while it is settled.** The three things to check in it:
   - `governor.shortfall` now matches the percentage in `governor.reason`. At B582 they read 0.29 and 61%.
   - `governor.rung` names the panels: `main · staged 10fps, second · live PAUSED`.
   - The external surface's note **leads with** `NN NEW PICTURES/s ON THE DISPLAY`, and the panel header's new **`on the display`** stat matches the number on the live panel's paused label. **At B582 those two disagreed and the panel was the wrong one.**
4. **Shrink the slice right down.** Once the shortfall is genuinely low the futility latch clears, so it is allowed to try shedding again later.

## What changed and why

The pip never recovered because the display shortfall was **0.59**, far above the 0.25 shed threshold, so B582's probing was never reached. **The real problem was that it should not have been shedding**: your report showed accounted cost falling 28.46ms → 11.17ms while the frame got *slower* (40 → 43ms). We removed 17ms of work and gained nothing.

# 🅿️ PREVIOUS SESSION (B582) — CLEARED: recovery ratchet and the missing fps readout both fixed and verified; superseded by B583's futility release.

# 🅿️ PREVIOUS SESSION (B581) — CLEARED: `signal: display` ✓, `starved: [pip]` ✓, label ✓, pause feels polished (Daniel). Only the ratchet and the missing fps readout failed.

**iPad, ~8 minutes. Needs B581.** Close-out step 3 verification. No new investigation.

## ⚠️ SET THE SCENARIO TAG TO `hdmi-broadcast` FIRST, and again before saving any baseline.

## Steps

1. 4K clip → 4K HDMI broadcast, in **perform** (so the live view is a real surface). Widen the slice until it is under.
2. **Watch the governor step down to the bottom rung.** Expect `main view 10fps, second view PAUSED`.
3. **The live panel's label must read `paused to protect the broadcast`**, not `live`. A black panel under a live label is the failure this rung has to avoid.
4. `copy report`.
5. **Ease the slice back.** The second view must come back on its own, and the label must return to `live`.
6. **Switch the second view off BY HAND, then let the governor recover.** It must stay off — the governor only re-enables what it turned off itself.

## What decides it

- **`governor.signal`** must read **`display`** while the HDMI broadcast is live. If it reads `app`, the delivered measurement is not reaching it and everything else is the old behaviour.
- **`governor.starved`** should list `pip` at the bottom rung and be empty otherwise.
- **Does the DISPLAY improve when the second view pauses?** Honest expectation: **only slightly.** The PiP costs 2.33ms of a 52ms frame, so the real benefit is a 4K texture freed in the app process, which is a crash-risk win rather than a frame-rate win. **Say plainly if you see no difference** — that is the expected answer and it is still worth having.

## Then, if it all holds, close-out step 4 is unblocked

The numbers for the guardrail: `draw` p50 40-48ms, `fresh` 17-21/s of ~30 arriving. **The external view sustains roughly 20-25fps of 4K at a large slice.** That is what an honest label and a warning threshold get built on.

# 🅿️ PREVIOUS SESSION (B580) — CLEARED: planar survives the broadcast (3840×2160 held), and the log named the GPU process as the real crash

**iPad, ~10 minutes. Needs B580.** This is close-out step 1 and step 2 together: the blocker fix, and the first clean 4K measurement we have ever taken.

## ⚠️ SET THE SCENARIO TAG TO `hdmi-broadcast` FIRST

Top of the frame-cost panel, before every report and before saving any baseline.

## What changed

A GL context restore was re-uploading through `setSource`, which retires the planar provider — so **starting a 4K broadcast dropped every GL context (normal on this device), and the recovery silently deleted the planar path**, leaving the engine on a 1280 preview canvas at a sixth of the resolution. Every app-side number in the B579 reports was measured in that state.

## Steps

1. **Tag set.** Load the 4K clip, start the 4K HDMI broadcast.
2. **Check the `source` row immediately.** It must read **`planar`**. If it reads `⚠ NOT ON THE PLANAR PATH`, the fix failed and everything below is moot.
3. **Reproduce the old triggers**, which used to break it every time:
   - motion → perform switch
   - start / stop / restart the broadcast
   - After each, the `source` row must still say `planar` and read **3840×2160**, not 1280×720.
4. **Then take the honest 4K measurement**, which we have never had: normal slice → `copy report`, then large slice → `copy report`.
5. **Save a baseline** at the normal slice, tagged `hdmi-broadcast`.

## What I need

- **Does `source` stay `planar` at 3840×2160 through all three triggers?** That is the fix.
- **Does `⚠ GL CONTEXT RESTORED ×N` appear?** Expected, and now visible for the first time. **The count is the interesting part** — the loss itself is still unfixed, only its damage is.
- **The two 4K reports.** With the app genuinely at 8.29MP, `fresh` and `draw` finally describe the real ceiling, and the guardrail decision depends on them.

## Watch for

The dark panels should be gone. If they persist while `source` reads `planar`, that is a **different** bug and worth saying so plainly rather than assuming this one came back.

# 🅿️ PREVIOUS SESSION (B579) — CLEARED: `arrive` 2ms → 34ms, producer exonerated, `fresh` 8/s → 25/s

**iPad, ~8 minutes. Needs B579.**

## ⚠️ FIRST, BEFORE ANYTHING: set the scenario tag to `hdmi-broadcast`

Top of the frame-cost panel. **Do this before every report and before saving any baseline in this session.** Both B578 reports came through tagged `idle-still`, and the baseline you saved landed in that slot, so it will not line up with anything tagged `hdmi-broadcast`.

## Steps

1. **Set the tag to `hdmi-broadcast`.**
2. 4K clip looping → 4K HDMI broadcast, stage and live panels **OFF** by hand. This was the WORST state (8 new pictures/s) so it is the clearest test. Run 15s → `copy report`.
3. **Save a baseline here** if it now looks good, so later builds have a healthy reference in the right slot.
4. Panels back **ON**, run 15s → `copy report`.
5. **Watch the wall, not the panel.** Is the judder gone?

## What success looks like

| number | before | target |
| --- | --- | --- |
| `extJitter.arrive` p50 | **2ms** | **~33ms** |
| `extJitter.fresh` n | **8/s** | **~30/s** |
| external note | `⚠ ONLY ~8 NEW PICTURES/s` | `steady (new picture ~33/…ms)` |

**Stopping rule: if `fresh.n` is within ~10% of `srcFps` and the judder is gone, this closes.** The governor then becomes a thermal lever rather than a smoothness lever.

## If it improves but does not fully close

Read **`extJitter.draw` p50**. After this change every render is a fresh one, so **`draw` p50 IS the cost of a single fresh 4K render in the view** — a number we have never had, because it was previously an average of cheap repeats and expensive fresh renders mixed together.

- `draw` p50 near 33ms → the view can sustain 30fps and any residue is elsewhere.
- `draw` p50 at 45ms+ → **the view's raw 4K render is the ceiling**, and the levers are different: render the external view at 2560 rather than 3840 (the display's own `preferred`/`nativeBounds` both report 2560×1440, so we may be oversampling for no visible gain — B506's ranked lever list).

## Also check `srcArrive` in the export

This is the control: the **app's** view of the same socket. If it reads ~33ms while the view read 2ms, the producer and the native fan-out are exonerated and we never need to open that investigation.

## Regression watch, both of these are the known traps on this path

- **Desktop/Electron output window, focus moved away.** Click another app so the output window is unfocused, then keep performing. **The broadcast must stay smooth.** This is the rAF-throttling failure and it is why the coalescer uses a macrotask rather than rAF.
- **A still image as source, broadcasting.** Should stay live and correct, not freeze. That is B549's territory.

# 🅿️ PREVIOUS SESSION (B578) — CLEARED: `arrive` p50 2ms proved the view starves its own socket

**iPad, ~4 minutes. Needs B578.** Same state as B577, one report. No behaviour changed.

## The finding this follows up

B577 measured it: **the display shows ~6 new pictures a second while reporting 26 drawn and 30 arriving.** Not judder at 30fps. Six fps. Arithmetic says the arrivals are bunching, and B578 measures that directly on the socket event rather than inferring it.

## Steps

1. **Same juddering state**: 4K clip looping, 4K HDMI broadcast, stage and live panels switched OFF by hand.
2. Run ~15s, `copy report`.
3. **Then turn the panels back ON, run ~15s, `copy report` again.** Both states matter this time, because the 3x difference between them is the lever we do not understand yet.

## What decides it — `extJitter.arrive`

At 30 frames a second, honest arrivals are ~33ms apart.

| `arrive` reading | meaning | next |
| --- | --- | --- |
| **p50 near 33, p95 near 33** | frames arrive steadily; **WE are the ones bursting** | the view's render trigger and its main-thread stalls |
| **p50 tiny (~1-5ms) with a large p95** | frames arrive in BURSTS, exactly as predicted | the socket fan-out to the second client, native side (cross-ref B505) |
| p50 near 159 | the producer itself is only sending 6/s | upstream of the socket entirely, in the decode or the writer |

**The middle row is my prediction.** If it lands there, the next question is the native fan-out, and the honest answer is that part of it is Class 2 and will need the plugin's own logging.

## Also worth noting

The `external` row's note now leads with the LEVEL rather than the spread. It should read something like `⚠ ONLY ~6 NEW PICTURES/s ON SCREEN (one every 159ms) — 30 arrive and most are never shown`. B577's version called that "even", which was true and useless.

# 🅿️ PREVIOUS SESSION (B577) — CLEARED, and it answered on the first run: the display was at 6fps, not 30

**iPad, ~5 minutes. Needs B577.** One state, one report. No toggling, no A/B.

**No behaviour changed in this build.** It only adds the external view's interval distributions, because every number we had was a one-second average and judder is a variance phenomenon.

## Steps

1. **Get into the state you already described as severely juddering**: 4K clip looping, 4K HDMI broadcast, and the stage and live panels switched OFF by hand. That is the cleanest case because the app is doing almost nothing and it still judders.
2. **Let it run ~15 seconds**, then `copy report`.
3. **Also paste what the `external` row's note says on screen**, since it is the one-line verdict.
4. **If it is convenient, a second report with the panels back ON.** Not required.

## What the answer looks like, so you know what you are seeing

The `external` note will now end with either `⚠ UNEVEN: new frame every Xms typical but Yms at p95` or `even (new frame X/Yms p50/p95)`. The raw numbers are in the export under `extJitter`, with **two** distributions: `draw` (every render) and `fresh` (only renders that showed a new picture).

**All three outcomes are informative and each points somewhere different:**

| reading | meaning | where we look next |
| --- | --- | --- |
| `fresh` bursty, `draw` bursty | the app's post cadence is irregular and the view faithfully mirrors it | the app's main loop and the 89% unaccounted frame time |
| `fresh` bursty, `draw` even | posts are steady but state messages and socket frames interleave badly | the pairing of the two streams, likely render-on-arrival |
| **both even** | delivery is fine and the judder is in the CONTENT | frame timestamps and what the app samples per render, not the transport at all |

**The third row would be the most surprising and the most valuable**, because it would move this off the transport entirely. Do not be disappointed if it lands there; it is the outcome that saves the most time.

## What this cannot tell us

It says whether delivery is uneven. **It does not say why.** If it comes back bursty, the next step is localizing the cause, not a fix.

# 🅿️ PREVIOUS SESSION (B576) — "can we trust what the governor says about itself?" — CLEARED: all four checks pass

**iPad, ~3 minutes. Needs B576.** Confirmation only. No new question, no new lever.

B575's rate ladder is verified working (display 21-23 → 27-32, materially smoother). But its self-report could drift from reality, and that report is the instrument for the pacing work that comes next, so it gets confirmed alone.

## Steps

1. **Broadcast 4K → 4K HDMI, push it under, let the governor reach the bottom rung.**
2. **Toggle `preview` and `pip` OFF by hand, wait ~20s, then `copy report`.**
   - **PASS:** `governor.reason` says *"no editor surfaces to shed"*, `level: 0`, `governing: []`, and **`overlay` reads `rate: 1`**.
   - **FAIL (the B575 bug):** any surface still showing `rate: 3` or `rate: 6` while the governor claims full rate.
3. **Turn them back on.** They should come back at full rate and the governor should re-shed from level 0.
4. **Drag a slice while governed.** The overlay must stay at `rate: 1` (it is DECOR now and permanently out of the governed set).

## What I need

Just the report from step 2. **One number decides it: `overlay` rate.**

# 🅿️ PREVIOUS SESSION (B575) — "does the RATE ladder move the display, where resolution didn't?" — CLEARED: yes, and the mechanism turned out to be cadence (see CHANGELOG B575 / BACKLOG)

**iPad, ~10 minutes. Needs B575.** Same setup as B574, different actuator, and the toggle is still there so it is still one sitting.

## What changed

The governor now sheds **how often** the editor surfaces draw, not how big they are. At a 30fps target the rungs read: full → main 30 / second 15 → 15 / 7.5 → 10 / 5. The panel shows `⏱ 1 in N` on a governed row and the `governor` stat reads e.g. `main view 15fps, second view 7.5fps`.

## Steps

1. **4K → 4K HDMI broadcast, slice wide enough to push it under.** Confirm the governor steps down and the `⏱ 1 in N` markers appear.
2. **Toggle the governor off and on a few times, watching the DISPLAY.** Exactly the B574 test with a different lever. **This is the whole question.**
3. **Check the app is still usable at the bottom rung.** The main view running at 10fps is meant to feel slow but responsive — drag a slider and confirm the preview still follows rather than freezing. (That path is new: a skipped frame re-schedules rather than dropping.)
4. **`copy report`** at the bottom rung.

## What I need from you

- **Does the display improve?** If not, the editor surfaces are not the wall at all and `setPlanarCap` (shrinking the sampled 4K texture) is the next lever — a different term entirely.
- **Does the governor pick the right main view in PERFORM mode?** It ranks by area, so it should protect the big PiP and shed the small preview. The report names its choice under `governor.surfaces`.
- **Does anything feel stuck** when the preview is at 10fps? That is the deferred-render path and it is the riskiest part of this build.

## Still open from B574, costs nothing while you are there

Arm a take during the broadcast and **`copy report` immediately.** Whether the `source` note says `planar` at that moment decides whether D3 is a bus bug or a filmstrip bug. Also confirm whether the clip loaded was 4K or 720p — I read a 1280×720 source in your last take report and the two explanations look identical without that.

# 🅿️ PREVIOUS SESSION (B574) — "is the governor helping or just reporting?" — CLEARED: no steadiness difference, resolution ladder removed

**iPad, ~5 minutes. Needs B574.** One question, one toggle, no rebuild between answers.

B573 answered "does it fire" (yes) and "does the ladder work" (no — see CHANGELOG B574 for the numbers). **The only thing left unresolved is your own observation:** the display reported 37 → 23 fps under the governor and *felt steadier*. That is worth knowing, because if it is real then the governor is buying pacing even though it is not buying throughput, and that changes whether the ladder comes out or gets kept as a pacing lever.

## Steps

1. **Get into the pressured state** — 4K → 4K HDMI broadcast, slice widened until reflections cover most of the source. Confirm `governor · editor @ 35%`.
2. **Scroll to the bottom of the panel and toggle `governor` off.** Surfaces snap back to full size within a frame.
3. **Watch the DISPLAY for ~15s. Toggle back on. Watch again.** Two or three times.

**The one thing I need:** with the governor off, is the display *choppier*, *the same*, or *smoother*? Ignore the fps number in the panel — it went the wrong way last time and that is the finding. **Trust your eyes on the wall.**

- *Choppier with it off* → the ladder stays as a pacing lever and the rate ladder is added alongside it.
- *No difference* → the ladder comes out and is replaced by the rate ladder.

## While you are there, costs nothing

Arm a take and **`copy report` immediately**. I need to know whether the `source` note says `planar` or not at that moment — that one word decides whether D3 is a bus bug or a filmstrip bug. Also confirm whether the clip loaded at the time was 4K or 720p, since I am reading a 1280×720 source in your last report and the two explanations look identical without that.

# 🅿️ PREVIOUS SESSION (B573) — "the governor is now visible, so what does it say?" — CLEARED

**iPad, ~10 minutes. Needs B573.** The point of this run is no longer "did it fire" — the panel now answers that itself.

## What changed

**The governor thought nothing was broadcasting.** `isBroadcasting` was `outputBus.running || env.externalDisplay?.active`, and during an iPad 4K HDMI broadcast **both are false**: the HDMI sink is `needsBus:false` so the bus never runs, and the desktop-chrome `env.externalDisplay` object has no `active` property at all. It now asks `env.isOutputLive()`.

**It also says what it is doing now.** A `governor` stat plus a full sentence in the frame-cost panel, and a `governor` block in `copy report`. **You should never again have to infer it from surfaces that did not move.**

## Steps

1. **Open the frame-cost panel with nothing playing.** Expect `governor · watching` with a sentence like *"no live output — nothing to protect"*.
   - **If it says `NOT TICKING` in red, stop and send the report.** That means it is not subscribed at all, which is the B572 failure returning, and nothing below is worth running.
2. **Start the 4K → 4K HDMI broadcast.** The sentence should change to *"keeping up"* or *"shedding in Nms"*, then after ~2s of sustained shortfall to **`editor @ 75%`**.
3. **Watch the DISPLAY, not the app, as it steps 75 → 50 → 35.** This is the real question.
   - **I expect it to fire and NOT help.** Your manual walk already showed 25% changed nothing, and `preview render` costing 16.53ms at 0.38MP says why: the cost is sampling the 8.29MP source texture, not writing output pixels. If the display does not visibly improve, **the ladder comes out rather than gets tuned** and the actuator redesign is the next build.
   - The governor will tell you when it bottoms out: *"at the bottom rung (35%) and still N% under — the ladder is not the answer here"*.
4. **Start a take during that broadcast.** → does it save now instead of dying with `null is not an object` (B572)?
   - Expect **video only** and a message saying so; a mic would interrupt the program (B570).
   - Source/stage going dark is a **separate, unfixed** bug (D3's `capture: null`). Note whether it happens.
5. **`copy report`** during the broadcast and after the take.

## What I can't see and need from you

- **The governor line's sentence** at each stage. It is the whole diagnostic now.
- **Whether the DISPLAY improves when it steps down.** Say so plainly if it does not.
- **Whether the take saves.**

## Bonus, costs nothing

You said the **first 4K source loaded per session** arrives stuck and a second upload works. If that holds again, note whether the `source` note reads `0 in/s` or ~30 during the stuck state, and whether `⚠ DECODE FAILING` appears. **A cold-start condition is a much smaller search space than an intermittent one** — filed with that reframing.

