# Sub-plan — Shared-socket video (single native decode → both webviews)

## Why
iPad HDMI + video = two WKWebViews, each opening its own `<video>` decoder (main
engine + output-view.js:163). At 4K/6K that trips iOS jetsam → lost GL context →
unrecoverable. Today's mitigation is a 1080p cap (B480). Root fix: decode the clip
ONCE natively, fan frames to both views over a localhost socket — exactly how the
native camera already reaches the external display.

## What's already built (de-risks this hugely)
- **Consumer:** `src/shell/native-camera-receiver.js` joins `ws://127.0.0.1:<port>`,
  decodes the `FYUV` wire format, paints an RGB canvas "the engine samples like any
  drawable." `port` is already a parameter. Generic except its name.
- **YUV→RGB blit:** `src/shell/yuv-renderer.js`.
- **Socket + encoder:** `FrameSocketServer.swift` (camera plugin) — one-way, multi-client,
  drop-not-queue realtime discipline, **static `encode(CVPixelBuffer)`** producing FYUV.
  Reusable verbatim on a new port.
- **External-view seam:** output-view.js has a `camera` payload branch doing
  `engine.setSource(camera.frameSource())`. A `video-native` branch mirrors it.

So the real new work is the **native producer** + the **source-swap/transport**, not
the plumbing.

## Wire contract (unchanged)
`FYUV` header + Y plane + interleaved CbCr, pixel format
`420YpCbCr8BiPlanarFullRange`. `AVPlayerItemVideoOutput` is configured to hand back
exactly that, so `FrameSocketServer.encode` and the JS receiver need zero changes.

## Stages
- **S2 (this increment) — native video producer.** New Capacitor plugin
  `fold-native-video`: `AVQueuePlayer` + `AVPlayerLooper` (seamless loop) +
  `AVPlayerItemVideoOutput` + `CADisplayLink`; on each new pixel buffer, encode off
  the main thread and `send`. Reuses `FrameSocketServer` verbatim on port **8900**.
  Transport: `start({path,loop})` / `stop` / `pause` / `resume` / `seek({time})` /
  `setRate({rate})`. Additive — nothing wired yet, so zero regression to the working
  `<video>` path. **Verify (Daniel, Xcode): compiles; a smoke caller decodes a clip
  and serves FYUV at 4K with stable memory** before we rip out `<video>`.
- **S3 (next) — source-swap + transport bridge (iOS-only).** In `loadVideo`
  (source-host.js:156) add an iOS-native branch: stage the file to a temp path
  (Capacitor Filesystem), `FoldNativeVideo.start`, point BOTH the main engine source
  AND output-view.js (`video-native` branch) at a receiver on 8900. Drop the second
  `<video>`, remove the 1080p cap for this path. Motion/perform transport (play/loop/
  seek/rate) drives the plugin instead of `<video>.currentTime`. **JS `<video>` stays
  the fallback** when the plugin is absent/errors (web, Electron, and iOS failure).
  Single decode ⇒ the two views are inherently frame-synced.
- **S4 (later, optional) — Electron parity.** Same consumer seam, a JS shared-frame
  producer (decode in main window, post frames to the external window) — no native
  decoder needed there. Not this arc; the seam is producer-agnostic so it's drop-in.

## Risk
Moderate, contained: S3 replaces the working iOS video path (the most cross-browser-
sensitive layer), so it's iOS-only, behind the source abstraction, with the `<video>`
fallback intact. S2 is pure addition. Perf watch: encode at 4K per frame — done off
the main thread; `wantsFrame()` skips when no client is ready.
