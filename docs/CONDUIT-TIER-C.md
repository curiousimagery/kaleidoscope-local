# conduit Tier C — the external-surface abstraction (design, 2026-07-18)

Tier C is the last broadcast-infrastructure move into conduit: **secondary display surfaces** (iOS external display, AirPlay, desktop output window). Unlike tiers A/B this needed design first, because the thing on the second surface — the render — is engine-specific, so we have to draw the line between what conduit owns and what a consumer owns before any code moves.

This doc settles that line. Scope: the external-surface plumbing. Explicitly OUT of scope and deferred: capture-domain detection (see the last section).

## the core decision: conduit owns a transport-neutral pipe, not a renderer

The naive second-display path reads the finished frame off the primary GPU every tick and ships those pixels. That readback + transfer is the wall — the same cost that caps NDI fps, paid again per frame. Fold avoids it: the second surface runs its **own** engine instance and receives only the tiny committed `state` (a few hundred bytes), re-rendering locally. Zero readback; smooth to 4K in any browser and over the native bridge.

The design question was whether conduit should (A) require every consumer to render-from-state, or (B) also maintain a frame-push fallback for engines that can't. The answer is **neither as a binary** — conduit owns a **transport-neutral pipe**:

- **conduit owns the plumbing** — the secondary-surface lifecycle, a message channel, a hello/fps handshake, context-loss recovery. It knows *nothing* about rendering.
- **the consumer owns the view** — render-from-state is the recommended and only-shipped pattern (`output-view.js` is the reference). It's a consumer responsibility, not conduit code.
- **frame-push stays possible** as a consumer choice: a consumer that can't render-from-state publishes *frames* over the same channel and blits them. This needs **zero conduit fallback code** — it's just a different payload on the pipe (and the readback machinery to produce those frames already lives in `conduit/capture.js`).

This gives maximum simplicity (conduit has no rendering knowledge), protects performance (the shipped pattern is state-based), and forecloses nothing — because the one realistic frame-push case (a visualizer whose per-frame state is as large as the frame itself) was never conduit's to hold.

## what a consumer is responsible for

Two distinct contracts, already partly shipped:

1. **Output bus** (record / NDI / Syphon — SHIPPED): implement the engine adapter `renderFrameAt(w, h) → { pixels, w, h, topDown, canvas?, renderMs, readMs }`. One render, fanned to every sink.
2. **External surface** (Tier C): provide a **render-from-state view** — the engine instantiated in a second context, driven by the committed-state stream — AND an **independent source-acquisition path per source kind**. The second view must obtain its source WITHOUT reading back the primary's output. Fold's `output-view.js` shows all the cases:
   - **still image** — sent once as a bitmap/dataURL.
   - **loaded video** — the view opens its own `<video>` on the same URL, loosely clock-synced.
   - **live camera** — web opens its own `getUserMedia` on the same `deviceId`; native joins the camera frame socket as a *second client*. Either way the source is obtained at the source, never via output readback.

Part (b) is the real work a consumer signs up for. For a zoetrope (small state, cheap SVG sources) it's trivial; for a visualizer with huge per-frame buffers it may be the reason to choose frame-push instead.

## the conduit contract (sketch)

```
createExternalSurface({ host, channelName }) → {
  open(target)          // desktop: BrowserWindow/popup · iOS: UIScreen/plugin webview
  post(message)         // ships a message to the view (state, source, output, test, close)
  onUp(cb)              // hello / fps / glLost / glRestored from the view
  fps                   // last reported view fps
  close()
}
```

- **Transport is host-provided.** Desktop uses a same-origin `BroadcastChannel`; iOS uses the external-display plugin's script-message bridge (`BroadcastChannel` can't cross WKWebViews). Both already exist in Fold — conduit picks the right one from `host`.
- **The message shapes are the pipe's vocabulary**, not conduit's business: `{type:'state', state, output, video?, test?}`, `{type:'source', payload}`, `{type:'close'}` upstream; `{type:'hello'|'fps'|'glLost'|'glRestored'}` downstream. Conduit relays them; the consumer's view interprets them.
- **The handshake** (`hello` → re-post current source; fps reporting; context-loss recovery) is conduit's, because it's identical for every consumer.

