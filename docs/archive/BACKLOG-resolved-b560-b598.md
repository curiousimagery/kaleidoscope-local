# backlog — resolved & superseded, Builds 560-598

Split out of `BACKLOG.md` at B599 (Daniel: the backlog should hold future planned work and context that serves it, nothing else).

**These are closed.** Kept because several were superseded rather than simply fixed, and the reasoning that was replaced is the useful part — it names hypotheses that read as plausible and are not. `CHANGELOG.md` has what shipped; `BROADCAST-DELIVERY.md` has the surviving conclusions about frame delivery.

---

### 🔴 THE DISPLAY IS WORSE WITH THE EDITOR SURFACES OFF THAN WITH THEM GOVERNED (Daniel, B571 + confirmed B575)

**Observed twice, in two different builds, with two different actuators. It is the most important open finding in the arc.** M1 iPad, 4K clip, 4K HDMI:

| editor surfaces | app fps | on the display |
| --- | --- | --- |
| full rate | ~22 | 21-23, less smooth |
| **governed (10fps / 5fps, B575)** | ~22 | **27-32, materially smoother** |
| **OFF entirely** | **36-45** | **choppier than governed** |

**The relationship is NOT monotonic.** Less app work does not mean a better broadcast. That rules out simple GPU contention as the sole mechanism, because the OFF row has the least app GPU work and the worst output.

## ✅ SOLVED B575 — IT IS A CADENCE MISMATCH, NOT A THROUGHPUT PROBLEM

Two reports, same session, same clip, same broadcast. **The `external` note settles it in one line each:**

| state | app fps | source in/s | **display: drawn · new** |
| --- | --- | --- | --- |
| governed (smooth) | ~22 | 28.9 | **25 drawn · 26 new** |
| surfaces off (choppy) | 36.8 | 28.9 | **36 drawn · 27 new** |

- **`in/s` is identical (28.9).** Decode starvation is dead.
- **`new/s` is essentially identical (26 vs 27).** The view receives the same frames either way, so back-pressure and over-delivery are dead too.
- **What changes is the DRAW rate: 25 vs 36 against a source arriving at ~27.**

**In the choppy state the view redraws 36 times a second while only 27 new frames arrive**, so roughly nine draws per second re-present a frame already on screen. That is not free: it quantizes each arrival onto a 27.8ms draw grid, and 27-into-36 is a non-integer cadence, so the interval between *new content actually appearing* alternates between one and two draw periods (27.8ms and 55.6ms). **A 2:1 swing in presentation interval is textbook judder, and it is exactly what Daniel sees.**

In the governed state the grid is 40ms and arrivals are 38.5ms apart, so it is nearly 1:1 and every draw carries a new frame. Smooth.

**MECHANISM: the external view redraws on the app's POST cadence (post-driven since B549's render-clock fix), while source frames arrive on the DECODER's cadence. Smoothness is governed by how well those two agree, not by how fast either one runs.** A faster app loop actively hurts, because it desynchronizes them.

**Three consequences:**
1. **The governor's actuator has been right for the wrong reason.** Rate-limiting the editor surfaces slows the whole loop, which drags the post cadence back toward the arrival rate. It is helping by side effect. **The direct lever is pacing the poster to source arrival** (publish on arrival rather than on rAF), which would make drawn ≈ new by construction. Care needed: B513's identical-post elision and B549's 32ms keepalive floor already live on this path, and B549 exists precisely because eliding posts starved the view's clock.
2. **Our health signal is inverted in the worst state.** That report reads `pressure: nominal, shortfall: 0` because app fps 36.8 exceeds the 30 target. **The governor would correctly decide to do nothing while the broadcast judders.** This is BACKLOG consequence 2 ("anything governing on app fps alone can make the product worse while reporting success") now proven with numbers rather than argued.
3. **B552's arrival counter is what solved this**, 23 builds after it was built, and this is the first time it was read as an A/B. Exactly the conserved-quantity pattern in DEBUGGING-PROTOCOL §3: one reading, hypothesis space collapsed.

