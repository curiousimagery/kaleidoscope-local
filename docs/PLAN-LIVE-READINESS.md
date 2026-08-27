# plan — live readiness

**The arc that runs from B609 forward.** Written at B609 because the arc it continues never had a plan document, and three independent reconstructions of its history (Claude Code, Daniel, and a Sonnet pass over the full session transcript) agreed on the state but had to re-derive it each time. This file exists so that stops happening.

**What this file owns:** the goal, the sequence, the dependencies between items, and the stopping rule for each one. **What it does not own:** current state (`HANDOFF.md`), open work detail (`BACKLOG.md`), how the frame pipeline works (`BROADCAST-DELIVERY.md`), or how to investigate (`DEBUGGING-PROTOCOL.md`). Where this file disagrees with a later CHANGELOG entry, the CHANGELOG wins.

**Naming:** "live readiness" in both senses. The app has to perform, and it has to be trustworthy in a live show.

---

## The goal

**Daniel, 2026-07-31:** *"On modern performant hardware we can handle working with 4K clips up to 10 mins and 4K output, and then degrade capabilities gracefully based on constraints of older or less powerful hardware."*

So 4K at 10 minutes is **the ceiling to design toward, not the floor to require**, and the degradation ladder is a first-class part of the design rather than a failure mode.

**The definition of done is the five exit criteria in `CAPABILITIES.md` §0** (Daniel, B560). They are not restated here. Read them before picking up any item. The short form: every offered option works in the context offered, every label is honest, capabilities are probed per device, the instrumentation can support optimization, and we can rank what things cost well enough to place guardrails deliberately.

**A standing note on how to break a tie (Daniel, B609).** He performs weekly and uses those shows as forcing pressure on the app rather than the other way round. **The app is the primary output; the performance is the deadline that focuses it.**

**The tiebreaker is development velocity and code quality, not learning for its own sake.** Learning is how we get there, not the goal. So the thing to refuse is not "a fix that helps tonight" — **shows genuinely should go well, on the latest build** — it is **a fix that has to be redone later.** When a short-term patch and the right change cost about the same, take the right change. When they do not, say so plainly and let Daniel weigh it, because there is always a **Plan B** (an older known-good build) that makes a deadline cheap to protect.

---

## Where we are

**Last revised 2026-08-26 at B752.** The B752 block below is authoritative; everything after it in
this section is the record of how the arc got here.

### ▶▶▶▶ STATE AT B752 — THE LADDER MOSTLY DISSOLVED, AND WHAT REPLACED IT

**Revised 2026-08-26 with Daniel, after B738-B751 and a full re-read. This block is authoritative
over everything below it in this section.** The rest of "Where we are" is kept as the record of how
the arc got here, not as a description of what is left.

**The arc was designed around a capability ladder: measure each device's limits, build a cost model,
gate combinations against it. Measurement retired most of the rungs by FIXING them.** That is a
legitimate result, and it is why this plan needed rewriting rather than continuing.

| rung the plan intended to gate on | what measurement did to it |
|---|---|
| **Bake memory** | **Dissolved.** 3188MB to 131MB (B732/B734/B735/B736/B737). `peakMB` is 72-132 on every device at every clip length, and a 3.5x larger source cost 0.7MB more. **The gate expression this plan was built on has no varying term left.** |
| **Clip duration** | **Not a limit. A FORECAST.** ~1.48x realtime on an M1 iPad pre-B747, far better since. A number to TELL someone, not a reason to refuse them. |
| **Render speed** | **Was OURS, and is fixed.** One `texImage2D` of a 2D canvas was 89% of a render (B746/B747). iPad 28 to 55.6 fps; Safari 22 to 131 fps. |
| **Thermal** | **Not a limit yet.** `nominal` across 530s and 270s fanless, twice. Still the largest single effect ever measured (40.0 to 19.8 fps at `serious`), but nothing has REACHED `serious` in this arc. |
| **Source file size** | **HYPOTHESIS DEAD.** See below. |
| **Record capability** | **UNTOUCHED SINCE B704**, and its evidence predates the B681 decoder fix. |

#### 🚫 THE SIZE HYPOTHESIS IS DEAD, AND THE REPLACEMENT AXIS IS CONCURRENCY

The same 2,629,310,897-byte file on the same M1 iPad Pro **failed three times** (B741 fetch, B742
blob passthrough, B743 render) and **succeeded twice** (B750 probe at 4ms, B751 a full 4K render at
55.6 fps in 270.2s, clean). **No size table can encode that**, and a table keyed on chip plus memory
would have said "2.63GB on M1 iPad: no" and been wrong on the day it shipped.

**What DOES differ between the two runs we have breadcrumbs for:**

| | `B750-ipadBeforeRender.json` (crashed 1/3 in) | `B751-ipadRenderReport.json` (completed) |
|---|---|---|
| `scenarioObserved` | `external-broadcast` | `idle-still` |
| `sessions.peak` | **gl: 2**, decode: 2 | **gl: 1**, decode: 3 |
| preceded by | a broadcast session | nothing, fresh launch |

**This is n=1 each, so it is a hypothesis and not a finding.** But it names an axis, and that axis
already has two entries in BACKLOG: *"record + broadcast on iPad loses the source and then the take"*
(B571) and *"arming a take while broadcasting loses the GL context"* (B667/B668). **Same family,
different pair of operations.** Daniel's own note on the successful run is the same observation from
the other side: *"I didn't spend time broadcasting or setting keyframes, which gives it a more simple
job."*

**⚠️ DO NOT BUILD THE OPFS SOURCE COPY UNTIL THE MATRIX RUNS.** If the failure is a revoked iOS
security-scoped handle, owning the bytes fixes it. If it is memory pressure at read time, it does
not. That is one device session's worth of difference against a week's worth of build.

#### THE THREE GATES — established B749, still the right frame

| gate | asks | shape | status at B752 |
|---|---|---|---|
| **1. FILE ACCESS** | can we read these bytes at all? | **binary**, 16 bytes, at load | mechanism shipped B743, moved to load B750. **It never learns a ceiling. Do not ask it to.** |
| **2. BAKE / RENDER** | will this job finish acceptably? | **not binary** — time, thermal, output storage | **became a FORECAST.** Needs SAYING, not gating. Output storage is the one unmeasured term |
| **3. RECORD** | can this device sustain the declared fps? | **not binary** — achieved vs declared, concurrency, thermal | **the real remaining work** |

#### 🎨 COLOUR IS A SHIPPED DEFECT NOW, NOT A FUTURE FEATURE

B747 removed a 2D-canvas intermediate from the render path for a 73x upload win. **That canvas was
silently doing HLG-to-SDR tone mapping and BT.2020-to-sRGB gamut conversion**, so removing it exposed
that we never owned a colour pipeline at all. `renderUploadViaCanvas` is the flagged workaround and
it costs the whole perf win.

**Reading the code at B752 found the bigger half (verify before acting, this has not been device
confirmed):** `src/engine/yuv.js` converts YUV to RGB with **hardcoded BT.601 coefficients**
(`1.402 / -0.344136 / -0.714136 / 1.772`), no transfer function, no primaries. That is the **native
decode path** — in-app playback and broadcast on iPad. Nearly all HD and 4K video is BT.709, and
neither native plugin reads `kCVImageBufferYCbCrMatrixKey`, so nothing ever told the shader what the
source was. The full-range assumption is correct (both plugins request
`kCVPixelFormatType_420YpCbCr8BiPlanarFullRange`).

**So there are three disagreeing colour paths**, which is the likely explanation for Daniel's
observation that perform-mode thumbnails looked better than the rest of the app.

