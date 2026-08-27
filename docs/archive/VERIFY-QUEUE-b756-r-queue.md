# archived — VERIFY-QUEUE session B756: the R queue

**CLOSED at B759.** R1/R1b/R3 answered; the bake failure was root-caused to an ordering bug and
fixed (B758). Live follow-ups moved to the B759 session. Kept for the reasoning.

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
