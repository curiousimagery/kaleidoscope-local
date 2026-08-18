# archived — the superseded six-item plan (HANDOFF, B609 → archived B658)

> **Cold store. Nothing here is current state or a to-do.** Archived at B658 during the item-3
> documentation cleanup. It was already marked SUPERSEDED at B609 and kept "for the reasoning
> behind items 1 and 2"; both are now closed and their conclusions live in documents that are
> actually read:
>
> - **Item 1's answer sheet is `../BROADCAST-DELIVERY.md`** — the pipeline, the levers that work,
>   the eight measured-dead hypotheses, and (rescued at B658, because this file was its only home)
>   the three-GL-uploads finding plus the 2560 caveat.
> - **The live sequence is `../PLAN-LIVE-READINESS.md`.**
> - **The Arena fixed-frame-size constraint lives in `../BACKLOG.md`.**
>
> Open this only to retrace how items 1 and 2 were argued. If you are here without a specific
> historical question, you are in the wrong file.

---

## ▶ THE PLAN (SUPERSEDED B609 — kept for the reasoning behind items 1 and 2)

Ordered by TRANSFER (what teaches the most about the rest) and DEPENDENCY, not by tractability. **The standing failure mode in this arc is a well-defined next step out-competing an important one** — see `DEBUGGING-PROTOCOL.md` state D. If you are about to work on something not on this list, that is the drift.

**1. FRAME CADENCE / BROADCAST DELIVERY — the levers are closed; the CEILING is now the open question, and it moved.** Shipped: the view coalesces messages (B579), the governor watches the DISPLAY (B581), the last rung pauses and says why (B581), recovery probes (B582), the ladder walk concludes and releases when shedding is not paying (B583), both ends of the frame wire report (B584).

> **⚠️ B584 RETIRED THE "EXTERNAL VIEW'S RENDER IS THE WALL" READING. Do not act on it; it is wrong.** Three of Daniel's B583 reports show the external view's **`draw` interval EQUAL to its `arrive` interval** — it draws every frame it receives, promptly. And during the B583 freeze, with the app not consuming, **it drew 4K at 45fps.** The 40-48ms draw times are CONTENTION, not a fixed render cost. **A minuscule slice delivered exactly the same 24/s as a normal one**, so slice size does not move delivery either.
>
> **⚠️ AND B584'S OWN "THE FAN-OUT IS THE CEILING" READING IS ALSO DEAD, killed by the first report off its own instrument.** Daniel's B584 run: **`skipped: 0` on BOTH clients**, over 4414 frames. `reaped: 0`, `closes: 0`, `reconnects: 0`. The app took 4414 of 4414 offered; the external view took 4189 of 4189. **`offered` over `ageMs` is 29.33/s against a 30fps source — the wire delivers 97.8% of it.** The fan-out drops nothing.
>
> **The ~25/s "arrivals" that started that hypothesis were an instrument artifact.** `extJitter.arrive` is measured in the external view's `ws.onmessage`, so it reports when that view's event loop *got to* the message, not when it landed. **It is downstream of the very main thread it was being used to exonerate.** The native counter is the wire; trust it instead.

**WHERE THE EVIDENCE NOW POINTS: the two webviews contend for the shared WebKit GPU process.** In one frame Daniel's B584 report has the external view **receiving 30/s from the wire and showing 18/s**, and the app at 12.7fps with **39.15ms of an 81ms frame unaccounted** (it is 11.15ms in the healthy baseline). B583's freeze is the natural control: with the app not consuming, **the external view drew 4K at 45fps.** So the view's capability is high and collapses under app load, shedding app editor surfaces does not recover it (the governor has now concluded futility twice), and the cost is in nobody's measured list. **That is the same suspect as the GPU-process crash below**, which unifies the two open threads.

**✅ THE 2560 QUESTION IS SETTLED, AND NOT IN OUR FAVOUR. Daniel's display is a real 4K panel (Dell P2415Q, 24" at 3840×2160).** So the `preferredMode`/`nativeBounds` 2560×1440 reading was the per-device iOS quirk the plugin already warns about, not evidence of an oversample. **Rendering the external view at 2560 IS broadcasting at QHD**, a genuine quality reduction. It shipped at B585 as an informed operator choice with a measured recommendation, not as an automatic rung. **Do not re-propose it as a free win.**

**✅ CLOSE-OUT STEP 4 SHIPPED (B585-586):** the resolution tiers report what this device actually sustained, learned by broadcasting rather than declared. **First real reading: `hdmi:3840` delivers 23 of 30fps on Daniel's M1 iPad.**

**✅ RESOLVED B587 — THE TIER NOW GOVERNS HDMI.** It used to render at the display's native size and ignore the selection, so picking FHD on a 4K panel broadcast 4K. Daniel's call: *"if I select resolution X for my output, it should output at X."* The display's size stays a ceiling, and `.toggle.is-native` marks which tier it is. **⚠️ Default behaviour changed: the tier defaults to FHD, so HDMI no longer runs at display-native unless 4K is picked. Watch for a "why is my broadcast soft" reaction; the default may want revisiting.**