**▶ THE DECISION, Daniel 2026-08-26:** do not ship a throwaway fix. Build the **input transform**
stage of real colour management — one conversion seam in the shader, driven by parsed source metadata
(`VideoFrame.colorSpace`, already recorded at B748, plus the `colr`/nclx box), defaulting to BT.709
when unknown — and route all three paths through it. **That fixes the regression, fixes the standing
BT.601 bug, and is not thrown away.** Honest limit: in an 8-bit working space it corrects hue and
saturation but will still band on HDR sources. **A float working space is the NEXT stage, not this
one**, and is what the photography and round-trip audiences actually need.


### ▶ THE ARC SINCE B704: GL LOSS CLOSED, A MEMORY CEILING OPENED AND MEASURED

**Item 2's remaining piece — *provoke GL context loss deliberately* — is effectively CLOSED.** All
five surfaces are watched with four distinguishable outcomes, loss is provokable on demand from the
frame-cost panel, and every provoked and organic loss in the arc recovered in 29-650ms. What remains
of it is a short test list (`VERIFY-QUEUE.md` A4/A6/A7: three surfaces never deliberately provoked).

**In its place a NEW and larger item was found and measured: the bake's memory ceiling.** It is not a
GL problem — it is jetsam, confirmed by the OS. Its shape:

- **Cost is a property of the JOB; the ceiling is a property of the DEVICE.** One clip, four
  machines, `peakMB` identical to 0.1MB; both Macs passed, both iPads failed, 8GB before 16GB.
- **The gate is arithmetic and every term is known before the bake starts**:
  `sourceBytes + 2 × outputBytes + ~56MB ≤ deviceFreeMB − ~250MB`.
- **Resolution is nearly free (~56MB at 4K).** The table collapses to 2-D: source bytes × output bytes.
- **Playback and broadcast are unaffected** — memory there is O(1) in file size (T10 held 1.25GB for
  50 minutes). **The asymmetry IS the ladder: broadcast 4K freely, bake within a byte budget.**

**Three builds address it, and B737 confirmed the result on desktop: `peakMB` 3188 → 2143 → 1441 →
**130.9**, at the same 33.8s bake time and with identical decode work.** B732 (shared demux),
B734/B736 (streaming muxer, byte-verified against the old target), B735/B736/B737 (streaming demux).

**⭐ The shape changed, not just the number.** Every remaining term is resolution-driven or constant,
so **nothing scales with clip length** — which is what makes a duration-based ladder unnecessary and
a byte-based gate sufficient. **Not yet device-verified.**

**⚠️ THE GATE (item C) IS THE CLOSE-OUT FOR PHASE 2 AND MUST COME LAST**, because the cost model it
enforces is exactly what these three builds change.

### ⚠️⚠️⚠️ THE EXIT CRITERION, REWRITTEN BY DANIEL 2026-08-27 — AND IT IS NOT WHAT WE HAD

**The old framing was "find the capability ceiling". We exceeded it, and that turned out to be the
wrong target.** Daniel, in his own words:

> *"What I keep pushing toward is that we need to PREVENT USERS FROM RUNNING INTO FAILURE STATES.
> Specifically: **we can document the upper limits of our end-to-end 4K workflows on an M1 8GB iPad,
> and users can't access common failure states, and degraded states warn appropriately.**"*
>
> *"'One tiny thing left' is wrong, because in our testing common actions still regularly result in
> failures. That doesn't meet a definition of done for basic quality even if we technically sometimes
> can achieve really impressive 4K feats.* **We're bound by the lower limits of reliability, not the
> upper limits of ad hoc success.**"

**▶ READ THAT LAST SENTENCE BEFORE CLAIMING ANYTHING IS CLOSED.** Every "it worked" in this arc is an
upper-limit result from a fresh launch. The exit criterion is about the floor.

**Three things this reframing immediately reclassifies as IN scope, not done:**

| | why it is in scope under the new criterion |
|---|---|
| **Degraded states that do not announce themselves** | **B760 is the clearest case:** a GL restore drops the live source to a **1280×720 preview canvas**, every take and broadcast silently becomes a sixth of the resolution, and nothing tells the operator. A performer cannot see it mid-set |
| **A bake failure raising a blocking `alert()`** | Filed since B707, measured up to **1827s**. A common action with a catastrophic, unrecoverable-looking outcome |
| **A GL loss costing the whole app session** | Contexts recover in ~474ms; source, panels and dialogs do not come back |

**And the big lift that is NOT done and was being under-counted: ON-DEVICE STORAGE ALLOCATION.**
Output storage is the one term gate 2 never measured, and B753 tripled output sizes (a 10-minute 4K
bake is now ~5.6GB). Nothing measures whether the share sheet, the Files write, or a reload survives
that, and the stage manager multiplies it by a queue. **Treat this as an item, not a footnote.**

### ▶ The item table (revised B737 — ⚠️ STALE, see the two corrections below)

Phase 2's pressure-testing arc ran B683-B704 and the memory-ceiling arc B705-B737; the per-hypothesis
record is in `BACKLOG.md`, the per-build detail in `CHANGELOG.md`, the narrative in
`archive/HANDOFF-builds-705-737.md`.

| # | item | status |
|---|---|---|
| 1 | Frame cadence / broadcast delivery | **Closed B594.** Record in `BROADCAST-DELIVERY.md` |
| 1.5 | Input normalization across modalities | **CLOSED B657** |
| 2 | The 4K source-attach cluster | **Closed B683-B704.** GL-loss provocation closed B723-B733 |
| 2.5 | **The bake's memory ceiling** | **MEASURED B727-B737, and SOLVED on desktop B737** (2143 → 131MB, O(1) in clip length). **Not device-verified** |
| 3 | NDI | Not started. One bug already diagnosed and waiting. **The governor is kept (default off) for this** |
| 4 | iPad limits, sustained load | **CLOSED B695-B698.** T7/T8/T9/T10 all complete |
| 5 | iPhone limits, honest labels | **Not reached, and now the largest evidence gap** → `HARDWARE-SUPPORT.md` |
| 6 | Thermal **AND BATTERY** | **Signal exists and is measured; NOTHING GATES ON IT.** The single biggest effect found this arc. **⚠️ REVISED 2026-08-27: thermal is only half of it.** The other half is **energy** — if the app is left open and unattended for thirty minutes, does it drain the battery? Can an iPhone customer use this out and about without becoming uncomfortable about opening it at all? That maps onto exit criterion #5 (*"a phone app that gets hot and eats the battery in ten minutes is not shippable"*), which named it and never measured it. **Guardrails like auto-idle after inactivity belong here and need evidence, not intuition** |
| **7** | **⭐ SUMMARISE THE KNOWN KNOWNS AND UNKNOWNS, THEN SHELVE** | **NEW, Daniel 2026-08-27, and it is what lets the arc pause honestly.** One document per open thread — **NDI, iPhone limits, thermal + battery** — stating what is measured, what is assumed, and what a future session would need to measure. **Not investigation; capture.** This is the seam at which the arc hands over to feature work (colour management, stage manager, tileable output, vector overlays) **without losing the state that took forty builds to build up.** Items 3, 4 and 5 below feed it rather than being completed |

### ✅ The exit criterion is met

*"A 6+ minute 4K clip broadcasts 4K over HDMI, cold start, without a GL context loss and without the app becoming unresponsive, with cost recorded at three points."*

**T10, 2026-08-21, `docs/temp/8-21-26-T10-4klooptest.json`:** a 6:39 4K clip, 50 minutes, `outcome: complete`, 6/6 steps, no context loss, power steady through an Apple dongle. Loop wraps 8 times with a worst-case gap of **6ms** (governor off). `broadcastCeiling` learned **22 fps delivered / 30 source** at 4K HDMI over 1.4M samples.

**The 20.4-second-clip gap named below is closed.** Every headline number in this plan now comes from a long clip.

### What phase 2 actually resolved

