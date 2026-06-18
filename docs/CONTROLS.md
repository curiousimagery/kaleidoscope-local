# controls, capabilities & I/O

The single reference for Fold's **inputs, outputs, settings, and actions**, plus **where each is available per platform**. This is the coherent "sense of truth" for PLANNED UI, so controls land in a structure instead of ad hoc. It is a living reference, not a spec: the durable program spec is `~/.claude/plans/in-our-last-thread-splendid-sparkle.md`, and rolling state is `HANDOFF.md`.

Seeded 2026-06-17 during Fold Live Phase 0, from the brainstorm of the full output-controls suite. The inventory below is fairly complete; the per-platform matrix is partially filled (outputs/inputs are confident) and grows as increments land. The output controls + traffic-light + the scoped app-bar restructure (opaque bar, expand-bands, canvas relocation) in "Locked UI decisions" shipped across Builds 175-178 (Increments 3.5-3.6). **Status key:** ✅ done · 🔜 in the current Fold Live increment sequence · 📋 planned (later phase) · 💭 speculative (not committed).

## Roles — the grouping logic

Four buckets; keeping them distinct is what prevents control-jamming, because each has a natural home and grouping logic:

1. **Sinks / outputs** — where the one program frame goes.
2. **Output settings** — sink-agnostic config of the frame itself.
3. **Sources / inputs** — what feeds the engine.
4. **Perform / transport** — the instrument (program/preview, transitions, deck).

Plus three cross-cutting groups: **control inputs** (keyboard/MIDI/touch), **status/telemetry**, **session/persistence**.

Architectural anchor (decided): **one program frame, many sinks.** The program is rendered ONCE at the chosen output resolution and fanned to every active sink. So **resolution + aspect + fps are global** (the program frame); only **encode/transport settings vary per sink** (codec/bitrate for disk, server name for Syphon, target display for the window). Per-sink resolution/aspect would mean N renders and is out of bounds.

---

## A. Sinks / outputs

| Sink | What | Status |
|---|---|---|
| Record to disk | MediaRecorder over the bus frame → downloadable file (interim universal stand-in on every platform) | ✅ (Build 175) |
| Syphon out | macOS GPU texture share into Resolume/Arena (Electron) | 🔜 Inc 5 |
| Output-only window | borderless program-only window on a second monitor | 🔜 Inc 6 |
| HDMI out | clean extended display out (Capacitor iOS/iPadOS) | 📋 native |
| AirPlay out | wireless mirror (NOT clean extend on iOS Safari) | 📋 native |
| NDI / RTMP stream | network video out | 💭 not in plan |

Shape distinction (drives the **traffic-light** indicator on the output button): **broadcast** sinks (Syphon/HDMI/AirPlay/window) are *arm-and-leave*, a green "this is live" state; **record** is a *momentary take*, a red "rolling" state. They are **concurrent** — record a take while broadcasting is the key simultaneous case. Green on top, red on bottom; either or both lit.

## B. Output settings (sink-agnostic; configure the one program frame)

| Setting | Notes | Status |
|---|---|---|
| Resolution (long-side tier) | HD/FHD/QHD/4K; default FHD; 4K = "clean hardware only"; never default square 4K | ✅ (Build 176) |
| Aspect | follows `session.frameAspect` (composition-global); venue/projector override deferred | ✅ follows comp |
| Frame-rate target / cap | 30 vs 60; pacing + perf | 📋 |
| Color range / colorspace | Rec.709 vs full range; ties to the iPhone washed-out bug | 📋 (with color pass) |
| Output transform (flip/rotate) | Arena Y-flip, HDMI orientation | 🔜 Inc 5 (Y-flip verify) |
| Test pattern / calibration | reference frame to prove clean arrival (flip/color/scale) — a diagnostic, not a creative control | 📋 (validation aid at Inc 5) |

## C. Sources / inputs

| Input | Notes | Status |
|---|---|---|
| Image upload | jpeg/png/webp | ✅ |
| Video file | codec caveats (ProRes Safari-only; HEVC) | ✅ |
| Live camera | getUserMedia; start/flip/stop/capture | ✅ |
| Native camera controls | lens / EV / WB / focus / 48MP still | 📋 native |
| AirPlay-as-source | receive a mirrored device | 💭 native |
| A/B source deck + library | slots = (prepped source + its motion JSON); select/load into A or B | 📋 Phase 5–6 |
| Per-source: loop / retime / trim / clip-edit | mostly exists in the still/motion tool; surface in perform mode | ✅ exists / 📋 surface |

## D. Perform / transport (the instrument — likely its own surface, not the toolbar)

| Control | Notes | Status |
|---|---|---|
| Program / preview buses | edit on preview, commit to program | 📋 Phase 2 |
| Take / transition | cut · smart-tween over N beats · auto on next loop boundary; duration; easing | 📋 Phase 2 |
| A/B crossfade | manual fader + auto-crossfade time | 📋 Phase 5 |
| Tempo / beat | BPM, tap-tempo, clock source (internal/MIDI/audio); quantize transitions | 📋 |
| Live gesture | arm/disarm record, loop-point detect, smooth/simplify, apply | 📋 Phase 3 |
| Motion transport | play/pause/loop/speed | ✅ exists |
| Snapshot (still grab of live output) | one-tap, separate from record | 💭 with perform controls |
| Blackout / freeze / cut-to-black | the standard VJ panic | 📋 |

