# handoff

This document is for whichever Claude session picks the project up next. **It is the rolling source of truth** for project state, recent decisions, and what's queued. Edit it as the project evolves; archive snapshots if you want history (or rely on git).

If you're a Claude reading this for the first time in a new session: read this entire doc, then `BACKLOG.md`, then skim `ARCHITECTURE.md` if relevant to what Daniel is asking about. `CHANGELOG.md` is per-version detail you usually don't need.

## who & what

Daniel Nelson is building a browser-based kaleidoscope tool for high-resolution still-image output. He's a VJ (Resolume Arena + Akai APC40 MK2), technically savvy but identifies as a non-developer. He's iterative, evidence-based, and methodical — runs builds locally, reports back specifically with what works and what doesn't, catches Claude's UI hallucinations.

He prefers **no em dashes** in any prose Claude generates for him.

## ▶▶ THE PLAN NOW LIVES IN `PLAN-LIVE-READINESS.md` (written B609, Daniel's ask)

**Read that file first.** It owns the goal, the sequence, the real dependencies between items, and the stopping rule for each one. It also records the pause point for the stage-manager arc and what is explicitly out of scope.

**What changed at B609:** input normalization was promoted to item 1.5 and scoped as architecture rather than triage; B609 verification is closed; and the six-item plan was superseded as a *sequence* (archived at B658 — see below). **Read `PLAN-LIVE-READINESS.md` for what to do next, and `BROADCAST-DELIVERY.md` for why item 1 and the loop hold are settled.**

## ▶ the superseded six-item plan → `archive/HANDOFF-plan-superseded-b609.md`

Archived at B658. It was marked superseded at B609 and kept for the reasoning behind items 1 and 2; both are closed. **Item 1's durable answer sheet is `BROADCAST-DELIVERY.md`** (including the three-GL-uploads lead and the 2560 caveat, rescued there at B658), and the live sequence is `PLAN-LIVE-READINESS.md`.

## current version

## ▶▶ PHASE 2 IS RUNNING. READ THIS BLOCK FIRST IF YOU ARE PICKING UP COLD.

