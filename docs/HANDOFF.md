# handoff

This document is for whichever Claude session picks the project up next. **It is the rolling source of truth** for project state, recent decisions, and what's queued. Edit it as the project evolves; archive snapshots if you want history (or rely on git).

If you're a Claude reading this for the first time in a new session: read this entire doc, then `BACKLOG.md`, then skim `ARCHITECTURE.md` if relevant to what Daniel is asking about. `CHANGELOG.md` is per-version detail you usually don't need.

## who & what

Daniel Nelson is building a browser-based kaleidoscope tool for high-resolution still-image output. He's a VJ (Resolume Arena + Akai APC40 MK2), technically savvy but identifies as a non-developer. He's iterative, evidence-based, and methodical — runs builds locally, reports back specifically with what works and what doesn't, catches Claude's UI hallucinations.

He prefers **no em dashes** in any prose Claude generates for him.

## ▶▶ THE PLAN NOW LIVES IN `PLAN-LIVE-READINESS.md` (written B609, Daniel's ask)

**Read that file first.** It owns the goal, the sequence, the real dependencies between items, and the stopping rule for each one. It also records the pause point for the stage-manager arc and what is explicitly out of scope.

**What changed at B609:** input normalization was promoted to item 1.5 and scoped as architecture rather than triage; B609 verification is closed; and the six-item plan was superseded as a *sequence* (archived at B658 — see below). **Read `PLAN-LIVE-READINESS.md` for what to do next, and `BROADCAST-DELIVERY.md` for why item 1 and the loop hold are settled.**

## ▶ the superseded six-item plan → `archive/HANDOFF-plan-superseded-b609.md`

Archived at B658. It was marked superseded at B609 and kept for the reasoning behind items 1 and 2; both are closed. **Item 1's durable answer sheet is `BROADCAST-DELIVERY.md`** (including the three-GL-uploads lead and the 2560 caveat, rescued there at B658), and the live sequence is `PLAN-LIVE-READINESS.md`.

## current version

**v0.27.5 · B743** (2026-08-25). Minor bumped at B738 for the O(1) bake landing on hardware.

**⭐⭐ THE O(1) BAKE IS NOW MEASURED, NOT MODELLED.** A 2.63GB / 8:21 4K source peaked at **131.6MB**
against **130.9MB** for a 741MB source. **3.5× the file, 0.7MB more memory.** Both 8GB M1 iPads also
passed the job that killed them at B730 (Air 71.6MB, Pro 114.9MB). The Blob is disk-backed and file
size is no longer a memory axis. **B705 and B706 are device-verified** — B705's instrument found B706, and B706 held on the repro that killed B705. B703, B704 and B707 are not yet device-verified.

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

