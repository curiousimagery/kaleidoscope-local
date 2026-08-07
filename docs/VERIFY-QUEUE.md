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
| **a fresh `cap:sync`** | **all of C1** | C1 shipped B546, after the sync taken for A–F. |
| nothing | **A, C1, F, Loop Builder, the carried-forward items** | independent; run in any order |

**Not blocked, not urgent:** everything under "carried forward" — those have been open for weeks and are not gating current work.

---

## 🔥 THERMAL ARC — the A–F matrix (B540–B543)

**Run A first.** Each row: set it up, do the thing, then `copy report` and note fps / `unmeasured` / `pressure`.

### A. No-regression (📱 iPhone Capacitor, ~10 min) — **eyes only, nothing to paste**

| # | setup | do | closes when |
|---|---|---|---|
| A1 | live camera, still mode | leave it sitting ~30s, then move a slice | preview never stale or frozen; motion starts on the **first** frame with no hitch at the idle→moving transition |
| A2 | record video mode, PiP visible | record ~20s, move the slice mid-take | played back in **Photos**: every frame present, no stutter |
| A3 | mid-take | open the panel, try stepping the **output** ladder down | stepper has no effect; note reads `ladder locked — this canvas IS the take` |
| A4 | any | toggle `render: skip identical frames` off/on | no visible difference at all |

**🛑 If A1 or A4 shows a stale preview: stop, turn `render: skip identical frames` OFF, and report it.** The elision guard has a gap; it is the first thing to fix and B/C/E are invalid until it is.

### B. The elision win (📱 iPhone; 📲 iPad if convenient) — **paste TWO reports per row**

Paired A/B. A single report cannot close these rows.

| # | scenario | closes when |
|---|---|---|
| B1 | live camera, static scene, **not** recording | `output render` **calls** roughly HALVE with the flag on; `fps` unchanged. (Calls, not ms.) |
| **B2** | same, left running **10+ min** | `pressure` and device warmth, ON vs OFF. **Paste a report at start AND at end of each run.** The sustained/installation case, and a governor blocker. |
| B3 | record video mode, framing up (not recording), **PiP hidden** | the eased-render row disappears from the report entirely |

### C. H2 — the unaccounted third of every 4K frame (📱 iPhone, ~5 min, no rebuild) — **paste both**

| # | scenario | closes when |
|---|---|---|
| C1a | 4K source = **camera**, PiP off | baseline captured (~11fps on 14 Pro, `unmeasured` ~33ms) |
| C1b | 4K source = **a still image**, same resolution, PiP off | **verdict:** `unmeasured` collapses + fps jumps ⇒ the missing third is the native camera bridge. Unchanged ⇒ it is the fold shader and there is nothing more to find. |

### D. HDMI — never measured on any device (📲 iPad Capacitor + HDMI cable) — **paste every row**

No prediction here; that is the point.

| # | scenario | closes when |
|---|---|---|
| **D1** | HDMI connected, app idle | the `external` row reports **real dimensions, not 0×0**. 🛑 If 0×0, stop and report — D2–D4 would measure nothing. |
| D2 | HDMI + live camera | fps and `unmeasured` vs the same scene with the cable out |
| D3 | HDMI + recording a take | **the combination that decides the PiP question** |
| **D4** | HDMI, **10+ min** | pressure drift and warmth. Governor blocker; paste start and end. |

### E. The starved PiP at 4K (B543) (📱 iPhone Capacitor)

| # | scenario | closes when | channel |
|---|---|---|---|
| E1 | 4K source, start a take | box stays · message reads `preview unavailable while capturing at 4K` · **rec dot still visible** (all three) | eyes |
| E2 | same, stop the take | PiP returns to live immediately | eyes |
| E3 | 4K, framing up, **not** capturing | PiP is LIVE — the rule is capture-only | eyes |
| E4 | FHD, recording | PiP live at 10Hz, unchanged | eyes |
| E5 | 4K, recording | fps near the PiP-off number (14 Pro: 11.4, not 11.0) | **`copy report`** |

### F. A/V sync + audio (📱 iPhone Capacitor) — **eyes and ears; play back in Photos**

| # | scenario | closes when |
|---|---|---|
| F1 | front camera, `standard`, talking | sound present, lips in sync |
| F2 | front camera, `smooth+`, talking | sound present, **still** in sync — the real test (~1s stabilization buffer must be compensated exactly) |
| F3 | rear camera, `smooth+`, talking | in sync |
| F4 | flip lenses without touching the motion control | front defaults `standard`, rear `cinematic` |
| F5 | pick a mode explicitly, then flip | the explicit choice survives the flip |

### Why the governor is not built yet
Its first rule is already known and measured — **the PiP must go OFF at 4K, not merely slow down** (11.0fps at 10Hz vs 11.4fps off). That shipped as B543. Everything else a governor would decide — what yields first, at what pressure, what the sustained setpoint is — needs **B2 and D4**. Building it on assumptions is the mistake this arc has punished repeatedly.

---

## 🧩 C1 — the unified frame-header parser (B546) — **REQUIRES A FRESH `cap:sync`**

**⚠️ B546 landed AFTER the sync taken for A–F.** These rows need `npm run build && npx cap sync ios` and an Xcode rebuild. Running them against the older build verifies nothing. A–F are unaffected and can finish on the current sync.

Both native frame consumers now share one parser (`shell/frame-header.js`). Nothing should change — that is the entire point. Pure regression pass on the path B540 broke.

| # | where | do | closes when | channel |
|---|---|---|---|---|
| **C1-1** | 📱 iPhone Capacitor, run from Xcode | live camera, still mode | **source panel shows the live feed** — not black, not frozen. 🛑 If this fails, stop: the build is bad on device. | eyes |
| C1-2 | 📱 iPhone Capacitor | rear ▸ front ▸ rear via flip | feed survives every flip; front mirroring correct | eyes |
| C1-3 | 📱 iPhone Capacitor | `take still` mode, then upload a still | both show a source (B541 regressed `take still` while upload still worked) | eyes |
| C1-4 | 📱 iPhone Capacitor | record ~15s, play back in **Photos** | video normal, **audio present and in sync** — confirms the latency field still parses at its offset | eyes |
| **C1-5** | 📲 iPad Capacitor **+ HDMI**, run from Xcode | play a **video clip** to the external display | clip plays on the panel **and timeline position + duration read correctly in the app**. This is the `FYUW` path, where a misread second f64 corrupts the master clock. | **`copy report`** on the iPad while playing · **plus Xcode console**: filter `[fold]`, paste any line containing `clock` or `duration`. A `duration` of `0` while the clip visibly plays is the exact corruption this row exists to catch. |
| C1-6 | 📲 iPad Capacitor + HDMI | live **camera** to the external display | feed appears on the external panel | eyes |

---

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
