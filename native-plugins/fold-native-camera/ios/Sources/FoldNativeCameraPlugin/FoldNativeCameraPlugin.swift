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
    private var captureDelegates = Set<PhotoCaptureDelegate>()   // retained until each capture completes

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

    private func availableLenses(_ facing: String) -> [String] {
        let position: AVCaptureDevice.Position = facing == "front" ? .front : .back
        let ds = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInUltraWideCamera, .builtInWideAngleCamera, .builtInTelephotoCamera],
            mediaType: .video, position: position)
        var out = ["auto"]
        for d in ds.devices {
            switch d.deviceType {
            case .builtInUltraWideCamera: out.append("ultraWide")
            case .builtInWideAngleCamera: out.append("wide")
            case .builtInTelephotoCamera: out.append("tele")
            default: break
            }
        }
        return out
    }

    @objc func start(_ call: CAPPluginCall) {
        let preset = call.getString("preset") ?? "hd1080"
        let fps = call.getDouble("fps") ?? 30
        let lens = call.getString("lens") ?? "auto"
        let preferPhoto = call.getBool("preferPhoto") ?? false
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
                    info = try self.configureSession(presetName: preset, targetFps: fps, lens: lens, preferPhoto: preferPhoto, facing: facing)
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
                    "availableLenses": self.availableLenses(facing),
                    "controls": self.controlRanges(),
                    "running": true
                ])
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        sessionQueue.async { [weak self] in
            guard let self = self else { return }
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

    // Full-resolution still with the live EV/WB/zoom baked in, saved to Photos. The
    // "high-res still on pause" win — up to the lens's native res (e.g. 48MP), which
    // the video stream (4K max) can't reach.
    @objc func capturePhoto(_ call: CAPPluginCall) {
        sessionQueue.async { [weak self] in
            guard let self = self, self.running else { call.reject("camera not running"); return }
            let settings: AVCapturePhotoSettings
            if self.photoOutput.availablePhotoCodecTypes.contains(.hevc) {
                settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.hevc])
            } else {
                settings = AVCapturePhotoSettings()
            }
            if #available(iOS 16.0, *) {
                settings.maxPhotoDimensions = self.photoOutput.maxPhotoDimensions
            }
            let delegate = PhotoCaptureDelegate(call: call) { [weak self] done in
                self?.sessionQueue.async { self?.captureDelegates.remove(done) }
            }
            self.captureDelegates.insert(delegate)
            self.photoOutput.capturePhoto(with: settings, delegate: delegate)
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
                             "customGainsSupportedWideLens": wideCustomWB],
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

    private func configureSession(presetName: String, targetFps: Double, lens: String, preferPhoto: Bool, facing: String) throws -> SessionInfo {
        let target: (w: Int, h: Int)
        switch presetName {
        case "hd720": target = (1280, 720)
        case "hd1080": target = (1920, 1080)
        case "uhd": target = (3840, 2160)
        default: target = (1920, 1080)
        }

        guard let device = pickCamera(lens, facing) else {
            throw NSError(domain: "fold", code: 1, userInfo: [NSLocalizedDescriptionKey: "no camera device"])
        }
        self.device = device

        let matches = device.formats.filter {
            let d = CMVideoFormatDescriptionGetDimensions($0.formatDescription)
            return Int(d.width) == target.w && Int(d.height) == target.h
        }
        let cameraMaxFps = matches
            .flatMap { $0.videoSupportedFrameRateRanges }
            .map { $0.maxFrameRate }
            .max() ?? 0

        var chosen: AVCaptureDevice.Format?
        var chosenMax = 0.0
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

        // Still tool: when photo resolution is prioritized, override with a format that
        // reaches the sensor's max still dimensions. Video formats cap stills ~10-12MP;
        // 48MP lives on dedicated photo formats — you get high-fps video OR max stills.
        if preferPhoto, #available(iOS 16.0, *) {
            let area: (CMVideoDimensions) -> Int = { Int($0.width) * Int($0.height) }
            let sensorMaxPhoto = device.formats
                .compactMap { $0.supportedMaxPhotoDimensions.map(area).max() }.max() ?? 0
            let photoCands = device.formats.filter {
                ($0.supportedMaxPhotoDimensions.map(area).max() ?? 0) == sensorMaxPhoto
            }
            let picked = photoCands.first(where: {
                let d = CMVideoFormatDescriptionGetDimensions($0.formatDescription)
                return Int(d.width) == target.w && Int(d.height) == target.h
            }) ?? photoCands.max(by: {
                let a = CMVideoFormatDescriptionGetDimensions($0.formatDescription)
                let b = CMVideoFormatDescriptionGetDimensions($1.formatDescription)
                return area(a) < area(b)
            })
            if let picked = picked {
                chosen = picked
                chosenMax = picked.videoSupportedFrameRateRanges.map { $0.maxFrameRate }.max() ?? 0
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

        if let conn = output.connection(with: .video) {
            if #available(iOS 17.0, *) {
                if conn.isVideoRotationAngleSupported(90) { conn.videoRotationAngle = 90 }
            } else if conn.isVideoOrientationSupported {
                conn.videoOrientation = .portrait
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

    // MARK: - frame delivery (encode synchronously; drop before encode when busy)
    public func captureOutput(_ output: AVCaptureOutput,
                              didOutput sampleBuffer: CMSampleBuffer,
                              from connection: AVCaptureConnection) {
        guard server.wantsFrame() else { return }
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        guard let data = FrameSocketServer.encode(pixelBuffer) else { return }
        server.send(data)
    }
}

// Receives one still, saves it to the Photos library (add-only), and resolves the
// JS call with the actual captured dimensions + file size. Retained by the plugin's
// captureDelegates set until `onDone` fires (AVCapturePhotoOutput holds it weakly).
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
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { [weak self] authStatus in
            guard let self = self else { return }
            guard authStatus == .authorized || authStatus == .limited else {
                self.call.resolve(["width": w, "height": h, "bytes": bytes, "savedToPhotos": false])
                self.onDone(self)
                return
            }
            PHPhotoLibrary.shared().performChanges({
                let req = PHAssetCreationRequest.forAsset()
                req.addResource(with: .photo, data: data, options: nil)
            }, completionHandler: { ok, _ in
                self.call.resolve(["width": w, "height": h, "bytes": bytes, "savedToPhotos": ok])
                self.onDone(self)
            })
        }
    }
}
