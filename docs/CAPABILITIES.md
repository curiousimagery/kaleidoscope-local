# capabilities

> **CORRECTION B557:** the "encoder flush is ~97% of finalize" line from B555 attributed the wait to the VIDEO encoder. It is the **audio** flush — 32.7s of a 33.1s finish on a 3:28 4K take. Video is drained by design (`publish` drops frames above a queue of 4); audio has no such valve. The 30-second-cliff finding is unaffected.

> ## 🛑 CORRECTION B551, NARROWED B552 — THE **MOBILE** TAKE PATH HAS NEVER RECORDED 4K
>
> **My B551 wording was too broad and Daniel was right to push back.** The DESKTOP/iPad path records
> through the output BUS, which has a real 4K tier (`tier >= 3840`, `outputBus.setResolution`) and no
> 2048 cap — 4K takes there are genuine, and he very plausibly did verify 4K files from it. What
> follows applies to the **mobile chrome only** (iPhone), which since B525 encodes the output canvas
> directly rather than going through the bus.
>
> Daniel selected 4K, recorded, and got a **1080p file** (both lenses). Reading `sizeOutput()` in
> `mobile/chrome.js`, the take resolution is structurally capped and always has been:
> - `recordUpscale` lifts the take's **short side up to 1080 and no further** — it is a floor, not a target;
> - a hard `cap = 2048 / max(w,h)` bounds the long side at **2048**, so 3840 cannot survive it.
>
> **On the phone, the "4K" camera setting selects the SOURCE resolution only.** The take has always been ≤1080×2048. The cap dates to **B295** (the 2048 bound, from the original mobile record work) and **B373** (the 1080 short-side floor) — so it is original behaviour, not a regression.
>
> **So every "4K recording" number in this arc measured a 1080p take fed by a 4K source**, including the
> B547 line I wrote saying *"4K/30 recording IS deliverable on the 17 Pro: 31.7fps"*. That was a
> 1080×1080 take. **It is withdrawn.** The honest statement is: a 4K SOURCE costs what those numbers
> say; recording at 4K has never been attempted and its cost is unknown.
>
> This does not invalidate the source-side findings (the PiP starve rule, the round-trip fixes) — those
> were about the cost of *sampling* a 4K source, which is real and correctly measured. It invalidates
> only the claims about 4K *output*.


> **UPDATE B547 (device pass).** Two ceilings moved and one measurement was found to be misleading.
>
> - ~~4K/30 recording IS deliverable on the 17 Pro: 31.7fps~~ **WITHDRAWN B551 — that was a 1080p take from a 4K source. See the correction at the top.** What it does establish: recording a 1080p take while SAMPLING a 4K source runs at 31.7fps on the 17 Pro, up from 11.4 before the PiP starve rule.
> - **Sustained idle is not a thermal problem.** 10 minutes of live camera: 60.0fps, p95 improved 22→17ms, pressure nominal, phone slightly warm. The installation case survives idle; it has not been tested under sustained *capture*.
> - **`unaccountedMs` at idle is not hidden cost.** At 60fps with ~1.1ms of work, ~15.9ms of every 17ms frame is waiting for vsync. Only read `unaccounted` as a signal when the frame budget is actually saturated.
> - **`pressure` cannot be trusted during a take.** It infers from fps against a 60 assumption, so a correct 30fps take reports `critical`. Fix before any governor consumes it.
> - **The HDMI ceiling is still unknown** — the app's own fps and the observed fps on the panel diverge badly (46 vs ~10) and the external surface is uninstrumented.


**What we can actually deliver, on what hardware, and how we find out at runtime.**

This is a living doc. It exists because the thermal arc (B512-B529) turned "it should be fast enough" into measured numbers, and those numbers have to drive product decisions rather than sit in a changelog. Two audiences: the UX work that has to warn, degrade, or hide options honestly, and the detection code that has to decide which case a given device is in.

`CHANGELOG.md` has the build-by-build story. `BACKLOG.md` has the open work. This doc owns **the constraints themselves** and **how we detect them**.

---

## 1. The governing principle: probe, never classify

**Do not gate features on device model, chip generation, or any static profile.** The measurements say this plainly:

> **An iPhone 14 Pro records FHD 30 at 59.9fps with a rock-steady frame (p50 17ms, p95 17ms). An iPhone 17 Pro, three chip generations newer and 40-100% faster on every published benchmark, manages 50.5fps on the same workload with p95 46ms.**

