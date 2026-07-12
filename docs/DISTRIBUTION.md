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

## what needs the $99 Apple Developer account (the gate)

Nothing below can happen until the account exists. None of it blocks development (the simulator needs no account; a free personal team allows 7-day device installs).

1. **Signing.** Enroll → App Store Connect creates the Team. In Xcode, set the App target's Team and enable Automatic Signing (Xcode manages the App ID `art.curiousimagery.fold`, certificates, and provisioning profiles). For CI, switch to manual signing with an uploaded distribution certificate + profile.
2. **Device install (beyond 7 days).** A real provisioning profile removes the free-tier 7-day expiry.
3. **TestFlight.** `xcodebuild archive` → `xcodebuild -exportArchive` (or Xcode Product ▸ Archive) → upload to App Store Connect → internal (up to 100, instant) / external (review) testers. This is how Daniel + alpha testers get builds before the store.
4. **App Store submission.** Create the app record in App Store Connect, fill metadata + screenshots (per device class), submit for review. 15–30% cut applies.
5. **Entitlements that need the account:** any push, associated domains, or IAP (freemium) capabilities.

**CLI automation (later, optional):** `xcodebuild archive`/`exportArchive` scripts, or `fastlane` (would be a new dev dependency — ASK before adding). Not needed to start; a repo script mirroring `electron/scripts/build-dmg.cjs` can wrap the archive/export once signing exists.

**Version mapping:** `src/version.js` `VERSION`/`BUILD` should map to `CFBundleShortVersionString` (e.g. `0.15.2`) and `CFBundleVersion` (the monotonic `BUILD`, e.g. `303`) in `ios/App/App/Info.plist` at archive time. Wire this into the archive script so the store build number always tracks `BUILD`.

**Before first submission (checklist):** confirm the bundle id; drop the real app icon (`ios/App/App/Assets.xcassets/AppIcon` — currently the default Capacitor mark, tracked in BACKLOG "drop the real assets") + launch screen; set usage-description strings in `Info.plist` (`NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, `NSPhotoLibraryAddUsageDescription` for saving to Photos); pick a minimum iOS version (WebCodecs needs 16.4+ if we lean on it).

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

| family (`editionAllows` key) | seam | example gate |
| --- | --- | --- |
| `motion` | desktop mode picker (`main.js`) | "iPad+Electron lite" bundle without motion/animation |
| `perform` | desktop mode picker | pro-only live-performance mode |
| `inputs` / control bus | the `[input]` app-bar button | pro-only MIDI/gamepad/gesture mapping |
| `recordVideo` | mobile `[+]` source menu | freemium: watermark or cap length on free |
| `broadcast` (HDMI/NDI/Syphon) | output destination picker | pro-only external output |
| `exportResolution` | save/record resolution picker | free capped at 1080p, pro to 4K |
| `forms` (beyond radial/rect) | form picker | free = core forms, pro = full set |

Freemium mechanics (later, when D1 says so): a **`host.iap` seam** (StoreKit on iOS via a Capacitor IAP plugin; a web billing provider on the web) sets a runtime "entitled" flag that flips `EDITION` from `*-free` to `*-pro` after purchase. Design it the same way as the other host seams (available/degrade); do NOT build it until positioning is settled. No paywall exists today — only the seam.

## per-platform codec / capture locking (reference)

`kit/capabilities.js` is the home. The engine-identity + capture-path decisions already live there (`capturePath`: WebKit → `gl`, else `2d`; `firefoxTextureCapped`). Native adds: iOS WebKit is the only ProRes decoder; WebCodecs `VideoEncoder` needs iOS 16.4+; HEVC >4K encode is Apple-Silicon-only. As native codec paths land, lock them per `engineId`/`edition` here rather than sniffing inline. (BACKLOG: "Native iOS/iPadOS/macOS app capability inventory".)

## remaining native work (specced for co-implementation on device)

Built and verified-by-compile where possible; runtime needs Daniel's device. Each rides its `host.*` seam.

- **HDMI out (`host.externalDisplay`)** — his top broadcast priority. A Capacitor Swift plugin watches `UIScreen.didConnectNotification`/`didDisconnect`, creates a second `UIWindow` on the external screen hosting a `WKWebView` that loads `output.html` (the existing chrome-free program view), and reports connect/disconnect to JS. The output bus already drives `output.html`; only the seam grows. Runtime verify: iPad + USB-C-HDMI + a display.
- **Native camera (`host.nativeCamera`)** — his highest lever. Cheap path is already web (`camera.js` `applyControls` for zoom/torch/focus). The native plugin adds what getUserMedia can't: EV/WB/lens-select + a full-res still on pause (AVCapturePhotoOutput). THE SPIKE: measure the cost of bridging AVFoundation frames INTO WebGL before committing to full native capture (the readback problem in reverse). Runtime verify: a device with a camera.
- **NDI (`host.ndi`)** — broadcast #3. Native-SDK-only (the NDI SDK is a third-party native dependency — NOT yet added; ASK before adding per the deps agreement). A Swift plugin publishes the program output as an NDI source Arena lists. Scaffold the seam + plugin skeleton first; add the SDK when greenlit.
- **AirPlay** — broadcast #2. Try the pure web spike first (`canvas.captureStream()` → `<video>` → `video.webkitShowPlaybackTargetPicker()`); native fallback only if it disqualifies.

## device-verify-pending (built or ready, needs Daniel's hardware)

Things the autonomous run could not verify (no headless browser + no camera in the simulator): camera controls runtime (`camera.js` layer is ready), the mobile camera-settings **gear popover** (consumes the layer), the **record-at-named-resolution** mobile integration (the delicate record path — desktop already records at the output-bus resolution via `output-engine.renderFrameAt`; mobile copies the on-screen canvas, so its offscreen-render integration is the real work and must be verified on device), and the native save actually landing in Files/Photos. The iOS safe-area/tab-bar landscape polish is also device-gated (the simulator can't be rotated headlessly here).
