# verification queue — pending Daniel's hardware

Things built but not yet verified on real hardware. Claude appends as it ships device-unverifiable work; Daniel checks off. Confirmed items move to CHANGELOG and are deleted from here.

**Every row names WHERE to run it and WHAT closes it.** A row that says "verify X works" without a platform and a readout is not a verification task, it is a wish. (Standing rule, Daniel B546.)

Legend: 🖥️ desktop browser · 💻 Electron · 📺 external display / HDMI / AirPlay · 📱 iPhone Capacitor · 📲 iPad Capacitor · ✅ confirmed

**Where diagnostics come from** — the three channels, named exactly as the rows reference them:
- **`copy report`** — the frame-cost panel's export button. Phone: diagnostics block → **show frame cost**. iPad: desktop diagnostics → **frame cost panel**. Desktop: `?perf`. This is the primary channel and works with no cable.
- **Xcode console** — device run from Xcode, filter string given per row. Only where a row says so.
- **eyes** — an observed outcome, no paste. Say what you saw.

---

## ⛔ WHAT BLOCKS WHAT

| this | blocks | why |
|---|---|---|
| **A** (no-regression) | **B, C, E** | A is a hazard check. If render elision shows a stale frame the build is broken and every number after it is measuring the wrong thing. |
| **B2 + D4** (the two 10-min runs) | **the governor** | Its yield order and sustained setpoint have to be designed against measured drift, not assumption. This is the arc's last hard blocker. |
| **D1** (external reports real dimensions) | **D2, D3, D4** | If the external surface reads 0×0 it is not registered and the rest measures nothing. |
| **B + E** | **cleanup C2** (retiring settled perf flags) | Those flags ARE the A/B mechanism for these rows. They cannot be deleted until the rows they serve are closed. |
| **a fresh `cap:sync`** | **all of FH + all of H** | C1 shipped B546, after the sync taken for A–F. |
| **H-1** (display fps visible) | **H-2, H-3** | without a throughput reading those rows cannot be judged |
| nothing | **A, FH, H, F, Loop Builder, the carried-forward items** | independent; run in any order |

**Not blocked, not urgent:** everything under "carried forward" — those have been open for weeks and are not gating current work.

---

## 🔥 THERMAL ARC — the A–F matrix (B540–B543)

**Run A first.** Each row: set it up, do the thing, then `copy report` and note fps / `unmeasured` / `pressure`.

### A. No-regression (📱 iPhone Capacitor, ~10 min) — **eyes only, nothing to paste**

| # | setup | do | closes when |
|---|---|---|---|
| ✅ A1 | live camera, still mode | leave it sitting ~30s, then move a slice | **CONFIRMED B547** |
| ✅ A2 | record video mode, PiP visible | record ~20s, move the slice mid-take | **CONFIRMED B547** |
| ✅ A3 | — | — | **CONFIRMED B547 by the B3 report**, not by the stepper test — see below |
| ✅ A4 | any | toggle `render: skip identical frames` off/on | **CONFIRMED B547** — no visible difference |

**A3 was badly worded and is already answered.** The intent was: *while a take is actually rolling*, the output canvas cannot be downscaled, because on the direct-encode path that canvas **is** the recording. Stepping it while idle SHOULD work — that is the ladder doing its job. Daniel's 100%→25% test was performed idle, so it proved nothing either way. **But the B3 report closes it anyway:** mid-take, the `output` surface note reads `ladder locked — this canvas IS the take`, which is the lock engaged and self-describing. No re-test needed.

### B. The elision win (📱 iPhone) — **paste TWO reports per row**

**⚠️ B1's scenario was wrong and produced a null result. Corrected below.** A live camera preview at 768×1024 delivers a genuinely new frame on **every** tick (`planeReader` gates on the wire sequence, and it advanced 60×/s), so there were no identical frames to elide and `output render` correctly stayed at 60 calls. The elision only has something to skip when the SOURCE is static.