**State:** item 1.5 CLOSED (B657), docs cleanup done (B658), the session recorder + flight recorder shipped (B660-B662). Daniel is mid pressure-testing on an M1 iPad Pro (12.9", 1TB = 16GB). **Builds 635-662 are UNCOMMITTED.**

### 🌡 B663 SHIPPED THE VITALS PLUGIN — ⚠️ IT NEEDS AN XCODE BUILD BEFORE IT READS ANYTHING

`fold-device-vitals` (thermal, memory headroom, memory warnings) is written, `npx cap sync ios` is run, the SPM manifest regenerated, and the web/Electron builds are clean. **Until Daniel builds in Xcode, `nativeReadings` stays `false` and every report is the same as the ones before it.** Say so rather than treating a null column as a reading.

**Batched into the same Xcode cycle, still TODO:** `listCameras` (external/USB cameras on iPad), the `loopCache.coveredMs` under-report, and the `scenario` guard. **None of those are built yet** — only the vitals plugin is.

**The trap that was caught before the cycle, because it will recur in any future host seam:** Capacitor calls are async, `conduit/vitals.js` reads `native()` sync. A Promise there makes every field undefined and the report says `nativeReadings: false` — *identical to no plugin*. The host caches; `read()` is synchronous. Proven in `vitals-native-check.mjs`.

### 🔬 B681 — THE FIX AND THE COUNTER SHIPPED. NEXT REPORT ANSWERS A QUESTION NO REPORT COULD BEFORE

Audit steps 1 and 2 are done. **What to read in the next device report, in order:**

```
sessions.now.decode     how many decoders were held at that moment
sessions.peak.decode    the high-water mark for the run
sessions.live[]         WHICH ones, named, with an age
sessions.acquired/released   conserved: acquired - released MUST equal now.total
trail[]                 THIS run's breadcrumbs, including gl-context-lost
```

**⚠️ A `live` entry naming a clip that was closed minutes ago is an orphan, and that is a bug, not a reading.** `ageSec` is what makes it visible.

**The known-and-deliberate double:** on iOS a loaded clip holds BOTH the source `<video>` (kept for authoring) and the native AVPlayer decode. **Two decoders on one clip is expected. Three is not.**

### ✅✅ ROOT CAUSE — AN 8-SECOND TIMER WAS ROUTING BIG CLIPS INTO THE CRASH PATH (B682)

**Three reports, and the third one — Daniel's own idea to relaunch and grab the previous session's trail — carried the ordering.**

```
20:16:12.968  loadVideo:start          1,252,687,803 bytes · 3840x2160 · 399.1s
20:16:13.296  loadeddata               the <video> decode was FINE (328ms)
20:16:26.016  nativeAttach DECLINED    failed at "frame socket": no native frames on port 8900
              ↓ fallback = OUR <video> + the external view's own copy of the staged 1.25GB file
20:17:24.263  broadcast on
20:20:09.675  gl-context-lost (preview)
20:20:10.753  memory-warning · availableMB 5094 · footprintMB 25
20:20:20.722  gl-context-lost (preview)
```

**That message is UNIQUELY the `requireFrame` timeout** (`native-frame-receiver.js:252`) — socket open, no frame inside `timeout`, which was **a flat 8000ms**. **The deadline chose the fallback, not the decode.** Load-start to decline was 13.05s: upload plus an 8s expiry.

**⚠️ CORRECTED SAME DAY. THE 8s DEADLINE IS MARGINAL, NOT ALWAYS TOO SHORT.** A THIRD run of the same clip, **on B681 with the flat 8s still in place, attached natively and ran healthy** (Daniel: app ~18 / broadcast ~33, honest). Three runs, three outcomes: attached-then-stalled, timed out, attached and fine. **So this is a RACE, and what decides it is unmeasured** — plausibly whether the file was already materialised from iCloud and warm in the page cache, i.e. an artifact of the test rig rather than of clip size. B682's scaling still removes the coin flip; do not describe it as the cause of the crash chain beyond the one run that timed out.

**⚠️ `availableMB: 5094` AT THE MEMORY WARNING IS THE NUMBER WE NEVER HAD.** Over 5GB free on the device. **This is the WebKit GPU process's own ceiling, not device RAM** — B580's Xcode log said so and no report had ever shown it.

**B682 scales the deadline (20ms/MB, floor 8s, cap 40s) and names it in the failure message.** The floor means clips under ~400MB are unchanged.

**⚠️ FALSIFIER: if the 6:39 clip still declines, the message now reads `within 23893ms` and that IS the measurement** — raise from there. **If it attaches, the native single-decode path takes over and the double-decode crash configuration never arises.**

**⚠️ ALSO CHECK `extGuard` IN THE NEXT REPORT.** The external surface rendered **3840x2160** when the 1080p memory guard should have applied. `extGuard.uncapToggle` now says outright whether `foldHdmiVideoUncap` is still set from B487's testing — that toggle re-arms this exact crash and would have been invisible forever.

### 🚨 THE FIRST OF THE THREE (on B680, `docs/temp/8-19-26-gl-context-loss-report.json`)

**The clip is 1,252,687,803 bytes — 1.25GB, 3840x2160, 399.1s.** Roughly the figure predicted for the external staging path, arriving as a source load instead.

**The swap trace COMPLETED.** `picker:change → guard:clear → loadVideo:start → loadeddata (453ms) → source-set`. The `<video>` decode was fine. **The failure is after the source was set**, on the native path:

```
source: ⚠ SOURCE STALLED 348.5s — socket open, offered 3, took 3, skipped 0 · ⚠ GL CONTEXT RESTORED ×1
srcFanOut: ticksNoBuffer 41615 · clients[0] offered 3 / taken 3 · srcSocket closes 0
```

**⚠️ THIS IS THE OPPOSITE BRANCH FROM B580's, AND THE B584 INSTRUMENT IS WHAT SEPARATES THEM.** There it was `offered 222 · took 222` — the frames arrived and we failed to use them. **Here only 3 frames were ever OFFERED.** The socket never closed and the fan-out ticked 41,615 times with no buffer, so **the native decode stopped producing.** Not the wire, not the receiver, not the plane textures.

**⚠️ WHAT THE REPORT CANNOT SAY, AND IT IS THE WHOLE QUESTION: which came first, the stall or the GL loss.** The restore is a bare count on a surface note (`main.js:212`) with no timestamp. **B681's `trail` export is what closes this** — `gl-context-lost` is marked with a time, so the next occurrence orders itself.

**⚠️ AND THERE WAS NO THERMAL OR MEMORY READING ANYWHERE NEAR IT:** `vitalsSeam` says `pushes: 0, loaded: false, why: "refresh never attempted"`. Whether that is the force-quit relaunch or the plugin failing to start, **this event has no memory number at all** — which matters for a 1.25GB clip.

**Do not chase this until a B681 report exists.** Two of the three things needed to read it did not exist when it happened.

### ✅ THE SESSION AUDIT IS DONE — `docs/SESSION-AUDIT.md` (2026-08-19)

**Item 2 step 1, the piece the plan called "what makes the expensive session cheap". Class 1, no device time.** Read that doc before touching the crash cluster.

**Two findings, both one-line-idiom omissions rather than architecture problems:**

- **A — the source `<video>` is orphaned on every swap.** `stopSourceVideoPlayback()` only *pauses*. The correct release (`pause` + `removeAttribute('src')` + `load()`) is written **six times elsewhere in this codebase** and is missing on the one path the user hits constantly. **And the overlap is real, not deferred:** `env.sourceVideo` is not reassigned until the incoming clip's `loadeddata` fires, so the outgoing 4K decoder is alive for the whole decode of the incoming one. **A guaranteed two-decoder spike at exactly the onset Daniel identified.** One function to fix.
- **B — no WebGL context is ever released.** Up to three in-process (preview, bus, PiP), monotonically increasing. `outputBus.stop()` does not touch the engine; the PiP says outright *"releases never"*. Defensible as written, **invisible is not** — nothing reports the live count.

**Peak concurrency is 5-6 decoders of ONE clip** (source + native + three Loop Builder + staging), each individually justified, none counted anywhere.

**The three transitions with no shedding guard are the three repros Daniel listed from memory, in the same order** — change source, enter perform mid-broadcast, arm a take during a broadcast. The table and his list were derived independently and match.

**▶ NEXT, in order:** (1) fix Finding A, one function; (2) **count the sessions and publish the count** — the audit can only say what the code *can* hold, not what it *did*, and that gap is why it cannot name a cause; (3) shed before acquiring at the three unguarded transitions, copying the `notice` precedent that already works; (4) then gate, with a live count so the rule has a reason rather than a device table.

### ✅ B680 — THE WAKE LOCK HOLDS (and the phone never had it)

**Confirmed on device 2026-08-19: a full 40-minute T7 ran uninterrupted.** The head-of-line theory is confirmed by the fix. `readVitals` stays retired; do not reinstate a pull, and do not add a boot probe.

**Scope of the lock: `broadcasting || wantRecord`.** Driven from `syncBusRunning()` in `shell/output-panel.js` — deliberately not from `need`, because a self-rendering destination (HDMI, `needsBus:false`) never starts the bus and is the case that most needs the screen held. **Ordinary editing does not hold the screen**, by design.

**B680 fixed the same gap on the phone chrome**, which mounts no output panel and had its own `acquireRecWakeLock()` calling `navigator.wakeLock` directly — the one API WKWebView refuses, inside a `catch` that swallowed the refusal. **Every phone take and every phone NDI broadcast has run with no lock at all.** Both helpers now delegate to `keepAwake`. B675 had already wired `setWakeLockHost` there; nothing ever called it. **Two-chromes trap, found by grepping rather than by a device session.**

### 📊 T7 · 2026-08-19 · 40 MINUTES, HANDS OFF, 4K→4K — NOTHING DEGRADES

241 samples, `outcome: complete`, no suspended gaps.

```
fps          19.7 → 20.6   (min 17.5, max 27)
wallFps      21.3 → 20.8   (min 14.5, max 27.8)
footprintMB  140  → 140    (min 128, max 171)
availMB      4979 → 4979
thermal      serious for 2410s of 2410s
battery      95% → 95%, charging, FLAT
```

**The wall held ~19 new pictures/s the whole time.** Memory is not a constraint, thermal `serious` is simply where this device lives and does not predict anything, and **40 minutes of 4K HDMI broadcast is sustainable at ~20fps app / ~19fps wall.**

**✅ THE POWER QUESTION IS ANSWERED (Daniel confirmed the rig 2026-08-19): this run was AirPlay + a charging cable directly into the iPad.** The earlier 70% → 55% run was HDMI in the port with charging through the Magic Keyboard case. **THE RULE: enough watts straight into the device sustains a 4K broadcast indefinitely; the case passthrough cannot.** The cooler room and less-warm start are real confounds but push the same direction. **What is still open is the WIRED variant** — a power-passthrough dongle carrying video and charge at once has never been run long (T10). The paragraph below stands as the reason the scenario guard still matters:

**⚠️ THE RIG WAS NOT RECORDED BY ANY INSTRUMENT.** The previous T7 fell 70% → 55% in 40 minutes; this one held 95% flat. **State of charge does not explain it**: if supply is capped below draw, the battery discharges at the deficit regardless of SoC. Same fps, same thermal, so the draw did not change — **the supply almost certainly did.** The report cannot say: the `scenario` tag is hand-picked and has no AirPlay option, so an AirPlay run is filed as `hdmi-broadcast`. **Ask Daniel which power path this run used before concluding anything, and build the scenario guard.**

### 🚧 B679 — THE PULL IS RETIRED, AND THE FIX IS THE EXPERIMENT

**B678's fix produced the decisive number:** `osIdleTimerDisabled: false` while the app asked for `true`. **So `setIdleTimerDisabled` does not merely fail to resolve — it never performs its write.** Its body is a resolve plus a one-line UIKit assignment; nothing in it can fail halfway. **The call is not reaching native.**

```
ping                  FIRST call ever made — resolves, returns swiftBuild 677
readVitals            0 resolved / 18, 26, 28 attempts · 0 errors
setIdleTimerDisabled  never settles, never writes
notifyListeners       39 pushes in the same report that had 0 resolves
```

**One success, then nothing, regardless of method, while the push channel is untouched.** The shape that fits is a **head-of-line block** — the first hung `readVitals` never completes and every later call queues behind it. The method bodies explain none of it; the ordering explains all of it.

**▶ SO THE PULL STOPS, AND DELIBERATELY WITHOUT A BOOT PROBE** — a probe would be the second call and would wedge the queue before the wake lock is ever asked, confounding the experiment and taking the lock down with it. **The only calls now made are `ping` at load and `setIdleTimerDisabled` when output goes live.** If the lock holds on the next run, the theory is confirmed by the fix.

**⚠️ IF IT STILL DOES NOT HOLD**, the head-of-line theory is dead and the next move is native-side instrumentation (an `os_log` at the top of the method to prove whether it is entered at all) — **not another JS build.**

### 🪤 B678 — THREE BUILDS OF SUBSCRIPTIONS THAT WERE NEVER REGISTERED (my bug)

`env.host` is assigned by `createApp` at **main.js:2026**. Both `host.vitals.onEvent` subscriptions were written at **504 and 512**, where it is `undefined`. **`env.host?.vitals?.onEvent?.(fn)` on an undefined host does nothing and says nothing.**

**What it cost:** B677's wake-lock read-back never arrived (`osIdleTimerDisabled: null` beside `pushes: 37` — the pair that made it findable); **B663's claim that thermal transitions were recorded at their onset was false** (the 10s sampler was detecting them, which is why it looked true); and a `memory-warning` would never have left a breadcrumb, which was the entire reason to subscribe.

**⚠️ THE PHONE CHROME WAS FINE** — its `host` is a const created before the wiring. **Two-chromes trap, and the broken one is the chrome the iPad runs.**

**▶ THIRD TIME THIS SESSION AN ABSENCE COULD NOT ANNOUNCE ITSELF** — B664's hung `read()`, B676's ambiguous `not requested`, and now this. **Optional chaining is the specific hazard: it turns an ordering bug into a silent no-op.** A missing seam now writes `vitals:no-events`.

**▶ PREDICTION WORTH CHECKING FIRST ON THE NEXT REPORT:** if `osIdleTimerDisabled` reads `true` while `wakeLock.native` still reports a timeout, **the native write is working and only its resolve is broken** — the screen is already staying awake and the timeout is a reporting fault. Different problem, one push from visible.

### 🧩 B677 — THE SWIFT IS BUILT. THE CALL SHAPE IS THE VARIABLE.

**⚠️ CORRECTS MY OWN GUESS.** I said the Swift half was probably not on the device. **It is:** `FoldDeviceVitalsPlugin.o` stamped 22:28:28, source edited 22:14:45. Checking the build products settled in one command what reasoning had gotten wrong.

**So the finding is sharper: in a binary containing all three, `ping` resolves and `readVitals` / B675's `setIdleTimerDisabled` never settle.**

**The pattern is the call SHAPE, not the method:** resolve-immediately works; resolve-after-the-function-returns does not. **Mechanism unknown, and the obvious suspects are ruled out** — `snapshot()` serialises fine through `notifyListeners`, and `readVitals` hung before any UIKit call existed in it. B677 adopts the working shape rather than guessing at the cause, and moves the read-back to the 5s push.

**▶ A TRAP AVOIDED THAT WOULD HAVE COST THE ARC:** delivering the push to subscribers also delivers it to the breadcrumb writer, and **`priorTrail` holds twelve entries** — a 5s heartbeat would have flushed every `take:arm` within a minute and destroyed the flight recorder. It emits as `'sample'` and the breadcrumb writer ignores that kind.

**▶ `ping` NOW CARRIES A SWIFT BUILD STAMP** (`vitalsSeam.swiftBuild`), so "is the native half current" is never a guess again.

### ⏱ B676 — `not requested` COULD NOT TELL SILENCE FROM A HANG (my bug, twice)

Daniel's report: `native: "not requested"`, `supported: true`, `why: "refused: NotAllowedError Permission was denied"`.

**Two findings and one self-inflicted wound:**

1. **The web wake lock EXISTS in the WKWebView and is DENIED.** `supported: true` then `NotAllowedError`. **API presence says nothing about usability** — B674 read `supported` as good news. The web path is dead on device; it stays only for web/Electron.
2. **`native: "not requested"` was ambiguous by construction** — it meant "nativeState was never set", which covers both "never called" and "called, never settled". **B664 fixed this exact hung-bridge bug in `capacitor-host.js`; B675 reintroduced it eleven builds later in `kit/wake-lock.js`.** Now raced against a 3s deadline.
3. **The likely real cause is that the Swift half was never built.** This plugin hangs on unknown methods rather than rejecting (`read()`: 28 timeouts, 0 errors), so JS-shipped-without-Swift is indistinguishable from silence. The timeout message says so outright.

**▶ NEXT: confirm the Xcode build actually rebuilt the plugin, then re-read `wakeLock.native`.** `held (native idle timer)` means done; the timeout message means the Swift is not there; `asked true, system reports false` means iOS refused for a reason worth understanding.

### 🔒 B675 — THE WAKE LOCK NOW HAS A NATIVE PATH (needs an Xcode build)

B674's `navigator.wakeLock` did not hold: **Daniel's iPad still slept 5-10 minutes into a broadcast.** Screen Wake Lock is a Safari feature and is not reliably exposed in a WKWebView. B675 adds `setIdleTimerDisabled` to the device plugin (`UIApplication.isIdleTimerDisabled`) and runs both paths.

**The native call reads the value back after writing it**, so a request that did not take reports `asked true, system reports false` instead of success — the distinction that cost a forty-minute run.

**Scope: broadcasting or recording only**, never "the bus is running" (HDMI self-renders and never starts the bus, and the unattended wall is the case that most needs it).

**⚠️ Naming compromise, deliberate:** an idle timer is not a vital. It lives in `fold-device-vitals` because that is already the device plugin; **if a third device setting appears, rename the package.**

### 😴 B674 — THE iPAD SLEPT AND THE INSTRUMENT SAID "ROCK STEADY" FOR FORTY MINUTES

**217 samples, byte-for-byte identical:** `fps 26.8 · frameP50 35 · unaccountedMs 26.32 · wallFps 19.6 · availMB 5025 · footprintMB 94`. The render loop stopped, so `ledger.report` never flushed and every sample copied the same frozen object. **Only the native values moved** (the plugin's push timer kept running), which is exactly what made the report look plausible instead of obviously broken.

**Sample intervals give it away too:** 10, 10, 10, 11, 14, 11, 14… against a 10s period, and **217 samples where 240 were due**.

**▶ FIXED, AND IT IS THE DEFECT CLASS THIS PROJECT KEEPS HUNTING** — an instrument that cannot tell "nothing changed" from "nothing was measured". Ledger-object identity is an exact staleness test, and timer drift is an exact suspension test. Both free, both now checked; stale samples are recorded but **excluded from aggregates**, and `measuredWhy` says so in words.

**▶ AND THE WAKE LOCK IS A PRODUCT REQUIREMENT, NOT A TEST FIX.** Broadcasting to an external display does **not** keep iOS awake, and nothing was asking it to. **An eight-hour installation that blanks after fifteen minutes is the whole thing not working.** `kit/wake-lock.js`, JS only (WebKit 16.4+), re-acquires on `visibilitychange` because the OS revokes it on every backgrounding, and publishes whether it was granted.

**⚠️ THIS RUN IS NOT A T8 RESULT, IN EITHER DIRECTION.** Battery went 60% → 80% — a 20-point *gain* against T7's 15-point loss — **but the app was suspended for much of it**, so it measures a sleeping iPad charging. And the report cannot say which rig it was: `wallW`/`wallH` shipped at B673 and this is Build 672. **T8 needs a rerun on the current build.**

### 🏁 T7 RAN — FORTY MINUTES, ZERO DEGRADATION, AND THE HEAT HYPOTHESIS IS FINALLY DEAD

```
fps      20.0 → 20.4      wallFps  21.7 → 20.8      frameP50  48 → 49
availMB  4986 → 4985      footprint 133 → 134       events: NONE
thermal: `serious` for 100% of the run (2,410,000ms)
```

**241 samples, hands-off, hot the whole time, and flat.** Nothing degraded — not the app, not the wall, not memory. No context loss in 40 minutes of broadcasting, which also localises that failure to **arming a take**, not to broadcast duration.

**▶ `serious` IS NOT A DEGRADATION STATE ON THIS HARDWARE.** It is simply where an M1 iPad lives under a 4K broadcast. **The arc has chased heat since B660; this ends it.** It also exposed the instrument defect fixed at B672: the glanceable warning fired on `serious` alone and would have shouted through forty minutes of a healthy run.

**▶ MEMORY IS ANSWERED FOR LONG RUNS TOO.** 4986 → 4985MB free over 40 minutes. No leak.

### ⚡ THE ONE REAL CEILING IS POWER, AND IT IS A PORT-CONTENTION PROBLEM

**70% → 55% in 40 minutes while charging = 22.5%/hour.** From full, **~4.4 hours**, not eight.

**Daniel's diagnosis is the likely mechanism and it is a design constraint, not a device flaw:** HDMI-out occupies the USB-C port, so charging runs through the Magic Keyboard's slower passthrough. **The two compete for one port.**

**▶ THE NEXT TEST IS HIS OWN WORKAROUND: charge directly + broadcast over AirPlay.** That changes both the power path and the video path, so it needs measuring rather than assuming — and if it holds, the eight-hour exhibit has a supported configuration and a documented unsupported one.

**Caveats to keep attached:** five-year-old iPad, unknown battery health, already warm, started at 73%. **Worst case — which for an exhibit is the useful case.**

**▶ THE GOVERNOR ACTED FOR THE FIRST TIME OBSERVED:** `pip enabled: false`, `preview rate: 3`. It had only ever reported `futile` or `nothing to protect` before.

### 🔌⚡ B671 — TWO FINDINGS THAT CHANGE WHAT THE LADDER IS FOR

**1. THE DEVICE LOSES CHARGE WHILE PLUGGED IN.** 85% → 80% → 75% in 58 minutes, `power: charging` throughout. Straight-lined that is **empty in ~7.5 hours** — the eight-hour exhibit failing with **no fps signature at all.** Daniel predicted this before any instrument could see it. **Caveats: iOS quantises battery to ~5% steps (three points is a direction, not a rate) and these were heavy runs, not an idle exhibit. T7 is what turns it into a number.** A glanceable warning now fires when charge falls while charging.

**2. THE WALL GOT FASTER WHILE THE APP COLLAPSED.**

```
wallFps 25.0 → 30.3 → 31.3 → 29.4     app fps 24 → 17.5 → 17.6 → 16.7
```

**Anti-correlated, not merely decoupled.** The external view is a second webview that **decodes the clip itself** and applies a ~1KB state stream; it never consumes our rendered frames. **On the video path the broadcast is largely immune to what the app is doing** — the design working as intended, measured for the first time.

**▶ SO THE LADDER'S MIDDLE ROWS NEED REWRITING.** Daniel's rubric keys "don't offer it" and "warn" on BROADCAST fps. On this evidence **those rows would almost never fire on the video path** — not even through a GL context loss and a dead take. **What actually needs gating is the take dying and the context dropping**, plus the operator's own view becoming unusable, which he has already called acceptable. **Before building row 2 or 3, decide what they key on** — the camera and still paths may behave completely differently and are unmeasured.

**▶ THE WATCHDOG WORKS.** `t=20 gl-context-lost · t=23 take:started · t=29 take:dead`. Take A `videoFrames: 0`, and the operator saw an error instead of a silent empty file.

### 📡 B670 — THE WALL'S RATE IS NOW IN THE SERIES, AND THE RESTART HYPOTHESIS IS DEAD

**⚠️ CORRECTION, one turn old:** the "pre-existing broadcast, stopped and restarted" hypothesis is **disproven**. Daniel ran T3 back to back; both clean, including one that stopped a live broadcast, re-tiered and restarted it — the exact sequence blamed. **Four clean runs on B669, three losses before it, no isolated variable.** Not resolution, not thermal, not the restart. It is intermittent and unexplained, and the dead-take watchdog means it is no longer silent. **Chasing it is now lower value than the cost model.**

**▶ THE MODEL PREDICTED A RUN BEFORE IT HAPPENED.** FHD broadcast + FHD take predicted **~13fps**; two independent runs measured **11.2** and **12.0**. Super-additive factor `cost(A+B) ≈ 1.17 × (cost(A) + cost(B))`, stable across two sessions. **Take-matches-app is now confirmed six times.**

**▶ AND THE GAP THAT MATTERED MOST: we have never recorded the number Daniel's rubric is about.** His criterion is the BROADCAST's rate; every series records the APP's. They are decoupled — 29-of-30 on the wall while the app sat at 12fps. **`wallFps` now rides in every vitals sample.** A post-run report could never recover it: the broadcast is off by then and the external surface reads `0x0`.

**▶ RUNG 1 NEEDS A REAL BASELINE.** "Idle" read 60fps in one run and 37-41 in another, because it was a gap between takes with the external view still tearing down. A cost measured against a moving, vsync-capped baseline has error bars.

### ⭐⭐⭐ THE COST MODEL IS ADDITIVE IN FRAME TIME, AND THAT IS THE COMPUTABLE GATE (2026-08-19, T3b + T3)

**Two runs, B669, same device, same clip, thermal `serious` throughout T3.** Read the app's fps in each state and convert to frame time:

| state | app fps | frame time | cost over idle |
|---|---|---|---|
| idle | ~60 | 16.7ms | — |
| broadcast only | 23.5 | 42.6ms | **+25.9ms** |
| take only | 19.3 | 51.8ms | **+35.1ms** |
| both | 11.2 | 89.3ms | **+72.6ms** (predicted 61ms) |

**The costs add.** Slightly super-additive at the top end, but close enough that a device can measure each output's cost ONCE and predict any combination. **That is the gate Daniel asked for and it needs no device table:** measure, add, compare against the frame budget, warn or refuse. We own the top of the hardware range and none of the bottom — an additive model calibrated at runtime is the only honest way to reach the hardware we cannot test.

**▶ AND A TAKE COSTS MORE THAN A 4K BROADCAST DOES.** +35ms against +26ms. Every instinct in this arc pointed at the broadcast; the recorder is the more expensive output.

### ⭐ THE TAKE IS NEVER STARVED. CONFIRMED FOUR TIMES, AND THE ARITHMETIC IS EXACT.

```
T3  take A   11.2 fps encoded   app during A   ~11.1 fps
T3  take B   19.2 fps encoded   app during B   ~19.3 fps
T3b take     13.9 fps encoded   app: 20s @ ~19.5 then 40s @ ~11.8  ->  14.4 predicted
```

**The take's frame count is the integral of the app's frame rate.** There is no priority inversion to fix: the recorder faithfully captures every frame the app produces, and **the app is the whole story.** The optimization target is the app's render path under recording, not the recorder's share of it.

### ✅ T3b ANSWERED — no context loss when the take starts FIRST

`record on` at t=0, `bus:start`, `take:started` at t=1, broadcast joined at t=21. **No `gl-context-lost` event anywhere**, take ran its full 60s and encoded 836 frames.

**⚠️ BUT THE SAME RUN'S T3 ALSO SURVIVED, so the failure is INTERMITTENT, not deterministic — and B667's filing that called it deterministic was wrong.** Five runs now: three lost the context, two did not.

**The difference the reports show, and it is the new candidate:** every failing run began with a broadcast ALREADY LIVE, which the script then stopped, re-tiered, and restarted. The two clean runs began with no broadcast — B669's T3 logs step 0 as `"why": "already off"`. **So the suspect is now the stop→retier→start cycle leaving the external view stale, not the plain act of arming a take.** Hypothesis with n=5. **Do not build the gate on it yet.**

**▶ NEXT DISCRIMINATOR, and it is a one-line script change:** run T3 twice in a row without touching anything between — the second run begins with a broadcast the script itself started and stopped. If the failure follows the restart rather than the operator's setup, that isolates it.

### 🚨 B669 — A TAKE CAN RUN A FULL MINUTE, REPORT SUCCESS, AND RECORD NOTHING

**The worst thing in the B668 report was not the context loss.** `take:started` fired at t=26, the app recovered to 30-37fps, no error appeared anywhere, and the file had **zero frames**. Nothing on screen suggested a problem. **Shipped a six-second dead-take watchdog** that says so and writes a `take:dead` breadcrumb.

**▶ THE COST DECOMPOSITION, from take A failing:** dead take + live broadcast = **30-37fps**; working take, no broadcast = **23-24fps**; idle = **60fps**. **A working take costs more than a live 4K broadcast.** And the take's own rate matches the app's to within a tenth of a frame, twice running — the take is never starved, the app is.

**▶ STILL UNRUN: T3b.** Daniel has now run T3 three times; the ordering discriminator is what decides whether the gate is about coexistence or about start order. **Do not build the gate before it runs.**

**▶ BATTERY WORKS:** 85% flat, `charging`, across 187s. The eight-hour question is T7's.

### 🔋 B668 — IT IS NOT THE TAKE'S RESOLUTION, AND RECORDING HALVES THE APP

**⚠️ CORRECTS B667's FILING. Daniel's hunch was right and mine was too narrow.** B667 called it "a 4K take on a 4K broadcast". **B668 lost the context on an FHD take** — `take:arm 1920x1080`, `bus:start 1920x1080` at t=20, `gl-context-lost` at **t=21** — and take A encoded zero frames again.

**What is common to every occurrence is that the OUTPUT BUS starts while the external view already holds a live GL context.** T3b (shipped B668) reverses the order to separate "these two cannot coexist" from "starting the bus underneath a live external view". Different bugs, different fixes; do not build a gate until that run says which.

**▶ AND THE PRIORITY QUESTION HAS A DIFFERENT ANSWER THAN EITHER OF US EXPECTED.**

```
between takes, nothing running   fps 59.0, 57.9
during take B                    fps 23.4, 24.1, 24.3, 24.1, 23.0, 22.8
take B's own encoded rate        23.5fps
```

**The take matches the app exactly. It is not being starved — it faithfully records every frame the app produces, and the APP is what collapses.** Recording costs ~25ms/frame and cuts the app's rate by 60%. **So this is not a priority inversion to re-prioritise; it is a cost to find and reduce.**

**✅ CLOSED B683 — AND THE COUNTER WAS NEVER BROKEN.** The `bus` surface measured **render** and **readback**; a take's cost is in **`sink.publish(f)`**, which was timed into `diag.ops` (a ring the panel does not show). Publish is now a ledger pass. **The zero was also honest**: with a still source the idle elision skips render and readback outright, so `calls: 0` was true — the note now names the elision so a true zero and a broken counter are no longer the same reading.

**▶ NATIVE VITALS ARE FULLY HEALTHY VIA PUSH.** Continuous series, thermal `nominal` for the whole 200s run, `availMB` 4961-4993, `footprintMB` 126-158. Memory remains a non-issue.

**▶ BATTERY IS NOW INSTRUMENTED, because Daniel found a ceiling nothing measured:** charge rate versus draw over hours. An exhibit that dies from this looks like nothing at all in the fps series.

### 🧨 B667 — THE 4K-TAKE-ON-4K-BROADCAST GL DEATH IS DETERMINISTIC. FOUR OCCURRENCES.

B661 fatal · B663 fatal · B666 twice, survivable. **Same trigger every time: arm a 4K take while broadcasting 4K.** In B666 the context was lost and restored, arming took 6s instead of ~1s, and **take A ran 60 seconds and encoded ZERO frames.**

**▶ THIS IS ENOUGH EVIDENCE TO GATE ON.** It is not an edge case any more. The honest product answers, in order: cap the take tier while a 4K broadcast is live, refuse the combination with a clear message, or make the take the priority and shed the broadcast. **Daniel's own framing applies — understand the constraint, gate on it, do not hardcode the device.**

**▶ AND THE 4K TAKE IS BAD EVEN UNOPPOSED.** Take B, no broadcast, app at 59fps: **13.4fps at 4K** (804 frames / 60.1s) against a declared 30. Wall and span agree to 0.3s, so the number is trustworthy now. **A 4K take is not losing a contention; it cannot hit its own target alone.** T3's real question — is the FHD take a priority inversion — is still unanswered and now runs at FHD by construction.

**▶ NATIVE VITALS ARE LIVE VIA THE PUSH CHANNEL.** `pushes: 57`, `pressure.source: native+inferred`, thermal `serious` read for the first time. `pingOk: true` against `read`'s 28/28 timeouts proved the failure was the method NAME; renamed `readVitals` at B667.

**▶ THE RUNNER IS NOT THE PROBLEM.** Daniel asked whether it would be easier to test manually. **No** — the run executed 17/17 steps correctly, and its report is the only reason we know take A encoded zero frames rather than "the take didn't work". Two real runner defects found and fixed (lost session, uncontrolled tier); neither is a reason to go back to hand-driving.

### 🩹 B666 — THE FIRST SCRIPTED RUN WAS VALID AS A RUN AND INVALID AS A TEST

**`outcome: complete`, 16/16 steps, and it measured nothing** — both takes were of a still frame, because the script never started playback and a freshly loaded clip parks paused (B595). **"Complete" and "meaningful" came apart, which is the exact failure a scripted test exists to prevent.** Fixed with a `play` step (verified, not assumed) and a pre-flight that names every knowable precondition before the operator walks away.

**⚠️ TWO MEASUREMENT DEFECTS FOUND BY THE SAME RUN, AND ONE IS OLD:**
- `takeFps: 13770`. B665 asserted `videoFrames / wallSec` was the take's frame rate **from a field name and a comment, without checking the value.** The wrong-noun test, skipped. Denominator is now `videoSpanSec`.
- **`wallSec` was broken anyway, by a shadowed variable** — `finish()` declared its own `t0` over the take's, so the field documented as *"how long the take really ran"* has reported the FINALIZE duration in every take report this project has ever produced. Fixed in `recorder.js`.

**▶ THE NATIVE PULL HANGS AND THE ANSWER IS DEFINITIVE:** `attempts 34, timeouts 34, errors 0, resolved 0`, `why: "read() never settles — bridge call hangs"`. B664's instrument earned itself on its first run. **B666 routes around it: the plugin now PUSHES every 5s through `notifyListeners`, the channel we know works.** The pull stays wired and instrumented, plus a `ping` method whose only job is to separate "every bridge call hangs" from "something about `read`". **Needs an Xcode build.**

**▶ A LEAD, NOT A FINDING, FROM THE INVALID RUN:** on a STILL source with the app at 59fps, take A (broadcasting) encoded 22.9fps and take B (alone) 26.0fps against a declared 30. Suggestive of fixed cost in the recorder path rather than contention — **confounded by identical-frame elision on a still source**, so T3 still needs its real run.

### 🤖 B665 — THE SCRIPTED DEVICE TEST IS IN. `run scenario` IN THE FRAME-COST PANEL.

Three scripts: **T2** hands-off (11 min), **T3** recording-priority A/B (~4 min), **T7** warm long run (10 min warm + 40 min measured). The app drives session, broadcast, takes and waits; the operator starts it and copies the report. Lands under `scenarioRun`, **aborted runs included**.

**The take's real frame rate is measured in-app** — `videoFrames / wallSec` from the recorder's own finalize report. T3 never needed a video inspector.

**Next device action is T3, and it is now one tap.**

### ⭐⭐ T2 ANSWERED — THE COLLAPSE IS INTERACTION-DRIVEN, AND THE 4K BROADCAST ITSELF IS STABLE (2026-08-18)

**11-minute hands-off run, M1 iPad Pro, 20.4s 4K clip looping to a 4K HDMI wall, nothing touched.**

```
67 samples · fps 19.6 – 25.0 · frameP50 44–48ms · events: [] · zero collapses
```

Against the interactive run of the **same clip on the same hardware minutes earlier**, which crossed repeatedly into a ~10fps state and bottomed at 9.8fps.

**▶ THIS RETIRES HEAT, MEMORY DRIFT, AND LOAD-OVER-TIME as explanations for the bimodal collapse.** Every one of them predicts degradation in a hands-off run, and there is none. **The device sustains a 4K → 4K broadcast indefinitely. What it cannot sustain is that broadcast plus a human editing.**

**▶ AND THAT IS A BETTER PROBLEM THAN THE ONE IT CLOSED.** The ceiling is not a device limit we have to gate around; **it is the cost of an interaction, which is ours.** The first cut is Class 1 and runs on desktop: with the ledger open, diff idle against a sustained canvas drag. Suspects already in view — the overlay redraw, `foldSliceIntoSource` re-running on every render inside a drag (**also the radial-pan suspect, so the two threads converge**), and per-pointermove state writes.

### ⚠️ THE GOVERNOR RAN ITS OWN EXPERIMENT AND PUBLISHED A NULL. BELIEVE IT.

```
futile: true
"shedding every editor view did not move the delivered rate
 (31% under before, 31% after) — panels restored.
 Whatever the wall is, it is not the editor surfaces."
```

**It shed every editor surface and the wall did not improve.** So the display's ~21-23-of-30 ceiling is NOT editor contention; the loss is in the decode → fan-out → external path (`30 arriving/s · 25 drawn/s · 21 new pictures/s`).

**⚠️ THIS PARTLY CORRECTS THE B664 NOTE ABOVE.** "Shedding renders should beat shedding pixels" was inferred from the PiP costing 16.6ms for 0.09MP. That inference is about **the app's own frame cost** and may still hold there. **For DELIVERY it is now disproven by the app's own measurement** — do not carry it as a delivery optimization.

**No native readings in this run** (`nativeReadings: false`, no thermal transition, so no push and the read path still never landed). B664's `vitalsSeam.why` names the cause in the next report.

### 🌡 B663/B664 — THE PLUGIN IS ON DEVICE AND THE FIRST NATIVE NUMBERS ARE IN

**`nativeReadings: true`. Three things are now known that were not:**

1. **MEMORY IS NOT THE CONSTRAINT.** `availMB 4969`, `footprintMB 150` — ~5GB headroom, 150MB used, during a 4K source → 4K HDMI broadcast on the M1 iPad Pro. **The named "open risk" of memory at 4K is, for this scenario, answered and negative.** The Air (8GB) is still worth running, but the hypothesis is now much weaker.
2. **THE COLLAPSE IS NOT HEAT.** First collapse at t=210 (10.9fps); first thermal transition to `serious` at t=441. **Nearly four minutes apart, in that order.** The bimodal finding survives contact with real thermal data.
3. **⚠️ THE READ PATH IS BROKEN AND ONLY THE PUSHES WORK.** Native values landed on 3 of 56 samples — exactly the three inside the staleness window after a thermal push. B664 makes the seam publish `vitalsSeam.why`; **the next report names the cause.** Until then, expect thermal only at transitions and no memory series.

**▶ AND THE MOST ACTIONABLE FINDING IS ABOUT THE GOVERNOR, NOT THE DEVICE.** `signal: "display"`, `shortfall: 0.04`, verdict *"keeping up"* — while `appShortfall: 1` and the editor ran at 12.3fps. **The governor watches the wall and is blind to the app.** That is the mechanism behind every "it stutters but the instrument says fine" report in this arc. Paired with: the PiP costs 16.6ms for 0.09MP against the preview's 25.1ms for 1.57MP, **so per-render cost is dominated by sampling the 8.29MP source, not by output pixels — the resolution ladder buys much less than its shape implies.** Shedding RENDERS should beat shedding pixels, and that is a testable change to the governor rather than a device limit.

### The three findings that must survive compaction

**1. THE fps COLLAPSE IS NOT THERMAL, AND WE HAVE NO THERMAL DATA ANYWAY.** Two sessions, both bimodal rather than monotonic. Run 1 (12min, 6:39 4K clip): **9 crossings between a ~22fps state and a ~10fps state, with its best sustained reading (25fps) arriving four minutes AFTER its first collapse to 10fps.** Run 2 (150s, 106s clip): collapsed 22.2 → 10.0 at t=10 and recovered to 21.4 by t=20 — **ten seconds apart.** Heat does not do that. **Something switches on and off.** A snapshot at the end of either run would have said "10fps, critical" and sent the next session chasing temperature.

**⚠️ AND `nativeReadings: false` IN BOTH — every `thermal` field is null.** The vitals plugin does not exist. **No conclusion about heat is available from any run so far**, and Daniel must state device temperature explicitly until it lands.

**▶ THE DECISIVE NEXT EXPERIMENT, AND IT IS CHEAP: A HANDS-OFF RUN.** Daniel was interacting throughout both, and independently reports that pan/zoom stutters visibly while fps does not move. If the ~10fps episodes vanish when nobody touches the device, the mode is INTERACTION-driven rather than thermal or load-driven, and the whole ceiling question reframes.

**2. THE PAUSES DANIEL SEES ON THE WALL ARE OURS, THEY ARE THE LOOP WRAP, AND THEY ARE VISIBLE IN THE REPORT.** Run 2: `extJitter.loop.maxTakeGapMs 1596` / `loopStall.maxTakeGapMs 1589` / `srcFanOut.maxSwapGapMs 1700`, against a routine `swapGapMs` of 325. `recentTakeGaps: [1596, 125]` over 2 wraps — **the first wrap cost 1.6 SECONDS, the second 125ms.**

**⚠️ CORRECTED AT 2026-08-18 docs — DO NOT CARRY THIS AS A REGRESSION.** Daniel: *"the clip i'm using hasn't been built into a loop but even so when i watch it loop i don't visibly see the frame hold issue."* And the shape agrees with him rather than me: `recentTakeGaps` is `[1596, 125]` over TWO wraps, so the huge gap is the FIRST transition — clip start / initial seek — and the only real loop cost 125ms, which is in family with B608's measured 141-158ms. **I read a startup cost as a steady-state regression and filed it as one; his eyes were the better instrument.** What remains genuinely open is the 325ms routine `swapGapMs` against the 141-158ms on record, which is worth one look but is not what he was seeing. The original text follows for the numbers: `BROADCAST-DELIVERY.md` §6a closed it at B608 with a measured 141-158ms lap, and `headSeconds: 0.22` was sized to exactly that. The lap is now 325ms routinely and 1700ms at worst, so **the cache covers 41% of a normal lap and 8% of a bad one** — while `loopCache.why` still advises *"raise the budget"*, which is the known B609 under-report giving bad advice. **Do not raise the budget on its say-so.** The real question is why the lap grew 2-10x, and it is a different question from the one B608 answered.

**3. THE HDMI DONGLE CHANGE IMPROVED DELIVERY, MEASURABLY.** Run 1 (old): `delivered 24/30`, note `⚠ UNEVEN: 39ms typical, 63ms p95`. Run 2 (new): `delivered 29/30`, note `steady (34/54ms)`. `broadcastCeiling.hdmi:3840` moved 24 → 29 over 63k samples. **Daniel's separate report of brief BLACKOUTS is not the same event as the held frames** — a held frame is ours (finding 2); a truly black frame is more consistent with the dongle renegotiating link, and the two separate cleanly because our counters show a take gap only for the former.

### ⭐ THE CRASH IS SOLVED, AND IT IS A 4K TAKE ON TOP OF A 4K BROADCAST (2026-08-18 docs)

**Daniel ran the discriminator and the flight recorder caught it exactly.** One variable, same clip, same destination, same session:

```
FHD  22:19:01.246  take:arm 1920x1080  broadcasting=true
     22:19:02.351  take:started                          -> SURVIVED
4K   22:24:22.714  take:arm 3840x2160  broadcasting=true
     22:24:23.396  take:started
     22:24:23.876  gl-context-lost                        -> 480ms after the take started
     22:24:35.080  gl-context-lost                        -> again; recovery re-armed and died too
```

fps was **34.0 at t=70**, one sample before. At t=84 it is **1.0**, `frameP50 163ms`, `frameP95 3419ms`.

**This is not thermal, not memory-over-time, not gradual. Arming a 4K encode while broadcasting 4K over HDMI kills the shared WebKit GPU process in under half a second.** It is the same suspect `BROADCAST-DELIVERY.md` names twice — the GPU process is shared across both webviews and its loss takes every context at once — now with an exact trigger and a working negative control (FHD).

**⚠️⚠️ AND THE HEADLINE IS NOW NARROWER THAN "4K TAKE KILLS IT" (Daniel, 2026-08-18). A 4K TAKE ON A 4K WALL SURVIVED — with a ~20s clip.** *"starting in a best case scenario with the shorter ~20s 4k clip looping I* **am** *able to record... albeit at a terrible 10-12fps... but at a real 4k resolution."*

**So the fatal ingredient is not the 4K encode by itself.** The kill used a 6:39 clip; the survivor used ~20s. **Clip length, or something that scales with it (the loop cache, the decode working set, total resident video memory), is inside the trigger** and the earlier one-variable reading was one variable too few. Do not carry "4K take + 4K broadcast = death" as a rule; carry it as *a* fatal combination whose other terms are not yet named.

**▶ AND THE PRODUCT ANSWER MAY NOT NEED THE MECHANISM AT ALL.** Daniel: *"the common sense metric is that a 10 fps recording isn't usable regardless."* **He is right, and it reprioritises the whole lane.** A 4K take on this device is not a capability we are one fix away from — it is unusable when it works and fatal when it does not. That makes the gate a **product decision available today** (do not offer 4K takes on this device class; offer the resolution that records well) and demotes the crash-mechanism hunt from urgent to interesting. **The reason to keep chasing the mechanism is the GATE'S GENERALITY, not this device's 4K take.**

**⚠️ CORRECTION TO WHAT THE VARIABLE WAS (2026-08-18 docs, read from the code, not guessed).** I described the survivor as an "FHD broadcast" because Daniel said he lowered the broadcast resolution. **He did not lower it, and could not have** — the HDMI sink is `needsBus: false` (`external-display.js:451`), self-rendering at the DISPLAY's native size, and the resolution tier only ever reaches `outputBus.setResolution`, which that sink never calls. **This is B587's finding verbatim** (`output-panel.js:558-561`: *"Daniel switched 4K→QHD, saw no change, and the reason was that nothing changed"*), and I failed to apply it while reading his report.

**So the experiment was CLEANER than filed, not dirtier: the 4K HDMI broadcast was constant across both runs, and the only variable was the TAKE resolution.** The conclusion stands and gets stronger. But two consequences follow:

- **The `take:arm` breadcrumb cannot distinguish the cells of the matrix it is being used to fill.** It records `broadcasting: true` and the bus dimensions, never the wall's resolution or the source's. **The wrong noun, in the instrument built to end wrong nouns** — the flight recorder is currently blind to two of the three axes of the only question it exists to answer.
- **"Lower the broadcast resolution" is not an available mitigation on HDMI.** Any gate we design cannot offer it. The levers that exist are: the take resolution, the source resolution, and the display itself.

**The failure mode Daniel described matches the report precisely:** *"individual elements dropped off one by one: source, thumbnails, output, then the app reset with a blank interface and no source, yet the broadcast continues."* The final report shows `preview 300x150` (the default canvas size — torn down), `source "no source" 0x0`, `overlay 0x0`, `external 0x0`, `broadcasting: false`, governor `"no live output — nothing to protect"`, and **fps 118.9 with accountedMs 0** — rendering nothing, very fast. **The external view survives because it is a separate process**, which is why the wall kept going.

**▶ THIS IS NOW ITEM 2's HEADLINE AND IT IS A CAPABILITY EDGE, NOT A BUG TO FIX BLIND.** The honest reading is that an M1 iPad cannot hold a 4K decode + 4K broadcast + 4K encode at once. **The session audit (still unstarted, Class 1, free) is exactly the work that turns this into a rule we can gate on** rather than a crash we rediscover. Candidate product answers, in order of honesty: cap the take resolution when a 4K broadcast is live; refuse the combination with a clear message; or make the take the priority and shed the broadcast.

**▶ RELATED, AND IT SHARPENS THE SAME POINT: the FHD take that survived produced a bad recording.** Daniel: *"the fps of the saved recording is terrible — certainly worse than the broadcast (as designed) but it feels even worse than in app fps (which isn't the prioritization we want here)."* **A take is a deliverable; an editor surface is not.** The recorder pulls from the output bus, and nothing today prioritises it over the preview and PiP. That is a priority inversion worth its own decision, and it is the cheap half of the same question.

### Instrument defects to fix BEFORE the next long run

1. **`pressure` cannot be read as a trend** — its baseline re-learns per workload, so both series print `"warming up"` MID-RUN and label the same fps differently at different times (22fps "nominal" at t=301, 23fps "fair" at t=20). **Ignore the pressure column in every report so far.** Record the raw baseline beside it or stop carrying it.
2. **`scenario` is manual and was wrong on run 2** — tagged `idle-still` for an HDMI broadcast, so its `baseline` block (saved 2026-08-13, also `idle-still`) is a different world and **the deltas in that report are meaningless.**
3. `loopStall.why` reads `"no loop boundary reached yet"` while reporting `wraps: 2` in the same object.
4. `loopCache.why` advises raising a budget B609 proved sufficient (see finding 2).

### What is queued, in order

1. **The vitals plugin** (BACKLOG, proposed, awaiting go) — thermal + memory headroom. **Batch in ONE Xcode cycle with:** the `coveredMs` fix, the `scenario` guard, and **`listCameras`** for external/USB cameras on iPad (BACKLOG, also proposed).
2. **Daniel's own next test:** broadcast + record simultaneously, FHD first, then one variable at a time to 4K. He expects the crash to reproduce.
3. Item 2's session audit (Class 1, free, no device) — still the highest-value unstarted work and the direct route to the crash cluster.

**👆 B662 — ALWAYS-ON BREADCRUMBS + A REAL TOUCH TARGET. JS + CSS.** B661 required a session for breadcrumbs too, which asked the operator to predict which action would be fatal; they now persist unconditionally as `priorTrail`. And the perform ruler was unresponsive on iPad because `.mf-ruler` is **16px** — the handler fires for touch, there is nothing to land on. 30px hit area on coarse pointers, applied to the shared class so motion gets it too. **Unconfirmed; discriminator in the changelog.**

**📊 DANIEL'S FIRST REAL SESSION (B660, iPad Pro, 12min, 6:39 4K clip → 4K HDMI) — AND THE HEADLINE IS THAT IT IS NOT HEAT.**

The trajectory is **bimodal, not monotonic**: 9 crossings between a ~22fps state and a ~10fps state, and **its highest sustained reading of the whole run (25fps) came at t=441s, four minutes AFTER the first collapse to 10fps.** Thermal throttling does not let you recover to your best number four minutes later. **Something switches on and off, and a snapshot at t=690 would have said "10fps, critical, degraded" and sent us chasing heat.** This is precisely what the session recorder was built to reveal, on its first use.

**⚠️ THERE IS NO THERMAL DATA IN THAT REPORT.** `nativeReadings: false`, every `thermal: null`. Daniel assumed it was captured. Until the vitals plugin lands he must state device temperature explicitly, and no conclusion about heat can be drawn from these runs.

**Standing reads from the same report:**
- **His visual-stutter observation is real and the instrument already agrees.** `extJitter.draw p50 39 / p95 58`, and the external note says `⚠ UNEVEN: new picture every 39ms typical, 63ms at p95`. The 26/s mean hides it — B576's lesson, now reproduced.
- **The unaccounted time is what doubles.** 22fps → 10fps takes accounted 36.8 → 49.5ms but unaccounted 24.2 → 39.5ms. The invisible term grows most, which is the three-GL-uploads suspect (`BROADCAST-DELIVERY.md` §5a).
- **⚠️ POSSIBLE LOOP-HOLD REGRESSION UNDER LOAD.** `maxSwapGapMs: 341` against the 141-158ms in the B608 record, with `loopCache.coveredMs: 133` — the cache covers 39% of the lap. `headSeconds` was sized to a 150ms lap. Not diagnosed; needs its own look.
- `srcArrive.max: 1198ms` — a 1.2s source stall somewhere in the run.

**▶ INSTRUMENT DEFECTS THIS REPORT EXPOSED (fix before the next long run):**
1. **`pressure` is not readable as a trend.** Its baseline re-learns per workload, so the series prints "warming up" twice MID-RUN (t=291, t=341) and calls 22fps "nominal" at t=301 while calling 23fps "fair" at t=20. **Same speed, different labels.** The vitals series should record the raw baseline alongside it, or stop carrying pressure at all.
2. `loopStall.why` reads `"no loop boundary reached yet"` while `wraps: 24` in the same object.
3. `loopCache.why` advises `"raise the budget"` — the known B609 under-report giving bad advice on a budget already proven sufficient.

**▶ THE DECISIVE NEXT EXPERIMENT IS CHEAP: a HANDS-OFF run.** Daniel was interacting throughout, and reports pan/zoom stuttering visibly. If the ~10fps episodes vanish when nobody touches the device, the mode is interaction-driven rather than thermal or load-driven, and that reframes the whole ceiling question.

**🛰 B661 — THE FLIGHT RECORDER. JS only.** B660 held the session in memory and wrote on stop, so it could report every run except the fatal ones. Now write-through on every sample and breadcrumb (synchronous `localStorage` — Capacitor Preferences is async, and async is the write that does not land when the process is dying), a `clean` flag set only on an orderly stop, and recovery on the next launch into the panel and the export as `crashed`. **Breadcrumbs go in BEFORE the risky call** — `take:arm` carries resolution, whether a broadcast was already running, destination and mic.

**▶ DANIEL'S FIRST FATAL, B661, NOT YET DIAGNOSED — DO NOT FIX AHEAD OF A REPORT.** iPad Pro, 6:39 4K clip, 4K broadcast, Xbox controller mapped and in use, autoplay on, all healthy — died **instantly on starting a recording**, black and unrecoverable without a reload. **The shape points hard at concurrent sessions** (a second encode arming while a 4K decode + 4K broadcast are live), which is the session-audit hypothesis arriving on its own. The next report will carry `crashed.lastBreadcrumb`.

**🩺 v0.26.0 · B660 — THE SESSION RECORDER. JS only.** Minor bump at Daniel's call, marking the close of the slice-hardening arc (extents, origin flip, fold, MIDI/gamepad).

`start session` in the frame-cost panel records thermal, memory headroom, fps and frame cost every 10s, keeps running while the panel is closed, and lands in `copy report` under `vitals`. **A separate instrument from the frame ledger on purpose** — the ledger is a snapshot and the arc's questions are curves. **Memory is recorded as HEADROOM first** (what is left before the OS kills us — the boundary we do not own); footprint is recorded but never concluded from. **Thermal is recorded as timestamped transitions**, alongside GL context losses, so a degradation can be lined up against the moment the device changed state. Ring holds one hour; past that the report says `truncated`. `nativeReadings: false` until the plugin lands, because absent must never read as nominal.

**Glanceable warning line** with the reasons, per Daniel's ask. It reads LIVE — a first cut read the last sample while recording and live when idle, which made one indicator mean two things; the harness caught it.

**The `source` row's on/off switch is now disabled.** Nothing honours it: only `engine/index.js` checks `perf.skip` (the render surfaces), and the source path calls `.pass()` for timing only. **A toggle nothing honours is worse than no toggle** — an A/B against a dead lever produces a confident null. The row still reports; only the lying control went.

**▶ NEXT: the iOS vitals plugin, proposed and awaiting Daniel's go.** `ProcessInfo.thermalState` + `thermalStateDidChangeNotification`, `os_proc_available_memory`, `phys_footprint`, `didReceiveMemoryWarning`, behind `env.host.vitals()` — the seam already exists and is wired on both chromes. **Batch it with the two outstanding instrument fixes** (`coveredMs` under-reporting, the manual `scenario` tag) so one Xcode cycle covers all three. **Everything shipped here works on desktop today**, which is what lets Daniel's "crawl" phase start without waiting on a native build.

**▶ THE TEST PLAN, agreed at B660.** Crawl (works today) → walk (pressure-test extreme cases) → run (8h autoplay 4K broadcast with 4K source transitions). **The single most valuable device pairing is his two M1 iPads: the 12.9" Pro at 1TB is 16GB, the Air is 8GB, same silicon** — a controlled A/B on the one named open risk (memory at 4K). The plan's "the Air is a control, not a second data point" is true on the pixel axis and backwards on the memory axis. Air first (it is the floor), Pro only if the Air fails.

**🎯 B659 — THE FOLD ASKS WHETHER THE SLICE IS REACHABLE. JS only.**

Daniel found radial's slice folding away at deep canvas zoom-out. **No radial exception was needed — it was the wrong-noun trap inside the fold's own trigger.** Radial's wedge extent is `1 / (canvasZoom × canvasNorm)`, so zoom-out grows the polygon without bound; across a sweep the intersection with the view stays **constant at 0.500** while the slice's span runs 0.63 → 12.66. `inter / span` stops meaning "can I reach it" once the slice outgrows the screen. The trigger now takes `max(inter / span, inter / viewSpan)` — unreachable requires BOTH ratios low. Nothing else changes: for a normally-sized slice `inter / span` is still the larger term.

**⚠️ ACCEPTED CONSEQUENCE (Daniel is living with it deliberately, and will confirm):** a very large radial wedge can have its ORIGIN pushed off screen with nothing pulling it back. Recovery is zoom in or reset slice. **Do not "fix" this by reinstating a span-only test.**

**▶ THE HARNESS LESSON, AND IT IS THE BIGGER ONE. `fold-check.mjs` passed before AND after** — `canvasZoom` was pinned at 1 in its base state, and zoom-out is the only way to make a slice larger than the view. **B644's lesson recurring in the same file: a null result from a sweep that cannot reach the state is not evidence.** Now sweeps `canvasZoom` log-uniformly 0.05 → 4 (fold count moved 1535 → 1500, which is the evidence the states are reached), and its own visibility assertion had the pre-B659 definition baked in. New `reach-check.mjs` asserts the rule directly: 30 cases where the slice covers ≥25% of the view while being <25% of itself, **all 30 folded by the old test, none by the new one.**

**▶ DANIEL VERIFIED AT B659:** slice min/max on every form, the modifier fix, and the perform ruler scrub.

## 🧹 B658 — DOCUMENTATION CLEANUP (item 3, docs half). No code touched.

Daniel bumped the documentation half of item 3 ahead of item 2. **The code half cannot move** — the plan's hard dependency is that the flags being deleted are the instruments item 2 needs.

| file | was | now |
|---|---|---|
| `HANDOFF.md` | 1372 | **553** |
| `VERIFY-QUEUE.md` | 73 | **38** |
| `BACKLOG.md` | 1644 | 1612 |

**The method, because it matters more than the line count: nothing was archived until its load-bearing content was confirmed to live in a document that gets read.** Three things were only in the file about to be archived and were rescued first:

- **The three-GL-uploads lead** — one frame uploaded as a 4K texture into three contexts every frame, and the observation that every lever this arc pulled makes one of the three cheaper while none asked why there are three. Now `BROADCAST-DELIVERY.md` §5a, with the 2560 caveat.
- **The GL-context-loss confound** on the inverted bake pattern (do a second bake in a session where nothing was lost). Now in `PLAN-LIVE-READINESS.md` §1.
- Two contradictions fixed: `BROADCAST-DELIVERY.md` still called the minimum viable 4K budget unknown after B609 answered it (64MB), and `VERIFY-QUEUE.md`'s "NEXT UP" still listed the input-mapping cluster that item 1.5 closed.

**Archived (moved, not deleted):** `archive/HANDOFF-builds-223-607.md`, `archive/HANDOFF-plan-superseded-b609.md`, `archive/VERIFY-QUEUE-b599-b609.md`. Each carries a header saying what it is, why it left, and where its live content went.

**BACKLOG was deliberately left nearly alone.** Only 139 of its 1644 lines were resolved sections, and most of those are explicitly *"kept for the reasoning"* or carry open device-verification tails. Its length is live items, which is what a backlog is for. The one collapse was the B608 loop hold, a verbatim duplicate of `BROADCAST-DELIVERY.md` §6a.

**⚠️ NOT TOUCHED, needs Daniel's call: `docs/temp/` is 60MB** — twelve iPad/iPhone console logs (Jul 15 → Aug 10) and a `prores-test.mov`. Raw device evidence from this arc, and item 2 is the arc's open device work, so deleting it during the investigation it belongs to is not mine to decide. `docs/daniel-planning/` (120KB) is his and was left alone.



**📐 B657 — ONE SLICE RANGE + THE GLIDE YIELDS. ⚠️ ITEM 1.5 IS CLOSED. JS only.**

**Slice scale is one shared range, 0.1 → 3** (`SLICE_MIN`/`SLICE_MAX`/`clampSliceScale` in `engine/geometry.js`). Daniel chose a shared bound over per-form maxima — *"this captures 99% of the real use cases while still blocking insanely large samples"* — which also removes the form-switch clamp question entirely. **The find: it was already enforced six times in `overlay.js` at THREE different maxima** (slider 5, pinch and wheel 10, handle drags 5). Audit instance seven, and the first found by adding a feature rather than by a bug report. **`zoomCover`/`zoomInFloor` are a DIFFERENT quantity and stay per-form** — they bound how far a canvas zoom-OUT grows the slice at the wall, which is why hex's cover is 0.65 while its slice may legitimately reach 3.

**Stage C closed by audit, not by symptom.** Daniel could not reproduce the handoff jerk (the B636-B640 gesture gate fixed it in passing). Auditing every holder of independent per-field state found **one** real gap: a settling glide held `cur` authoritatively and overwrote any other input for ~0.5s (~1s for phone gestures). Rate loop, `kit/drift.js`, the follower and pointer drags all already adopted correctly. The glide now uses drift's own mismatch test and **yields**.

**▶ ITEM 1.5 IS CLOSED.** Stage A B618-B619 · stage B B655 · stage C B657. The one remaining named sub-item — `slice position x/y` addressing the origin rather than the box centre — is **filed to BACKLOG**, because it is a semantics fix to two targets, not architecture.

**▶ NEXT PER DANIEL: the DOCUMENTATION half of item 3 (cruft cleanup).** He asked to bump cleanup ahead of item 2 to declutter. **The code half cannot move** — the plan's hard dependency is that the flags being deleted are the instruments item 2 needs. Docs consolidation is unblocked and is most of the decluttering.

**🎚 B656 — RELEASING A MODIFIER STOPS WHAT IT ROUTED. JS only.** Daniel hit a runaway zoom (right-stick modifier + d-pad ramp) and correctly identified it as a modifier problem, not a zoom one. **Routing is decided at arrival**, so releasing the modifier first means the d-pad's release is never delivered to the shifted row that started the ramp, and the rate loop integrates forever. Fires on press AND release, because the mirror case (unshifted row masked mid-ramp by a modifier going down) strands identically. **Affected any `ramp` mapping behind a modifier; the new zoom target is just where he met it.**

**🔎 B655 — THE UNIFIED ZOOM IS MAPPABLE. STAGE B OF ITEM 1.5 IS CLOSED. JS only.** A third target, `unified zoom`, drives canvas + slice exactly as a pinch does. **`canvas zoom` and `slice scale` are untouched** — Daniel: *"discrete slice and canvas zoom inputs are more valuable than unified zoom so we don't want to get rid of them."* **Step/ramp only**, because the model is a multiplicative delta with path-dependent overflow and has no position for a fader to hold; `deltaOnly` says so in the UI, and an `abs` mapping falls back to stepping. A press is 19%, matching canvas zoom's confirmed feel. New hooks: `delta` (a target owning its own relative application) and `afterParamWrite()` (writeParam's tail, extracted so the delta path cannot drift from it).

**🏃 B654 — ONE SCRUB ENTRY POINT. JS only.** B653's ruler wrote its own `clock.seek()` per pointermove; Daniel felt it immediately (*"pauses a beat"*). `scrubStillFrame` is not `seek` — it coalesces latest-wins, uses `seekSettled` + `refreshFrame` natively, stands down the thumb pass, and repaints synchronously. Both surfaces now call `env.scrubSourceTo(p)` / `env.scrubSourceSettle()`. **The lesson is the standing one: a behaviour needed twice moves to a shared home rather than being written twice** — and it was broken by the build that shipped right after two days of work about exactly that.

**▶ DANIEL CONFIRMED AT B654:** droste crossfade good in app AND companion video; transparent OOB no longer shows thumbnail generation; the rig loads (Firefox worked, Brave did not — the B651 picker resolved it, deprioritised by his call); **input handoffs between MIDI / remote gesture / trackpad now feel smooth and he could not reproduce the jerk.**

**▶ STILL OPEN, HIGH:** the video-upload-after-live-camera dead end. Daniel has tried two sustained 10-minute broadcasts and **cannot reproduce it right now**; his read is that it wants gamepad input + broadcast output + sustained use together. B646's `swapTrace` + watchdog are in place and will answer it when it next fires. **Do not fix ahead of a report.**

**⏩ B653 — THE PERFORM TIME RULER SCRUBS. JS only.** `#pfRuler` had not one listener while `.mf-ruler` — the class it shares with motion's scrubbable ruler — already declared `cursor: pointer; touch-action: none`, so it had been advertising the affordance and ignoring it. Scrubs in the trimmed + retimed frame the ruler labels, seeking `env.sourceClock` (correct on the native decode path). No pinch/pan twin: perform's ruler has no zoom. **BACKLOG carries it as shipped-pending-verification at Daniel's explicit instruction — delete that line once he confirms.**

**🌗 B652 — DROSTE CROSSFADES ITS ROLE SWAP. JS only.** Parity with the polygon forms, and it was **three marks, not twelve**: the two ring arcs, the wedge sides, the reflection. Everything else droste paints white describes the SOURCE boundary or an affordance state and must stay fixed. The endpoints already agreed (`roleStyle(1)` = alpha 0.9 / width 1.5×; `roleStyle(0)` = amber / 0.6 / 1×), so **at rest the picture is unchanged** — only the journey is new; the one real change is the dash, `[6,4]` → the shared `[4,3]`. `shell/overlay.js` now passes `foldFade` + `roleStyle` into `form.drawOverlay`'s geom object, so any future bespoke overlay gets the ramp the same way.

**🔀 B651 — RE-HOME AN OFFLINE DEVICE'S MAPPINGS. JS only.** Daniel imported a pre-B650 rig and got the stranded state: two DualSense rows, one offline with 24 mappings, one connected with one. B650 could not have rescued it (Chromium's old slug truncates at 40 chars before the vendor digits). **The real defect was that rename, delete and drag all LOOKED like the fix and all silently did nothing** — the device key is invisible, uneditable, and the only thing that matters. An offline device holding mappings now offers "move mappings to…" for connected devices of the same kind; rows are selected by `m.dev` and rewritten positionally within the sig (the two are not guaranteed to agree — the v1→v2 migration wrote `dev: 'unknown'`), duplicates collapse on the TARGET only, and a move that finds nothing says so instead of deleting the row. Also: controller names keep their last letter (28 → 32 chars — "DualSense Wireless Controller" is 29), and the inputs help text finally says set / step / ramp.

