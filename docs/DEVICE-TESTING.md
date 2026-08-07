# reading diagnostics on device

**How to get evidence off an iPhone or iPad running the Capacitor build.**

This doc exists because two builds were spent guessing at the silent-take bug while the evidence that would have settled it went to a console nobody could open. The instrumentation was fine. The channel was the problem.

**The rule that follows from that: anything Claude adds for Daniel to read must reach the exported report. Console is a bonus, never the only route.**

---

## Channel 1 — the exported report (default, no tooling)

**Use this unless there is a reason not to.** It is how every reading in the thermal arc arrived.

1. Open the frame-cost panel: **triple-tap the version label** in the phone chrome, or **show frame cost** in the diagnostics block. (Desktop/Electron: `?perf`, or the **frame cost panel** button in diagnostics. On iPad the button is the only way in.)
2. Do the thing being measured. Leave the panel open — it floats and does not cover the app.
3. Tap **copy report**. The JSON goes to the clipboard and into a selectable text box as a fallback.
4. Paste it into the conversation.

**What the report contains:** `fps`, `frameMs` p50/p95, `accountedMs` / `unaccountedMs`, every registered surface with per-pass timings and call counts, `mpPerFrame`, `pressure`, the last take's `audio` outcome, and the saved `baseline` if one exists for that scenario.

**Set the `scenario` dropdown before copying** — it names the reading and keys the saved baseline, so `recording` and `idle-still` compare against their own history rather than each other.

---

## Channel 2 — the Xcode console (for `console.*` output)

Capacitor forwards web console output to the native log, so it lands in Xcode's debug console. `loggingBehavior: "debug"` is set explicitly in `capacitor.config.json` — it is the default, pinned so it cannot drift. **Changing it requires `npx cap sync ios` to take effect.**

1. Open `ios/App/App.xcworkspace` in Xcode (the **workspace**, not the project).
2. Select the connected device in the scheme's destination menu, then **Run** (⌘R).
3. The debug console is the bottom pane. If hidden: **View → Debug Area → Activate Console** (⇧⌘Y).
4. Use the filter box at the bottom right of that pane to search.

**Search strings that matter:**

| filter | what it surfaces |
| --- | --- |
| `[conduit]` | recorder, encoder, capture, and broadcast internals |
| `[fold]` | app-level lifecycle: edition, camera path, mic acquisition, record state |
| `audio:` | the per-take audio verdict with batch/chunk/config counts |
| `⚡️` | everything Capacitor forwarded, if you want the raw firehose |

Capacitor prefixes forwarded lines with `⚡️  [log] -`, `⚡️  [warn] -`, or `⚡️  [error] -`, so severity is visible in the filter results.

**Without Xcode running the app:** connect the device, open **Console.app** on the Mac, select the device in the sidebar, and filter by process `App`. This catches logs from a launch Xcode did not start, which is useful for testing a build the way a user would run it.

---

## Channel 3 — Safari Web Inspector (full devtools)

Heaviest to set up, and the only one that gives breakpoints, a network panel, and a live DOM.

1. **On the iPhone/iPad:** Settings → Apps → Safari → Advanced → **Web Inspector** on.
2. **On the Mac:** Safari → Settings → Advanced → **Show features for web developers** on.
3. Connect by cable and launch the app on the device.
4. In Safari: **Develop → [device name] → Fold** (the entry is the app's webview, not a tab).

Worth the setup when stepping through logic. Not worth it for collecting a number.

---

## Which channel for which job

| job | channel |
| --- | --- |
| a performance reading | 1 |
| the outcome of a take (audio, encoder, capture path) | 1 |
| a one-off trace while reproducing a bug | 2 |
| something that fires before the panel can be opened | 2 |
| stepping through logic, inspecting state live | 3 |

---

## For Claude, when adding instrumentation

- **Default to the report.** If Daniel is expected to read it, it belongs in the exported JSON. Console-only means uncollectable.
- **Publish, do not just log.** The pattern is `recorder.js`'s `reportAudio()` → `env.lastAudioReport` → the panel's export. Copy that shape.
- **Name the stage, not the symptom.** `CHUNKS BUT NO decoderConfig` is actionable; `audio failed` is another round trip.
- **Cover the fallback paths too.** A take rescued by MediaRecorder must not read as a failure, or the report sends the next build in the wrong direction.
- **Keep the `[fold]` / `[conduit]` prefixes** on console output. They are the Xcode filter strings above.
