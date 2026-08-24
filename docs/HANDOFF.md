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

**v0.26.75 · B735** (2026-08-24). **B705 and B706 are device-verified** — B705's instrument found B706, and B706 held on the repro that killed B705. B703, B704 and B707 are not yet device-verified.

---

## ▶▶ READ THIS FIRST — STATE AT B704

**`PLAN-LIVE-READINESS.md` "Where we are" is the accurate roll-up. Read it, then this.**

**Phase 2's exit criterion is MET** — T10, 2026-08-21: a 6:39 4K clip broadcast 4K over HDMI for 50
minutes, cold start, `outcome: complete`, no GL context loss, 8 loop wraps at a 6ms worst gap.

**Fixed this arc**, all device-verified by Daniel unless marked: radial pan (B694), the
rotation-blind pan joystick in both chromes (B697), droste pan (verified, needed nothing), the
governor default (B701), the native-decode first-frame deadline (B700), the source-freeze deadlock
(**B703, NOT device-verified**), reset-canvas pan easing (**B704, NOT device-verified**).

### ⚠️ The two remaining pieces of phase 2

Both named by Daniel at B704 **because I had left them off the plan.** Full scope for each is in
`BACKLOG.md`.

1. **Gate recording on detected capability.** Scoped, not built. **Computed, never a device table** —
   `HARDWARE-SUPPORT.md` owns that rule. The old recording evidence is stale and needs a re-verify
   run first, since it predates B681/B699/B700/B703.
2. **Provoke GL context loss deliberately, then cycle diagnostics.** The larger piece. The listening
   side only became ready at B695/B699/B703, so a loss provoked before that was mostly unobservable.
   **A loss that heals cleanly is a PASS.**

### ✅ B706 HELD. THE APP SURVIVED. (`8-21-26-contextLoss-05.json`)

**Two context losses, two clean restores, zero `gl-restore-failed`, and the trail runs past all of it** — the prior session ended with the trail cut short by a kill. Daniel scrubbed the 4K crossfade that killed B705. **The `source has no dimensions yet` entries in that report's `priorTrail` are the B705 session preserved, not new.**

### ⚠️ AND THE 86.8-SECOND RESTORE IN THAT TRAIL IS A DIALOG, NOT THE GPU

`alert()` pauses the event loop. Both "slow" restores (86.8s, 101.4s vs 982ms-2.3s everywhere else) were queued behind Daniel reading a bake-failure modal — **which is also why B705's own 3s `gl-restore-timeout` never fired.** A wrong noun inside my own instrument, one build after building it. **Timestamps after a modal are delivery time.** B707 marks `dialog-blocked`; **not blocking the thread at all is the real fix and is filed.**

### B707 — the bake is honest now

- **Refuses to start on a lost context** (`bake-refused`). B705's guard correctly reported `frame 1 of 2635`, and **frame 1 means it should never have begun.**
- **The encoder's real error beats its symptom.** `VideoEncoder is not configured` describes the state we found it in, not what broke it; a synchronous throw was beating the `encError` check.
- **The bake button no longer reads `baking…` forever while clickable.** `setClipMode`'s comment claimed it restored the label; `loopPrimary()` does. Daniel pressed the lying button, which is how the second bake happened.

### ⭐⭐⭐ PICK UP HERE (B735) — A AND B ARE BOTH BUILT. VERIFY ON DESKTOP FIRST, THEN ONE iPAD RUN.

**A (B734):** the muxer streams to disk-backed Blob parts. Removes the OUTPUT term. Fast Start kept.
**B (B735):** the demux is incremental and sample bytes live in a disk-backed Blob. Removes the
SOURCE term. **Source memory is now O(1) in clip length.**

**▶ STEP 1 — DESKTOP, FREE, DO THIS FIRST.** `npm run dev` on the Mac, the 741MB original, vanilla
slice bake. Read `bakeDecode.mem.peakBy`:

| what you see | means |
|---|---|
| `sample-index` ~0.4MB, `parse-window` ~24MB, `encoder-output` ≤8MB, peak **~80MB** | both changes landed |
| `sample-index` small but peak still hundreds of MB | mp4box is retaining bytes despite the null — the `releaseUsedSamples` path matters after all |
| bake produces a broken/unplayable file | the muxer assembly — check for a `mux-assembly` throw first |

**⚠️ AND PLAY THE BAKED CLIP, plus save it and open it somewhere else.** B734 changed how the file is
written. **The format is supposed to be identical** (moov still at the front) and the assembly
refuses rather than guesses, but *"it encoded"* is not *"it plays in Arena"*.

**▶ STEP 2 — ONE iPAD RUN, only if desktop is clean.** M1 iPad Pro, same file, vanilla slice, one bake
per launch. Then the Air.

**⚠️ VERIFY THEM TOGETHER, NOT SEPARATELY. The ledger is what makes that safe** — `peakBy` names every
term, so one report says which is still binding.

**▶ C (the gate) IS NEXT and must come last.** It enforces a cost model both of these changed.

### 🎯 THE FLOOR, IN DANIEL'S WORDS (2026-08-24)

**"Hitting the common use case durations on M1 8GB devices is non-negotiable."** 4K at those
durations would be *"amazing"* but is defensible to miss **if the implementation would cost
performance or stability.**

**⚠️ NOTE THE FLOOR WAS NOT SAFE EITHER BEFORE B735.** FHD at ~10 Mbps for 6 minutes is a ~450MB
source, which at B732's 2× is a ~900MB peak against an ~850MB budget. **The non-negotiable case was
marginal, not comfortable.** That is the strongest argument for B735 and it is not about 4K at all.