**🎛 B650 — A GAMEPAD RIG IS PORTABLE NOW. JS only.**

Pad mappings key on the controller's **vendor+product** pair, not the browser's name for it. `gp.id` is browser-specific by spec (Chromium `...(STANDARD GAMEPAD Vendor: 054c Product: 0ce6)` vs Gecko `054c-0ce6-...`), mappings match on exact sig equality, so an Electron rig could not bind in Firefox. Unparseable ids fall back to the old slug. Existing `localStorage` rigs migrate themselves in place on first sight of the controller, keyed off the sig prefix (so a drifted `dev` heals too), guarded so it cannot fire twice or clobber a rig already on the new key.

**⚠️ Daniel's already-exported `fold-rig.json` will still not bind** — it carries the old slug, and Chromium's is truncated at 40 chars before the vendor digits, so there is nothing in the file to recover. **Re-export once from B650+ and it travels.** Say this if he reports the old file still failing; it is expected, not a regression.

**Two identical controllers now MERGE** (any-press for buttons, largest-deflection for axes) and list as one device row. They already shared a key — `gp.id` has no serial — but each emitted the same signal with its own value every frame, so the bus saw a 60Hz alternation. That was a latent bug, not a cost of the new key. Daniel's read was right: *"that actually feels like a benefit that forces them to sync."*