Per registered item the 17 Pro is faster on everything: output render 1.76ms vs 2.97ms, record encode 3.29ms vs 4.08ms, accounted total 5.86ms vs 7.48ms. The chip is exactly as fast as advertised. **The entire difference is one operation** — the PiP's consume of the WebGL canvas — which is nearly free on the older device and costs ~35ms on the newer one.

So a specific graphics operation got *worse* on newer hardware or its driver. Any tier list built from chip generation would have put the 17 Pro above the 14 Pro and been wrong about the only thing that mattered.

**Corollary:** the capability probe must measure the operations we actually depend on, on the device in front of us, at runtime. This matches what the 2026-07 device bench already found for readback paths (winners were per-device, not per-engine).

---

## 2. Known constraints (measured)

### iOS Capacitor — record video

| scenario | 14 Pro | 17 Pro | status |
| --- | --- | --- | --- |
| FHD 30, static | **59.9fps** | 50.5fps | ✅ ship, no warning |
| FHD 30, dragging, PiP on | not measured | 14-18fps | ❌ |
| FHD 30, dragging, PiP off | not measured | ~54fps | ✅ |
| FHD 60, hot, static, PiP off | not measured | 44-53fps | ⚠️ under target |
| FHD 60, hot, PiP on | not measured | 8.4fps | ❌ |
| 4K 30, PiP off | **11.4fps** | 24-28fps | ❌ / ⚠️ |
| 4K 30, PiP on | 11.0fps | ~10fps | ❌ |

**Constraints that follow:**

- **C1. FHD 30 is universally deliverable on iOS**, including a two-year-old phone, including with the monitor live. No warning needed.
- **C2. 4K/60 is not deliverable on any tested device.** Not close. Should not be offered.
- **C3. 4K/30 is device-dependent** and not deliverable on a 14 Pro (11fps, thermally critical inside two minutes). The 17 Pro reaches 24-28fps, under target.
- **C4. The PiP is not affordable at 4K at any rate.** 11.0 vs 11.4fps on the 14 Pro — each consume costs so much that ten per second saturate the budget regardless. **PiP rate must be adaptive, not constant.**
- **C5. Manipulating the slice roughly doubles render cost** while the follower is chasing (measured: 31 `output render` calls for 18 frames). Any budget computed from a static reading is optimistic.
- **C6. Sustained 4K recording fails.** Takes die after a few minutes with "recording failed" and a finish that outlasts the take. Data loss, not just slowness.

### Not yet measured, and therefore unknown

- **HDMI / AirPlay out** — the priority external surface. Registered `remote: true` in B529 but its cost lives in another webview that our ledger cannot see.
- **NDI broadcast on iOS** — registered B529, never read. Deprioritized: significant cycles already spent, and current behavior is not suited to live motion content, especially on iPad.
- **Any Android device, and mobile web on any device.**
- **Perform mode and Motion mode under load.** Every reading in the arc is record-video.

---

## 3. What the instrument still cannot see

Naming these matters as much as the numbers, because an unmeasured path reads as free.

- **The native camera bridge.** At 4K on the 14 Pro, ~33.5ms per frame is unaccounted *while the loop is saturated*, so it is not vsync idle. `refresh` (3.67ms) times only our paint of the delivered planes. Receiving ~373MB/s of YUV over the socket is invisible to us. **Test that isolates it: run 4K with a still image source instead of the camera.**
- **Thermal state, when the device is already hot.** The inferred pressure signal learns a baseline per workload, so a device throttled for the entire measurement window reads *nominal*. It detects drift, not absolute heat. Treat `nominal` as "no worse than when this window started," never as "cool."
- **Real GPU time on WebKit.** No timer extension, so `output render` measures CPU submit. **It doubles as a saturation gauge:** single-digit means the GPU is keeping up, 30ms+ means the command queue is full and the CPU is blocking on submit. Always read `maxMs` beside it.
- **Remote surfaces.** An external display self-renders; its megapixels count toward the power budget, its milliseconds are invisible.

---

## 4. The levers, ranked by measured value

| lever | where it helps | size | status |
| --- | --- | --- | --- |
| PiP rate limit | everywhere | 19.1 → 50.5fps at FHD | ✅ shipped B528 |
| PiP off entirely | 4K, and while dragging | 14-18 → ~54fps dragging | needs adaptive policy |
| Skip the preview render while diverged | during any manipulation | ~35% of frame time | proposed |
| Skip the eased render when idle | not recording/broadcasting | one whole render | proposed |
| Source mipmaps or downsample | 4K only | unknown, the only 4K hope | proposed, needs A/B |
| Output resolution ladder | 4K preview only | large but **unsafe during a take** | see hazard below |
| Onion-skin sample count | — | 0.69-1.0ms total | ❌ dismissed, measured |
| Record encode / capture path | — | 3.3-4.9ms | ❌ dismissed, measured |

