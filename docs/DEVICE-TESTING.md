# reading diagnostics on device

Only what is specific to this project. Safari Web Inspector setup, Xcode basics, and Console.app are standard and deliberately not documented here.

## The rule

**Anything Daniel is meant to read must reach the exported report.** He does not run Safari Web Inspector, and console output requires attaching Xcode. Three builds were spent guessing at the silent-take bug while the deciding evidence went somewhere nobody could open it. Console is a bonus, never the only route.

When adding instrumentation: publish, don't just log (`recorder.js` `reportAudio()` → `env.lastAudioReport` → `perf-panel.js` export). Name the failing **stage**, not the symptom. Cover fallback paths, so a rescued take does not read as a failure.

**And measure the signal, not the plumbing.** B531-B533 counted every stage of the audio path, all of them read healthy, and the take was silent — because an AudioWorklet emits render quanta whether or not there is any audio in them. A pipeline that is running is not a pipeline that is carrying something.

## Getting a report

Triple-tap the version label, or **show frame cost** in the diagnostics block. (Desktop/Electron: `?perf`, or the frame-cost button in diagnostics. On iPad that button is the only way in.) Set the **scenario** dropdown before copying — it names the reading and keys the saved baseline, so `recording` and `idle-still` compare against their own history. Then **copy report**.

## Xcode console filters

`loggingBehavior: "debug"` is pinned in `capacitor.config.json` so console forwarding cannot silently drift. Changing it needs `npx cap sync ios`. Capacitor prefixes forwarded lines with `⚡️ [log|warn|error] -`.

| filter | surfaces |
| --- | --- |
| `[conduit]` | recorder, encoder, capture, broadcast internals |
| `[fold]` | app lifecycle: edition, camera path, mic acquisition, record state |
| `audio:` | the per-take audio verdict, counts, peak level, and container contents |