| thread | outcome |
|---|---|
| Radial pan | **Fixed B694** after three wrong attempts. Gain is derivable (`2/zoom`); the ceiling is a float32 fact, shared, not per-form |
| Pan joystick ignored canvas rotation | **Fixed B697**, both chromes. Daniel found it; it was the root of the old 45° bug |
| The governor | **Default OFF B701.** Its display-signal premise is false — the external view renders in its own process |
| Source freeze after a GL restore | **Root-caused + fixed B703.** A deadlock: the planar path was gated on element-path state |
| Reset canvas snapped the pan | **Fixed B704.** The lock was a render-time override, so it could not be eased |
| Native decode first-frame deadline | **Fixed B700.** Missed by five milliseconds; cost the planar path for a whole session |
| Session/permit accounting | **Shipped B681, proven conserved.** Peak GL 2-3, peak decode 8 |
| Instrumentation | **All five GL surfaces now report (B695).** Four of five were console-only before |

### ⚠️⚠️ WHAT CLOSES PHASE 2 — REVISED AGAIN B749, BECAUSE THE MEASUREMENTS RETIRED HALF OF IT

**The B737 revision below is now partly obsolete. It said the bake gate was "blocked only on
device-verifying B732/B734/B737". Those are verified, and what they proved was that the thing the
gate was designed to compute no longer varies.**

**THERE ARE THREE GATES, THEY MEASURE DIFFERENT QUANTITIES, AND ONLY ONE IS BINARY.**

| gate | asks | shape | status |
|---|---|---|---|
| **1. FILE ACCESS** | can we read these bytes at all? | **binary, per file, 16 bytes at load** | mechanism built (B743); needs to move to load + refuse |
| **2. BAKE / RENDER** | will this job finish acceptably? | **not binary** — time, thermal, output storage | **rationale changed, see below** |
| **3. RECORD** | can this device sustain the declared fps? | **not binary** — achieved vs declared, concurrency, thermal | **unbuilt, and its evidence is stale** |

**⭐ GATE 2 LOST ITS ORIGINAL REASON.** It was specified as a memory cost model
(`sourceBytes + 2 × outputBytes + ~56MB ≤ free`). **Measurement retired that**: `peakMB` is 72-132MB
on every device for every clip length, and a 3.5× larger source cost 0.7MB more. There is no memory
curve left to gate on. What survives is **not a refusal but a forecast**: ~1.48× realtime on an M1
iPad and ~0.23-0.31× on a Mac means a 30-minute 4K bake is ~44 minutes on an iPad — a number to TELL
someone, not a reason to stop them. Thermal held `nominal` across 530s fanless, so it is not a gate
yet either. **Output storage is the one unmeasured term** (a 10-minute 4K bake is 1.87GB).

**⭐ GATE 3 IS THE REAL REMAINING WORK, AND IT IS NOT ABOUT FILE SIZE.** A perfectly readable FHD
file can still fail a 4K take on an iPhone. Its quantity is achieved-versus-declared fps (**13.5fps
against a declared 30**, two devices, two builds), plus record-while-broadcast concurrency, plus
thermal `serious`. **None of that evidence has been re-measured in this arc** — see BACKLOG
*"RE-VERIFY RECORDING ON THE CURRENT BUILD"*. Everything since B704 has been bake and render.

**So the honest state of phase 2:** the bake side collapsed into something simple and mostly needs
SAYING rather than gating; the record side still holds the original question with stale evidence.

### ⚠️ WHAT CLOSES PHASE 2, revised B737 (partly superseded above)

**Item 2 of the B704 pair is done** (provoke GL loss + cycle diagnostics — see the arc summary above).
**Two things remain, and they are the same shape:**

1. **The BAKE gate.** Refuse or warn using the measured cost model, reading `deviceFreeMB` live.
   **Blocked only on device-verifying B732/B734/B737** — the model is proven, the reductions are not.
2. **The RECORD gate** (the original item 1 below). Same mechanism, different subsystem.

**Both must be COMPUTED, never a device table** (`HARDWARE-SUPPORT.md`), and both need one honest
refusal path rather than two. **A published capability table is the right thing to SAY; the live
reading is the right thing to GATE on** — the same iPad Pro measured 1259MB and 1065MB free on two
runs.

### ▶ (superseded B737) The two things phase 2 has NOT done, both named by Daniel at B704

1. **Gate recording on detected capability.** Scoped in BACKLOG, not built. Refuse 4K takes (13.5fps against a declared 30, two devices, two builds); warn on record-while-broadcast and on thermal `serious`. **Must be COMPUTED, never a device table** — see `HARDWARE-SUPPORT.md`.
2. **Provoke GL context loss deliberately and cycle diagnostics.** **The largest remaining piece of the item.** The listening side only became ready at B695/B699/B703; before that a provoked loss was mostly unobservable. B703 may already have fixed the most common consequence, so losses that heal cleanly are a PASS.

### Known unknowns

- **No iPhone data at all** for Perform or broadcast, and the phone chrome is a separate code path.
- **No pre-Apple-silicon data.** Tier C is an assumption with nothing behind it.
- **No cool-device measurement of FHD-while-broadcasting.** Every run of that combination was at thermal `serious`.
- **One silicon generation.** Everything is M1 — we own the top of the range and none of the bottom.
- **The governor A/B is incomplete**: the confirming run lost its new-pictures metric to a report contradiction (filed).
- **B703 and B704 are not device-verified**, only modelled and harness-checked.

---

## The sequence

Ordered by dependency, not tractability. **The documented failure mode of this arc is a well-defined next step out-competing an important one** (`DEBUGGING-PROTOCOL.md`, state D). If you are working on something not on this list, that is the drift.

### ▶▶ THE REVISED SEQUENCE TO CLOSE PHASE 2 (agreed with Daniel, 2026-08-26)

**This supersedes items 1-5 below as the ORDER OF WORK.** Those items are kept because they hold the
reasoning and the done-conditions; this table holds what to do next and why in that order.

**The honest definition of close, and it is narrower than the original plan:** *we can state what we
support, the statement is true, and the app prevents or warns the cases where it isn't.* It does NOT
require iPhone measurement, NDI, or the notification-bar build. Those are real, and they are not
close-out.

| # | what | depends on | why here |
|---|---|---|---|
| **0** | **Revise this plan. Update `ARCHITECTURE.md` and `CAPABILITIES.md` for the SETTLED things** (streaming demux, streaming muxer, O(1) bake memory, the render upload path) | — | Daniel: *"I don't trust that I have the full scope in my own memory right now."* Writing it down at the END is too late for both parties. **Hold the GATING sections until after 2** — the model is about to change |
| **1** | **⚠️ MOSTLY ALREADY BUILT — see below. Add a `render` and a `bake` verb to `shell/scenario-runner.js`** | — | The velocity fix, and it is 90% done. **And it is the prerequisite for enlisting alpha testers** on hardware we do not own, which is the only route to the M2-M5 middle of the range |
| **2** | **ONE batched device session: the concurrency matrix + the record control conditions.** ⚠️ **Its record half, A4-A6, needs NO BUILD and can run on B751 today** | 1 for A1-A3 only | Replaces "verify the probe across four devices", whose premise died with the size hypothesis. **Settles the new ceiling axis AND gate 3 AND whether OPFS is the right fix, in one session** |
| **3** | **Colour: build the input transform** (not a throwaway fix) | — | A shipped regression plus a standing BT.601 bug. Independent of 1-2, so it can run in parallel or slip |
| **4** | **Concurrency gates for record**, if 2 says there is something to gate | 2 | **Real possibility the refuse rule shrinks to a warning.** The 13.4fps figure is pre-B681 and is the ONLY justification for a take-tier cap |
| **5** | **Spot-check pass, learn only, commit to changing nothing**: iPhone record, Capacitor NDI, **battery under sustained idle** | 1 | Rides the runner. Bounded by the no-changes commitment, which is what stops it becoming another arc |
| **6** | **Spec archaeology, then cruft cleanup. Notification bar PUNTED** | 2, 4 | Archaeology decays and the UI does not, so it goes first. **Cleanup must come after the measurement work because the flags being deleted ARE the instruments** |
| **7** | **Close the plan out, pause, go to feature work** | all | The clean exit |

