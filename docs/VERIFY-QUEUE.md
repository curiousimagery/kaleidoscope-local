# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG. Closed sessions are archived under `archive/VERIFY-QUEUE-*.md`.

---

# ▶▶ OPEN SESSION (B752) — IS THE CEILING A PROPERTY OF THE FILE, OR OF THE SESSION?

**The question:** *the source-size hypothesis is dead. Does what PRECEDED an operation predict whether
it survives?* And, riding along because it is the same rig: *are the record limits still where the
pre-B681 evidence says they are?*

**Why now:** the same 2,629,310,897-byte file on the same M1 iPad Pro **failed three times**
(B741/B742/B743) and **succeeded twice** (B750, and B751's clean 55.6fps render). The only thing that
differs between the two runs that left breadcrumbs is not the file:

```
B750, CRASHED 1/3 in : scenarioObserved external-broadcast · sessions.peak { gl 2, decode 2 }
B751, COMPLETED clean: scenarioObserved idle-still         · sessions.peak { gl 1, decode 3 }
```

---

## 🛑 FOUR OPERATING RULES. GET THESE WRONG AND THE SESSION PRODUCES NOTHING.

### 1. ⚠️⚠️ COPY THE REPORT AFTER **EVERY** RUN. IT DOES NOT SURVIVE A FORCE-QUIT.

**Verified by reading, B752.** The runner's record is a module-closure variable
(`shell/scenario-runner.js`), so a force-quit takes it with it. **Only `priorTrail` (12 entries) and
the vitals crash store are in `localStorage` and survive.** There is no accumulate-across-relaunch
report — that was scoped as optional and is not built.

**So: run → wait for `✅ complete — copy report` → tap `copy report` → paste to a file → THEN force
quit.** A run whose report was not copied did not happen.

Suggested naming so a later session can cross-reference: **`docs/temp/B752-<device>-<script>.json`**,
e.g. `B752-ipadPro-a1.json`.

### 2. The button is `copy report` in the **frame-cost panel** — the same one as always.

On iPad it is reachable only through the desktop diagnostics section ("frame cost panel"); a URL
param cannot reach a Capacitor build. `run scenario` is in that same panel.

### 3. Per-run setup, in order:

1. **Force quit**, reopen.
2. **Load the source** (see the file table below).
3. **Enter motion mode.** This auto-seeds keyframe 0 (`ensureSeededSelection`), which is what the
   render scripts need — **the render sheet will not open with zero keyframes.** No manual keyframing.
4. Frame-cost panel → pick the script → **`run scenario`** → walk away.
5. `copy report` → paste → force quit.

### 4. ⚠️ A RENDER'S LENGTH IS THE **CLIP's** LENGTH, not a fixed job.

`lockVideoDuration` sets `motion.durationMs` from the source's native duration, so the render cost
scales directly with the clip you load. **This is how to budget the session:**

| clip | frames at 30fps | iPad render, at B751's measured 55.6 fps |
|---|---|---|
| 20.4s 4K | ~612 | **~11 s** |
| **IMG_5132, 1:46** | ~3,180 | **~57 s** |
| 6:39 4K | ~11,970 | ~3.6 min |
| **RAKBE6010, 8:21** | 15,019 | **270 s** — this is exactly what B751 measured |

---

## 📁 THE FILES, BY HOW YOU ACTUALLY IDENTIFY THEM

**⚠️ THE PHOTOS COPY IS NOT THE SAME FILE.** Photos hands out a lower-bitrate re-encode: same
3840x2160, same duration, **45% of the bytes**, 8-bit where the original is HEVC Main10. This has
invalidated results twice (BACKLOG: *"SAME CLIP HAS BEEN WRONG TWICE"*). **Check `srcBytes` in the
report before comparing any two runs.**

| use it for | where | name | duration |
|---|---|---|---|
| **the matrix constant** | **On My iPad** | **IMG_5132** (741.7MB) | 1:46 |
| the escalation, only if the matrix shows nothing | On My iPad | RAKBE6010 (2.63GB) | 8:21 |
| ⛔ **do not use for comparisons** | Photos | the 1:46 4K | 1:46 — this is the IMG_5132 **re-encode** |

**Everything in this session runs on IMG_5132 from On My iPad.** One source, held constant, is the
whole design. **No need to move any other file to local storage for this session.**

---

## ▶ THE ORDER. START ON THE MAC, NOT THE iPAD.

### 🆓 STEP 0 — **A1 on the desktop, in a browser. Free, ~10 seconds, before any device time.**

You asked for a first run that confirms the instrumentation and the report format before spending
device time. **This is it, and it costs nothing** — it is the same R0 discipline that caught two
failures in the B737 session.

`npm run dev`, load any clip, enter motion mode, frame-cost panel → **A1** → run.

| check the report for | pass |
|---|---|
| `scenarioRun.outcome` | `"complete"` |
| `scenarioRun.stepsRun` / `stepsTotal` | equal |
| `scenarioRun.log[]` | one entry per step, each with `ok: true` |
| the `render` log entry | carries **`wallSec`, `renderPx`, `frames`, `sourcePath`, `outBytes`** |
| `scenarioRun.session` | **present, not undefined** — this is the B667 defect, watch for it |
| a file downloaded | the render actually saved |

**If any of those are missing, STOP and send me that one report.** That is exactly the B741 failure
mode — an instrument that silently did not ship — and it must not cost an iPad session.

### Then the iPad Pro, in this order

| # | script | source | rig | ~time | what it answers |
|---|---|---|---|---|---|
| 1 | **`t11-take-baseline`** | IMG_5132 | **no HDMI** | ~4 min | ⭐ **The record gate's control condition, written B665, never run.** FHD take alone, then 4K take alone. **The 13.4fps figure re-measured post-B681** |
| 2 | **`a1-render-fresh`** | IMG_5132 | none | ~2 min | the render CONTROL. Everything else is measured against it |
| 3 | **`a2b-render-while-broadcasting`** | IMG_5132 | **HDMI** | ~3 min | **concurrency.** Most likely to kill the process — and that is fine, B751's breadcrumbs make a kill a RESULT |
| 4 | **`a2-broadcast-then-render`** | IMG_5132 | **HDMI** | ~8 min | **residue.** Different fix from #3: a release bug, not a capability gate |
| 5 | **`t3-rerun-post-b681`** | IMG_5132 | **HDMI** | ~4 min | take while broadcasting, refreshed |
| 6 | **`a3-bake-then-render`** | IMG_5132, **set the loop mode by hand first** | none | long | the D5 residue question. ⚠️ **A failed bake raises `alert()` and stops the run dead** until you dismiss it |

**Why T11 is first even though it is not "A1":** A1-A3 are the RENDER half and T11/T3r are the RECORD
half. **They are two independent questions, not one sequence.** T11 needs no HDMI, is the cheapest,
and unblocks the gate that phase 2 has been stuck on since B704.

### Which devices?

**Everything above on the M1 iPad Pro.** That is where every failure in this arc happened, and
running four devices before we know the axis exists multiplies cost without adding signal.

**One exception worth the extra run: `t11-take-baseline` on the 8GB iPad Air**, after the Pro number
exists. Record is the memory- and thermal-sensitive path, and the Air is the only controlled A/B we
own (same silicon, half the memory). **Not simultaneously — get the Pro number first.**

**Not the Macs**, beyond step 0. They swap rather than jetsam-kill, so a desktop pass says nothing
about the iPad's failure mode.

---

## What each result would mean

| outcome | reading |
|---|---|
| A1 passes, A2b crashes | **concurrency is the axis.** Gate 2 becomes a concurrency gate, and OPFS is NOT the fix |
| A1 passes, A2 crashes, A2b passes | **residue is the axis.** A release bug, and it is the same family as B571/B667 |
| all of A1/A2/A2b pass | the axis is neither, and the 2.63GB escalation is next |
| T11 4K take ≈ 13.4 fps | the refuse rule stands; build the take-tier cap |
| T11 4K take is healthy | **B681 fixed it and there is no cap to build.** The gate shrinks to a warning |

---

# 🅿️ CARRIED FORWARD — still open, reprioritised at B752

**What changed underneath these lists:** the source-size cliff was removed at B738 and the size
hypothesis died at B750/B751, so anything phrased around a byte threshold is now asking a question
that has no answer. **Three items moved and one died:**

| item | B752 status |
|---|---|
| **B8 — load 3+ 4K clips in sequence without leaving the app** | ⭐⭐ **PROMOTED TO HIGH, and it is the highest-value unrun test outside the matrix.** It is the concurrency hypothesis from a third angle AND it is the **stage manager's core question** — nine sources on deck, only two in working memory. `sessions.peak` is the readout and it needs **no build**. Run it right after the matrix |
| **A8 — a second context loss during a recovery** | **Still the one I would not skip.** Every recovery path in this arc was built and verified against a SINGLE loss |
| **A5 — `preview` lost at the motion → perform switch** | still B703's owed verification, still unrun |
| **B7 — record while broadcasting at 4K** | **superseded** by `t3-rerun-post-b681` in the open session |
| **B4 — bake a 4K loop while broadcasting to HDMI** | **effectively A2b's sibling.** Run it only if A2b shows something |
| **D1 / D2 / D3 / D4** | ✅ **all run 2026-08-24.** Kept below for the reasoning |
| **D5 — three bakes in one launch** | **became script `a3-bake-then-render`.** Do not run it by hand |
| **🪦 B10 — "a clip over 1.5GB, the silent cliff"** | **DEAD.** The 1.5GB cap became computed `sourceBudget()` at B738, and B750/B751 killed the size hypothesis outright. **There is no cliff to confirm.** Struck rather than deleted so it is not re-derived |

**Part C (platform path confirmation) is still valid and still cheap**, and it is exactly the
"spot-check, change nothing" pass in step 5 of `PLAN-LIVE-READINESS.md`. **It is also how we would
catch the colour bug from the other side** — the three disagreeing colour paths mean "which path ran"
is now a correctness question, not just a performance one.

---

## Part A — provoked losses (frame-cost panel → `lose context`). Mostly DESKTOP.

Arm at 10s, close the panel, get to the state, let it fire. **Run desktop first; only A5-A7 need the
iPad.** Copy a report after each.

| # | surface | state when it fires | what it is really asking |
|---|---|---|---|
| A1 | `preview` | idle, clip loaded | ✅ **PASS on B724** (459ms). The B723 run was a false FAIL from an incomplete harness. |
| A2 | `preview` | **mid-bake** | ✅ **PASS 2026-08-24** (541ms; the timeout in that trail is the modal). |
| A3 | `preview` | mid-broadcast | ✅ **PASS 2026-08-24** (399ms, Brave, 4K to an output window). |
| A4 | `yuv-source` | scrubbing the timeline | ⚠️ **NOT ACTUALLY RUN** — the 2026-08-24 attempt provoked `preview`. Re-run on B725, which names the surface on the button. |
| A5 | `preview` | motion → perform, right at the switch | **this is B703's owed verification.** Was the deadlock actually fixed |
| A6 | `output` / `live-pip` | mid-broadcast over HDMI | the surface the audience sees |
| A7 | `external` | during a loop wrap | the wrap is the one moment the external path is doing real work |
| A8 | `preview` | **twice, ~2s apart** | nobody has ever tested a second loss during a recovery. `now` twice, or 3s then 3s |
| A9 | any | while the Loop Builder is open | does a sheet-owned surface come back, or does the builder need reopening |

**A8 is the one I would not skip.** Every recovery path in this arc was built and verified against a
single loss.

---

## Part B — organic provocation. The list of known and suspected crash triggers.

**These are the real ones**, drawn from what has actually killed the app this arc. Each is worth
attempting deliberately now that the listening side is complete.

| # | action | why it is on the list |
|---|---|---|
| B1 | scrub the crossfade on a 4K clip in the Loop Builder | **killed B705 outright.** The single most reliable crash we have |
| B2 | 4K clip + ambitious pan/rotate animation, then switch to perform | Daniel's B705 session: source and output panels lost, broadcast kept playing |
| B3 | load a NEW 4K clip while broadcasting | source swap under load; the swap path is where B703's deadlock lived |
| B4 | bake a 4K loop while broadcasting to HDMI | two 4K jobs on one media engine, the combination the external view tears itself down to avoid |
| B5 | attach/detach HDMI mid-broadcast | an OS-initiated loss is documented when a 4K display attaches |
| B6 | background the app mid-bake, return after ~30s | iOS purges GPU resources; nothing has tested a bake across that |
| B7 | record while broadcasting at 4K | the record gate exists to refuse this and does not yet |
| B8 | load 3+ 4K clips in sequence without leaving the app | tests whether teardown actually releases. `sessions.peak` is the readout |
| B9 | rapid mode switching (still → motion → perform → still) with a 4K source | mode changes are breadcrumbed since B695 and have never been stress-tested |
| ~~B10~~ | ~~a clip over 1.5GB~~ | 🪦 **DEAD at B752.** The cap became computed `sourceBudget()` (B738) and the size hypothesis died (B750/B751). No cliff to confirm |

**⭐ B8 is the one to run**, and it is now high priority for two reasons at once: it is the
concurrency hypothesis from a third angle, and it is the stage manager's core question. No build.

---

## Part D — the two single-variable iPad tests (do these FIRST, they are cheapest)

**The 4K slice bake dies at frame 4 on the iPad, deterministically.** One run each, no build needed:

| # | change ONE thing | survives → |
|---|---|---|
| D1 | bake the same 4K clip at **1080p output** (format control) | ❌ **FAILED 2026-08-24.** Output resolution is NOT the lever |
| D2 | bake the same 4K clip in **bounce** mode (one reader, not slice's two) | ❌ **FAILED at frame 1 — but CONTAMINATED**, it ran straight after D1 in the same session |
| **D3** | **re-run D2 from a FRESH LAUNCH** | ✅ **RUN 2026-08-24.** Encoded all 6,387 frames where the contaminated D2 died at frame 1. **A failed bake does not release its memory.** Failed at the HANDOFF instead: `bake-rejected · the baked clip failed to load` |
| **D5** | **three bakes in ONE launch**, fresh Loop Builder each time | does the failure point walk earlier each time? Cheapest test of the residue question, no build needed |
| **D6** | **⚠️ CONTROL THE FILE FIRST.** iCloud gave the iPad a 334MB copy of the same clip the Macs got at 741MB. **Check `sourceSwap[].size` before comparing any two reports.** Get the identical file onto every device (AirDrop the original, not the Photos copy) | any cross-device number is meaningless until this holds |
| **D4** | **a vanilla bake, no edits, on B729+, ONE PER LAUNCH, on EACH machine** | ⭐⭐ **the run everything now waits on.** Read `bakeDecode.mem.peakMB` + `peakBy` (how much, which term), `bakeMem.heldMB` (residue: ours or GC), and `mem.deviceFreeMB` (the blind spot). **`peakMB` should be IDENTICAL across devices for an identical job; only the outcome differs.** **RUN 2026-08-24: M1 Max 3188.5MB, M5 Max 3188.6MB, M1 iPad Pro 1627.3MB — all PASSED.** iPad Air outstanding. |

**Change nothing else.** Same clip, same trim, defaults everywhere else. **One bake per app launch**
— D2 proved that a second bake in the same session is not the same experiment.

**⚠️ Xcode confirmed the cause on 2026-08-24:** *"terminated because it is using too much memory."*
So D3/D4 are no longer asking IF it is memory. They are asking **how much, and of what.**

---

## Part C — platform path confirmation. One clip, every platform, two questions each.

**Are we on the fast path everywhere we think we are?** Every cell is *load one FHD clip, render,
bake*, then read the panel. **This is not a performance test** — it asks which CODE PATH ran.

| platform | render path to confirm | bake path to confirm |
|---|---|---|
| iPad (Capacitor) | native decode + planar (`⚠ NOT ON THE PLANAR PATH` must be absent) | WebCodecs reader, not element seeking |
| iPhone (Capacitor) | same, **and this is the mobile chrome — a different code path entirely** | same |
| Chrome / Electron desktop | element or planar as expected | WebCodecs reader |
| Safari desktop | **the readback winner differs per device here** (`reference_browser_engine_gotchas`) | WebCodecs reader |
| Firefox | expect the texture cap quirk; confirm it degrades honestly | WebCodecs, or an honest fallback |

**The tell for the bake path is in the report:** a `bakeDecode` block means the WebCodecs reader ran.
**Its absence means the element-seek fallback ran and said nothing** — which is the same silence as
the 1.5GB cliff, from a different cause.

**⚠️ Compare `bakeDecode` across platforms ONLY when the geometry matches.** Open the Loop Builder,
choose slice, **touch nothing else** (defaults: `slicePoint 1/3`, `crossfadeMs 500`). Before B722 a
passing run reported the post-bake reset instead of what it baked, so **no pre-B722 success report is
comparable to anything.**

---

## Still outstanding, small enough not to need their own session

**B704** — reset canvas should now EASE the pan; set a slow transition speed in perform mode.
(**B703 is folded into A5 above.**)

---

# ▶ CARRIED FORWARD — one item, and it does not need a device

## T6 — WHAT DOES AN INTERACTION ACTUALLY COST (mostly NOT a device test)

Promoted straight to second place by T2's answer. **The first cut is Class 1 and runs on desktop**: with the ledger open, compare idle against a sustained canvas drag and read which surfaces and passes move. Candidates already in view — the overlay redraw, `foldSliceIntoSource` re-running on every render inside a drag (which is also the radial-pan suspect), history/state writes per pointermove.

**Only the confirmation belongs on device.** Do not spend a session on the enumeration.

---

---

# 🅿️ CLOSED SESSIONS

| session | file |
|---|---|
| B658-B704 — "where is the ceiling, and is it a number we can compute?" | `archive/VERIFY-QUEUE-b658-b704.md` |
| B599-B609 | `archive/VERIFY-QUEUE-b599-b609.md` |
| B573-B597 | `archive/VERIFY-QUEUE-b573-b597.md` |
| B382-B476 | `archive/VERIFY-QUEUE-b382-b476.md` |

Answers live where they get read, not here: **B609's three** in `PLAN-LIVE-READINESS.md` §1, **the
loop hold** in `BROADCAST-DELIVERY.md` §6a, **the ceiling session** in `PLAN-LIVE-READINESS.md`
"Where we are".

# 🅿️ PARKED — not this session

Pulled forward one session at a time. Nothing here is blocking.

**HDMI / external display** — the stale-broadcast-at-startup mystery on iPad, the 25–45s source-switch lag, iPhone HDMI in record mode, portrait vertical squish. B549/B551/B552 built the instruments; B559 gives the view a voice. **iPad 4K HDMI itself now reads healthy (B559)**, so what remains is the startup and switching behaviour rather than throughput.

**The 4K unaccounted third** — camera vs still image at the same resolution, two reports, no rebuild. Settles H2 and names the next optimization target.

**Frame-header pass (B546)** — FH-1, FH-2 and the still-after-camera check all confirmed (B559). Remaining: the iPad video-to-display clock check.

**Behaviour confirmations** — PiP starve rules at 4K vs FHD; A/V sync across smoothing modes.

**Loop Builder** — desktop, independent of all of the above. Cancel mid-bake, back-nav during bake, iPad safe-area header collision.

**Long-standing** — B382 external-display/GL-context cluster, large-clip HDMI staging, NDI HD-vs-FHD over WiFi, Movink resolution re-verify.

Detail for any of these is in git history (`docs/VERIFY-QUEUE.md` before B553); ask and I'll bring one forward as a focused session.
