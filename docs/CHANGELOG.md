# changelog

Newest first. Format: `version (Build N) — date — summary`. Each version section captures what shipped relative to the previous version. Builds are a global monotonic counter; see `src/version.js` for the convention.

---

## v0.9.25 (Build 172) — 2026-06-17

**Fold Live, Phase 0 · Increment 1 (cont.): source controls → global control area + export feedback in its modal.** Daniel's review of Build 171: (1) export confirmation was still landing in the sidebar footer; (2) source/camera status wasn't visible in the global controls; (3) upload/use-camera don't belong in the segment-settings sidebar either. All three addressed, completing the "right sidebar = segment/slice/canvas only; global control area = source + app actions" reorg. **Export feedback** now renders inside the save modal (`#exportStatus` in `#exportSheet`) like the render modal's output line — `doExport`/`exportPackage` write there instead of the shared status line. **Source input** moved into a global **`source ▸`** modal (`#sourceSheet`: upload / use camera) launched from the output toolbar; the **live capture/flip/stop controls moved inline into the toolbar** (a `#cameraLive` `.ot-group` shown only while the camera runs — they must stay reachable during a session, so they're not behind the modal). The source modal auto-closes once a source loads (failure keeps it open, since the upload error renders inside it). **Source/camera status** is now a global caption (`.output-status`) pinned just under the toolbar over the output, always showing the current source + live state ("live camera", "loaded 1920×1080", "captured — export to save") and still the engine-init error target. `updateCameraUI` no longer hides upload/camera when live (they live in the modal now; uploading exits live mode on its own). The old sidebar source block is gone — the right sidebar now opens on the form picker. All relocations keep original ids, so wiring (`wireCamera`/upload/`wireExportButton`) is unchanged. Build green, `node --check` clean; no duplicate ids. **No engine/render change.** **Verify (Daniel):** save ▸ → export telemetry shows in the modal; `source ▸` → upload/camera modal, closes on load; start camera → capture/flip/stop appear inline in the toolbar + "live camera" caption shows over the output; capture a still; right sidebar is form/thumbnail/slice/canvas only. **Next — Increment 2:** the stage spine (`src/stage/` output bus + adapter contract + raw-RGBA FBO method + op-ring) + record-to-disk + the live-output toolbar button.

---

## v0.9.24 (Build 171) — 2026-06-17

**Fold Live, Phase 0 · Increment 1: global control-area IxD cleanup (behavior-preserving relocation).** Kicking off the live-performance program (Electron+Syphon → Arena), but starting with a clean-as-you-go IxD pass on the global control area, since that's where the new live-output affordance will live and the right sidebar's export + diagnostics groups are backlog cruft sitting right beside it. Both groups moved out of the right sidebar (now focused on segment/slice + canvas) into modals launched from the output toolbar (`#outputToolbar`), mirroring the mobile save sheet: a new **save ▸** button opens `#exportSheet` (the same format / resolution / res-hint / save-package / save-composition controls + Firefox-cap notice, all keeping their original ids so `wireControls`/`wireExportButton` are untouched), and a compact **version chip** (the always-visible discrete-diagnostics affordance, merging the old version badge) opens `#diagSheet` (the `#diag` readout + run-diagnostics + a new capability-profile line `profile: engine · capture path · maxFBO`, with the full report / copy-JSON still via the existing `showDiagnosticPanel`). Both sheets reuse the `.vid-sheet` modal idiom (open = `hidden=false`, ✕/backdrop-click closes), matching the motion render sheet. The general `#status` line (source/camera/capture feedback + engine-init error target) stays always-visible at the sidebar bottom (its old visual home), not buried in the export modal. Build green, `node --check` clean. **No engine/render change; web functionally identical — UI reorganized only.** **Verify (Daniel):** save ▸ opens the export modal with every control + hint + Firefox notice working identically (PNG/JPG, sizes, save, package, telemetry); the version chip opens the diagnostics modal (readout + capability line + run-diagnostics/copy-JSON); the right sidebar is slice/canvas only; source/camera/capture status still shows. **Next — Increment 2:** the stage spine (`src/stage/` output bus + engine-adapter contract + raw-RGBA FBO method + op-ring diagnostics) + record-to-disk + the live-output toolbar button.

---

## v0.9.23 (Build 170) — 2026-06-16

**Architectural prep, Phase 4: host-services seam (`shell/host.js`) — scaffolding, no behavior change. Completes the architectural-prep arc.** Defined the host-services interface — the native capabilities the browser can't provide that an Electron/Capacitor shell eventually will: `syphon` (GPU frame output), `midi` (control input), `nativeCamera` (lens/EV/WB/focus/48MP), `fileSystem` (native save/open round-trip). Ships `webHost`, the web no-op: every service reports `available: false` with safe stub methods (return empty, never throw), so the contract is "the app asks (`env.host.syphon.available`) and degrades to the browser path; it never assumes." Threaded onto `env.host` via `createApp` (defaults to `webHost`; a native shell injects its own object of the same shape). **Pure scaffolding:** no native implementations, and nothing in the app reads `env.host` yet — the seam is defined so future features (Syphon out, MIDI, native save) and the native shells mount against a fixed interface instead of editing back into the app. Build green, `node --check` clean. **No verification needed** (zero behavior change — `env.host` is set but unread). **Architectural-prep arc done (Builds 164–170):** Phase 1 closure→env; Phase 2 main.js split into desktop chrome + clip/source/motion modules behind `env` handles + `createApp`; Phase 3 `kit/capabilities.js`; Phase 4 `shell/host.js`. A future Electron/Capacitor entry point reuses the whole web codebase and injects its own `host` + `capabilities` through `createApp({ host, capabilities })` — no fork.

---

## v0.9.22 (Build 169) — 2026-06-16

**Architectural prep, Phase 3: capability profile (`kit/capabilities.js`) — behavior-preserving.** Centralized the scattered per-engine UA-sniff decisions into one probe-once table: `createCapabilities(engine)` → `{ engineId ('webkit'|'gecko'|'blink'), isWebKit/isGecko/isBlink, capturePath ('gl'|'2d'|'bitmap'), maxFBOSize, maxTextureSize, firefoxTextureCapped }`. Built once in main.js from the engine diagnostics and threaded onto `env.capabilities` via `createApp` (the Phase-2d seam — `host` still null, now `capabilities` is the real browser profile). Replaced the two genuinely-sprinkled decisions with profile reads: the video-export **capture path** (was `defaultCaptureMode` in motion-runtime → `env.capabilities.capturePath`) and the **Firefox 8K texture cap** (was `isFirefox`/`isFirefoxCappedAt8K` in main.js, used in the WebGL-cap notice + the source-host upload-error hint → `env.capabilities.firefoxTextureCapped`). **Decisions are byte-identical** (same WebKit/Firefox regexes, same `?capture=` override, same `maxTextureSize ≤ 8192` test). **Scope note:** the already-single-sourced encoder probes (`videoExportSupported`/`pickVideoCodec` in shell/video-export.js, self-used + encoder-coupled), the seek strategy (video-source.js), and the readback/FBO probe (engine/gl.js) stay where they live — capabilities.js documents them as the index rather than duplicating. This is the future home for per-platform feature locking as runtimes go from 3 → 5 (+ Electron-Chromium, + Capacitor-WKWebView). **Pure move — no behavior change.** Build green, `node --check` clean. **Verify (Daniel):** Safari uses the `gl` capture path (fast export) + no Firefox notice; Firefox shows the 8K-cap notice + the upload-error hint + uses `2d`; `?capture=2d|gl` override still works. **Next:** Phase 4 — `shell/host.js` + `webHost` no-op (Syphon/MIDI/native-camera/file-system seam).

---

## v0.9.21 (Build 168) — 2026-06-16

**Architectural prep, Phase 2d: the `createApp` mount seam — Phase 2 complete (behavior-preserving).** Added `src/shell/app.js` exporting `createApp(env, { host, capabilities })`: the chrome builds `env` (engine, DOM refs, schedulers, source-overlay, layout handles) and then calls `createApp` to (1) thread the injectable runtime seams onto env and (2) mount the shared wiring (`createClipEditor` → `createSourceHost` → `createMotionRuntime`) in one place. main.js's init now reads as chrome-handle assignments + a single `createApp(env, …)` call (replacing the three inline `createX` calls); it imports `createApp` instead of the three modules. **`host`/`capabilities` are threaded as injectable params** (default null today) — the seam the native-wrapper work mounts against: Electron/Capacitor reuse main.js verbatim and inject their own host + capability profile here without editing back into the app. Chosen as a lean mount-orchestrator (not a heavier engine/env-construction move) because the wrappers reuse the desktop chrome as-is — what they need is the injection seam, not duplicated construction. **Pure move — no behavior change.** Build green, `node --check` clean. **Phase 2 done:** the app wiring (clip / source / motion) is fully separated from the desktop chrome behind the `env`-handle convention + `createApp`. **Verify (Daniel):** quick confirm the app still boots and behaves identically (it's a one-call rewire of init) — nothing user-facing changed. `docs/ARCHITECTURE.md` updated to reflect the new module structure + the createApp/env-handle seam. **Next:** Phase 3 — `kit/capabilities.js` (centralize the per-engine matrix); Phase 4 — `shell/host.js` + `webHost` no-op.

---

## v0.9.20 (Build 167) — 2026-06-16

**Architectural prep, Phase 2c: motion runtime extracted — main.js is now the desktop chrome (behavior-preserving).** The whole motion subsystem (~1,100 lines: sampling/playback, keyframe ops, the timeline = ruler + markers + zoom/pan view-transform + filmstrip, video scrub/retime, motion-JSON, AND the video-export sheet incl. `defaultCaptureMode`) moved out of `main.js` into `src/shell/motion-runtime.js` as `createMotionRuntime(env)`. Kept as ONE cohesive module because these all call each other constantly — splitting would convert in-file calls into cross-module handles with no real separation (and bundling makes file-count runtime-neutral anyway). The move was done by **byte-exact extraction** (copying the line ranges, not retyping) to protect the byte-for-byte invariant; only the mechanical `env.`-prefix conversions were applied (`resizePreviewCanvas`/`drawMiniKaleidoscope`/`arrangeSlots`/`sourceOverlay`/`applyFormControls` → `env.*`). It hangs its public surface on `env` (`scrubVideo`/`renderTimeline`/`renderRuler`/`scheduleFilmstrip`/`updateMotionUI`/`ensureSeededSelection`/`lockVideoDuration`/`stopPlayback`/`haltPlayback`/`rebindMotionToSource`/`fmtClock`) and wires its own DOM (`wireMotion` + `setupVideoExport`). main.js's init now reads as three `createX(env)` calls (clip → source → motion) + chrome wiring; dropped 10 now-unused imports. **`main.js`: 2203 → 865 lines.** Verified: `node --check` both files, build green, and a cross-module audit confirming every `env` handle motion consumes is provided. **Pure move — no behavior change.** Build 167 includes 2a+2b. **Verify (Daniel — the full motion pass, since this is the largest extraction):** enter motion mode; add/select/delete/anchor keyframes; play/loop; scrub the timeline (+ pinch/zoom/pan/fit on iPad); the filmstrip thumbnails; duration + smoothing scrub fields; motion-JSON save/load; **video export** (the sheet, resolution gating, render, .zip package with source-preview + motion-json); source-video scrub/playback/retime; and that the clip editor (2a) + camera/still-export (2b) still work since they call into motion via `env`. **Next:** Phase 2d — `shell/app.js` `createApp({host,capabilities,dom})` orchestrator + final chrome slim-down, then the ARCHITECTURE.md update.

---

## v0.9.19 (Build 166) — 2026-06-16

**Architectural prep, Phase 2b: source host extracted (behavior-preserving).** The SOURCE host moved out of `main.js` into `src/shell/source-host.js` as `createSourceHost(env)` — three concerns that share the source-identity tuple (`env.media`): media loading (`loadImage`/`loadVideo`/`stopSourceVideoPlayback`), the **live camera** host (getUserMedia + the continuous render loop + flip + capture-to-still — it creates its own `camera` instance and wires the camera buttons itself), and **still export** (`doExport`/`exportPackage`/`buildFilename`/`downloadBlob`). Follows the Phase-2a convention: collaborators via late-bound `env` handles (`env.haltPlayback`/`rebindMotionToSource`/`updateMotionUI`/`arrangeSlots`/`drawMiniKaleidoscope`/`sourceOverlay`/`isFirefoxCappedAt8K`), public surface hung on `env` (`env.loadImage`/`loadVideo`/`stopSourceVideoPlayback`/`startLiveLoop`/`doExport`/`exportPackage`/`downloadBlob`). main.js dropped its now-unused `createCamera`/`getActiveForm` imports. **Pure move — no behavior change.** main.js: 2636 → 2203 lines. Build green, static-checked (no bare cross-module refs; camera section fully gone). Build 166 includes Phase 2a (it supersedes 165 for testing). **Verify (Daniel):** upload image + video (drag-drop AND file picker), still export (PNG/JPG + package .zip), live camera start/flip/capture/package on iPad + phone PWA, and that loading a new source mid-animation re-binds the timeline. **Next:** Phase 2c — `shell/motion-runtime.js` (the big one: motion core + timeline + filmstrip + video export).

---

## v0.9.18 (Build 165) — 2026-06-16

**Architectural prep, Phase 2a: clip editor extracted to its own module (behavior-preserving).** First physical extraction toward the wrapper seam. The pre-animation clip editor (the `#clipSheet` trim/bounce/slice sheet + bake pipeline) moved out of `main.js` into `src/shell/clip-editor.js` as `createClipEditor(env)`. Establishes the **cross-module call convention** the rest of Phase 2 follows: extracted modules reach collaborators through late-bound `env` method handles (`env.scrubVideo`, `env.renderTimeline`, `env.lockVideoDuration`, …) and hang their own public surface back on `env` (`env.openClipEditor`/`closeClipEditor`/`applyClip`/`setClipMode`/`makeClipHandle`/`clipSeekTo`/`startClipPreview`/`stopClipPreview`) for the chrome's motion-footer wiring. Stable data refs (`engine`/`motion`/`session`) are destructured from `env`; clip state still lives on `env.clip`. **Pure move — no behavior change.** main.js's clip code is now a one-line pointer; ~380 lines relocated verbatim. **Verify (Daniel — clip editor on a video source):** open `clip ▸`; trim in/out + apply (forward, non-destructive); bounce bake; slice bake with cut-point + crossfade dial-in (the two-video dissolve); clip-bar scrubber pause/resume; Cancel reverts. All should behave exactly as Build 164. **Next:** Phase 2b — `shell/source-host.js` (media load + camera + still export).

---

## v0.9.17 (Build 164) — 2026-06-15

**Architectural prep, Phase 1: closure→env migration (behavior-preserving, no file moves).** Ahead of native-wrapper work (Electron/Capacitor), this is the first of the refactors that separate the app *wiring* from the desktop *chrome*. Every module-level mutable `let` in `main.js` that the wiring functions closed over has moved onto cohesive `env` runtime sub-objects, so no wiring function reads or writes module scope anymore (the prerequisite for relocating it to a shared module without forking). New groupings on `env`: `media` (source-identity tuple — filename/objectURL/original/captureURL), `live` (camera isLive/active/raf), `motionRT` (motion mode active/raf/start/scrubbing/pointers/gesture/relayoutPending), `clip` (trim object + the preview/bake state machine), `filmstrip` (timer/lastSig/gen/busy/freezeEl), `scrub` (coalescing), `sched` (rAF flags), `sourcePreview` (export-frame scratch canvases). `state`/`session`/`motion` and the `sourceVideo`/`liveVideo` handles are unchanged. This is a pure move — **no behavior change, no new features, no functional cleanup.** Honors the "no module-level mutable globals; thread state through env" convention. **Verify (Daniel — full oracle pass, desktop + iPad):** all overlay gestures (move/scale/rotate, segments, square edge+corner, droste ratio/arms/offset, two-finger pinch), output pinch/twist, form switch, swap, divider resize, undo/redo, still export, the full motion/timeline/keyframe flow, video source load/scrub/playback/export, the clip editor (trim/bounce/slice), and the iPad live-camera flow (start/flip/capture/package) should all behave exactly as in Build 163. **Next:** Phase 2 — physically extract the wiring into `shell/motion-runtime.js`, `shell/clip-editor.js`, `shell/source-host.js` + a `createApp` orchestrator (mechanical now that state is on `env`).

---

## v0.9.16 (Build 163) — 2026-06-10

**Smooth crossfade preview (two-video live blend) — fixes the seam stutter.** The crossfade dissolve was stepping through a fixed ~8 captured frames (smooth at 0.5s, badly stuttery at 3s). Replaced the seam-frame capture entirely with a **two-video live blend**: a second hidden preview `<video>` (`_clipPrevVideoB`) plays the A-head while the main preview plays the B-tail, and the two are alpha-blended onto `#clipBlend` over the crossfade duration. Both play natively at 1× → smooth at any crossfade length, no capture, no seek pause when adjusting cut/crossfade. The main video's post-crossfade seek to `in+cfSec` is masked by keeping the blend up until the seek lands (no end-of-dissolve flicker). Removed `captureSeamFrames`/`scheduleSeamCapture`/the seam buffers. **Verify (Daniel):** slice mode → the seam dissolve is smooth at both short and long crossfades; dragging cut/crossfade updates the dissolve live with no pause; no flicker at the dissolve's end. (Decode-by-playback bake was investigated + deferred — seek-based bake kept for short loops; WebCodecs-decoder is the future fast-bake option, a new dependency.)

---

## v0.9.15 (Build 162) — 2026-06-10

**Bake no longer flickers the preview ("baking…" cover).** The bake decodes by seeking the *visible* clip-preview video, so the sheet flashed through frames + black while baking (the "feels broken" look Daniel flagged; the baked file was always fine). A simple `#clipBaking` cover now hides the clip stage during the bake, showing "baking…" + the progress bar. Independent of the decode method, so it's correct regardless of the later bake-speed work. **Verify (Daniel):** baking shows a clean "baking…" state instead of flickering. **NOTE — bake-speed investigation (see HANDOFF/response):** decode-by-playback turned out narrower than the plan assumed (≈3× on Firefox/Chromium only; Safari is encode-bound by the `VideoFrame`-from-canvas cost; bounce-reverse + long-crossfade seam buffers hit a memory wall). The real fast fix is a WebCodecs `VideoDecoder` + mp4 demuxer (new dependency). The smooth-dial-in need is better served by the two-video crossfade PREVIEW blend (next).

---

## v0.9.14 (Build 161) — 2026-06-10

**Clip editor: live crossfade dissolve preview.** Slice mode now previews the actual seam crossfade (not a hard cut), so you can dial in the cut point + crossfade duration before baking — the editor's whole purpose. The slice preview is a phase machine: native playback of B(=[cut,out]) → at the seam it PAUSES and cross-dissolves pre-captured seam frames (B-tail → A-head) on a `#clipBlend` overlay over the crossfade duration → seeks to in+cfSec and continues A → loops. The small seam buffer (~8 frames each side, preview res) is captured seek-based + debounced when you enter slice mode or change the cut/crossfade/trim; until it's ready the seam falls back to a hard cut. Matches the baked output. **Verify (Daniel — needs your eyes on timing/look):** slice mode → the seam shows a smooth dissolve that loops; dragging the cut point / crossfade re-captures (brief preview pause ~1–2s) then updates the dissolve; the dissolve length tracks the crossfade field. **Known:** entering slice / changing cut/crossfade pauses the preview briefly while it re-captures the seam (seek-based); the live dissolve is preview-res. **Next:** the bake speedup (decode-by-playback) — the remaining half.

---

## v0.9.13 (Build 160) — 2026-06-10