## what moves, and what stays

From Fold today:
- **Moves to conduit** (the plumbing): the surface lifecycle + transport selection + handshake currently spread across `src/shell/output-window.js` (desktop popup mgmt), `src/shell/external-display.js` (UIScreen/AirPlay watch + the native bridge), and the upstream/`hello`/fps/context-loss protocol inside `src/output-view.js`.
- **Stays in Fold** (the engine-specific view): `src/output-view.js` as a whole is the reference render-from-state view — it keeps Fold's `createEngine` + per-source-kind acquisition + the render loop. Conduit documents the view contract; it does not own this file.
- **Unchanged**: `output.html` (Fold's view host page), `native-camera-receiver.js` (the second-socket-client — an example of independent source acquisition), the commit-cell (already conduit).

**The unification win:** desktop output window, iOS external display, and AirPlay are the same abstraction today wearing three code coats. Tier C collapses them into one `createExternalSurface` that varies only by host transport.

## migration plan (contained increment, after the design lands)

1. ✅ **B382** — Added `conduit/external-surface.js` → `createSurfacePoster({ transport, content, renderCaps, sourceCaps, onClosed })`: the per-frame state stream + source-on-change + hello/fps handshake + arm/begin/end lifecycle + the degradation ladder. Transport-neutral (the caller injects `post`/`isClosed`); no `host` coupling — the transport IS the host-specific piece.
2. ✅ **B382** — Repointed Fold's `output-window.js` (BroadcastChannel + popup transport) and `external-display.js` (Capacitor plugin transport + crash-degradation + fill/frame-aspect dims) at it; both are thin adapters now. Public exports unchanged; behavior preserved move-for-move.
3. ⏳ Document the view contract in the conduit README; mark `output-view.js` the reference implementation. (Next.)
4. ⏳ **Device-verify** (regression, not new behavior): desktop output window + iPad external display + AirPlay all still render-from-state at tier resolution with zero readback.

No rendering changes; behavior-neutral for Fold, capability-additive for the next consumer.

## vNext (deferred by decision): capture-domain detection

DEFERRED (Daniel, 2026-07-18) — our immediate consumers (zoetrope, tap, visualizers) don't take camera input, and designing a capability catalog with zero camera-consumers is guessing at a contract. **This section records the scope so the deferral is understood, not forgotten.**

When a camera-consuming app is real, a **sibling package (the input/capture side of conduit)** would carry, lifted from Fold's `native-camera.js` + `FoldNativeCameraPlugin.swift` + `yuv-renderer.js`:

- the per-device **camera capability catalog** — lenses (incl. virtual devices), per-lens resolutions + max fps, still photo sizes, EV/WB/zoom ranges + lens-switchover factors, stabilization modes, focus support, Deep Fusion / quality prioritization;
- the **pipeline-safe fps governor** (`peakThroughput` / `safeFps`) — excludes the device's peak resolution×fps combo that jetsams the webview;
- the **still-vs-video format selection** (photo format for capture, video format for streaming);
- the **frame-ingest path** — biplanar YUV over a localhost socket → the YUV→RGB WebGL blit.

It's the mirror image of the broadcast domain: *enumerate and drive a device's cameras and get frames IN*, vs *get composed frames OUT*. Named and scoped when the first camera-consumer exists — not before.

## open decisions for Daniel

1. **Transport-neutral framing confirmed?** (conduit owns the pipe + handshake; render-from-state is a documented consumer responsibility; no frame-push fallback maintained in conduit). This doc assumes yes.
2. **Package boundary:** external-surface as a module inside the core conduit package (alongside output-bus), or its own optional host-adjacent package? Recommendation: core module — it's pure-JS plumbing with no native dependency (the native bits are already in the host).
