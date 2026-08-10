# debugging protocol

**Status: draft for Daniel's edit (B575). Derived from a forensic review of builds ~512-575.**

This doc exists because a review of the last 50 builds found a repeating failure: we measure something *semantically adjacent* to the phenomenon and spend two to four device sessions before noticing. Eleven instances are catalogued below. The protocol is the countermeasure.

`CLAUDE.md` owns how we work together. `DEVICE-TESTING.md` owns the mechanics of getting a reading off a device. **This doc owns how we decide what to measure and when to stop.**

---

## 1. The two classes of question

**This is the single highest-leverage distinction in this document.**

| | Class 1 | Class 2 |
| --- | --- | --- |
| question | does OUR CODE do what we think? | what does the PLATFORM do? |
| examples | is this handler still registered? does this object have that property? does this counter count uploads or calls? does the setting reach the encoder? | how much does WebKit charge for consuming a GL canvas? does iOS honour `noiseSuppression`? does the fence signal? does it get hot? |
| resolved by | reading code, `grep`, running the app locally once | a physical device, and nothing else |
| cost | minutes | a whole session of Daniel's time |

**HARD GATE: no device run may be scheduled while an unresolved Class 1 question exists on the same code path.**

In builds 551-573, at least seven device sessions were spent discovering Class 1 facts: a missing `active` property, a single-slot subscription, a target resolver that omitted clips, a temporal-dead-zone crash, a hardcoded 2048 output cap, a misread of our own `finalizeMarks` semantics. Every one was a thirty-second `grep`. **That is the velocity problem, more than any measurement subtlety.**

---

## 2. The four uncertainty states

Name the state before proposing anything. Each has a different legal move.

| state | meaning | ONLY legal move | tell that you are here |
| --- | --- | --- | --- |
| **A** | we don't know WHAT is happening | ship instrumentation, **never a fix** | competing hypotheses with no discriminating evidence |
| **B** | we know what, not WHY | targeted probe or architectural reasoning | a reproducible number with no mechanism |
| **C** | we know why, not WHICH lever | **A/B switch**, both answers in one sitting | a mechanism and two or more candidate fixes |
| **D** | enough evidence to act, no stopping rule | **stop and act** | you are refining something already decided |

**State A is the expensive one.** B530 and B531 both shipped fixes while in state A, and the changelog describes each in the same words: *"a correct fix to a real bug, and it was not this bug."* If that sentence is writable about your change, you were in A and acted like C.

**State D is the invisible one.** B571 recorded *"the ladder is the wrong lever anyway"*, and B572, B573 and B574 were then spent making that lever fire. Three builds and three device sessions to confirm something already written down. D is not caused by ignorance. It is caused by **a well-defined next step out-competing an important one.**

---

## 3. The wrong-noun test

Before shipping any instrument, complete this sentence: **"This counts X, which is only equal to the thing I care about if ______ holds."**

If you cannot fill the blank, the instrument is not ready. If the blank contains an assumption you have not tested, **test that first**. It is usually Class 1.

### The catalogue (all real, all from this arc)

| measured | assumed | actually | builds lost |
| --- | --- | --- | --- |
| batches / chunks / `trak` boxes | pipeline running means signal present | a worklet emits zeros forever | 3 |
| `measuredFps` (render calls) | a render means a new frame | re-presenting the last frame is free and looks healthy | 2, twice (B519, B552) |
| fps against an assumed 60 | 60 is the target | a correct 30fps take read `critical` | 1, plus a mis-armed governor |
| `pip draw` = 0.17ms | cost is inside the call | the call *caused* 41ms elsewhere | 2 |
| output resolution (`scale`) | cost scales with pixels written | ~11.5ms fixed per draw; cost is sampling the source | 4 |
| `bus.running \|\| externalDisplay.active` | these mean "broadcasting" | both false during an HDMI broadcast | 3 |
| a timed calibration window | the window contains speech | it opened on silence, then on room tone | 2 |
| "4K is selected" | the setting reaches the encoder | hardcoded 2048 cap; every 4K number was 1080p | a whole sub-arc, withdrawn |
| `finalizeMarks` | the mark is a duration | it is a start timestamp, so I published a backwards table | 1 |
| `onReport(fn)` returned | subscribed | a single slot; the second caller replaced the first | 1 |
| `calls` counter | uploads | shell timing-wrapper invocations | caught pre-device |

### The unifying cause, and the rule that follows

**Every one of these instruments sits on the near side of a boundary we do not own**: WebKit's compositor, another process, the iOS audio unit, the muxer library, the GPU driver, a native plugin. We instrument what we can reach, and the failures live where we cannot.

> **RULE: when the phenomenon crosses a boundary you do not own, an instrument on your side is a proxy by construction. Measure a CONSERVED quantity, one that must survive the crossing, or measure at the far end.**

Every investigation in this arc that ended in a *single* reading used a conserved quantity: **peak amplitude** (survives the WebAudio graph), **arrival counters** (survive the socket), **fps measured on the display** (survives the process boundary), **the finished file's actual dimensions** (survive the encoder).

---

## 4. The absence problem

**A rule that can decline to act must publish why.** An absence, whether a surface that did not move, a counter that stayed at zero, or a message that never appeared, is compatible with "declined correctly", "never subscribed", "predicate false" and "never reached". Those are indistinguishable from outside, and this arc shipped all four.

Three consecutive governor builds had *no observable at all*. The fix was not a better measurement of the phenomenon. It was making the rule narrate its own decisions (`reason`, `ticking`).