**Two fixes from Daniel's Build-159 testing.**
- **Clip scrubber resumes from where you scrubbed.** Releasing the scrubber reset the preview to the segment start (you couldn't scrub forward and play on). `startClipPreview(reset=false)` now resumes from the current frame — picks up the right segment for forward/slice, re-anchors the bounce clock.
- **Video plays with just the default keyframe.** Playback/render required ≥2 keyframes (the still-animation rule); for a video, one keyframe is already playable — the footage moves under static params. Now video play/render/export are enabled at ≥1 keyframe (`env.sourceVideo ? 1 : 2`); stills still need ≥2.

**Verify (Daniel):** scrub the clip bar, release → it keeps playing from there; enter motion mode on a video (just the seeded kf0) → play works without adding a second keyframe.

---

## v0.9.12 (Build 159) — 2026-06-10

**Clip editor: scrubber + bounce preview (Phase 1a).** Two of Daniel's clip-editor findings:
- **Scrubber.** Drag anywhere on the clip bar (off the trim/cut handles) to move the preview to that moment — pauses the auto-loop, coalesced seek (`clipSeekTo`), resumes on release. Lets you inspect any frame (e.g. the bounce turnaround) without waiting for the whole loop.
- **Bounce preview actually bounces.** `bounce` mode previewed as a forward loop (native `<video>` can't reverse). Now it's seek-driven: a wall-clock `p` over the bounce duration → triangle (`q = 1 − |1 − 2p|`) → trimmed source time, seeked. It bounces between the trimmed ends; the reverse half is choppy on long clips (backward seeks), but the scrubber lets you inspect the turnaround precisely. Forward/trim/slice keep native segment playback.

**Verify (Daniel):** drag the clip bar → preview jumps there, playhead tracks, loop resumes on release; bounce mode → preview plays forward then back between the trim points. **Next (Phase 1b):** a real crossfade dissolve in the slice preview; then (Phase 2) the bake speedup (decode-by-playback).

---

## v0.9.11 (Build 158) — 2026-06-09

**Clip editor — increment B2: slice + crossfade bake.** The **slice** mode is now live (the FCP technique): cut the trimmed clip at a point, move the head segment to the back, and crossfade the seam so it loops seamlessly. New controls in the clip sheet: a **cut-point** handle on the clip bar (blue, distinct from the yellow trim handles) and a **crossfade duration** scrub field (default 0.5s), both shown only in slice mode. The bake reuses the same pipeline (`bakeAndApply` slice branch): it rearranges to B(=[cut,out]) then A(=[in,cut]) — the loop point (A end = B start = cut) is continuous, and the B→A seam is cross-dissolved by overlapping B's tail with A's head (two source seeks per crossfade frame, `globalAlpha` blend), which shortens the loop by the crossfade length. The **in-editor preview** plays the rearrangement (B then A) so the seam is visible in context — a hard cut live; the bake applies the blend. **Verify (Daniel):** slice → set the cut point + crossfade → preview shows the rearranged seam → bake → the result loops seamlessly with a smooth dissolve at the seam; animate + export over it. **Known limits (shared with B1):** seek-based decode (slow on long clips), 30fps bake, no mid-bake cancel; the live preview shows a hard seam cut (blend only on bake), and bounce preview is forward-only (reverse can't play natively).

---

## v0.9.10 (Build 157) — 2026-06-09

**Fix: always arrive in the motion editor with a selected kf0.** After using the clip editor (trim or bake) — and on a source switch — the re-bind reset `motion.selected = -1` and didn't guarantee a start keyframe, so the first `+keyframe` re-created a start anchor (or anchored a new one at the scrubber) instead of adding an in-between (Daniel: "after trimming, the first keyframe needs recreated"). New shared `ensureSeededSelection`: however you reach the motion editor (fresh entry, source switch, clip editor), you land with a kf0 (recording the current slice look) AND with it selected, so `+keyframe` adds an in-between as expected. Wired into `rebindClipToTimeline` + `rebindMotionToSource` (fresh entry already did this). **Verify (Daniel):** trim a clip → back in the motion editor, kf0 is present/selected and the first `+keyframe` drops an auto-spaced in-between (matches the no-trim flow); same after bounce-bake and after switching sources.

---

## v0.9.9 (Build 156) — 2026-06-09

**Clip editor — increment B1: bounce bake.** The clip editor gains a **seamless-loop mode** toggle (trim only / bounce / slice) and the **bake pipeline**. Bounce bakes a forward-then-reverse version of the trimmed clip so it loops seamlessly (the animation doesn't need to bounce — it ends on the same frame). The pipeline reuses the video **export encoder** (`exportVideo`): a `frameAt` callback decodes source frames (seek-based) along a triangle-wave source time (`q = 1 − |1 − 2p|`), draws them to a canvas, and re-encodes to mp4; the baked clip is swapped in as the working source (`applyBakedClip`), trim resets, and the motion timeline re-binds — downstream it's a normal forward loop (realtime, no engine change). Baking is **destructive** (replaces the working source; the uploaded original is kept in `originalSource` for the export package and is untouched on disk), so it's gated behind a **confirm** soft-warning, with an in-sheet progress bar. **Known limits (v1):** decode is seek-based so baking is one-time-slow on long clips (WebCodecs decode = future speedup); bakes at 30fps (source-fps estimation is a backlog item); no mid-bake cancel yet. **Slice** mode is present but disabled (B2 next). **Verify (Daniel):** clip ▸ → trim → bounce → bake; the result is a seamless forward-reverse loop, the timeline/duration cover it, and animating + export work over it; trim-only still applies non-destructively without baking.

---

## v0.9.8 (Build 155) — 2026-06-09

**Fix: clip-editor trim handles no longer flood the decoder.** The trim handles seeked the preview video on *every* pointermove with no coalescing, so dragging flooded the decoder and made the clip-editor scrubber feel much heavier than the main timeline — even on Chrome (engine-independent; Daniel confirmed cross-engine). Now handle drags go through a coalesced `clipSeekTo` (latest-target-wins, mirroring `scrubVideo`), so only the latest position seeks. **Context (Daniel's diagnosis):** the broader "slow on M5" turned out to be a Firefox-vs-Chrome comparison, not a regression — 154 is snappy on Brave/Chromium; Firefox's heavier seek/decode cost (everything video is seek-based) is the real driver there, addressed later by seek-reduction (footage cache / decode-based thumbnails), not reversion. **Verify (Daniel):** dragging the clip-editor trim handles is now as responsive as the main scrubber on Chromium.

---

## v0.9.7 (Build 154) — 2026-06-09

**Clip editor — increment A: trim + looped preview (non-destructive).** First piece of the pre-animation clip editor. A **clip ▸** button in the motion footer (video-only) opens a sheet (`#clipSheet`, mirrors the render sheet) with a looping preview of the source and two drag handles to **trim** off the front and back. The preview is its OWN `<video>` (same blob URL) so it never disturbs the texture-source element; it loops within the trimmed range and a playhead tracks it. Apply commits the trim; Cancel reverts. Trim threads through the source-time seam non-destructively: `pToMediaSec(video, p, clip)` now scales `p` into `[inT, outT]` (default `[0,1]` = identical to before), `videoNativeDurationMs`/`lockVideoDuration` use the trimmed length (so the timeline + export cover only the trim, and retime stacks on top), and `startVideoPlayback` loops within the trimmed range. Trim resets to the whole clip on a new video load. **Next — increment B:** bounce + slice/crossfade (baked, reusing the export encoder) + the destructive-bake soft-warning + in-editor loop preview of the seam. **Verify (Daniel):** open clip ▸ on a video, trim front/back (preview loops the trimmed range), Apply → timeline/ruler/duration cover only the trim, scrub/playback/export honor it; Cancel reverts; loading a new video clears the trim.

---

## v0.9.6 (Build 153) — 2026-06-09

**Video retime (playback speed).** Video sources were stuck at native speed (stills can already set any duration). A new **speed** control in the motion footer (25% / 50% / 100% / 200%, video-only) retimes playback — especially to *slow busy footage down* so the kaleidoscope fold stays readable. Implementation maps onto what we already have: `motion.videoSpeed` sets the source `<video>.playbackRate` for preview, and the locked `motion.durationMs = nativeDuration ÷ videoSpeed`, so the timeline + frame-by-frame export stretch/compress automatically (no engine change). Re-locked on motion entry, source switch, and JSON load; `videoSpeed` is included in the motion JSON. **Caveat:** heavy slow-mo repeats the nearest footage frame on export (seek-based, no frame interpolation) — masked well by the fold; true interpolation is a future nicety. **Verify (Daniel):** with a video, the speed presets slow/speed playback (footage + params stay in sync), the ruler/duration reflect the new length, export runs at the retimed duration, and 50%/25% make a busy clip readable.

---

## v0.9.5 (Build 152) — 2026-06-09

**Source-switch reset.** Loading a new source while animating left stale state behind: the old clip's locked duration, the previous source's keyframe thumbnails, and a desynced play/pause (plus video always free-ran, even mid-animation). Now `loadVideo`/`loadImage` halt playback and clear the filmstrip signature on any switch, and — if you're in motion mode — `rebindMotionToSource` re-binds the keyframes to the new source: re-locks the duration to the new clip (video), resets the playhead + timeline view to fit, forces a thumbnail rebuild from the new source, and shows the new clip's first frame timeline-driven (no free-run). **Keyframes are kept** — they're source-agnostic (params over time, like the motion-JSON), so the bug was only the source-dependent state, not the animation. **Verify (Daniel):** animate over video A, load video B → duration matches B, thumbnails regenerate from B, playhead at start, play/pause sane, keyframes preserved; same for switching to a still.

---

## v0.9.4 (Build 151) — 2026-06-09

**Fix: inserting an auto-spaced keyframe between two keyframes no longer inherits the first one's look.** `+keyframe` captures `{...state}`, which (when a keyframe is highlighted) equals the *selected* keyframe's snapshot — so inserting between two keyframes with different slice properties detoured the motion to the first keyframe's values (Daniel's repro; the anchor-then-unlock workaround gave the right result because the anchored path captures the interpolated `state` from the playhead sample). Now an auto-spaced inserted keyframe captures the **interpolated value on the existing curve at its new time** (`sampleKeyframes` over the other keyframes, discrete still locked to kf0), so the insert lies on the path and doesn't disturb the motion until you tweak it. The working state + panel sync to the interpolated value so edits build on it. (Anchored-at-scrubber and kf0 adds are unchanged — they already captured the right value.) **Verify (Daniel):** two keyframes with different slice properties, `+keyframe` between them → the new keyframe sits on the curve (no detour to the first); editing it then works from the in-between value.

---

## v0.9.3 (Build 150) — 2026-06-06

**Tween band is aspect-locked cells now (no more zoom-stretch).** Replaces the single stretched strip canvas with a row of square thumbnail **cells** positioned by time (`makeStripCell`/`repositionStripCells`; `.mf-cell`). Per Daniel's proposal: at fit they tile edge-to-edge (the continuous-filmstrip look); zooming in **spreads them apart at their native aspect** (crisp, never stretched) via cheap repositioning; and a **debounced rebuild re-renders the cells for the current visible window when idle**, so they fill back in densely + crisply. The band always covers just the visible window (`[pan, pan+span]`, ~one square per track-height of width), so the seek count per rebuild stays bounded regardless of zoom. The strip's CSS transform is now pan-only (the cells carry zoom in their positions). Rebuild triggers added on zoom/pan settle (`scheduleFilmstrip` from the zoom/pan handlers; the sig now includes zoom + pan). Both still and video paths use the cell model (video seeks per cell, frozen-preview, as before). **Verify (Daniel):** at fit the band reads as a continuous filmstrip; zooming spreads crisp square thumbnails (gaps briefly, then they re-fill denser when you pause); panning re-fills for the new region; on video the cells show the footage at each time; no stretching at any zoom.

---

## v0.9.2 (Build 149) — 2026-06-06

**Smooth playhead follow (replaces the Build-148 page-jump).** Daniel found the paged follow disorienting — it snapped the whole timeline forward in an instant while the eye was tracking the scrubber. Now the playhead **pins at ~80% of the window and the timeline scrolls continuously underneath it** (no jump); on a loop wrap it re-enters near the left. To make per-frame panning smooth and cheap, markers + ruler are now positioned by **zoom only** (`zPct`) and **panned via a single CSS layer transform** (`applyPan` on `#mfMarkers`/`#mfRuler`, plus the strip's existing transform) — so following and two-finger scroll just slide transforms instead of rebuilding the timeline each frame. The playhead lives in the track itself (absolute, via `tToPct`), so it stays put while the layers scroll. `relayoutTimeline` (rebuild) is now only for zoom + structural changes; pan-only updates use `applyPan`. **Verify (Daniel):** zoomed playback scrolls smoothly with the scrubber pinned near the right (no snap); two-finger scroll pans smoothly; markers/ruler/scrub stay aligned; loop wrap returns to the start cleanly.

---

## v0.9.1 (Build 148) — 2026-06-06

**Three timeline-interaction refinements (Daniel's smoke-test notes).**
- **Playhead auto-follow when zoomed.** During playback, once the scrubber passes ~85% of the visible window (or wraps to the left on a loop), the view pages so the playhead sits ~15% in, keeping buffer ahead (`followPlayhead`, called from both playback loops; only relayouts at a threshold cross, so it's cheap). No effect when fit (zoom = 1).
- **Context-aware keyframe placement.** `+keyframe` now branches on whether a keyframe is highlighted: if one IS selected, it lays an auto-spaced keyframe after it (duplicate-and-tweak, as before); if NOTHING is selected (you scrubbed to a specific point), it ANCHORS a keyframe at that exact scrubber position. So you can place precise keyframes by scrubbing, or keep the auto-spaced flow by working from a selection.
- **Scrub from the ruler.** Dragging the time ruler now moves the scrubber (single-pointer; pinch/pan stays on the track), since the ruler reads as a measuring scale you'd want to drag.

**Verify (Daniel):** zoomed playback keeps the scrubber on screen with lookahead; scrub-to-a-gap + `+keyframe` drops an anchored keyframe there, while selecting a keyframe + `+keyframe` adds an auto-spaced one after it; dragging the ruler scrubs.

---

## v0.9.0 (Build 147) — 2026-06-06

**Milestone: video support is real.** Marks the point where the source-video animation track is end-to-end usable (load → scrub/keyframe/play over footage → frame-accurate export) plus a navigable timeline. Lots of refinement still ahead, but the capability is real.

**Timeline zoom / pan / scale-to-fit (the long-pending "B4").** The timeline is now navigable — essential for multi-minute video sources. Ephemeral, session-scoped view transform (`session.timelineZoom` ≥1, `session.timelinePan` = visible-window left edge in normalized [0,1]); everything positioned by time routes through `tToPct`/`pctToT`, so markers, playhead, ruler, and scrub share one window. The tween strip is rendered at full-timeline width and **CSS-transformed** (`translateX` + `scaleX` on `#mfStrip`), so zoom/pan is instant and never re-seeks the footage.
- **Input (per Daniel):** trackpad-native — pinch-to-zoom (browsers map it to ctrl+wheel) zooms centered on the cursor; two-finger scroll pans (when zoomed in). Touch gets two-finger pinch-zoom + pan (anchored to the finger midpoint). Mouse users get **fit / zoom-in / zoom-out** buttons in the transport row.
- **Scale-to-fit** resets to the full view; max zoom scales with clip length (~2s minimum visible window, capped 240×). Entering motion mode starts fit-to-view.
- `renderTimeline` split into `relayoutTimeline` (markers/playhead/ruler/strip-transform, no rebuild) + a debounced filmstrip rebuild, so zoom/pan only relayout.

**Verify (Daniel):** on a long video, pinch/scroll (trackpad) and the fit/±buttons zoom and pan; markers, playhead, ruler ticks, and click-to-scrub all stay correct under the transform; dragging a keyframe lands where expected when zoomed; fit resets. Touch: two-finger pinch + pan. **Known limitations:** the strip is CSS-stretched when zoomed (gets soft at deep zoom — a crisp re-render-at-window is a future polish); the view doesn't auto-follow the playhead during playback yet.

---

## v0.8.8 (Build 146) — 2026-06-06

**Ruler shows total duration.** The timeline ruler now always renders the clip / loop length as a right-aligned label at the very end (slightly brighter `#aaa` so it reads as the bound), per Daniel's request to prioritize total-duration visibility. Any regular tick that would collide with it (within ~half a step of the end) is suppressed. **Verify (Daniel):** the right end of the ruler always shows the total time (matches the duration field on stills, the clip length on video), with no crowding against the last regular label.

---

## v0.8.7 (Build 145) — 2026-06-06

**Filmstrip rebuild — fast + flash-free on every browser (fixes the Build-143 regression).** Build 143's browser-conditional render path backfired once the tween strip multiplied the per-rebuild work: on Firefox the offscreen FBO path uses `readPixels` (Gecko is slow at it — the old Build-124 lag cause), so rebuilds crawled and the band took minutes; on Safari the capture path borrows the live preview, so all the cell renders flashed through on screen ("a sequence of images" after editing). Fix: use the readback-free **capture path on every engine** (GPU `drawImage`, fast everywhere — what Firefox used fine in 142), and **freeze the live preview behind a static snapshot** (`freezePreview`/`unfreezePreview`, a 2D copy `position:fixed` over the preview rect) for the duration of the background rebuild, lifted after a synchronous repaint — so the off-screen work never flashes. Removed the `IS_WEBKIT`/`exportFrame` branch. **Verify (Daniel):** editing a keyframe (e.g. dragging the slice segment) over a video no longer flashes the output on Safari, and Firefox is responsive again (the band still takes a beat to fill on long clips — that's the seeks; a footage-frame cache is the next lever if it's still too slow). **Known remaining cost:** one seek per strip cell + thumb per rebuild (background, masked).

---

## v0.8.6 (Build 144) — 2026-06-06

**Timeline ruler — ticks + occasional timestamps.** A measuring scale (`#mfRuler`) now sits above the track: minor ticks at a regular interval plus major ticks with a timestamp at a coarser "nice" interval (0.5/1/2/5/10/15/30/60/120/300/600/900/1800s) chosen so labels stay readable at the current width (~one label per 84px, 2–12 labels). Timestamps read as `m:ss` past a minute, else `Ns`/`N.Ns`. Relative keyframe position is still the focus; the labels give a sense of absolute time, which fixed-duration media (video) needs. Re-renders on duration change, timeline change, motion entry, and resize (label density tracks width). Tick positions are inset 1px to line up with the markers inside the track's border. **Verify (Daniel):** the ruler reads sensibly for both a short still loop and a multi-minute video (sensible label spacing, t=0 left-aligned, no crowding); labels update when you scrub the duration field (stills) and match the clip length on a video.

---

## v0.8.5 (Build 143) — 2026-06-06

**Tween-strip band renders for video + flicker fixed (Firefox/Chrome).** The timeline's tween filmstrip (the continuous band behind the keyframe markers) now renders for a video source, and the rebuild flicker is gone on engines with sound FBO readback.
- **Tween strip for video.** `buildFilmstripVideo` now seeks the footage per strip cell as well as per keyframe, in one ascending pass over time, so the band shows the actual footage + interpolated look across the whole timeline (previously skipped for video). Builds into a fresh canvas swapped in only when complete, so the old band stays visible during the rebuild instead of blanking.
- **Flicker fixed (Firefox/Chrome).** The flicker came from the rebuild borrowing + resizing the LIVE preview canvas, with the async seeks letting it composite mid-build. Where the engine's FBO readback is sound (Firefox/Chrome) the thumbnails now render OFFSCREEN via `exportFrame`, never touching the preview — no flicker. Desktop Safari's FBO readback is the "blue cells" corruption, so WebKit stays on the capture path (its existing flicker remains there — status quo, not a regression).

**Verify (Daniel):** on a video with ≥2 keyframes, the band behind the markers fills with the footage/tween across the timeline; on Firefox the preview no longer flickers during the debounced rebuild. (Safari still flickers — expected.) Longer/higher-res clips: the band takes a moment to fill (one seek per cell) — a known cost of seek-based rebuilds.

---

## v0.8.4 (Build 142) — 2026-06-06

**Video keyframe thumbnails actually render now + dragging a keyframe previews the footage.** Two fixes on the Build-141 thumbnail work:
- **Blank thumbnails fixed.** Build 141 hid the preview canvas during the thumbnail build; Firefox drops the WebGL drawing buffer for a non-composited canvas, so the captures came back empty (blank markers). Removed the hide — captures render correctly. Trade-off: a brief preview flicker during the debounced rebuild as the captures render at thumbnail size (cosmetic; `resizePreviewCanvas` restores the preview after).
- **Dragging a keyframe previews the drop position.** The marker-drag handler updated the keyframe's time but never moved the footage, so you couldn't see where you were dropping it (scrub, memorize the spot, then drag blind). Dragging a marker now scrubs the footage to the drop position live (coalesced seeks) so you can place keyframes by eye.

**Verify (Daniel):** keyframe marker thumbnails render (not blank) and match each keyframe's footage; dragging a keyframe shows the footage move to where it will land.

---

## v0.8.3 (Build 141) — 2026-06-06

**Keyframe thumbnails follow the footage (video).** Keyframe marker thumbnails now seek the footage to each keyframe's own time before capturing, so they stay correct under add / edit / auto-shift / drag instead of all rendering from the last-edited frame (the bug Daniel hit: editing one keyframe rewrote every other thumbnail with its frame). The rebuild is async + single-flight (`_filmstripBusy`) + cancellable (`_filmstripGen`, bumped by scrub/playback): it seeks per keyframe, hides the preview during the build (captures borrow the live GL canvas), restores the footage to the playhead after, and bails if a scrub / playback / newer build supersedes it. Adding a keyframe also moves the footage to the new keyframe's (auto-spaced) time. **Deferred for video:** the tween filmstrip STRIP (the band behind the markers) is skipped for now (it would need a seek per cell); the markers carry the correct per-keyframe thumbnails. **Verify (Daniel):** add several keyframes over a video at different times, then edit / auto-shift / drag them — each marker thumbnail should show that keyframe's own footage frame, and editing one should not change another's. A brief preview blank during the debounced thumbnail rebuild is expected (it's seeking).

---

## v0.8.2 (Build 140) — 2026-06-05

**Selecting/cycling keyframes now seeks the footage (video).** `selectKeyframe` loaded the keyframe's params and re-rendered but never moved the video, so on a video source every keyframe you clicked or stepped to rendered over whatever frame was last positioned — the most-recently-edited keyframe's frame "projected" onto all the others (params differed, footage didn't). Now selecting a keyframe also seeks the footage to that keyframe's time. The coalescing seeker (`scrubVideo`) gained an `assignParams` option: scrub / load-playhead still sample the interpolated params at p, but selection passes `false` so the keyframe's EXACT stored snap shows (over the correct frame), not the interpolated value. Covers marker-click, prev/next stepper, and post-delete reselect. **Verify (Daniel):** with a video + several keyframes at different times, click/step through them — each shows its own footage frame, not a shared stale one. (The marker THUMBNAIL images are still the separate async-filmstrip gap.)

---

## v0.8.1 (Build 139) — 2026-06-05

**Frame-accurate video export — the footage now moves in the render.** `exportVideo` awaits each `frameAt`, and for a video source each output frame first seeks the footage to that point (`advanceSourceToP`) before capturing. So a rendered loop now shows the actual video advancing under the animated kaleidoscope params, instead of a single frozen frame. The companion source-preview video seeks too, and after a render the footage is restored to the playhead. **Note:** this is seek-based (one video seek per output frame), so a long high-res render is correct but slow — the WebCodecs-demuxer accelerator (faster decode) remains the future speed option, and the per-frame timing reader's `gl` bucket now includes the seek cost. Still-image animation export is unchanged. **Verify (Daniel):** render a keyframed loop over a moving clip — the footage should advance through the render, not stay frozen.

---

## v0.8.0 (Build 138) — 2026-06-05

**Video animation milestone + the stuck-frame scrub fix.** Keyframing kaleidoscope parameters over a source video now works end to end (load → scrub → keyframe → play → render), hence the minor bump to 0.8.0.

- **Fixed the stuck-frame bug (Daniel, longer clips).** `seekVideoTo` waited on `requestVideoFrameCallback` after the seek, but the source `<video>` is occluded (opacity 0, behind the preview canvas), so on Blink/WebKit it may never present a frame to the compositor — the callback never fired, the seek promise hung, and the coalescing scrub loop wedged on whatever frame playback last left (clicking the scrubber elsewhere did nothing; only pressing play recovered, since playback reads `currentTime` instead of seeking). Now `seekVideoTo` resolves on the `'seeked'` event (the decoded frame is ready for the texture then) and never waits on the compositor, with a 2s safety timeout so a seek can never wedge the loop. `scrubVideo` also clears its in-flight flag in a `finally`. Scrub now updates live (coalesced) on all engines, which also fixes the source-overlay-not-animating symptom (same root cause).
- **Firefox false-positive ProRes error fixed.** A mid-playback decode hiccup on some Firefox `.mov` files fired the load-error handler and wrongly blamed ProRes. The codec/ProRes hint now shows only if the error happens BEFORE the clip loads; a post-load decode error just warns to the console (the underlying Firefox `.mov` decode robustness is a tracked, deferred issue).

**IMPORTANT — video export is still params-over-a-frozen-frame.** Rendering currently animates the keyframed params over a SINGLE (paused) video frame; the footage does NOT advance frame-by-frame in the output yet. Making the video move in the render is the **frame-accurate video export** increment (now unblocked by this seek fix). So the "animated loop over a video" renders so far are param animation over a still from the clip.

**Verify (Daniel):** on a longer clip, click/scrub anywhere on the timeline → the footage jumps to that frame (no longer stuck) and you can keyframe there; play still works; the Firefox `.mov` that false-errored should no longer throw the ProRes message mid-playback.

---

## v0.7.41 (Build 137) — 2026-06-05

**Video bound to the motion timeline (increment 2a) — scrub + keyframe over the footage.** Motion mode now works on a video source (un-gated): entering it stops the free-run loop, pauses the video, and locks the loop duration to the clip length; exiting resumes the free-run preview. New `shell/video-source.js` (`pToMediaSec`; `seekVideoTo` — rVFC-preferred with a `'seeked'` fallback for Firefox) plus `advanceSourceToP` / `scrubVideo` (coalescing seeks, latest-target-wins) in `main.js`. **Scrub** the timeline → the footage seeks to that frame, params sampled at the same position. **Playback** uses the `<video>` as the master clock — it plays, and each frame derives `p` from `currentTime`, samples params at `p`, and renders, so params stay locked to the actual presented frame. The duration field is read-only for a video (it's the clip length). Net: you can author parameter keyframes over moving footage — scrub to a spot, tweak, add a keyframe, repeat.

**Known gaps (next increments):** the filmstrip + keyframe thumbnails still sample only params against the *current* frame (no per-cell seek yet → the strip looks uniform across footage; the async filmstrip is a later increment); loop-lock for a looping clip + in/out trim are increment 2b; iPhone/Firefox color + rotation quirks still deferred.

**Verify (Daniel):** load a video → the motion button is enabled; enter motion mode; scrub the timeline → the footage seeks under the wedge; add 2+ keyframes at different scrub positions with different looks; press play → the video plays with params animating in sync; exit motion → the free-run preview resumes. (Firefox uses the `'seeked'` fallback; expect scrubbing to feel a touch less immediate there.)

---

## v0.7.40 (Build 136) — 2026-06-05

**Source-video preview actually wired up (the real fix for blank source on Brave/Firefox).** Build 135's canvas preview never executed: `mountSourceView` operates on the source-overlay COMPONENT's `view` object, which only proxied `liveVideo`, not `sourceVideo` — so every loaded video fell through to the STILL path (a `background-image` of a video blob URL, which only WebKit renders, which is exactly why it "worked" on Safari and was blank on Blink/Gecko). Separately, the render loop read the preview canvas off `env` while `mountSourceView` wrote it onto `view`. Both halves are now connected: the component exposes `sourceVideo` (via a new `getSourceVideo` ctx hook) and a `paintSourceVideo()` method that the host render loop calls each frame. **Verify (Daniel):** the source slot shows the playing footage (not black/blank) on Brave + Firefox + Safari for mp4/m4v/mov. (The iPhone-`.mov` color/aspect quirks remain the separate deferred item.)

---

## v0.7.39 (Build 135) — 2026-06-05

**Source-video preview painted via a 2D canvas (fixes the black preview on Blink/Gecko).** A `<video>` used as a WebGL texture source renders black when also displayed directly on Brave/Firefox (it worked only on Safari), even while playing. Fix: keep the `<video>` in the DOM but occluded (it must stay live to decode + feed the texture) and paint a small 2D-canvas copy on top that the render loop refreshes each frame — a canvas composites reliably on every engine, and it also dodges native-video color/rotation display quirks. The source slot now shows the moving footage with the wedge overlay on all three browsers. (Live camera is unchanged — it still mounts its `<video>` directly.)

**Still open — real-world iPhone-video quirks (Daniel, backlog):** (a) **washed-out color in the kaleidoscope OUTPUT** for an iPhone `.mov` on Safari + Firefox — a texture colorspace/range issue in the WebGL upload (the painted source preview shows natural color); (b) **vertical aspect squish on Firefox** for the same clip — iPhone rotation / pixel-aspect metadata handled differently across engines, so `videoWidth/Height` (and thus the kaleidoscope aspect) come out wrong on Gecko. Both are deferred to a focused video-color/rotation pass; neither blocks the timeline-binding work.

---

## v0.7.38 (Build 134) — 2026-06-05

**Source-video fixes from Daniel's cross-browser test.** (1) **Preview now plays.** A loaded video plays muted-on-loop and drives the kaleidoscope each frame via the live-camera render path, so preview + output stay in sync. Replaces the static first-frame approach, which left a blank source preview on Chromium/Gecko (a paused, never-played `<video>` doesn't reliably paint there) and auto-played out of sync on Safari. (2) **`.m4v` (and any video) selectable** — file picker uses `accept="…,video/*"` instead of an explicit MIME list (Safari/Firefox were greying out `.m4v`). (3) **Clearer codec error** — failed loads say the browser may not support the codec and that ProRes works only in Safari. (4) **Motion mode gated off while a video is the source** (still-only until the timeline is bound to video next increment) so the playback loop and motion loop don't fight; loading a still re-enables it. Switching sources (still/camera/video) stops the video loop, pauses it, and revokes its objectURL.

**Known limitation (flagged by Daniel):** browser `<video>` can't decode **ProRes** except on Safari (WebCodecs can't either, broadly) — relevant to the FCP→(Fold)→Resolume Alley workflow; ProRes sources need Safari or a transcode to H.264/HEVC first. Tracked in BACKLOG, not a blocker.

**Verify (Daniel):** a video shows + plays in the source slot with the wedge aligned and the kaleidoscope animating in sync on Brave/Firefox/Safari; `.m4v` selectable; ProRes gives the clearer error on Chrome/FF and still loads on Safari; switching back to an image works and re-enables motion.

---

## v0.7.37 (Build 133) — 2026-06-05

**Load a video as the source (first increment of source-video animation).** The file picker + drag-drop now accept video (`mp4`/`mov`/`webm`); a chosen/dropped video routes to a new `loadVideo()` (parallel to `loadImage`) that mounts a paused `<video>`, hands it to `engine.setSource()` (the engine already samples a `<video>` — the live camera uses the same path), and kaleidoscopes its FIRST frame as a static source. All slice/canvas editing, swap, and export work on it like a still. `mountSourceView` now mounts a loaded source video (via `env.sourceVideo`), not just the live camera; switching to a still/camera clears it and revokes the objectURL. "upload image" button → "upload". **NEXT increment:** bind the video to the motion timeline (scrub the timeline to scrub the footage, then author parameter keyframes over the moving video; loop-lock for looping clips). **Verify (Daniel):** drop a video → it loads, shows in the source slot with the wedge overlay aligned, the kaleidoscope renders its first frame; slice/canvas controls + export behave like a still; switching back to an image still works.

---

## v0.7.36 (Build 132) — 2026-06-05

**All WebKit (incl. iPad) defaults to WebGL-direct export.** Daniel tested iPad M1: WebGL-direct gives ~55 fps vs ~18 on the 2D path, and a 75-second render was stable (the VideoFrame-from-WebGL hang from Build 115 is fixed on current iPadOS). Plus desktop-Safari 6K output verified correct. So `defaultCaptureMode` now selects WebGL-direct for ALL WebKit (desktop Safari + iPad), not just non-touch; Firefox + Chromium stay on 2D. `?capture=2d` remains as a safety hatch for any older iOS device that might still hang. Export speed is now fast on every engine and device we've tested.

---

## v0.7.35 (Build 131) — 2026-06-05

**Per-engine frame source — WebGL-direct on desktop Safari (the export-speed fix).** Build-130's A/B settled it: desktop Safari renders ~20× faster wrapping the WebGL canvas directly in a `VideoFrame` (≈130 fps @4K, >30 @8K) vs the 2D-canvas path (≈6 fps); Firefox + Chromium are fast on 2D, and Firefox is actually slightly *slower* on WebGL-direct. So the frame source is now chosen by engine (`defaultCaptureMode` in `main.js`): **non-touch WebKit (desktop Safari) → WebGL direct; everyone else (Firefox, Chromium, iPad) → 2D canvas.** iPad stays on the proven 2D path (WebGL-direct hung iPadOS in Build 115); `?capture=2d|bitmap|gl` overrides for testing (e.g. whether iPad tolerates 'gl' now). Removed the experiment selector from the render sheet (kept `engine.captureFrameGL` + the per-mode timing reader). Net: export throughput is no longer a bottleneck on any tested engine. **Verify (Daniel):** a desktop-Safari render is fast AND visually correct (color + orientation); Firefox/Chromium unchanged.

---

## v0.7.34 (Build 130) — 2026-06-05

**Frame-source experiment — find a faster `VideoFrame` path on Safari.** Build 129 localized the export bottleneck to `new VideoFrame(canvas)` (Safari ~177 ms/frame vs Firefox ~5 ms; encode ~0 on both). This build adds a temporary **frame source** selector to the render sheet to A/B the three candidates and read the resulting per-frame `vframe` ms: **2D canvas** (current/default, the proven Safari-safe path), **ImageBitmap** (`createImageBitmap` → `VideoFrame`), and **WebGL direct** (`VideoFrame` straight from the WebGL canvas via new `engine.captureFrameGL`; this was fast in Build 112 but hung iPadOS in Build 115, so it's a **desktop-only probe** with a fallback to the default). Goal: see whether avoiding the 2D-canvas RGBA→YUV conversion cuts Safari's per-frame cost. If one mode is dramatically faster and correct, it becomes the default and may remove the need for a worker-pool speedup; if none help, the conversion is intrinsic and parallelizing it across a worker pool is the real lever. The selector is experimental scaffolding to be removed once a winner is picked. No change to the default render path.

---

## v0.7.33 (Build 129) — 2026-06-05

**Export per-frame timing reader (diagnostic for the throughput ceiling).** `exportVideo` now accumulates and returns per-stage timing, and the render status + console show a per-frame breakdown: `gl` (frameAt = GL render + GL→2D capture blit), `vframe` (VideoFrame construction = the suspected color conversion), `encode` (encoder backpressure wait + flush = where the sequential encode cost surfaces, since `encode()` only queues). Purpose: localize which stage owns the single-threaded, output-pixel-linear cost Daniel measured (Safari ≈21 fps @1080p, ≈5–6 @4K, ≈1 @8K) so we can decide whether the browser-side lever (building `VideoFrame` straight from the WebGL canvas to drop the 2D-copy/convert) is worth attempting, or whether it's encode-bound and therefore native-wrapper territory. Captured as a **[HIGH PRI]** opportunity in BACKLOG. No behavior change to the render itself.

---

## v0.7.32 (Build 128) — 2026-06-05

**Revert the `prefer-hardware` hint — it was inert (export perf finding).** Daniel's Safari timings across resolutions: 4K ≈5 fps, 6K ≈2 fps, 8K ≈1 fps, all pegging a single "Safari Graphics and Media" core with the GPU idle, and cost scaling with OUTPUT pixels (not source size). Crucially, 8K HEVC was ~1 fps **both** in Build 126 (no hint) and Build 127 (hint), proving `hardwareAcceleration: 'prefer-hardware'` did nothing on Safari — this path is CPU / color-conversion bound (per-frame canvas→`VideoFrame` + sequential encode), not encoder-selection bound. Reverted to the default encode config (restores the verified Build-126 path and removes any doubt the hint touched the 4K H.264 path). The honest conclusion: browser WebCodecs encode here is single-threaded and has a throughput ceiling; the planned worker build makes a slow render non-blocking + abortable + memory-safe but will not multiply throughput (encode is sequential), and true multi-core/hardware-encode (plus Syphon) is the native-wrapper's job (FOLD.md Phase 4).

---

## v0.7.31 (Build 127) — 2026-06-05

**HEVC export — prefer the hardware encoder (8K render speed, from Daniel's test).** An 8K HEVC render came back correct but very slow (~1 frame/s, one CPU core pegged, GPU idle) — the signature of a single-threaded software encode (or per-frame CPU color conversion), not the hardware media engine. The Build 112 GL→`VideoFrame` capture path is codec-agnostic and still in use; what changed at 8K is that the bottleneck moved to the encoder. `encoder.configure` now passes `hardwareAcceleration: 'prefer-hardware'` so WebCodecs prefers the platform media engine (Apple Silicon VideoToolbox) where available, with software fallback intact. It's a hint, so it can't break a config gating already confirmed; gating still probes without the hint, so tiers stay offered even when only software encode exists. **Verify (Daniel):** re-render 8K HEVC and compare time + CPU usage; also try 6K — if 6K is fast and 8K stays slow, the hardware HEVC encoder caps below 8K on this machine and 8K is inherently software there (we'll then treat 8K as a slow/extreme tier with a warning, while 6K stays fast).

---

## v0.7.30 (Build 126) — 2026-06-05

**Video-export hardening — honest device-aware resolutions, HEVC for 6K/8K, 10-minute durations (first build of the source-video animation track).** Groundwork shared by still-animation and the coming video-source feature.

- **6K render crash fixed by gating + HEVC.** The crash was the encoder, not the renderer: we emit H.264 High@5.1, whose level caps frame size at 4K, so a 6K request was accepted by a lying `isConfigSupported`, encoded a few frames, then wedged (made worse by large frames piling up in the in-memory muxer). The render sheet now **probes each resolution tier per codec** (`pickVideoCodec` in `shell/video-export.js`) and only enables what this device can render (probed FBO ceiling) AND encode. Tiers that exceed the GPU/encoder are disabled with a reason in the tooltip; if the active tier is unsupported it falls back to a safe ≤4K pick.
- **HEVC encode branch (no new dependency).** Anything above 4K now encodes as **HEVC** (`hvc1.1.6.L186.B0`, Main@6.2) where the device supports it — hardware-backed on Apple Silicon via Safari — falling back to H.264 ≤4K elsewhere. mp4-muxer already muxes HEVC, so no dependency was added. Added an **8K** tier (appears only where HEVC at that size probes supported); the resolution grid is now 3-up (two rows). The meta line shows the chosen codec.
- **Duration cap 60s → 600s.** The motion duration field now scrubs to 10 minutes (`min 0.5, max 600`, coarse step 10); the motion-JSON load clamp follows (`600000`ms). NOTE: long high-res renders still risk the in-memory muxer OOM — Build 127 adds OPFS streaming-to-disk before 10-minute 4K is fully safe.
- **FBO probe ladder.** `probeMaxFBOSize` / `probeMaxFBOSizeVerbose` (`engine/gl.js`) gained `6144` and `3072` candidates (was `[16384,8192,4096,2048]`), so the probed ceiling can land on the 6K/3K tiers instead of silently collapsing them to 4096.

**Needs Daniel's in-browser pass:** on Apple Silicon Safari the sheet should offer 6K/8K (HEVC) and a 6K render should complete + play; on Firefox/Chrome (no HEVC encode) 6K/8K should be disabled with a tooltip and ≤4K H.264 unchanged; duration scrubs to 600s; 4K H.264 output unchanged from Build 125.

---

## v0.7.29 (Build 125) — 2026-06-04

**Motion mode seeds a keyframe on entry; settings lock only at 2 keyframes (Daniel QoL).** Entering motion mode now immediately adds a keyframe of the current look (auto-selected, so edits write through to it) instead of opening to an empty timeline. Form/segments/mirror/OOB stay **editable while there's a single keyframe** (refine the starting look) and **lock once a second keyframe exists** — the moment animating actually begins. Light-touch: reuses `addKeyframe` (with the Build-111 auto-select) and just nudges the existing lock thresholds from `>= 1` to `>= 2` (the `body.motion` CSS gate + `canEditDiscrete`). Re-entering motion mode keeps existing keyframes (no duplicate seed). Pairs with Build 124 — editing that seeded keyframe is snappy now that the per-frame thumbnail readback is gone.

---

## v0.7.28 (Build 124) — 2026-06-04

**Firefox motion-edit lag — the ACTUAL cause (per-frame keyframe-thumbnail readback).** Build 123 was the wrong layer. Daniel's finer detail nailed it: lag only when editing a *selected* keyframe (write-through) and on "+ keyframe" — both ran `fillThumb` → `engine.exportFrame` → `renderToFBO` → **`readPixels` (+ the Build-119 fence sync)** per edit frame / per add. Firefox is far slower at that GPU readback than Safari, so it stuttered there (snappy when no keyframe is selected → no write-through).

- **Removed `fillThumb` entirely.** Write-through now just commits `kf.snap` live (cheap); keyframe thumbnails are painted by `buildFilmstrip`'s **readback-free capture path** (`beginCapture`/`captureFrame` → `drawImage`) on the debounced rebuild — no per-frame/per-add `readPixels`.
- **`buildFilmstrip` now refreshes marker thumbnails even with a single keyframe** (the tween strip still only draws for ≥2), so a lone keyframe still gets a thumbnail. (Build 123's `syncControls` coalescing stays — a valid micro-opt, just not this bug.)

---

## v0.7.27 (Build 123) — 2026-06-04

**Firefox overlay-drag lag — coalesce per-move control syncing (Daniel: severe slice-drag lag on Firefox, snappy on Safari).** The direct-manipulation drag path (source-overlay move/scale/rotate + output pinch/twist) called `syncControls()` on **every pointermove**. Each call does DOM writes (`slider.value` + value `textContent`) for every registered control, and those writes interleaved with the `getBoundingClientRect()` read in the move handler — a read→write→read pattern that forces a synchronous layout reflow per event (layout thrash). Firefox fires far more pointermoves than Safari/Chrome and is much harsher about forced reflow, so dragging was sluggish there. Render and overlay-draw were already rAF-coalesced; `syncControls` now is too (`scheduleSyncControls`, one rAF), so the per-move reads no longer interleave with the writes. Sliders still track the drag (updated once per frame). If lag persists, the next suspect is `preserveDrawingBuffer: true` (a known Firefox per-frame cost, but it's needed for the on-demand preview to stay visible, so it can't simply be dropped).

---

## v0.7.26 (Build 122) — 2026-06-04

**Companion-video stroke weight + motion JSON round-trip (Daniel).**

- **Thicker wedge lines in the source-preview video.** The overlay strokes were hairline at 1920². Added an `overlayStrokeScale` (default 1, so the live overlay is unchanged) that the companion render sets to ~`size/540` (≈5px wedge lines at 1920²). Applied to the polygon outline/OOB/sample-region strokes and droste's ring/wedge/spiral outlines.
- **Motion data JSON (download / load).** A new **⋯ menu** in the motion footer: "download motion data" saves `{format,version,app,durationMs,loop,smoothing,keyframes:[{t,anchored,snap}]}` (source-AGNOSTIC — stores the motion, not the image); "load motion data" re-applies it to the current source (thumbnails regenerate, form UI syncs, cross-session persistence with no backend). Invalid file → an alert.
- **"motion data .json (.zip)" render checkbox**, alongside "source preview video". Any extra selected makes the render output a `.zip` (reuses the Build-121 packaging). The plain render (nothing checked) is still a single `.mp4`.

---

## v0.7.25 (Build 121) — 2026-06-04

**Companion "source preview" video + render packaging (Daniel).** Opt-in second video showing the SOURCE with the moving wedge overlay (the "how it was made" clip).

- **Render sheet checkbox "source preview video (.zip)".** When on, the render produces the kaleidoscope mp4 **plus** a square 1920² source-preview mp4 (same fps/duration), bundled into a **`.zip` package** (`name.mp4` + `name-source.mp4`) via the existing `zipStore` — since multi-file downloads are unreliable. Off = a single mp4 as before.
- **Source-preview frame compositor** (`renderSourcePreviewFrame`): draws the source image (square, matching the live fit) + a CLEAN wedge overlay (no editing affordances) by reusing `drawSourceOverlay` against the overlay component's view, pointed at an offscreen high-res canvas with hover/affordances neutralized — so **every form including droste** renders through its existing overlay path with no per-form code. Swap+restore is synchronous so a stray live overlay draw can't land on the temp canvas.
- **`exportVideo` generalized** to take a `frameAt(p) → canvas` + optional `onBegin/onEnd`, so the kaleidoscope (GL capture) and the source preview (2D compositor) drive the same encoder/muxer. Kaleidoscope path behavior is unchanged.

---

## v0.7.24 (Build 120) — 2026-06-04

**"Blue cells" — the real fix: filmstrip now avoids `readPixels` entirely.** Builds 118 (FBO reuse) and 119 (fence sync) both failed. New clues — **desktop Safari only** (not iPad/mobile), and **scrubbing alone re-triggers** corruption/correction — proved it's not a sync issue but desktop Safari's FBO `readPixels` path being broken (returns channel-swapped/banded data). No GPU sync fixes a broken readback, so we escape it: the filmstrip now renders via the engine **capture path** (`beginCapture`/`captureFrame` → `drawImage`, no `readPixels`) — the same approach that fixed iPad export. Also:
- **Synchronous build** so the briefly-borrowed preview canvas never composites mid-build (no flicker); preview restored + repainted after.
- **Content-signature skip:** scrubbing fires `renderTimeline` → `scheduleFilmstrip`, but the filmstrip is scrub-invariant, so it now skips the rebuild when keyframes/curve/duration/width are unchanged (no more needless rebuilds re-rolling the corruption).
- **Keyframe marker thumbnails refreshed in the same readback-free session**, so they're corrected too (the instant on-add thumb still uses the old path, then self-corrects on the 600ms debounce).

---

## v0.7.23 (Build 119) — 2026-06-04

**"Blue cells" — second, higher-confidence fix: real GPU fence sync before readback.** Build 118 (FBO reuse) didn't fix it. New screenshots showed *partial fills, horizontal banding, channel-swapped (R↔B = blue) content, flickering and self-correcting* — the signature of `readPixels` reading the FBO **before the GPU finished + resolved it** (returning the raw swizzled/tiled buffer). `gl.finish()` is meant to prevent that but is unreliable on Safari. `renderToFBO` now waits on a WebGL2 **fence sync** (`fenceSync` + `clientWaitSync`, ~1s cap, `gl.finish` fallback) before `readPixels`. One cause explains every symptom (partial + banding + blue + flicker + self-correct), reproduced on a fresh webcam capture (so not image-specific). Affects all `renderToFBO` users (filmstrip/thumbnails, still export, diagnostics) — still export was already fine, so no regression expected.

---

## v0.7.22 (Build 118) — 2026-06-04

**Filmstrip/thumbnail "blue cells" on Safari — attempted fix (needs Daniel's Safari verify).** `renderToFBO` created AND deleted a framebuffer + texture on *every* call; the filmstrip fires dozens of small renders in a burst, and Safari intermittently returned corrupt `readPixels` data under that churn → some thumbnails rendered blue (Firefox fine). Now reuses **one persistent FBO + texture**, (re)allocating only when the output size changes — removes the per-call churn and cuts GC. Shared by still export (`exportAt`) and the diagnostics path; behaviour otherwise unchanged. **If blue cells persist, the next diagnostic is whether they sit in fixed positions vs. move/flicker on rebuild** (fixed → state/shader-dependent; moving → readback corruption).

---

## v0.7.21 (Build 117) — 2026-06-04

**iPad timeline pushed offscreen with Safari tabs open — fixed.** The desktop chrome's `body` used `height: 100vh`. On iPad Safari, `100vh` is the *toolbars-hidden* (larger) viewport, so with the tab bar/toolbars showing the body ran taller than the visible area and the bottom (the motion timeline) was pushed below the fold — with `overflow: hidden` there was no way to scroll to it (closing tabs hid the bar and it fit again). Now `height: 100dvh` (dynamic viewport, fits the visible area; `100vh` fallback for old browsers), matching the mobile chrome. Desktop browsers are unaffected (dvh == vh there).

---

## v0.7.20 (Build 116) — 2026-06-04

**Motion smoothing — much stronger, tunable range (Daniel found 100% too mild).** Build 114's smoothing did a single Laplacian relax pass at 100% (one neighbour-average — mild). It now compounds `SMOOTH_PASSES` (=4) stable passes, so 100% is dramatically stronger while staying continuous and monotonic across the slider. Per-pass strength is capped at 0.5 (a full λ=1 oscillates when iterated — verified). `SMOOTH_PASSES` in `kit/tween.js` is the single "make it wilder" knob. Note: heavy smoothing also gradually relaxes loop amplitude toward the anchor (it's pulling values toward neighbours); for crank-the-smoothness-without-losing-motion, a shape-preserving (Taubin) pass is the follow-up if wanted.

---

## v0.7.19 (Build 115) — 2026-06-04

**iPad video export fixed (regression from Build 112).** On iPadOS Safari, export hung before the first frame: Build 112 built each `VideoFrame` directly from the **WebGL canvas**, which Safari handles unreliably (especially with `premultipliedAlpha:false`). Chrome was fine; iPad was not.

- **Fix (`engine.captureFrame`):** render to the GL canvas as before, then **GPU-blit it into a 2D canvas** (`drawImage`) and hand the `VideoFrame` that 2D canvas — a proven-compatible source (it's what the pre-112 path used). Still no `readPixels` / CPU Y-flip / `putImageData`, so the Build 112 speedup is preserved (`drawImage` is a GPU copy and handles the Y-flip). One path for all browsers.

---

## v0.7.18 (Build 114) — 2026-06-04

**Motion smoothing — velocity-continuous interpolation (Daniel's top animation priority, B3).** Replaces the per-segment easing that eased to **zero velocity at every keyframe** (a visible stutter when motion continued in one direction).

- **Velocity continuity is now the baseline, always on.** `sampleAt` interpolates with a **Catmull-Rom / finite-difference Hermite** spline across the whole keyframe sequence (`kit/tween.js` `sampleKeyframes`), so motion flows *through* keyframes and only slows at genuine turning points (where a value actually reverses). Loop-aware (kf0 is the t=1 return target; the curve is periodic with continuous velocity across the seam) and angle-unwrapped (angular fields run on a continuous unwrapped curve via shortest-path deltas, then re-wrap) so a 350°→10° sweep crosses 0° smoothly. At smoothing 0 the curve passes through keyframes exactly. Verified numerically (no zero-velocity dip through a middle keyframe; exact pass-through; correct angle sweep).
- **New "smoothing" control (replaces "easing").** `motion.smoothing` (0–100%, default 0) Laplacian-relaxes interior keyframe *values* toward their neighbours before interpolating — fudging exact values to absorb jaggy timing/placement (like a drawing app smoothing pen-stroke shake), as Daniel framed it. Endpoints/loop anchor stay fixed. The motion-footer field is relabeled `smoothing` (`mfSmoothVal`).
- Removed the old `spanSample`/`motion.easing` per-segment ease. `lerpState` stays as a Kit primitive (A/B + future live transitions). Pending refinement (backlog): per-keyframe ease handles for deliberate holds.

---

## v0.7.17 (Build 113) — 2026-06-04

**Video export success text now reports render time.** After a successful render the status reads e.g. `saved ✓ · rendered in 6.2s · 145 frames/s` — the wall-clock duration plus effective throughput (frames rendered per second, a device/perf diagnostic distinct from the output fps). Helpful for comparing the Build 112 speedup across devices/resolutions.

---

## v0.7.16 (Build 112) — 2026-06-04

**Video export speed — eliminate the single-core readback bottleneck (Daniel; pro-tool framing).** Export previously did, per frame: `renderToFBO` → `gl.finish()` → **`readPixels`** (a 4K frame is ~37 MB GPU→CPU) → a **CPU Y-flip loop** → **`putImageData`** → `VideoFrame`. All serial, single-core, main-thread — thousands of times for a long 4K loop.

- **New fast path:** the engine renders each frame **straight to its GL canvas** at output size and the canvas is wrapped **directly** in a `VideoFrame` (`engine.beginCapture(w,h)` / `captureFrame(state)→canvas` / `endCapture()`). No `readPixels`, no Y-flip, no `putImageData` — the browser ingests the canvas efficiently and the H.264 encode is already hardware. Orientation is correct (canvas is display-oriented); `preserveDrawingBuffer` (already on) makes the capture stable.
- The GL canvas is the live preview canvas, so its size is snapshotted/restored around the session and the preview is repainted after (`resizePreviewCanvas`). The export sheet is modal + video export requires a still source, so no competing render can corrupt a frame.
- **Still-image export (`exportAt`) and the thumbnail/filmstrip path (`exportFrame`) are untouched** — only the multi-frame video loop changed.
- Worker-based encode/mux offload was deliberately deferred (the encode is hardware; `readPixels` was the cost) — measure first.

---

## v0.7.15 (Build 111) — 2026-06-04

**Keyframe authoring → back to auto-select / duplicate-and-tweak (Daniel).** Reverses the Build 97 model. Daniel's diagnosis: the Build 97 "duplicate pause" was a *missing save-on-add trigger*, not auto-select itself — so we keep auto-select and make the commit explicit.

- **`+keyframe` now auto-selects the new keyframe** (`motion.selected = newIdx`), so subsequent edits write through (autosave) to it via the existing live write-through. (Was `-1`, which left edits unsaved unless you manually clicked the marker.)
- **`+keyframe` always lays a keyframe after the current one** — removed the `sameLook` guard that skipped an add when the scrubber sat on a matching keyframe (that was the "you must move the slider between keyframes to add" symptom). Adding without editing now leaves an intentional hold.
- **Explicit commit on add:** before laying the next keyframe, the currently-selected keyframe is synchronously committed from the working state, so the just-edited keyframe is never left stale (the save trigger Build 97 was missing). Removed the now-dead `sameLook` / `CONTINUOUS_KEYS` import.

---

## v0.7.14 (Build 110) — 2026-06-04

**First-keyframe lag fixed (HIGH-priority motion bug).** Saving the first keyframe froze the "+ keyframe" button for ~4-8s before a second could be added (source-size dependent).

- **Root cause:** `makeThumb()` did `drawImage(previewCanvas, …)` from the **large WebGL preview canvas** into the marker thumbnail. That's a synchronous GPU→CPU readback whose first (cold) sync stalls for seconds on big sources — and the add path also did a redundant full-size `engine.render(state)` first.
- **Fix (`src/main.js`):** thumbnails now fill from a small **offscreen** `engine.exportFrame` at 120×120 (the same cheap path the filmstrip uses since Build 99), fire-and-forget and async — the marker appears instantly and the thumb paints into its live canvas a frame later, so the tap is never blocked. A 120² render+readback is cheap regardless of source size. Removed the redundant full-size render from the add path. The edit write-through thumb uses the same cheap path (also helps huge-source keyframe editing).

---

## v0.7.13 (Build 109) — 2026-06-04

**Save/export sheet → centered modal (per Daniel — stop the cross-variant whack-a-mole).** The bottom-sheet positioning rendered wrong in most variants (tiny responsive desktop, portrait/landscape PWA, landscape mobile app — only mobile portrait was correct). Rather than keep patching tab-bar-relative offsets, it's now a plain centered modal: `position: absolute; top/left 50%; translate(-50%,-50%); width: min(480px, 100vw-32px); max-height: 86dvh`. Centering with a viewport margin clears the tab bar, a side Dynamic Island, the home indicator, and tiny widths all at once — no orientation/tab-bar logic. Removed `positionSheet()` and its calls. Backdrop still dims + dismisses.

---

## v0.7.12 (Build 108) — 2026-06-04

**Touch-rotate runaway — actual root cause (stacked listeners).** Build 106's frozen-frame fix helped but rotation still multiplied (~2× mobile web, ~2.75× PWA). The real cause: `setupSourceInteraction` binds the move/down listeners to `slotEl` — the **persistent** source-panel container — and `mountSourceView` re-runs on every swap / fill-fit toggle / divider re-fit / source change. It de-duped only the **window** listeners, so the wrap-level `mousemove`/`touchmove` **stacked** with each remount. Because rotate is the only *accumulative* gesture (it sums angle deltas), N stacked `onMove`s multiplied a 90° drag into N× the rotation; absolute move/scale were immune (last-write-wins), which is why only rotate ran away. The non-integer ratio just reflected how many remounts a session had accumulated.

- **Fix (`src/shell/overlay.js`):** track the attached **wrap-level** handlers (not just window) and remove them before re-binding, so exactly one listener set is ever active. Rotation now tracks the finger 1:1.
- Build 106's frozen-frame snapshot is retained as defense against mid-drag panel reflow (a smaller, separate effect).

---

## v0.7.11 (Build 107) — 2026-06-03

**Save sheet rests on the tab bar + narrower in landscape (from Daniel's testing).**

- **Rests on the tab bar, doesn't cover it.** `positionSheet()` now offsets the sheet panel so it sits *above* the tab bar in portrait (`bottom: tabbar height`) and *beside* it in landscape (`right: tabbar width`), re-applied on rotation. The full-screen backdrop still dims everything and catches a dismiss tap. (Interpretation of "rest on top of it rather than cover it" — confirm the feel.)
- **Narrower in landscape:** sheet cap dropped 600 → 480px (≈ just over half a landscape screen, clearly wider than the 260px popover menus, clears a side island).

---

## v0.7.10 (Build 106) — 2026-06-03

**Touch-rotate runaway fixed (regression from the backlog, reproduced on device).** Dragging a 90° arc to rotate the slice spun it 500°+ — an accumulating multiplier, not proportional tracking.

- **Root cause:** the rotate gesture snapshotted the orbit *center* at drag start (the Build 84 fix) but `localCoords()` still read the **live** `wrap.getBoundingClientRect()` every move. When the source panel reflows mid-drag (iPhone Safari hiding its address bar fires `resize`/relayout), the live frame shifts under the snapshot center and injects spurious angle that accumulates.
- **Fix (`src/shell/overlay.js`):** freeze the entire coordinate frame for the rotate gesture — snapshot `wrap.getBoundingClientRect()` at drag start and compute the pointer angle in that frozen frame, so rotation tracks the finger 1:1 regardless of mid-drag reflow. Also seeds `prevAngle` with the same `atan2` the move uses (instead of `cls.theta`, which a form's custom `classifyPointer` may compute in another convention) so there's no first-move jump on any form. The delta math itself was already correct (incremental + unwrapped); only the frame was drifting.

---

## v0.7.9 (Build 105) — 2026-06-03

**Mobile overlay positioning (from Daniel's device testing).**

- **Popovers now anchor off their launching tab button.** The source/form menu was fixed to the bottom of CONTEXT, so in landscape it opened far from the (right-edge) tab button that triggered it. It's now `position: fixed`, positioned by `positionMenu()`: it unfurls upward from the button in portrait and to the left of the button (top-aligned) in landscape, clamped on-screen, and re-anchors on rotation. Width is bounded (260px) instead of full-width.
- **Save/export sheet narrowed + centered.** It was full-width and ran under a side Dynamic Island in landscape. Now capped at `max-width: 600px` (≈ half a landscape screen, comfortably wide for the format/resolution rows) and centered via `margin-inline: auto`; still full width in portrait where it's narrower than the cap.

---

## v0.7.8 (Build 104) — 2026-06-03

**Safe-area robustness — honor `env()`, stop pixel-matching (from Daniel's device testing).** Daniel flagged that the Build 102 "nudge the bar down" approach effectively *overrode* the OS-reported safe area (`--m-tab-clear` subtracted from `env(safe-area-inset-bottom)`), which is fragile across hardware and really a native-app concern.

- **Reverted the nudge-down and the device-corner rounding** (`--m-tab-clear`, `--m-tab-corner`, and the `:first-child`/`:last-child` bottom-corner radii — the latter only ever rounded the live-camera state's last child anyway). The tab bar now honors `env(safe-area-inset-bottom)` verbatim, which also fixes the "icons touching the screen edge" symptom (the nudge had pushed buttons into the rounded-corner zone).
- **Tab bar now respects side insets too** (`max(8px, env(safe-area-inset-left/right))` in portrait; `max(8px, env(safe-area-inset-right))` for the landscape right edge — no arbitrary buffer added, so an island on the LEFT gives a minimal right gap automatically).
- **Flip (front/rear camera) button collision fixed.** It was at `top: 8px` and collided with the status bar / Dynamic Island in the installed PWA. Now offset by `env(safe-area-inset-top)` (and `inset-right` for landscape side-islands).

---

## v0.7.7 (Build 103) — 2026-06-03

**Mobile landscape layout — core (first pass; on-device validation pending).** The mobile chrome now reflows for landscape instead of staying portrait-only.

- **In-place relayout, no reload.** `#m-root` flips between a column (portrait) and a row (landscape) via `@media (orientation)`; `layout()` and the divider drag became orientation-aware (drive/measure the OUTPUT's width in landscape, height in portrait; divider uses clientX vs clientY). Rotation triggers `resize` + a `matchMedia('(orientation: landscape)')` change, both re-running `layout()` — **the chrome is never torn down, so a live camera feed keeps running across rotation** (boot.js already stays on the mobile chrome in both orientations via the short-side test, so it doesn't reload either).
- **Left→right order:** OUTPUT | vertical divider grip | CONTEXT (source/settings) | vertical tab bar on the right. The DOM order already matched, so only the flex axis flips. Divider grip rotates to vertical (`col-resize`); tab bar stacks down the right edge.
- **Dynamic Island / notch handled by safe-area insets.** `env(safe-area-inset-right)` is non-zero only when the island rotates onto the right edge (clockwise rotation), so the tab bar pads itself off that edge **then and only then** (plus an 8px buffer so it's never tucked under the OS chrome); counter-clockwise (island on the left) leaves the tab bar flush. Home indicator (bottom in landscape) cleared via `inset-bottom`.
- **Known follow-ups (IxD, on-device):** vertical tab-bar button sizing/feel, the source/form popover still anchors to the bottom of CONTEXT rather than near the tab bar, and full-bleed corner-hugging. Captured in BACKLOG.

---

## v0.7.6 (Build 102) — 2026-06-03

**PWA tab-bar bottom anchoring — first pass (on-device tuning to follow).** The installed-standalone tab bar floated well above the screen bottom because it reserved the full conservative home-indicator inset (`6px + safe-area-inset-bottom`) below the buttons.

- The bottom padding now trims the inset by `--m-tab-clear` (default 14px), clamped to a 6px floor, so the bar sits closer to the true bottom edge while the glyphs still clear the home-indicator pill.
- The edge buttons round their bottom-outer corner by `--m-tab-corner` (default 20px) to nod to the phone's screen corner radius.
- Both values are `:root` CSS vars for quick iteration. **Open IxD question for on-device review:** whether to go full-bleed (drop the 8px side padding) so the corner rounding truly hugs the device corners. Entangled with the carved-out landscape build (the bar moves to the right edge there).

---

## v0.7.5 (Build 101) — 2026-06-03

**Polish fixes from Build 100 testing (Daniel).**

- **Desktop canvas type ramp unified.** The four settings under "canvas" (composition zoom, rotation, out of bounds, frame) were on three different type rungs — two 12px slider labels, OOB on the dim 10px `.setting-label`, and frame still an 11px `<h2>` sub-header — so OOB and frame read as subordinate rather than as siblings. OOB and frame are now `.field` blocks with a shared 12px/#888 `.field-label`, matching the slider labels, so all four read as peer settings under the one "canvas" header.
- **Mobile popover float fixed (PWA).** The source/form popover floated well above the tab bar in standalone — its `bottom` offset hard-coded `--m-tabbar + safe-area-inset + 8px` while being positioned against the viewport, double-counting the bar. It's now mounted inside `#m-context` (whose bottom edge is the tab bar's top) with a plain `bottom: 8px`, so it anchors just above the bar regardless of bar height or the home-indicator inset.

---

## v0.7.4 (Build 100) — 2026-06-03

**UI/UX polish pass — OOB default + settings coherence.** First of a small batch of presentation/coherence refinements (the bigger landscape build is carved out separately).

- **Default out-of-bounds is now mirror** (was clamp). Mirror is the generally-preferred OOB mode, so it's the default instead of an extra step every session. Desktop's active-button markup moved to match (desktop has no init-sync from state).
- **Out-of-bounds is now a canvas control** on both chromes — its dedicated header is gone; on desktop it sits under the "canvas" group as a labeled control (`.setting-label`) beside composition zoom / rotation.
- **Mobile settings regrouped to match desktop.** The list now reads **slice** (segments, scale, rotation, aspect/thickness, spiral, mirrors) → **reset slice** → **canvas** (composition zoom, rotation, out of bounds), with "slice" / "canvas" section headings (replacing the single generic "settings" header). Grouping is driven by each param's existing `scope` field, so canvas controls no longer interleave mid-slice (e.g. Droste's comp-zoom/rotation no longer sat above spiral).

---

## v0.7.3 (Build 99) — 2026-06-03

**Aspect control in the footer + filmstrip perf fix (from Daniel's 0.7.x testing).**

- **Frame aspect control added to the motion footer** (1:1 / 4:5 / 16:9), next to duration where it's reachable while animating, synced with the canvas-group "frame" control — both drive `session.frameAspect`. (Build 98 only had it in the canvas group, which was easy to miss.)
- **Filmstrip no longer blocks the main thread.** The rebuild renders frames OFFSCREEN at a small size (`engine.exportFrame`, ≤240px) with yields between them and a cancel token, instead of N full synchronous renders to the large non-square preview canvas. This fixes the multi-second lag after adding a keyframe (high-priority, affected every session) and no longer disturbs the live preview.

---

## v0.7.2 (Build 98) — 2026-06-03

**Global output aspect — WYSIWYG framing.** Aspect ratio (1:1 / 4:5 / 16:9) is now a global **frame** setting (in the canvas group), not an export-time crop. The preview canvas reshapes to the chosen frame, so what you edit is exactly what exports — no more pattern appearing outside the square preview.

- `session.frameAspect` (w/h) drives the non-square preview (`resizePreviewCanvas`), the engine render (`u_outputAspect`, via the canvas dimensions), and is inherited by **both** still export (`exportAt` now renders the chosen size tier as the LONG side at the frame aspect) and video export (the sheet's own aspect selector is gone; it reads the global frame).
- Timeline thumbnails, the filmstrip, and the swap mini stay square via a center-crop of the preview — they show the *look*, not the frame, so they don't distort and don't need re-capture when the aspect changes.
- Note: still-export size tiers (1K…max) are now the long side; a non-square export's short side scales from the aspect.

---

## v0.7.1 (Build 97) — 2026-06-03

**Timeline duplicate-keyframe fix + video resolutions.**

- **Duplicate keyframe / pause fixed.** The auto-select-on-add (Build 89) made the just-added keyframe the live edit target, so the *next* + keyframe copied it — leaving a trailing duplicate (a static pause). New model: **+ keyframe saves the current look and jumps forward; editing then stages the next pose**; click a marker to refine an existing keyframe (write-through). Plus a guard that skips adding a keyframe identical to the one already under the scrubber. Anchor/delete now also act on the keyframe under the scrubber, not only an explicitly clicked one.
- **Video resolutions** are now long-side based and cover **1080p / 2.5K / 3K / 4K / 6K**, clamped to the device's FBO max (6K renders fully only on a high-cap desktop GPU; an iPad clamps down).
- **Bitrate** raised to ~0.1 bits/pixel/frame (4–80 Mbps) — a high-quality H.264 target for this detailed content.

---

## v0.7.0 (Build 96) — 2026-06-03

**Video export (Phase 4) — desktop/iPad. Milestone.** Render the still-animation loop to an H.264 `.mp4`, frame by frame, via WebCodecs `VideoEncoder` → **mp4-muxer** (the one new dependency, Daniel-approved). Frame-perfect and faster than real time.

- **Non-square engine rendering (new):** a `u_outputAspect` uniform scales the longer axis in the shader so a non-square framebuffer is an undistorted CROP, not a stretch. `renderToFBO` now takes `w × h` (square still-export unchanged, `h` defaults to `w`), and `engine.exportFrame(state, w, h, ctx2d)` renders one frame into a 2D canvas for `VideoFrame`.
- **UI:** a **render ▸** button in the motion footer opens a sheet with aspect (1:1 / 4:5 / 16:9), resolution (1080p / 1440p / 4K, clamped to the GPU FBO max and rounded even), and frame rate (24/30/60), a live `W×H · frames · duration` readout, and a progress bar. Output downloads as `<source>.mp4`. Frames sample the same `sampleAt` as playback, so easing and the loop-close are honored.
- **WebCodecs required** (Chrome, Safari 16+ / iPadOS 16+); a clear message shows otherwise.
- **Untested by Claude** (no browser / WebCodecs in this environment) — needs Daniel's in-browser pass. Watch: that the .mp4 plays + loops, that 4:5 / 16:9 crops look right (undistorted), and that 4K respects the FBO cap.

Follow-ups: MediaRecorder fallback for non-WebCodecs browsers, 3K/6K tiers (memory/codec permitting), aspect crops for still export (the engine now supports it), loading a video file as the source (the other half of Phase 4).

---

## v0.6.5 (Build 95) — 2026-06-03

**Filmstrip refinements (from Daniel's Build 94 test).**

- **Performance:** the filmstrip rebuild debounce went from 120ms to 700ms, so it only fires after a real pause in editing instead of hitching mid-wedge-manipulation (the N synchronous renders were retriggering on brief pauses).
- **Visual redesign (to Daniel's mockup):** filmstrip frames are now the same size as the keyframe thumbnails (inset to match) and tiled at that fixed size, so the keyframe markers sit on top and the strip slides under them. The strip is dimmed (0.55) so it recedes. Keyframe outlines are now a thick 3px white; the active/selected keyframe is yellow (outline + notch) to stand apart. Anchored notch filled, auto notch hollow, as before.

---

## v0.6.4 (Build 94) — 2026-06-03

**Tween filmstrip.** A continuous strip of interpolated thumbnails now renders behind the keyframe markers (non-interactive, no outlines), like a video editor's filmstrip, so the progression between keyframes is visible across the track. It samples the animation at even intervals (`sampleAt`) across the track width and renders each to one strip canvas, rebuilt debounced after edits / adds / retimes / anchor toggles / easing changes / resize. The N renders run synchronously to the preview canvas in a single JS turn (no intermediate compositing → no flicker), then the current frame is restored. Skipped during playback and below two keyframes. The bordered, notched keyframe markers sit on top; the filmstrip is the outline-free background.

Next: video export.

---

## v0.6.3 (Build 93) — 2026-06-03

**Anchor / auto-space keyframe model + affordances hidden on playback.**

- **Keyframe spacing is now anchor-based** (replaces the one-way `retimed` flag). A keyframe is either *anchored* (hand-positioned, fixed time) or *auto* (even-spaced). New keyframes are auto, so sequential adds stay evenly spaced; dragging a keyframe makes it an anchor and the autos re-space evenly around it. An **anchor** toggle (next to delete) flips the selected keyframe between fixed and auto at any time, so a manually-placed frame can rejoin auto-spacing later. Keyframe 0 is always the start anchor. On the track, auto keyframes show a hollow notch, anchored ones a filled notch.
- **Touch affordance arrows hide during playback/scrub.** The rotate/scale arrows on the source overlay (touch surfaces) are suppressed while the animation runs, via a `hideAffordances` predicate threaded into the shared overlay (default off, so normal editing is unchanged).

Next: tween filmstrip behind the keyframes.

---

## v0.6.2 (Build 92) — 2026-06-03

**Motion-mode refinements (from Daniel's Build 89 feedback).**

- **Discrete params stay editable until the first keyframe.** Gating (hidden form picker, dimmed segments/mirror/OOB) now activates only once a keyframe exists, not the instant you enter motion mode — so you can pick the form/segments for your starting look first. Keys off `keyframes.length >= 1`.
- **Direct-manipulation discrete edits are locked too.** The segment-spoke drag and droste-arms drag on the source overlay were bypassing the slider gating; a `canEditDiscrete` predicate threaded into the shared overlay now blocks them once motion mode has a keyframe (the spoke falls through to a scale drag; arms-drag is a no-op). Default-true, so desktop/mobile normal use is unchanged.
- **The source wedge animates during playback and scrubbing.** Playback/scrub now mutate the working state to the sampled frame, so the overlay wedge moves in sync with the output instead of sitting at a stale position. Sliders still only resync on pause/scrub-end (no 60fps thrash); no history is pushed (it's navigation).

Next: tween filmstrip and video export (Daniel: the two that make this genuinely usable).

---

## v0.6.1 (Build 91) — 2026-06-03

**Global easing control (motion smoothing, v1).** A new "easing" field in the timeline controls (0–100%) blends each tween span between linear (0 = constant velocity, kills the pulse at short durations) and ease-in-out (100% = eased into each keyframe, the prior behavior and the default). Pre-blended in `spanSample` and passed to `lerpState` as linear so it isn't eased twice. The control previews live while paused. This is the first version of motion smoothing; the richer **smooth-through spline** (Catmull-Rom for continuous velocity through keyframes, no stops) and per-keyframe ease handles are the queued refinement (deliberately not bundling untested spline math here).

---

## v0.6.0 (Build 90) — 2026-06-03

**Drag-to-retime keyframes (timeline milestone).** Keyframe markers can be dragged horizontally to set their timing. A click still selects; a horizontal drag past the 3px threshold retimes. Keyframe 0 stays locked at t=0 (the start/loop anchor); the rest clamp between their neighbors so a drag can't reorder them, and the last clamps short of t=1 (leaving the loop-return span). The scrubber follows a dragged selected keyframe.

- **Sequential add is now non-destructive once you've retimed.** Before any manual drag, repeated + keyframe re-evens the set (the easy default). After the first drag (a `motion.retimed` flag), inserts go in at the midpoint of the next gap and leave your hand-set times alone. Deleting back to an empty timeline resets to auto-even.

This is the v0.6.0 milestone — the still-animation timeline is now a real editor (add / select / edit / delete / **retime** / play / loop / scrub).

---

## v0.5.15 (Build 89) — 2026-06-03

**Timeline refinements (round 2, from Daniel's Build 88 test).**

- **+ keyframe auto-selects and jumps forward.** Each add now selects the new keyframe and moves the scrubber to it (add-then-edit / duplicate-and-modify). Insert-after still means it never overwrites the keyframe you were on.
- **Loop bookend shows its thumbnail.** The return-to-kf0 marker at the track end now renders keyframe 0's thumbnail (left edge visible), not just a notch. (kf0's thumbnail canvas is copied into a fresh canvas since a canvas node can't be in two places.)
- **Default duration is 30s** (was 4s — far too fast for a still loop).
- **Scrubber and notch align.** The scrubber line is centered on its time (matching the centered notch), and the playhead snaps onto a keyframe when scrubbing lands on one.
- **Select guard for cross-form keyframes.** If a keyframe was captured under a different form (exit motion → change form → re-enter → add), selecting it no longer renders broken: discrete fields are forced to keyframe 0 on select, matching what playback already does. Elegant cross-form transition handling is backlogged.

Still deferred: motion smoothing (proper easing model), drag-to-retime.

---

## v0.5.14 (Build 88) — 2026-06-02

**Timeline refinements (from Daniel's Build 87 test).**

- **+ keyframe never overwrites.** Clicking + keyframe while parked on an existing keyframe now inserts a new one *after* it and re-distributes the set to even spacing, so repeated clicks build an evenly-spaced sequence. Parked off a keyframe still drops at the scrubber (explicit). (Even-redistribution on sequential add is destructive of manually-set spacing until drag-to-retime ships — fine for now since there's no manual retime yet.)
- **Sequential authoring fixed.** After any add, nothing stays selected, so the next edit stages a fresh look (edit → + keyframe → edit → + keyframe…). Clicking a marker is what enters write-through edit on an existing keyframe. This also resolves the report that **editing after exiting motion mode could write through to a stale-selected keyframe** (selection is now cleared on the mode toggle).
- **Monochrome + centered notches.** Dropped the sketch's magenta/purple (sketch was layout intent only). Keyframe notches are centered over their thumbnails and share the thumbnail outline color (grey, white when selected); the scrubber line is white. The first/last thumbnails clip at the track edges by design (they're two halves of the loop).
- **Settings gating.** In motion mode the form picker is hidden and the non-animatable controls (segments, mirror, wedge-mirror, out-of-bounds) are dimmed and disabled, since discrete fields are pinned to keyframe 0.

Deferred (with a clear reason): a **motion-smoothing** control + per-keyframe ease — the easing model deserves a proper design (likely spline-based, not a mislabeled linear↔ease blend) rather than a rushed version. Tracked in BACKLOG.

---

## v0.5.13 (Build 87) — 2026-06-02

**Multi-keyframe timeline — core (desktop/iPad).** The A/B motion mode generalizes to an N-keyframe timeline (built to Daniel's mockup). `motion` now holds a sorted `keyframes` list (each `{ t: 0..1, snap, thumb }`) plus total `durationMs`, `loop`, `playhead`, and `selected`. The footer is the timeline: global controls (prev/play-pause/next, loop, + keyframe, + gesture [reserved/disabled], delete, total duration) on the left, and a track on the right with **keyframe markers that render the saved-state thumbnail** under a magenta pin, a yellow scrubber, and a faint loop-bookend marker at t=1.

- **Sampling:** interpolates between adjacent keyframes via `lerpState`; **discrete fields are locked to keyframe 0** for the whole animation (so changing form/segments mid-edit can't introduce a hard cut). Loop on closes the cycle by tweening the last keyframe back to kf0.
- **Edit model (explicit):** select a keyframe (click its marker / land the scrubber on it) and edits write through to it live; edit off a keyframe and it's a staged preview that only commits via "+ keyframe" (drops at the scrubber). Scrubbing or playing away reloads the working state from the timeline, discarding the stage (undo still applies). First keyframe anchors at t=0.
- **Thumbnails:** captured by copying the preview canvas (same trick as the swap mini-canvas), refreshed live while editing a selected keyframe.
- The form picker is hidden in motion mode (discrete is pinned to kf0).

**Deferred to fast-follows:** drag-to-retime markers, pinch-zoom/pan + scale-to-fit on the track, the previous/next PiP output monitors, per-segment rotation winding, gesture-record, and fuller settings gating. **Untested by Claude (no device/headless browser) — needs Daniel's in-browser pass.**

---

## v0.5.12 (Build 86) — 2026-06-02

**Output toolbar (desktop/iPad).** A new top toolbar on the output area homes the view/workspace controls that aren't parameters: **undo/redo** (relocated from the floating bottom bar so it won't compete with the coming animation timeline), **swap** (moved from its floating top-right spot), and the **motion-mode** toggle (moved out of the canvas settings group, where it never belonged). The toolbar container is click-through; only the left/right button groups capture events, so the gap between them still passes gestures to the canvas. This is the start of a broader move (backlog) to pull non-settings out of the panel (source display, change-source, export, build info) into this toolbar. Mobile chrome unaffected. Also: captured Daniel's multi-keyframe timeline design direction in BACKLOG (Procreate-Dreams/iMovie north star, control areas, loop-bookend model, per-segment rotation winding, output PiP comparison, JSON project file) and the revised sequence (timeline → video export → video loops → gesture-record → transitions).

---

## v0.5.11 (Build 85) — 2026-06-02

**Flip icon, take two.** The Build 84 redraw used two full semicircles that met exactly at the arrowheads (3 and 9 o'clock), leaving no gap. Each arc is now pulled back ~20° from the opposite cardinal so the down/up arrowheads have breathing room — reads as two arrows chasing around a ring.

---

## v0.5.10 (Build 84) — 2026-06-02

**Mobile chrome fixes (from Daniel's Build 81 device testing).**

- **Touch-rotate runaway fixed (suspected).** On iPhone, rotating the wedge by touch spun it ~3× the finger's travel (a 90° drag → ~900°). Root cause analysis: the rotate gesture is the only *accumulative* one (it sums angle deltas via `prevAngle`), and it read the orbit center from the live overlay geometry every move; when the source panel reflows mid-drag (iPhone Safari hiding its address bar — doesn't happen on desktop/iPad), the drifting center corrupts the accumulated delta. Fix: snapshot the rotation center (`cx0/cy0`) at drag start and orbit that fixed point. Behavior-identical on desktop/iPad (center is stable there). **Couldn't reproduce remotely (no device/headless browser) — needs Daniel's on-device confirmation.**
- **Reverse-camera (flip) icon redrawn.** The old glyph had broken arrowheads; replaced with two half-circle arcs and vertical arrowheads (3-o'clock down, 9-o'clock up), matching the iOS camera-flip style.
- **Tab popover toggle.** Tapping an already-open tab (source/form) now closes its menu instead of flickering it closed-and-reopen.

---

## v0.5.9 (Build 83) — 2026-06-02

**Motion mode (A/B still-animation) — desktop + iPad.** First user-facing animation feature. A "motion mode" toggle (in the canvas group) reveals a contextual transport footer beneath the work area: **set A / set B** capture the current look as keyframe snapshots (`{...state}`), **A / B** jump back to a captured look to tweak and re-capture, **play/pause** animates A↔B via `lerpState` (Build 82) over a continuous rAF loop, a **loop** toggle closes the cycle seamlessly (triangle A→B→A with `easeInOut`, so no velocity snap at the ends), a **duration** scrub field (0.25–30s), and a **scrubber track** to preview any point in the span.

- **Playback is transient.** Frames render interpolated snapshots straight through the stateless `engine.render` — the working `state`, the sliders, and undo are never touched. Exiting motion mode (or changing a control) repaints the working state.
- **Discrete fields locked.** Only continuous fields animate; `form`/`segments`/`drosteArms`/`oobMode`/mirrors hold across the loop (per the settled decision).
- **Gating.** Motion mode requires a loaded still source and is mutually exclusive with the live camera (starting the camera force-exits it).
- **Layout.** `<body>` is now a column: the existing main/divider/panel split is wrapped in a `.work-row`; the footer sits beneath it and, when hidden, the layout is identical to before. Mobile chrome unaffected (it replaces `document.body`).

Next: generalize A/B to a multi-keyframe timeline (Build 3, collaborative IxD), then video export (Build 4).

---

## v0.5.8 (Build 82) — 2026-06-02

**Tween/easing kit (`src/kit/tween.js`) — animation infra, no UI yet.** First piece of the Phase 3 animation track. A pure Kit-layer module that interpolates two state snapshots (a keyframe is a `{...state}` snapshot, the same currency as an undo entry): `lerpState(a, b, t, easing)` plus `linear`/`easeIn`/`easeOut`/`easeInOut` (default) easing. The module owns the canonical field classification — **continuous** fields are interpolated (`sliceScale`, `sliceCx/Cy`, `sliceRotation`, `squareAspect`, `drosteZoom`, `drosteSpiral`, `drosteOffsetX/Y`, `canvasZoom`, `canvasRotation`), the two **angular** ones (`sliceRotation`, `canvasRotation`) take the shortest path around 360°, and **discrete** fields (`form`, `segments`, `drosteArms`, `oobMode`, `drosteMirror`, `drosteWedgeMirror`) are held. params.js can't carry this list because the direct-manipulation-only fields and `drosteSpiral` aren't declarative sliders. Nothing imports it yet — invisible build, like the Build 65 registry refactor. Next: motion mode (A/B loop) on the desktop/iPad chrome.

---

## v0.5.7 (Build 81) — 2026-06-02

**Export: gate unsupported resolutions (desktop + mobile).** Resolution tiers larger than the device's actual export ceiling (`engine.diagnostics.maxFBOSize`) are now **disabled** rather than silently clamped/hidden, with a tooltip ("not supported by this hardware (max ~XK)"). On desktop, if the default 4K tier exceeds the cap, the selection re-homes to the largest supported tier. Mobile shows all tiers (1K–8K + max) with the unsupported ones greyed; the lazy 8192 probe on first save-sheet open re-enables 8K where the device supports it.

---

## v0.5.6 (Build 80) — 2026-06-02

**PWA (installable, standalone) + versioning policy.**

- **PWA via vite-plugin-pwa.** Web manifest (name "Fold", standalone display, portrait, dark theme), an auto-updating service worker that precaches the build (offline-capable once loaded), and iOS standalone meta tags (`apple-mobile-web-app-capable` etc.) + an SVG app icon (`public/fold-icon.svg`). Installs to the home screen with no browser chrome. **Needs on-device verification:** (1) standalone hides the Safari UI and the tab bar sits cleanly; (2) **does `getUserMedia` work in an installed iOS standalone PWA** — historically fragile (the in-browser camera is the floor). Note: `base` is relative (`./`); if the service worker misregisters on the deploy, switching `base` to `/` is the fix (the app deploys at the domain root).
- **Versioning policy change.** Per Daniel: the VERSION **patch bumps on every code-shipping build** now (not just milestones), alongside the monotonic BUILD. This catches the version up — builds 74→80 since the v0.5.0 milestone land us at v0.5.6. Codified in CLAUDE.md standing maintenance. (Builds 75–79 below were shipped under the old policy as v0.5.0.)

---

## v0.5.0 (Build 79) — 2026-06-02

**Export polish (desktop + mobile).**

- **Save spinner restored.** The export-button spinner was flashing too briefly to see on fast exports; it now holds a minimum ~300ms so it's perceptible.
- **Resolution hint on mobile.** The save sheet now shows "sharp output up to ~XK at current settings" (under the size tiers), matching desktop.
- **Firefox notice repositioned (desktop).** Moved under the resolution hint (above the save buttons) instead of awkwardly between the two save buttons, and dropped its stray top border/rule.

---

## v0.5.0 (Build 78) — 2026-06-02

**Mobile: portrait source fill (+ fit toggle) and lazy higher-res export probe.**

- **Source fill / fit toggle.** The shared overlay's display fit is now parameterized — `contain` (letterbox, default on desktop) vs `cover` (fill the panel + crop). Mobile defaults to **cover** so portrait sources no longer leave side gutters. A fill↔fit toggle sits top-right of the source panel (mirroring the settings toggle top-left). `drawSourceOverlay` geometry + `mountSourceView` CSS (object-fit / background-size) both honor `env.fit`, and `createSourceOverlay` gains a `fit` option + `setFit()`. Desktop unchanged (defaults to `contain`).
- **Lazy export-max probe.** New `engine.probeExportMax(cap)` re-runs the FBO probe with a higher cap and updates `diagnostics.maxFBOSize`. The mobile save sheet calls it once on first open (cap 8192) so capable phones (e.g. iPhone 14/17 Pro) can pick a >4096 export tier; weaker devices fall back to 4096. Init still caps low to avoid the load-time memory crash. Size tiers + the diagnostics readout rebuild from the probed value.

---

## v0.5.0 (Build 77) — 2026-06-02

**Mobile save sheet.** The EXPORT tab now opens a slide-up sheet (replaces the basic direct download): collapsible **show/hide diagnostics** on top (renderer, max texture, max export, DPR), then **format** (JPG/PNG), **size** tiers (up to the device's probed FBO max), a status line, then **save package (.zip)** and the primary **save composition** at the bottom (thumb reach). Package bundles the composition + the unmodified original (uploaded file or captured frame), reusing `engine.exportAt` + `shell/zip.js`. *Deferred to todo: the lazy higher-cap max-res probe (to offer >4096 on capable phones without the init crash) — sizes are currently capped at the init FBO probe (4096 on mobile).*

---

## v0.5.0 (Build 76) — 2026-06-02

**Mobile parity: stateful settings controls + capture-icon polish + nits.**

- **Stateful SETTINGS controls added** (no longer desktop-only): segments (form-routed — radial `segments` / droste `drosteArms`, with the shared snap), droste **spiral**, and **tier mirror** / **wedge mirror** toggles. Form-aware visibility (segments for radial+droste; spiral/mirrors for droste; wedge mirror hidden at arms=1). Behavior/snap shared with desktop via `kit/snaps.js`; only the touch DOM is new. Mobile settings now matches desktop's control set.
- **Capture iconography (per Daniel):** the aperture placeholder is replaced with the Material camera glyph for *capture*; *go live* uses a **red** record dot (actionable, not informational); and freezing a live frame **keeps the SOURCE icon as live** (record) — the mental model is "paused live capture," not a new still.
- **Nits:** placeholder reads "tap + to begin" with proper spacing; `startCamera` logs the actual granted camera resolution to the console (to check 4K vs 1080p per device).

---

## v0.5.0 (Build 75) — 2026-06-02

**Mobile tab bar (icons + popovers), export rename, export-return fix.**

- **Icon tab bar + popovers** ([src/mobile/icons.js](src/mobile/icons.js) + chrome). Tabs are icon-only and reflect the current selection. **SOURCE** opens a single-select menu — *live camera* (red record dot), *take still* (native full-res via a `capture="environment"` file input), *choose photo / file* — and the tab icon updates to match the active source (plus / record / camera / folder). **FORM** opens a popover listing each form's thumbnail + name, current indicated; the tab shows the active form's icon. **CAPTURE** shows an aperture (capture) ↔ red record (go live). Null state: "tap + to begin" and tapping the empty output opens the source menu. Settings/direct-manip toggle now uses sliders/target icons. (Icons are functional placeholders — polish is backlogged.)
- **Export → Save.** Renamed "export composition/package" to **"save composition" / "save package (.zip)"** on desktop, reordered so the primary "save composition" sits at the bottom (thumb reach), and the desktop status now says "saved". (Mobile export is still a basic direct download — the full slide-up save sheet with size/format/diagnostics + lazy max-res probe is the next pass.)
- **Export-return dark output fixed.** Returning to the mobile app after viewing an exported image left the output dark (backgrounded rAF didn't resume). A `visibilitychange`/`pageshow` handler now resumes the live loop / re-renders.

---

## v0.5.0 (Build 74) — 2026-06-02

**Version milestone: second front-end + live camera.** Marks the mobile chrome reaching a real, usable state — phone-class viewports get a touch-first chrome mounting the same shared components as desktop, with live camera, capture/go-live, and direct manipulation. Still alpha (remaining parity items in BACKLOG), but a meaningful surface-area jump from the desktop-only still tool. No code change beyond the version + new backlog items.

---

## v0.4.1 (Build 73) — 2026-06-01

**Mobile live camera + responsive chrome switching.**

- **Live camera on mobile.** The SOURCE tab now opens a popover (live camera / upload photo). "Live camera" wires the shared `createCamera` host module into the mobile chrome: a continuous render loop feeds the kaleidoscope live, the wedge overlays the feed (direct-manipulable), a contextual **capture / go-live** toggle appears in the tab bar (capture freezes the frame as the editable still; "go live" resumes), and a **flip** button (front/rear) overlays the output. Front camera is mirrored to match the preview (reuses the Build 67 mirror path). Rear default on phones. Reuses `createSourceOverlay`/`createOutputGestures` unchanged. *Note: live-camera preview perf on a phone is subject to the same full-res texture-upload cost noted for iPad (BACKLOG) — the camera-resolution optimization will help here too.*
- **Responsive chrome switching.** `boot.js` now reloads into the other chrome when the viewport crosses the breakpoint (so narrowing a desktop window switches to mobile, and vice versa). Slice/canvas params are carried across the switch via sessionStorage (one-shot — normal refresh still resets); the loaded image is not carried. A true in-place swap was avoided (the desktop chrome has no teardown path); a debounced reload is simple and robust.

---

## v0.4.1 (Build 72) — 2026-06-01

**More mobile fixes + responsive desktop breakpoint.**

- **iPhone refresh crash — probable root cause fixed.** The FBO-size probe (`probeMaxFBOSize`, `gl.js`) allocated 16384²/8192² textures *and* 2D canvases on every init (~1GB/256MB) — fine on iPad, an OOM-crash vector on an iPhone (especially on reload before the prior context frees). `createEngine`/`createGLContext` now accept `maxProbeSize`; the mobile chrome passes `4096`, so the phone never attempts the huge allocations. Desktop is uncapped (unchanged). *Needs Daniel's re-test — this is the suspected fix for "a problem repeatedly occurred."*
- **Portrait source affordances no longer clip at a square.** `drawSourceOverlay` only resized its canvas on *width* change; on mobile the width is fixed and only the height varies (divider drag / portrait sources), so the canvas height froze at its first value and the overlay covered only a square. Now resizes on width *or* height change (behavior-preserving on desktop, where both change together).
- **Responsive chrome selection.** `boot.js` now picks the mobile chrome when the window is `< 700px` wide (covers narrowed desktop windows) or a coarse-pointer device's short side is `< 600px` (covers phones in landscape); iPad (≥ 768) stays desktop. Evaluated at load — crossing the breakpoint needs a reload.
- **Build/version readout on mobile** under the SETTINGS reset button (no footer on the mobile chrome).

---

## v0.4.1 (Build 71) — 2026-06-01

**Mobile chrome fixes from first phone testing.**

- **Width bug fixed (the big one).** The mobile chrome rendered in a narrow ~half-width column because desktop's `styles.css` (`body { display: flex }`) was still applied — the `id`-based removal in `chrome.js` silently failed since Vite strips the `id` during build. Now removed reliably in `boot.js` (the desktop `<link>` is the only stylesheet present at boot, removed by element before the mobile CSS loads). Likely also resolves the oversized-canvas memory pressure.
- **Source-panel ↔ tab-bar bleed fixed.** `#m-context` now clips (`overflow: hidden`) so overflowing wedge affordances / the gear can't paint onto the tab bar when the panel is shrunk to dock; `#m-tabbar` gets `position: relative; z-index: 10` to stay on top.
- **Out-of-bounds control added to mobile SETTINGS** (clamp / mirror / transparent) — was an unwanted omission per Daniel.
- **WebGL context released on `pagehide`** — defensive against the intermittent "a problem repeatedly occurred" Safari crash on reload (piled-up GPU contexts).

---

## v0.4.1 (Build 70) — 2026-06-01

**Mobile chrome — first increment (still-editor core; alpha, behind a mode gate).**

The second front-end lands, mounting the SAME shared components as desktop (the thesis: not a duplicate UI). Desktop is unchanged — it now loads through a tiny boot selector. Phone-class viewports (or `?chrome=mobile`) get the mobile chrome; iPad/desktop stay on the desktop chrome.

- **`src/boot.js` (new).** Chrome selection: `Math.min(innerWidth, innerHeight) < 600 && (pointer: coarse)` → mobile, else desktop; `?chrome=mobile|desktop` override. `index.html` now loads `boot.js` (was `main.js`); on desktop boot imports `main.js` unchanged. Vite code-splits desktop vs mobile vs shared.
- **`src/components/param-control.js` (new, Step D).** `mountRangeControl(container, paramEntry, env)` builds a control's DOM from a registry entry and wires it via the shared `wireSliderWithScrub` (same scrub/snap/sync behavior). Mobile-facing; desktop migrates to it later.
- **`src/mobile/chrome.js` + `styles.css` (new).** Two stacked regions (OUTPUT top, CONTEXT bottom) split by a fat **sticky draggable divider** with a soft center detent (collapses either region, stays where left). CONTEXT flips between **SOURCE** (mounts `createSourceOverlay` — full wedge direct-manipulation) and **SETTINGS** (registry-rendered sliders + reset) via a corner button. OUTPUT mounts `createOutputGestures` (pinch=zoom, twist=rotation). Bottom tab bar (minimal this increment: upload / form-cycle / export). Form-aware control visibility from the registry.
- **Deferred to the next increment:** camera wiring (source-picker/capture toggle), SOURCE/FORM popovers, the EXPORT sheet (+ package zip), stateful settings controls (segments/spiral/toggles), PWA. Mobile undo/redo remains out of scope.
- Desktop loads via boot now — quick re-confirm desktop still comes up normally (behavior unchanged; one extra module hop).

---

## v0.4.1 (Build 69) — 2026-06-01

**Components-layer extraction (no user-visible change — refactor toward the mobile chrome).**

First, behavior-preserving pass of the Phase 1+2 plan: the source-overlay and output-gesture machinery become standalone components mounted via a clean lifecycle, so the mobile chrome can mount the *same* code instead of reimplementing the expensive proportionality/mirroring/hit-test math. Desktop now consumes the components; the implementation bodies are unchanged, so desktop + iPad should behave identically.

- **`src/kit/snaps.js` (new).** Droste arms/spiral snap math (`armsSnapStep`/`snapSpiralValue`/`applyArmsSnap`) moved out of `main.js` into the Kit layer as pure functions of `state`. `main.js` keeps thin wrappers so call sites + `env` exports are unchanged.
- **`src/components/source-overlay.js` (new).** `createSourceOverlay(ctx) → { mount, render, scheduleDraw, destroy }` wraps the unchanged `mountSourceView`/`drawSourceOverlay`/`setupSourceInteraction` from `overlay.js` behind a private `view`, owning the overlay canvas + hover/drag state (off the shared `env`). Desktop `main.js` consumes it (replaced all `mountSourceView`/`drawSourceOverlay(env)` call sites).
- **`src/components/output-gestures.js` (new).** `createOutputGestures(canvas, ctx)` — the output pinch=`canvasZoom`/twist=`canvasRotation` handler, extracted verbatim from `setupPreviewGestures`. Desktop consumes it.
- **`overlay.js` bodies are untouched** — only the desktop *wiring* changed. Acceptance: byte-identical to Build 68, including iPad live camera.

---

## v0.4.1 (Build 68) — 2026-06-01

**Export model rework + overlay affordance refinements (pre-mobile cleanup).**

- **Two export buttons, no more multi-file downloads.** "Export composition" saves only the kaleidoscope (one file). "Export package (.zip)" bundles the composition + the unmodified original into a single `.zip`. This replaces the Build 67 "first export also saves the original" two-download behavior, which Safari (iPad + desktop) silently collapsed to one file. A zip is one download, so it works everywhere — and it's the seam for future package layers (overlay thumbnail, transparent geometry map; see BACKLOG). New dependency-free [src/shell/zip.js](src/shell/zip.js) (store-only ZIP, validated against `unzip -t`). The original is the uploaded file for uploads, the raw frame for camera captures; tracked in `originalSource`.
- **Square form: one affordance cluster instead of eight.** Was drawing scale arrows on all 4 edges + all 4 corners (Build 64 orientation-independence). Now draws a scale arrow on the top edge (height), the right edge (width), the top-right corner (diagonal), and the rotation arc just beyond the right edge — chosen screen-relative so they stay put under rotation. Hit-testing still accepts all edges/corners; only the drawn handles changed. [src/shell/overlay.js](src/shell/overlay.js).
- **Rhombus (triangle) scale targets trimmed.** The shared scale band ate ~16-28px of the interior, leaving small rhombi with no move zone. The rhombus now uses a dedicated thin interior band (4px) + modest exterior band (16px) via a signed per-edge perpendicular, and is self-contained (doesn't fall through to the radial scale band). Most of the interior is now a move target. New `RHOMBUS_SCALE_*` constants in [src/shell/overlay.js](src/shell/overlay.js).

---

## v0.4.0 (Build 67) — 2026-06-01

**Live-camera fixes from first iPad testing.**

- **Version string fix.** Build 66 bumped BUILD but left `VERSION` at v0.3.1; the footer read "v0.3.1 · Build 66". Now correctly v0.4.0.
- **Front-camera sampling fixed (was sampling the mirror-opposite side).** The preview was mirrored (CSS) but the texture wasn't, so the wedge sampled the opposite side from what the user saw. The front camera now feeds the engine a horizontally-flipped frame (offscreen canvas, `camera.frameSource()`/`refreshFrame()` in [src/shell/camera.js](src/shell/camera.js)); mirrored preview + mirrored texture share an orientation, so the overlay samples what's under it. [src/engine/index.js](src/engine/index.js) `sourceDims()` now also accepts a `<canvas>` source.
- **Captured thumbnail no longer disappears.** Build 66 revoked the capture's blob URL while the source view still painted it via background-image (dark gap). The URL is now kept alive for the source's lifetime, and the source view picks the live `<video>` vs still via an explicit `env.liveVideo` handle ([src/shell/overlay.js](src/shell/overlay.js)).
- **Capture no longer auto-saves.** Shutter now just freezes the frame as the editable still and stops the camera. The unmodified original (raw frame) is saved *with* the kaleidoscope on the FIRST export; later exports of the same source save only the kaleidoscope. Uploads have no pending original (the file is already on disk).
- **Export spinner restored.** A single rAF ran its callback before paint, so the spinner never showed before the synchronous FBO export blocked the thread. Now a double rAF guarantees the spinner + status paint first.
- **Desktop defaults to the front camera (mirrored).** Touch devices (iPad) still default to the rear camera; desktops have no real rear camera and want the mirrored front by default. Heuristic: `(pointer: coarse)`.
- **Known/out of scope:** Firefox shows a camera picker for multi-camera setups while Safari forces the default — a custom device-enumeration picker would be needed to unify this; deferred.

---

## v0.4.0 (Build 66) — 2026-05-31

**Phase 0.5: live camera as a host capability (desktop/iPad).**

The camera is wired into the existing desktop chrome — not a new shell. A live `<video>` from `getUserMedia` flows through the same engine, source-view, and wedge-overlay machinery as a still image; the only structural addition is a continuous render loop (the still path stays render-on-demand). iPad-via-desktop-chrome is the intended capture surface. Version bumped to v0.4.0 — first new interaction surface beyond the still tool. This also folds in the Phase 0 texture-source spike: the engine now accepts a `<video>` source for real.

- **Engine source generalized for video.** [src/engine/index.js](src/engine/index.js): `setSource()` resolves dimensions from `naturalWidth || videoWidth` so it accepts `<img>` or `<video>`; new `updateSourceFrame()` re-uploads the current video frame into the existing texture each tick; new `getSourceSize()` and `clearSource()`. `suggestResolution()` uses the resolved size. [src/engine/gl.js](src/engine/gl.js): new `updateTexture()` re-specs an existing texture (no per-frame delete/recreate).
- **Camera host module.** New [src/shell/camera.js](src/shell/camera.js): `createCamera()` → `start({facingMode})` / `stop()` / `flip()` over a reused `<video>`. Rear (`environment`) default; front (`user`) preview mirrored via CSS.
- **Continuous render driver + UI.** [src/main.js](src/main.js): `startLiveLoop()`/`stopLiveLoop()`; camera button beside upload, plus live controls (capture / flip / stop). [index.html](index.html) + [src/shell/styles.css](src/shell/styles.css) for the controls. [src/shell/overlay.js](src/shell/overlay.js) `mountSourceView()` mounts the live `<video>` (object-fit: contain) for the camera path, keeping the bg-image div for stills.
- **Capture = freeze + save both, stay editable.** The shutter grabs the frame at native resolution, downloads the raw frame AND the kaleidoscope (at the chosen export size), and freezes the frame as a normal editable still so the existing controls/export take over. Camera stops on capture.
- **Known nuance:** the front-camera *preview* is mirrored but the live texture is not, so for front-facing the kaleidoscope output's handedness is true-camera (invisible on mirror-symmetric forms; flips droste spiral chirality). The captured frame and frozen still ARE mirrored to match the preview. Revisit if it matters in the mobile chrome (Phase 2).
- **Secure-context requirement:** `getUserMedia` needs https or localhost; on a LAN IP without https the camera button surfaces a clear error.

---

## v0.3.1 (Build 65) — 2026-05-31

**Phase 0: parameter registry (Kit foundation, no user-visible change).**

First step of the multi-version architecture work (see `BACKLOG.md` capability tier). Control definitions move from inline literals at the `wireSliderWithScrub()` call sites into a declarative catalog, so a future second chrome (mobile) can render the same controls without re-hand-wiring ranges, steps, and formats.

- **New [src/shell/params.js](src/shell/params.js):** `PARAMS` registry describing every adjustable control — state key, scope (slice/canvas/output), form-control gating, and (for the clean sliders) the exact `wireSliderWithScrub` opts. Two classes: `declarative` sliders wired straight from `opts`, and stateful/form-aware controls (segments form-routing, the arms-aware spiral fmt+snap, the mirror/wedge-mirror/OOB toggles) that keep their bespoke wiring and carry catalog-only metadata.
- **[src/main.js](src/main.js):** the six declarative sliders (`scale`, `compZoom`, `sliceRot`, `aspect`, droste `zoom`/thickness, `canvasRot`) are now wired by looping `DECLARATIVE_PARAM_IDS` through the unchanged `wireSliderWithScrub()`. The fmt/parse closures moved verbatim into the registry. Stateful controls untouched.
- **No behavioral change.** Desktop/iPad should be byte-identical: same ranges, steps, scrub formats, spiral fractions, segments form-routing, toggle visibility, undo/redo, export.

---

## v0.3.1 (Build 64) — 2026-05-31

**Three more Build 57/61 Y-flip residuals fixed.**

1. **Droste rotation direction reversed.** Build 61 inverted the rotate-drag delta to compensate for the Y-flipped polygon overlay, but Droste computes its own positions via cos/sin in screen y-down (no Y-flip baked in like polygon forms have via sliceVecToSourceUV). Result: drag CCW rotated the wedge CW. Fix: negate `seamPhaseRad` in `droste.drawOverlay`. The negation makes Droste interpret sliceRotation the same way polygon forms now do (post-Build 61), so the inverted drag delta is correct for both.

2. **Droste center-offset reversed.** Pre-existing bug surfaced after Build 61. The drag handler stored `drosteOffset` in the wedge's local frame (rotated by sliceRotation), but the GPU interprets `drosteOffset` directly in canvas-NDC fold-space (y-up). Mismatch caused the spiral pole to land at a sliceRotation-dependent mirror of the diamond's screen position. Fix: simplified both the diamond visual and the drag handler to use canvas-NDC y-up directly (no sliceRotation involved). The diamond no longer rotates *with* the wedge — it represents a fixed canvas-NDC position, which is what the user expects ("diamond at upper-right of overlay = spiral pole at upper-right of canvas, regardless of wedge angle").

3. **Affordance placement after Y-flip.**
   - **Rhombus (triangle):** scale arrows now sit on the two NON-apex edges of the wedge instead of the two topmost edges. Daniel's observation: dragging away from the apex grows the shape, so the natural grab point is the far side.
   - **Radial wedge:** spoke double-line drawn on BOTH spoke edges (was: only `spokeEdges[0]`). Pre-Build 61 the marker happened to land on the screen-top spoke; the Y-flip moved it to the opposite side, so showing it on both spokes makes the affordance orientation-independent.
   - **Square:** scale arrows drawn on all 4 edges and all 4 corners (was: top + right edge plus top-right corner). Pre-Build 61 the "top + right" labels matched what the user saw; post-flip those vertex labels shifted by 90°. Drawing on all 4 edges/corners is orientation-independent.

**Systematic check for other reversed controls.** Audited the drag handlers in [src/shell/overlay.js](src/shell/overlay.js):
- `rotate` and `pinch` rotate-component: inverted in Build 61 (correct for polygon, was breaking Droste — fixed in #1 above).
- `square-edge` axis classification: fixed in Build 62.
- `droste-offset`: fixed in #2 above.
- `droste-arms`: uses *magnitude* of cursor-vs-sliceRotation angle, sign-independent. Unaffected.
- `droste-ratio`, `scale`, `segments`, `move`, `square-corner`: use radial distance or screen-coord ratios directly with no sliceRotation in their math. Unaffected.

- **Code:** [src/engine/forms/droste.js](src/engine/forms/droste.js) (`seamPhaseRad` negation + offset diamond simplification), [src/shell/overlay.js](src/shell/overlay.js) (droste-offset drag, triangle non-apex selection, radial both-spokes loop, square all-edges/all-corners), [src/version.js](src/version.js) (Build 64).

---

## v0.3.1 (Build 63) — 2026-05-31

**Triangle (rhombus) apex-incident edges now have full scale-grace zone.** Pre-existing asymmetry (not a Build 57 regression) surfaced after Build 61 brought polygon-overlay into agreement with GPU sampling. The triangle form has slice-center at the apex (V0), so two of its four edges are *apex-incident* — they touch slice-center and define the polygon's angular boundary at ±30°. The per-edge scale-proximity check required `!outsideAngular`, so cursor perpendicular-outside an apex-incident edge would cross the angular boundary, set `outsideAngular=true`, and fall through to rotate. Effect: dragging the upper-left arrow (an apex-incident edge) would rotate unless the user dragged exactly along the edge direction (which kept the cursor angularly inside). The upper-right arrow (non-apex edge, always inside the angular range) worked normally.

Fix: relax the `!outsideAngular` guard. When cursor is angularly outside the polygon, only check apex-incident edges for perpendicular proximity (non-apex edges can't be usefully close from outside the polygon's angular range). Apex-incident edges now have full perpendicular scale-grace on both sides, matching non-apex edges.

- **Code:** [src/shell/overlay.js](src/shell/overlay.js) per-edge proximity block in `classifyPointer`, [src/version.js](src/version.js) (Build 63).

---

## v0.3.1 (Build 62) — 2026-05-31

**Square form: aspect drag was adjusting the wrong axis at non-zero rotations.** Another Build 57 Y-flip fallout — caught now that Build 61 brought the polygon overlay into agreement with GPU sampling. The square edge-drag classifies which axis the dragged edge controls (long vs short side of the rectangle) by computing `normalAngle − rotRad`, where `normalAngle = atan2(ny, nx)` of the edge's outward normal in screen y-down. With the polygon's Y-flip applied to screenPts, the normal's y-component is mirrored from the wedge's local frame, so the axis classification inverted — dragging the long edge inward shrank the short axis (and vice versa). Fix: negate `ny` in the `atan2` call when computing `normalAngle` for axis classification, which compensates for the overlay's Y-flip.

- **Code:** [src/shell/overlay.js](src/shell/overlay.js) `square-edge` dispatch (axis IIFE), [src/version.js](src/version.js) (Build 62).

---

## v0.3.1 (Build 61) — 2026-05-31

**Fallout from the Build 57 Y-flip: overlay was diverging from GPU sampling on radial/hex/square/triangle.** Build 57 added `vec2(v.x, -v.y)` inside the shader's `toSourceUV` to fix Droste's arms=1 upside-down sampling, but missed the explicit JS mirror function `sliceVecToSourceUV` in [src/engine/geometry.js](src/engine/geometry.js) — which the polygon overlay path uses to place the wedge at the correct source-UV position. After Build 57 the GPU was sampling the Y-mirror of where the overlay drew the wedge; invisible on outputs with bilateral mirror symmetry across the horizontal axis (sliceRotation on multiples of π) but visible at any other rotation. Daniel: rotating the radial wedge to "11, 12, 1 area" actually sampled "5, 6, 7" content; hex same issue at vertical rotations.

- **Patched `sliceVecToSourceUV`** to negate `y` after aspect correction. Matches the shader's transform exactly per the doc comment in that file ("MUST match the shader's transform exactly — when this math drifts from the shader's, the overlay stops matching the rendered output").
- **Inverted the rotate-drag and pinch-rotate delta signs.** With the Y-flip applied to the overlay, sliceRotation maps to a Y-mirrored wedge direction relative to before. Without the sign inversion in the drag handlers, dragging the cursor CCW would now rotate the wedge graphic CW (counterintuitive). The pinch handler's apex-orbit math is *not* inverted — it positions slice-center, which is independent of the wedge direction flip.
- **Code:** [src/engine/geometry.js](src/engine/geometry.js), [src/shell/overlay.js](src/shell/overlay.js) (rotate + pinch handlers), [src/version.js](src/version.js) (Build 61).

---

## v0.3.1 (Build 60) — 2026-05-30

**Droste OOB detection fix.** The wedge-OOB check used the wrong source-theta-shift value when probing the twisted-wedge boundary at the inner ring. Under the old log-shear math the variable was the rotation-per-tier in radians; in Build 56 I left a stale approximation `twistRad = spiral · 2π` which, for spiral=6, evaluates to ~37.7 rad (≈6 full revolutions). The inner-ring probes wrapped fully around the source many times over and triggered OOB even when the actual sampling region had room to spare. Daniel observed: "the wedge is highlighted yellow but actually has plenty of room before hitting an edge."

The correct source-theta shift across one tier under generalized Lenstra (`c = 1 + ib`, `b = -spiral·logS/(2π)`) is `−b·logS = spiral·logS²/(2π)`. The OOB probe code does `aArc − twistRad`, so we negate: `twistRad = −spiral·logS²/(2π)`. For spiral=6, zoom=2 this is ≈ −0.46 rad ≈ −26°, matching the actual per-tier source-theta shift the warp produces.

- **Code:** [src/engine/forms/droste.js](src/engine/forms/droste.js) (fix `twistRad` formula), [src/version.js](src/version.js) (Build 60).

---

## v0.3.1 (Build 59) — 2026-05-30

**Droste spiral preview redrawn in the correct space + direction.** Build 57 brought back a spiral seam curve, but it was effectively drawing the *canvas-side* tier-boundary curve overlaid in *source-overlay* coordinates — geometrically meaningless. The result curved in the opposite direction from where source is actually sampled.

The correct visualization: each canvas-radial line maps to a curve in source space via `theta_src = θ_canvas + b·logr` (with `b = -spiral·logS/(2π)`). Going from canvas-outer (logr=0) to canvas-inner (logr=−logS), source theta shifts by `−b·logS`. For positive spiral, that shift is positive (CW in screen y-down) — toward the +θ direction past the wedge boundary.

- **At `arms = 1`**: draw a single curve at `θ_canvas = 0` (the wedge-center / sliceRotation direction). Shows the spiral-arm structure: starts at the source-outer ring on the slice-rotation radial, curves to the inner ring at angle `−b·logS` past it.
- **At `arms ≥ 2`**: draw two curves at `θ_canvas = ±halfWedge` (the wedge boundaries). Both start at the wedge boundary on the source-outer ring and curve toward the inner ring in the spiral direction. Content beyond these curves at the inner ring is where the next tier's sampling reaches — visibly indicating how the wedge "tilts" with spiral.
- **Code:** [src/engine/forms/droste.js](src/engine/forms/droste.js) (spiral-preview math + draw helper), [src/version.js](src/version.js) (Build 59).

---

## v0.3.1 (Build 58) — 2026-05-30

**Two Droste nit-fixes from Build 57 testing.**

- **Segments slider syncs on form switch.** The `buildFormGrid` onclick handler in [src/shell/controls.js](src/shell/controls.js) now calls `env.syncControls()` after switching `state.form` — the form-aware segments slider (routes to `state.segments` for radial, `state.drosteArms` for droste) re-displays the correct value + range. Previously the slider stayed at the radial default (12) after switching to Droste even though Droste defaults to arms=1 — visible/state desync.
- **Spiral preview extends beyond the wedge at arms ≥ 2.** Removed the `isFullCircle` gate. The log-spiral seam curve now draws everywhere the spiral is non-zero, regardless of arms count. At arms > 1 with non-trivial spiral, the curve visibly extends *outside* the wedge boundary — which is the useful information: that's where source sampling actually reaches (the canvas-space seam isn't constrained by the wedge fold, even though source content beyond the wedge is reached only via the per-tier `c.x·θ + c.y·logr` rotation pulling source-theta out past the wedge angular bounds).
- **Code:** [src/shell/controls.js](src/shell/controls.js) (form-switch sync), [src/engine/forms/droste.js](src/engine/forms/droste.js) (drop isFullCircle gate on spiral preview), [src/version.js](src/version.js) (Build 58).

---

## v0.3.1 (Build 57) — 2026-05-30

**Five Droste polish fixes: Y-flip, visible spinner, combined offset, wedge-mirror cleanup, spiral preview.**

- **Source Y-flip fixed globally.** `toSourceUV` in [src/engine/shader-builder.js](src/engine/shader-builder.js) now negates `v.y` before adding `sliceCenter`. WebGL textures upload with `UNPACK_FLIP_Y_WEBGL = false` (image top-left at UV 0,0); without the negation, canvas-y-positive maps to UV-y-positive which is source-BOTTOM, so canvas-top sampled source-bottom (everything upside-down). Invisible on radial/square/hex/triangle (kaleidoscope mirror symmetry makes flipped ≡ unflipped), visibly correct on Droste at arms=1.
- **Export spinner now visible.** Build 56 added a button-spinner wrapper, but `doExport` was still calling `setBusy()` which displays a fullscreen overlay (z-index 100) that covered the button. The spinner WAS rendering — just hidden. Removed `setBusy/clearBusy` calls from `doExport`. Status text + button-spinner are the export feedback path now.
- **Combined offset diamond + shift dot into one handle.** Removed `drosteShiftX/Y` state and `u_drosteShift` uniform. The GLSL pipeline now drives BOTH the canvas-side Möbius pre-composition AND the source-side per-tier drift from `u_drosteOffset` — one parameter, two effects, single visual handle (the blue diamond). The drag handler in [src/shell/overlay.js](src/shell/overlay.js) writes only to `drosteOffsetX/Y`. The shift hit-test, drag mode, geom entries, and `tx<XX>y<YY>` filename clause all removed.
- **Wedge mirror at arms=1: GLSL no-op + UI hidden.** The Build 54 tier-parity theta mirror at arms=1 produced a vertical flip on alternating tiers — unrelated to the arms≥2 wedge-mirror reflection idiom, and visually confusing. Removed that GLSL block. Also hide `#wedgeMirrorLabel` when `state.drosteArms === 1` via the existing `syncWedgeMirrorToggle` callback (registered with `controlsSync` so it re-runs on every state change).
- **Smooth spiral preview brought back.** When `drosteSpiral > 0.005` and arms=1, draw a single log-spiral curve on the source overlay tracing the generalized-Lenstra tier-0/tier-1 seam (`logr_src = -logS`). 80 line segments for visual smoothness. Stroke is white at 70% opacity (amber dashed when OOB). Preview only — no drag affordance.
- **Code:** [src/engine/shader-builder.js](src/engine/shader-builder.js) (toSourceUV Y-flip), [src/main.js](src/main.js) (drop setBusy/clearBusy from doExport, hide wedgeMirror UI at arms=1, drop drosteShift from sliceReset), [src/shell/state.js](src/shell/state.js) (remove drosteShiftX/Y), [src/engine/forms/droste.js](src/engine/forms/droste.js) (drop u_drosteShift uniform; source-side drift uses u_drosteOffset; remove arms=1 wedge-mirror GLSL block; remove shift handle drawing + hit-test + geom entry + filename clause; add smooth spiral seam preview when spiral>0 at arms=1), [src/shell/overlay.js](src/shell/overlay.js) (remove droste-shift drag mode + cursor + dispatch), [src/version.js](src/version.js) (Build 57).

---

## v0.3.1 (Build 56) — 2026-05-30

**Droste: fix offset math + remove swirl + export spinner + per-form reset.** Daniel tested Build 55 and identified four issues: (1) the blue diamond's `drosteOffset` math produced a "bulge / view pan" rather than the intended PhotoSpiralysis off-center-rings aesthetic — because `p = p − (1−|p|)·offset` is a *non-uniform* canvas warp; (2) the hollow-ring `drosteSwirl` doesn't feel right as "rotation" and was getting in the way of the offset UI; (3) the export button needs a spinner to prevent double-clicks during the multi-second export delay; (4) per-form reset-to-defaults would help iteration. All four fixed in Build 56.

- **Offset math is now Möbius pre-composition.** `M(p) = (p − a) / (1 − conj(a)·p)` — a disc automorphism. Maps the unit circle to itself (outer ring preserved), maps origin to `−a`, and **maps every circle to another circle** — so each tier ring stays circular but with a different center. This is exactly the PhotoSpiralysis "off-center nested circles" aesthetic. The math is what `drosteSwirl` used to compute; we've moved it to `drosteOffset` since "offset" matches the user-facing mental model.
- **`drosteSwirl` removed entirely.** Two sequential Möbius transformations compose into a single Möbius, so having both `drosteOffset` (now Möbius) and `drosteSwirl` (also Möbius) as separate parameters was mathematically a single control split confusingly into two. Removed: state fields `drosteSwirlX/Y`, the `u_drosteSwirl` uniform, the GLSL swirl block, the hollow-ring handle drawing, the swirl hit-test in `classifyPointer`, the `droste-swirl` drag mode + dispatch, the swirl cursor entry, the `sx<XX>y<YY>` filename suffix clause. Future "true rotation" work (Build 57+) starts from a clean slate.
- **Export spinner.** While export is in-flight, the button's text is replaced by a CSS `.btn-spinner` element and `disabled = true` is set. `try/finally` ensures the button restores even if export throws. Re-uses the existing `@keyframes busy-spin` animation. Prevents the multi-second download delay from looking like the click didn't register.
- **Per-form slice reset.** New `reset slice` button at the bottom of the slice section (low-contrast secondary styling — doesn't compete with the primary `export` button). On click, writes defaults to all form-specific + slice-section state fields (segments, sliceScale, sliceRotation, sliceCx, sliceCy, squareAspect, drosteZoom, drosteSpiral, drosteMirror, drosteArms, drosteWedgeMirror, drosteOffsetX/Y, drosteShiftX/Y), then `applyArmsSnap`, `controlsSync.syncAll`, `scheduleRender`, `updateUndoUI`. The form selection, canvas zoom/rotation, OOB mode, and export settings are untouched. Pushes history so undo restores the previous state.
- **Code:** [src/shell/state.js](src/shell/state.js) (removed `drosteSwirlX/Y`), [src/engine/forms/droste.js](src/engine/forms/droste.js) (GLSL offset → Möbius math, removed `u_drosteSwirl` uniform + swirl handle drawing + swirl hit-test + `swirlHandleX/Y` geom + `sx…` filename clause; classifyPointer priority comment updated; SWIRL_HIT constant removed), [src/shell/overlay.js](src/shell/overlay.js) (removed `droste-swirl` cursor, drag handler, onDown dispatch), [index.html](index.html) (added `#sliceReset` button), [src/main.js](src/main.js) (slice reset wiring; export spinner wrapping the existing click handler), [src/shell/styles.css](src/shell/styles.css) (`.reset` button class, `.btn-spinner` inline spinner), [src/version.js](src/version.js) (Build 56).

---

## v0.3.1 (Build 55) — 2026-05-30

**Droste: commit generalized Lenstra + spiral UX polish.** After Build 54's A/B test, Daniel chose generalized Lenstra. Build 55 commits the math, simplifies the slider, removes broken direct-manipulation affordances, and fixes the "mirrored by default" first-paint feel.

- **Generalized Lenstra committed.** Classical Lenstra and the mode toggle are removed. The `u_drosteC` extractor is now a one-liner: `c = (1, -spiral · logS / (2π))`. The shader pipeline is unchanged. `state.drosteLenstraMode` is removed; the `lenstraMode` slider DOM and `'lenstraMode'` entry in the form's `controls` array are removed.
- **Default `drosteArms` changes from 2 → 1.** Out of the box, the Droste form is now a single-arm spiral (no angular fold). This produces a centered, non-bilaterally-mirrored result by default — the form's namesake aesthetic. Users opt into arms ≥ 2 (kaleidoscope-style) via the segments slider.
- **Spiral slider range tightens to 0..6** (was −3..3). Negative chirality wasn't adding visible value.
- **Tier-mirror-aware snap.** The snap step is `1/arms` when tier mirror is OFF and `2/arms` when tier mirror is ON. Reason: with tier mirror, one canvas turn that lands in an *odd* tier ends up in a reflected tier, producing visible misalignment at the canvas seam. Only even multiples of `1/arms` close cleanly. Toggling the tier mirror re-snaps the spiral value automatically and refreshes the slider display.
- **Direct-manipulation handle for spiral removed.** The seam-endpoint dot, the log-spiral seam line, the translucent twisted-wedge preview, and the corresponding `'twist'` hit-test + `'droste-twist'` drag mode are all gone. They were rooted in log-shear-era math, inaccurate under Lenstra, and the dot had no working drag. Spiral is now adjusted via the slider only. `seamEndX/Y` is dropped from the geom export.
- **Smoother spiral overlay.** With the polyline seam-spiral drawing removed, the source-overlay is now drawn entirely with `ctx.arc` for circles and straight `lineTo` for wedge sides — no more octagonal-looking curves.
- **Filename suffix simplified.** Drops the `lm<C|G>` clause. Format is now `z<zoom>q<spiral>a<arms>m<mirror>` + optional `ox…`, `sx…`, `tx…` clauses.
- **Code:** [src/shell/state.js](src/shell/state.js) (removed `drosteLenstraMode`, default `drosteArms: 1`), [src/engine/forms/droste.js](src/engine/forms/droste.js) (simplified `u_drosteC`, removed seam-related drawing + hit-test, dropped `'lenstraMode'` from `controls`, simplified filename suffix), [index.html](index.html) (`#spiral` slider min=0; removed `#lenstraModeLabel`), [src/shell/controls.js](src/shell/controls.js) (dropped `lenstraMode` from conditional labels), [src/main.js](src/main.js) (tier-mirror-aware `armsSnapStep`; spiral slider min=0; tier mirror toggle re-snaps via `applyArmsSnap` + `syncAll`; removed Lenstra mode toggle wiring), [src/shell/overlay.js](src/shell/overlay.js) (removed `'droste-twist'` drag mode + `'twist'` cursor and dispatch), [src/version.js](src/version.js) (Build 55).

---

## v0.3.1 (Build 54) — 2026-05-30

**Droste: A/B Lenstra mode + spiral slider (tiers per turn) + wedge mirror at arms=1.** Daniel's testing of Build 53 surfaced three observations that all trace to a single fundamental property of classical Lenstra: at any non-zero twist, `c.real < 1`, so one canvas turn shows less than 360° of source theta. With arms=1, this means the spiral "repeats" before showing the full source — Daniel's "7→9 / 8→10 jump." The fix is a **generalized Lenstra** parameterization, `c = 1 + i·b`, which keeps the log-spiral seam aesthetic but sets `c.real = 1` so each canvas turn always sweeps the full source. The trade-off is mild non-conformality (~4° angular shear per tier at zoom=2). To pick visually, Build 54 ships both modes behind a toggle; Build 55 will commit.

- **State changes** in [src/shell/state.js](src/shell/state.js):
  - **Renamed** `drosteTwist` (degrees of rotation per tier) → `drosteSpiral` (tiers per canvas turn). Range −3 to +3, default 0 (no spiral, concentric Droste).
  - **Added** `drosteLenstraMode`: `'classical'` (Build 53 math) or `'generalized'` (new, default). Both modes accept the same `drosteSpiral` parameter — the only difference is the JS-side computation of `c`.
- **Mode-aware `u_drosteC` extractor** in [src/engine/forms/droste.js](src/engine/forms/droste.js):
  - Classical: back-derives `twist_rad = (π − √(π² − spiral²·logS²)) / spiral` (small branch), then `c = logS / (logS + i·twist_rad)`. Real solutions limited to `|spiral·logS| ≤ π` (≈ `|spiral| ≤ 4.5` at zoom=2); past that, clamps gracefully.
  - Generalized: `c = 1 + i·b` where `b = -spiral · logS / (2π)`. Always `c.real = 1`. The GLSL pipeline (canvas-side offset → swirl → arms → Lenstra → tier mirror → source-side shift) is unchanged.
- **Wedge mirror at arms=1** — new GLSL block applied after the Lenstra step and before the radial reduction. When `arms=1 && wedgeMirror=on`, theta is mirrored on odd tiers (`floor((logr_src + 1000·logS) / logS) % 2 == 1`). Adjacent tiers along the spiral arm appear with alternating chirality. Consistent semantic with the arms≥2 wedge mirror (reflect at boundary between repeating units); the "unit" is a tier when there's only one arm.
- **Slider** in [index.html](index.html) renamed `twist` → `spiral`, range `-3..3 step 0.001`. Value display prefers fraction format (`1`, `1/2`, `2/3`, `5/4`) on snap points, decimal otherwise. Snap to multiples of `1/arms` (1/12 at arms=12, 1/2 at arms=2, integers at arms=1) — clean spiral closures across the arms-fold lattice.
- **Lenstra mode toggle** — new two-button row in the slice panel (`classical` / `generalized`), idiomatically matching the tier-mirror and wedge-mirror toggles. Tooltip explains the trade-off.
- **Snap plumbing** in [src/main.js](src/main.js): `snapTwistDeg` → `snapSpiralValue` (rounds to nearest `1/arms`). `env.snapDrosteTwist` → `env.snapDrosteSpiral`. `armsSnapStep` returns `1/arms`. The slider keeps fine-grained step (0.001) and lets the snap function do the discretization, so smooth drags + crisp landings.
- **Overlay drag** in [src/shell/overlay.js](src/shell/overlay.js): `droste-twist` handler now writes `state.drosteSpiral` with units `tiers per turn`. One full canvas-turn cursor drag (2π rad) maps to +1.0 spiral (matches "one tier per turn" intuition).
- **Filename suffix:** `t<deg>` removed; replaced by `q<NNN>` (spiral × 100, signed) and `lm<C|G>` (Lenstra mode). Example: `q100lmGa01m1` = spiral 1.00, generalized mode, arms 1, tier mirror on.
- **Overlay seam-spiral approximation deferred.** The source-overlay's twisted-wedge preview still uses log-shear-style math (`twistRad = spiral · 2π` as a rough hint). It was already approximate after Build 53's switch to Lenstra; accurate redraw waits until Build 55+ commits to one mode.
- **Code:** [src/shell/state.js](src/shell/state.js), [src/engine/forms/droste.js](src/engine/forms/droste.js), [index.html](index.html), [src/shell/controls.js](src/shell/controls.js), [src/main.js](src/main.js), [src/shell/overlay.js](src/shell/overlay.js), [src/version.js](src/version.js) (Build 54).

---

## v0.3.1 (Build 53) — 2026-05-29

**Droste: Lenstra conformal map replaces log-shear + new canvas-side offset.** Daniel's fresh-eyes review after Build 52 surfaced three things that all traced to one decision: our log-shear spiral has *circular* tier boundaries, so even at the "canonical spiral" settings (arms=1, mirror=off, twist=360°) the output reads as nested concentric circles, not one unbroken spiral. The Möbius swirl built on top of log-shear inherits that non-conformality, so it reads as planar distortion rather than spherical rotation. And the source-side `drosteShift` we shipped in Build 52 was solving the wrong half of the offset problem — it shifted the *content* within each ring instead of moving the *visible ring centers*. Build 53 addresses all three with one math change plus one new control.

- **Replaced log-shear with the Lenstra conformal map** in [src/engine/forms/droste.js](src/engine/forms/droste.js)'s `foldDroste`. New step: `z_src = exp(c · log(p))` where `c = logS / (logS + i·twist_rad)` is pre-computed JS-side and pushed via the new `u_drosteC` (`2f`) uniform. The classical Print Gallery map: at `twist=0` it's the identity `c = (1, 0)` (no spiral, no singularity, no first-paint race); at `twist=2π` it's `c = logS/(logS + 2πi)`, giving exactly one canvas rotation per zoom step. **Tier boundary is now a log-spiral curve in canvas, not a circle** — so a true unbroken spiral emerges at any non-zero twist. The previous `u_drosteTwist` uniform is removed (`u_drosteLogS` stays for the radial reduction).
- **Conformal swirl as a side benefit.** With Lenstra in place of log-shear, the Möbius `u_drosteSwirl` pre-composition composes into a fully conformal map. Shapes preserve angles everywhere; swirl now reads as rigid sphere rotation rather than 2D polar unwrapping.
- **New canvas-side offset** in [src/engine/forms/droste.js](src/engine/forms/droste.js)'s `foldDroste`: `p ← p − (1 − |p|)·u_drosteOffset`, applied before the warp. The factor `(1 − |p|)` is 0 at the outer ring (preserves the surface tier) and ramps to 1 at the canvas center; cumulative shift across tiers converges geometrically so the visible ring centers walk off-axis toward `offset/(1 + |offset|)`. PhotoSpiralysis "shift the visible center" aesthetic — distinct from the source-side `drosteShift` (Build 52), which stays in the codebase as the source-content "drift" effect.
- **Three direct-manipulation handles now** at the slice center, stacked as a bullseye when all are zero. New: filled light-blue diamond (offset, 5/7 px, hit 9/14). Existing: filled white dot (shift, 6/8 px, hit 11/18) and open white ring (swirl, 10/12 px, hit 14/22). Hit priorities: offset (innermost, smallest) > shift > swirl. Knob ergonomics are tight at zero; Build 54 will add panel sliders + reset-defaults to disambiguate.
- **State + uniforms:** new `state.drosteOffsetX/Y` (defaults 0), new `u_drosteOffset` (`2f`). `u_drosteTwist` removed (replaced by `u_drosteC`); `u_drosteLogS` kept for the wrap/mirror radial reduction.
- **Drag plumbing** in [src/shell/overlay.js](src/shell/overlay.js): new `'droste-offset'` drag mode (cursor → fold-space inverse-rotated, no clamp); `cursorForMode` entry; `onDown` dispatch.
- **Filename suffix** extended with `ox<XX>y<YY>` (canvas-side offset, when non-zero), preceding the existing `sx…` (swirl) and `tx…` (shift). Order: `…m<mirror>` + `ox…`? + `sx…`? + `tx…`?
- **Why mirror still works seamlessly:** the source-side shift's factor `(1 − r/r_src)` still crosses 0 at every mirror reflection (where r = r_src), so it remains seamless under `drosteMirror`. Canvas-side offset does *not* have this property — at `drosteMirror = true` the offset's tier-cumulative shift may show a faint seam at tier boundaries. Visual review pending.
- **Spiral test:** the canonical Lenstra test is `arms=1, mirror=off, twist=360°` — should now show one unbroken spiral from outer ring to center (the thing Daniel couldn't reproduce in Build 52).
- **Code:** [src/engine/forms/droste.js](src/engine/forms/droste.js) (replaced GLSL pipeline, `u_drosteC` + `u_drosteOffset` uniforms, new offset handle drawing, hit-test priority reordering, geom export, filename suffix), [src/shell/state.js](src/shell/state.js) (new `drosteOffsetX/Y`), [src/shell/overlay.js](src/shell/overlay.js) (new drag mode + dispatch + cursor), [src/version.js](src/version.js) (Build 53).

---

## v0.3.1 (Build 52) — 2026-05-26

**Droste: split offset into two distinct controls — per-tier shift + full-range Möbius swirl.** Build 51's "vanishing-point offset" used a Möbius pre-composition that correctly moves the spiral pole but non-uniformly distorts the disc interior — the visual feel was rotational, not translational. Comparing against PhotoSpiralysis's center-offset (Daniel's reference) showed that what users actually expect for "shift the center" is **per-tier linear translation**: each recursive tier drifts by a constant amount toward the offset direction, with rings retaining their shape and stacking off-center. Build 52 exposes both as separate controls.

- **Shift (new):** `state.drosteShiftX/Y`, GLSL post-warp `z_src += u_drosteShift * (1.0 − r/r_src)`. The factor is **exactly 0** on the surface tier (the visible annulus is unaffected) and approaches 1 as the recursion deepens. In `drosteMirror` mode this is **seamless at every tier boundary** — at the reflection point r = r_src on both sides, so factor = 0 on both sides; no step seam introduced by the shift. (Linear factor has a small C1 slope kink at the surface/first-mirror-tier boundary; if visually objectionable in testing, swap for the C1-continuous squared variant at the cost of a less dramatic effect.)
- **Swirl (renamed from offset):** `state.drosteSwirlX/Y` (formerly `drosteOffsetX/Y`). Math unchanged — same Möbius pre-composition from Build 51 — but **the `|a| ≤ 0.95` clamp is removed**. Dragging past the disc boundary takes the user around the back of the Riemann sphere; when `|a| > 1` a single pixel inside the disc (at `p = 1/conj(a)`) sources from infinity and is absorbed by the existing OOB mode (clamp/mirror/transparent). Builds toward the planned pole-rotation feature, which adds the third DOF on the Möbius family.
- **Two handles on the source overlay.** Shift = filled white circle (6 px normal / 8 px active); swirl = open white ring (10 px / 12 px). At zero they form a target/bullseye (filled dot inside the open ring) over the slice center dot; as either is dragged they separate. Hit zones: shift = 16 touch / 10 mouse (snug), swirl = 22 touch / 14 mouse (looser, annulus around the shift hit zone). When both are at zero the user grabs shift by touching dead-center, swirl by touching the surrounding ring band.
- **`classifyPointer` priority order** updated: shift (1) → swirl (2) → twist (3) → ring bands (4) → wedge boundary (5) → inner ring move (6) → wedge move (7) → rotate (8).
- **Drag-mode plumbing** in [src/shell/overlay.js](src/shell/overlay.js): renamed `'droste-offset'` → `'droste-swirl'` (clamp removed); new `'droste-shift'` handler; `cursorForMode` updated.
- **Filename suffix** restructured: the Build 51 `ox<XX>y<YY>` clause is replaced by `sx<XX>y<YY>` for swirl and `tx<XX>y<YY>` for shift. Both omitted when zero. Order: `…m<mirror>` + `sx…`? + `tx…`?
- **Code:** [src/engine/forms/droste.js](src/engine/forms/droste.js) (uniform rename + new uniform, GLSL post-warp shift, two overlay handles, classifyPointer priorities, geom export, filename suffix), [src/shell/state.js](src/shell/state.js) (rename `drosteOffsetX/Y` → `drosteSwirlX/Y`, add `drosteShiftX/Y`), [src/shell/overlay.js](src/shell/overlay.js) (drag mode rename + add, cursorForMode), [src/version.js](src/version.js) (Build 52).

---

## v0.3.1 (Build 51) — 2026-05-26

**Droste vanishing-point offset (Möbius pre-composition).** The PhotoSpiralysis-style move-the-pole feature. A complex offset `a = (drosteOffsetX, drosteOffsetY)` is applied to fold-space input as `M(p) = (p − a) / (1 − conj(a)·p)` *before* the log-shear warp, shifting the spiral's vanishing point off the geometric center. At `a = (0, 0)` the warp is identity (Build 50 behavior unchanged). `|a|` is clamped to 0.95 to stay safely inside the unit-disc, avoiding the boundary singularity.

- **Direct manipulation only — no slider.** A small open ring (9 px outer radius, 11 px when active) sits at the offset's screen position. At `a = 0` it overlays the slice center dot; drag it anywhere within the unit disc to shift the pole. Hit zone is 18 px touch / 12 px mouse — slightly larger than the visible ring, looser than the twist handle's 22 px so the offset target reads as a smaller, more precise affordance. Departure from the original plan: hit zone follows the visible handle (rather than staying anchored at slice center) so the user can grab the ring to readjust after offsetting.
- **GLSL Möbius pre-comp** in `foldDroste`. Two complex products: `conj(a)·p` for the denominator and `num·conj(den)/|den|²` for the division. Composes cleanly with the arms fold and log-shear that follow.
- **State + uniform.** New `state.drosteOffsetX`, `state.drosteOffsetY` (default 0). New `u_drosteOffset` uniform (`2f`), clamped at extraction time. Undo/redo captures both fields via the existing shallow-copy history.
- **Hit-test priority** in [src/engine/forms/droste.js](src/engine/forms/droste.js)'s `classifyPointer` reorganized: offset handle is priority 1 (above twist), so the user can always grab the ring even when it overlaps the center dot at `a = 0` or the inner-disc 'move' region at non-zero offset. Trade-off: dragging from exactly the slice center now sets the offset rather than moving the slice — to move the slice when `a = 0`, grab anywhere inside the inner ring outside the offset hit zone.
- **Drag-mode plumbing** in [src/shell/overlay.js](src/shell/overlay.js): new `'droste-offset'` case in `onMove`, `onDown` dispatch, and `cursorForMode`. Cursor is `grab`/`grabbing` to match the slice 'move' idiom.
- **Filename suffix** extended: append `ox<XX>y<YY>` (signed, `m` prefix for negative) when offset is non-zero. Omitted at `(0, 0)` so existing reproducibility is unchanged.
- **Code:** [src/engine/forms/droste.js](src/engine/forms/droste.js) (uniform, GLSL Möbius, offset handle drawing, hit-test priority, geom export, filename suffix), [src/shell/state.js](src/shell/state.js) (`drosteOffsetX/Y`), [src/shell/overlay.js](src/shell/overlay.js) (drag mode wiring), [src/version.js](src/version.js) (Build 51).

---

## v0.3.1 (Build 50) — 2026-05-26

**Droste rotation arc direction fix.** Build 49 placed the arc at `sliceRotation + π` (opposite the wedge), but the correct idiom — matching radial and hex — is to place it on the same side as the outer arc at `sliceRotation`. Arc now sits just past the outer ring in the wedge's own direction, hugging the outside of the outer boundary.

- **Code:** [src/engine/forms/droste.js](src/engine/forms/droste.js) (rotation arc angle: `seamPhaseRad + π` → `seamPhaseRad`), [src/version.js](src/version.js) (Build 50).

---

## v0.3.1 (Build 49) — 2026-05-26

**Droste affordance geometry refinements (round 2).** Two more corrections from Build 48 testing.

- **Rotation arc moved back to outside the wedge.** Build 48 placed the arc at the top-right corner of the source image, where it was getting clipped by the preview area edge. Arc is now centered at `(cx, cy)` (established in Build 48) with radius just past the outer ring, positioned at `sliceRotation + π` — opposite the wedge, same idiom as radial.js. Stays within the image as long as the opposite side of the outer ring is within bounds, which matches normal usage.
- **Thickness + scale arrows now purely radial.** The 30° tilt introduced in Build 47 was meant to distinguish the arrows from horizontal affordances at sliceRotation=0, but on screen they should angle directly away from the origin. Tilt removed; direction vector is now `(cos(arrowAngle), sin(arrowAngle))` — pointing straight away from the slice center.
- **Code:** [src/engine/forms/droste.js](src/engine/forms/droste.js) (rotation arc position, arrow direction), [src/version.js](src/version.js) (Build 49).

---

## v0.3.1 (Build 48) — 2026-05-25

**Droste affordance geometry fixes.** Two small corrections to Build 47's touch affordances — no hit-zone or math changes.

- **Thickness + scale arrows repositioned to the lower portion of the wedge arc.** Build 47 placed both arrows at the wedge center axis (`seamPhaseRad`). They now sit at `seamPhaseRad + halfWedge × 0.65` — roughly 65% of the way from the wedge center toward the lower boundary — so they hug the arc edge below the midpoint where the gesture naturally lands. Arrow direction (30° tilt from radial) is updated to match the new angular position. At arms=1 (full-circle, no wedge boundary), the arrows shift to `seamPhaseRad + 45°` as a reasonable fixed offset.
- **Rotation arc centered at slice center.** Build 47 drew the arc centered at the corner point itself (a small circle spinning around the corner). The arc is now centered at `(cx, cy)` with radius = distance from slice center to the corner. The visible portion of the arc still appears at the top-right corner but its curvature reads as rotating around the slice center — which is the actual rotation gesture. Arc span reduced to ±15° (was ±50°) to match the narrower visible chord at the larger radius.
- **Code:** [src/engine/forms/droste.js](src/engine/forms/droste.js) (arrow angle, rotation arc center + radius), [src/version.js](src/version.js) (Build 48).

---

## v0.3.1 (Build 47) — 2026-05-25

**Droste touch affordance fine-tuning.** Four small calibrations on top of Build 46's polish pass — all visual / hit-zone, no math changes.

- **Inside-band hit zones bumped from 4/2 → 8/6 px** (touch/mouse). Build 46 went too aggressive on Daniel's "only a few pixels inside the wedge" guidance — actually using it on iPad showed the user needed slightly more room to reliably hit the thickness and scale targets without scoring move-instead. 8 px touch / 6 px mouse leaves the wedge interior generously sized for `'move'` while making the ring boundaries comfortable to grab. Same bump applied to `SIDE_BAND_IN` for consistency on the wedge boundary lines.
- **Segment-drag affordance on the upper wedge boundary.** Two faint parallel lines along whichever wedge boundary has the smaller midpoint y on screen (the "upper" one), same visual idiom as radial.js's spoke double-line. Tells the user "this edge is actionable" — discoverability for the droste-arms drag. Only drawn for arms ≥ 2.
- **Thickness + scale arrows tilted 30° CW from radial.** At sliceRotation=0 (the default), pure radial arrows draw horizontally, which competes with any other horizontal affordance on the canvas. A 30° tilt reads visually distinct without losing the "drag toward/away from center" gesture meaning.
- **Rotation arc relocated to the top-right corner of the visible source image.** Build 46 placed it at `sliceRotation + π` just past the outer ring — fine at default zoom, but when the user scales up enough that the outer ring extends past the image, the rotation arc would fly off-screen and become invisible. The corner placement (30 px inset from top-right) stays discoverable at every scale. The rotation arc itself is also bigger (50° span vs 11°) so it reads as a rotation icon rather than a thin curved tick. The rotation **gesture** is unchanged — drag outside the outer ring, same as before; the corner icon is purely a visual hint.
- **Helper update:** [src/engine/forms/droste.js](src/engine/forms/droste.js)'s `drawRotationArc` now takes an optional `hspan` parameter so the corner icon can use a fatter arc than the previous wedge-adjacent version.
- **Code:** [src/engine/forms/droste.js](src/engine/forms/droste.js) (band sizes, touch affordance placement + tilt + segment-drag double-line, drawRotationArc hspan), [src/version.js](src/version.js) (Build 47).

---

## v0.3.1 (Build 46) — 2026-05-25

**Droste touch/click polish.** Build 45 iPad testing surfaced seven things to tighten before adding the next feature. All of these are calibration tweaks to existing structures — no new capabilities. Vanishing-point offset is deferred to Build 47 (Daniel's call: don't risk regressions on the polish work).

- **Ring-band hit zones reduced and asymmetrized.** Daniel's "~16 px total, only a few px inside the wedge" rule applies to both ring bands and wedge boundary lines. New values: `BAND_OUT` = 14 px touch / 12 mouse (outside the annulus, where users naturally grab the ring); `BAND_IN` = 4 px touch / 2 mouse (inside the annulus body — reserves the wedge interior for `'move'`). Same asymmetric treatment for `SIDE_BAND` on the wedge boundary lines: 14 px outside the wedge angular range, 4 px inside.
- **Inside the inner ring is now exclusively `'move'`.** Added a priority-4 catch-all: `if (r <= rIn) return 'move'` runs after the ring-band scale and wedge-boundary checks but before the wedge-angular gate. So clicking anywhere inside the inner ring repositions the slice center, regardless of whether the cursor is inside the wedge angular range. (Reserves this region for the future vanishing-point handle.)
- **Touch affordances moved onto the wedge arcs.** The thickness arrow now lives on the **inner arc** at `sliceRotation` (radial direction), the scale arrow lives on the **outer arc** at `sliceRotation` (same direction), and the rotation arc lives **opposite the wedge** at `sliceRotation + π`, just past the outer ring. Build 45 had them in arbitrary "top-of-screen" or "opposite-the-seam" positions; the new placement makes the affordance live where the gesture actually applies.
- **Translucent twisted-wedge opacity reduced.** From 0.5 → 0.3. The twisted-sample preview reads as informational without competing with the solid white untwisted reference.
- **Per-wedge OOB detection.** Build 45 used `cx ± rOut < imgX | imgX + imgW` (the full outer ring's bounding box) which flagged the wedge as OOB whenever the geometric outer circle exited the image — even when the wedge itself sat entirely inside. New check samples 12 points along the outer arc, inner arc (shifted by −twist), and both log-spiral sides of the **actual** twisted wedge; OOB fires only if any sample lands outside the image rect. Full-circle case (arms=1) keeps the simple bounds check.
- **Scrub-field touch hit area enlarged.** `@media (pointer: coarse)` rules expanded for `.scrub`: min-height 28 px (was 18), padding 6/8 (was 2/4), min-width 44 px (was 36). The numeric values next to the sliders now match the slider thumb's tap-target size — Daniel reported the new sliders' touch targets feeling narrower than the existing ones; this was the scrub-field side, not the slider track.
- **Slider thumb on touch enlarged.** `width: 28px; height: 28px` (was 24×24). Adds 4 px to the tap target without crowding the slider track.
- **Code:** [src/engine/forms/droste.js](src/engine/forms/droste.js) (classifyPointer reorganized, asymmetric bands, per-wedge OOB, touch-affordance placement, twisted-wedge opacity), [src/shell/styles.css](src/shell/styles.css) (coarse-pointer scrub + slider thumb), [src/version.js](src/version.js) (Build 46).

---

## v0.3.1 (Build 45) — 2026-05-25

**Droste click/touch refresh + accurate twisted-wedge preview + wedge-mirror toggle + "thickness" rename.** Version bump for the accumulated Droste polish across Builds 41–45. Build 44 testing surfaced four things to refine: the overlay outline didn't match the actual sampled pixels at non-zero twist; the wedge-mirror behavior should be user-toggleable; the click/touch zones hadn't been updated to respect the new wedge visualization; and "zoom" was a misleading label for the inner/outer ratio control.

- **Translucent twisted-wedge overlay.** When twist ≠ 0 and arms ≥ 2, the actual sampled region in source space is drawn on top of the solid untwisted wedge as a translucent outline: outer arc unchanged, inner arc shifted by −twist, log-spiral sides connecting them (the warp `theta_src = theta + (twist/logS)·log r` accumulates exactly one tier of rotation across the radial span). The solid untwisted wedge stays as the click/touch reference + straight-line affordance; the translucent overlay is purely informational ("here are the actual pixels"). At twist=0 or arms=1 the two would coincide, so we skip the translucent layer.
- **Seam direction corrected.** The center seam previously drew from `(rIn, sliceRotation)` outward to `(rOut, sliceRotation + twist)` — same magnitude of bend as the warp but reversed direction. Now draws from `(rOut, sliceRotation)` inward to `(rIn, sliceRotation − twist)`, matching the warp exactly. The twist drag handle moves from the outer ring to the seam's inner endpoint at `(rIn, sliceRotation − twist)`, where it tracks the parameter directly. Cursor-CCW now decreases twist (because the handle's screen angle follows the cursor, and a CCW cursor means smaller screen angle = larger twist). Sign of the twist drag delta flipped to match.
- **Click/touch zones reworked.** Ring band scale hits (inner and outer) now fire only when the cursor is **inside the wedge angular range** — clicking the rings on the side opposite the wedge no longer activates scale or zoom; it just rotates. The annulus body inside the wedge now classifies as `'move'` (was falling through to `'rotate'`), so dragging anywhere within the visible wedge repositions the slice center. Outside the wedge angular range, all drags rotate. Reflects [src/engine/forms/droste.js](src/engine/forms/droste.js)'s `classifyPointer` priority order.
- **Wedge boundary lines draggable for arms count.** A new `'droste-arms'` drag mode in [src/shell/overlay.js](src/shell/overlay.js) lets the user grab the radial side lines (the wedge boundaries, visible when arms ≥ 2) and drag angularly to change the arms count. Cursor's `|angle from sliceRotation|` becomes the new halfWedge; arms = π / halfWedge, snapped to {1, 2, 4, 6, 8, 10, 12}. Twist re-snaps to the new arms count's alignment step via `env.applyArmsSnap` cascade.
- **Wedge mirror toggle (default on, experimental).** New `state.drosteWedgeMirror` plus UI toggle. When on (default): kaleidoscope-style mirror at the angular wedge boundaries — restricted to even arms, produces N/2 visible bilateral petals at non-zero twist. When off: plain angular mod — arms can be any integer in the valid set, the wedges become chiral copies with hard boundary seams. Lets Daniel A/B the bilateral-pairing aesthetic against the "true N arms with visible seams" alternative.
- **"zoom" renamed to "thickness".** The slice-panel label changes from "zoom" to "thickness" (state field, uniform, and HTML id remain `drosteZoom` for internal consistency). The user-facing meaning: the outer/inner ratio determines how wide the annulus is; "thickness" reads more accurately for the visual effect than "zoom."
- **VERSION → v0.3.1.** First minor bump since v0.3.0 shipped triangle in Build 40. Captures the Droste-arms-mirror-overlay-routing-snap suite.
- **Code:** [src/engine/forms/droste.js](src/engine/forms/droste.js) (translucent twisted-wedge draw, corrected seam direction, inner-endpoint twist handle, wedge mirror branch in GLSL + uniform, geom additions for `halfWedge` / `sliceRotationRad`, classifyPointer rework), [src/shell/overlay.js](src/shell/overlay.js) (`droste-arms` drag mode, sign flip on droste-twist), [src/shell/state.js](src/shell/state.js) (`drosteWedgeMirror`), [src/shell/controls.js](src/shell/controls.js) (wedgeMirror conditional label), [index.html](index.html) (thickness rename, wedge mirror toggle DOM), [src/main.js](src/main.js) (wedge mirror toggle wiring, `env.applyArmsSnap` export), [src/version.js](src/version.js) (v0.3.1, Build 45).

---

## v0.3.0 (Build 44) — 2026-05-25

**Droste UX refinements: segment slider reuse, arms=1 back, accurate wedge-arc overlay.** Build 43 testing on iPad surfaced four follow-ups: the overlay's full-circle affordance overstated the sample region (we only sample one wedge, mirrored); the previously-retired arms=1 (single chiral spiral) was missed; the dedicated arms slider felt redundant alongside segments; and the bilateral pairing inherent to wedge-mirror+twist makes "arms=N" read as N/2 visible petals.

- **Segments slider shared with radial.** The `#segments` slider DOM is now one element used by both forms, with form-aware routing: radial drives `state.segments` (range 2–48, step 2); droste drives `state.drosteArms` (valid set {1, 2, 4, 6, 8, 10, 12}, default 2). Range, step, snap function, and bound state field all shift with `state.form`. Custom wiring in [src/main.js](src/main.js) (`setupSegmentsSlider`) replaces the prior `wireSliderWithScrub` call; the standalone arms slider DOM is removed from [index.html](index.html). One fewer slider in the Droste panel; the kaleidoscope vocabulary stays consistent ("segments" works for any folding form).
- **arms=1 restored.** Single chiral spiral / Print Gallery feel. At arms=1 the wedge fold is bypassed and the warp produces the full-circle single-arm spiral that Build 41 originally shipped. The horizontal seam comes back at this setting — Daniel knows. arms ≥ 2 stay restricted to even integers (chirality-parity invariant); the slider snaps through {1, 2, 4, 6, 8, 10, 12} as the user drags. Twist snap step is `360°/N` for N≥2; at N=1 the twist slider becomes continuous (no snap).
- **Annular-wedge overlay.** The dim layer now cuts only the fundamental sample wedge (annular arc spanning `2π/arms` centered on `sliceRotation`), not the full annulus. Two radial lines connect the inner and outer arcs at the wedge boundaries. The rest of the annulus stays dim, signalling "those pixels are mirror-images of the wedge, not independently sampled." arms=1 collapses to the full-circle annulus (no boundary lines). The seam-spiral and twist-endpoint dot are unchanged.
- **State changes:** `state.drosteArms` default stays 2 (separate from `state.segments` which keeps its 12 default). The form-aware accessor handles routing; history's shallow spread captures both fields independently so undo across form switches works as before.
- **Code:** [src/engine/forms/droste.js](src/engine/forms/droste.js) (controls `'arms'` → `'segments'`, uniform extractor allows arms=1, `drawOverlay` cuts annular wedge + draws boundary lines), [index.html](index.html) (removed arms slider DOM), [src/shell/controls.js](src/shell/controls.js) (removed `'arms'` from conditional labels), [src/main.js](src/main.js) (`setupSegmentsSlider`, `armsSnapStep` / `snapTwistDeg` / `applyArmsSnap` hoisted to file scope, removed standalone arms wiring), [src/version.js](src/version.js) (Build 44).

**Known visual property** (not a bug): with arms ≥ 2 + non-zero twist, adjacent wedges are mirror-paired (the wedge fold inverts chirality at each boundary), so N wedges read visually as N/2 bilateral "petals." This is consistent with how the kaleidoscope mirror works across all the forms — radial doesn't show it because radial has no chirality to flip; Droste's twist introduces chirality which the mirror then pairs. To get N truly-chiral arms we'd have to drop the wedge mirror, which reintroduces hard seams at wedge boundaries — the very problem the even-arms restriction was designed to solve. Sweet spot Daniel found: 6+ arms with 3× zoom.

---

## v0.3.0 (Build 43) — 2026-05-25

**Droste refinements: snap-to-arms, even-only arms, log-shear math, single-seam overlay.** Build 42 closed the seam-reduction gap but Daniel's testing on iPad surfaced three follow-ups: twist still allowed arm misalignment between snap-clean values; odd arms produced a chirality-parity seam; the multi-arm seam visual was overwhelming at high arms counts. This build addresses all three.

- **Twist math switched from Lenstra c-multiplier to log-shear.** Build 42's conformal `c = (1−φ)·1 + φ·cPG` had a side effect: the actual rotation accumulated per tier depended on zoom (at zoom=2 with twist=±360° you only got ~±4.5° per tier, almost imperceptible), and the natural N-arm closure values fell outside the slider range. Replaced with a non-conformal log-shear: `theta_new = theta + (twist_rad / logS) · log r`, `logr_new = log r` unchanged. Now `twist_rad` is exactly the rotation accumulated over one tier — independent of zoom. Trade-off: shapes get slightly sheared along the spiral (not conformal), but in the kaleidoscope context with mirror folds it reads as "the picture is twisted by twist°/tier," which is what the slider label promises. `u_drosteC` dropped; `u_drosteTwist` restored as a `1f`.
- **Twist snaps to 360°/arms.** Both the slider's native step and the scrub field's parse path now round to multiples of `360°/drosteArms`. Arms=8 snaps at 0, ±45, ±90, …, ±360. Arms=2 snaps at 0, ±180, ±360. New `snap` and `onSet` options on `wireSliderWithScrub` carry this through. The same snap function is exposed via `env.snapDrosteTwist` so the overlay's seam-drag handler in `overlay.js` snaps too.
- **Arms restricted to even integers (default 2, range 2–12 step 2).** Matches the radial form's segments convention. The wedge-fold's mirror parity is consistent around the full circle only when N is even; odd N produced a visible "connection" seam where the parity flipped. Default changed from 1 to 2 — the "single-arm Print Gallery" look is gone for now, but at twist=0 with arms=2 the visual is still essentially concentric Droste with a horizontal mirror axis. When `drosteArms` changes, `state.drosteTwist` re-snaps to a valid step for the new arms count and the twist slider's native step updates.
- **Single-seam overlay.** Drawing N seam spirals at arms=8 read as visual noise; reduced to a single seam at `sliceRotation` plus one endpoint dot. The N-arm symmetry is implied by the wedge fold rather than literally drawn. Hit-testing checks only the primary endpoint — dragging it adjusts `drosteTwist`, which the wedge fold then propagates to all arms uniformly.
- **Filename suffix unchanged structurally** (`z…t…a…m…`), but values now reflect the snapped twist and even arms.
- **Code:** [src/engine/forms/droste.js](src/engine/forms/droste.js) (GLSL log-shear, single seam, single endpoint hit-test, uniform rename), [src/shell/state.js](src/shell/state.js) (drosteArms default 2), [src/shell/controls.js](src/shell/controls.js) (`snap` + `onSet` options on `wireSliderWithScrub`, slider thumb bounces to snapped position on input), [src/main.js](src/main.js) (`snapTwistDeg`, `applyArmsSnap`, exposed via `env.snapDrosteTwist`), [src/shell/overlay.js](src/shell/overlay.js) (snap in droste-twist drag), [index.html](index.html) (arms slider min/step/default), [src/version.js](src/version.js) (Build 43).

---

## v0.3.0 (Build 42) — 2026-05-25

**Droste seam-reduction + twist=0 bug fix.** Build 41 testing surfaced a hysteresis-flavored bug (slider at 0 didn't visually equal "no spiral") plus three families of seams in the rendered output. This build addresses both via a math reparameterization and two new per-form controls.

- **Twist reparameterized to fix the bug.** The Build 41 GLSL parameterized `α = (logS + iβ)/iβ` — singular at β=0 with a near-singular region just above the threshold, which is why the slider near zero felt undefined. Replaced with a linear interpolation in the complex multiplier `c`: `c = (1−φ)·1 + φ·cPG` where `φ = twist / 360°` and `cPG = 2πi/(logS + 2πi)`. At twist=0 the warp is pure identity (concentric Droste); at twist=360° it's classic Print Gallery; smoothly interpolated everywhere in between. Still conformal at every twist value. The hysteresis disappears as a side effect — no branch, no singular neighborhood. JS computes `c` per render and pushes one `uniform vec2 u_drosteC`; `u_drosteTwist` no longer appears in the shader (state field stays for overlay drawing).
- **Tier mirror (new control, default on).** Replaces the radius mod-reduction with a triangle-wave reflection: tier transitions reflect radially rather than teleporting from inner-ring back to outer-ring. The "type-i" wrap seam (where the picture's outer-ring content meets its inner-ring content) disappears at the cost of alternating tier parity. Toggle in the slice panel; on by default since the default visual reads much cleaner. Composes cleanly with the global `oobMode == mirror` (both are isometries; can stack to produce parity-flipped corners at OOB tiers — a "huh" moment, not a bug).
- **Spiral arms (new control, default 1).** Integer 1–12. Before the conformal warp, θ is folded into a 1/N angular wedge with mirror at the wedge boundaries — same recipe as `radial.js`. Result: N identical spiral arms with mirror seams between them. The "type-ii" angular alignment failure and "type-iii" arm-edge seam are reduced (the wedge boundaries are mirror axes, not visible jumps). Arms × twist are independent — twist stays continuous; at commensurate values (multiples of 2π·k/N) the arms close exactly, and at intermediate values the mirror hides the small alignment offset.
- **Multi-arm seam overlay.** `drawOverlay` now draws N log-spiral seam previews (one per arm) and `classifyPointer` hit-tests all N seam endpoint dots. Dragging any endpoint adjusts twist.
- **Filename suffix expanded.** `z{zoom×100}t{±degrees}a{arms}m{mirror}` — e.g. `z200t045a03m1` = zoom 2.00, twist +45°, arms 3, mirror on. Old `z…t…` filenames remain consistent.
- **Code:** [src/engine/forms/droste.js](src/engine/forms/droste.js) (fold math rewrite, new uniforms `u_drosteC` `u_drosteMirror` `u_drosteArms`, multi-arm seam drawing + hit-test, filenameSuffix, tilesPerDim), [src/shell/state.js](src/shell/state.js) (`drosteMirror`, `drosteArms`), [index.html](index.html) (arms slider + mirror toggle DOM), [src/shell/controls.js](src/shell/controls.js) (`applyFormControls` gating for new control keys), [src/main.js](src/main.js) (slider + toggle wiring, sync registration for undo), [src/version.js](src/version.js) (Build 42).

---

## v0.3.0 (Build 41) — 2026-05-24

**Droste spiral form (initial cut).** Fifth form: a logarithmic-conformal Droste warp (Lenstra & de Smit), producing recursive picture-within-a-picture spirals. The source overlay is bespoke — concentric inner/outer rings define the sample annulus, with a log-spiral seam line previewing the angular wrap. Two new parameters: `zoom` (outer/inner ratio = scale per spiral tier) and `twist` (degrees per tier; 0 = pure concentric Droste, ±360 = one full extra turn per tier). All four overlay manipulations are direct: drag outer ring = scale (existing `sliceScale`), drag inner ring = zoom, drag the seam endpoint dot = twist, drag outside the outer ring = rotate. Two-finger pinch works as on the other forms.

- **New form file:** `src/engine/forms/droste.js`. Per-pixel cost (1 log + 1 exp + a couple multiplies + a mod) is cheaper than hex's axial-coord rounding; 4K preview runs comfortably. The fold function returns `z_src` in the same isotropic fold-space convention the polygon forms use, so the engine's `toSourceUV` aspect correction lands the annulus visually-circular on non-square sources without any per-form path needed.
- **Schema extension (additive):** two new optional fields on the form module — `drawOverlay(env, ctx, geom)` and `classifyPointer(env, x, y, isTouch, geom)`. Forms whose sample region isn't a polygon (Droste's annulus, future hyperbolic disc) own their overlay drawing and hit-testing entirely. Polygon forms (radial, square, hex, triangle) are unchanged — the existing path runs when these hooks are absent. The architecture doc anticipated this escape hatch since v0.0.5; this is the first form that needs it.
- **State additions:** `state.drosteZoom` (default 2.0; range 1.1–16) and `state.drosteTwist` (default 0°; range ±360°). Hidden behind the form's `controls: ['zoom', 'twist']` declaration, so the sliders only appear when Droste is the active form.
- **New env field:** `env.hoverHandle` — a form-specific hover-handle discriminator that lets Droste distinguish inner-ring hover from outer-ring hover for stroke highlighting. Other forms ignore it.
- **New drag modes:** `'droste-ratio'` (inner-ring radial drag adjusts `drosteZoom` with the same relative `r/startR` feel as outer-ring scale) and `'droste-twist'` (angular drag from the seam endpoint adjusts `drosteTwist`, with the seam endpoint tracking the cursor for immediate visual feedback).
- **Filename suffix:** `z{zoom×100}t{±degrees, 3-digit padded, m prefix for negative}` (e.g. `z200t045`, `z350tm120`).
- **Code:** `src/engine/forms/droste.js` (new, ~280 lines), `src/engine/forms/index.js` (1 line), `src/shell/state.js` (2 fields), `src/shell/overlay.js` (drawOverlay + classifyPointer dispatch in `drawSourceOverlay`/`classifyPointer`, new drag-mode branches in `onMove`/`onDown`, hoverHandle tracking), `src/shell/controls.js` (`applyFormControls` extended to handle new control keys), `index.html` (zoom + twist slider DOM), `src/main.js` (slider wiring + `env.hoverHandle` init), `src/version.js` (Build 41).

---

## v0.3.0 (Build 40) — 2026-05-24

**Version bump + Firefox-aware UX + upload error positioning.** Triangle wallpaper form (p3m1, shipped across Builds 32-38) is a meaningful new visual capability — comparable in scope to v0.2.0's session undo/redo. Marking the milestone with a minor version bump. Also: a cluster of UX improvements informed by Build 39's diagnostic data.

- **VERSION bumped to v0.3.0.** Triangle wallpaper form is the v0.3.0 headline.
- **Firefox detection + WebGL-cap notice.** Build 39 diagnostics confirmed the M5 Max's "8K limit" mystery: Firefox's Resist Fingerprinting (RFP) is active by default and caps `MAX_TEXTURE_SIZE` at 8192 — a browser-level limit, not a hardware constraint. (Safari on the same M5 correctly reports 16384.) When Firefox is detected AND the max texture is 8K, the export controls now show a small notice: "Firefox limits WebGL textures to 8K. For higher-resolution export on Apple Silicon, try Safari." Safari/Chrome/Edge see nothing.
- **"Image too large" error augmented for Firefox.** When upload fails with the engine's `image too large for GPU` message AND Firefox-RFP is detected, the message now also reads "Firefox limits WebGL to 8K — try Safari for full-size images on Apple Silicon." On Safari with the same overflow, the message stays as-is (since the cap is then a real API ceiling, not a browser limitation).
- **Upload errors moved to a discoverable location** (BACKLOG item closed). The "image too large", "failed to load image", and "unsupported format" errors used to appear in the `#status` element down by the export button — far from where the user clicked. New `#uploadError` element is inserted right below the upload button. Auto-clears on the next upload attempt. The `#status` element continues to handle export-related status.
- **End-to-end diagnostic test bug fixed.** The Build 39 e2e test was synchronously destructuring a Promise (forgot to `await renderToFBOForDiagnostics`), so it always threw `"undefined is not an object"` instead of running. Now correctly awaits. Diagnostic JSON's `endToEndTest.summary.allZero` is the canary we'll use when the Intel Air becomes accessible to test the "probe passes but render goes black" case.
- **Diagnostic button shows "running..." state** during the async report generation. Disables the button while in-flight to avoid double-clicks.
- **Code:** `src/main.js` (Firefox detection, notice, error rerouting), `index.html` (uploadError div), `src/shell/styles.css` (uploadError + browser-notice classes), `src/shell/diagnostics.js` (async fix + button busy state), `src/version.js` (v0.3.0, Build 40).

---

## v0.2.0 (Build 39) — 2026-05-24

**GPU capability diagnostics surface.** Tooling to gather per-device data about WebGL capability detection. Daniel observed inconsistent results across devices (M5 reports ~8K max export vs M1's ~16K despite similar specs; vintage Intel Air's probe passes but actual export goes black). Build 39 adds a diagnostic panel that exposes everything needed to identify which probe step is mis-firing on each platform.

- **Always-on basic info expansion** in the existing `#diag` element: now also shows the unmasked GPU renderer (via `WEBGL_debug_renderer_info` when available) and `devicePixelRatio` alongside the existing texture/FBO sizes.
- **Run diagnostics button** appended to the diagnostics group. Click to open a full-screen modal panel showing:
  - WebGL version, vendor, renderer (masked + unmasked), max parameters
  - User agent, screen/viewport dims, DPR
  - Per-step FBO probe results for every candidate size (16K, 8K, 4K, 2K) — granular pass/fail for each step (`texImage2D`, `framebufferStatus`, `readPixels`, 2D canvas create, 2D canvas pixel round-trip) so we can see WHICH check is failing at WHICH size
  - End-to-end render+sample test that actually renders through the shader and samples 4 pixel positions plus computes average RGB — catches the "probe passes but export renders black" case
  - Full JSON report (copy-to-clipboard button + selectable textarea fallback for Safari iOS)
- **URL param `?diag`** auto-opens the panel on load — useful when remote-debugging on iPad or other devices without easy devtools access.
- **New module:** `src/shell/diagnostics.js`. **New verbose probe:** `probeMaxFBOSizeVerbose(gl, maxTextureSize)` in `src/engine/gl.js`. **Engine API expansion:** `engine.glContext` (raw GL handle) and `engine.renderToFBOForDiagnostics(state, size)` exposed for diagnostic use.
- **No behavior change** to the existing probe or the chosen `maxFBOSize` — the verbose probe is a parallel implementation, not a replacement. Build 39 is data-gathering tooling; fixes will be planned separately once the cross-device data is in.

---

## v0.2.0 (Build 38) — 2026-05-24

**Hit-test fix for triangle's apex-incident edges.** In Build 37, the rhombus's two apex-incident edges (top-left and bottom-left) appeared as scale arrows but didn't actually fire scale on drag. They fell through to `'move'` mode instead. Root cause: `classifyPointer` measures "distance from the polygon's outer angular boundary," which for a polygon with the slice center at a vertex misses any edge interior to the polygon's angular range. The two apex-incident rhombus edges are *inside* the 60° apex cone, not at its boundary, so they were never within the scale band as measured by the standard logic.

- Added a per-edge perpendicular-distance check in `classifyPointer` (after `polygonRadiusAt`, before CASE A): for any form with `spokeRule: 'none'` AND the slice center coinciding with a polygon vertex, any edge within `SCALE_OUT` perpendicular distance fires `'scale'`. Guarded by `!outsideAngular` so dragging outside the polygon still triggers rotate via CASE B.
- Square is unaffected — its slice center is at the polygon's geometric center (not a vertex), so the `sliceCenterAtVertex` guard fails. Radial and hex are unaffected — they don't use `spokeRule: 'none'`.
- Code: `src/shell/overlay.js` (added ~17 lines in `classifyPointer`).

---

## v0.2.0 (Build 37) — 2026-05-23

**Triangle default-size and orientation tuning for cross-form consistency.** The Build 36 rhombus was correct but visually inconsistent with the other forms — significantly smaller and tilted at 30° while radial and hex sit horizontally. Build 37 makes the triangle's overlay match radial/hex defaults.

- **Rhombus now horizontal.** Fold output rotated by -30° in GLSL (`vec2(cos(t - PI/6), sin(t - PI/6))`), so the long diagonal sits along +X and the rhombus is symmetric across the horizontal axis. Same apex-on-left, wedge-opens-right convention as radial and hex. Kaleidoscope output content rotates by -30° as a consequence.
- **Rhombus matches radial extent.** Fold output magnitude scaled by √3 in GLSL (`r * SQRT3 / TRI_SIZE`), so the far 60° corner now sits at magnitude 1 — same left-to-right reach as radial's polygon (= 0.5 of image width at default `sliceScale`). Kaleidoscope tiles now show √3× more source content per tile; compensate with `sliceScale` if needed.
- **buildPolygon updated** to match the new fold output: corners at `(0, 0)`, `(0.5, -√3/6)`, `(1, 0)`, `(0.5, √3/6)`.
- **`spokeRule: 'hex'` → `'none'`.** All 4 edges are now scale targets. The apex-incident edges (top-left and bottom-left, touching the slice center) can be dragged to scale just like the outer edges.
- **Affordance arrows moved to the 2 topmost edges.** Previously on the two outer edges (top-right + bottom-right after the rotation), which sat close together and overlapped at small sizes. Now on the top-left + top-right edges, which are farther apart geometrically. Selected by sorting all edges by midpoint y and taking the 2 with smallest y.
- **`overlay.js` `drawSourceOverlay`** now treats `spokeRule: 'none'` forms uniformly — all edges go to `outerEdges` regardless of geometric incidence to slice center — so the rhombus's apex-incident edges highlight during scale-drag (previously only outer edges highlighted, leaving the apex-incident edges visually dead during interaction).
- **Code:** `src/engine/forms/triangle.js` (fold output transform + polygon + spokeRule + comments), `src/shell/overlay.js` (edge-split logic + triangle affordance branch).

---

## v0.2.0 (Build 36) — 2026-05-23

**Triangle polygon is the rhombus sample region.** Build 35's full-equilateral-triangle overlay with an internal wedge indicator was based on a wrong analysis of the fold output shape. The actual fold output range is a **60-120 rhombus** (not a 60° pie slice with constant outer radius) — the fold's mirror axes sit 30° offset from the canvas triangle's altitudes, so the max output magnitude varies with fold angle (1/3 at the wedge boundaries, √3/3 at the wedge midline). Build 36 replaces the triangle overlay with this rhombus directly.

- **`buildPolygon`** returns the 4 rhombus corners: `(0,0)`, `(1/3, 0)`, `(1/2, √3/6)`, `(1/6, √3/6)`. The slice center sits at the apex (the `(0,0)` corner), same anchor point as Build 34/35 — no kaleidoscope output change.
- **`spokeRule: 'hex'`** restored. The two apex-incident edges are wedge legs (visual artifacts, not cell boundaries); scale only fires on the two outer edges. Hit-testing for "drag outside the polygon to rotate" is handled by the existing radial-fallback code path.
- **`buildSampleRegion` removed** — the main polygon IS the sample region now. The `buildSampleRegion` plumbing in `overlay.js` is kept as a dormant extension point for any future form whose visual shape differs from its sample region.
- **Affordances** updated: 2 scale arrows on the two outer edge midpoints (perpendicular outward), 1 rotation arc above the topmost vertex. Matches square's "2 of 4 edges shown" convention.
- **Fold function GLSL unchanged.** Kaleidoscope output is byte-identical to Build 35.
- **Code:** `src/engine/forms/triangle.js` (polygon + spokeRule + buildSampleRegion removed), `src/shell/overlay.js` (triangle affordance branch iterates `outerEdges` instead of all edges).

---

## v0.2.0 (Build 35) — 2026-05-22

**Triangle sample-region indicator.** The displayed equilateral triangle is a useful interaction zone but doesn't accurately represent what the kaleidoscope actually samples — the fold output is a 60° wedge that occupies roughly 1/6 of the triangle area and pokes out of the triangle on one side. Build 35 adds an indicator showing the true sample region inside (and partially outside) the triangle.

- **New form-schema field:** `buildSampleRegion(state)` (optional). When a form implements it, the overlay treats the result as a secondary "actual sample region" polygon, drawn alongside the main polygon. Used only by triangle for now; other forms don't need it because their main polygon already equals the fold output range.
- **Triangle:** implements `buildSampleRegion` returning the 60° wedge polygon (apex at slice center, opening 60° in fold space, magnitude up to √3/3). Resolution of 16 arc segments matches radial.js.
- **Overlay rendering:** `drawSourceOverlay` now cuts the dim-background hole for the UNION of the main polygon and the sample region (so the wedge's poke-out beyond the triangle reveals additional source image). Outlines: the main triangle keeps its current style; the sample wedge gets a subtler 1px white outline at 0.7 opacity (informational, not competing with the interactive frame).
- **What stays the same:** interactions (drag edges, drag-outside-to-rotate), touch affordances, hit-testing, OOB indicator, fold function. The kaleidoscope output is byte-identical to Build 34.
- **Code:** `src/engine/forms/triangle.js` (+`buildSampleRegion`), `src/shell/overlay.js` (sample-region computation + union hole-cut + outline).

---

## v0.2.0 (Build 34) — 2026-05-22

**Triangle interaction refinements.** Mental model shifted from wedge-with-apex-at-center (hex-style) to centered-polygon (square-style). Same fold math, same visual affordance language, different polygon geometry and hit-test behavior.

- **Polygon centered.** `buildPolygon` now returns a full equilateral triangle with the centroid at the slice center, apex up on screen. Vertices at circumradius √3/3 to match the fold's natural output scale. Slice origin (the white dot) is now at the visual center of the triangle.
- **All three edges are scale targets.** `spokeRule` changed from `'hex'` to `'none'`. The hit-test logic now treats any edge as a scalable cell boundary (previously only the far edge fired scale).
- **Rotation outside the polygon.** Press-and-drag outside the triangle rotates, matching square's behavior. The previous "outside angular range" model only worked because the wedge didn't span 360° around the slice center.
- **Affordance placement.** New `triangle` branch in `drawTouchAffordances`: three scale arrows perpendicular to each edge midpoint, one rotation arc above the topmost vertex (matches square's "arc above the top edge" convention but uses the apex as the anchor since triangle has no horizontal top edge).
- **Code:** `src/engine/forms/triangle.js` (`buildPolygon` + `spokeRule`), `src/shell/overlay.js` (new triangle branch in `drawTouchAffordances`).

---

## v0.2.0 (Build 33) — 2026-05-22

**Hotfix for Build 32:** triangle form was non-functional in production because the GLSL fold function used a local variable named `centroid`, which is a reserved interpolation qualifier keyword in GLSL ES 3.00. Shader compilation failed, cascading to a broken engine init (upload button and form thumbnails stopped rendering). Renamed the variable to `triCenter` in `src/engine/forms/triangle.js`. No behavior change; only a naming fix to satisfy the GLSL ES 3.00 parser.

---

## v0.2.0 (Build 32) — 2026-05-22

**Triangle wallpaper form (p3m1).** Fourth form in the registry, joining radial, square (p4m), and hex (p6m). Completes the trio of regular wallpaper tilings (square, hex, triangle).

- **Fold math:** D3 fold (3-fold rotation + mirror) around each triangle's centroid. Tiles the plane with alternating "up" and "down" equilateral triangles via a rhombus unit cell. Fold continuity at triangle edges is automatic because edges are mirror axes in p3m1.
- **Overlay:** equilateral triangle wedge with apex at slice center, opening 60°. Far edge is the cell boundary where scale gestures fire; the two apex-incident sides are visual-only via `spokeRule: 'hex'`.
- **Thumbnail:** single equilateral triangle with three altitudes shown — matches the on-canvas wedge shape.
- **Code:** new `src/engine/forms/triangle.js`, one-line registry addition in `src/engine/forms/index.js`. No engine, schema, or overlay changes needed; the form-registry architecture absorbed the new form purely additively.
- Tuning: `TRI_SIZE = 0.6` mirrors hex's tile-density choice; `tilesPerDim = 2.4` is a starting guess for the resolution hint. Both may want adjustment after production review.

---

## v0.2.0 (Build 31) — 2026-04-27

**Affordance geometry precision + pinch highlight fix.**

- **Scale arrows (radial + hex):** placed at the outer boundary using `polygonRadiusAt`, which intersects the polygon path. Previously the arrow floated at an interior point.
- **Arc gap (all forms):** formula changed to `max(R+20, maxVertexDist+16)`, making clearance size-adaptive.
- **Square arc:** moved to above the top edge center (24px gap from edge midpoint), avoiding collision with the scale arrow.
- **Corner arrow (square):** centered on vertex with no additional offset.
- **Rotation arc (all forms):** now bidirectional, with arrowheads at both ends.
- **Pinch highlight:** pinch no longer activates all affordances simultaneously. Outline highlights are drag-mode-aware (`strokeEdges`) and clear on gesture release via `scheduleOverlayDraw` in `onUp`.
- Code: `src/shell/overlay.js` (126 lines changed).

---

## v0.2.0 (Build 30) — 2026-04-27

**Touch affordance geometry fixes + active-state feedback.** Ten issues from post-Build-29 iPad QA.

- **Universal — arc gap** (Issue 1): rotation arc radius changed from `outerPt.d + 10` to `outerPt.d + 20`, giving ~20px of clear space between the arc and the shape edge.
- **Universal — line length** (Issue 2): scale arrow shaft lengthened from 14px to 28px total (`HALF` 7→14); arrowheads now have clear spacing from the shape edge.
- **Universal — active state** (Issue 3): new `env.overlayDragMode` field (set in `onDown`, cleared in `onUp`) drives per-affordance highlighting. Active affordance renders at 100% opacity + 2.5px stroke; inactive affordances dim to 25% during a gesture. Drag modes map: `rotate`/`pinch` → rotation arc, `scale`/`square-edge`/`pinch` → scale arrows, `segments`/`pinch` → spoke lines, `square-corner`/`pinch` → corner arrow.
- **Radial — jitter fixed** (Issues 4, 5): replaced max-distance vertex selection with centroid of all outer edge midpoints. Centroid is the average of all 16 arc-segment midpoints → a stable bisector point that doesn't jump between frames. Scale arrow now placed at the midpoint between center and outer centroid (along the axis of symmetry).
- **Hex — rotation arc placement** (Issue 6): same centroid approach; hex has one outer edge, so centroid = stable outer edge midpoint, not a corner.
- **Square — rotation arc flickering + jitter** (Issue 7): switched from max-distance vertex (all 4 corners equidistant → jumps) to `screenPts[1]` (always the top-right corner in the shape's own folded-space coordinate system → moves smoothly with rotation).
- **Square — corner scale arrow** (Issue 8): new diagonal bidirectional arrow at `screenPts[1] + 8px outward`, oriented along the corner-to-center diagonal. Active when `dragMode === 'square-corner'`.
- **Square — two edge handles** (Issue 9): replaced single outermost-edge midpoint with two fixed edge handles: top edge (`screenPts[0..1]`) and right edge (`screenPts[1..2]`), both visible simultaneously regardless of shape orientation.
- **Landscape layout** (Issue 10): reduced right-panel landscape padding from 34px to 16px.
- Code: `drawTouchAffordances` refactored into two path (square vs wedge) with extracted `afScaleArrow` and `afRotationArc` helpers.

---

## v0.2.0 (Build 29) — 2026-04-27

**Persistent touch affordances.** Three per-form indicators drawn on the source overlay on touch devices only (60% opacity at rest, 25% during active drag).

- **Scale arrow** (all forms): bidirectional arrow perpendicular to the outermost edge midpoint. Signals the outer boundary is draggable for scale.
- **Rotation arc** (all forms): short 22° curved arc with arrowhead just outside the outermost corner, in the zone where the rotate hit region lives.
- **Spoke double-line** (radial only): two thin parallel lines along one spoke edge (20–68% of its length), hinting that dragging near a spoke edge adjusts segment count.

Indicators live in `drawTouchAffordances()` in `src/shell/overlay.js`, called from `drawSourceOverlay` after the polygon outline and center dot. `env.overlayDragging` is set/cleared in `onDown`/`onUp` and used to fade affordances during drag. No changes to hit-testing or existing stroke-highlight feedback.

---

## v0.2.0 (Build 24) — 2026-04-27

**Session undo/redo.** 100-step snapshot history for the kaleidoscope state object.

- New `src/shell/history.js`: two-stack model (undoStack + redoStack). Each entry is a shallow copy of state (all values are primitives). `push` captures pre-action state; `undo` pops undo stack and saves current state to redo stack; `redo` is inverse. New push clears the redo stack.
- Capture points (one push per user interaction, at interaction START): overlay single-touch and pinch drags (`onDown`), native slider (`mousedown` / `touchstart`), scrub field drag (`onPointerDown` via new `onStart` callback), form switch (`buildFormGrid` onclick), OOB mode button, preview canvas pinch (`touchstart`).
- `env.pushHistory()` convenience method on the shared runtime container; `env.updateUndoUI()` keeps button states in sync.
- Keyboard: Cmd+Z undo, Cmd+Shift+Z redo.
- Touch UI: `←` / `→` button pair, 44px targets, absolutely positioned at bottom-center of the preview area (thumb-reachable on iPad). Greyed when at stack boundary.
- Version bumped to v0.2.0 -- undo/redo is a meaningful new surface area, not a patch.

---

## v0.1.2 (Builds 21-23) — 2026-04-27

**iPad touch pass.** Two rounds of improvements based on live iPad testing. No new forms; all changes are touch UX and export reliability.

**Build 23 — pinch pivot fix:**
- Overlay two-finger pinch now uses a proper rotation-around-pivot transform (`apex_new = currentMidUV + R(Δθ) × (startApex - startMidUV)`). Previously rotation and translation were applied independently, which caused wedge shapes to orbit their off-screen apex tip rather than rotating naturally under the fingers. Rectangle forms were unaffected (their apex IS at the visual center), but radial and hex wedges felt disconnected. Now all three forms track correctly during combined scale + rotate + move gestures.

**Build 22 — export probe + pinch refinements:**
- GPU FBO probe now also tests the 2D canvas encoding path. Creates a canvas at each candidate size, writes one pixel, and reads it back. If the browser silently fails (Safari canvas encoding limit), the probe falls back to a smaller size. This is the second line of defense that catches the case where the GPU FBO is fine but `toBlob` would fail.
- Canvas zoom minimum lowered from 0.25 to 0.15 (slider, scrub field, and pinch gesture clamp all updated).
- Overlay two-finger pinch now drives all three transforms simultaneously: spread = slice scale, twist = slice rotation, midpoint movement = slice position. The origin point is no longer locked during pinch.

**Build 21 — touch infrastructure:**
- Divider resize now responds to touch. Mouse and touch handlers share `startDrag`/`moveDrag`/`endDrag` helpers. Hit target widened to ~30px via `::after` pseudo-element.
- Slider thumbs enlarged on coarse-pointer (touch) devices via `@media (pointer: coarse)`: thumb grows from 12px to 24px, row height to 44px.
- Removed the "grip line + rotation dots" touch affordance from the source overlay. It was confusing and only indicated one of several interactive zones. Persistent control-point affordances are deferred to a future session (see BACKLOG).
- Overlay two-finger pinch: scale + rotate the slice. Single-finger drag behavior unchanged.
- Preview canvas two-finger pinch: zoom and rotate the canvas composition. Wired to `canvasZoom` and `canvasRotation` state; slider values update in sync.
- GPU FBO probe (first pass): at engine init, tests each candidate export size (16384, 8192, 4096, 2048) with `checkFramebufferStatus` + `gl.clear` + single-pixel `readPixels`. Stores `diagnostics.maxFBOSize` separately from `diagnostics.maxTextureSize`. Export cap and status messages use `maxFBOSize`. Diagnostics readout shows both values.

---

## v0.1.1 (Build 20) — 2026-04-27

**Github + Vercel readiness.** No engine changes. This build prepares the project for hosting on GitHub and deployment to Vercel.

- Added `LICENSE` (AGPL-3.0, copyright Daniel Nelson)
- Added SPDX headers to entry files (`main.js`, `version.js`)
- Added `README.md` for GitHub viewers
- Added `docs/` folder with `ARCHITECTURE.md`, `CHANGELOG.md`, `BACKLOG.md`, `HANDOFF.md`
- Build counter convention changed: BUILD is now a monotonic global counter that never resets on version bumps. Previous convention reset BUILD to 1 on each version bump; that lost the "how many iterations total" signal.

## v0.1.0a (Build 19) — 2026-04-27

**Four small fixes after first round of testing.**

- Square corner cursor stays diagonal regardless of cell aspect ratio (was: bug where wide rectangles got near-horizontal cursors at the corners). Fix uses sign-based quadrant angle instead of geometric angle.
- Resolution hint formula refactored: per-form `tilesPerDim()` slot on form modules, plus a global 0.5 perceptual softening multiplier. Daniel's calibration test (1080p × square × sliceScale 2 × zoom 1) now reports ~2.1K (was ~3.3K).
- Default export format changed from PNG to JPG (slight compression usually preferred over lossless given the bilinear interpolation already happening in the render).
- Oversized images now throw a clear error pre-upload instead of silently rendering black. The engine pre-checks `gl.MAX_TEXTURE_SIZE` and reports the actual GPU limit.

## v0.1.0a (Build 18) — 2026-04-26/27

**Engine extraction + Vite project.** The original ~3050-line single-file `kaleidoscope.html` was decomposed into a Vite project with a "wide engine" + forms-registry architecture.

- New project structure: `src/engine/`, `src/engine/forms/`, `src/shell/`, single `src/main.js` entry
- Forms registry pattern: each symmetry form is a self-contained module declaring GLSL fold function, per-form uniforms, polygon builder, spoke rule, controls list, file code, thumbnail, filename suffix
- Shader composed at startup by stitching together every form's contribution
- `state.form` changed from numeric index to string id (e.g. `'radial'`, `'square'`, `'hex'`) — future-proofs against form-order changes
- Build counter introduced: `v0.1.0a · Build 1` shown in diagnostics footer
- No behavior changes — pure refactor

## v0.0.x (Builds 1–17) — through April 2026

**Pre-extraction monolith.** All in a single `kaleidoscope.html` file. Rough mapping of changelog entries to builds (some entries may have spanned multiple iterations):

- v0.0.17 — hex spoke-edge scale fix; resolution hint heuristic dialed back
- v0.0.16 — rotate cursor polish; square cursor decoupling; right-panel max-width raised; divider drag rAF-coalescing; resolution hint introduced
- v0.0.15 — square aspect ratio added; rectangular cells; corner/edge drag for non-uniform vs uniform scale; aspect encoded in filename
- v0.0.14 — direct manipulation syncs slider/scrub display back to state; overlay redraw rAF-coalescing; miniCanvas hidden during divider drag; hit zones reworked
- v0.0.13 — rotate hot zone extended to spoke-adjacent regions on radial wedges; rotate cursor redrawn (filled-triangle arrowheads); polygon stroke brightens in scale/rotate hover
- v0.0.12 — export resolution uncapped from source dims (bounded only by `gl.MAX_TEXTURE_SIZE`); 8K + max buttons; rotate cursor angle-aware (16 pre-generated SVG variants)
- v0.0.11 — direct manipulation on slice overlay (move/scale/rotate); cursor changes signal mode on mouse; touch-only visible handles
- v0.0.10 — Pointer Lock API for scrub fields; button hierarchy pass (toggle selections recede so Export reads as the only CTA)
- v0.0.9 — scrub fields on all numeric controls; rotation dials retired; explicit Export button; resize-vector lag fixed
- v0.0.8 — mirror sampling formula corrected (was using complement triangular wave); mirror reflection visualizations clipped to image rect
- v0.0.7 — canvas mid-edge → overlay tip convention; mirror reflection visualization in overlay when wedge crosses image bounds
- v0.0.6 — per-form input normalization inside fold functions; default OOB changed to clamp; dashed amber stroke for OOB wedges; compact form picker
- v0.0.5 — wedge-range fix in foldRadial; rotation matrix convention pinned down; imgDiv + transparent overlay canvas to defeat `.main-slot canvas` background rule
- v0.0.4 — shader-based rendering; FBO export; slot abstraction
- v0.0.3 — three forms (radial / square / hex); slice + canvas attributes
