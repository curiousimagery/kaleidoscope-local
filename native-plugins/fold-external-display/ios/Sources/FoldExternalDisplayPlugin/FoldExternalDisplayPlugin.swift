// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// FoldExternalDisplayPlugin — presents the chrome-free output view (output.html)
// on a connected external screen (HDMI / USB-C / AirPlay display) and bridges
// the committed program state-stream into it.
//
// Architecture (the arc plan's Lane 3 answer): a SECOND WKWebView on the external
// screen renders the program from STATE, not from captured frames — zero readback,
// zero per-frame pixel transfer. BroadcastChannel does not cross WKWebViews, so
// the transport is this plugin: the main webview calls postState(json) per frame
// (a ~1KB param snapshot — the committed program frame) and we evaluateJavaScript
// it into the external view's window.__foldExternal hook. Messages travel UP
// (hello / fps) via a WKScriptMessageHandler and surface as plugin events.
//
// The external view loads the SAME bundled web assets the main webview serves.
// It can't use capacitor://localhost (the bridge's scheme handler belongs to the
// main webview's configuration) and file:// breaks ES modules (null origin), so a
// tiny scheme handler serves Bundle/public at fold-ext://localhost — a real
// origin, modules load normally.

import Foundation
import Capacitor
import UIKit
import WebKit

// Serves the app's bundled web assets (the public/ folder cap sync copies in) to
// the external webview under the fold-ext:// scheme.
class ExternalAssetHandler: NSObject, WKURLSchemeHandler {
    let root: URL       // the bundled public/ web assets
    let staged: URL     // a writable cache dir for STAGED media (video sources) — served /staged/*
    init(root: URL, staged: URL) { self.root = root; self.staged = staged }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        // STAGED media (a video source cached for the external view) — served with HTTP RANGE
        // support, which WKWebView's <video> element REQUIRES for a custom scheme (a 200 full-file
        // response makes AVFoundation refuse to play). Bundle assets keep their simple path below.
        if path.hasPrefix("/staged/") {
            let name = String(path.dropFirst("/staged/".count))
            serveWithRange(staged.appendingPathComponent(name), task: urlSchemeTask, url: url)
            return
        }
        let fileURL = root.appendingPathComponent(String(path.dropFirst()))
        guard let data = try? Data(contentsOf: fileURL) else {
            urlSchemeTask.didFailWithError(NSError(domain: "fold-ext", code: 404,
                userInfo: [NSLocalizedDescriptionKey: "not found: \(path)"]))
            return
        }
        let resp = URLResponse(url: url, mimeType: Self.mime(for: fileURL.pathExtension),
                               expectedContentLength: data.count, textEncodingName: "utf-8")
        urlSchemeTask.didReceive(resp)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    // Serve a staged file, honoring a `Range: bytes=start-end` request with a 206 response (206 +
    // Content-Range + Accept-Ranges), else a 200 with Accept-Ranges advertised.
    private func serveWithRange(_ fileURL: URL, task: WKURLSchemeTask, url: URL) {
        guard let size = (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size]) as? Int,
              let handle = try? FileHandle(forReadingFrom: fileURL) else {
            task.didFailWithError(NSError(domain: "fold-ext", code: 404,
                userInfo: [NSLocalizedDescriptionKey: "staged not found"]))
            return
        }
        defer { try? handle.close() }
        var status = 200, start = 0, end = max(0, size - 1)
        var headers = ["Content-Type": Self.mime(for: fileURL.pathExtension), "Accept-Ranges": "bytes"]
        if let rh = task.request.value(forHTTPHeaderField: "Range"), let r = Self.parseRange(rh, size: size) {
            status = 206; start = r.0; end = r.1
            headers["Content-Range"] = "bytes \(start)-\(end)/\(size)"
        }
        // SAFETY for large staged clips: never read more than one chunk into memory per response. An
        // open-ended range (`bytes=0-`) on a multi-hundred-MB clip would otherwise load the whole file
        // and jetsam the process. Cap the span + force 206; the <video> range-requests the remainder.
        let maxChunk = 8 * 1024 * 1024
        if end - start + 1 > maxChunk {
            end = start + maxChunk - 1
            status = 206
            headers["Content-Range"] = "bytes \(start)-\(end)/\(size)"
        }
        let length = end - start + 1
        headers["Content-Length"] = "\(length)"
        handle.seek(toFileOffset: UInt64(start))
        let data = handle.readData(ofLength: length)
        guard let resp = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(NSError(domain: "fold-ext", code: 500, userInfo: nil)); return
        }
        task.didReceive(resp)
        task.didReceive(data)
        task.didFinish()
    }

    // "bytes=START-END" → (start, end) clamped to the file; END optional. nil if malformed/unsatisfiable.
    static func parseRange(_ header: String, size: Int) -> (Int, Int)? {
        guard header.hasPrefix("bytes="), size > 0 else { return nil }
        let parts = header.dropFirst("bytes=".count).split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        guard let s = parts.first, let start = Int(s), start < size else { return nil }
        var end = size - 1
        if parts.count > 1, !parts[1].isEmpty, let e = Int(parts[1]) { end = min(e, size - 1) }
        return start <= end ? (start, end) : nil
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    static func mime(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html"
        case "js", "mjs": return "text/javascript"
        case "css": return "text/css"
        case "json": return "application/json"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        case "ico": return "image/x-icon"
        case "webmanifest": return "application/manifest+json"
        case "wasm": return "application/wasm"
        case "mp4", "m4v": return "video/mp4"
        case "mov": return "video/quicktime"
        case "webm": return "video/webm"
        default: return "application/octet-stream"
        }
    }
}

