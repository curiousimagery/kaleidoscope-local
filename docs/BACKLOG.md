# backlog

Living list of things we want to do, grouped by **surface / family** (not by when they were added). **This is a backlog, not a changelog** — when something ships it moves to `CHANGELOG.md` and comes out of here.

**Conventions:**
- **▶ NEXT** marks an item on the active arc's critical path. NEXT items float to the **top of their own group** (we keep items in their family home rather than extracting a cross-cutting "on deck" list).
- The **active program is the UX restructure → perform program** (arcs 0–7; see the Fold Live section digest; executable plan `~/.claude/plans/i-m-previous-sessions-we-ve-indexed-frog.md`). Hardening/export work is a deliberate parallel lane, lower priority for now.
- Known bugs + quick wins are consolidated at the **top** as a running triage; everything else is grouped by family below.

> Historical reasoning worth retracing (early exploration, design rationale, investigation narratives) lives in `ARCHIVE.md`. The byte-exact pre-2026-06-21-trim backlog is in git at `4046013:docs/BACKLOG.md`. What shipped, build by build, is in `CHANGELOG.md`.

---

## ▶ known bugs & quick wins (triage)

### Open bugs (running list)

- **[HIGH — breakage] Safari: the output window's camera STARVES the main app.** When the source is the live camera, the popup opens its OWN `getUserMedia` of the same device, and Safari allows only ONE consumer → it hands the device to the popup and the MAIN app goes black. Recovery is NOT automatic (left paused; Daniel must click Safari's paused-camera icon → Resume; with both open, Resume ping-pongs the device). **Next-up code task** (pairs with the perform arc — see Output window below). Leaning fix: **frame-push fallback for the camera source** — the main app (sole owner) sends camera frames to the popup over the channel (per-frame transfer, only the camera frame, downscalable; stills/video stay zero-copy). Also fixes the no-auto-recovery. (Chromium/Firefox allow multiple handles — unaffected.)
- **[HIGH] Firefox video export stutters — output unusable.** Editor PLAYBACK is smooth on Firefox, but the exported file stutters (frame pacing / dropped-or-duplicated frames). Output *correctness*, not throughput. Belongs with the Firefox color/orientation hardening pass (Gecko seek/decode + VideoFrame-timestamp during export). Brave/Safari are reference-correct. [Export & rendering hardening]
- **[MEDIUM] Phone PWA: safe-area below the tab bar doubles up.** In the installed standalone PWA, the space below the tab bar looks like the bottom safe-area inset is applied twice (`env(safe-area-inset-bottom)` likely double-counted in `mobile/styles.css`/`chrome.js`). **Pairs with the "PWA tab-bar bottom anchoring" item — treat as ONE safe-area investigation (top + bottom inset behavior), attack together.** Needs live device inspection. Honor OS insets verbatim; don't pixel-match device geometry.
- **[MEDIUM] Motion footer must NEVER shrink the timeline (iPad).** With the playback-speed controls present (video source), the footer crams and the timeline scrubber shrinks below a usable touch-target/legibility size. **Desired:** WRAP the motion controls to a second row, keep the timeline full-size always. Pure footer flex-layout fix; pairs with the motion-controls IxD pass.
- **[MED] Firefox: the output window runs ~1 fps.** Safari ~60 HD / ~30 4K (fine); Firefox ~1. Likely Gecko throttling the popup's `requestAnimationFrame` when not focused, or a slow 2nd GL context. Investigate: is `document.hidden` false on a 2nd monitor? Does a `setTimeout`/`OffscreenCanvas` loop dodge the throttle? Worst case document "use Chromium/Safari for the output window." [Fold Live — Output window]
- **[MODERATE-LOW] Filmstrip/scrub thumbnails go muddy/torn during rapid keyframe+scrub on a long clip.** Repro: open a longer video (6–10 min), enter motion, rapidly add/adjust keyframes AND scrub at once; marker thumbnails + tween-strip cells show partially-decoded frames; **self-resolves once activity settles.** Root cause: the seek-per-cell filmstrip build (`motion-runtime.js buildFilmstripVideo`) captures before a cold/slow decoder has presented the seeked frame; rapid scrub cancels builds mid-flight and marker thumbs draw in-place (vs the atomic tween cells), so partials linger. **No clean no-tradeoff fix** (rVFC is avoided on the occluded source `<video>` — can hang). Levers when we invest: (a) decoder warming on load; (b) buffered marker-thumb commit (offscreen, swap in on completed build); (c) a small decoded-frame cache. Low priority.
- **[LOW–MED] Edge seams where a segment slice meets the canvas edge (certain video files).** A thin border seam the fold then mirrors. Proposed: an optional **edge-inset crop toggle** (sample a few px in from the source edge). Opt-in so it doesn't crop sources that don't need it.
- **[LOW] Wide preview pins to the TOP of the main area (all engines).** A 16:9 comp with output in the main slot floats up with dead space below, on Safari/Firefox/Brave/Electron. Build 198 fixed Safari's separate "doesn't honor the aspect" symptom but not the top-float. Not visible from the CSS (the chain *should* center) — needs **live computed-style inspection** of `.slot-content` + `.preview-canvas` heights/offsets. Don't ship a blind fix.
- **[LOW] Cursor affordances intermittently not showing (Firefox; not reproducible).** Most likely Gecko cold-start flakiness; the gates would *show* affordances on an undefined read, not hide them. Park until reproducible.
- **[LOW] PWA live-camera vertical aspect ~2× stretch (mobile; self-corrected, not reproducible).** Park until reproducible.
- **[LOW] Firefox: assorted UI quirks** (un-itemized — first Firefox look in many builds). Fold into the broader Firefox pass; itemize when revisited.
- **[HIGH — parked by Daniel's call 2026-07-06, two fixes failed; don't burn more cycles until we instrument it] Mobile: output preview black after the save handoff.** Symptom matrix (confirmed on B236): **PWA** — return from save → source PRESERVED but output BLACK, and stays black even after loading a NEW source; only closing/reopening the app recovers. **Mobile web** — "view image" opens the JPG as a PAGE in the same tab (Safari), back → BOTH live-camera source and output lost; a DIRECT download preserves both. **What we tried:** (1) B230 — `webglcontextlost` preventDefault + `webglcontextrestored` → engine `reinitGL()` (reference-stable rebuild) + `restoreContext()` on visibility. (2) B234 — cache `WEBGL_lose_context` while the context is alive (Safari returns null from getExtension on a lost context). Neither recovers. **Key clue:** a NEW source still renders black → the restore/reinit path likely never runs at all (either `webglcontextrestored` never fires on iOS for a context lost while backgrounded, or our own `pagehide` loseContext leaves it in a state iOS won't restore). **Next levers (in order):** (a) **instrument, don't guess** — remote Safari inspector on the device, log `isContextLost()` + whether the lost/restored events fire across the save cycle (Daniel offered step-by-step screenshots); (b) **scope the `pagehide` loseContext to real navigation** — skip it when the hide was caused by our own save/view click (e.g. a "saving" flag set for a few seconds), since the GPU-pileup guard it implements was for reloads, not round-trips; (c) recreate the CANVAS element + engine outright on return instead of restoring the context; (d) the web "view image" same-tab navigation could use a different handoff (share sheet / `<a download>` semantics differ in standalone). Related-but-separate: the live-camera full reset is the page-discard/persistence item below.
- **[MED — edge case] Timeline doesn't update after returning to motion from a camera still.** Repro (Daniel 2026-07-06): still source → add keyframes → switch to a CAMERA still (capture) → re-enter motion → the timeline doesn't update; switching to a different still IMAGE updates as expected. Suspected cause: the capture path (`source-host.js captureFrame`) sets the source via `engine.setSource(img)` directly and likely skips the motion-rebind/refresh step the `loadImage` path runs (`env.rebindMotionToSource` / `renderTimeline`) — compare the two paths.
- **[LOW–MED] Source-panel corner seams unjoined in VIDEO EXPORT.** The Build 223/224 corner-join fix (single closed path + `lineJoin:round`) landed in the live overlay draw but the exported "how it was made" source-preview render still draws unjoined corners — the export path draws the overlay through a different code path; apply the same closed-path join there.
- **[LOW] Radial wedge outer arc isn't strictly honest.** The actual sampled area usually extends beyond the drawn arc — especially on non-square canvases. Either draw the true sampled extent or mark the arc as approximate; audit the geometry in `engine/geometry.js` vs the overlay draw. [Engine, forms]
- **BUG: motion JSON doesn't remember aspect ratio.**
- **On-add keyframe thumb still on `readPixels` (desktop Safari).** The filmstrip is on the readback-free `drawImage` path (Build 120), but the instant on-add/edit thumb (`fillThumb`→`exportFrame`→`readPixels`) can still flash corrupt before the 600ms debounce corrects it. If bothersome, move `fillThumb` off readPixels too. (Still-export `exportAt` also uses `readPixels` — if a corrupt still export ever appears on desktop Safari, same readback bug, same drawImage escape.)
- **Intel Air black-square export — needs hardware access.** The probe passes (FBO complete) but the shader render comes back all-black; likely an Intel iGPU driver bug with large FBOs or VRAM exhaustion. The Build 40 e2e diagnostic catches it — next time the hardware is accessible, run diagnostics + check `endToEndTest.summary.allZero`, then design a render-validation step into the probe.
- **Camera preview performance (M1 iPad).** ~12–15fps observed in live preview (felt 24–30 before; a refresh helped → partly runtime variance). Dominant cost is the full-res camera texture upload (we request up to 3840×2160). Lever: request/upload a lower-res preview stream, keep high-res only at capture.

### Quick wins / cheap optimizations

- **Add a 150% speed preset** (between 100 and 200 — speeding up never needs interpolation, so it's free now). [Motion editor & animation]
- **Tier-1 source-fps hint** — show est. source fps + warn when a preset drops effective fps below ~15. Cheap interim before frame interpolation. [Export & rendering hardening]
- **Output band declutter (two nits):** remove the horizontal rule between the global bar and the output sub-band; drop the redundant idle resolution readout (`.or-status` duplicates `#outputResHint` when idle — keep the live state/fps it carries while recording/broadcasting). [Design system — global control-area]
- **Test-pattern: add a moving element** (sweep or counter) so a frozen pipe doesn't look identical to a working one. [Fold Live — test pattern]
- **Drop the real assets:** Daniel drops a 16px-legible favicon (`public/favicon.svg`) + the Apple Icon Composer app-icon (`electron/build/icon.png`); homes are wired + shown in the Lab. [Design system]
- **Hide (don't disable) settings that don't apply to the current form** (e.g. no segments row on hex). Rides Arc 2's per-panel control stacks ("only show when they apply"), but is a cheap standalone if reached earlier.
- **Dead CSS: the `.camera-live-row` block** (styles.css ~436) references a layout the camera controls no longer use (they live in the toolbar `#cameraLive` group; `#stopCameraBtn` is gone as of Build 233). Confirm nothing renders it, then delete the block.

---

## Fold Live — perform mode & live output  ·  ACTIVE PROGRAM

> **The active program is the UX restructure → perform program** — Daniel's 2026-07-06 design drop (heads-down sketching + informal usability sessions) sequenced into arcs. **Executable plan: `~/.claude/plans/i-m-previous-sessions-we-ve-indexed-frog.md`** (supersedes `fold-live-perform-phase-1-2.md`; the durable spec `in-our-last-thread-splendid-sparkle.md` still holds for architecture decisions #1–8). **Phase 0** (Electron + Syphon + output bus + diagnostics) and the enablement cluster are DONE. Arc sequence (structure first — locked with Daniel):
>
> - **Arc 0 — high-priority bugs.** Electron pause-on-blur (blocks the Arena rig) · keyframe undo · mobile save loses the output view. (All three in the triage above.)
> - **Arc 1 — mode discipline + global app bar.** **Still | Motion mode selector**; strict gating (save = stills-only; render/broadcast = motion-only). New app-bar sequence (Daniel's spec): +upload (filename under) · camera dropdown (current camera shown; quit at bottom) + **record/pause capture toggle** · mode selector · undo/redo · per-mode export controls · Fold v# chip (future global-settings home). Save-menu reorg (composition: resolution/format/image-only-vs-package w/ source-image + composition-JSON (new) + vector-overlay-SVG (new) checkboxes); output surface (record LED · destination: window / HDMI-out (future native) / syphon+name · resolution · live/test-pattern · broadcast LED). Mobile capture stop→pause unification.
> - **Arc 2 — panel-sibling overhaul.** Source/output become symmetric, middle-aligned, divider-repositionable siblings (built third-panel-ready). Parallel per-panel control stacks, shown only when applicable — *form:* segments/scale/rotation/thickness/spiral/tier-mirror/wedge-mirror/reset; *canvas:* aspect/OOB/comp-zoom/canvas-rotation/**reset canvas (new)**. Placement converges via **2–3 in-app switchable variations** (Daniel reacts on-screen). Source panel gains fit/fill (from mobile) + a mini scrubbable timeline (still mode, video sources, no autoplay) + filename/resolution beneath. **Aspect expansion:** 1:1 · 5:4 · 4:3 · 3:2 · 16:9, landscape default, click-again flips portrait, swap affordance on hover.
> - **Arc 3 — motion timeline rework.** Timeline HEIGHT is the priority; controls flank left/right. Left, fat buttons: [+keyframe] [+gesture (reserved slot)] / [◀ prev] [next ▶] / [play/pause wide]. Right, icon stack: […] overflow (motion-JSON up/down · smoothing · duration · loop toggle) · zoom −/+ · scale-to-fit. Absorbs the motion-IxD cleanup + the button-emphasis disambiguation; first-keyframe hardening + a loop / no-loop fork. Open detail: where playback speed + the 150% preset live.
> - **Arc 4 — realtime perform.** Ghost/echo of the previous state (decays as output catches up) + a **follow ramp** (instant→slow) — ONE transition-speed primitive, shared with Arc 5's blend-in; experiment literal vs perceptually-normalized durations. Winding = unwrapped-angle following (350° goes the way you moved). Canvas-edit-while-live question (mini PiP of the changed setting vs an output preview) prototyped on-screen. Checkpoint: Arena hop + **first M1 Max validation + memory-pressure reading** (the Arc 6 gate).
> - **Arc 5 — staged transitions.** **output-staged** third panel (pre-paid by Arc 2): save a next-up snapshot, edit off-air (canvas settings editable in staged), **blend in** on the shared speed control while output-live keeps the old state. Output-live minimizes to a **PiP over staged** (explicit control + auto-dock below a size threshold).
> - **Arc 6 — cut line (memory-pressure governed):** (a) **MIDI** (APC40; Web-MIDI-in-Electron spike first) → (b) **Syphon-IN** (below). Ride in-arc if headroom allows; else next arc.
> - **Arc 7 — mobile perform.** Output-live always a PiP; **record with audio** + the realtime effect; ghost/echo reuse.
> - **Later:** +gesture record (winding capture — its timeline button slot is reserved in Arc 3), single-source-as-asset / loop-builder mode, A/B crossfade → multi-slot deck (the engine only ever blends TWO sources; the deck is a library UI, never a compositor), Capacitor / iOS HDMI.

### Perform-mode input — controller-driven (Arc 6; mapping TBD with Daniel)

**macOS gives browsers no multi-touch.** Diagnostic (Brave + Sidecar, `?inputdebug`): `peak pointers=1 touches=0` — neither the Wacom Movink nor Sidecar delivers multi-touch; touch registers as a single `mouse` pointer. A macOS platform limit (Chromium/Electron + Safari don't fire TouchEvents on macOS), not our code. The only multi-finger event is the **trackpad pinch as `wheel`+`ctrlKey` (scale only)** — SHIPPED (scales `sliceScale` over source, `canvasZoom` over output); desktop Safari also fires `gesturestart/change/end` with scale+rotation. So the iPad-style combined gesture is impossible on a Mac touchscreen.

**Consequence:** perform-mode input on the Mac/Syphon rig must be **MIDI (Akai APC40) + game controller (Gamepad API)** mapped to slice params — rotary→angle, slider→scale, joystick/XY→position. Both Web MIDI and Gamepad API are web/Electron-native (no native module — confirm Web MIDI in Electron with a 30-min spike). Pairs with smart-tween (controller moves ease between states). **The exact mapping is undefined — define it with Daniel at the Phase 1+2 kickoff (his hardware, his preferred control assignments).**

**Still open:** Safari `gesturechange` → rotate (Safari-only bonus); a synthetic Chromium rotate mapping (e.g. shift+pinch) if wanted. **Bigger touch targets on the Movink** (~7" effective) = the touch-target-scaling item in the design-system layer. **True multi-touch = run Fold ON the iPad directly** (Safari/PWA, mobile chrome), not Sidecar — confirm with `?inputdebug` on the iPad (expect `touches=2`).

### Syphon INPUT — Arena (or any Syphon server) as a live source (Electron) — pairs with the realtime control arc

Close the loop: receive Arena's program output INTO Fold as a live source, kaleidoscope it, and publish back out via the existing `SyphonMetalServer` — so Fold becomes a live **effect** in the Arena chain, not just a source. **Feasible:** Syphon is bidirectional; `node-syphon` exposes the client/directory side (`SyphonServerDirectory` to enumerate published servers + a Metal client to receive frames). Arena publishes its output as a Syphon server, so Fold subscribes, gets frames, and feeds them as a source — a new host-side input alongside camera/video/still, fitting the source-host abstraction + the `host.syphon` seam (which today only *publishes*). **Perf note:** input shares the same readback consideration as output (the received frame still has to reach the WebGL engine; CPU path ~HD-viable, GPU-shared/IOSurface is the same hard problem as output). Strong pairing with the perform arc — receive → kaleidoscope live → send back is a compelling VJ capability. Seam additions: `host.syphon.listSources()` + `host.syphon.subscribe(name)`; wire as a source type in the deck (Phase 4/5).

### Mobile perform (Arc 7) — live PiP + record-with-audio

The mobile expression of realtime perform, after the desktop core (Arcs 4–5). **Output-live is ALWAYS a PiP** on mobile viewports. Core capability: **record a video with the live camera that includes AUDIO** (mic) and the kaleidoscope effect moving in realtime with the follow-ramp smoothing — the recorder's `captureStream` can add an audio track (kept free of video-only assumptions; see monetization "Audio in the consumer wonder share"). Reuses the desktop ghost/echo treatment (previous state decays as live output catches up). External live output (Syphon / virtual camera) from mobile still needs the native wrapper (FOLD.md Phase 4).

### Output window — cross-browser bugs

(The two HIGH/MED ones — Safari camera-starve + Firefox ~1fps — are in the triage above.)

- **[feature?] The output window PERSISTS after the main app closes** ("kindof cool"). An independent window (own engine + camera + channel) freezing on its last params. Could be formalized as an **exhibit / kiosk mode** (set up, then close the controller). Decide later: embrace (a "detach" action) or tear down on opener close.
- **Output-window follow-ups:** confirm **`BroadcastChannel` across Electron BrowserWindows** (web path verified); the live camera opens a 2nd `getUserMedia` to the same device — fine on macOS/Chromium/WebKit, watch for a browser that refuses it.

### Syphon output — open levers

**Measured (Daniel, M-series, 1920×1080): `render 0 + read ~44 + publish ~2.3 ms` (~20fps via the legacy preview-canvas path).** The GPU→CPU `readPixels` was 100% of the cost, so backpressure / zero-copy IPC / single-render / async-PBO all save ~nothing. **A faster readback method SHIPPED (Build 199):** the live bus renders through a SEPARATE offscreen engine (`shell/output-engine.js`) whose `drawImage(GL→2D)→getImageData` path is ~9× faster than `readPixels` on Blink, and never touches the preview canvas. **Remaining levers:** (1) **resolution** — 720p/HD is the practical perform default (4K readback = 33MB/frame); (2) **IOSurface/native** — the true zero-readback fix and the genuine web-tech ceiling (ties to the native wrapper). The output WINDOW already sidesteps readback entirely (4K@120) for the display path. **Live server rename while broadcasting:** editing the name mid-broadcast updates the label but not the live server (takes effect on next arm); a true live rename = dispose+recreate, which makes Arena drop/re-find (a visible blip) — deferred, gate behind a confirm if wanted.

**[NEW] Benchmark the hidden-engine capture path on M1 Max.** The 9x speedup and the render-bound HD/mid-30s-4K numbers were measured on the M5 Max. Confirm the same ratio holds a generation and a tier down before treating those numbers as a general Apple Silicon baseline, not just an M5 result. Cheap to run, the diagnostics benchmark button already does this.

**[NEW] Real-time input raises the stakes on the two-loop state read.** The hidden-engine capture path is architecturally two independent render loops (main preview, invisible capture) reading the same shared state object. Build 201 already surfaced one bug from exactly this shape, a slice drag during playback leaking a transient uncommitted edit into the broadcast before the main loop's own logic overwrote it, fixed with a purpose-built lock across both surfaces. As perform mode's MIDI input and any future high-frequency, externally-triggered state changes land, treat this as a bug *class*, not a one-off, and design new real-time inputs with an explicit "when is a state write visible to the capture pass" rule in mind rather than patching each new occurrence individually. See the new architecture note under Strategic / roadmap ("Shared `stage/` across web apps") for how this bears on any future attempt to generalize this pipeline beyond Fold.

### Output calibration / test pattern (shipped — one follow-up)

The `test pattern` toggle publishes a known reference frame (corners/orientation/border/circle/color bars), runs without a source (pre-show pipe check). **Possible follow-up:** a moving/animated element (sweep or counter) so a frozen pipe doesn't look identical to a working one.

### Live record-to-disk sink — fast capture path

NOT urgent (the recorder is a UX stand-in for Syphon, not the live output path). It runs ~11–12fps and lags motion playback because it uses the slow path (`exportFrameRaw`→`renderToFBO`→CPU Y-flip→`putImageData`→MediaRecorder, while the preview renders a 2nd pass). Fix: give the sink the engine's fast render-to-canvas + `drawImage` path (the video exporter's `beginCapture/captureFrame`). Tension with the bus's one-frame-many-sinks model: Syphon needs the raw CPU buffer, the recorder wants a canvas — so the bus offers both representations from one render, or the recorder renders its own pass. Smaller/aspect-correct output resolution already raises record fps. (Long-render memory → OPFS streaming is under Export & rendering hardening.)

---

## Motion editor & animation

### ▶ NEXT — motion timeline rework (Arc 3; absorbs the old motion-IxD cleanup)

Daniel's spec (2026-07-06): **prioritize timeline HEIGHT**; cluster controls left and right instead of on top — keyframes get much larger, and the track becomes a big pinch/zoom/pan surface. **Left, three rows of fat buttons:** [+keyframe] [+gesture] / [◀ prev] [next ▶] / [play/pause (wide toggle)]. **Right, minimal icon stack:** […] overflow (motion JSON upload/download · smoothing · duration · loop mode toggle) · [−] zoom out · [+] zoom in · [⛶] scale to fit. Notes: [+gesture] ships as a **reserved slot** (the record capability is a later arc; decide disabled-vs-hidden at build); absorbs **unambiguous loop on/off** [design-system button disambiguation — do here], **keyboard** (space = play/pause, delete = delete selected), and **first-keyframe hardening + a loop / no-loop fork** (below). Open detail: where playback speed + the 150% preset live (not in the overflow spec). The "two control tiers" framing + exit criteria below still guide it.

### Motion control IxD/UI

Two control tiers to design around:

- **Occasional / global** (overflow-friendly): aspect ratio; duration; smoothing; render; ⋯ overflow (download/load motion data, clip editor).
- **Always-used, tight with the timeline:** playback (play/pause, next/prev, loop); keyframe control (add, delete, anchor); navigation (zoom in/out, fit, pan).

Address:

- **Keyboard:** delete = delete selected, space = play/pause, a quick lock/unlock; keyboardability is likely poor across the whole app (untested).
- **Shift+click** to multi-select keyframes on the timeline.
- **Ambiguous state:** the outlined "loop on" reads the same as primary buttons that stay outlined — needs unambiguous on/off [design-system button disambiguation].
- **Clip-editor edges of long clips are hard to work with** → increase the modal size proportional to the viewport.
- **"Reset workspace"** command: delete all keyframes, start fresh on the same source.
- **Exit criteria:** responsive down to a **700px mobile breakpoint**; ergonomic placement; visually scannable; appropriate hierarchy + groupings; progressive disclosure. North star: Procreate Dreams / iMovie.

### Motion editor — design direction (north star + IxD reference)

Forward design reference for the motion editor + perform-mode controls. North star: **Procreate Dreams / latest iMovie** — uncluttered, precise, powerful; "fun because the content is interesting, not because we picked a playful font." Priority stories: add keyframes → scrub the whole animation fast → edit/delete → realtime playback + loop → (eventually) export.

- **Control areas.** Global transport (play/pause, step fwd/back, loop on/off, save/export, total duration). Timeline track (keyframe outputs + the tween preview-strip across the span). Keyframe-edit lane above the track (create/select/edit/delete; ticks + occasional timestamps, but **relative** keyframe position is the focus, not absolute "33s in"). Scrubber drags along the track. **Add-keyframe is a global control that drops at the current scrubber position.** Zoom/pan defaults to fit; pinch-zoom + two-finger pan + "scale to fit." Motion mode hides/disables the non-smooth controls (form switch, segment/arms count, mirror toggles) so only animatable params are offered.
- **Loop model.** Keyframe 0 is the start AND is rendered again at the END as the loop-return target (the user sets the spacing between the last authored keyframe and that return → tween-back duration). KF0's wedge persists as a low-opacity **ghost** (onion-skin) while authoring; the final keyframe tweens into it.
- **Rotation winding — per-segment property.** Default direct/shortest; opt-in "+N turns"; plus captured winding from gesture-record. Each keyframe = intent to move smoothly from the previous state to this one without inadvertently reversing or replaying detours.
- **Output comparison — PiP.** Onion-skin wedge-outline helps, but we ultimately want to compare the actual previous OUTPUT with the current: a small picture-in-picture of the previous state top-left, with a side-by-side option. Needs rendering two states at once (the stateless engine supports it). Also needed for live-capture/Syphon. (Held loosely — large track thumbnails may suffice, esp. iPad portrait.)
- **Timeline IxD refinement (Daniel drives, pixel-level).** Prev/next stepper ergonomics are weak; the loop on/off state is hard to read with current button styling (needs an unambiguous on/off affordance — ties to the design-system button disambiguation); pixel-precise refinement of the keyframe markers + scrubber.

### Animation usability bugs

- **Droste seams:** spirals seem to ALWAYS seam; thickness changes seam if the value changes between keyframes. If spiral is enabled, warn or gate motion mode.
- **Change a property globally AFTER keyframes exist — DECIDED (Daniel 2026-07-06): allow it.** Changing segments during an animation applies to ALL keyframes, behind a warning dialog with a pre-selected "don't show me this again". For Droste, handle turning off tier mirror etc. **Related — form-type change during motion: also allow, with a DESTRUCTIVE warning** (not all properties translate); default CTA is cancel/nevermind, "change form and lose settings" is secondary or even a text link. [relates to cross-form keyframe transitions]
- **First-keyframe hardening + loop / no-loop fork (Arc 3).** It's currently possible to delete the primary initialized keyframe — harden it. And the split keyframe (kf0 rendered again at the end as the loop-return), while elegant, confuses users who don't want a loop: add a **fork in motion mode for looping vs non-looping animations**; the loop model only applies to the former.
- **Onion skinning** (consider).
- **Auto-keyframe on drag:** if you drag the slice without a keyframe during playback, auto-save an anchored keyframe, or require the explicit add step?

### Open animation threads

(The multi-keyframe timeline, smoothing, tween filmstrip, pinch-zoom/pan, video-file source, clip editor, and retime/speed are all SHIPPED — see CHANGELOG. Open tails:)

- **Per-keyframe ease handles** for deliberate holds/finer control (and per-segment rotation winding, below). Current Catmull-Rom smoothing + the "smoothing degree" control are the baseline.
- **Taubin (shape-preserving) smoothing — explore (low pri).** Current Laplacian smoothing relaxes loop amplitude toward the anchor as cranked; a Taubin λ|μ pass would smooth jaggedness WITHOUT shrinking the motion. Optional mode or default. Not urgent — current smoothing feels good.
- **Per-segment rotation winding (+N turns).** Explicit per-segment property (default direct/shortest, opt-in "+N turns", plus captured winding from gesture-record), not a global unwrap. Each keyframe = intent to move smoothly from the previous state without inadvertently reversing/replaying detours.
- **Cross-form keyframe transitions.** A keyframe can be captured under a non-kf0 form (exit→change form→re-enter); playback ignores its discrete and renders it as kf0's form. No elegant way yet to author a form/segment *change* across the loop [relates to discrete-transitions crossfade].
- **Random / live-wallpaper mode.** Generative slow parameter drift on the continuous loop — the wedge gently pivots, properties gradually shift, as a live-wallpaper output from a still. "Animation without authoring"; ships on the tween primitive, before full keyframe UI.
- **Gesture-record mode (data model must support it now).** Record the continuous parameter stream while manipulating; detect return to the start ghost as the loop point; smooth + simplify to sparse keyframes. A second authoring mode on the SAME tween engine. Especially valuable once Fold's live output Syphons into Arena. Sequenced after video. [Becomes perform Phase 3.]
- **Discrete transitions via crossfade (deferred — only if compelling).** Excluded params (form, segments, arms, oobMode, mirror toggles) can't tween but could CROSSFADE (render two states, dissolve) — most valuable for form→form. Shares the render-two-states capability with PiP. Explicitly NOT now.
- **Tween-band visible-window refinement (assess feasibility).** The band only renders thumbnails for the VISIBLE window (gap on pan/zoom until idle re-render). Evaluate: (a) a slight buffer beyond the edges; (b) retain previously-rendered cells and only fill new gaps; (c) opportunistic off-view render when resources allow. A footage-frame cache (keyed by time) makes (b)/(c) cheap.

### Clip editor — deferred polish

Trim/bounce/slice are feature-complete. Remaining: seek-based decode slow on long clips (WebCodecs-decode speedup); 30fps bake (source-fps estimation); no mid-bake cancel; live preview shows a hard seam cut vs the baked blend (the two-video crossfade preview is in for dial-in); bounce preview forward-only.

**Loop-builder rework (usability finding, Daniel 2026-07-06): the clip editor confuses users.** Be opinionated about the sequence of operations, with visual feedback at the slice step: **1)** trim edges → **2)** set bounce or loop behavior → **3)** if loop, set the slice point — SHOW what's happening: `[ab]` → `[a]·slice·[b]` becomes `[b]·slice·[a]` → **4)** if loop, set the crossfade duration at the slice → **5)** bake. Conceptually this may become a **loop builder MODE** (fits the Arc 1 mode discipline) rather than today's ad-hoc dialog; decide when touched.

---

## Export & rendering hardening  ·  parallel lane (lower priority)

(The big bug here — Firefox export stutter [HIGH] — is in the triage. This lane is deliberately secondary to the perform arc; pick it up when a real export wall is hit, or for a contained change-of-pace. **Frame interpolation is the one item that's really a net-new creative capability** — it jumps up if live slow-mo matters during perform.)

- **Frame interpolation — wanted sooner (Daniel confirmed).** At 30fps source, 25% is unusable and 50% is a bit choppy (readable slow-mo floor ~50%). Interpolation (blend first, optical-flow later) unblocks sub-25% speeds; can bake. Cheap interim: a **Tier-1 source-fps hint** (above). Also **add 150%** now (speeding up never needs interpolation).
- **Variable framerate / non-30fps source hardening (higher-risk, deferred).** All tuning has been on 30fps. A 60fps clip showed slower scrub/thumbnail fill (2× frames + heavier exact-time seeks, Gecko especially) and an out-of-sync start/end keyframe after trim (parked for a repro). Treat as a hardening pass: estimate source fps (rVFC delta), robust exact-frame seeking at higher rates, reduce seek load (footage-frame cache), re-test trim→rebuild→loop-bookend. Low urgency while 30fps is the baseline.
- **Long-render MEMORY → OPFS streaming + worker.** `fastStart:'in-memory'` accumulates all encoded chunks until finalize; long/high-res renders risk OOM. Move encode+mux to a **Worker** writing to **OPFS** (`createSyncAccessHandle`, cross-browser), stream to disk, download the disk-backed file; abort = terminate worker + delete temp. Required before 10-min 4K is safe. Buys responsiveness + memory, NOT throughput. **Also covers the live record-to-disk sink** (`stage/recorder.js` accumulates compressed chunks in a JS array until stop) — MediaRecorder → OPFS is the natural fit (write each `ondataavailable` chunk straight to a sync handle).
- **Render throughput ceiling = the native wrapper.** Export is single-thread CPU/color-conversion-bound and scales with OUTPUT pixels; Safari was fixed to ~render-bound via WebGL-direct `VideoFrame` (≈130fps @4K), but true fast/multi-core/hardware encode is the native wrapper. Brave/Firefox stay on the 2D path. **Chromium export remains UNTESTED.**
- **Unreasonable-render detection.** A 16:9 6K @30 from a 130MB JPG stalls indefinitely (FBO/memory). Warn/guard when frames × output-pixels (or source size) is extreme, before starting. Tie to abort robustness (the X cancels a normal render but can't interrupt a single stuck frame; aborting always preserves keyframes).
- **Huge-source keyframe slowness.** Saving keyframes on a 130MB source lags (texture upload / per-render sampling); downscaling is the current workaround.
- **WebCodecs `VideoDecoder` + `mp4box.js` demuxer (NEW dependency — needs approval).** The future fast-bake / fast-decode path (~2× on long renders where the codec decodes) for the clip-bake + video export. Decode-by-playback was shelved (≈3× FF/Chromium-only, Safari encode-bound). Cleanly isolated as an alternate `advanceSourceToP` — same cost later as now.
- **iPhone-`.mov` color/rotation pass (Gecko-specific).** (a) Washed-out color in the OUTPUT on Safari + Firefox — a WebGL texture colorspace/range issue in the video upload (investigate `UNPACK_COLORSPACE_CONVERSION_WEBGL` / limited-vs-full-range YUV→RGB / HDR). (b) Firefox applies a 90° CCW rotation to ALL video loads + an aspect squish on iPhone clips (Gecko handles rotation/pixel-aspect metadata differently) — read the rotation metadata and normalize. Brave + Safari are reference-correct. (Includes the Firefox export-stutter bug in the triage.)
- **Firefox cold-start scrub/playback lag (deferred).** First interactions on a long clip show transient warm-up (stale-frame flash mid-drag; 1–2s lag) that self-resolve after ~a minute. Gecko JIT + cold decoder. Levers if annoying: warm the decoder on load, a tiny decoded-frame cache, or an rVFC readiness gate. Low priority (clears itself).
- **ProRes limitation.** Browser `<video>` decodes ProRes only on Safari; WebCodecs can't broadly either. Matters for the FCP→Fold→Resolume workflow. Options if it blocks: require Safari for ProRes, document a transcode-first step, or native wrapper. Not a core blocker (most sources are H.264/HEVC).
- **WebGPU rendering port (large, shared across the three apps).** Raises texture-size caps (incl. the Firefox 8K still-export cap), enables tiled >hardware-max, helps the realtime/Syphon endgame.
- **AV1 encode; audio passthrough** (v1 is muted); **in/out trim** (subsumed by the clip editor).
- **6K/8K video — remainder is non-HEVC browsers.** >4K routes through HEVC (hardware on Apple Silicon via Safari); Firefox/Chrome lack HEVC encode → those tiers stay disabled there. Future routes: AV1 encode (slow), a WebCodecs demuxer/tiled path, or a WebGPU port.
- **PWA stale cache.** An installed iPad PWA served an old build from its cached service worker. Verify the SW updates promptly / the precache is versioned.

---

## Design system & UI Lab

The token foundation + UI Lab + control standardization + token auto-discovery shipped (Builds 205–227). **Decided: NOT React/Plasmic** — Fold stays plain Vite + vanilla JS + GLSL; the investment is a design-system layer (tokens → components → compositions → interaction patterns) + a UI Lab. **The running app + design system are the source of truth, NOT a Figma artifact**; Figma / Claude Design are upstream *inputs* that can feed tokens, never a runtime renderer. The Lab is the home for future polish, and the **fragmentation detector for all three surfaces** (its usage cross-reference flags `0×`/unfiled tokens; tokens now auto-discover from tokens.css).

### ▶ NEXT — button-emphasis disambiguation (rides Arc 3's timeline rework)

SIX distinct "emphasis/selected" treatments (`.primary` fill + 5 outlined: `.toggle.active`, `.ot-btn.active`, `.band-open`, `.mf-toggle.active`, `.mf-add`) → the "loop on reads like a primary" ambiguity; collapse to an unambiguous on/off + primary vocabulary. Context radii drift (button 4 / ot-btn,mf-btn 6 / mobile 8). **This is the substrate the perform loop on/off + transport controls sit on — clean it as part of Phase 1.**

### Open follow-ups

- **Tokenize spacing.** The `--space-*` scale exists in tokens.css but the stylesheets still use literal padding/gap/margin (reads `0×` in the Lab). Adopt it the same parity way, leaving layout-coupled values literal (e.g. `.ms-stage` 24px, tied to canvas-fit math). **The broader intent: reduce the current sprawl of spacing/sizing variants toward a smaller, more intentional set. Base-8 is ONE experiment to try on the app bar with open hands — not a direction or commitment.** Normalize PER-SURFACE as we refine (it's a visual change, not parity), not a blind global snap.
- **The deferred app-bar IxD batch is the natural FIRST composition to migrate** once we lean on the system (see "Global control-area UI follow-ups"). Doing it in hardcoded CSS would be throwaway. (Note: perform mode now subsumes much of "use the design system for real.")
- **Touch-target scaling for hybrid/large-panel contexts** (Movink ~7" effective — scale with panel size, or threshold above a few hundred px). Lands in the interaction-patterns / control-states layer. (This is the actual Movink fix — see perform-mode input.)
- **Systematic tooltips (own item, Daniel 2026-07-06).** Tooltips across the controls describing what each does + keyboard shortcuts where applicable. Decide native `title=` vs a styled token-driven tooltip first (see Text cleanup note), then add systematically per surface.
- **Systematic destructive interrupts (interaction pattern).** A consistent confirm pattern wherever data would be lost: changing form in still mode after motion edits, leaving the loop editor unsaved, the Arc-3 all-keyframes property changes, etc. One shared dialog treatment (with "don't show again" where appropriate), not per-spot one-offs.

### Design-system cleanup inventory (the punch-list)

"Collapse the diffs / fix the rough edges" tasks the Lab surfaced. None blocking; tackle alongside the surface they live on. (DONE items removed — these are what's left.)

- **Cursors / affordances.** The LOST Droste rotation grippy + crosshair-vs-dot for the offset; the min-wedge ~20px clamp where the affordance UI breaks. (Cursor restyle, camera-flip icon, Droste-diamond off-token color, slice-outline corner-join all DONE; rotate cursors redrawn Build 226.)
- **Text.** Migrate the ~25 sprawled text rules onto the named `.t-*` set (defined Build 218; migration is the parity step). Tooltips are native `title=` (unstyled) — decide keep-native vs a styled tooltip.
- **Empty / similar states.** 3+ empty messages (placeholder / status / side + mobile) with different wording, color, size → unify. Other reused states handled inconsistently desktop↔mobile.
- **Modals.** desktop↔mobile divergence (radius 10 vs 16, backdrop dim/blur, no card shadow) → reconcile into one treatment.
- **Radii.** off-grid 1/3/6/10 → fewer, per-surface (part of the reduce-variation intent above).
- **Assets (remaining).** Daniel drops the real 16px-legible favicon (`public/favicon.svg`) + the Apple Icon Composer app-icon (`electron/build/icon.png`). The homes + drop instructions are wired and shown in the Lab's app-icon section.
- **Keyframe pin (open Daniel input).** The pin reads as a triangular notch flush on the square's top. Locked-vs-auto representation: lean to FILL the notch on all keyframes + a different mark for locked.
- **Mobile `target` icon** (settings ↔ source) — unintuitive; needs a better concept.

**Affordance SVG workflow (durable agreement):** Daniel authors his own replacement SVGs; we RECEIVE and integrate them. When he hands over an SVG, **clarify the mode** (design-intent to redraw in our normalized style, vs a literal asset to integrate as-authored) — don't assume. Do NOT proactively rewrite how affordances are generated (procedural canvas → SVG) — breaking-change risk in a core UI surface for little gain. See `DESIGN.md` "extending onto new surfaces".

### Global control-area UI follow-ups (Fold Live era)

The coherent control inventory + locked decisions live in `docs/CONTROLS.md`. **The Arc 1 app-bar spec (see the program digest) supersedes several items here** — new bar sequence: +upload (filename under) · camera dropdown + record/pause toggle · Still|Motion mode selector · undo/redo · per-mode export controls · version chip. The **camera-module rework** is part of it: the camera button itself becomes the dropdown (current camera shown; camera list; "quit camera" at the bottom); capture becomes a record/pause toggle between live and frozen still, the same pattern on mobile (today's stop → pause). Remaining open items:

- **Controls default to DROPDOWN MENUS (direction, Daniel 2026-07-06 — DEFERRED, don't block the core sequence).** Output/broadcast and similar control clusters should live in dropdown menus by default, not in-flow expand bands — the camera dropdown (Build 233) is the first instance. Daniel's call (same day): these menu-pattern migrations looked trivial but aren't — **backlog them for later rather than losing steam on the arc sequence**; the `#outputRow`/`#canvasRow` bands get superseded when their surfaces are next touched for real.
- **Source info shown in too many places (Daniel 2026-07-06).** Filename+resolution appear top-left (the status caption) AND under the source panel — **keep only the source panel's**, drop the top-left one. For motion data, add DURATION beside name+resolution under source. (Supersedes the earlier "filename under the upload button" idea from the app-bar spec — the source panel is the one home.) Same disease in the output band: the selected resolution shows twice — keep it by the resolution selector, drop the useless right-side echo (`.or-status` idle dims; keep its live state/fps while running).
- **Form-picker location — DECIDED (Daniel agreed 2026-07-06): header of the FORM SETTINGS stack.** It determines which controls appear below it (an honest header/selector relationship), and motion mode's contextual form lock reads naturally there. Lands as part of the Arc 2 control stacks. Revisit only if perform mode later needs fast form switching (a controller mapping serves that better than bar placement).
- **Resolution shown twice in the output band.** The floated-right `.or-status` duplicates the picker's `#outputResHint` when idle — drop the redundant idle dims BUT keep the live state/fps it carries while recording/broadcasting.
- **Remove the horizontal rule between the bar and the output sub-band** — visual noise without hierarchy.
- **Canvas controls → a dropdown over the output, not an in-flow band** (reverses the band approach for canvas specifically; the output band stays in-flow). **Desktop relocated** the canvas `.group` into `#canvasRow`; **mobile still pending** (a settings button opposite the flip-camera control — mobile rebuilds its own body).
- **iPad landscape ~30px unwanted vertical margin on the global app bar.** The `@media (coarse, landscape) .main-slot { padding-top: 34px }` (clearing Safari's compact tab bar) adds ~30px unwanted margin — same class as the slice-settings / right-panel issue. Needs on-device tuning (can't verify blind). **Same family as the iPad-landscape right-panel-top-space bug below — both are the coarse+landscape 34px hack misfiring; tackle together at the device.**
- **Source/output swap control relocation.** Its toolbar home no longer makes sense — move next to the **divider**, possibly an icon button over the source image(s).
- **Responsive + icon overflow pass.** Add icons + breakpoints so the output row + global bar resize gracefully: **icon+text as space allows → icon-only → "…" overflow** when very compact.
- **Future consideration — does the right panel need to be persistent?** **ANSWERED by the Arc 2 panel-sibling overhaul:** source/output become symmetric siblings, each with its own on-demand control stack (form settings / canvas settings), placement converged via in-app variations. The persistent right panel dissolves into that model.
- **Broader aspect ratios (Arc 2, canvas stack).** Spec (Daniel): 1:1 · 5:4 · 4:3 · 3:2 · 16:9, sorted squarest→widest, each defaulting landscape; clicking the selected ratio again flips to portrait (e.g. 16:9 → 9:16 → 16:9); show an aspect-swap arrow affordance on hover of the selected state. Matters especially for print-destined stills.
- **Canvas reset control (Arc 2, canvas stack).** Parallel to the per-form slice reset: return aspect/OOB/zoom/rotation to defaults.

**iPad-landscape right-panel extra top space (cosmetic, landscape only).** In iPad Safari **landscape**, the right panel's content (form-picker row) sits below the output toolbar with extra space above; portrait is correct. Build 174 set `.right-panel { padding-top: 34px }` + `.output-toolbar { top: 50px }`; the CSS math checks out and there's no conflicting rule, yet on-device it's still pushed down → Safari-landscape-specific, not obvious from CSS. **Next step: inspect on-device** (Safari Web Inspector) — read the computed top of `#outputToolbar` and `.form-row`, reconcile. **Same coarse+landscape 34px-hack family as the app-bar margin item above.** Low severity.

---

## Engine, forms & tile-aware

### New forms

Each is one new file in `src/engine/forms/` plus one registry line. Order is rough; pick whichever sounds most fun.

- **Hyperbolic Escher (circle limit).** Tessellation of the Poincaré disk. Circular image with shapes crowding the edge (Escher's *Circle Limit*). Heavy lift: custom overlay (disk boundary + warped fundamental triangle) + custom controls (Schläfli tiling selector). The Droste form's `drawOverlay`/`classifyPointer` schema hooks are reusable. Distinctive Escher feel; significant differentiation.
- **p31m wallpaper.** Alternate triangular tiling — same equilateral triangles as p3m1 but mirror axes through vertices not edges. Fully seamless. Visually distinct at triangle centers vs corners. Vocabulary expansion; lower priority.
- **Radial polygon-frame variation (low priority).** A parameter on radial: optional n-sided polygon outer boundary instead of a circular arc (even sides matching segment count for seam compliance). May emerge from tile-aware work. Not a separate form.
- **"None" / passthrough form (Daniel 2026-07-06 — sees real value).** A form applying no transformation — the source straight through the canvas pipeline (zoom/rotation/aspect still apply) — or minimally a simple mirror (flip vertical/horizontal). Cheap: one form file + a registry line; useful as a broadcast-the-source mode and a debugging reference.

**Design constraint for all new forms:** No visible seams. Pinwheel-only groups (p3/p6/p4) are excluded (cell seams break the illusion); glide-reflection groups (pmg/pgg) excluded (glide-axis discontinuities); rectangular mirror groups (pmm/cmm) excluded (redundant with the square form). With p3m1 shipped, p31m is the only remaining wallpaper group adding distinct vocabulary while satisfying the seam constraint. For each new form, fill in `tilesPerDim(state)` so the resolution hint is accurate.

### Droste math directions (future, pair with motion shell)

- **True vanishing-point offset (per-tier rigid translation).** The current `drosteOffset` uses Möbius pre-composition (preserves circles but introduces in-tier non-conformal stretch Daniel reads as "rotation forced onto a 2D plane"). Clean math: per-tier rigid translation — each tier k has center `c_k = offset·(1 − 1/zoom^k)`; per pixel determine tier, translate, apply standard warp. Undistorted off-center concentric circles, visible tier seams. (Daniel's mental model: moving the vanishing point should be like looking down a TUNNEL, not rotating a sphere.)
- **Dimensional rotation / volumetric tilt.** Each concentric tier projected at a different angle (looking at a tube off-axis). More complex; per-tier perspective.
- **"True rotation" / pole rotation.** Lower priority. Post-composition Möbius on source `z_src`, or a joystick/corner-gesture affordance mapping to whatever math we pick. Strong motion-shell pairing (animating gives a flowing-water effect).
- **Offset affordance.** As canvas-side control is added: a **toggle for what the center offset does + whether it's locked**; recommend a **crosshair** affordance instead of the dot.

### Per-form behavior + defaults

- **Per-form perceived scale / default normalization.** p3m1 triangle + hex feel like much tinier samples than radial/rectangle/droste at the same `sliceScale`; tighten per-form defaults (default scale + decoupled passthrough) so forms feel relatable when switching.
- **Refine segment + canvas defaults per form** to maintain continuity across forms.
- **Minimum wedge sample size.** Clamp to a ~20×20px floor per form (currently shrinks to ~1px where the affordance UI breaks).
- **Droste needs a seam divider line (Daniel 2026-07-06).** At arms=1 there's no way to tell the circle is rotating on desktop — draw a divider line where the single segment meets itself. Dual purpose: the rotation tell AND a draggable affordance for changing segment count with the mouse (the radial-spoke-drag equivalent for Droste).
- **Slice params carry across form switches (product decision, not a bug).** `sliceScale`/`sliceCx/Cy`/`sliceRotation` are global state, so they persist across form switches (a large scale on radial makes droste's annulus oversized). Decide: keep shared, make per-form, or reset-the-slice-section on switch. Daniel: remembering values is sometimes desirable → likely a soft default + easy reset.
- **Global reset-to-defaults.** Per-form slice reset shipped (Build 56). If a "reset everything" workflow emerges, add a global button (form/slice/zoom/rotation/OOB/export → defaults, keep the loaded source).

### Tile-aware features

Treat Fold output as tile / wallpaper content rather than standalone images. Likely to evolve from research to feature as the gallery installation concept matures (see `FOLD.md`).

- **Snap-to-tile canvas zoom.** Per form, the canvas-zoom slider has natural snap points where the output is exactly one unit cell (or an integer multiple). Identify these mathematically per form, surface as hard snaps or slider indicators. Initial analysis suggested square-only, but visual evidence (repeating patterns at certain zoom-out levels) says the analysis was incomplete — revisit with a screenshot of the working repeat.
- **Snap zoom to repeatable increments.** At least Droste allows zoomed states that repeat — helpful for saving a loopable zoom sequence by returning to a visually identical (but technically zoomed) state.
- **Tileable cell export.** Export one unit cell of the tiling, not the full mosaic; filename labels the group; crop to the unit cell shape (square from p4m, hex from p6m, triangle from p3m1). Acceptance: cells tile seamlessly in a repeating grid.
- **Non-square tile output for snapping.** For non-square fundamental domains (hex, triangle), export the actual polygon shape (transparent outside / vector-cropped) so downstream tools can snap cells together — e.g. a gallery installation where visitor outputs snap into a larger hexagonal composition.
- **Snap compositions to the nearest tileable size** where possible.

---

## Sources, input & capability tier

**Layering vocabulary (settled — Engine / Kit / Components / Chrome).** Engine (`src/engine/`) = forms/shader/gl/geometry, pure pixels, never rebuilt. Kit (`src/kit/`, `shell/state.js`/`history.js`/`params.js`) = DOM-agnostic primitives (state schema, undo/redo, snaps, param registry, tween/keyframe model) + host services (camera, render driver, export). Components (`src/components/`) = mountable UI shared by both chromes, **parameterized not forked** (source-overlay draw+hit-test+gesture math, output gestures, param-control renderer). Chrome (`src/desktop/`, `src/mobile/`) = layout/divider/tab-bar/disclosure/gesture-routing — the only layer rebuilt per device. **A state snapshot is the universal currency** — it powers undo, becomes a keyframe, is the A/B endpoint for live-transition tweening, and is the captured raw-frame edit state. Build the tween primitive once; it serves live transitions, keyframe interpolation, and random-mode drift.

- **Sources are universal across modes (direction, Daniel 2026-07-06).** Support every source (still / video / live camera) in every mode as far as possible. Still mode on a video source: NO autoplay and no playback transport — just a **mini timeline scrubber** to pick the frame to work with (the Arc 2 source-panel item). Live camera in motion mode: becomes valid with realtime/staged transitions (Arc 4) — pre-perform it was nonsensical, so today's motion-rejects-live gate stays only until then. The Build-231 mode gating already keeps output reachable during live camera in still mode.
- **Preserve source across a chrome switch / iOS page discard.** The responsive reload carries slice/canvas params but not the source image/camera (mobile↔desktop view switch still interrupts the source — tried before, NOT resolved). **Also covers Daniel's 2026-07-06 repro: live cam → save → back can reset BOTH panels — iOS discarded the backgrounded page entirely (full reload), which no context-restore can fix.** Persist the uploaded image (blob → IndexedDB) and re-`setSource` after reload; live camera re-prompts.
- **Camera controls — platform-limited.** iOS Safari `getUserMedia` exposes only facingMode + a resolution request; zoom/lens-select/EV/WB/focus and ImageCapture (48MP) are unsupported → need the native Capacitor wrapper. Build any camera UI capability-driven (`getCapabilities()`) so it lights up if more becomes available.
- **Canvas pan state (`canvasOffset`).** One-finger drag on the mobile OUTPUT is a no-op until a canvas-translate state key + shader uniform exist.
- **Export package layers: composition JSON + vector overlay SVG (Arc 1 reserves the menu slots; ship later).** Daniel's save-menu spec adds two package checkboxes: **composition JSON** (the settings needed to recreate the output from the source — the still analogue of motion JSON) and **vector overlay SVG** (the wedge/geometry shape sized to the SOURCE dimensions). Subsumes the earlier "geometry overlay still" idea: overlay math is in `overlay.js` (`drawSourceOverlay`); the lift is rendering geometry at export resolution + zip entries. Pairs with tile-aware export. Plus: ensure save-composition / save-package language is **consistent across mobile + desktop**.
- **Desktop control-widget migration.** Desktop keeps hand-authored slider DOM; a later pass migrates it to the shared `mountRangeControl` (behavior already shared; only markup is forked).
- **iOS file-picker redundancy.** "choose photo/file" always offers "Take Photo" on iOS (redundant with "take still"); no web way to suppress — native-wrapper only.
- **Proper opening / first-run screen** (mobile + desktop).
- **Audio sync (wishlist).** Load a track (Spotify / mp3) and animate playback in time with it.

---

## Mobile & PWA

- **Mobile landscape — on-device validation + IxD polish pending.** The in-place relayout shipped (Build 103; `#m-root` flips column↔row, live camera survives rotation, Dynamic Island handled via `env(safe-area-inset-right)`). Pending: (a) Daniel's on-device validation (camera-survives-rotation, island clearance CW vs CCW, divider drag, centering); (b) IxD polish — vertical tab-bar button sizing, source/form popover anchoring near the tab bar, full-bleed corner-hugging option. Pairs with the PWA bottom-anchor item.
- **PWA tab-bar bottom anchoring (iPhone).** In installed standalone the tab bar floats above the screen bottom (rounded-corner safe area). Idea: round the tab-bar hit-targets to follow the phone's corner radius so the bar anchors at the true bottom. **Same safe-area investigation as the "phone PWA safe-area doubles up" bug in the triage — do together.** Interacts with landscape (the bar moves to the right edge there). (Also re-surfaced in testing: **snap the grippy to dock at top/bottom**.)
- **Mobile undo/redo.** The shared snapshot model (`shell/history.js`) makes it available; the source-overlay exposes `onCommitStart`/`onCommitEnd`. Access gesture TBD (two/three-finger tap?).
- **Mobile `target` icon** (settings ↔ source) — unintuitive; needs a better concept. [Also in design-system cleanup.]

---

## Cross-browser & platform

- **Cross-browser test pass on a Chromium browser (Chrome/Edge/Brave) — NOT yet tested.** We've tested WebKit + Gecko and hit several engine divergences; Blink is the third major engine. Scrutinize, with symptoms we've seen: **`readPixels` from an FBO** (WebKit corrupt under churn → escaped via drawImage; Gecko slow → removed per-frame readback; verify Blink's is correct AND fast for `exportAt`/diagnostics); **`VideoFrame` from a WebGL canvas** (WebKit hung → 2D-canvas drawImage source; confirm Blink's WebCodecs path + H.264 levels/`isConfigSupported`); **`gl.finish()` reliability**, **`preserveDrawingBuffer:true`** per-frame cost (Gecko penalty), **pointer-event coalescing** (Gecko fires far more pointermoves); **`premultipliedAlpha:false`** + 2D-canvas color management (the Safari tint history). Also confirm multi-download vs zip, `dvh` layout, `accent-color`, and the SW on Chromium.
- **WebGL context loss/restore (general).** If a gray screen recurs in any scenario, add a `webglcontextlost`/`webglcontextrestored` handler pair on the preview canvas to re-init GL cleanly. (Also the fix path for the PWA-save blackout in the triage.)

---

## Native wrapper & Syphon (distribution)

### node-syphon leak (RESOLVED, revert pending)

**RESOLVED (Build 185).** node-syphon@1.5.0's native `SyphonMetalServer.publishImageData` leaked ~14.2MB/frame (allocated a Metal texture per call, never released — the fix was a commented-out TODO right there). We forked + patched `MetalServer.mm` (local texture + `addCompletedHandler` release, mirroring the correct `PublishSurfaceHandle`), built the addon with node-gyp + Command Line Tools (N-API, no full Xcode), and carry it as a **vendored binary** `electron/vendor/node-syphon/syphon.node` applied by the postinstall hook `electron/scripts/patch-node-syphon.cjs`. Profiler-flat (~110MB across 400 publishes) + Arena-confirmed. node-syphon is GPL-3.0+ (compatible with Fold's AGPL). **Upstream PR open: [benoitlahoz/node-syphon#46](https://github.com/benoitlahoz/node-syphon/pull/46) (Closes #45).**

**REVERT when #46 merges + releases:** bump `node-syphon` in `electron/package.json`, delete the hook line + `electron/vendor/`.

### HDMI out as a broadcast destination (future, native)

Daniel's output-menu spec lists **HDMI out** beside output-window/Syphon as a destination — a clean extension of the destination picker once a native shell exposes a second display as a sink (Capacitor iPad HDMI is the primary case; FOLD.md Phase 3). The output bus's many-sinks model already accommodates it; only the host seam grows.

### Distribution gating (needs the $99 Apple Developer account)

Code-signing + notarization (so the DMG runs on another machine without right-click→Open) and a **universal (x86_64+arm64) binary** (gated on a universal node-syphon build too — currently arm64-only). Revisit when distribution to other machines is the goal.

---

## Strategic / roadmap

### Strategic forks & build-order

**Three upstream forks gate big chunks of downstream work:**

- **D1 — Positioning** (prosumer ↔ kid-friendly $.99 ↔ tiered). Gates Global-UI style direction, marketing/pricing, the free-vs-paid model. Does NOT gate engine work or ergonomic IxD.
- **D2 — Native wrapper** (PWA-only ↔ native universal ↔ stays web). Gates Syphon, advanced camera, per-platform codec locking, HDMI — and how much web-UI polish is safe before a possible native redo.
- **D3 — Distribution** (standalone ↔ Snapchat/IG filter ↔ NLE plugin ↔ photo). The **core engine is shared under all of them**; only the shell differs — parallel *bets* on one engine, chosen per D1.

**Key leverage insight:** the **core engine + the tween/keyframe/realtime model is the shared asset under EVERY distribution path.** Investing there pays off regardless of how D1/D2/D3 resolve. So engine/realtime work + the parallel bug/ergonomics/hardening tracks are the safest momentum; style-branding, Syphon, and plugin paths benefit from settling D1/D2 first.

**Parallel tracks (no cross-dependency, run anytime):** motion-control IxD; the bug/polish cluster; hardening (OPFS long-render, Firefox color/orientation, Chromium perf/stability). **Sequential chains:** realtime live-video (web, smart-tween) → save-to-disk → [D2] → Syphon/camera/codec-locking/HDMI; source-fps hint → frame interpolation → sub-25% speeds; Global UI Figma audit → [D1 style] → itemized fixes / icon suite.

### Native wrapper / Syphon — does going native FORK the code? (settled: NO)

- **NO fork, if we use a WRAPPER.** Electron (macOS) and Capacitor/WKWebView (iOS/iPadOS/macOS) both RUN the existing web app — reusing Engine/Kit/Components/Chrome as-is. "Native" = a thin shell + native modules (Syphon, camera, HDMI). Only a full SwiftUI+Metal rewrite would fork, and that's NOT required. **Polishing the web app now is not wasted.**
- **The architectural-prep arc is DONE (Builds 164–170):** the wiring is split from the desktop chrome; a runtime-capability layer (`kit/capabilities.js`) and host-services seam (`shell/host.js` + `webHost` no-op) exist. A native wrapper mounts the same code via `createApp(env, { host: nativeHost, capabilities: nativeCaps })` — no fork.
- **The real technical unknown was getting WebGL output INTO Syphon efficiently — answered by the spike (`spike/electron-syphon/`):** the CPU readback path (`drawImage` + `getImageData`) is viable on Apple Silicon (unified memory; no GPU texture sharing needed). `node-syphon`'s `SyphonMetalServer` works in Electron's main process. Resolume confirmed "Electron - Fold" as a live source. Viable on M1+ at 1920²; 4K 16:9 has margin only on clean hardware/M1 Pro+; Intel unlikely. Drive Syphon from the engine's FBO export path, not the display canvas.

### [NEW] Shared `stage/` across web apps: parallel double-render (web) and WKWebView (native) tracks

Prompted by a planning conversation about whether the Fold Live output work generalizes to other web-based visualizers (Zoetrope, and whatever comes after). Recorded here as a real plan, not just reasoning, since it touches this section, the Syphon output levers above, and the D2 fork question directly.

**Where things stand today.** `stage/` (engine-adapter contract, output bus, recorder sink, Syphon sink) is already engine-agnostic by design, "first tenant Fold, zero kaleidoscope assumptions." What is NOT shared is the capture technique itself: the hidden-engine, `drawImage`, `getImageData` trick lives in Fold-specific files (`shell/output-engine.js`, `shell/fold-adapter.js`) next to `stage/`, not inside it, because building the hidden engine means calling Fold's own `createEngine`. A future web app plugging into `stage/` today gets the bus and the sinks for free but has to build its own version of the capture trick against its own renderer.

**Two tracks worth running in parallel, not sequentially, since they solve the same problem at different layers:**

1. **Web track — extract `stage/` as a shared package, then explore lowering the contract.** Near-term: pull `stage/` and `shell/host.js` out of Fold into their own small repo, consumed by Fold and future apps as a dependency (private npm package or git dependency), so the generic bus/sink/host-seam code stops needing to be re-derived per app. This is mechanical given the code is already contract-shaped. Longer-term, more speculative: redraw the contract one level lower, from "hand me a finished Frame" to "render yourself into the canvas I hand you," which would let the capture technique (hidden engine, drawImage, getImageData) move into the shared package permanently instead of being re-implemented per app. Any work on this MUST carry forward the state-sync discipline from the item above (the slice-drag bug class), as an explicit part of the contract, e.g. a defined "commit point" a render pass is allowed to read from, not just the canvas handoff mechanics. Without that, every app adopting the lower-level contract risks rediscovering Fold's Build-201 bug independently.

2. **Native track — WKWebView plus a Metal-backed IOSurface, owned by the wrapper, not the app.** This is the one path that structurally removes the double-render problem rather than optimizing around it, since it captures the WebView's actual displayed frame directly, no second render pass, no shared-state race, by construction. It is currently unbuilt and would need its own spike, the same way the original Electron+Syphon pipeline did. The reason it belongs paired with the web track above rather than after it: because this lives entirely in the wrapper and never touches app code, ANY web app hosted this way inherits it automatically once built, Fold, Zoetrope, or anything future, with zero per-app native work. That is a structurally better payoff than the web track's per-app capture technique, which is worth remembering when prioritizing engineering time between the two.

**Decision this does NOT require yet:** which track ships first. Both are additive to what exists (Fold's current pipeline keeps working either way), and the honest state-of-the-art per the item above is that the web fix already reaches usable real-world numbers, so neither track is gating anything today. Revisit sequencing once either (a) a second web app actually needs Syphon output, making the extraction concrete rather than speculative, or (b) 4K/heavier-shader performance or the state-sync risk actually bites in practice, making the native track's payoff worth its build cost.



### Native iOS / iPadOS / macOS app capability inventory  [ties to FOLD.md monetization Phase 3/4]

Wanted: camera controls (lens, resolution, EV, WB); switch live-video → full-res still on capture; **Syphon** or **HDMI** live-out; per-device tab-bar placement. Value of native = **optimizing engines + locking the best path per platform** (only Safari handles ProRes; Safari can't use the fast 2D-canvas path so uses WebGL — pick + lock per platform). Could **gate** features (motion + forms behind a paywall; keep core radial/rectangular + live camera free) and/or gate export resolutions. Adoption may be easiest **inside an existing ecosystem**: Snapchat/IG filter; DaVinci/Premiere plugin; **especially Arena**; an **FCP plugin** (Daniel's personal want).

### Global UI / brand pass

Mostly proceeds on existing principles: **neutral, powerful, precise, intuitive** — the playful "portal to another world" feel comes from getting the UI *out of the way*. (Now substantially served by the design-system arc; the remaining open pieces:)

- **General audit:** what's working/not; areas lacking polish; discoverability (missing tooltips, first-run, demo content); where WYSIWYG breaks; **WCAG accessibility check.**
- **Global style direction / brand:** possibly art-direct a theme (palette, font, type ramp, voice + tone); confirm staying **lowercase + minimal**; any iconic defining visual elements. Parallel, any-time, NOT a blocker.
- **Start-from UX nits:** SVG misalignment on the slice overlay; motion not showing the actual slice area in non-square aspect ratios; don't show BOTH the reflected wedge AND the over-extended wedge; timeline/keyframe UI; keyboardability; **lost the rotation affordance on the Droste circle** (want a grippy in/extending from the circle); mobile tab-bar icons still slightly wonky.
- **Note:** assumes the **PROSUMER creative-tool** use case; a kid-friendly / party version would call for a different flavor + reduced complexity [D1 positioning].

### Alpha test / marketing research / positioning  [ties to FOLD.md monetization]

Dipping from design over to strategy + marketing: URL, landing page, pricing, positioning. Daniel's parallel lane (which audience / use case / distribution mode) — feeds D1/D3, runs alongside engineering.

---

## monetization / sharing

Full narrative in `FOLD.md`. Work items, priority order:

- **Phase 1 (next): PWA + Ko-fi tip jar.** A Ko-fi link on the landing page. Audience-building, no paywall.
- **Phase 2: Walled-garden subscription brand.** Page-routing auth gating via a third-party platform (Patreon, Ghost, etc.). Parent brand candidate `curioustools.art`. Builds on Phase 1.
- **Phase 3: Native iPad app via Capacitor.** Web core, native shells for Pencil pressure / Files / Photos / share sheet / Shortcuts. App Store $5–15. Apple Developer ($99/yr) + 15–30% cut.
- **Phase 4 (sidebar): Native Mac wrapper for Syphon out.** Electron wrapper into Resolume. Spike + end-to-end proof complete; unsigned local DMG SHIPPED (`npm run dist` in `electron/`). Distribution gating (signing/universal) is under Native wrapper & Syphon above.
- **Phase 5 (deferred): Photoshop PSD export.** Export output + original + wedge as separate PSD layers.
- **Audio in the consumer "wonder" share.** The live-output path is video-only by design (Syphon/HDMI carry video; Arena owns audio). The one real audio case is the **Wonder-mode consumer flow** (record a clip with the effect baked in to SHARE, expecting source audio). Far down the list. No corner: the recorder's `captureStream` can add an audio track later — just keep the recorder free of hardcoded "video-only" assumptions.

The license choice (AGPL-3.0) preserves all of these without locking any in.

## gallery installation work

Curatorial frame in `FOLD.md`. Work items:

- **Cloud folder I/O handshake.** Fold reads source images from a configured cloud folder, writes outputs to another. Fixed paths, clean handshake. Upload UI, moderation, and gallery rotation belong to a separate sibling app, not Fold.
- **Guided Access kiosk compatibility verification.** Test the PWA install on iPad Pro 12.9" in Guided Access fullscreen: gesture/touch behavior, no UI element opens external links, survives extended use. Shared concern with the Drift project's kiosk backlog — investigate in tandem.
- **Document-camera source mode.** A live-camera-shell variation with the camera overhead pointing at a table of objects; visitors arrange objects, the kaleidoscope responds. Architecturally identical to the live-camera shell; possibly just a different default form / framing.

## developer tooling backlog

- **GitHub Actions CI:** `npm run build` on push to main, deploy preview to Vercel on PR (Vercel handles this already; a CI workflow is for adding lint/typecheck when those exist).
- **Visual regression harness.** A small node script that loads each form at default settings, exports at 1K, and diffs against a saved baseline. Catches accidental shader regressions.
- **Source-mapped production builds.** Vite does this by default; verify on deploy.

## open architecture questions (settled notes)

Kept brief so the reasoning isn't lost:

- **Engine input contract.** The engine accepts HTMLImageElement / HTMLVideoElement / HTMLCanvasElement / ImageBitmap / VideoFrame as a texture source (`gl.texImage2D` natively accepts all).
- **Mobile is a distinct chrome.** Not a responsive retrofit — a separate front-end on the same engine, rendering the shared parameter registry. This is what makes the pro-and-playful product story possible.
- **Shared infrastructure for video sources.** Camera (MediaStream), video file (`<video>.src`), and animated still (parameter timeline) are *host modules* over a common continuous render driver, not three code paths.
- **WebCodecs for video export.** Prefer `VideoEncoder` for frame-perfect output; fall back to `MediaRecorder` if unsupported. Codec: mp4/h264 if available, webm/vp9 otherwise.
