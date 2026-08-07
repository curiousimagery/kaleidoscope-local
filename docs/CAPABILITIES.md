# capabilities

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

## 6. Open UX questions these constraints raise

- What does the record menu do with an option the device cannot deliver — hide it, disable it, or offer it with a warning? (Daniel's instinct: offer everything we can honestly support, warn where we cannot.)
- Does the PiP turn itself off at 4K, or does choosing 4K explain that the monitor is unavailable?
- Is there an honest "this will run hot" mode the user opts into deliberately? (Arc goal #4.)
- How does a take that starts fine and degrades at minute ten communicate what is happening without lying about it?
