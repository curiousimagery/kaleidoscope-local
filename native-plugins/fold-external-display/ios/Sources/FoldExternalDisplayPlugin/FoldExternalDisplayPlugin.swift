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
public class FoldExternalDisplayPlugin: CAPPlugin, CAPBridgedPlugin, WKScriptMessageHandler, WKUIDelegate {
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
            // Prefer the window scene the system created for this screen (scene-
            // based apps); fall back to the classic screen assignment otherwise.
            if let scene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.screen == screen }) {
                window.windowScene = scene
            } else {
                window.screen = screen
            }

            let webView = WKWebView(frame: window.bounds, configuration: config)
            webView.uiDelegate = self          // grant getUserMedia (the camera-source path)
            webView.isOpaque = false
            webView.backgroundColor = .black
            webView.scrollView.isScrollEnabled = false
            let vc = UIViewController()
            vc.view = webView
            window.rootViewController = vc
            window.isHidden = false

            webView.load(URLRequest(url: URL(string: "fold-ext://localhost/output.html")!))

            self.externalWindow = window
            self.externalWebView = webView
            call.resolve(self.statusData())
        }
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