**Bitrate is a LEVER, not a default** — *"halving bitrate feels like a reasonable lever we could make
available, but not a silent default."* Filed; not built.

### 🔻 SUPERSEDED (B734) — A IS BUILT. B IS NEXT. VERIFY THEM TOGETHER, NOT SEPARATELY.

**A (B734): the muxer streams to disk-backed Blob parts.** Removes the OUTPUT term. Fast Start
preserved via `fastStart: { expectedVideoChunks }`, so the baked file is unchanged as a file.

**B (next): the streaming demux.** Removes the SOURCE term, which is the iPad's binding constraint.

**▶ BUILD B, THEN TEST ONCE. The ledger is what makes batching safe** — `peakBy` attributes every
term by name, so a single report says which one is still binding. Verifying them separately would
cost a device session to learn something one report already separates.

**▶ C (the gate) MUST COME LAST.** It enforces a cost model that A and B both change; built first it
would refuse work they make possible.

### 📐 BOTH CEILINGS APPLY EVERYWHERE — IT IS ONE BUDGET WITH TWO TERMS

`sourceBytes + 2 × outputBytes + ~56MB ≤ budget`. **The iPad is bound by output bytes too**; we have
simply never given it a long enough low-res clip to reach that term first. Which term dominates is an
accident of the clip, not a property of the platform.

### 🎯 THE TARGET, IN DANIEL'S WORDS (2026-08-24)

**Loops are typically 2-6 minutes**, many under 2, a handful 8-12+. **10-minute 4K is the upper bound
of normal use, not a floor.** *"If our honest hardware limit is half that, we still can offer robust
4K support for M1 class devices, just for smaller files."*

**⚠️ AND M1 + 8GB IS THE BIGGEST MARKET SHARE** (the M1 MacBook Air, which we do NOT own — the 8GB
iPad Air is the only proxy we have). **That raises the streaming demux from optional to required**: a
4-minute 4K source at 25 Mbps is ~750MB, and at 55.7 Mbps 10-bit it is ~1.67GB. **The source term
alone exceeds an 8GB device's budget at the typical clip length.** A alone does not reach it.

**⚠️ QUALITY BEATS REACH.** *"Our settings should bias toward higher quality with honest constraints
instead of silently doing things like how photos dropped to 8bit without telling us."* **This retires
the "halve the output bitrate to buy headroom" idea** unless it is an explicit, labelled choice.

### 🔻 SUPERSEDED (B733) — THE MUXER IS THE LAST BIG TERM, AND IT IS A PRODUCT DECISION

**B732 hit its number exactly: `peakMB` 2143.2 → 1441.1, and the iPad Pro went from frame 181 to
frame 2116 of 3178.** Still fails, but two thirds through.

**⭐ THE FAILURE MOVED OFF OUR PEAK.** It now dies at 67% of the ENCODE, where our attributed total is
~967MB — **below the 1441MB peak the same run survived.** What grows through the encode is the
muxer's output, and `ArrayBufferTarget` reallocates and COPIES as it grows, so its real transient is
about double what the ledger counts.

**📏 THE PRO DIES AT ~250MB FREE, TWICE** (B730: 1259 → 220, frame 181. B732: 1065 → 261, frame 2116).
Same threshold across two builds. **That is a gate input readable BEFORE the bake starts.** It also
says B732 came within roughly 100MB of finishing.

**▶ NEXT BUILD: stream the muxer output. AND IT NEEDS DANIEL'S CALL FIRST**, because it changes the
baked FILE, not just memory. Current config is `ArrayBufferTarget` + `fastStart: 'in-memory'`, which
buffers everything precisely so the moov lands at the front. Streaming means either **moov at the
end** (`fastStart: false`, valid MP4, fine for a local blob we reload immediately, less friendly to
other apps) or **fragmented MP4** (`fastStart: 'fragmented'`, streams natively, some tools dislike
it). **It also touches the save path `video-export.js` shares with recording.**

**▶ AFTER THAT, THE GATE HAS EVERYTHING IT NEEDS:** cost is arithmetic (`4×file` → now `2×file`, plus
output), the floor is ~250MB free, and headroom is readable at bake start.

### ⚠️ T10's SOURCE WAS 25.1 Mbps — AND THE RESULT SURVIVES ANYWAY

`MMNT_20260721_163742806.mov`, **1,252,687,804 B · 3840×2160 · 399.1s = 25.1 Mbps.** Daniel is right
that it is a light 4K file: the same 25.1 Mbps as the Photos copy, against **55.7 Mbps** for the
`IMG_5132` original (which is `hvc1.2.4` — **HEVC Main10, 10-bit**; Photos transcodes HDR to 8-bit on
export, which is most of the size difference).

**But T10 was a BROADCAST test, and broadcast does not demux the file into the JS heap.** It held a
**1.25GB** 4K source for 50 minutes with no context loss, which is direct evidence that
playback/broadcast memory is **O(1) in file size** while the bake is O(file). **The bitrate caveat
does not threaten T10's conclusion** — and a higher-bitrate broadcast would test decode bandwidth,
not memory, which is a different and much cheaper question.

### 📐 IS FILE SIZE THE CONSTRAINT? YES — TWO OF THEM, AND RESOLUTION IS NEARLY FREE

**Resolution's direct memory cost is ~56MB at 4K** (canvas 32 + held frames 24). Noise. The dominant
terms are **source bytes** (sample table) and **output bytes** (muxer accumulation, ×2 on realloc).

**So the permutation table collapses from 3-D (resolution × duration × bitrate) to 2-D (source bytes
× output bytes)**, and resolution and duration matter only because they produce bytes. See
`BACKLOG.md` for the term table and the gate expression.

