# Lane 4B — lifting the readback ceiling (proposal + decision framework, 2026-07-15)

**The problem, quantified (Daniel's device passes):** every live-output consumer (record-to-disk, NDI, Syphon) pays a per-frame CPU readback — render → drawImage GL→2D → getImageData. On Blink that's cheap (Brave records 50fps+). On WebKit it's the wall: iPad record ~15fps FHD, iPad/iPhone NDI ~25fps FHD, Safari desktop ~5fps. The self-rendering destinations (HDMI/AirPlay/output window) skip readback entirely and fly at 4K — proof the render isn't the cost, the readback is.

## Tier 1 — a faster JS readback (cheap, decided by the B362 bench)

The diagnostics sheet's **"benchmark readback"** button now measures every candidate on the running device (checksum-validated so a fast-but-corrupt path can't win):

- **A `readPixels`** — legacy path; historically CORRUPTS on WebKit (why drawImage exists). The bench re-validates on current iOS.
- **B `getImageData`** — today's path, the baseline.
- **D `createImageBitmap`** — transport-only number (worker hand-off candidate).
- **C1/C2 `VideoFrame` → `copyTo`** — the WebCodecs candidates (2D-canvas source = "Safari-safe"; GL-canvas direct = fastest historically but froze iPadOS once at Build 115; run last, console-breadcrumbed). Note the reported pixel FORMAT: BGRA means sinks need either copyTo-conversion or format-tagged frames (NDI accepts BGRA natively; Syphon/recorder assume RGBA).

**RESULTS ARE IN (Daniel, 2026-07-15, FHD avg-15):**

| path | iPad (native+web) | Safari desktop | Brave | Electron |
| --- | --- | --- | --- | --- |
| B getImageData (shipping) | 19.4ms | 45.5ms | 6.6ms | 4.1ms |
| A readPixels | **5.7ms ✓checksum** | 42.8ms | 47ms | 45ms |
| C2 VideoFrame(GL)+copyTo | 5.3ms (BGRA) | **2.7ms** | 3.7ms | 3.4ms |
| D createImageBitmap | 0.4ms | 0.3ms | 0.2ms | 0.0ms |

Folklore overturned: readPixels **no longer corrupts** (checksums match everywhere) and VideoFrame(GL) **no longer hangs iPadOS**. The winner differs per DEVICE, not per engine family (readPixels: 5.7ms on iPad, 43–47ms everywhere else!) — so **Tier 1 shipped (B363) as a probe-once RUNTIME selection**: on the first bus frame, each candidate runs against the just-rendered buffer, checksum-validated against getImageData, fastest valid path carries the session (console-logged; `?buscapture=` override). BGRA VideoFrames convert via copyTo({format:'RGBA'}) where supported, else an in-place u32 swizzle. The GL→2D blit stays on every path so the recorder keeps its frame.canvas fast lane. Expected: iPad readback 19.4→~5.7ms (record/NDI fps roughly doubles), Safari 45.5→~3ms.

## Tier 2 — the WebCodecs recorder (independent of Tier 1, fixes the freezes)

Record-to-disk's other ailments (Safari/iPad mid-take FREEZES, WebM on Chromium, MediaRecorder pacing) all bypass: **VideoFrame → VideoEncoder → mp4-muxer** — the exact pipeline `shell/video-export.js` already runs for motion export, repurposed for live takes. Hardware encode, mp4 everywhere WebCodecs lives, no captureStream. Open question: AUDIO (motion export is silent) — either WebCodecs `AudioEncoder` (AAC) muxed alongside, or a parallel audio-only MediaRecorder muxed after. Sized as its own increment.

## Tier 3 — true native capture (only if Tiers 1–2 disappoint)

Honest constraints on iOS: there is **no public API to capture another WKWebView's GPU surface** zero-copy. The real options, none free:
- **ReplayKit** captures the whole screen (chrome included, permission dialog, not the clean program) — wrong shape.
- **Plugin-owned webview + snapshot APIs** — CPU composite, likely no faster than Tier 1.
- **WebRTC to a native peer** — real, but a heavyweight dependency and re-encode.
- **The long game**: the conduit contract's per-host capture — a native Metal renderer of the committed state (the engine re-implemented outside the webview) is the only zero-readback iOS capture, and that's a much bigger project than 4B.

**Recommendation:** Tier 1 (bench → swap-with-validation) then Tier 2 (WebCodecs recorder). Tier 3 stays parked unless both underdeliver.

## Post-compact sequencing (Daniel's call, 2026-07-15)
1. Daniel runs the bench (iPad + Safari + Brave + Electron), pastes numbers.
2. Tier 1 implementation per the winner; re-measure record + NDI fps.
3. Tier 2 WebCodecs recorder (also resolves the audit's freeze bugs + WebM gripe).
4. Then Lane 5 (graceful device degradation) + the video-save UX convergence (AUDIT-video-save-ux.md).
