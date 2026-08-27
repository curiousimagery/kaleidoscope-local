# archived — VERIFY-QUEUE session B752: the concurrency matrix

**CLOSED at B756.** All six cells ran. Five passed clean; the sixth (A3) failed in a way that
produced the arc's best lead — `suspended` in the trail, then `NotFoundError` on the 741MB file.
Results live in `CHANGELOG.md` and `HANDOFF.md`; the open follow-ups moved to the B756 session.

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