**⚠️ The budget is NOT a per-model constant** — it is `deviceFreeMB at bake start − ~250MB`, and the
same iPad Pro measured 1259MB and 1065MB free on two runs. **Publish a table, gate on the live
reading.**

### ✅ B733 — THE STRIP REPAINTS AFTER A RESTORE

`onGLRestored(fn)` in `gl-watch.js`. **The step 3→4 blackout is NOT a B732 regression** — B730's iPad
Pro run has the same loss/restore before its bake. B732 just let the bake run long enough to notice
the strip never came back.

### 🔻 SUPERSEDED (B732) — ONE DEVICE RUN, NOT FOUR. THE iPAD PRO IS THE TEST.

**B732 shares one fetch + one sample table across slice's two readers. Expected `peakMB` 2143 → ~1441.**

**▶ THE RUN: the M1 iPad Pro, same 741MB file, same vanilla slice, ONE BAKE PER LAUNCH.** That is the
whole next device session.

- **Passes** → the file-size ceiling moved. *Then* run the Air, which is the harder case.
- **Fails** → read `peakMB` first. **~1441 means the reduction worked and the ceiling is simply lower
  than that**; still ~2143 means the shared source did not take effect and it is a code bug, not a
  device limit.

**⚠️ DO NOT RE-RUN THE MACS.** They passed at 2143MB and the change only lowers it. **And do not
re-run the gauntlet to re-measure** — the gauntlet answered its question. Device runs from here test
a CHANGE, not a number we already have.

**⚠️ CHECK `srcBytes` = 741,685,378 IN THE REPORT BEFORE READING ANYTHING ELSE.** Photos hands out a
334MB re-encode of the same clip; it must arrive via Files.

### 🧾 THE REDUCTION LEDGER — what is built, what is not

| | status | ceiling it owns |
|---|---|---|
| release `buf` after `demux()` | **built B728** | — |
| one fetch + one sample table for slice | **built B732** | **file size** |
| stream the muxer output | **NOT BUILT** | **duration** (killed a 47:45 FHD bake on 64GB) |

### 🔬 THE RESIDUE IS NOT YET PROVEN, AND THE TEST IS FREE

D2-vs-D3 is **one uncontrolled pair** (different modes, different builds). `heldMB: 0` says our code
releases everything it takes, so if residue is real it is GC latency or engine-side.

**▶ D5 SETTLES IT WITH NO BUILD: three identical bakes in ONE launch.** `peakMB` must be constant;
watch whether `bakeMem.device.freeBeforeMB` returns to baseline before each one. Free memory not
recovering between bakes is the measurement. **Worth doing on whichever device is in hand after the
B732 run.**

### 🔻 SUPERSEDED (B731) — THE GAUNTLET IS DONE. SAME COST, DIFFERENT CEILING. BUILD THE REDUCTION.

**One file (`741,685,378 B`), one vanilla slice bake, four machines, `peakMB` = 2143.2 on ALL FOUR:**

| machine | outcome |
|---|---|
| M5 Max / M1 Max MBP | pass |
| M1 iPad Pro (16GB) | **fail, frame 181** |
| M1 iPad Air (8GB) | **fail, frame 88** |

**The cost is a property of the job; the ceiling is a property of the device.** Computed gating is now
grounded in measurement.

**▶ THE PEAK IS THE DEMUX, NOT THE ENCODE** (`frames-held: 0` at peak). Slice builds two readers in
sequence, so the high-water mark is *B's sample table + A's file buffer + A's sample table*.

**▶ THE NEXT BUILD IS THE SHARED DEMUX: one fetch and one sample table across slice's two readers.
2143MB → ~1441MB, a 33% cut**, landing exactly on the moment that fails. Proposed, NOT built — it
changes `createSequentialFrameReader`'s shape and Daniel has not greenlit it.

**▶ THEN: stream the muxer output.** Removes ~300MB, its realloc doubling, and the duration ceiling
that killed a 47:45 FHD bake on 64GB.

### 📐 CORRECTION TO B727: MEMORY *IS* THE DEVICE AXIS

**8GB Air failed at frame 88; 16GB Pro at frame 181. Same job, same file, same build.** B727 argued
the Air/Pro difference *"probably matters much less than expected"* because the cap is per-process.
The ordering says otherwise.

### ⚠️ "SAME CLIP" HAS BEEN WRONG TWICE — CHECK `srcBytes` FIRST, ALWAYS

The Photos copy is `3840×2160 · 106.45s · 30fps` at **45% of the bytes** — a lower-bitrate RE-ENCODE,
not a downsample. **AirDrop is not enough**: iOS files it into Photos and Photos transcodes. The
original must travel via Files.

**At 4× file size in the cost model, that 407MB difference is 1.6GB of peak — enough to flip pass into
fail on its own.** Every historical "the iPad handles 4K" result is suspect. B731 puts `codec`,
`srcBytes` and `mbps` in the shape so this is one glance rather than an inference.

### 🔬 DEVICE-WIDE READINGS ARE IN, AND ARE DIRECTIONAL ONLY

Pro: free `1259 → 220MB`. Air: free `691 → 1583MB` (a RISE, which is what jetsam looks like from the
inside — the OS frees by killing). **Two single samples, one 1.8s stale, on a noisy quantity.** The
robust findings are `peakMB` and the failure ordering.

### 🚨 NINE MINUTES FROZEN ACROSS TWO MODALS

`dialog-blocked: 243890` and `289064`. **Filed since B707; now the worst operator-facing defect in the
arc.**

### 🔻 SUPERSEDED (B730) — THE COST MODEL IS MEASURED. IT IS ARITHMETIC.

