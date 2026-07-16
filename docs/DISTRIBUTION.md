# distribution & feature-gating

The technical reference for shipping Fold as native builds and for gating features across editions. This is the *mechanics* doc (signing, TestFlight, App Store, the edition flag); the *strategy* (positioning, pricing, monetization phases) lives in `FOLD.md`, and the running task list in `BACKLOG.md` (Native wrapper & Syphon · Strategic forks). Written during the Capacitor arc (B300–, branch `capacitor-arc`).

## the shape of it

One web codebase, several native shells, all reusing Engine/Kit/Components/Chrome unchanged:

- **web** (Vercel) — the free/PWA surface. `vite build` → `dist/`.
- **Electron** (macOS) — the Syphon/desktop shell. Wraps `dist/`. Shipped (unsigned DMG).
- **Capacitor** (iOS/iPadOS) — the App Store shell. Wraps `dist/`. This arc.

The shell never forks the UI; it injects a `host` (native services) + `capabilities` (per-platform profile + `edition`). See `ARCHITECTURE.md` "Why this matters for native."

## the Capacitor build pipeline (what exists now)

- `capacitor.config.json` → `webDir: dist`, appId `art.curiousimagery.fold` (CONFIRM before first submission — it's the permanent bundle id; changing it later means a new App Store record).
- `npm run cap:sync` = `vite build` → `cap sync ios` (copies the web build into `ios/App/App/public`, regenerates `Package.swift` from installed plugins). `npm run ios` also opens Xcode. `npm run cap:open` just opens Xcode.
- The `ios/` project is committed (like `electron/`); the web-copy, Pods, and build outputs are gitignored. Capacitor 8 uses **Swift Package Manager** for plugins (no Podfile); CocoaPods is installed for any SDK that ships only as a pod (e.g. NDI).
- Day-to-day: edit web code → `npm run cap:sync` → run in Xcode/simulator. Native plugin code lives in `ios/` and is edited there (like the Electron `native/` addons).

Verified through B303: `xcodebuild` BUILD SUCCEEDED for the simulator, app boots and reuses the mobile/desktop chrome, first-party plugins (Filesystem/Share/Preferences) linked.

## running on a device (development, free Apple ID — no $99 account needed)

You install onto your OWN devices with just your existing Apple ID. The only limits vs the paid account: a free-signed app stops launching after ~7 days (re-run from Xcode to refresh), and there's no over-the-air distribution (that's TestFlight, below). All devices use the identical process; one universal `.app`.

### first-time Mac + Xcode signing (once per Mac)

1. `npm install` (pulls `node_modules`, incl. the Capacitor deps).
2. `npm run ios` — builds the web app, copies it into the native project, opens Xcode. First open resolves the Swift Package deps over the network (~1 min).
3. Xcode → **Settings → Accounts → +** → sign in with your Apple ID (creates a free "Personal Team").
4. Select the blue **App** project → **App** target → **Signing & Capabilities** → check **Automatically manage signing** → **Team** = your Personal Team. If it says the bundle id `art.curiousimagery.fold` is unavailable, append `.dev` locally (device-testing only — don't commit that).

### adding a NEW device (each device's first time — Xcode prompts most of this, but here's the full list, since you'll come to this cold when you add the smaller devices later)

1. Plug in via USB; on the device tap **Trust This Computer** + enter the passcode.
2. **Enable Developer Mode:** device → **Settings → Privacy & Security → Developer Mode → on → restart**, then confirm after restart. (The toggle only appears after the device has been connected to Xcode at least once — so connect first, then look.) Note: you must first attempt to run on the device before dev mode even appears as an option on the iphone.
3. In Xcode, **Window → Devices and Simulators** → the device appears and "prepares for development" (downloads a debug-symbols package the first time — wait for it to finish).
4. Pick the device in Xcode's toolbar dropdown → **Run (⌘R)**.
5. First launch is BLOCKED as an untrusted developer. On the device: **Settings → General → VPN & Device Management → Developer App → [your Apple ID] → Trust**. Then tap the Fold icon.
6. (Optional) In Devices and Simulators, tick **Connect via network** to run wirelessly from then on.

### the every-time loop, and cap:sync vs the initial build

After signing/trust is set up (once), the whole loop is: change web code → **`npm run cap:sync`** → back in Xcode press **Run**. The INITIAL build is the one-time signing + device-trust setup above. `npm run cap:sync` (= `vite build` + `cap sync ios`) is the REPEAT step: it recompiles the web app and copies it into `ios/App/App/public` and refreshes the plugin list. It does NOT touch signing, open Xcode, or build the native app — Xcode does the native compile + install when you press Run. Mental model: **signing/trust is one-time per device; `cap sync` + Run is every code change.**

### cable vs wireless, and what TestFlight buys you

- **Now (development):** the first connection needs the cable; after ticking "Connect via network" you can run wirelessly from Xcode on the same network. But it still needs YOUR Mac + Xcode open, and the 7-day re-sign applies.
- **TestFlight (needs the $99 account):** yes to all three of your guesses. It distributes builds **over-the-air** (testers install from the TestFlight app — no cable, no Xcode, not even your Mac), it **removes the 7-day expiry** (TestFlight builds last ~90 days), and it lets you **invite other people as testers** (up to 100 internal + up to 10,000 external by email/link) — the right path for alpha testing. You upload one archived build to App Store Connect and testers pull it themselves.

### Xcode's "recommended settings" prompt (the yellow ⚠)

Safe to **Accept all** for this project — they're modernization nudges, low-risk here: Enable Recommended Warnings / String Catalog Symbol Generation / Parallelization (cosmetic/quality/speed, no behavior change), and Inherit Development Team from Project Settings (convenience). The only one that ever breaks web-wrapper builds is **Enable User Script Sandboxing** (it can block build scripts from reaching files) — **tested B304: our build SUCCEEDS with it on** (Capacitor copies web assets via `cap sync` outside Xcode, so there's no in-Xcode script phase for it to break). Accepting edits the committed `ios/App/App.xcodeproj/project.pbxproj`, so **commit that change** after accepting (or hand it to Claude to fold in) to keep the repo consistent.

