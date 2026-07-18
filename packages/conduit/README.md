# conduit

Generalized **broadcast infrastructure**: committed program frames from ANY signal-producing engine — visual (Fold's kaleidoscope), audio-reactive processors, music visualizers, generative systems, mini-games — fanned out to every destination: HDMI/external displays, output windows, Syphon, NDI, record-to-disk. A consumer app supplies an engine adapter and a host, and reuses the conduit verbatim. It never rebuilds device/browser capability detection, encoder discovery, or the broadcast transports.

**New consumer? Read this file top to bottom, then look at Fold's `src/shell/fold-adapter.js` and `src/output-view.js` as the reference implementations.** This is the whole contract.

## the handshake (what a consumer does)

Four steps take a moving-image engine from "renders to a canvas" to "records + broadcasts everywhere":

1. **Implement the engine adapter** ([src/engine-adapter.js](src/engine-adapter.js)) — the ONE contract between conduit and your renderer:
   - **Universal tier** (required): `engineId` and `renderFrameAt(w, h) → Frame`. `renderFrameAt` renders one frame at the requested size and returns `{ pixels /* RGBA Uint8Array, bottom-up */, w, h, topDown, canvas?, renderMs, readMs }`. This drives record-to-disk, Syphon, and NDI (they need CPU pixels). `renderMs`/`readMs` feed the diagnostics.
   - **Perform tier** (optional): `getState()` / `applyState(s)` / `tween(a, b, t)` — unlocks program/preview split and staged transitions. Skip it if your app has no addressable state.
2. **Pick a host** ([src/host.js](src/host.js)) — the native-services seam (`syphon`, `ndi`, `fileSystem`, `externalDisplay`, `mediaDecoder`, `nativeCamera`, …), each behind `.available` so you degrade gracefully. `webHost` (exported here) is the browser no-op baseline; Electron/Capacitor shells inject their own.
3. **Create the bus + register sinks**: `createOutputBus({ engineAdapter, host, diag })`, then `registerSink()` the destinations you want (`conduit/recorder`, `conduit/ndi-sink`, `conduit/syphon-sink`, and your external surface — see below).
4. **`start()`** — the bus runs one paced render loop and fans each frame to every sink. On plain web with just the recorder, that's recording with zero native code.

## who owns what: resolution, aspect, bitrate, fps

The division is: **conduit owns the mechanism and the policy; the consumer owns the choice and the UI.** This is the part most worth understanding to "optimize your render process."

- **Output resolution + aspect** — the bus holds `width`/`height`/`aspect` as its own state (deliberately decoupled from your display canvas and from any export path). You call `bus.setResolution({ width, height })` from your own UI; the bus then drives `renderFrameAt(w, h)` and hands that one frame to every sink, so they can never disagree. **Aspect is derived** (`width / height`) — you pick dimensions, aspect falls out. Your obligation: `renderFrameAt` must render correctly at whatever size the bus asks. You decide which sizes to *offer*; the bus is the single source of truth for what's *live*.
- **Bitrate** — NOT a per-consumer knob today; it's a conduit **policy** in [src/encode.js](src/encode.js): `videoBitrateFor` ≈ 0.1 bits/pixel/frame, clamped 4–120 Mbps, computed automatically from resolution × fps at record time, alongside codec discovery (`pickVideoCodec` — H.264 ≤4K, HEVC above). One place decides what's encodable and at what rate, so a live recorder and an offline exporter can never drift. You get a sensible bitrate from the dimensions you chose. (It can become an override the day a consumer needs a quality slider.)
- **fps** — the bus doesn't *set* it. It paces to render-rate (the rAF cadence, capped by how fast `renderFrameAt` returns), *measures* achieved fps, and reports it in the diagnostics op-records. Bitrate uses that fps. fps is an outcome, not an input.

**Optimize your render by making `renderFrameAt` cheap at the requested size**, and by using the fastest pixel-readback path for your platform — which conduit already solves for you (see `conduit/capture`, the probe-once adaptive readback). Fold keeps *three* distinct resolution domains — the on-screen display canvas, the live-output bus (conduit's), and still/video export — don't conflate them; conduit owns only the middle one.

## external surface — secondary displays (output window / HDMI / AirPlay)

The fast way to drive a second display is NOT to read back the finished frame and ship pixels (that's the readback wall, paid per frame). Instead the second surface runs **its own engine instance** and receives only the small committed `state`, re-rendering locally — zero readback, smooth to 4K.

`conduit/external-surface` → `createSurfacePoster({ transport, content, renderCaps?, sourceCaps?, onClosed? })` owns the transport-neutral spine: the per-frame state stream, source-repost-on-change, the hello/fps handshake, the arm/begin/end lifecycle, and an optional degradation ladder. You supply:
- **`transport`** — `{ post(msg), isClosed?() }`. It's the host-specific pipe: a same-origin `BroadcastChannel` to a popup (desktop), or a native bridge into an external WKWebView (iOS). You open/close the surface (so you control when `begin()` runs, e.g. after a native start resolves).
- **`content`** — `{ getState(), getOutputDims({cap}), getVideoSync?(), getTest?(), sourceSignature(), buildSourcePayload({sourceCap}) }`. Your engine + your **per-source-kind acquisition** (the second view must obtain its source independently — a bitmap sent once, its own decode of the same URL, a second client on a live source socket — never by reading back the primary's output).

**Render-from-state is the recommended and only-shipped pattern; `src/output-view.js` in the Fold repo is the reference view.** A consumer whose per-frame state is as large as the frame itself can publish *frames* over the same transport instead — no conduit fallback to maintain; it's just a different payload on the pipe.

## modules

| module | what it is |
| --- | --- |
| `conduit/output-bus` | the live-output fan-out: one paced loop renders committed frames through the engine adapter and feeds every sink; owns resolution/aspect + measured fps |
| `conduit/engine-adapter` | the adapter contract (doc + `hasPerformTier`) |
| `conduit/host` | the host-services contract + `webHost` no-op baseline |
| `conduit/mock-host` | `mockSyphonHost` — exercises the broadcast path on plain web (`?mocksyphon`) |
| `conduit/commit-cell` | single-writer latest-value cell `{value, gen, t}` — the program-snapshot discipline (payload-opaque) |
| `conduit/capture` | probe-once adaptive readback — the per-device fastest pixels off a GL canvas (getImageData / readPixels / VideoFrame), checksum-validated |
| `conduit/encode` | WebCodecs codec + bitrate discovery (video + audio), shared by the live recorder and offline exporters |
| `conduit/recorder` | record-to-disk sink (WebCodecs → mp4 with proving probes + MediaRecorder fallback + `lastResult`) |
| `conduit/ndi-sink` | NDI publish sink (via `host.ndi`) |
| `conduit/syphon-sink` | Syphon publish sink (via `host.syphon`) |
| `conduit/frame-wire` | the FNDI frame-socket protocol (header, backpressure, top-down + UYVY packing) shared by native transports |
| `conduit/external-surface` | the secondary-display poster core (render-from-state, transport-neutral) — see above |
| `conduit/test-pattern` | the output view's connect-time reference frame |
| `conduit/hosts/*` | optional native host packages a shell adds per platform (`electron-ndi`, `capacitor-ndi`) |

Import subpaths directly (`conduit/output-bus`) so each bundle stays lean; the barrel (`conduit`) exists for spikes and harnesses.

## the two-home model (canonical repo + embedded copy)

The canonical standalone repo is **github.com/curiousimagery/conduit** (private). Fold embeds the package at `packages/conduit` and consumes it as a `file:` dependency — deliberately, so Vercel deploys and fresh clones never need remote auth for a private git dependency. The embedded copy is the working copy; publish changes to the canonical repo with:

```sh
git subtree push --prefix packages/conduit git@github.com:curiousimagery/conduit.git main
```

Second tenants (Tap, …) consume the canonical repo directly (`"conduit": "github:curiousimagery/conduit"`; their installs authenticate as Daniel, or the repo goes public when that's decided). If the repo is ever made public or published to a registry, Fold can switch its one dependency line to match — no import changes either way. NOTE: the bare name `conduit` exists on the public npm registry (an unrelated legacy package) — if registry publishing ever happens, scope it (`@curiousimagery/conduit`).

Rendering note: this layer changes NO rendering. How a committed frame is *produced* is per-host; the conduit only defines the contract and the fan-out.