| # | scenario | closes when |
|---|---|---|
| **B1 (redo)** | **a STILL IMAGE source** (not the camera), untouched, not recording | `output render` **calls** drop well below fps with the flag ON, and return to ~fps with it OFF. (Calls, not ms.) If calls stay pinned to fps in both states, the elision is not firing and that is the finding. |
| ✅ B2 | live camera, 10+ min | **CONFIRMED B547 — stable.** fps 60.0, p95 **improved** 22→17ms, `pressure` nominal throughout, phone slightly warm, not hot. Sustained idle is not a thermal problem. Governor input satisfied for the idle case. |
| ✅ B3 | 4K record | **CONFIRMED B547** and better than predicted — see the CAPABILITIES update. |

### C. H2 — the unaccounted third of every 4K frame (📱 iPhone, ~5 min, no rebuild) — **paste both**

**The question:** at a 4K source, about a third of every frame is time we cannot attribute to any registered surface. Is that the **native camera bridge** (socket + YUV plane handling) or the **fold shader itself**? The only way to tell is to keep everything identical and change only where the pixels come from.

| # | exact setup | closes when |
|---|---|---|
| **C-1** | 📱 iPhone. Live camera, resolution set to **4K**. PiP monitor **OFF**. Do not record — just sit on the live preview. `copy report`. | baseline captured — note `fps` and `unmeasured` |
| **C-2** | Same session, same everything. Now switch the source to **a still photo from the library** (any photo; ideally a large one). PiP still OFF. Still not recording. `copy report`. | **compare `unmeasured` between the two.** Collapses toward zero ⇒ the missing third is the native camera bridge, and that becomes the next optimization target. Stays ~33ms ⇒ it is real GPU work in the fold shader and there is nothing left to find. |

The only variable that may change between them is the source; leave form, slice, zoom and output size alone.

### D. HDMI (📲 iPad Capacitor + 4K HDMI) — **RUN B547; found three bugs**

| # | scenario | result |
|---|---|---|
| ✅ D1 | HDMI connected, idle | **PASS, row was mis-worded.** `external` reads 0×0 while idle because nothing is being sent — that is correct, not a failure. It reports a true 3840×2160 the moment a broadcast starts (see D2). Row rewritten: *the external row reports real dimensions once broadcasting*. |
| ⚠️ D2 | HDMI + live camera | **App renders 46fps; Daniel observes ~10fps on the monitor.** Also exposed the iPad camera's missing planar path (15.47ms upload for 0.79MP). Both filed. |
| 🔴 D3 | HDMI + recording a take | **FAILS.** Starting a record kills the broadcast. Filed CRITICAL. **This row cannot close until that is fixed**, and it is the row that was meant to decide the PiP question. |
| 🔴 D4 | HDMI, 10+ min | **BLOCKED by the same lifecycle bug** — after a reset, broadcast reports live with a blank display. A restart plus an FHD clip broadcasts, but at ~11fps observed against 42.9fps reported. The long-run thermal reading is still outstanding. |

**D2/D4's core problem: we cannot see the external display's real frame rate.** It renders in another process and reports no passes. Every "observed ~10fps vs reported 46fps" gap is unmeasurable until the receiver reports its own paint rate. Filed as a blocker for the whole D group.

### E. The starved PiP at 4K (B543) (📱 iPhone Capacitor)

**What E is for, in one line:** at 4K the PiP monitor is too expensive to run during capture, so B543 keeps the *box* and starves its *content*. E checks that the rule fires at the right times and only then.

**Setup for all rows:** phone, **record video** mode, live camera, PiP monitor **visible** (not hidden). Change only the camera resolution between rows.

