// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// FoldNativeCameraPlugin.swift
//
// Tier-2 frame-bridge SPIKE. Native AVCaptureSession (we OWN the camera), streams
// biplanar YUV to the webview over a localhost WebSocket, and exposes native-only
// controls (EV, zoom, white balance). Supports selecting a specific physical lens
// vs the auto-switching virtual device — the fork that decides whether custom
// (Kelvin) white balance and per-lens 48MP capture are available (a single sensor
// allows sensor-absolute controls; the composite virtual device does not). Also
// reports each device's still-photo resolution ceiling. Tap-to-focus and actual
// high-res still capture are the next increments.

import Foundation
import AVFoundation
import CoreMedia
import Photos
import Capacitor

@objc(FoldNativeCameraPlugin)
public class FoldNativeCameraPlugin: CAPPlugin, CAPBridgedPlugin, AVCaptureVideoDataOutputSampleBufferDelegate {
    public let identifier = "FoldNativeCameraPlugin"
    public let jsName = "FoldNativeCamera"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setExposureBias", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setZoom", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setWhiteBalance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getWhiteBalance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "capturePhoto", returnType: CAPPluginReturnPromise)
    ]

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "fold.camera.session")
    private let videoQueue = DispatchQueue(label: "fold.camera.video")
    private let output = AVCaptureVideoDataOutput()
    private let server = FrameSocketServer(port: 8899)
    private let photoOutput = AVCapturePhotoOutput()
    private var running = false
    private var device: AVCaptureDevice?
    private var capturing = false   // true during a still capture — drops preview frames so
                                    // the brief switch to the heavy photo format streams nothing
    private var captureDelegates = Set<PhotoCaptureDelegate>()   // retained until each capture completes
    // orientation: RotationCoordinator (iOS 17+) publishes the correct capture angle
    // for the current device orientation + sensor; Any? because the type is 17-only.
    private var rotationCoordinator: Any?
    private var rotationObservation: NSKeyValueObservation?

    // `lens`: "auto" = best virtual multi-lens device (seamless zoom, no custom WB);
    // "ultraWide"/"wide"/"tele" = a single physical lens (full manual control).
    private func pickCamera(_ lens: String, _ facing: String) -> AVCaptureDevice? {
        if facing == "front" {
            // front is a single sensor — no lens choice (TrueDepth is the fallback name)
            return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
                ?? AVCaptureDevice.default(.builtInTrueDepthCamera, for: .video, position: .front)
        }
        switch lens {
        case "ultraWide": return AVCaptureDevice.default(.builtInUltraWideCamera, for: .video, position: .back)
        case "wide": return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
        case "tele": return AVCaptureDevice.default(.builtInTelephotoCamera, for: .video, position: .back)
        default:
            let types: [AVCaptureDevice.DeviceType] = [
                .builtInTripleCamera, .builtInDualWideCamera, .builtInDualCamera, .builtInWideAngleCamera
            ]
            for t in types {
                if let d = AVCaptureDevice.default(t, for: .video, position: .back) { return d }
            }
            return AVCaptureDevice.default(for: .video)
        }
    }

    // The physical lenses present, each with its UI zoom multiple relative to the 1x
    // wide — the labels the picker shows (0.5x / 1x / 3x, per device). The multiples
    // come from the virtual multi-cam device's switch-over factors (Apple's sanctioned
    // source): its widest constituent is base zoomFactor 1.0, and each later
    // constituent's lower bound is the preceding switch-over factor, so a lens's
    // multiple = its lower-bound zoomFactor / the wide lens's lower-bound zoomFactor.
    private func lensCatalog(_ facing: String) -> [[String: Any]] {
        let position: AVCaptureDevice.Position = facing == "front" ? .front : .back
        let ds = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInUltraWideCamera, .builtInWideAngleCamera, .builtInTelephotoCamera],
            mediaType: .video, position: position)
        let present = Set(ds.devices.map { $0.deviceType })

        var lowerBound: [AVCaptureDevice.DeviceType: Double] = [:]
        var wideZoom = 1.0
        let virtualTypes: [AVCaptureDevice.DeviceType] = [.builtInTripleCamera, .builtInDualWideCamera, .builtInDualCamera]
        if let virt = virtualTypes.compactMap({ AVCaptureDevice.default($0, for: .video, position: position) }).first {
            let switches = virt.virtualDeviceSwitchOverVideoZoomFactors.map { $0.doubleValue }
            for (i, c) in virt.constituentDevices.enumerated() {
                lowerBound[c.deviceType] = i == 0 ? 1.0 : (i - 1 < switches.count ? switches[i - 1] : 1.0)
            }
            if let w = lowerBound[.builtInWideAngleCamera], w > 0 { wideZoom = w }
        }

        // U+00D7 MULTIPLICATION SIGN — safe end-to-end: Swift source is UTF-8, the
        // Capacitor bridge serializes to UTF-8 JSON, and the DOM sets it via textContent.
        // (It's display-only — never a filename/identifier — so no ASCII-context risk.)
        func label(_ type: AVCaptureDevice.DeviceType, _ fallback: String) -> String {
            guard let lb = lowerBound[type], wideZoom > 0 else { return fallback }
            let mult = lb / wideZoom
            if abs(mult - mult.rounded()) < 0.05 { return "\(Int(mult.rounded()))×" }
            return String(format: "%.1f×", mult)
        }

        var out: [[String: Any]] = []
        if present.contains(.builtInUltraWideCamera) { out.append(["id": "ultraWide", "label": label(.builtInUltraWideCamera, "0.5×")]) }
        if present.contains(.builtInWideAngleCamera) { out.append(["id": "wide", "label": label(.builtInWideAngleCamera, "1×")]) }
        if present.contains(.builtInTelephotoCamera) { out.append(["id": "tele", "label": label(.builtInTelephotoCamera, "2×")]) }
        return out
    }

    // Which of our named resolutions the CURRENT lens actually offers (a physical
    // tele may not do 4K, so the picker changes per lens — Daniel's ask), each with
    // its max frame rate so the UI can gate the fps options.
    private func resolutionCatalog(_ device: AVCaptureDevice) -> [[String: Any]] {
        // VIDEO resolutions only — never below 1080p (Daniel's rule); QHD self-hides
        // on devices that don't offer a 1440p format (most iPhones don't).
        let targets: [(id: String, label: String, w: Int, h: Int)] = [
            ("hd1080", "1080p", 1920, 1080),
            ("qhd", "QHD", 2560, 1440),
            ("uhd", "4K", 3840, 2160)
        ]
        var out: [[String: Any]] = []
        for t in targets {
            let matches = device.formats.filter {
                let d = CMVideoFormatDescriptionGetDimensions($0.formatDescription)
                return Int(d.width) == t.w && Int(d.height) == t.h
            }
            guard !matches.isEmpty else { continue }
            let maxFps = matches.flatMap { $0.videoSupportedFrameRateRanges }.map { $0.maxFrameRate }.max() ?? 0
            out.append(["id": t.id, "label": t.label, "maxFps": maxFps, "width": t.w, "height": t.h])
        }
        return out
    }

    // The format that reaches the sensor's MAX still dimensions (e.g. 48MP). We stream a
    // light video format for the preview and switch to THIS only at capture time, so the
    // menu can advertise the real still sizes without a heavy preview. Among formats that
    // tie for the max photo size, prefer the smallest video dims (cheapest to switch to).
    @available(iOS 16.0, *)
    private func bestPhotoFormat(_ device: AVCaptureDevice) -> AVCaptureDevice.Format? {
        let area: (CMVideoDimensions) -> Int = { Int($0.width) * Int($0.height) }
        let sensorMaxPhoto = device.formats.compactMap { $0.supportedMaxPhotoDimensions.map(area).max() }.max() ?? 0
        guard sensorMaxPhoto > 0 else { return nil }
        let cands = device.formats.filter { ($0.supportedMaxPhotoDimensions.map(area).max() ?? 0) == sensorMaxPhoto }
        return cands.min(by: {
            area(CMVideoFormatDescriptionGetDimensions($0.formatDescription)) < area(CMVideoFormatDescriptionGetDimensions($1.formatDescription))
        })
    }

    // The STILL capture sizes reported to the menu — read from the full PHOTO format
    // (12MP + 48MP on the main lens), NOT the light preview format (which caps stills
    // low). Capture switches to that format, so these sizes are all reachable.
    private func stillResolutionCatalog(_ device: AVCaptureDevice) -> [[String: Any]] {
        guard #available(iOS 16.0, *) else { return [] }
        let area: (CMVideoDimensions) -> Int = { Int($0.width) * Int($0.height) }
        let fmt = bestPhotoFormat(device) ?? device.activeFormat
        let dims = fmt.supportedMaxPhotoDimensions.sorted { area($0) < area($1) }
        return dims.map { d in
            let mp = Double(area(d)) / 1_000_000.0
            let label = mp >= 1 ? "\(Int(mp.rounded()))MP" : String(format: "%.1fMP", mp)
            return ["id": "\(d.width)x\(d.height)", "label": label, "width": Int(d.width), "height": Int(d.height)]
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        let preset = call.getString("preset") ?? "hd1080"
        let fps = call.getDouble("fps") ?? 30
        let lens = call.getString("lens") ?? "auto"
        let stillMode = call.getBool("stillMode") ?? true
        let facing = call.getString("facing") ?? "back"
        AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
            guard let self = self else { return }
            guard granted else { call.reject("camera not authorized"); return }
            self.sessionQueue.async {
                if self.running {
                    self.session.stopRunning()
                    self.server.stop()
                    self.running = false
                }
                let info: SessionInfo
                do {
                    info = try self.configureSession(presetName: preset, targetFps: fps, lens: lens, stillMode: stillMode, facing: facing)
                } catch {
                    call.reject("configure failed: \(error.localizedDescription)")
                    return
                }
                self.server.start()
                self.session.startRunning()
                self.running = true
                call.resolve([
                    "port": self.server.port,
                    "width": info.width,
                    "height": info.height,
                    "requestedFps": info.requestedFps,
                    "cameraMaxFps": info.cameraMaxFps,
                    "lenses": self.lensCatalog(facing),
                    "resolutions": self.device.map { self.resolutionCatalog($0) } ?? [],
                    "stillResolutions": self.device.map { self.stillResolutionCatalog($0) } ?? [],
                    "controls": self.controlRanges(),
                    "running": true
                ])
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        sessionQueue.async { [weak self] in
            guard let self = self else { return }
            self.rotationObservation?.invalidate()
            self.rotationObservation = nil
            self.rotationCoordinator = nil
            if self.running {
                self.session.stopRunning()
                self.server.stop()
                self.running = false
            }
            call.resolve()
        }
    }

    // MARK: - controls (native-only; each applies to the live session immediately)

    @objc func setExposureBias(_ call: CAPPluginCall) {
        guard let value = call.getDouble("value") else { call.reject("value required"); return }
        sessionQueue.async { [weak self] in
            guard let self = self, let device = self.device else { call.reject("no device"); return }
            do {
                try device.lockForConfiguration()
                let clamped = max(device.minExposureTargetBias, min(device.maxExposureTargetBias, Float(value)))
                device.setExposureTargetBias(clamped, completionHandler: nil)
                device.unlockForConfiguration()
                call.resolve(["value": Double(clamped)])
            } catch { call.reject("ev failed: \(error.localizedDescription)") }
        }
    }

    @objc func setZoom(_ call: CAPPluginCall) {
        guard let factor = call.getDouble("factor") else { call.reject("factor required"); return }
        sessionQueue.async { [weak self] in
            guard let self = self, let device = self.device else { call.reject("no device"); return }
            do {
                try device.lockForConfiguration()
                let clamped = max(device.minAvailableVideoZoomFactor,
                                  min(device.maxAvailableVideoZoomFactor, CGFloat(factor)))
                device.videoZoomFactor = clamped
                device.unlockForConfiguration()
                call.resolve(["factor": Double(clamped)])
            } catch { call.reject("zoom failed: \(error.localizedDescription)") }
        }
    }

    @objc func setWhiteBalance(_ call: CAPPluginCall) {
        let mode = call.getString("mode")
        let temperature = call.getDouble("temperature")
        sessionQueue.async { [weak self] in
            guard let self = self, let device = self.device else { call.reject("no device"); return }
            do {
                try device.lockForConfiguration()
                if mode == "auto" {
                    if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) {
                        device.whiteBalanceMode = .continuousAutoWhiteBalance
                    }
                } else if mode == "lock" {
                    if device.isWhiteBalanceModeSupported(.locked) {
                        device.whiteBalanceMode = .locked
                    }
                } else if let temp = temperature, device.isLockingWhiteBalanceWithCustomDeviceGainsSupported {
                    // MUST be gated on the custom-gains capability, or AVFoundation
                    // throws an NSException (uncatchable in Swift) that crashes the app
                    let tnt = AVCaptureDevice.WhiteBalanceTemperatureAndTintValues(temperature: Float(temp), tint: 0)
                    var gains = device.deviceWhiteBalanceGains(for: tnt)
                    let maxG = device.maxWhiteBalanceGain
                    gains.redGain = max(1.0, min(maxG, gains.redGain))
                    gains.greenGain = max(1.0, min(maxG, gains.greenGain))
                    gains.blueGain = max(1.0, min(maxG, gains.blueGain))
                    device.setWhiteBalanceModeLocked(with: gains, completionHandler: nil)
                }
                device.unlockForConfiguration()
                call.resolve()
            } catch { call.reject("wb failed: \(error.localizedDescription)") }
        }
    }

    // Read the CURRENT white balance temperature — the value auto WB has settled on —
    // so the UI can show one always-visible slider that tracks auto and drops to manual
    // on a drag (instead of a crude auto/manual toggle). Gains are clamped before the
    // conversion (they drift past maxWhiteBalanceGain transiently, which would throw).
    @objc func getWhiteBalance(_ call: CAPPluginCall) {
        sessionQueue.async { [weak self] in
            guard let self = self, let device = self.device else { call.reject("no device"); return }
            var g = device.deviceWhiteBalanceGains
            let maxG = device.maxWhiteBalanceGain
            g.redGain = min(max(1.0, g.redGain), maxG)
            g.greenGain = min(max(1.0, g.greenGain), maxG)
            g.blueGain = min(max(1.0, g.blueGain), maxG)
            let tnt = device.temperatureAndTintValues(for: g)
            let mode = device.whiteBalanceMode == .locked ? "locked" : "auto"
            call.resolve(["temperature": Double(tnt.temperature), "tint": Double(tnt.tint), "mode": mode])
        }
    }

    // Full-resolution still with the live EV/WB/zoom baked in. The preview streams a
    // LIGHT video format; here we switch the active format to the full photo format
    // (up to 48MP) JUST for the capture, dropping preview frames meanwhile so the heavy
    // format streams nothing. The shell stops the session right after, so there's no
    // switch-back (the next go-live starts fresh on the light format).
    @objc func capturePhoto(_ call: CAPPluginCall) {
        let reqW = call.getInt("width") ?? 0
        let reqH = call.getInt("height") ?? 0
        sessionQueue.async { [weak self] in
            guard let self = self, self.running, let device = self.device else { call.reject("camera not running"); return }
            self.capturing = true   // drop preview frames during the switch + capture
            var didSwitch = false

            // switch to the full photo format so the still reaches the sensor's max
            if #available(iOS 16.0, *), let photoFmt = self.bestPhotoFormat(device), device.activeFormat != photoFmt {
                didSwitch = true
                // a format change resets the device to auto EV/WB — snapshot the user's
                // current exposure bias + (locked) WB gains and re-apply them after, so
                // the captured still carries the same look as the preview.
                let savedBias = device.exposureTargetBias
                let wbWasLocked = device.whiteBalanceMode == .locked
                let savedGains = device.deviceWhiteBalanceGains

                self.session.beginConfiguration()
                do { try device.lockForConfiguration(); device.activeFormat = photoFmt; device.unlockForConfiguration() }
                catch { /* keep the current format on lock failure */ }
                let area: (CMVideoDimensions) -> Int = { Int($0.width) * Int($0.height) }
                if let maxDim = photoFmt.supportedMaxPhotoDimensions.max(by: { area($0) < area($1) }) {
                    self.photoOutput.maxPhotoDimensions = maxDim
                }
                self.session.commitConfiguration()

                // re-apply EV/WB on the new format
                do {
                    try device.lockForConfiguration()
                    device.setExposureTargetBias(max(device.minExposureTargetBias, min(device.maxExposureTargetBias, savedBias)), completionHandler: nil)
                    if wbWasLocked, device.isLockingWhiteBalanceWithCustomDeviceGainsSupported {
                        let maxG = device.maxWhiteBalanceGain
                        var g = savedGains
                        g.redGain = max(1.0, min(maxG, g.redGain))
                        g.greenGain = max(1.0, min(maxG, g.greenGain))
                        g.blueGain = max(1.0, min(maxG, g.blueGain))
                        device.setWhiteBalanceModeLocked(with: g, completionHandler: nil)
                    }
                    device.unlockForConfiguration()
                } catch { /* leave auto on lock failure */ }

                // a format change can reset the connection rotation — re-apply it
                if #available(iOS 17.0, *), let coord = self.rotationCoordinator as? AVCaptureDevice.RotationCoordinator {
                    self.applyRotation(coord.videoRotationAngleForHorizonLevelCapture)
                }
            }

            // fire the capture — after a short settle when we switched formats, so the
            // re-applied EV/WB (and the new format) take effect before the shot.
            let fire: () -> Void = { [weak self] in
                guard let self = self else { return }
                // JPEG so the returned file loads cleanly into a webview <img> / canvas
                // (HEIC decode in WKWebGL is unproven); fall back to the default codec.
                let settings: AVCapturePhotoSettings
                if self.photoOutput.availablePhotoCodecTypes.contains(.jpeg) {
                    settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
                } else {
                    settings = AVCapturePhotoSettings()
                }
                if #available(iOS 16.0, *) {
                    // per-shot dimensions (the chosen 12/48MP), clamped to the output's max
                    if reqW > 0, reqH > 0 {
                        settings.maxPhotoDimensions = CMVideoDimensions(width: Int32(reqW), height: Int32(reqH))
                    } else {
                        settings.maxPhotoDimensions = self.photoOutput.maxPhotoDimensions
                    }
                }
                let delegate = PhotoCaptureDelegate(call: call) { [weak self] done in
                    self?.sessionQueue.async { self?.captureDelegates.remove(done) }
                }
                self.captureDelegates.insert(delegate)
                self.photoOutput.capturePhoto(with: settings, delegate: delegate)
            }
            if didSwitch { self.sessionQueue.asyncAfter(deadline: .now() + 0.18, execute: fire) }
            else { fire() }
        }
    }

    private func controlRanges() -> [String: Any] {
        guard let device = self.device else { return [:] }
        let lensFactors = device.virtualDeviceSwitchOverVideoZoomFactors.map { $0.doubleValue }
        let wideCustomWB = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)?
            .isLockingWhiteBalanceWithCustomDeviceGainsSupported ?? false
        return [
            "exposureBias": ["min": Double(device.minExposureTargetBias),
                             "max": Double(device.maxExposureTargetBias)],
            "zoom": ["min": Double(device.minAvailableVideoZoomFactor),
                     "max": Double(device.maxAvailableVideoZoomFactor),
                     "lensFactors": lensFactors],
            "whiteBalance": ["lockSupported": device.isWhiteBalanceModeSupported(.locked),
                             "customGainsSupported": device.isLockingWhiteBalanceWithCustomDeviceGainsSupported,
                             "customGainsSupportedWideLens": wideCustomWB,
                             // AVFoundation exposes no Kelvin min/max; use a span WIDER
                             // than auto's excursions (it settles below 2500 in warm
                             // light — measured 2331 on the 14 Pro) so the manual slider
                             // covers what auto shows. Gains are clamped in setWhiteBalance.
                             "temperatureMin": 2000, "temperatureMax": 9000],
            "photo": photoInfo(device)
        ]
    }

    // Still-photo resolution ceiling for this device/lens (read from the formats;
    // no photo output needed just to report it). `sensorMax` = the biggest the
    // sensor offers across formats; `activeMax` = what the current streaming format
    // allows. Actual capture is a later increment.
    private func photoInfo(_ device: AVCaptureDevice) -> [String: Int] {
        if #available(iOS 16.0, *) {
            let area: (CMVideoDimensions) -> Int = { Int($0.width) * Int($0.height) }
            let sensorMax = device.formats.flatMap { $0.supportedMaxPhotoDimensions }.max(by: { area($0) < area($1) })
            let activeMax = device.activeFormat.supportedMaxPhotoDimensions.max(by: { area($0) < area($1) })
            return [
                "sensorMaxW": Int(sensorMax?.width ?? 0), "sensorMaxH": Int(sensorMax?.height ?? 0),
                "activeMaxW": Int(activeMax?.width ?? 0), "activeMaxH": Int(activeMax?.height ?? 0)
            ]
        }
        return ["sensorMaxW": 0, "sensorMaxH": 0, "activeMaxW": 0, "activeMaxH": 0]
    }

    // MARK: - session config

    private struct SessionInfo {
        let width: Int
        let height: Int
        let requestedFps: Double
        let cameraMaxFps: Double
    }

    private func configureSession(presetName: String, targetFps: Double, lens: String, stillMode: Bool, facing: String) throws -> SessionInfo {
        var target: (w: Int, h: Int)
        switch presetName {
        case "hd720": target = (1280, 720)
        case "hd1080": target = (1920, 1080)
        case "qhd": target = (2560, 1440)
        case "uhd": target = (3840, 2160)
        default: target = (1920, 1080)
        }

        guard let device = pickCamera(lens, facing) else {
            throw NSError(domain: "fold", code: 1, userInfo: [NSLocalizedDescriptionKey: "no camera device"])
        }
        self.device = device
        self.capturing = false   // fresh session on the light preview format

        let area: (CMVideoDimensions) -> Int = { Int($0.width) * Int($0.height) }
        var chosen: AVCaptureDevice.Format?
        var chosenMax = 0.0

        // STILL MODE: preview at the SAME field of view (aspect) as the still capture, so
        // switching to the photo format on capture doesn't shift the composition. A LIGHT
        // format matching the photo aspect (usually 4:3), not the 16:9 video target.
        if stillMode, #available(iOS 16.0, *), let photoFmt = bestPhotoFormat(device) {
            let pd = CMVideoFormatDescriptionGetDimensions(photoFmt.formatDescription)
            let photoAspect = Double(pd.width) / Double(max(1, Int(pd.height)))
            let cands = device.formats.filter {
                let d = CMVideoFormatDescriptionGetDimensions($0.formatDescription)
                let a = Double(d.width) / Double(max(1, Int(d.height)))
                return abs(a - photoAspect) < 0.03 && Int(d.height) >= 720 && Int(d.height) <= 1440
            }
            if let c = cands.min(by: { area(CMVideoFormatDescriptionGetDimensions($0.formatDescription)) < area(CMVideoFormatDescriptionGetDimensions($1.formatDescription)) }) {
                chosen = c
                let d = CMVideoFormatDescriptionGetDimensions(c.formatDescription)
                target = (Int(d.width), Int(d.height))
                chosenMax = c.videoSupportedFrameRateRanges.map { $0.maxFrameRate }.max() ?? 30
            }
        }

        let matches = device.formats.filter {
            let d = CMVideoFormatDescriptionGetDimensions($0.formatDescription)
            return Int(d.width) == target.w && Int(d.height) == target.h
        }
        let cameraMaxFps = matches
            .flatMap { $0.videoSupportedFrameRateRanges }
            .map { $0.maxFrameRate }
            .max() ?? chosenMax

        // fps-based pick among the target-dimension formats (video mode, or the still
        // fallback if no aspect-matching light format was found above)
        if chosen == nil {
            for f in matches {
                let m = f.videoSupportedFrameRateRanges.map { $0.maxFrameRate }.max() ?? 0
                if targetFps <= 0 {
                    if m > chosenMax { chosenMax = m; chosen = f }
                } else if m >= targetFps {
                    if chosen == nil || m < chosenMax { chosenMax = m; chosen = f }
                }
            }
            if chosen == nil {
                for f in matches {
                    let m = f.videoSupportedFrameRateRanges.map { $0.maxFrameRate }.max() ?? 0
                    if m > chosenMax { chosenMax = m; chosen = f }
                }
            }
        }

        session.beginConfiguration()

        for input in session.inputs { session.removeInput(input) }
        for out in session.outputs { session.removeOutput(out) }

        let input = try AVCaptureDeviceInput(device: device)
        if session.canAddInput(input) { session.addInput(input) }

        output.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
        ]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: videoQueue)
        if session.canAddOutput(output) { session.addOutput(output) }

        if session.canAddOutput(photoOutput) { session.addOutput(photoOutput) }

        // ORIENTATION: keep the delivered frame (and the still) horizon-level in every
        // device rotation. iOS 17's RotationCoordinator computes the correct capture
        // angle for the current device orientation AND sensor (front included, so it
        // also fixes the front 90°-off-in-portrait case) and updates as the device
        // turns — no manual per-orientation math. Pre-17 falls back to fixed portrait.
        if #available(iOS 17.0, *) {
            setupRotationCoordinator(device)
        } else {
            for conn in [output.connection(with: .video), photoOutput.connection(with: .video)] {
                if let c = conn, c.isVideoOrientationSupported { c.videoOrientation = .portrait }
            }
        }

        var requestedFps = targetFps
        if let fmt = chosen {
            do {
                try device.lockForConfiguration()
                device.activeFormat = fmt
                let useFps = (targetFps <= 0) ? chosenMax : min(targetFps, chosenMax)
                requestedFps = useFps
                let dur = CMTimeMake(value: 1, timescale: Int32(max(1.0, useFps.rounded())))
                device.activeVideoMinFrameDuration = dur
                device.activeVideoMaxFrameDuration = dur
                device.unlockForConfiguration()
            } catch {
                // keep the format's default frame duration on lock failure
            }
        } else {
            let preset: AVCaptureSession.Preset = presetName == "hd720" ? .hd1280x720
                : presetName == "uhd" ? .hd4K3840x2160 : .hd1920x1080
            if session.canSetSessionPreset(preset) { session.sessionPreset = preset }
        }

        // enable full-resolution still capture for this format/lens (up to 48MP)
        if #available(iOS 16.0, *) {
            let area: (CMVideoDimensions) -> Int = { Int($0.width) * Int($0.height) }
            if let maxDim = device.activeFormat.supportedMaxPhotoDimensions.max(by: { area($0) < area($1) }) {
                photoOutput.maxPhotoDimensions = maxDim
            }
        }

        session.commitConfiguration()
        return SessionInfo(width: target.w, height: target.h,
                           requestedFps: requestedFps, cameraMaxFps: cameraMaxFps)
    }

    // MARK: - orientation (iOS 17 RotationCoordinator)

    @available(iOS 17.0, *)
    private func setupRotationCoordinator(_ device: AVCaptureDevice) {
        rotationObservation?.invalidate()
        let coord = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: nil)
        rotationCoordinator = coord
        applyRotation(coord.videoRotationAngleForHorizonLevelCapture)
        // update as the device turns (the coordinator observes device orientation)
        rotationObservation = coord.observe(\.videoRotationAngleForHorizonLevelCapture, options: [.new]) { [weak self] c, _ in
            let angle = c.videoRotationAngleForHorizonLevelCapture
            self?.sessionQueue.async { self?.applyRotation(angle) }
        }
    }

    private func applyRotation(_ angle: CGFloat) {
        if #available(iOS 17.0, *) {
            if let v = output.connection(with: .video), v.isVideoRotationAngleSupported(angle) { v.videoRotationAngle = angle }
            if let p = photoOutput.connection(with: .video), p.isVideoRotationAngleSupported(angle) { p.videoRotationAngle = angle }
        }
    }

    // MARK: - frame delivery (encode synchronously; drop before encode when busy)
    public func captureOutput(_ output: AVCaptureOutput,
                              didOutput sampleBuffer: CMSampleBuffer,
                              from connection: AVCaptureConnection) {
        guard !capturing else { return }               // suppress the heavy photo-format frames
        guard server.wantsFrame() else { return }
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        guard let data = FrameSocketServer.encode(pixelBuffer) else { return }
        server.send(data)
    }
}

