# verification queue — pending Daniel's hardware

A running list of things built but not yet verified on real hardware / a full desktop session. Claude appends here as it ships device-unverifiable work; Daniel checks off when back on his setup. Remove items once confirmed (or move a confirmed note to CHANGELOG).

Legend: 🖥️ desktop browser · 📺 external display / AirPlay (workstation) · 📱 iOS device · ✅ Daniel confirmed

## open

- **📺 External display + AirPlay render-from-state regression (B382).** The external-surface poster was refactored (`createSurfacePoster`, transport-neutral). Behavior-neutral by intent. Verify: iPad external display (HDMI) and Apple TV AirPlay still present the program render-from-state at tier resolution, exactly as before. (Daniel away from that setup as of 2026-07-18.)
- **🖥️ Two-reader slice crossfade (B384).** Bake a **slice** loop with a crossfade and confirm the seam no longer drops/pops frames (a fading-out frame snapping back to full opacity). Also just confirm slice + bounce bakes still produce correct loops (regression). Desktop browser (needs WebCodecs — Brave/Chrome/Electron).
- **🖥️ Loop Builder timeline rework (B388). UNTESTED — geometry will want tuning.**
  - Footage thumbnails render across the timeline (source clip frames, not the folded output); the time ruler reads right.
  - On the crossfade step the strip resequences to B→gap→A (crossfade in the middle); non-editable blue slice markers at both ends; crossfade region at the seam is selectable.
  - The split-stage's two seam frames still populate correctly (now via the thumbnail seek pass).
  - Known-approximate: seam sits at ~50%, crossfade-region width is a heuristic, thumbnail cell sizing may over/underflow the track — all expected to need your eye.
  - HELD: realtime drag-to-adjust the seam on the resequenced step-4 timeline (handles hide there for now).
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