**Why this is a clean exit at 7 and not before:** the plan doc is current, the instruments are either
kept deliberately or removed deliberately, and the one shipped regression is fixed. Not because
everything is answered. **What stays open is named and measured, which is the difference between a
pause and a drift.**

#### The A1-A6 matrix that step 2 runs

**Same file throughout. Fresh launch per run. Vary only what PRECEDES the operation.**

| run | preceded by | answers |
|---|---|---|
| **A1** | nothing | the control |
| **A2** | a broadcast session | the B750/B751 hypothesis |
| **A3** | a bake, then teardown | the long-open D5 residue question |
| **A4** | nothing — **FHD take** | **the record gate's control condition, which has NEVER been run.** Every FHD number we own came from a run with a broadcast live |
| **A5** | nothing — **4K take** | whether the 13.4fps refuse rule survives B681 |
| **A6** | **take while broadcasting** | closes gate 3 |

**What cannot be automated, and must stay manual:** the force-quit and relaunch (Capacitor has no
reliable programmatic process restart, and `location.reload()` does not clear the residue we are
hunting), the HDMI attach, and the Files picker (needs a user gesture). **Everything after "go" can
be.**

**The second design, free once the first exists:** run all six back to back in ONE launch. That is a
different experiment — does residue accumulate monotonically — and it is cheaper. Build the runner to
do both.

**B751's breadcrumbs are what make this affordable**: a process kill now leaves evidence, so a crash
is a RESULT rather than a wasted session.

#### ⭐⭐ THE RUNNER ALREADY EXISTS, AND HALF THE MATRIX IS ALREADY SCRIPTED (found by reading, B752)

**`src/shell/scenario-runner.js` has been in the codebase since B665** and is hardened by B666 and
B667 (the still-frame bug, the wrong denominator, the lost session block). It is wired into
`main.js:524`, surfaced as **`run scenario`** in the frame-cost panel, reachable on iPad through the
desktop diagnostics section, documented in the UI Lab, and it already exports under `scenarioRun` in
`copy report`. **Scripts are declarative data; every step publishes why it declined; a pre-flight
refuses by name rather than skipping silently.**

**⭐ SO A4, A5 AND A6 NEED NO BUILD AT ALL. They are already written and have never been run:**

| matrix cell | existing script | what its own comments say it is for |
|---|---|---|
| **A4 + A5** | `t11-take-baseline` | FHD take alone, then 4K take alone. *"the 13.4fps figure, re-measured"*. **The control condition the record gate has been blocked on since B704** |
| **A6** | `t3-rerun-post-b681` | take while broadcasting, re-run against the decoder fix |
| A2 (partly) | `t3b-take-first`, `t2-hands-off` | broadcast-first orderings |

**The reason they were never run is not that they were hard. The arc went to bake and render at B705
and never came back.** Running `t11-take-baseline` on the current build is the single cheapest
unblocked action available, and it does not wait on step 1.

**▶ WHAT STEP 1 ACTUALLY IS, then — small and scoped:**

1. **A `render` verb and a `bake` verb.** Neither is reachable from the runner today: `env.outputActions`
   is the only action seam that exists (`output-panel.js:1078`). This needs an `env.renderActions` /
   `env.bakeActions` in the same shape, exposed by `motion-runtime.js` and `clip-editor.js`.
   **⚠️ THREE FILES, AND TWO OF THEM ARE THE RENDER AND BAKE ENTRY POINTS. Wants a yes before
   building** — it is precedented but not trivial, and those are the two hottest paths in the app.
2. **Scripts A1, A2, A3** once the verbs exist.
3. **Cross-relaunch accumulation is OPTIONAL, not required.** Each matrix cell is self-contained
   within one launch (A2 is *broadcast on, wait, broadcast off, render* in a single script), so the
   fresh-launch control is satisfied by force-quitting between runs. That yields six reports rather
   than one. Merging them is a convenience; **do not let it block the session.**

---


### 1. Close out B609 verification ✅ COMPLETE

All three questions are answered. **Do not extend this session; it is done.**

- **Upload drain holds.** Multiple clip loads across three sessions, no `NO NATIVE DECODE`.
- **The minimum viable 4K budget is 64MB, the current default.** `heldMB 59`, 5 frames, `firstPts 0`, and the wall's worst lap gap was 52ms against a 33ms interval, a 19ms overhang on one frame. At 256MB it was 42ms. **Four times the memory buys 10ms on one frame per lap.** The default is right and the 4K memory risk is smaller than feared.
- **The bake pattern inverted.** Not "first attempt fails" but **"the second bake within a session fails"**, with two fresh-session first bakes succeeding. Points at something a completed bake does not release, rather than something held at startup. **⚠️ Confound to separate on the next device session (rescued from VERIFY-QUEUE at B658): a GL context loss happened between the good bake and the bad one. Do a second bake in a session where nothing was lost.**

**Two instrument defects to fix in the next native build, not now:**
- `loopCache.coveredMs` measures the span between first and last cached pts, which under-reports real coverage by one frame interval, so `why` advises raising a budget that is already sufficient.
- The report's `scenario` tag reads `idle-still` during a 4K broadcast. Per `BROADCAST-DELIVERY.md` §7 it must be set before a baseline is saved.

### 1.5 Input normalization across modalities and forms

**Promoted by Daniel at B609**, and explicitly scoped as architecture rather than triage: *"ensuring that the lower level infrastructure to capture inputs across modalities and surfaces matches how we want to build things long term and isn't a 'stop the bleeding' hack."*

**The diagnosis, and it is already written in the code.** The zoom/slice/canvas normalization work (B440 semantic roles, B477 `sizeNorm`, B483 `canvasNorm`, B462 unified zoom) **landed for the touch surfaces and was never carried to the hardware paths.** `input-bus.js` even names the target in a comment: *"a candidate for the shared helper when the 'one fn per input axis' hardening lands."* So the architecture is not being invented here, it is being finished.

**Three stages, and the bugs get fixed inside them rather than as one-offs:**

- **A. Make the target registry per-form aware.** `PARAM_TARGETS` is a flat list of state keys with fixed ranges; exactly one entry (`canvasZoom`) has a `resolve(state)`. Extend that to every target whose meaning is per-form. **Pan can be done today** (`latticePeriod` is real per-form data on square, hex and triangle). **Scale cannot** (see the blocker below).
- **B. One transform per input axis, shared across every modality.** Today the bus, the local touch handler, the pan joystick and the mobile chrome each derive their own input-to-param transform. `kit/zoom.js` and `kit/pan.js` are the pattern that already works; the remaining axes need the same treatment. **This is what makes a mapping behave identically whether it arrives from a fader, a finger, or a stick.**
- **C. Ownership and handoff.** Whichever input takes over adopts the current value and moves relative to it. The per-field ownership pattern autoplay already uses. **This is the root fix for the gesture/joystick jerk**, which is two inputs holding independent absolute position state.

**Bugs that resolve inside these stages:** the joystick 45° offset (axis-convention mismatch, stage B), the handoff jerk (stage C), left-pan not honored on triangle (stage A or B, a clamp or wrap boundary), droste's accumulated zoom leaking into other forms (stage A, and Daniel has already chosen the resolution: decouple per form), and iPad touch hypersensitivity (stage B, and note `PINCH_ZOOM_SENS` has been cut three times already at `3 → 1.05 → 0.5` with Daniel still reporting it too enthusiastic, which suggests the constant is not the real problem).

**✅ THAT BLOCKER IS CLEARED (B618).** All five forms now declare `zoomCover` and `zoomInFloor`, tuned by Daniel with the `?tune=forms` range sweep. The text below is kept because it explains *why* the blocker mattered. **Nothing in item 1.5 is waiting on a tuning pass any more.**