## what needs the $99 Apple Developer account (the gate)

Nothing below can happen until the account exists. None of it blocks development (the simulator needs no account; a free personal team allows 7-day device installs).

1. **Signing.** Enroll → App Store Connect creates the Team. In Xcode, set the App target's Team and enable Automatic Signing (Xcode manages the App ID `art.curiousimagery.fold`, certificates, and provisioning profiles). For CI, switch to manual signing with an uploaded distribution certificate + profile.
2. **Device install (beyond 7 days).** A real provisioning profile removes the free-tier 7-day expiry.
3. **TestFlight.** `xcodebuild archive` → `xcodebuild -exportArchive` (or Xcode Product ▸ Archive) → upload to App Store Connect → internal (up to 100, instant) / external (review) testers. This is how Daniel + alpha testers get builds before the store.
4. **App Store submission.** Create the app record in App Store Connect, fill metadata + screenshots (per device class), submit for review. 15–30% cut applies.
5. **Entitlements that need the account:** any push, associated domains, or IAP (freemium) capabilities.

**CLI automation (later, optional):** `xcodebuild archive`/`exportArchive` scripts, or `fastlane` (would be a new dev dependency — ASK before adding). Not needed to start; a repo script mirroring `electron/scripts/build-dmg.cjs` can wrap the archive/export once signing exists.

**Version mapping:** `src/version.js` `VERSION`/`BUILD` should map to `CFBundleShortVersionString` (e.g. `0.15.2`) and `CFBundleVersion` (the monotonic `BUILD`, e.g. `303`) in `ios/App/App/Info.plist` at archive time. Wire this into the archive script so the store build number always tracks `BUILD`.

**Before first submission (checklist):** confirm the bundle id; drop the real app icon (`ios/App/App/Assets.xcassets/AppIcon` — currently the default Capacitor mark, tracked in BACKLOG "drop the real assets") + launch screen; ~~set usage-description strings in `Info.plist`~~ **(DONE B303 — `NSCameraUsageDescription`/`NSMicrophoneUsageDescription`/`NSPhotoLibraryAddUsageDescription` added; required or camera/mic/Photos-save crash on device)**; pick a minimum iOS version (WebCodecs needs 16.4+ if we lean on it).

## feature-gating: the edition flag (built B301, seam only)

Two orthogonal axes decide what a build offers, both cross-shell (web / Electron / Capacitor):

1. **Native capability** — does the host provide it? Answered at runtime by `env.host.*.available` (Syphon/NDI/HDMI/native-camera) and `env.capabilities.*`. Not a licensing decision; a "does this shell/device have it" decision.
2. **Edition / tier** — is this a lite/pro/freemium build? Answered by the **`EDITION` flag** in `kit/capabilities.js`. This is the licensing/packaging decision, and it is deliberately platform-independent.

### how it works (already in the code)

- `EDITION` resolves from the build-time env var `VITE_FOLD_EDITION` (Vite bakes it in), with a `?edition=` URL override for testing gates in a browser. Default `'web'`.
- `editionAllows(feature)` reads an `EDITION_FEATURES` map that **defaults to everything-on**, so an unlisted edition withholds nothing (the shipping builds are byte-identical). A listed edition (e.g. the example `lite`) sets specific families false.
- Both chromes read the same seam: the desktop mode picker drops a withheld mode (`?edition=lite` hides motion + perform), and the mobile chrome reads it at boot. New gates hook the same `editionAllows(...)` call at the feature's natural seam.