**Harnesses:** `padkey-check` (all three engine id shapes agree per controller; unknown shapes stay distinct), `padmerge-check` (merge semantics, single emit per change, clean return to 0).

**Still open, in BACKLOG:** re-homing a mapping to a *different* device (different controller model; MIDI still keys on port name, which differs per OS) — drop a row on a device header. Whole-rig export stays as-is by Daniel's call.

**🫥 B649 — A TRANSPARENT SNAPSHOT IS NOT AN OCCLUDER. JS only.**

Daniel's layer order settled it in one line: *"the bottom layer is the solid fill, then the thumbnails, then the actual output content."* The video filmstrip builds async (a seek per cell), `engine.captureFrame` renders into **the live preview canvas** (the engine says so: *"The GL canvas IS the live preview canvas"*), and `freezePreview()` covered that with a 2D snapshot — which, being a snapshot of a transparent output, occludes nothing where the output has alpha. **The live canvas is now hidden outright for the build**, with the canvas's own CSS background carried onto the snapshot so the composite is unchanged. The bug predates transparent OOB; opaque OOB only hid it. Every other capture caller already used `display: none`.

**▶ MY OWN DISCRIMINATOR WAS WRONG, AND THAT IS THE LESSON.** BACKLOG predicted "whole canvas → renders land on the visible canvas / only the holes → something shows through". The answer was *only the holes* and the cause was *renders landing on the visible canvas* — because I had enumerated two mechanisms without checking whether a third thing (the freeze layer) sat between them. **A discriminator built from an unverified list of causes can point confidently at the wrong one.** Daniel's observation was still what solved it; the prediction attached to it was not.