> ~~**⚠️ BLOCKER, and it is Daniel's:** per-form scale normalization needs per-form values, and no form declares `zoomCover` or `zoomInFloor` today. Both appear only in `forms/index.js` as the flat fallbacks 3 and 0.7. B511 shipped `?tune=forms` to produce these values and the tuning pass never happened.~~

**Also to settle here (Daniel, B609):** which parameters persist across a form switch versus a mode switch. His stated intuition, which stage C should implement: **persist basics like slice position and scale when switching forms during a performance; do not persist discrete changes across still and motion modes.**

**Done when:** a mapped control behaves the same way on every form, an input that takes over from another does not jump, and a mapping that cannot act on the current form says so rather than writing silently.

---

### ▶ ITEM 1.5 STATUS ROLL-UP — CURRENT AS OF B623 (post-show)

**Daniel ran a full show on B621. The app "behaved beautifully."** That is the first real-world validation this arc has had, and it moves item 1.5 from "being built" to "being refined against use."

**Everything he reported afterwards is a REFINEMENT of shipped behaviour, not a hole in it** — with one exception (the camera source-swap dead end, filed HIGH in BACKLOG, which is a source-host bug rather than an input one).

| # | item | state |
|---|---|---|
| 1 | learn defaults to `sliceRotation` | ✅ B619 |
| 2 | semantic `zoom` resolves key but not MODE | ✅ **SHIPPED B621+B623, confirmed by reading the registry at B653.** `resolve()` returns `wrap`/`wrapPeriod`/`relSpan`/`geometric` per form, which IS the control mode. The `abs`-fader-sweeps-one-loop behaviour was settled as CORRECT by decision; the real defect was the nudge size, fixed by `relSpan: 3.5` |
| 2b | **no target reaches the UNIFIED zoom** | ✅ **SHIPPED B655.** A third target (`unified zoom`) drives the pair as a pinch does; `canvas zoom` and `slice scale` untouched by Daniel's instruction. Step/ramp only — the model has no absolute position to hold. **This closes stage B** |
| 2c | discrete targets stepped by a percentage | ✅ B621 (`nudge`) |
| 3 | per-form ranges for `sliceScale` | ✅ **CLOSED B657, and NOT per-form.** Daniel chose one shared range (0.1 → 3) over per-form maxima: *"this captures 99% of the real use cases while still blocking insanely large samples."* The find was that the range was already enforced **six times at three different maxima** — audit instance seven |
| 4 | `slice position x/y` address the ORIGIN, not the box centre | 🟡 open — `write` hook (B619) makes it implementable |
| 5 | missing targets (form, segments, oob, droste toggles) | ✅ B619 + B621 (`last form`) + B623 (resets) |
| 6 | trackpad zoom judder | 🟡 open |
| 7 | transition-speed floor (~0.05s) | 🟡 open. Default itself moved to 0.5s at B622 |
| 8 | iPhone pan-lock parity | 🟡 open — **and Daniel owes a verification on the iPhone slice-centring fix (B619)** |
| 9 | the SHARED-QUANTITY audit | 🟡 open, and now **six** instances |
| 10 | droste infinite-zoom loop | ✅ **ROOT-CAUSED + FIXED B623.** Underlying period loss in `setTarget` still open |
| 11 | droste zoom press ~6× too small | ✅ B622 (`relSpan`) |
| 12 | canvas zoom steps disproportional when zoomed out | ✅ B623 (`geometric`) |
| — | **stage C: ownership and handoff** | ✅ **CLOSED B657.** Daniel could not reproduce the jerk (the B636-B640 gesture gate fixed it on the way past). An audit of every holder of independent per-field state found **one** real gap: a settling glide overwrote any other input for ~0.5s. Now yields, using `kit/drift.js`'s own mismatch test. Rate loop, drift, follower and pointer drags already adopted correctly |

**▶ B630 STATUS: every item Daniel approved is now shipped.** The modifier layer (B629), the duplicate-binding prompt (B629), the source-swap diagnostic (B630) and the off-canvas origin (B630) are all in. **Stage C (ownership and handoff) is now the only unstarted piece of 1.5**, and the shared-quantity audit ran at B627.

**▶ ITEM 1.5 IS CLOSED AT B657.** Stage A closed B618-B619, stage B closed B655 (the unified-zoom target), stage C closed B657 (the glide yield). The remaining named sub-item, (4) `slice position x/y` addressing the ORIGIN rather than the box centre, is **filed to BACKLOG rather than held here** — it is a semantics correction to one target, not architecture, and holding 1.5 open for it misrepresents where the work stands.

**▶ NEXT PER DANIEL (B657): the DOCUMENTATION half of item 3 (cruft cleanup), which is unblocked now.** The CODE half stays behind item 2 — the flags being deleted are the instruments.

**⚠️ THE AUDIT ITEM IS NOW THE MOST-EVIDENCED THING ON THIS LIST — SIX instances of one value or behaviour living in multiple copies:** droste's overlay missing `sizeNorm` (B614), radial's polygon missing `canvasNorm` (B618), the overlay missing `canvasOffset` (B612), the B616 centring hook reaching only the desktop chrome (B619), the six copies of the `0.35` transition default (B622), and `env.panDrift` covering only one of two joystick instances (B620). **It has stopped being a hypothesis.**

---

### ▶ ITEM 1.5 STATUS ROLL-UP — AS OF B619 (superseded, kept for the stage framing)

**Stage A (per-form target resolution) and stage B (one transform per input axis) are substantially DONE. Stage C (ownership and handoff) has not started and is now the largest remaining piece of 1.5.**

| stage | state |
|---|---|
| **A. per-form target registry** | **Done for the fields that have per-form meaning.** `resolve(state)` now covers zoom, pan (lattice-aware, unbounded where periodic) and segments. Every form declares all four normalisation numbers. **Remaining: `sliceScale` has no per-form range** (unblocked since B618, item 3 below). |
| **B. one transform per axis** | **Done for pan and zoom.** `kit/pan.js` `panDelta` is shared by touch, remote and bus; `kit/zoom.js` `applyUnifiedZoom` is shared by touch and remote. **Remaining: no mapping target reaches the UNIFIED zoom** (item 2b below) — hardware can only write `canvasZoom` or `sliceScale` raw, which is not what a pinch does. |
| **C. ownership and handoff** | **NOT STARTED.** No input adopts another's current value on takeover. This is still the root fix for the gesture/joystick jerk. **Largest remaining piece of 1.5.** |

**Also still unsettled from the original scope:** which parameters persist across a form switch versus a mode switch. B613 answered half of it by decision (canvas pan never carries; the box centre does), but the still-versus-motion half is untouched.

---

### ▶ ITEM 1.5 DETAIL (rolled up B618, revised B619)

**✅ SHIPPED, B610-B618 — stage A and B are substantially done.**

| build | what landed |
|---|---|
| B610 | Pan gain derived from the shader (`aspect/Z`, `1/Z`); droste pinch `startDist` floor + finite guard |
| B611 | **Gesture and direct-manipulation pan paths MERGED** (`panDelta`, one gain, both magic constants gone); pan "edge" fixed via per-form resolve; `targetOf` resolves at the single lookup point |
| B612 | Droste gesture travel bounded by the follower's own `LEAD_CAP` |
| B613 | `canvasOffset` never carries across a form switch; pan-unlock always starts centred |
| B614 | `sizeNorm` tuned on all five forms; **droste's overlay never applied it** |
| B615 | `centerFormInSource` — centre the form's BOX, not its origin; portrait sources rotate 90° CW |
| B616 | Wired centring to load + form switch; **form switch carries the BOX CENTRE, not the origin** |
| B617 | Tuner hugs the bound being dragged + `range sweep`; source swap runs the full slice reset |
| B618 | **Zoom extents on all five forms** — the last normalisation number; radial's polygon missing `canvasNorm` |
| B619 | **Learn lands unassigned**; form selection / segments / droste toggles / oob mappable; **iOS box centring + frame-relative orientation**; `resetSliceState` shared by both chromes |

