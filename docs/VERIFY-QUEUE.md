# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG. Closed sessions are archived under `archive/VERIFY-QUEUE-*.md`.

---

# ▶▶▶ WHERE THE ARC IS — read this before picking a test (B759, 2026-08-27)

**This doc is Daniel's.** It should be readable without opening `HANDOFF.md`. If you need a fact to
run a test, it belongs here.

## The arc in one paragraph

Phase 2 set out to find the app's limits and build a capability ladder. **Measurement retired most of
the ladder by fixing the limits instead.** Memory, file size, clip duration, the 4K-take refusal, the
record-while-broadcast refusal and the device table are all gone as gates. What is left is far
smaller: **one real binary** (can we read these bytes), **one forecast** (how long a job will take),
and **one warning with a number** (what a concurrent operation costs you).

## ⚠️ AND THE THING NOT TO LOSE SIGHT OF

**The last ~10 builds went deep into bitrate, pacing and the bake handoff.** That work was necessary —
every render and every take the app produced was visibly broken — but it is **hardening, not the
arc's goal.** The high-priority feature work waiting behind it, in Daniel's order:

1. **⭐ COLOUR MANAGEMENT — the input transform.** *"Without this the app isn't super usable for real
   output."* We currently have **three disagreeing colour paths**, one of which (`engine/yuv.js`,
   the native decode path behind in-app playback and broadcast) **hardcodes BT.601 with no transfer
   function and no primaries**. B747 turned this from a latent bug into a visible regression.
   **Scoped and agreed: one conversion seam in the shader, driven by real source metadata, defaulting
   to BT.709.** Not a throwaway — it is stage one of real colour management.
2. **Stage manager** — spec captured in `PLAN-LIVE-READINESS.md`.
3. Tileable still output, vector overlays, DAM round-trips (Lightroom / Capture One / PhotoLab).

**Do not let the verification queue below out-compete item 1.** It is the documented failure mode of
this arc: a well-defined next step out-competing an important one.

---

# ✅ CLOSED — do not re-run these

| what | outcome |
|---|---|
| **The B752 concurrency matrix** (6 cells) | **All six ran.** Nothing crashed from concurrency |
| `t11-take-baseline` | FHD alone **46.6 fps** · 4K alone **17.1 fps** (was 13.4 pre-B681) |
| `a1-render-fresh` | **55.2 fps**, `gl 1` |
| `a2b-render-while-broadcasting` | completed, 31.2 fps (**−43%**) |
| `t3-rerun-post-b681` | **both takes completed, NO GL loss.** 23.6 broadcasting vs 46.4 alone |
| **The 4K bake failure** | **ROOT-CAUSED + FIXED B758.** An ordering bug, not a capability limit |
| **The `NotFoundError` / file-handle mystery** | **CLOSED by A3-take2** — see below |
| **The suspend hypothesis** | **DEAD.** `backgrounded: {count: 0}` on every failure that mattered |
| R3 (render bitrate) | **Confirmed on device.** 74.6 Mbps / 782MB, *"dramatically improved"* |

### ⭐ WHY THE FILE-HANDLE QUESTION IS CLOSED

The `NotFoundError` on the 741MB file appeared once, at B755, in a run whose bake had **failed**.
`A3-take2.json` runs the **identical sequence** — bake then render — on B758 and comes back
`sourcePath: webcodecs-reader`, no error, 3178 frames in 59.6s. **The error was collateral from the
broken swap, not a handle lifetime problem.** R1b-b1 and R1b-b2 (the background tests) are therefore
**dropped**; `backgrounded` stays in the report as a cheap watch.

### ⭐ AND WHAT B758 ACTUALLY FIXED

`applyBakedClip` ran while every VideoDecoder the bake opened was still holding its GPU surface pool.
The swap is the largest GPU allocation in the operation, so it arrived with device-free at ~127MB and
iOS purged the GPU process, killing the WebGL contexts.

| | before B758 | after |
|---|---|---|
| `gl-context-lost` after a 4K bake | **4×** | **none** |
| `deviceFreeMB` after | 127 | **921** |
| bake wall time | 558s | **156s** |

**Our own process footprint was 39MB with 5GB of jetsam headroom in both.** This was never our
memory ceiling.

---

# 🔬 OPEN — in order

## 🔴 V1 — RE-RUN `t11-take-baseline` ON **B759**. Two fixes are untested.

**⚠️ You must be on B759.** B758 has a regression that makes this test fail.

**What went wrong on B758 (my bug, fixed):** B757 raised the take to 0.30 bpp but left the codec probe
at 0.10, so `isConfigSupported` validated 12.4 Mbps while `configure` got 18.7. WebKit throws on that
mismatch and the take **silently drops to MediaRecorder** — which is the 7KB black one-second file.