**⚠️ HAZARD: the output resolution ladder is no longer safe during a take.** Since B525 the record path encodes the output canvas directly, so scaling that canvas down scales the *deliverable* down. Worse, `recSize` is locked at record start, so a mid-take scale change makes `paintRecord` fall back to the scaling blit — the exact 40ms path B525 deleted. The switchboard currently permits this. Either lock the ladder while `recState === 'recording'` or give the preview its own render target.

---

## 5. What detection has to do

Not yet built. Requirements, so the UX work can be designed against them:

1. **Measure, do not infer.** A short startup probe timing the operations we depend on: consuming the WebGL canvas as an image source, encoding a frame, rendering at each offered resolution. `shell/diagnostics.js` already benches readback paths A-D and is the seed.
2. **Probe per workload, not once.** The 4K and FHD answers differ by more than a scale factor, and per-consume costs scale with the whole pipeline rather than with the thing being consumed.
3. **Report in product terms.** The output is not milliseconds, it is "4K recording will run near 11fps on this device" — which is what a warning or a hidden menu option needs.
4. **Re-check under thermal drift.** A device that qualifies cold may not qualify at minute ten. The pressure signal exists; it needs an absolute reference it currently lacks.
5. **Degrade in declared priority order.** `PRIORITY.DECOR → EDITOR → PROGRAM → CAPTURE` already exists in the ledger and is honored by the PiP. Nothing else consults it yet.

---

## 6. Untested hypotheses worth money

Not exhausted. These are the live leads, ordered by expected value.

- **H1 — The 17 Pro's slow consume is a COLOR SPACE conversion.** The newer phone has a wider-gamut, EDR-capable display. If its WebGL drawing buffer lands in Display P3 while the older one is sRGB, then every consume of that canvas has to convert, which would explain a better display being slower at exactly one operation and nothing else. **Test:** pin `drawingBufferColorSpace` / the context's `colorSpace` to `'srgb'` and re-read the PiP cost. Cheap, and if right it may recover the PiP outright rather than merely rationing it.
- **H2 — The 4K unaccounted third is the native camera bridge.** ~33.5ms/frame unexplained while the loop is saturated. `refresh` times only our paint of delivered planes; receiving ~373MB/s of YUV over the socket is invisible. **Test:** run 4K with a still image source instead of the camera.
- **H3 — We render at 60fps from a 30fps source.** `chrome.js:1561` calls `engine.render(state)` every rAF with no change detection, so with a 30fps camera and no gesture, **half of all renders produce a provably identical frame.** The bus already has this logic (`frameSignature`/`busElide`); the main render never got it. **This is the single biggest lever for the sustained/exhibit case**, where nothing is being manipulated for hours.
- **H4 — Source mipmaps.** The elegant answer to "how much source resolution do we need" is the one the hardware already computes per fragment. Helps only where we minify; a magnifying kaleidoscope gets nothing. Needs a measurement, not a decision.
- **H5 — The double render while diverged** (measured: 31 calls for 18 frames) and **the eased render while idle**, which is not needed at all when nothing is recording, broadcasting, or showing a PiP.

## 7. The sustained-operation target (installations, exhibits)

A different problem from peak throughput, and currently unmet: **hours of smooth running, not seconds of peak.** The device is warm within minutes today.

Peak-fps levers and steady-state-power levers are not the same list. Steady state wants **deliberately capping work**, not extracting maximum work:
- render at the source's rate rather than the display's (H3),
- an explicit frame-rate cap for installation mode,
- no PiP, no overlay, no editor surfaces at all — the priority ladder already describes this and nothing consults it,
- a governor that holds a thermal setpoint rather than chasing the highest number it can reach.

**This target should be stated before the governor is designed**, because "never exceed X" produces a different controller than "go as fast as possible until it hurts."

## 8. Open UX questions these constraints raise

- What does the record menu do with an option the device cannot deliver — hide it, disable it, or offer it with a warning? (Daniel's instinct: offer everything we can honestly support, warn where we cannot.)
- Does the PiP turn itself off at 4K, or does choosing 4K explain that the monitor is unavailable?
- Is there an honest "this will run hot" mode the user opts into deliberately? (Arc goal #4.)
- How does a take that starts fine and degrades at minute ten communicate what is happening without lying about it?
