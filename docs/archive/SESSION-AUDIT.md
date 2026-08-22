# session audit — what hardware sessions the app holds, and who releases them

**Written 2026-08-19 as `PLAN-LIVE-READINESS.md` item 2, step 1.** Class 1 throughout: every claim here was resolved by reading code, and **no device time was spent on any of it.**

**Why this exists.** The bake failure, the source-panel blackout, the GL context loss, the slice-preview stall and the green glitch were all filed separately, and item 2 asserts they are one question: *how many decode, encode and GL sessions do we hold at once, and do we release them.* This is the answer to that question.

**The frame that makes it useful (Daniel, 2026-08-19).** The failures happen at **onsets** — changing source, switching mode mid-broadcast, arming a take during a broadcast — and not under accumulated pressure. T7 sat at thermal `serious` for forty unbroken minutes with zero events. **So the thing they have in common is not load. It is that the count of simultaneously held sessions goes up at that instant.**

---

## THE HEADLINE

**The app never releases a source `<video>` on the path that swaps sources, and it never releases a WebGL context at all.**

Both are one-line-idiom omissions, not architecture problems. The correct idiom for a `<video>` is already written **six times** in this codebase. The swap path is where it is missing.

---

## 1. The release idiom, and where it is

Releasing an HTMLVideoElement's decoder takes three calls. Dropping the reference does not do it, and neither does removing the node from the DOM or revoking the object URL — the element owns a decode pipeline until it is explicitly told to let go, and when it is collected is the GC's business, not ours.

```js
try { v.pause(); } catch {}
v.removeAttribute('src');
try { v.load(); } catch {}    // ← the call that actually tears the pipeline down
```

**Written correctly in six places:**

| file | what it releases |
|---|---|
| `shell/clip-editor.js:82` | the Loop Builder's visible preview |
| `shell/clip-editor.js:83` | its hidden A-head crossfade decoder |
| `shell/clip-editor.js:84` | its hidden thumbnail decoder |
| `shell/clip-editor.js:951` | the swapped-out baked clip |
| `shell/source-host.js:203` | `detectLoopFromFrames`'s throwaway probe (in a `finally`) |
| `shell/stage-source.js:85` | the staging seek decoder, in `end()` |

**Missing in exactly one place, and it is the busiest one.**

## 2. ⚠️ FINDING A — the source `<video>` is orphaned on every swap

`shell/source-host.js`, all three swap paths:

| path | what it does to the outgoing element | line |
|---|---|---|
| `loadVideo` | `stopSourceVideoPlayback()` → **pause only**, then `env.sourceVideo = v` (a new element) | 223, 271 |
| `loadImage` | `stopSourceVideoPlayback()` → **pause only**, then `env.sourceVideo = null` | 68, 74 |
| camera start | `stopSourceVideoPlayback()` → **pause only**, then `env.sourceVideo = null` | 649, 659 |

```js
function stopSourceVideoPlayback() {
  if (!env.live.isLive) stopLiveLoop();
  if (env.sourceVideo) { try { env.sourceVideo.pause(); } catch { /* ignore */ } }
}
```

**A paused `<video>` at `readyState 4` still holds its decode pipeline.** The object URL *is* revoked, which is good hygiene and does nothing for this: revoking a URL does not tear down an element that already loaded it.

`overlay.js:1943` `mountSourceView` opens with `slotEl.innerHTML = ''`, which **detaches** the old element from the DOM. Detaching is not releasing.

**⚠️ AND THE OVERLAP IS REAL, NOT JUST DEFERRED.** In `loadVideo` the new element's `src` is assigned at line 403 and `env.sourceVideo` is not reassigned until the new element's `loadeddata` fires at line 271. **So for the entire decode of the incoming clip, the outgoing clip's decoder is still fully alive and still referenced.** Two 4K decode sessions, guaranteed, on every single source change. That is not a leak that accumulates; **it is a spike that lands exactly at the onset Daniel identified.**

**Cost to fix: one function.** Give `stopSourceVideoPlayback` the release idiom the other six sites use.

## 3. ⚠️ FINDING B — no WebGL context is ever released

The desktop chrome (which the iPad runs) creates up to **three** GL contexts in-process, and the count only ever goes up:

| context | created | released |
|---|---|---|
| preview engine | `main.js:289`, at boot | — |
| hidden output/bus engine | `shell/output-engine.js:70`, **on first broadcast or record** | **never** |
| live PiP engine | `shell/perform-runtime.js:77`, **on first entry to perform mode** | **never** |

Plus the external view's own context, in its own process (`output-view.js:37`).

`outputBus.stop()` (`conduit/output-bus.js:166`) cancels the rAF and drops the cached frame. **It does not touch the engine.** The PiP is explicit about it in a comment: *"registers on FIRST USE, releases never — the PiP engine outlives a mode switch."*

