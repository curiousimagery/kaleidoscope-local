# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG. Closed sessions are archived under `archive/VERIFY-QUEUE-*.md`.

---

# ▶ OPEN SESSION (2026-08-18 docs) — "WHERE IS THE CEILING, AND IS IT A NUMBER WE CAN COMPUTE?"

**Standing ask (Daniel, 2026-08-18 docs):** *"keep a running list of highest value tests and verification tasks... we don't want to waste exchanges with me asking what is most helpful if you already knew."* **This list is that list.** It is kept ranked and current every turn; the top item is always the one to do next. Spontaneous tests are welcome and get folded in.

**The session's question, in Daniel's framing:** not *what can this iPad do*, but **which constraint is being hit**, so the gate is computed from what any device reports at runtime rather than hardcoded per model. We own the top of the hardware range and none of the bottom (HANDOFF "environment / hardware"), so **a model table would be calibrated entirely on good hardware.**

**⚠️ TWO READING RULES FOR EVERY REPORT IN THIS SESSION.** Both are known instrument defects, not fresh doubt:
1. **Ignore the `pressure` column.** Its baseline re-learns per workload; it has called 22fps "nominal" and 23fps "fair" in the same run.
2. **Check the `scenario` tag before trusting any `baseline` delta.** It is manual and was wrong on run 2, which made that report's deltas meaningless.

---

## ✅ T2 ANSWERED (2026-08-18, 11-min hands-off run, iPad Pro, 4K→4K HDMI)

**THE BIMODAL ~10fps STATE IS INTERACTION-DRIVEN.** 67 samples, `fps` band **19.6–25.0**, `frameP50` 44–48ms, **zero collapses, zero thermal events.** The interactive run of the same clip on the same hardware minutes earlier crossed into a ~10fps state repeatedly and bottomed at 9.8.

**What this retires:** heat, memory drift, and load-over-time as explanations for the collapse. **The device sustains a 4K source → 4K HDMI broadcast indefinitely.** What it cannot sustain is that broadcast *plus a human editing*.

**What it opens, and it is a better question than the one it closed:** the ceiling is not a device limit, it is **the cost of an interaction**. That is ours, and most of it is measurable without a device.

---

## ▶ T3 — RECORDING-PRIORITY A/B (next on device, ~6 min)

**The question:** is the saved take bad because the recorder path has a fixed cost, or because it is losing a contention it should be winning? *"The fps of the saved recording is terrible... it feels even worse than in app fps, which isn't the prioritization we want here."*

**▶ SHIPPED B665: THIS IS NOW ONE TAP.** Open the frame-cost panel → pick **T3 · recording priority A/B** → **run scenario**. The app does the rest and the take frame rates arrive in the report under `scenarioRun.takes`. **Preconditions it cannot check for you:** the 4K clip loaded, HDMI connected, and the destination selected.

