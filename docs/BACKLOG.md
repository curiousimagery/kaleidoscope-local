# backlog

Living list of **incomplete / pending work**, grouped by **surface / family**. **This is a backlog, not a changelog** — when something ships it moves to `CHANGELOG.md` and comes out of here. Historical reasoning + shipped detail live in `archive/ARCHIVE-reasoning.md`, `CHANGELOG.md`, and git.

**Conventions:**
- **▶ NEXT** marks an item on the active arc's critical path; NEXT items float to the top of their group.
- Items are roughly **stack-ranked within each group** (top = higher priority / more ready).
- Bugs + quick wins are consolidated at the top as a running triage.

> **▶ SEQUENCE LIVES IN `PLAN-LIVE-READINESS.md` (B609).** This file says *what* is open; the plan says *in what order and why*, with the dependencies and the stopping rule for each item. If you are about to pick something up from here, check the plan first — the arc's documented failure mode is a well-defined item out-competing an important one.
>
> Cleaned 2026-08-13 at B599 (Daniel's ask): **this file holds future planned work and the context that serves it, nothing else.** 16 resolved or superseded sections moved to `archive/BACKLOG-resolved-b560-b598.md`. Closed verification sessions are in `archive/VERIFY-QUEUE-b573-b597.md`.
>
> Previously cleaned 2026-07-18; pre-cleanup versions in git history.

---

## ▶ how this file is organised (regrouped B704)

**The triage section was chronological, which scattered related items across a thousand lines.** It is now grouped by cluster, newest-relevant-first within each. Family sections (Fold Live, Motion, Export, Design system, Engine, Native, Strategic) follow unchanged below.

| group | what is in it |
|---|---|
| [GL context loss, crashes, session accounting](#-gl-context-loss-crashes-and-session-accounting) | **the largest remaining phase 2 work** |
| [Capability gating and honest labels](#-capability-gating-and-honest-labels) | **the other remaining phase 2 item** |
| [Loop builder, bake and the decode path](#-loop-builder-bake-and-the-decode-path) | several may already be closed by B699/B700 |
| [Broadcast, external display and the governor](#-broadcast-external-display-and-the-governor) | governor is default-off since B701 |
| [Input, forms, gestures and droste](#-input-forms-gestures-and-droste) | refinements; item 1.5 closed B657 |
| [Sources, cameras and audio](#-sources-cameras-and-audio) | |
| [Instrumentation and diagnostics](#-instrumentation-and-diagnostics) | |
| [Cleanup and consolidation](#-cleanup-and-consolidation) | code half gated behind phase 2 |
| [Product gaps, watch items, standing context](#-product-gaps-watch-items-and-standing-context) | not bugs |
| [Older device passes (B547-B594)](#-older-device-passes-and-running-lists-b547-b594) | **currency warning — probably part-closed** |

**Status tags in headers are not always current.** Where one contradicts its own body, it is marked `⚠️ HEADER STALE` inline. Items flagged `🔎 LIKELY CLOSED` need one check, not an investigation.

---

## 🧨 GL context loss, crashes and session accounting

**The cluster `PLAN-LIVE-READINESS.md` item 2 exists to close, and the largest remaining phase 2 work.** These were filed separately over ~150 builds and item 2 asserts they are one question: how many decode, encode and GL sessions we hold at once, and whether we release them. `archive/SESSION-AUDIT.md` is the read-only answer to that question; `conduit/sessions.js` (B681) is the running count. **The failures happen at ONSETS** — changing source, switching mode mid-broadcast, arming a take during a broadcast — not under accumulated load.

### ✅ [ROOT-CAUSED + FIXED B709 — THE ACTUAL CAUSE OF THE BLANK SOURCE] A FIFTH GL CONTEXT, UNWATCHED AND UNRECOVERABLE

**B708 was a real bug and not this one.** `yuv-renderer.js` creates its own `webgl2` context for the source panel's picture, and **had no `webglcontextlost` handler** — so no `preventDefault()`, so **the browser never offered a restore.** One loss was permanent.

**`grep "getContext('webgl"` returns two creators in this codebase.** B705 wired the four ENGINES and called it "all five GL surfaces", counting engines rather than contexts. **The grep is one line and would have found this immediately.**

**Daniel's own words separated the two contexts:** *"the source is lacking a picture and the reflections are showing."* Reflections = preview engine (watched, restored in 499ms). Source picture = this renderer (unwatched, gone).

**✅ FIXED B709** — watched via `gl-watch.js`, repaints from the held frame on restore, holds instead of throwing while lost, wired at both instances and in both chromes. New surfaces `yuv-source` / `yuv-camera`.

**⚠️ STANDING RULE, now the FOURTH instance of the shape:** B703, B706, B708, B709 are all *a recovery path that cannot start itself* — and B709 is the worst kind, a recovery path that does not exist. **Ask `getContext` where the contexts are, not the architecture diagram.**

### ✅ [ROOT-CAUSED + FIXED B708 — CLASS 1, NO DEVICE TIME] THE SOURCE STAYS BLANK AFTER LEAVING THE LOOP BUILDER

**`8-21-26-contextLoss-05.json`:** `planar · native decode · 0.0 in/s · ⚠ SOURCE STALLED 65.7s — socket open, offered 3219, took 3219, skipped 0 · ⚠ GL CONTEXT RESTORED ×2`.

**The cause.** `planeReader()` returns null while `seq === lastSeq`, which the engine reads as *"hold the last frame."* Correct **only while a last frame is held** — and `reinitGL` sets `planar = null`, destroying the uploader and its texture. `updateSourceFrame` rebuilds the uploader only inside `if (frame)`. **A paused clip offers no new frame, so the uploader is never rebuilt and the source stays blank indefinitely.** The frame itself was never lost; `latest` is still in the receiver.

**Daniel's split observation is what located it** — the dotted outlines return in perform and the image never does. 2D geometry from state is fine; the GL texture is not.

**✅ FIXED B708:** `read.resync()` drops the reader's history so the next call re-delivers the held frame; `reinitGL` calls it when restoring the provider; `native-video.js`'s wrapper forwards it; `native-camera.js` gets the same treatment so the two readers cannot diverge. `scratchpad/planar-resync-check.mjs` 8/8.

### 📐 [STANDING RULE EARNED B708 — THREE INSTANCES IN SIX BUILDS] A RECOVERY PATH THAT CANNOT START ITSELF

| build | cache the restore discarded | what should have re-filled it | why it did not |
|---|---|---|---|
| **B703** | the planar uploader | `updateSourceFrame` | gated on ELEMENT-path state |
| **B706** | the element texture | `reinitGL`'s re-upload | threw on a 0×0 element, nothing retried |
| **B708** | the planar uploader **and its texture** | the next frame off the socket | a paused clip has no next frame |

**The question to ask on every restore path: what re-fills this, and is that thing GUARANTEED to happen?** All three answered "an event that usually arrives," and each failed exactly where it did not.

**⚠️ And `offered === taken` held through all three.** Equal counts are not health; they are the absence of one specific fault. **B584's rule needs its precondition stated every time it is used** — *equal counts WITH A FROZEN PICTURE, confirmed from the screen* — which is what B702 got wrong and what made this one findable.

**▶ WORTH AN AUDIT, NOT YET DONE:** every other cache `reinitGL` discards. `sourceTexture`, `planar`, `gpuTimer` are the three it nulls; the first two now have starters. **`gpuTimer` has not been checked.**

### ✅ [ROOT-CAUSED + FIXED B706, VIA B705's INSTRUMENT] THE SURFACE THAT NEVER COMES BACK — `source has no dimensions yet`

**`docs/temp/8-21-contextLoss-04.json` named it in one session.** `gl-restore-failed · preview · why "source has no dimensions yet"`, and the same for `live-pip`, twice, six seconds apart. Daniel was scrubbing a 4K clip across the crossfade in the loop builder.

**The cause is ours, not the GPU's.** `reinitGL` rebuilds the context fine, then re-uploads the source; `setSource` throws on a 0×0 element, which is what a `<video>` reads for a moment mid-swap. With no planar provider to absorb it (the loop builder has none) the error rethrew, `sourceTexture` stayed null, and **nothing ever retried** — so the element guard in `updateSourceFrame` refused forever. **This is the second half of the B703 deadlock, and B703's own comment predicted it.**

**✅ FIXED B706:** transient failures queue a retry that `updateSourceFrame` completes once the element has dimensions; permanent ones (`maxTextureSize`) still throw. `reuploadPending` / `reuploadTries` are in the report. Harness `scratchpad/reupload-check.mjs`, 8/8.

**⚠️ WHAT IS STILL OPEN: the app died anyway.** B706 removes the permanent-black consequence; **it is unproven that it removes the CRASH.** The failed restores may have been a symptom of whatever killed the process. **▶ NEXT: re-run the loop-builder 4K crossfade scrub.** Survives + picture returns → closed. Still dies → a separate cause, now with a legible trail.

### ✅ [2026-08-21 — A PASS, AND WORTH RECORDING AS ONE] `8-21-contextLoss-03.json`: THREE SURFACES LOST, THREE RECOVERED

Preview restored in 982ms, external in 1.26s, live-pip in 2.3s. `reinitWhy: null`. Source row `3840×2160 · planar · native decode · 29.3 in/s`. **The recovery path works**, and Daniel's report matches: *"overall this session was much more reliable."*

**This is the reading that retires B704's withdrawn headline for good — `preview` recovers, and always could.** The brief source-panel blackout he saw is the ~1s loss-to-restore window, which is the system working rather than failing. **A loss that heals cleanly is a PASS.**

### 🚨🚨 [HIGH — Daniel, 2026-08-21, TWO REPORTS, THE BEST GL EVIDENCE THIS PROJECT HAS] THE PREVIEW SURFACE NEVER RECOVERS ITS CONTEXT, AND THE APP DIES WITH IT

**Reports: `docs/temp/8-21-contextLoss-01.json` (motion → perform) and `docs/temp/821-contextLoss-02.json` (mid-render).** Both are post-reload, so `priorTrail` is the whole evidence — which is exactly what it was built for (B661).

**Run 1 — the trigger is the mode switch, and it is 1.1 seconds wide.** Ambitious canvas pan + rotate keyframes on the 20.4s 4K clip, then switch to perform:

```
04:58:53.895  mode → perform
04:58:55.030  gl-context-lost      external     (+1135ms)
04:58:55.035  gl-context-lost      live-pip     (+5ms)
04:58:55.103  gl-context-restored  live-pip     ✅
04:58:55.587  gl-context-restored  external     ✅
04:58:55.664  gl-context-lost      preview      ← never restores
04:58:55.853  gl-context-lost      external     (second loss)
[app dies]
```

**Run 2 — same shape, 7 minutes into a 3193-frame render (4K source → 2.5K out):**

```
05:13:31      thermal serious · availableMB 5081 · footprintMB 38
05:20:48.022  gl-context-lost      preview      ← never restores
05:20:48.027  gl-context-lost      live-pip     (+5ms)
05:20:49.009  gl-context-restored  live-pip     ✅
[app dies]
```

**❌ WITHDRAWN B705 — ~~THE PATTERN, AND IT IS CONSISTENT ACROSS BOTH: `live-pip` recovers every time, `preview` recovers never.~~** **`preview` had no `gl-context-restored` mark and never had one** (nor did `mobile-preview`); the restore was never wired when B695 added the loss. **The absence was guaranteed by construction, so the preview may have recovered perfectly in both runs.** An absence is not evidence, and this one was read as the headline. B705 ships the mark; the question is now genuinely open and genuinely answerable. `external` recovers sometimes, and that reading is sound — it always marked both edges. **A 5ms gap between two surfaces losing context is not two events — it is one GPU-process-level event**, which is B580's finding (`IT IS THE WEBKIT GPU PROCESS CRASHING`) arriving with better instrumentation.

**⛔ IT IS NOT MEMORY, AND THIS IS THE CLEANEST DISPROOF WE HAVE.** `availableMB 5081`, `footprintMB 38` seven minutes before the death. Do not spend a session on memory.

**✅ THE INSTRUMENT SHIPPED AT B705** (`shell/gl-watch.js`) — four outcomes, all surviving the kill via `priorTrail`. **Stopping rule: one report containing any `preview` restore outcome.** Original framing below, kept because the reasoning is what produced the instrument.

**⚠️ WE COULD NOT TELL THE CANDIDATE CAUSES APART — uncertainty state B, so the move was an instrument, not a fix.** Either preview's `webglcontextrestored` **never fires**, or it **fires and `reinitGL()` throws**. The handler (`main.js:362`) catches, writes to `console` and `statusEl`, and **marks nothing** — so the outcome dies with the app. The `reinitWhy` field (B703) cannot help either: it lives on the engine, and the report is read after a reload. **Fix the instrument first: mark `gl-restore-failed` with the reason, so it lands in `priorTrail` and survives the kill.** Standing rule, violated here: *anything that can decline to act must publish why.*

### 🎬 [2026-08-21 — CLASS 1, FOUND BY READING, NO DEVICE TIME] THE VIDEO EXPORT HAS NO CONTEXT-LOST GUARD

`shell/video-export.js` checks exactly one abort condition, `shouldCancel()` (line 97). **There is no `isContextLost()` check anywhere in the export loop** — the codebase has only two, in `main.js:727` and `mobile/chrome.js:2967`, both in the reset path.

So when run 2's context died at frame ~N of 3193, **the export kept calling `frameAt` into a dead context for every remaining frame.** That is a plausible contributor to the app's death rather than merely a casualty of it, and it is certainly why the render produced no usable diagnostic of its own.

**✅ FIXED B705.** The loop checks `glLost()` **before** calling `frameAt`, and throws `code: 'gl-lost'` carrying the frame index — `graphics context lost at frame 1847 of 3193`. Passed at all three call sites (motion render, source-preview render, **loop-builder bake**), and both catch sites mark `export-aborted` so it survives the kill. **Detection and graceful abort, NOT prevention** — nothing in JS stops the GPU process dying. **Whether the export should then RESUME is a separate and larger question** — see the stage-manager teardown item.

### 🔨 [HIGH — Daniel, 2026-08-21] GLASS-BREAK RESET DOES NOT REACH THE BROADCAST

**Daniel: *"given that the broadcast is still running even though the app has reset, this is a great test for our fix to the glass break reset. update: it didn't reset the broadcast."*** In run 1 the app lost its panels while the external display kept looping the clip with the last slice keyframe still applied.

**That is architecturally expected and is still a bug.** The external view is a SECOND WKWebView with its own engine and its own process; it renders frames straight off the native FrameSocketServer. **It survived the app's death because it never depended on the app for frames** — only for state. B683 rebuilt `allEngines()`, and the external view's engine is not among them; it is reached over the bridge by `createSurfacePoster`, not by an engine handle.

**So reset is honest about what it did and silent about what it could not touch**, which is the failure mode CLAUDE.md names. Two things needed: reset must **re-post state to the external view** (or tear the presentation down and restart it), and it must **report which surfaces it could not reach** rather than implying a full recovery.

**⚠️ Operationally this is also a live-show hazard worth knowing now:** a dead app leaves the wall playing the last frame-state indefinitely. That is arguably the correct failure mode for a performance, but it must be a decision rather than an accident.

### 🚨 [HIGH — Daniel B583, intermittent] THE APP'S FRAME-SOCKET CLIENT CAN STOP RECEIVING WHILE THE EXTERNAL VIEW KEEPS PLAYING

**Symptom:** start the broadcast and every app panel freezes on one still. Slice edits still update the stills and the external display. Reproduced once; a fresh session with the same clip was clean, so it is intermittent and probably a race at broadcast start.

**Confirmed by reading, not guessed.** One native decode serves both webviews as two clients of one port. In the frozen report the app's client read `0.0 in/s` (with `upload` running 43x for 0.00ms) while the external client read 30 arriving/s. **The decoder never stopped.**

`FrameSocketServer.send()` filters `{ $0.ready && !$0.sending }` — a client mid-send is skipped for that frame — and `reapStalledLocked()` cancels one that has been sending 6s. At 4K each frame is ~12.4MB and the loopback already carries ~370MB/s to one client, so a second client joining is exactly when contention peaks. **B501 fixed the mirror image of this** (the external view failing to join while the app streamed), which makes a start-of-broadcast race the leading hypothesis.

**B584 shipped the instrument, not a fix** (uncertainty state B: we know what, not why). **STATUS: NO REPRO in two further B584 attempts, closed as watched rather than pursued** (Daniel's call, and the right one: chasing an intermittent with no repro is the trap this arc is named for). The instrument is in place, so the next occurrence answers it in one reading rather than costing a session. Read `srcFanOut.clients[].offered` vs `taken`:
- **equal, picture frozen** → the frames arrived and we failed to use them. Our bug, JS side.
- **`skipped` growing** → the fan-out is passing us over. Contention; the lever is the send path or a per-client budget.
- **`reaped` bumped, or `srcSocket.state: closed`** → we were dropped by the watchdog. B584's rejoin should now recover it; `reconnects` will say so.

**✅ AND THE SAME INSTRUMENT EXONERATED THE WIRE ON ITS FIRST READING, killing the hypothesis that built it.** B584 healthy run: **`skipped: 0` on both clients** over 4414 frames, `reaped: 0`, `closes: 0`. `offered` over `ageMs` = **29.33/s against a 30fps source, 97.8% delivery.** The claim in this item's previous revision — that ~5 frames a second were being lost to the fan-out — was **wrong, and wrong because `extJitter.arrive` is measured in the external view's `ws.onmessage` and is therefore downstream of the main thread it was being used to exonerate.** A textbook wrong noun, in an instrument, used to justify a second instrument. The native counter is the wire; prefer it.

### ✅ [ROOT-CAUSED + FIXED B703 — ⚠️ NOT DEVICE-VERIFIED] THE SOURCE FREEZES AFTER A GL CONTEXT RESTORE — kept for the reasoning

**It was a DEADLOCK in `engine/index.js`, found by reading, no device time.** `updateSourceFrame` was gated on `sourceTexture` and `sourceImage` — both ELEMENT-path concepts — so when `reinitGL`'s element re-upload threw (a zero-size preview canvas mid mode switch), `sourceTexture` stayed null, the guard refused to run, `planar` was never rebuilt, and the render fell back to the null texture. **Frozen permanently while the socket kept delivering**, which is precisely `offered 222, took 222, skipped 0` at `0.0 in/s`.

**Fixed by moving the guard below the planar block** (the planar path owns its own texture and needs neither) and restoring the provider in a `finally`. Proven in `scratchpad/planar-deadlock.mjs`: 0/5 frames consumed before, 5/5 after, with three regression guards. **Needs device confirmation on the original motion → perform repro.**

Original write-up below.

### 🚨 [HIGH — Daniel, B611] A RESET FIXES THE STAGED CANVAS AND LEAVES LIVE STUCK, WITH NO OBVIOUS RECOVERY

**The most damaging thing in the whole input cluster, because it happens mid-set and looks unrecoverable.**

Daniel's B611 repro, final step: after the droste blowup he goes to canvas settings and recentres. **The staged canvas is correct. The live canvas keeps zooming and never stops.** `env.panRecenter` resets the pan; **nothing resets the follower**, so live is still chasing an accumulated `drosteZoomPhase`.

**The escape hatch that works TODAY is CUT** — `pfCut` calls `follower.jump(state)` ([perform-runtime.js:659](../src/shell/perform-runtime.js#L659)), which hard-lands live on the staged state. Worth knowing mid-show.

**But requiring the operator to know that is not a fix.** A reset action that visibly corrects staged while live misbehaves is a broken affordance, and "live is stuck and I cannot get it back" is the worst possible failure during a performance.

**The shape of the fix, needing a decision:** which actions should SETTLE the follower rather than let it chase? A recentre and a canvas-reset are corrections, not performance gestures — the operator is saying "put it back", not "travel there". **Candidate rule: any RESET action jumps; any PARAMETER change eases.** That is a clean line and it generalises past this bug.

**Cross-ref:** `canvasReset` already zeroes `drosteZoomPhase` and calls `panRecenter`, so it is closer to correct than the settings recentre — but it still does not jump the follower.

### 🚨 [HIGH — Daniel, B623 post-show] A LIVE CAMERA RUNNING ~10 MINUTES BLOCKS THE NEXT SOURCE, AND ONLY AN APP RESTART RECOVERS

**Daniel's report, desktop/Electron, during a show.** iPhone via Continuity Camera as the live source for roughly 10 minutes, then he picks a file. **Nothing happens — no error, no visible attempt to load.** Manually quitting the camera did not help. He had to kill the app and reboot it to recover.

**Why this is the highest-severity item on the list.** It is silent (no error surfaces anywhere), it is unrecoverable in-app, and it happens on the source-swap path *during a performance*. Every other open bug has a workaround the operator can reach.

**What makes it tractable:** it is almost certainly Class 1 — readable in code. The file-open path is `source-host.js`, and the question is what a long-running camera leaves behind that blocks `setSource`. Candidates worth reading before any device time:
- the file picker's `img.onload` never firing because the object URL / decode is queued behind something the camera holds
- a camera-owned `engine.setPlanarSource` still attached, so the engine keeps sampling planes and ignores the new element
- `stopCameraStream()` not awaited, so the swap races the teardown
- `cameraMode` left in a state the file path guards against and returns early from

**⚠️ ANYTHING THAT CAN DECLINE TO ACT MUST PUBLISH WHY.** A dead end with no error is the exact failure the standing rule exists for. Whatever the cause, the swap path needs a reason string on every early return.

**Duration matters and is a clue** — 10 minutes, not 10 seconds. Suspect something that accumulates (frame buffers, object URLs, a growing plane queue) rather than a plain state bug.

### 🧨 [B667, RE-SCOPED B668, DOWNGRADED 2026-08-19 — INTERMITTENT, NOT DETERMINISTIC] ARMING A TAKE WHILE BROADCASTING LOSES THE GL CONTEXT

**⚠️ B667 SCOPED THIS TO 4K AND THAT WAS WRONG.** B668 lost the context arming an **FHD** take (`bus:start 1920x1080` at t=20, `gl-context-lost` at t=21). Five occurrences now — B661 fatal, B663 fatal, B666 twice, B668 once — at both resolutions. In the survivable form the take runs its full minute and encodes **zero frames**.

**✅ T3b RAN AND THE ORDER MATTERS: starting the broadcast UNDER a running take lost no context at all.**

**⚠️ BUT B667's "deterministic" was WRONG, and the same session's T3 also survived.** Five runs: three lost the context, two did not. **It is intermittent.**

**The new candidate, from what the five reports differ on:** every failing run began with a broadcast ALREADY LIVE that the script then stopped, re-tiered and restarted. Both clean runs began with none (`"why": "already off"` in the log). **So the suspect is the stop→retier→start cycle leaving the external view stale, not arming a take as such.** n=5, hypothesis only.

**Next discriminator, cheap:** run T3 twice back to back without touching anything between, so the second run's broadcast is one the script itself created. **Do not build a capability gate on this until it is isolated** — the additive cost model above is a better basis anyway, and it is measured rather than inferred.

**And the 4K take is unusable even unopposed** — 13.4fps against a declared 30 with nothing else running and the app at 59fps.

**Three candidate answers, most honest first:**
1. **Cap the take tier while a broadcast is live**, and say so where the tier is chosen. Cheap, and it matches the existing `videoHdmiCapped` precedent for a memory guard.
2. **Refuse the combination** with a clear message. Blunter but unambiguous.
3. **Make the take the priority and shed the broadcast** — right for a deliverable, wrong for a live show, so it cannot be the default.

**✅ B681 SHIPPED THE INPUT IT NEEDS: `conduit/sessions.js`.** The gate could not be computed before because nothing knew what the app was holding. `sessions.peak.decode` / `.gl` / `.encode` is now in every report, so a rule like *"refuse a 4K take while a 4K broadcast is live"* can carry the count that justifies it instead of a device name. **Still to decide: which fps each rung keys on** (T7/T8 give real numbers now: ~20 app / ~19 wall sustained at 4K, indefinitely, on adequate power).

**⚠️ THE GATE MUST BE COMPUTED, NOT A DEVICE TABLE** (Daniel's standing requirement). We own the top of the hardware range and none of the bottom, so a limit calibrated here would be calibrated on good hardware. The learned-ceiling pattern (`broadcastCeiling`) is the shape to copy, and the flight recorder already persists the exact combination that preceded a context loss.

### 🧮 [2026-08-21, Daniel's question — READ, NOT YET MEASURED ON DEVICE] MODE CHANGES STACK DECODERS; SOURCE UPLOADS DO NOT

*"could the fact that we don't shed before acquiring be related to crashes where we upload a new source or change modes?"* **Half right, and the half that is right is the one nobody has counted.**

**UPLOADS ARE FINE.** `loadVideo` / `loadImage` shed first, in order, before anything new is created:

```js
if (env.live.isLive || env.live.frozen) stopCameraMode({ keepSource: true });
releaseSourceVideo();          // the outgoing decoder, released
env.detachNativeVideo?.();     // the native decode, detached
...then the new <video> is created
```

**MODE CHANGES DO NOT SHED, BY DESIGN, AND THE DESIGN IS CORRECT — but nothing counts the total.** Entering motion keeps the source `<video>` alive on purpose (`stopSourceVideoPlayback` is pause-only, because the clip must stay loaded) and `stage-source.js begin()` then acquires a THIRD decoder for the staging seek.

**And the loop builder adds three more on top of whatever mode you were in** (`clip-editor.js`): preview, A-head crossfade, thumbnail strip, all on the same URL.

**So the readable worst case is six concurrent decode sessions of ONE clip:**

| # | session | acquired by |
|---|---|---|
| 1 | source clip `<video>` | `source-host.js` |
| 2 | native decode (AVPlayer) | `native-video.js` |
| 3 | staging seek decoder | `stage-source.js` (motion) |
| 4-6 | loop builder × 3 | `clip-editor.js` |

**That is the same number the pre-B681 audit predicted from LEAKS — reached here entirely by legitimate, released-on-exit acquisitions.** Releasing correctly does not help if the peak is the problem.

**▶ THE MEASUREMENT IS CHEAP, NEEDS NO DISPLAY, AND WORKS ON B695 OR LATER:** load a clip, enter motion, open the loop builder, copy a report, read `sessions.peak.decode` and the `live[]` labels. **If it reads 6, this is a real ceiling risk and the shed-before-acquire policy (session audit step 3) has its first concrete target.** If it reads 3 or 4, some path already tears down and the model above is wrong.

**⚠️ AND "SHED BEFORE ACQUIRE" IS THE WRONG FIX FOR THE STAGING DECODER SPECIFICALLY** — that second decoder IS staging; releasing it removes the feature (B495 proved exactly that). The candidate targets are the loop builder's three, which could plausibly be two, and whether the staging decoder is released when the loop builder opens over it.

### 🚧 [Daniel, 2026-08-21 — NAMED AS MISSING FROM THE PLAN] PROVOKE GL CONTEXT LOSS DELIBERATELY, THEN CYCLE DIAGNOSTICS

*"2) attempting to create scenarios where GL context loss bugs pop up and cycling through diagnostics for root cause and fixes."* **Also missing from the ledger. This is the largest remaining piece of phase 2.**

**✅ THE LISTENING SIDE IS NOW READY (B695, B699, B703).** All five GL surfaces mark `gl-context-lost` / `gl-context-restored` with a `surface` field; mode changes are breadcrumbed; the bake decoder is counted; and `reinitWhy` reports a restore whose element re-upload failed. **Before B695 four of five surfaces were console-only, so a provoked loss would have been mostly unobservable.**

**Known provocations, from the record:**
- attaching a 4K external display drops every GL context in the app (the B382 cluster)
- the stop → retier → start broadcast cycle preceded every one of the five historical failures
- rapid mode switching while manipulating large slices (Daniel's own proposed stress test)

**▶ READ THE REPORT IN THIS ORDER AFTER ANY FAILURE:** `priorTrail` (survives the kill) → `trail` (this run) → `reinitWhy` (did recovery half-fail) → `sessions` (what was held) → `sourceSwap` (what had just been loaded).

**⚠️ B703 MAY HAVE ALREADY FIXED THE MOST COMMON CONSEQUENCE.** The freeze-after-restore deadlock is fixed, so a provoked loss should now heal itself. **A stress test that provokes losses and sees them recover cleanly is a PASS, not a null result** — record it as one.

### 🔴 RECORD + BROADCAST ON iPAD LOSES THE SOURCE AND THEN THE TAKE (Daniel, B571)

Starting a take during a 4K HDMI broadcast: **source panel, stage panel and thumbnails all go dark** (Daniel: "akin to old context loss"), playback on the display gets *smoother*, stop does not save, and pausing the broadcast reports **`take FAILED: null is not an object (evaluat…`** with no recovery.

**Two known bugs firing together, both already filed, now confirmed on iPad:**
- **D3's signature exactly:** the report reads **`bus … capture: null`** with `readback` and `render` at **0 calls**. The bus is registered but not running and the capture probe never resolved to a mode. B549 fixed `failOutput` tearing down a `needsBus:false` destination; this is the same lifecycle defect from the other direction — arming the second consumer kills the first.
- **The `decoderConfig.colorSpace` crash**, filed from B516 as an iPhone FHD failure, is not iPhone-specific. The take dies because the encoder's first chunk arrives without `decoderConfig` (or without `colorSpace`) and the muxer dereferences it unconditionally. **Guard the first-chunk path** — this is a small fix and it converts a lost take into a working one.
- **The dark panels are NOT a governor degradation** (the governor was inert — `target: 0`). Daniel's read is right: it looks like context loss.

**🎯 B574 ADDS THE MISSING HALF, and it moves the suspicion off the bus.** The take-failure report shows the `source` surface reading:

```
1280×720   "from canvas · native decode · 26.1 in/s"   refresh 0ms   upload 3.52ms
```

**No `planar` in that note, and the dimensions are `PREVIEW_CAP`.** So at the moment the take starts, the main engine has been knocked off the planar provider and is uploading `native-video.js`'s 1280-wide RGB *preview* canvas instead — which is the cross-context readback B518/B541 removed, silently back on, and the `refresh 0ms / upload 3.52ms` split is the fingerprint of exactly that swap.

That reframes the bug. **`capture: null` on the bus may be a consequence rather than the cause**: something re-sources the engine when a take arms, and the dark source/stage/thumbnail panels are the same event seen from three other places.

- **▶ FIRST SUSPECT — the filmstrip build.** `motion-runtime.js:1158` does `engine.setSource(still)` per cell with the comment *"retires the planar provider; restored below"*, and restores it in a `finally`. The **timeline going blank alongside the source** is exactly what an interrupted or half-finished filmstrip build looks like. Check whether arming a take invalidates the filmstrip signature and kicks a rebuild, and whether every exit from that loop truly restores the provider.
- **▶ SECOND SUSPECT — `output-engine.js:112 syncSource`.** It re-`setSource`s the hidden bus engine when dimensions change, and it *holds* while `env.filmstrip.busy`. If a filmstrip build is in flight when the take arms, the bus engine skips its source sync for the duration — which would leave the capture probe with nothing to resolve against. That would tie `capture: null` and the dark panels to a single cause.
- **▶ THE READING THAT SPLITS THEM:** publish `filmstrip.busy` and the planar state into the report. If `busy` is true at take-arm, it is the filmstrip; if it is false and planar is still gone, it is the take path re-sourcing directly. **One line in the export, one device run, no guessing.**
- **Alternative reading to rule out first:** Daniel may simply have had a 720p clip loaded for that take. **The absence of `planar` is the load-bearing signal, not the resolution** — a natively-decoded 720p clip would still report `planar` — but confirm the source before building on it.

**▶ DANIEL'S PRIORITY ORDER, recorded as the contract for every future degrade decision:**
> **broadcast → recording → source → stage → live PiP**

Note this refines the ledger's four tiers: `source` sits ABOVE the stage/preview, which the current `PRIORITY.PROGRAM/EDITOR` split does not express (source is PROGRAM at 90, preview and PiP are both EDITOR at 30, so nothing distinguishes stage from PiP). **The ladder needs a fifth rung or an explicit ordering within EDITOR.**

### 🚨🚨 IT IS THE WEBKIT **GPU PROCESS** CRASHING, NOT A GL CONTEXT LOSS (Daniel's Xcode log, B580)

**This renames and re-scopes the entire context-loss cluster.** From `docs/temp/iPadConsoleLog-Aug10-01.txt`:

```
GPUProcessProxy::didClose:
GPUProcessProxy::gpuProcessExited: reason=Crash
WebProcessProxy::gpuProcessExited: reason=Crash
GPUProcessConnection::didClose
  → [fold] WebGL context LOST (live PiP)
  → [fold] WebGL context LOST (preview canvas)
```

**The GPU process is shared across WebContent processes**, so its death takes every WebGL context in the app simultaneously — the app's preview and PiP, and the external view in its own WebContent process. That is why this has always presented as "the whole session broke" rather than "a canvas broke", and why source + stage + PiP go dark together.

**So the target is not "recover from context loss" (B580 did that, and the log proves it worked). The target is why the GPU process runs out of resources.** Leading suspect is 4K memory across processes: preview engine + PiP engine + external view engine + 4K source textures + planar uploaders, all resident on one GPU process.

- **▶ THIS SUPERSEDES** the "FHD→4K source switch causes context loss" framing below. Same phenomenon, correctly named.
- **▶ It also reframes B382's long-standing external-display/GL-context cluster**, which has been open for dozens of builds under the wrong noun.
- **▶ AND IT IS EXIT CRITERION 5 WORK**, not a side bug: "we can honestly rank how intensive each thing we do is" now has a hard failure mode attached. A GPU process that dies IS the resource ceiling, stated by the platform.
- **Instrumentation we have:** `engine.glGeneration` (B580) counts restores and rides the source note, so a session that survived one is no longer silent.

**▶ DANIEL'S QUESTION (B580): can we detect the per-device threshold in realtime, to warn and throttle? Answer: not by reading it, but yes by LEARNING it.**

**What is not available, and will not be.** WebKit exposes nothing about GPU-process memory to JS. `performance.memory` is Chromium-only and reports the JS heap rather than GPU allocations. The GPU process is a *separate* process from our app, so even a native plugin calling `os_proc_available_memory()` measures the wrong process. **There is no realtime number to read.**

**What we can do instead, and it is the arc's own governing principle (CAPABILITIES §1, probe never classify):**
1. **Count what WE allocate**, which is arithmetic we fully control: source texture, planar planes, FBOs, per engine, plus the external view's own set. Publish it as `estGpuMB` per surface. It is an estimate of our contribution, not of the ceiling, and must be labelled as such.
2. **Treat `webglcontextlost` as the ground truth**, because it is the device telling us it failed. `glGeneration` already counts it. **Record the WORKLOAD SIGNATURE at the moment of the loss** — source megapixels, output megapixels, engine count, broadcast on/off — and persist it per device.
3. **Learn the ceiling from that.** A device that has died once at (4K source, 4K out, broadcast, PiP on) is a device that should be warned, or pre-degraded, before it gets there again. **We cannot predict the ceiling, but we can remember where the floor gave way**, which is enough for a guardrail and is exactly what exit criteria 3 and 5 ask for.

**The honest limitation to state up front:** this learns from a crash. The first user on a new device still hits it. That is a real cost and it is why (1) matters as well: our own footprint estimate, compared across devices that HAVE crashed, is what turns one device's experience into a prediction for others.

### 🔴 TWO DISTINCT CRASHES, DO NOT CONFLATE THEM (same log)

- **Crash A — WebContent dies immediately after the FIRST `frameAt` on a fresh 4K clip, with no context loss anywhere before it.** The still generator. This is the standing B519 CRITICAL wearing its most severe face, and it is unrelated to the GPU-process story.
- **Crash B — GPU process crash → contexts lost → restored correctly at 4K → ~10s healthy → WebContent dies.**
- **A third load in the same session succeeded and ran normally** (many `frameAt` calls, seeks, pause/resume), so neither is deterministic on load. **Do not sharpen either from one session** (the standing rule after B573's cold-start theory).

### 🟠 THE EXTERNAL VIEW IS THROWING A SHADER-COMPILE LOOP (Daniel's B579 reports, `extLogs`)

**The first error `extLogs` has ever carried**, so B573's republish fix earning its keep a second time.

```
[fold ext] uncaught: Error: compile failed @ .../test-pattern-*.js:111
[fold ext] uncaught: TypeError: Argument 1 ('shader') to WebGL2RenderingContext.shaderSource
           must be an instance of WebGLShader          × ~19
```

A shader compile returned null and every subsequent call passed that null straight back in. Present in **all three** B579 reports, during an ordinary broadcast with no test pattern requested.

Two questions, in order: **why is the test-pattern module compiling shaders at all during a normal broadcast**, and **is the compile failing because the view's GL context is under pressure** — which would tie it to the FHD→4K context-loss item. `createShader` returning null is what a context that is lost or out of resources does. Cheap first check either way: whether it appears on a fresh session before any pressure.

### 🟠 A MODE SWITCH DURING "preparing clip for native playback" MAY CORRUPT THE UPLOAD (Daniel, B571 — theory, not reproduced)

Daniel's own hypothesis for the 4K clip that would not play, and it survived a rebuild (the same clip plays now): he may have changed modes while the native upload/attach was still running. **Worth auditing whether any user action can interrupt that operation** — mode switches, source swaps, entering the Loop Builder — and either blocking them for the duration or making the attach cancel-safe. Cross-ref B570's decode-error publishing, which will name the failure if it recurs.

---

## 🪜 Capability gating and honest labels

**Exit criteria #1 and #2** (`CAPABILITIES.md` §0). **The gate must be COMPUTED, never a device table** — `HARDWARE-SUPPORT.md` owns that rule and `CAPABILITIES.md` §5 is the nearest thing to a spec. The cost model came out **additive in frame time** (B683 era), which is what makes a computed gate possible at all.

### 🪜 [Daniel, 2026-08-19 — SPEC GIVEN, NOT BUILT] THE CAPABILITY LADDER: WHAT GETS GATED, WARNED, OR FLAGGED

**Daniel's rubric, verbatim in shape, tied to consequences rather than to features:**

| consequence | response | where |
|---|---|---|
| high risk of the app crashing | **don't allow it** | — |
| fairly certain the broadcast will run <15fps | **don't offer it as supported** | — |
| happy path 25-30fps, but aggressive input could pull it to 10-20 | **warn proactively, with hints to improve output** | inline, at the choice |
| actually broadcasting at <20fps for more than a few seconds | **red health indicator, prompting a lever to pull** | live PiP, or the planned notification bar under the app bar |

**Placement examples he gave:** record is a **disabled button with a tooltip** during a broadcast; selecting 4K broadcast on this class of hardware (**detected by capability, never hardcoded to a device**) gets an **amber inline warning in the output dialog**.

**His principles:** *"I don't like automatically forcing a failure or settings change, but this is preferable to a full crash."* And: *"build in preventive guardrails where full failure scenarios are basically nonexistent and poor perf scenarios are adequately instrumented to detect issues and let folks throttle settings in exchange for fps as needed."* **The user pulls the lever; we make sure they can see it.**

**⚠️ THE ONE THING THE SPEC HAS TO RESOLVE BEFORE IT CAN BE BUILT: which fps.** Rows 2-4 are about the BROADCAST's rate; the model we can predict from is the APP's rate, and the two are decoupled (the governor's own null result, plus a run holding 29-of-30 on the wall at 12fps in-app). **`wallFps` shipped at B670 so the broadcast rate is finally a time series** — the mapping from predicted app cost to expected wall rate is the missing link, and it is measurable now rather than assumable.

**Ladder rungs, in build order:**
1. **Measure this device's costs** — needs a deliberate quiet baseline (see the idle-baseline caveat below), then each output's marginal frame cost.
2. **Predict a combination before it runs.** Already validated once: FHD broadcast + FHD take predicted ~13fps, measured 11.2 and 12.0.
3. **Act** — the table above.

**⚠️ RUNG 1's WEAK LINK:** the idle baseline is not stable. It read 60fps in one run and 37-41fps in another, because "idle" was a gap between two takes with the external view still tearing down. **A cost measured against a moving baseline has error bars**, and the baseline is also vsync-capped, so a fast device's true headroom is invisible. **Rung 1 needs its own quiet measurement, not a gap in a script.**

### 📐 [2026-08-19 — THE GATE IS NOW COMPUTABLE] OUTPUT COSTS ADD IN FRAME TIME

Measured on the M1 iPad Pro across two B669 runs: broadcast **+25.9ms/frame**, take **+35.1ms/frame**, both together **+72.6ms** against a predicted 61ms. **Slightly super-additive, close enough to predict from.**

**This is the answer to Daniel's standing requirement** — *"ideally we wouldn't have to hard code these limits by device but we'd understand which constraints were being hit and gate/warn accordingly based on any permutation of devices."* A device measures each output's cost once, at runtime, and any combination is a sum against the frame budget. **No model table, and it reaches hardware we do not own.**

**The shape to copy is `broadcastCeiling`** — a learned per-destination number already persisted the same way.

**What has to be decided before building it** (Daniel's call, not mine):
- **Warn or refuse?** A predicted 11fps is honest to warn about; refusing removes a capability someone may knowingly want.
- **Where does it surface?** The tier picker is the one moment the choice is safe to make (`locks.js` freezes it while live), which argues for a sentence there.
- **Does it ever act on its own** — auto-capping the take tier — or only ever advise?

**⚠️ AND THE FIRST OPTIMIZATION TARGET CHANGED.** A take costs MORE than a 4K broadcast (+35 vs +26ms). The whole arc assumed the broadcast was the expensive thing.

### 🚧 [Daniel, 2026-08-21 — NAMED AS MISSING FROM THE PLAN] GATE RECORDING ON DETECTED CAPABILITY

*"I don't see anything on your plan about two of the more important tests that i am remembering: 1) gating recording based on detected device capability."* **He is right — it was on the ledger as a vague "thermal-aware gate" and had never been scoped.**

**⚠️ COMPUTED, NEVER A DEVICE TABLE** (his standing requirement). See `docs/HARDWARE-SUPPORT.md` for why the matrix and the gate are different artifacts.

**What the evidence now supports, by his own rubric:**

| tier | rule | evidence |
|---|---|---|
| **refuse** | 4K takes | **13.4 and 13.8 fps** against a declared 30, across two devices, two builds, and before/after the decoder-release work. Structural, not headroom. |
| **warn** | recording while broadcasting | 12.7 vs 19.8 fps, a 36% cost. **Intermittent GL loss did NOT reproduce on B698.** Not a crash risk any more. |
| **warn** | recording while thermal is `serious` | **40.0 → 19.8 fps** on the same device, same tier, minutes apart. **The single largest effect measured this arc.** |

**⚠️ THE INPUT THAT IS MISSING FROM EVERY EXISTING GATE IS THERMAL STATE**, and it is the strongest predictor we have. `createPressureSource` already consumes it and the vitals plugin already reports it, so the signal exists and nothing gates on it.

**Still needed before the "warn" rules are honest:** FHD-while-broadcasting has never been measured on a COOL device. Every run of that combination was at `serious`. The refuse rule for 4K needs nothing further.

### 🎬 [QUEUED 2026-08-21, Daniel's ask] RE-VERIFY RECORDING ON THE CURRENT BUILD — THE OLD EVIDENCE IS STALE

**Why this is queued rather than gated:** every record-while-broadcasting failure on record is **B661, B663, B666, B668**. The session registry and the orphaned-decoder release landed at **B681**. The audit that prompted that fix found the source `<video>` was orphaned on *every* swap, peaking at five or six live decoders of one clip, counted by nothing.

**So the entire evidence base predates the fix for a resource-exhaustion problem that could plausibly have caused it.** Daniel spotted this: *"the permit management system you've implemented i think is new since we tested recording while broadcasting on ipad. I wonder if theres a chance this might have actually addressed a root cause limitation for at least some of our failure states?"*

**Building a capability gate on those numbers would encode a limit that may no longer exist.** T10 (B695) supports the concern: `sessions` peak was `{ total 4, gl 2, decode 2 }` and conserved, where the pre-fix audit predicted 5-6 decoders alone.

**Three tests, in this order. The first two are the CONTROL CONDITION and have never been run:**

1. **FHD take, nothing else running.** Never measured. Every FHD number we have comes from a run with a broadcast live.
2. **4K take, nothing else running.** Last measured at **13.4fps against a declared 30** with the app at 59fps — but that was pre-B681 too, so it needs refreshing before anything is built on it.
3. **T3 again (take while broadcasting), unchanged rig.** Three outcomes, all useful: it passes (the decoders were the cause and there is no gate to build); it fails (the evidence is refreshed and the gate gets real numbers); it fails differently (that is the isolation this has needed since B667).

**⚠️ DO NOT BUILD THE TAKE-TIER CAP BEFORE 1 AND 2.** The 13.4fps figure is the only justification for it and it is from the leaking build.

### 🖥 [OPEN — Daniel, 2026-08-19] THE PERMIT WORK IS PLATFORM-NEUTRAL. THE LIMITS ARE NOT.

Daniel: *"is this iOS only or does this work carry over to electron... ideally our architecture could support an M1 iMac just as well as an M1 iPad."*

**What already carries, with no further work:**
- **`conduit/sessions.js` is platform-neutral** and registers in shared code. `createEngine` is the same function on every target, so GL contexts are counted on Electron, web and iOS alike.
- **The Finding A fix is in `shell/source-host.js`, which is the DESKTOP chrome** — the one Electron, the browser and the iPad all run. The orphaned decoder was leaking on macOS too; it just had the headroom to hide it.

**What does NOT carry, and must not be assumed:**
- **The native decode path is iOS-only.** The 8s deadline, the frame socket and the double-decode fallback have no Electron equivalent — Electron plays a `<video>` and the output window opens a second one. **Structurally the same two-decoders-one-clip shape, without the hard OS cap.**
- **The ceiling itself.** iOS kills the GPU process; macOS mostly just gets slower. **Same architecture, different failure mode**, so a threshold measured on the iPad must never be copied to the desktop as a limit.

**The open work, and it is small:**
1. **Wire the Electron/output-window second decoder into the registry** the way the external view's is — `output-view.js` runs in both, so most of this is already done; confirm rather than assume.
2. **Run T7 on the desktop build** and record `sessions.peak` there. **We have never had a desktop number** — B479's "watch Electron desktop HDMI for the same wall under heavy video" has been open since.
3. **Keep ONE computed ladder, not two code paths.** The rung is a measured fps and a session count; the M1 iMac and the M1 iPad differ in what they can sustain, not in how we decide. **This is the whole reason the gate must be computed** — a device table would need a row per machine and would still be wrong on the next one.

**⚠️ SESSION AUDIT STEPS 3 AND 4 ARE THE OPEN HALF (B681 shipped 1 and 2).**
- **Step 3 — shed before acquiring at the three unguarded transitions**: change source while broadcasting, enter perform mid-broadcast, arm a take during a broadcast. **The precedent exists and works**: the Loop Builder and the bake post a `notice` to the external view, which tears down its own decoder outright *"because a 4K bake and a 4K external render at the same time is what restarted the app"*. It was simply never extended to the other three.
- **Step 4 — gate**, using the live count rather than a device table. See the capability-ladder item.
- **⚠️ Do step 3 only after a B681 report shows real numbers.** The audit says what the code CAN hold; a shed rule written against what it can hold rather than what it does is a guess with a table in it.

**⚠️ STILL OPEN, and they were meant to ride the same Xcode cycle — they did NOT get built:**
- ~~`loopCache.coveredMs` under-reports coverage by one frame interval (Swift), so its `why` advises raising a budget that is already sufficient.~~ **✅ FIXED B684** — it was reporting `last.pts`, a timestamp rather than a duration. Now `(lastPts - firstPts) + frameInterval`, shared with the `why` so reading and advice cannot disagree.
- ~~`listCameras` for external/USB cameras on iPad.~~ **✅ SHIPPED B684**, end to end (Swift enumeration + `deviceId` selection + JS seam + a `camera source` row). Needs an Xcode build.
- The `scenario` tag is a manual dropdown and read `idle-still` during a 4K broadcast at B609, which invalidates any baseline diff from that session. Wants a guard that notices it disagrees with what is running.
  - **⚠️ PROMOTED 2026-08-19 — IT HAS NOW COST A SECOND COMPARISON, AND THE SECOND ONE IS EXPENSIVE.** A clean 40-minute T7 came back with the battery flat where the previous run drained 22.5%/hr, **and the report cannot say which power path or which video path it used.** The list in `shell/perf-panel.js` (`SCENARIOS`) has **no AirPlay entry at all**, so an AirPlay broadcast is necessarily filed as `hdmi-broadcast`. Forty minutes of device time is now pending an answer no instrument recorded. **Derive the tag from the live destination** (`selectedDest()` already knows) and let the dropdown override rather than originate. Do this before the next power run.

**First use, before any long run:** `pressure.js` shipped inert on purpose, *"to find out whether the inferred signal actually tracks the native one, BEFORE anything starts degrading the app based on it."* Native thermal is what makes that check possible — and it matters beyond iOS, because the inferred drift signal is all the desktop arm will ever have.

### 🟠 THE PRESSURE TARGET CAN HALVE ITSELF UNDER LOAD, AND THAT IS CIRCULAR (Daniel's B580 report)

One report reads `pressure: { target: 15, label: "warming up" }` on a 30fps clip while `srcArrive p50` is 30ms (i.e. ~33 arrivals/s, perfectly healthy). `videoWireFps()` snaps the measured arrival rate to 0/15/30/60/120, and a single slow sampling window drops it into the 15 bucket.

**The failure is circular: struggling → a sampled window under 20/s → target halves to 15 → shortfall drops → the governor concludes we are fine.** Exactly the shape B559 split `shortfall` from `pressure` to avoid, reintroduced through the denominator instead of the numerator.

**▶ The fix is to take the target from the CLIP's declared frame rate rather than the observed arrival rate**, since a clip's fps is a property of the file and does not degrade when we do. Observed arrival stays as the fallback for sources that cannot declare one.

---

## 🔁 Loop builder, bake and the decode path

**Several of these predate B700's first-frame deadline fix and B699's decoder registration, and may already be closed.** Flagged individually below. The loop hold itself closed at B608 and T10 re-confirmed it (8 wraps, 6ms worst gap).

### 🐛 [Daniel, 2026-08-23 — DESKTOP/CHROMIUM, NOT DIAGNOSED] THE FIRST SOURCE FRAME DOES NOT LOAD UNTIL YOU SCRUB

**Daniel: *"we have a regression where the first source frame doesn't load, but scrubbing the timeline activates it."*** Brave/Chromium, desktop web build.

**Not diagnosed, and deliberately not guessed at.** Nothing in B706-B714 obviously touches the desktop element-load path, and he notes this is his first browser test in a while — **so it may predate this arc entirely.** Do not assume it is a recent regression without checking.

**▶ Class 1 and desktop-reproducible, so it costs minutes, not a device session.** `npm run dev`, load a clip, watch whether the first `updateSourceFrame` uploads. The suspects worth reading first are the element path's `readyState < 2` guard and whatever triggers the initial render after `setSource`.

### 🔬 [2026-08-23 — DETERMINISTIC, AND THAT IS THE WHOLE LEAD] THE BAKE'S DECODE TIMEOUT AT A FIXED TIMESTAMP

**`decode timed out at 81.470s (10s budget for one frame)` — and the retry produced the same error at the same point.**

**A deterministic failure at a fixed timestamp is not resource exhaustion.** Pressure failures wander; this one does not. It points at the clip's own structure at t≈81.47s of a ~90s file, which is what `video-decode.js`'s message already guesses: *a very long keyframe interval, or a backward seek re-decoding too much*. One frame is blowing the 10-second per-frame budget in `createSequentialFrameReader`.

**⚠️ THIS RETIRES THE DECODER-PRESSURE HYPOTHESIS** that B711 was built on, and B711 is reverted (B714).

**▶ AND IT SHOULD REPRODUCE ON DESKTOP, WHICH IS THE WHOLE POINT.** The bake's decode path is pure WebCodecs JS over demuxed samples — **no native plugin, no frame socket, no engine texture.** `clip-editor.js` is shared. So `npm run dev` on the Mac with the same file should hit the same 81.470s, in seconds per attempt, with a debugger attached. **Confirm that before any further device time.**

**✅ IT REPRODUCES ON DESKTOP (B720).** M1 Max, twice, `decoded 9 frames, 0 decoder resets`. Every
earlier desktop run passed only because the trim had been dragged in. **This is not an iPad bug and
the investigation is off the device.**

**✅ AND A CAUSE IS NOW PROVEN REACHABLE (B721): a hole in the presentation timeline was a state the
forward wait loop could not leave.** `frameAt` returns a frame when it COVERS the target and drops it
when a later frame SUPERSEDES it; a target between one frame's end and the next frame's start is
neither, and no frame the decoder can still produce sorts into the gap. Fixed with the rule
`revLookup` already used on the backward path. Harness `waitloop-check.mjs`, 11/11.

**⚠️ REACHABLE IS NOT DEMONSTRATED. THIS ITEM STAYS OPEN UNTIL ONE BAKE SAYS SO.** Circumstantial
support is strong (`decoded 9` with `resets: 0` is a full queue and an idle decoder; the identical
error twice is what a fixed-target hole predicts) but no run has yet shown a hole being bridged.
**The deciding reading is in `bakeDecode`:** `holes > 0` on a passing bake closes it; a failure with
`outQ` near empty and `queue` at 24 means the platform decoder is wedged and this was incidental.
`HANDOFF.md`'s pick-up block has the four-outcome table.

**⛔ Retired: *"the flat budget is too tight for 4K on one media engine"*.** Nine frames in thirty
seconds is a stall, not slowness, and that framing came from comparing an iPad failure against
desktop successes that were not the same experiment.

### 🚨🚨 [HIGH — Daniel, 2026-08-23 — DATA LOSS, MITIGATED B710, CAUSE STILL OPEN] A BAKE CAN SILENTLY REPLACE THE CLIP WITH GREY

**`applyBakedClip` REPLACES the working source with the bake's output.** A bake that reads garbage therefore **destroys the operator's clip while reporting success** — worse than any crash in this thread, because a crash is survivable by relaunching.

**Daniel: *"if i press the bake action button again it completes quickly and lands me with neutral gray source that adjusts in brightness as i scrub across."*** `docs/temp/8-23-contextLoss-clipBake.json` names the state exactly: `1280×720 · from canvas · native decode · 0.0 in/s · ⚠ SOURCE STALLED 388.3s · ⚠ NOT ON THE PLANAR PATH — sampling the preview canvas`. **The engine had fallen off the planar path onto the stalled 1280 preview canvas (the B580 signature) and the bake captured that.**

**✅ MITIGATED B710:** the bake refuses when `env.nativeVideo && !engine.planarActive`. **The app already knew** — `main.js` prints that warning from the same expression. Nothing on the destructive path consulted it.

**🔴 STILL OPEN — WHY the engine falls off the planar path here.** `reinitGL` preserves the provider via `keepPlanar`, so the loss happened elsewhere. **Prime suspect: the loop builder calls `setPlanarSource(null)` (`source-host.js:829/939`), so a context restore that lands while the loop builder holds the source has nothing to preserve.** Class 1 — read the loop builder's entry/exit against the restore path before instrumenting.

**✅ THE SWAP IS NOW VALIDATED (B711).** Daniel: *"the output from a bake should only replace the source when it has baked successfully."* **The sharp edge is that "successfully" cannot mean "did not throw" — the bake that destroyed his clip COMPLETED.** So the output is checked against the requested dimensions before anything touches `env.sourceVideo`; a 3840×2160 request that returns 1280×720 is rejected with `bake-rejected` and the original is kept. **B710 guards the input, B711 the output; both are needed, since the source can degrade DURING a four-minute bake.**

**🅿️ STILL WORTH DANIEL'S CALL, and now less urgent: should a bake replace the source IN PLACE at all**, or mint a new source and leave the original loaded? The validation makes the current model safe; a non-destructive model would make it *unloseable*.

### 🧪 [HYPOTHESIS SHIPPED B711, UNPROVEN] `Decoding task did not complete` AT ~85% OF A LONG 4K BAKE

**Stated plainly: B707, B709 and B710 all made a failing bake legible or safe. None of them address why it fails.** This is the same error as the B603 and B607 entries below, still recurring on B709.

**The evidence now points at concurrent decoders.** `sessions.peak.decode: 7`, with five still live at report time:

```
source clip: IMG_5132.mov       394s      native decode: IMG_5132.mov   389s
loop builder: preview           255s      loop builder: A-head crossfade 255s
loop builder: thumbnail strip   255s
```

**The loop builder holds three preview decoders for its entire session and the bake opens its own on top.** Shedding them for the duration of a bake is the obvious move and was **Daniel's own suggestion at B700**.

**✅ SHIPPED B711 — and it was smaller than I estimated.** The three "decoders" are three `<video>` elements on one URL, and `disposeClipPreview` already had the correct release idiom; the work was making it reversible. `mountClipPreviews`/`shedClipPreviews`/`restoreClipPreviews`, restored from the bake's `finally` on every exit path. **Concurrent decode during a bake: 7 → ~4.**

**⚠️ WHETHER THAT FIXES THE BAKE IS UNPROVEN, and this is the test.** If a long 4K bake still dies at ~85%, decoder pressure was not the cause and `sessions.peak.decode` in the next report is the evidence. **Do not treat B711 as a fix until a bake completes.**

**✅ AND THE RESTORE QUESTION IS ANSWERED WITHOUT DETECTION.** Daniel, B700: *"is there an elegant way to pick them back up if someone cancels a bake and goes back? can the loop builder self-detect a failure state mid-bake and restore previews? it seems like the different timeline and output panels themselves should know if they're stale and know how to ask to repair."* **The `finally` is the answer, and it is elegant because it detects nothing** — every exit from a bake runs it, so there is no failure state left to detect. A restore keyed on *did it fail* would have to enumerate the failure modes, and the two that cost builds this month (a synchronous encoder throw, a context loss inside an `await`) are both ones nobody enumerated. **Restoring also rebuilds the thumbnail strip, which is the stale-thumbnail failure mode filed separately.**

**🅿️ The larger "panels that know they are stale and can ask to repair" idea is NOT built** and is still worth doing as its own piece — B711 solves it for one caller by brute force (restore everything, always), which is right for a bake and would not scale to the stage manager.

### 🔎 LIKELY CLOSED BY B700 [Daniel, 2026-08-21 — reproduced twice, instrumented B699] SEAMLESS BAKE FAILS WITH A DECODER TIMEOUT. **Daniel reported a SUCCESSFUL bake on B700, which raised the first-frame deadline. Needs one more bake to close.**

*"Could not bake the clip: decode timed out at 39.288s (10s budget for one frame — usually a very long keyframe interval, or a backward seek re-decoding too much)"*. **Twice**, about halfway through the progress bar. Clip: significant trim off the end, a little off the front, 60fps source converted to 30fps output, on the M1 iPad Pro.

**What the error actually means:** `39.288s` is the TARGET TIME IN THE CLIP, not elapsed time. The budget is ten WALL-CLOCK seconds to produce one frame (`video-decode.js:306`). **So a `VideoDecoder` returned nothing for ten seconds.**

**❌ REFUTED B700 — IT IS NOT THE SESSION COUNT.** The two runs, measured:

```
FAILED   B699 · peak.decode 6 · source note: "from <video> · ⚠ NO NATIVE DECODE"
SUCCEEDED B700 · peak.decode 8 · source note: "from canvas · planar · native decode"
```

**The bake SUCCEEDED at a HIGHER peak than the one that failed.** Eight concurrent decodes was fine; six was not. Session count cannot be the discriminator, and the hypothesis below is wrong.

**What actually changed is B700's deadline fix, which restored the NATIVE decode** — and that is a LOAD story, not a COUNT story. Without it, the source is a 4K60 `<video>` element decoding continuously in the same process the bake's `VideoDecoder` is asking to work in. With it, the element is parked and AVPlayer carries the clip. **The bake was competing with an active 4K60 element decode, not running out of permits.**

**The original hypothesis, kept because the reasoning was sound and the refutation is the useful part:**

**~~LEADING HYPOTHESIS — DECODE SESSION EXHAUSTION~~** A bake runs from inside the loop builder, which already holds three counted decoders on top of the source element and, on Capacitor, the native decode. The bake's reader is the sixth or seventh live decode on one clip. **A decoder that cannot be granted a session produces no frames, which is exactly this signature.**

**✅ B699 MADE IT COUNTABLE.** The bake reader now acquires `decode: 'bake: frame reader'`. It was previously the ONLY decode path invisible to the registry — so `sessions.peak.decode` was undercounting by precisely the session most likely to be the one refused.

**⚠️ COMPETING EXPLANATIONS NOT YET ELIMINATED, do not fix on the hypothesis alone:**
- **The 60→30 conversion** means every other source frame is requested; combined with trims at both ends, a forward jump could repeatedly cross `FORWARD_SEEK_US` and re-decode a GOP per frame.
- **A long keyframe interval** in this specific clip, which is what the error message itself guesses.
- **Contention:** the M1 Pro was running the governor-off 4K broadcast test at the time.

**▶ NEXT: reproduce on B699+ and read `sessions.peak.decode` and `live[]`.** If the peak reaches 6-7 with `bake: frame reader` present, the hypothesis is confirmed and the fix is a shed policy. If it peaks at 3-4, it is the seek/keyframe path and the fix is in `resetTo`.

### 🔁 [T9, 2026-08-19 — MEASURED, NOT FIXED] THE LOOP CACHE CANNOT COVER A LONG 4K CLIP'S WRAP

**The item swap scales with clip length**: 325ms on the 6:39 clip against ~25ms on the 20.4s one (a longer clip is a bigger index to re-open). The head cache exists to replay across exactly that gap, and it **structurally cannot**:

```
loopCache: 5 frames · 133ms held · 59MB of a 64MB budget · "partial fill — raise the budget"
```

A 4K NV12 frame is ~12MB. Covering 325ms needs ~10 frames ≈ **124MB, roughly double the maximum budget.** So the advice is correct and unfollowable, which is its own small instrument bug.

**⚠️ DO NOT TREAT THIS AS URGENT.** It does not reach the wall: the external view's worst take gap across the whole run was **132ms, once every 6:39**. Daniel described the run as uneventful, and that is an accurate description of a 132ms hitch every six and a half minutes.

**⚠️ REDUCED RESOLUTION IS OFF THE TABLE (Daniel, 2026-08-19) and the reason is one I had not weighed.** The cache feeds the same pipeline as the broadcast: *"if a syphon broadcast is started at 4k but flips to QHD the actual scale of the clip will reduce in the arena composition which would be extremely jarring."* **A composition that jumps size at the loop point is far worse than a 132ms hold.** Do not re-propose it.

### ⚠️ THE BUDGET HISTORY, CHECKED AGAINST THE RECORD (2026-08-19) — AND IT DOES NOT SAY WHAT WE REMEMBERED

Daniel's recollection was *"we tested increased sizes and ran into stability and performance issues with larger buffers."* **The changelog does not support that.** What B605-B608 actually recorded:

- **B608: 4K looped SEAMLESSLY at a 256MB budget.** `frames: 8, coveredMs: 200, heldMB: 94, why: "covering the lap"`, take gaps `[37, 25, 42, 39, 38, 41]` — one frame interval. Daniel at the time: *"maybe this is our first time actually seamlessly looping 4k?"*
- **`heldMB: 94` against a 256MB ceiling.** The budget is a CEILING, not an allocation; the fill stopped well under it because `headSeconds` (0.22) is the real target.
- **The "64 stuttery / 128 stuttery / 256 seamless" reading was RETRACTED at B608 as an artifact of test order** — setting the budget to 0 discards the cache, and a clip's head is produced exactly once on the opening pass, so later arms could never refill. At 128MB it read `heldMB: 47`: **well under budget, so the budget was not the constraint.**

**There is no recorded instance of a larger buffer causing instability or a performance problem.** The jetsam history in the code comments is about 4K decode memory generally, not about this cache.

**What IS true, and it is the part that matters for T9:** at 64MB the long clip held `5 frames / 59MB` — **the budget WAS binding there** (a sixth frame would be 71MB). So T9 is the first case where raising it would actually change anything. **But there are TWO limiters and raising one alone does nothing:** `headSeconds = 0.22` caps the fill at ~7 frames ≈ 231ms, still short of the 325ms lap. **Covering it needs `headSeconds ≈ 0.36` AND a budget ≈ 128MB.**

### 🪜 [OPEN QUESTION — Daniel, 2026-08-19] SHOULD THE CACHE SIZE RIDE THE CAPABILITY LADDER?

*"on our most constrained supported devices the current behavior is by design, but on devices with more headroom we can increase the buffer... can you assess if this feels over-engineered?"*

**The principle is right and the first move is wrong, for one specific reason: we would be sizing against a signal we have PROVEN does not predict the failure.** The 2026-08-19 GL death happened with `availableMB: 5094` — over 5GB free. **The ceiling that kills this app is the WebKit GPU process's, and `availMB` does not see it.** A ladder keyed on free memory would be confident and uninformed.

**Two more reasons to hold:**
- **A budget raised mid-session does nothing.** The head is produced once, on the opening pass (B608). Any ladder must decide at CLIP LOAD, not dynamically — which removes most of what makes a ladder attractive.
- **The benefit is bounded and small**: a 132ms hitch once every 6:39. The short-clip case is already invisible at 25ms.

**The cheaper move that is not a ladder:** size the fill from the MEASURED lap (`swapGapMs` is already reported) rather than from a fixed `headSeconds`, capped by a budget that stays a ceiling. That is one variable, uses a number we already have, and needs no capability model at all. **If that lands the gap under ~100ms the question closes and the ladder is never needed.**

**The genuinely cheapest move is still pre-roll** — start opening the next item earlier so the gap shrinks at source. No extra memory, no dimension change, no capability guess.

### 🧨 [HIGH — Daniel, B607] THE BAKE THROWS "encoding task did not complete", AND ONCE CRASHED THE APP

**🔄 THE PATTERN INVERTED AT B609, and Daniel's data is what inverted it.** It is **not** "the first attempt fails". Two fresh sessions in a row had their **first** bake succeed uneventfully; the failure came on the **second bake within a session**, and that time the app went fully unresponsive with the bake UI frozen.

**So it is not something held at startup and released by a failed attempt. It is something a completed bake does not release.** That is a better diagnostic and it points at the bake's own teardown rather than at app startup state.

**⚠️ One confound to separate, and it costs nothing:** a **GL context loss happened between the good bake and the bad one** in that session. So the precondition might be the context loss rather than the preceding bake. **Cheap discriminator, no code: do a second bake in a session where nothing was lost.** If it still fails, it is bake teardown. If it succeeds, the context loss is the trigger and this item merges into the GPU-process cluster.

**(superseded B609)** ~~every FIRST attempt fails and every SECOND succeeds~~. Seen on **FHD as well as 4K**, so "4K memory pressure" is too narrow and remains retracted as the framing.

`encoding task did not complete` is not our string — it is WebCodecs. At bake time the app holds: the native decode, the Loop Builder's two preview `<video>` elements, the thumbnail image generator — and then asks for two WebCodecs readers plus an encoder. **iOS limits concurrent sessions, and B501 was the same shape.** The session audit in `PLAN-LIVE-READINESS.md` item 2 is where this gets answered.

**Cheapest thing to try:** release what the bake does not need before it starts (the preview elements, and possibly the native decode, which the bake does not read from) rather than leaving them loaded.

Twice in one session on 4K, and **the second time the app genuinely restarted** — the Loop Builder closed and the uploaded clip was dropped, while the external display still showed the "baking … in Loop Builder" notification. A retry in the same session succeeded both times, so it is intermittent rather than deterministic.

**Same theme as everything else at 4K: memory.** A bake runs two WebCodecs readers over a 4K file beside the native decode and (as of B605) a ~94MB head cache. Supersedes the narrower B603 filing of the same string.

**Two things worth doing regardless of root cause**, because a crash mid-bake currently loses the user's work: **the uploaded source should survive an app restart**, and **the external display's "baking…" notification must clear** when the bake dies rather than persisting into a dead state.

### 🔁 [OPEN — Daniel, B605] THE SLICE PREVIEW STALLS FROM THE LOOP POINT TO THE CROSSFADE

**Consistent repro:** Loop Builder, seamless (slice) loop, preview or bake step, while playing. After the playhead passes the cut point at the end and returns to the beginning, **nothing plays until the playhead reaches the crossfade, where it flickers and resumes.** The baked output is correct, so this is the preview's phase machine and not the bake.

**Checked at B606 — neither recent change is implicated.** B604's forward-seek is in `createSequentialFrameReader`, which the **bake** uses and the preview does not (`startSlicePreview` drives `<video>` elements directly). B602's playhead fix is in `updateSrcScrub`, a different element from the Loop Builder's bar.

**More detail (Daniel, B606):** it plays fine the **first** time through, and fine after a manual scrub-and-play before the crossfade. **It stalls only after the loop.** At the crossfade there is a flicker, and **the fading-OUT side stays frozen while the incoming side moves** — so it is the B-tail element that is not running after a lap, not the phase machine's timing.

**Where to look:** `startSlicePreview`'s phase machine and the A/B pre-roll in `clip-editor.js` — the B-head keeps `vB` pre-seeked to `inA`, and the resume condition is `v.currentTime >= inA + cfSec - 0.06`. A stall that ends exactly at the crossfade points at that condition or at the pre-roll seek not having landed. **Also worth ruling out decoder contention**: the slice preview runs two `<video>` elements beside the native decode, and three concurrent sessions is the shape of B501.

### 🧨 [OPEN — Daniel, B603] BAKE FAILED WITH "Decoding task did not complete" AT ~3/4

A 30s seamless loop taken from the **middle** of a long FHD clip, roughly three quarters through the bake. Not reproduced since; the same trim taken from the head of the file baked cleanly.

**No root cause.** The string is not ours, so it comes from WebCodecs or AVAssetImageGenerator. **Plausibly a symptom of the forward-walk fixed at B604** — that path held a decoder open for minutes decoding frames it discarded, which is exactly the shape that trips a decode watchdog. If it recurs after B604, it is its own bug and needs the failure percentage and whether the trim was mid-file.

### 🎚 [OPEN — Daniel, B594] THE LOOP BUILDER'S CROSSFADE PREVIEW CANNOT KEEP UP ON M1 AT 4K

The crossfade preview stutters and pauses on the M1 iPad Pro. **The bake itself is correct** — the preview drives two occluded decoders over the same 4K file in real time, which the bake does offline and at its own pace.

Daniel's call on the fix: **fix it if it is cheap, otherwise guard the expectation.** A warning on the crossfade step saying the *preview* may stutter on this device and the baked loop will still be correct. Preferable to silently looking broken.

Cheap avenues before conceding: preview the crossfade at a reduced resolution (it is judging a dissolve, not detail), or pre-roll both readers before the seam instead of seeking into it live.

### 🔎 LIKELY CLOSED — A 4K CLIP HOLDS A FRAME FOR A FEW BEATS ON EVERY LOOP RESTART (Daniel, B580). **T10 measured 8 wraps at a 6ms worst gap. One look confirms and closes it.**

In-app, no broadcast needed. Daniel filed this as *"fixed a long time ago and has come back."*

**⚠️ IT WAS NEVER FIXED (history checked at B605, on Daniel's ask).** No build ever closed it:

- **B487** — first report, on the `<video>` path, filed as a watch item with *"should vanish under S3-A's seamless native `AVPlayerLooper`"*. **A prediction, not a fix.**
- **B490** — re-test: happens **100% of the time on 4K sources, including a 12.6s baked seamless loop.**
- **B491** — fixed the external-view **seek thrash**, a different and much worse stutter. Its own verify still asked *"does the trimmed-clip loop still lurch every lap?"*, so it was open then.
- **B498-B506** — S3-A shipped AVPlayerLooper. Nothing ever verified the prediction.
- **B580** — re-reported as a regression.

**Why it feels new: we made everything around it smooth.** Before B590 the broadcast was clocked by the app's rAF at ~20-25/s, where a 150ms hold is three frames of an already-choppy stream. B590 took delivery to 29-30/s with `fresh p50 33ms`. **A fixed 150ms defect becomes conspicuous exactly when its surroundings stop being noisy.** Nothing in the B593-B604 session could have introduced it — it is measured inside the plugin, before any of our JS runs, on both loop mechanisms, at 4K and FHD identically.

**Standing lesson: a predicted fix filed as a watch item reads like a closed item three months later.** If we predict a fix, the prediction gets a verification step or it stays open.

**⚠️ THE "SEEK TO ZERO" PREMISE IS FALSE ON THE NATIVE PATH (B595/B596).** `rewinds: 0, suppressed: 0` — our rewind never fires on a full-range trim, and AVPlayerLooper wraps the item without any seek at all. Whatever this is, it is not a seek cost. See the B596 loop item above; the live question is `takeGapMs`.

**✅ ONE OF THE FOUR MAY BE OFF THE LIST.** The intermittent "loads but will not play" has a concrete candidate mechanism as of B597: `FoldNativeVideo.stop()`'s staging purge racing the next `beginUpload`, which stages a clip into a file that is then deleted, with writes still succeeding. Fixed from both sides. **If it stops recurring, that symptom is closed and this cluster is three.**

---

## 📡 Broadcast, external display and the governor

**The governor defaults OFF as of B701** — its display-signal premise is false, because an HDMI or external-window view renders in its own process. It is kept, not deleted, for the NDI investigation, where the premise does hold. `BROADCAST-DELIVERY.md` is the answer sheet for this whole family.

### 🖥 [Daniel, 2026-08-22 — CLARIFIED: THIS IS A PICKER BUG, NOT A NEW FEATURE] HDMI AND AIRPLAY SHOULD BE SELECTABLE THE SAME WAY TWO MONITORS ARE

**Daniel's clarification: *"my expectation is that we should pick between sources here just the same as if there were two physically connected displays on desktop. We already have a UI for this."***

**That reframes it and makes it smaller.** The multi-display picker already exists and already solves "several destinations are available, choose one." **AirPlay is simply not being enumerated into it when HDMI is attached**, so the operator's choice is made by which cable is plugged in.

**So the work is enumeration and labelling, not a new surface.** Two questions to answer first, and the first is Class 1:
1. **Where does the destination list get built, and what excludes AirPlay when a wired display is present?** Read it before assuming a platform limit — this may simply be an `else` that should be a second entry.
2. **Only if the code says the exclusion is deliberate:** can iPadOS present to a wired display and an AirPlay receiver at once, or only alternately? **Even if only alternately, the picker should list both and switch** — a capable destination vanishing with no explanation is the publish-why rule failing in the UI.

### 📺 PiP-DURING-BROADCAST POLICY — `conduit/governor.js` · ⚠️ HEADER STALE: THE GOVERNOR DEFAULTS **OFF** SINCE B701

Daniel weighed two approaches: **always hide the PiP during any broadcast**, or **hide/starve it only when the device is actually struggling**.

**Recommendation: the measured one, and we already own every piece of it.**

- **The blanket rule breaks the case Daniel himself flagged.** "The PiP is redundant to the external display" is true for HDMI and **false for Syphon and NDI**, where there is no second screen in the room and the PiP is the only view of the program. A blanket rule would blind the operator in exactly the destination he named as a concern.
- **It also contradicts the arc's governing rule.** An M3 iPad Pro may run both comfortably; a device-agnostic "always hide" is classification by fiat, and CAPABILITIES §1 is probe, never classify.
- **The mechanism exists.** B543 already ships a governor rule that starves the PiP for 4K capture, with a pre-warning (B555) so it is never a surprise. B559 added **`shortfall`** — an honest absolute "we are not hitting target". The rule is: *while broadcasting, if shortfall stays above a threshold for a couple of seconds, step the PiP down (rate, then resolution, then off) and say why.* Hysteresis so it cannot oscillate; restore when the broadcast stops.
- **Measured stakes on the M1 iPad at 4K:** `preview render` 14.36ms + `pip render` 9.91ms = **24.3ms of a 44ms frame.** The PiP alone is ~23% of the budget. **Prefer the broadcast over the app** (Daniel's call), so the preview should be on the same ladder — his 100/75/50 rungs were measured for this.
- **Pairs with:** the adaptive-preview-resolution proposal filed under the B506 entry. These are one piece of work, not two.

### 🟠 THE GOVERNOR'S BOTTOM RUNG SHOULD STARVE THE SECOND VIEW, NOT SLOW IT (Daniel, B575)

At the bottom rung the second view runs at 5fps and Daniel's read is that **it is more distracting than helpful at that rate** — a monitor below some threshold stops reading as live and starts reading as broken. B528 found the same floor from the other direction on the phone PiP (10Hz was kept as the default "because a monitor below that stops reading as live").

**So the last rung should be OFF with a stated reason, not 5fps.** That also matches the arc's own rule that 25% was reserved as an honest distress signal rather than a quality rung. Product decision, already made; needs implementing plus a visible "second view paused to protect the broadcast" state so it never looks like a failure.

### 🔌 [2026-08-21 — HARDWARE, NOT AN APP LIMIT] THE APPLE A1621 DONGLE IS UNRELIABLE ON THE DELL P2415Q

Daniel, during T10: the A1621 (USB-C multiport) drops the connection to the Dell 4K panel, while a plain USB-C to HDMI cable on the **same display and same iPad** works fine. **Recorded so a future flaky-HDMI session does not get spent debugging the app.** Power delivery through the dongle held steady throughout the 50-minute run; it is the display link that is unreliable. Untested against a projector, which is the more common real use.

### 🎚 [T9, 2026-08-19 — SUPERSEDED BY THE B701 DECISION, KEPT AS THE DATA BEHIND IT] THE GOVERNOR SHOULD BE SCOPED TO BUS DESTINATIONS

`PLAN-LIVE-READINESS.md` item 3 argues the governor should be scoped to bus destinations because it watches the display and the display rarely has a shortfall. **T9 is that argument as data:**

```
governor INACTIVE · signal 'display' · shortfall 0 · appShortfall 0.98
preview rate 1 → 22.73ms/frame     pip rate 1 → 11.47ms/frame     app 15fps
```

**The wall was flawless and the app was at half its target, and the governor correctly did nothing** — it is not watching the thing that is suffering. By Daniel's rubric that is defensible (*"dropping to poor fps in app is acceptable"*). **But 34ms/frame of editor cost is a free lever**, and the operator is the one looking at the 15fps UI.

**The decision this sharpens:** the governor's signal should probably be *per-surface-class* rather than one global choice — shed EDITOR surfaces on app shortfall, shed PROGRAM surfaces only on display shortfall. That is a different change from "scope it to bus destinations" and may supersede it.

### 🔬 [OPEN — B593] DOING LESS APP WORK MAKES THE BROADCAST WORSE, AND WE CANNOT SEE WHY

The panels-off case, now that B592's counter exonerates state posts (**4650 elided vs 859 sent, `ownClock: true`, delivery still 29/s → 20/s**):

| | app fps | app accounted | delivered |
|---|---|---|---|
| panels on | 19.0 | 30.95ms | **29/s** |
| panels off | **35.3** | **3.81ms** | **20/s** |

**The app got 8x cheaper and 1.9x faster, and the wall lost a third of its frames.** Nothing on the measured list explains it — with the panels off the app's own loop free-runs at 35fps, and the only shared resource left is the GPU process both webviews sit on.

**Leading hypothesis: the app's rAF loop rate itself is the competitor**, independent of what it draws. If so the lever is a **frame-rate cap on the app's loop while broadcasting** — categorically different from shedding surfaces, and it would explain why every shedding experiment failed.

**Cheap test, no code:** the app has no rate cap today, but the governor's rate ladder throttles surface renders while the loop keeps spinning. **A/B a deliberate cap (e.g. rAF every other frame) against the current free-run, panels off, and watch delivery.** If delivery recovers, that is the real lever and the governor should be rebuilt around it rather than deleted.

**⚠️ THIS CHANGES THE CONSOLIDATION DECISION.** Do not delete the governor until this is answered — its machinery may be repurposable, and "shed surfaces" being wrong does not mean "throttle the app" is.

### 🔁 [MED — B590, partly answered B591] RE-TEST THE GOVERNOR'S FUTILITY RESULT UNDER A CONTROLLED PROTOCOL

**▶ B591 UPDATE: partly answered, and against the governor.** Daniel's controlled panels-off run delivered **18/s vs 24-26/s with the panels on** — shedding the editor surfaces made the broadcast *worse*, not merely useless. So the futility conclusion was directionally right even if its measurement was confounded. The open question is no longer "does shedding help" but item 1 above: whether the governor should exist at all now.

B583 and B584 both concluded **"shedding the editor surfaces does not move the delivered rate"**, and the governor now acts on that conclusion by releasing at the bottom rung. **Both measurements were taken on a hot device with an enlarged slice, comparing before against after across time — the same uncontrolled setup that produced B587's false "QHD is slower" result**, which Daniel's slice-size callout later demolished.

There is also now a mechanism predicting shedding SHOULD help: B590 found delivery was gated by the app's frame rate, and the editor surfaces are ~24ms of a 40ms frame.

**Re-run under the B589 protocol** (cold start, fixed slice, A/B/A) using the frame-cost panel's manual surface toggles. No code needed. If shedding does help, `futileGain` and the whole futility branch need revisiting — a false negative there means the governor gives up exactly when it would have worked.

### 🔒 CONSTRAINT: OUTPUT RESOLUTION IS A CONTRACT WITH THE DOWNSTREAM CONSUMER (Daniel, B583)

**A destination can be expecting a fixed frame size, and changing it mid-broadcast breaks the composition rather than the frame rate.** Daniel's case is **Syphon/NDI into Resolume Arena**, where the incoming source's dimensions set the scale of the comp: degrade the resolution to buy fps and the projection is now the wrong size on the wall, mid-show. **So there are real circumstances where poor fps is the better outcome and resolution must not degrade automatically.**

This does NOT prohibit degrading under duress; it prohibits doing it *silently on a contracted path*. Design implications when the honest-guardrail work (close-out step 4) lands:

- **Separate the two mechanisms.** An **HDMI/AirPlay external window** has no downstream consumer with a fixed expectation, so the size is ours to choose. Syphon/NDI publish into someone else's graph and are not. **⚠️ CORRECTION (B585): the "we may be oversampling a 2560 panel" version of this is DEAD.** Daniel's display is a real 4K panel (Dell P2415Q, 24"). The `preferredMode`/`nativeBounds` 2560×1440 reading was the per-device iOS quirk [FoldExternalDisplayPlugin.swift:178](../native-plugins/fold-external-display/ios/Sources/FoldExternalDisplayPlugin/FoldExternalDisplayPlugin.swift#L178) already warns about. **Dropping to 2560 IS broadcasting at QHD.** Shipped B585 as an operator choice with a measured recommendation.
- On a contracted path, prefer **telling the operator** ("this device sustains ~20fps at 4K") over changing the frame size under them. That is the same "explain, don't silently degrade" rule as B555 and the governor's paused-panel label.
- If we ever do offer it there, it should be an explicit operator choice with the tradeoff stated, not an automatic rung — and ideally at **broadcast start**, when nothing downstream is locked in yet.

### 🚨 THE RESOLUTION LADDER IS THE WRONG LEVER FOR A 4K SOURCE (Daniel, B571) — this changes the governor

**The most important measurement of the arc, and it invalidates the design I just shipped.** Daniel drove the ladder by hand during a 4K→4K HDMI broadcast:

| state | app fps | on display |
| --- | --- | --- |
| preview + PiP at 100% | 21-23 | 29-31 |
| preview + PiP at 25% | **unchanged** | unchanged |
| preview + PiP OFF entirely | 34-38 | **visibly choppier** |

And the number that explains it: **`preview render` costs 16.53ms at 822×462 — 0.38 megapixels.** Same signature as the 9.91ms PiP at 402×226. **The cost is sampling the 8.29MP 4K source texture, not writing the output pixels**, so shrinking the output changes nothing. B506 already named this ("the kaleidoscope is TEXTURE-BANDWIDTH-BOUND at 4K") and the governor was built on the other assumption anyway.

**Three consequences:**
1. **A resolution ladder cannot govern this workload.** Stepping preview/PiP down their ladder is a no-op at 4K. The governor's actuator has to be *skipping the render* (or dropping its rate), not scaling it — the levers that worked were B542's elision and B528's rate limit, both of which cut CALLS rather than pixels.
2. **Turning surfaces off made the DISPLAY worse while making the app's number better** — a 34-38fps app with choppier output. That gap is its own finding: the app's fps and what lands on the wall are not just different numbers, they can move in opposite directions. **Anything that governs on app fps alone can make the product worse while reporting success.** The governor should watch the `external` surface's own rate when one exists.
3. **The source-detail cap is the lever that actually applies** (`setPlanarCap`) — it shrinks the sampled texture, which is the thing being measured. It is already wired and nothing consults it.

**✅ FIXED B571 (the reason the governor never fired at all):** the pressure target was declared only for a take or a live camera, so a video CLIP reported `target: 0` and the governor skipped every tick. It now takes the decoder's arrival rate — the `29.8 in/s` the source note has shown all along — snapped to a common rate so it cannot re-learn the baseline every window.

**✅ CONFIRMED FROM A SINGLE REPORT, B574 — no cross-build inference needed.** The governor fired, walked to its bottom rung, and produced the clean measurement:

| surface | output pixels | cost |
| --- | --- | --- |
| preview | 585×329 = **0.19 MP** | **21.93 ms** |
| pip | 141×79 = **0.011 MP** | **12.07 ms** |

**17x fewer pixels, 55% of the cost.** A line through those two points implies **~11.5ms of fixed cost per editor surface per frame** plus ~54ms/MP. Inside the governor's operating range, shrinking a surface to a seventeenth of its area removes under half its cost, and a surface at zero pixels would still cost 11.5ms. **A resolution ladder cannot remove a fixed per-draw cost.**

Caveat kept honest: `gpuMsPerFrame: 0` everywhere (no WebKit timer queries), so per-surface attribution is CPU wall-clock on a pipeline that blocks unpredictably. **The conclusion survives it for a different reason: a skipped render costs zero wherever the time lands, while a smaller render demonstrably does not.**

**✅ SHIPPED B575 — the rate ladder** (`[[1,1],[1,2],[2,4],[3,6]]` as `[primary, secondary]` divisors; secondary ranked by AREA because it flips by mode; phase-staggered; deferred-not-dropped for the on-demand preview). Details in CHANGELOG B575. **Unverified on device — the open question is whether the DISPLAY improves, which the resolution ladder never did.**

**▶ WHAT B575 DELIBERATELY DID NOT DO, still open:**
1. **The resolution ladder was REMOVED from the governor rather than kept as a later rung.** Daniel's A/B showed no steadiness difference at 4K, so keeping it would have been carrying a lever with no evidence. **But 54ms/MP is not nothing at FHD**, where the fixed per-draw cost is smaller relative to the variable one, and that case is unmeasured. If FHD broadcast ever shows shortfall, re-measure before assuming rate is the only lever there too. Manual scale control stays in the panel either way.
2. **The governor still watches APP fps, not the `external` surface's own rate** (consequence 2 above — turning surfaces off made the app's number better and the display worse). This is the one that can still make the product worse while reporting success. **Do this before trusting the governor unattended.**
3. **`setPlanarCap` is still the untried lever** (consequence 3) — it shrinks the sampled texture, which is the term that actually dominates at 4K. Wired since B518 and nothing consults it. **If the rate ladder also fails to move the display, this is the next thing to try, and the fact that it attacks a different term is why.**
4. **The fifth-rung problem is sidestepped, not solved.** Ranking by area gives the right answer for preview-vs-PiP in both modes, but it is a proxy for Daniel's declared `source → stage → live PiP` order rather than an expression of it. A third editor surface would expose the difference.

### 🟠 THE EXTERNAL DISPLAY STAYS GRAY UNTIL YOU PLAY OR SCRUB (Daniel, B575)

Starting a broadcast shows nothing on HDMI until the timeline moves, **even though the PiP already has a picture.** A paused program still has a frame, and showing black instead of it reads as a broken connection.

**And for the first time we have the external view's own account of it**, because B573 fixed `extLogs` on this path:

```
[fold ext] joined port 8900 but no frames yet — the decode may be stalled
```

**The view joined the socket and no frame was ever posted.** So this is not a render fault at the far end; nothing was sent. Likely the poster only publishes on a change and there is no initial post at broadcast start. Cross-ref the standing "external display starts dark and PAUSED on a fresh broadcast" item from B565 — **this is probably the same bug with a mechanism now attached**, and it may also relate to the 25-45s source-switch lag.

### 🟢 THE JUDDER IS SPECIFIC TO 4K SOURCE **AND** 4K OUTPUT (Daniel, B579 smoke test)

4K source → FHD output: fine. FHD source → 4K output: fine. **Only 4K→4K.**

Useful because it says **both terms contribute and neither alone crosses the threshold.** The source size drives the view's texture sampling (B506: the kaleidoscope is texture-bandwidth-bound) and the output size drives its fill cost; one render stays under the ~33ms budget with either halved and goes over with both at 4K. That is consistent with the B579 saturation mechanism and it also predicts where the residue will be if coalescing does not fully close it.

### 🔴 iPAD NDI + 4K READBACK — the async readback is NOT working on iPad (Daniel, B569)

From a 4K NDI broadcast on the M1 iPad, with a FHD source:

```
bus  capture: async   readback 31.43ms/frame (max 33)   render 1.86ms
```

**`capture: async` yet 31.43ms.** On desktop, B521 took the same 4K readback from 19.48ms to **0.87ms** with the pipelined path — a 22x win that made 4K/60 Syphon comfortable. On iPad the mode string says the pipeline is selected and the cost says it is behaving like a blocking `readPixels`.

**This is very likely the whole explanation for the NDI choppiness** Daniel has reported for two arcs (`~30fps` in the output panel, `~48` in the frame-cost panel, and visibly stop/start in Arena). 31.43ms of a 76ms frame is the single largest item, and the start/stop pattern is what a stalling readback produces while the reported render rate stays healthy.

- **▶ FIRST THING TO CHECK:** whether `clientWaitSync` on WebKit ever reports the fence as signalled. B519's original bug was exactly this shape on Chromium (the busy-wait could not observe a signal arriving via the event loop) and B521 fixed it by yielding between polls. **If WebKit never signals, the pipeline silently falls back to a sync read every frame while still reporting `async`** — and the mode string would then be lying, which is its own bug (the note was added at B520 precisely so a reading like this would be interpretable).
- **Instrument before fixing:** report the fence outcome (signalled / timed-out / abandoned) in the bus note, the way the capture mode already is. A count of pipeline misses per window would settle it in one reading.
- **Cross-ref** the standing "iPad NDI drain — STUTTER PERSISTS after UYVY" item, which this may simply be the cause of.

### 🎛️ iPAD 4K HDMI SESSION — four findings (Daniel, B565)

Baking a seamless 4K loop on an M1 iPad was **uneventful** (that closes a long-standing worry). Broadcasting it found four things.

- **✅ PARTLY ADDRESSED B565 — the output panel advertised 29-32fps while the frame-cost panel read 21.6.** Both numbers were correct: the external view self-renders off the frame socket on its own clock (30 new/s arriving, 26 drawn), so it legitimately outruns the app's editor loop. **The dishonesty was the missing label** — a bare "fps" in the output panel reads as the app's frame rate. It now says `26 fps on display · app 22` when the two diverge materially. **What remains open is the underlying gap**, below.
- **🔴 [HIGH] The iPad's editor surfaces are the wall, confirmed again and worse at 4K.** From the report: **`preview render` 14.36ms (1.57MP) + `pip render` 9.91ms (0.09MP) = 24.3ms of a 44ms frame**, against a `source` upload of 4.14ms for the full 8.29MP 4K texture. **A 402×226 PiP costing 9.91ms is the arc's signature finding again — the cost tracks the 4K SOURCE being sampled, not the tiny destination.** This is B516's number (preview 13.41 + PiP 9.0) reproduced at 4K, and it is the concrete case for **adaptive preview resolution on mobile** (the proposal already filed under the B506 entry). Daniel's ladder (100 → 75 → 50) was measured for exactly this.
- **🔴 [HIGH] The external display starts DARK AND PAUSED on a fresh broadcast** — he had to scrub the timeline and press play before anything appeared. Distinct from (and sharper than) the existing "stale/latent at session start" entry: it is not slow, it is *paused*. Pairs with the standing **"broadcasting in MOTION mode plays even when paused"** bug — the same transport-state desync, seen from the other side. **The external view is not being told the transport state at broadcast start.**
- **🔴 [HIGH] Opening the output panel PAUSES PLAYBACK when a mic is selected.** The level meter opens its own `getUserMedia` whenever the panel is open, and on iOS acquiring an audio input changes the AVAudioSession category, **interrupting video playback**. Opening a panel should never stop the program, and this is worst exactly where it matters — mid-broadcast. **Options:** do not auto-acquire the meter while a broadcast or playback is live (meter on demand); acquire once and hold it for the session rather than per-panel-open; or configure the audio session so capture and playback coexist (likely needs the native plugin). **Cross-ref: the meter's separate `getUserMedia` is already filed as a thing to unify with the take's.**
- **🟠 [MED] Play/pause desyncs after a system-forced pause**, in BOTH the Loop Builder and perform. The transport stops for an external reason, the button still reads "pause", and resuming needs two taps. **The button reflects intent rather than the transport's actual state** — it should follow the `<video>`/decoder's real playing state (a `play`/`pause`/`ended` listener), not the last thing the user asked for. Same family as the external-display transport desync above; worth fixing together.

---

## 🎛 Input, forms, gestures and droste

**Item 1.5 closed at B657**; everything here is a refinement of shipped behaviour or a deliberate deferral, not a hole in it. The exit report below groups what the arc left open. **⚠️ Two chromes share no `env`, and `source-overlay.js` has a third private `view`** — see `CLAUDE.md` before touching anything both surfaces use.

### 🎞 [HIGH — Daniel, 2026-08-21] STALE TIMELINE + KEYFRAME THUMBNAILS AFTER A CLIP SWAP THAT INHERITS KEYFRAMES

**Daniel: *"i loaded a new clip and it inherits the same keyframes in motion but it didn't figure out that it needed to re-render the timeline and keyframe thumbnails yet. even after editing and making new keyframes they still don't update... when i switched to a FHD clip the timeline and keyframe thumbnails were restored."***

**⚠️ THE SECOND SENTENCE IS THE IMPORTANT ONE, AND IT RULES OUT THE OBVIOUS CAUSE.** If this were a missing invalidation on the swap, *editing a keyframe would fix it* — a new keyframe has to draw a new thumbnail. **It did not.** So the thumbnail RENDER PATH itself was refusing, not the cache.

**And that puts it in the same family as B706**, which is the first thing to check: the thumbnails render through an engine, and after a failed context restore `sourceTexture` stayed null and every element-path render silently returned false. **Switching to the FHD clip fixed it because a successful `setSource` is exactly what the old code could only get from a fresh load.** If that is the mechanism, B706 already fixes it — so **re-test before investigating.**

**If it survives B706**, the next question is which engine draws the thumbnails and whether it is one of the four now watched, or a fifth surface nobody is marking.

### 🎬 [UX — Daniel, 2026-08-21] THE OUTPUT DISPLAY KEEPS PLAYING DURING A RENDER, AND SHOULD ANNOUNCE ITSELF INSTEAD

**Daniel: *"i notice while rendering a video that the output display is still playing. shouldn't it black out and say 'rendering [clipname]...' similar to how we pause broadcast while baking."***

**The precedent he is pointing at already exists** — a bake pauses the broadcast and says so. A render does not, so the wall keeps showing a live composition while the app is busy producing a file, and the operator has no signal from the surface the audience is looking at.

**Design questions:** should it black out, or hold the last frame with an overlay? (A hard black is a strong statement mid-show; a held frame with a corner badge may be kinder.) Should it carry PROGRESS, given a 3193-frame 4K render is minutes long? And should this be automatic or a preference — **there is a real case for wanting the wall untouched while rendering**, if the render is a side task during a set.

**⚠️ There is also a correctness angle, not just a UX one:** a render and a live broadcast are contending for the same GPU. Whatever this becomes should be decided alongside the recording-capability gate rather than separately.

### 🌀 [UX STORY — Daniel, 2026-08-21] RE-TUNE AUTOPLAY TO WORK WITH AN UNLOCKED CANVAS

**Daniel: *"with another 8+ min FHD clip i'm playing with autoplay and having the canvas unlocked creates some wild transitions where autoplay quickly moves from one location to another while zoomed in in a way that is very disruptive."***

**The story:** *as a performer, I want autoplay to keep exploring the source while the canvas is unlocked, without lurching between distant points.* Today autoplay was tuned against a LOCKED canvas, where the only things moving are slice-local. With the canvas unlocked it can also retarget canvas pan, and **at high canvas zoom a small change in target is a large change on screen** — the same `2/zoom` relationship that made radial pan feel wrong at B694. So the disruption scales with zoom, which is why it reads as "wild" rather than "fast".

**Design questions to settle before building:**
- Should autoplay's step size be **screen-relative rather than state-relative**, so a move covers the same visible distance at any zoom? That is the direct analogue of the pan fix.
- Should a retarget **ease over the transition speed** rather than cut? Perform already owns a transition speed; autoplay currently does not consult it for position.
- Should autoplay prefer **local wandering with occasional deliberate jumps** over uniform random retargeting? A jump that is clearly intentional reads very differently from one that looks like a glitch.
- Does the canvas lock state belong in autoplay's model at all, or should autoplay simply never write `canvasOffset` unless explicitly enabled?

**Related:** `AUTOPLAY'S ZOOM MEANS THE FOLLOWER NEVER SETTLES` (B609), and the accepted-consequences note on removing the pan bound (B694).

### 🎞 [HIGH — Daniel, 2026-08-21, REPRODUCED ACROSS TWO FORMS] THE MOTION PATH ITSELF PLAYS BACK AT AN UNEVEN SPEED

**Daniel: *"while playing through a 4k animation in motion mode with significant panning and zooming across the canvas the lateral movements playback stuttery and jerky. it feels like the issue isn't frame rate but that the actual motion path itself isn't moving at an even speed. e.g. the source video is playing back evenly but the motion across the canvas is uneven, especially while zoomed in... if i switch the form type to square it's clearer to see how the motion path itself is uneven."***

**⭐ Take the framing seriously: he has separated the two clocks by eye.** The source advances evenly; the CANVAS TRANSFORM does not. That rules out frame rate and rules out decode, and it means the defect is in how a keyframed value is sampled over time — not in how often we draw.

**Why square makes it legible:** a lattice gives the eye a fixed reference grid to judge velocity against; a radial wedge does not. **The bug is not form-specific — the readout is.**

**Candidate mechanisms, none yet tested. This is uncertainty state A/B, so instrument or read before changing anything:**
1. **Per-segment easing.** If each keyframe pair eases in and out independently, a multi-keyframe path necessarily pulses — decelerating into every waypoint and accelerating out. This would be *by construction*, would be worse with more keyframes, and is the first thing to read.
2. **Interpolating the wrong quantity.** `canvasOffset` interpolated linearly is NOT constant screen velocity when `canvasZoom` is also animating, because the shader applies `p /= zoom` then `p -= offset`. **Even speed in state space is uneven speed on screen.** This matches "especially while zoomed in" exactly.
3. **The follower/spring** overlaying the keyframe track rather than yielding to it.
4. Sampling the timeline against wall time rather than the source clock.

**⚠️ (2) is the one that would also explain the autoplay item above**, and both would be fixed by the same change. Worth checking whether they are one bug.

**▶ The cheap first move is Class 1 and needs no device:** render the keyframed `canvasOffset`/`canvasZoom` pair over a synthetic timeline in a harness and plot screen-space velocity. If it is not constant between waypoints, mechanism 1 or 2 is confirmed without a build.

**Daniel's own next step, already underway:** render the animation out and compare the file against the preview. **If the render is smooth and the preview is not, it is a sampling/timing bug in the preview loop. If both are uneven, it is the motion model** — and that is the more likely and more important answer.

### 📋 ITEM 1.5 EXIT REPORT — everything the slice/input arc left open, grouped (2026-08-18 docs)

**Daniel's ask:** *"we were going to file an exit report on 1.5 capturing known issues... even though this doc should prob go into archive it will be a helpful paper trail that may help us identify when and how certain issues were introduced."*

**Nothing here is new** — every item was filed as it was found. What was missing is that they were scattered in build order, so the shape of what the arc left behind was invisible. This is an INDEX, not a move: the entries keep their detail where they are. **Archive this section with the arc; keep the entries.**

**Arc scope, for the record:** builds 635-662 — the geometry flip and fold (B635-B645), the crossfade (B642-B652), rig portability (B649-B651), the unified zoom and stage C (B655-B657), and the instrumentation that opened phase 2 (B660-B662). Item 1.5 closed at B657.

---

**A. INPUT / CONTROL BUS — the arc's own subject, and what it did not finish**
- `slice position x/y` still address the ORIGIN, not the box centre (below) — the last named 1.5 sub-item, carried out deliberately as semantics rather than architecture.
- **Locks do not block MIDI / gamepad input** — a lock that holds for one hand and not the other. Carries a persistence decision that overlaps stage manager.
- **Rig portability: MIDI still keys on port name**, so a MIDI rig remains non-portable across OSes; and an import that cannot bind still looks like it loaded fine.
- Should a momentary button default to `rate`?

**B. SLICE GEOMETRY / FOLD — shipped behaviour with known edges**
- **The reachability trade-off** (B659): a very large radial wedge can have its origin pushed off screen with nothing pulling it back. Daniel is living with it deliberately. **The note there names the wrong fix explicitly**, which is the point of filing it.
- **Droste with mirroring OFF** can put the origin on-source with no slice on-source. Working as designed; filed so it is not re-reported.
- Second-order reflections; onion-skin trail under the fold; **companion video + slice overlay under the fold is UNVERIFIED.**

**C. PLATFORM EDGES — intermittent, low, watch rather than chase**
- Firefox cursors over the source (intermittent, likely fixed B648, unconfirmed).
- iPad gesture-surface latency (instrument-first, never instrumented).

**D. NATIVE WORK, BATCHED INTO ONE XCODE CYCLE — the arc's real debt**
- The **device-vitals plugin** (thermal + memory headroom). **The single largest instrumentation hole**, and phase 2 is already blocked on it: every run so far reports `nativeReadings: false`.
- **`listCameras`** for external/USB cameras on iPad.
- Plus the two instrument fixes: `loopCache.coveredMs` under-reporting, and the manual `scenario` tag.

**E. DEFERRED BY DECISION, NOT BY OVERSIGHT**
- **Stage manager / per-mode state** — parked with Daniel's own straw man recorded.
- Colour management — named as new-feature-shaped, belongs with stage manager.

---

**⚠️ THE PATTERN WORTH CARRYING FORWARD, since a paper trail is the point.** The arc's recurring defect was **one behaviour with two implementations**, and it appeared SEVEN times: droste's overlay missing `sizeNorm` (B614), radial's polygon missing `canvasNorm` (B618), the overlay missing `canvasOffset` (B612), the centring hook reaching only one chrome (B619), six copies of the transition default (B622), `env.panDrift` covering one of two joysticks (B620), and the slice-scale clamp written six times at three different maxima (B657). **Two more arrived as fresh instances during the arc itself** — B653's ruler re-implementing the scrub instead of calling it, and B638's flag set on the wrong `env`-shaped object. It is not a hypothesis; it is the shape of this codebase's bugs, and `CLAUDE.md` now leads with it.

### 👁 [Daniel, B694 — WATCH ITEM, HIS CALL] OUTPUT BRIEFLY DOUBLE-EXPOSES AFTER AN AGGRESSIVE ZOOM-OUT + PAN

*"zoom way out on the canvas, pan aggressively, use the slice overlay on the source to zoom back in. upon doing so the output quickly flickers showing two videos overlaid on top of each other."* Does not reproduce consistently. **Daniel filed it as a watch item explicitly; do not spend a device session on it until it recurs.**

**⚠️ HIS DIAGNOSTIC IS THE VALUABLE PART AND IT NARROWS THIS ENORMOUSLY.** *"capturing a screenshot on device renders only a clean single image but i took a photo of my ipad screen on the iphone that looks like a double exposure."*

A screenshot captures the composited framebuffer; a camera integrates light across several refreshes. **Clean screenshot + doubled photo means two DIFFERENT images were on the display within one exposure — temporal alternation, not a corrupted frame.** That rules out, without a device:

- the shader, the fold, the geometry, the source texture, the planar path — **anything that would corrupt a single frame would appear in the screenshot too.**

**Killed by reading:** the classic double-buffer flicker (a rate-gated frame that returns without drawing, leaving the other buffer visible). `engine/gl.js` sets `preserveDrawingBuffer: true`, so a skipped render leaves the previous content intact. Not this.

**What remains, and it is a real structural candidate: TWO VISIBLE SURFACES SHOW DIFFERENT LOOKS OF THE SAME VIDEO IN PERFORM MODE.** `main.js:646` renders raw `state` to the main canvas, while `perform-runtime.js:529` renders `env.performRT.followed` to `#livePipCanvas`. During an aggressive pan the follower lags the state by a lot, so the two surfaces genuinely hold two very different frames. `#clipBlend` is a second stacked canvas worth eliminating too.

**▶ IF IT RECURS, THESE THREE FACTS RESOLVE IT AND NOTHING ELSE IS NEEDED:** was PERFORM mode active; is the doubled region the WHOLE frame or a sub-rectangle; and does it survive with the live PiP closed.

### 🧭 [Daniel, B694 — REPRODUCED AND EXPLAINED, DELIBERATELY NOT FIXED] RESETTING THE CANVAS LEAVES THE SLICE TINY

*"zoom out using the canvas, zoom back in using the slice, reset canvas, reset slice. result is that the slice ends up being quite tiny... conceptually feels like the right trade off, to not edit both slice and canvas when only resetting one. but in practice it feels unexpected."*

**Reproduced numerically** (`scratchpad/quirk.mjs`), and the cause is the unified zoom's overflow:

```
0. defaults              canvasZoom 1.000  sliceScale 1.000  box extent 0.633
1. zoom out on canvas    canvasZoom 0.050  sliceScale 2.000  box extent 25.312
2. zoom in on the slice  canvasZoom 0.050  sliceScale 0.350  box extent 4.430
3. reset canvas          canvasZoom 1.000  sliceScale 0.350  box extent 0.221   <-- the tiny slice
```

`applyUnifiedZoom` is canvas-PRIMARY with overflow: once `canvasZoom` pins at `Z_CANVAS_MIN = 0.05` the remaining zoom spills into `sliceScale` (up to the form's `zoomCover`). Zooming back in **via the slice overlay** then reduces `sliceScale` directly while `canvasZoom` stays pinned at the floor. Reset canvas restores `canvasZoom` and leaves `sliceScale` where the user left it, so the slice is now about a third of default. **Daniel's own reading of the tradeoff is correct — this is reset canvas doing exactly and only its job.**

**⚠️ ONE PART DOES NOT REPRODUCE AND SHOULD NOT BE ASSUMED:** he reports needing a SECOND reset to correct it. In simulation `resetSliceState` is idempotent and the first call restores the default extent exactly (0.633). Either a real-app path (the anchor, the fold, or the overlay drag writing more than `sliceScale`) is involved, or the repro differs from what was modelled. **Establish that before building anything.**

**His proposed fix is the right instinct and needs provenance we do not have.** *"maybe we consider normalizing the slice size as part of zooming to reset canvas from an extreme?"* We cannot currently tell how much of `sliceScale` was spilled there by the canvas gesture versus set deliberately by the user on the slice. The shape would be a spill accumulator written ONLY by `applyUnifiedZoom`'s overflow branches and consumed by reset canvas.

**Not built, on a risk read:** it introduces provenance state into a zoom path that took several builds to stabilise (B563, B611, B612, B657), and it has to stay invisible to presets, motion keyframes and the perform follower or it becomes a fourth thing that can desync. The current behaviour costs one extra click and is recoverable. **Revisit only if it bites during a real set.**

### 📌 [B694 — ACCEPTED, NOT A BUG] TWO CONSEQUENCES OF REMOVING THE PAN BOUND

Filed so a future session does not "fix" them. Daniel accepted both explicitly: *"we're talking about support for an edge case because the main use case of just being able to gesture and pan and pinch intuitively and pan around within a few wraps feels constrained."*

- **Past ~20 fold units the centre cannot be found by zooming out.** Canvas zoom floors at `Z_CANVAS_MIN = 0.05`, which shows a fold radius of 20. `action:panRecenter` (B694) is the way home.
- **A long drift at deep zoom-out quantises visibly after ~45 minutes.** float32 loses the screen-relative variation in `p -= offset`; ~4px blocks at offset 40,000. Degrades smoothly, never crashes.

**The fix for both exists and was deliberately dropped.** The offset is exactly periodic past 3 fold units (offset O and O+P differ by ~1e-15, P = `4/(sliceScale × sizeNorm)`), so wrapping would make drift unbounded AND keep the centre reachable. Revisit only if long-form drift becomes a real use case; it would need a `sliceScale`-change recompute, a mirror-mode gate, and validation against the real shader rather than the isolated model.

### 🎯 [B619 → carried out of item 1.5 at B657] `slice position x/y` STILL ADDRESS THE ORIGIN

The mapping targets `sliceCx` / `sliceCy` write the slice ORIGIN, but since B616 the app's model is the BOX CENTRE — which is what a drag moves, what `placeSliceBox` solves for, and what the fold bounds. **So a fader on slice position means something different from what your hand does**, which is the one-behaviour-two-surfaces class this arc keeps paying for.

**Filed here rather than held open in the plan (B657):** it is a semantics correction to two targets, not architecture, and keeping item 1.5 open for it misrepresents where the input work actually stands.

**Implementable without a special case** — B619 added the `write` hook, so the target can write through `placeSliceBox` the way `segments` writes through its setter. Small.

### 🌀 [OPEN — Daniel's question, 2026-08-19] DROSTE IS CENTRED AS A CIRCLE, NOT AS ITS VISIBLE WEDGE

Daniel: *"I know the droste form has some bespoke JS — can you confirm those are all handled in your universal polygon shape detection?... for a droste segment where 1 = the entire circle and a higher count might be a narrow slice."*

**Confirmed and it is worth writing down, because the answer is "by a deliberate design that predates B690, not by the anchor".**

`droste.buildPolygon(state)` **ignores `state` entirely** — it returns a 32-point unit circle at every arm count, zoom and spiral. The true sampled outline lives in `ghostPaths(state)` (the annular wedge with twist-shifted inner arc and log-spiral sides), and **`formBoxCenter` deliberately does not read it.** `geometry.js` says why:

> *"Collapsing them would break droste in the exact way Daniel reported: because the droste origin is far away from the slice, you can drag near the origin and push the slice itself entirely off canvas."*

Two boxes, two questions: `formBoxCenter` (origin-seeded, `buildPolygon`) answers *"where should a freshly reset form sit"*; `sliceBoxCenter` (no seed, `ghostPaths`) answers *"is the visible slice still on screen"*.

**So B690 cannot move droste** — proven in `anchor-check.mjs`: changing arms, droste zoom or spiral returns `false` from `syncSliceAnchor` and leaves the origin byte-identical. Only form / source aspect / frame aspect / mirror re-solve it, exactly as before.

**⚠️ THE LATENT GAP, WHICH IS PRE-EXISTING AND NOT A REGRESSION:** at `arms ≥ 2` the visible annular wedge sits off to one side of that circle, so "centred" for droste means **the circle is centred, not the wedge**. A reset droste at arms=12 is therefore less centred than a reset radial. Daniel's intuition is right.

**Do NOT fix it by pointing `formBoxCenter` at `ghostPaths`** — that is the collapse the note above forbids, and it would re-open the drag-off-canvas bug. The fix, if wanted, is for droste to declare an HONEST `buildPolygon` that tracks arms while still containing the origin, so both consumers stay correct. **That is a droste geometry change with its own verification pass, not a tidy-up.**

### 🔒 [Daniel, B655 — DESIGN ITEM, DELIBERATELY NOT BUILT] LOCKS DO NOT BLOCK MIDI / GAMEPAD INPUT

*"Currently our settings locks don't block MIDI/gamepad inputs. e.g. if the form selection input is locked in the app, the dualsense gamepad can change forms without any resistance."*

**A lock that holds for one hand and not the other is not a lock**, and this is the same shape as the bug class this arc keeps paying for: a rule enforced at one surface while another writes the field directly. `isLocked()` is consulted by the control UI; `writeParam` never asks.

**Daniel's three candidate directions, and they are complementary rather than alternatives:**

1. **Enforce at the write.** A mapping targeting a locked field declines, and *says so* — a toast or the existing `in-idle` row flash, in the vocabulary B624 already established for "this mapping declined because its target does not apply to the active form". **This is the correctness fix and the smallest one.** The decline must publish why; a silently ignored knob is worse than one that works.
2. **A global unlock for hardware** — an explicit "hardware ignores locks" escape, for the case where the rig IS the intended authority and the locks were set for mouse work.
3. **A lock inventory surface** — one place showing what is currently locked, with unlock-all and per-field control. Today locks are set only where each control lives, so there is no way to see the set.

**Daniel's recommendation is a hybrid, and his structural observation is the important part:** *"this probably moves our lock states from ephemeral session based to persistent memory if we build UI around the settings."* Right — a lock you can only see at the control can survive being ephemeral; **a lock inventory implies locks are worth persisting**, which makes them rig state rather than session state, which means they need a home in the config and a decision about whether they travel with a saved rig.

**Sequencing note:** (1) is worth doing on its own and is independent of the rest. (2) and (3) are one piece of work with a persistence decision inside it, and that decision overlaps the stage-manager / per-mode-state design already queued — locks are one more thing whose scope is "per mode or global?".

**Related:** this is arguably the first concrete instance of item 1.5 stage C (ownership and handoff) showing up as a *product* question rather than a jerk — "which input owns this field" and "may this input write this field at all" are the same question asked twice.

### 🎯 [Daniel, B659 — SHIPPED, ONE CONSEQUENCE AWAITING HIS LONG-TERM READ] THE FOLD MEASURES REACHABILITY, SO A HUGE RADIAL WEDGE CAN PUSH ITS ORIGIN OFF SCREEN

The fold's trigger now measures REACHABILITY (`max(inter/span, inter/viewSpan)`) rather than "what fraction of the slice is visible", which was meaningless once a slice outgrew the view. Radial was the only form that could expose it, because its wedge extent is `1 / (canvasZoom × canvasNorm)` and so grows without bound on zoom-out.

**The open question is not the rule, it is the trade-off Daniel accepted to get it:** a very large radial wedge can now have its ORIGIN pushed off screen with nothing pulling it back, because the wedge still covers the view and the fold correctly reports it reachable. Recovery is zoom in or reset slice. He is *"going to play with the consequence and confirm this feels like the right trade off long term."*

**If it turns out to be wrong, the fix is NOT to reinstate a span-only test** — that reintroduces the exact bug. The lever would be an origin-specific affordance (e.g. an on-screen indicator of which direction the origin lies, or a "bring origin back" action), which addresses reachability of the ORIGIN without lying about reachability of the SLICE.

### 📎 [Daniel, B653 — WORKING AS DESIGNED, RECORDED SO IT IS NOT RE-REPORTED AS A BUG] DROSTE UNMIRRORED CAN PUT THE ORIGIN OVER THE SOURCE WITH NONE OF THE SLICE ON IT

With mirroring OFF, droste can reach a state where the **origin is over the source but none of the slice is**. Daniel: *"since the origin is still interactable i'd flag this as a known quirk that's working by design vs a bug."*

Agreed, and the reason is structural rather than incidental. **The fold only exists because mirror mode makes it free** — `(cx, m)` and `(2n − cx, −m)` sample identical pixels, so re-expressing the slice as its own reflection cannot change the output. In clamp or transparent OOB there is no such equivalence: a slice pushed off the source is genuinely sampling nothing, and folding it back would change the picture rather than merely rename it. So the guardrail correctly does not apply, and the origin stays interactive because it is the handle that gets you back.

**If this is ever revisited**, the fix is not to fold — it is to decide whether a fully-off-source slice deserves an affordance saying so. Do not "fix" it by extending the fold to non-mirror modes.

### 🎛 [Daniel, B649 → B650 + B651] RIG PORTABILITY — WHAT IS LEFT

**Shipped:** the canonical vendor+product pad key (B650) and the device-level re-home picker (B651), which together cover both the same-controller-different-browser case and rescuing a rig imported under a key this browser does not produce. Whole-rig export stays as-is — Daniel: *"lets keep the current behavior to copy everything in one go."*

**Still open:**

- **⚠️ BRAVE DID NOT BIND THE SAME FILE FIREFOX DID (Daniel, B653 verification).** *"The ability to load the saved electron mapping worked in firefox but not brave."* That is backwards from the naive expectation — Brave is Chromium, like the Electron the rig came from, so it should have been the easy case. **Hypothesis, NOT confirmed: Brave's fingerprinting protection masks or farbles `gp.id`**, which would strip the vendor/product pair and drop `padKey` to its legacy-slug fallback, producing a key nothing else can produce. **One-look discriminator:** read the device name on the Brave row in the inputs sheet — if it is generic, or lacks a recognisable controller name, Brave is rewriting the id and no keying scheme of ours can be portable there. The B651 picker resolved it in practice (Daniel: *"a great workaround and now Brave is using the exported electron mapping no problem"*), so this is a diagnosis worth having rather than an open blocker.
- **MIDI still keys on `slug(input.name)`**, and port names differ per OS, so a MIDI rig remains non-portable across platforms. The B651 picker is the manual escape hatch; there is no MIDI equivalent of the vendor+product pair to canonicalise on, so this may be as good as it gets without a fingerprint built from the port's control surface.
- **A rig referencing a device that is not connected still looks like it loaded fine.** The import path says nothing, and the operator finds out by noticing an offline row. An import that named what it could not bind — and offered the re-home there and then — would close the loop the B651 picker currently only reopens after the fact.
- **Row-level re-home** (drag one mapping to another device) — deliberately skipped at B651 in favour of the device-level move, since the reported case was 24 rows at once. Worth adding only if a mixed rig turns up in practice.

### 🐢 [B636→B640, Daniel] iPAD GESTURE-SURFACE LATENCY — UX POLISH

**Daniel's call: polish, not a blocker.** *"Still functional and adequate but shows increased latency and choppiness compared to earlier states."*

**What is known, so the next attempt does not restart:** B636 removed a genuine per-frame forced reflow (`visibleUVRect` reading `clientWidth`, promoted from drag-only to every frame by B635). That was a real improvement to a real problem and **did not fix this**, so the cause is unidentified. A box measurement is ~1µs, so the fold's arithmetic is not a plausible candidate either.

**⚠️ DO NOT GUESS A THIRD TIME.** Tier 1 by DEBUGGING-PROTOCOL: the quantity is invisible, it is device-only, and a wrong guess costs a device session. The next move is INSTRUMENTATION that reaches the exported report — not another candidate fix.

**Suggested conserved quantity:** timestamp each remote event at arrival → state write → render commit, and report the distribution. That separates "the network is delivering in bursts" from "our frame is late", which are currently the same picture from outside. The `reportAudio` → `env.lastAudioReport` → perf-panel shape is the established pattern.

### 🪞 [B639, Daniel] SECOND-ORDER REFLECTIONS — reflect the reflection

On iPad, dragging continuously can pull the solid outline out of view and then the reflection out of view too, at which point nothing is drawn. Daniel: *"acceptable, but it would be preferable to reflect the reflection visibly here."*

The overlay currently draws only FIRST-order copies — reflections about u=0 and u=1 plus the four diagonals. The mirrored plane's full symmetry group also contains **translations by 2**, which is what covers a slice out past u=2. Generating copies for k ∈ {−1,0,1} per axis and keeping only those whose bounding box intersects the visible rect would be both more general and simpler than the current hand-listed eight transforms, and the existing REFLECT_FADE LOD already bounds how many actually paint.

**Deferred, not forgotten** — and lower value since B639, because with the fold now gated for gamepad and knob input as well as pointer drags, this state is transient during a gesture and self-corrects on release.

### 🎚 [B639] SHOULD A MOMENTARY BUTTON DEFAULT TO `rate`?

Daniel asked whether a held button can send continuous input like a joystick. **It already can — set the mapping's mode to `rate`** (offered for momentary signals; `rel` is the default). Press sets the deflection, release clears it, and the rate loop integrates in between.

The open question is whether `rate` should be the DEFAULT for a momentary button on a continuous target. It would suit droste infinite zoom and canvas zoom; it would be wrong for anything people tap once. Wants Daniel's call, not a guess.

### 🎬 [B636 — ⚠️ UNVERIFIED FOR ~70 BUILDS] COMPANION VIDEO + SLICE OVERLAY UNDER THE FOLD

The one B635/B636 surface Daniel has not smoke-tested: the rendered companion video that burns the slice overlay in. It borrows `drawSourceOverlay` with `overlayStrokeScale` bumped, so it inherits the handedness and the reflected-origin dot for free **in principle** — but it renders from a state stream rather than live interaction, and nothing has watched a fold happen inside a recorded take.

**What to look for:** an outline that mirrors mid-take without the render changing (correct), versus an outline that jumps to a position the render never showed (wrong). Also whether ghost/onion-skin passes appear in the burn.

### 🌀 [B636] ONION-SKIN TRAIL: DROP vs RE-FOLD

Shipped the conservative option — the trail clears on a fold, per Daniel's own recommendation. The alternative is to re-fold each ghost into the new frame, which keeps the history and makes the trail visibly bounce off the source edge exactly as the render did. More information, more to read. **Revisit only if losing the trail on every fold turns out to be the more annoying of the two.**

### ⌨️ [Daniel, B624] A MODIFIER / SHIFT LAYER FOR THE CONTROLLER — the honest answer to form switching

His problem: five forms, four face buttons. Left-stick-press works but is *"an unexpected input location"*. He proposed chords: `X + O` = droste where `O` alone = radial.

**Chords as literally described have a latency problem that rules them out.** If `O` alone means radial and `X + O` means droste, then pressing `O` must WAIT to see whether `X` follows — so the common single press pays a detection window on every use. Live controls cannot afford that.

**A HELD MODIFIER has no such cost and is how every hardware controller solves this.** Designate one button (L1, or left-stick-press, which he already finds unobtrusive) as SHIFT. Held + any face button = a second layer. Unambiguous, zero added latency to the unshifted press, and it **doubles every binding on the controller** rather than solving forms alone.

**Why `last form` does not cover it, and he is right:** *"if you were on square previously and want to go to droste or radial wedge, back sends you to neither."* Last-form is for oscillating between two; it is not addressing, and addressing is what he needs for five forms.

**Scope:** the bus is stateless per signal today, so this needs a held-signal set (a button's press/release already both arrive, so the state is available) plus a per-row `shifted` flag and a UI affordance for assigning the modifier. Not trivial, not large. **Worth doing — it is the general fix for "I have run out of buttons", which will recur as targets keep being added.**

### 📱 [Daniel, B624] THE PHONE/TABLET GESTURE SURFACE SHOULD REACH ACTIONS TOO, NOT JUST AXES

*"the ipad/iphone gesture input surface would also benefit from being able to tie into some of the midi controls to change forms, reset canvas, etc."*

**Sanity check confirmed: no technical blocker.** The remote surface already emits `mob:mobile.<zone>.<kind>` signals over the WS, and `onSignal` routes them through exactly the same mapping layer as MIDI and gamepad. Adding buttons means new signal names and nothing else in the pipeline. **His read is right — the work is entirely UI: what controls, in which zone, and how they avoid competing with the gesture areas.**

Worth pairing with the modifier-layer item, since both are "the surface has run out of room" problems.

### 🔭 [B612 DIG — three of Daniel's four droste invariants now have MECHANISMS] WHAT MAKES DROSTE DRIFT, AND WHICH LEVER OWNS EACH

**1. ✅ ROOT-CAUSED — "you should never be able to zoom non-proportionally to the slice overlay."**
`overlay.js` and `geometry.js` reference `canvasOffset` **nowhere**. The overlay is computed from `sliceCx/Cy`, `sliceScale`, `sliceRotation`, `sizeNorm` and the source aspect only.
- **On a tiling form that is CORRECT.** A lattice translation is a symmetry of the tiling, so the sampled source region genuinely does not move. The overlay stays true for free.
- **On radial and droste it is WRONG.** No lattice means the offset really does move which source region is hit, and the overlay keeps drawing the old one.
- **Fixing it properly is hard**: the offset applies before the fold, so its effect on the source region is not a translation and cannot be mirrored by shifting the overlay. **Realistic options: keep the offset small enough that the overlay stays approximately true (B611's ±1 clamp does some of this), or give the overlay an honest "the sample has moved" state.**

**2. ✅ ROOT-CAUSED — droste's seamless zoom has two preconditions, documented and enforced NOWHERE.**
[droste.js:79-84](../src/engine/forms/droste.js#L79-L84) states them plainly: **offset centered** (*"the Möbius pre-comp is NOT scale-invariant — why the offset is default-locked"*) and **spiral = 0** (*"a seamless spiral zoom must couple canvasRotation to cancel it — the Droste screw motion, not yet wired"*). Both are only DEFAULTS. Unlock pan or move the spiral and the form's headline feature silently stops being seamless, with nothing said.
- `panLockedByDefault: true` is the closest thing to enforcement, and it is a default, not a contract.

**3. ✅ MECHANISM FOUND, partly fixed B612 — "staged is correct, live is stuck."**
The shader renders `phase mod 1` while `state.drosteZoomPhase` is a deliberately UNWRAPPED accumulator (the motion tween needs it that way for multi-loop keyframes). **So staged looks identical at phase 0.4 and 200.4, and the follower has to travel every loop between.** The two views never disagreed about the picture, only the distance. B612 bounds gesture travel to the follower's `LEAD_CAP`; it does not establish the general invariant.

**4. Understood since B611** — the translation carry. See the `canvasOffset` entry below.

### 🎯 [PROPOSAL — B612] ROUTE DROSTE'S PAN TO `drosteOffsetX/Y`, NOT `canvasOffset`

**Three independent arguments converge on the same conclusion**, which is why this is worth doing properly rather than clamping harder:

1. **Geometric** (Daniel, B611): translating an offset from a wallpaper form to a form with a known centre is nonsense.
2. **The form's own code** (droste.js:79-80): seamless infinite zoom REQUIRES a centred offset, because the Möbius pre-composition is not scale-invariant.
3. **The overlay** (item 1 above): a raw `canvasOffset` moves the sampled region and the overlay cannot show it.

**And droste already HAS a correct off-centre control.** `drosteOffsetX/Y` is a disc automorphism — it keeps the unit circle fixed and maps each tier ring to another circle, which is exactly what preserves the seamless loop. **`canvasOffset` on droste is a strictly worse duplicate of a control that already exists.**

**So the proposal is not "remove the capability" but "point it at the right parameter."** Unlocking pan on droste would drive `drosteOffsetX/Y`, so the gesture still pans, off-centre composition still works, value-sharing across forms still behaves — and the blow-up class disappears rather than being bounded.

**Needs Daniel's call** because it changes what a pan gesture does on one form, and because `drosteOffsetX/Y` is currently gated behind the `manual` toggle for a reason.

### 🧭 [INVARIANTS PROPOSED — Daniel, B611] FOUR RULES THE INPUT/FORM LAYER SHOULD HOLD

Daniel, B611, reading across the whole cluster: *"it seems like there are a number of compounding issues."* He is right, and each of these is stated as an invariant so a violation is a bug rather than a judgement call.

1. **You should never be able to zoom non-proportionally to the slice overlay.** The overlay's job is to show what is being sampled. If the canvas can zoom past it, the overlay is lying — an exit-criterion-2 (honest labels) failure on the one surface whose entire purpose is telling the truth about the sample.
2. **There should be no state the app cannot get out of.** Any runaway needs a bound or a recovery, and preferably both.
3. **Live must always follow staged and must never get caught doing its own thing.** The strongest of the four, and the current design violates it: the follower holds its own accumulator that can diverge permanently. See the recovery item above.
4. **Positional X/Y must not carry from an infinitely-mirroring form to a form with a known centre.** Daniel: *"that carry over is nonsense."* Correct — see the entry below.

**On his broader question — should form properties carry over between forms at all?** He noted the tension himself: at B609 he wanted basics like slice position and scale to persist during a live form switch, and at B611 he wondered whether never carrying is cleaner. **Proposed resolution, which satisfies both: carry a property iff it means the SAME THING in both forms.**
- **Carry** the slice family (`sliceCx/Cy`, `sliceScale`, `sliceRotation`) — these describe how the SOURCE is sampled, identical in every form, and they are what makes a live form switch feel continuous.
- **Carry** framing (`canvasZoom`, `canvasRotation`) — same meaning, and `canvasNorm` already normalises the per-form difference.
- **Do NOT carry** `canvasOffset` — it is three different things (below).
- **Harmless either way:** form-private params (`droste*`, `squareAspect`) are ignored by forms that do not declare them.

**The line to remember: it is not "carry vs don't carry", it is "does this word mean the same thing over there".** Pan is the first parameter where it genuinely does not.

### 📐 [DECISION NEEDED — Daniel, B609/B611] `canvasOffset` MEANS A DIFFERENT THING IN EVERY FORM

**No longer hypothetical: it produced the B611 droste blowup.** One global `canvasOffsetX/Y` is:
- a **lattice pan** in square/hex/triangle (wrapped mod the period, loops seamlessly, accumulates unwrapped)
- a **centre shift** in radial (no lattice, raw)
- a **log-polar centre** in droste (no lattice, raw) — where droste ALSO has its own `drosteOffsetX/Y` for the same concept, with its own joystick and its own ±1 range

B611 clamps the non-lattice case to ±1, which bounds the damage without resolving the design. **The real question is Daniel's own from B609: which properties carry over between forms, and when.** His stated intuition — persist basics like slice position and scale when switching forms during a performance, do not persist discrete changes across still/motion modes — needs extending to say what happens when a value has **no meaningful translation** into the destination form. Pan is the first case where it genuinely does not.

**Options:** per-form offset storage; convert on switch (wrap into the old form's period first, so the carried value is the smallest equivalent); or declare pan non-carrying and reset it on a form change. **Stage A/C of the input plan.**

### ♾️ [MED — Daniel, B609; NOT the runaway he hit] AUTOPLAY'S ZOOM MEANS THE FOLLOWER NEVER SETTLES

**Symptom (Daniel, B609, iPad gesture perform mode):** *"our infinite zoom control actually got locked into an infinite loop... the accumulated follow just kept following and following forever."* No repro steps known at report time.

**✅ ROOT CAUSE FOUND BY READING (Class 1, no device time). It is two deliberate designs composing into a behaviour nobody asked for.**

1. **The autoplay walker never settles, on purpose.** [kit/drift.js:80-87](../src/kit/drift.js#L80-L87) treats `drosteZoomPhase` as a **continuous-velocity walker rather than a spring** — Daniel's own tuning call: *"once it picks a direction it KEEPS MOVING that way (no settle/pause between picks); only the SPEED varies."* So the target advances forever while autoplay is on.
2. **The follower is uniquely amplified for this one field.** [kit/follow.js:51-57](../src/kit/follow.js#L51-L57), `drosteZoomPhase` is the ONLY field opting into both a raised `LEAD_CAP` (**4 periods**, vs 1 for rotation) and a `BOOST` (omega up to **4x**). Both were added so a vigorous multi-loop pinch is honoured in full.

**Together: a target that never stops moving, chased by a permanently boosted spring.** `isSettled()` can never return true.

**The consequences are worse than the zoom itself**, because `isSettled` gates other things in [perform-runtime.js:536-541](../src/shell/perform-runtime.js#L536-L541):
- the **onion-skin ghost trail never fades** and keeps accumulating (`settleFadeT` is reset every frame)
- the live/staged **"showing the same thing" affordance can never fire**
- omega stays elevated, so everything about the chase reads frantic

**▶ NEEDS DANIEL'S CALL, because both underlying behaviours were his:**
- **(a) Exclude `drosteZoomPhase` from the settle test.** Surgical, and the principle is sound: **a field that is deliberately always-moving must not be allowed to answer "are we in sync?"** Fixes the ghost trail and the affordance without changing either design.
- **(b) Exclude infinite zoom from autoplay by default.** Already filed as an option under the droste entry; a bigger product change.
- **(c) Cap the walker.** Contradicts the "keeps moving" design directly.

**Recommendation: (a).** It is the only one that treats the real defect, which is that a never-settling field was allowed into a settle test.

**Also observed while reading, filed not fixed:** `follow.js step(dtMs)` has **no upper clamp on `dt`**, unlike its sibling motion loop in `input-bus.js` which clamps at 100ms. On a device that demonstrably hitches for 150ms to 2s (loop laps, bakes, GL restores), a large `dt` feeds an exact critically-damped formula that assumes constant omega across the step. It resolves to a teleport rather than a runaway, so it is not this bug, but it is worth a deliberate decision rather than an accident.

### 🌈 [OPEN — Daniel, B594] GREEN/RGB CHANNEL GLITCH ON THE FIRST MOTION → PERFORM TRANSITION

**"there's a brief moment where colors get screwed up and RGB channels seem to be firing weird (glitchy green view)."** First transition only, seen across two builds. A green cast on a YUV path is the classic signature of **sampling a plane texture before all three planes have been uploaded**, or of a plane texture allocated at one size and read at another.

Class 1. Look at the perform engine's `setPlanarSource` / first `updateSourceFrame` ordering, and at whether the PiP engine's reader can return a frame before its textures are sized. **Last member of the source-switch cluster still without a root cause.**

### 🟠 A LOCKED CONTROL WILL NOT UNLOCK DURING A BROADCAST (Daniel, B571)

Tapping the **form** padlock mid-broadcast opens the tooltip but does not unlock. B469's decision was that structural locks (form/segments/spiral/mirrors/oobMode) stay user-unlockable mid-broadcast and only `frameAspect`/`outputRes` are hard-locked. Either the wiring regressed or form is being treated as encoder-tied. Check `locks.js` against the B469 list.

### 🚪 MODE SWITCHING IS GATED ON HAVING A SOURCE (Daniel, B564) — likely removable

**Daniel:** *"we currently disable switching modes until a source has been added... it'd feel more natural to switch to perform mode and then turn on the live camera instead of the reverse. unless there's a legit constraint gating us lets unlock that."*

**What I found reading it, not yet changed** (it spans mode lifecycle, so it wants a proposal rather than a drive-by):
- `motion-runtime.js` gates **perform** on `engine.getSourceImage()` — any source, including a live camera.
- The same file **force-exits perform when the source goes away**: `if (env.performRT?.active && !engine.getSourceImage()) env.setPerform?.(false)`. **That is the real blocker** — even if the button were enabled, entering perform with no source would immediately bounce you out.
- **Motion** is gated on `available` (a video clip), which is a different and more defensible constraint.

**So the perform gate is self-imposed and the unlock is two changes, not one:** enable the control, and relax the force-exit to fire only on a source being *removed* rather than on absence. Risk is in whatever `perform-runtime` assumes about a source existing at entry (`play.disabled = !hasVideo` suggests it already tolerates sourceless states, but that is a reading, not a test). Worth doing; worth doing deliberately.

---

## 📷 Sources, cameras and audio

### 🎮 [HIGH — Daniel, 2026-08-21, ROOT-CAUSED BY READING — REGRESSION OF THE B595 CLASS] THE PLAY BUTTON LIES AFTER A SOURCE SWAP

**Daniel: *"after switching sources and hitting play on a new 1:46 4k source it wasn't playing. if i hit pause it stays paused and the button changes to play. when i hit play again it plays as expected. quite some time back we had a similar issue and the fix was supposed to make it impossible for the button to be dishonest about its state."***

**✅ FOUND, and it is four lines** (`shell/native-video.js:234`):

```js
play() {
  state.paused = false;                              // ← flag moves FIRST, unconditionally
  FoldNativeVideo.resume().catch(() => {});          // ← failure swallowed
  FoldNativeVideo.setRate({ rate: state.rate }).catch(() => {});   // ← failure swallowed
},
```

**The flag is written optimistically and no failure path can ever correct it.** If `resume()` rejects — which is exactly what a just-swapped source does while the plugin is still settling — the UI reads "playing" forever and the clip is parked.

**And it reproduces his sequence exactly:** press play → flag says playing, `resume()` rejects silently, nothing moves. Press pause → flag says paused, `pause()` lands, **flag and player now AGREE**. Press play → the swap has settled, `resume()` succeeds, it plays.

**This is the same class B595 fixed, re-entering from the other end.** B595's note is still in the file: *"the flag and the player disagreed from the moment of load."* That fix corrected the LOAD path; the PLAY path was left able to reintroduce the same disagreement.

**The fix, and it should be the shape used everywhere:** set the flag from the RESULT, not before the call. `await` the resume, set `state.paused = false` on success, and on rejection leave the flag true and **publish the reason** — the `.catch(() => {})` pair is a direct violation of *anything that can decline to act must publish why*. **`pause()` at line 239 has the identical shape** and should be fixed in the same pass; its failure direction is benign today but it is the same latent bug.

### 🔊 AUDIO ON LONG TAKES — NOT REPRODUCING since B558 (Daniel, B559)

**Downgraded from two open HIGH/MED bugs to one watched item.** Daniel's 5:06 4K take on B558 came back clean by ear and clean by the numbers, after a 6:03 4K take on B557 that drifted obviously. The B558 mic change is a *specific mechanism* for both symptoms rather than a coincidence, so this is not being closed on luck — but two clean takes after one dirty one is not proof, which is why it stays watched rather than deleted.

- **✅ Quality — FIXED B558, confirmed by ear.** Voice-processing (echo cancellation / noise suppression / AGC) was ON for every mic. On iOS those flags also select the **voice-processing audio unit**, a different input path with its own resampling. That is the quality gap against Apple's Camera app.
- **👁 WATCHED: drift on a long take.** B559 numbers on 5:06 at 4K: `videoSpanSec 305.5` vs `audioSpanSec 305.9` (0.13%, and a tail offset is expected since audio keeps flushing past the last video frame), `secondsIn 305.9` / `secondsOut 306` so the encoder lost nothing, `captureLatencyMs 73-113` so the stamp was stable within two frames. **Symptom to watch:** audible lip-sync error growing toward the end of a take. **What it would mean:** the voice-processing unit was not the cause and samples are being lost under main-thread saturation. **First read:** the same four numbers — a `videoSpan`/`audioSpan` gap beyond ~1% is the tell.
- **👁 WATCHED: occasional static.** Not present in either B558/B559 take. Same suspected mechanism, same first read.

### 📷 [Daniel, B623] USB WEBCAM: THE WEB APP FINDS IT, THE NATIVE CAPACITOR APP DOES NOT

Testing the iPad as a kaleidoscope selfie kiosk with a USB webcam attachment. **The web app enumerated it fine; the native Capacitor build could not find it.**

This is a capability question, not a bug in our code: the native camera path (`native-camera.js` / the Capacitor plugin) enumerates through AVFoundation, and external/USB cameras need `AVCaptureDeviceTypeExternal` (iPadOS 17+) to appear in a discovery session — the default device-type list does not include it. The web path goes through `getUserMedia`, which WebKit already handles.

**Two honest options.** Extend the native discovery session's device types and test on the actual hardware; or **fall back to the web camera path when the native enumerator returns nothing**, which is cheaper and also covers future device classes we have not met. **The kiosk use case is a real product direction** (Daniel raised it unprompted) so this is worth scoping rather than filing and forgetting.

**Cross-ref:** `reference_ios_camera_webkit_capabilities` records what `getUserMedia` exposes on iOS 26 — relevant, because if the web path covers the kiosk needs, the fallback is the whole feature.

### 📷 [Daniel, B661 — NATIVE, BATCHES WITH THE VITALS PLUGIN] iPAD CANNOT SEE EXTERNAL CAMERAS

Long-deferred and re-raised: the web app enumerates a USB webcam, the Capacitor build cannot. **Confirmed by reading the plugin:** `fold-native-camera` discovers only `.builtInUltraWideCamera` / `.builtInWideAngleCamera` / `.builtInTelephotoCamera` filtered by `position`, and exposes **no list method at all** — `pluginMethods` is start/stop/exposure/zoom/WB/focus/photo. There is nothing for JS to call, so this cannot be fixed on the JS side.

**What it needs:**
- A `listCameras` method running `AVCaptureDevice.DiscoverySession` with **`.external`** (iPadOS 17+, covers USB/UVC webcams) and **`.continuityCamera`**, at `position: .unspecified` — external devices report no position, so the current position filter would exclude them even if the types were listed.
- `start` to accept a `deviceId` so a discovered device can be selected, rather than only lens + facing.
- A JS picker in camera settings, and the `?url` param / Lab entries that come with it.

**⚠️ CONTINUITY CAMERA TO AN iPAD IS UNVERIFIED AND MAY NOT EXIST.** Apple documents Continuity Camera with Mac and Apple TV as the receivers; an iPhone acting as a camera *for an iPad* is not something to promise. **The enumeration answers it for free** — once `listCameras` exists, the DiscoverySession either returns a continuity device or it does not, which is a runtime probe rather than a guess. Ship the enumeration, then report what the device actually says.

### 🔴 4K CLIP WILL NOT PLAY OR SCRUB ON iPAD — recurrence, not a new regression (Daniel, B569)

4K source: play/pause reads "pause" while paused, toggling does nothing, the scrubber is dead in perform AND motion, and the still-mode mini-timeline will not scrub either. **A FHD clip is completely fine in the same build.** Blocked the whole B568 verification pass.

**Almost certainly the standing CRITICAL from B519** ("iPad: a 4K clip LOADS BUT WILL NOT PLAY AT ALL, in either motion or perform"), not something B563-B568 introduced: **nothing since B562 touched the video decode, transport or playback path** (`git diff 957e540..HEAD` — the only `source-host.js` change is camera facing + `liveCameraInfo.frameRate`, and `native-video.js`/`motion-runtime.js`/`perform-runtime.js` are untouched). Daniel also successfully scrubbed and played a 4K clip earlier in the same session, which matches the B515/B516 note that this state is **INTERMITTENT**.

- **▶ THE READING THAT SPLITS IT, and B520 built it for exactly this:** the `source` row's note carries a live wire rate. **`0 in/s` = the decode/socket stalled and nothing downstream is at fault; ~30 in/s = frames are arriving and the fault is after that point.** His FHD broadcast report shows the instrument working (`native decode · 60.1 in/s`), so one glance at that note during the 4K failure is decisive.
- **❌ THE COLD-START THEORY IS DEAD (Daniel, B574).** B573 filed "it is the first 4K source loaded per session" as a sharpened repro. **The very next session opened the same clip first and it played fine.** Recorded rather than deleted because a discarded hypothesis is worth as much as a live one here: **first-per-session is NOT the trigger**, so decoder warm-up, first `AVPlayerItemVideoOutput` bind and first `fold-ext://` request are all off the list. What remains is genuinely intermittent, and the mode-switch-during-attach theory above is the only surviving lead. **Do not sharpen this again from fewer than three consecutive observations** — this is the second theory the next session has invalidated.
- **The dead still-mode scrubber is a NEW detail** worth carrying: it means the failure is not confined to the motion/perform transports, which points further upstream (the decoder or the socket) rather than at transport state.

---

## 🔬 Instrumentation and diagnostics

**Anything Daniel reads must reach the exported report** (`DEVICE-TESTING.md`). Three instruments were found wrong during phase 2; one is still open below.

### ⚠️ [2026-08-22 — INSTRUMENT DEFECT IN MY OWN B705 WORK] TRAIL TIMESTAMPS AFTER A MODAL ARE DELIVERY TIME, NOT EVENT TIME

**`8-21-26-contextLoss-05.json` reads as though the preview took 86.8s and then 101.4s to get its GL context back**, against 982ms-2.3s in every other report. **It is `alert()`.** A modal pauses the event loop until dismissed, so the restore event and B705's own 3-second `gl-restore-timeout` were both queued behind Daniel reading a dialog — which is why no timeout appears in the trail either.

**Left alone, the next reader concludes the iPad takes ninety seconds to restore a context.** A wrong noun inside an instrument, one build after building it.

**✅ PARTIAL FIX B707:** `dialog-blocked { ms, where }` is marked whenever a modal holds the thread >250ms, so the gap is legible instead of invisible.

**🔴 STILL OPEN, and it is the real fix: stop blocking the thread.** A bake failure currently raises a native `alert()`, which on an iPad in a live context freezes rendering, the broadcast poster and every timer until someone taps it. **The Loop Builder already has an inline surface (`clipBaking` cover) that can carry an error**, so the pieces exist. **Audit every `alert()` / `confirm()` on a path that can run while something is live** — this one was found by accident, in a diagnostic, and there is no reason to think it is the only one.

### 🐞 [2026-08-21 — INSTRUMENT GAP, FOUND BY READING TWO REPORTS] A FAILED GL RESTORE PUBLISHES NOTHING THAT SURVIVES THE KILL

`gl-context-lost` and `gl-context-restored` are marked and therefore reach `priorTrail`. **The third outcome — restore attempted, `reinitGL()` threw — is not.** `main.js:362`'s catch writes `console.warn` and a `statusEl` string; neither survives a reload, and on a Capacitor device neither is readable at all.

**Consequence, concretely:** the two 2026-08-21 reports establish that preview never recovers and cannot establish why, because *"restore never fired"* and *"restore failed"* produce identical evidence. **That is one build's worth of instrumentation standing between us and a root cause.**

**✅ FIXED B705** — and it turned out to be worse than described: `preview` and `mobile-preview` were missing the `gl-context-restored` mark entirely, not merely the failure mark. `shell/gl-watch.js` now owns all four in-process surfaces and reports four outcomes including a 3s timeout, which is what separates *never fired* from *died first*.

### 🔧 [Daniel, 2026-08-21 — SMALL UI GAP, WORKAROUND EXISTS] THE FRAME-COST PANEL CANNOT BE OPENED FROM THE LOOP BUILDER

*"our affordance for opening the frame cost dialog is the gear in the top right which we don't show in the loop builder so i'm not actually able to open a report from there."*

Correct: the loop builder sets `body.loop-active`, which hides the app bar deliberately (no mode switching or uploads mid-edit, B-era design). **So the one surface that holds the most decoders is the one whose cost cannot be inspected while it is open.**

**✅ WORKAROUND, NO CODE NEEDED: `sessions.peak` is a HIGH-WATER MARK.** Open the loop builder, do the thing, close it, then open the report. `peak.decode` still holds the maximum reached while it was open, and `live[]` will have shrunk back. **That is enough for the measurement this blocks.**

**The real fix if it comes up again** is to let the frame-cost panel open over the interstitial, since it is a diagnostic rather than an editing surface. Small, but it touches the loop-active layering rules, so not worth doing speculatively.

### 🐞 [2026-08-21 — INSTRUMENTATION BUG, FOUND WHILE READING TWO REPORTS] THE EXTERNAL SURFACE NOTE CONTRADICTS `extGuard`

In `8-21-26-4klooptest-noGov.json` the external surface reports *"this view decodes its own copy, so nothing here measures what the audience sees"* while `extGuard` in the SAME report says `singleDecode: true, why: "moot: the single native decode means the external view runs no decoder of its own"`. **Two fields in one report disagree about the same fact.**

**The cost is not cosmetic: the NEW-PICTURES/s figure silently became unavailable in the run that was specifically designed to measure it** (the governor A/B). The comparison run had it, this one did not, so the prediction under test could be neither confirmed nor refuted.

**Same class as the scenario-tag mismatch that invalidated two earlier measurements** — an instrument that can quietly stop reporting the number a decision depends on. Whichever of the two derivations is wrong, they should read from one source.

### ✅ [SHIPPED B663 — the plugin half. The three batched items below are still OPEN] THE iOS DEVICE-VITALS PLUGIN

**The JS half shipped at B660** (`conduit/vitals.js`, the panel's session recorder, both chromes). The `native` seam is wired and returns null everywhere, which is recorded as `nativeReadings: false` rather than looking healthy. **What is missing is the reading itself, and it is the arc's largest instrumentation hole:** confirmed by grep, there is NO thermal and NO memory reporting anywhere in the three native plugins, while `BROADCAST-DELIVERY.md` names memory at 4K as the one open risk.

**What to add, behind `env.host.vitals()`:**

- `ProcessInfo.processInfo.thermalState` + **`thermalStateDidChangeNotification`** — transitions with timestamps, not a level.
- **`os_proc_available_memory()`** — headroom before jetsam. **The conserved quantity**: a boundary we do not own, and the thing that actually ends a long run.
- `phys_footprint` via `task_info`/`TASK_VM_INFO` — what we cost. Recorded, never concluded from on its own.
- `didReceiveMemoryWarning` — an event that must publish itself, or a jetsam kill is indistinguishable from a random crash.

**A NEW small plugin (`fold-device-vitals`), not bolted onto `fold-native-video`.** Vitals have to work when no video is loaded — the exhibit case may be camera-driven — and coupling them to the video plugin means the instrument disappears in half the scenarios worth measuring. It is also a **conduit** concern by Daniel's own framing: every future consumer app wants device vitals, and `conduit/pressure.js` already has the `native:` hook waiting for exactly this shape.

**✅ SHIPPED B663:** the plugin, the `host.vitals` seam declared in `conduit/host.js`, the retirement of the duplicate `host.thermalState()` call, thermal/memory-warning pushes wired to breadcrumbs on both chromes, and `take:arm` carrying the wall + source resolutions and clip length. **Awaiting an Xcode build to read anything.**

### 🔔 STATUS SURFACE — a DEDICATED READOUT BAR, and a real audit (Daniel, B561 → B569)

**⚠️ SCOPE CORRECTION (B569).** B567 removed ONE redundant inline message (the take status in the output panel, which was duplicating the toast) and I described it as "the first step of the audit". **That was an overstep** — Daniel: *"I actually was surprised to see you squeeze this in in the first place... this is UI work that needs consistent application."* He is right: the app has on the order of a hundred inline messages and changing one in isolation makes the inconsistency worse, not better. **Nothing else was touched.** Still inline and unaudited: `starting camera…`, `preparing clip for native playback`, the whole source-panel status line, the loop-builder notices, the external-view text cards, locked-control toasts, upload errors. **Do not fix these one at a time.**

**▶ DANIEL'S DIRECTION (B569), and he leans strongly toward it: a dedicated STATUS READOUT BAR** — a strip immediately below the app bar, ~24-32px tall, small text at the toast's type scale and colours, shown only when it has something to say. It stays out of the way of other UI, unlike a toast that floats over the work.

**Its second job is what makes it clearly right:** it can carry *dynamic* readouts, not just events — **current broadcast fps, elapsed recording duration** — which a toast fundamentally cannot, because a toast is transient by nature. That is the thing the app has no home for today, and it is why this beats "move everything to toasts".

**The audit this needs, before any of it is built:**
1. **Inventory every message-emitting site in the app.** Not a sample — the whole set, with where it renders today.
2. **Classify each one** against a written rule: *persistent state* (belongs inline, next to the control it describes: "ladder locked", validation, a disabled reason) vs *transient event* (belongs in the status bar: saving, saved, camera starting, clip preparing) vs *continuous readout* (the new capability: fps, duration, take progress).
3. **Decide the timing rules deliberately** — how long a transient stays, whether a new message replaces or queues, what wins when a readout and an event compete for the strip.
4. **Then build**, once, and put the classification table in the UI Lab entry as the reference for every message added afterwards.
5. **Decide what happens to the toast.** It may survive for save confirmations on mobile (where the tab bar makes a top strip awkward) or be fully superseded. One decision, applied everywhere.

**Cross-refs:** the save toast (`shell/save-flow.js`) already exposes `status`/`dismiss` and is host-agnostic, so it is the closest thing to a precedent; the governor's degrade notice (B568) currently borrows it and should move to the strip; the take-progress ring is a third status surface still unbuilt and should be designed WITH this rather than after it.



**Daniel:** *"we throw messages all over the place, sometimes in the top left of the source panel, sometimes in their respective dialogs and sometimes in toasts... showing saving / take saved inline in the output dialog doesn't feel right. status and controls should be separate."*

**His proposal, and it is the right default: toasts everywhere, including desktop and iPad**, unless a message has a specific reason to be inline. The principle underneath is the useful part — **a panel is for controls, a toast is for status** — and it explains why an inline "saving…" reads wrong even though it is technically in the right context.

- **[MED] Audit every system notification in the app** and classify: genuinely inline (validation on the control it belongs to; a persistent state label like "ladder locked — this canvas IS the take") vs status (anything transient about something that is happening). Known emitters: `#outputStatus` in the output popover, the source panel's top-left messages, the save toast, the locked-control toast, the loop-builder notices, the external-view text cards.
- **The toast already exists and is host-agnostic** (`shell/save-flow.js`, `status`/`dismiss` on the same surface as `save`), so this is mostly re-routing rather than new components. **Its landscape bug is already fixed (B552)**, which was the thing that would have made this consolidation backfire.
- **Decide the desktop placement deliberately.** The toast pins bottom-centre above the mobile tab bar; on a wide desktop window that may want a different anchor. One decision, then apply everywhere.
- **Lands in the UI Lab with its state matrix** per the standing rule, and the audit's classification table is worth keeping in the Lab entry as the reference for the next message anyone adds.

### 🎚️ THE GAIN STAGE — MANUAL as of B562, needs device verification

**Automatic calibration is removed after two failures in opposite directions.** B560 measured at record start and always caught silence. B561 fired on room tone (`micRawPeak 0.00552`, about -45dBFS) and jumped 32x, 2.4s into a take. **The unsolvable part was "is this speech", not the gain math** — both failure modes are bad and a short listen cannot reliably tell a voice from an air conditioner.

**Shipped:** an input-gain slider (1x-32x) plus an `auto` button that calibrates against what the mic hears *at the moment it is pressed*, so the user's press is the measurement. Trim frozen for the take, limiter retained, default 1x (restoring B559's good iPhone behaviour plus clip protection). A live `N× · raw M` readout.

- **Verify (iPad):** the raw readout should move when you speak — **that number is the whole diagnosis.** If raw stays near 0.005 while talking, the mic is genuinely near-dead and no gain will fix it honestly; that would point at mic SELECTION or the iOS audio session, not level.
- **Verify (iPhone):** unchanged from B559 at 1x, with `peak` now at or under 1.0.
- **[MED] The phone chrome has no gain control.** It defaults to 1x, which its measurements say is right, but there is no way to change it if a phone ever needs one. Add when the mobile audio UI is next touched.
- **[LOW] Two mic paths still acquire separately** — the meter opens its own `getUserMedia` alongside the take's, which is why the trim is a handoff rather than one value. Unify when the audio path is next opened.

**✅ FIXED B562 — the iPad and desktop take never published `env.lastAudioReport`.** It was wired only in the phone chrome, so every iPad report came back `audio: null` **including the ones sent to diagnose an iPad audio problem.** Three builds were spent guessing at something the instrument could have shown. **Standing lesson: the exported report is the only diagnostic channel that works on these devices, so a path that does not publish into it is a path we are debugging blind.**

---

## 🧹 Cleanup and consolidation

**`PLAN-LIVE-READINESS.md` item 3. Its documentation half ran at B658 and again at B704; the CODE half is still gated behind item 2** — the flags being deleted are the instruments the pressure testing needs.

### 🧹 POST-ARC CLEANUP — audited B545, three increments proposed

The thermal + audio arc ran 30 builds, six of them pure instrumentation for a bug that turned out to be four bytes of container framing. It left less mess than that history suggests: **no dead code, no abandoned modules, no orphaned CSS.** The instrumentation was not scaffolding — it is the diagnostic channel, and it stays. What it did leave is *narration debt* and *duplication that has already bitten once*. B545 took the obvious half; these are the rest, each independently shippable.

- **✅ C1 — Unify the native frame-header parser. SHIPPED B546.** `shell/frame-header.js`; both consumers on it. Device pass is VERIFY-QUEUE "C1", and it needs a fresh `cap:sync`.

- **[MED] C2 — Retire the settled perf flags.** `perf-flags.js` says it plainly: *"this file is a measuring stage, not a permanent configuration surface."* Ten flags is past the point where the panel is scannable, and several have finished their job — `asyncReadback`, `recordDirect` and `busElide` are each measured, decisive and permanent, and their OFF state exists only to prove a win nobody disputes any more. **Do this AFTER the verification matrix**, not before: groups A, B and E toggle these, and C2 is only safe once the matrix has stopped needing them. `recordMediaRecorder` and `recordForceFlush` should stay regardless — those are escape hatches, not measurements. The comment prose is dense but earns it (it is the record of *why* each optimization is safe) and should move with the code rather than be deleted.

- **[MED] C3 — Prune VERIFY-QUEUE.md.** 165 lines, of which the thermal matrix is the top 55 and the remaining 110 are Loop Builder / NDI / lock-pass items from B385–B476, many long since confirmed or superseded. The file Daniel works through should not bury the live section under a year of history. Rule: confirmed → a line in CHANGELOG and delete; still-open but off-arc → move to BACKLOG under its own area; genuinely awaiting hardware → keep. **Daniel's call per item — this is his test queue, not one to prune unilaterally.**

- **[HIGH] C4 — Archive the bottom half of HANDOFF.md.** The file is 805 lines. The top ~460 is live. Below that, **`## what's working` describes Build 24 and `## what we're doing right now` describes Build 57** — the two sections CLAUDE.md explicitly names as going stale fastest, wrong by ~490 builds, in the document every session is told to read first. B545 marked the boundary with a HISTORICAL banner so it cannot mislead, but the real fix is to move it to `docs/archive/HANDOFF-builds-19-187.md` and leave HANDOFF as current state only. Cheapest large win available: it is pure context cost with negative informational value. **Docs-only, zero risk.**

- **✅ RESOLVED B563 — five exported symbols imported nowhere.** Four (`parseUsage`, `armsSnapStep`, `resolveEdition`, `COMMON_UNIFORMS`) were used only inside their own module: accidental exports, now module-local. **The fifth was the interesting one.** `Z_SLICE_IN_FLOOR`/`Z_SLICE_COVER` in `kit/zoom.js` carried a comment saying `formZoomBounds` used them as the per-form defaults — **it never did**, it had its own literals. Changing them changed nothing, and they would have quietly misled the next person tuning zoom extents. Moved beside the function that reads them as `ZOOM_COVER_DEFAULT`/`ZOOM_IN_FLOOR_DEFAULT` (`engine/forms/index.js`). **Cross-ref the per-form zoom-extent tuning item — that work would have hit this trap.**

### 🟠 THE SOURCE SURFACE'S OFF SWITCH DOES NOTHING (Daniel's B576 report)

That report reads `source: enabled: false` alongside `refresh 30 calls / upload 30 calls`. The switch is decorative: `sourceSurface` declares no `onEnabled`, and `updateSourceFrame()` never consults `perf.skip` (only `render()` does).

Small, but it is exactly the class of defect that corrupts an A/B, inside our own instrument, and it violates exit criterion 1 (every offered option functional in its context) in the tool we use to check exit criterion 1. Either wire it or stop offering it.

### 🔤 SURFACE TERMINOLOGY — the naming was settled at B583, two consumers still need it

The vocabulary Daniel decided on: **keep the UI names** (`source` / `staged` / `live`, with the middle slot honestly `output` in still and motion), and let diagnostics carry a concise hybrid that references them (`main · staged`, `second · live`). The middle slot is genuinely two different things in two modes, not two names for one, which is why picking a single word was the wrong fix.

**Open:** the status-readout-bar audit needs these same nouns, and **the UI Lab has no terminology section to record them in** — so today the only place the vocabulary exists is a shipped code comment and this entry.

### 🧹 [HIGH — Daniel, B591] CONSOLIDATION: THE FPS ARC LEFT LEVERS IN THE CODE THAT WE HAVE SINCE DISPROVED

Daniel: *"our frame loss diagnostic is littered with the residue... lots of experiments we've determined aren't helpful so the controls and code to wire these up is probably cruft."* He is right. Each item below is a measured negative still carrying live code:

1. **🚨 B590 INVERTS THE GOVERNOR'S PREMISE.** It sheds editor surfaces to protect the broadcast; **the broadcast no longer depends on them.** Worse, Daniel's B590 panels-off run shows shedding now *hurts* delivery (24-26/s → 18/s). **Left armed it will degrade a live show before the futility release pulls it back.** Decide: retire it, or repurpose it to protect the APP's responsiveness — a different goal needing a different signal. **Daniel's call, not ours.**
2. **The resolution/scale ladder is dead** (B574: 17x fewer pixels, 55% of the cost) and still fully wired — `scaleLadder`, `onScale`, `setSurfaceScale`, plus the panel's scale controls on every surface.
3. **Slice-overlay governing is vestigial.** B576 excluded it permanently as DECOR; it still declares a ladder and reports zeros forever.
4. **`foldHdmiVideoUncap` is a confirmed no-op** on the single-decode path (B586) and still renders a warning about a mechanism that no longer exists.
5. **The frame-cost panel carries settled conclusions as open questions** — several readouts exist to answer things now answered.

**Sequenced AFTER the loop-restart stall** (Daniel is hitting that in normal use and calls it visually disruptive), because this is hygiene and that is a defect.

---

## 🧭 Product gaps, watch items and standing context

Not bugs. Product decisions, deliberate watch items, and the context that keeps the rest readable.

### 👁 WATCHED ITEMS — defaults we changed on limited evidence, and what to do if they bite

Each entry names a SYMPTOM to watch for, what it would mean, and the mitigation already designed. The point is to close the investigation now rather than carry it open, without losing the reasoning if the symptom ever shows up.

- **SYMPTOM: a recorded take on a Capacitor/WebKit build plays back with frames out of place, stale, or showing the preview instead of the followed output.**
  - **What it would mean:** WebKit does defer 2D-canvas rasterization after all, at least under some load, and the `getImageData(0,0,1,1)` guard removed in B524 was load-bearing there. Evidence for removing it was ONE clean take (Daniel, B524); canvas deferral is timing-dependent, so one take is evidence and not proof.
  - **Immediate mitigation:** turn `record: force sync rasterize` ON in the frame-cost panel. That restores the old behavior instantly, at a measured cost of ~40ms/frame on iPhone.
  - **Proper fix if it recurs:** stop blitting to an intermediate 2D canvas entirely and hand WebCodecs a `VideoFrame` built straight off the GL canvas. `VideoFrame` snapshots at construction, so it solves the ORDERING problem the guard existed for without any GPU→CPU synchronization.
  - **STATUS: shipped B525 for performance reasons, so the recording half of this item stands down.** The take is now `new VideoFrame(outputCanvas)` with no 2D canvas in between, and construction-time copy is exactly the ordering guarantee the guard was buying. Two residual paths still rely on the removal: the **MediaRecorder fallback** (which must blit, and where `recordForceFlush` still applies) and a **mid-take size change** (which rebuilds the scratch canvas to scale into the locked take size).
  - Same guard was removed from `paintPip` in the same build; a stale PiP is cosmetic, so it is the lower-stakes canary for the same behavior — **and it is now the only routine path still exposed**, since the PiP still blits.

### 🧱 iOS CEILINGS AND COST MODEL → see `docs/CAPABILITIES.md`

The measured per-device tables, the constraint list (C1-C6), the ranked levers, and the untested hypotheses (H1-H5) live in `CAPABILITIES.md` so there is one place to maintain them. Open work that came out of those measurements:

- **[HIGH] The output resolution ladder is unsafe during a take.** Since B525 the record path encodes the output canvas directly, so scaling it down scales the deliverable down — and `recSize` is locked at record start, so a mid-take change makes `paintRecord` fall back to the scaling blit B525 deleted. The switchboard currently permits it. Lock the ladder while `recState === 'recording'`, or give the preview its own render target.
- **[HIGH] 4K takes fail after a few minutes** with "recording failed" and a finish that outlasts the take (17 Pro). Expected at 6-11fps with encoder backpressure plus thermal, but it is data loss and needs its own fix.
- **[MED] 14 Pro at 4K: colour shifts and a frozen source/output** until toggling to still and back.
- **[MED] The PiP rate must become adaptive.** 10Hz is right at FHD and useless at 4K (11.0 vs 11.4fps with it off) — its cost scales with the whole pipeline, not with the thumbnail.

### 🎬 A/V SYNC — FIXED B540, ⚠️ STILL AWAITING DEVICE VERIFICATION (~165 builds)

The "motion modes" are AVFoundation video stabilization modes (`standard` / `cinematic` / `cinematicExtended`), not our follower. Cinematic stabilization buffers frames for lookahead, so delivery lags capture by up to ~a second at smooth+; stamping frames on ARRIVAL turned that into a timeline offset and pushed recorded video behind recorded audio.

Fixed by carrying the capture-to-delivery latency across the frame socket (`"FYUX"`, 40-byte header) and stamping recorded frames at capture time. Measured natively where the capture PTS and "now" share a clock — a raw PTS alone is unusable in JS, since the capture-clock-to-`performance.now()` offset is the very unknown being solved.

- **Needs `npx cap sync ios` + a native rebuild.** Web-only reload leaves the old plugin sending `"FYUV"`.
- **Verify:** front camera, smooth+, talking — the harshest case. Then `standard` as a no-regression check.
- **Not a factor, and an earlier entry here wrongly said it was:** the follower delays the kaleidoscope TRANSFORM, not the image. The camera texture is uploaded fresh every frame, so lip motion was never eased. Follower lag is exactly tau = `performResponse` for constant-velocity input (critically damped, omega = 2/tau) and is a deliberate look, not a sync fault.
- **Kept in reserve, not built:** Daniel's mitigation strategies (a warning on smooth/smooth+, lighter default smoothing, front-camera prioritisation) if verification shows residual drift.
- **Untouched:** the external-display consumer reads the same socket and now gets the field for free; the video plugin already carried a pts.

### 🎨 COLOR MANAGEMENT — a product gap, not a perf detail (Daniel, B531)

Surfaced while investigating why the 17 Pro is slower than the 14 Pro at consuming the WebGL canvas (a possible Display P3 conversion). **Daniel's read is that the perf angle is the smaller half.** The real gap is that Fold has no color management story, and two audiences need one:

- **Prosumer/pro photographers** doing `open in → Fold` round trips from Lightroom or DxO PhotoLab: edit, save, return. A round trip that shifts color is a broken round trip, and the app is not viable for that workflow without it.
- **iPhone 48MP stills**, which are large enough for moderately sized prints, where color accuracy matters directly.

**Scope to work out:** what color space the engine composites in, whether we honor embedded ICC/EXIF profiles on import, what we tag on export, whether Display P3 is preserved end to end or flattened to sRGB, and how the canvas's `colorSpace` / `drawingBufferColorSpace` should be set per build. **Cross-cutting: this belongs in conduit**, since every consumer app inherits the same import/render/export path.

Pairs with, but is not blocked by, the H1 perf experiment in `CAPABILITIES.md`.

### 📱 MOBILE WEB / PWA EXPOSURE FROM THE THERMAL ARC (audited B528, Daniel's question)

**Every measurement in this arc is iOS Capacitor. No Android or mobile-web device has been in the loop at any point.** The audit below is a code-path reading, not a measurement, and it is the honest state of that surface.

- **✅ Platform-gated, cannot affect mobile web:** the planar camera upload (B518, gated on `host.nativeCamera?.available`, Capacitor-only — mobile web keeps the `<video>` + `getUserMedia` path untouched) and the pipelined broadcast readback (B519/B521, desktop bus and `host.ndi?.available`).
- **⚠️ Universal, WebKit-motivated — the one to watch: the PiP (B527/B528).** `bitmaprenderer` is supported on Chrome/Android and Firefox so it will not break, but **`drawImage(webglCanvas)` was never the bottleneck on Blink**, so Android pays a frame of latency and a 10Hz monitor for a problem it may not have. Defensible on energy grounds (arc goal #3) and the flag makes it reversible, but it wants an Android reading before it is treated as settled. **The B527 aspect regression was universal**, which is a reminder of how this category bites.
- **⚠️ Universal but low risk: the direct record path (B525).** Mobile web on both Android Chrome and iOS Safari uses it. `VideoFrame(canvas)` from a WebGL canvas is well-supported and cheap on Blink, and the MediaRecorder fallback is structurally intact — `recordCanvas` + its `captureStream` are still built eagerly and only released once the WebCodecs sink has actually started. Ordering is safe on Blink because `VideoFrame` copies at construction, which is a stronger guarantee than the `getImageData` flush it replaced.
- **📊 Genuinely unknown, and the most likely mobile-web weak point: the iOS Safari camera upload.** B518's planar fix was native-only, so mobile web on iPhone still uploads through a `<video>` element. It was never measured before or after. Given the arc found four separate GPU→CPU round trips, this path deserves one reading before anyone claims mobile web is healthy.
- **▶ THE TEST, when a device is available:** Android Chrome, phone chrome, record FHD with the PiP visible; read `unmeasured`, the `pip` row, and `record encode`. Then the same on iOS Safari (not the Capacitor app) to isolate what the native camera was hiding.

**HOW MUCH OF THE ARC ALREADY REACHES MOBILE WEB: most of it, on iOS.** The two biggest wins (B525 direct record, B527/528 PiP) are fixes to WebKit image-source paths, and **iOS Safari is WebKit** — so mobile web on iPhone inherits them unchanged, without a line of extra work. Same for the B513 overlay cuts and the whole instrument. Only two are gated away: the planar camera (native plugin) and the pipelined broadcast readback (desktop bus / NDI, neither of which mobile web has).

**A DEDICATED MOBILE-WEB ROUND — one real item, then measure.**
- **🟡 [WAS HIGH, DOWNGRADED B559 — MEASURED, and the desktop claim was wrong] `updateSourceFrame()` re-uploads the same video frame every tick.** Shipped B559 behind `elideElementUploads` (default OFF). **Daniel A/B'd it on Electron and saw no difference: the element upload already costs 0.09-0.12ms there**, because Blink takes a hardware path for `texImage2D` from a `<video>`. Halving 0.1ms of a 16ms frame is noise, so **"a major perf win for desktop" is withdrawn — I agreed with that framing and the measurement says otherwise.** It never engages on iPad at all, where the camera is on the planar path. **Where it is still plausibly worth real time: WebKit** (iOS Safari mobile web, desktop Safari), which is exactly the family of operations this arc found expensive four times and the one platform none of this has been measured on. Keep the flag, retarget the test. Original reasoning below.
- **[ORIGINAL ENTRY, kept for the reasoning]** `src/engine/index.js:172` gates only on `readyState >= 2`, so a 30fps camera or clip against a 60fps render loop uploads **every frame twice**. The planar path (native) already has the right shape — it returns early when nothing new arrived off the wire — and the `<video>` path has no equivalent. Fix: gate on presented-frame identity via `requestVideoFrameCallback` (Safari 15.4+, Chrome; fall back to a `currentTime` comparison for Firefox). **This is not mobile-web-only** — desktop web and Electron video playback waste the same uploads. Unmeasured, but halving the call count is free regardless of what each call costs, and on WebKit "consume a video element as an image source" is exactly the family of operations this arc found to be expensive four times.
- **Everything else waits for a reading.** The arc's method was measure-then-fix, and it corrected three of my own confident hypotheses. Guessing at Android before the panel has ever run there would abandon the only thing that worked. Given mobile web's long-term status is uncertain, the cheap and correct move is one measurement session, then decide whether it is a small fix or a real project — not speculative investment in a platform that may be cut.

### 🎨 DESIGN-SYSTEM ITEMS SURFACED BY THE PiP LAB ENTRY (B544)

- **[MED] The PiP status dot is one flat `--danger` for BOTH recording and broadcasting.** The two live states are indistinguishable at a glance, on the one surface whose whole job is telling you what the output is doing. Disambiguation target; the same dot is mirrored in `#m-stage-dot` when the PiP is swapped.
- **[MED] Audit for other ID-styled components.** The PiP could not be put in the Lab without first making its selectors accept a class, because id-scoped styling cannot be specimened without copying the CSS. **An id-styled component is one the design system cannot see.** Same treatment where it applies: keep layout id-scoped, share the visual rules.

### 📼 RESCUED FROM THE HANDOFF ARCHIVE (B547) — filed 2026-06-10, never in BACKLOG

Three items that were sitting in HANDOFF's stale half. Each was described there as live work and had zero presence here, so archiving without filing them would have been the only genuinely lossy part of the cleanup.

- **[HIGH] Firefox + Safari video colour and orientation — a real correctness bug, and it feeds COLOR MANAGEMENT above.** iPhone `.mov` sources render **washed-out OUTPUT colour on Safari AND Firefox** while the 2D source preview shows natural colour — so it is the WebGL texture path, not the decode. Suspects: `UNPACK_COLORSPACE_CONVERSION_WEBGL`, limited-vs-full-range YUV→RGB, HDR transfer. Firefox additionally rotates **all** video 90° CCW and squishes iPhone aspect (Gecko rotation / pixel-aspect metadata not being read). Brave/Safari are reference-correct on orientation. **Daniel's B547 note: he had believed this fixed, but has been testing almost exclusively with `.m4v` exports from FCP rather than straight-from-iPhone `.mov`, so it is very likely still real and simply not being hit.** Reproduce with an unprocessed iPhone `.mov`. **The washed-out half is plausibly the same texture-path problem as the colour-management gap — do not fix them independently before checking.**

- **[MED] CONTROLS.md as a system-wide reference.** Daniel's stated longer-term intent: grow the controls/IO inventory into a SYSTEM-WIDE reference that becomes the basis for a **user manual** and a **systematically-built icon library**. Explicitly deferred as a rabbit trail, never abandoned. Revisit when there is appetite; it pairs naturally with a design-system pass.

- **[MED] Settings that persist across sessions — fold into "Clip queue → workspace sessions → persistence" below.** Daniel (B547): this becomes particularly valuable once a **stage manager** handles multiple clips and animation sequences in one session and that data must survive a restart. The existing persistence item covers *clips and workspaces*; the gap it does not cover is **app/user settings** (motion mode, camera preferences, output destination, aspect, quality choices). That is the "Generalized user-config JSON" already named under Control bus — these two should be designed as one store, not two. **Explicitly NOT perf flags**, which are a measuring stage and must keep resetting on reload.

**Two items were examined and deliberately NOT filed:**
- *Gesture recording + live-tween* — **shipped at Build 269** (v0.12.11: a gesture lands as one keyframe carrying its winding), with the directional-vs-shortest-path distinction settled later on the Droste zoom follower. The residuals — per-segment rotation winding (+N turns) and smoothed translation-path capture — were already in BACKLOG. The 2026-06-10 note was simply never retired.
- *Cross-format / frame-rate robustness + test story* — **premise was wrong when written.** It claimed "Blink largely untested for the video path"; Brave and the Electron build have been in rotation at least as much as WebKit and Gecko (Daniel, B547). The genuinely open piece of it is test infrastructure, which is a deliberate standalone decision, not a feature-commit rider.

### 🎛 [Daniel, B642] STAGE MANAGER QUEUE — per-mode state, scenes, and source as a stage object

**▶ QUEUED DELIBERATELY. Daniel: *"we don't touch anything now but we add this to our stage manager queue as something to handle thoughtfully."* Nothing here is committed; this records the framing while it is fresh.**

**His straw man is MORE decoupled than mine was.** I proposed a snapshot ledger over one shared `state`. He wants: **each mode instantiates a NEW state derived from wherever you came from, and gets its own undo, canvas, and so on.** Entering a mode inherits; leaving it does not write back. Worth stating plainly because it is the more expensive answer and he chose it with the tradeoff in view — a ledger preserves "one state object" and its consequences (undo as a snapshot swap, a stateless engine, one currency for record/broadcast/export); genuinely separate state per mode means each of those has to name which state it means.

**What is shared, per Daniel:** broadcast destination, MIDI input, and source. **Source is negotiable** and probably becomes a stage object rather than a global — see below.

**Q2 (what motion derives from), answered:** we do not support transitioning form / segment count mid-animation, but might later, so a new mode's state should derive from **the first or nearest keyframe** — canvas aspect, form type, form properties, canvas settings. (This is also exactly what B641 fixed the narrow version of: motion re-entry now re-adopts the sampled frame instead of the previous mode's edits.)

**Q4 (source swap), reframed rather than answered:** it only makes sense alongside the scene manager, where a keyframed loop, a newly added source and a live camera are all things you can cut between side by side. In that world, changing source in motion is a choice between **sending the current keyframed motion to the queue/stage**, **discarding it and starting fresh**, or (least likely viable) **keeping the keyframe parameters and swapping the source under them**. Decisions to make then, not now.

**The one thing worth carrying forward:** B642's OOB guard is the same shape of problem in miniature — a global setting changed in one place invalidating snapshots held somewhere else. Per-mode state does not remove that class, it multiplies it. Whatever the design, it needs an answer for "this change makes some stored look unrepresentable" that is not written once per setting.

---

## 🗂 Older device passes and running lists (B547-B594)

**⚠️ CURRENCY WARNING: these predate the phase 2 arc (B683-B704) and several are probably closed.** They have not been individually re-checked against the current build. **Treat any item here as a candidate for verification-then-closure, not as a confirmed open bug.** Where one is genuinely still open it will also appear, restated, in a group above.

### 📦 RECENTLY CLOSED → `archive/BACKLOG-resolved-b599-b704.md`

**Twenty items closed between B599 and B704 were moved out at B704** — shipped, fixed, answered,
withdrawn, or superseded. Among them: the loop hold (closed B608), the droste infinite-zoom loop
(B623), the two-chrome divergence audit (B627), the semantic flip (B635), the scenario runner (B665),
**radial pan** (B694, four builds of reasoning), the dupe-key linter decision (B696), the withdrawn
post-bake source stall (B702), and recentre-does-not-ease (fixed B704).

**Where a closed item still constrains future work, that constraint was moved into the code or into
a live doc rather than left here** — the archive header lists each one and where it went.

### ✅ CLOSED B608 — THE LOOP HOLD → `BROADCAST-DELIVERY.md` §6a

Collapsed to a pointer at B658. That section is a strictly better record than the 36 lines that were here: what the hold was (AVFoundation, ~150ms, fixed cost, iPad-only), **eight hypotheses each closed by its own instrument**, the head-frame-cache fix, the one field that says whether it works (`loopCache.firstPts` must be ~0), and two traps for whoever reads a budget comparison next. First reported B487, closed 121 builds later.

### 🚫 PRODUCT CONSTRAINTS ON ANY FIX (Daniel, B602) — these rule out most of the obvious options

- **A deliberate hold is a non-starter.** Seamless looping is non-negotiable for perform mode.
- **The fix cannot live in the Loop Builder.** **The majority of loops are built elsewhere and imported**, so anything that depends on our bake choosing a friendly loop point only helps the minority case.

**What survives those constraints: fill the gap with frames we already have.** Cache the first N encoded frames of the clip on the opening pass, and at the lap feed them from the cache while AVFoundation restarts — the wire and both clients see continuous frames with correct pts, and nothing about the clip's origin matters. Trigger the rewind ~150ms early and the content is continuous rather than merely unfrozen.

**Cost to weigh before building:** ~6 frames of cache is **~74MB at 4K** (12.4MB per frame) and ~19MB at FHD. This project has a jetsam history at 4K, so the memory has to be measured, not assumed — and if the gap turns out to scale with resolution, N can be much smaller at 4K than the worst case suggests.

**STOPPING RULE (agreed shape, B602):** if the pull model does not move the number and the gap does not scale with resolution, **stop investigating** and build the frame cache.

**Dead, each by its own instrument** (3 and 4 added at B598/B599, 5 at B599):

5. **Our backpressure.** `skipped: 0` on both clients across the lap. The fan-out declined nothing.

3. **The external view's render.** `wrapRenders` after a lap: `ren` 8-15ms, `up` 0-4ms, `sched` 0-12ms, `gap` 9-28ms. **All fast.** The view renders normally through the hold and has nothing new to draw — so it is not a shader rebuild, not a texture reallocation, and not a blocked thread.
4. **"The app does not hold, only the wall does."** That was my instrument, not the app: `paintLatest` counted re-blits of the same buffer as clock events, and only the app calls `refreshFrame()`. Fixed B599.

**The one fact nothing explains: 1.8 seconds of footage is absent at the lap** (`fromPts 19.4 → toPts 0.833` on a 20.4s clip) while the wire reports a 7ms gap. **Those cannot both describe the same event.**

**Open measurement (B599):** `srcFanOut.itemSwaps` / `swapGapMs` / `swapFromPts` / `swapToPts` / `ticksNoBuffer` — the decode's own account of the lap, from the only code that sees AVPlayerLooper swap items. It separates "AVFoundation lost the content" from "our backpressure declined to take it".

**⚠️ Instrument caveat:** `maxTakeGapMs` was contaminated by a post-bake re-join (2009ms, an attach cost not a lap), which is why `recentTakeGaps` exists and why the native counters reset on teardown.

**If take gaps come back small too**, the hold is not at the frame boundary at all and the next suspects are param-side: `p` snapping from 1 to 0 at the wrap, and whatever the timeline/playhead UI does when it scrolls back to the start.

### 🔎 LIKELY CLOSED [Daniel, B647→B648] FIREFOX: CURSORS OVER THE SOURCE ARE PLAIN ARROWS — intermittent, and not seen since

Firefox only; Brave is fine. **The symptom discriminates and it points AWAY from the cursor art:** if the SVG data-URI failed to load, Firefox would fall back to the keyword in each declaration (`move`, `ew-resize`, `ns-resize`) — visibly different cursors. A plain ARROW is `default`, which is what `cursorForMode` returns when `classifyPointer` yields `mode: null` — and that happens when `sourceOverlayCanvas._geom` is missing.

**▶ B648 FOUND A REAL MECHANISM AND FIXED IT — but it is unconfirmed as THE cause.** Daniel's follow-up that it stopped reproducing is what pointed the way: an encoding failure is deterministic, so intermittency argues for lifecycle. The overlay's change gate could skip a draw on a freshly re-mounted canvas (signature unchanged → no draw → `_geom` never written → every hit test null → `default` cursor), and it would stay that way until an unrelated value moved. The gate now refuses to skip when there is no cached geometry.

**▶ B649 — Daniel: *"hasn't repo'd and this seems to have been a one of state issue. i'll watch it."*** Left open at LOW rather than closed, because the fix is unconfirmed and a bug that stopped reproducing is not a bug that was proven fixed. **If it recurs on B648+**, the discriminator still stands: any resize-style cursor over the outline means the cursor ART is failing; a plain arrow everywhere means hit-testing, and the next place to look is why `_geom` is stale rather than absent.

### 🌡️ [MED — B588, scoped down B589] THE SAME WORK GETS MORE EXPENSIVE OVER A SESSION — LOAD-DEPENDENT, SO CONTROL FOR IT

**▶ B589 UPDATE: not the crisis it first looked like.** The 40% climb below came from a session with an **enlarged slice** running hot. B589's controlled pair (cold start, default slice) drifted only ~5% and produced a perfectly clean result. **Standing protocol for any A/B from here: cold start, fixed slice, and note the elapsed time in the report.** That is enough; a full warm-up-and-settle harness is not needed yet.

Found while running the 4K-vs-QHD test. At **identical surface geometry**, within one sitting:

| | `preview render` | `pip render` | accounted |
|---|---|---|---|
| baseline | 11.68ms | 12.68ms | 27.68ms |
| 4K arm (~164s in) | 13.08ms | 7.63ms | 25.29ms |
| QHD arm (~254s in) | **16.30ms** | 10.75ms | **32.85ms** |

`preview render` rose **40%** at constant size. **Every cross-time A/B in this arc has therefore had an uncontrolled variable**, and it is a plausible explanation for how many of them came back ambiguous or reversed.

**Leading hypothesis is thermal**, which we cannot confirm: `ProcessInfo.thermalState` reads null (see the thermal item), so the only signal is drift-based and drift is exactly what is in question. **Alternatives not ruled out:** accumulated GPU memory pressure, ledger overhead growth, a leak in one of the engines.

**▶ THE CHEAP DISCRIMINATING TEST, and it should precede any further A/B: run the same comparison in the OPPOSITE order.** If the second arm is worse regardless of which resolution it holds, the variable is time. That result would mandate a warm-up-and-settle protocol (fixed dwell before sampling, and A/B/A rather than A/B) for everything downstream — which is a methodology fix worth more than any single measurement.

### 🟡 THE 4K SCRUBBER JITTERS AT THE START OF PLAYBACK (Daniel, B575, long-standing)

Initially playing a 4K source makes the scrubber jump around slightly. Believed fixed for FHD and thought to be fixed for 4K. **Daniel flagged it as possibly related to the intermittent 4K playback failure**, which is worth taking seriously: both are 4K-only, both are at the *start* of playback, and both are consistent with the clock/first-frame handshake settling late. Filed together deliberately.

### 🔴 B551 TRIAGE — Daniel's H/FH/TF pass, grouped by SHARED CAUSE

Ten symptoms, four causes. Ranked by how much each unblocks.

**CAUSE 1 — "4K record" does not exist.** `sizeOutput()` lifts a take's short side *to* 1080 (a floor, never a target) and hard-caps the long side at 2048. The 4K setting selects the SOURCE only.
**▶ DANIEL'S DECISIONS (B561), and the one open question.** He has settled most of this:
- **4K SOURCE earns its place regardless** — he can perceptibly see the improvement and the file size is unchanged, since the take is FHD either way. **So relabel rather than remove:** make clear we sample more pixels and always record FHD. That is the honest fix for the liar, and it is cheap.
- **Test real 60fps output WITHOUT the PiP first.** If it comes back clean, keep it and apply the same starve-the-PiP pattern 4K recording already uses. If not, **cut it** — he judges a 60fps source feeding a 30fps take to be worth nothing, and I agree with one caveat worth stating: the only real benefit is a shorter exposure per frame (less motion blur), which is subtle and costs double the camera bandwidth and upload. Not worth keeping the liar for.
- **A 720p tier for older devices** as a fallback where 1080p cannot be held, plus a clear statement of which iPhones clear which gate.
- **🔴 THE OPEN QUESTION: can we actually record 4K/30 OUTPUT on the phone?** Never attempted. **The memory objection is gone** — B553-B555 proved a 254MB take streams to disk and never occupies the JS heap — so what remains is pure throughput, and that is measurable rather than arguable. **Test:** lift `sizeOutput()`'s 2048 cap behind a perf flag, record at 4K with the PiP starved, and read `record encode` + fps + `shortfall`. Note the prior 24-28fps reading was a 1080p take from a 4K source; a real 4K take is 4x the encoder pixels, so expect worse and measure rather than predict.

- **🔴 [HIGH — now unblocked by B553] Recording at 4K on the PHONE is unimplemented.** The memory objection is gone; what remains is a product call. **Daniel's framing (B553) is the standard: weigh the complexity of bringing it up to spec against honestly not pretending we can do it.** The dishonest middle — a 4K setting that silently saves 1080p — is the one option ruled out. Cheapest honest fix is to relabel the phone control as a SOURCE resolution (which is what it is) and state the take resolution separately. TF-1: 4K selected, 1080p file, both lenses. **Fixing this is a product decision, not a patch** — a true 4K take multiplies encoder load AND the in-memory muxer's peak footprint, which is already the prime suspect for finalize failures. Sequence: OPFS streaming first, then lift the cap. Lifting it alone would very likely make finalize worse.
- **Fallout: every "4K recording" number in this arc measured a 1080p take.** CAPABILITIES corrected at the top; the B547 "4K/30 is deliverable" line is withdrawn. Source-side findings stand.
- **Blocks TF-2/TF-3/TF-4** — there is no 4K finalize to measure yet.

**CAUSE 2 — the external view's first source payload is slow or stale.** Everything the view shows comes from a source payload posted on signature change; until it lands the view renders whatever it had.
- **🔴 [HIGH] Broadcast is stale/latent at session start** (H-5): output updated once per 5–10s while the app itself logged **p95 1262ms** — the main thread stalling over a second at a time, with only 2.5ms accounted. Self-corrected after minutes, and reproduced on a fresh session.
- **🔴 [HIGH] 25–45s for the display to pick up a SOURCE SWITCH** (H-1), then honest 60fps afterwards.
- **🟠 [MED] iPhone HDMI degrades badly in RECORD MODE even before recording starts** (H-9) — seconds between frames, blackouts.
- These are one shape: **the payload path, not the render path.** Once the view has its source it runs honestly (60fps video, 39–51fps camera, confirmed on both devices). Prime suspects: the native-camera/video socket handshake on the view's side, and the `hello`/repost sequence racing the first frames. **Next step is measurement, not a guess** — B551 makes the phone's row report dims+fps, which it never has.
- **Daniel's call worth taking seriously:** should HDMI broadcast and recording be *allowed* simultaneously on iPhone? Two expensive pipelines, and the record path already owns the output canvas. A declared "not both on phone" is a legitimate capability statement.

**CAUSE 3 — instrumentation gaps that make the above unmeasurable.**
- **✅ FIXED B551 — the phone never published `env.externalDisplay` at all.** The desktop sink got dims at B515; the mobile autoconnect was never wired, so the iPhone `external` row has read 0×0 on every build ever, and B549's fps note read "awaiting first fps report" permanently. **iPhone HDMI has never been measurable.**
- **✅ FIXED B559 — `pressure` assumed a 60fps target.** It now takes a declared target rate, floors the drift reference at it (no more `critical` on a correct 30fps take) and reports `shortfall` separately (no more `nominal` on a device that has been slow the whole window). Declared for takes and the phone's live camera; a still declares nothing and falls back to pure drift.

**CAUSE 4 — orientation is not handled in two independent places.**
- **🟠 [MED] iPhone HDMI output is vertically squished in portrait, correct in landscape** (FH-2). The external render dims come from the display's native size and the frame aspect, and the portrait sensor's aspect is not surviving that math.
- **🟠 [MED] Toasts are invisible in landscape** — Daniel waited ~20s after a take with no status, rotated to portrait, and found a success toast already showing. **This masks every status message we ship**, including B550's new finalize progress, and is why TF-1 saw no percentage. Cheap fix, disproportionate value: it restores the channel the take UX depends on.

**Unrelated singletons from the same pass:**
- **✅ FIXED B564 — resuming live camera from a still reverted to the REAR lens.** `startWithPreferredDevice()` had no saved deviceId to honour on the native path (the plugin drives lenses, not enumerated devices), so it fell through to `DEFAULT_FACING` every time. The lens is now persisted (`fold.cameraFacing`) and preferred on restart; the device default applies only to a genuine first run. **Needs device verify: front camera → pause → resume should stay on front.**
- **🟠 [MED] Intermittent audio static** on a take with aggressive zoom/droste manipulation (TF-1). New; not reproduced yet. Suspect main-thread starvation of the mic worklet during heavy interaction.

### 🔴 FROM THE D-GROUP DEVICE PASS (Daniel, B547 — iPad Capacitor + 4K HDMI)

The HDMI group had never been run on any device. It found more in one sitting than the rest of the matrix combined.

- **✅ FIXED B549 — D3 (record kills broadcast).** `failOutput` was tearing down a `needsBus:false` destination on a bus failure. Device re-verify in VERIFY-QUEUE.
- **✅ FIXED B549 — HDMI stuck at 10fps.** Poster elision starved the external view of its render clock once `getVideoSync` began returning null on the single-decode path. Device re-verify in VERIFY-QUEUE.
- **✅ FIXED B549 — no external-display throughput reading.** The view's own fps now reaches the report.
- **✅ FIXED B549 — iPad camera missing B518's planar path.**
- **🔴 [HIGH — STILL OPEN] iPad: broadcasting in MOTION mode plays the clip externally even when motion is PAUSED.** Narrowed at B549, not fixed: on the native-decode path `getVideoSync` returns null by design (both views sample the same frames), so the external view is never told the transport is paused. `native-video.js` `pause()` does pause the decoder, so the question is whether STARTING a broadcast re-arms playback — suspect the source re-post / go-live path resuming the decode rather than the external view running its own clock. **Repro: iPad, motion mode, pause, then start the broadcast.**
- **🟠 [PARTIALLY FIXED B550] 4K take finalize.** **The false failures are gone:** a flat 30s wall clock was DISCARDING takes that were still working, which is exactly what a fixed deadline on a variable-length flush produces. Now times out on *stall* (45s of no phase change and no queue movement), names the phase it died in, and reports determinate progress from `encodeQueueSize`. **✅ OPFS streaming SHIPPED B553, FIXED B554, PROVEN ON DEVICE B555.** The 30s fixed deadline was killing 4K takes ~3s short of completion (measured: 33.1s finalize on a 3:28 4K-source take). **✅ OPFS streaming** — the take now writes through to disk and never occupies the JS heap. Whether that was in fact the cause of the long-4K failures is the open question; it is the highest-value thing to find out. **`finalizeMs`/`finalizeMarks` now ride the report — get TF-3's numbers before building anything.**
- **[MED] The take-progress RING (Daniel's voice-memo reference).** B550 ships the data (`sink.progress` → `{phase, frac, queued}`) and the toast percentage. The paired UI increment is filling a circle around the stop button. Daniel wants both: the ring reads at a glance, the number is what you check when worried.
- **[was CRITICAL, superseded above] 4K take finalize is slow and fails more often than not.** Daniel's standing report, re-confirmed B549. Highest-stakes moment in the app. Two parts, and the reliability half outranks the status half: **(a)** find why finalize fails at 4K — suspect memory during in-memory muxing (`fastStart:'in-memory'` accumulates every chunk until `finalize()`, which is the OPFS-streaming item), and **(b)** the progress UX below.
- **🔴 [was CRITICAL, superseded] D3 — starting a RECORD while broadcasting kills the broadcast.** iPad, live camera, 4K external broadcast running: press record → **broadcast stops, source panel goes gray, a static still persists in the staged panel and the live PiP**. The panel still reports 60.4fps, which is what makes it nasty — the render loop is healthy, so nothing looks wrong from the inside. **The tell is in the report: the `bus` surface reads `capture: null` with `readback` and `render` both at 0 calls.** The bus is registered but not running, and `capture: null` means the readback-path probe never resolved to a mode (the note renders `cap.mode || 'probing'`, so a literal `null` is its own signal). Record and broadcast SHARE the bus — desktop measurement at B514 established that "recording adds essentially nothing on top of a broadcast" precisely because one readback feeds both — so this is arming the second consumer tearing down the first. **Suspect the bus start/stop lifecycle when a second sink arms mid-run.**
- **🟠 [HIGH — likely fixed by B549's failOutput change, re-verify] D4 — after the glass-break reset, broadcast reports LIVE but the display is blank.** Re-arming a 4K broadcast following the reset shows the broadcast as active in the app while the external panel stays black. Cleared only by quitting from Xcode and restarting. Almost certainly the same lifecycle defect as D3 — the bus's reported state and its actual state diverging.
- **🔴 [HIGH] iPad: broadcasting in MOTION mode plays the clip on the external display even when motion is PAUSED.** The external view is self-rendering from posted state, so it is running its own clock rather than following the editor's transport. Discovered incidentally during D1.
- **✅ FIXED B549 (was MED-significant). The iPad camera never got B518's planar path.** D2's report: `source` note reads **`from canvas · camera`**, not `planar · native cam` as the iPhone does, and its **`upload` costs 15.47ms/frame for a 1024×768 (0.79MP) texture** — against 1.91ms on the iPhone for an **8.29MP** 4K source. Ten times fewer pixels, eight times the cost. That is the exact GPU→CPU→GPU round-trip signature B518 diagnosed and fixed for the phone, still live on the iPad camera. **This is the single biggest measured inefficiency currently in the app** and it sits on the surface the exhibit/installation case runs on.
- **✅ FIXED B549 (was MED). We had zero instrumentation on the external display's actual frame rate.** The `external` surface reports dimensions and nothing else (`passes: []`) because it renders in another process. Daniel observed **~10fps on the monitor while the panel reported 46fps** (D2) and again **~11fps against 42.9fps** (D4). Those are the numbers that matter for HDMI and we cannot see them. Needs the poster/receiver to report its own paint rate back through the same channel `native-frame-receiver.js` already uses for `arrived`/`painted` counters. **Until this exists, every HDMI row is measuring the wrong process.**
- **🟡 [LOW but misleading] `pressure` reads `critical` during a correct 30fps take.** B3: a 4K take running at 31.7fps against a 30fps target is behaving exactly right, but pressure is inferred from fps against a 60 assumption and reports `1 / critical`. A governor built on this input would degrade a healthy take. **Pressure must know the target frame rate**, not assume 60.

### 🎛️ UX FINDINGS FROM THE SAME PASS (Daniel)

- **✅ SHIPPED B555. Warn BEFORE capture that the PiP will go dark at 4K.** Daniel: "it is unexpected and potentially concerning to a user to not have any warning *before* they start capturing." His proposal, which is the right one: as soon as 4K is selected, overlay the still-live PiP with text saying it *will* go dark during capture. Keeps the monitor usable while framing (the B543 rule is capture-only) while removing the surprise. This is the "explain, don't silently disable" half of the question B543 deliberately left open.
- **[MED — half shipped] "Finishing take" progress.** B550 built the phases + percentage; B555 fixed the bug that made them unreachable (the session was nulled before finalize ran). **Still open: the stop-button ring** (Daniel's voice-memo reference) and the yield-everything-else half. Now that the flush is measured at ~97% of finalize, yielding the preview during it is the concrete win.
- **[LOW] Take quality degrades under heavy manipulation** — grain/pixelation rather than dropped frames, at ~7Mbps for a 1080² take (`w*h*6`). Bitrate starvation under high motion; expected, but the constant may want revisiting.
- **[was HIGH] "Finishing take" needs determinate progress, and should starve everything else.** Daniel: 4K finalize is slow and **historically fails more often than not** — the highest-stakes moment in the app, currently a spinner-less toast with no completion signal. Two parts: **(1)** show real progress — his reference is Apple's voice-memo stop button filling a circle around itself; the muxer knows its chunk count so a percentage is derivable. **(2)** This is the clearest case in the app for the priority order to actually fire: during finalize the take is the only thing that matters, so preview, PiP and overlay should all yield. **This is a governor rule that does NOT need the sustained-load data** — unlike the thermal rules, it is triggered by a discrete known event. Buildable now.

### Open bugs (running list)

- **🔴🔴 [CRITICAL — Daniel, B519] iPad: a 4K clip LOADS BUT WILL NOT PLAY AT ALL**, in either motion or perform. Escalation of the B515/B516 stutter regression, which was already confirmed with the panel closed. Panel reads `fps 59.9`, `source: from canvas · planar · native decode`, `refresh 1.13ms / 60 calls`, **`upload 0ms / 60 calls`** and `preview render 7.45ms / 60 calls`. **Read that carefully: the render loop is healthy and the engine is rendering — the planar reader is returning null every frame, i.e. NO NEW FRAMES ARE ARRIVING.** `refresh` still costs 1.13ms because `paintLatest` repaints the last frame whether or not it is new, so it is not evidence of arrival. B520 adds a live `N in/s` wire rate to the source note to split this definitively: **0 in/s = the decode/socket stalled (nothing downstream is at fault); ~30 in/s = frames arrive and the fault is after that point.** Note B517-B519 touched only the phone chrome, native-camera, and the bus — none of which are on the iPad HDMI video path — so the cause most likely predates them and this is the same regression deepening. First bisect point is the last known-good conduit-hardening build.
- **🟠 [MED — Daniel, B519, REGRESSION] Pinch-zoom on the canvas judders in the Syphon output when transition speed is INSTANT.** It halts, jitters, and moves in and out slightly before following the gesture; with any transition set it is smooth. Believed fixed for FHD some time ago, so this is either a 4K-specific reappearance or a regression of that fix. With `instant` there is no follower smoothing, so every intermediate gesture value is published as its own committed frame — worth checking whether the bus is now publishing a mix of stale (pipelined, one frame old) and fresh values during a gesture, since B519 made pixel delivery one frame late while `frame.canvas` stayed current.

- **🔴 [HIGH — Daniel, B516] iPhone FHD record fails: `null is not an object (evaluating 't.info.decoderConfig.colorSpace')`.** Thrown as "take FAILED". Reads as a muxer/encoder handshake problem: the encoder's output config arrives without a `decoderConfig` (or without `colorSpace` on it) and the mp4 muxer dereferences it unconditionally. Distinct from the throughput story — this is a hard failure, not a slow path. Check where the recorder passes `metadata.decoderConfig` through to the muxer and guard the first-chunk path; iOS WebKit likely omits `colorSpace` where Chromium supplies it.
- **🔴 [HIGH — Daniel, B516] iPad crashed and LOST THE LOADED CLIP while using the frame-cost panel on a 4K source.** Required a re-upload to recover. May be the panel (extra rAF + DOM churn under memory pressure), may be the 4K path's existing fragility, may be the switchboard cutting a surface mid-frame. Data loss on crash is the real severity here regardless of cause — relates to the session-persistence work in the clip-queue entry.
- **🟠 [MED — Daniel, B516, REGRESSION] Desktop Electron: a 4K source loads DARK until the layout is nudged** (dragging the panel grippy fixes it). "A regression of a past bug we fixed ages ago, but presumably our fix isn't working for 4K source." Notably NOT reproducible on iPad Capacitor, which points at the `<video>`-element path (desktop) rather than the native decode path (iPad) — the old fix was for a video that had not yet PRESENTED a frame, and a 4K decode plausibly takes long enough to slip past whatever readiness check that fix installed.
- **🔴 [HIGH — Daniel, B515/B516, REGRESSION vs the conduit-hardening arc] iPad 4K→4K broadcast is WORSE than it was.** Confirmed with the frame-cost panel CLOSED, so it is not the instrument. A 20.4s 4K clip now alternates between a few seconds of smooth playback, pausing, and choppy playback — while the output panel reports a healthy 34-46fps. **That gap between reported fps and observed smoothness is itself the clue:** we are rendering frames the display never shows evenly, so the problem is pacing/delivery, not throughput. The earlier 6+min 4K success is the reference point to bisect against. Suspects, in order: the B513 poster idle-elision heartbeat (test first — it is one switch in the panel, `external: skip identical posts`); anything else that changed the external-view message cadence; the `fold-ext://` range-server hypothesis already filed below.

- **[HIGH — breakage] Safari: the output window's camera STARVES the main app.** With a live-camera source, the popup opens its OWN `getUserMedia` of the same device; Safari allows only ONE consumer → the main app goes black, no auto-recovery. Lean fix: **frame-push fallback for the camera source** — the main app (sole owner) sends camera frames to the popup over the channel (only the camera frame, downscalable; stills/video stay zero-copy). Also fixes no-auto-recovery. (Chromium/Firefox allow multiple handles — unaffected.) Pairs with the perform arc.
- **[HIGH] Firefox video export stutters — output unusable.** Editor PLAYBACK is smooth; the exported file stutters (frame pacing / dropped-or-duplicated frames). Correctness, not throughput. Belongs with the Firefox color/orientation hardening pass (Gecko seek/decode + VideoFrame-timestamp during export). Brave/Safari reference-correct.
- **[HIGH — parked, 2 fixes failed; instrument before more] Mobile: output preview black after the save handoff.** PWA — return from save → source preserved but output BLACK, stays black even loading a new source; only app relaunch recovers. Mobile web — "view image" opens the JPG as a page, back → both source + output lost. Tried B230 (contextlost/restored + reinitGL) + B234 (cache WEBGL_lose_context) — neither recovers. Key clue: a new source still renders black → the restore path likely never runs. Next levers: (a) **instrument** via remote Safari inspector (do lost/restored events fire across the save cycle?); (b) scope the `pagehide` loseContext to real navigation (skip on our own save/view click); (c) recreate the canvas + engine outright on return; (d) different web "view image" handoff. Related: live-camera full reset = the page-discard item under Sources.
- **[MED] Firefox: the output window runs ~1 fps.** Safari ~60 HD / ~30 4K fine; Firefox ~1. Likely Gecko throttling the popup's rAF when unfocused, or a slow 2nd GL context. Investigate `document.hidden` on a 2nd monitor; try setTimeout/OffscreenCanvas to dodge the throttle. Worst case: "use Chromium/Safari for the output window."
- **[MED — edge case] Timeline doesn't update after returning to motion from a camera still.** Repro: still → add keyframes → switch to a CAMERA still (capture) → re-enter motion → timeline doesn't update; a different still IMAGE updates fine. Suspect: `captureFrame` sets the source via `engine.setSource(img)` directly and skips the motion-rebind step `loadImage` runs (`env.rebindMotionToSource` / `renderTimeline`) — compare the two paths.
- **[MED → likely resolved B244, verify iPad] Motion footer must never shrink the timeline.** Arc 3 made the timeline `flex:1` between fixed clusters. Confirm on iPad portrait, then drop.
- **[MEDIUM] Phone PWA: safe-area below the tab bar doubles up.** Installed standalone — the bottom safe-area inset looks applied twice (`env(safe-area-inset-bottom)` double-counted). **Treat as ONE safe-area investigation with the "PWA tab-bar bottom anchoring" item.** Needs live device inspection; honor OS insets verbatim.
- **[MODERATE-LOW] Filmstrip/scrub thumbnails go muddy during rapid keyframe+scrub on a long clip.** Self-resolves once activity settles. Root: seek-per-cell filmstrip build captures before a cold decoder presented the frame; rapid scrub cancels builds mid-flight. No clean no-tradeoff fix (rVFC avoided on the occluded `<video>`). Levers: decoder warming on load; buffered marker-thumb commit; small decoded-frame cache.
- **[LOW–MED] Edge seams where a segment slice meets the canvas edge (certain video files).** A thin border seam the fold mirrors. Proposed: opt-in **edge-inset crop toggle** (sample a few px in from the source edge).
- **[LOW–MED] Source-panel corner seams unjoined in VIDEO EXPORT.** The B223/224 corner-join fix (closed path + `lineJoin:round`) landed in the live overlay but the exported "how it was made" source-preview still draws unjoined corners — apply the same closed-path join to the export path.
- **[LOW] Save-resolution hint ("Sharp output up to ~XK") under-reports.** Ignores canvas aspect; `tilesPerDim` may under-count perceived repeats. An order-of-magnitude SWAG hint — make it aspect-aware + re-derive tilesPerDim per form when revisited. Needs a mis-estimating case to trace.
- **[LOW] Wide preview pins to the TOP of the main area (all engines).** A 16:9 comp floats up with dead space below. Needs live computed-style inspection of `.slot-content`/`.preview-canvas`; don't ship a blind fix.
- **[LOW] Radial wedge outer arc isn't strictly honest.** The sampled area extends beyond the drawn arc, especially on non-square canvases. Draw the true extent or mark approximate; audit `engine/geometry.js` vs the overlay draw.
- **[MED — regression watch, Electron, Daniel B483–B488] Output pinch-zoom no longer feels direct (delay/ease) + BT-trackpad stutter-at-first.** Daniel: the trackpad pinch "functions but with a delay and some ease rather than moving the amount I'm pinching," and with a **Bluetooth** trackpad it stutters at first when tracking the pinch; the **built-in trackpad and the iPhone gesture input both feel good**. Analysis: the zoom math is direct — `applyUnifiedZoom` (kit/zoom.js) is synchronous with no easing, the wheel handler applies `factor = exp(-deltaY·0.01)` per event with no accumulation, and `canvasNorm` (B483) is a static shader multiplier that can't add delay. So this points to **input-event cadence** (BT polling / wheel-momentum coalescing vs rAF), NOT the zoom pipeline or the triangle change. Needs on-device repro to isolate (does built-in-trackpad alone feel non-direct, or only BT?); don't blind-fix a feel regression on a path that can't be verified here.
- **✅ [WAS HIGH — Daniel B495, Electron] FIXED B498 — bounce bake stalls at the reversal point: "decoder stalled at 88.061s".** Diagnosed, not a flaky file. `video-decode.js` `frameAt()` is **monotonic-friendly**: `if (target < lastTargetUs) resetTo(target)` — a backward jump re-decodes from the preceding keyframe. Bounce mode plays forward then **reverses**, so every frame past the midpoint is a backward jump = one keyframe re-decode PER FRAME. On a long clip with a sparse GOP that blows the 10s `deadline` at exactly the halfway mark, which is precisely where Daniel saw it. **Fix directions:** (a) decode the reverse half in FORWARD order into a ring/cache and emit it backwards (the standard approach — decode a GOP, hold it, walk it in reverse); (b) failing that, detect the reversal and pre-roll from the keyframe once per GOP instead of per frame; (c) at minimum, replace "decoder stalled" with an honest message naming the cause, since the current text sends you looking at the file. Slice/forward bakes are unaffected (monotonic). **B498 fix:** a REVERSE-WALK CACHE — one re-decode per window instead of per frame, bounded by bytes (~96MB → ~32 frames at 1080p, ~8 at 4K, so the bigger the frame the fewer we hold). Plus an honest timeout message. **⚠️ Correction on the record:** the original diagnosis above (B-frame cts reordering fooling the keyframe scan) was **disproved by a harness over IPBB-reordered tables** — the old scan agrees with the correct answer on well-formed input. The time-sorted binary search was kept anyway (the early break is a real hazard on unusual tables, and O(log n) beats O(n)) but it is NOT what fixes this. **Still unverified on device** — if the stall survives B498, the next suspect is per-call overhead in the `frameAt` wait loop (`setTimeout(0)` is clamped to ~4ms and outQ is capped at 12), not the keyframe search.
- **✅ [WAS MED — Daniel B495, Electron] FIXED B498 — a failed bake left the decoder wedged: the immediate retry died at "0.067s" and only an app restart cleared it.** Consistent with a leaked `VideoDecoder` from the failed run still holding the hardware. `bakeAndApply`'s `finally` closes `sliceReaderA`/`sliceReaderB`; **Confirmed by reading:** `bounceReader` was opened at clip-editor.js:782 and **never closed** — only `sliceReaderA/B` were in the `finally`. Fixed, with a comment naming every reader the bake opens. (`exportReader` in motion-runtime is separately owned and was not implicated.)
- **🎛️ [DEFERRED FROM THIS ARC — Daniel, 2026-07-31] PERFORM STAGE MANAGER: clips on deck + crossfade between them.** Perform mode gets a deck: several sources loaded and ready, a way to select what's next, and a crossfade between the playing one and the staged one. **A keyframed motion animation becomes one of the things you can put on the deck** — you build a loop in motion, send it on as a source, and stage it beside the clips. That closes the loop between the two modes: motion authors the material, perform decks and mixes it. Origin: Daniel's B496 proposal to import perform's autoplay-override UX into motion (edits go live, manual wins per field, release drifts back to the keyframed value, `K` commits the current look, keyframes draggable while staged). We agreed that design is **live keyframing, not staging** — nothing is off-air — so it belongs here, in a mode built for on-air work, rather than replacing motion's off-air staging (which B497's `stageSource` seam preserves). Also captures Daniel's read that out-of-sync staged *playback* was "honestly a bit confusing anyway": the deck is where two things legitimately play at once. **Explicitly a rabbit trail from the conduit-hardening arc — do not start it mid-arc.** Build notes when picked up: reuse the follower + per-field ownership (`kit/follow.js`, the input-bus ownership pattern), the program-frame commit discipline, and the transition-speed control (which this work would surface in the motion overflow menu too). Cross-ref the shared-socket constraint: N decks means N decodes, so the deck's capacity is bounded by the same budget as everything else — proxies or bounded stills for anything not currently on air.
- **[MED — watch, Daniel B498 iPad] Main-engine GL context-loss recovery does not restore the stage preview or the timeline thumbnails.** During the B480 double-decode crash (he was on the `<video>` fallback), the MAIN webview lost its context while the EXTERNAL view kept rendering on its own: source playback and the broadcast continued, but staged content and thumbnails went dark and stayed dark. `main.js` has `webglcontextlost/restored` handling and the PiP has its own half, so something in the restore path isn't re-uploading the filmstrip/stage surfaces. Independent of whatever caused the loss — re-check once the native decode path actually runs and the losses stop being routine.
- **[LOW — Daniel B504] A video source opens in STILL mode before switching to motion.** "Newish". Cosmetic, but it reads as a glitch on every load — the mode switch happens after the native upload/attach resolves, so the still-mode frame is visible for as long as that takes. Either engage motion before the attach or hold the mode transition until the source is live.
- **✅ [WAS MED — B501] The keyframe FILMSTRIP stood down on the native path — FIXED B506.** Now takes each cell from `env.stillAt` and points the engine at that still for the capture, restoring the planar source afterwards (including on a cancelled build). Paired with a `tolerance` parameter on `frameAt`: thumbnails ask for 0.5s (a cell doesn't care which frame of the second it gets), scrub previews keep 0.05s.
- **✅ [WAS HIGH — Daniel B505] The Loop Builder's CANCEL was non-responsive during a bake — FIXED B507.** Not a broken button: `exitLoopBuilder()` refuses while `baking` is set (correctly — the decoders are in use) and did nothing else. `exportVideo` already took a per-frame `shouldCancel`; the bake never passed one. Cancel now arms `env.clip.cancelBake` and the bake's existing unwind does the cleanup.
- **🎚️ [PROPOSED — Daniel B506, needs a yes] ADAPTIVE PREVIEW RESOLUTION while broadcasting: a real feedback loop, not a fixed cap.** Daniel's framing, and it's the right one: "render at full res when not broadcasting and scale down as needed when we are, even if the floor is 480p — that's enough to be usable while keeping the output pristine." Turning off previews during a broadcast is a massive UX degradation and is off the table; scaling them is not. **Current render budget per frame when broadcasting 4K from perform:** external view 3840×2160 (8.3MP) + in-app preview ~2MP (dpr-capped at 2, long edge capped at 2048) + perform PiP up to 1600² docked / 960² floating (0.9-2.6MP) ≈ **13MP, i.e. ~57% overhead on top of the 8.3MP that actually goes on air.** In motion it's ~10.3MP (~24% overhead). **Design:** the external view already reports its measured render rate upstream (`sendUp({type:'fps'})`, `poster.noteFps`), which is a real signal — it counts completed renders, so a number below 30 means that view genuinely could not keep up. Use it as the controller input: while a broadcast is live, step the PREVIEW and PIP caps down a ladder (2048 → 1440 → 1024 → 720 → 480) when measured output fps sits under target for a couple of seconds, and step back up when it holds above target with headroom. Hysteresis + a floor so it can't oscillate or vanish. Restore full resolution the moment the broadcast stops. **Note the ladder already exists in spirit** — `createPoster`'s `RENDER_CAPS`/`SOURCE_CAPS` degrade on external-view CRASHES; this is the same idea driven by frame rate instead of by disaster, and it should probably subsume that path rather than sit beside it. Touches main.js (`resizePreviewCanvas`), perform-runtime (`sizePip`), external-display/conduit poster. **Propose-before-build per CLAUDE.md; this entry IS the proposal.**
- **[LOW — insight, B506] The kaleidoscope is TEXTURE-BANDWIDTH-BOUND at 4K, which explains two of Daniel's observations at once.** He noticed a smaller slice overlay gives noticeably better fps than a larger one, and that capping source detail to 720p recovers the last few frames per second. Same mechanism: a small slice means every fragment samples a small region of the source texture, which stays resident in cache; a large slice spreads sampling across the whole 8MP texture and misses. Capping source detail shrinks the texture so more of it fits. Worth knowing before optimizing — it means the wins are in reducing sampled TEXTURE FOOTPRINT and rasterized pixels, not in the upload path (already 0.6ms) or the wire (already 30/s).
- **[MED — Daniel B505] A crossfaded bake of a 6:39 clip projects to ~25 minutes.** Progress didn't move for the first minute, then inched. Decode + crossfade + re-encode of ~12,000 4K frames through WebCodecs, single-pass. Options when picked up: (a) do it natively (`AVAssetExportSession` / `AVAssetWriter` with a composition — the plugin already owns the asset, and this is exactly what that API is for); (b) cap the bake resolution with an explicit warning; (c) bake only the crossfade REGION and keep the rest as a trim, which is what the loop actually needs. (c) is probably the real answer and is the cheapest. Note a bake is off-air by design (B494), so it competes with nothing.
- **✅ [WAS HIGH — Daniel B490→B504, the external display could never join] FIXED B505: the fan-out added a client before its socket was up.** `FrameSocketServer.accept()` put the client in the broadcast list on accept rather than on `.ready`, so the first send went to a connection still doing its WebSocket upgrade; that send's completion never fired, `sending` latched true, and the consumer was starved permanently. Presented as a resolution problem because the race is against the handshake: at 4K the loopback is already moving ~370MB/s and the newcomer lost every time, at 1080p it won. Daniel's full matrix (every source-detail setting × every output resolution, 4K clip always fails / 1080p clip always works) is what made it findable — and it also proved the source-detail cap was never a candidate, since **the cap bounds the engine's texture, not the wire**. Fixed in both plugins, with a stall reaper and native-side fan-out logging. Supersedes the B502 accept-queue diagnosis, which was wrong.
- **✅ [WAS HIGH — MEASURED B502/B503] The 4K wall was the ENGINE'S TEXTURE UPLOAD, not the socket — FIXED B504, VERIFIED ON DEVICE (162.6ms → 0.6ms at 4K; 60 painted/s, decode-bound).** Three points, dead linear at ~20ms per megapixel (720p 18.7ms / 1080p 49.5ms / 4K 162.6ms) = ~200MB/s = CPU readback: `engine.updateSourceFrame()` was doing `texImage2D` of the receiver's WebGL canvas from a *different* context, which WebKit round-trips through main memory, while the wire delivered 28-30 frames/s the whole time. **Fixed by handing the engine the planes** (`engine/yuv.js` + `gl.js createPlanarUploader`) and converting into its own source texture through an FBO — which turned out NOT to need the GLSL change originally proposed, since `u_source` stays an ordinary RGB texture. Wired into all four sampling engines (preview, output bus, PiP, external view). Also explains why the native camera never showed it: same path, but 1080p and sensor-capped at 30fps, so ~50ms hid inside the frame budget. **Device verify pending — that reading decides the arc (see HANDOFF's decision rule).**
- **✅ FIXED B559 — the external display webview's console never reached the Xcode log.** `warn`/`error` plus `window.onerror` and unhandled rejections ride `sendUp`; the driver re-logs them as `[fold ext]` and the last 20 lines ride the exported report as `extLogs`. Original entry kept below for the reasoning.
- **[SUPERSEDED by the above] The external display webview's console never reaches the Xcode log.** Only the main webview's `console.*` is bridged, so every failure inside `output-view.js` (the "could not join the video stream" class, a source payload that never arrives, an engine that never renders) is invisible unless it happens to print text on the HDMI screen. This has now cost two rounds of guessing. `sendUp` already exists as a channel from the external view to the main app — forwarding warnings/errors up it and re-logging them with a `[fold ext]` prefix would make the next external-display failure diagnosable instead of inferred. Small, and it pays for itself the first time it fires.
- **[SUPERSEDED by the measurement above] 4K over the shared socket delivers frames at a FIXED low cadence, independent of playback rate.** Native decode confirmed working end to end (217MB/s upload, first frame received, decode active). Symptom shape says throughput wall: regular one-frame-at-a-time, unchanged tempo at 50% vs 100% speed, external view slower still. **Candidates:** (a) the wire — 12.4MB per 4K YUV frame and `FrameSocketServer` gates a client until its previous send completes; (b) the GPU — two uploads per frame, the second being the engine's cross-context `texImage2D` out of a 4K canvas (~33MB). The native CAMERA shares this path and is fine at its 1080p default (4× less), which is consistent with either. **B500 ships instrumentation + a source-cap A/B rather than a guess** (see CHANGELOG). **If it's the GPU:** the structural fix is to give the ENGINE the Y/CbCr planes and do the conversion in its own fragment shader — one upload instead of two, no intermediate canvas, no cross-context copy. That's a GLSL/engine change and wants proposing before building. **If it's the wire:** options are chroma-subsample harder, cap the streamed resolution natively (AVPlayerItemVideoOutput can hand back scaled buffers), or hand the external view a lower tier than the main view.
- **📈 [ANALYSIS — 2026-07-31, post-B506] WHERE THE REMAINING 4K FRAMES ARE, and what the real ceiling is.** Measured standing: 4K→4K broadcast runs 22-26fps at native source detail, 29-30 at 720p detail, on both a 20s and a 6:39 clip. The clip is 30fps, so the gap is small and the cause is now known to be **fill rate, not throughput** — the engine upload is 0.6ms and the socket delivers 30/s, but the same frame is rasterized by up to four engines (preview, PiP, output bus, external view) and the external one renders at 3840×2160. That the 720p cap recovers the last few frames per second is the proof: fewer source pixels only helps a fragment-shader-bound pipeline. **Ranked levers, cheapest first:** (1) skip the PREVIEW engine's render while broadcasting at 4K, or drop it to a lower internal resolution — the operator is watching the HDMI output, and the preview is the least valuable of the four renders; (2) render the external view at 2560 instead of 3840 (the panel's own `preferred`/`nativeBounds` both report 2560×1440 — we pick the largest advertised mode, which may be oversampling for no visible gain); (3) chroma-subsample the wire (YUV 4:2:0 is already 12.4MB/frame at 4K; the planes are what they are, but a native downscale in `AVPlayerItemVideoOutput` would cut the socket AND the upload together, unlike the current cap which only bounds the texture). **Real-world limit:** clip LENGTH is no longer a factor for playback — the decode is native and streaming, so a 10min 4K clip costs the same per frame as a 20s one (confirmed: the 6:39 clip broadcasts at the same rate as the 20s one). What still scales with length is the one-time upload (~4s for 58MB, ~20s for a 1.2GB clip), the thumbnail pass, and the bake. **So the stated 4K/10min target is met for playback and broadcast, and what's left is authoring ergonomics on long clips, not throughput.**
- **🎯 THE STATED TARGET (Daniel, 2026-07-31) — read this before optimizing anything on the video path.** "On modern performant hardware we can handle working with 4K clips up to 10 mins and 4K output, and then degrade capabilities gracefully based on constraints of older or less powerful hardware." So: 4K/10min at 4K out is the ceiling to design toward, NOT the floor to require — and the degradation ladder (resolution caps, feature gating) is a first-class part of the design, not a failure mode. Current standing: **~9min 1080p → 4K HDMI is solid** (15min uneventful); **18s 4K → 4K HDMI is close** (no loop pause, decent fps, occasional stuck frames); **6min 4K → 4K HDMI is not usable yet** (periodic sputter — see the range-server hypothesis directly below). Weak links ranked, B493: (1) the `fold-ext://` synchronous main-thread range reads; (2) two 4K decoders + two 4K texture uploads per frame (~66MB/frame of upload traffic) — what S3-A stages 3/4 remove; (3) sustained-4K thermal throttling (matches "smooth, then slows down"); (4) the fps readout counts RENDERED engine frames, not NEW source frames, so it reads healthy while the underlying `<video>` stalls — an honest metric would count PTS/rVFC advances.
- **🔍 [HIGH — Daniel B493, hypothesis not yet tested] The `fold-ext://` range server probably IS the 4K periodic sputter.** Symptom: a 6min 4K clip over 4K HDMI plays smooth then pauses every few seconds; 50% playback speed roughly halves the pauses; 1080p is clean; an 18s 4K clip is clean. Mechanism: `serveWithRange` (fold-external-display's `WKURLSchemeHandler`) caps EVERY response at 8MB **and does a synchronous `handle.readData` on the handler's main thread**. 4K at ~50Mbps burns 8MB every ~1.3s, so the external webview's main thread blocks on a disk read at exactly the observed cadence — and every one of the four observations falls out of that arithmetic (half the rate → half the pauses; 1080p at ~10Mbps → a read every ~6.4s and a cheaper one; a small clip stays in the page cache). **Fix:** read on a background queue, hand the bytes back on the main thread, and add a stopped-task guard (`webView(_:stop:)` is a no-op today, so an async response to a cancelled task would raise). Possibly also raise the cap for big files once the read is off-thread. **Test it before building it:** the cheap A/B is to change only `maxChunk` and see whether the pause *interval* moves proportionally — if it does, the mechanism is confirmed. Note this whole path disappears on the native side under S3-A stage 4 (no external `<video>` at all), so weigh the fix against just finishing the arc.
- **✅ [WAS HIGH — Daniel B490] Baking a seamless loop from a 6min 4K clip WHILE broadcasting to HDMI restarted the app — FIXED B494.** The Loop Builder now takes the broadcast off air for its whole duration (a `notice` text card on the external view), which drops a 4K decode and a 4K render — the headroom the bake needed. Daniel's call: "there's no real merit to broadcasting anything during the loop builder." Original diagnosis kept for the record: The clip is dropped as if freshly opened. The bake decodes + re-encodes 4K (`exportVideo` + the clip-editor's decode videos) while the external view renders at 4K — a memory wall, not a logic bug. The 20.4s 4K clip bakes fine, so it scales with clip length. **No guard shipped.** Options when picked up: refuse-with-a-reason above a size/duration threshold while an external broadcast is live; pause the broadcast for the duration of the bake (probably the honest one — a bake is not a performance moment); or wait for the shared-socket path to cut the concurrent decode count and re-measure. Daniel's call on which.
- **[MED — Daniel B490, follow-up to B492] Footage-thumbnail builds seek the PROGRAM video.** `buildSrcStrip` (and the motion filmstrip) drive `env.sourceVideo` directly — in perform that is the live source, so a rebuild fights the transport. B492 fixed *when* they rebuild (a clip+trim signature, so a trim/bake no longer leaves stale thumbs); *what they seek* is unchanged. Build them off their own hidden decoder the way clip-editor's `thumbVideo` already does. Likely the same root as the "slow thumbnail reprocess" watch item, and it gets sharper under S3-A, where the source clock may be a native decode that cannot be borrowed for thumbnails.
- **[MED-LOW — watch, iPad 4K-over-HDMI, Daniel B487] Loop-point pause + slow thumbnail reprocess + occasional stutter.** With the "4K/QHD over HDMI" toggle on, 4K source → 4K HDMI: plays smooth after one loop, but (a) **pauses momentarily at the loop point** (the `<video>` loop seam — should vanish under S3-A's seamless native `AVPlayerLooper`), (b) **timeline thumbnail reprocess is very slow** (a perform↔motion switch nudged it), (c) occasional playback stutter even on 1080p→4K. (a) is expected to be fixed by shared-socket S3-A; (b)/(c) are watch-items to re-measure after S3-A. **B490 re-test (Daniel):** the loop-point pause happens **100% of the time on 4K sources**, including a 12.6s baked seamless loop — so it is not a property of one clip. (c) got a mechanism and a fix in B491 (external-view seek thrash); (b) got a *timing* fix in B492 and a decoder-isolation follow-up filed above.
- **[BUG] Motion JSON doesn't remember aspect ratio.**
- **✅ Locked-control feedback + broadcast lock decision — SHIPPED B469.** Daniel's call: structural locks (form/segments/spiral/mirrors/oobMode) stay user-unlockable mid-broadcast (already were); `frameAspect`/`outputRes` STAY hard-locked (a mid-broadcast dim change = sender teardown/recreate = Arena/HDMI blip — not worth it; fill-display covers aspect). Fixed the real bug: a tap on a locked control now shows a toast (`.m-locked` body is `pointer-events:none`; a delegated listener catches the tap-through to `.m-control[data-lock-key]` and surfaces `why` — mobile). Added `WHY.broadcast` so the reason reads as a broadcast guard, not the motion "across keyframes" wording (also improves the desktop tooltip). **Tail:** if the encoder-tied pair is ever wanted mid-broadcast, it's the "unlock → change (brief sender-restart blip) → relock" flow — deferred by Daniel's decision.
- **[LOW, park until reproducible]** Cursor affordances intermittently missing (Firefox cold-start); PWA live-camera vertical ~2× stretch (mobile, self-corrected); assorted Firefox UI quirks (fold into the Firefox pass).
- **On-add keyframe thumb still on `readPixels` (desktop Safari).** Can flash corrupt before the 600ms debounce corrects it; move `fillThumb`→`exportFrame` off readPixels if bothersome. (Still-export `exportAt` also uses readPixels — same escape if a corrupt still ever appears.)
- **Intel Air black-square export — needs hardware access.** Probe passes (FBO complete) but the render is all-black; likely Intel iGPU driver bug with large FBOs. Run diagnostics + check `endToEndTest.summary.allZero` next time the hardware's accessible; design a render-validation step into the probe.
- **Camera preview performance (M1 iPad).** ~12–15fps in live preview; dominant cost is the full-res camera texture upload (up to 3840×2160). Lever: request/upload a lower-res preview stream, keep high-res only at capture.

### Quick wins / cheap optimizations

- **✅ FIXED B563 — [iPad] Loop Builder header collided with the iOS status bar (Daniel, B547).** `env(safe-area-inset-top)` on `.loop-header`, plus left/right insets (non-zero in iPad landscape, where the close button sat against the edge) and the left inset on `.loop-rail`. **Still wants a device look** in both orientations. Original entry:
- **[verify on device] Loop Builder header collides with the iOS status bar (Daniel, B547).** The Loop Builder's header UI does not honour the safe-area inset and runs under the clock / battery / Dynamic Island. The builder hides the app bar and fills the screen (B404/B387), so it is the one surface that owns its own top edge — and it is the one that forgot to. Fix with `env(safe-area-inset-top)` per the standing rule (honour the OS inset verbatim; do not pixel-match device geometry). Check both orientations, and check the step rail's top alignment while you are in there. **Verification row is in VERIFY-QUEUE under "Loop Builder".**
- **Inputs tab: say what works HERE.** State per-adapter support for the current browser: Web MIDI = Chromium-only (DMG always works); Brave shields block Gamepad API + Web MIDI (shields-down fixes); iPhone/iPad gesture + QR pairing need the desktop DMG (LAN server lives in Electron). One capability line per adapter (they expose `supported()`) + a "use the Mac app for X" pointer.
- **Add a 150% speed preset to the Loop Builder format control** (`fmtSpeed`; speeding up never needs interpolation — free now). The resolution/fps/speed format controls shipped B394 on the Preview & bake step.
- **Source-fps warning in the Loop Builder format spec** — the spec (`renderFormatSpec`) shows the effective loop; add a warn when the chosen speed drops effective fps below ~15 (the "this will judder without interpolation" hint). Cheap interim before frame interpolation.
- **Output band declutter:** remove the horizontal rule between the global bar and the output sub-band; drop the redundant idle resolution readout.
- **Test-pattern: add a moving element** (sweep or counter) so a frozen pipe doesn't look like a working one.
- **Drop the real assets:** Daniel drops a 16px-legible favicon (`public/favicon.svg`) + the Apple Icon Composer app-icon (`electron/build/icon.png`); homes wired + shown in the Lab.
- **Hide (don't disable) settings that don't apply to the current form** (e.g. no segments row on hex). Cheap standalone if reached before the per-panel control stacks.
- **Still-mode frame picker thumbs: re-render on resize** (cells stretch after big divider drags; add a debounced rebuild — the build is already cancellable + single-flight).
- **✅ DONE B563 — dead CSS `.camera-live-row` deleted.** Confirmed no markup carried the class; `#shutterBtn`/`#flipBtn` are `.ot-btn` toolbar items now, so the rules had no selector to match.

---

---

## Fold Live — perform mode & live output

> The active program was the UX-restructure → perform program (arcs 0–7). Arcs 0–5 core + the mode/timeline/staging/autoplay/control-bus work SHIPPED (see CHANGELOG). Remaining pending below.

### Perform autoplay ("drift") — open tails
- **Discrete variety tier** — form/segment changes on a long randomized cadence (deferred until the continuous feel is dialed).
- **Auto keeps drifting a STAGED look** (deferred variant).
- Remaining dial-in constants (momentum probabilities, sweep floor, coverage exponent, pace curve, smoothing tau) in `perform-runtime.js` `autoPick`/`autoTick`.

### Multi-clip source staging (perform) — DEFERRED (strong next-arc candidate)
Seamlessly move from one clip to another LIVE, using only the gesture controls — **retain the current slice overlay while crossfading the SOURCE underneath**. Not a full clip-blend engine; a source A↔B dissolve. ~3–7 clip slots. Least-invasive path: alpha-blend two source `<video>`s into an offscreen canvas (reuse `drawTwoVideoBlend`/`#clipBlend`, `clip-editor.js`) → `engine.setSource(canvas)` per frame (the engine is source-agnostic — no engine change). Pairs with edit-during-staged-playback / per-field ownership (Motion editor § Open animation threads).

### Clip queue → workspace sessions → persistence (Daniel's direction, 2026-07-24) — DEFERRED, but shapes near-term data-loss work
The multi-clip staging above is step 1 of a larger arc. The full picture, captured so today's data-loss decisions (source-swap warning + copy) angle toward it rather than away:
- **Perform clip queue.** A deck of clips staged "on deck," callable in perform + crossfaded one→another (immediate driver: perform continuously between clips without pausing output). This is the UI home the staging crossfade lives in.
- **Save individual clips.** A clip = raw file + motion data (keyframes, isLoop, etc.). **We mostly already have this** in the motion JSON (`motionToJSON` — carries isLoop/aspect/keyframes); the gap is packaging the raw source WITH it and a load-back path. This is the atom of everything below.
- **Save workspace sessions.** The whole deck — all clips + their positions/order in the queue/clip-manager — as one document. Reopen and land exactly where you left off (WIP across sessions). Native-app value especially.
- **Motion-editor loop → perform clip.** Author a keyframe animation in the motion editor and save that animated loop OUT to perform as a clip — so perform slots are populated with **pre-optimized animations as the default starting point** (still live-overridable). Ties to "bake a bounce/loop" and cross-form keyframe work.
- **Close/quit data-loss guard.** Warn on app close with unsaved work — `beforeunload` (browser), the Electron `close`/Cmd-Q hook, and whatever iPad/Capacitor exposes on background/terminate. Detection surface varies per platform; capture what's possible where.
- **Architectural throughline for the interim source-swap warning:** design its pattern + COPY toward this future — the vocabulary is *save this clip* / *assign to the workspace* / *save the workspace*, not a generic "you'll lose changes." Reuse the `confirmInterrupt` shell. Pick state-persistence patterns (IndexedDB for blobs; the portable user-config JSON at "Control bus → Generalized user-config JSON") that a clip/workspace store can grow into.
- **OPEN Q (unresolved, Daniel):** the current "preserve keyframe positions when you change source (unless live feed)" default has pros/cons — should a source swap ASK (keep positions ↔ start fresh) or keep defaulting one way? Leaning toward an interim data-loss gate first (below), with the ask/remember decision folded into the clip/workspace model when it lands.
- **Source-swap data-loss gate — INTERIM SHIPPED B431 (desktop).** `env.guardSourceSwap(proceed)` fronts the desktop file-input + drop loads: if `env.hasUnsavedClipWork()` (source loaded + authored keyframes), a `confirmInterrupt` offers **save & load / discard & load / cancel**. These are the FIRST staging seams, named to grow: `hasUnsavedClipWork` → per-slot dirty tracking (replace the keyframes>1 heuristic + add a real dirty flag reset on save); `saveActiveClip` packages the CLIP artifact (`env.media.originalSource` blob + `motionJSONBlob`) — interim to a `.zip` download, staging swaps the sink for the in-app clip store (IndexedDB). **Remaining entry points to route through the guard:** the source PICKER menu (if it bypasses the file input), the camera/still swap (`engine.setSource` paths in source-host), and the **mobile** source-load (`loadImage` in chrome.js — separate chrome). **Tune:** the `keyframes>1` trigger may want to also cover a bare source with slice edits once dirty-tracking exists.

### Control bus — open tails (Arc 6)
- ▶ **APC40 MK2 default profile** — allocate the physical zone WITH Daniel + full-zone LED painting as the connected cue (he held his APC mapping until rig-save existed — now unblocked).
- **Additive 'pulse' mapping mode** — physical inputs SET the base value, audio/onset signals ADD decaying offsets (Resolume value+animator model); the bus already allows multiple signals per field, pulse is one more mode + a per-field offset ledger.
- **Audio adapter** — Web Audio AnalyserNode → RMS/onset/tempo signals into the same mappings (pulse-mode default). No native code.
- **Node-based mapping canvas** — adopt **Drawflow** (MIT, zero-dep) as a visual skin over the same rig JSON when the audio adapter lands (inputs left, params/actions right, mappings as wires). List view stays for quick edits. Confirm the dependency at build time.
- **Generalized user-config JSON** — one portable `{v, inputs, prefs, ...}` doc all features read/write (the input bus migrates onto it); carries "don't show again" flags, defaults, UI dispositions, per-venue profiles. Electron mirrors to userData; web = localStorage + download/import.
- **Keyboard-device capture** (XP-Pen ACK05, TourBox-as-keyboard) — needs a capture-scope design so bindings don't fight app shortcuts. TourBox Elite HID = a WebHID adapter; ESP32 = class-compliant USB-MIDI (works with the existing adapter unmodified).
- **Per-mapping curve/smoothing knobs** (the row model reserves them); **mapping profiles** (save/load named rigs per venue).

### Mobile gesture-input surface — open tails (SHIPPED v1 B281–B283)
- Canvas two-finger PAN over the remote surface — code SHIPPED B464 (phone sends centroid as a `d` message) + verified correct END-TO-END B466, but Daniel still sees no pan ⇒ suspected STALE gesture page on the phone (old DMG / Safari cache). B466 added "· pan" to the phone canvas-card label as the "am I on the new page?" tell. **If it reads "· pan" and pan STILL fails, it's a real receiver bug** (next: log in the input-bus drag branch / confirm `panDrivableNow()` on the active form). Tunables: `PAN_GESTURE_SENS` (input-bus), `PINCH_ZOOM_SENS`=1.05 (was 3, −65% per Daniel B466). Zoom guard: `Z_SLICE_IN_FLOOR`=0.7 (canvas can't shrink slice below ~70% source).
- **[MOBILE UX — Daniel 2026-07-29] "Keep centered while zooming" lock for radial/droste.** On the native gesture surface, pan+zoom are ONE combined two-finger gesture (vs. discrete on desktop), so on radial/droste it's "basically impossible to zoom without repositioning" — undesirable for those centered forms. Droste/radial pan is intentionally left ON (B467), but add an opt-in lock (a toggle, or auto for radial/droste) that suppresses the centroid-pan component during a zoom gesture so you can zoom without drifting the center. (Ties to the general gesture-decoupling / per-form gesture-policy idea.)
- Full touch-manipulation of the overlay ON the phone (grab edges/corners/handles like the desktop overlay — port `classifyPointer` + affordance hit-testing over the WS; today's zone gestures cover move/scale/rotate without handles).
- Duplicated-slider layouts; multi-phone support (server accepts N clients; signals need per-client ids).

### Mobile touch responsiveness / hit-testing — POLISH WATCH (Daniel, 2026-07-24; not a blocker)
Touch on the mobile controls feels a touch laggy/finnicky, especially while recording — no longer the two-tap regression (fixed B429/B430), but not crisp. A dedicated polish pass, not gating anything. Known threads: **(a)** controls in `#m-settings` (a `-webkit-overflow-scrolling:touch` momentum-scroll container) can absorb a first tap when the container isn't "settled" — worse under record-time render load; try dropping the deprecated `-webkit-overflow-scrolling` (modern iOS scrolls smoothly without it) and/or not making the panel a scroll container when it fits. **(b)** the "top visible layer wins the tap" principle (B430 handled the source-panel icon buttons via a `padDown` control-bail + expanded `::after` targets) should be audited across ALL layered surfaces — popovers, PiP, sheets — for stray capture-phase / document handlers that eat the first tap. **(c)** general touch-target sizing sweep (44px min) on the mobile chrome. **(d)** the record-time padlock two-tap, if it recurs after B430 — needs the pinpointing observation (settings-view vs source-visible, live-cam vs still).

### Mobile UX polish pass — settings-over-canvas + menu positioning + tap arbitration (Daniel, 2026-07-26) — POLISH, not a blocker
Surfaced while verifying the mobile joystick controls (B449). A dedicated mobile-UX pass, separate from the functional work:
- **Editing controls obscure the output — can't see the real-time result.** The settings menu (canvas/slice, incl. the joystick) mostly covers the output canvas, so you can't watch what you're adjusting. Want the canvas visible while editing — e.g. a more compact / side-docked / translucent / peek-through settings surface, or shrink-the-output-behind-a-scrim while a control is active. Most acute for the *live* controls (joysticks, sliders) where seeing the change is the point.
- **Menus can hide beneath panels when dragged past the grippy.** Repositioning a menu via its grippy handle can push it *under* an adjacent panel (z-order / off-screen clamp issue) — it should stay on top and clamp within the viewport.
- **Tapping controls interferes with tap-to-focus** (camera source). Controls layered over the canvas eat taps meant for tap-to-focus — same "top visible layer wins the tap" theme as the [Mobile touch responsiveness](#) item's thread (b); resolve the two together (a control tap must not also fire a focus, and vice-versa).
- General: real-time-visibility-of-edits, menu positioning/z-order, and tap arbitration are the three themes. Pairs with the touch-responsiveness POLISH WATCH item above.

### NDI / external-display broadcast — open
- **iPhone NDI broadcast from record-video** (Daniel's idea, wants a design pass): an "NDI broadcast" affordance beside record video — the phone as a standalone symmetry camera feeding Arena (native camera → followed program look → NDI over WiFi). Pieces exist since B356 (`host.ndi` is universal); missing = the mobile chrome's frame feed (record canvas → `host.ndi.publish` per tick) + toggle UI + a perf pass. Sequence after the iPad NDI throughput pass.
- **Electron HDMI/AirPlay external-display parity** — a "display" destination that opens the chrome-free output window fullscreen on a chosen display (macOS treats HDMI/AirPlay as normal displays; `screen.getAllDisplays()` gives labels). Rides the output-window sink + a small placement IPC; no new rendering.

### Perform-mode input — controller mapping (define WITH Daniel)
macOS gives browsers no multi-touch (Movink/Sidecar register as one pointer; only trackpad pinch = `wheel`+ctrl, SHIPPED). So perform input on the Mac rig = **MIDI (APC40) + Gamepad** mapped to slice params (rotary→angle, slider→scale, XY→position). The exact mapping is undefined — define it at the kickoff (his hardware, his assignments). Bigger touch targets on the Movink = the touch-target-scaling item. True multi-touch = run Fold ON the iPad (confirm `?inputdebug` shows `touches=2`).

- **Control-registry unification — CONTROL BUS spec v2 (Daniel-raised 2026-07-25). This IS the plan; no separate plan doc.** ROOT ISSUE: a control is described in ~6 hand-maintained lists keyed by raw state key — `PARAMS` (UI), `PARAM_TARGETS` (input mapping), `CONTINUOUS/DISCRETE/ANGULAR_KEYS` (tween), `FOLLOW_SPANS` (follow), `AUTO_BOUNDS/TEMPER/EXCLUDED` (drift), shader uniform + `state.js` default. Adding a control means touching several; every miss is a SILENT failure — and even the RIGHT list with the wrong *metadata* fails silently: the droste perform-zoom "goes backward" bug (fixed B460) was `drosteZoomPhase` sitting in `CONTINUOUS_KEYS` but NOT flagged cyclic, so the follower unwrapped it linearly across the [0,1) seam (first misattributed to a missing `FOLLOW_SPANS`, which was already present — a maintainer misdiagnosing WHICH list is exactly the failure mode a descriptor closes). Other misses: missing `PARAM_TARGETS` = unmappable pan. Note: keyframe SAVING is already robust — full-state `{...state}` snapshots + `snap[key] ?? default` mean new keys/forms never break old clips; the fragility is *participation*, not saving.
  **TARGET ARCHITECTURE:** one CONTROL DESCRIPTOR per param — `{ role, label, keyByForm|key, motion:'continuous'|'discrete'|'angular', span, map:{min,max,wrap,dir}, autoplay:{…}, ui:{…}, default }` — and the 6 lists become DERIVED views. Register once ⇒ animates + eases + maps + autoplays correctly. Forms declare their `controls` (like they already declare `uniforms`) so a NEW FORM auto-wires. Mapping targets are SEMANTIC ROLES (resolve to the per-form key) so hardware stays wired across form switches. Precedent already in-repo: the UI's `keysByForm` (segments→drosteArms).
  **STAGED (de-risked):** ✅ **Stage 1 SHIPPED B440** — semantic "zoom" role in `PARAM_TARGETS` (resolves droste→drosteZoomPhase else canvasZoom; `applyMapping` resolves per-apply; drosteZoomPhase hidden from the dropdown), so one zoom knob works across forms. **Stage 2:** derive `CONTINUOUS_KEYS`/`FOLLOW_SPANS` from a descriptor (kills the transition/animation silent-failure class); verify by proving derived == current hand lists (token-parity technique). **Stage 3:** fold mapping meta in, derive `PARAM_TARGETS`; add SNAP-AWARE mapping for discrete controls (segments/form — continuous input → nearest valid integer/enum; `writeParam` currently writes raw). **Stage 4:** forms declare `controls` (new-form auto-wire endpoint).
  **EFFORT / SEQUENCING (Claude's estimate for Daniel):** Stages 2–4 = a focused mini-arc, ~3–5 builds; the CODE is moderate but the RISK concentrates in the equivalence verification (must prove the derived lists match today's behavior exactly — motion/follow/autoplay are subtle). **Recommend a DEDICATED hardening pass, NOT interleaved with M4–M6 feature work** (cross-cutting refactors + feature churn is how regressions hide). Best slot: **after M4/M5, immediately BEFORE M6 (tile builder)** — M6 adds the most new controls, so it's the movement that most benefits from auto-wiring, and doing the refactor just-in-time captures the stable pre-M6 control set. **CONDUIT:** the input bus + descriptor are prime shared infra (every consumer app maps controllers→params) — build once, share.

### 🔎 CLOSED — NDI OUT in the Electron DMG, libndi bundling ✅ SHIPPED B484 (kept only for the bundling note)
Shipped: the addon now links **two** rpaths (dev-SDK path + `@loader_path`, binding.gyp); build-dmg.cjs **bundles `libndi.dylib` next to `fold_ndi.node`** (rebuilds the addon if it predates the new rpath); package.json `asarUnpack` extracts the dylib so dlopen sees a real file. Proven by stripping the dev-SDK rpath from a copy and loading via `@loader_path` alone → `start()` succeeded. **Still needs Daniel's DMG-on-machine verify** (NDI row appears in the shipped .app → localhost → Arena lists it — the App-Store cross-app fallback where Syphon is sandbox-blocked). See CHANGELOG v0.20.27.

### 🎛️ INPUT MAPPING + PER-FORM EXTENTS — one cluster, one pass (Daniel, B559)

**Daniel's framing, and it is the right one: these belong together.** They are all the same unfinished business — the zoom/slice/canvas normalization work (B440 semantic roles, B477 `sizeNorm`, B483 `canvasNorm`, B462 unified zoom) landed for the *touch* surfaces and was never carried across to the other input paths or reconciled with per-form extents. Fixing any one in isolation would be tuning against a moving target. **Sequence this with the tiling-density item directly below, as one pass.**

- **🔴 [HIGH] Game controller / MIDI mappings no longer map correctly across forms.** Daniel performed live on the Electron build with a PlayStation controller and found the mappings "caught looking for the wrong inputs and aren't normalized across forms." The touch/gesture path was normalized; the hardware path was not. **This is what Stage 1 of the control-registry work (B440, semantic `zoom` role in `PARAM_TARGETS`) was supposed to generalize** — see "Perform-mode input — controller mapping" above. Strong evidence that Stages 2-3 are now load-bearing rather than a nice-to-have.
- **🟢 [NOT REPRODUCING on iPad — Daniel, B609] The finger joystick is rotated ~45° from the direction it moves.** **Do not "fix" this blind.** Daniel re-tested on iPad at B609 and it does not reproduce. Either it was resolved by one of the intervening normalization changes (B462 unified zoom, B477/B483 norms, B442/B443 rotation-compensated pan) or it is platform-specific. **Next step is a check on Electron/desktop and iPhone to decide which** — if it reproduces there, it is a platform-path divergence and that is more informative than the original bug. Original report kept below.
  - Daniel: "the finger joystick inputs aren't actually directionally mapped correctly but seem to be off by 45 degrees or so in all directions." A constant angular offset points at an axis convention mismatch (screen-space vs slice-space, or a swapped/negated pair reading as a rotation), not at a tuning value. Check where the joystick vector is converted into a pan delta and whether it is passing through the same slice-vs-canvas basis the gesture path uses.
- **✅ [FIXED B610] Canvas pan accelerated with zoom (iPad/iPhone direct manipulation).** `u_canvasOffset` is subtracted after `p /= u_canvasZoom`, so a flat pan gain accelerates as you zoom in and crawls as you zoom out. Gain is now derived from the shader (`aspect/Z` on x, `1/Z` on y) and the feel-tuned `PAN_TOUCH_GAIN = 3.5` is gone. **Two tails:** simultaneous pinch+pan scales accumulated travel by the *current* zoom rather than integrating, so content can drift under the fingers when both change at once (exact anchoring needs a content-space centroid); and **the remote gesture surface almost certainly has the same defect, masked because it was only verified at default zoom** — test by zooming the host in, then dragging from the phone.
- **🟠 [MED] Panning LEFT is not honored from the iPhone gesture surface** on an infinitely-repeating form (triangle). The finger joystick can move that direction; the gesture input cannot. A direction-specific failure on one axis suggests a clamp or a wrap boundary rather than a mapping error.
- **🟠 [MED] Switching between the mobile gesture surface and the finger joystick JERKS.** Each reverts to its own remembered position rather than continuing from where the other left off. **Expected behaviour: whichever input takes over should adopt the current value and move relative to it** — the per-field ownership pattern the input bus already uses for exactly this. Two inputs holding independent absolute position state is the bug.
- **🟠 [MED] Droste's accumulated zoom leaks into other forms.** Droste zoom accumulates deliberately (so a progressive zoom-in can be animated and the follower remembers it), but switching back to another form retains that accumulated extent and lands on an undesired visual extreme. **Two candidate resolutions and Daniel should pick:** reconcile the extents so the accumulated droste value maps sensibly onto the other forms' ranges, or decouple the parameter per form so each keeps its own zoom state. Pairs directly with the per-form zoom-extent tuning task.

### Triangle "canvas too zoomed out" — tiling-density normalization (Daniel, B481)
Size-norm (`sizeNorm`, B477) scales the SLICE SAMPLE and works for hex; triangle also needs its CANVAS scale (tiles appear too small/dense on canvas). The lever is the tiling density — triangle's `TRI_SIZE=0.6` (shader) + the matching JS super-period (`const s = 0.6`) + the tilesPerDim hint. Bump `TRI_SIZE` (~1.8× → ~1.08) so tiles read bigger, updating ALL references in lockstep so the overlay wedge stays matched. Confirm the direction/value with Daniel first (visual tuning; guessed the slice-vs-canvas lever wrong once). Could generalize to a per-form `canvasNorm` if other forms need it.

### Syphon INPUT — Arena as a live source (Electron)
Receive Arena's program output INTO Fold as a source, kaleidoscope it, publish back out — Fold becomes a live effect in the Arena chain. `node-syphon` exposes the client/directory side. Perf: same readback consideration as output (CPU ~HD-viable). Seam: `host.syphon.listSources()` + `.subscribe(name)`; wire as a source type. Strong pairing with the perform arc.

### Mobile perform (Arc 7)
Output-live always a PiP on mobile. Core: record video with the live camera + AUDIO + the realtime effect + follow-ramp smoothing (recorder captureStream adds an audio track). Reuse the desktop ghost/echo. External live-out from mobile needs the native wrapper.

### Output window — cross-browser + follow-ups
(Safari camera-starve + Firefox ~1fps are in the triage.)
- **The output window PERSISTS after the main app closes** ("kindof cool") — could be formalized as an **exhibit / kiosk mode** (a "detach" action). Note: B383 made the *desktop popup* close-with-app; this is about a deliberate detach option.
- Confirm **`BroadcastChannel` across Electron BrowserWindows** (web path verified).

### Syphon output — open levers
- **Resolution** — 720p/HD is the practical perform default (4K readback = 33MB/frame).
- **IOSurface/native** — the true zero-readback fix and the web-tech ceiling (ties to the native wrapper). The output WINDOW already sidesteps readback (render-from-state).
- **Live server rename while broadcasting** — updates the label but not the live server (next arm); a true live rename = dispose+recreate (Arena blip). Gate behind a confirm if wanted.
- **Benchmark the hidden-engine capture path on M1 Max** — the 9× speedup + render-bound numbers were measured on M5 Max; confirm a generation/tier down. The diagnostics benchmark button already does this.

### Chrome / layout
- **▶ [SIGNIFICANT NEW SURFACE — Daniel, 2026-08-05, prototype-worthy, iPhone first] MERGED SINGLE-SURFACE MODE: drop the source/output split and put the slice overlay ON the output.** Today's two-panel split (source you sample from, output you produce) is the core UX everywhere. Daniel's proposal: on iPhone especially, but potentially on larger screens too, collapse to ONE surface at roughly double the size, with the slice overlay and its direct manipulation drawn over the output itself. **The argument:** it is unthinkable to not see what you are sampling, EXCEPT with a live camera in the real world, where the source context is in front of your eyes already. And there is a real delight case: discovering compositions directly inside the mirrored output rather than by proxy.
  - **Perf read (2026-08-05): expect this to cost slightly MORE, not less, and adopt it for UX reasons.** The engine render is fragment work that scales with output pixels, so roughly doubling the output area roughly doubles the single most expensive item, and the overlay canvas grows with it. What we drop is comparatively cheap (a composited video layer, a ≤640px thumbnail blit). **The better framing is allocation, not savings:** on iPhone the current split makes the output small, so we spend the budget on a panel the operator half-ignores. Merged mode spends it on the thing that matters, and under thermal pressure a single surface has nothing competing with it, which makes the ladder simpler.
  - **The real cost is geometry, not perf.** The wedge overlay lives in SOURCE space over a source rectangle; a merged surface has no source rectangle to draw on. Three candidate designs, and this fork wants Daniel's eye before any build: (a) composite a translucent source over the output with today's wedge on it; (b) highlight one fundamental domain IN OUTPUT SPACE and manipulate from there, which needs the INVERSE of the shader's source→output map and does not exist in JS today; (c) a ghosted source inset that appears on touch. (b) is the one that delivers the "discover compositions in the mirror" promise.
  - **Sequencing:** (b) is straightforwardly cheaper after **M4 geometry-truth** (next arc), which is exactly where a trustworthy source↔output coordinate mapping belongs. Prototype on iPhone.
  - **Instrumentation dependency:** the perf work's surface registry must be layout-agnostic for this not to invalidate it — see `~/.claude/plans/thermal-and-frame-cost-audit.md` §5d.
- **[LOW · investigate] Does the desktop `styles.css` reach the mobile chrome?** B411 surfaced this: a global `body { min-width }` rule in the desktop sheet forced horizontal scroll on iPhone, which shouldn't happen if boot.js's `link[rel=stylesheet]` removal works and the phone is on mobile chrome. Either the desktop sheet isn't being removed on mobile (bundling/timing), or the iPhone briefly/actually falls into desktop chrome. Harmless today (every other desktop rule targets desktop-only DOM; the floor is now `@media (pointer: fine)`), but worth confirming the removal actually fires on device — if desktop CSS is leaking, other global rules could bite later. Cheap check: log in boot.js whether the mobile branch ran + how many stylesheet links were removed, read on the iPhone.

### Live record-to-disk — open tail
Long-render memory → OPFS streaming (under Export & rendering) now applies to live takes too (the mp4 assembles in memory).

- **▶ [HIGH — DEDICATED HARDENING SESSION] iPhone video capture: audio + bitrate/perf failures (Daniel, 2026-07-23; DEFERRED out of the Flows/Guardrails/Tiling arc to keep focus).** A cluster of related record-path failures on iPhone that want one focused session with device profiling, NOT piecemeal fixes mid-arc. Root-cause each and design a **graceful device-degradation framework** + a **hardware capability matrix** (which device/tier runs which resolution/fps/features) so the UI only offers settings the hardware can actually sustain, and steps down cleanly instead of timing out.
  - **No audio in recorded takes (mobile web AND Capacitor).** B410 tried the native fix `automaticallyConfiguresApplicationAudioSession = false` (the AVCaptureSession stomping WebKit's getUserMedia audio session) — **did NOT resolve it**, and it fails on mobile *web* too (no native camera there), so the AVAudioSession theory isn't the whole story. A `[fold] record mic:` diagnostic is in `mobile/chrome.js` (reports track absent/muted/live at record start). Next: read that line on device; check whether WebCodecs `AudioEncoder` (AAC) is even supported in iOS WKWebView (if not, the session should fall to MediaRecorder, which addTracks audio — verify that path actually preserves it); confirm the mic tap's AudioContext produces non-zero samples on iOS. Keep the B410 native change (benign) unless it proves a red herring.
  - **Runs HOT while recording.** Thermal load during capture. Needs the degradation framework (drop resolution/fps under thermal pressure; surface honest status) + guidance on sustainable settings per device.
  - **4K take fails on iPhone 17 Pro.** Even a ~10s clip times out. First attempt reported a ~5s timeout failure, then a later attempt "succeeded" but at unusably low fps (~3fps, ~20 frames total for the clip). Strongly suggests the WebCodecs encoder + readback pipeline can't sustain 4K on this device (the `recordUpscale` renders at record res; 4K readback+encode per frame is the wall). The capability matrix should cap iPhone record resolution to what sustains real fps.
  - **60fps short clip also times out and fails.** Same class — the pipeline can't sustain 60fps; the tier picker should gate 60fps to capable hardware or step it down.
  - Consolidate with the existing **PARKED GNARLY PAIR** (iPad record ~19fps, iOS NDI flicker) and **Lane 5 graceful degradation** notes — this is the same capture-pipeline-ceiling story, now with concrete iPhone 17 Pro data. The `?recorder=mediarecorder` A/B override and the diagnostics benchmark button already exist as instruments.

---

## Motion editor & animation

### Motion timeline — remaining IxD tails
- **Shift+click** to multi-select keyframes.
- **"Reset workspace"** — delete all keyframes, start fresh on the same source.
- **G = +gesture** shortcut (reserved until the capability lands); quick lock/unlock key; app-wide keyboardability untested.
- **Editable duration for a VIDEO source** — treat a duration edit as an implicit speed change, clamped to 0.25×–2× (duration + speed as two views of one control). Needs incremental (non-preset) speeds.
- **Exit criteria** for the rework: responsive to a 700px breakpoint; ergonomic; scannable; progressive disclosure. North star: Procreate Dreams / iMovie.

### Motion editor — design direction (north star reference)
Procreate Dreams / latest iMovie — uncluttered, precise, powerful. Priority stories: add keyframes → scrub fast → edit/delete → realtime playback + loop → export. Open IxD refinement (Daniel drives, pixel-level): prev/next stepper ergonomics; loop on/off legibility (ties to button disambiguation); keyframe-marker + scrubber precision. **Output comparison PiP** — compare actual previous OUTPUT with current (needs rendering two states; also for live-capture/Syphon; held loosely — large track thumbnails may suffice).

### Animation usability
- **Droste seams (REFINED 2026-07-22, Daniel's hands-on):** only the **spiral** creates an uncaught seam when animated between keyframes — the earlier "zoom/thickness seams" was likely mis-attributed to spiral (Daniel can't repro a seam by animating `drosteZoom` alone; queued for a confirming verify). Decision: **spiral is structural, not animatable** — same treatment as segment count (`drosteSpiral` moves into the "editable in motion, but global / never tweened" bucket; not a soft "animate anyway" gate). `drosteZoom` stays freely animatable (and is the carrier for infinite zoom). All other Droste discrete keys (arms, mirror, wedgeMirror, oob) are already held to kf0.
- **M3 lock model — SHIPPED B414–B419** (`shell/locks.js`). Follow-ups from the build: (a) the unlock **warning is a bare `window.confirm`** — migrate to the shared destructive-interrupt pattern (which also serves the source-swap dialog); (b) the **on-canvas offset diamond has no locked visual** yet (functional lock is in); (c) locked slider labels dim less than the old blanket rule (only the value + input dim) — tune if it reads under-disabled. Original decisions below for reference:
- **M3 lock model (decided with Daniel 2026-07-22):** lock + tooltip is the pattern; **avoid dialogs with "don't show again"** (only where a lock can't express it; the source-swap keep-vs-fresh choice is the one genuine dialog). Lock state is **session-ephemeral** (defaults locked every session; "don't show again" decisions, where any exist, persist across sessions but the lock/unlock still resets). **Lock and "exclude from autoplay" are SEPARATE toggles on a control** (not one icon doing both — that's an anti-pattern): "exclude from autoplay" defaults ON, switchable to include. Default-locked set = segment count + Droste center offset (offset also always the fat-finger case). Forms: explore a **lock icon overlaid on the form-picker buttons** with a warning shown on unlock. Non-menu handles (center offset) get their lock/unlock in the relevant settings menu even though the handle stays canvas-only. Sequencing: tighten wedge targets first (B409), re-evaluate on device, then add only the locks still needed.
- **Perform crossfade on disruptive change (follow-up, Daniel leans include):** when segment count / spiral / form changes live, a freeze-and-dissolve (snapshot current output → apply change → crossfade to the live new render, reusing staging-crossfade machinery) instead of a hard snap. Not a guardrail; re-evaluate after locks land. Caveat: for a hard structural jump a clean snap sometimes reads better than a dissolve — wants Daniel's eye on real footage.
- **Global property change after keyframes exist — DECIDED (allow it):** segment change applies to ALL keyframes behind a warning w/ "don't show again"; form-type change during motion also allowed with a DESTRUCTIVE warning (default CTA = cancel). [relates to cross-form transitions]
- **Onion skinning** (consider, beyond the current ghost).
- **Auto-keyframe on drag:** if you drag the slice without a keyframe during playback, auto-save an anchored keyframe, or require the explicit add?

### Open animation threads
- ▶ **Bounce PLAYBACK mode in motion** (DIRECTED) — drop a linear clip, trim, play BOUNCE with keyframes. Playback becomes loop / bounce / once (the ⋯ loop toggle grows a third option; distinct from the clip-bake bounce — this is playback-time ping-pong, no re-encode). Time runs 0→1→0; video seeks mirror. Check the loop-fork (kf0 return) at the ends. **Needed in BOTH perform and non-looped motion** (see mode-guardrails).
- **Stage-changes open tails** (core shipped B273–B276): two-decoder drift on very long synced staging (add a periodic nudge only if reported); slider write-through dots the marker only on next render; **edit-during-staged-playback** = autoplay's per-field ownership pattern (design once, shared with the perform-from-a-looping-motion hybrid).
- **Per-keyframe ease handles** for deliberate holds/finer control.
- **Per-segment rotation winding (+N turns)** — explicit per-segment property (default direct/shortest, opt-in "+N turns", plus captured winding), not a global unwrap. The winding data model exists (context-menu affordance away).
- **+gesture retro-capture** (DIRECTED, after stage changes) — make the gesture FIRST, then tap G to record what you just did (no arming). Real work is RESET HYGIENE: the accumulator resets on every non-manual state write + re-bases after ~800ms stillness.
- **Cross-form keyframe transitions** — a keyframe captured under a non-kf0 form; no elegant way yet to author a form/segment change across the loop [relates to discrete crossfade].
- **Spiral discrete-edit propagation gap** — `env.commitDiscreteToKeyframes()` (B428) is wired into the oob/segments/mirror/wedge control handlers so a discrete edit reaches every keyframe (else the kf0-hold reverts it on playback). The **spiral** slider rides the generic `wireSliderWithScrub` path, which doesn't call it — so editing spiral while the playhead is between keyframes can still revert on playback. Wire the commit into the generic slider's set for discrete keys (or the spiral onChange).
- **Random / live-wallpaper mode** — generative slow drift on the continuous loop; "animation without authoring", ships on the tween primitive.
- **Discrete transitions via crossfade** (deferred, only if compelling) — form/segments/arms/oob/mirror can't tween but could CROSSFADE (render two states, dissolve); most valuable form→form. Shares render-two-states with PiP.
- **Taubin (shape-preserving) smoothing** (low pri) — smooth jaggedness without shrinking motion amplitude. Current Laplacian feels good; not urgent.
- **Tween-band visible-window refinement** — the band only renders the visible window (gap on pan/zoom until idle). Levers: edge buffer; retain rendered cells + fill gaps; opportunistic off-view render. A footage-frame cache makes it cheap.
- **[TRIAGE — needs repro] Gesture keyframe: editing the final position after save briefly broke playback** (tick-tock instead of full spin). Suspects: finish-flow in-flight commit; write-through autosave colliding with `kf.wind`; spline near a wound segment. Get the exact step order; instrument before fixing.
- **Smoothed translation-PATH capture** (+gesture tail, lower pri) — record the take's spatial path, shape the tween as one smooth arc honoring the destination; pairs with per-keyframe ease.

### Loop Builder (was clip editor)
The full stepped mode shipped + iterated B385–B396 (see CHANGELOG); device/desktop verification is in VERIFY-QUEUE. Remaining forward-facing work:
- ▶ **Spit-and-polish UI refinement** (Daniel's stated next phase) — interaction-feel tuning across the stepped flow, the thumbnail timeline, seam drag, and split reference. **Daniel flagged (B404/B405 review) additional sloppy UI inside the editor to tighten, plus a sweep for stray non-lowercase JS-generated copy** (the HTML copy was lowercased in B405).
- **Tiny-A-segment interaction:** with honest proportions a 90/10 slice makes the right clip only ~10% of the track — grabbable but small. Daniel's zoom idea (focus a ~30s window, 15s either side of the seam) is the fallback if the proportional strip proves too tight.
- **Bounce bake — GOP-reverse buffering** (the deeper speedup). Bounce runs on the WebCodecs reader (forward half fast) but the reverse half re-decodes from the keyframe per frame (O(N²) within a GOP). Fix: when playing a GOP backward, decode it forward ONCE into a bounded buffer and serve in reverse, evicting per GOP. Bounds memory to one GOP; makes reverse ~linear. Lives in `video-decode.js`.
- **Safari crossfade-PREVIEW stall.** Playing through the seam in the in-editor slice preview stalls a moment on Safari — the seek-based two-video handoff (`startSlicePreview`: pause + backward-seek `v` to `inA+cfSec`) hits Safari seek latency. The BAKE is unaffected (WebCodecs). Fix: swap the primary/secondary `<video>` roles at the seam instead of seeking, or drive the preview off the reader. Preview-only, Safari-only.
- **A dedicated perform-mode access point** (the mode menu reaches Loop Builder from anywhere; perform has no overflow menu).
- **Bake tails:** no mid-bake cancel; bounce preview is forward-only; shared-demux memory optimization (two readers fetch the same file twice — see Export lane).

### App-wide mode-transition guardrails + opinionated flows  ·  ⚠️ NO LONGER THE ACTIVE ARC — closed 2026-07-21, plan archived at `archive/plans/we-recently-closed-out-abundant-bubble.md`
Now the SPINE of the active arc — these guardrails plus slice/gesture parameter locks, geometry-truth (honest overlay), Droste infinite zoom, SVG export overlays, and the tile builder. Make moving between Still / Motion / Perform / Loop-builder opinionated + safe (destructive-interrupt pattern as the mechanism):
- **▶ UX-strategy checkpoint FIRST (undecided — gates the rest).** How/when do we capture "is this a loop already?" / "loop or bounce playback?" WITHOUT becoming wizard-heavy — infer-and-override vs. one interstitial question vs. skippable step; land a principle. AND decide whether the Loop Builder stays a top-level mode or becomes an interstitial/modal contextual surface (Daniel's lean), for consistency with the tile-builder-as-surface direction.
- **Keyframe-shift warning** — SHIPPED B386 (entering Loop Builder with existing keyframes warns). Extend the pattern to the other transitions.
- **Open-a-motion-file routing** — on opening a motion file, detect whether it's a loop and ask; route to Loop Builder vs plain motion.
- **A simplified NON-LOOP variation of the motion editor** — no split first/last keyframe. Pairs with the routing (looped → loop builder + split-keyframe editor; non-looped → the simplified one).
- **Bounce PLAYBACK mode** — see Open animation threads (needed in both perform + non-looped motion). Non-loop clips default to bounce in perform (user-overridable).
- **Sensible defaults pass** — motion content defaults to a 16:9 canvas (only if the user hasn't explicitly chosen an aspect); apply other low-complexity defaults as discovered.
- **[LOW · polish, PARTIALLY fixed] Motion 16:9 shows square-first on first entry.** B409 hid the preview across the reshape (killed the harsh *flicker*), but a brief square-then-16:9 remains on the FIRST motion entry (default `frameAspect` is 1/square → 16:9). Diagnostic (B411) confirmed the hide path runs (`willChange=true`), and B410 renders 16:9 synchronously before revealing, yet the square still shows — so hiding `.preview-canvas` isn't masking whatever's square, and the code path reads as correct on paper (hide selector matches, engine renders straight to previewCanvas at 16:9, outputAspect follows canvas dims). Needs hands-on element inspection (is the square the canvas box, a container, or letterboxed content at reveal?) rather than more blind reasoning. Deferred to keep arc focus. The `body.motion-aspect-settling` hide stays (it reduced the flicker). Daniel's original ask: first motion frame should already be 16:9 landscape.

### Conduit vNext — capture-domain detection (DEFERRED by decision)
Until a camera-consuming conduit app exists (zoetrope/tap/visualizers don't take camera input). Full scope in [archive/CONDUIT-TIER-C.md](archive/CONDUIT-TIER-C.md) "vNext" + [archive/CONDUIT-ROADMAP.md](archive/CONDUIT-ROADMAP.md). A sibling package (the input/capture side) lifted from `native-camera.js` + `FoldNativeCameraPlugin.swift` + `yuv-renderer.js`: per-device camera capability catalog, pipeline-safe fps governor, still-vs-video format selection, YUV frame-socket ingest. Named + scoped when the first camera-consumer is real.

---

## Export & rendering hardening  ·  parallel lane (lower priority)

(Firefox export stutter [HIGH] is in the triage. Secondary to the perform arc; pick up on a real export wall or a change-of-pace. **Frame interpolation is the one net-new creative capability** — jumps up if live slow-mo matters during perform.)

- **Frame interpolation — wanted sooner (Daniel confirmed); now COUPLED to the Loop Builder output-format speed control (SHIPPED B394).** The bake speed control (100/50/25%) works cleanly when the source fps has headroom (120fps → 25% is smooth) but on a 30fps source, 25% is currently **totally unusable** and 50% is choppy — each source frame repeats. Interpolation (blend first, optical-flow later) is what would make sub-source-fps slomo *workable for some content*. **When this lands it must plug into the Loop Builder bake** (`clip-editor.js` bakeAndApply — the `durationMs /= speed` path): interpolate the in-between frames the speed control currently duplicates, and drive it from the same `env.clip.fmt.speed` / source-fps relationship. Also relevant to any future motion-render slomo. Cheap interim already partly done: the format spec shows the effective loop; a sub-15-effective-fps warning is still worth adding.
- **Long-render MEMORY → OPFS streaming + worker.** `fastStart:'in-memory'` accumulates all chunks until finalize; long/high-res risks OOM. Move encode+mux to a Worker writing OPFS (`createSyncAccessHandle`), stream to disk, abort = terminate + delete. Required before 10-min 4K is safe. **Also covers the live record-to-disk sink.**
- **Variable framerate / non-30fps source hardening** (higher-risk, deferred). 60fps showed slower scrub + an out-of-sync trim keyframe. Estimate source fps (rVFC delta), robust exact-frame seeking at higher rates, footage-frame cache. Low urgency while 30fps is baseline.
- **Unreasonable-render detection.** A 16:9 6K@30 from a 130MB JPG stalls indefinitely. Warn/guard when frames × output-pixels is extreme, before starting. Tie to abort robustness (X can't interrupt a single stuck frame).
- **Huge-source keyframe slowness.** Saving keyframes on a 130MB source lags (texture upload / per-render sampling); downscaling is the workaround.
- **Shared-demux memory optimization for the clip bake** (filed B384). The slice two-reader fetches the file TWICE (2× compressed in memory). A `video-decode.js` refactor — split `demuxFile(url)→{samples,config}` from `createReader({samples,config})`, keep `createSequentialFrameReader` as a wrapper — halves it. Do it if large-clip bakes OOM; not urgent.
- **Bounce clip-bake render acceleration** (deferred PERF). Bounce's reverse pass is backward; the monotonic-forward reader can't help without extra machinery. Candidates: a bounded ring cache of recently-decoded frames, or decode the forward pass once to OPFS and read backward. Pure speedup, no correctness stake. Only if bounce bakes feel slow.
- **iPhone-`.mov` color/rotation pass (Gecko-specific).** (a) Washed-out OUTPUT color on Safari + Firefox — WebGL texture colorspace/range in the video upload (`UNPACK_COLORSPACE_CONVERSION_WEBGL` / limited-vs-full-range / HDR). (b) Firefox 90° CCW rotation on all video loads + aspect squish on iPhone clips — read rotation metadata + normalize. Brave + Safari reference-correct. (Includes the Firefox export-stutter triage item.)
- **Firefox cold-start scrub/playback lag** (deferred, self-clears). Levers: warm the decoder on load; small decoded-frame cache; rVFC readiness gate.
- **Render throughput ceiling = the native wrapper.** Export is single-thread CPU/color-bound, scales with output pixels; Safari ~render-bound via WebGL-direct VideoFrame (~130fps@4K), Brave/Firefox on the 2D path. **Chromium export remains UNTESTED.** True multi-core/hardware encode = native.
- **WebGPU rendering port** (large, shared across apps) — raises texture-size caps (incl. the Firefox 8K still-export cap), enables tiled >hardware-max, helps the realtime/Syphon endgame.
- **6K/8K video — remainder is non-HEVC browsers.** >4K routes through HEVC (hardware on Apple Silicon via Safari); Firefox/Chrome lack HEVC encode. Future: AV1 encode (slow), WebCodecs demuxer/tiled path, or WebGPU.
- **ProRes limitation (browser).** `<video>` decodes ProRes only on Safari; WebCodecs can't broadly. (Desktop app solved via B378 avconvert transcode; browser path unchanged.) Options if it blocks in-browser: require Safari, document transcode-first, or native.
- **AV1 encode; audio passthrough** (v1 is muted).
- **PWA stale cache.** An installed iPad PWA served an old build from its cached SW. Verify prompt SW updates / versioned precache.

---

## Design system & UI Lab

Design-system layer (tokens → components → compositions → interaction patterns) + the UI Lab (the fragmentation detector for all three surfaces). NOT React/Plasmic — plain Vite + vanilla JS + GLSL. Running app + design system are the source of truth, not Figma.

- ▶ **Button-emphasis disambiguation.** SIX "emphasis/selected" treatments (`.primary` fill + 5 outlined) → the "loop on reads like a primary" ambiguity. Collapse to an unambiguous on/off + primary vocabulary. Context radii drift (4 / 6 / 8). Substrate under the perform loop on/off + transport controls.
- **Ingest the Arc 6 settings/inputs surface into the Lab** (audited B290 — gap is real). ~27 new classes (`.set-tabs`, `.in-card`, `.in-map`, `.in-devhead`, `.in-lights`, `.in-kind` chips, `.in-pair`/`.in-qr`) with zero Lab specimens. One focused build: specimens + a stray-literal pass, before the audio adapter + Drawflow rounds build on them.
- **Tokenize spacing.** `--space-*` exists but stylesheets use literal padding/gap/margin (reads 0× in the Lab). Adopt per-surface (leave layout-coupled values literal). **Reduce the sprawl toward a smaller intentional set; base-8 is ONE experiment to try on the app bar with open hands, not a commitment.**
- **Systematic tooltips** — across controls, describing each + shortcuts. Decide native `title=` vs a styled token-driven tooltip first.
- **Systematic destructive interrupts (interaction pattern).** One shared confirm treatment wherever data would be lost (form change after motion edits, leaving Loop Builder unsaved, all-keyframes property changes), with "don't show again" where appropriate. Replaces the interim `window.confirm`s.
- **Touch-target scaling for hybrid/large-panel contexts** (Movink ~7" — scale with panel size). The interaction-patterns/control-states layer. (The actual Movink fix.)
- **The deferred app-bar IxD batch** is the natural FIRST composition to migrate once we lean on the system (hardcoded CSS would be throwaway).

### Cleanup punch-list (none blocking; tackle with the surface they live on)
- **Cursors / affordances.** Lost Droste rotation grippy + crosshair-vs-dot for the offset; the min-wedge ~20px clamp where the affordance UI breaks.
- **Text.** Migrate ~25 sprawled text rules onto the named `.t-*` set (parity step).
- **Empty / similar states.** 3+ empty messages with different wording/color/size → unify; other reused states inconsistent desktop↔mobile.
- **Modals.** desktop↔mobile divergence (radius 10 vs 16, backdrop, shadow) → one treatment.
- **Radii.** off-grid 1/3/6/10 → fewer, per-surface.
- **Assets (remaining).** Daniel drops the real favicon + Apple app-icon (homes wired in the Lab).
- **Keyframe pin (open Daniel input).** Reads as a triangular notch; lean to FILL the notch on all keyframes + a different mark for locked.
- **Mobile `target` icon** (settings ↔ source) — unintuitive; needs a better concept.

**Affordance SVG workflow (durable):** Daniel authors his own SVGs; we integrate. When he hands one over, **clarify the mode** (redraw in our style vs integrate as-authored) — don't assume. Don't proactively rewrite the procedural-canvas→SVG affordance generation.

### Global control-area follow-ups
- **Controls default to DROPDOWN MENUS** (direction, DEFERRED — don't block the core sequence). Output/broadcast clusters → dropdowns not expand bands; the `#outputRow`/`#canvasRow` bands get superseded when their surfaces are next touched.
- **Source info shown in too many places.** Filename+resolution appear top-left AND under the source panel — keep only the source panel's; add DURATION for motion data. Same in the output band (resolution shows twice — mostly fixed B353; verify).
- **Canvas controls → a dropdown over the output** (mobile still pending; desktop relocated into `#canvasRow`).
- **Source/output swap control relocation** — move next to the divider (icon button over the source image).
- **Responsive + icon overflow pass** — icon+text → icon-only → "…" overflow when compact, for the output row + global bar.
- **iPad-landscape 34px-hack bugs (2, tackle together at the device):** ~30px unwanted top margin on the global app bar, and the right-panel extra top space — both the `@media (coarse, landscape)` 34px hack misfiring. Needs on-device tuning.
- **Broader aspect ratios / canvas reset** — mostly SHIPPED (B245/B246); any remaining per-surface polish.

---

## Engine, forms & tile-aware

### New forms (each = one file in `src/engine/forms/` + a registry line)
- **"None" / passthrough form** (Daniel sees real value) — source straight through (zoom/rotation/aspect still apply), or a simple mirror. Cheap; useful as a broadcast-the-source mode + debugging reference.
- **Hyperbolic Escher (circle limit).** Poincaré-disk tessellation. Heavy: custom overlay (disk boundary + warped triangle) + Schläfli selector. Reuses Droste's overlay/classifyPointer hooks. Distinctive; strong differentiation.
- **p31m wallpaper.** Alternate triangular tiling (mirror axes through vertices not edges). The only remaining wallpaper group adding distinct seam-compliant vocabulary. Lower priority.
- **Radial polygon-frame variation** (low pri) — optional n-sided polygon outer boundary on radial (even sides matching segments). May emerge from tile-aware work; not a separate form.

**Constraint for all new forms:** no visible seams (pinwheel/glide-reflection/rectangular-mirror groups excluded). Fill `tilesPerDim(state)` for an accurate resolution hint.

### Droste math directions (pair with Motion mode)
- **Infinite zoom (seamless loop) — ✅ SHIPPED B433 (desktop still-mode slider).** Looping `infiniteZoom` slider (canvas settings, replaces composition zoom in droste) drives `drosteZoomPhase ∈ [0,1)` → `u_drosteZoomShift` → `logr += shift` in `foldDroste`. Scale-periodic fold + the existing `mod` = seamless wrap. Preconditions baked in: **offset centered** (Möbius not scale-invariant — default-locked) + **spiral = 0** for a pure zoom (spiral keeps radial shift exact via `c.real=1` but adds a residual source rotation per loop = `spiral·logS²/(2π)` — a seamless spiral zoom must couple canvasRotation; documented at the uniform, NOT wired, needs on-device sign check); MIRROR tiers double the period (×zoom²). **B432's `kit/droste-zoom.js` primitive subsumed → deleted** (impl landed shader-side; engine can't import kit). Shares the snap-point idea with tile snap-to-zoom. **Follow-ups (filed under repeating-movements ① below):** pinch gesture + mobile parity (B434); smooth motion-tween + autoplay-wander of the phase.
- **Unlockable "repeating movements" — GREENLIT PLAN (Daniel, 2026-07-25).** The lock unblocks a class of default-locked live-driveable motions. Model Daniel set: **manual controls in canvas settings + matching canvas gestures**; autoplay / direction-lock / recenter are *fractional polish on top of a working core loop*, not core. Priority order + status:
  - **① Droste infinite zoom — ✅ COMPLETE B433→B435** (looping slider + pinch + perform easing + reset + mobile slider + iPad touch + **autoplay**; direction corrected). Phase stored UNWRAPPED, shader wraps it. Full coverage: desktop web / iPad Cap / Electron / iPhone. **Remaining (minor/tuning):** (a) autoplay variety-subsetting can pause the zoom periodically — one-line exclusion from the subset if Daniel wants it always-moving during autoplay. (b) an "exclude infinite-zoom from autoplay" toggle (it's default-included now; the `autoplayInclude`/exclude UI is the "autoplay controls" polish). (c) desktop-Safari GestureEvents pinch path — confirm it routes to phase. (d) ✅ the wrapped-phase-blips-the-follower risk is RESOLVED B460: the perform follower now treats `drosteZoomPhase` as cyclic (period 1) and unwraps it directionally, so a wrapped [0,1) phase from remote/MIDI/mobile no longer eases backward across the seam. (e) if direction still reads inverted on device, one-char flip in `foldDroste`.
  - **② Tiling canvas translation — 🚧 RECTANGLE + JOYSTICK SHIPPED B436 (desktop); B437 extends.** Foundation done: form-agnostic `canvasOffsetX/Y` (unwrapped) + `u_canvasOffset` + `p -= u_canvasOffset` in main (wrapped in-uniform by the form's `latticePeriod`); `square.latticePeriod=[2√aspect,2/√aspect]` (declared on the form → toward M4). **Velocity joystick** (`pan-joystick.js`): push-to-pan/spring-back, position dot (pacman), recenter; gated to tileable forms. Wired to tween/follow (perform easing + motion); excluded from autoplay for now. **B437 SHIPPED:** X-direction fix; dot-in-canvas-rectangle fix; canvas PAN GESTURE (one-finger output drag, shared `output-gestures.js`, gated by `ctx.panPeriod()`); hex+triangle `latticePeriod` (now pan). **STILL OPEN:** (a) **B438 mobile-chrome settings joystick** (mobile pans via gesture now, but no jog-pad control yet; port `createPanJoystick` into mobile canvas settings + `applyFormVisibility` gate — it's pointer-based + touch-action:none so should carry). (b) **"continue motion on release" — ✅ SHIPPED B438** as the LATCHING handle (Daniel chose the handle-stays pattern over a toggle): release leaves the handle put + drift continues; drag-to-center/recenter stops; `.drifting` glow. Watch item: every-release-latches may feel twitchy — pivot to a hybrid (spring-back below a small deflection threshold; latch above) if so. (c) **pan-autoplay** (directional walker like the zoom) if wanted. (d) promote `HEX_SIZE`/`TRI_SIZE` to uniforms when M6 makes tile size adjustable (then `latticePeriod` reads the uniform instead of the hardcoded 0.6). (e) **✅ B442** — pan moved to a **TWO-finger** gesture (centroid travel) composing with pinch→zoom + twist→rotation in one manipulation; **ROTATION-COMPENSATED** (`toOffsetDelta`) so content follows the finger at any canvas rotation (was a 90° axis remap when rotated — offset lives in the shader's post-rotation space; only correct at 0° before, which is why desktop looked fine); flick-to-drift on the two-finger release; one finger reserved. **B443** corrected the direction (was inverted after B442): the transform (`panToOffset` = `δO=−A·M·f`) folds in the Y-flip (`v_uv` p.y-up vs client-y-down), the `u_canvasOffset` X-negation (axis reflection), AND the rotation; touch feeds finger delta, wheel feeds negated scroll delta (unchanged at 0°). Resolves the "residual X/Y sign flip on device."
  - **④ Single-finger rotate gesture — DEFERRED (Daniel, 2026-07-25).** One finger is now reserved on the output canvas (B442 moved pan/zoom/rotate to two-finger). Wanted: single-finger drag → `canvasRotation` (the "rotate without the full pinch gesture" Daniel described). Must coexist with the segment-overlay drags, which also consume single touch — needs a hit-zone/arbitration decision (e.g. rotate only outside the overlay's grab bands, or an explicit mode). Its own small pass.
  - **③ Offset + radial translation via the SAME joystick — 🚧 DESKTOP SHIPPED B445 (fixed B446).** Reuse ②'s velocity joystick (now `rowId`/`label`/`locked`-parameterized) for two non-looping cases: **radial** ungates the existing canvasOffset joystick (translates the center, `periodOf`→null); **droste** gets a 2nd instance driving `drosteOffsetX/Y` (the Möbius center), mounted in the `#drosteOffsetLabel` row, DISABLED unless `manual` is on (the same unlock that gates the diamond drag — keeps the offset centered by default, which seamless infinite zoom depends on) or while an animation drives state. Both respect the motion edit-lock via `locked()`. **B446:** the pan row self-gates in its `syncAll` (`visibleWhen`) — it's a dynamic row mounted after the init `applyFormControls`, so gating there no-op'd on the default form (radial never showed); droste-offset joystick gain cut to `speed: 0.32` (~1/5) since the Möbius center is far touchier. **STILL OPEN:** (a) **mobile droste-offset joystick — ✅ SHIPPED B449** (`mountDrosteOffsetControl` in slice settings + a session-based `manual` toggle; gated to droste). (b) radial-center via `canvasOffset` translates the whole plane; if Daniel wants "move the sampling center on the source" instead, that's a different mapping — get on-device read. (c) position DOT is centered (no feedback) in the non-looping case — could show absolute offset clamped. (d) NOT wired to a gesture yet (joystick + diamond only). (e) **PLACEMENT INCONSISTENCY (possible UX follow-up):** the canvas-pan joystick (tiling + radial) lives in CANVAS settings; the droste center-offset joystick lives in SLICE/form settings (it's a form param). Both are "translate the composition" but sit under different gears — a plausible source of "I can't find the radial control." Decide whether to co-locate. The radial-wedge "no translational symmetry → non-looping" caveat stands; a looping offset would need the per-tier rigid-translation "tunnel" model (below).
  - **Pan fat-finger lock on perform entry — UX REFINEMENT, PARKED (Daniel, 2026-07-25). SKIP unless real use surfaces a problem.** Proposed policy: all panning stays UNLOCKED in still + motion; entering PERFORM, droste + radial switch to locking their pan/offset controls by default (mirrors how segment count is unlocked everywhere until perform). Daniel's own counter, and the reason it's parked: the pan inputs are already discrete + deliberate (two-finger gesture + explicit menu joystick), so false-positive fat-fingers are unlikely — not worth adding lock friction pre-emptively. Principle to reuse if revisited: lock what's consequential-and-hard-to-undo, leave what loops-and-recenters free. Revisit only if accidental pans bite during live use.
- **True vanishing-point offset (per-tier rigid translation)** — replace the Möbius pre-composition (which introduces in-tier stretch) with per-tier rigid translation (`c_k = offset·(1 − 1/zoom^k)`). Daniel's model: moving the vanishing point should feel like a TUNNEL, not rotating a sphere.
- **Dimensional rotation / volumetric tilt** — each tier projected at a different angle (tube off-axis). Per-tier perspective; more complex.
- **"True rotation" / pole rotation** (lower pri) — post-composition Möbius; strong motion pairing (flowing-water effect).
- **Offset affordance** — a toggle for what the center offset does + whether it's locked; a crosshair instead of the dot.

### Per-form behavior + defaults
- **Overlay density-LOD — SHIPPED B463** (reflected copies fade in `drawSourceOverlay` as `coverage` = the sampled polygon's UV bbox span grows past `REFLECT_FADE_START`/`END` = 1.6/4.0; primary outline + seam never fade; self-targets radial/large-slice, tiling never fades, droste untouched). **Tails:** (a) `REFLECT_FADE_START/END` on-device tuning with Daniel; (b) droste's bespoke overlay was left out (its annulus doesn't scale with the infinite-zoom, so it's not the zoom-out-crazy case) — add a parallel fade only if its reflections ever read busy in practice.
- **✅ Zoom overflow bounds are now PER-FORM — MECHANISM SHIPPED B511** (`zoomCover` / `zoomInFloor` on the form, via `formZoomBounds()`; the old flat 3 / 0.7 remain the fallback so it shipped behavior-neutral). **VALUES pending Daniel's `?tune=forms` pass** — that pass is the last step of form slice hardening.
- **✅ Per-form perceived scale normalization — SHIPPED B477 (mechanism; values pending Daniel's tuning).** Each form has a `sizeNorm` multiplier (via `formSizeNorm()`, applied at shader u_sliceFactor + overlay geometry + sharpness hint) so `sliceScale=1.0` is perceptually comparable. Anchor radial=rectangle=droste=1.0; hex/triangle=1.6 FIRST-PASS. **Tail:** Daniel tunes the hex/triangle multipliers against the reference; then this closes. **B511 gives him the tool** — `?tune=forms` dials this live and emits a paste-ready block. (Related: the per-form `Z_SLICE_COVER` calibration above can reuse the same `sizeNorm` seam.)
- **Droste seam divider line** (Daniel) — at arms=1 there's no rotation tell on desktop; draw a divider where the segment meets itself (also a draggable segment-count affordance, the radial-spoke-drag equivalent).
- **Minimum wedge sample size** — clamp to ~20×20px per form (currently shrinks to ~1px where the affordance UI breaks).
- **Slice params across form switches** — `sliceScale/Cx/Cy/rotation` are global so they persist (a large radial scale makes droste oversized). Decide: keep shared, per-form, or reset-on-switch. Likely a soft default + easy reset. **Re-ask this AFTER the per-form norms are dialed** — normalization is exactly what makes cross-form persistence tolerable, so the answer may change.
- **[SMALL — open question from B508/B509] Should LOCKING pan also RECENTRE?** The center lock releases translation but does not move the offset back, so unlock → pan → re-lock leaves a stored offset that the shader ignores while locked and restores when unlocked. That is deliberate (non-destructive, undo-friendly), but "center lock" arguably implies recentering on lock. The joystick already has a recenter action. Daniel's call; wants his eyes on device before changing.
- **Global reset-to-defaults** — if a "reset everything" workflow emerges (form/slice/zoom/rotation/OOB → defaults, keep the source).

### Future surfaces — PERF PRE-ASSESSMENT (Daniel, 2026-08-05)
Three conceptual directions Daniel asked to be able to weigh on cost before committing. Assessed against the frame-cost audit (`~/.claude/plans/thermal-and-frame-cost-audit.md`); each one also sharpened a Phase A design requirement, noted inline.

- **USER-LOADABLE SHADERS (line art, stipple, etc.).** Cheapest of the three IF scoped to stills first, and that scoping is the whole recommendation. **A still is a one-shot render with a budget measured in seconds; a video frame has 16ms.** The CNC/laser/etching use case is entirely on the still side, so it can run an arbitrarily expensive shader at export resolution and nobody notices. The video side is the opposite: cost multiplies by every live surface, and these effects are typically NEIGHBORHOOD-SAMPLING (edge detection reads 8+ texels per fragment, dithering may want a noise texture or feedback buffer). Since the pipeline is already texture-bandwidth-bound at 4K, a naive edge-detect can be ruinous live while being free on a still. **User shaders are also UNBOUNDED cost — we cannot predict what someone writes** — so they need a load-time cost probe that classifies the shader (still-only / live-capable / live-capable-at-reduced-res) and says so honestly in the UI. That is goal 4 from the audit in its purest form. **Phase A requirement it produced: work items must NEST (a surface owns passes), and one-shot renders must be budgeted separately from per-frame renders.**
- **THREE.JS TILED GEOMETRY (hex honeycomb on a sphere, camera inside it).** Biggest architectural commitment of the three, and it carries one hard constraint that decides whether it is viable at all: **three.js MUST share the engine's WebGL2 context.** If it gets its own, feeding it our output means a cross-context texture copy, which is precisely the GPU→CPU→GPU readback that cost 162ms/frame at 4K until B504 deleted it. Sharing the context makes our FBO texture directly sampleable at zero copy. With that settled the cost shape is reasonable: our kaleidoscope pass (unchanged) plus a geometry pass over the viewport. Geometry itself is cheap (a sphere is a few thousand triangles); the second full-viewport raster is the real add, so budget roughly 2x. One genuine upside: mapped onto minified geometry the output texture is sampled through lower mip levels, so it may actually cost LESS bandwidth than showing it flat. "Camera inside the sphere" is the demanding variant (immersive wants high, steady framerate). **Also note this would be by far the largest dependency ever added to a deliberately plain Vite + vanilla + GLSL project — it is an architecture decision, not a feature decision.** Still-first is available here too (render a turntable, not a live scene).
- **HYPERBOLIC / ESCHER CIRCLE-LIMIT FORM (see New forms above).** Reassuringly the cheapest, and interesting because it is our first form that is **ALU-bound rather than bandwidth-bound** — the opposite of the current bottleneck, so it uses headroom we are not currently competing for. Caveat specific to mobile: the Poincaré-disk fold is an ITERATED reflection with a variable trip count, and variable-length loops cause thread divergence on tile-based mobile GPUs, which can cost far more than the average iteration count suggests. It is also the **first form whose cost varies with its own parameters** (iterations climb near the disc boundary), where every existing form is constant-cost. Worth an iteration clamp with a quality/perf tradeoff exposed. Cheap to assess once Phase A ships, since form switching is already live.

### Tile-aware features (evolve from research as the gallery concept matures)
- **Snap-to-tile canvas zoom** — natural snap points per form where output = one unit cell (or integer multiple). Revisit the math with a working-repeat screenshot.
- **Tileable cell export** — export one unit cell, crop to the fundamental-domain shape (square/hex/triangle); cells tile seamlessly.
- **Non-square tile output** — export the actual polygon shape (transparent/vector-cropped) for downstream snapping (gallery composition).
- **Snap compositions to the nearest tileable size.**

---

## Sources, input & capability tier

- **Sources universal across modes** (direction). Every source (still/video/live camera) in every mode as far as possible. Still mode on a video = a mini timeline scrubber to pick the frame (no autoplay/transport). Live camera in motion = valid with realtime/staged transitions.
- **Preserve source across a chrome switch / iOS page discard.** The responsive reload carries slice/canvas params but not the source image/camera. Persist the uploaded image (blob → IndexedDB) + re-`setSource` after reload; live camera re-prompts. (Also the native fix for the mobile-save blackout on web.) **Fresh-eyes pass (2026-07-22, Daniel re-raised as a data-loss bug):** root cause is precisely `boot.js` — crossing the 700px breakpoint calls `location.reload()` into the other chrome, and only `{state, session}` serialize to sessionStorage; the source blob is dropped by design (comment at boot.js:32). TWO fix lanes: **(A) carry the source** — stash the uploaded File/Blob in IndexedDB (holds Blobs natively, big quota; sessionStorage can't) before the reload and rehydrate + re-`setSource` on boot (the fix this item already names; camera re-prompts). **(B) don't switch on desktop-narrow** — decouple the two triggers so a FINE-pointer desktop window never swaps to mobile chrome (only genuine coarse-pointer phone-class does); pair with a min-width + horizontal scroll on the desktop layout below ~700px so the source is never lost by a resize. (B) is Daniel's proposed fallback and is far lower-risk; (A) is the complete fix but adds IndexedDB rehydrate machinery. Recommend B now, A if/when we want narrow-desktop to preview mobile chrome without `?chrome=mobile`. **UPDATE 2026-07-22: lane B SHIPPED (B407)** — triggers decoupled + 700px min-width floor, so a narrowed desktop window keeps its source. **Lane A (IndexedDB source-carry) remains open** as the complete fix for when we want narrow-desktop to genuinely become the mobile app (and as the iOS page-discard safety net); this item stays for that.
- **Data-loss warning on SOURCE SWAP + "start fresh" option** (Daniel-raised 2026-07-22). Swapping in a new clip/image while motion has keyframes currently keeps them at their normalized `t` positions (`rebindMotionToSource` re-locks duration + re-renders but never clears `motion.keyframes`) — the mappings survive but are usually meaningless against unrelated footage. Want an interrupt on swap-with-keyframes offering **keep keyframe positions** (current behavior) vs **start fresh** (clear keyframes). Build it as the shared destructive-interrupt / warning-gate pattern (Movement 3), NOT a one-off `window.confirm`. **Decision (Daniel, 2026-07-22): HOLD until M3** — no interim one-off; address it when M3 builds the warning-gate component properly. This is a natural first consumer of that pattern.
- **Export package layers: composition JSON + vector overlay SVG.** Save-menu package checkboxes: composition JSON (recreate the output from the source — the still analogue of motion JSON) + vector overlay SVG (wedge/geometry sized to the SOURCE). Overlay math is in `overlay.js`; the lift is rendering geometry at export res + zip entries. Pairs with tile-aware export. Keep save-composition/save-package language consistent mobile↔desktop.
- **Canvas pan state (`canvasOffset`).** One-finger drag on the mobile OUTPUT is a no-op until a canvas-translate state key + shader uniform exist.
- **Desktop control-widget migration** — desktop keeps hand-authored slider DOM; migrate to the shared `mountRangeControl` (behavior already shared; only markup forked).
- **Proper opening / first-run screen** (mobile + desktop).
- **Audio sync (wishlist)** — load a track, animate playback in time with it.
- **iOS file-picker redundancy** — "choose photo/file" always offers "Take Photo" (redundant); native-wrapper-only to suppress.
- **Shader / generative + other live-source input (explore, DEFERRED).** Beyond camera/video/Syphon-in: accept a live shader or an external live-video feed as the fold source (à la iPhone Continuity Camera as an input). Cross-ref Syphon INPUT (Fold Live) + iPhone-as-capture-device (Native wrapper). Speculative; capture for the input-architecture arc.
- **CoreMediaIO virtual camera — OUTPUT (App Store cross-app route) + the INPUT-routing question (Daniel, 2026-07-30).** Two distinct ideas:
  - **As OUTPUT:** a Mac virtual-camera system extension makes Fold's program appear as a "webcam" to Arena/Zoom/OBS/etc. — sandbox-clean, so it's the robust **App Store** cross-app route (where Syphon is likely blocked; NDI-localhost is the other App-Store option). More work than NDI (a CMIO extension) but the most universal.
  - **As INPUT (routing OTHER apps INTO Fold):** Daniel's painting-app-canvas → Fold / zoetrope → Fold discovery idea. A virtual camera helps only if the *source* app publishes one (few do). Better paths per source: **native Mac app → Fold = Syphon-IN** (already backlogged above); **our own web apps (zoetrope) → Fold = a shared conduit transport** (same-origin BroadcastChannel, or WebRTC/shared-canvas cross-origin, or Syphon when both are Electron) — this is exactly the "build once in conduit, share across consumers" play. Sits alongside the shader/live-source-input exploration; sequence into the input-architecture arc.

---

## Mobile & PWA

- **Mobile landscape — on-device validation + IxD polish.** In-place relayout shipped; pending: Daniel's device validation (camera-survives-rotation, island clearance, divider drag) + IxD polish (vertical tab-bar button sizing, popover anchoring, full-bleed corner-hugging).
- **PWA tab-bar bottom anchoring (iPhone).** In installed standalone the bar floats above the true bottom (corner safe area). Round the hit-targets to follow the corner radius. **Same safe-area investigation as the triage "doubles up" bug.** Also: snap the grippy to dock top/bottom.
- **Mobile undo/redo.** The shared snapshot model makes it available; access gesture TBD (two/three-finger tap?).

---

## Cross-browser & platform

- **Chromium test pass (Chrome/Edge/Brave) — NOT yet done.** Blink is the untested third engine. Scrutinize: readPixels from an FBO (correct AND fast for `exportAt`/diagnostics?); VideoFrame from a WebGL canvas (WebCodecs path + H.264 levels); `gl.finish()`, `preserveDrawingBuffer:true` cost, pointer-event coalescing, `premultipliedAlpha:false` + 2D color management; multi-download vs zip; `dvh`, `accent-color`, the SW.
- **WebGL context loss/restore (general).** If a gray screen recurs anywhere, add a `webglcontextlost`/`restored` handler pair on the preview canvas. (Also the fix path for the PWA-save blackout.)

---

## Native wrapper & Syphon (distribution)

> The Capacitor arc delivered its outcome (native iPhone/iPad, native camera, HDMI/AirPlay/NDI on all three shells, conduit extracted). Remaining pending below; device-verify items live in `VERIFY-QUEUE.md`.

### iPhone field pass — the stabilization lane
- ▶ **Record quality + reliability (1080p).** Pixelation/compression artifacts, stop sometimes not stopping after ~2min, save sometimes failing — WebKit-MediaRecorder pathologies; the phone chrome is the LAST MediaRecorder consumer. **Fix = port the conduit WebCodecs recorder into the mobile record path** (explicit bitrate → quality; no captureStream → reliability). Device-paired increment (delicate-path rule).
- **Still capture fidelity** (latency + feedback REWORKED B380–B381). Remaining device-paired: brightness DARKENS on capture; alignment shifts slightly on camera switch (`STABILIZATION_CROP` calibration). Idea: a "3·2·1" countdown before the shot (opt-in — avoids button-press shake).
- **8K still save consistently fails (iPhone).** Likely FBO/memory ceiling (probe passes, real export dies). Fix: a REAL allocation test, or an honest per-device cap (see below).
- **Composition at the selected 4K tier** — the 4K tier applies to the source capture; the composition records at the 1080 upscale target. Honoring 4K = render the output at 2160 short side during the take (an fps tradeoff to measure on-device).
- **🔥🔥 [MEASURED B516 — THE iPHONE WALL IS THE CAMERA TEXTURE UPLOAD, and it is the SAME BUG WE ALREADY FIXED ONCE.]** Daniel's iPhone runs, the single most valuable measurement of the arc:

  | state | source | fps | source `upload` | source `refresh` | output render |
  | --- | --- | --- | --- | --- | --- |
  | still camera, idle | 768×1024 (0.79MP) | 60 | **5.43ms** | 0.22ms | 0.50ms |
  | recording, fresh | 1080×1920 (2.07MP) | 16.1 | **13.47ms** | 0.47ms | 1.18ms |
  | recording, ~5min | same | 12.2 | **18.69ms** | 1.15ms | 2.15ms |
  | recording, ~13min | same | 11.3 | **19.42ms** | 1.17ms | 1.83ms |

  - **The upload is ~6.7ms PER SOURCE MEGAPIXEL** (5.43/0.79 = 6.9; 13.47/2.07 = 6.5). Dead linear, ~150MB/s. **That is the exact signature of a CPU round trip** — the same shape as the B504 iPad wall (20ms/MP), which we diagnosed, fixed, and verified. At idle it is already 33% of a 60fps frame budget; it is 10x the cost of rendering the kaleidoscope itself.
  - **THE CAUSE IS ALMOST CERTAINLY THE FRONT-CAMERA MIRROR CANVAS.** `camera.js frameSource()` returns `mirrorCanvas` when facing is `user` and the raw `<video>` otherwise. Uploading from a `<video>` is a fast hardware path; uploading from a 2D CANVAS makes WebKit round-trip through main memory. Note `refresh` (the mirror draw itself) is only 0.22ms — the canvas is cheap to DRAW and ruinous to UPLOAD FROM. **Compare desktop: a 4K (8.29MP) `<video>` upload costs 0.06ms on Chromium. That is ~400x cheaper per pixel than iPhone's 2MP canvas upload.**
  - **✅ SETTLED B517, FIXED B518 — it was never the mirror canvas, it was the NATIVE CAMERA missing B504's planar path.** The `note` read `from canvas · facing environment · native cam` on BOTH cameras, so `camera.js` was never in play at all: the phone runs `native-camera.js`, which receives YUV planes over its socket, paints them into its own WebGL canvas, and lets the engine `texImage2D` that canvas out of a DIFFERENT GL context — the exact 162ms-at-4K mechanism from the video path, at camera resolutions. Fixed by giving `native-camera.js` a `planeReader()` and wiring `engine.setPlanarSource()` through a single `attachCameraSource()` in the phone chrome. The selfie mirror rides in the frame and the engine's blitter already honored it, so it cost nothing. **Lesson worth keeping: the first hypothesis was plausible, wrong, and untestable with the data we had — the fix was to instrument the PATH, not to argue about the cause.**
  - **[LOW — follow-up after B518 verifies] `refreshFrame()` may now be redundant.** It still paints the RGB canvas each tick for the source panel's display copy (0.15-0.27ms). If the panel does not actually read that canvas on mobile, the paint can go entirely; check before removing, since the display path differs between chromes.
  - **❌ [SUPERSEDED — kept for the record] THE MIRROR-CANVAS HYPOTHESIS WAS NOT CONFIRMED (B517).** Daniel ran front and rear: **5.88ms vs 5.43ms at 0.79MP — the same.** But the report did not record which SOURCE the engine was sampling, so that result is equally consistent with "the mirror canvas is innocent" and with "both runs used the mirror canvas anyway". B517 adds a per-surface `note` reporting the element type, camera facing, planar state and native-vs-getUserMedia; **one more run settles it.** Two readings to plan for: (a) `from canvas` on both → the facing detection is not switching the source and the mirror hypothesis is alive; (b) `from <video>` on rear with the cost unchanged → **`texImage2D` from a `<video>` is itself slow on iOS WebKit**, the mirror canvas is irrelevant, and the fix is the planar/native-camera path (which already exists for video — B504 — and which the camera may not be using) rather than a shader flip.
  - **THE FIX: mirror in the SHADER, upload from the `<video>` element.** A horizontal UV flip costs nothing per fragment and deletes both the canvas and the round trip. **Needs proposing before building** (Daniel's rule): it spans `camera.js` (frameSource stops branching), the engine (a mirror uniform), and the overlay, whose geometry currently assumes the displayed element and the sampled texture share an orientation — that assumption is exactly what a shader-side flip changes, and getting it wrong desyncs the wedge from the render.
  - **✅ THERMAL THROTTLING IS NOW MEASURED, AND THE PRESSURE SIGNAL TRACKS IT.** Over ~13 minutes of recording at a CONSTANT workload the upload went 13.47 → 18.69 → 19.42ms (+44%) and fps 16.1 → 12.2 → 11.3, while pressure read 0 → 0.33 (fair) → 0.46 (serious). The B515 per-workload baseline is doing its job: it stayed quiet through the workload change and only rose as the device genuinely slowed at constant work. **This is the first real validation that the inferred signal works without a native thermal API.**
- **🎯 [MEASURED B514, and it redirects the whole arc] WHERE THE COST ACTUALLY IS: the GPU→CPU READBACK, and essentially nothing else.** Daniel's Electron gauntlet, with real GPU timer queries:

  | scenario | fps | bus readback (cpu) | bus render (gpu) | preview+pip+overlay (gpu) |
  | --- | --- | --- | --- | --- |
  | still, no broadcast | 120 | — | — | ~0 |
  | FHD video, perform, no broadcast | 120 | — | — | 0.32ms |
  | FHD → Syphon | 60 | **5.31ms** | 0.17ms | 0.44ms |
  | FHD → Syphon + record | 60 | **5.24ms** | 0.18ms | 0.59ms |
  | 4K → Syphon | 38.4 | **17.34ms** | 0.56ms | 0.42ms |
  | 4K → Syphon + record | 29 | **21.31ms** | 0.62ms | 0.49ms |

  - **The readback is 30-40x the cost of the render, and ~40x everything the editor draws COMBINED.** Every editor surface we planned to degrade (preview, PiP, overlay) totals under 0.6ms of GPU. Turning all of them off on desktop would buy nothing measurable.
  - **It is bandwidth-bound and linear in pixels:** 8.3MP × 4 bytes / 17.3ms ≈ 1.9GB/s; 2.07MP × 4 / 5.3ms ≈ 1.6GB/s. Same wall, scaled.
  - **⚡ RECORDING COSTS ALMOST NOTHING ON TOP OF BROADCAST** (5.31 → 5.24ms at FHD; the 4K pair differ by the resolution change, not the recorder). Both sinks consume ONE readback. **This is strong desktop evidence for the iPhone record hypothesis: the wall is the readback, not the encoder** — which means capping iPhone record resolution treats the symptom and killing the round trip treats the cause.
  - **🎯 [MEASURED B520 — iPAD'S WALL IS THE EDITOR SURFACES, which vindicates the adaptive-preview proposal FOR MOBILE ONLY.]** 4K clip, 4K HDMI broadcast, iPad: **preview render 13.41ms + PiP 9.0ms = 22.4ms of a 32ms frame.** On desktop the same two surfaces cost 0.5ms combined and cutting them bought 8%; on iPad they are two thirds of the entire budget. So the adaptive-preview-resolution design was not wrong, it was mis-targeted — **it is a MOBILE lever, not a desktop one.** Daniel's ladder is already in hand (100 → 75 → 25, skipping the uncanny middle) and this is the case it was measured for. Also note the earlier iPad ablation is consistent: preview off gained ~9fps while the panel measured it at 0.39ms, the 13x WebKit understatement.
  - **✅ [B520] The poster idle-elision is NOT the iPad regression.** Switching `external: skip identical posts` OFF made it slightly WORSE (28.3 → 26.6fps), so B513 is exonerated and the cause lies elsewhere. Playback also returned on its own in this session (40fps in perform, wire at 30.5 in/s), so the "will not play at all" state is INTERMITTENT rather than permanent — which makes it harder to bisect and worth catching with the wire-rate readout the next time it happens.
  - **⏱️ [B527 FAILED, B528 CHANGES THE LEVER.]** The async GPU-to-GPU bitmap bought 9ms: 52.39 → 43.6ms unmeasured, 17.3 → 19.1fps. **On WebKit, consuming the WebGL canvas as an image source costs ~43ms whatever you consume it into.** The exception that kills the "expensive copy" explanation: `new VideoFrame(outputCanvas)` runs on the same canvas in the same frame for 2.7ms — one image-source path is cheap and the others are not, so it is a specific WebKit path problem.
    - **B528 rate-limits the PiP to 10Hz** and the flag is also the diagnostic: 60fps restored ⇒ per-consume, rate limit is the fix. Barely moving ⇒ a fixed per-frame penalty for having consumed at all, and **the PiP cannot coexist with recording on WebKit at any rate — the arc's first honest "cannot deliver as designed" (goal #1).**
    - Remaining ideas if 10Hz falls short: reuse `VideoFrame(outputCanvas)` (cheap, but no direct way to DISPLAY a VideoFrame without landing back in a 2D canvas); render the PiP as a viewport region inside the main GL canvas (zero-copy and architecturally right, but the output canvas is letterboxed inside its panel so the PiP corner is often outside it); or accept it as necessarily hot and build the opt-in UX (goal #4).
    - **Fixed a B527 regression: the PiP squashed a square output into 2:1.** WebKit does not reliably adopt a transferred bitmap's dimensions as the canvas intrinsic size, and `#m-pip canvas` is `width:100%` with no height. **Universal, not iOS-only.**
  - **🏆 [MEASURED B526, FIXED B527 — THE PiP WAS THE WALL.]** Mid-take A/B on iPhone FHD: PiP on **17.3fps / 58ms frame / 52.39ms unmeasured / pressure critical**; PiP off **60fps / 17ms frame / 10.48ms unmeasured / pressure nominal**. Its own `draw` pass read **0.17ms**. A 238×238 thumbnail was costing 41ms/frame.
    - **Fourth instance of the same GPU→CPU round trip** (B518 camera, B521 broadcast, B525 record). A WebKit 2D canvas is CPU-backed, so `drawImage(webglCanvas)` into one resolves the drawing buffer to the CPU every frame. **The heuristic worth keeping: the cost tracks the SOURCE being read, not the destination being written** — which is why a tiny thumbnail and a 1080² record canvas cost the same, and both scaled with source resolution.
    - **B527 fix:** `createImageBitmap` + `transferFromImageBitmap`, GPU-to-GPU and async; frames drop rather than queue. `draw`/`present` split so the sync issue and the async handoff are separately visible.
    - **The `unmeasured` stat earned its place in one reading.** Healthy: 6.5ms work / 10.5ms unmeasured at 60fps (vsync idle). Unhealthy: 52ms unmeasured on a 58ms frame. Read it first on any slow frame.
    - **▶ NEXT, unmeasured and same pattern: `paintBroadcast` on the phone** does `drawImage` + full-canvas `getImageData` into a 2D canvas every frame for NDI. It genuinely needs CPU pixels, so the fix is the async readback (B519/B521), not a bitmap. Register it as a surface first — it does not run during a record test, which is why it has escaped every reading so far.
  - **🕳️ [MEASURED B526 — THE RECORD PATH IS FIXED AND THE FRAME DID NOT GET FASTER.]** iPhone FHD recording: `blit` **40.7 → 0ms**, `encode` **2.74ms**, fps 19.4 → 22.4. 4K: `blit` 92.57 → 0, `encode` 4.6ms, fps 9.8. **The GPU→CPU round trip is out of the record path and the encoder is definitively exonerated at 2.74ms.** But FHD frame time is still 44ms against **3.82ms of total registered surface cost**, and 4K is 102ms against 16.7ms. ~40ms and ~85ms are unregistered.
    - **The ledger now reports `unaccountedMs` (`unmeasured` in the panel).** The general lesson: an instrument that reports only what it was pointed at always reads clean. Amber/red only when the frame is also missing its target, since idle on a 30fps-capped source belongs in that gap.
    - **▶ PRIME SUSPECT: `paintPip`, never registered, `drawImage(outputCanvas, …)` every frame in video mode.** Same implicit GL sync the record blit had. Deleting one sync hands it to the next consumer of the GL canvas. Registered in B526 at EDITOR priority with a switch — toggling it off mid-take is the direct A/B.
    - **If the PiP is NOT it,** the gap is genuine GPU render time or compositing, and that is the first thing this arc has hit that the ledger cannot name from inside the page. Next tool would be a Safari Web Inspector / Instruments GPU capture, not more `performance.now()`. Worth noting the shape that would suggest: at FHD the output render is 1.17MP and 0.78ms of CPU submit, so 40ms of GPU for that is implausible on this hardware — which is itself an argument for the sync hypothesis over the GPU-bound one.
  - **✅ [SHIPPED B525, WORKED.]** The blit is deleted: on the WebCodecs path the take is `new VideoFrame(outputCanvas)` and the 2D canvas is released the moment the sink starts. Behind `record: encode the GL canvas`, and the surface note distinguishes `webcodecs · direct` from `webcodecs · via blit` so a near-zero `blit` cannot be confused with a skipped one.
    - **▶ WHAT TO READ, and it is `encode`, not `blit`.** `blit` collapsing toward zero only proves the copy is gone. **The real question is where the 40ms went.** If `encode` jumps from ~3ms to ~40ms, then `VideoFrame(GL canvas)` is itself a hidden readback on WebKit, the sync merely MOVED, and the next lever is the encoder's input format (a planar/pixel-buffer path, the mirror of what B518 did for the camera). If `encode` stays near 3ms, the round trip is genuinely gone and we are finally measuring the hardware encoder — which is where the 4K/60 and FHD/120 question gets a real answer.
    - Also watch the 4K symptoms Daniel reported separately (unresponsive triple-tap, a finalize that outlasted the take): releasing the ~33MB scratch canvas may or may not have touched those, and if they persist they are a queue/memory problem rather than a throughput one.
  - **❌ [B524 DID NOT FIX IT — MEASURED B525. The `getImageData` was NOT the cost.]** With the forced flush removed on WebKit, `blit` is **still 40.7ms** at FHD (was 39.29) and **92.57ms** with a 4K source (was 58). The one-pixel read was never the expensive part.
    - **The remaining cost is `ctx.drawImage(outputCanvas, …)` ITSELF.** Drawing FROM a WebGL canvas INTO a 2D canvas requires the GL commands to have completed, so the call carries its own implicit synchronization — removing the explicit one changed nothing. Same conclusion as before, one layer down. Note again it scales with SOURCE size while the record canvas stays 1080²: it is waiting on the render, not moving more bytes.
    - **▶ THE FIX, fully specified: delete the intermediate 2D canvas and hand WebCodecs the GL canvas directly.** `recordCanvas.width = outputCanvas.width` (chrome.js ~1070) and `recordUpscale` makes `sizeOutput` render the output canvas AT record resolution while a take rolls — **so the record canvas is a same-size copy of a canvas we already have, and the whole blit is pure overhead.** `new VideoFrame(outputCanvas)` snapshots at construction, which also solves the frame-ORDERING problem the removed guard existed for, with no synchronization at all.
    - **Corroboration this is the right path:** `kit/capabilities.js` already resolves `capturePath: 'gl'` for WebKit — meaning "wrap the WebGL canvas directly in a VideoFrame" — and the video-EXPORT path has used it for a long time. The mobile RECORD path simply never adopted it.
    - **Risk to handle:** older iOS hung building a `VideoFrame` from a WebGL canvas (the folklore behind `?capture=2d|bitmap|gl`), so this wants the same probe-and-fall-back treatment the bus capture has, plus a flag. Also verify a take's frames are correct, since the ordering guarantee moves from the flush to `VideoFrame`'s snapshot semantics.
  - **✅ [FIXED B524 — but see above; it did not move the number] The forced rasterization is now Blink-only** — Daniel verified a WebKit take recorded without it plays back clean. Also applied to `paintPip`, which carried the same guard on a per-frame path. **Re-measure iPhone FHD recording: expected ~40fps against the 20 it sat at.** The switch remains for the timing-dependent case; a single clean take does not prove deferral never happens on WebKit under different load.
  - **📌 [RE-READ THESE IN LIGHT OF B522] The iPhone field-pass record failures below ("4K take fails on iPhone 17 Pro", "60fps short clip times out", "runs hot while recording") were all attributed to the WebCodecs encoder + readback pipeline and answered with "cap the resolution".** The measurement says the encoder costs 3-4.5ms while the sync cost 39-58ms. **Those entries need re-testing before any capability tier is designed from them** — a tier built on the pre-B524 numbers would cap devices that can now do considerably more.
  - **🎯 [MEASURED B522 — THE iPHONE RECORDING CEILING IS A ONE-PIXEL READ.]** `blit` **39.29ms** vs `encode` **3.19ms** at FHD; **58.00ms** vs 4.50ms with a 4K source. Twelve to one. **The encoder was never the problem, so every earlier plan to cap iPhone record resolution was treating a symptom** (see the iPhone field-pass entries below — the "4K take fails / 60fps times out" cluster should be re-read in this light). The cost is `ctx.getImageData(0, 0, 1, 1)` in `paintRecord`, placed there only to force the deferred 2D canvas to rasterize in order. **Proof it is a STALL and not a copy: the record canvas is 1080×1080 in both rows, yet the blit nearly doubles when the SOURCE goes 4K — it is waiting for a slower render to finish, not moving more bytes.** Same signature as the desktop bus before B521. B523 puts it behind `record: force sync rasterize` so we can find out whether WebKit needs the guard at all (the deferral it defends against is a Chromium behavior). **The test is whether the TAKE is correct, not the fps.** If correct: make the flush Chromium-only, recover ~39ms/frame. If not: build a `VideoFrame` straight off the GL canvas, which fixes the ordering without leaving the GPU.
  - **🏆 [MEASURED B521 — THE ARC'S BIGGEST WIN] Pipelined readback: 4K Syphon readback 19.48ms → 0.87ms (22x), fps 33.7 → 85.3.** Bus note confirms `capture: async`. **This retires the "the copy is the floor" theory outright** — the cost was the STALL, not the transfer: once the fence has signalled, `getBufferSubData` is nearly free because the DMA already happened in the background. Also retires the capability claim built on it: **4K Syphon at 60fps IS reachable in Electron**, comfortably. Every remaining editor surface is now noise by comparison (preview 0.37ms gpu, PiP 0.30ms). Frame-time p95 (17.2ms) runs above p50 (8.4ms), so there is some jitter left to look at if 85fps ever needs to be 120.
  - **❌ [B520 → FIXED B521] Pipelined readback NEVER RAN — B519's "21.3 → 19.1ms" was variance.** The bus note read `capture: videoframe`: the path lost the probe. Cause: the probe's validation busy-waited on `clientWaitSync`, and in Chromium the GL context is in another process whose fence signal reaches the renderer via its event loop, so a loop that never yields cannot observe it. Fixed by yielding between polls (safe because the caller awaits and `preserveDrawingBuffer` is on). The mode string now carries the REASON when async is not in use. **So the pipelining question is still open and unmeasured — do not treat 19ms as a floor until a run reports `capture: async`.**
  - **⚠️ [B519 RESULT — SUPERSEDED BY THE ABOVE; the reasoning is kept because it may still be right] Pipelined readback appeared to buy ~10%.** Desktop 4K: readback **21.3ms → 19.1ms**, fps 29 → 34.7. Real, but far short of "toward 60". **The likely explanation is that the cost was never the WAIT, it was the COPY:** 8.29MP × 4 bytes = 33MB at ~1.7GB/s ≈ 19ms, which matches almost exactly. Pipelining removes a stall; it cannot remove a copy, and `getBufferSubData` still performs the full GPU→CPU transfer on the calling thread. **B520 adds the capture mode to the bus row because this reading is uninterpretable without it** — if the mode says `readpixels`, the pipeline never ran and the conclusion is completely different. Confirm before acting.
  - **If the copy IS the floor, that is a capability statement, not a bug** (goal 1 of the arc): ~19ms of unavoidable CPU copy per 4K frame means **4K Syphon at 60fps is not reachable in Electron**, while 4K at 30fps is comfortable. The remaining levers all reduce BYTES rather than latency: broadcast at 1080p or 1440p when the consumer composites there anyway (already user-exposed via the resolution tiers, and worth defaulting more honestly), or a subsampled wire format. Worth measuring the readback at each tier to give the resolution picker an honest fps estimate per rung.
  - **✅ ADDRESSED B519 — pipelined readback.** `PIXEL_PACK_BUFFER` + fence, collect a frame later, so the main thread stops blocking on the transfer. Costs one frame of constant latency (Daniel's explicit call, favouring smoothness). The IOSurface-direct idea filed below was **retracted before it was built**: the WebGL context lives in Chromium's sandboxed GPU process and there is no supported way to hand a native Syphon module a texture handle from there. Pipelining was the reachable fix and it is entirely in our code.
  - **THE REDIRECT:** the adaptive-preview-resolution proposal was aimed at the wrong target. The high-value work is **eliminating the CPU round trip** — hand Syphon an IOSurface-backed GL texture directly, and hand the recorder a `VideoFrame` built from the GL canvas (candidate C2 in the existing readback benchmark, measured but never adopted). Preview degradation stays worth having on the *phone*, where the budget is small enough that 0.5ms matters, but it is not the desktop answer and never was.
  - **iPad ablation, and a lesson about the numbers.** 4K→4K: 43.3fps all on → 44.0 with PiP off (PiP is free) → **53fps with the preview also off**. That is ~5ms recovered, while the panel *measured* the preview at 0.39ms — a **13x understatement**, exactly the WebKit submission-vs-execution gap. Confirms the switchboard is the method there, and that WebKit ms figures cannot be compared against desktop ones.
  - **⚠️ Two open observations from the same run, NOT yet explained.** (a) With the preview and PiP switched off, raw fps rose but playback became MORE halting (the old play/stop/halt pattern). fps went up while smoothness went down, so something other than raster is pacing the frames — decode or wire, unmasked once raster stopped competing. (b) Daniel judges 4K→4K broadcast **worse than the earlier successful runs**, and cannot rule out the panel or B512-B515 as a cause. **Test before theorising: run the same clip with the panel CLOSED and read the output panel's own fps.** If it recovers, the instrument is perturbing the measurement, which is a serious enough problem to fix before any more numbers are gathered.
  - **✅ 4K SOURCE ON DESKTOP — FILLED IN B516, and it exonerates the source path entirely.** 6+min 4K clip, Electron: no broadcast = **120fps** with the 8.29MP source upload costing **0.06ms**. Syphon at 4K = 30.3fps, readback 21.3ms. Plus record = 30.5fps, readback 21.3ms — **recording is free on top of a broadcast, confirmed a second time.** Switching off preview + PiP + overlay together took it from 30.5 to 32.9fps (18.21 → 16.59 MP/frame): **8%, for every editor surface in the app.** The readback is 350x the cost of the source upload at the same 4K resolution. On desktop there is exactly one problem and it is the readback.
  - **📐 THE QUALITY LADDER (Daniel's ceiling/floor, iPad staged preview, B516) — this is the Phase D ladder, answered:** 75% = barely noticeable · 50% = "something feels off viscerally but it doesn't catch your attention" · 35% and 25% = actually terrible. **But 25% has a use precisely because it is unambiguous:** Daniel almost prefers it, because it reads not as poor quality but as SYSTEM STATUS — visibly "this isn't pushing full resolution". **REFINED (Daniel, B517): 50% is OUT.** "It lives in that uncanny 'something is off' zone so we should avoid it where reasonably possible." So the shipping ladder is **100 → 75 → 25**, skipping the uncanny middle entirely: 75 is the graceful step nobody notices, and 25 is the honest distress signal you are meant to notice. That also answers the open UX requirement that a degraded preview must never be mistaken for a degraded broadcast — the two rungs are "invisible" and "obviously deliberate", with nothing in between to be misread as a broken output.
  - **🔥 [HIGH — Daniel, B515] The iPhone runs warm on PLAIN STILL-MODE CAMERA PREVIEW, not just while recording.** "Anything, even just basic still camera capture, seems to heat it up pretty quickly." So the expensive thing is in the BASELINE, and until B516 the baseline had no instrumentation at all (the phone report listed the output canvas and the overlay, and nothing about how a camera frame becomes a texture). B516 adds a `source` surface with `refresh` (mirrored-canvas 2D copy) and `upload` (texture) passes on every live path. **Leading hypothesis, now testable:** the live loops run on rAF at up to 120Hz while the camera delivers 30, so we may be paying the full camera→texture cost 2-4x per delivered frame, on the hottest path on the most thermally constrained device. If confirmed, per-surface frame pacing stops being a Phase D nicety and becomes the first fix. Second candidate on the same path: the mirrored-canvas copy exists only for front-camera mirroring and could plausibly be a texture-space flip instead of a per-frame CPU blit.
- **▶ THERMAL / SUSTAINED LOAD — "GATE 2". NOW THE ACTIVE ARC; Phase A shipped B512.** ⚠️ **The authoritative plan is `~/.claude/plans/thermal-and-frame-cost-audit.md`** (full frame-cost audit, the four goals, per-lever rulings, the durability constraints, the iPhone record gap, and the phased path). The notes below are the pre-audit reconstruction, kept because the reasoning is still correct; where they disagree with the plan, the plan wins. Phase A (B512) = `conduit/perf-ledger.js` + `conduit/pressure.js` + `shell/perf-panel.js`. Phase C (B513) = the three certain-waste cuts (overlay DPR cap, overlay change-gating, bus + poster idle elision). **Phase B is Daniel's on-device measurement pass and is the current blocker** — the resolution ceiling/floor per surface per device is the ladder, and only he can produce it. Phase D is the single governor.
  - **✅ [WAS OPEN — instrumentation gap, B512] The ledger measured WALL time, not GPU time — FIXED B514** (`conduit/gpu-timer.js`). `EXT_disjoint_timer_query_webgl2` on Chromium/Electron now gives true GPU-execution numbers, which is what the plan's "rank on desktop, confirm on device" step assumes. WebKit still has no timer queries, so iPad/iPhone keep ranking by ablation.
  - **[OPEN — B514] Should the RECORD path be measured as a one-shot or a per-frame surface?** The recorder currently shows up only inside the bus row. iPhone's record failure is the sharpest open question in this arc (see HANDOFF) and the readback-vs-render split within the bus is the diagnostic — if the pass breakdown proves too coarse to answer it, give the recorder its own registered surface with encode as a third pass.
  - **Scope, as agreed:** a `thermalState` host seam + a frame governor under pressure + idle-render elision + honest sustained-fps tiers.
  - **Why it exists:** NDI + AirPlay run the device hot; per-frame readback plus the WS pump with no governor. Also weak-link #3 on the 4K target ("smooth, then slows down" matches throttling).
  - **The signal.** iOS gives us `ProcessInfo.processInfo.thermalState` (nominal/fair/serious/critical) + `thermalStateDidChangeNotification` — a small native addition to an existing plugin. **The web has no thermal API at all**, so desktop/Electron must INFER pressure from sustained frame-time drift. Design the seam so the inferred signal and the native one are interchangeable.
  - **Recorded decision — ship and verify SEPARATELY from any other governor.** Both are adaptive controllers, but they act on different signals (thermal vs backpressure), at different stages (render vs publish), and need different test procedures: a governor check is a short "is it smooth now", thermal is a sustained multi-minute "does it stay cool". Bundling them makes each result unreadable.
  - **⚡ NEW CONNECTION (2026-08-03):** the **adaptive preview resolution** proposal (filed above, awaiting Daniel's yes) is the *same controller* with a different input — measure a signal, step render cost down a ladder, step back up with hysteresis. Build that one first with a **pluggable pressure source**, and thermal becomes a second input to it rather than a parallel system. That also gives thermal a ready-made actuator (the resolution ladder) instead of needing its own.
  - **Testing reality:** Claude is device-blind and this needs sustained load on real hardware. Daniel pre-authorized building it anyway with a queued verification list ("if there are things we can progress on but might be harder to test, maintain a running list of verification items to circle back on later").

### Per-device-category SAFE export ceilings
Build a conservative table (phone / iPad / desktop × memory class) of what each can SAVE safely — seed from real crashes (iPhone 17 Pro: 8K dies, 6K ok pending verify). Longer term: a TILED export (render in strips, memory-bounded, no ceiling).

### ⏸ PARKED gnarly pair (documented, not chased)
Both contained (no cascade risk). Full logs in `docs/temp/`.
- **iPad record ~19fps** — the B374 probe worked; remaining cost is deeper in WebKit's encode/copy path. Long-term = the Tier-3 native-capture class; not worth speculative surgery.
- **iOS NDI blue cast — ✅ ROOT FIX B465 (pending device verify).** Deduced: the capture probe's checksum summed R+G+B (channel-order INVARIANT), so WebKit iPad's readPixels returning B,G,R,A won the probe and shipped channel-swapped bytes as RGBA → blue cast. Fixed by making the checksum channel-aware + auto-swizzling that device's fast path (`conduit/capture.js`). If the cast persists after verify, the console probe line shows whether `(R↔B fixed)` engaged — if it didn't, the cause is downstream (native FourCC / Arena color-matrix). **Flicker** (separate): NDI rides the WiFi AP (DSL-era router suspect) — A/B on hotspot/ethernet; also should ease now that UYVY halves the wire load.

### iPad NDI drain — STUTTER PERSISTS after UYVY (▶ Daniel's #1 remaining gap, 2026-07-29)
UYVY (B465) fixed the color and helped, but playback in Arena still HALTS (start/stop). Daniel's numbers: **FHD still, app reports ~54fps** → stops/jumps/occasional flicker+blackout; **HD still, ~60fps** → still start/stop but no flicker/blackout. Blue cast GONE (JPG correct). Both on **WiFi**. Key read: at FHD the app pushes ~54fps × 4MB(UYVY) = ~216MB/s, ABOVE the ~165MB/s WS wall → backpressure drops → burst/stall; at HD ~60fps × 1.8MB = ~108MB/s is UNDER the wall yet STILL stutters — so it's not purely the mean throughput; it's **bursty pacing / WiFi jitter** (the "delivered fps" counts frames ACCEPTED to the wire, which overcounts smoothness when they're accepted in bursts).
- **🟡 WiFi NDI is choppier than hoped — ACCEPTED LIMITATION (Daniel, B478), documented + warned.** After the pacing work (B472), the Movink/HD-vs-FHD retest, and `clock_video` (B478), Daniel's conclusion: WiFi NDI from iOS is **usable but not smooth for live performance** — it's WiFi packet-timing JITTER, not bandwidth (halving resolution barely helped; modern multi-band router; solid ONLY over ethernet-iPad / Thunderbolt-iPhone). Sender-side levers are largely exhausted; the remaining ones are receiver-side (Arena's NDI input buffer) or wired transport. **Posture: set expectations, don't keep chasing.** Best outputs = Capacitor→HDMI/AirPlay, Electron→Syphon, or WIRED NDI (ethernet/USB-C). **✅ In-app caution SHIPPED B488** (NDI destination shows "⚠ NDI over Wi-Fi can stutter — Ethernet for smooth playback" inline). **✅ clock_video decision (Daniel B488):** default flipped ON (helped iPhone; iPad bursty either way), diagnostics toggle retained — tentative, revisit if a device disagrees. Options tried + shelved: fixed-cadence pacing (helped, kept), resolution cut (marginal), `clock_video` (may've already been on via the SDK C++ default). Bitrate isn't cleanly settable (SpeedHQ auto; NDI|HX = different SDK + quality loss).
- **⚠️ B471 AIMD governor was a NO-OP → REPLACED B472 with fixed-cadence pacing (pending WiFi device verify).** Daniel's ethernet A/B confirmed WiFi-TRANSPORT-bound (WiFi off = smooth on BOTH iPad + iPhone). B471 shipped an AIMD governor that back-off on `publish()→false` — but the gauntlet re-test still halted, and the native `[FoldNdi]` profile showed why: `send-wait 0.0ms`. The native send is async (`send_video_async_v2`) and never blocks → `host.publish()` never returns false → AIMD's drop signal never fired (paced at gap 0 = every frame). JS also can't see WiFi backpressure (past the NDI SDK, on the far side of a localhost socket that never fills). **B472 REAL FIX (`ndi-sink.js`):** both native hosts DECLARE 30fps (`frame_rate 30000/1000`) while we fed ~40–60 → the receiver's frame-sync clock fights the mismatch (ethernet masks it, WiFi compounds it). Now paces send to an even target MATCHING the declaration (default 30) via scheduled `nextT+=MIN_GAP` + resync guard; aligns Capacitor + Electron (both declared 30, both overran). `?ndifps=N` = **diagnostic knob**: lower target proportionally smooths WiFi → BANDWIDTH-bound (chroma-subsample / lower res / lower fps next); no change → LATENCY/JITTER (WiFi power-save) → wired or receiver-side jitter-buffer is the real answer. Breadcrumb `[fold] NDI paced <fps>fps (target N)`. JS-only (no Xcode rebuild). **Tails if WiFi still imperfect at steady 30:** the `?ndifps=24` A/B decides bandwidth-vs-jitter; if bandwidth, native could declare + send a lower rate (carry target fps in the FNDI wire → native `frame_rate`); if jitter, ethernet remains the max-fps rig answer.

### HDMI external-display follow-ups (core SHIPPED B331–B334)
- **🟠 iPad HDMI + VIDEO source — GPU context loss (~30s → "could not recover", app wedges). MITIGATED B480; ROOT FIX IN PROGRESS (shared-socket, S2 landed B486).** The external view runs its own `<video>` decoder on a 2nd WebGL context at native 4K/6K → memory exhaustion. B480: capped the external render to 1080p for video sources (guard) + a break-glass session reset. **Root fix = SHARED-SOCKET: decode the clip ONCE natively, fan FYUV frames to both webviews** over a localhost socket (exactly how the native camera reaches the external view), killing the second decode and lifting the 1080p cap. Full sub-plan: `~/.claude/plans/shared-socket-video-conduit.md`. **S2 SHIPPED B486** = the native producer plugin `fold-native-video` (AVQueuePlayer+AVPlayerLooper → AVPlayerItemVideoOutput → CADisplayLink → FrameSocketServer:8900), additive, not yet wired. **S3-A (NEXT, Daniel greenlit — "A" design):** NOT a plain camera-mirror. Investigation found the **motion runtime uses the `<video>` as its master clock** (derives progress `p` from `v.currentTime` every frame, and writes it for scrub/trim/retime — ~28 sites in motion-runtime + ~10 perform + ~7 output-view). So the socket approach needs the native decode to OWN the clock: stamp each frame's PTS into the wire, expose `receiver.currentTime()`, and route every clock read/write through a `sourceClock` seam that's `<video>` today and the native receiver on iOS. Capability-gated with `<video>` fallback (worst case = no improvement, never broken). Loop Builder (~50 clip-editor sites) stays on `<video>` (authoring, not the broadcast path). Full sub-plan: `~/.claude/plans/shared-socket-video-s3a.md`. **✅ STAGE 2 SHIPPED B493** = the `sourceClock` seam — `createVideoElementClock` (shell/video-source.js) + `env.sourceClock`, a straight `<video>` passthrough so it is behavior-neutral by construction; routed through motion's play loop/retime/trim-rewind/scrub/duration-lock/halt, perform's transport/tick/ruler/speed/exit, and `getVideoSync` in external-display + output-window. Authoring surfaces (filmstrip, footage thumbs, staging's `stg.video`) deliberately stay on `<video>`. **⚠️ DECIDE BEFORE STAGE 3: motion staging implies a SECOND decode** — `stgStartVideo` opens its own `<video>` so the committed loop can sit at a different playhead than the edit scrub, and `env.programVideo()` puts it on the broadcast path; under one native decode there is one playhead, so hold/take over video either gives up the independent staged position or needs a second native decode. **✅ STAGE 1 SHIPPED B490** = the PTS wire — a `"FYUW"` variant (FYUV header + f64 pts + f64 duration, planes at offset 40) on the video socket only, the camera's 24-byte FYUV untouched; `native-camera-receiver.js` → `native-frame-receiver.js` reads both magics and exposes `pts`/`duration`, advancing the clock **on paint**. **STAGE 2 (next)** = the `sourceClock` seam, behavior-neutral on `<video>`, desktop-verifiable. **✅ STAGES 3 + 4 SHIPPED B498 — the arc is code-complete, pending Daniel's device pass.** Bytes over a binary upload socket (`FileUploadServer.swift`:8901); `shell/native-video.js` = upload + start + FYUW receiver + a `sourceClock` implementation; `loadVideo` hands over PLAYBACK while the `<video>` stays parked for authoring; native `stageSource` via `frameAt`/AVAssetImageGenerator; output-view `kind:'video-native'` joins the same socket; the 1080p cap lifts when a native decode is active. No second decoder, no staged file, no range server, no clock to reconcile. Falls back to `<video>` on any failure. **✅ STAGING UNBLOCKED B497** — the `stageSource` seam (`shell/stage-source.js`) inverts which side pays for the second decode: the audience keeps the one playing decoder, the editor gets bounded on-demand stills. The native implementation stage 3 must add is `AVAssetImageGenerator` on the same asset with `maximumSize` + seek tolerance — a decode burst per scrub-settle, no second player. **STAGE 3 BYTE TRANSPORT — DECIDED 2026-07-31 (Daniel): a BINARY UPLOAD SOCKET.** `AVURLAsset` needs a file on disk and a WKWebView `<input type=file>` File has no native path, so the bytes must move. The webview streams raw `blob.slice()` chunks over a localhost WebSocket into the plugin, which appends to a temp file and resolves a path. Chosen over base64-over-bridge (the sub-plan's original assumption, and the same slow transport that caps external-display staging today) and over a native zero-copy document picker — the socket measures ~165MB/s on the NDI path (~12s for 2GB) with peak memory of one chunk, needs no import-UX change, and is the only option that also covers **Loop Builder baked clips** (Blobs that never existed as files). Zero-copy-via-picker stays available later as an import fast path. **S4 (later)** = Electron parity via a JS shared-frame producer into the same consumer seam (no native decoder needed there). Device-blind for Claude — Daniel verifies. **✅ Verification (Daniel B487, uncap toggle ON):** 1080p→4K HDMI sustained ~10min smooth/usable (occasional stutter); 4K→4K HDMI mixed-but-PROMISING (smooth after one loop, 50% initially, loop-point pause, slow thumbnail reprocess; 20.4s clip); **context-loss NOT reproduced** so far (5min-4K/10min pressure test pending). Encouraging that even the double-decode 4K path is borderline-usable — single-decode S3-A should clear it. Also: **watch Electron desktop HDMI (B479)** for the same wall under heavy video (second context there too, just absorbed by desktop memory today). **Testing affordance (B487):** a diagnostics toggle "4K/QHD over HDMI" (`localStorage.foldHdmiVideoUncap`, default off) lifts both the tier-button disable and the 1080p render cap so 4K can be measured on device — note this re-arms the crash and the halting is the DECODE cost (independent of output res), so it confirms the problem, not the fix.
- **◐ Multi-external-display picker + per-display RESOLUTION OVERRIDE (B479/B482 follow-up, Daniel greenlit).** (a) ✅ SHIPPED B485 (Electron): enumerate ALL non-primary displays + a "display" sub-selector to choose which one (labeled "HDMI / AirPlay · W×H"); default = largest. Fixed the 6K+4K "only the first is reachable" bug. **Still needs Daniel's two-display verify.** (b) ▶ STILL OPEN — the **manual resolution override**, because auto-detection has NO clean rule (Daniel's data: the iPad 4K display needs `largest`=4K while the Movink needs `preferred`=FHD; `nativeBounds` doesn't disambiguate — it reads QHD on the 4K). Semantics diverge by platform: iPad can pick a real `UIScreenMode`; Electron can't switch OS display mode, so its "override" = render at a chosen ≤native resolution. Also OPEN: the **iPad plugin** side of multi-display (deferred — iPad's real-world case is a single HDMI/AirPlay display; its open issue is resolution *detection*, not count). A candidate for the shared conduit external-display capability.
- **✅ Desktop HDMI / external-display output — SHIPPED B479 (Electron; pending Daniel's display verify).** Reuses the self-rendering output view; `createExternalDisplayWindow` + Electron `setWindowOpenHandler` places the output window borderless on the external display; `displays` host capability (screen module) drives the auto-select destination (iPad-parity UX). **Conduit-extraction tail:** the poster core is already shared conduit; the display-enumeration + fullscreen-placement is currently Fold/Electron-specific — extract into a conduit "present-on-external-display" capability (host implements enumerate/place; browser via Window Management API `getScreenDetails`, Electron via screen module, iOS via the native plugin) so every follow-on consumer (zoetrope/tap/music-viz) inherits desktop + browser HDMI-out for free. Also: **browser** (Chromium) desktop-web HDMI via the Window Management API — a follow-up once the conduit capability lands.
- **▶ Native app menus / file menu (pre-release polish — Daniel, not urgent).** Expose Fold settings + commands in a proper native menu bar for the shippable builds. **Electron:** trivial — the `Menu`/`MenuItem` API builds an app/File/Edit/View menu with accelerators; wire items to the same commands the UI already calls (open source, save, reset, toggle output, etc.). **Capacitor iPad:** possible via the iPadOS menu system (`UIMenuBuilder` / key commands) through a small native plugin — more work than Electron but real (iPad apps get a hardware-keyboard menu bar). Do before any official release; good home for discoverability + keyboard shortcuts. Cross-ref the future conduit/consumer apps (shared menu scaffolding).
- **✅ Display-resolution detection — FIXED B476 (pending Movink re-verify).** B465 used the *largest* `UIScreenMode` (fixed a 4K adapter that `bounds × scale` under-reported as 1440), but that OVER-reports on Daniel's Movink 13 (advertises up to 2560×1600, physically FHD). B475's `[FoldExt] display modes` diagnostic settled it: `preferredMode` = 1920×1080 (correct) while largest = 2560×1600. B476 switched `nativeSize`/`applyNativeMode` to prefer `preferredMode` (fallback largest → bounds×scale). **Tail:** re-verify the original 4K adapter reports 4K via `preferredMode` (very likely, but that display isn't on hand — verify-queue). Output was always correct; this fixes the identifier + presented mode.
- **▶ Frame-aspect change while a BUS output is live (NDI/Syphon/record) — deferred follow-up.** B475 made aspect unlockable during a SELF-RENDERING broadcast (HDMI/AirPlay/output-window re-letterbox from state, no bus). NDI/Syphon stay hard-locked because a mid-stream aspect change needs the bus to reconfigure its render size (`outputBus.setResolution` is cheap — the loop reads w/h each frame — but the SINKS must re-negotiate: NDI re-sends dims → Arena re-detects/blips; Syphon recreates its texture). Recording is genuinely fixed (muxer) and should stay locked always. To ship: wire the frame-aspect change → `outputBus.setResolution(computeDims())` when the bus is running, unlock aspect for NDI/Syphon too (keep recording locked), and **device-verify the NDI/Syphon re-negotiation** (needs Daniel's NDI network — blocked at Starbucks). Daniel accepted the momentary blip. Opportunistic QoL, not critical.
- **✅ VIDEO SOURCES over the external display — SHIPPED B470 (iPad/desktop chrome; NEEDS DEVICE VERIFY).** Native `stageVideo` (base64 clip → cache file) + `fold-ext://.../staged/*` served with HTTP RANGE (206 — WKWebView `<video>` requires it) + `clearStaged`; JS `buildSourcePayload` returns `{kind:'video',url}`. Render + program-clock sync (`reconcileVideo`) already existed. ~60MB cap (base64 jetsam guard). **Gauntlet result (2026-07-29):** works — a 19s 1080p clip plays + syncs; but a **2:45 1080p clip fails the ~60MB cap** ("too large" hint). HDMI-3 sync looked good (one transient desync, non-repro). **Daniel's target: ~7–9min 1080p covers most use cases; dream = 10min 4K.** (a) device-verify done ✓; (b) **✅ LARGE-CLIP STAGING — SHIPPED B473 (needs Xcode rebuild + verify).** Chunked transfer: JS slices the blob → base64 per 8MB chunk → native `appendVideo({id,data,first})` truncates on first + appends decoded bytes; `serveWithRange` caps any single response ≤8MB (forces 206) so a huge staged clip can't load whole-file → jetsam. Peak memory = one chunk regardless of length → ceiling ~60MB→**~2GB soft cap (~9min 1080p, Daniel's realistic target)**. (c) mobile chrome has no video sources (image+camera only). **⚠️ B489: the ceiling REJECT was itself fatal** — the pre-check ran `fetch(blobUrl).blob()` first, reassembling the whole clip in memory (Daniel's 6min-4K test: the "too large" hint AND a lost graphics context). Fixed by sizing + slicing `env.media.sourceVideoBlob` directly; the ceiling is unchanged, only the failure mode. **Beyond ~2GB, base64-over-bridge is the wrong transport entirely** — see the byte-transport decision on the shared-socket item above; Daniel's 4K target lands there, not here.
- **▶ True-4K / 10min external-display video — needs a streaming socket (FUTURE, not built).** What we support TODAY (B473): video sources up to the **~2GB soft cap ≈ ~9min 1080p** via chunked base64-over-the-Capacitor-bridge. That covers the common broadcast case but has real limits — base64 inflates each chunk ~1.33× and every chunk is a bridge round-trip, so staging a multi-GB clip is slow and 4K/10min sources (≈4–7GB) exceed the cap and fall back to the honest hint. **To lift it to true 4K / 10min:** replace base64-over-bridge with a **localhost streaming socket** (the same transport the NDI frame path already uses — a native `NWListener` the webview streams the raw file bytes into, no base64, no per-chunk bridge overhead). Only worth building if long-4K external-display broadcast becomes a real need; the ~9min-1080p ceiling likely covers most use.
- **Video sources across webviews** — blob URLs are per-context; write the clip to cache + serve through the plugin's `fold-ext://` asset scheme.
- **Desktop screen enumeration** (Window Management API labels — Chromium only) for placing the output window on a named display.
- **Small external-display status indicator** in the mobile chrome (console-only today).
- **[edge] iPad front-ultra-wide initial-load 90° rotation** — iPad only, that lens only, initial load only; switching cameras corrects it. May become moot if the native camera owns iPad capture.

### Video save UX convergence — open tails (core SHIPPED B370)
- Device-verify the iPhone .zip package path.
- Desktop parallel-source recording (a product decision — memory cost of a second 4K take) before the package option exists on desktop.
- Migrate stills' `exportStatus` line to the save-flow voice (stills show BOTH today).

### AirPlay OLED tearing/stutter — WATCH
Apple TV → OLED showed slight tearing even at 30fps+; not re-reproduced. Validate next AirPlay session; suspect the external view's render pacing vs the TV refresh, not throughput.

### Native camera → iPad/desktop chrome (core SHIPPED B339–B344)
- **48MP still-on-freeze for the desktop chrome** (freeze currently grabs the preview-res frame).
- **iPad Capacitor: tap-to-focus + WB/EV press-hold gestures** on the source panel (port the mobile pad — gated to touch + native camera).
- **Electron**: the honest desktop set is resolution + fps (WB/EV/torch don't apply). Full native depth = the iPhone-as-camera lane below.
- Device-verify: iPad native rows + a macOS webcam's res/fps.

### iPhone as a capture device for desktop
Pair the phone via the settings→inputs QR/LAN path; it shows up by name in the Electron camera dropdown, owning its AVCaptureSession (lens/EV/WB/48MP/**stabilization**). Video rides a WebRTC peer connection LAN-local (phone's native-camera canvas → captureStream → RTCPeerConnection → desktop `<video>` → setSource). Daniel's sharpener: Continuity Camera already lists the iPhone but loses the native capture features — the gap is CONTROL, not connection. Sequence after the iPad gear; pairs with NDI-out ("Fold nodes on a LAN").

### Camera polish follow-ups (post-stability)
- **Stabilization crop vs the SVG overlay package** — the saved full-res original is UNcropped; the planned overlay-.SVG-over-source must scale/position against the true source aspect.
- **Capture feedback honesty** (mostly addressed B380) — verify the white flash / status rides the actual capture moment on device.

### node-syphon leak — REVERT when released
Fix merged upstream (issue #45, PR #46) but NOT released on npm (still 1.5.0, the leaking binary). Stay on the vendored `electron/vendor/node-syphon/syphon.node` + the postinstall patch. Re-check when npm shows >1.5.0: bump the dep, drop the hook + vendor dir, verify with the memory profiler + an Arena hop. Do it alongside the next Electron packaging round.

### Capacitor arc — remaining tails
- **iOS safe-area / tab-bar polish** — the two iPad-landscape 34px-hack bugs + native-vs-PWA bottom inset (native portrait reads single-counted, so "doubling" looks PWA-specific).
- **Record-at-named-resolution mobile integration** — desktop records at the output-bus resolution; the mobile record path is the gap (delicate; device-gated). Overlaps the conduit-recorder port above.

### Distribution gating (needs the $99 Apple Developer account)
Full reference: `docs/DISTRIBUTION.md`. Code-signing + notarization (so the DMG runs elsewhere) + a universal (x86_64+arm64) binary (gated on a universal node-syphon build — currently arm64-only). Revisit when distribution to other machines is the goal.

---

## Strategic / roadmap

### Strategic forks (gate big downstream chunks)
- **D1 — Positioning** (prosumer ↔ kid-friendly ↔ tiered). Gates global-UI style, pricing, free-vs-paid. Not engine/IxD.
- **D2 — Native wrapper** (PWA-only ↔ native universal ↔ web). Gates Syphon, advanced camera, codec-locking, HDMI.
- **D3 — Distribution** (standalone ↔ filter ↔ NLE plugin ↔ photo). The core engine is shared under all — parallel bets on one engine, chosen per D1.

**Leverage insight:** the core engine + tween/keyframe/realtime model is the shared asset under EVERY path — investing there pays off regardless. Parallel tracks (no cross-dependency): motion IxD; the bug/polish cluster; hardening. Sequential chains: realtime live-video → save-to-disk → [D2] → Syphon/camera/HDMI; source-fps hint → interpolation → sub-25% speeds; UI audit → [D1 style] → itemized fixes.

### Shared `stage/`/conduit — native track (the structural fix)
The web track shipped (conduit extracted, B345/B349; external-surface B382). The **native track** (WKWebView + Metal-backed IOSurface, owned by the wrapper) is the one path that structurally removes the double-render — it captures the WebView's displayed frame directly, no second render, no state race, by construction. Unbuilt; needs its own spike. Belongs paired with the web track because it lives entirely in the wrapper: ANY web app hosted this way inherits it (Fold, zoetrope, future) with zero per-app native work. Not gating anything today; revisit when a second app needs Syphon output, or 4K/heavy-shader perf actually bites. **Also filed (Daniel):** once conduit stabilizes, extract `packages/conduit` OUT to `~/Code/conduit` (sibling repo, canonical clone) — solve the deploy question then (a `file:../conduit` dep breaks Vercel; pair with going public or a scoped registry publish).

### Native capability inventory / brand / positioning (parallel, any-time)
- **Native app capability inventory** [FOLD.md monetization 3/4] — camera controls, live→still-on-capture, Syphon/HDMI out, per-device tab placement, per-platform codec locking; possible feature/resolution gating; adoption inside an ecosystem (Snapchat/IG filter, DaVinci/Premiere/FCP plugin, Arena).
- **Global UI / brand pass** — general audit (polish, discoverability, WYSIWYG breaks, WCAG); style/brand direction (palette/font/voice; confirm lowercase + minimal). Start-from nits: slice-overlay SVG misalignment; motion not showing the slice area in non-square aspects; don't show both the reflected + over-extended wedge; keyboardability; mobile tab-bar icons.
  - **▶ WORKED EXAMPLE for the copy half of this pass — the B642 OOB-mode warning** (`main.js`, "move slices back onto the source?"). Daniel: *"the ux copy on the warning is pretty confusing and isn't consistently lowercase."* Lowercased and shortened at B643, but it is still a placeholder and it names the genre well: **the message explained the MECHANISM (mirror vs clamp, what playback would do) when the reader only needs the consequence and the choice.** It also mixed sentence case with an ALL-CAPS mode name mid-sentence. When this pass runs, treat interrupt copy as its own pattern with a shape — what changed, what happens if you continue, what the button does — rather than writing each one fresh. Every `confirmInterrupt` in the app is a candidate; they were written one at a time and read like it.
- **Alpha test / marketing / positioning** [FOLD.md] — URL, landing page, pricing, audience/use-case/distribution. Feeds D1/D3.

---

## monetization / sharing

Full narrative in `FOLD.md`. Priority order:
- **Phase 1 (next): PWA + Ko-fi tip jar.** A Ko-fi link on the landing page. Audience-building, no paywall.
- **Phase 2: Walled-garden subscription** — page-routing auth via a third-party platform (Patreon/Ghost). Parent-brand candidate `curioustools.art`.
- **Phase 3: Native iPad app via Capacitor.** App Store $5–15; Apple Developer $99/yr.
- **Phase 4 (sidebar): Native Mac wrapper for Syphon out** (into Resolume) — unsigned local DMG SHIPPED; distribution gating above.
- **Phase 5 (deferred): Photoshop PSD export** (output + original + wedge as layers).
- **Audio in the consumer "wonder" share** — the one real audio case (record a clip with the effect + source audio to share). Far down; keep the recorder free of video-only assumptions.

## gallery installation work

Curatorial frame in `FOLD.md`.
- **Cloud folder I/O handshake** — read source images from a configured cloud folder, write outputs to another. Upload UI/moderation/rotation belong to a sibling app, not Fold.
- **Guided Access kiosk verification** — PWA on iPad Pro 12.9" in Guided Access fullscreen (gesture behavior, no external-link escapes, survives extended use). Shared with the Drift kiosk backlog.
- **Document-camera source mode** — overhead camera at a table of objects; architecturally identical to the live-camera shell (a different default form / framing).
- **Companion "honeycomb" app (builds on tile-aware output) — DEFERRED; informs mode sequencing NOW.** Two use-cases: (a) **gallery show** — a visitor uploads an image (e.g. via Dropbox), builds a folded composition within set parameters (e.g. hexagon/triangle only), then manually places their tile on a shared tiled composition alongside others' hexagons; (b) **personal meditation** — each day, make a kaleidoscopic hexagon of something you noticed (e.g. on your commute) and add it to a personal honeycomb grid; over time, share with friends to co-create a collaborative mosaic. Short-term relevance: it needs opinionated build→place sequencing, which is WHY the tile builder is a contextual surface (see the Flows/Guardrails/Tiling arc). Depends on tileable-cell + non-square/vector tile export.

## developer tooling backlog

- **GitHub Actions CI** — `npm run build` on push to main; a workflow for lint/typecheck when those exist.
- **Visual regression harness** — load each form at defaults, export at 1K, diff against a baseline. Catches shader regressions.
- **Source-mapped production builds** — Vite does this; verify on deploy.

## open architecture questions (settled notes)

- **Engine input contract** — accepts HTMLImage/Video/Canvas / ImageBitmap / VideoFrame as a texture source.
- **Mobile is a distinct chrome** — a separate front-end on the same engine, not a responsive retrofit.
- **Shared infrastructure for video sources** — camera / video file / animated still are host modules over one continuous render driver, not three code paths.
- **WebCodecs for video export** — prefer `VideoEncoder`, fall back to `MediaRecorder`; mp4/h264 if available, webm/vp9 otherwise.
