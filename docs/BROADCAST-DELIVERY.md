# broadcast delivery — the durable reference

**What is true about getting frames from a source to an external display, as of B608.** Written to close the 4K frame-rate arc (B549-B593) and extended through the loop-hold arc (B593-B608) so their conclusions survive without re-deriving them.

**If you are picking this up cold: §6a is the loop hold, start to finish.**

`CHANGELOG.md` is the narrative — how each conclusion was reached, build by build. **This file is the answer sheet.** If the two disagree, the CHANGELOG entry with the later build number wins.

---

## 1. The pipeline

```
AVPlayer (native, iOS)
  └─ CADisplayLink tick @60Hz → hasNewPixelBuffer? → encode YUV → FrameSocketServer.send()
       │  ONE decode, ONE socket (port 8900), MULTIPLE clients
       ├─ client 1: the APP webview      → engine.planeReader() → preview + pip engines
       └─ client 2: the EXTERNAL webview → its own engine → the display

     …and separately, over the Capacitor bridge:
     app rAF loop → createSurfacePoster → { type:'state', … } → output-view.js
```

**Two independent channels reach the external view: frames on its own WebSocket, and program state over the bridge.** Nearly every confusion in this arc came from forgetting that they are separate, and from assuming one of them clocked something it did not.

### Who clocks the picture on the wall

| build | trigger for an external render | consequence |
|---|---|---|
| ≤ B589 | **state posts only** | app fps was a hard ceiling on the broadcast |
| B590+ | state posts **or** a new socket frame | delivery decoupled from app fps |
| B593+ | as above, but frame-arrival renders gated on `playing` | a paused app holds the wall |

---

## 2. Ownership — conduit vs fold

**Conduit owns the transport-neutral machinery.** It must not know about kaleidoscopes, slices or panels.

| file | owns |
|---|---|
| `conduit/external-surface.js` | the poster: per-frame state stream, source-on-change, hello/fps handshake, idle elision + heartbeat |
| `conduit/perf-ledger.js` | surfaces, passes, per-frame cost accounting, pressure, the report shape |
| `conduit/governor.js` | the shed rule (**see §5 — its premise is now invalid**) |

**Fold owns the app-specific answers conduit asks for.** Every one of these is a `content.*` or `opts.*` hook:

| hook | answered by | means |
|---|---|---|
| `getState` | `shell/program-frame.js` | the committed program params |
| `hasLivePixels` | `shell/external-display.js` | the picture moves on its own |
| `viewHasOwnClock` | `shell/external-display.js` | the view holds a frame socket, so identical state is skippable |
| `isPlaying` | `shell/external-display.js` | the operator's transport is running |
| `getOutputDims` | `shell/external-display.js` | selected resolution, capped by the display |

**Fold-only, not conduit:** `shell/native-frame-receiver.js` (the socket client), `output-view.js` (the external view), `shell/broadcast-ceiling.js` (learned limits), and the Swift plugins.

**The rule:** if a decision needs to know what a *kaleidoscope* is, it belongs in fold. If it needs to know what a *surface* or a *transport* is, it belongs in conduit.

---

## 3. What is instrumented, and what each field is actually a noun for

**The recurring failure of this arc was measuring something semantically adjacent.** Each row names what the field is and, where it matters, what it is *not*.

| field | what it measures | NOT |
|---|---|---|
| `report.fps` | the **app's** render loop | anything about the wall (they moved in opposite directions at B571 and B576) |
| `external` note headline | **new pictures/s on the display** (`1000/fresh.p50`) | frames drawn — the view redraws unchanged pictures |
| `extJitter.draw` | the view's render interval | — |
| `extJitter.fresh` | interval between renders showing a **new** picture. **The one the eye judges** | — |
| `extJitter.arrive` | gaps between the view's `ws.onmessage` | **not the wire rate** — it is downstream of that view's event loop |
| `srcFanOut.clients[].offered/taken` | the **native** fan-out's own account | the only true wire measurement; both other arrival numbers are proxies |
| `srcSocket` | our client's `readyState`, `msSinceFrame`, `closes`, `reconnects` | — |
| `extPosts` | state posts `sent` vs `elided`, and `ownClock` | — |
| `loopStall` | wall-clock gap across a **pts wrap**, plus `rewinds`/`suppressed`: which of the two loop mechanisms fired | `wraps` counts the pts discontinuity itself, so it counts a lap whichever mechanism caused it |
| `broadcastCeiling` | learned median delivery per destination + **actual render size** | not the requested tier (they differ on self-rendering destinations) |
| `gpuMsPerFrame` | **always 0.** `EXT_disjoint_timer_query_webgl2` is not exposed on WebKit | we have never measured GPU time. This is the largest blind spot |

**Also unmeasured:** the external view has no cost ledger of its own. We know its per-cycle time and nothing about where it goes.

---

## 4. Levers that work

