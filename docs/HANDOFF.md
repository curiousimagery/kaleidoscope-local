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

**v0.26.46 · B706** (2026-08-21). B703, B704 and B706 are in the tree and **not yet device-verified**; B705's instrument is verified — it produced the reading that found B706.

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

### ✅ B706 — THE INSTRUMENT PAID FOR ITSELF IN ONE SESSION. ROOT CAUSE FOUND AND FIXED.

**B705 shipped the instrument; the very next report named the cause.**

```
gl-restore-failed · preview  · why "source has no dimensions yet"
gl-restore-failed · live-pip · why "source has no dimensions yet"
```

**It is our bug, not the GPU's.** `reinitGL` rebuilds the context fine, then re-uploads the source. `setSource` throws on a 0×0 element — what a `<video>` reads for a moment mid-swap. Daniel hit it scrubbing a 4K clip across the crossfade in the loop builder, where **there is no planar provider to absorb it**, so it rethrew, `sourceTexture` stayed null, and nothing ever retried. **The second half of the B703 deadlock, which B703's own comment predicted.**

**✅ Fixed B706** — transient failures queue a retry that completes on the next frame with dimensions; `maxTextureSize` failures still throw. `reuploadPending`/`reuploadTries` in the report. `scratchpad/reupload-check.mjs` 8/8.

**✅ And `8-21-contextLoss-03.json` is a PASS:** three surfaces lost, all three restored (982ms / 1.26s / 2.3s), source healthy at 29.3 in/s. **B704's withdrawn headline is retired for good — `preview` recovers, and always could.**

### ⚠️ THE CRASH ITSELF IS STILL OPEN — THIS IS THE NEXT DEVICE TASK

B706 removes the permanent-black consequence. **It is unproven that it removes the crash** — the failed restores may have been a symptom of whatever killed the process, not the cause.

**▶ Re-run the loop-builder 4K crossfade scrub.** Survives and the picture returns → closed. Still dies → a separate cause, and the trail is now legible while it happens.

**Three more of Daniel's findings from the same session are filed in BACKLOG, not fixed:** stale timeline/keyframe thumbnails after a clip swap (**re-test after B706 first — it may be the same bug**), AirPlay disappearing from the picker when HDMI is attached, and the output display continuing to play during a render instead of announcing itself the way a bake does.

**Still filed from earlier:** the play button lying after a source swap (`native-video.js:234`, root-caused, small fix), glass-break not reaching the broadcast, and the motion-path unevenness (Class 1, no device needed).

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