**✅ SETTLED AT B589 BY A CONTROLLED REVERSED A/B: RESOLUTION IS FREE ON THIS PATH. DO NOT REACH FOR IT AGAIN.** Cold start, fixed default slice, QHD first then 4K: **26 new pictures/s and a 39ms draw interval in BOTH arms**, at 3.69MP and 8.29MP. 2.2x the pixels, identical cost. B588 closed the hypothesis from one side (cutting does not help), B589 from the other (adding does not hurt). **4K is not "asking too much" of this device.**

**⚠️ B588's OPPOSITE READING IS RETRACTED.** That run showed QHD worse; Daniel identified the confound (**he had enlarged the slice**, and it was late in a hot session). It was never a resolution effect.

**🌡️ THE TIME DRIFT IS REAL BUT LOAD-DEPENDENT.** `preview render` rose 40% across the hot heavy-slice sitting and only ~5% across B589's controlled pair. **So cross-time A/Bs are salvageable, not worthless — they need a COLD START and a FIXED SLICE.** Adopt that as the standing protocol for any comparison; it is cheap and it is what made B589 readable where B588 was not.

**🔓 B590 — THE MECHANISM BEHIND ALL OF IT: THE BROADCAST WAS CLOCKED BY THE APP'S FRAME RATE.** `external-surface.js` posts state on the app's rAF loop and `output-view.js` used that as its only render trigger, so the app's fps was a hard ceiling. **Delivery tracked app fps to within one frame in every run ever measured** (25.1→26, 27.2→26, 23.7→23, 19.7→20, 24.0→24) while the view's own socket carried 30/s it was never asked to draw. **B583's freeze was the accidental control: app at 42.5fps → the view drew 45fps of 4K.**

This retires the confusion, not just a hypothesis. Resolution was free because the view was clock-gated, not fill-bound. The wire was clean because the frames were there and undrawn. Slice size mattered because it moved the APP's frame rate.

**B590 makes a new frame its own reason to draw** (`onFrame` → `scheduleRender`), keeping the B579 coalescing so the socket is never starved.

**✅ VERIFIED B590, AND IT IS THE RESULT OF THE ARC.** Big-slice arm: **app fps 10.8, delivery 24/s.** The editor slowed and the audience's picture did not. **B591** then removed the redundant state posts B590 made unnecessary (they were measurably hurting delivery: panels off → 18/s).

**▶ ITEM 1 IS EFFECTIVELY CLOSED. The remaining work here is CONSOLIDATION, not investigation** — see BACKLOG's consolidation item, which Daniel called for directly. **The governor is the live risk: B590 inverted its premise and its action now measurably hurts delivery.**

**📕 ITEM 1 IS CLOSED AT B594. `docs/BROADCAST-DELIVERY.md` is the answer sheet — read it before proposing anything about broadcast frame rate.** Result: **29 of 30 delivered at full 4K** while the app runs at ~20fps. Eight hypotheses are recorded there as measured-dead; several are plausible enough to be re-proposed by someone who has not read it.

**▶ NEXT IS ITEM 2, promoted by Daniel:** the **loop-restart stall is reproducing for him in normal use and he calls it "visually very disruptive."** It is a multi-frame hold at the end of each loop, predates B590, and is the way into the source-attach cluster. **B593's `loopStall` already answered the first question: the decoder is INNOCENT** (25 wraps, max gap 17ms, 29 frames in the second after the wrap). The hold is in our own render/upload path on a pts discontinuity.

**Three symptoms, one family — "the first frame after a mode or source change":** the loop hold; **broadcast-start from motion mode autoplaying**; and a **green/RGB glitch on the first motion → perform transition**.

**✅ B595 FOUND ROOT CAUSES FOR TWO OF THE THREE, PLUS ONE NOBODY HAD REPORTED, ALL BY READING CODE — no device session spent.**

- **The autoplay was a lying flag, not a wrong gate.** The plugin's `start()` plays the AVPlayer so a first frame can arrive, and nothing ever paused it again while the JS clock initialised `paused: false`. **The clip had been playing since load**; it only became visible once the external view started drawing on its own clock. Now parked after the first frame. B593's `isPlaying` was reading the right property off a value that had never been true.
- **The loop hold: we were rewinding a clip that AVPlayerLooper had already wrapped.** Both playback ticks seek to the trim in-point at every lap, and `seek()` opened a 120ms `seeking` window during which perform's tick skips its entire body. **Four frames at 30fps.** `clock.rewind(inSec, outSec)` now defers to the looper when the looper owns the wrap, and rewinds without blanking the render when we genuinely own it. **⚠️ Whether the rewind fires at all depends on where the last frame's pts falls against `outSec - 0.03`, which is why `loopStall` gained `rewinds`/`suppressed`/`why`. If both counters read 0, this mechanism was wrong.**
- **A bake never gave the baked clip its own decode.** `applyBakedClip` swapped the `<video>` and never re-ran `attachNativeVideo`, while `setSource` retired the planar provider on its way through. The result: the engine on the new element, `env.nativeVideo`/`env.sourceClock` still on the **pre-bake** decode, no planes flowing. Daniel's dark source panel. **It also means his B594 bake test measured the old clip.**

