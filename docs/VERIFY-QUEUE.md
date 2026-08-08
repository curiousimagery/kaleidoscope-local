# verification queue — pending Daniel's hardware

Things built but not yet verified on real hardware. Claude appends as it ships device-unverifiable work. **Confirmed rows are DELETED, not ticked** — the result lives in CHANGELOG. A queue that keeps its own history stops being a queue. (Daniel, B550.)

**Every row names WHERE to run it and WHAT closes it.** A row without a platform and a readout is a wish, not a task.

Legend: 🖥️ desktop browser · 💻 Electron · 📺 external display / HDMI · 📱 iPhone Capacitor · 📲 iPad Capacitor

**Diagnostic channels:**
- **`copy report`** — the frame-cost panel's export. Phone: diagnostics → **show frame cost**. iPad: desktop diagnostics → **frame cost panel**. Desktop: `?perf`.
- **Xcode console** — filter string given per row. Only where a row says so.
- **eyes** — an observed outcome, no paste.

---

# ▶ RUN IN THIS ORDER

**First: `npm run build && npx cap sync ios`, then rebuild from Xcode.** B546 and B549 both landed after your last sync; P0 and P1 are unverifiable without it.

| | what | why this rank | time |
|---|---|---|---|
| **P0** | **T-1**, then **FH-1**, then **H-5** | T-1 captures the stale-broadcast mystery with the instrument that can finally see it — do it while the bug is fresh. Then two hazard checks on MY changes ("did I break the source panel"), ten seconds each. | ~5 min |
| **P1** | **H-1 → H-9** | The HDMI regression fixes. This surface went from unusable to unknown, and H-9 is coverage that has never existed on any build. Highest information per minute in the queue. | ~20 min |
| **P2** | **FH-2 → FH-6** | Rest of the frame-header regression pass. Cheap, and FH-5 is the only check on the master-clock path. | ~10 min |
| ~~P3~~ | ~~TF-1 → TF-4~~ | **BLOCKED — 4K recording is unimplemented (B551). There is no 4K finalize to measure.** TF-1 done: it exposed the cap. | — |
| **P4** | **C-1 / C-2** | Settles where the unaccounted third of every 4K frame lives, which decides the next optimization target. Two reports, no rebuild. | 5 min |
| **P5** | **B1-redo, E2, E3, E4** | Behaviour confirmations on shipped rules. Low risk of surprise, but E3 is where your "warn me before 4K" change will land, so it is worth knowing it currently passes. | ~10 min |
| **P6** | **F1 → F5** | A/V sync. You already confirmed timing "looks perfect" at B540; this is regression cover, not discovery. | ~10 min |
| **P7** | **LB-1 → LB-9** | Loop Builder. Independent of everything above; do it when you are on desktop rather than device. | ~20 min |
| **P8** | carried-forward | Open for weeks, gating nothing. | — |

**If you only have 20 minutes: P0 + P1.** That is the broken surface and the two hazard checks.

---

## ⛔ WHAT BLOCKS WHAT

| this | blocks | why |
|---|---|---|
| **a fresh `cap:sync`** | **all FH + all H** | both shipped after your last sync |
| **FH-1** (source panel shows the feed) | everything on device | if the shared parser rejects camera frames the build is bad |
| **H-1** (display fps is visible at all) | **H-2, H-3** | without a throughput reading those cannot be judged |
| **H-6** (D3 re-run) | the old **D3/D4** rows | they were blocked on the bug H-6 tests |
| **D4 10-min run** | **the governor's thermal rules** | still the last hard blocker; B2 delivered the idle half |
| **B1, E** | **cleanup C2** (retiring settled perf flags) | those flags are the A/B mechanism |

---


## 🔬 B552 — telemetry + two UI fixes · **needs the B552 sync**

| # | where | do | closes when | channel |
|---|---|---|---|---|
| **T-1** ⭐ | 📲 iPad + HDMI | **Reproduce the stale-at-startup broadcast** (fresh session, live camera, broadcast on). While the display is lagging, read the `external` row. | it now reads something like `51 fps drawn · ⚠ only 4 NEW frames/s`. **That line is the whole point** — it separates "the view is stalling" from "the renderer is slow", which we could not tell apart before. Paste it. | `copy report` |
| **T-2** | 📲 iPad + HDMI | Same, after it self-corrects. | `N fps ON THE DISPLAY · M new/s` with M close to 30 (camera) or the clip's rate | `copy report` |
| **T-3** | 📱 iPhone, **LANDSCAPE** | Record a short take, stop, and **stay in landscape**. | the status toast is **visible** — phase text and, on a long finalize, a percentage. This was invisible in landscape and masked every status message. | eyes |
| **T-4** | 📱 iPhone | Open **canvas settings** over a live source, both orientations. | the popover floats **above** the source panel, not under or clipped | eyes |

## 🛠️ H — the HDMI fixes (B549) · 📲 iPad + 4K HDMI unless stated