### 🎯 CHARACTERIZED B578 — IT IS A 3x FRAME LOSS, NOT A PACING SUBTLETY

The B577 instrument answered on its first run. `26 fps ON THE DISPLAY · 30 new/s` with `fresh: { p50: 159, p95: 198, n: 7 }`. **Seven of twenty-six renders per second put a new picture on the wall, so the display's real rate is about SIX fps.**

| state | drawn | arriving | **new pictures ON SCREEN** |
| --- | --- | --- | --- |
| governed, panels on | 23 | 30 | **~19/s** (53/83ms) |
| panels off by hand | 26 | 30 | **~6/s** (159/198ms) |

**Switching the editor surfaces off cuts the real content rate by 3x.** That is the whole "higher reported fps, worse display" mystery, and both the cadence theory and the contention theory are now retired: nothing subtle is happening, we are dropping three quarters of the frames and two averages were hiding it.

**Arithmetic says the ARRIVALS bunch, not just the renders.** Renders are clustered (`draw` p50 24ms against a 41ms mean), but clustered renders alone would still find a new frame on ~73% of them, giving `fresh.n` near 19. We measured 7. So ~4-5 frames land at once, ~7 times a second, and the view renders once and takes the latest — three of every four are discarded unseen. The picture jumps four frame-times, holds 159ms, jumps again.

## 🎯 ROOT CAUSE FOUND B578 — THE EXTERNAL VIEW RENDERS PER MESSAGE, SATURATES ITS OWN MAIN THREAD, AND THEN CANNOT SERVICE ITS SOCKET

`extJitter.arrive`, measured on the view's `ws.onmessage` so it is independent of rendering. **Same arrival COUNT in both states (n=31), completely different distribution:**

| state | app fps | `arrive` p50/p95 | `draw` p50 | **new pictures on screen** |
| --- | --- | --- | --- | --- |
| panels OFF | 38.8 | **2ms** / 139ms (max 187) | 20ms | **8/s** |
| panels ON, governed | 27.9 | **28ms** / 72ms | 35ms | **17/s** |

**A median inter-arrival gap of 2ms is an event loop draining a backlog**, not a producer sending fast. Frames pile up in the socket while the thread is busy, then fire back-to-back the instant it frees. With the panels on, arrivals land every 28ms, which is honest for a 30fps source.

**THE MECHANISM, and it is a feedback loop that runs backwards from intuition:**

1. The view renders **synchronously on every state message** (by design since the original render-on-message design and B549 — rAF is throttled in unfocused windows, so rendering on arrival was the fix for a real Firefox bug).
2. Each render is a **full 4K kaleidoscope** in that process.
3. **A faster app posts more often**, so the view renders more often, and at 4K it saturates its own main thread.
4. **A saturated main thread cannot run `ws.onmessage`**, so socket frames queue and arrive in bursts of ~4.
5. The view renders once per burst and takes the **latest** frame, discarding the other three unseen.

**So posting faster puts FEWER pictures on the wall.** More app fps, less content. That is the whole three-build mystery, and it is not subtle once the right quantity is visible.

**IT ALSO RETRO-EXPLAINS THE RESOLUTION LADDER (B574).** Scaling the preview down made the app *cheaper per frame*, so the app looped *faster*, so it posted *faster*, so the display got *worse* — roughly cancelling the gain. **The ladder was not a no-op; it was two effects of opposite sign.** That is why it measured as "changes nothing".

**And it explains the sweet spot.** app 25.1fps → 14 new/s; app 27.9fps → 17 new/s; app 38.8fps → 8/s. Non-monotonic with a peak near 28, which is why the governor at level 2 felt best. **Even at the peak we are still losing 43% of arriving frames**, so the governor is finding a local optimum inside a broken design rather than fixing it.

