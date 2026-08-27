# archived — VERIFY-QUEUE session B737: "does the O(1) bake actually arm?"

**CLOSED at B752.** Archived rather than deleted, per the standing rule.

**Outcome: YES, and it retired the question that came after it.** R0 and R1 both passed — the
741,685,378-byte original baked at `peakMB` 130.9 on an M1 Max, **114.9 on an M1 iPad Pro and 71.6 on
an 8GB M1 iPad Air**, both of which had FAILED the identical job at B730. R2 (the reference-point
table) was overtaken: `peakMB` turned out to be 72-132MB on every device at every clip length, so the
2-D table it was meant to produce has no varying term to tabulate. **D5 lives on as script `A3`
(bake, then render) in `shell/scenario-runner.js`.**

---

# ▶ OPEN SESSION (B737) — DOES THE O(1) BAKE ACTUALLY ARM?

**The question:** *has the streaming reader ever run on a device, and does the memory model hold?*

**⚠️ EVERY DEVICE RUN SINCE B735 HAS SILENTLY USED THE SLOW FALLBACK.** `bake-decode-none`, no
WebCodecs reader, per-frame `<video>` seeking. **34.5s → 345s → 293s on the same clip.** Nothing about
the O(1) design has been exercised yet.

## ⭐ R0 — DESKTOP, FREE, BEFORE ANY DEVICE TIME

`npm run dev`, the **741,685,378-byte original** (not the Photos copy), vanilla slice, one bake.

| check | pass |
|---|---|
| **speed** | **~35s.** Minutes = still on the fallback |
| `bakeDecode` present | **`bake-decode-none` = STOP, send the report** |
| `peakBy` | `sample-index` ~0.2MB · `parse-window` = moov size · peak **well under 100MB** |
| the file | **play it, save it, open it in another app** |

**This exact check has caught the same class of failure twice. Do not skip it.**

## R1 — then ONE iPad Pro run, one bake per launch. Then the Air.

Same file, vanilla slice. `peakMB` should match the desktop's to a decimal. **Check `srcBytes` reads
741,685,378 first** — Photos hands out a 334MB re-encode and AirDrop is not enough, the file must
arrive via Files.

## R2 — the reference point, once R1 passes

Three bakes on the iPad Pro to bracket what we can honestly claim: **FHD vanilla**, **the 334MB 4K
copy**, and **the 741MB 4K original**. That produces the published table.

## D5 — the residue question, no build needed

**Three identical bakes in ONE launch**, fresh Loop Builder each time. `peakMB` must be constant; the
measurement is whether `bakeMem.device.freeBeforeMB` returns to baseline before each one.

---