```
slice bake peak ≈ 4 × fileBytes + encodedOutputBytes + ~55MB      (bounce/forward: 2 × fileBytes)
```

**Measured 2026-08-24, one clip, vanilla slice, one bake per launch, all three passed:**

| machine | `peakMB` | file |
|---|---|---|
| M1 Max MBP | **3188.5** | 741,685,378 B |
| M5 Max MBP | **3188.6** | 741,685,378 B |
| M1 iPad Pro | **1627.3** | **334,468,478 B** |

**The two Macs agree to 0.1MB on an identical job.** The conserved quantity works.

**⚠️ THE iPAD IS RUNNING A DIFFERENT FILE.** Same name, same duration, same resolution, **half the
bytes** — iCloud handed it a lighter copy. **The weaker device is getting the easier file, which
flatters it and hides the ceiling.** Any cross-device comparison must check `sourceSwap[].size`
first. This is the fourth uncontrolled A/B this arc and the first an instrument caught.

**▶ NEXT: the iPad AIR run, on B730.** It is the one expected to fail, and `peakMB` plus the new
device-wide delta will say at what number. **Check its file size before comparing anything.**

**▶ THE TWO REDUCTIONS ARE QUANTIFIED AND NOT BUILT:** one shared fetch + demux across slice's two
readers removes **half** the buffer cost (1.4GB on the Macs); streaming the muxer output removes
~300MB, its realloc doubling, and the duration ceiling that killed the 47:45 FHD bake on 64GB.

### ✅ THE RESIDUE IS NOT A RETAINED REFERENCE

**`heldMB: 0`, `openHandles: 0`** after teardown on all three, and still zero minutes later. D2 vs D3
is **not** "we forgot to release something". It is GC latency or engine-side, which needs a different
fix. **This is what measuring before modelling bought.**

### ⚠️ TWO THINGS THE READING DOES NOT SHOW

1. **Whether mp4box COPIES the sample bytes.** `sample-table` ≈ `source-buffer` is equally consistent
   with copies and with views sharing `buf`. B728's changelog called it settled; **it is not.** The
   model may be 4× or 3×. B730's device-wide delta is what distinguishes them.
2. **B729's `source-buffer` was a PHANTOM** — B728 freed `buf` after the demux and kept counting it
   for the reader's life. **The peaks above are real; their composition was not.** Fixed in B730, so
   B729 numbers and B730 numbers are not directly comparable.

### 🔻 SUPERSEDED (B729) — MEASURE FIRST. TWO INSTRUMENTS ARE IN; NOTHING GATES YET.

**▶ THE RUN: one vanilla bake per machine, same clip, same settings, ONE BAKE PER LAUNCH.**
iPad Pro, iPad Air, M1 Max, M5 Max. Then read three fields:

| field | question it answers |
|---|---|
| `bakeDecode.mem.peakMB` + `peakBy` | **how much, and which term dominates** |
| `bakeMem.heldMB` (after teardown) | **retained references, or GC latency?** Non-zero = ours to fix |
| `mem.deviceFreeMB` trend vs `peakMB` | **the blind spot**: total movement minus what we can attribute |

**For an identical job `peakMB` should be identical on every device.** Only the outcome differs.
**That separation is what makes a computed gate possible** — measure the cost once, read the limit
per device. It is also the answer to *"is the memory needed for the identical task the same on each
device"*, which nothing could answer before this build.

**⚠️ ONE BAKE PER LAUNCH.** D2 (second bake in a session) died at frame 1 where D3 (fresh launch,
identical job) encoded all 6,387 frames.

**⚠️ THE SWIFT IN B729 IS UNVERIFIED** — `host_statistics64` compiles nowhere in this toolchain. If
Xcode rejects it, it is one function and one call site; removing it leaves B728 intact.

### 🧭 WHAT WE KNOW / WHAT WE DO NOT (B727 roll-up, for a cold session)

**Know:** the bake is a memory failure (the OS said so on D2). Output resolution is not the lever
(D1 failed at 1080p). A failed bake does not release its memory (D2 vs D3). The encode itself is
within reach on an M1 iPad (D3 did 6,387 frames). D3's failure is the HANDOFF, and B711's guard
preserved the source. Native footprint is not the constraint (39MB). Contexts recover reliably
(459/541/399/402ms provoked; 550/29/650ms organic). Desktop has its own separate ceiling
(`ArrayBufferTarget`, 47:45 FHD on 64GB).

**Do not know:** how much a bake actually costs anywhere; which term dominates; whether D2's app
termination and D3's GL loss are one failure or two; whether the residue is retained references or
uncollected garbage; the per-device ceiling.

### 🔎 `resetSession` IS NOT A TRUE RESET — CONFIRMED BY READING, NOT ASSUMED

Daniel's requirement: release the memory on recovery, or say we are in a bad state and offer a real
reset. **The current glass break rebuilds GL contexts and nothing else.** It never touches the
demuxed buffers, held frames or muxer output; only its `location.reload()` fallback frees them, and
that runs only when *nothing* recovered. **Both halves of the requirement are still open** and both
need the measurement first: we cannot honestly warn about a state we cannot detect.

### 🔻 SUPERSEDED (B727) — THE CEILING IS A PER-PROCESS CAP, AND WE CANNOT READ IT

**D3's first bake-time memory reading: `footprintMB: 39, availableMB: 5080, thermal: nominal`**, at
the instant both GL surfaces died. **The native plugin measures the HOST process. The bake's memory
is in the WKWebView CONTENT process**, which has its own footprint limit and is what gets killed.