**Manual steps, if you would rather drive it:**
1. Set the scenario tag to `hdmi-broadcast` **before** starting the session (the session label freezes at start; the last two runs disagreed with the report's own tag).
2. Broadcast the 20.4s 4K clip to the 4K wall. Start a session.
3. **Take A:** record ~60s at FHD **while broadcasting**. Stop the take.
4. Stop the broadcast. Wait ~20s.
5. **Take B:** record ~60s at FHD with **no broadcast**.
6. Stop the session, export, and note the two files' actual frame rates (QuickTime inspector or the Files preview is fine).

**What each outcome means:**
- **Both files bad** → fixed cost in the recorder path. Ours to fix outright, no priority question.
- **Only Take A bad** → contention, and the fix is priority, not throughput. A take is a deliverable; an editor surface is not.
- **Both fine** → the problem is specific to 4K takes and the FHD path is healthy, which is a gate we can write today.

**⚠️ EVERY STEP HERE IS AUTOMATABLE, INCLUDING THE MEASUREMENT — see the scenario-runner note below.** `recorder.js` already counts `videoFrames` and reports `wallSec` and `videoSpanSec` into the take report (exported as `audio`), so **the saved take's real frame rate is `videoFrames / wallSec` and never needed QuickTime.**

**Also captured for free:** B664's `vitalsSeam.why` names the native read-path failure, and `take:arm` now carries the wall size, source size and clip length.

---

## ✅ T8 — ANSWERED 2026-08-19. POWER IS A SOLVED PROBLEM, IF THE CABLE GOES INTO THE IPAD

**Daniel confirmed the rig: AirPlay broadcast, charging cable directly into the iPad.** Forty minutes, hands off, 241 samples, `outcome: complete`, **battery 95% → 95% flat.**

Against the earlier run (HDMI cable in the iPad's port, charging through the Magic Keyboard case, hot room, device already warm): **70% → 55% in the same forty minutes.**

**THE RULE: enough watts directly into the device sustains a 4K broadcast indefinitely. The Magic Keyboard's passthrough cannot.**

**Two confounds Daniel named himself and they do not overturn it:** the second run was 3-6°F cooler and started less warm, and iOS may throttle charge acceptance when hot. Both make the case-charging figure *worse* than the port's, not better, and neither explains a supply that cannot cover the draw. **The physics is one-way: if the supply is capped below the draw, the battery discharges at the deficit regardless of state of charge or temperature.**

**⚠️ WHAT IS STILL OPEN IS THE HDMI VARIANT, NOT THE POWER QUESTION.** The winning rig broadcasts over AirPlay because HDMI occupies the only port. **Nobody has yet run a sustained test on a passthrough dongle that carries both video and power.** See T10.

## 🅿️ T8 — pre-answer framing (kept for the reasoning)

**2026-08-19, on B679: a full T7 completed uninterrupted — 241 samples, `outcome: complete`, no suspended gaps. The wake lock holds.** Everything held flat (fps 19.7 → 20.6, memory 140MB, thermal `serious` throughout) **and battery held 95% → 95% while charging.**

**That is the power ceiling not reproducing.** The previous run fell 70% → 55% over the same 40 minutes.

**⚠️ BEFORE CONCLUDING ANYTHING, ESTABLISH THE RIG. The report cannot say.** The `scenario` tag is hand-picked from a fixed list in `shell/perf-panel.js` that **has no AirPlay option**, so an AirPlay run and an HDMI run are both filed as `hdmi-broadcast`. `wallW/wallH` read 3840x2160, which *suggests* HDMI (a mirrored AirPlay screen usually presents 1920x1080), but that is inference, not a reading.

**What the physics does rule out: state of charge.** If the supply is capped below the draw, the battery discharges at the deficit regardless of whether it sits at 95% or 73%. Same fps and same thermal in both runs, so the draw did not change. **The supply almost certainly did.**

- **If this was AirPlay + direct charge:** T8 is ANSWERED, and there is a supported eight-hour configuration. Then run **HDMI + direct charge** (a power-passthrough dongle) to separate the two variables the workaround moves at once.
- **If this was still HDMI via the Magic Keyboard:** the earlier 22.5%/hr drain is unexplained and T8 has not run. Suspect the first run's sleep/wake cycles or a different charger.

**⚠️ T8 IS NOT A NEW SCRIPT — it is the T7 script with a different rig.** Pick **T7 · warm long run** in the dropdown. Nothing to build.

**⚠️ KEEP THE 20.4s CLIP** for any power comparison. T7 is its only baseline.

**Two amplifiers Daniel named that belong in the reading, not in the conclusion:** ambient ~75°F with the device already hot, and iOS is known to throttle charge rate when hot.

### ▶ BUILD THE SCENARIO GUARD BEFORE THE NEXT POWER RUN

This is the second time a hand-picked tag has cost a comparison. The list needs an `airplay-broadcast` entry at minimum, and better, the tag should be **derived from the live destination** rather than typed. Filed in BACKLOG.

## 🅿️ T8 — original framing (superseded by the run above)

**T7 found the only ceiling that actually ends a run: power.** 70% → 55% in 40 minutes while plugged in, because **HDMI-out occupies the USB-C port and charging falls back to the Magic Keyboard's slower passthrough.**

**⚠️ THE FIRST T8 ATTEMPT (2026-08-19) IS VOID — the iPad slept through much of it.** B674 fixes both halves: the app now holds a screen wake lock while broadcasting, and the report says outright when samples were frozen. **Rerun on B674 or later**; on an older build the report cannot even say which rig it was.

**⚠️ T8 IS NOT A NEW SCRIPT — it is the T7 script with a different rig.** Pick **T7 · warm long run** in the dropdown exactly as before. Nothing to build.

**Daniel's own workaround is the test:** charge directly into the iPad, broadcast over **AirPlay**. **This changes two variables at once** — the power path and the video path — so if it holds, run it again over HDMI-with-direct-charge (a dongle that passes power through, if one is available) to separate them. **A single 40-minute T7 run in the AirPlay configuration answers whether the eight-hour exhibit has a supported setup at all.**

**⚠️ KEEP THE 20.4s CLIP.** T8's question is POWER, and T7 is its only baseline. Changing the source as well would move two variables across a 40-minute run and cost the comparison — the one thing that makes T7's forty minutes worth having.

Watch: `batteryPct` slope, `wallFps` over AirPlay against HDMI's ~21, and `wallW/wallH` (B673) to prove which rig the report describes.

**Two amplifiers Daniel named that belong in the reading, not in the conclusion:** ambient ~75°F with the device already hot, and iOS is known to throttle charge rate when hot. **If both are real, they compound** — a hot device charges slower while drawing more — and they make the AirPlay test more valuable rather than less, since a cooler run should charge faster for reasons that have nothing to do with the port.

## ▶ T10 — HDMI WITH POWER PASSTHROUGH (Daniel's Apple dongle, lower priority, but it is the one hardware unknown left)

**T8 proved power is solvable over AirPlay. It did not prove there is a WIRED setup that works**, and a wired signal is what a venue actually wants.

**Daniel's Apple multiport dongle held and dropped frames in an early test.** That was never characterised, and the dongle carries both video and power, so it answers the two remaining questions at once: **does the charge hold, and does the picture stay stable over a long run.**

**Run it as T7 with the same 20.4s clip**, dongle into the iPad, HDMI to the wall, power into the dongle. Watch `batteryPct` slope against T8's flat 95% and the external surface's `new pictures/s` against ~19. **A drop on either axis names a hardware limit, not a software one** — which is a perfectly good answer and belongs in CAPABILITIES.

## ▶ T9 — THE LONG CLIP (after T8, and it has its own hypothesis)

Daniel: *"we were looping the same 20.4s clip not a more massive file, which would minimize memory pressure."* **Correct, and the flat memory in T7 means "no leak in this configuration", not "memory is fine at any clip length".**

**A longer clip is a genuinely different test, not just a bigger one:**
- **The 6:39 clip is what the first fatal crash used** (B661/B663); the 20.4s clip survived the same operation. Clip length has been a live suspect since and has never been isolated.
- **Staging to the external view is per-clip.** `external-display.js` ships the file across in base64 chunks — a ~60MB clip today, roughly **1.2GB** for 6:39. That path has never been measured at that size.
- **Loop-wrap cost inverts.** 40 minutes of a 20.4s clip is ~120 wraps; the same 40 minutes of a 6:39 clip is ~6. **The short clip stresses the wrap; the long clip stresses the decode working set.** They are opposite tests, and T7 only ran one of them.

**Run it as its own T7 with the long clip**, once T8 has settled the power question.

## ✅ T7 — RAN 2026-08-19, ANSWERED

Forty minutes hands-off: **fps 20.0 → 20.4, wallFps 21.7 → 20.8, memory flat, no events, thermal `serious` throughout.** Nothing degrades over time. **The heat hypothesis is closed.** The only finding was the power ceiling above.

## 🅿️ T7 — original framing (Daniel's design, and it is better than mine)

*"Is 10 mins enough to verify there wouldn't be thermal throttling after an hour? I imagine we could pressure test harder using a longer 4k source clip and running for 30min+ with autoplay on after the device is already physically warm."*

**Correct on all three counts, and "indefinitely" was an overclaim on my part.** Eleven minutes bounds nothing beyond eleven minutes, and that run had **no thermal reading at all**, so it cannot even establish what state the device was in while it held 20-25fps.

**One refinement to the design: keep the SAME 20.4s clip for the first long run.** Duration and clip length are two variables and clip length is already implicated in the crash (a ~20s 4K clip survived what a 6:39 one did not). Same clip + longer duration + warm start is a **one-variable** change from the run we just did, so any difference is attributable. The longer-clip run is a separate, equally worthwhile test.

**Prerequisite: the native read path.** Without it a long run reports thermal only at transitions, which is exactly the signal this test is for. **Run T3 first — it is what surfaces `vitalsSeam.why`.**

**▶ SETUP, ANSWERING DANIEL'S QUESTION (2026-08-19). You do NOT need to start playback or the broadcast — the script does both.**

**Before you tap run:** the 20.4s 4K clip loaded, HDMI connected, the destination selected. That is all.

**What the script then does:** plays the clip (it loops on its own — no autoplay setting needed), starts the broadcast, waits **10 minutes while you interact freely** (this part is deliberately outside the session, its job is to remove the thermal headroom a cold start gives you), then starts the session and runs **40 minutes hands-off**, then stops. **~50 minutes total.**

**What it answers now that it did not before:** `batteryPct` over 50 minutes turns the 10%-per-hour reading into a real slope, and `wallFps` says whether the wall holds its rate over the same window. Those are the two questions with no fps signature.

**Old protocol note:** warm the device with ~10 min of interactive 4K broadcast, then start a session and go hands-off for 30-60 min. Hands-off matters: T2 established interaction is its own load, so mixing them back in would re-confound the thing this test isolates.

---

## ▶ T6 — WHAT DOES AN INTERACTION ACTUALLY COST (mostly NOT a device test)

Promoted straight to second place by T2's answer. **The first cut is Class 1 and runs on desktop**: with the ledger open, compare idle against a sustained canvas drag and read which surfaces and passes move. Candidates already in view — the overlay redraw, `foldSliceIntoSource` re-running on every render inside a drag (which is also the radial-pan suspect), history/state writes per pointermove.

**Only the confirmation belongs on device.** Do not spend a session on the enumeration.

---

## 🅿️ T1 / T4 / T5 — repositioned by what T2 and the native readings said

- **T1 (4K take, broadcast off)** — still generalises the gate, no longer urgent. A 10-12fps 4K take is unusable whether or not it crashes.
- **T4 (M1 iPad Air)** — **demoted.** Its main question was memory, and the first native reading answered it: `availMB 4969`, `footprintMB 150`. Worth doing eventually as a GPU-class floor, not as a memory test.
- **T5 (M1 Max desktop)** — unchanged, and T6 will likely give it a sharper question to answer.

# 🅿️ CLOSED SESSIONS → `archive/VERIFY-QUEUE-b599-b609.md`

B599-B609 archived at B658. Their answers live where they get read: **B609's three** in `PLAN-LIVE-READINESS.md` §1 (with the GL-context confound for the next bake test), and **the loop hold** in `BROADCAST-DELIVERY.md` §6a. Earlier sets are in `archive/VERIFY-QUEUE-b382-b476.md` and `archive/VERIFY-QUEUE-b573-b597.md`.


# 🅿️ PARKED — not this session

Pulled forward one session at a time. Nothing here is blocking.

**HDMI / external display** — the stale-broadcast-at-startup mystery on iPad, the 25–45s source-switch lag, iPhone HDMI in record mode, portrait vertical squish. B549/B551/B552 built the instruments; B559 gives the view a voice. **iPad 4K HDMI itself now reads healthy (B559)**, so what remains is the startup and switching behaviour rather than throughput.

**The 4K unaccounted third** — camera vs still image at the same resolution, two reports, no rebuild. Settles H2 and names the next optimization target.

**Frame-header pass (B546)** — FH-1, FH-2 and the still-after-camera check all confirmed (B559). Remaining: the iPad video-to-display clock check.

**Behaviour confirmations** — PiP starve rules at 4K vs FHD; A/V sync across smoothing modes.

**Loop Builder** — desktop, independent of all of the above. Cancel mid-bake, back-nav during bake, iPad safe-area header collision.

**Long-standing** — B382 external-display/GL-context cluster, large-clip HDMI staging, NDI HD-vs-FHD over WiFi, Movink resolution re-verify.

Detail for any of these is in git history (`docs/VERIFY-QUEUE.md` before B553); ask and I'll bring one forward as a focused session.
