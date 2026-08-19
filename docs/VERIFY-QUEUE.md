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

**Steps, one sitting:**
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

## ▶ T7 — THE WARM LONG RUN (Daniel's design, and it is better than mine)

*"Is 10 mins enough to verify there wouldn't be thermal throttling after an hour? I imagine we could pressure test harder using a longer 4k source clip and running for 30min+ with autoplay on after the device is already physically warm."*

**Correct on all three counts, and "indefinitely" was an overclaim on my part.** Eleven minutes bounds nothing beyond eleven minutes, and that run had **no thermal reading at all**, so it cannot even establish what state the device was in while it held 20-25fps.

**One refinement to the design: keep the SAME 20.4s clip for the first long run.** Duration and clip length are two variables and clip length is already implicated in the crash (a ~20s 4K clip survived what a 6:39 one did not). Same clip + longer duration + warm start is a **one-variable** change from the run we just did, so any difference is attributable. The longer-clip run is a separate, equally worthwhile test.

**Prerequisite: the native read path.** Without it a long run reports thermal only at transitions, which is exactly the signal this test is for. **Run T3 first — it is what surfaces `vitalsSeam.why`.**

**Protocol:** warm the device with ~10 min of interactive 4K broadcast, then start a session and go hands-off for 30-60 min with autoplay on. Hands-off matters: T2 established interaction is its own load, so mixing them back in would re-confound the thing this test isolates.

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
