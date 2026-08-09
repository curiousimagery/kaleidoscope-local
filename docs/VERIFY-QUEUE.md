# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG.

---

# ▶ THIS SESSION (B575) — "does the RATE ladder move the display, where resolution didn't?"

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