@objc(FoldExternalDisplayPlugin)
public class FoldExternalDisplayPlugin: CAPPlugin, CAPBridgedPlugin, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {
    public let identifier = "FoldExternalDisplayPlugin"
    public let jsName = "FoldExternalDisplay"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "postState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appendVideo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearStaged", returnType: CAPPluginReturnPromise),
    ]

    private var externalWindow: UIWindow?
    private var externalWebView: WKWebView?
    private var observers: [Any] = []
    private var attachPath: String?   // "scene" | "classic" — which window attachment presented
    private var crashTimes: [Date] = []   // recent web-process deaths (the crash-loop breaker)

    override public func load() {
        let nc = NotificationCenter.default
        observers.append(nc.addObserver(forName: UIScreen.didConnectNotification,
                                        object: nil, queue: .main) { [weak self] _ in
            self?.notifyDisplayChange()
        })
        observers.append(nc.addObserver(forName: UIScreen.didDisconnectNotification,
                                        object: nil, queue: .main) { [weak self] _ in
            self?.teardown()   // the window's screen is gone — drop the presentation
            self?.notifyDisplayChange()
        })
    }

    deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }

    // iOS supports ONE external display at a time (both classic mirroring-era and
    // Stage Manager extended); no picker needed on this platform. Note: UIScreen
    // exposes no public product name for the display — JS labels it by resolution.
    private func externalScreen() -> UIScreen? {
        UIScreen.screens.first { $0 != UIScreen.main }
    }

    // External displays (HDMI adapters AND AirPlay) default to a CONSERVATIVE UI mode, not their
    // native pixel resolution — a 4K TV commonly reports 2560×1440 or 1080p via bounds×scale
    // (Daniel: iPad HDMI detected a 4K display as 2560×1440, and the test pattern rendered at that
    // mode). The display's true resolution is the LARGEST available mode. `nativeSize` reports it
    // (so the picker shows real capability on connect); `applyNativeMode` promotes the screen to it
    // before we present, so the window — and the WKWebView that renders the program/test pattern
    // from state — is sized to native pixels. AirPlay already lands on its native mode, so this is a
    // no-op there.
    private func nativeSize(_ s: UIScreen) -> CGSize {
        // PER-DEVICE QUIRK, no clean universal rule yet: `preferredMode` was FHD-correct on the Movink
        // (B476) but UNDER-reports a 4K display as QHD (Daniel, B480) — and under-reporting loses real
        // resolution for stills, which is worse than the Movink's cosmetic over-report. So we're back
        // to LARGEST available mode (gets 4K right; over-reports the Movink to QHD). The universal rule
        // is still open — logDisplayModes now also prints `nativeBounds` (the physical-pixel candidate)
        // for both displays so we can settle it with data.
        return s.availableModes.max { $0.size.width * $0.size.height < $1.size.width * $1.size.height }?.size
            ?? CGSize(width: s.bounds.width * s.scale, height: s.bounds.height * s.scale)
    }
    private func applyNativeMode(_ s: UIScreen) {
        if let best = s.availableModes.max(by: { $0.size.width * $0.size.height < $1.size.width * $1.size.height }),
           s.currentMode != best { s.currentMode = best }
    }

    // DIAGNOSTIC (Daniel's Movink 13: detected QHD but physically FHD — "largest mode" over-reports
    // on that panel, while it UNDER-reported on the earlier 4K adapter via bounds×scale). Log every
    // candidate once on present so we can pick a rule correct for BOTH displays with real data
    // instead of guessing (the NDI-AIMD lesson). Behavior is unchanged — this only prints.
    private func logDisplayModes(_ s: UIScreen) {
        let preferred = s.preferredMode?.size
        let boundsScale = CGSize(width: s.bounds.width * s.scale, height: s.bounds.height * s.scale)
        let nb = s.nativeBounds.size   // physical-pixel candidate — the hoped-for universal rule
        let picked = nativeSize(s)
        let modes = s.availableModes.map { "\(Int($0.size.width))x\(Int($0.size.height))" }.joined(separator: ", ")
        let pref = preferred.map { "\(Int($0.width))x\(Int($0.height))" } ?? "nil"
        print("[FoldExt] display modes — preferred: \(pref) · nativeBounds: \(Int(nb.width))x\(Int(nb.height)) · bounds×scale: \(Int(boundsScale.width))x\(Int(boundsScale.height)) · picked(largest): \(Int(picked.width))x\(Int(picked.height)) · available: [\(modes)]")
    }

    private func statusData() -> [String: Any] {
        var data: [String: Any] = ["connected": false, "presenting": externalWindow != nil]
        if let s = externalScreen() {
            data["connected"] = true
            let px = nativeSize(s)
            data["width"] = Int(px.width)
            data["height"] = Int(px.height)
        }
        if let attach = attachPath { data["attach"] = attach }
        return data
    }

    private func notifyDisplayChange() {
        notifyListeners("displayChanged", data: statusData())
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(self.statusData()) }
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let screen = self.externalScreen() else {
                call.reject("no external display connected")
                return
            }
            if self.externalWindow != nil { call.resolve(self.statusData()); return }
            self.crashTimes = []   // a fresh presentation gets a fresh crash budget
            // WAIT for the system's UIWindowScene for this screen before attaching.
            // The scene arrives slightly AFTER UIScreen.didConnectNotification, so an
            // instant attach (the iPhone's autoconnect) found no scene and fell into
            // the deprecated `window.screen` path — which on a modern iPhone drives
            // the display (backlight on) but composites NOTHING: the black-screen
            // bug from Daniel's first device pass. The iPad only worked because a
            // human pressed start seconds later, when the scene already existed.
            self.attachWhenSceneReady(screen: screen,
                                      deadline: Date().addingTimeInterval(3.0),
                                      call: call)
        }
    }

    private func matchingScene(for screen: UIScreen) -> UIWindowScene? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.screen == screen }
    }

    // Poll for the scene (250ms cadence; notification delivery for scene connects
    // is not guaranteed in AppDelegate compatibility mode, so polling is the
    // reliable path). Past the deadline, fall back to the classic screen
    // assignment and REPORT it — status carries attach: "scene" | "classic" so a
    // console run tells us which path presented.
    private func attachWhenSceneReady(screen: UIScreen, deadline: Date, call: CAPPluginCall) {
        guard UIScreen.screens.contains(screen) else {
            call.reject("external display disconnected while presenting")
            return
        }
        if let scene = matchingScene(for: screen) {
            present(on: screen, scene: scene, call: call)
        } else if Date() > deadline {
            present(on: screen, scene: nil, call: call)
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                self?.attachWhenSceneReady(screen: screen, deadline: deadline, call: call)
            }
        }
    }

    private func present(on screen: UIScreen, scene: UIWindowScene?, call: CAPPluginCall) {
        if externalWindow != nil { call.resolve(statusData()); return }

        // the same dist the main webview serves (App/App/public in the bundle)
        guard let root = Bundle.main.url(forResource: "public", withExtension: nil) else {
            call.reject("bundled web assets not found")
            return
        }

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(ExternalAssetHandler(root: root, staged: Self.stagedDir()), forURLScheme: "fold-ext")
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "foldExternal")

        // TVs (HDMI adapters AND AirPlay screens — this same UIScreen path serves
        // both) often overscan; scale into the safe area so the artwork's edges
        // are never cropped. AirPlay = Control Center → Screen Mirroring: iOS
        // raises the identical didConnect, and presenting a window switches the
        // screen from mirroring to extended content.
        screen.overscanCompensation = .scale
        logDisplayModes(screen)   // one-shot: what each API reports (Movink QHD-vs-FHD diagnosis)
        applyNativeMode(screen)   // promote to native resolution BEFORE sizing the window (Daniel: 4K HDMI read as 1440)

        let window = UIWindow(frame: screen.bounds)
        if let scene = scene {
            window.windowScene = scene
            attachPath = "scene"
        } else {
            window.screen = screen
            attachPath = "classic"
        }

        let webView = WKWebView(frame: window.bounds, configuration: config)
        webView.uiDelegate = self              // grant getUserMedia (the camera-source path)
        webView.navigationDelegate = self      // report load success/failure as events
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        let vc = UIViewController()
        vc.view = webView
        window.rootViewController = vc
        window.isHidden = false

        webView.load(URLRequest(url: URL(string: "fold-ext://localhost/output.html")!))

        externalWindow = window
        externalWebView = webView
        call.resolve(statusData())
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.teardown()
            call.resolve()
        }
    }

    private func teardown() {
        externalWebView?.configuration.userContentController
            .removeScriptMessageHandler(forName: "foldExternal")
        externalWindow?.isHidden = true
        externalWindow = nil
        externalWebView = nil
        attachPath = nil
    }

    // ---- load diagnostics: surfaced as externalMessage events so a device
    // console run shows exactly how far the external view got -------------------
    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        notifyListeners("externalMessage", data: ["type": "loaded", "attach": attachPath ?? "?"])
    }
    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        notifyListeners("externalMessage", data: ["type": "loadError", "error": error.localizedDescription])
    }
    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        notifyListeners("externalMessage", data: ["type": "loadError", "error": error.localizedDescription])
    }
    // The external view's web content process can be killed under memory/GPU
    // pressure (a 4K render surface next to the main app + camera). Reload it —
    // the poster degrades its render size per crash and re-posts the source on
    // the fresh view's 'hello' — but with a BREAKER: Daniel's landscape pass
    // crash-looped 113 times (each reload re-allocated into the same memory
    // wall). Past 3 deaths in a minute, give the memory budget back and tear
    // the window down entirely — iOS falls back to MIRRORING the device, so
    // the projector still shows something. Unplug/replug (or a manual start)
    // resets the budget and tries fresh.
    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        let now = Date()
        crashTimes = crashTimes.filter { now.timeIntervalSince($0) < 60 } + [now]
        if crashTimes.count > 3 {
            notifyListeners("externalMessage", data: ["type": "crashLoop"])
            teardown()
            return
        }
        notifyListeners("externalMessage", data: ["type": "crashed", "count": crashTimes.count])
        webView.load(URLRequest(url: URL(string: "fold-ext://localhost/output.html")!))
    }

    // Per-frame state push: the payload is already a JSON string — a valid JS
    // expression — so it embeds directly. The __foldExternal guard makes calls
    // during page load a silent no-op (the view re-requests via 'hello' once up).
    @objc func postState(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else { call.reject("json required"); return }
        DispatchQueue.main.async {
            self.externalWebView?.evaluateJavaScript(
                "window.__foldExternal && window.__foldExternal(\(json))",
                completionHandler: nil)
            call.resolve()
        }
    }

    // A writable cache dir for staged media (video sources served to the external view). A blob:
    // URL is per-webview, so a loaded video can't cross into the external context — the main view
    // hands us the bytes in chunks (base64) via appendVideo and we serve the assembled file over
    // fold-ext://localhost/staged/*.
    static func stagedDir() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("fold-ext-staged", isDirectory: true)
    }

    // Stage a video source ONE CHUNK at a time. The main view slices the clip and streams the bytes
    // here (base64); we append each slice to a cache file. Chunking keeps PEAK memory at one slice
    // regardless of clip length — the old whole-file base64 held several copies at once and capped at
    // ~60MB (a 3min 1080p clip blew it, Daniel's gauntlet). `first` truncates + drops any stale clip.
    @objc func appendVideo(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let b64 = call.getString("data"),
              let data = Data(base64Encoded: b64) else {
            call.reject("appendVideo: missing/invalid id or data"); return
        }
        let first = call.getBool("first") ?? false
        let dir = Self.stagedDir()
        let fileURL = dir.appendingPathComponent(id)
        do {
            if first {
                try? FileManager.default.removeItem(at: dir)   // drop any previously staged clip
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                try data.write(to: fileURL)                    // create/truncate with the first slice
            } else {
                let handle = try FileHandle(forWritingTo: fileURL)
                defer { try? handle.close() }
                handle.seekToEndOfFile()
                handle.write(data)                             // append this slice's raw bytes
            }
            call.resolve(["url": "fold-ext://localhost/staged/\(id)"])
        } catch {
            call.reject("appendVideo: write failed \(error.localizedDescription)")
        }
    }

    @objc func clearStaged(_ call: CAPPluginCall) {
        try? FileManager.default.removeItem(at: Self.stagedDir())
        call.resolve()
    }

    // Messages UP from the external view (hello / fps) → a plugin event.
    public func userContentController(_ userContentController: WKUserContentController,
                                      didReceive message: WKScriptMessage) {
        if let body = message.body as? [String: Any] {
            notifyListeners("externalMessage", data: body)
        }
    }

    // The external view is our own bundled content and the app already holds the
    // camera permission — grant its capture request (a live-camera source opens a
    // second capture there). Without this the permission prompt would try to
    // present on a screen that can't take input.
    @available(iOS 15.0, *)
    public func webView(_ webView: WKWebView,
                        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                        initiatedByFrame frame: WKFrameInfo,
                        type: WKMediaCaptureType,
                        decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)
    }
}
