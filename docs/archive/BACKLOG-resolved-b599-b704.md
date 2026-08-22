# backlog — resolved items, B599-B704

> **📦 ARCHIVED 2026-08-21 at B704.** Items lifted out of `BACKLOG.md` because they are **closed with
> no open tail** — shipped, root-caused and fixed, answered, withdrawn, or superseded by a later
> block in the same file. `BACKLOG.md` is what you read to find open work; carrying 322 lines of
> settled investigation in it makes that harder, and CHANGELOG already holds the build-by-build
> record.
>
> **Nothing here is a to-do.** They are kept because several carry *reasoning that cost builds to
> produce* — the radial-pan sequence alone took four. Where a finding still constrains future work,
> it was moved into the code or into a live doc before this file was written:
>
> | reasoning | now enforced at |
> |---|---|
> | Radial pan: the gain is derivable, the ceiling is shared and is a float32 fact | `src/engine/forms/index.js`, in the code that enforces it |
> | The two-chrome divergence rule (*a function injected into shared code must take everything it needs as arguments*) | `CLAUDE.md` |
> | The duplicate-key class | `tools/check-dupe-keys.mjs` + `npm run check`, item 5 of the CLAUDE.md ritual |
> | The loop hold, all eight closed hypotheses | `BROADCAST-DELIVERY.md` §6a |
> | Recentre must be canonicalised in STATE to be easeable | `src/engine/forms/index.js` `normalizePanLock` |
>
> **Predecessor:** `BACKLOG-resolved-b560-b598.md`.

---

### 🔁 [HIGH — B596] THE LOOP HOLD, WITH TWO MECHANISMS NOW MEASURED DEAD

**Symptom:** the picture holds for a few beats every time the clip loops. Reproduces on demand, predates B590, Daniel calls it "visually very disruptive."

**Dead, each by its own instrument:**
1. **A decoder stall.** B593: `maxGapMs 17`, `after1s 29`. Three sessions running, the wire is clean across the wrap.
2. **Our own trim rewind's 120ms settle window.** B595: `rewinds: 0, suppressed: 0`. The boundary test never fires on a full-range trim — the last frame's pts falls 0.037s short of a 0.03s window.

**✅ ROOT CAUSE FOUND AT B599, natively: AVFoundation's item swap.** `swapGapMs 141`, `maxSwapGapMs 150`, `swapFromPts 20.4 → swapToPts 0.1159`, measured inside the plugin before anything touches the socket. **The new item's clock runs through the silence, so the content skipped equals the stall** — which is why the earlier 1.8s content gap and the 150ms hold were always the same event. All three vantage points agree: decode 141, wall 136-157, app 91-162.

**✅ NARROWED AT B600: it is the swap itself, not output priming.** Reusing the `AVPlayerItemVideoOutput` across the lap left `swapGapMs` at **150 against 150**. Reverted with the hypothesis.

**✅ AND THE MECHANISM DOES NOT MATTER (B601/B602 A/B, one sitting).** Item swap 141ms, seek-to-zero 150ms, `swapToPts` equal to the gap in both. **~150ms is what AVFoundation costs to resume delivering frames after the playhead returns to zero, by any route.** `loopBySeek` stays as a flag; it is a second road to the same floor.

**✅ AND IT IS A FIXED COST (B604).** FHD `swapGapMs` **141 / max 150**, identical to 4K's 141/150 at four times the pixels. Not decode work. The FHD run is also the cleanest isolation of the arc: app at 59.9fps, 30 new pictures/s on the display, every counter healthy, **and the hold still exactly 145ms.**

**✅ THE PULL-MODEL HYPOTHESIS IS DEAD WITHOUT A BUILD.** B601 arm B attached the output once and never moved it, and still paid 150ms. A notification cannot deliver data that does not exist, and we already poll at 60Hz. Same reasoning kills pre-attaching an output to the next queued item.

### 🗒 [ORIGINAL, B609] THE SOURCE FREEZES AFTER A GL CONTEXT RESTORE, AND THE FRAMES ARE ARRIVING FINE

**This is the B584 instrument's first firing on the branch it was built to separate, and it answers the question in one reading.** Symptom: switching motion → perform loses the source image while the broadcast keeps working.

```
from canvas · planar · native decode · 0.0 in/s
⚠ SOURCE STALLED 3.4s — socket open, offered 222, took 222, skipped 0
⚠ SOCKET REJOINED ×1 · ⚠ GL CONTEXT RESTORED ×1
```

**Per the rule recorded when that counter shipped: equal `offered`/`taken` with a frozen picture means the frames reached us and we failed to use them. Our bug, JS side.** Not contention, not the wire, not the fan-out backpressure — all three are exonerated by `skipped: 0` and the equal counts.

**Leading mechanism, and it is Class 1 (readable, no device time): the planar source's plane textures do not survive `reinitGL`.** A GL context was restored in the same window. B580 made the planar path come back at full resolution after a restore, but that is a different question from whether `setPlanarSource` re-establishes the plane textures the receiver is still feeding. The receiver keeps taking frames off the socket and has nowhere to put them.