**▶ DANIEL CONFIRMED AT B649:** the fast live transition between primary and reflected states *"feels fantastic"*. Firefox cursors have not recurred (watching, not closed).

**🎯 B648 — THE CHANGE GATE MAY NOT SKIP A CANVAS IT HAS NEVER DRAWN. JS only.**

Daniel's Firefox cursor report **stopped reproducing**, and that is the finding: an encoding failure would be deterministic, so intermittency moves it to lifecycle. `_geom` is written at the END of a draw and read by `classifyPointer` — without it every hit test is `mode: null` and every cursor is `default` (a plain arrow, NOT the `move`/`ew-resize` a failed cursor URL would give). A re-mount hands over a fresh canvas; if state has not changed the signature matches, the draw is skipped, and the new canvas never gets geometry — until something unrelated moves. **The gate now requires cached geometry before it may skip.** A real contract violation regardless; unconfirmed as Daniel's exact case.

**⏱ B647 — TWO FADE DURATIONS. JS only.** Live crossfade 130ms (feedback — you caused it), companion render 900ms (explanation — no hand caused it). Baked window stays exported for motion's timeline-derived progress.

**▶ DANIEL CONFIRMED AT B646:** companion video *"looks excellent"*; clamp + transparent OOB function correctly.

**🔴 TWO NEW REPORTS, BOTH INSTRUMENTED-NOT-FIXED (see BACKLOG):**
- **Transparent OOB reveals thumbnail generation.** Two candidate mechanisms needing OPPOSITE fixes; the discriminator is whether the flash covers the whole canvas or only the transparent regions.
- **Firefox shows plain arrows over the source.** The symptom points AWAY from cursor art: a failed data-URI would fall back to `move`/`ew-resize`, not `default`. `default` means `classifyPointer` returned null, i.e. `_geom` missing.

**🩻 B646 — FILL CROSSES THROUGH ZERO; loadVideo GETS THE TRACE IT NEVER HAD. JS only.**

- **Tinted fill now rides the role ramp** (full at p=0, gone at p=1) and the primary draws a transient tint on its way in, so both sides pass through 0 instead of one blinking.
- **⚠️ `loadVideo` had NO swapTrace and NO watchdog.** B630 wired both to `loadImage` only — so the "picker → guard → decode" coverage I claimed was stills-only, and Daniel's dead end is a `.m4v`. Now traces start/loadeddata/source-set/error/timeout (8s), recording `wasLive`.

**🔴 OPEN — VIDEO SWAP DEAD END, INSTRUMENTED NOT FIXED. Uncertainty state A.**

From the B643 report: `nativeAttach` stamped 74ms after `guard:discard-then-load`, so `loadVideo` ran and reached the native-decode check (declined correctly, iOS-only). The `source` surface still reads **camera** at 1080×1920 and `slice.sourceAspect` 0.5625 matches the camera, not the clip. **So the swap started and the camera stayed the source — but whether `loadeddata` ever fired is NOT knowable from that report**, and it is the branch that decides everything.

**Next occurrence answers it outright:** `loadVideo:loadeddata` present → the decode worked and something later re-asserted the camera (suspect `keepSource: true` plus the live loop). Absent, with `loadVideo:timeout` → the decode itself hung. **Do not guess between those two.**

**🖌 B645 — THE WHOLE STYLE CROSSFADES; OVERLAY CLIPPED TO THE IMAGE. JS only.**

**▶ DANIEL CONFIRMED AT B644: the crossfade renders.** Remaining complaint was that only COLOUR animated.

- **All four properties cross** — colour, weight, opacity, and the dash (via a gap that shrinks to zero; `[len,0]` renders solid). One `roleStyle(p)`, run backwards for reflections, so they cannot drift apart. Verified zero change in all four at the swap instant, monotonic ramp.
- **The filled hole dissolves** via `destination-out` at partial alpha on both regions.
- **Overlay clipped to the image rect** (polygon path + droste). The reflections were always clipped, the PRIMARY never was — invisible on the live panel where the image fills the box, glaring in the letterboxed square companion frame. Affordances draw AFTER the restore so rotation arcs are not cut.
- **Origin dots removed everywhere** — a fill and a stroke crossfaded by two different rules could not agree mid-swap.

**🔬 B644 — THE CROSSFADE, REPRODUCED LOCALLY AND ACTUALLY FIXED. JS only.**

**⚠️ THE WRONG-NOUN TRAP, IN OUR OWN HOUSE.** B643 stamped the fade whenever the fold RETURNED A FOLD — an activity counter. `out` is rebuilt from aligned keyframes every frame, so it always arrives unfolded and the fold re-applies: *"a fold happened"* is true **continuously**, 55 frames of 180 in the measured case. That pinned "time since last fold" at zero, so the primary snapped to amber and stayed. **The handedness is the conserved quantity — it flips once and holds.** The fade now starts on that change, guarded to consecutive frames of an ordered pass (the filmstrip samples at arbitrary p).

**▶ THE PRACTICE THAT FOUND IT, worth reusing:** the bake is fully reproducible in Node — `sampleKeyframes` + `foldSliceIntoSource` are pure, so a harness can drive a whole take and print the fade per frame without a canvas. Scratch harness pattern is in the B644 changelog. **Two earlier harness runs were useless because the authored animation never folded** — B639's alignment keeps both keyframe ends in one frame, so only animations pushed far enough for the PATH to leave the image can fold mid-tween. Build the scenario that exercises the bug before trusting a null result.

**🎞 B643 — THE CROSSFADE REACHES THE COMPANION VIDEO. JS only.**

**▶ DANIEL VERIFIED AT B642:** the OOB keyframe guard works functionally (copy was the complaint, now fixed).

- **A baked frame has no clock**, so `env.foldFadeP` supplies TIMELINE-derived progress; the wall clock stays for the live overlay and a bake cannot expire it.
- **The fold was never announced from motion's sampler** — it folds via `foldSliceIntoSource`, not `normalizeSliceMirror`, so nothing started the fade during playback OR baking. `markSliceFold()` fixes both; the bake passes `{ bake: true }` so it cannot leave a stray fade on the live overlay.
- Verified encoder-independent: ~900ms of playback in every case (27 frames at 30s/30fps, 54 at 5s/60fps, 22 at 120s/24fps).
- **OOB warning copy lowercased + shortened**, and cited in the BACKLOG UI/brand pass as the worked example for interrupt copy.

**🎨 B642 — THE ROLE SWAP CROSSFADES; LEAVING MIRROR MODE GUARDS KEYFRAMES. JS only.**

**▶ DANIEL VERIFIED AT B641:** MIDI translate + release *"feels great"*, motion→perform→motion round trip validated, keyframe animation correct, **companion video renders as expected**.

- **Fold colour flip is a ~900ms crossfade.** No identity tracking needed: at the fold the primary and one reflection SWAP membership, so fading the two CLASS styles past each other is the crossfade. Verified continuous — each copy's colour changes by 0 at the swap instant, then eases to its new role.
- **The overlay's change gate had to be opted out of** for the fade's duration (it animates on the clock, not on state), and `foldFadeP` is a PURE read with one expiry point — a self-clearing read would have ended the animation early depending on which call site ran first.
- **Leaving mirror mode now warns** when keyframes hold an origin off the source, and offers to move them (one undo entry; cancel is safe). A lock-out would be a dead end when the offending keyframe is one of twenty and only reachable by scrubbing. Desktop-only BY FACT — mobile has no motion authoring.

**⚠️ DROSTE DOES NOT CROSSFADE** — its overlay paints its own colours in ~12 places instead of going through `strokeEdges`. Left cutting rather than half-threaded, in BACKLOG.

**🎛 STAGE MANAGER QUEUE OPENED** — Daniel's per-mode-state direction is recorded in BACKLOG with his answers to Q2 and Q4. **His straw man is more decoupled than mine**: a new state per mode with its own undo and canvas, not a snapshot ledger over one shared state. Nothing built; queued deliberately.

**🏷 B641 — set/step/ramp, THE DEFERRED FOLD RE-ARMS, MOTION RE-ENTRY. JS only.**

**▶ DANIEL VERIFIED AT B640:** mapping reorder *"looks and functions as expected"*, droste off-canvas reflection correct, undo *"continues to perform exactly as expected"*.

- **`abs`/`rel`/`rate` now display as `set`/`step`/`ramp`.** Stored values UNCHANGED — no migration, saved rigs untouched. Lab specimens follow.
- **The fold lands after a MIDI/gamepad move.** The render loop is ON-DEMAND: a knob has no release, so its last write rendered inside the idle window, was gated, and nothing ever asked again. Declining now schedules the retry and re-arms until the hardware goes quiet. **A deferred bound that nothing re-requests is not deferred, it is dropped.**
- **Motion re-entry assigns the sampled frame**, so the form picker follows kf0 instead of the previous mode's edit. Selection deliberately not restored.

**🚧 PROPOSED, NOT BUILT — PER-MODE STATE MEMORY.** Daniel named the general rule behind the motion bug. **It is not a safe universal change**: one `state` object is why undo is a snapshot swap and why the engine is stateless. The cheap version that delivers the behaviour is a SNAPSHOT LEDGER (store on leave, restore on enter, inherit on first entry) — one object, three snapshots, no consumer changes. **Four product questions need Daniel's answer first** (what is global vs per-mode, what motion's snapshot means, whether undo crosses a mode switch, whether snapshots survive a source swap). Full write-up in BACKLOG.

**🎯 B640 — DRAG-DROP: THE ACTUAL CAUSE. JS + CSS.**

**▶ DANIEL VERIFIED AT B639:** the gesture-detection pause *"works great"*. Droste thickness proportional. The flip settled — no A/B needed.

- **Mapping reorder FIXED.** `drop` bubbles to the target's ANCESTORS, and rows are SIBLINGS of each other and of the slot; `.in-maps` is a flex column with a 5px gap. Releasing in a gap — or on the slot, which sits exactly where you aim — targeted the CONTAINER, whose ancestor chain contains no row handler. body's file-drop handler swallowed it. **dragover/drop now live on the container**, wired once per element (renderMaps only clears innerHTML).
- **Skeleton slot needed `flex: none`** — a scrolling flex column shrinks items to min-content, and an empty div collapses to its borders. That is why the Lab (which sets `max-height:none`) looked right while the app showed a bare dashed line.
- **Droste reflection** was gated on boundary CROSSINGS, so it vanished once the wedge was wholly past an edge — exactly when it is all there is to see. Now a point test; the seam line keeps the crossing test.
- **Idle window 220 → 100ms.**

**⚠️ THE METHOD LESSON, THREE BUILDS RUNNING: I fixed what I found instead of what was reported.** B634 (`setData`), B639 (`getData`/dragend ordering) and B640 (event target) were each a real defect in this feature, correctly diagnosed and correctly fixed. Only the third was the reported bug. **A plausible defect at the scene is not the cause** — before shipping a fix, name the mechanism that would distinguish "this was the cause" from "this was *a* cause", and if there is none, say so.

**🧵 B639 — THE GATE GENERALISES; DRAG-DROP FIXED FOR REAL. JS + CSS.**

**▶ DANIEL VERIFIED AT B638:** the flip *"is working mostly as expected — a massive improvement"*, no A/B needed, the approach is settled. Gesture inputs *"feel excellent"*. Clamp/transparent OOB correct. Droste thickness proportional. Undo passes smoke tests. Companion video good apart from the origin dot.

- **`kit/gesture-gate.js`** — HOLDS (pointer drag, held button: real begin/end) vs TOUCHES (MIDI CC: no end event, short idle window). The joystick mid-push flip was a genuine gap: B636 asked "is a pointer down" when the question is "is an input still moving this". **Autoplay deliberately still folds** — drift writes state directly and never passes through the bus.
- **Drag-drop: the third report, the first correct diagnosis.** `dragend` clears `dragIdx` and the drop-then-dragend order is not universal, so `drop` ran with `-1` and hit the no-op guard. B634 wrote the `setData` payload and then still read the closure. Now read back off `dataTransfer`. Cross-device drops refused (the list is grouped by device, so they were silently undone).
- **Skeleton drop slot** replaces the 2px line (in the Lab).
- **Keyframes align to the PREDECESSOR, not kf0** — fixes the tween jog. Playback also folds each sampled frame so an animation never sits fully reflected.
- **Origin dot scales with `sw`** — it was 3px at every scale, invisible in the companion video.

**🩹 B638 — THE FOLD GATE WAS READING A FLAG ON THE WRONG OBJECT. JS only.**

B636's fold-on-release gate tested `env.overlayDragging`, which lives on the **private `view` object** `components/source-overlay.js` builds ("replaces the global desktop env"). Each chrome's render schedule passes its OWN env, where the flag is `undefined` — so the gate held at the drag site and did nothing at the render site, and the fold ran every frame mid-drag.

**`move` re-derives its target from the pointer each event**, so pointer-writes and folds alternated at frame rate; half those frames put a folded handedness on an unfolded position, which is a genuinely different picture. **That is why the OUTPUT flickered, and that detail is what diagnosed it — a fold is pixel-preserving and cannot change the output, so output flicker meant state was oscillating.**

Reproduced then fixed: **77–90 handedness flips per drag → 0**, with exactly one flip on release. Gate is now a module-level flag (setupSourceInteraction is already a module singleton), cleared on re-mount so it can never strand.

**⚠️ THE TWO-`env` DIVERGENCE, NEW ACTORS:** not desktop vs mobile this time but **chrome vs component**. Worth adding to the standing audit — the overlay component owning a private view is good design, and it means any flag there is invisible to the chrome.

**🎞 B637 — MOTION KEYFRAMES RECONCILE THEIR FOLD FRAME. JS only.** Closes the one limitation B635 shipped knowingly.