### building a specific edition

`VITE_FOLD_EDITION=<edition> npm run cap:sync` (or `vite build` for web / the Electron pack). The native shell wraps whatever `dist/` was built. So the SAME repo produces: a free web build, a pro web build (behind auth), an "iPad + Electron bundle without motion" edition, a freemium mobile tier — each one flag, no per-shell code forks. Verified the bake works (B300: `VITE_FOLD_EDITION=iostest` appears in the bundle; the default build has zero trace).

### the gating map (fill in with positioning — D1 in BACKLOG)

The feature families that make natural gates, and the scenarios Daniel named. This is a *menu*, not a decision — the actual free/pro split waits on positioning (`FOLD.md` D1). Each row = one `editionAllows('<family>')` check at the noted seam.


| family (`editionAllows` key)  | seam                            | example gate                                         |
| ----------------------------- | ------------------------------- | ---------------------------------------------------- |
| `motion`                      | desktop mode picker (`main.js`) | "iPad+Electron lite" bundle without motion/animation |
| `perform`                     | desktop mode picker             | pro-only live-performance mode                       |
| `inputs` / control bus        | the`[input]` app-bar button     | pro-only MIDI/gamepad/gesture mapping                |
| `recordVideo`                 | mobile`[+]` source menu         | freemium: watermark or cap length on free            |
| `broadcast` (HDMI/NDI/Syphon) | output destination picker       | pro-only external output                             |
| `exportResolution`            | save/record resolution picker   | free capped at 1080p, pro to 4K                      |
| `forms` (beyond radial/rect)  | form picker                     | free = core forms, pro = full set                    |

Freemium mechanics (later, when D1 says so): a **`host.iap` seam** (StoreKit on iOS via a Capacitor IAP plugin; a web billing provider on the web) sets a runtime "entitled" flag that flips `EDITION` from `*-free` to `*-pro` after purchase. Design it the same way as the other host seams (available/degrade); do NOT build it until positioning is settled. No paywall exists today — only the seam.

## per-platform codec / capture locking (reference)

`kit/capabilities.js` is the home. The engine-identity + capture-path decisions already live there (`capturePath`: WebKit → `gl`, else `2d`; `firefoxTextureCapped`). Native adds: iOS WebKit is the only ProRes decoder; WebCodecs `VideoEncoder` needs iOS 16.4+; HEVC >4K encode is Apple-Silicon-only. As native codec paths land, lock them per `engineId`/`edition` here rather than sniffing inline. (BACKLOG: "Native iOS/iPadOS/macOS app capability inventory".)

## remaining native work (specced for co-implementation on device)

Built and verified-by-compile where possible; runtime needs Daniel's device. Each rides its `host.*` seam.

- **HDMI out (`host.externalDisplay`)** — his top broadcast priority. A Capacitor Swift plugin watches `UIScreen.didConnectNotification`/`didDisconnect`, creates a second `UIWindow` on the external screen, and reports connect/disconnect to JS (the plugin *shell* is straightforward — the CAPBridgedPlugin + UIScreen notifications). **THE REAL DESIGN QUESTION (found B303, must be resolved on-device): how the external display gets the live program frames.** A second `UIWindow` hosting its own `WKWebView` that loads `output.html` will NOT work as-is: `output.html` receives program state via `BroadcastChannel`, which does **not** cross separate WKWebViews — the display would render blank. Options to weigh on device: (a) drive the external webview over the Capacitor bridge / a shared file / `localStorage`-poll instead of BroadcastChannel (state-sync, cheap — the output view re-renders from state, same as the popup window today); (b) mirror the main webview's canvas frames to the native layer and draw them on the external `UIWindow` (the frame-bridge, expensive). Option (a) reuses the existing "output view renders from a state stream" design (`src/output-view.js`) and is the likely answer — but the transport (bridge vs storage vs a tiny local socket) needs measuring on hardware. **This is the same frame-vs-state delivery question as NDI (out) and the camera (in) — i.e. the frame-bridge spike is the real gate for all three, exactly as the plan flagged.** Runtime verify: iPad + USB-C-HDMI + a display.
- **Native camera (`host.nativeCamera`)** — his highest lever. Cheap path is already web (`camera.js` `applyControls` for zoom/torch/focus). The native plugin adds what getUserMedia can't: EV/WB/lens-select + a full-res still on pause (AVCapturePhotoOutput). THE SPIKE: measure the cost of bridging AVFoundation frames INTO WebGL before committing to full native capture (the readback problem in reverse). Runtime verify: a device with a camera.
- **NDI (`host.ndi`)** — broadcast #3. Native-SDK-only (the NDI SDK is a third-party native dependency — NOT yet added; ASK before adding per the deps agreement). A Swift plugin publishes the program output as an NDI source Arena lists. Scaffold the seam + plugin skeleton first; add the SDK when greenlit.
- **AirPlay** — broadcast #2. Try the pure web spike first (`canvas.captureStream()` → `<video>` → `video.webkitShowPlaybackTargetPicker()`); native fallback only if it disqualifies.