| # | exact steps | closes when | channel |
|---|---|---|---|
| ✅ E1 | Resolution **4K**. Start a take. Look at the PiP box. | **CONFIRMED B547** — box stayed, content starved. (Note reads `starved — source too large to monitor while capturing`.) | eyes |
| **E2** | Still 4K. **Stop** the take. Watch the PiP. | live picture returns **immediately** — no stall, no need to leave and re-enter the mode | eyes |
| **E3** | Still 4K, **not** recording, just framing up. | PiP is **LIVE**. The rule is capture-only; if it is starved while merely framing at 4K, the guard is too broad. *(This is also where Daniel's "warn me first" improvement will land.)* | eyes |
| **E4** | Set resolution to **FHD**. Record a take. | PiP stays **live** through the whole take — FHD is affordable and must not be starved | eyes |
| ✅ E5 | 4K, recording | **CONFIRMED B547** — 31.7fps | `copy report` |

### F. A/V sync + audio (📱 iPhone Capacitor) — **eyes and ears only, nothing to paste**

**What F is for:** `smooth`/`smooth+` use Apple's cinematic stabilization, which buffers about a second of frames. B540 measures that delay natively and shifts the audio to match. F confirms the compensation is right in every mode and survives a lens flip.

**How to run each row:** record ~10 seconds **while talking** (count out loud — "one, two, three…" gives you sharp consonants to sync against), stop, save, then **play it back in Photos** and watch your mouth against the sound.

The motion-smoothing control is in the camera settings: **standard · smooth · smooth+**.

| # | exact steps | closes when |
|---|---|---|
| **F1** | **Front** camera, smoothing **standard**. Talk, record ~10s, play back in Photos. | sound present, lips in sync |
| **F2** | **Front** camera, smoothing **smooth+**. Same. | sound present and **still in sync** — this is the real test; smooth+ has the longest buffer to compensate |
| **F3** | **Rear** camera, smoothing **smooth+**. Same. | in sync |
| **F4** | Fresh app launch. Do **not** touch the smoothing control. Look at what it reads on the **front** camera, flip to **rear**, look again. | front shows **standard**, rear shows **cinematic**. (B541 default: selfies favour low latency, rear favours stability.) |
| **F5** | Now **explicitly pick** a smoothing mode — say `smooth+` on the front camera. Flip to rear, then flip back to front. | your explicit choice is still there. Once you choose, the per-lens default must stop overriding you. |

### Why the governor is not built yet
Its first thermal rule shipped as B543. The rest — what yields first, at what pressure, what the sustained setpoint is — needs D4, which is now blocked on the D3 lifecycle bug. **B2 delivered its half: sustained idle is stable and not a thermal problem.**

**However, B547's pass found a governor rule that needs NO further data:** the "finishing take" case (filed in BACKLOG). It is triggered by a discrete known event rather than a thermal curve, so it can be designed and built now.

---

## 🧩 FH — the unified frame-header parser (B546) — **REQUIRES A FRESH `cap:sync`**

**⚠️ B546 landed AFTER the sync taken for A–F.** These rows need `npm run build && npx cap sync ios` and an Xcode rebuild. Running them against the older build verifies nothing. A–F are unaffected and can finish on the current sync.

Both native frame consumers now share one parser (`shell/frame-header.js`). Nothing should change — that is the entire point. Pure regression pass on the path B540 broke.

| # | where | do | closes when | channel |
|---|---|---|---|---|
| **FH-1** | 📱 iPhone Capacitor, run from Xcode | live camera, still mode | **source panel shows the live feed** — not black, not frozen. 🛑 If this fails, stop: the build is bad on device. | eyes |
| FH-2 | 📱 iPhone Capacitor | rear ▸ front ▸ rear via flip | feed survives every flip; front mirroring correct | eyes |
| FH-3 | 📱 iPhone Capacitor | `take still` mode, then upload a still | both show a source (B541 regressed `take still` while upload still worked) | eyes |
| FH-4 | 📱 iPhone Capacitor | record ~15s, play back in **Photos** | video normal, **audio present and in sync** — confirms the latency field still parses at its offset | eyes |
| **FH-5** | 📲 iPad Capacitor **+ HDMI**, run from Xcode | play a **video clip** to the external display | clip plays on the panel **and timeline position + duration read correctly in the app**. This is the `FYUW` path, where a misread second f64 corrupts the master clock. | **`copy report`** on the iPad while playing · **plus Xcode console**: filter `[fold]`, paste any line containing `clock` or `duration`. A `duration` of `0` while the clip visibly plays is the exact corruption this row exists to catch. |
| FH-6 | 📲 iPad Capacitor + HDMI | live **camera** to the external display | feed appears on the external panel | eyes |

---


## 🛠️ B549 — the HDMI fixes — **REQUIRES A FRESH `cap:sync`** (run with the FH rows)

Four fixes to the path the D group broke on. **Every row is 📲 iPad Capacitor + 4K HDMI unless stated.**

| # | do | closes when | channel |
|---|---|---|---|
| **H-1** | Broadcast a **video clip** to the display. Watch the panel's `external` row. | it now reads **`N fps ON THE DISPLAY`**. 🛑 If it still reads no fps, the view is not reporting and everything below is unmeasurable. | **`copy report`** |
| **H-2** | Same, clip broadcasting. | that number is **~30–60, not ~10**, and the picture on the panel visibly matches. This is the regression fix. | **`copy report`** |
| **H-3** | Live **camera** broadcasting. | same: display fps well above 10 | **`copy report`** |
| **H-4** | Camera broadcasting. Check `source` note + `upload`. | note now says **`planar`**; `upload` drops from **15.47ms** to a fraction of a millisecond | **`copy report`** |
| **H-5** | 🐛 **The B541 hazard H-4 could have reintroduced.** Camera live → **capture a still**. Then separately: camera live → **upload an image**. | the still/image actually appears — **not** the feed's last frame frozen. If the panel shows a stale camera frame, stop and report: the planar release is not firing. | eyes |
| **H-6** | **D3 re-run.** Broadcast to HDMI, then press **record**. | the **broadcast survives**. If recording itself fails, the status line should say so *and* note the broadcast is still live. | **`copy report`** + eyes |
| **H-7** | If H-6's recording failed: read the `bus` row. | note now names the failure (`NOT STARTED — readback path never resolved`) instead of a bare `capture: null` | **`copy report`** |
| **H-8** | **D4 re-run.** After a glass-break reset, re-arm a 4K broadcast. | display actually shows the picture when the app says it is broadcasting | eyes |
| **H-9** | 📱 **iPhone + HDMI — never tested on any build.** Plug in, live camera. | display shows the program; `external` reports fps | **`copy report`** |

**H-9 is new coverage, not a re-test** — iPhone HDMI has never appeared in this queue. Daniel suspects it shares the iPad's symptoms; the elision fix is wired for the phone's autoconnect path too, so this is where that gets confirmed.

## 🎬 Loop Builder — fresh pass (authored B547, replaces B385–B406)

The fifteen B385–B406 rows were **archived rather than carried forward**: they describe an interface that was reshaped three times during the run that produced them (full-screen stepped surface → editing mode with app bar → modal with its own header + step rail; steps merged and renumbered at B395). Verifying them literally would mean checking buttons and layouts a later build removed. This is one pass against the surface as it actually ships, plus the defects Daniel believes are fixed.

**Where:** 🖥️ desktop browser (Brave) for the bake/flow rows, 📲 iPad Capacitor for the touch and safe-area rows. Load a real video source first.

| # | where | do | closes when | channel |
|---|---|---|---|---|
| **LB-1** | 🖥️ desktop | start a **seamless-loop** bake, then hit cancel mid-bake | the bake **actually stops** — progress halts, the surface returns to the step, the source is unchanged. Daniel believes this was fixed; it was a known limit at B156/B158. | eyes |
| **LB-2** | 🖥️ desktop | during a bake, try to navigate **back a step** | either it is cleanly blocked with an explanation, or it cancels the bake and goes back — **not** a half-baked state or a stuck rail. Say which behaviour you get; both are defensible, silence is not. | eyes |
| **LB-3** | 📲 **iPad Capacitor** | open the Loop Builder, both orientations | 🐛 **KNOWN BUG (BACKLOG quick-wins):** the header collides with the iOS status bar (clock / battery / island). This row is the repro until it is fixed — confirm it, then re-confirm after the fix. Check the step rail's top alignment too. | eyes + a screenshot if convenient |
| LB-4 | 🖥️ desktop | trim-only ▸ apply | lands in the **motion editor** with the trimmed range, not the still frame-picker | eyes |
| LB-5 | 🖥️ desktop | bounce bake, then seamless-loop bake | both produce a correct loop; playback is seamless at the wrap | eyes |
| LB-6 | 📲 iPad | bake a **portrait** iPhone clip (slice and bounce) | baked source is **upright and correctly proportioned** — not rotated 90° or stretched | eyes |
| LB-7 | 🖥️ desktop | mid-edit, try to switch modes / upload a new clip | warns about unsaved trim changes; cancel backs out cleanly | eyes |
| LB-8 | 🖥️ desktop | open builder ▸ close via X and via cancel | app bar disappears while open and **returns** on close; changed-trim warns first | eyes |
| LB-9 | 🖥️ desktop | undo after a trim / slice / crossfade edit | walks back through the edits on the global history stack | eyes |

**If LB-1 or LB-2 fails**, file it rather than fixing in place — mid-bake lifecycle is its own piece of work, not a quick win.

---

## 📦 Carried forward — open, not blocking anything

Kept from the B382–B476 wave because they are genuinely unverified. The rest of that wave is in [`archive/VERIFY-QUEUE-b382-b476.md`](archive/VERIFY-QUEUE-b382-b476.md).

- **📺 [B382, still open] External display + GL-context-lost cluster.** Three parts, all iPad Capacitor: **(a)** HDMI out with a **video source** shows "video sources on the external display are coming" (test pattern + still + live camera work) — video-over-external regressed; **(b)** a 4K external panel detected as 2560×1440 rather than 3840×2160; **(c)** motion→perform throws **"graphics context lost — could not recover"**, and afterwards a new source leaves motion controls stacked over perform controls. Suspected to originate in the conduit extraction. **Needs a repro matrix — desktop web vs Electron vs iPad Capacitor — to localise shared code vs native surface.** Closes with: which of the three surfaces reproduce each part. Note (b) may overlap D1.
- **📺 [B473] Large-clip video over HDMI — LONG clip half.** Short test ✅ confirmed (2:45 1080p broadcasts fine). Still to do at the workstation: a clip toward ~9min 1080p stages and plays without stall; a genuinely huge 4K/long clip should fall back to an honest hint, **not hang**.
- **📡 [B472] NDI HD-vs-FHD over WiFi — decisive test.** Blocked on location, not on the build. At the regular workstation: stop NDI → set **HD (1280)** → restart on WiFi. HD smooth + FHD halts ⇒ bandwidth (build an HD-for-WiFi affordance); both halt ⇒ WiFi jitter ⇒ ethernet is the reliable FHD path. iPhone-NDI-over-Thunderbolt is already confirmed smooth.
- **📺 [B476] Movink resolution + aspect padlock — fixed, never re-checked on device.** Movink should report/render 1920×1080 (`preferredMode`, not largest=2560×1600); on the 4K adapter it should still report 4K. Same pass: iPad — unlock the aspect padlock over HDMI and confirm the ratio buttons are live; iPhone — tap a hard-locked padlock and confirm the explanatory toast appears.
- **📱 [B476] The `[fold] aspect hard-locked` stale-flag reading.** iPhone from Xcode, filter `aspect hard-locked`, paste the line. **If it reports a broadcast or recording live when you did not start one, that is a stale-flag bug** — Daniel saw the NDI/Syphon toast with no broadcast active.