Handedness is the first DISCRETE field COUPLED to a continuous one, so motion's "hold discrete to kf0" rule rendered kf1's position with kf0's handedness. **Fixed by making the pin true rather than removing it:** `alignSliceFrame` re-expresses each keyframe in kf0's frame via the reflection that leaves its picture untouched, choosing the representative nearest kf0's sampled box (`n = round((ref + cur) / 2)`) — the shortest honest travel, which plays as the slice reflecting off the edge.

**Reconciled at the READ points** (`sampleAt`, `stgEval`, `selectKeyframe`), not at the five write sites — B635's lesson applied deliberately. New `COUPLED_DISCRETE_KEYS` in tween.js; the propagation loops in main.js and the gesture-capture path skip them.

**Verified across 5 forms × 3 aspects:** aligned keyframe renders as posed (drift 2.2e-16), zero handedness mismatches, worst travel 0.81 source-widths.

**🔧 B636 — FOLD ON RELEASE + THE B635 SMOKE-TEST ROUND. JS only.**

**▶ DANIEL VERIFIED B635 BROADLY:** desktop mouse + MIDI, iPad gesture surface → Electron, iPhone/iPad direct manipulation, desktop perform + autoplay. *"No major showstoppers."* **Still untested: the rendered companion video with the slice overlay.**

