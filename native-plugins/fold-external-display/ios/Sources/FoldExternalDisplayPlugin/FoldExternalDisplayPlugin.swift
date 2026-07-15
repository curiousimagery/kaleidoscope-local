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
    let root: URL
    init(root: URL) { self.root = root }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
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
    ]

    private var externalWindow: UIWindow?
    private var externalWebView: WKWebView?
    private var observers: [Any] = []
    private var attachPath: String?   // "scene" | "classic" — which window attachment presented

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

    private func statusData() -> [String: Any] {
        var data: [String: Any] = ["connected": false, "presenting": externalWindow != nil]
        if let s = externalScreen() {
            data["connected"] = true
            data["width"] = Int(s.bounds.width * s.scale)
            data["height"] = Int(s.bounds.height * s.scale)
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
        config.setURLSchemeHandler(ExternalAssetHandler(root: root), forURLScheme: "fold-ext")
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "foldExternal")

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
    // pressure (a 4K render surface next to the main app + camera). Without
    // this the external screen goes permanently dark — reload the view and
    // report; the poster re-posts the source on the fresh view's 'hello'.
    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        notifyListeners("externalMessage", data: ["type": "crashed"])
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
