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

## ⏸ SESSION ON HOLD — DANIEL'S CALL, AND IT IS THE RIGHT ONE (2026-08-18)

*"on the zero thermal and memory data that feels like it blocks us from being able to maximize the value of capturing any reports and should take precedence over any on device testing."*

**Agreed. Every device test below spends a real session producing a report with two null columns**, and both of those columns are load-bearing for the questions this session asks. **The vitals plugin now outranks T1-T5.** T0 (JS-only) rides along in the same cycle.

**One reprioritisation inside the hold, from Daniel's 4K-take result:** a 4K take now *works* on a short clip at 10-12fps, which is unusable. **T1's job was to decide which gate to build; the product answer no longer waits on it.** T1 stays because it generalises the gate, but it is no longer the top device test. **T2 (hands-off) is, because the bimodal collapse is unexplained and affects every workflow, not just recording.**

---

## 🔧 BLOCKER — do this before the next crash run (JS only, no Xcode, ~20 min)

**T0. Make `take:arm` record all three resolutions.** Today it records the bus dimensions and `broadcasting: true`. **It does not record the wall's resolution or the source's** — so the flight recorder cannot tell the cells of the matrix apart in the one question it exists to answer. Every crash report from here is worth roughly double with this in. **Do this first; it is cheap and it is the difference between a data point and a data set.**

---

## Ranked, most decisive first

**T1. 4K TAKE WITH THE BROADCAST OFF.** *(~2 min, expect a crash, iPad Pro)*
Unplug HDMI or stop the broadcast. Same 4K source. Start a session, arm a 4K recording.
- **Survives** → the encode is fine alone; the killer is **concurrency**, and the honest gate counts simultaneous full-resolution surfaces. Device-independent, computable at arm time.
- **Dies** → the M1 iPad cannot 4K-encode our output at all, and the gate is a **hard take-resolution cap** independent of broadcast state.
**This single bit decides which gate we build**, which is why it outranks everything else including the hands-off run.

**T2. HANDS-OFF RUN.** *(10 min, no touching, iPad Pro)*
4K source → 4K HDMI, start session, **do not touch the device for 10 minutes**, stop, export.
- **Bimodal ~10fps episodes vanish** → the collapse is **interaction-driven**, and the whole ceiling question reframes: we are not at a load ceiling, we have a cost in the input/render path.
- **They persist at the same rate** → load-driven, and heat is back on the table (but still unmeasurable until the plugin lands).
Free, no build. Daniel was interacting throughout both prior runs, so **every fps number we have is confounded by input.**

**T3. RECORDING-PRIORITY A/B.** *(~4 min, two 60s takes, iPad Pro)*
Record FHD **while** broadcasting, then record FHD with **broadcast off**. Compare the saved files' actual frame rates.
- **Both bad** → the recorder path has a fixed cost and the inversion is ours to fix outright.
- **Only the concurrent one is bad** → it is contention, and the fix is priority, not throughput.
Answers *"the saved take is worse than in-app fps, which isn't the prioritization we want"* with two files instead of an argument.

**T4. M1 iPad AIR (8GB), SAME 4K RUN.** *(~15 min)*
The controlled A/B on memory: same silicon, half the RAM. **Run it now for the fps and crash axes** — those work today. The memory axis needs the plugin, so this gets re-run later; that is fine, the crash axis alone is worth the trip.
- **Air dies at combinations the Pro survives** → memory is implicated without needing the plugin to say so.
- **Identical behaviour** → the ceiling is GPU/encoder, not memory, and the plugin's priority drops.
**Air before Pro from here on: it is the floor we actually own.**

**T5. M1 MAX DESKTOP, MOST DEMANDING WORKFLOW.** *(open-ended)*
Different question entirely — no jetsam, no thermal cliff of the same shape. What we want is whether the *same* stutter signature appears at all under 4K source + Syphon/NDI + aggressive canvas work. **If it does, it is our code and not the iPad.** That is the cheapest possible test of "is this a platform ceiling or an architecture cost."

---

## Parked until the vitals plugin lands

Anything whose answer is a temperature or a memory-headroom curve. **No conclusion about heat is available from any run so far** (`nativeReadings: false` in every report) and stating one would be inventing data.

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