// Receives one still, writes it to a temp file, and resolves the JS call with the
// file URL (loaded into the webview as the editable high-res source via
// Capacitor.convertFileSrc) + the actual dimensions. NOT saved to Photos — the raw
// still becomes the source; the user saves the EDITED result through the export flow.
// Retained by the plugin's captureDelegates set until `onDone` fires.
final class PhotoCaptureDelegate: NSObject, AVCapturePhotoCaptureDelegate {
    private let call: CAPPluginCall
    private let onDone: (PhotoCaptureDelegate) -> Void

    init(call: CAPPluginCall, onDone: @escaping (PhotoCaptureDelegate) -> Void) {
        self.call = call
        self.onDone = onDone
    }

    func photoOutput(_ output: AVCapturePhotoOutput,
                     didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        if let error = error {
            call.reject("capture failed: \(error.localizedDescription)")
            onDone(self)
            return
        }
        guard let data = photo.fileDataRepresentation() else {
            call.reject("no photo data")
            onDone(self)
            return
        }
        let dims = photo.resolvedSettings.photoDimensions
        let w = Int(dims.width), h = Int(dims.height), bytes = data.count
        let name = "fold-still-\(Int(Date().timeIntervalSince1970 * 1000)).jpg"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do {
            try data.write(to: url)
            call.resolve(["url": url.absoluteString, "path": url.path, "width": w, "height": h, "bytes": bytes])
        } catch {
            call.reject("write failed: \(error.localizedDescription)")
        }
        onDone(self)
    }
}