**Start here in `PLAN-LIVE-READINESS.md` item 2** — it is the cheapest entry point into the whole GPU-process cluster, and it may share a root cause with the bake failure directly above (a GL context loss preceded that failure too).

**Cross-ref:** this is very likely the same defect as the long-standing "source panel lost its image after a bake → perform switch", now with a root-cause branch rather than a symptom.

### ✅ [ROOT-CAUSED + FIXED B623] THE DROSTE INFINITE-ZOOM LOOP — was `LEAD_CAP.drosteZoomPhase = 4`

**FIXED at B623 by dropping the cap to 1.** Verified over 300 seeded trials of `drift.js` → `follow.js` (0/300 blow-ups at cap 1; 134/300 at cap 2, 3 and 4). **BOOST is only an amplifier** and stays. Full evidence table in CHANGELOG B623.

**⚠️ THE UNDERLYING DEFECT IS STILL OPEN and this only bounds it.** Under a continuously moving cyclic target, `setTarget`'s accumulation loses whole periods — traced with `state = -1.004` while `tgt = -2.004`. Cap 1 keeps the resulting error too small to self-sustain; it does not stop the period loss. **Anyone raising `LEAD_CAP` again must re-run the sweep first**, and the real fix is to make the cyclic accumulation period-exact so a vigorous multi-loop pinch can be honoured again (its loss is the cost of this fix).

**▶ THE METHOD LESSON, because it cost three builds:** B619 simulated the follower with state held CONSTANT after a finger lift, found it settles, and declared runaway disproven. That was right about its own experiment and wrong about the phenomenon — **the instability requires a target that keeps MOVING**, which the test never supplied. *A stability test must reproduce the forcing, not just the initial condition.* Daniel's autoplay repro is what supplied it.

**⚠️ AND THE PAN-UNLOCK CORRELATION WAS A RED HERRING.** B619 recorded it as a necessary condition across every open occurrence. Daniel then found the loop in autoplay with pan apparently locked. The correlation was real in the reports and not causal — **pan-unlock and autoplay are both just ways to keep the target moving.**

### 🗒 [SUPERSEDED B623 — kept for the eliminations, which are still valid] earlier droste-loop investigation

**Daniel's B619 repro, which is cleaner than B611's and should be the one used from here:** unlock droste pan → pan to any corner of the image → **quickly** pinch zoom out **from the corner**. Staged behaves as expected. **Live starts looping an infinite follow.** Panning back to centre and zooming in recentres live but neither stops the loop nor reverses its direction. **`reset canvas` is the only recovery.**

**⛔ DISPROVEN — the follower is not running away.** `follow.js` was simulated directly (it is pure, so this cost no device time and no build): response 0.35 / 1 / 2 / 4s × pinch deltas of 0.5 / 2 / 4 / 8 / 20 loops, injected over 10 frames then held constant. **Residual motion 8 seconds after the lift is zero in every cell.** The `LEAD_CAP` re-anchoring and the `BOOST` catch-up do not produce a limit cycle. **Do not re-propose this hypothesis.**

**⛔ RULED OUT — autoplay drift.** `drift.tick` is gated behind `autoOn` in both chromes ([perform-runtime.js](../src/shell/perform-runtime.js), [mobile/chrome.js](../src/mobile/chrome.js)) and Daniel confirmed the loop happens with autoplay off. Note for whoever looks next: drift's `drosteZoomPhase` branch is a **constant-velocity walker** that writes `state[k]` every frame with no settle, so it matches the symptom exactly *if* it ever ticks unexpectedly. Worth one check that `autoOn` cannot be true while the button reads off.

**✅ THE STRONGEST EVIDENCE WE HAVE IS A NECESSARY CONDITION: UNLOCKING PAN. Daniel raised it at B619 and the record confirms it exactly.**

| occurrence | pan unlocked? | status |
|---|---|---|
| B609/B610 iPad perform loop | **no** — cause was a stray touch flooring `startDist` | **FIXED B610** (40px floor + non-finite guard) |
| B611 "navigate to droste, then unlock pan, canvas zooms way in" | **yes, explicitly** | open |
| B612 "live view caught flailing on a loop" | **yes** (same droste pan thread) | open |
| B619 "unlock droste pan → corner → fast pinch out" | **yes, explicitly** | open |

**Every UNFIXED occurrence required unlocking pan. The single occurrence that did not is the one already cured.** That is a real discriminator, not a coincidence, and it should drive the investigation.

**▶ WHAT IT NARROWS TO:** `canPan` gates the entire pan block in `onMove` ([output-gestures.js](../src/components/output-gestures.js)). With droste pan locked, that block never runs and **`canvasOffsetX/Y` is never written by a gesture at all.** So the culprit is on the `canPan` path, and in droste `canvasOffset` is the **log-polar centre** — the field B612 already root-caused as the "superzoom" driver when read raw. **Instrument `canvasOffsetX/Y` first; `drosteZoomPhase` is now the secondary suspect, not the primary.**