**▶ THE FIX: coalesce messages into ONE render, and never render more often than the source advances.** Rendering a 4K frame more often than the picture changes is pure waste under any explanation, and here it actively destroys frames. Constraint to respect: **do not go back to a pure rAF loop.** the original render-on-message design and B549 exist because rAF is throttled or suspended in an unfocused window, which is the perform-mode showstopper. Coalescing to a microtask or `setTimeout(0)` keeps message-driven rendering while collapsing a burst into one render.

**▶ ONE CONFIRMATION WORTH SHIPPING WITH IT:** the same `arrivalSpread()` on the APP's receiver. If the app sees even arrivals (~33ms) at the moment the view sees 2ms bursts, the producer and the native fan-out are exonerated outright and this is proven rather than strongly inferred — which also means never opening the Class 2 fan-out investigation (cross-ref B505).

### [SUPERSEDED B578] ❌ FALSIFIED B576 — RATE MATCHING IS NOT SUFFICIENT.

The cadence story above predicted that judder would go away when drawn ≈ new. **Daniel's B576 run produced `28 fps ON THE DISPLAY · 28 new/s`, a perfect match, with SEVERE judder.** The hypothesis is dead in its simple form and the entry above is kept only for the evidence it contains.

**What survives:** app-loop timing and display smoothness are linked. **What is dead:** that the link is average rate matching.

**The reframe, and it is a statistics problem rather than a semantics one for once.** Judder is a VARIANCE phenomenon and every number we have is a one-second AVERAGE. The app's own frame times already tell us the loop is badly paced in the state that judders:

```
fps 29.7   p50 39ms   p95 52ms   →  mean 33.7ms
```

**`p50` (39) above the mean (33.7) means the distribution is bursty**: a run of short frames then a long one. An average of 28 drawn against 28 new is exactly what a bursty loop looks like when you smooth it over a second, and it is compatible with both perfectly even delivery and violent judder.

The most likely mechanism now: **presentation is even and CONTENT ADVANCE is not.** The app samples whatever the latest decoded frame is at rAF time; if rAF intervals are irregular, consecutive displayed frames represent unevenly-spaced moments of the clip. That is judder at a steady display rate, and the external view would faithfully mirror it while reporting healthy numbers.

**And the frame is 89% unaccounted in that state.** `accountedMs 4.37` of a 39ms frame, with preview off, pip off and the overlay idle. The app is uploading an 8.29MP texture and rendering nothing visible, and still takes 39ms. Note the external view runs its OWN 4K kaleidoscope render in another process on the same GPU (it joins the same frame socket and renders from state), so contention is the leading candidate for the gap.

**▶ THE INSTRUMENT GAP, and this is the next step rather than a fix:** the external view reports an average fps and nothing else. **We need its frame-interval DISTRIBUTION** (p50/p95 of its own intervals, and separately the interval between NEW frames), which is the same shape the app already reports as `frameMs`. Without it we cannot distinguish "even 28fps" from "bursty 28fps", and that distinction IS the bug.

**Do not start the pacing work.** It was designed against a falsified hypothesis.

### ✅ FIXED B576 — THREE B575 GOVERNOR BUGS, ALL FOUND BY READING THE REPORT (no device time)

All three are visible in Daniel's surfaces-off report and all three are mine, introduced in B575.

1. **A surface that leaves the filter keeps its rate forever.** `editorSurfaces()` filters on `msPerFrame > 0`, so a surface that stops costing anything drops out of the list and is never reset. The `overlay` entered the list during a gesture (it draws then), took the secondary rate, and is now **stuck at `rate: 6` with `calls: 0`** for the rest of the session. Same for `preview` and `pip` once Daniel disabled them: they sit at 3 and 6 and will come back throttled when re-enabled.
2. **`level` advances even when nothing was applied.** `applyLevel` decrements/increments `level` regardless of whether the list was empty, so the governor walked itself 3 → 0 over ~16s against an empty list while the real rates stayed at 3 and 6. **The report proves the divergence: `level: 0, rates: {primary: 1, secondary: 1}` alongside `preview rate: 3, pip rate: 6`.** The governor's model of the world and the world disagree.
3. **The primacy tie is too close to be stable.** `preview` 0.39MP vs `pip` 0.37MP. A 5% difference decides which surface is protected, so a minor layout change could flip it mid-broadcast and swap the rates visibly. Needs hysteresis, or a stickier rule than area.