---

## 5. Instrument perturbation

Before trusting a reading, ask what the act of observing changed. Real incidents:

- **B572**: opening the frame-cost panel *switched the governor off* (single-slot `onReport`). The instrument disabled the subject.
- **B569**: opening the output panel acquired the mic, which interrupted the iOS audio session and **paused the program**.
- **B538**: the panel's restore-on-close was about to sabotage the experiment it was there to run.
- **Standing**: on WebKit, `performance.now()` around a draw call measures *submission*; under saturation it measures *blocking*. The instrument's meaning changes with load (B529).

---

## 6. Pre-flight: every build

Five lines. Costs a minute. Goes in the response, not just my head.

1. **Goal, and which exit criterion this advances.** ("None" is a legal answer and means stop.)
2. **Uncertainty state: A / B / C / D**, and the legal move for it.
3. **Class 1 questions on this path: resolved?** If no, resolve them before anything else.
4. **What this measurement cannot distinguish.**
5. **Stopping rule**: the result that means stop, and the result that means change direction.

## 7. Full form: opening an investigation, or requesting a device run

- arc goal and relevant exit criterion
- the exact phenomenon, stated as an observable
- uncertainty state (A/B/C/D)
- competing hypotheses, at least two
- the causal quantity that distinguishes them
- what the proposed measurement **actually** measures (section 3 sentence completed)
- what it **cannot** distinguish
- surviving alternative explanations
- whether the instrument could perturb the phenomenon (section 5)
- what evidence would **falsify** the leading hypothesis
- the single highest-information experiment available
- **the stopping rule**: what result stops, changes direction, or proceeds

---

## 7b. Scope triage: three buckets, not two

Daniel's B575 question: the MIDI mapping bugs are clearly out of scope, but the intermittent 4K playback failure is ambiguous because *it blocks our ability to test reliably*. The two-bucket model (arc work / backlog) has no place to put it, which is why it kept getting picked up and dropped.

There are three buckets:

| bucket | test | budget |
| --- | --- | --- |
| **ARC WORK** | advances one of the five exit criteria | the arc's budget |
| **INSTRUMENT MAINTENANCE** | **blocks our ability to run an experiment at all** | fixed, declared up front, and it buys a capability rather than a feature |
| **BACKLOG** | everything else, however annoying | zero, until the arc closes |

**The deciding question is not "is it a bug in this arc's code." It is "does this prevent a measurement we need."** A 4K clip that will not play blocks every 4K experiment, so it is instrument maintenance and it is legitimately in scope. A joystick 45 degrees off does not block any measurement, so it is backlog regardless of how easy it looks.

**Instrument maintenance still gets a declared budget**, because it is the bucket most likely to balloon. One build, or one clearly-scoped investigation, then it reverts to backlog with what was learned written down. "It blocks testing" justifies *starting*, never *continuing indefinitely*.

Daniel's own framing at B575, worth keeping verbatim: *"straightforward tasks to retain some sense of momentum"* is the pressure that produces bucket errors. **Momentum is not a bucket.** If a task is being picked up for momentum, it belongs in backlog and the honest fix is a shorter feedback loop on the real work.

## 8. Device-run discipline

The expensive resource is Daniel's device time. Each run must be maximally informative.

- **Batch by variable, not by fix.** One sitting should let him *vary* something and read both answers. An A/B switch in the panel is worth more than two builds.
- **Every verify step states both outcomes and what each one means.** If one outcome is uninformative, the step is not ready.
- **Never ask him to watch a number whose semantics have not been verified in code first.** (The `calls` incident: I asked him to watch a counter that counted something else.)
- **Never bundle unrelated cleanup into a diagnostic build.** Daniel's own words, B559: *"without creating messy conditions where other verification may result in us not knowing whether an issue relates to older or newer work."* B563 and B567 violated this two builds later.
- **A theory is not sharpened by one observation.** The "first 4K clip per session" repro was filed from one session and dead by the next. Three consecutive observations, or it stays labelled intermittent.
- **Archive the report.** Paste it into `docs/reports/BNNN-<scenario>.json`. Reports currently live only in chat and are lost, so every cross-build comparison costs another device run.

---

## 9. What we stop doing

1. **Shipping a fix while in state A.** Instrumentation only.
2. **Treating activity counters as evidence.** Batches, chunks, calls and render counts may ride along; they may never conclude.
3. **Bundling declutter, UI polish or opportunistic cleanup into a diagnostic build.**
4. **Asking for a device reading of an instrument whose semantics are unverified.**
5. **Sharpening a repro from a single observation.**
6. **Letting "make X fire" stand in for "is X the right X."**

## 10. What we keep, and formalize

1. **The A/B switchboard.** Highest information per device-second in the entire arc. B526 through B528 nailed the PiP with three decisive tables; the audio saga, which had no switch, took six builds of re-guessing.
2. **The exported report as the only diagnostic channel.** Repeatedly validated. Console is not a channel here.
3. **Conserved-quantity measurements.** Section 3. These are the ones that end investigations in one reading.
4. **Writing the negative result down.** "B527 did not work, and failing cleanly is the finding." "Withdrawn." The changelog's honesty is why this review was possible at all.
5. **Predicting before measuring.** B529 recorded a prediction and was wrong, and the surprise is what made the reading informative.
6. **Two-outcome verify steps.**
7. **Daniel's exit criteria (CAPABILITIES section 0)** as the standing relevance filter.