**This reframes the ladder.** The ceiling is not device RAM: a 16GB iPad died with 5GB free. **The
8GB Air vs 16GB Pro comparison probably matters much less than expected.** And it is the same
mistake that retired the memory hypothesis earlier in this arc — `footprintMB 38`, a true number
from a broadcast, describing a process that does not allocate.

**▶ WebKit exposes no per-process web memory API, so the next instrument is OUR OWN ALLOCATION
LEDGER** — we know every large allocation the bake makes. **Proposed, not built.** See BACKLOG.

**▶ AND MEASURE COST BEFORE MODELLING IT.** The ledger's first job is to say which term dominates:
the per-reader file buffer, the demuxed sample table, held `VideoFrame`s, or the accumulating output.

### ⭐ A FAILED BAKE DOES NOT GIVE ITS MEMORY BACK — NOW EVIDENCE, NOT A CAVEAT

**D2** (second bake in one session) died at **frame 1 of 3540**. **D3** (same clip, same mode, FRESH
LAUNCH) **encoded all 6,387 frames** and only failed at the handoff. **`recovered` currently means
the contexts came back, not that the session returned to its prior state.**

### ⚠️ D3's FAILURE IS THE HANDOFF, NOT THE ENCODE — AND THE GUARD WORKED

`bake-rejected · "the baked clip failed to load" · w: 0, h: 0`. The encode completed; the output blob
(212.9s of 4K) would not load. **B711's output validation kept the working source.** That is the
guard doing exactly its job.

**⚠️ BUT THE PANELS STAYED BLANK.** Both contexts restored in ~650ms and neither the preview nor the
timeline repainted. **The contexts recovered and the UI did not.** Concrete repro for the *"panels
that know they are stale"* item. Plus `dialog-blocked · ms: 105316`.

### ✅ B726 WORKED — THE CHANNEL IS LIVE DURING A BAKE NOW

D3: `loaded: true, pushes: 258` on a bake-only session. D1 on the previous build: `loaded: false,
pushes: 0`.

### 🔻 SUPERSEDED (B726) — THE iPAD BAKE IS A JETSAM KILL. CONFIRMED BY THE OS.

**Xcode, 2026-08-24:** *"The process has been terminated by the operating system because it is using
too much memory. Terminated due to memory issue."* Device `iPad13,8` (M1 iPad Pro 12.9"), iPadOS 26.6.
**The purge hypothesis is no longer a hypothesis.**

**D1 and D2 both FAILED, and both eliminate a lever:**

| test | change | result | conclusion |
|---|---|---|---|
| **D1** | output at **1080p** (`srcW 1920` in the shape) | failed, both surfaces lost | **output resolution is NOT the lever** |
| **D2** | **bounce** mode, ONE reader not two | failed at **frame 1** | reader count is not obviously it either |

**⚠️ D2 IS CONTAMINATED AND MUST BE RE-RUN.** It ran in the same session immediately after D1's
failure, so the app was already carrying whatever D1 left behind. **Failing at frame 1 instead of
frame 4 is itself the evidence** — it started closer to the ceiling. **Re-run D2 from a fresh
launch**, and that re-run doubles as the test of whether a failed bake gives its memory back.

**▶ THE NEXT READING IS THE ONE THAT MATTERS.** B726 makes `footprintMB` arrive during a bake for the
first time. **Any vanilla bake on B726+ now answers what the ceiling actually is** — Daniel's instinct
to re-run the plain no-edits bake is right, and it is now worth more than another D-test.

### ⚠️ THE MEMORY CHANNEL WAS DEAD, WHICH IS WHY FOUR REPORTS OF THIS FAILURE CARRY NO NUMBER

**`onEvent` called `refresh()`, which B679 made a no-op**, and `load()` is what registers the push
listeners. The only remaining caller of `load()` is `setIdleTimerDisabled` — the wake lock. **So
thermal and memory arrived only while broadcasting or recording**, never during a bake. `D1`:
`loaded: false, pushes: 0`. `T10` (a broadcast): `loaded: true, pushes: 625`.

**⚠️ AND EVERY THERMAL READING WE HOLD IS FROM A BROADCAST OR RECORD SESSION.** The plan calls
thermal the biggest effect of the arc; that stands, but **we have no thermal data for baking,
loading, or idle**, and no way to have noticed — `diagnostics().why` returned the same string for a
seam pushing 625 samples and one pushing none.

### 🧮 WHAT THE BAKE ADDS, AND WHERE THE ARITHMETIC IS STILL A GUESS

Live 4K broadcast holds a decode session, the preview 4K texture, an output canvas — steady state.
**A bake adds, without releasing any of it:** a full-file `ArrayBuffer` PER READER (`fetch` +
`arrayBuffer`, and slice makes two readers fetch the same URL twice), mp4box's parsed sample table,
up to twelve held 4K `VideoFrame`s per reader at ~12.4MB, a 4K `VideoEncoder`, a 4K 2D capture
canvas, and the output accumulating in `ArrayBufferTarget`.

**⚠️ Whether mp4box COPIES the sample bytes or views into the source buffer is UNVERIFIED** — the
bundled build does not expose the internal. It is the difference between ~1x and ~2x file size per
reader, so do not put it in a cost model until it is measured. **`footprintMB` during a bake settles
it without reading any source.**

**▶ Two obvious reductions, neither yet built:** one fetch and one demux shared across slice's two
readers, and releasing `buf` after `demux()` (nothing reads it afterwards).

### ✅ A1-A4 PASS (B724). THE RECOVERY PATHS WORK.

Restores at **459ms, 541ms, 399ms, 402ms** on the M1 Max, including one fired mid-bake (the bake
aborted honestly at frame 1137 of 3178, and the same clip baked cleanly afterwards) and two in
perform mode while broadcasting 4K.