**Two things this run is the first to test:**

| | reads |
|---|---|
| FHD take **stays on WebCodecs** | `takes[0].engine` must be **`webcodecs`**, not `mediarecorder`. If it falls back, **`fallbackWhy` now says why** (new in B759) |
| FHD at **18.7 Mbps / 0.30 bpp** | **look at the file at 100%.** This is the first FHD take at the bitrate that made the render *"dramatically improved"* |

Also read: `takes[].pacedOut` should be **large** and `droppedToBackpressure` **0**. Never add them.

## 🟠 V2 — THE GL CONTEXT LOSS AT TAKE START (new, 2026-08-27, no report yet)

**Daniel, on B758:** *"almost immediately hit a gl context loss where all panels went gray, throwing
an error accurately reporting that take did not start."*

**Unexplained, and possibly a symptom of V1's bug** — a WebCodecs session that throws at configure may
be leaving the bus in a bad state. **Run V1 first**; if it recurs on B759, this is real and separate.

**If it recurs: `copy report` immediately.** The trail is a 12-entry ring and scenario steps evict
early entries, so a report taken later loses the loss. `priorTrail` survives a full kill.

## 🟡 V3 — B8: THREE OR MORE 4K CLIPS IN SEQUENCE, NO RELAUNCH

No build needed. Read `sessions.peak` and `sessions.live`.

**Why it matters more than it used to:** the A3 runs peaked at **`decode 7`** with **three Loop
Builder decoders still live 940 seconds later** (`acquired 9 / released 3`). Nothing has yet shown
this CAUSING a failure — every run that reached `decode 7` still completed — but **it is the stage
manager's core question**: nine clips on deck against a Loop Builder that retains three decoders per
visit.

## 🟢 V4 — THE 8K QUALITY TIERS (desktop, free, 2 minutes)

Never seen by a human, only harness-proven. In the render sheet: at **8K**, every quality tier above
`draft` should be **disabled with a tooltip** naming the 120 Mbps ceiling. Switch back to **4K** and
the tier you had should **come back**. Also confirm the estimated file size tracks resolution, fps and
quality.

---

# 🧪 PRESSURE TEST — what to do once V1 passes

**Every number this arc produced came from a single action, on a short clip, from a fresh launch.**
That is the condition least likely to expose what is left. **Bias toward long, mixed, unattended
sessions**, and treat any failure there as worth more than another clean single-action run.

| # | scenario | believed to work because | limit that remains |
|---|---|---|---|
| 1 | **Broadcast 4K to a 4K display for an hour** | T10: 50 min, no loss, 6ms worst wrap. HDMI re-learned at **30/30 delivered** | none known. **Strongest thing we do** |
| 2 | **Render 4K on an 8GB iPad** | 55.2 fps, `peakMB` ~92, thermal nominal | needs the WebCodecs reader to arm |
| 3 | **Render while broadcasting** | completed, 31.2 fps | **costs 43%** — forecast, not refusal |
| 4 | **Bake a 4K seamless loop** | B758: clean, 156s, `deviceFreeMB` 921 after | on failure it still raises a **blocking `alert()`** |
| 5 | **Bake then render, unattended** | A3-take2: clean end to end | — |
| 6 | **Record FHD** | 46.6 fps → paced to 30 | **V1 is the open question** |
| 7 | **Record FHD while broadcasting** | 23.6 fps, no GL loss, HDMI held 30/30 | **~49% of take fps.** Warn, do not refuse |
| 8 | **A 2.63GB / 8:21 4K source end to end** | B751: 55.6 fps, 270s, clean | — |

**Chain them.** Load → broadcast → bake → load another → render, without relaunching. That is the one
condition nothing has tested, and `sessions.peak` is the readout.

---

# 🚧 KNOWN, OPEN, NOT BLOCKING A TEST

- **A bake failure raises `alert()`**, blocking everything including scripted runs. Measured 243s,
  289s, once **1827s**. Filed since B707. `shell/interrupt.js` already exists as the non-blocking
  replacement. **The worst operator-facing defect in the arc.**
- **A GL loss costs the whole app SESSION** even though the contexts themselves recover in ~474ms.
  Source, panels and dialogs do not come back.
- **4K takes run at 17.6 fps.** Throughput, not bitrate. **The record path has no per-stage timing
  split** like the render's `gl / vframe / enc` — instrument before optimising.
- **Three disagreeing colour paths** — see the top of this file. This is feature work, not a test.
- **`t7-warm-long-run` leaves the broadcast on** (B665 era). Daniel's call whether to change it.

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