**⛔ RULED OUT — flick-to-drift. Daniel confirmed drift mode was OFF** in his B619 repro, and `onEnd` gates the velocity handoff behind `pd?.on?.()`. Dead.

**⛔ RULED OUT — joystick handle feedback.** `syncAll` only calls `layout()`, which moves the position DOT. State never deflects the handle, so a large `canvasOffset` cannot start a drift.

**⚠️ WHAT REMAINS IS A CONTRADICTION, AND IT IS THE MOST USEFUL THING IN THIS ENTRY.** With autoplay off, drift mode off, and no fingers on the glass, an exhaustive grep for writers of `canvasOffsetX/Y` and `drosteZoomPhase` finds **only** the pan-joystick tick (needs `hx||hy`), `drift.js` (needs `autoOn`), the input bus (needs a mapping or remote gesture), and the gesture handlers (need fingers). **None of them can run.** And `follow.js` provably settles against constant state — re-simulated at B619 over a 65-second horizon measuring the residual RATE rather than a displacement threshold, which is the right noun for a log-polar field where any nonzero rate is visible zoom; the tail reaches zero by 30s in every cell tested.

**So either a writer exists that static reading has missed, or the moving quantity is not one of the two we assumed.** Further reading will not settle it. **Instrument.**

**▶ FOUND WHILE INVESTIGATING — a real defect regardless of whether it is this bug.** `mountDrosteOffsetControl()` ([mobile/chrome.js](../src/mobile/chrome.js), and the desktop equivalent) creates a **SECOND `createPanJoystick` instance** driving `drosteOffsetX/Y`, with its own `driftMode`, its own `hx/hy`, and its own tick loop. **`env.panDrift` is assigned only the canvas-pan instance**, so `output-gestures`' `onStart` "grabbing takes control → stop the drift" **cannot reach the droste one**. A latched droste-offset drift keeps writing until recenter or reset, and no canvas gesture will cancel it. **Same shape as the reported bug; worth fixing on its own merits.** The fix is either to expose both instances through `env.panDrift` (make it a list) or to have the joystick register itself into a drift registry the gesture layer can stop wholesale.

**▶ NEXT MOVE IS AN INSTRUMENT, NOT A FIX** (uncertainty state B; a speculative fix here is exactly what cost a build at B611 and again at B612). **Publish per frame into the exported report** — Daniel does not run Web Inspector — **`canvasOffsetX/Y`** and **`drosteZoomPhase`**, plus whether `panDrift` is running. These are the conserved quantities actually being rendered, not activity counters, and **which one is moving decides the question in a single reading.**

**🛡 MITIGATION AVAILABLE TONIGHT, NO CODE: do not unlock pan on droste.** Droste already ships `panLockedByDefault: true`, so the safe configuration is the default one and the guardrail costs nothing. **Given that pan-unlock is a necessary condition across every open occurrence, this is a complete mitigation, not a partial one.** If a hard guardrail is later wanted in code, the honest options are to keep droste's pan lock non-overridable in perform mode, or to bound `canvasOffset` in STATE for centre-shift forms (not at the uniform — see B611's correction).

### 🔬 [AUDIT RESULT — B627] THE TWO-CHROME DIVERGENCE AUDIT: one real defect, one live trap, and a lot of correct absences

**Ran after the seventh instance. The headline is better than expected, and the one remaining risk is specific.**

**METHOD** (repeat this when the surface changes): diff the `env` keys each chrome assigns; diff the module import sets; for every shared component, diff which `ctx` keys each chrome supplies; and compare CALL ARITY for every function exported by a shared module against both chromes' call sites. The last check is the one that finds signature traps, and it is the one that would have caught B627 before a device session.

**✅ THE INJECTION SURFACE IS HEALTHIER THAN THE BUG SUGGESTED.** Every `ctx` key mobile omits was checked individually and every one is a CORRECT absence:
- `editLocked` — desktop's is `isMotionDriven`, and **mobile has no motion timeline** (`env.motionRT` is desktop-only). Nothing to lock against.
- `onCommitStart` / `onCommitEnd` — mobile documents *"mobile undo/redo is out of scope: no pushHistory / updateUndoUI."* Deliberate.
- `getPaintSource` / `getSourceVideo` — mobile paints through `getLiveVideo` with `fit: 'cover'`.
- `env.setSegments` / `segmentsRange` / `segmentsValue` — **the input bus is DESKTOP-ONLY** (`createInputBus` is called once, in `main.js`), so there is no mobile consumer. Worth remembering before assuming a mapping feature reaches the phone.

**⚠️ THE LIVE TRAP, AND IT IS THE ROOT OF B627: `main.js` DEFINES LOCAL WRAPPERS THAT SHADOW THE KIT EXPORTS BY NAME.**