**This is defensible as written** — rebuilding a context is expensive and these get reused. **What is not defensible is that it is invisible.** Nothing reports how many contexts are live, so "switching to perform mode mid-broadcast" is, in resource terms, "permanently add a third GL context to a process that is already holding two, while a 4K decode runs." That is Daniel's exact repro, and no instrument in the app currently says so.

The failure mode is already characterised: **`output-engine.js:70` is wrapped in a `try/catch` that reports "could not start the live-output engine (a second GL context failed)".** That path exists because someone anticipated exactly this.

## 4. ⚠️ FINDING C — peak concurrency is 5 to 6 decoders of ONE clip

Worst case, in the main process, one 4K clip loaded, opening the Loop Builder while broadcasting:

| # | decoder | held by |
|---|---|---|
| 1 | the source `<video>` | `source-host.js` — paused but loaded; on iOS it is *deliberately* kept for authoring after the native decode takes over playback (`source-host.js:1295`) |
| 2 | the native AVPlayer decode | `native-video.js` |
| 3 | `clipVideo` | `clip-editor.js:45` |
| 4 | `prevVideoB`, the hidden A-head | `clip-editor.js:51` |
| 5 | `thumbVideo`, the hidden strip builder | `clip-editor.js:61` |
| 6 | the staging seek decoder | `stage-source.js:67`, if staging is active |

Plus **any orphan from Finding A**, which is not bounded by anything.

**iOS caps concurrent decode sessions.** This is the shape B501 hit and the shape BACKLOG:799 predicts for the bake (`encoding task did not complete` is WebCodecs' string, not ours, raised while five decoders and an encoder are live).

**Every one of these six is individually justified.** The problem is that nothing anywhere counts them, so no code and no reviewer can see the total.

## 5. ✅ WHAT IS ALREADY CORRECT — and it is the template

Three paths already do release-before-acquire properly, and the fixes below should copy them rather than invent anything.

- **`source-host.js:1277`, the native handover.** `await detachNativeVideo(); await pendingTeardown;` **before** starting the new decode, plus two staleness guards (`if (env.sourceVideo !== v) return ...`) that abort if a newer source landed mid-flight. This is the gold standard in the codebase.
- **`output-view.js:64`, the external view.** `teardownSource()` is awaited at the top of `setupSource`, and it releases the camera, the socket receiver and the `<video>` before anything new is built. A `sourceToken` invalidates in-flight work. **The external view is disciplined; the main app is not.**
- **`output-view.js:161`, the `notice` kind.** The Loop Builder and the bake post a `notice`, which tears down the external view's decoder outright, *"because a 4K bake and a 4K external render at the same time is what restarted the app."* **The precedent for shedding a session before a heavy operation already exists and already works.**

## 6. The transitions, ranked by how much they add

| transition | sessions added at the instant | already guarded? |
|---|---|---|
| **change source while broadcasting** | +1 decode (the incoming clip) **and +1 orphan** (Finding A), while the external view re-stages | no |
| **enter perform mode mid-broadcast** | **+1 permanent GL context** | no |
| **arm a take during a broadcast** | +1 GL context (bus, if not already up) + 1 video encoder + 1 audio encoder | no |
| **open Loop Builder** | +3 decoders | ✅ the external view sheds its decoder via `notice` |
| **bake** | +2 WebCodecs decoders +1 encoder, on top of the three above | ✅ same `notice` |
| **start staging** | +1 seek decoder | ✅ `end()` releases it |

**The three unguarded rows are the three repros Daniel listed from memory, in the same order.** That is the audit's actual result: his list and this table were derived independently and they match.

---

## ▶ WHAT THIS MAKES POSSIBLE, IN ORDER

1. **Fix Finding A.** One function in `source-host.js`. Removes an unbounded orphan and halves the decode count at the single most common transition. **Do this first: it is the cheapest thing on the list and the only one that is unambiguously a bug.**
2. **Count the sessions and publish the count.** A tiny module that decode/encode/GL acquisitions register with, exported in the report. **Right now the peak concurrency of a real session is unknown, and this audit could only establish what the code *can* hold, not what it *did*.** That is the difference between this document and a measurement.
3. **Shed before acquiring at the three unguarded transitions**, copying the `notice` precedent that already works.
4. **Then, and only then, gate.** With a live count, "refuse a 4K take during a 4K broadcast" becomes a rule with a reason attached rather than a hardcoded device limit — which is Daniel's standing requirement (`BACKLOG.md:493`).

## ⚠️ WHAT THIS AUDIT DOES NOT ESTABLISH

**It does not prove any of these caused any specific crash.** It establishes what is held and what is released, which is what item 2 asked for and all that reading code can give.

**Specifically unresolved:** whether the GPU process dies from GL contexts, from decode sessions, or from total texture memory — B580's Xcode log says the GPU process crashes rather than a context being lost, and this audit cannot separate those three. **Step 2 above is what would.**
