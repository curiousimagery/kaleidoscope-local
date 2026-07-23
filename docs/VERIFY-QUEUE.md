# verification queue — pending Daniel's hardware

A running list of things built but not yet verified on real hardware / a full desktop session. Claude appends here as it ships device-unverifiable work; Daniel checks off when back on his setup. Remove items once confirmed (or move a confirmed note to CHANGELOG).

Legend: 🖥️ desktop browser · 📺 external display / AirPlay (workstation) · 📱 iOS device · ✅ Daniel confirmed

## open

- **📱 Mobile width regression — ✅ CONFIRMED FIXED by Daniel (B411).** (Left here as a record; can drop next edit. iPhone fills 100% width, no horizontal scroll.)
- (Deferred to BACKLOG, no longer verify-queue items: iPhone record AUDIO + the capture bitrate/perf failures → "Video capture hardening session"; motion 16:9 square-first → polish item.)
- **🖥️📱 Radial wedge segment drag — direction + targets (B409).** (1) Grab either spoke and pull it AWAY from the wedge's middle → the wedge gets fatter (fewer segments); pull toward the middle → skinnier (more segments). Both spokes should feel the same; no inversion. (2) The segment-grab band is tighter now (mouse 20→12, touch 32→20) — confirm you can still grab a spoke intentionally on touch, but accidental segment changes while scaling/rotating are reduced. iPad + iPhone especially.
- **🖥️📱 Droste zoom does NOT seam when animated (Daniel's re-check).** Daniel's earlier "zoom seams" was likely mis-attributed to spiral. Build a Droste animation with different `drosteZoom` values across keyframes and confirm the tween stays seamless (no tier-thickness seam). If confirmed, drosteZoom stays freely animatable (no gate); if it does seam, it joins spiral as non-animatable. Settles the last open parameter in the M3 model.
- **🖥️ Desktop layout reads well down to ~600px (B408).** With the floor lowered 700 → 600, drag the desktop window toward 600px and confirm the split layout still looks right (panels tight but usable) before the horizontal scrollbar kicks in. (Folds into the B407 check below.)
- **🖥️📱 Chrome switch no longer drops the source (B407).** Desktop: load a source, then drag the window narrower than 700px → it should STAY in the desktop chrome (a horizontal scrollbar appears, layout holds at 700px) and keep the footage — no reset. Widen again → scrollbar goes away. Phone: a real phone (or `?chrome=mobile`) should still boot the mobile chrome. iPad should still be desktop chrome. Check the Lab (`/lab.html`) still lays out fine (it shares the min-width floor).
- **🖥️ UI Lab — Loop Builder specimens (B406).** Open `/lab.html` → the Composites section should now show a "Loop Builder interstitial" row: the header (title + X, hover the X), the step rail across done/active/plain/disabled, and the `.ot-btn` access button. Confirm they render from the real classes (match what the running builder looks like). Open the Loop Builder → the app bar should DISAPPEAR (no mode picker, undo/redo, upload, save) and the surface fills the screen. Close via X / cancel → the app bar returns. Confirm you can't switch modes or upload mid-edit. Copy is lowercase (button "loop builder", header "loop builder", rail lowercased). Desktop/iPad.
- **🖥️ D2 — Loop Builder as a modal (B404). Visual + flow verify.** (1) `#modeSelect` no longer lists "loop builder". (2) In motion or perform with a video source, a "Loop Builder" button shows between the mode switcher and undo/redo → click opens the builder. (3) The builder now has a header (title + X top-right) and a cancel button; X and cancel both close it, warning first if you changed the trim. (4) While the builder is open the picker reads the underlying mode (motion/perform), not "loop". (5) Eyeball the header / close / button styling and that the header doesn't crowd the stage. Desktop/iPad. (Header + button now in the UI Lab — B406.)
- **🖥️ Loop detection re-runs on a source swap (B403).** Upload a loop → motion opens loop ON. WITHOUT reloading the app, upload a different clip (a non-loop) → the toggle flips to OFF (and the reverse). I.e. detection isn't stuck on the first clip. (Threshold calibrated at 28 — loops ~2, non-loops ~80; console log removed.)
- **🖥️ Loop detection — capture fix + CALIBRATE (B402). ✅ calibrated (loops ~2, non-loops ~80) — superseded by B403.** Reload a few known loops and a few non-loops. Open the console: each load prints `[loop-detect] meanDiff=… lumFirst=… lumLast=… → LOOP/linear`. (a) If `lumFirst`/`lumLast` are ~0, capture is still black — report it. (b) Otherwise note the meanDiff for real loops vs non-loops, pick a `LOOP_MATCH_THRESHOLD` (source-host.js) that separates them, and report the numbers — I'll set it + remove the log. Then confirm the motion editor opens with loop ON for loops, OFF for non-loops.
- **🖥️ Loop detection + open-into-motion routing (B401). NEEDS CALIBRATION + cross-browser check.** Desktop/iPad: load a fresh video → it should NOT open the Loop Builder anymore; it should land in the MOTION editor. A seamless-loop clip should arrive with loop ON; a non-loop clip (pan / one-way motion) with loop OFF (linear). If the calls are wrong, tune `LOOP_MATCH_THRESHOLD` in `source-host.js` on real clips. Reach the Loop Builder from the mode dropdown (still there until D2). Verify the load path on Safari + Firefox + Brave (seek-based detection + motion-entry). Confirm mobile load is unchanged (lands in still). Confirm loading while ALREADY in motion still rebinds (no re-detect / re-enter).
- **🖥️📱 Drag keyframe to the end in linear mode (B400).** With loop OFF (linear): drag the last keyframe all the way to the right edge → it reaches the true end (no ~0.3s gap / end-stall on playback). With loop ON: the last keyframe should still stop just short of the very end (that spot is the return-to-kf0 loop point). Desktop + iPad.
- **🖥️📱 Motion always loops + loop toggle = "is this a loop" (B399).** Play a motion animation with loop ON → it repeats seamlessly (kf0 return) as before. Toggle loop OFF (linear) → playback still repeats but with a visible cut at the wrap (no more halt / play-once). Confirm on BOTH a still-image animation and a video-source animation, and that HOLD/TAKE/CUT staging playback also loops. The loop button's tooltip reads the new "is this a loop" meaning. Desktop + iPad.
- **🖥️📱 Motion defaults to 16:9 (B398).** Fresh session: enter motion with any source aspect (square / portrait / landscape) → the output frame should default to 16:9. Then change the aspect manually and re-enter motion → your choice sticks (no re-clobber). Desktop + mobile (mobile: the preview should reshape even if the aspect-button highlight lags).
- **🖥️📱 Trim-only → motion editor (B397).** In the Loop Builder, load a video, choose trim-only, adjust the trim handles, apply. Confirm you land in the MOTION editor (timeline + keyframes) with the trimmed range, not back in the still frame-picker. Regression: bounce + slice bakes still drop into motion as before. Desktop + iPad.
- **📺 External display + AirPlay render-from-state regression (B382).** The external-surface poster was refactored (`createSurfacePoster`, transport-neutral). Behavior-neutral by intent. Verify: iPad external display (HDMI) and Apple TV AirPlay still present the program render-from-state at tier resolution, exactly as before. (Daniel away from that setup as of 2026-07-18.)
- **🖥️ Two-reader slice crossfade (B384).** Bake a **slice** loop with a crossfade and confirm the seam no longer drops/pops frames (a fading-out frame snapping back to full opacity). Also just confirm slice + bounce bakes still produce correct loops (regression). Desktop browser (needs WebCodecs — Brave/Chrome/Electron).
- **📱🖥️ Loop Builder mode-as-next + touch transport (B396). UNTESTED.**
  - Step 1: picking a loop mode (trim only / bounce / seamless loop, bottom-right) advances — no separate "next"; back-nav to step 1 shows the previously-picked mode highlighted.
  - **iPad web:** play/pause button + prev/next (left of the timeline) work without a keyboard; prev/next jump to markers (loop ends, trim handles, slice cut on linear steps; ends + seam + crossfade edges on the crossfade step); the play label toggles play↔pause.
  - **Baking mask:** while baking, the black cover fully hides the source (test PORTRAIT + landscape — no footage peeking).
- **🖥️ Loop Builder arc-closing UX (B395). UNTESTED.**
  - **Trim & behavior merged** into step 1 (trim handles + behavior buttons on one step); rail numbers read sequentially; slice = 4 steps, bounce = 2, trim-only = 1.
  - **Tap on the crossfade step moves the playback point** (and selects); the **time ruler scrubs** (click/drag). Space no longer jumps to the start after scrubbing into the A segment.
  - **Bake step shows the real source fps** ("match source (60 fps)") and warns when a setting fabricates data (slowing below source-fps support → "needs frame interpolation"; resolution above source → "won't upscale").
  - Regression check: the merged step 1 still applies trim (trim-only) / advances (bounce, slice); behavior change still reshapes the sequence + undo still walks it.
- **📱🖥️ Loop Builder portrait fix + UX rework + format settings (B394). UNTESTED.**
  - **Portrait bake (iPhone):** load a PORTRAIT iPhone clip → bake a seamless loop → the baked source should be upright + correct aspect (was rotated 90° + stretched). Test slice AND bounce. Also confirm the source panel doesn't overlap the form controls right after the bake→motion drop (no divider nudge needed).
  - **Crossfade timeline:** the band is full-height/prominent, edges drag the duration. Tap a clip → highlight under the timeline + a seam bar through/below the track; drag it (from the seam or underneath) to move that clip's edge. Tap the same clip / tap the band → deselect. Scrubbing still works while a clip is selected.
  - **Output format (Preview & bake):** resolution / fps / speed selects + the live spec readout; bake honors them (downscaled resolution, chosen fps, slomo duration). Confirm 25% on a 30fps source is juddery-but-expected (interpolation is the fix), and clean on high-fps footage.
- **🖥️ Loop Builder point 5 + bounce/fps (B393). UNTESTED — interaction-feel will want tuning.**
  - Crossfade step: **tap the left clip** → an end handle at the seam drags the left clip's end; **tap the right clip** → a start handle drags the right clip's start; **tap the crossfade band** (top half) → drag its edges for duration. Tap = select, drag = scrub still works.
  - Dragging an endpoint: the handle follows the cursor, the split-stage shows both seam frames live, and the strip **reflows on release** (freeze-then-reflow). Value overlay shows on every drag.
  - Confirm the top/bottom split feels right (band on top, clips selectable below); confirm a 90/10 slice's tiny right clip is still grabbable (else revisit the zoom idea).
  - **Bounce bake speed**: a bounce should bake faster than before (forward half fast); confirm the loop is still correct. **fps**: baked loop should match the source rate (a 24/60fps source bakes at 24/60, not 30).
- **🖥️ Loop Builder review pass 2 (B392). UNTESTED.**
  - Mode picker shows "loop" while in Loop Builder (not "still"). Sub-header gone; "XXs of XXs" reads UNDER the clip while trimming.
  - Resize the window on any step — the thumbnail strip + ruler rebuild (no black/clipped cells).
  - Primary button names the current step ("set slice point ›" on the slice step, etc.); last step "bake loop" (no ✦).
  - Crossfade step: B and A are proportional to their real durations (90/10 slice looks 90/10); the yellow band is centered on the true seam; dragging its edges shows a white-on-black duration overlay (no popover).
  - Baking drops straight into motion mode (no "what next?" screen).
- **🖥️ Loop Builder seam-match + dissolve scrub (B391). UNTESTED.**
  - Dragging a crossfade seam edge (step 4) pops the two-frame split (before/after seam) while dragging, then returns to the live preview on release.
  - Scrubbing the timeline THROUGH the crossfade zone shows the blended dissolve (B fading into A), not just one clip; outside the zone it's a clean single frame.
- **🖥️ Loop Builder review pass (B390). UNTESTED — mostly confirmed by Daniel; undo now works.**
  - **No visible playthrough on load** — opening a clip should NOT scrub the stage preview through the whole clip while thumbnails build (now uses a separate hidden video).
  - **Scrubber** works by dragging the timeline on every step (full-clip trim steps, resequenced crossfade step, bake preview) and lands the right frame; parks on the frame if it wasn't playing, resumes if it was.
  - **Space** plays/pauses the preview on every step INCLUDING crossfade (the resequenced loop with the live dissolve) and the bake-preview step.
  - **Primary button** reads the action ("choose loop type ›" / "set slice point ›" / "set crossfade ›" / "preview & bake ›" / "apply trim" / "bake loop ✦"), not "next".
  - **Crossfade band is yellow** and draggable (edge handles) on the crossfade step; **static yellow** (no drag/menu) on the bake-preview step.
  - **"Preview & bake"** step (renamed) shows the TRIMMED, resequenced loop — no cut-off head/tail.
  - **SPLIT-STAGE RETIRED from step 4** (was the two-frame seam-match). Decide: relocate seam-match to the slice-point step, or leave it out?
  - Seam geometry (B389): seam at a true 50%; crossfade region straddles it **asymmetrically** when B≠A (reaches each segment at its own time-scale); clamp = 90% of the shorter segment.
- **✅ Undo/redo in Loop Builder (B389/B390)** — Daniel: "undo seems to work great now" (2026-07-19). Trim/slice/crossfade/behavior edits ride the global history stack.
- **🖥️ Loop Builder timeline rework (B388). UNTESTED — geometry will want tuning.**
  - Footage thumbnails render across the timeline (source clip frames, not the folded output); the time ruler reads right.
  - On the crossfade step the strip resequences to B→gap→A (crossfade in the middle); non-editable blue slice markers at both ends; crossfade region at the seam is selectable.
  - The split-stage's two seam frames still populate correctly (now via the thumbnail seek pass).
  - (B389 made the resequenced halves exactly-equal so the seam is a true 50%, and replaced the crossfade-region width heuristic with real per-segment geometry — verify alongside the seam-drag item above.)
- **🖥️ Loop Builder 2b — the editing-mode conversion (B387). UNTESTED.**
  - App bar stays visible + only upload/mode/undo-redo/settings work; surface sits below the bar (check the `top` offset lands right — it's measured from the toolbar height).
  - Mode picker is the exit; switching modes or uploading a new clip warns on unsaved changes and backs out on cancel; uploading resets the process.
  - Space plays/pauses the preview (no longer fires "bake"); crossfade −/+ steppers + prominent value work.
  - Cancel/close buttons are gone.
- **🖥️ Loop Builder iteration 2 — the stepped mode (B386). UNTESTED.**
  - Full-screen surface (not a popover), left step rail, progressive disclosure: Trim → Behavior → [Slice → Crossfade] → Bake; slice-only steps appear only for seamless loop; back-nav until bake; rail jumps between reached steps.
  - Split-stage crossfade seam match on step 4: LEFT = last frame before seam, RIGHT = first after; dragging OUT updates left, IN updates right, in realtime.
  - Crossfade region on the bar → click to select → contextual menu (duration + remove); inline duration scrub on the step panel.
  - Keyframe-shift warning when entering with existing keyframes (explicit entry only).
  - All four behaviors bake correctly (trim only / bounce / seamless loop) and the post-bake nudge still routes.
  - Feel/polish feedback expected — this was built without runtime testing.
- **🖥️ Loop Builder integration, iteration 1 (B385).**
  - Selecting **"loop builder"** in the mode menu opens the Loop Builder sheet (and the picker snaps back to the real mode).
  - Loading a **video** in still mode auto-opens Loop Builder.
  - After a **bake**, the next-step nudge appears (render & save · edit in motion · perform · done for now) and each routes correctly (save opens the export sheet; motion/perform switch modes; done closes).
  - The overflow-menu "loop builder…" entry still opens it.

## recently confirmed (safe to prune)

- **✅ Camera UX (B379–B381)** — Daniel: "camera UX is looking good and working as expected" (2026-07-18). Stop-recording finishing state, capture-then-freeze, resolution/deep-fusion toggle. (One residual worth a glance: does "49MP · deep fusion" return a true ~49MP still, and how does `.speed` low-light quality read.)
- **✅ Output window (B382/B383)** — Daniel smoke-tested in Brave (works); checking the new close-with-main-window behavior (B383) now.
