# handoff

This document is for whichever Claude session picks the project up next. **It is the rolling source of truth** for project state, recent decisions, and what's queued. Edit it as the project evolves; archive snapshots if you want history (or rely on git).

If you're a Claude reading this for the first time in a new session: read this entire doc, then `BACKLOG.md`, then skim `ARCHITECTURE.md` if relevant to what Daniel is asking about. `CHANGELOG.md` is per-version detail you usually don't need.

## who & what

Daniel Nelson is building a browser-based kaleidoscope tool for high-resolution still-image output. He's a VJ (Resolume Arena + Akai APC40 MK2), technically savvy but identifies as a non-developer. He's iterative, evidence-based, and methodical — runs builds locally, reports back specifically with what works and what doesn't, catches Claude's UI hallucinations.

He prefers **no em dashes** in any prose Claude generates for him.

## ▶▶ THE PLAN NOW LIVES IN `PLAN-LIVE-READINESS.md` — ⚠️ RESTRUCTURED B760, READ IT FRESH

**It was rewritten end to end at B760** (Daniel: *"increasingly fragmented across various states, and
updates have been inserted surgically without addressing document-wide inconsistencies"*). It is now a
**phase map** — 2 (4K end to end), 2.5 (colour, urgent, may pre-empt 2), 3 (iPhone honest labels +
battery), 4 (NDI), 5 (cleanup, split so its docs half runs early and its code half last) — with one
work list per phase and a single dependency table. **The old numbered items 1 through 7, the item 1.5
detail, and the three superseded close-out blocks are archived at
`archive/PLAN-items-b609-b752.md`.** Nothing was deleted.

## ▶▶ (superseded framing, kept for the B609 pointer)

**Read that file first.** It owns the goal, the sequence, the real dependencies between items, and the stopping rule for each one. It also records the pause point for the stage-manager arc and what is explicitly out of scope.

**What changed at B609:** input normalization was promoted to item 1.5 and scoped as architecture rather than triage; B609 verification is closed; and the six-item plan was superseded as a *sequence* (archived at B658 — see below). **Read `PLAN-LIVE-READINESS.md` for what to do next, and `BROADCAST-DELIVERY.md` for why item 1 and the loop hold are settled.**

## ▶ the superseded six-item plan → `archive/HANDOFF-plan-superseded-b609.md`

Archived at B658. It was marked superseded at B609 and kept for the reasoning behind items 1 and 2; both are closed. **Item 1's durable answer sheet is `BROADCAST-DELIVERY.md`** (including the three-GL-uploads lead and the 2560 caveat, rescued there at B658), and the live sequence is `PLAN-LIVE-READINESS.md`.

## current version

**v0.28.0 · B761** (2026-08-27). Minor bumped at B738 for the O(1) bake landing on hardware.

**⭐⭐ THE O(1) BAKE IS NOW MEASURED, NOT MODELLED.** A 2.63GB / 8:21 4K source peaked at **131.6MB**
against **130.9MB** for a 741MB source. **3.5× the file, 0.7MB more memory.** Both 8GB M1 iPads also
passed the job that killed them at B730 (Air 71.6MB, Pro 114.9MB). The Blob is disk-backed and file
size is no longer a memory axis. **B705 and B706 are device-verified** — B705's instrument found B706, and B706 held on the repro that killed B705. B703, B704 and B707 are not yet device-verified.

---

## ▶▶▶▶▶▶▶▶▶▶▶▶ B761 (2026-08-27) — THE APP HAS A COLOUR PIPELINE, AND THE TEST CLIP IS HDR

**⚠️ READ THIS BEFORE QUOTING ANY QUALITY JUDGEMENT FROM THE B7xx ARC.**

`IMG_5132.MOV`, the clip every scenario run in this arc has used, parsed from its own boxes:
**BT.2020 primaries, HLG transfer, BT.2020 matrix, HEVC Main 10, 10-bit.** It is HDR. The planar path
decoded it with hardcoded **BT.601** coefficients, no transfer function and no primaries.

**Shipped: the input transform** (plan PHASE 2.5). `engine/color.js` holds the maths and the GLSL,
`shell/source-color.js` reads the `colr` box in JS (~64KB of `Blob.slice`, no native change needed),
and one owner in `source-host.js` fans the description to the preview engine, the bus engine, the PiP,
the source panel and the external view's payload. `?color=off` pins the old behaviour for an A/B.

**What it does NOT do:** the working space is still 8-bit, so HDR gradients will band. Stage two is a
half-float buffer behind the same seam; stage three is the output side (display transforms, ICC).

**Also shipped, and it is the phase-2 exit criterion in miniature:** B669's dead-take watchdog read
`if (n === null || n > 0) return`, and `framesEncoded` returns null exactly when the recorder has no
session — so **"I cannot tell" was treated as "fine"**, in the one instrument built to catch a
totally dead take. It never fired on `R2-take4`. Every path now marks, and a zero-frame take reports
as failed instead of saving silently.

**▶ NEXT: `VERIFY-QUEUE.md` V0.** Most of it is desktop and free. The one judgement only Daniel can
make is V0a-versus-V0b: whether the new look is right.

---

## ▶▶▶▶▶▶▶▶▶▶▶ B760 ADDENDUM — WHAT `R2-take4.json` RETURNED, AND IT MOVED THE TARGET

**The trail worked on its first report, and it pointed somewhere better than expected.** The planar
drop is **not** a stray `setSource` — it is `reinitGL`, at a GL context loss that happens **when a
take is armed**, and the provider IS reinstalled afterwards. So B760's reconciler correctly did
nothing (`hasPlanarProvider` was true) and the open question narrowed to *why the uploader never
rebuilds*, which is B708's question on a build that has B708's fix. **Next step is one free counter,
not a device session** — see BACKLOG.

**And the report contained a bigger finding than the one it was run for.** Arming an FHD take, with
**no broadcast** and no external display, lost the GL context on **three** surfaces (output,
yuv-source, preview) inside one second. The take then ran 60 seconds of wall clock, recorded
`videoFrames: 0` / `wallSec: 0.5`, wrote no file, **and the app reported success.** The 4K take that
followed managed 17.4 fps against a declared 30, on a source that was 720p at the time.

**That is the exit criterion failing in a single report**, and it now leads phase 2 as item 2A. The
loud-failure half is Class 1 and should not wait on the cause: the per-take record already computes
`why: "no video span"` and simply never reaches the operator.

**⚠️ Do not calibrate any record gate against 17.4 fps.** It was measured off the planar path.

---

## ▶▶▶▶▶▶▶▶▶▶ B760 (2026-08-27) — THE PLANAR PATH GETS AN OWNER. HALF THE BUG IS FIXED, HALF IS INSTRUMENTED.

**Read this before touching anything that calls `engine.setSource`.**

**What was wrong.** Daniel's FHD takes looked, in his words, like "a half loaded website in 1993" — at
129MB, which disproves any bitrate theory outright. The source row said `1280×720 · from canvas ·
native decode · ⚠ NOT ON THE PLANAR PATH`. The engine was sampling the decode's 1280 RGB **preview
canvas** instead of its planes, and the fold then magnifies a ~320px wedge to fill 1920.

**⚠️ AND I READ THAT ROW WRONG ALL SESSION.** I quoted fps, session counts and take numbers out of
these reports for a whole arc without once checking the `source` row, which the project's own standing
rule says to check first. **Every measurement in the B752–B759 matrix needs re-reading against it
before it is quoted again.**

**Sorting `docs/temp/*.json` by that row split the reports in two, which is what said this was more
than one bug:**

| reports | source row | cause |
|---|---|---|
| `R1`, `A3-take2` | `3840×2160 · from <video>` | the render teardown — **FIXED B760** |
| `R2`, `R2-take2`, `R2-take3` | `1280×720 · from canvas` | **still unattributed, instrumented B760** |
| `R1-FHDbakesuccess` | `1920×1080 · planar` | healthy |

**FIXED: the render half.** `teardownExportReader` restored the `<video>` and stopped there. On iOS
that element is PARKED (`source-host` pauses it the moment the native decode attaches), so after any
render the preview sat on a frozen element and every later take sampled it. Hence
`SOURCE STALLED 226.7s` in `R1.json` with no context loss to blame.

**NOT FIXED: the record half, and that is deliberate.** Uncertainty state **B** — know what, not why.
All five places that can retire a provider were read, and none explains a session with no context
loss, no render and no source swap. `sourceW === 1280` proves a `setSource` on the preview canvas
completed, and all three sites that do that install the provider on the very next line with no `await`
between. The protocol's only legal move in state B is instrumentation, so:

- **`planarTrail`** (engine, 12 entries, rides the exported report) names the caller that retired the
  provider and when. **The next report of any kind attributes this.**
- **The reconciler** in `source-host.js` heals the one pairing that is never correct — the engine's
  source IS the decode's preview canvas and no provider is installed — within 500ms. It is an
  invariant, not a guess, and the source-identity check is what makes it safe: every deliberate borrow
  swaps a DIFFERENT element in, so it cannot fire underneath one. `planarHeals` counts it.
- **`tools/check-planar-handback.mjs`**, now in `npm run check`. Every `setSource` must either hand
  planes back within six lines or carry a `planar-handback-ok` comment WITH the reason. Fifteen sites
  now state their intent.

**⚠️ The checker's first draft did not catch the bug it was written for** — it matched
`setSource(x.frameSource())` and the defect was `setSource(v)` on a `<video>`. The rule that works is
weaker and broader: **declare, don't pair.** Verified against the pre-fix file, where it flags line 393.

**Found and NOT fixed, filed in BACKLOG:** the external view's native-camera path still samples the
receiver's RGB canvas rather than its planes. Uncapped receiver, so it costs frame rate rather than
resolution.

**▶ NEXT:** the degraded state still only announces itself in the frame-cost panel. A performer whose
broadcast silently drops to 720p mid-set has no way to know, which is exactly the case Daniel's
rewritten exit criterion names. That is the first piece of visible work, and it is separate from this.

---

## ▶▶▶▶▶▶▶▶▶ B759 (2026-08-27) — THE BAKE ARC IS CLOSED. NEXT IS COLOUR.

**⚠️ `VERIFY-QUEUE.md` IS DANIEL'S DOC AND IS NOW SELF-CONTAINED.** It carries the arc summary, the
open tests (V1-V4) and the pressure-test scenarios. Do not make him bounce between files: **a fact he
needs to run a test belongs there, not here.** This file is the Claude-facing record.

### ✅ CLOSED THIS SESSION

- **The 4K bake failure — root-caused and fixed (B758).** `applyBakedClip` ran while every
  VideoDecoder still held its GPU surface pool, so the swap arrived with `deviceFreeMB` at ~127 and
  iOS purged the GPU process. Releasing first: **no context loss, 127 → 921MB free, 3.6× faster.**
  **Our footprint was 39MB against 5GB of headroom in both cases — never our memory ceiling.**
- **The `NotFoundError` / file-handle mystery — CLOSED.** `A3-take2.json` runs the identical
  bake→render sequence clean on `webcodecs-reader`. **It was collateral from the broken swap.**
  The suspend hypothesis is dead (`backgrounded: {count: 0}` throughout). R1b-b1/b2 dropped.
- **The B752 concurrency matrix — all six cells ran, nothing crashed from concurrency.**
- **Render bitrate — device-confirmed.** 74.6 Mbps / 782MB, Daniel: *"dramatically improved"*.

### 🐞 A REGRESSION I SHIPPED AND FIXED IN THE SAME SESSION (B757 → B759)

B753 pinned the record codec probe at 0.1 bpp "to keep the path byte-identical". **B757 then raised
the take to 0.30 and left the probe at 0.10**, so `isConfigSupported` validated 12.4 Mbps while
`configure` got 18.7 — WebKit throws on that, and the take silently drops to MediaRecorder (a 7KB
black file). **The lesson is in the comment: a justification stops being true the moment the thing it
justified changes.** Probe and configure now derive from one expression.

**And the reason was console-only**, so the report said `engine: "mediarecorder"` with no explanation.
`fallbackWhy` now rides the report.

### ▶ WHAT IS ACTUALLY NEXT, AND IT IS NOT MORE HARDENING

**Colour management's input transform.** Daniel: *"without this the app isn't super usable for real
output."* Three disagreeing colour paths, one of which hardcodes BT.601 on the native decode path.
Scoped and agreed — see BACKLOG. **Do not let the verify queue out-compete it.**

---

## ▶▶▶▶▶▶▶▶ WHAT WE BELIEVE WORKS NOW, AND WHY (B756, Daniel's ask)

**Read this before designing any gate.** The arc set out to build a capability ladder and
**measurement retired most of its rungs by fixing them.** What follows is what is believed to work,
the evidence, and the limit that actually remains. **Everything here was measured with ONE action on
a SHORT clip** — the pressure test is what turns "works" into "holds".

### 🚫 THE GATES WE THOUGHT WE NEEDED AND DO NOT

| gate we planned | why it is gone |
|---|---|
| **A memory / cost gate on bake** | `peakMB` is **72-132MB on every device at every clip length**; a 3.5x larger source cost 0.7MB more. The expression `sourceBytes + 2×outputBytes + 56MB ≤ free` has no varying term left |
| **A max-file-size gate** | The same 2.63GB file failed 3x and passed 2x on one device; the **741MB** file then failed too, after a suspend. **Size never predicted anything** |
| **A duration gate** | Nothing scales with clip length. It became a forecast — a number to say, not a refusal |
| **A "refuse 4K takes" rule** | 13.4 → **17.1 fps** post-B681, and it never crashed |
| **A "refuse record while broadcasting" rule** | **Both takes completed with no GL loss** (T3r). The B571/B667 cluster did not reproduce |
| **A device/SKU table** | Would have said *"2.63GB on M1 iPad: no"* and been wrong the same day |

**What replaced them is smaller and mostly honest LABELLING**: a forecast of time, a warning with a
measured cost, and one real binary (can we read these bytes).

### ✅ SCENARIOS BELIEVED TO WORK, WITH THE REASON AND THE REMAINING LIMIT

| # | scenario | evidence | limit that remains |
|---|---|---|---|
| 1 | **Broadcast a 4K clip to a 4K display, long-form** | T10: 6:39 clip, **50 min**, no context loss, 6ms worst wrap. **HDMI 4K re-learned at `delivered 30 / source 30`** over 1.47M samples (was 22/30) | none known. **This is the strongest thing we do** |
| 2 | **Render a 4K clip on an 8GB iPad** | A1: 3193 frames in **57.8s (55.2 fps)**, `peakMB` ~92, thermal nominal | needs the WebCodecs reader to arm — see limit A |
| 3 | **Render while broadcasting 4K** | A2b: **completed**, 31.2 fps | **costs 43% of render speed.** A forecast, not a refusal |
| 4 | **Record an FHD take** | T11: **46.6 fps**, paced to 30 at B754 | B754's picture fix is **unverified by eye** (R2) |
| 5 | **Record FHD while broadcasting 4K** | T3r: **23.6 fps, no GL loss, HDMI held 30/30** | **~49% of take fps.** Below 30 → warn. This is the WARNING case, not a refusal |
| 6 | **Bake a 4K seamless loop on an 8GB iPad** | B737: both iPads passed the job that killed them at B730. 741MB, `peakMB` 71.6-114.9 | **slow and fragile — see limit C.** The weakest link now |
| 7 | **Bake / render a 2.63GB, 8:21 4K source** | B751: **clean, 55.6 fps, 270s**, `peakMB` 92 | works when the handle is alive — limit A |
| 8 | **Render at 8K on desktop** | completed at 35 fps, 6.25GB out | **quality tiers above `draft` are inoperative at 8K** (120 Mbps ceiling), and now say so |

### 🚧 THE LIMITS THAT ACTUALLY REMAIN — four, and only one is a hard stop

**A. THE FILE HANDLE DIES, PROBABLY ON SUSPEND. ⭐ The only true blocker.**
`suspended` in the trail, then `NotFoundError` on the **741MB** file. Not size, not duration — a
lifecycle event. Everything that re-reads the original `File` minutes later (bake, render, the
WebCodecs reader) is exposed; broadcast is not, because native decode copies the bytes at attach.
**VERIFY-QUEUE R1 settles it in one 2-minute test, and it makes the OPFS decision.**

**B. SESSIONS ARE NOT RELEASED, AND IT ACCUMULATES.**
Peak **`decode 7`**, `acquired 9 / released 3`, with **three Loop Builder decoders alive 940s later**.
A take also creates a second GL context (`output/bus engine`) that `output-engine.js` never releases.
**Not yet shown to CAUSE a failure** — every cell that reached `decode 7` still completed — but it is
the leading explanation for B750's crash and it is what makes long sessions differ from short ones.

**C. ✅ MOSTLY FIXED B758 — THE BAKE'S FAILURE WAS THE HANDOFF, NOT THE BAKE.**
`applyBakedClip` ran while every VideoDecoder was still held, so the swap — the largest GPU
allocation in the operation — arrived with device-free at ~127MB and iOS purged the GPU process.
Releasing before the swap: **4K bake clean, `deviceFreeMB` 127 → 921, and 3.6× faster.**
**What remains:** on failure it still raises `alert()` (blocking, measured up to 1827s), and a GL
loss still costs the whole app SESSION even though the contexts themselves recover in ~474ms.
**558s for a 1:46 clip.** On failure it raises `alert()`, which blocks everything (measured 243s,
289s, once **1827s**) — and now blocks scripted runs too. It also leaves `heldMB 55.6`. **Of the
eight scenarios above, this is the one to pressure-test hardest.**

**D. 4K TAKES RUN AT 17.1 fps.**
Structural, not a stall (`wallVsSpan` 0.3). Pacing bought ~35% headroom but did not fix it. The
record path has **no per-stage timing split** like the render's `gl / vframe / enc`, so nothing can
say where the time goes. **Instrument before optimising.**

### 🎯 HOW TO PRESSURE-TEST THIS (Daniel, 2026-08-27)

Everything above came from **single actions on a short clip from a fresh launch**. The interesting
failures will not. **Bias toward long, mixed, unattended sessions:**

- **Let the device suspend mid-session** — that is limit A, and it is the highest-value thing to
  provoke deliberately.
- **Chain operations without relaunching**: load → broadcast → bake → load another → render. That is
  limit B, and `sessions.peak` is the readout.
- **Use a long clip** (6:39 or the 8:21) rather than the 1:46, so slow paths have room to diverge.
- **Watch the output FILES, not only the reports.** The bitrate defect was invisible in every report
  and obvious at 100% zoom.

**Anything that fails here is worth more than another clean single-action run.** Copy the report at
the moment of failure — and if the app dies, `priorTrail` survives the kill and is the whole point of
B751's breadcrumbs.

---

## ▶▶▶▶▶▶▶ B754 (2026-08-27) — RECORD PACING. THE ENCODER WAS LIED TO ABOUT ITS FRAME RATE.

**Takes now hold their declared 30fps.** The encoder was configured `framerate: 30` while the
rAF-driven output bus handed it **46.6**, so every frame got ~64% of its budgeted bits.

```
FHD  12.4 Mbps / 46.6 fps = 0.129 bits/px    (starved — what Daniel saw)
4K   40.0 Mbps / 17.1 fps = 0.282 bits/px    (2.2x better, which is why 4K LOOKED better)
```

**FHD effective quality 0.129 → 0.200 bits/px, no bitrate change, no file-size change, and ~35% less
encoder work.** Harness `record-pacing-check.mjs` 20/20.

**⚠️ NEEDS A DEVICE RE-MEASURE:** re-run `t11-take-baseline` and compare against
`01-t11report.json`. Watch the new `pacedOut` vs `droppedToBackpressure` — **they must never be
added together.** A large `pacedOut` with zero drops is healthy.

**⚠️ 4K record's 17.1 fps is UNTOUCHED.** That is throughput, not bitrate. Pacing buys it headroom
and does not fix it.

**No record quality selector yet, by agreement** — its tiers must be picked against post-fix numbers.

---

## ▶▶▶▶▶▶ B753 (2026-08-27) — RENDER QUALITY WAS THE PROBLEM ALL ALONG

**Daniel compared a render against a live broadcast at 100% and found heavy macroblocking.** Cause:
`videoBitrateFor` was a hardcoded **0.1 bits/px/frame = 24.9 Mbps at 4K30**, from a **55.8 Mbps
source**. The broadcast looked better because **it has no encoder in the path at all.**

**Shipped:** a `draft/good/high/max` quality picker (0.10/0.20/0.30/0.45 bpp), **default now
`high`**, with live bitrate + estimated file size, unreachable tiers disabled by name, and the 4GB
zip extras gated up front. Harness `bitrate-tiers-check.mjs` 26/26.

**⚠️ THE A/B HAS NOT BEEN RUN.** `draft` vs `high`, same clip, on the Mac. **The diagnosis is well
evidenced and the fix is not yet verified.** Do this before trusting the new default.

**⚠️ RECORD IS UNTOUCHED ON PURPOSE.** Separate formula (`min(40 Mbps, w × h × 6)`, no fps term), and
its codec probe is pinned at 0.1 so nothing moved. FHD takes at 12.4 Mbps are the obvious next win.

### 📊 THE B752 MATRIX SO FAR (M1 iPad Pro, IMG_5132 741,685,378 bytes)

| run | result |
|---|---|
| **T11 record baseline** | **FHD alone 46.6 fps** (healthy, never measured before) · **4K alone 17.1 fps** (was 13.4 pre-B681) |
| **A1 render control** | 3193 frames, 57.8s, **55.2 fps**, `gl 1` — matches B751's 55.6 |
| **A2b render while broadcasting** | **completed**, 102.4s = **31.2 fps** (−43%), `gl 1`, no crash |
| **A2 broadcast then render** | completed, 20.3 Mbps out |
| **T3r take while broadcasting** | ⭐ **BOTH COMPLETED, NO GL LOSS.** A (broadcasting) **23.6 fps** · B (alone) **46.4 fps** — a 49% cost, and B replicates T11's 46.6 exactly |

**HDMI 4K re-learned at `delivered 30 / source 30`** over 1.47M samples, up from T10's 22/30.

**⭐⭐ GATE 3 IS ANSWERED: RECORD-WHILE-BROADCASTING NO LONGER FAILS.** The B571/B667 cluster
(*"arming a take while broadcasting loses the GL context"*) **did not reproduce**. `sessions.peak`
`{gl 2, decode 3, encode 1}`, conserved, HDMI held 30/30 throughout. **B681 fixed it.** So the
"refuse" rule has no evidence behind it any more — the honest response is a WARNING carrying the
measured cost (~49% of take fps), which is Daniel's stated product direction anyway.

**⚠️ A HYPOTHESIS I HAD TO CORRECT: HDMI broadcast does NOT create a second GL context** (the
external view renders in its own process). **A take does** — `output/bus engine`, and
`output-engine.js` has no `.release()` at all. So B750's `gl: 2` came from a bus-side consumer, not
from HDMI, and **A2b was not the cell that reproduces it.**

---

## ▶▶▶▶▶ READ THIS FIRST — B752 (2026-08-26)

**SHIPPED: the scenario runner can now drive a render and a bake**, so the concurrency matrix runs
itself. Four new scripts (A1, A2, A2b, A3) plus `docs/temp/scenario-preflight.mjs` at 272/272.

**▶ THE NEXT ACTION, AND IT NEEDS NO BUILD:** run **`t11-take-baseline`** from the frame-cost panel.
It is the record gate's control condition, written at B665, never run. Load the **741MB / 1:46 4K**
clip (not the 2.63GB one — that conflates record capability with the file question), no HDMI needed.
Then **A1**, from a force-quit relaunch, with whichever source you want held constant across A1/A2/A2b.

**`PLAN-LIVE-READINESS.md` was rewritten with Daniel and is now the authoritative scope.** It carries
the revised close-out sequence, the stage-manager spec, and two things that were only in session
history: the fragmented gating/communication spec, and battery as the second face of thermal.

**Three findings from reading, none device-confirmed, all in the plan:**

1. **⭐⭐ `shell/scenario-runner.js` HAD EXISTED SINCE B665, and `t11-take-baseline` is the record
   gate's control condition, already written and never run.** FHD take alone, then 4K take alone,
   its own comment reading *"the 13.4fps figure, re-measured"*. It runs on B751 as shipped, from
   `run scenario` in the frame-cost panel. **This is the cheapest unblocked action in the project**
   and it needs no build.
2. **🎨 `engine/yuv.js` hardcodes BT.601 YUV-to-RGB coefficients** (`1.402 / -0.344136 / -0.714136 /
   1.772`), with no transfer function and no primaries. That is the NATIVE DECODE path — in-app
   playback and broadcast on iPad — and nearly all HD/4K video is BT.709. Neither native plugin
   reads `kCVImageBufferYCbCrMatrixKey`. The full-range assumption IS correct (both plugins request
   `420YpCbCr8BiPlanarFullRange`). **So the app has three disagreeing colour paths**, which likely
   explains Daniel's *"thumbnails in perform mode seem to look better than the rest of the app"*.
3. **The B747 render path did NOT touch broadcast.** Verified: `updateSourceFromFrame` has exactly
   one caller, guarded by `exportReader`, which is non-null only inside a render.

**⚠️ The size hypothesis is dead and the replacement axis is CONCURRENCY.** B750 crashed with
`gl: 2` after a broadcast; B751 completed with `gl: 1` from a fresh launch, same file, same device.
n=1 each. **Do not build the OPFS source copy until the matrix runs.**

---

## ▶▶▶▶ STATE AT B751 — 4K END-TO-END WORKS ON AN 8GB iPAD

**`B751-ipadRenderReport.json`** — the 2.63GB / 8:21 4K clip, M1 iPad Pro, rendered **clean**:

| | before B747 | **B751** |
|---|---|---|
| rate | 28 fps | **55.6 fps** (270.2s for 15,019 frames) |
| `upload` | 35.16 ms/frame | **0.48 ms** |
| `peakMB` | — | **92.1** |
| thermal | — | nominal → nominal |
| `availableMB` | — | 5074 → 5073 |

Remaining cost is `vframe` 9.64ms and `enc` 4.98ms — both platform, neither ours. **Breadcrumbs
fired as designed**: `render:begin · progress ×3 · encoded · render-decode-worst`.

### ⭐ THE ARC'S QUESTION, ANSWERED — AND THE ANSWER IS "MOSTLY NOT WHERE WE THOUGHT"

The goal was to find our limits and build a ladder. What the measurements produced instead:

- **Memory: dissolved.** 72-132MB on every device at every clip length. There is no curve to gate on.
- **Thermal: not a limit yet.** `nominal` across 530s and 270s fanless, twice.
- **Duration: not a limit, a forecast.** ~1.48× realtime on an M1 iPad before B747; far better now.
- **Render speed: was ours, and is fixed.** One `texImage2D` of a 2D canvas was 89% of a render.
- **File access on iOS: real, and NOT gateable by size.** See below.

**Most of the ladder we set out to build turned out not to be needed.** That is a legitimate result.

### 🚫 THE FILE-ACCESS FAILURE IS TRANSIENT, SO A DEVICE TABLE CANNOT ENCODE IT

The same 2,629,310,897-byte file on the same iPad Pro: **failed three times** (B741 fetch, B742
blob-passthrough, B743 render) and **succeeded twice** (B750 probe at 4ms, B751 full render). A table
keyed on chip + memory + platform would have said *"2.63GB on M1 iPad: no"* and been **wrong today**.

**Leading hypothesis: an iOS security-scoped file handle being revoked** some time after the pick.
It fits everything — works at load, works for broadcast (native decode copies the bytes at attach),
fails at bake and render which re-read the original `File` minutes later.

**⭐ THE FIX IS NOT A GATE, IT IS OWNING THE BYTES.** Copy the source into storage we control at load
and read from there, so the sandbox handle stops mattering. **Precedent exists in this repo**:
`conduit/recorder.js` already streams takes to OPFS, feature-detected, Safari 17+ / iOS 17+. On iOS
we ALSO already copy the whole file to the native plugin for decode, so part of that cost is paid.
**Unmeasured: what a multi-GB OPFS copy costs in time and disk.** Decide before building.

### 🚩 REPRODUCIBLE, UNEXPLAINED

**The source/output panels show the image UPSIDE DOWN** — twice now, on the iPad, at load, before any
render. Every `UNPACK_FLIP_Y_WEBGL` in the codebase is set to `false` consistently
(`gl.js` ×2, `yuv.js`), so a leaked pixelStorei is **not** it. B747's direct upload only runs inside
a render, so that does not fit either. **No instrument fired. Do not guess again** — the cheap
localiser is whether scrubbing corrects it (which would make it the same family as the
black-panels-after-bake bug: a bad first paint, not a bad pipeline).

---

## ▶▶▶ STATE AT B743 — TWO AXES, NOT ONE

**The O(1) memory work is VALIDATED and it revealed a SECOND constraint we did not know existed.**

| clip | M5 Max | M1 Max | iPad Pro | iPad Air |
|---|---|---|---|---|
| **741MB · 1:46 · 4K** bake | ✅ 131MB | ✅ 131MB | ✅ **103MB** (B742) | ✅ 72MB (B737) |
| **741MB** render | — | — | ❌ never tried | — |
| **2.63GB · 8:21 · 4K** bake | ✅ 132MB | ❌ never tried | 🚫 **file unreadable** | — |
| **2.63GB** render 4K | ✅ | ✅ 104MB (B740) | 🚫 **file unreadable** | — |
| **2.63GB** render 8K | ✅ 35fps, 6.25GB out | — | — | — |

**AXIS 1 — MEMORY. Solved and proven.** `peakMB` is 72-132 everywhere, for every clip length, and a
3.5× larger source costs 0.7MB more. Nothing here scales with duration.

**AXIS 2 — FILE ACCESS ON iOS. New, and it is where we now fail.** The 2.63GB File reports
`size: 2,629,310,897` and throws `NotFoundError` on `slice(0,16).arrayBuffer()`. **By both routes** —
`fetch` (which took 7.5s and then died) and the B742 `File` passthrough. The `<video>` element plays
it happily, so this is random-access-from-JS being refused, not a broken file.

**The 741MB control on the SAME build and device reads fine** (`via: blob-passthrough`, `armed: true`,
`moovBytes: 97273`), which makes SIZE the strong hypothesis and staleness unlikely. **The wall is
unbracketed: somewhere between 741MB and 2.63GB, and nobody has looked.**

### ⚠️ WE HAVE NEVER SEEN A GOOD iPAD RENDER

Both iPad renders ran on the element-seek fallback because the reader never armed. **Every quality
complaint Daniel has made about iPad renders describes the fallback, not the render.** The 741MB clip
now arms on iPad — **rendering it is the cheapest unrun test we have** and the only way to learn
whether iPad render quality is actually a problem.

### 📋 SHIPPED BUT NEVER EXERCISED

- the zip refusal's **split-save fallback** (the refusal itself is harness-proven, 6/6)
- the **loop assertion** on slice/bounce (B740)
- **`captureForce2d`** (B742) — the capture-path A/B
- **`holes` thresholding** — ships as `holes: 0, holesRounding: 0`, has not yet distinguished anything

### 🚫 STILL ZERO EVIDENCE

- **The iPad Air crash.** Two crashes, empty trail both times. A process kill takes the trail with it.
- **8K render memory anywhere** — the one 8K run predates B739's instrument.

### ⚖️ PROCESS — THE HARNESS IS A VALID DEVICE PROXY, SO INSTRUMENT BUGS MUST NEVER REACH A DEVICE

`docs/temp/gate-preflight.mjs` imports the REAL `video-decode.js` and asserts every field the report
promises, including the two that B741 claimed and silently did not ship. **25/25.** Its numbers match
the device to the byte — `moovBytes 97273`, `frames 3192`, identical in the harness and in
`B742-ipadprobake.json`. **There was never a reason to learn instrument correctness on hardware.**

**Standing rule: run `gate-preflight.mjs` and `realfile-demux-check.mjs` before any device session
that will read a source.** Promoting them into `tools/` alongside `check-dupe-keys.mjs` is a decision
for Daniel — they need a real file on disk, so they cannot join `npm run check` unchanged.

---

## ▶▶ READ THIS FIRST — STATE AT B737

**`PLAN-LIVE-READINESS.md` owns the sequence. `VERIFY-QUEUE.md` owns the open tests. This file is
current state only.** Builds 705-737 are in [`archive/HANDOFF-builds-705-737.md`](archive/HANDOFF-builds-705-737.md),
whose header carries the one-table summary of what the arc established.

### ✅ WHAT PHASE 2 HAS CLOSED

**The exit criterion was met at T10** (2026-08-21): a 6:39 4K clip broadcast 4K over HDMI for 50
minutes, cold start, `outcome: complete`, no context loss, 6ms worst loop-wrap gap.

- **GL context loss is understood and survivable.** All five surfaces watched by one module
  (`shell/gl-watch.js`) with four distinguishable outcomes. Four *"recovery path that cannot start
  itself"* bugs found and fixed (B703, B706, B708, B709). **Provoked losses A1-A4 all recovered in
  399-541ms**; organic ones in 29-650ms.
- **Loss is provokable on demand** — frame-cost panel, surface picker, arm-and-delay.
- **The bake's decode stall** was a hole in the presentation timeline the wait loop could not leave (B721).

### ⭐⭐ THE OPEN THREAD: THE BAKE'S MEMORY CEILING

**Cost is a property of the JOB; the ceiling is a property of the DEVICE.** Proven at B730-B731: one
741MB 4K clip, vanilla slice bake, `peakMB` **identical to 0.1MB on four machines** — and both Macs
passed while both iPads failed, the 8GB Air earlier than the 16GB Pro.

**The gate expression, every term known before the bake starts:**

```
sourceBytes + 2 × projectedOutputBytes + ~56MB   ≤   deviceFreeMB at start − ~250MB floor
```

**Resolution's direct cost is ~56MB at 4K — noise.** The permutation table Daniel asked for collapses
from 3-D (resolution × duration × bitrate) to **2-D (source bytes × output bytes)**. The ~250MB floor
is measured: the M1 iPad Pro died at 220MB and 261MB free on two different builds.

**⚠️ The budget is NOT a per-model constant.** The same iPad Pro started at 1259MB and 1065MB free on
two runs. **Publish a table; gate on the live reading.**

### 🧾 THE REDUCTION LEDGER

| change | status | term it removes | measured |
|---|---|---|---|
| release `buf` after demux | B728 | — | — |
| one fetch + one sample table for slice | B732 | half the source term | 2143 → 1441MB |
| muxer streams to disk-backed Blob parts | B734, fixed B736 | **output** | heap holds one write (≤16KB) |
| demux parses the moov only, indexes the original Blob | B735, fixed B736/B737 | **source** | **1404MB → 0.2MB (desktop + both iPads)** |

**Source memory is now O(1) in clip length by design.** That is the order change; everything before
it changed the constant.

### ✅✅ B737 CONFIRMED ON DESKTOP — THE O(1) BAKE WORKS. 16× LESS MEMORY, SAME SPEED.

**`B737-M1maxMBP-baketest.json`, M1 Max, the 741,685,378-byte original, vanilla slice:**

| | B729 | B731 | B732 | **B737** |
|---|---|---|---|---|
| `peakMB` | 3188.5 | 2143.2 | 1441.1 | **130.9** |
| bake time | 34.5s | — | — | **33.8s** |

`peakBy: { frames-held 83.1, capture-canvas 31.6, encoder-output 16, sample-index 0.2 }`.
**`sample-index` at 0.2MB is where a 1404MB sample table used to be.** `heldMB: 0` after teardown.
`decoded 113 · via cover · holes 1` — **identical work to B730/B731**, so nothing was traded for the
saving.

**⭐ THE SHAPE HAS CHANGED, NOT JUST THE NUMBER.** Every remaining term is driven by RESOLUTION or is
a constant:

```
peak ≈ frames-held + capture-canvas + encoder-output + index   ≈ 131MB at 4K, any clip length
```

**Nothing left scales with the clip.** Against a measured iPad budget near 850MB that should pass at
any duration, which is the categorical result the arc was after. **Worst case is bounded too**: the
frame queues cap at 12 per reader, so `frames-held` cannot exceed ~300MB at 4K.

### ✅✅✅ B737 DEVICE-VERIFIED — BOTH 8GB iPads PASSED THE JOB THAT KILLED THEM AT B730

`B737-ipadPro.json` / `B737-ipadAir.json`, same 741,685,378-byte original, vanilla slice, run in
parallel. **Both `srcBytes` read 741685378 — the right file.**

| | M1 iPad Air 8GB | M1 iPad Pro 8GB | M1 Max MBP |
|---|---|---|---|
| B730 (same clip) | **FAIL, GL lost frame 88/3178** | **FAIL, GL lost frame 181/3178** | pass |
| B737 `peakMB` | **71.6** | **114.9** | 130.9 |
| B737 bake time | **155.9s** | **157.3s** | 33.8s |
| holes / timedOut | 0 / false | 0 / false | 1 / false |
| `heldMB` after | 0 | 0 | 0 |
| thermal | nominal → nominal | nominal → nominal | — |

**Three findings that change what we build next:**

1. **⭐ `deviceFreeMB` IS NOT A VALID GATE INPUT.** The Air began its bake with **`freeBeforeMB: 101`**
   and passed cleanly. Free was 896 on the Pro and 101 on the Air for the same job on the same OS.
   **The gate must read `free + reclaimable`** (2939 on the Air, 3666 on the Pro — those are
   comparable), or it will refuse jobs that work. This corrects the gate expression in
   `PLAN-LIVE-READINESS.md`.
2. **The two iPads are the SAME SPEED** (155.9s vs 157.3s, 0.9% apart). The Pro's extra GPU cores
   and bandwidth bought nothing, so **the bake is media-engine bound, not GPU bound.** The M1 Max's
   4.6× is its second encode engine plus memory bandwidth. **Practical read: the bake ladder is a
   CHIP-CLASS ladder, not a model ladder** — every M1/M2/M3 base chip will behave like these two.
3. **`peakBy` composition is device-dependent within the bound.** `frames-held` was 83.1MB on the Pro
   (≈7 queued 4K NV12 frames) and 23.7MB on the Air (≈2). The queue depth is a scheduling outcome,
   not a constant — which is why the CAP (12/reader) is the number to gate on, not the observed peak.

**⚠️ AND WHAT THE DEVICE NUMBERS DO NOT SAY.** On the Pro, device-wide `free + reclaimable` went
3666 → 2076 across the bake — **~1.6GB moved while our ledger peaked at 115MB.** Most is file cache
(reclaimable, healthy) and GPU-process VideoFrames (a process we cannot read), but **we have not
attributed it and must not claim we measure everything.** The categorical result still stands,
because the term we removed was the one that scaled with clip LENGTH and this one does not.

### 🚩 THREE CEILINGS THE B737 WORK DID NOT TOUCH (found by reading, 2026-08-24)

1. **✅ FIXED B738, VERIFIED SAME DAY — the 1.5GB source cap is now `sourceBudget()`**, computed from
   `os_proc_available_memory()` on iOS (5014MB on the Air, 5093MB on the Pro — stable, and it scales
   to hardware that does not exist yet), `navigator.deviceMemory` on Chromium, a generous default on
   desktop. **A 2.63GB source peaked at 131.6MB.** Still unverified: anything past 2.63GB, and the
   iOS branch of `sourceBudget()` has never run (both desktop reports took the Chromium branch).
2. **Still export is the one remaining single-shot spike, and it is unledgered.** `exportAt`
   ([engine/index.js:444](../src/engine/index.js#L444)) holds THREE full-res RGBA copies at once —
   `pixels` from readPixels, `imgData.data`, and the canvas backing store — plus the GPU FBO.
   At 8192 that is 268MB × 3 ≈ **805MB transient**; at 16384, **3.2GB**. The phone chrome already
   hardcodes 6144 because of a field jetsam ([mobile/chrome.js:2790](../src/mobile/chrome.js#L2790)).
   **Desktop chrome still offers 8K and `max`, and the iPad runs desktop chrome.** The FBO probe
   round-trips ONE pixel, so it cannot see the three-buffer peak. Flagged, not fixed.
3. **The output Blob is a STORAGE ceiling now, not a memory one, and is untested.** 4K30 bakes at
   `w×h×fps×0.1` = 24.9 Mbps → 1.87GB for 10 minutes. Nothing measures whether the share sheet,
   the Files write, or the reload survives that.

**▶ NEXT: the reference-point runs** (`VERIFY-QUEUE.md` R2) and **the gate**, which is what closes
phase 2.

### 📌 SMALL KNOWN GAP, NOT WORTH A BUILD ON ITS OWN

`parse-window` never appears in `peakBy` — the moov is read and released before the peak, so the term
is invisible rather than small. **The moov's size is therefore unreported.** Fold `moovBytes` into
`bakeShape` next time that file is open.

### 🐞 OPEN, WITH CONCRETE REPROS

- **🚨 A bake failure freezes the app behind `alert()`.** Measured `dialog-blocked` of 243s, 289s and
  once **1827s (30 minutes)**. Filed since B707; **the worst operator-facing defect in the arc.**
- **After a successful bake the panels stay black until you scrub** (Daniel, B736 iPad). Source panel,
  output panel and all thumbnails but the last. **`applyBakedClip` swaps the source without
  repainting.** B733 fixed the GL-restore path; this is the swap path and it is separate.
- **The residue is not a retained reference.** `heldMB: 0` and `openHandles: 0` after teardown on four
  machines. If it is real it is GC latency or engine-side. **D5 (three bakes in one launch) settles
  it and needs no build.**
- **`resetSession` is not a true reset** — confirmed by reading. It rebuilds GL contexts and never
  touches decoded buffers or muxer output; only its `location.reload()` fallback frees them.

### 🎯 THE TARGET, IN DANIEL'S WORDS (2026-08-24)

**Loops are typically 2-6 minutes**, many under 2, a handful 8-12+. **10-minute 4K is the upper bound
of normal use, not a floor.** *"If our honest hardware limit is half that, we still can offer robust
4K support for M1 class devices, just for smaller files."*

**Hitting the common durations on M1 + 8GB is NON-NEGOTIABLE.** 4K at those durations would be
*"amazing"* but is defensible to miss **if the implementation would cost performance or stability.**
**M1 + 8GB is the single biggest Apple-silicon market share** (the M1 MacBook Air — which we do not
own; the 8GB iPad Air is our only proxy).

**Quality beats reach.** *"Our settings should bias toward higher quality with honest constraints
instead of silently doing things like how photos dropped to 8bit without telling us."*

**The bake output is a PRODUCT**: it must be durable and open cleanly in other tools (Arena). That
rules out moov-at-end and fragmented MP4 as memory tactics, and it is why B734's Fast Start is
preserved and byte-verified against the target we have always shipped.

### ⚠️ "SAME CLIP" HAS BEEN WRONG TWICE — CHECK `srcBytes` FIRST, ALWAYS

Photos hands out a **lower-bitrate re-encode**: same 3840×2160, same 106.45s, same 30fps, **45% of
the bytes** (the original is `hvc1.2.4`, HEVC Main10 10-bit; Photos exports 8-bit). **AirDrop is not
enough** — iOS files it into Photos. The original must travel via Files.

**Every historical "the iPad handles 4K" result is suspect**, T10 included (its source was 25.1 Mbps).
**T10's conclusion survives anyway**, because broadcast does not demux into the heap: it held a 1.25GB
4K source for 50 minutes. **Playback memory is O(1) in file size; the bake's was not.**

### 📏 PROCESS — the two rules that actually saved time this arc

1. **Desktop first. A device session costs ~9 minutes** (`DEVICE-TESTING.md`). Both B735 and B736's
   failures were visible on the Mac.
2. **Ask the library, do not model it.** B734 and B735 each shipped a wrong assumption about
   mp4-muxer and mp4box. **`scratchpad/muxwrite-check.mjs`, `muxassemble-check.mjs` and
   `mp4box-moov-check.mjs` each cost ten minutes and each would have prevented a device session.**

### ⚠️ Owed a device pass

- **B703** — source freeze after a GL restore (motion → perform repro). Folded into VERIFY-QUEUE A5.
- **B704** — reset canvas should EASE the pan; set a slow transition speed in perform mode.
- **A4, A6, A7** — `yuv-source`, `output`/`live-pip` and `external` have never been deliberately
  provoked. All four early attempts hit `preview`.

---

## ▶ where the rest of the history went

This file is **current state only**. It stopped being that some time around B660 and had grown to
1,305 lines of build narrative by B704, at which point it held a red "PICK UP HERE" marker for work
that had already shipped.

| you want | read |
|---|---|
| what to do next, and why in that order | `PLAN-LIVE-READINESS.md` |
| every open bug, investigation and idea | `BACKLOG.md` |
| what shipped, build by build | `CHANGELOG.md` |
| the phase 2 narrative as it was written | `archive/HANDOFF-builds-607-704.md`, then `archive/HANDOFF-builds-705-737.md` |
| how the codebase is put together | `ARCHITECTURE.md` |
| how to decide what to measure | `DEBUGGING-PROTOCOL.md` |
| how to get a reading off a device | `DEVICE-TESTING.md` |

**Keep it that way.** A finding that is resolved belongs in CHANGELOG; a finding that is open belongs
in BACKLOG. This file holds the handful of things a cold session needs in its first five minutes.

---

## historical record

**Builds 705-737 (the memory-ceiling arc) live in [`archive/HANDOFF-builds-705-737.md`](archive/HANDOFF-builds-705-737.md).** Moved out at B737 — it was 780 of this file's 809 lines and had accumulated eleven "SUPERSEDED" blocks. Its header carries a one-table summary of what the arc established.

**Builds 607-704 (the phase 2 pressure-testing arc) live in [`archive/HANDOFF-builds-607-704.md`](archive/HANDOFF-builds-607-704.md).** Moved out at B704 — it was 1,200 of this file's 1,305 lines and had begun contradicting itself. Its header lists what was rescued and where each piece went. Builds 223-607 are in [`archive/HANDOFF-builds-223-607.md`](archive/HANDOFF-builds-223-607.md).

Builds 19–187 (early kaleidoscope through Fold Live Phase 0) live in [`archive/HANDOFF-builds-19-187.md`](archive/HANDOFF-builds-19-187.md). Moved out at B547 — it was half this file and two of its sections actively misdescribed current state. Everything still live was rescued to BACKLOG first; the archive header lists exactly what.

## decisions locked in

- **License:** AGPL-3.0, copyright Daniel Nelson. The author retains rights to commercial licensing. This was chosen over MIT to discourage forking-as-competitor while keeping the code openly viewable.
- **Repo:** public.
- **Build counter convention:** monotonic global, never resets on version bump.
- **Docs structure:** `README.md` at root, `docs/HANDOFF.md` `BACKLOG.md` `CHANGELOG.md` `ARCHITECTURE.md`.
- **Form ID is a string** (not numeric index) everywhere. Don't reintroduce numeric form indexing.
- **The `env` runtime container** is the seam between shell modules. Don't add module-level mutable globals; thread state through `env` instead.

## decisions deferred

- **"Scale to tile" canvas zoom snap.** Build 19 conceptual analysis concluded it's feasible only for square output, but Daniel reports visually-repeating patterns appearing at certain zoom-out levels and wants to revisit. Deferred until someone has time to investigate with screenshots. See `BACKLOG.md`.
- **Monetization approach.** Full narrative and phased plan now in `docs/FOLD.md` under "monetization paths." The AGPL license preserves all options.

## what to avoid

- **Don't reset BUILD when bumping VERSION.** It's a monotonic global counter. Read the comment in `src/version.js` if unsure.
- **Don't put backticks inside form GLSL strings.** The `glsl` field in form modules is a JS template literal; a backtick inside breaks parsing silently. The original monolith had a long-running bug from this. (Mentioned in `ARCHITECTURE.md` too.)
- **Don't assume Daniel sees what you describe.** He's caught Claude hallucinating UI elements before (e.g. a "Clip" transport mode option that didn't exist in his Resolume version, in another project). When describing Resolume / Vercel / VS Code UI, be tentative and defer to what he actually sees on screen.
- **Don't introduce new mutable module-level state in shell modules.** Thread it through `env` instead. The `_windowHandlers` and `_overlayDrawPending` patterns from the original monolith have already been ported to env-based equivalents.

## environment / hardware

Refreshed 2026-08-18 docs (Daniel's own list, and the previous version was missing the M1 Max and collapsed two different iPads into one line). **Phase 2 is a hardware question, so this section is now an instrument: what we can measure on, and what we CANNOT, stated so a gap never gets mistaken for a clean bill of health.**

### In hand

| device | why it matters to phase 2 |
|---|---|
| **M1 iPad Pro 12.9", 1TB (16GB)** | the phase-2 workhorse; every report so far is from this. The 4K/4K crash is ITS ceiling, not "iPad's". |
| **M1 iPad Air (8GB)** | **the controlled A/B on the one named open risk.** Same silicon, half the memory. The only pair we own that isolates memory from GPU generation. |
| **iPhone 14 Pro** | outperforms the 17 Pro on the sustained record path and nobody knows why (CAPABILITIES.md — the reason for "probe, never classify"). |
| **iPhone 17 Pro** | current-gen ceiling. |
| **M1 Max MBP, 64GB** | the demanding-desktop-workflow target. **Not a stand-in for a low-power Mac** — see the gap list. |
| **M5 Max MBP, 64GB** | current-gen desktop ceiling; the Syphon benchmarks in the archive are from here. |
| **Movink touch display + second monitor** | perform-mode ergonomics rehearsal rig. |
| **Akai APC40 MK2** | Perform mode / control bus. |
| **HDMI dongle (new, since 2026-08-18 docs)** | ⚠️ **A MEASURED VARIABLE, NOT A CONSTANT.** It moved `delivered` 24 → 29 and `UNEVEN` → `steady`. **Pin it in any comparison against a pre-2026-08-18 docs report.** |

### NOT in hand — and what each one would answer

**These are gaps in the evidence, not "untested platforms".** Naming them stops the in-hand devices from being read as representative.

- **iPhone 12 mini / SE2** — *the floor of "modern".* **The most valuable single gap.** Without it, the 14 Pro is our weakest phone, and a graceful-degradation path tuned against a 14 Pro almost certainly does not degrade far enough. Everything we call a "mobile default" is currently an untested guess below the Pro tier.
- **Non-Pro iPhone 13 / 14 / 15** — the actual volume hardware. No ProMotion, fewer GPU cores, smaller thermal envelope than the Pro of the same year. **Our two phones are both Pros**, so the entire non-Pro column is unmeasured.
- **M2–M5 MacBook Air** — *the realistic desktop user.* **The M1 Max is a bad proxy in the wrong direction on every axis at once:** more GPU cores, 64GB, and a fan. An Air is fanless, memory-constrained, and thermally throttled — **the one Mac configuration where the iPad's failure modes could plausibly reappear on desktop**, and the one we cannot see.
- **A non-Apple-silicon path** — Windows/Intel/AMD. Out of scope by Daniel's stated goal (Apple-silicon parity), recorded so its absence is deliberate rather than forgotten.
- **A second DualSense** — the shared vendor-product device key was reasoned about at B650 and never exercised with two identical pads.

**▶ THE RULE THIS TABLE EXISTS TO ENFORCE:** we own the top of the range and none of the bottom. **Every ceiling we measure is a ceiling for good hardware.** Gates must therefore be computed from what the device reports at runtime, never from a table of models — which is also Daniel's stated requirement.

## context from prior sessions worth preserving

Daniel was learning Resolume in parallel with the early kaleidoscope work, and there's a separate `drift` project (a video-art PWA) that shares some architectural DNA but is unrelated functionally. The handoff for Drift mentions "plans to open-source on GitHub" but no license was actually picked there — kaleidoscope is the first of his projects to land on AGPL-3.0 explicitly.

If Daniel asks Claude to look at Drift or Zoetrope (another project of his), they're available in the project knowledge as separate handoff docs.

