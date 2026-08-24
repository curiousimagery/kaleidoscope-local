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

**v0.26.54 · B714** (2026-08-23). **B705 and B706 are device-verified** — B705's instrument found B706, and B706 held on the repro that killed B705. B703, B704 and B707 are not yet device-verified.

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

