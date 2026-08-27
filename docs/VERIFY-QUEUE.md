# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG. Closed sessions are archived under `archive/VERIFY-QUEUE-*.md`.

---

# ▶▶ OPEN SESSION (B756) — WHAT THE B752 MATRIX ANSWERED, AND WHAT IS LEFT

**The B752 matrix is COMPLETE. Six cells, five clean passes, one failure that turned out to be the
most useful run of the arc.** Results are recorded in `CHANGELOG.md` and `HANDOFF.md`; this section
now owns only what is still OPEN.

## ✅ CLOSED BY THE MATRIX — do not re-run these to "confirm"

| cell | result |
|---|---|
| `t11-take-baseline` | FHD alone **46.6 fps** · 4K alone **17.1 fps** (was 13.4 pre-B681) |
| `a1-render-fresh` | 3193 frames, 57.8s, **55.2 fps**, `gl 1` — replicates B751's 55.6 |
| `a2b-render-while-broadcasting` | **completed**, 31.2 fps (−43%), no crash |
| `a2-broadcast-then-render` | **completed** |
| `t3-rerun-post-b681` | **both takes completed, no GL loss.** 23.6 broadcasting vs 46.4 alone |
| `a3-bake-then-render` | bake FAILED after 558s → `suspended` → `NotFoundError` on the 741MB file |

**⭐ Gate 3's refuse rule has no evidence behind it any more.** The B571/B667 cluster did not
reproduce. What remains is a measured cost to WARN about, not a reason to refuse.

---

## 🔴 R1b — THE BACKGROUND TEST, RE-RUN. **The first attempt could not answer.**

**⚠️ R1 (2026-08-27) came back CLEAN and is INCONCLUSIVE, not a refutation.** Probe read in 2ms, the
reader armed, 53.4 fps. But the `suspended` detector only fires inside a recording session, and the
app was backgrounded *before* the scenario started — **nothing could have detected it.** B757 adds an
always-on `backgrounded` block to the report so this is answerable.

**⚠️ AND R1 CHANGED THREE THINGS AT ONCE** versus the A3 failure: no 9-minute bake first, a much
shorter session, and an unknown suspend duration. A clean result there does not isolate anything.

**R1b — vary ONE thing. Fresh launch each time, IMG_5132, same render:**

| # | do this | reads |
|---|---|---|
| **b1** | background **~2 minutes**, return, render | `backgrounded.count` ≥ 1, and does the reader arm? |
| **b2** | background **~10 minutes**, return, render | duration dependence |
| **b3** | run a **bake first** (slice), then render — no backgrounding at all | isolates the bake from the suspend |

**⚠️ CHECK `backgrounded.count` IN EVERY REPORT.** If it reads 0, the app never actually went to the
background and the run says nothing.

| outcome | reading |
|---|---|
| b1/b2 throw `NotFoundError` with `count ≥ 1` | ⭐ handle dies on suspend, duration-dependent. **Build OPFS** |
| b3 throws and b1/b2 do not | **it is the BAKE, not the suspend.** Look at `openHandles: 4` and `heldMB 55.6` |
| all three clean | the A3 failure needs a different explanation — re-open with the full A3 sequence |

---

## 🟠 R2 — RE-RUN `t11-take-baseline` ON B754+, BECAUSE THE PACING CHANGED WHAT IT MEASURES

**The question:** *did pacing fix the FHD picture, and what did it cost?*

The FHD take was handing a 30fps-configured encoder **46.6 fps**, so every frame got ~64% of its
budgeted bits (0.129 bits/px, against 4K's 0.282 — which is why 4K looked BETTER). B754 paces to 30.

**Same script, same source, fresh launch. Then LOOK AT THE FILES, because this is an eye test, not
only a number test.**

| read | expect |
|---|---|
| `takes[].takeFps` FHD | **~30**, not 46.6 |
| `pacedOut` | **large** — that is the limiter working |
| `droppedToBackpressure` | **0**. ⚠️ **Never add these two together** |
| the FHD file at 100% | **the macroblocking should be visibly reduced.** Compare against the take from `01-t11report.json` |
| `takes[].takeFps` 4K | unchanged near 17.1 (pacing does not fix throughput) |

---

## 🟢 R3 — THE RENDER BITRATE A/B. **Desktop. Free. No device time.**

**The question:** *does 0.30 bpp actually fix the macroblocking Daniel photographed?*

**Already partly answered on device by accident:** A3's render at B755 asked **74.6 Mbps** and wrote
**948 MB** where B752's asked 24.9 and wrote 270. **The lever works.** What is unverified is whether
the picture is now acceptable.

1. `npm run dev`, load any 4K clip, motion mode.
2. Render sheet → **`draft`** → render.
3. Render sheet → **`high`** → render.
4. Compare at 100%, ideally beside a live broadcast (which has no encoder in the path at all).

**Also check while there:** at 8K the quality tiers above `draft` should be **disabled with a
tooltip**, and re-selecting 4K should **restore** the tier you had. That is the B753 preference
memory, harness-proven at 26/26 but never seen by a human.

---

## 🟡 R4 — A3 AGAIN, ON B756, WITH THE SETUP RIGHT

**Two things were wrong the first time and both are fixed:**

- `forward` mode now refuses at **pre-flight** by name rather than aborting at step 3.
- **The bake verb no longer reports `ok: true` for a failed bake** (B752 tested "did the teardown
  run", and the teardown runs on every exit path — the wrong noun).

**Setup:** Loop Builder → **slice** at the Behavior step → advance to the bake step → run A3.
**Not** the loop toggle in motion mode's overflow.

**⚠️ Expect the bake to be slow and possibly to fail again**: the first attempt took **558s** for a
1:46 clip and left `heldMB 55.6`. **If it fails you will be behind a modal** — that defect is filed
and unfixed. **Run R1 first**; if the handle dies on suspend, A3's failure may simply be R1 again.

---

## 🟡 R5 — B8, PROMOTED AT B752 AND NOW STRONGLY SUPPORTED

**Load 3+ 4K clips in sequence without leaving the app**, reading `sessions.peak`. No build needed.

**B756 raised its priority again**: that run peaked at **`decode 7`** with **three Loop Builder
decoders still live 940 seconds later** and `acquired 9 / released 3`. **This is the stage manager's
core question** — nine on deck against a Loop Builder that retains three decoders per visit.

---

## 📋 PRESSURE-TEST SCENARIOS — Daniel's ask, 2026-08-27

**Everything above is a single action on a short clip.** `HANDOFF.md` carries the list of real-world
scenarios that are now believed to work, with the reason and the remaining limit for each. **Use it
as the script for a strained-conditions pass**, and treat any failure there as more informative than
another clean single-action run.

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
