# Sub-plan — Shared-socket S3-A (native decode owns the motion clock)

Daniel greenlit design **A** (2026-07-31). This is the wire-up of the S2 native
producer (`fold-native-video`, shipped B486) into the app so a video clip is
decoded ONCE natively and both webviews (main engine + external HDMI view) render
from it — killing the iPad double-decode crash and lifting the 1080p cap.

## The load-bearing discovery (why this isn't a camera-mirror)

The camera works over the socket because it's **clockless** (a live stream). Video
in motion mode is the opposite: **the `<video>` element IS the motion runtime's
master clock.**
- Every frame motion derives progress from the playhead: `p = (v.currentTime - inSec) / span` (motion-runtime.js:377), then samples animated params at `p`.
- It WRITES the playhead for scrub (`v.currentTime = pToMediaSec(...)`, :368), trim-rewind (:374-375), and retime (`v.playbackRate`, :370).
- The external view keeps its own `<video>` synced to the program clock `{t,paused,rate}` (external-display.js:257, output-view.js:221).

A socket-fed canvas has no `currentTime` and can't be seeked, so a naive swap breaks
scrub/trim/retime/p-derivation. Design A resolves this by making the **native decode
own the clock** and exposing it back to JS.

## Clock touch-point audit (the "don't miss a spot" surface)

Relevant to the broadcast path (route these through the seam):
- `motion-runtime.js` — ~28 sites (main play loop :357-377; staging copy `v2`/`stg.video` :648-682; retime :92-93; thumbnails :1049; pause :335/:1417).
- `perform-runtime.js` — ~10 sites.
- `output-view.js` — ~7 sites (external sync :214-225).
- `external-display.js` `getVideoSync` :257-260.

OUT of scope (stay on `<video>`): `clip-editor.js` ~50 sites — that's Loop Builder
**authoring**, not the HDMI broadcast path. Leaving it on `<video>` shrinks the
surface and de-risks. (Note: the staging copy `v2` may also stay `<video>` if it's
only used off the broadcast path — decide during build.)

## Design

1. **PTS in the wire.** Extend the frame the native producer sends with its
   presentation timestamp so the receiver can report `currentTime()` without a
   per-frame bridge round-trip. Do it WITHOUT breaking the camera receiver that
   shares the `FYUV` format — either a new magic (`FYUW`?) with an 8-byte f64 PTS
   after the existing header, or a parallel field the camera path ignores. Update
   `FoldNativeVideoPlugin` encode + a video-aware receiver decode.
2. **`sourceClock` seam.** One small abstraction: `{ get time(), get duration(),
   get paused(), seek(t), setRate(r), play(), pause() }`. Two implementations:
   `<video>` (today, byte-for-byte current behavior) and the native receiver
   (time from latest PTS; seek/rate/play/pause → `FoldNativeVideo` bridge calls).
   Route every audited clock site through it.
3. **`createNativeVideoSource(env)`** (new `src/shell/native-video.js`) — the
   interface-compatible sibling of `native-camera.js`: stage the clip to a temp
   file, `FoldNativeVideo.start({path, loop})`, open the socket, paint YUV→RGB
   canvas (`yuv-renderer.js`), `frameSource()` returns the canvas, plus the
   `sourceClock` transport. Duck-types as a drawable like the camera.

   **BYTE TRANSPORT — DECIDED 2026-07-31 (Daniel): a BINARY UPLOAD SOCKET, not
   base64-over-bridge.** `AVURLAsset` needs a file on disk and a WKWebView
   `<input type=file>` File has no native path, so the bytes have to move. The
   webview streams raw `blob.slice()` chunks over a localhost WebSocket into the
   plugin, which appends them to a temp file and resolves a path. Why this one:
   the bridge path (the sub-plan's original assumption) is the SAME slow transport
   that caps external-display staging at ~2GB today (Daniel's 6min-4K clip can't
   even start), whereas the socket measures ~165MB/s on the NDI path (~12s for
   2GB) with peak memory of one chunk. It also covers **Loop Builder baked clips**,
   which are Blobs that never existed as files — a native file picker (the
   zero-copy option, considered and deferred) structurally cannot. Reuses the
   Network.framework infra already in the plugin; no import-UX change.
   Zero-copy-via-native-picker stays available later as a fast path for imports.
4. **`loadVideo` branch** (source-host.js:156): iOS-native + plugin available →
   native source instead of `<video>`; else the existing `<video>` path (fallback).
5. **External view** (output-view.js): a `video-native` payload branch mirroring the
   existing `camera` branch (`engine.setSource(receiver.frameSource())`) on port
   8900, so it drops its own `<video>`. `buildSourcePayload` emits `kind:'video-native'
   ,port` on the native path.
6. **Remove the cap on the native path** (external-display.js effCap): no second
   `<video>` → no double-decode → the 1080p guard is unnecessary; render native.

## Safety + verification discipline (Daniel's explicit ask)

- **Capability-gated with `<video>` fallback** — if the plugin is absent or native
  seek proves inadequate, degrade to today's behavior. Worst case = no improvement,
  never a broken state.
- **Use-case test matrix on device** (Daniel drives; Claude is device-blind):
  play · seamless loop (the loop-point pause should vanish) · trim in/out · scrub ·
  retime (videoSpeed) · motion vs perform · source-swap mid-motion · 4K-over-HDMI
  endurance + memory · fallback path (plugin off) still works. Verify each explicitly.
- **The one genuine unknown:** whether AVPlayer seek is fast/accurate enough for
  interactive scrub and per-loop rewind. Measure early; if scrub lags, it's a UX
  regression on that interaction (not a crash), and the fallback bounds it.

## Staging order (each its own build + four-part ritual)
1. ✅ **SHIPPED B490** — PTS wire + video-aware receiver (additive; camera unaffected).
   `"FYUW"` = FYUV header + f64 pts + f64 duration, planes at offset 40, video socket
   only; `native-camera-receiver.js` → `native-frame-receiver.js` reads both magics and
   exposes `pts`/`duration`, advancing the clock **on paint** (the reader gets the time
   of the frame actually on screen).
2. ✅ **SHIPPED B493** — `sourceClock` seam + routed reads/writes (behavior-neutral on
   `<video>`; desktop-verifiable). `createVideoElementClock` in shell/video-source.js;
   `env.sourceClock` resolved through a getter. Routed: motion play loop/retime/
   trim-rewind/scrub/duration-lock/halt, perform transport/tick/ruler/speed/exit,
   `getVideoSync` in external-display + output-window. Left on `<video>` by design:
   filmstrip + footage-thumb builders, and staging's `stg.video`.
   **⚠️ OPEN CALL FOR STAGE 3 — motion staging implies a SECOND decode.**
   `stgStartVideo` opens its own `<video>` on the same clip so the committed loop can
   sit at a different playhead than the edit scrub, and `env.programVideo()` puts that
   copy on the broadcast path. Under ONE native decode there is one playhead: hold/take
   over a video source either gives up the independent staged position, or gets a second
   native decode (which partly re-opens the memory problem we're solving). Daniel decides
   before the source swap is wired.
3. `createNativeVideoSource` + the binary upload socket + `loadVideo` branch (main view on native, fallback intact).
4. output-view `video-native` branch + `buildSourcePayload` + drop the cap (external view on native; the crash fix completes).
5. Endurance + the full matrix.