## E. Control inputs (how you drive the above)

| Input | Notes | Status |
|---|---|---|
| Keyboard | space / delete / arrows / number-keys for slots / blackout key | 📋 Phase 1 basics |
| Touch | iPad / Movink ergonomics | ✅ ongoing |
| MIDI (APC40 MK2) | map faders/pads/knobs → params/transitions/slots/crossfade; MIDI learn; clock in | 📋 (Web MIDI likely works in Electron) |

## F. Status / telemetry (on the diagnostics substrate)

| Readout | Status |
|---|---|
| Per-sink active indicators (broadcast/record) | 🔜 traffic-light |
| Resolution + aspect + live fps | ✅ |
| Per-sink health: Syphon name + publishing · record elapsed/size/disk · window display | 📋 |
| Capability profile + op-perf ring + dropped frames | ✅ |
| Tempo/beat indicator | 📋 |
| Warnings: 4K-on-weak-hw · long-record memory · dropped frames | 📋 |

## G. Session / persistence

Save/load a performance set (sources + motion + MIDI map + output config), snapshots/cue list, output-config persistence across sessions. 📋 later.

---

## Per-platform availability (partial — grows as we build)

Platforms: **WebD** = web/PWA desktop · **WebM** = web/PWA phone · **iPad** = Safari/PWA (desktop chrome) · **Electron** = macOS wrapper · **Cap** = Capacitor iOS/iPadOS.

### Outputs
| Sink | WebD | WebM | iPad | Electron | Cap |
|---|---|---|---|---|---|
| Record to disk | ✅ | ✅ | ✅ | ✅ | 📋 |
| Output-only window | ✅ (popup) | ✗ | ✗ | ✅ (borderless) | ✗ |
| Syphon out | ✗ | ✗ | ✗ | ✅ | ✗ |
| HDMI out (clean extend) | ✗ | ✗ | ✗ (mirror only) | ✗ | 📋 |
| AirPlay (mirror) | ✗ | ~ | ~ | ✗ | ~ |

### Inputs
| Input | WebD | WebM | iPad | Electron | Cap |
|---|---|---|---|---|---|
| Image / video upload | ✅ | ✅ | ✅ | ✅ | ✅ |
| Live camera (getUserMedia) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Native camera controls | ✗ | ✗ | ✗ | 📋 | 📋 |

*(Settings / perform / control-input matrices: TODO — fill as those land. Most are web-first and platform-agnostic; the gates are native modules, per the host-services seam in `shell/host.js`.)*

---

## Locked UI decisions (Fold Live, 2026-06-17)

Recorded here so PLANNED UI stays coherent (this is the home Daniel asked for):

- **Spatial logic:** top owns I/O + app actions (the global bar + an expandable output row); bottom owns motion/time (the motion footer near the timeline). **Input left, output right.**
- **Output controls = expand-bands SCOPED to the output column** (SHIPPED Build 178, Increment 3.6; the Build-177 first cut was a full-width band that pushed the right panel down — rejected). `#mainSlot` is a vertical stack: an **opaque** in-flow global bar → expand-bands (`#outputRow`, `#canvasRow`, one open at a time via `wireBarBands`, subordinate to the button that opened them, like expanding a list item) → the preview stage (`#msStage`). The bands push only the preview down, NEVER the right panel. Single-click density: record take toggle (red), broadcast arm toggle (green; hidden when no live channel), resolution tier picker, Syphon name field.
- **Traffic-light indicator** on the output button: green (broadcast armed) over red (recording), either/both lit. The always-on glance, visible even when the row is collapsed. The persistent top-right status text **folds into the row** (the dots + open row carry it; no separate always-on text).
- **Syphon name field** is gated to Syphon-capable hosts and **labeled "Syphon server name"** (it sets the source label Arena shows; inert on plain web, so it should not appear there).
- **Canvas controls relocation:** `frameAspect`, OOB, canvas zoom, canvas rotation are **composition-global**, NOT slice settings. **Desktop DONE (Build 178):** a `canvas` button beside `motion` opens the `#canvasRow` band holding the relocated controls. **Mobile pending:** a **settings button opposite the flip-camera control** (mobile rebuilds the body in its own chrome, so it keeps canvas with slice until its own pass — BACKLOG). Output resolution stays in the output panel; still-export resolution stays in the export sheet; both derive from the composition-global `frameAspect`.
- **Source/output swap** control: its current toolbar home no longer fits; relocate next to the divider, possibly an icon over the source/input image(s). (BACKLOG.)
- **Responsive/icon polish:** as these controls grow, follow icon+text → icon-only → "…" overflow as space shrinks, so small viewports degrade gracefully. (BACKLOG.)
