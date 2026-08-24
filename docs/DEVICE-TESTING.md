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

## What a device answer actually costs (measured by Daniel, 2026-08-23)

**Record it here so it drives decisions instead of living in someone's head.** One turn, end to end, on an iPad:

| step | elapsed |
|---|---|
| build + open the latest code on device | ~1:00 |
| select and upload a 1:49 4K clip from iCloud | ~2:20 |
| reach the action under test | ~3:40 |
| the bake itself | 2:00+ |
| **total, on a turn that hit a false-positive guard and never reached the test** | **8:55** |

**So the unit cost of a device answer is roughly nine minutes of Daniel's time plus a context switch, and a wasted one costs the same as a good one.**

**Three rules follow, and the first is already in `DEBUGGING-PROTOCOL.md`:**

1. **Never spend a device session on a Class 1 question.** The failure mode this month was not disbelieving the rule — it was treating *"an iPad is in hand"* as a reason to use it. Ask first whether reading the code answers it.
2. **Check whether it reproduces on desktop before asking for a device.** The web build runs the engine, the forms, the Loop Builder, the bake, and all of WebCodecs. It does **not** run the native decode plugin, HDMI, the frame socket, or thermal. **Anything outside that list should be reproduced on the Mac first**, where the loop is seconds and a debugger attaches.
3. **Batch.** Instrumentation changes cannot entangle with one another, so shipping one build per instrument buys nothing and costs a full session each time. Accumulate several, ship one build, run one session against a checklist.
