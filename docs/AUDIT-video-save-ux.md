# Video save UX audit (2026-07-15, analysis only — no behavior changed)

> **UPDATE 2026-07-16 (B370):** the proposed convergence SHIPPED — `shell/save-flow.js` merges the downloadBlob twins and gives every save on every surface the saving → saved-✓-destination → failed-with-retry flow (sequencing items 2+3). Still open from the sequencing: (1) device-verify the iPhone package path, (4) the desktop parallel-source-recording product decision. The B365 WebCodecs recorder separately resolved this audit's freeze bugs + the WebM gripe (format-honesty section).

Daniel's ask: map how saving a recorded video actually behaves across every surface, check the health of the .zip package path, and identify where UX + code should converge. Written after B355 (host-aware recorder save) and B359; device claims marked where untested.

## The matrix — what happens when you stop a recording

| Surface | What records | Save trigger | Transport | Package option | Feedback while saving | Feedback after |
| --- | --- | --- | --- | --- | --- | --- |
| Desktop web (Chromium/Brave) | effected output (WebM — Chromium's MediaRecorder ceiling) | automatic on stop | browser download (`<a download>`) | none | none | none (file appears in Downloads) |
| Desktop web (Safari) | effected output (**.mp4** — the sink already prefers it) | automatic on stop | browser download | none | none | none |
| Desktop web (Firefox) | effected output (WebM) | automatic on stop | browser download | none | none | none |
| Electron | effected output (WebM — same Chromium ceiling) | automatic on stop | browser download inside the shell (its `fileSystem` host entry is still a stub) | none | none | none |
| iPad Capacitor (desktop chrome) | effected output (**.mp4**) | automatic on stop (B355) | host share sheet (chunked base64 write → Share) | none | **none — and the chunked write of a big take takes real seconds** | the share sheet itself |
| iPhone Capacitor (mobile chrome) | effected output AND the unedited source in parallel (`rawRec`) | **manual**: download tab → menu | host share sheet | **yes — "save package (.zip — video + source)"**, shown when the raw take survived (flip/lens change drops it) | none (zip composes lazily, then the chunked write) | the share sheet; unsaved-take guard on exit (`recordingSaved` + confirm) |
| iPad/iPhone mobile WEB (PWA) | same as mobile chrome | manual (same menu) | browser download (Safari download manager) | yes (same menu) | none | none |

Stills, for contrast, already do this well: `exportStatus` shows "rendering N×N…" → "saved … • sizes • MB" with success styling. Video has nothing anywhere.

## Findings

1. **The zip package path is healthier than remembered.** The code exists (`zipStore`, lazy composition so both takes never sit in memory), and it HAS a UI entry point — the iPhone record-video download menu. What it lacks is a confirmed device pass (Daniel recalls it untested) and any presence outside the phone chrome. Desktop chrome records no parallel source take at all, so a desktop package is a product decision (memory cost at 4K), not a missing wire.
2. **Auto vs manual is the deepest inconsistency, and it exists for a reason.** iPad auto-opens the share sheet because there's exactly one artifact; iPhone interposes a menu because there's a choice (video vs package). Any convergence has to preserve that choice, not flatten it.
3. **Silence during save is universal.** Every surface goes quiet between "stop" and the file existing: Chromium's instant download hides it, but the iPad's multi-second chunked base64 write and the phone's zip composition are real waits with zero feedback — the anxiety Daniel described.
4. **"Saved" confirmation is universal-absent**, including whether the destination was Photos, Files, Downloads, or a share target.
5. **Transport is already centralized; feedback is not.** All roads lead through a host-aware `downloadBlob` (desktop `env.downloadBlob`, mobile's own twin — near-duplicates, a merge candidate for the conduit/host layer). That is exactly where a single "saving → saved/failed" state machine belongs, so every caller inherits feedback for free.

## Proposed convergence (for discussion, then an increment of its own)

- **One save-flow service** wrapping the (unified) host-aware saver with three states: `saving` (persistent status/overlay — reuse the stills' status pattern), `saved` (toast naming the destination: "saved — check the share sheet" / "saved to Downloads"), `failed` (message + retry). Both chromes consume it; stills migrate to it too so video and stills speak one language.
- **One take-ready model:** on stop, every surface surfaces the same choice set — *save video* (+ *save package* when a source take exists). Where the platform makes auto-present natural (single artifact on Capacitor) keep the auto share sheet; elsewhere a take-ready toast with the actions doubles as the user gesture browsers require.
- **Format honesty stays**: .mp4 wherever MediaRecorder supports it (WebKit), WebM as the Chromium/Firefox/Electron ceiling; the upgrade for mp4-everywhere is routing recording through the WebCodecs + mp4-muxer path motion export already uses (BACKLOG).
- **Sequencing:** (1) device-verify the iPhone package path as-is; (2) merge the two downloadBlob twins; (3) build the save-flow service + toasts; (4) then decide desktop parallel-source recording.

## Open bugs (Daniel's 2026-07-15 cross-browser pass)

- **iPad Capacitor: mid-record video freeze.** ~13s into a take (possibly at a pinch canvas-zoom), the recorded VIDEO sticks on one frame for the remaining minute while AUDIO records fine throughout. Since audio rides a separate track, the video side stalled: either the output bus's readback loop stopped publishing (GPU pressure during the pinch?) or WebKit's `canvas.captureStream` stopped ticking. Probably not new — first take long enough to catch it. **Next diagnostic: repro with the console attached + read the `live-output` diag ops records during the freeze window** (they show whether the bus kept rendering). If the bus kept publishing, the suspect is WebKit captureStream; if it stopped, the readback loop.
- **Safari desktop web: ~5–6fps recording + a freeze ~10s in** (audio fine). Same family as the iPad freeze — WebKit readback + captureStream. Both strengthen the case that the durable fix is Lane 4B / the WebCodecs recorder rather than per-engine MediaRecorder debugging.
- **Firefox: record button dead with no error** → RESOLVED B361 by Daniel's call: record is disabled on Gecko with an honest hint ("recording is unreliable in Firefox — use Safari, Chrome, or the desktop app"). Not worth engine-specific debugging for a WebM-ceiling browser.
- **Brave/Chromium: flawless at 50fps+** — the readback loop is NOT the bottleneck on Blink; the slow paths are WebKit-specific.

## Related but separate: iPad record fps

~15fps at FHD recording on the M1 iPad Pro vs smooth 4K over AirPlay the same day is expected with the current architecture: recording runs the output bus's READBACK loop (render → drawImage → getImageData per frame — the WebKit-safe but slow path), while AirPlay/HDMI/output-window render themselves from state with zero readback. The real fix is Lane 4B (native frame capture on iOS); until then the honest lever is the resolution tier. Filed in BACKLOG.