**🟢 UNBLOCKED — nothing waiting on Daniel. Safe to work autonomously.**

1. ~~**MIDI learn defaults to `sliceRotation`**~~ **SHIPPED B619** — learn now lands on `— pick a target —` and is inert until assigned. **The diagnosis of Daniel's crossed-wires symptom is still unconfirmed** (see BLOCKED), but the defect was real either way.
2. **The semantic `zoom` target resolves the KEY but not the MODE.** `canvasZoom` is bounded/absolute; `drosteZoomPhase` is cyclic/unbounded. An `abs` fader sweeps one wrapping loop on droste and reads as dead. `resolve()` must carry the control mode. **Now the top unblocked item.**

2b. **▶ NEW, B619, AND IT IS THE MOST IMPORTANT MAPPING GAP: no target reaches the UNIFIED zoom.** The `zoom` target writes `canvasZoom` directly; `slice scale` writes `sliceScale` directly. **Neither is what a pinch does** — `applyUnifiedZoom` ([kit/zoom.js](../src/kit/zoom.js)) distributes canvas-primary with bounded slice overflow across three log-space segments. **Daniel found this from the product side while mapping a DualSense** (B619): *"right triggers: rotate canvas (could just as well be canvas scale too but with the unified zoom slice gets at this without needing to use two more controls)"* — his layout only works if one control can drive the unified pair, and today none can. **This is the clearest instance of stage B being unfinished:** the transform is shared between touch and remote, and the hardware path was never connected to it.

2c. ~~**Discrete targets step by `sens × range`**~~ **SHIPPED B621** — discrete targets declare `nudge` and step one legal value per press. Original note kept below for the reasoning.

> **Discrete targets step by `sens × range`, which is wrong for a snapped control.** Segments on droste (arms, range 1–12) at 2% sens moves 0.22 of a step and snaps back to where it started, so a d-pad press does nothing until enough presses accumulate. **Workaround: raise sens to 10–25%.** The real fix is that a snapped/enum target should step exactly one legal notch per event regardless of sens — already filed as Stage 3 of the control-registry item in BACKLOG. **Newly urgent because B619 made segments and form selection mappable, so this now affects controls Daniel is actively binding.**
3. **Per-form ranges for `sliceScale`** — unblocked as of B618, since `zoomCover`/`zoomInFloor` now exist.
4. **`slice position x/y` still address the ORIGIN**, but since B616 the app's model is the BOX CENTRE. A fader on slice position now means something different from what the gesture path does. **Found by reading Daniel's B618 target list.** B619 added the `write` hook that makes this implementable without a special case: the target can write through `placeFormBox` the way segments writes through the slider's setter.
5. ~~**Missing mappable targets**~~ **SHIPPED B619** — form selection (next/prev + one per form), `segments` (form-routed), droste mirror / wedge mirror, and `oob` (cycle). **Still missing and worth a look: droste offset x/y are present but gated behind the `manual` toggle (see DECISIONS), and `sliceScale`'s range is not yet per-form (item 3).**
6. **Trackpad zoom judder** — the spasm before direction is detected. Investigate BEFORE the transition floor, or the filter hides it.
7. **Transition-speed floor** (~0.05s instead of true zero). At response 0 the follower hard-snaps, which switches the spring's low-pass filtering off entirely. Daniel proposed it; agreed.
8. **iPhone pan-lock parity** — radial forms have no unlock, others have no lock.
9. **✅ AUDIT RUN AT B627 — result in BACKLOG. One real defect (fixed), one live trap (named, not yet fixed), and a lot of correct absences.** The injection surface is healthier than the seven instances suggested: every `ctx` key mobile omits was checked individually and each is deliberate. **The remaining risk is specific and narrow** — `main.js` defines local wrappers that SHADOW the kit exports by name, so `applyArmsSnap` means a zero-arg function there and a one-arg function everywhere else. **Fix: rename them, before adding more injected callbacks.** New standing rule earned: *a function injected into shared code must take everything it needs as arguments.*

> ~~**⬆️ PROMOTED B619 — the SHARED-QUANTITY audit, and it is broader than "normalisation".** FOUR instances this arc of a shared thing reaching only some of its consumers: droste's overlay missing `sizeNorm` (B614), radial's polygon missing `canvasNorm` (B618), the overlay missing `canvasOffset` (B612), and **the B616 centring hook reaching only the desktop chrome while the mobile chrome kept a stale partial copy (B619)**. The fourth is the expensive one: it shipped as "fixed", was verified on desktop, and was still broken on the device Daniel actually performs with. **The audit question is not "which values are missing a norm" but "which behaviours exist in more than one copy, and do the copies agree."** Start with the two chromes: `main.js` and `mobile/chrome.js` do not share an `env`, so every `env.*` hook added to one is a candidate.

10. **Droste infinite-zoom loop — INVESTIGATION, NOT A FIX. Full detail in BACKLOG; this is the summary.** Uncertainty state **B**. Four mechanisms eliminated by reading and simulation, no cause established, **so the only legal next move is an instrument.**
    - **DISPROVEN — follower runaway.** `follow.js` simulated across response 0.35–8s × pinch deltas 0.5–20 loops, and again over a 65-second horizon measuring the residual RATE (the right noun for a log-polar field, where any nonzero rate is visible zoom). **The tail decays to zero by 30s in every cell.** Do not re-propose.
    - **RULED OUT — autoplay drift.** Gated behind `autoOn`; Daniel confirmed autoplay off.
    - **RULED OUT B619 — flick-to-drift.** Gated behind drift mode, and **Daniel confirmed drift mode was off** in his last repro.
    - **RULED OUT — joystick handle feedback.** The joystick's `syncAll` only moves the position DOT; state never deflects the handle, so a large offset cannot start a drift.
    - **⚠️ WHAT THAT LEAVES IS A CONTRADICTION, AND IT IS THE MOST USEFUL THING WE HAVE.** With autoplay off, drift mode off, and no fingers down, **an exhaustive grep finds no writer that can move `canvasOffsetX/Y` or `drosteZoomPhase`** — and the follower provably settles against constant state. Yet the motion is real. **So either a writer exists that static reading has missed, or the moving quantity is not the one we think.** One instrument distinguishes those, and no amount of further reading will.
    - **▶ FOUND ALONG THE WAY, a real defect either way: the droste centre-offset joystick is a SECOND `createPanJoystick` instance** ([mobile/chrome.js](../src/mobile/chrome.js) `mountDrosteOffsetControl`, driving `drosteOffsetX/Y`) with its **own** `driftMode`, `hx/hy` and tick loop. **`env.panDrift` points only at the canvas-pan instance**, so `output-gestures`' "grabbing takes control" stop cannot reach it. **A latched droste-offset drift is uncancellable by any gesture** — recenter or reset only. That is the same shape as the reported bug and is worth fixing regardless of whether it is the cause.
    - **The instrument:** publish per frame into the exported report `canvasOffsetX/Y`, `drosteZoomPhase`, `drosteOffsetX/Y`, and the follower's own `cur` for each. **Conserved quantities actually being rendered, not activity counters.** Daniel does not run Web Inspector, so `copy report` is the only channel that counts.

**🔴 BLOCKED — needs Daniel.**

- **The rotation "crossed wires" symptom.** His B618 screenshot showed the AVAILABLE TARGET LIST, not his mapping rows — so the learn-default diagnosis is still unconfirmed. **Needed: how many of his existing rows say "slice rotation" that he did not choose.** ⚠️ B619 fixed the learn default, which stops NEW rows landing there — it does **not** repair rows already stored in `localStorage`. If the count comes back high, those existing rows need re-picking (or clearing the rig).
- **Overlay reads inaccurate while sweeping the tuner.** No repro detail; the radial fix is unlikely to be the cause since its norm is 1.0. **Needed: which form, and roughly where in the sweep.**
- **Three guessed `zoomCover` values** (square/hex/triangle, all 0.65) were set when the slider floor was 1 and they were unreachable. Behaviour is identical anywhere below 1, so this only matters if one actually wants to be **above** 1.
- **Segments-as-performance-control** needs definition: step size and bounds. A count that runs to 64 mid-set is a different instrument from one that walks 6→8→12.