## authoring a custom native plugin (the concrete pattern — researched B303)

Reverse-engineered from the first-party plugins so the HDMI/camera/NDI plugins are fast to build + verify together on-device. **Why not build them blind:** `cap sync` MANAGES `ios/App/CapApp-SPM/Package.swift` (marked "DO NOT MODIFY") and the `packageClassList` in `ios/App/App/capacitor.config.json`, deriving both from the installed npm plugins. So a custom plugin must be a **local npm package** to survive `cap sync`, and whether it actually REGISTERS at runtime (the `packageClassList` entry) is precisely what can't be verified without a device — a plugin that *compiles* is not a plugin that *works*. Hence: co-implement on device, not blind.

The pattern (mirror `@capacitor/preferences`):

1. **A local npm package** `native-plugins/<name>/` referenced in `package.json` as a `file:` dependency, with a `package.json` carrying a `capacitor` field so `cap sync` treats it as a plugin.
2. **`Package.swift`** (swift-tools 5.9): a library target depending on `.product(name: "Capacitor", package: "capacitor-swift-pm")`.
3. **The plugin class** `ios/Sources/<Name>Plugin/<Name>Plugin.swift`:
   ```swift
   import Foundation
   import Capacitor
   @objc(ExternalDisplayPlugin)
   public class ExternalDisplayPlugin: CAPPlugin, CAPBridgedPlugin {
       public let identifier = "ExternalDisplayPlugin"
       public let jsName = "ExternalDisplay"
       public let pluginMethods: [CAPPluginMethod] = [
           CAPPluginMethod(name: "present", returnType: CAPPluginReturnPromise),
           CAPPluginMethod(name: "clear",   returnType: CAPPluginReturnPromise),
       ]
       @objc func present(_ call: CAPPluginCall) { /* UIScreen + 2nd UIWindow + WKWebView(output.html) */ call.resolve() }
       @objc func clear(_ call: CAPPluginCall) { call.resolve() }
       // notifyListeners("change", data:) for UIScreen didConnect/didDisconnect
   }
   ```
4. **JS side:** `import { registerPlugin } from '@capacitor/core'; const ExternalDisplay = registerPlugin('ExternalDisplay');` inside `shell/capacitor-host.js`, wiring `host.externalDisplay.present/clear/onChange` to it. (No separate JS wrapper package needed — the app registers by name.)
5. `npm install ./native-plugins/<name>` → `cap sync ios` (adds it to Package.swift + packageClassList) → build in Xcode → verify on device.

The three custom plugins (`ExternalDisplay`/HDMI, `NativeCamera`, `NDI`) each follow this exactly; NDI additionally needs the NDI SDK (a native dependency — get the go-ahead first).

## device-verify-pending (built or ready, needs Daniel's hardware)

Things the autonomous run could not verify (no headless browser + no camera in the simulator): camera controls runtime (`camera.js` layer is ready), the mobile camera-settings **gear popover** (consumes the layer), the **record-at-named-resolution** mobile integration (the delicate record path — desktop already records at the output-bus resolution via `output-engine.renderFrameAt`; mobile copies the on-screen canvas, so its offscreen-render integration is the real work and must be verified on device), and the native save actually landing in Files/Photos. The iOS safe-area/tab-bar landscape polish is also device-gated (the simulator can't be rotated headlessly here).

## fold-ndi setup (per machine)

The NDI plugin links the **licensed Vizrt NDI SDK** (install from ndi.video → `/Library/NDI SDK for Apple`). Its binaries never enter the repo: run `native-plugins/fold-ndi/scripts/make-xcframework.sh` once per machine (and after SDK updates) to build the .gitignored `ios/ndi.xcframework` before the first iOS build. Notes: the SDK ships no arm64-simulator slice, so the app excludes arm64 for SIMULATOR builds (they run x86_64 under Rosetta); device builds are native arm64. Distribution builds (TestFlight/App Store, and the Electron DMG) must bundle the SDK's redistributable per its license — an open item tracked in BACKLOG "NDI out".