- **The fold waits for gesture RELEASE** (`?fold=live` restores B635's continuous fold for A/B). Drags only — knobs, encoders, autoplay and the tween have no release and still fold live, which is what keeps the leak closed.
- **iPad stutter FIXED, and it was not the fold's arithmetic.** A box measurement is 1µs; the cause was `visibleUVRect` reading `clientWidth` — B635 promoted that from drag-only to EVERY FRAME, so every render was preceded by a layout flush. Now reads the canvas backing store. Also killed a doubled measurement in the pinch capture and the per-vertex `{mx,my}` allocation.
- **Reflected copies draw the ORIGIN** — polygon forms and droste.
- **Onion-skin trail clears on a fold** (Daniel's own call). The alternative — re-folding each ghost so the trail bounces off the edge the way the render did — is noted in the code if the lost history ever bothers him.
- **Droste thickness genuinely proportional now.** B634 was wrong twice: `geometric` never applied to ABSOLUTE-mode mappings at all (so his mapping never reached it — *"seems unchanged"* was literally true), and where it did apply it sized the step by the ARITHMETIC span, giving ~98% per press. Now log(max/min); canvas zoom's confirmed feel preserved.

**⚠️ THE METHOD NOTE:** B634 shipped a fix for a target whose mapping MODE it never checked, and calibrated a constant against one target's span while applying it to another's. Printing the step-size table across the range would have caught both in two minutes, and is now in the changelog.

**🪞 B635 — THE GEOMETRY FLIP. THE ORIGIN GUARDRAIL IS GONE. JS + GLSL — `cap sync` for device builds.**

Push the slice off the source and the reflection you can see **becomes** the primary slice. New state `sliceMirrorX/Y` (±1 handedness) threaded through the shader, geometry, overlay, droste, tween and follow.

- **The bound is measured on the SAMPLED region now**, not the declared polygon — which is what closes droste's leak, where the origin sits far from the wedge you actually see.
- **Trigger is Daniel's own 25% overlap threshold from B631**, against the VISIBLE source. The response changed, not the number.
- **`sliceCx/Cy` mapping envelope back to ±0.5.** B634's ±0.25 was an admitted mitigation and the range carries no safety load any more.
- **Report gained `slice.mirror` / `slice.sampleC` / `slice.sampleHalf`.**

**Why this and not a sixth patch:** the guardrail leaked five times from five different writers because `clampOriginToSource` lived in the overlay's drag handler and could only bound the writer it sat inside. The fold makes the bad state *unrepresentable* instead of defended, and runs on the state about to be shown — two sites, both chromes' render schedules plus the post-drag site.

**VERIFIED BY HARNESS, NOT BY ASSERTION:** 144,000 sampled-UV probes over 5 forms × 4 source aspects, 1,622 folds, **worst pixel drift 8.9e-16**; idempotent; slice never left invisible where a better representative exists. Droste's angle-map exact to 9.2e-16. Every form's default is inert under the fold on all five aspect pairs.

**⚠️ MEASUREMENT KILLED THE TIDY VERSION.** Folding when the box CENTRE crosses an edge is cleaner arithmetic and wrong: droste's default wedge centres at u=1.091 on a square/portrait source, so a fresh droste would fold on sight and open with its origin off-panel. `defaultOverflow` is droste declaring that overflowing IS its look. **Daniel predicted this exact failure in the spec; the harness is what proved it.**

**▶ NEEDS DANIEL ON DEVICE — the parts a harness cannot answer, all about FEEL:**
1. **The teleport at fold.** When the slice drops below 25% visible it jumps back mirrored. The render never changes (pixel-identical), only the overlay outline moves. Legible as "it comes back", or jarring?
2. **Post-fold drag direction.** After a reflection, pushing further in the same direction moves the visible slice the other way. That is honest mirror behaviour and matches the output, but it is the thing that felt wrong before — worth a deliberate try.
3. **iPhone `cover` crop** — the trigger uses the visible rect, so B633's complaint should be gone. Confirm.
4. **Droste specifically**: origin off-panel while the wedge stays put; the offset diamond after a flip; rotation direction after a flip.

**🔩 B634 — REORDER, MODIFIER ROWS, DROSTE THICKNESS. JS only.**

- **Mapping drag-reorder works again** — `dataTransfer.setData` was never called, so `dragover` fired (line appeared) but `drop` never did. Missing since B278; a long-standing bug, not a regression.
- **Modifier rows no longer show mode/sensitivity** (both meaningless for a held modifier).
- **Droste thickness steps are GEOMETRIC.** It is the tier RATIO, so perception tracks log(drosteZoom): a fixed step was a 68% change at 1.1 and 4.9% at 16.

**▶ VERIFIED BY DANIEL AT B633:** d-pad double mapping, the modifier layer, and droste accumulated follow all working. **The B632 cycDelta fix holds up in real use.**

**🛡 B633 — THE ORIGIN GUARDRAIL, MADE DURABLE. JS only.**

Two holes in B632's guardrail, one per symptom Daniel reported.

1. **The bound was only asserted in the `move` branch**, so `scale` / `square-edge` grew the box past it with nothing re-checking — *"make a slice larger and I can still move the entire slice off canvas."* Now enforced at **one site every drag branch falls through to.** A per-branch call is something each future mode must remember, and that already failed once.
2. **Overlap was measured against the FULL source**, but the phone mounts the overlay `fit: 'cover'` so its panel shows a crop — a slice could satisfy the bound while sitting entirely in a part of the source the panel never shows. **Now measured against the visible rect**, derived from `_geom` ∩ canvas: `contain` returns [0,1] (no change), `cover` returns the crop. One derivation, both chromes.

Verified at scales 0.667 / 2.0 / 4.0 against both the full source and a simulated crop: 25% overlap holds in every case.

**Semantic flip: DEFERRED by Daniel** — *"introduces complexity isn't worth it yet."* The guardrail is the feature.

**🎯 B632 — THE DROSTE LOOP'S ACTUAL ROOT CAUSE. JS only.**

**`cycDelta` had a sign bug and that is the whole thing.** JS `%` keeps the DIVIDEND's sign, so `((b - a + 1.5P) % P) - 0.5P` left its own ±P/2 range as soon as `b` (the RAW state) drifted negative — which autoplay's walker does constantly:

| b | a | returned | should be |
|---|---|---|---|
| −3.2 | 0 | **−1.200** | −0.200 |
| −12.4 | 0.6 | **−1.000** | 0.000 |

Each injects a **whole period of error into the target every frame.** That is the traced `state −1.004 / tgt −2.004`: **the follower was never misbehaving — it was handed a target a full loop from the truth.** Fixed with a double modulo. Also latent for ROTATION (P=360) on any raw negative angle.

**`LEAD_CAP.drosteZoomPhase` is BACK TO 4** — the sweep is now flat across caps 1/2/4/8 (0/300 blow-ups, lag ≤0.53 even at tau=3s), so Daniel's accumulated multi-loop follow returns.

**⚠️ THE METHOD LESSON — the sharpest of this arc.** B623's A/B was executed correctly and concluded wrongly. Varying `LEAD_CAP` genuinely changed the failure rate, so it looked causal — **but it only gated how much room a defect elsewhere had to hide in. A lever that suppresses a symptom is not evidence that the lever is the cause.**

**Origin off-canvas now requires 25% box overlap** with the source (Daniel's own fallback). His preferred **semantic flip is feasible but is a feature**: folding the position is trivial, mirroring the slice's handedness needs a new `sliceMirrorX/Y` state threaded through shader + geometry + overlay + tween + mapping. Filed, not smuggled into a clamp.

**🔧 B631 — THE DUPLICATE PROMPT WAS INVISIBLE AND PRE-EMPTED. JS only.**

Daniel: *"it still just highlights the existing mapping without asking."* **Two bugs, and his sentence named both.**

1. **The prompt was inserted INTO `.in-maps`**, which is `max-height: 62vh; overflow-y: auto`. With any real rig the list is scrolled, so `prepend` put it off-screen above. Now inserted *before* the list + `scrollIntoView`.
2. **A learned button's RELEASE fired its existing mapping.** Learn captures on the press and clears `learnCb`; the release then routed normally, firing the old binding and flashing its row. Swallowed now — **momentary only**, since a cc/axis may never send 0 and latching would mute it for the session.

**▶ THE REPEATED LESSON, twice in three builds:** B629 and B631 both had correct mechanisms and broken paths through the UI. **Verifying the routing is not verifying the feature.** Watch it render in a realistic state (a full list, a real rig) before calling it done.

**🧭 B630 — SOURCE-SWAP TRACE, OFF-CANVAS ORIGIN, LAB DEBT PAID. JS only.**

**The source-swap dead end no longer needs catching live.** Every phase from file picker → guard → decode logs a reason on exit; the last 12 attempts ride the exported report as `sourceSwap`. **An 8-second decode watchdog** covers the reported symptom specifically: if the decode neither loads nor errors, that fact is recorded, which is the one outcome that previously left no trace. `"failed to load image"` now names the format and points at `copy report`.

Two things checked rather than assumed: **`img.onerror` already existed** (I had guessed it was missing — wrong), and `confirmInterrupt` supports `onCancel`, so a cancelled swap is distinguishable from a hang.

**The slice origin may leave the image in MIRROR mode**, bounded at ±1 period. That answers the open question I had put to Daniel: **mirror is periodic with period 2 in UV, so one period out already reaches every distinct reflection** — unbounded would only repeat looks while the numbers grow. Mirror-only because `clamp` smears and `transparent` is empty out there. **Mapping targets resolve to the same range** so hardware and pointer cannot disagree.

**UI Lab debt from B629 is paid:** `.in-dupask` specimen, the `mod` column (section text now says 10-column, not 9), and a state row showing two rows sharing one d-pad with the inactive one dimmed.

**⌨️ B629 — A SECOND BINDING PER CONTROL, AND THE MODIFIER LAYER. JS only.**

**⚠️ B624's form-gating had NO WAY IN and nobody noticed until Daniel tried it.** Mapping the d-pad to both square aspect and droste thickness needs two rows on one signal, and learn refused to make the second — it flashed the existing row instead. **A capability with no path through the UI is not shipped.** Learn now asks: edit the existing, or add a second.

**The MODIFIER layer** is in. Any row can be flagged `mod` (no fixed slots — Daniel's correction). Hold it while learning another control to record a chord; **release it alone and nothing is recorded**, which replaced his proposed 3s window and is faster both ways. A modifier drives no target of its own, and holding one **only masks bindings that have a shifted alternative**, so it never deadens unrelated controls.

**Fit is now 75%** (was 90%). ⚠️ Side effect: **square's default shrinks 6% on desktop** (its box is 0.800, just over the line). Radial/hex/triangle are unaffected at the 1.78 reference. Exempt square if that reads wrong.

**⚠️ OWED: UI Lab entries** for `.in-dupask` and the changed `.in-map` row — filed in BACKLOG.

**📏 B628 — FIT THE BOX, NOT JUST CENTRE IT. ⚠️ `cap sync` REQUIRED.**

**Centring was only half the job.** Daniel's iPhone still showed overage because **the wedge forms' horizontal extent does not depend on source aspect below 1.0** — `sliceVecToSourceUV` divides x by the aspect only for LANDSCAPE sources, so a `sizeNorm` tuned on the 1.78 desktop reference measures 0.632 there and **1.125 on any portrait source** (hex 1.018, triangle 1.300). A box wider than the source is off-image however you place it.

`resetSliceState` now scales the default slice to fit within 90% of the source before centring. **Scales DOWN only, so every tuned value is untouched** — at 1.78 all four fitting forms come out at `scale = 1.000`. Portrait spans `[0.05, 0.95]`. **Droste is exempt** (`defaultOverflow: true`) because its default is deliberately larger than the frame.

**▶ PROCESS CHANGE, Daniel's call and the right one.** The two-chrome divergence rules were in BACKLOG, where a working-process change would quietly die. They now live in **`CLAUDE.md`** (read every session) and **`ARCHITECTURE.md`** (the layering section that owns the chrome split), with the reasoning and the repeatable audit method. `main.js`'s shadowing wrappers are renamed `...Local`, and shared code is handed the kit function directly.

**✅ B627 — THE iPHONE SLICE CENTRING IS FIXED. ⚠️ `cap sync` REQUIRED.**

**It was one missing argument.** `resetSliceState` called `applyArmsSnap?.()` with no argument, an implicit contract only ONE of two callers satisfied: `main.js` injects a zero-arg wrapper closing over its own `state`; `mobile/chrome.js` injects `kit/snaps.js`'s `applyArmsSnap(state)` directly and threw on `state.drosteSpiral`. Because B626 guards that function so it can never abort camera acquisition, **the iPhone silently never centred at all** — which is why the bug survived B619, B623, B625 and B626.

**▶ B626's `sliceError` channel found it on its first run.** The error message named the field. Verified by running the exact mobile injection: origin −0.0625, boxC 0.5000.

**⚠️ SEVENTH INSTANCE of one-behaviour-two-copies**, and **four of the seven were found by a device session or a live show, not by reading.** The shared-quantity audit in PLAN-LIVE-READINESS is no longer tidy-up; it is the highest-yield reliability work available. **Start with `main.js` vs `mobile/chrome.js`: they share no `env`, so every helper injected into both is a candidate.**

**NOT a bug, expect it:** `boxVsSource` 1.125 means radial's default box is 12.5% wider than a 0.75 source, so even perfectly centred it overflows ~6% on EACH side, symmetrically. If that reads wrong the lever is radial's `sizeNorm` for portrait sources, not the centring.

**🚑 B626 — THE RE-CENTRE COULD KILL THE CAMERA. ⚠️ `cap sync` REQUIRED. Fixes a B619 regression.**

**Two defects in one function, both introduced at B619.**

1. **A cosmetic slice re-placement could abort CAMERA ACQUISITION.** It was called from inside `attachCameraSource()` unguarded. Daniel: *"first 'capture still' gives a could-not-start error, second attempt works."* **The second attempt works because the aspect latch early-returns BEFORE the throwing line** — first-fails-then-works is the signature. Now guarded twice; the attach call is a head start, not the mechanism.
2. **It latched an aspect that was not real yet.** The camera's frameSource is a CANVAS whose dimensions are a placeholder at attach time. The render loop now re-checks once frames flow.

**▶ B625's INSTRUMENT IS WHAT SETTLED IT.** Two explanations were indistinguishable by reading; one `copy report` decided it in a line — `origin [0.5, 0.5]` (the default, never re-placed) against a desktop simulation giving −0.063. **The maths was never wrong. The wiring was.**

**The per-frame re-check is safe because of the OWNERSHIP TEST:** the slice is only re-placed while it is still exactly where we last put it (a four-field snapshot). Once a hand, mapping, or autoplay moves any of them, it is theirs.

**🎚 B624 — ONE BUTTON, TWO FORMS, NO HIDDEN WRITES. JS only.**

**A target that does not apply to the active form now DECLINES instead of writing.** Square aspect + droste thickness can share a d-pad. **There was never a routing blocker** (two rows always fired on one signal) **but there WAS a silent bug** — the inactive form's parameter got written anyway, accumulating into undo history and motion keyframes and surfacing only on the next form switch.

**The gate reuses each form's own `controls` array**, the same data that decides which controls appear in the panel. No new configuration. A declined row dims for 400ms, because declining silently is the exact sin the standing rule forbids.

**▶ FILED, NOT BUILT:** a **held-modifier (SHIFT) layer** is the real answer to Daniel's five-forms-four-buttons problem. Chords as he described them need a detection window on every unshifted press; a held modifier does not, and it doubles every binding rather than solving forms alone. **`last form` does NOT cover this** — he is right that oscillation is not addressing.

**🎯 B623 — THE DROSTE INFINITE-ZOOM LOOP IS ROOT-CAUSED AND FIXED. JS only.**

**✅ Daniel ran a full show on B621 and the app "behaved beautifully."** First real-world validation this arc has had.

**THE LOOP WAS `LEAD_CAP.drosteZoomPhase = 4`.** Dropped to 1. Verified over 300 seeded trials wiring `drift.js` → `follow.js` headless: **0/300 blow-ups at cap 1, 134/300 at cap 2, 3 and 4.** BOOST is only an amplifier (scales severity, not rate) and stays.

**⚠️ THE RAISED CAP NEVER DELIVERED ITS OWN CONTRACT** — it exists to bound the lag to `cap` loops and at cap 4 the lag reached **fifteen**. Broken feature, not a risky one.

**Mechanism (frame-traced):** under a continuously moving cyclic target, `setTarget`'s accumulation loses whole periods — `state = −1.004` while `tgt = −2.004`. That hands the spring `y ≈ 1.07`, BOOST quadruples omega, velocity runs to −27 and self-sustains. **The period loss is STILL OPEN; cap 1 only bounds the damage. Do not raise the cap again without re-running the sweep.**

**⚠️ TWO CORRECTIONS TO THE RECORD, both mine:**
1. **B619's disproof was wrong.** It held state CONSTANT after a finger lift and found the follower settles. **The instability requires a target that keeps MOVING.** Right result, wrong experiment. *A stability test must reproduce the forcing, not just the initial condition.*
2. **The pan-unlock "necessary condition" was a red herring.** Daniel found the loop in autoplay with pan apparently locked. Pan-unlock and autoplay are both just ways to keep the target moving. **The droste pan-lock guardrail is no longer needed.**

**Also shipped:** `reset slice` / `reset canvas` are mappable (Daniel hands the controller to audience members and every recovery affordance was on a screen he is not standing at); canvas zoom nudges are **geometric**, a constant 16.6% at every zoom instead of 5% at 4× and 198% at 0.1×.

**🚨 NEW HIGH-SEVERITY, UNFIXED:** a live camera running ~10 minutes then swapping to a file is a **silent dead end** needing an app restart. Filed in BACKLOG with four candidate causes, all Class 1. **Highest-severity open item: silent, unrecoverable, and on the source-swap path mid-performance.**

**⚖️ B622 — DROSTE ZOOM PRESS SIZE + TRANSITION-SPEED DEFAULT. JS only.**

**Droste's infinite-zoom press was ~6× too small.** `canvasZoom` at 5% moves 0.198 absolute (~20% from 1.0×); phase at 5% moves 0.05 of a loop, and a loop is a factor of `drosteZoom` (2× default), so 2^0.05 ≈ 3.5%. **The span of 1 is correct for `abs`** (a fader should sweep one seamless loop), so the fix is the new **`relSpan`**, which scales nudges only. Droste phase gets `relSpan: 3.5`.

**Perform transition speed defaults to 0.5s** (was 0.35). ⚠️ **Six sites carried that fallback** — `state.js`, `perform-runtime.js` ×2, `motion-runtime.js`, `follow.js`, `mobile/chrome.js`. All updated; `state.js` now names the others in a comment.

**🎮 B621 — DISCRETE CONTROLS STEP, THEY DON'T SCALE. JS only.** All from Daniel's DualSense session.

**Segments steps one legal value per press on every form.** The `span × sens` arithmetic is wrong against a snap: at 5% radial nudged 2.3 (looked fine) while droste nudged 0.55 and **the first press did nothing**, which is the 2x/4x tapping he reported. **No sensitivity fixes both**, so discrete targets now declare `nudge` and use the form's own snap as the authority. Sens column reads `1 step`; `rate` mode is withdrawn for discrete targets.

**`last form (toggle back)`** replaces the awkward left-stick-press-to-radial. **A two-form toggle would need a default; last-form does not** — whatever you were on before, go back.

**`zoom` renamed `canvas zoom  (droste: infinite zoom)`.** ⚠️ **The asymmetry Daniel found is CORRECT, not a bug: radial's `buildPolygon` genuinely depends on `canvasZoom`** (wedge extent is `1/(canvasZoom × canvasNorm)`) so its overlay moves; the tiling forms' cells do not. `slice scale` is the control he wanted and it works everywhere.

**🔬 B620 — THE DROSTE HUNT GETS AN INSTRUMENT. JS only.**

**`?probe=motion`** arms a read-only probe ([kit/motion-probe.js](../src/kit/motion-probe.js)) that publishes to the frame-cost panel's `copy report`. **Headline number: `quietMovingMs`** — how long a field travelled while every known writer was idle. `verdict` names the field in one line. Follower spring internals ride alongside via the new `follower.debugState()`.

**▶ HOW TO USE IT:** load with `?probe=motion`, reproduce the loop, then `copy report`. **If a field shows `quietMovingMs` above a few hundred, that field is the bug and a writer was missed by static reading. If everything is flat while live still moves, every hypothesis so far is wrong and the motion is downstream of both state and the follower.** Either answer closes the question.

**FOUR HYPOTHESES ARE NOW DEAD** — follower runaway (disproven by simulation over 65s measuring rate, not displacement), autoplay drift (gated), flick-to-drift (gated behind drift mode, **Daniel confirmed it was off**), joystick handle feedback (`syncAll` moves only the dot). **Do not re-propose any of them.**

**⚠️ AND WHAT REMAINS IS A CONTRADICTION.** With autoplay off, drift mode off and no fingers down, an exhaustive grep finds **no writer that can move `canvasOffsetX/Y` or `drosteZoomPhase`**, and the follower provably settles against constant state — yet the motion is real. Either a writer was missed, or the moving quantity is not one of those two. **Instrument, do not read.**

**🐛 FOUND WHILE INVESTIGATING, UNFIXED:** the droste centre-offset joystick is a **second `createPanJoystick` instance** with its own drift state, and `env.panDrift` points only at the canvas-pan one — **so a latched droste-offset drift cannot be cancelled by any gesture.** Same shape as the reported bug. Left unfixed deliberately: unconfirmed as the cause, and the fix changes behaviour on a path needing device verification.

**🛡 MITIGATION THAT WORKS TODAY, NO CODE: do not unlock pan on droste.** Every unfixed occurrence (B611, B612, B619) required it; the one that did not (B610, stray touch) is already cured. Droste ships pan-locked by default, so the safe configuration is the default one.

**🎛️ B619 — MAPPING GAPS CLOSED; THE iOS CENTRING THAT NEVER RAN. ⚠️ `cap sync` REQUIRED — the iOS fix is the point of this build.**

**MIDI learn now lands UNASSIGNED (`— pick a target —`).** It used to default every learned control to `slice rotation`, which compounds: a rig built in one pass ends up with several rows all claiming slice rotation and all fighting, with nothing on screen saying so. **This is the suspected cause of Daniel's "crossed wires" symptom and is still UNCONFIRMED — the confirming observation is a count of how many of his existing rows say `slice rotation` that he did not choose.**

**Newly mappable: form selection** (`next` / `previous` plus one direct target per form — previously you could reshape a form from hardware but never change it, the largest single gap on that screen), **`segments`** (form-routed: radial 2–48, droste arms 1–12), **droste mirror / wedge mirror**, and **out of bounds** (as a cycle).

**⚠️ THE iOS CENTRING BUG WAS TWO DEFECTS WEARING ONE SYMPTOM.**

1. **The mobile chrome does not import `main.js`.** It is a genuinely separate chrome that builds its own `env`, so `env.centerSliceInSource` — added at B616 — never existed there at all. **B616 was verified on desktop and shipped believing it was done. It had reached one of two chromes.** Mobile also carried its own four-line `reset slice` that skipped box centring, orientation, segments and every droste param.
2. **`defaultSliceRotation` keyed off the SOURCE aspect, and on iOS the source and the frame always disagree.** Mobile opens at `frameAspect: 1` (a square canvas) while the camera hands it a portrait source, so every form turned 90° to match an image whose shape nobody can see. **The reference is now the OUTPUT FRAME: orient to what is visible.** Daniel called it as an iOS exception; it generalises, and on desktop (landscape source, landscape frame) it returns the same answer B615 did.

The reset now lives once, as `geometry.js` → `resetSliceState`, called by both chromes. **The camera path guards on an actual source-shape change**, because `attachCameraSource()` also fires on every flip and lens re-acquire and an unconditional reset there would destroy a composition the user just framed.

**▶ THIS IS THE THIRD INSTANCE THIS ARC of a shared quantity reaching only some of its consumers** (droste's overlay missing `sizeNorm` at B614, radial's polygon missing `canvasNorm` at B618, the centring hook now). **The audit item in `PLAN-LIVE-READINESS.md` is no longer speculative — promote it.**

**🚧 OPEN — DROSTE INFINITE-ZOOM LOOP. Deliberately NOT fixed at B619; the cause is not established.** Daniel's cleaner repro: unlock droste pan → pan to a corner → **fast** pinch out **from the corner** → staged behaves, live loops forever; panning back and zooming in recentres live but neither stops the loop nor reverses it; only `reset canvas` recovers.

- **Follower runaway — DISPROVEN.** `follow.js` simulated directly across response 0.35–4s × pinch deltas 0.5–20 loops: with state held constant after the lift, residual motion is zero in every cell. The lead cap and the catch-up boost are not producing a limit cycle. **Do not re-propose this.**
- **Autoplay drift — RULED OUT.** `drift.tick` is gated behind `autoOn` in both chromes and Daniel confirmed autoplay was off.
- **LIVE LEAD: the pinch handler's flick-to-drift.** `output-gestures.js` `onMove` accumulates centroid velocity during a two-finger gesture and starts a **pan** drift on release, so a *pinch* can start a *pan* inertia. In droste `canvasOffset` is the **log-polar centre**, and a drifting log-polar centre reads exactly as an unstoppable zoom. It explains why both "quickly" and "from the corner" are load-bearing. **It does NOT yet explain why a fresh grab fails to cancel it** (`onStart` calls `panDrift().stop()`), so it is a lead, not a conclusion. **Uncertainty state B — the legal next move is an instrument, not a fix.**

**📐 B618 — ZOOM EXTENTS LANDED; THE NORMALISATION PASS IS CLOSED. JS only, no `cap sync`.**

**All five forms now declare all four normalisation numbers.** Extents: **radial 2.0/0.5 · square 0.65/1.0 · hex 0.65/0.6 · triangle 0.65/0.3 · droste 2.2/0.15.**

**A cover below 1 never engages the zoom-out overflow** (sliceScale starts at 1, so `s < cover` is false) — which is the right answer for a tiling form: zooming out should buy more repeats, not a bigger slice. **The three tiling forms are effectively declaring "the slice is mine, the canvas is yours"**, while radial and droste, whose folds genuinely rescale the sampled region, keep a live overflow on both sides.

**⚠️ The `zoom cover` slider floor was 1**, so everything below was unreachable and Daniel had to GUESS three of five values. Now 0.2 — **those three are worth re-checking now that they can actually be measured.**

**Also fixed: radial's `buildPolygon` used raw `canvasZoom`** against the shader's `canvasZoom × canvasNorm`. Invisible today (radial's norm is 1.0) but the same class as droste's missing `sizeNorm` at B614 — **a normalised quantity with a consumer that never got the norm. Third instance in this arc; worth an audit rather than another one-off.**

**🚧 OPEN: the slice overlay reads inaccurate while sweeping the tuner** (Daniel, B618). The radial fix is unlikely to be the whole story since its norm is 1.0. Needs the specific form and sweep position.

**▶ NOTHING IS OWED NOW. The MIDI/gamepad cluster is fully unblocked.**

**🎚 B617 — YOU CANNOT JUDGE AN EXTENT YOU CAN NEVER STAND AT. JS only, no `cap sync`.**

**`?tune=forms` now HUGS the bound being dragged** (cover pins fully OUT, in-floor pins fully IN) and gains a **`range sweep`** that walks the form's whole zoom range across both slice↔canvas handoffs, with a live `slice · canvas` readout.

**Daniel's "the extents are a variable moving target" was describing the DESIGN, not a UI gap.** The unified zoom is three log-space segments — slice `cover→1` with the canvas pinned out, then canvas `min→max` with the slice at 1, then slice `1→inFloor` with the canvas pinned in. **What a bound means depends which segment you are in, and the bounds live at the two ends you are least likely to be standing at.**

**Also:** a new source now runs the **full slice reset** (Daniel's ask) — which is what fixed the rectangle sitting off-centre on load, since B616's hook re-centred a box whose `sliceScale`/`squareAspect` were still the previous source's. One shared `env.resetSlice()`. **`sizeNorm` droste → 1.65** (1.82 touched the right edge once the box was centred). **`canvasNorm` hex → 1.5**; radial/rectangle stay 1.0, triangle 1.8, **droste deliberately untouched** (relative zoom, so a norm is meaningless).

**▶ ZOOM EXTENTS ARE NOW THE ONLY THING OWED**, and the tool to measure them exists.

**🎯 B616 — B615 CENTRED THE BOX IN ONE PLACE OUT OF THREE. JS only, no `cap sync`.**

**Daniel caught that B615 did nothing visible.** The geometry was correct and was wired to the **reset slice button only** — so with state defaults of `sliceCx/Cy = 0.5`, load and form-switch both still parked the ORIGIN at the middle, which is the behaviour B615 existed to replace. Now wired to **new-source load** (right after `engine.setSource`, the first moment the aspect is knowable) and to **form switch**.

**⚠️ AND THE FORM-SWITCH HALF CORRECTS THE CARRY-OVER DECISION.** `sliceCx/Cy` was decided CARRY on the reading *"which part of the image is sampled"* — that reading is right, but **the stored number is the ORIGIN, which means different things per form** (apex for the wedges, centre for the rectangle). **The BOX CENTRE is what means the same everywhere**, so that is what carries now; the origin is re-solved per form. Same class of error as `canvasOffset`. **Standing lesson: the value that is safe to carry is rarely the value that happens to be stored.**

**🎯 B615 — CENTRE THE FORM'S BOX, NOT ITS ORIGIN. JS only, no `cap sync`.**

**Daniel's rule, and it made the per-form constants I was about to ask him for unnecessary:** draw a box around the form including its origin, centre that box in the source. `centerFormInSource()` reads each form's own `buildPolygon`, maps the vertices through `sliceVecToSourceUV`, and centres the result — **nothing hardcoded per form**, so it tracks `sliceScale`/`sizeNorm`/`sliceRotation`/aspect automatically and stays right for forms that do not exist yet.

**Including the origin (0,0) in the box is the detail that makes it work for all five at once.** Rectangle and droste surround their origin, so they stay centred; the wedge forms grow outward from theirs, so the box is lopsided and centring it pushes the origin left. **The old "origin at 0.5" was only ever correct for the rectangle** — the one form whose origin IS its centre, which is why the problem went unnoticed.

**A portrait source now turns every form 90° CW** so the form's long edge follows the source's long edge. Applied BEFORE centring, since rotation changes the box.

**▶ STILL OWED: canvas ZOOM EXTENTS** (`zoomCover`/`zoomInFloor`, still undeclared on every form — the one thing gating per-form range normalisation for MIDI and gesture).

**📏 B614 — THE SLICE-SIZE TUNING PASS, FINALLY TAKEN. JS only, no `cap sync`.**

**All five forms carry Daniel-tuned `sizeNorm` values**, measured against a reference source: **radial 2.25, rectangle 1.6, hex 2.35, triangle 2.6, droste 1.82.** Hex and triangle had been deliberately matched at a 1.6 first-pass; the pass separated them. Radial was the 1.0 anchor everything normalised to — the whole set moved to a larger default slice, so the anchor moved with it.

**⚠️ AND DROSTE'S OVERLAY NEVER APPLIED `sizeNorm`** — its bespoke `drawOverlay` used `sliceScale × halfMinPx` against the shader's `sliceScale × sizeNorm`. Written before B477 added the norm and never updated. **Exactly the failure `formSizeNorm`'s own doc-comment warns about**, invisible because droste's overlay sits outside the shared polygon geometry. Daniel found it by using the tuner and noticing the slider did nothing to the overlay.

**▶ STILL OWED, and the pass is not done without them: slice ORIGIN repositioning, and canvas ZOOM EXTENTS** (`zoomCover`/`zoomInFloor` are still undeclared on every form — the one thing gating per-form range normalisation for MIDI and gesture).

**🔒 B613 — A BOUND THAT IS NOT IN STATE IS NOT A BOUND. `canvasOffset` no longer carries across a form switch, and unlocking pan always starts centred.**

**🔭 B612 — STAGED AND LIVE WERE NEVER DISAGREEING ABOUT THE PICTURE, ONLY THE DISTANCE. JS only, no `cap sync`.**

**The shader renders `phase mod 1`; `state.drosteZoomPhase` is a deliberately UNWRAPPED accumulator** (the motion tween needs that for multi-loop keyframes). **So staged looks identical at phase 0.4 and phase 200.4, while the follower must travel every loop in between.** That is the whole of *"staged is correct, live is stuck zooming forever"* — and why recentring fixed staged and not live: recentring never touches the distance. Gesture travel is now bounded by the follower's own `LEAD_CAP` (imported, not duplicated), on the argument that **anything past the cap is discarded by the follower anyway, so commanding more can only create divergence, never visible motion.**

**🔍 THREE OF DANIEL'S FOUR DROSTE INVARIANTS NOW HAVE MECHANISMS (see BACKLOG):**
- **The slice overlay does not know about `canvasOffset`** — nowhere in `overlay.js` or `geometry.js`. Correct on a tiling form (a lattice translation is a symmetry, so the sample really does not move); **wrong on radial/droste**, where it silently keeps drawing the old region.
- **Droste's seamless zoom documents two preconditions and enforces neither** ([droste.js:79-84](../src/engine/forms/droste.js#L79-L84)): offset centred, and spiral 0. Both are only defaults.
- **Live can still outlive the state that produced it.** B612 shrinks the worst case; it does not establish the invariant.

**🎯 AND ONE PROPOSAL WORTH READING: route droste's pan to `drosteOffsetX/Y` rather than `canvasOffset`.** Three independent arguments converge, and droste already has the mathematically correct off-centre control (a disc automorphism that preserves the seamless loop). **`canvasOffset` on droste is a strictly worse duplicate.** Needs Daniel's call.

**🌀 B611 — ONE PAN GAIN FOR EVERY SURFACE; THE LOOP STOPPED HAVING AN EDGE. JS only, no `cap sync`.**

**✅ THE GESTURE AND DIRECT-MANIPULATION PAN PATHS ARE MERGED** (Daniel-approved). `kit/pan.js`'s new `panDelta` takes a displacement as a **fraction of the gesture surface's own short side** and folds in the `1/zoom`. **Both hand-tuned constants are gone** (`× 3` in remote-input, `PAN_GESTURE_SENS 1.2` in input-bus). **Contract: drag across the short side of whatever you touch, content travels the short side of the canvas — any device, any size.**

**✅ AND THE PAN "EDGE" IS FIXED.** `canvasOffsetX/Y` were a flat ±2 with a hard clamp, which is simply wrong on a lattice form that loops forever. They now resolve **per form: unbounded when periodic, ±1 when a centre shift.** Daniel's tell was *"but you can pan right"* — one-directional failure means pinned against a bound, not a scale error.

**⚠️ THE DEEPER FIX WAS AT THE LOOKUP POINT:** only `applyMapping` resolved per-form targets, so the gesture path and the motion loop saw raw flat ranges. `targetOf` now resolves. **That divergence was the edge, and it would have bitten every future per-form target identically.**

**✅ B610'S PAN FIX IS DANIEL-VERIFIED** on every form except droste, at all scales and directions: *"core issue addressed!"*

**The droste exception had its own cause.** `canvasOffsetX/Y` is **one global value shared by every form**, accumulating UNWRAPPED and kept sane only by being wrapped mod the lattice period at the uniform. Droste has no lattice, so it read the raw accumulated value — and in droste that is not a translation but a shift of the **log-polar centre**, squeezing the visible field into a thin annulus. Clamped to ±1 for non-lattice forms.

**"At first all looks good" is the load-bearing part of Daniel's repro:** droste is `panLockedByDefault`, and a locked form renders centred, so square's offset sits there invisibly until the lock comes off. **This is also why B610's `startDist` floor helped without curing it — two independent routes into a runaway phase, both real.**

**🚨 STILL OPEN, AND THE HIGHEST-VALUE ITEM LEFT: live can get stuck with no recovery.** Recentre fixes the STAGED canvas while the LIVE view keeps zooming, because `panRecenter` resets pan and nothing resets the follower. **The escape hatch that works today is CUT** (`pfCut` → `follower.jump(state)`). But "the operator must know to press cut" is not a fix — a reset that visibly corrects staged while live misbehaves is a broken affordance.

**📋 AND THE PRODUCT DECISION NOW HAS A CONCRETE FAILURE ATTACHED:** one global `canvasOffset` is a lattice pan in square, a centre shift in radial, and a log-polar centre in droste — which also has its own `drosteOffsetX/Y` for the same concept. This is Daniel's B609 "which properties carry over between forms" question, no longer hypothetical.

**🤏 B610 — CANVAS PAN IGNORED THE ZOOM. JS only, no `cap sync`.**

**`u_canvasOffset` is subtracted AFTER `p /= u_canvasZoom`, so one offset unit moves content in proportion to the zoom — and the pan gain was a flat 3.5.** Pan therefore accelerated as you zoomed in and crawled as you zoomed out. Gain is now derived from the shader: **`aspect/Z` on x, `1/Z` on y.** The flat `PAN_TOUCH_GAIN`, marked `TUNE`, is gone; its original justification ("touch reads as ¼ of the gesture") was this bug seen at one zoom level.

**Daniel's measurement identified it without a single instrument:** content crossing the canvas on ~60% of a finger sweep at 1× and ~20% at 2.48×. **A 3× error for a 2.48× zoom change is the signature of a missing 1/zoom**, and the shader's transform predicts ~20% at 2.48× on 16:9. **Pinch reading correct throughout is the control** that isolated it to pan.

**⚠️ The remote gesture surface is deliberately UNCHANGED** (Daniel: it behaves correctly today) — different reference frame, own gain in `input-bus.js`. **But it almost certainly has the same defect, masked because it was checked at default zoom.** Test: zoom the host in, then drag from the phone.

**⚖️ AND THE DEBUGGING PROTOCOL IS NOW TIERED** (`DEBUGGING-PROTOCOL.md` §0 + `CLAUDE.md`): full protocol only for invisible quantities where being wrong costs a device session; two named things for architectural work; **nothing for local, visible, cheap-to-check changes.** Daniel, B609: always-on was costing more velocity than it bought. **Under-applying the protocol on a tier-3 change is now correct, not a lapse.**

**📕 THE ARC PLAN IS `PLAN-LIVE-READINESS.md`** — read it before picking anything up.

**🌀 AND THE DROSTE RUNAWAY IS FIXED — a stray touch, not autoplay.** A pinch's ratio is anchored to the fingers' STARTING separation and had no floor. A palm or a thumb catching the glass gives a `startDist` of a few pixels, so `log(dist/startDist)` hands the follower a target dozens of loops away, or a **non-finite phase that an unwrapped accumulator never recovers from.** Floored at 40px, plus a finite-guard on the write. **Only droste was exposed** because the non-droste path is incremental and bounded by `applyUnifiedZoom`'s [0.05,4] wall.

**⚠️ AND THE FIRST DROSTE DIAGNOSIS WAS WRONG — Daniel caught it.** I blamed autoplay (`drift.js`'s never-settling walker + the follower's unique 4-period cap and 4× boost). **That is real and still filed** — `isSettled()` can never be true, so the ghost trail never fades — **but he was not in autoplay.** Two different bugs; only one was his.

**Also settled this session, by reading:**
- **`loopLog()` is NOT a runaway risk, checked and cleared.** Dividing by `log(drosteZoom)` looked explosive at low thickness; it is correct by construction (a pinch of ratio R gives exactly R of visual zoom at any thickness), which is why pinch reads accurate throughout.
- **The joystick 45° offset does NOT reproduce on iPad (B609).** Do not fix it blind; check Electron and iPhone to decide whether it is resolved or platform-specific.
- **The MIDI-vs-gesture rotation asymmetry is NOT a bug — retracted.** The gesture path negates slice rotation to reconcile a finger's screen direction with the overlay Y-flip. A knob has no screen direction; its direction is a declared convention with a per-mapping `invert`. Applying the negation to MIDI would introduce a bug.

**📦 B609 — THE UPLOAD WAS CLOSING THE SOCKET BEFORE IT DRAINED. JS only, no `cap sync`.**

**✅ THE LOOP HOLD IS CLOSED AND VERIFIED AT BOTH RESOLUTIONS (B608).** FHD at 64MB, 4K at 256/128MB: `loopCache.firstPts: 0`, take gaps **25-42ms**, and cache-off restores the stall. **First reported B487, closed 121 builds later.** `BROADCAST-DELIVERY.md` §6a is the durable record — read it before touching this again.

**⚠️ THE 64MB READING IS VOID.** `nativeAttach.why: failed at "upload": upload short by 11161254 bytes` — that session had **no native decode and therefore no loop cache at all**, so the hold seen at 64MB was the `<video>` path, not a partial fill. **The minimum viable 4K budget is still unmeasured**; ~94MB is what the window costs, so 128 should suffice from a cold load.

**The upload bug:** the slice loop lets four slices (16MB) sit in the socket's send buffer and `close()` does not promise to flush them. 10.6MB short is squarely inside that window. The consequence is not a slow load — the upload "succeeds", `AVURLAsset` gets a truncated file, and **the session falls back to `<video>` for good.** Now drains before closing. **Third time `nativeAttach` has caught a silent fallback before it became a false conclusion.**

**▶ THE OPEN THREAD: the bake fails on the FIRST attempt and succeeds on the SECOND**, every time, on **FHD as well as 4K** — so the earlier "4K memory pressure" framing is retracted. `encoding task did not complete` is WebCodecs', and a first-attempt-only failure points at a **hardware session still held** when the bake asks for one. At first-bake time we hold the native decode, two preview `<video>` elements and a thumbnail image generator, then ask for two readers and an encoder. **Same shape as B501.** Cheapest thing to try: release what the bake does not need before it starts.

**Also carried:** the source panel lost its image after a bake → perform switch (broadcast unaffected); and the Loop Builder slice-preview stall, where the fading-OUT side of the crossfade freezes after a lap while the incoming side moves.


**🎉 B608 — 4K LOOPS SEAMLESSLY. THE ARC'S RESULT. ⚠️ NEEDS `npx cap sync ios` + AN XCODE BUILD.**

**Daniel-verified at both resolutions.** FHD at 64MB, 4K at 256MB (`loopCache.firstPts: 0`, take gaps **25-42ms**, `heldMB: 94`), and toggling the cache off brings the stall straight back at either. *"maybe this is our first time actually seamlessly looping 4k?"* **First reported B487, closed 121 builds later.**

**📕 `BROADCAST-DELIVERY.md` §6a is the durable record** — what the hold is, whose it is, the eight hypotheses closed with the instrument that killed each, the fix, and the one field (`loopCache.firstPts`) that says whether it is working. **Read that before touching this again.**

**⚠️ DO NOT READ "64 stuttery / 128 stuttery / 256 seamless" AS A MEMORY CURVE.** At 128MB the cache held only 47MB, so the budget was never the constraint. Setting the budget to 0 between arms **discards the head, and a clip's head is produced exactly once, on the opening pass** — every lap afterwards resumes at ~0.109. A clean per-budget comparison needs a clip reload between arms. **The real minimum viable 4K budget is unknown** and is worth finding before the default is trusted.

**Also fixed:** a clip loaded into perform started paused with the button reading "pause" — `refreshPerformSource` synced against the `<video>` before the native decode attached (parked) behind it.

**▶ THE OPEN THREAD IS MEMORY AT 4K, and it is now showing up in the bake.** `encoding task did not complete` twice, and once **the app crashed outright**, losing the uploaded clip while the external display kept showing "baking…". Filed HIGH. Two things worth doing whatever the root cause: the uploaded source should survive a restart, and a dead bake must clear that notification.

**Carried, unfixed:** the Loop Builder slice-preview stall (the fading-OUT side of the crossfade is frozen after a lap while the incoming side moves — the B-tail element is not restarting).


**▶ Build notes for B223 → B607 are archived** in [`archive/HANDOFF-builds-223-607.md`](archive/HANDOFF-builds-223-607.md) (B658). Everything load-bearing was checked into a living doc first: the broadcast arc and the loop hold into `BROADCAST-DELIVERY.md`, the three-GL-uploads lead into its §5a, the Arena constraint into `BACKLOG.md`. Builds 19-187 are in `archive/HANDOFF-builds-19-187.md`.


## historical record

Builds 19–187 (early kaleidoscope through Fold Live Phase 0) live in [`archive/HANDOFF-builds-19-187.md`](archive/HANDOFF-builds-19-187.md). Moved out at B547 — it was half this file and two of its sections actively misdescribed current state. Everything still live was rescued to BACKLOG first; the archive header lists exactly what.

## decisions locked in

- **License:** AGPL-3.0, copyright Daniel Nelson. The author retains rights to commercial licensing. This was chosen over MIT to discourage forking-as-competitor while keeping the code openly viewable.
- **Repo:** public.
- **Build counter convention:** monotonic global, never resets on version bump.
- **Docs structure:** `README.md` at root, `docs/HANDOFF.md` `BACKLOG.md` `CHANGELOG.md` `ARCHITECTURE.md`.
- **Form ID is a string** (not numeric index) everywhere. Don't reintroduce numeric form indexing.
- **The `env` runtime container** is the seam between shell modules. Don't add module-level mutable globals; thread state through `env` instead.

## decisions deferred

- **"Scale to tile" canvas zoom snap.** Build 19 conceptual analysis concluded it's feasible only for square output, but Daniel reports visually-repeating patterns appearing at certain zoom-out levels and wants to revisit. Deferred until someone has time to investigate with screenshots. See `BACKLOG.md`.
- **Monetization approach.** Full narrative and phased plan now in `docs/FOLD.md` under "monetization paths." The AGPL license preserves all options.

## what to avoid

- **Don't reset BUILD when bumping VERSION.** It's a monotonic global counter. Read the comment in `src/version.js` if unsure.
- **Don't put backticks inside form GLSL strings.** The `glsl` field in form modules is a JS template literal; a backtick inside breaks parsing silently. The original monolith had a long-running bug from this. (Mentioned in `ARCHITECTURE.md` too.)
- **Don't assume Daniel sees what you describe.** He's caught Claude hallucinating UI elements before (e.g. a "Clip" transport mode option that didn't exist in his Resolume version, in another project). When describing Resolume / Vercel / VS Code UI, be tentative and defer to what he actually sees on screen.
- **Don't introduce new mutable module-level state in shell modules.** Thread it through `env` instead. The `_windowHandlers` and `_overlayDrawPending` patterns from the original monolith have already been ported to env-based equivalents.

## environment / hardware

Refreshed 2026-08-18 docs (Daniel's own list, and the previous version was missing the M1 Max and collapsed two different iPads into one line). **Phase 2 is a hardware question, so this section is now an instrument: what we can measure on, and what we CANNOT, stated so a gap never gets mistaken for a clean bill of health.**

### In hand

| device | why it matters to phase 2 |
|---|---|
| **M1 iPad Pro 12.9", 1TB (16GB)** | the phase-2 workhorse; every report so far is from this. The 4K/4K crash is ITS ceiling, not "iPad's". |
| **M1 iPad Air (8GB)** | **the controlled A/B on the one named open risk.** Same silicon, half the memory. The only pair we own that isolates memory from GPU generation. |
| **iPhone 14 Pro** | outperforms the 17 Pro on the sustained record path and nobody knows why (CAPABILITIES.md — the reason for "probe, never classify"). |
| **iPhone 17 Pro** | current-gen ceiling. |
| **M1 Max MBP, 64GB** | the demanding-desktop-workflow target. **Not a stand-in for a low-power Mac** — see the gap list. |
| **M5 Max MBP, 64GB** | current-gen desktop ceiling; the Syphon benchmarks in the archive are from here. |
| **Movink touch display + second monitor** | perform-mode ergonomics rehearsal rig. |
| **Akai APC40 MK2** | Perform mode / control bus. |
| **HDMI dongle (new, since 2026-08-18 docs)** | ⚠️ **A MEASURED VARIABLE, NOT A CONSTANT.** It moved `delivered` 24 → 29 and `UNEVEN` → `steady`. **Pin it in any comparison against a pre-2026-08-18 docs report.** |

### NOT in hand — and what each one would answer

**These are gaps in the evidence, not "untested platforms".** Naming them stops the in-hand devices from being read as representative.

- **iPhone 12 mini / SE2** — *the floor of "modern".* **The most valuable single gap.** Without it, the 14 Pro is our weakest phone, and a graceful-degradation path tuned against a 14 Pro almost certainly does not degrade far enough. Everything we call a "mobile default" is currently an untested guess below the Pro tier.
- **Non-Pro iPhone 13 / 14 / 15** — the actual volume hardware. No ProMotion, fewer GPU cores, smaller thermal envelope than the Pro of the same year. **Our two phones are both Pros**, so the entire non-Pro column is unmeasured.
- **M2–M5 MacBook Air** — *the realistic desktop user.* **The M1 Max is a bad proxy in the wrong direction on every axis at once:** more GPU cores, 64GB, and a fan. An Air is fanless, memory-constrained, and thermally throttled — **the one Mac configuration where the iPad's failure modes could plausibly reappear on desktop**, and the one we cannot see.
- **A non-Apple-silicon path** — Windows/Intel/AMD. Out of scope by Daniel's stated goal (Apple-silicon parity), recorded so its absence is deliberate rather than forgotten.
- **A second DualSense** — the shared vendor-product device key was reasoned about at B650 and never exercised with two identical pads.

**▶ THE RULE THIS TABLE EXISTS TO ENFORCE:** we own the top of the range and none of the bottom. **Every ceiling we measure is a ceiling for good hardware.** Gates must therefore be computed from what the device reports at runtime, never from a table of models — which is also Daniel's stated requirement.

## context from prior sessions worth preserving

Daniel was learning Resolume in parallel with the early kaleidoscope work, and there's a separate `drift` project (a video-art PWA) that shares some architectural DNA but is unrelated functionally. The handoff for Drift mentions "plans to open-source on GitHub" but no license was actually picked there — kaleidoscope is the first of his projects to land on AGPL-3.0 explicitly.

If Daniel asks Claude to look at Drift or Zoetrope (another project of his), they're available in the project knowledge as separate handoff docs.
