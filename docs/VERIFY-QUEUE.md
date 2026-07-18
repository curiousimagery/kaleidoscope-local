# verification queue — pending Daniel's hardware

A running list of things built but not yet verified on real hardware / a full desktop session. Claude appends here as it ships device-unverifiable work; Daniel checks off when back on his setup. Remove items once confirmed (or move a confirmed note to CHANGELOG).

Legend: 🖥️ desktop browser · 📺 external display / AirPlay (workstation) · 📱 iOS device · ✅ Daniel confirmed

## open

- **📺 External display + AirPlay render-from-state regression (B382).** The external-surface poster was refactored (`createSurfacePoster`, transport-neutral). Behavior-neutral by intent. Verify: iPad external display (HDMI) and Apple TV AirPlay still present the program render-from-state at tier resolution, exactly as before. (Daniel away from that setup as of 2026-07-18.)
- **🖥️ Two-reader slice crossfade (B384).** Bake a **slice** loop with a crossfade and confirm the seam no longer drops/pops frames (a fading-out frame snapping back to full opacity). Also just confirm slice + bounce bakes still produce correct loops (regression). Desktop browser (needs WebCodecs — Brave/Chrome/Electron).
- **🖥️ Loop Builder integration, iteration 1 (B385).**
  - Selecting **"loop builder"** in the mode menu opens the Loop Builder sheet (and the picker snaps back to the real mode).
  - Loading a **video** in still mode auto-opens Loop Builder.
  - After a **bake**, the next-step nudge appears (render & save · edit in motion · perform · done for now) and each routes correctly (save opens the export sheet; motion/perform switch modes; done closes).
  - The overflow-menu "loop builder…" entry still opens it.

## recently confirmed (safe to prune)

- **✅ Camera UX (B379–B381)** — Daniel: "camera UX is looking good and working as expected" (2026-07-18). Stop-recording finishing state, capture-then-freeze, resolution/deep-fusion toggle. (One residual worth a glance: does "49MP · deep fusion" return a true ~49MP still, and how does `.speed` low-light quality read.)
- **✅ Output window (B382/B383)** — Daniel smoke-tested in Brave (works); checking the new close-with-main-window behavior (B383) now.