```js
// main.js — imports the kit functions under aliases, then shadows their names:
function snapSpiralValue(v) { return kitSnapSpiral(state, v); }   // kit is (state, v)
function applyArmsSnap()    { kitApplyArmsSnap(state); }          // kit is (state)
```

**So the same identifier means a one-arg function in `main.js` and a two-arg function everywhere else.** Both chromes are internally consistent today, which is exactly why this survives review — it only breaks when a SHARED module receives one of them by injection and picks a signature, which is precisely what `resetSliceState` did.

`env.applyArmsSnap` (the local wrapper) is exported onto `env` and called zero-arg from `shell/overlay.js:1305`. **Verified desktop-only, so it is safe today** — but it is safe by accident of module reachability, not by design.

**The shared component gets it RIGHT and is the model to copy:** `components/source-overlay.js:70` does `snapDrosteSpiral: (v) => snapSpiralValue(view.state, v)` — imports the kit function, passes state explicitly, no wrapper.

**✅ FIXED B628** — renamed `snapSpiralLocal` / `applyArmsSnapLocal`, and `resetSliceState` is now handed `kitApplyArmsSnap` directly. The shadowing class is gone from `main.js`.

**▶ THE STANDING RULE THIS EARNED HAS MOVED (B628, Daniel's call).** *A function injected into shared code must take everything it needs as arguments* is a working-process change, not a planned feature, so it now lives in **`CLAUDE.md`** and **`ARCHITECTURE.md`** rather than here. **The audit METHOD above stays** — that is a procedure to re-run, which is backlog-shaped.

### ✅ [SHIPPED B629] A MODIFIER / SHIFT LAYER — kept for the reasoning

### ✅ [SHIPPED B635] THE SEMANTIC FLIP — the reflection becomes the form you are holding

Shipped as `sliceMirrorX/Y` + `foldSliceIntoSource`. Details in CHANGELOG v0.25.45. Two notes worth keeping, both corrections to what this entry predicted:

- **The "it may be free for symmetric forms" hope was wrong to build on.** Most forms' folds ARE mirror-symmetric, but the flip is not about the fold's symmetry — it is about the SOURCE-UV offset, which reflects for every form regardless. The flag was needed everywhere.
- **The trigger is not "entirely outside".** That reads well and produces a large teleport; the shipped trigger is the 25% overlap threshold measured against the VISIBLE source, which is Daniel's own number from B631.

### 🎞 [Daniel, 2026-08-19 — REPORTED, NOT DIAGNOSED] THE SOURCE PANEL'S FIRST FRAME IS NOT THE CLIP'S FIRST FRAME

*"Regression: initial frame on source panel isn't actually the first frame on load."*

**Not investigated, and deliberately not guessed at.** `source-host.js` and `engine/` are **untouched this session** (last commits B659 and earlier), so nothing in the pressure-testing arc is an obvious cause — which makes it more likely to be either older than it looks or a second-order effect of something else. **A wrong guess here would send the next session at the wrong file.**

**What the fix path already looks like:** loading parks a clip paused (B595), and painting the first frame relies on the nudge at `source-host.js:184` — `await dv.play(); await nextFrame(); dv.pause();` — plus the native decode's `seekSettled(0)` hand-off at ~line 1318. **A frame that is close-but-not-first points at the seek settling late; a black or stale frame points at the nudge not landing.** Those are different bugs.

**✅ ANSWERED 2026-08-19: a later frame of the same clip** — *"source frame was from toward the end of the clip actually, but the issue didn't repro and it loaded correctly."*

**That points at the SEEK settling late, not at the first-frame nudge failing.** The suspect is the native-decode hand-off (`source-host.js` ~1318): `seekSettled(0)` is awaited, but the panel may paint before it lands, leaving whatever frame the decoder had. **Intermittent and currently unreproducible — do not chase it blind.** Recorded so the next occurrence starts from the right file instead of the wrong one.

**Class 1 and desktop-reproducible either way — do not spend a device session on it.**

### 🚧 [Daniel, B667 — REPORTED, NOT DIAGNOSED] "RESET SESSION (BREAK GLASS)" NO LONGER WORKS

*"Under our diagnostics I tried the 'reset session (break glass)' control and it doesn't seem to be working anymore."*

Reported after a GL-context loss in perform mode.

**✅ ANSWERED AND FIXED B683 — it was neither of the two candidates.** It rebuilt `main.js`'s PREVIEW engine and nothing else, while **perform mode's visible surface is the live PiP's context** and the output/bus engine is a third. So it was broken specifically in the state Daniel was in, for a reason that had nothing to do with the context loss itself. It now walks `allEngines()` and reports which surfaces recovered.

**⚠️ STILL OPEN: the phone chrome has no break-glass control at all.** `resetSession` is defined only in `main.js`. Adding one to `mobile/chrome.js` is a UI addition (needs a Lab entry), not a bug fix, so it was filed rather than folded into B683.

**Class 1 first:** read the handler and check what it does with a lost/restored context before spending any device time.

### ✅ [B668 — CLOSED B683] THE RECORD BUS IS INVISIBLE TO THE FRAME-COST LEDGER

The `bus` surface registers and reports `calls: 0, msPerFrame: 0` with the note `capture: async`. Meanwhile recording measurably costs the app **~25ms per frame** — 59fps down to 23.5fps with nothing else running. **The single most expensive thing in a recording session does not appear in the panel built to say what things cost.**

This is why "the take is slow" read as a priority problem for three builds: the cost was real and unattributable, so it looked like starvation. **Class 1 — no device needed to find out why an async capture path reports nothing.**

**✅ ANSWERED B683, and the counter was never broken.** The surface measured **render** and **readback**; a take's cost is in **`sink.publish(f)`** (VideoFrame construction + encode submission), which was timed into `diag.ops` — a ring the frame-cost panel does not show. Publish is now a ledger pass. **And the zero itself was honest:** with a still source the idle elision skips render and readback entirely, so `calls: 0` was true; the note now says so rather than leaving a true zero and a broken counter indistinguishable.

### ✅ [SHIPPED B665] SCENARIO RUNNER — the app performs the device test

Daniel's ask, and the answer to him being the sole chokepoint on device work: *"I build the latest on device, open an agreed upon source, click 'run test', come back, copy and paste the results."* Shipped as `run scenario` in the frame-cost panel (`shell/scenario-runner.js`), exported as `scenarioRun`.

**Still open, and worth doing when a script needs it:**
- **Scripts are hardcoded in the module.** Fine while there are three; a fourth kind of test (source switching, form sweeps) may want them to be data the panel can compose.
- **No scripted INTERACTION step.** T6 wants "drag the canvas for 30s" as a step so the interaction cost can be measured on a script rather than by hand — which is the one thing T2 proved matters most. **This is the highest-value next addition.**
- **✅ Pre-flight shipped B666** (source loaded / ready / has duration). **Still unchecked: whether a display is actually attached**, because a non-display destination is legitimate and the run should not second-guess the rig.
- **⚠️ `loopStall.why` still reads `"no loop boundary reached yet"` while reporting wraps in the same object** — four builds of reports now. Cosmetic but it is the kind of lie that costs an hour when someone trusts it.

### ✅ [CLOSED B694] RADIAL PAN IS NOT ZOOM-PROPORTIONAL — kept for the reasoning, which cost four builds

*"One of the items we fixed in this phase was to ensure that panning is proportional across all zoom levels. This seems to be true for all forms except the radial wedge. At first panning seems to work fine but then if you zoom out it gets sluggish and seems to hit invisible walls, and if you zoom back in it doesn't correct. If I reset canvas it does self-correct until I zoom out again."*

**Not diagnosed. Filed with the suspicion so the investigation starts warm, and explicitly NOT fixed blind.**

**What is already ruled out by reading:** `kit/pan.js` `panDelta` is the single shared gain, divides by zoom, and is form-agnostic — **the pan math itself cannot be radial-specific.** So the asymmetry is downstream of the gain.

**The suspect, and it is the B659 neighbourhood.** Radial's wedge extent is `1 / (canvasZoom × canvasNorm)` (geometry.js:315), so canvas zoom-OUT grows the slice box without bound — this run reported `boxHalf [0.64, 0.77]`, `boxVsSource 1.548` at `sliceScale 2.06`. The fold (`foldSliceIntoSource`, via `normalizeSliceMirror`) is evaluated **on the render schedule**, so it re-runs continuously during a pan. A fold translates the box by its own span; when the span is enormous, that is an enormous jump. **A fold firing intermittently mid-pan would read exactly as "sluggish, invisible walls, does not correct on the way back", and reset-canvas clearing it fits too.**

**⚠️ The discriminator is local and free — this is a Class 1 question and must not cost a device session.** Zoom out with radial on desktop, pan, and watch whether `foldSliceIntoSource` returns non-null during the drag. If it does, the trigger is the bug; if it does not, the cause is elsewhere and the suspicion above should be discarded rather than defended.

**Do not "fix" this by reinstating a span-only fold test** — that is the trap B659's note names.

---

#### 🔬 B693 UPDATE — THE FOLD SUSPICION IS DEAD, AND THE REAL NUMBER IS MEASURED

**The Class 1 discriminator above was finally run** (`scratchpad/foldpan-check.mjs`, headless, no device). **The fold suspicion is wrong and is hereby discarded, not defended:** a canvas pan writes `canvasOffsetX/Y` and never touches `sliceCx/Cy`, so `foldSliceIntoSource` fires **zero** times across a full 40-step pan at 0.25×, 1× and 4×, and `syncSliceAnchor` re-places **zero** times. The gesture gate is a real gap — `holdGesture` is called only from `shell/overlay.js`, never from the canvas gesture — but it is not this bug.

**What the same harness DID measure** (`scratchpad/reach-check.mjs`), and it is one table:

| canvasZoom | radial's own sampled extent `R = 1/(zoom×norm)` | `offsetBound` | **reach = bound/R** |
|---|---|---|---|
| 0.25 | 4.00 | 2 | **0.50** |
| 0.5 | 2.00 | 2 | 1.00 |
| 1 | 1.00 | 2 | 2.00 |
| 2 | 0.50 | 2 | 4.00 |
| 4 | 0.25 | 2 | **8.00** |

**`reach` is the conserved quantity this investigation never measured: travel expressed in units of the thing you are looking at.** It swings **16×** across the zoom range. Zoomed out you can pan across half of what you can see; zoomed in you can pan eight times past it.

**And the gain equals the bound**, so one full-side drag always asks for **100% of the range**, at every zoom.

**Together these predict all three of Daniel's complaints from one cause, which no previous model did:**

- *"very sluggish zoomed out... barely moves off center"* → reach 0.5. The total available travel really is half the visible wedge.
- *"movement is jerky"* → the gain spends the entire range in one drag. Every pixel of finger travel moves a lot, over a range that is tiny relative to the picture.
- *"hitting invisible walls... less able to move after already moving a bit away from center"* → **this was read as progressive resistance and it is not.** The two-finger pan re-bases `manip.ox` from the CLAMPED offset at each gesture start, so every new drag begins with less remaining range than the last. Decreasing remaining travel, not increasing drag — indistinguishable from the hand, which is why three builds chased the wrong shape.

**Uncertainty state: C — the cause is known, the lever is a product decision.** Three, not mutually exclusive:

- **(A) store the offset as a FRACTION of the form's extent.** Correct and durable: bound becomes a constant ±1 in stored units so drift is impossible by construction, reach is identical at every zoom, and any future bounded form inherits it. **Cost: `canvasOffsetX/Y` changes units**, so presets, motion keyframes and control mappings need a migration.
- **(B) keep fold units, restore the zoom-scaled bound, and re-normalise the stored offset whenever zoom changes** so the FRACTION is preserved across the change. Same behaviour as A without changing what is persisted; this is exactly the `syncSliceAnchor` pattern (watch the inputs, re-solve) applied to a second quantity. **Cost: a second watcher.**
- **(C) decouple the gain from the bound** — a full-side drag should cover a fixed fraction of the range (~40%), not all of it. **Independent of A and B, and it is the half that fixes "jerky".** Cheapest of the three.

**⚠️ B688's reasoning was half right and the half that was wrong is why this persisted.** It correctly established that `u_canvasOffset` is applied after the zoom divide and is therefore zoom-independent *as a coordinate*. It wrongly concluded that its BOUND must be too. **The coordinate is zoom-independent; the CONTENT it addresses is not** — radial's wedge extent is `1/canvasZoom` by its own `buildPolygon`. A fixed bound over a content extent that swings 16× cannot feel the same at both ends.

### ✅ [DECIDED + SHIPPED B696] A LINTER, FOR `no-dupe-keys` AND NOTHING ELSE — kept for the reasoning

**Not a style question. It is about one bug class that has cost two builds and is invisible in review.**

```js
getDeviceId: () => deviceId,   // B684 added this
getDeviceId: () => null,       // ...20 lines below, pre-existing, and it WINS
```

**A JS object literal silently takes the LAST duplicate key.** No syntax error, no warning, no runtime complaint. B686 found two of these in `native-camera.js`: one disabled every camera UI gate (so B685's correct structural fix had zero effect), the other dropped a `resetControls()` call. An AST scan (`scratchpad/dupkeys.mjs`) then found zero others across 100 files, so **the codebase is currently clean** — this is about not regressing.

**The tradeoff Daniel has to weigh:**

| | for | against |
|---|---|---|
| **Add ESLint, `no-dupe-keys` only** | catches the exact class, on by default in every JS linter, one config file | CLAUDE.md says no build steps without asking; a linter tends to grow rules and become a thing to argue with |
| **Keep the AST scan as a scratchpad script** | zero project surface, already written and passing | only runs when someone remembers to run it, which is the failure mode it exists to prevent |
| **Nothing** | honest about how rare it is (2 instances, both fixed, 0 remaining) | the two that existed were found by a device session and a live show, not by review |

**✅ B696 SHIPPED THE MIDDLE OPTION, PROMOTED.** `tools/check-dupe-keys.mjs` in `npm run check`, and `check` is now item 5 of CLAUDE.md's ritual. No dependency (`acorn` rides Vite's rollup), no config. Original recommendation kept below.

**Recommendation if asked: the middle option promoted** — keep it dependency-free, but make the AST scan something the four-part maintenance ritual runs rather than something to remember. It buys the one guarantee without opening the door to a lint config.

### ❌ [WITHDRAWN B702 — THE INSTRUMENT WAS WRONG, NOT THE APP] ~~THE SOURCE STALLS AFTER A SUCCESSFUL BAKE~~

**⚠️ WITHDRAWN. Daniel: *"in the app the source panel is rendering and the diagnostic reads planar source so the issue didn't seem to persist."* The picture was FINE.**

**The bug was in the note.** `sourceStallNote` keys on `msSinceFrame`, which equals "the decode is wedged" only if the clip is supposed to be producing frames — and **a freshly baked clip parks PAUSED by design (B595)**. No frames is the correct behaviour there, and the instrument called it a stall.

**And I compounded it by skipping a precondition.** B584's rule is *"equal offered/taken WITH A FROZEN PICTURE means the frames reached us and we failed to use them."* I applied the conclusion without establishing the frozen picture. Daniel supplied it and it falsified the reading. **The wrong-noun test, failing inside the report itself.**

**✅ FIXED B702:** the note returns early when the source is paused. Unfixed, this would have aimed every future post-bake session at a bug that does not exist.

**The original write-up is kept below because the B609 item it pointed at is still open and the narrowed suspect in it is still worth reading.** What is NOT established is that it reproduces after a bake.

~~This is the B609 item caught fresh.~~ From `docs/temp/loopBuilderSuccess-report.json`, taken right after a bake that SUCCEEDED:

```
source: from canvas · planar · native decode · 0.0 in/s
        ⚠ SOURCE STALLED 35.1s — socket open, offered 157, took 157, skipped 0

sessions.live: [ gl preview engine, decode "baked clip", decode "native decode: loop.mp4" ]
```

**The B584 instrument has fired on the branch it was built to separate, for the second time.** `offered 157, taken 157, skipped 0` with a frozen picture means **the frames reached us and we failed to use them.** Not contention, not the wire, not backpressure — all three are exonerated by the equal counts. **Our bug, JS side.**

**⚠️ AND THIS RUN HAD NO GL CONTEXT LOSS**, which is new information: B609 assumed the restore was part of the mechanism. Here the source swaps to the freshly baked `loop.mp4`, a new native decode starts and delivers frames, and nothing consumes them. **So the trigger is the post-bake SOURCE SWAP, not a context restore.** That makes it far cheaper to reproduce.

**The narrowed question from B698's read of `engine/index.js`** stands and is now the prime suspect: `updateSourceFrame()` opens with `if (!sourceTexture || !sourceImage) return false;`, and the planar branch sits behind that guard. **Those are element-path concepts.** A native decode feeding raw planes into a freshly swapped source may satisfy `planarFrame` while `sourceImage`/`sourceTexture` are not yet re-established — and the receiver keeps taking frames off the socket with nowhere to put them, which is precisely `offered == taken` with `0.0 in/s`.

**▶ NEXT, and it is Class 1 (readable, no device):** trace the post-bake swap in `clip-editor.js` `rebindClipToTimeline` and the `setSource` / `setPlanarSource` ordering against that guard. **`setSource` retires the planar provider by design**, so if `setPlanarSource` is called BEFORE `setSource` on this path, the provider is destroyed immediately after being installed.

### ✅ [CLOSED 2026-08-21 — VERIFIED ON DEVICE] THE DROSTE-CENTRE JOYSTICK

**Daniel smoke-tested droste and radial after B697: joystick, manual pan and drag all move in the expected directions.** The droste instance was already correct, so no flag was needed. Reasoning kept below.

### 🕹 [B697 — SIBLING OF A FIXED BUG, NOT VERIFIED] THE DROSTE-CENTRE JOYSTICK LIKELY HAS THE SAME ROTATION BUG

B697 fixed the TILING-PAN joystick: it wrote the raw handle vector into `canvasOffset`, which the shader consumes in POST-rotation space. **`drosteOffsetX/Y` is consumed in the same post-rotation space** (the Möbius pre-composition runs inside `foldDroste`, which receives an already-rotated `p`), so the same joystick component driving it almost certainly has the same defect.

**Not changed blind, for a specific reason:** that offset has a SECOND consumer, the overlay diamond drag, which does its own mirror un-folding (B635). Rotating the joystick without checking whether the diamond agrees would trade a known bug for a disagreement between two controls on one value.

**The fix if confirmed is one word** — pass `rotates: true` at both instantiation sites (`main.js` droste offset joystick, `mobile/chrome.js` line ~872). **The check first:** rotate the canvas 90°, drag the diamond, and see whether the pole moves the way the hand does. If the diamond is already correct, the joystick just needs the flag; if the diamond is also wrong, they should be fixed together.

### 🔴 [Daniel, B694 — DIAGNOSED BY READING, NOT FIXED] RECENTER DOES NOT EASE IN PERFORM MODE

*"return center should honor the transition speed in perform mode, but right now it appears to be instant."*

**Two paths, and only one of them is broken. Establish which one he used before building anything.**

- **`recenter` (pan joystick)** writes `canvasOffsetX/Y = 0` to state. Both are in `CONTINUOUS_KEYS` and `perform-runtime.js:524` feeds `setTarget(state)` every frame, so this **should already ease**. If it does not, the model above is wrong and that is itself the finding.
- **`reset canvas`** also sets `panLock = {}`, which re-locks radial (`panLockedByDefault: true`), and `shader-builder.js`'s `u_canvasOffset` opens with `if (formPanLocked(state)) return [0,0]`. **Instant by construction** — the follower can be easing perfectly and the uniform will ignore it.

**Same class as the B611/B612 note in `controls.js`** (*"a bound that is not in STATE is not a bound"*): a recentre that is not in STATE cannot be eased.

**Candidate fix, not yet validated:** drop the uniform's override and have the LOCK write `0` to state instead — both padlock paths already do exactly that at `main.js:1295`, so the state is already correct there. **⚠️ Check B612 before shipping it:** unlocking must never inherit a position, and the override is currently what guarantees that for paths which set `panLock` without going through the toggle.

### ✅ [SHIPPED B637] MOTION MODE LOCKS SLICE HANDEDNESS TO KEYFRAME 0

Fixed by `alignSliceFrame` — keyframes are re-expressed in kf0's fold frame at the read points. Details in CHANGELOG v0.25.47. **The prediction in this entry was right about the difficulty and wrong about the conclusion:** recovering *which* reflection a keyframe came through is indeed impossible from the ±1 flag, but it turned out not to be needed — choosing the representative nearest kf0's sampled box gives both a correct picture and the shortest tween travel.

### 🎛 [B621, Daniel's open question] CAN ONE BUTTON MEAN DIFFERENT THINGS ON DIFFERENT FORMS? — ✅ ANSWERED + SHIPPED B624

**Yes, and it now works properly.** There was never a routing blocker (two rows could always share a signal) but there WAS a silent bug: the inactive form's parameter was being written anyway. B624 gates on the form's own `controls` array and dims the declining row. Detail in CHANGELOG B624. **The legibility caution below still stands and is now partly addressed by the dimming.**

His framing: *"e.g. dpad arrows could control droste thickness on droste form and segments on radial wedge. that's a bad e.g. bc we'd want segment controls mapping to both, but you understand the Q?"*

**Two mechanisms, and choosing between them per control is the actual design work.**

**1. SEMANTIC ROLES — preferred wherever a meaning transfers.** Already how `segments` and `canvas zoom` work: one target, `resolve(state)` picks the per-form key and range, so the button needs no reprogramming and the operator's mental model stays "this is the segments button". **His own counter-example proves the rule** — segments *should* map to both, and it already does. **Default to this. Reach for a conditional only when the meanings genuinely do not correspond.**

**2. FORM-CONDITIONAL ROWS — needed for the genuine case** (droste thickness has no radial counterpart). The mechanism is nearly free: `onSignal` already applies EVERY row matching a signal, so two rows can share a button today — they just both fire. Adding an optional `when form is X` filter per row is a small change to `applyMapping`.

**The real cost is not code, it is legibility mid-set.** A button whose meaning depends on invisible state is how an operator loses the plot under lights. **If this ships, the mapping row must show its condition, and inactive rows must be visibly inactive** — the input panel already flashes rows on activity, so the affordance exists.

**Not scheduled.** Worth raising with Daniel as a product decision once the stage-C ownership work lands, since "which input owns this field right now" and "which row is live right now" are the same question wearing two hats.

### ✅ [FIXED B610] ONE OF TWO DROSTE RUNAWAY ROUTES WAS A STRAY TOUCH (the other was B611's, above)

**⚠️ THE ENTRY BELOW DIAGNOSED THE WRONG BUG. Daniel corrected it: he was NOT in autoplay.** Both are real; only one was his.

**The actual cause:** a pinch's scale ratio is anchored to the two fingers' **starting separation**, with no floor on it ([output-gestures.js](../src/components/output-gestures.js)). A palm, a thumb catching the glass, or a fast two-finger tap gives a `startDist` of a few pixels, so `log(dist / startDist)` hands the follower a target dozens of loops away — or a **non-finite phase, which an unwrapped accumulator never recovers from for the rest of the session.** Fits every detail of the report: no autoplay, no deliberate gesture, touch-only, sudden, and sticky once entered.

**Fixed:** separation floored at 40px (≈ the narrowest deliberate pinch), plus a `Number.isFinite` guard on the phase write. **Only droste was ever exposed** — the non-droste path is incremental and bounded by `applyUnifiedZoom`'s [0.05, 4] wall.

**Checked and cleared while hunting this:** `loopLog()` divides by `log(drosteZoom)`, which looked like an explosion risk at low thickness. It is correct by construction — a pinch of ratio R yields exactly R of visual zoom at any thickness, which is why the pinch reads accurate throughout.

**Still open, same family:** two-finger ROTATION has the same tiny-separation exposure (`atan2` on near-coincident touches is noisy). Bounded rather than unbounded, so it degrades instead of exploding, but it could ride the same floor.