**⚠️ ALL FOUR PROVOKED `preview`.** A4 was meant to be `yuv-source`. **`yuv-source`, `output`,
`live-pip` and `external` have still never been deliberately provoked.** B725 puts the surface name
on the button; re-run A4, A6, A7.

**⚠️ A2's `gl-restore-timeout` is an artifact, not a failure.** `dialog-blocked · ms: 3003`
immediately precedes it: the bake-failure `alert()` held the event loop so the scheduled
`restoreContext()` could not run, and the restore landed 223ms after the timeout. **Third time a
modal has corrupted a timing instrument this arc.**

### ⭐⭐ PICK UP HERE (B724) — THE iPAD BAKE DIES AT FRAME 4. DETERMINISTIC, THREE TIMES.

**`8-24-contextLoss-clipBake-06-iPad.json` and `-07-iPad.json`.** Both GL surfaces lost within 2ms of
each other, then `export-aborted · gl-lost · frame 4`. **Three times: two builds (B721, B723), two
different trims, and a fresh app start.** Decode was healthy every time (`via: cover`, 54-86ms).

**Both surfaces dying together means the GPU PROCESS died, not one canvas.** That is iOS purging,
not a bug in one renderer. **And the app recovered every time** (550ms / 29ms), so this is a
capability ceiling, not a broken recovery path.

**Frame 4 is where the encoder has just configured for 4K output** while two 4K WebCodecs decoders
and the preview engine's 4K textures are already resident. `sessions.peak.decode: 7`.

**▶ B725 STAMPS `footprintMB` ONTO THE LOSS.** If frame 4 is a jetsam kill, the next report says so
outright. **Both chromes were discarding that reading three lines before it mattered** (the `sample`
kind was filtered out before marking), which is why four reports of this failure carry no memory
number at all.