1. **Decouple the view's render clock from the app's** (B590). The single largest win of the arc: delivery went from tracking app fps to exceeding it. **23 → 26 → 29 of 30 at full 4K.**
2. **Elide identical state posts when the view has its own clock** (B591). Removes bridge traffic from the thread doing the rendering.
3. **Coalesce renders into one per macrotask** (B579). Keeps the message handler returning immediately so the socket never starves. **Do not render synchronously in `ws.onmessage`** — that is what caused the original starvation.
4. **One decode, many clients** (S3-A stage 4). A second decoder at 4K is memory exhaustion and loses the GL context in ~30s.
5. **Planes, not canvases** (B504). Sampling another context's canvas is a GPU→CPU→GPU round trip, ~20ms/megapixel on WebKit.

---

## 5. Proven dead — do not re-propose without new evidence

**Each of these was measured, not reasoned about. The measurement is named so it can be challenged rather than repeated.**

| hypothesis | how it died |
|---|---|
| **Lower the editor surfaces' resolution** | B574: preview 0.19MP cost 21.93ms, pip 0.011MP cost 12.07ms. **17x fewer pixels, 55% of the cost** — a large fixed per-draw term |
| **Lower the BROADCAST resolution** | B589 controlled pair: **26/s and a 39ms draw interval at BOTH 4K and QHD.** Free in both directions |
| **Kill the PiP / shed editor surfaces** | Governor futility twice, then B590/B592 directly: shedding both panels made delivery **worse** (29 → 20/s) |
| **The frame fan-out drops frames** | B584: `skipped: 0` on both clients over 4414 frames; 29.33/s of a 30/s source, 97.8% |
| **The external view's render is the wall** | It drew **4K at 45fps** when the app stopped competing (B583) |
| **Slice size drives delivery** | Only via the app's frame rate. After B590 a heavy slice slows the editor and not the wall |
| **App fps is a proxy for the broadcast** | B571 and B576: opposite directions |
| **The loop hold is a decoder stall** | B593 `loopStall`: 25 wraps, **maxGap 17ms**, 29 frames in the second after the wrap. **The decoder never stops** |

**⚠️ Two false results in this arc came from uncontrolled A/Bs, not from bad hypotheses.** B587 "QHD is slower" was an enlarged slice plus a hot device. **Both were caught by Daniel, not by the instruments.** See §7.

---

## 5a. The one structural cost never attacked — THREE GL uploads of every frame

**Rescued from HANDOFF at B658, where it was the only copy.** It is the strongest remaining lead and it must not live in an archived narrative.

**One source frame is uploaded as a 4K texture into THREE GL contexts every frame:** the staged engine, the live engine, and the external view's engine in its own process. The record/broadcast bus is **not** among them — confirmed by its absence from every report.

**Every lever this arc pulled makes one of the three cheaper. None asked why there are three.** That single fact is consistent with every dead hypothesis in §5:

- shrinking a surface does not help, because the upload is a fixed cost per context;
- killing the PiP does not help, because it removes the cheapest of the three;
- the external view jumped to 45fps the moment the app stopped uploading (B583).

**This is an architecture change and deserves its own design pass with Daniel, not a smuggled performance fix.**

**⚠️ And do not re-propose 2560 as a free win.** Daniel's display is a real 4K panel (Dell P2415Q). The `preferredMode`/`nativeBounds` 2560×1440 reading was a per-device iOS quirk, so rendering the external view at 2560 **is** broadcasting at QHD — a genuine quality reduction, shipped at B585 as an informed operator choice rather than an automatic rung.

---

## 6. Open, with the evidence that frames each

- ~~**The loop-restart hold**~~ **CLOSED B608 — see §6a**, which is the full record. It was AVFoundation, ~150ms, fixed by a head-frame cache and verified seamless at both resolutions.
- **A faster app loop makes the broadcast worse.** Panels off: app 8x cheaper and 1.9x faster, delivery 29 → 20/s. Nothing measured explains it. Leading hypothesis is that the app's rAF *rate itself* competes for the shared GPU process, which would make a **frame-rate cap while broadcasting** a real lever and is categorically different from shedding surfaces. **The governor should not be deleted until this is answered.**
- **The WebKit GPU process is shared** across both webviews and its crash takes every context at once. Same suspect as the above.
- ~~**Motion-mode start-of-broadcast autoplays**~~ **CLOSED B595.** Not a gate problem. The plugin's `start()` plays the AVPlayer so the first frame can arrive and nothing ever paused it again, so `clock.paused` had been false since load. The clip is now parked after its first frame. **B593's `isPlaying` was reading the right property off a value that had never been true**, which is the same shape as the wrong-noun failure: the field named the right thing and did not mean it.
- **A green/RGB glitch on the first motion → perform transition.**
- **Electron and NDI/Syphon are unmeasured.** Nothing removed in this arc ever ran on those paths, but the app-frame-rate finding may not transfer: on a **bus** destination the app's canvas genuinely is the output.

---

## 6a. The loop hold — CLOSED, and the whole answer in one place (B593-B607)

