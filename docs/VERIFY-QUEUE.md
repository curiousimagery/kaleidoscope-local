# verification queue

**Format (Daniel, B553):** one focused SESSION at a time, framed as a question we're trying to answer, with steps in the order you'd naturally do them in a single Capacitor run. Not a matrix. Everything not in the current session lives in the parked list at the bottom.

**Batching rule (Daniel, B559):** a session should let you vary things in ONE sitting rather than cross-reference builds. Where a question needs an A/B, the switch is in the frame-cost panel and both answers come from the same build.

Confirmed results are DELETED from here and recorded in CHANGELOG. Closed sessions are archived under `archive/VERIFY-QUEUE-*.md`.

---

# ▶ OPEN SESSION (B723) — WHERE DOES IT BREAK, AND DOES IT HEAL?

**The question:** *which surfaces survive a context loss, which organic actions still crash us, and
does every platform render and bake on the path it should be on?*

**Grading, once for the whole session.** A provoked loss is a **PASS** when the trail shows
`gl-context-restored` for that surface and the picture returns with no operator action.
`gl-restore-failed` / `-incomplete` / `-timeout` are FAILs. **A loss with none of the four means the
app died inside the window**, which is the worst result and the most useful one.

**Before reading any report from this session, check for `gl-loss-provoked`.** Provoked and organic
losses are otherwise indistinguishable, and mixing them poisons the evidence.

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
| B10 | **a clip over 1.5GB** (roughly 4K over ~4 min) | **the silent cliff.** Expect a working but very slow bake, with nothing said. Confirms the BACKLOG finding on real hardware |

**B10 is a reading, not a crash test.** It is the cheapest confirmation of the limits finding and it
needs no instrumentation.

---

## Part D — the two single-variable iPad tests (do these FIRST, they are cheapest)

**The 4K slice bake dies at frame 4 on the iPad, deterministically.** One run each, no build needed:

| # | change ONE thing | survives → |
|---|---|---|
| D1 | bake the same 4K clip at **1080p output** (format control) | the ceiling is OUTPUT resolution |
| D2 | bake the same 4K clip in **bounce** mode (one reader, not slice's two) | the ceiling is concurrent 4K decoders |

**Change nothing else.** Same clip, same trim, defaults everywhere else.

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