**⚖️ DECISIONS FILED, NOT GUESSED** (all in BACKLOG with reasoning):

- **Live-follows-staged:** should a RESET action jump the follower rather than chase? The unrecoverable-live bug. **Most consequential open call.**
- **Autoplay's settle test:** exclude `drosteZoomPhase` from `isSettled` so the ghost trail can fade?
- **Droste's seamless preconditions:** enforce, warn, or accept silently?
- **Why is `drosteOffsetX/Y` gated behind the `manual` toggle?** Needed before touching droste pan.

**⚠️ FRAGILE / LIGHTLY VERIFIED — worth knowing after a compaction:**

- **Every normalisation number changed in the last five builds** and has had one pass of eyes. Scale and position are coupled through the bounding box (droste already needed 1.82 → 1.65 after centring moved it), so a change to one can invalidate the other.
- **`canvasOffset` now resets on EVERY form switch** (B613). Deliberate and Daniel-approved, but aggressive — if the tiling-pan workflow starts feeling lossy, this is why.
- **`env.resetSlice()` runs on every new source** (B617, Daniel's ask), explicitly flagged by him as "revisit if this doesn't feel right over sustained actual use."

### 2. Real-world pressure testing and hardening

**The arc's actual unmet target**, and Daniel's framing is the right one: this is one cluster, not a list of separate bugs. **The bake failure, the source-panel blackout, the GL context loss, the slice-preview stall and the green glitch are all downstream of a single question: how many decode, encode and GL sessions we hold at once, and whether we release them.** Fixing them individually means deriving the same audit three times.

**Order within the item:**

1. **The session audit. ✅ DONE 2026-08-19 → `docs/archive/SESSION-AUDIT.md`.** Class 1, answerable by reading code, **no device time.** What hardware sessions does the app hold at each moment, and who releases them. This turns three device sessions into one. **Result: the source `<video>` is orphaned on every swap, and no GL context is ever released. Peak is 5-6 decoders of one clip, counted by nothing.** The follow-on it names (an actual session counter, published in the report) is what turns the audit into a measurement.
2. **The thermal signal.** `ProcessInfo.thermalState` reads null. The JS seam already exists at `main.js:102` and `createPressureSource` already consumes it, so this is a small addition to a plugin we rebuild anyway. **It is a prerequisite, not a phase.**
3. **The long-form run.** 6 to 10 minutes of 4K, broadcasting 4K over HDMI, cold start, fixed slice. Governor pinned off. Readings at start, middle and end.
4. **The cluster fixes**, aimed by what 1 and 3 found.

**New this session, and it is the highest-value single finding:** the source-loss reading fired the B584 instrument for the first time and landed on the branch that instrument was built to separate.

```
offered 222 · took 222 · skipped 0 · 0.0 in/s · ⚠ GL CONTEXT RESTORED ×1
```

**Equal counts with a frozen picture means the frames reached us and we failed to use them.** Not contention, not the wire, not the fan-out. Almost certainly the planar source's plane textures not surviving `reinitGL`. **Class 1, readable, start here.**

**On the second device:** the M1 iPad Air is a **control, not a second data point.** Same silicon, fewer pixels, 60Hz instead of 120, so it does strictly less work for the same content. **If a 6-minute 4K broadcast fails on both, the ceiling is not device headroom.** Check RAM on both first; the M1 iPad Pro is 8GB below 1TB and 16GB at 1TB or above.

**Done when:** a 6+ minute 4K clip broadcasts 4K over HDMI, cold start, without a GL context loss and without the app becoming unresponsive, with cost recorded at three points. **If it fails, done means a named failure with a measurement**, not a fix.

### 3. Cruft cleanup

**Both code and documentation.** The consolidation item is filed HIGH at B591 and lists five disproven levers still carrying live code. Documentation gets the same treatment: keep the learnings, archive the narrative.

**The governor decision belongs here, and B609's report sharpens it.** The report reads `active: false, level: 0, rung: "full rate", signal: display, shortfall: 0` while `appShortfall` is 0.62. **It is not shedding.** Since B581 it watches the display, and since B590 the display rarely has a shortfall, so it almost never arms. When it does arm, B591 measured that its action makes delivery *worse*.

**So it is a loaded gun that only fires in the one situation where firing hurts** — and Daniel's instinct about the exception is correct. On an HDMI or external-window destination the view renders itself, so app fps does not gate it. **On a bus destination like NDI or Syphon the app's canvas genuinely is the output, so app fps gates it directly.** The governor's original premise is false for HDMI and still true for NDI. **The decision is therefore not retire-or-keep, it is scope it to bus destinations.** That decision needs item 5's measurement to confirm, which is why the governor should be disabled rather than deleted here.

**Done when:** disproven levers are gone from the code and the panel, the docs hold only living material, and the governor has a decided scope rather than a default.

### 4. iPhone limits and honest labels

**Independent of everything above.** It was gated on items 1 and 2 when the plan was written; those are closed, so it is unblocked and can slot wherever a phone is in hand.

**Known before starting:** the mobile chrome's take path has a structural 2048 cap, so "4K record" on the phone has never been true and every 4K recording number from the phone measured a 1080p take (`CAPABILITIES.md`, correction B551). HDMI from the phone has never been measured on any build.

**The exit-criteria audit got bigger this arc, not smaller.** New confirmed liars: the source surface's off switch does nothing, `gpuMsPerFrame` always reads 0 because WebKit does not expose the timer extension, `pressure` cannot be trusted during a take, and `foldHdmiVideoUncap` is a confirmed no-op.

**Done when:** every option the phone offers is either functional or honestly labeled.

### 5. NDI

**One measurement, not an investigation.** B478 already concluded that WiFi NDI is packet-timing jitter with sender-side levers exhausted, and that conclusion stands. **Do not re-litigate it.**

**What is genuinely open, and it is specific:** B569 found the async readback is not working on iPad, costing **31.43ms of a 76ms frame**, the single largest item in that path. That is plausibly the entire explanation for the choppiness reported across two arcs, and it is a different animal from the WiFi jitter.

**Done when:** the readback is fixed, one wired and one WiFi reading exist, and the destination carries a label matching what was actually measured.

---

## The dependencies that are real

Everything else can be bundled or reordered. **These four cannot.**

| dependency | why | strength |
|---|---|---|
| Thermal signal **before** the long run | Without it, a slowdown at minute six is indistinguishable between heat, memory pressure and a leak. Three different fixes | **Hard.** Cheap to clear |
| Governor **pinned off** during the long run | If it arms mid-run it changes the workload under measurement | **Soft.** A switch, not a decision. Its fate does not need settling first |
| Cleanup **after** pressure testing | **The flags being deleted are the instruments.** The cache budget knob, `loopBySeek`, the surface toggles. Delete them first and A/B capability is gone mid-investigation | **Hard** |
| NDI readback fix **before** NDI measurement | Measuring with a known-broken readback measures the readback | **Hard**, but it is one small fix |

**One discrete piece sits at the front of item 2:** the session audit. Class 1, no device. Doing it first is what makes the expensive session cheap.

---

---

## The stage manager, as specified (Daniel, 2026-08-26)

**Recorded here rather than in BACKLOG because it is a DESIGN INPUT to the gating work, not just the
next feature.** It changes what a gate is a property of, so building gates without it means building
them twice. Still in design phase; these are the requirements as they stand.

**Shape:**

- **Up to nine sources on the stage**, including the live and the staged source.
- **Live video sources are a stage type**, not just files: webcam, Continuity Camera iPhone, tethered
  mirrorless. **They do not all play back live.** A queued camera shows a thumbnail with a ~3-5s clip
  of its last active moment on hover or tap; **only one camera is activated, as it is staged and
  readied to go live.**
- **Stills and video loops can be sent to the stage from the motion editor with keyframes applied.**
- **Bake gains save-direct-to-disk**, so a baked loop outlives the session.
- **Crossfade between live and staged only.** A DJ mixing deck, not Resolume Arena's compositor.

**⭐ THE CONSEQUENCE THAT MATTERS FOR GATING: only two sources are in working memory at a time.** The
other seven are references. Killing the source and/or staged panels during a transition is on the
table as a way to free resources. **So the capability gate stays a property of the ACTIVE PAIR, not
of the queue of nine.** That is a large simplification over what the queue length first suggested.

**⚠️ AND THE ONE EXPOSURE IT CREATES, which points at the same matrix.** Nine held `File` references
is the handle-revocation exposure multiplied by nine and stretched over time. If the transient
`NotFoundError` is iOS revoking a security-scoped handle some interval after the pick, then **a clip
sitting on deck for forty minutes before promotion is the worst case for it.** The stage manager
makes gate 1 more load-bearing, not less. The mitigating half: clips sent to the stage from the motion
editor are files WE wrote, so their bytes are ours and they are immune.

**Persistence across sessions is not in the initial build, but must be designed for now.** Daniel:
real users will demand it. The intended shape: **the stage holds motion JSON, actionable metadata and
attributes (is it a loop, and so on) and stage layout; the media itself is referenced on disk, not
held.** This is the same requirement that makes bake-to-disk necessary rather than nice.

---

## Two things this plan must carry that are NOT written down anywhere yet

### 🔍 THE GATING AND COMMUNICATION SPEC IS REAL, DETAILED, AND FRAGMENTED ACROSS COMPACTIONS

**Daniel, 2026-08-26:** we have accumulated a lot of specific design detail about **how** limits get
communicated, and it is scattered across dozens of compaction summaries rather than captured in any
doc. It is not lost, but **recovering it requires deliberate sleuthing through session history, and
it decays with every further compaction.**

Examples of the shape, to calibrate the search:

- disabling the record button outright during an iPad broadcast, versus warning about poor fps and
  **suggesting a lower broadcast resolution as the fallback lever**
- estimating render and bake times, and **showing the estimate alongside time elapsed**
- the persistent communication space under the app bar as the home for toast-like notifications,
  which is eventually meant to absorb **well over a hundred** existing toasts and inline notices

**The nearest thing to a spec that IS written down** is BACKLOG *"THE CAPABILITY LADDER: WHAT GETS
GATED, WARNED, OR FLAGGED"* (Daniel's four-row consequence rubric) plus `CAPABILITIES.md` §5. Treat
those as the skeleton and the archaeology as the flesh.

**▶ THIS IS TIME-SENSITIVE IN A WAY THE UI BUILD IS NOT.** The notification bar can wait; the
recovery of what it is supposed to say cannot. **Do the archaeology before the build, and do it
early.**

### 🔋 SUSTAINED THERMAL HAS A SECOND FACE: BATTERY

**Daniel, 2026-08-26.** The arc has investigated thermal only as a performance throttle. **The other
half is power draw, and it is a product question, not a perf one:**

- if someone leaves the app open and unattended for thirty minutes, does it drain their battery?
- can an iPhone customer use this out and about and have a delightful experience, **without becoming
  uncomfortable about opening it at all?**

**Not to solve now.** Recorded so it is in scope when item 5's measurement pass happens, and so that
guardrails like auto-idle after inactivity get placed against evidence rather than intuition. It maps
directly onto exit criterion #5 (*"a phone app that gets hot and eats the battery in ten minutes is
not shippable"*), which named this and was then never measured.

## The pause point

**⚠️ REVISED B752. It is now after step 6 of the revised sequence, not "after item 3".**

Cleanup is still the seam, for the same reason: it is where docs and code get consolidated, so
stopping there does not leave half-derived context for the next arc to re-inherit. **What changed is
what has to happen BEFORE it** — the concurrency matrix, because without it we would pause having
invalidated our ceiling model and built nothing to replace it.

**The feature work that follows the pause, in Daniel's priority order (2026-08-26):** stage manager
and proper colour management first, both named most impactful; then tileable still output, vector
overlays, and round-trip processing with image-editing DAMs (Lightroom, Capture One, PhotoLab).
**Colour management is a showstopper for commercial viability with photographers and designers**, and
it is what unlocks the tile maker and lossless still round-trips.

**Steps 5 and 6 are measurement, archaeology and labeling. They do not rot while paused** — with the
one exception named above: the fragmented gating spec decays with every compaction, so its recovery
belongs BEFORE the pause even though its UI does not.

**Do not pause before item 2.** Shipping feature work without ever having confirmed the core promise leaves that promise unverified indefinitely, and every open risk in this arc is one that only appears over time.

---

## Explicitly not this arc

Named so they stop competing for attention, not to dismiss them.

- **Colour management — ⚠️ SPLIT AT B752, half of it is now IN this arc.** The *output* half (a float
  working space, display transforms, ICC handling) is still feature-shaped and belongs with stage
  manager. **The INPUT transform is not** — B747 turned it into a shipped regression, and reading the
  code found a standing BT.601 hardcode underneath it. See step 3 of the revised sequence and the
  colour block in "Where we are".
- **Mobile web and Android.** No Android device has ever been in the loop. One measurement session, then a decision, and not before.
- **New forms, motion editor work, tiling density.** Off-arc.
- **Test infrastructure.** A deliberate standalone decision, never a feature-commit rider.

---

## How to measure so the answer survives

Full form in `DEBUGGING-PROTOCOL.md` and `BROADCAST-DELIVERY.md` §7. **The three that this arc paid for in builds:**

1. **Cold start, fixed slice, A/B/A.** The same work gets more expensive over a session. Two false results in this arc came from uncontrolled A/Bs, and **both were caught by Daniel rather than by the instruments.**
2. **Prefer a conserved quantity** that must survive a boundary we do not own, over an activity counter. `offered`/`taken`, pts across a wrap, new pictures on the wall. Not draws, calls or batches.
3. **Anything that can decline to act must publish why.** An absence is not evidence. `nativeAttach` caught three silent fallbacks this arc, each of which would otherwise have become a false conclusion.

**And the standing rule at the top of every verification:** check the `source` row says `planar · native decode` before trusting any measurement. A report from the fallback path cannot be compared to one from the native path.

### ⚠️ Two columns in the report cannot be read at face value (rescued from VERIFY-QUEUE at B704)

Both are **known instrument defects, not fresh doubt.** They were the standing reading rules of the
B658-B704 session and they still apply to every report that build era produced.

1. **Ignore the `pressure` column.** Its baseline re-learns per workload, so it prints `"warming up"`
   mid-run and has labelled 22fps *"nominal"* and 23fps *"fair"* in the same session. Same speed,
   different label. Record the raw baseline beside it or stop carrying it.
2. **Check the `scenario` tag before trusting any `baseline` delta.** It is set by hand and has been
   wrong (`idle-still` on a 4K HDMI broadcast), which makes that report's deltas meaningless.

---

## Risk register

What would invalidate this plan rather than merely delay it.

- **The long run shows 4K at 10 minutes is not reachable on M1.** Then graceful degradation stops being the fallback and becomes the headline product story, and the honest-labels work moves up rather than down.
- **The GPU-process crash is not fixable from our side.** It is a shared WebKit process across both webviews. If it cannot be avoided, the arc's deliverable becomes surviving it well (recovery, state preservation, an honest warning) rather than preventing it.
- **The input work needs more of the control registry than stage A to C.** Stages 2 and 3 of that registry were described as load-bearing back at B559 and have never been scoped properly.
- **A conclusion in this file was measured on the `<video>` fallback rather than the native decode.** It has happened twice. Every 4K number here should be re-checkable against a report where the source row says `native decode`.