**Still without a root cause: the green/RGB glitch.** Class 1; look at the perform engine's first `updateSourceFrame` after `setPlanarSource`.

**⚠️ B594 CORRECTION.** That build ruled out the seek-settle window on the grounds that `seekUntil` is set only by an explicit `seek()`. True, and the inference was wrong: **the trim rewind IS an explicit seek, issued from the playback tick every lap.** `BROADCAST-DELIVERY.md` §6 has been corrected.

**(superseded) VERIFY DECIDES THE ARC.** If delivery goes to ~30/s and stops tracking app fps, item 1 closes and the product behaviour inverts in the right direction (a heavy slice slows the operator's editor, not the audience). **If delivery does NOT move, the app-frame story is wrong too, and the standing instruction is to STOP and go to item 2 without proposing anything further here.**

**⚠️ ALSO SUSPECT, and cheap to re-test in the same session: the governor's futility results.** B583/B584 both concluded "shedding editor surfaces does not help", but both were measured on a hot device with an enlarged slice, comparing across time — **the same uncontrolled setup that produced B587's false QHD result.** Re-run the shed test under the B589 protocol (cold start, fixed slice) before treating that conclusion as settled.

**▶ NEXT — the one structural cost never attacked: one source frame is uploaded as a 4K texture into THREE GL contexts every frame** (the staged engine, the live engine, and the external view's engine in its own process; the record/broadcast bus is NOT among them, confirmed by its absence from every report). **Every lever this arc has pulled makes one of the three cheaper. None has asked why there are three.** That single fact is consistent with every dead hypothesis above: shrinking a surface does not help because the upload is fixed cost; killing the PiP does not help because it removes the cheapest of the three; and the external view jumped to 45fps the moment the app stopped uploading. **This is an architecture change and deserves its own design pass with Daniel, not a smuggled performance fix.**

> **⚠️ CONSTRAINT ON ANY AUTOMATIC RESOLUTION DEGRADATION (Daniel, B583).** A downstream consumer can be expecting a fixed frame size — his case is **Syphon/NDI into Resolume Arena, where a mid-broadcast resolution change rescales the composition.** So poor fps can be the better outcome there, and resolution must not degrade automatically on that path. **The 2560 lever is a different mechanism and is not covered by this**: an HDMI/AirPlay external window has no downstream consumer with a fixed expectation, and the display itself declares 2560×1440, so rendering 3840 into it is pure waste with no contract to break. Keep the two separate.

**2. THE 4K FIRST-FRAME / SOURCE-ATTACH CLUSTER — next.** Four symptoms, one likely mechanism, all "the first frame after a seek or attach costs something we do not pay elsewhere": the loop-restart hold (**REGRESSION, and the only one that reproduces on demand — this is the way in**), the scrubber jitter at playback start, the intermittent "loads but will not play", and the mode-switch-during-attach theory. **Instrument maintenance with a declared budget**, because it blocks measurement.

**3. NDI — one measurement, not an investigation.** B579's fix does NOT touch it (no view, no message-driven render loop). **B478 already concluded WiFi NDI is packet-timing jitter with sender-side levers exhausted.** What is genuinely open: the iPad `capture: async` reading 31.43ms/frame, and a wired retest.

**4. iPAD LIMITS — sustained capture, long takes, honest edges.** Exit criterion 5's data. Needs 1 and 2 done first. Record-to-disk already shipped (B553); the open question is how long/how big, and the known long pole is the **audio flush at finalize** (32.7s on a 3:28 4K take vs 94ms for video).

**5. iPHONE — mostly DECISIONS once the iPad numbers exist.** Same conduit, codecs, OPFS path. Genuinely phone-specific: HDMI has never been measured on any build, and the mobile chrome's 2048 output cap is structural. Honest labels are cheap after 4, guesswork before.

**6. THERMAL / SUSTAINED LOAD — last.** Prerequisite: `ProcessInfo.thermalState` currently reads null, so we have no native signal and the inferred one is drift-based. **Fix that BEFORE the thermal work or we will be inferring heat from frame times**, which is the adjacent-quantity trap this arc is named for.

**Riding alongside, not in the sequence:** the WebKit **GPU-process crash** (see below — it is exit criterion 5 work, not a side bug) and the status-readout-bar audit. *(Surface naming unified at B583.)*