**Fix (1) and (2) together: track the governed set explicitly rather than re-deriving it from a cost filter each tick, and reset every surface it has ever touched.** Worth doing before any further governor work, since (2) means its own reported state cannot currently be trusted.

### ✅ [FIXED B587] THE RESOLUTION TIER DID NOT REACH HDMI/AIRPLAY

`computeOutputDims()` rendered a self-rendering destination (`needsBus:false`) at the **display's native size**; the tier only fed `outputBus.setResolution`, which those destinations never use. **Picking FHD on a 4K panel broadcast 4K.** Daniel called it dishonest and he was right: the panel bundles recording and broadcast under one control, so it reads as governing both. Now it does, with the display's size as a ceiling and `.toggle.is-native` marking which tier that is.

**✅ AND THE DEFAULT WAS FIXED AT B588**, because B587 shipped an honest picker with a degraded FHD default, which Daniel rightly called the opposite of the goal. Broadcasting defaults to the display's resolution; recording/NDI/Syphon default to the source's. A hand-picked tier outranks it for the session.

### ✅ FIXED B580 — `reinitGL()` re-uploaded through `setSource`, which retires the planar provider

**Root cause found by reading, no device time.** A GL context restore called `this.setSource(sourceImage)` to re-upload; `setSource` drops the planar provider by design (a new source must not feed on the old decode's planes), so **every context recovery silently deleted the planar path** and dropped the engine onto the 1280 RGB preview canvas. Attaching a 4K external display drops every GL context in the app (B382 cluster), so **the broadcast start caused the loss and the recovery caused the damage.** Now preserved and restored around the re-upload, plus `⚠ GL CONTEXT RESTORED ×N` and `⚠ NOT ON THE PLANAR PATH` in the source note so neither is ever silent again. Detail in CHANGELOG B580.

**▶ STILL OPEN under this heading:** the context loss ITSELF. B580 fixes the damage, not the cause. See the FHD→4K item below and the B382 cluster.

### [FIXED B580, kept for the evidence] THE ENGINE FALLS OFF THE PLANAR PATH (Daniel, B579)

**Three triggers, all named by Daniel in one session:**
1. load a 4K source into **motion**, then switch to **perform** → source and stage panels go dark/gray
2. reopening within the same session → corrected
3. **starting the broadcast** → they go dark again

**The report signature is unambiguous and identical every time:**

```
source: 1280×720 · "from canvas · native decode"   (no `planar`)   refresh 0ms   upload 3-4ms
```

`1280` is `PREVIEW_CAP`. **The engine has been knocked off the planar provider onto `native-video.js`'s RGB preview canvas**, which is the cross-context readback B518/B541 deleted. `refresh` going free while `upload` becomes the cost is the fingerprint of exactly that swap.

**This is the same state as the B574 take-failure report**, which we filed as possibly a filmstrip bug. Three reproducible triggers beats that theory: **it is source ATTACH, and a broadcast start is enough on its own.**

**It now blocks clean 4K measurement** — every B579 report has the app rendering a 0.92MP texture instead of 8.29MP, so no app-side number in that session is a 4K number. **Instrument maintenance under the three-bucket rule, with a declared budget: one build.**

- **▶ FIRST READ, and it is Class 1:** who calls `setPlanarSource(null)` or re-`setSource`s the main engine on broadcast start and on a mode switch. Candidates already known: `source-host.js:620/730` (teardown), `motion-runtime.js:715/1158-1178`, `perform-runtime.js:201-203`.
- **▶ SECOND, and this one is subtle:** `receiver.planeReader()` mints a FRESH cursor per call (each engine gets its own), but `native-video.js` exposes **`planeProvider` as a single shared instance created once**. The main engine uses the shared one while the PiP and bus engines each call `planeReader()`. **If two consumers share `planeProvider`, they race for frames and one starves.** Starting a broadcast adds a consumer, which is exactly when this fires.
- **Cross-ref** the FHD→4K context-loss item below and the take-failure item; all three now point at attach.

### [SUPERSEDED by the GPU-process finding above] SWITCHING FHD → 4K SOURCE MID-SESSION CAUSES GL CONTEXT LOSS (Daniel, B579)

Loading an **FHD clip first and then switching to a 4K source** produced a graphics-context-loss error. **Loading the same 4K clip first in a fresh session works fine.** Reproduced deliberately, out of curiosity, which makes it the most controlled observation we have on the 4K cluster.

**This is very likely the same bug as the intermittent "4K clip loads but will not play"**, seen from a angle we can actually act on: it is a SOURCE SWITCH problem, not a cold-start problem (B573's cold-start theory was already falsified at B574). Retaining an FHD-sized texture/planar allocation and then being handed 8.29MP is exactly the shape that OOMs a GL context on a tile-based GPU.

- **▶ First read:** the teardown/reallocation path on source switch. `setPlanarSource(null)` disposes the uploader, but the ELEMENT texture stays allocated alongside (by design, engine/index.js), and there are three engines holding sources (preview, PiP, bus) plus the external view's own.
- **Cross-ref** the scrubber-jitter item below and the mode-switch-during-attach theory. All three are now source-attach, not decode.

### 🎙️ THE MIC THREAD — CLOSED B567. raw + trim.

Daniel ran all three modes: **raw is best, balanced beats voice, and raw + a large trim is "genuinely pretty decent quality" on iPad.** `raw` stays the default everywhere; the gain slider is the answer where the input is quiet; the trim persists in localStorage.

**A platform limit worth recording: WebKit's `getSettings()` reports only `echoCancellation`.** `noiseSuppression` and `autoGainControl` are absent entirely, not `false` — so **on iOS we cannot verify two of the three constraints we set.** The one it does report tracks level exactly (`echoCancellation: true` with `micRawPeak 0.391`, vs 0.00249 off), confirming that echo cancellation selects the voice-processing path and its gain. That noise suppression is the garble remains a well-supported inference, not a measurement.

- **[MED] The phone chrome has no mode or gain control.** Its raw path measures healthy so the default is right, but there is no escape hatch if a phone ever needs one.
- **[LOW] Two mic paths still acquire separately** (meter + take), which is why the trim is a handoff rather than one value. **Cross-ref the HIGH bug where opening the panel pauses playback** — these are the same acquisition, and fixing that one probably subsumes this.

### 🎙️ [HISTORICAL] both ends measured, `balanced` was the open test (B566)

| mode | `micRawPeak` | Daniel's verdict |
| --- | --- | --- |
| raw | 0.00249 (~-52dBFS) | clean, unusably quiet |
| voice | 0.83231 | good levels, "garbled… terrible" |

**A 334x jump confirms the voice-processing unit supplies essentially all of the iPad's input gain**, and brings back the artifact B558 removed from the iPhone. He would take the quiet one.

- **▶ THE OPEN TEST: does `balanced` (echo cancellation ON, noise suppression OFF, AGC ON) keep the gain without the garble?** Hypothesis: echo cancellation selects the voice-processing path, noise suppression is what garbles, AGC is what pumps. **Read `trackState.applied` in the report** — if `noiseSuppression` comes back `true` under `balanced`, iOS does not honour the flags individually and the path is all-or-nothing.
- **If it IS all-or-nothing**, the honest options narrow to: ship `raw` + our own gain (accepting the noise floor, which at -52dBFS is poor), ship `voice` and accept processed audio, or **stop pretending the iPad's built-in mic is a recording input and recommend an external one** — a legitimate capability statement per the arc's goal #1, and one a VJ would find unsurprising.
- **[MED] The phone chrome has no mode control.** Its raw path measures healthy so the default is right, but there is no escape hatch.

### 🎙️ [HISTORICAL] THE iPAD MIC — DIAGNOSED B564. Raw path is ~50dB down.

**`micRawPeak 0.00249` while talking loudly (about -52dBFS)** on an iPad that does FaceTime and Zoom fine. On iOS the B558 constraints switch the input away from the **voice-processing audio unit**, which on iPad supplies most of the input gain. **The gain stage was aimed at a symptom** — 32x on -52dBFS amplifies the noise floor and burns most of the bit depth, which is why a 32x take sounded "fairly normal" rather than good.

Shipped B564: a **`voice processing` toggle** on the mic row (off by default — the iPhone raw path is healthy at `peak` 2.82, so this cannot be a device rule; probe, never classify per CAPABILITIES §1), re-acquiring the meter on change, plus an advisory when the raw input is too dead to rescue. **Advisory rather than automatic on purpose** — two automatic decisions have already failed here.

- **▶ THE OPEN QUESTION FOR DANIEL: with voice processing ON, does the iPad recording sound GOOD, or does it sound processed** the way B558 set out to fix? That answer decides the default and whether we need a middle path.
- **[MED] The middle path, if needed:** the three constraints may not be all-or-nothing. Keeping `autoGainControl: true` while disabling `echoCancellation`/`noiseSuppression` might buy the level without the gating artifacts. **Untested** — worth one A/B before designing anything more.
- **[MED] The phone chrome has no toggle** (or gain control). Its raw path measures healthy, so the default is right there, but there is no escape hatch if a phone ever needs one.

### 🎚️ [HISTORICAL] B560 DID NOTHING, B561 FIRED ON ROOM TONE

**B560 failed on device and the reason is worth keeping.** It sampled a fixed 800ms window starting when the mic tap opened — which is *the instant the take starts*, reliably the one moment the user is not talking yet. It measured room tone, fell under the signal floor, and correctly declined to guess. **The mechanism was right and the trigger was wrong: a calibration window that opens on a timer will nearly always open on silence.**

Two changes at B561: the calibration now lives in the **level meter**, which is open while the mic is armed and the shot is being set up (so it sees real speech with no time pressure) and publishes its trim to the recorder via `setMicTrimHint`; and the take's own calibration triggers **on signal rather than on time**, bounded to the first 15s, as a fallback for paths with no meter. Ceiling raised 8x → 32x — the 8x figure was a guess, and Daniel's iPad needed playback volume at maximum even after it, so the real input is far quieter than that allowed for. **The property that matters is unchanged: the gain settles once and does not move for the rest of the take.**

**A readout now shows `N× · raw peak M` under the meter.** Added because B560's failure was invisible: a silent auto-gain that guesses wrong looks exactly like one that never ran.

**Still open underneath:** whether the iPad's quietness is mic SENSITIVITY or mic SELECTION. `micRawPeak` and `trackState.label` across takes answer it. The trim compensates for the first and only papers over the second.

**[LOW] Two mic paths still acquire separately** — the meter opens its own `getUserMedia` alongside the take's, which is why the calibration constants are duplicated rather than shared. Unify when the audio path is next opened.

### 🎚️ [HISTORICAL] THE FIRST ATTEMPT — SHIPPED B560

**Built:** one-time calibrated trim (loudest 800ms at arm time, clamped 1x-8x, never ridden afterwards) into a limiter (-1.5dB, ratio 20), on both the recorder's mic tap and the level meter so the two agree. `micGain` / `micRawPeak` in the report.

**Verify on iPad:** the meter should now move meaningfully when you speak, and the take should come back at a usable level. **Then `copy report` after the take** — `micRawPeak` says what the mic actually delivered and `micGain` says what we did about it. That pair still answers the open question underneath this: whether the iPad's quietness is mic SENSITIVITY (expected: low `micRawPeak`, high `micGain`) or mic SELECTION (a far-field element being chosen), which the trim compensates for but does not fix. Compare `trackState.label` across takes — Daniel's middle take was louder with more background noise, which fits a different element rather than a different gain.

**Deliberately NOT built:** a manual input-gain control. The auto-trim should make it unnecessary for the common case, and adding a knob before knowing whether one is needed is the wrong order. If calibration ever picks a bad number in the field, that is the signal to expose it.

**[LOW] Two mic paths still acquire separately** — the meter opens its own `getUserMedia` alongside the take's. That predates this work and is why the calibration had to be written twice with shared constants rather than shared code. Worth unifying when the audio path is next opened; not worth a dedicated pass.

### 🎚️ [HISTORICAL — fixed B560] WE REMOVED THE LEVEL CONTROL AND DID NOT REPLACE IT (Daniel, B559)

B558 disabled AGC because it was audibly wrong for a recording. That was right, and it was only half the job: **AGC was also the only thing managing level anywhere in the app.** Both halves of the consequence showed up in the same test round, on two devices, in opposite directions:

- **🔴 [HIGH] iPad take audio is VERY quiet.** Daniel, B559: the meter reads "as if a master gain has been tuned way down" the moment the mic is enabled, and two of three takes came back very quiet (the middle one louder, with more background noise, which suggests a different mic element or distance rather than a different gain). The iPad's mic array is farther from the subject and less sensitive than the iPhone's; AGC used to hide that entirely.
- **🟠 [MED] iPhone `peak` is now 2.82, about 9dB over full scale.** Nothing prevents clipping any more, and the old pinned-at-1.0 readings were AGC riding rather than a well-behaved signal. It did not audibly hurt a 5-minute take, but **a loud room (a gig, a PA) is a real risk the conferencing profile was silently covering.**

**These are one problem: no gain stage.** The fix is ours to build, not to revert. Options, and Daniel's call:
1. **Limiter only** (safe, unopinionated) — catch the overs, leave quiet material quiet. Solves the iPhone half, not the iPad half.
2. **Limiter + makeup gain toward a target level** — a slow, musical AGC of our own with a much longer time constant than the browser's. Solves both, and is what a recorder is expected to do.
3. **Manual input gain with the existing meter** — most honest for a performance tool, worst for the "just hit record" case.

**Diagnose the iPad half first, it is cheap:** the take report already carries `trackState.label` (which mic) and `peak` (how hot). Daniel's iPad report had `audio: null` because it was captured during a broadcast rather than after a take. One `copy report` after an iPad take names the device and the level, and would say whether this is mic SELECTION or mic SENSITIVITY before anything is built.
- **[MED] The audio flush IS the finalize wait.** 22.6s on the 5:06 4K take, of which `flushing audio` is 22.2s. Video is drained continuously because `publish` drops frames above a queue depth of 4; audio has no equivalent valve. Options: a shallower audio queue with backpressure during the take, a larger worklet batch, or accepting the wait now that it is honestly reported. **Do not touch this while the drift item is watched** — changing the audio queue depth would move the very thing under observation.
- **[LOW] The finalize percentage goes BACKWARDS for the first second or two** (Daniel, B559: "jumped back and forth between 1-2%"), then counts forward correctly to 100%. The denominator is `encodeQueueSize`, which is still growing while the first flush frames are submitted. Clamp the reported fraction to monotonic.
- **[MED] The audio flush IS the finalize wait — so it is the thing to optimise.** 32.7s of a 33.1s finish. Video is drained continuously because `publish` drops frames above a queue depth of 4; audio has no equivalent valve and absorbs the whole backlog until the end. Options worth weighing: a shallower audio queue with backpressure during the take, a larger worklet batch, or accepting the wait now that it is honestly reported.