| # | do | closes when | channel |
|---|---|---|---|
| **H-5** 🛑 | **P0 HAZARD CHECK.** Camera live → **capture a still**. Then camera live → **upload an image**. | the still/image actually appears. **A stale camera frame means my planar-release fix is wrong** — stop and report. | eyes |
| **H-1** 🛑 | Broadcast a **video clip**. Read the `external` row. | reads **`N fps ON THE DISPLAY`**. No fps ⇒ the view is not reporting; H-2/H-3 unmeasurable. | `copy report` |
| **H-2** | Same, clip broadcasting. | that number is **~30–60, not ~10**, and the panel visibly matches. This is the regression fix. | `copy report` |
| **H-3** | Live **camera** broadcasting. | display fps well above 10 | `copy report` |
| **H-4** | Camera broadcasting. Read `source` note + `upload`. | note says **`planar`**; `upload` drops from **15.47ms** to a fraction of a ms | `copy report` |
| **H-6** | **D3 re-run.** Broadcast, then press **record**. | the **broadcast survives**. If recording itself fails, the status line says so *and* notes the broadcast is still live. | `copy report` + eyes |
| **H-7** | Only if H-6's recording failed: read the `bus` row. | names the failure (`NOT STARTED — readback path never resolved`) instead of a bare `capture: null` | `copy report` |
| **H-8** | **D4 re-run.** After a glass-break reset, re-arm a 4K broadcast. | display shows the picture when the app says it is broadcasting | eyes |
| **H-9** ⭐ | 📱 **iPhone + HDMI, STILL mode then RECORD mode.** Needs the B551 sync. | `external` now reports **real dims and fps** (it read 0×0 forever before). Then: does record mode still degrade, and what does the display fps say while it does? **This is the row that characterises Daniel's worst iPhone symptom.** | `copy report` in BOTH modes |
| **H-10** | 📲 iPad, HDMI, **10+ min** (the old D4 thermal run). Do after H-6 passes. | pressure drift + warmth; **paste at start and end**. Governor blocker. | `copy report` ×2 |

## 🧩 FH — the unified frame-header parser (B546) · 📱 iPhone Capacitor

| # | do | closes when | channel |
|---|---|---|---|
| **FH-1** 🛑 | **P0 HAZARD CHECK.** Live camera, still mode. | **source panel shows the live feed** — not black, not frozen. If it fails, stop: the build is bad on device. | eyes |
| **FH-2** | rear ▸ front ▸ rear via flip | feed survives every flip; front mirroring correct | eyes |
| **FH-3** | `take still` mode, then upload a still | both show a source (B541 regressed `take still` while upload worked) | eyes |
| **FH-4** | record ~15s, play back in **Photos** | video normal, **audio present and in sync** | eyes |
| **FH-5** | 📲 iPad + HDMI, run from Xcode: play a **video clip** to the display | clip plays **and timeline position + duration read correctly**. The `FYUW` path — a misread f64 corrupts the master clock. | `copy report` · **plus Xcode console**: filter `[fold]`, paste any line with `clock` or `duration`. A `duration` of `0` while the clip plays is the corruption this catches. |
| **FH-6** | 📲 iPad + HDMI, live **camera** to the display | feed appears on the panel | eyes |

## C — where the unaccounted third of every 4K frame lives · 📱 iPhone, no rebuild

Keep everything identical and change only the source. The only variable is where pixels come from — leave form, slice, zoom and output size alone.

| # | exact setup | closes when |
|---|---|---|
| **C-1** | Live camera at **4K**. PiP **OFF**. Not recording. `copy report`. | baseline — note `fps` and `unmeasured` |
| **C-2** | Same session. Switch source to **a still photo from the library**. PiP still OFF, still not recording. `copy report`. | **compare `unmeasured`.** Collapses ⇒ it is the native camera bridge, and that becomes the next optimization target. Stays ~33ms ⇒ real shader work, nothing left to find. |

## B / E — behaviour confirmations · 📱 iPhone

**E setup:** record-video mode, live camera, PiP monitor **visible**. Change only resolution between rows.

| # | exact steps | closes when |
|---|---|---|
| **B1** | A **STILL IMAGE** source, untouched, not recording. Toggle `render: skip identical frames` ON vs OFF. **Two reports.** | `output render` **calls** drop well below fps with it ON, return to ~fps OFF. Pinned to fps in both ⇒ elision is not firing, and that is the finding. |
| **E2** | 4K, start a take, then **stop** it. Watch the PiP. | live picture returns **immediately** |
| **E3** | 4K, **not** recording, framing up. | PiP is **LIVE** — the rule is capture-only. *(Where your "warn me before 4K" change will land.)* |
| **E4** | **FHD**, record a take. | PiP stays live the whole take — FHD is affordable and must not be starved |

## F — A/V sync · 📱 iPhone, eyes and ears only

Record ~10s **while talking** (count out loud — sharp consonants to sync against), save, play back **in Photos**. Smoothing control is in camera settings: **standard · smooth · smooth+**.

| # | exact steps | closes when |
|---|---|---|
| **F1** | **Front** camera, **standard**. | sound present, lips in sync |
| **F2** | **Front** camera, **smooth+**. | sound present and **still in sync** — the real test, longest buffer to compensate |
| **F3** | **Rear** camera, **smooth+**. | in sync |
| **F4** | Fresh launch, do **not** touch smoothing. Check front, flip to rear, check again. | front reads **standard**, rear **cinematic** |
| **F5** | Explicitly pick `smooth+` on front. Flip to rear, flip back. | your choice survived — the per-lens default must stop overriding you |


## ⏳ TF — take finalize (B550) · 📱 iPhone Capacitor · **needs the same fresh `cap:sync`**

| # | do | closes when | channel |
|---|---|---|---|
| **TF-1** | Record a **4K** take of ~60s. Tap stop and **watch the toast**. | it names phases and shows a **moving percentage** during `encoding remaining frames`. A stuck 0% or no phase text means the progress stream is not reaching the UI. | eyes |
| **TF-2** | Same take, let it finish. | **the take actually saves.** This is the row that matters — previously a long 4K finalize was discarded at 30s. | eyes |
| **TF-3** | After it saves, open the panel. | report has **`finalizeMs`** and **`finalizeMarks`** — paste them. This is the first real data on where 4K finalize spends its time. | `copy report` |
| **TF-4** | If a take DOES still fail: read the message. | it names the phase it stalled in, not "finalize timed out". Paste it. | eyes |

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
