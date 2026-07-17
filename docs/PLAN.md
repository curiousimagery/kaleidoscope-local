# PLAN — the single prioritized plan (2026-07-17)

This is the one place priority lives. `HANDOFF.md` = rolling current state; `BACKLOG.md` = the full item inventory; `CONDUIT-ROADMAP.md` = the package extraction map; the old Capacitor-arc plan (`~/.claude/plans/we-just-finished-a-piped-minsky.md`) is superseded by this doc. When priorities change, change THIS file.

## where we are (what's CLOSED)

The **Capacitor arc** delivered its outcome: Fold runs native on iPhone + iPad with the native camera (lens/EV/WB/48MP/stabilization/tap-to-focus), record video, HDMI + AirPlay out, NDI out on ALL THREE shells (device-confirmed in Arena), native save, and the conduit package extracted with its own repo. The **4B perf sequence** (Daniel-approved, 2026-07-16) shipped end to end: probe-once adaptive readback (B363), the WebCodecs live recorder (B365), async NDI sends + drain profiler (B366), the fast decode path for renders (B367, mp4box dependency approved), and the save-flow convergence (B370). Measured wins: Electron 4K takes ~50fps; **Brave 1080p renders 364fps, Firefox 72fps** (was ~90/18 pre-sequence); iPad NDI 25.5→29fps produced.

## P0 — the gauntlet loop (fix ↔ device-verify until green)

Daniel tests in batches; each round's failures get fixed in one batch build. Round-3 fixes shipped (B371): take duration crash, success-toast phantom retry button, NDI status honesty (delivered fps, not rendered). **Round 3 checks:**
1. iPad take saves (third error class: first decoderConfig, then duration — both structural, both fixed; expect success or a NEW reason in the status line).
2. iPad NDI status line now reads ~20fps (the honest wire number; see P1 transport decision).
3. iPhone toasts: retry button only on failures.
4. iPhone .zip package path (record video → download → package).
5. Firefox export-stutter retest (exact repro: export a motion render FROM A VIDEO SOURCE in Firefox; the editor plays smoothly but the exported FILE stutters — pacing/dropped-duplicated frames. Distinct from cold-start scrub lag and from slow-mo choppiness. The fast decode path may have killed it).

## P1 — stabilization + performance lane (the field-pass findings, 2026-07-16)

Daniel's outdoor iPhone practice surfaced the real-world list. In priority order:

1. **iPhone record quality + reliability** — pixelation/compression artifacts at 1080p (droste interior circles blocky = bitrate starvation, not resolution), stop sometimes not stopping after ~2min takes, save sometimes failing. All three are WebKit-MediaRecorder pathologies; the mobile record path is the LAST MediaRecorder consumer. **The fix is porting the proven WebCodecs recorder session (conduit) into the phone chrome's record path** — gated on the iPad take being device-proven first (the delicate-path rule). Explicit bitrate lands the quality; no captureStream lands the reliability.
2. **Still-capture latency + fidelity** (existing BACKLOG item, priority raised by field use): ~2s capture lag with dishonest feedback timing; brightness DARKENS meaningfully on capture; alignment shifts slightly (the stabilization-crop estimate vs the un-stabilized still). Needs a device-paired session: profile where the 2s goes (0.18s settle + format switch shouldn't cost 2s), then honest feedback, then the crop calibration.
3. **8K still save fails consistently (iPhone)** — next round: capture the save-flow toast reason + any console line; likely the FBO/memory ceiling (probeExportMax 8192 passing but the real export OOMing). Fix shape: trust a REAL allocation test or cap the phone's offered sizes honestly.
4. **iPad NDI FHD transport decision** — the drain profile proves the native side idle (`frame gap 50ms, copy 0.4, send-wait 0.0`): the WebKit WebSocket send path itself caps ~20fps at 8.3MB/frame. Options: (a) **GPU RGBA→UYVY** halves wire bytes → ~40fps headroom AND skips the SDK's conversion (a shader pass; 4:2:2 chroma — visually fine for NDI); (b) fetch-POST unmasked transport (saves two XOR passes, gain uncertain); (c) ship guidance: FHD ≈ 20fps vs HD tier ≈ 30fps+, performer's choice. Recommendation: (a) when this lane is picked up, (c) meanwhile.
5. **Thermal / sustained load** — devices run hot, high power draw. Fold Lane 5 (graceful degradation) expands: not just "older devices cope" but "modern devices SUSTAIN" — frame-rate governors when thermal pressure shows (iOS `ProcessInfo.thermalState` via a host seam), idle-render elision, and honest sustained-fps expectations per tier.
6. **Clip-bake fast decode** (two-reader design per BACKLOG) + **bake fps estimation** — after the export path is field-proven.
7. Cosmetic: mp4box parse noise in the console on some sources (`[BoxParser] Invalid box type`) — harmless (parser recovers, fast path engages), quiet it when touching video-decode next.

## P2 — save/UX tails (from the audit, post-gauntlet)

Desktop parallel-source recording (product decision: memory cost of a second take) → then the package option beyond the phone; stills' exportStatus migrates to the save-flow voice.

## P3 — conduit extraction (the multi-app mandate)

Per `CONDUIT-ROADMAP.md`, starts when the gauntlet is green: tier A pure-JS moves (capture probe, save transport, FNDI protocol), tier B native host packages (conduit-electron, conduit-ndi-capacitor), tier C design-first (external-display plumbing; capture-domain detection = sibling package). Second app onboarding is the forcing function.

## P4 — parked / strategic (pointers, not plans)

Tier 3 native iOS capture (only if the above underdelivers); OPFS streaming for long takes/renders; frame interpolation (creative capability — jumps the queue if live slow-mo matters); VFR source hardening; iPhone-as-capture-for-Electron; edition gating map; input arcs (CONTROL BUS v2, MIDI gauntlet) per BACKLOG.