**What it is:** a clip loops and the picture holds for ~150ms. Reported since B487, never fixed.

**Whose it is:** **AVFoundation's.** Measured inside the plugin, before anything touches the socket: `swapGapMs` **141-158ms**, and the new item's clock runs through the silence, so **the footage skipped equals the stall**. That is why "1.8s of content missing" and "a 150ms hold" were always the same event.

**It is a FIXED cost, not decode work.** 4K 141/150, FHD 141/150 — four times the pixels, same gap.

**It is iPad-only.** Electron and Firefox loop a `<video>` natively with no perceptible hold (Daniel, B605).

**It feels new because B590 made everything around it smooth.** At 20-25/s a 150ms hold is three frames of an already-choppy stream; at 29-30/s it is the only thing moving wrong.

### Eight things it is NOT, each closed by its own instrument

| hypothesis | how it died |
|---|---|
| the decoder stalls | `loopStall` B593: `maxGapMs 17`, `after1s 29`. Frames cross the boundary at full rate |
| our trim rewind's settle window | B595: `rewinds: 0, suppressed: 0` — the boundary test never fires on a full-range trim |
| the external view's render | B598 `wrapRenders`: `ren` 8-15ms, `up` 0-4ms, `sched` 0-12ms. All fast |
| "the app does not hold, only the wall does" | B599: an instrument artifact — `paintLatest` counted re-blits as arrivals |
| our backpressure | `skipped: 0` on both clients across the lap |
| the item swap specifically | B601 A/B: a single-item seek-to-zero costs the same 150ms |
| a fresh video output having to prime | B600: reusing it across the lap left 150 against 150 |
| Apple's pull model / pre-attaching an output | B601 arm B attached once and never moved it, and still paid 150ms |

### The fix: fill the lap from a head-frame cache

The plugin keeps the clip's first `headSeconds` of **encoded** frames and replays them **as a sequence at the source frame interval** while AVFoundation restarts. Real frames, real timestamps, so both webviews and the motion clock never notice, and **it works on any clip** — required, since most loops are authored elsewhere.

**Cached frames are SOURCE FOOTAGE, not rendered output.** Each engine applies the kaleidoscope at render time from live state, so the slice keeps animating through the lap.

**The one field that says whether it works is `srcFanOut.loopCache.firstPts`.** It must be ~0. If it is 0.115 the cache begins where the decoder resumes anyway and can only repeat content that was coming regardless — it fills nothing while reporting healthy frame counts.

**Budget: the need is a duration, the risk is bytes.** `headSeconds` (0.22) is the TARGET — how much head to keep, sized to the measured lap. `budgetMB` is a CEILING, live-adjustable in the panel. At 4K the window costs ~94MB (8 frames), well under a 256MB ceiling.

**✅ VERIFIED SEAMLESS AT BOTH RESOLUTIONS (B608).** FHD at 64MB, 4K at 256MB: `firstPts: 0`, take gaps **25-42ms**, one frame interval. Cache off restores the stall at either. **First reported B487, closed 121 builds later.**

**⚠️ Two traps for whoever reads a budget comparison next.** Setting the budget to 0 **discards the head, and a clip's head is produced exactly once, on the opening pass** — every lap afterwards resumes at ~0.109, so the cache can never rebuild itself without a clip reload. That makes an off → 64 → 128 → 256 sweep look like a memory curve when it is a sequencing artifact. **Reload the clip between arms.** ~~And the real minimum viable 4K budget is still unknown.~~ **ANSWERED B609: it is 64MB, the current default** — `heldMB 59`, 5 frames, `firstPts 0`, worst lap gap 52ms against a 33ms interval (a 19ms overhang on one frame); at 256MB it was 42ms. **Four times the memory buys 10ms on one frame per lap**, so the default is right and the 4K memory risk is smaller than this section feared.

**The open risk is memory at 4K**, not the loop: holding ~94MB beside a 4K decode and two webviews is the pressure the single-decode architecture exists to avoid, and it is now showing up as intermittent bake failures and one outright app crash.

## 7. How to measure so the answer survives

Adopted after two false results (B587, B588):

1. **Cold start.** The same work gets more expensive over a session — `preview render` rose 40% across one hot sitting at identical geometry.
2. **Fix the slice.** It is the dominant load variable and it is easy to move by accident.
3. **A/B/A, or reverse the order.** B589 reversed the arms and the effect vanished.
4. **Set the scenario tag** before saving a baseline, or the diff is against the wrong world.
5. **Prefer a conserved quantity** that must survive a boundary we do not own (`offered`/`taken`, pts across a wrap, new pictures on the wall) over an activity counter (draws, calls, batches).
6. **Anything that can decline to act must publish why.** `governor.reason`, `extPosts.elided`, `srcFanOut.reaped`, `SOCKET REJOINED ×N` all exist because an absence once looked identical to success.

See `DEBUGGING-PROTOCOL.md` for the general form of this.