**▶ TWO SINGLE-VARIABLE TESTS, ONE iPAD RUN EACH, NO BUILD NEEDED:**
1. **Bake the same clip at 1080p output** (format control). Survives → the ceiling is OUTPUT resolution.
2. **Bake in bounce mode** (ONE reader instead of slice's two). Survives → the ceiling is concurrent 4K decoders.

**⚠️ DO NOT COMPARE AGAINST THE 08:46 SUCCESS.** That report is pre-B722, so its `mode`, `inT` and
`outT` are the post-bake reset, not what it baked. **We cannot say what geometry succeeded that
morning.** The `sec: 0.044` worst target hints at slice (reader A's first call at `inA`), which if
true means the mode is NOT the variable — but that is an inference from one field, not a reading.

### ⚠️ THE OUTPUT IS HELD IN RAM. THAT IS A SECOND, INDEPENDENT CEILING.

`video-export.js` muxes to **`ArrayBufferTarget`** — the entire encoded result accumulates in memory
before it becomes a Blob, and the target reallocates and copies as it grows, so peak is roughly
double. Daniel's 47:45 FHD bake died with `Array buffer allocation failed` about a quarter through,
**on a 64GB M1 Max**.

**So there are TWO limits, at opposite ends:** the 1.5GB INPUT cap in `video-decode.js` (silent, and
that file was 4.94GB so the bake was on the slow element-seek path from the start), and this
unbounded OUTPUT accumulation. **Neither is stated anywhere the operator can see.**

### ⚠️ AND THE MODALS FROZE THE APP FOR 30 MINUTES

`dialog-blocked · ms: 1827033` in `8-24-arrayBufferError-longFHDclip.json`. **Thirty and a half
minutes** behind one `alert()`. The iPad session shows 52.6s, 8.1s and 3.9s on three more.
**Replacing the bake's modals is no longer a nicety.**

### 🧪 B723 — GL LOSS IS NOW PROVOKABLE ON DEMAND. THE MATRIX IS DANIEL'S TO RUN.

**Frame-cost panel → surface picker + `now`/3s/10s/30s + `lose context`.** Arm it, close the panel,
go to the thing you want interrupted. **A loss that heals cleanly is a PASS**; grade it with
`gl-watch.js`'s four outcomes, and remember that a loss with NONE of the four means the app died
inside the window.

**`gl-loss-provoked` marks every deliberate one**, so provoked and organic stay distinguishable in
the trail. **Do not read a report from a provocation session without checking for that mark first.**

**This does not replace organic crash hunting, and Daniel made the point himself:** the harness shows
whether a surface can heal; only real crashes say which surfaces get hit and why. Both continue.

### ⚠️ THE APP DOES NOT KNOW ITS OWN LIMITS — AND ITS ONE LIMIT IS BELOW THE PLAN'S GOAL

**`maxBytes = 1_500_000_000` in `video-decode.js` is the ONLY hard limit on the ingest/bake path**,
and over it `createSequentialFrameReader` **returns null silently**: no mark, no message. The bake
falls back to per-frame element seeking, which is the path the reader exists to avoid.

**The plan's stated ceiling is above that cliff.** 4K at 10 minutes is ~3.75GB at a typical 50 Mbps,
so a clip at the design ceiling takes the slow fallback on every device including the M5 Max. **And
it violates the standing rule: anything that can decline to act must publish why.**

**The sharpest constrained axis is memory, and it is COMPUTABLE before the bake starts.**
`createSequentialFrameReader` fetches the whole file into an ArrayBuffer and holds sample references
into it for the reader's life. **Slice mode creates TWO readers, each with its own fetch**, so a
slice bake costs ~2x the source file size resident, plus up to 12 held 4K VideoFrames per reader
(~12.4MB each) plus the reverse cache. A 1.4GB clip is ~3GB on an 8GB iPad Air before the encoder.

**Nothing needs probing to gate this.** File size, mode and resolution are all known at open.

### ⭐⭐ PICK UP HERE (B722) — THE BAKE PASSES ON BOTH MACHINES. ONE THREAD IS STILL OPEN.

**2026-08-24, B721, same 4K clip: M1 Max PASSED, M1 iPad Pro PASSED.** Reports
`8-24-contextLoss-clipBake-04-success.json` and `-05-iPad.json`. **`holes: 1` on both** — the same
file yields the same count on two platforms, and a hole was a state the wait loop could not leave,
so pre-B721 that one target would have spun to the budget and thrown.

**The iPad completed a 3178-frame 4K bake.** That is new, and it is a real capability-ladder data
point. **Do not spend it yet** — see the open thread below.

**▶ THE OPEN THREAD: desktop's worst target walked 113 frames, the iPad's walked 4.** Same file,
same targets, so the work should be the same. B716 named exactly this fork: *same count different ms
= throughput; different count = the READER behaves differently per platform.* **We cannot currently
tell which**, because the passing reports could not say what geometry they baked (fixed in B722).

**▶ NEXT: one bake per machine on B722+, then compare `mode`/`slicePoint`/`crossfadeMs` FIRST.** If
the geometry matches and `decoded` still differs by 28x, that is a per-platform reader difference and
is worth a proper investigation. If the geometry differs, the runs were never comparable and the
thread closes.

### ⚠️ B722 — TWO MORE OF MY OWN INSTRUMENTS WERE WRONG, AND ONE INVERTED B719's PURPOSE

1. **The bake shape was read in the `finally`, after `applyBakedClip` reset it.** Every PASSING run
   recorded `mode: 'forward', inT: 0, outT: 1` — the post-bake reset, not what was baked. **A
   forward trim never bakes at all**, which is how it was caught: the report described an impossible
   state. **The failure path was always accurate**, so B719's comparability check inverted into
   comparing a real trim against a reset one on exactly the A/B that mattered.
2. **`resets` could only ever read 0.** The per-target counters were zeroed below every path that
   calls `resetTo`. **I used that zero at B720 to rule out a reconfigure. That inference was not
   supported**, though it does not change B721's conclusion.

**Four instrument bugs this arc (B716 wrong-noun, B720 ranking, B722 late-read and dead-counter).
The recurring shape is READING A VALUE AT THE WRONG MOMENT, not measuring the wrong thing.**

### ✅ B721 — THE FORWARD WAIT LOOP HAD A STATE IT COULD NOT LEAVE

`frameAt` returns `outQ[0]` when it COVERS the target and drops it when a later frame SUPERSEDES it.
**A target landing between one frame's end and the next frame's start satisfies neither, and no frame
the decoder can still produce sorts into that hole.** Terminal state; spins to the budget; throws on
a decodable file. A zero-duration sample or a VFR/edit-list jump opens the hole, and the bake asks
for **continuous** targets (`t = p * outDur`), never snapped to the frame grid.

**`revLookup` twelve lines up already had the right rule.** Only the backward path used it.

**⛔ RETIRED: *"the flat budget is too tight for 4K on one media engine"*.** Nine frames in thirty
seconds is a stall, not slowness. That framing came from comparing an iPad failure against desktop
successes that were not the same experiment. A B716 comment in `video-decode.js` still states it and
is marked superseded.

### ⚠️ TWO INSTRUMENT BUGS FIXED IN B720 — READ BEFORE TRUSTING OLDER `bakeDecode` ENTRIES

1. **The harvest ranked readers by `decoded` and took the largest**, so a bake that failed with `decoded: 9` reported `decoded: 113, timedOut: false` from the other reader. **Twice.** Every `bake-decode-worst` before B720 may be the healthy reader, not the failing one.
2. **`gopWalk` reset only on `resetTo`**, so *"953 samples since the keyframe"* was actually samples since the last reconfigure. Now per-target.

**The lesson: a timeout is not a large cost, it is a different kind of event, and must be ranked first.**

**⚠️ AND B721 FOUND A THIRD: the message's leading number is the TARGET time, not the elapsed time.**
*"decode timed out at 30.982s"* against a 30s budget reads as a duration, and a build's reasoning was
aimed at throughput because of it. **Three of this arc's instruments reported a real number under the
wrong noun.** Reworded to *"stalled waiting for the frame at 30.982s (gave up after 30.0s ...)"*.

### 📏 PROCESS — device sessions cost ~9 minutes each (`DEVICE-TESTING.md`)

**Of the builds since B703, the large majority were diagnosed by reading or on desktop.** Daniel's two desktop sessions found more real bugs than the four iPad sessions before them. **Desktop first; the iPad owns only native decode, HDMI, the frame socket and thermal.**

**⚠️ AND CONTROL THE EXPERIMENT.** Three false results this arc came from uncontrolled A/Bs and **all three were caught by Daniel, not by the instruments.** `bakeDecode` now carries its own trim, mode, frame count, duration, fps and size so comparability can be checked rather than remembered.

### ⚠️ B713+B714 — I SHIPPED THREE THINGS THAT MADE IT WORSE. READ THIS BEFORE TOUCHING THE BAKE.

**B710's degraded-source refusal: removed.** It gated on `engine.planarActive`, and **the bake does not read the engine** — it reads the FILE through WebCodecs. It blocked a working bake twice and cost Daniel 8m55s. **It also withdraws B710's explanation of the grey bake, which now has no established cause.**

**B711's preview shed: reverted.** It tore down `env.clip.prevVideo`, which is the element the bake's fallback `frameAt` seeks. On desktop (no native decode, so a different bake path) that produced **no progress bar and a cancel that could not land.**

**B711's `pv` extraction: fixed.** It left `openClipEditor` referencing a variable that had moved into `mountClipPreviews()`. The ReferenceError threw *after* the sheet was shown, so **the Loop Builder opened with its step state uninitialised** — on both chromes.

**The pattern in all three: I predicted from adjacent state instead of validating the actual thing, and I verified mechanisms instead of walking the user's path.** B711's OUTPUT validation survives because it is the opposite shape — it checks the result and can only reject a bad bake, never block a good one.

### 🔬 THE BAKE FAILURE IS DETERMINISTIC, AND IT BELONGS ON DESKTOP

**`decode timed out at 81.470s`, twice, same point.** Not resource pressure — a property of the clip's GOP structure. **This retires the decoder-pressure hypothesis.**

**▶ The bake's decode path is pure WebCodecs JS. It should reproduce in `npm run dev` on the Mac.** Seconds per attempt with a debugger, instead of ~9 minutes on device. **Confirm that before any further device time.**

### 📏 WHAT A DEVICE ANSWER COSTS — now recorded in `DEVICE-TESTING.md`

Daniel measured it: **build+open ~1:00 · upload a 1:49 4K clip ~2:20 · reach the action ~3:40 · bake 2:00+. Total 8:55 on a turn that never reached the test.** A wasted device answer costs the same as a good one.

**Of the eleven builds since B703, eight were diagnosed by reading code and needed no device at all.** The rule was already written; the failure was treating *"an iPad is in hand"* as a reason to use it.

### ✅ B709 — THE BLANK SOURCE, ACTUALLY. A FIFTH GL CONTEXT NOTHING HAS EVER WATCHED.

**`grep "getContext('webgl"` returns TWO creators in this codebase:** `engine/gl.js` (the four engines B705 wired) and **`yuv-renderer.js`, which had no `webglcontextlost` handler at all.** No handler means no `preventDefault()`, which means **the browser never offers a restore** — the loss was unrecoverable by construction, not merely unreported.

That renderer paints the SOURCE PANEL's picture. **Daniel's description separated the two contexts precisely** — *"the source is lacking a picture and the reflections are showing"* — reflections being the preview engine, which restored in 499ms and is in the trail. **No counter could have caught it: `offered === taken` describes the engine's plane reader, a different consumer. This surface has never had a counter.**

**B708 was a real bug and not this one.** Both are shipped.

**⚠️ THE AUDIT THAT SHOULD HAVE HAPPENED AT B705.** I wired "all five GL surfaces" by counting ENGINES rather than CONTEXTS. **Four builds of blank-source investigation sit downstream of a one-line grep I did not run.**

### 📐 STANDING RULE — now FOUR instances in seven builds

B703, B706, B708, B709: **a recovery path that cannot start itself.** B709 is the worst kind — one that does not exist.

| build | cache a restore discarded | what should have re-filled it | why it did not |
|---|---|---|---|
| B703 | the planar uploader | `updateSourceFrame` | gated on element-path state |
| B706 | the element texture | `reinitGL`'s re-upload | threw on 0×0, nothing retried |
| B708 | the uploader **and its texture** | the next frame off the socket | a paused clip has no next frame |
| B709 | the yuv blitter | nothing — **there was no handler** | no `preventDefault()`, so no restore was ever offered |

**Ask `getContext` where the contexts are, not the architecture diagram. And `offered === taken` was true in all four.**

### ✅ `dialog-blocked` confirmed B707 outright

`48309ms` and `49573ms`. Subtract them and this session's restores are **540ms and 499ms** — normal. The 86.8s/101.4s in B707's report were the dialogs. **The instrument now explains its own outliers**, and replacing those modals is no longer theoretical: a bake failure froze the app for ~98 seconds across two of them.

### ⚠️ Also fixed B709: the export guard's async gap

The first bake in `8-21-contextLoss-06.json` lost the context with **no `export-aborted` mark** — `frameAt` is async and awaits a 4K seek, so a loss *inside* it escaped as an unrelated GL error. The guard now re-checks after the await and re-labels.

### ⚠️ Owed a device pass

- **B703** — the source freeze after a GL restore. Use the original motion → perform repro.
- **B704** — reset canvas should now EASE the pan the way it already eased rotation. Set a slow
  transition speed in perform mode.

### How to read a report after a failure, in order

`priorTrail` (survives the kill) → `trail` (this run) → `sessions` (what was held) → `sourceSwap`
(what had just been loaded). All five GL surfaces mark `gl-context-lost` / `gl-context-restored`
with a `surface` field since B695; before that, four of the five were console-only.

### ⚠️ Three of my own instruments were wrong this arc, and all three cost real time

The pattern repeats, which is why it is here rather than in the archive:

- `sourceStallNote` could not tell a **paused** clip from a **wedged** one (fixed B702).
- The external surface note **contradicts `extGuard`** and silently dropped the metric a whole
  experiment depended on. **Still open**, filed in BACKLOG.
- I twice applied B584's rule without establishing its stated precondition.

**When a report and Daniel's description of the screen disagree, the screen is right.**

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
| the phase 2 narrative as it was written | `archive/HANDOFF-builds-607-704.md` |
| how the codebase is put together | `ARCHITECTURE.md` |
| how to decide what to measure | `DEBUGGING-PROTOCOL.md` |
| how to get a reading off a device | `DEVICE-TESTING.md` |

**Keep it that way.** A finding that is resolved belongs in CHANGELOG; a finding that is open belongs
in BACKLOG. This file holds the handful of things a cold session needs in its first five minutes.

---

## historical record

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

