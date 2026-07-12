// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// FoldNativeCameraPlugin.swift
//
// Tier-2 frame-bridge SPIKE. Runs a native AVCaptureSession (so we OWN the
// camera), streams biplanar YUV frames to the webview over a localhost WebSocket
// (WebGL uploads + YUV->RGB), AND now exposes the native-only controls that
// getUserMedia can't reach: exposure bias (EV), zoom across the physical lenses,
// and locked white balance by temperature. Purpose: prove the whole Tier-2
// thesis — native owns the sensor, so real controls preview live — before
// wiring the bridge into the real kaleidoscope engine. Tap-to-focus is deferred
// (needs on-device coordinate calibration).

import Foundation
import AVFoundation
import CoreMedia
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
        CAPPluginMethod(name: "setWhiteBalance", returnType: CAPPluginReturnPromise)
    ]

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "fold.camera.session")
    private let videoQueue = DispatchQueue(label: "fold.camera.video")
    private let output = AVCaptureVideoDataOutput()
    private let server = FrameSocketServer(port: 8899)
    private var running = false
    private var device: AVCaptureDevice?

    // Prefer the widest-spanning virtual device so `videoZoomFactor` crosses the
    // physical lenses (ultrawide -> wide -> tele) and exposes real switchover points.
    private func pickCamera() -> AVCaptureDevice? {
        let types: [AVCaptureDevice.DeviceType] = [
            .builtInTripleCamera, .builtInDualWideCamera, .builtInDualCamera, .builtInWideAngleCamera
        ]
        for t in types {
            if let d = AVCaptureDevice.default(t, for: .video, position: .back) { return d }
        }
        return AVCaptureDevice.default(for: .video)
    }

    @objc func start(_ call: CAPPluginCall) {
        let preset = call.getString("preset") ?? "hd1080"
        let fps = call.getDouble("fps") ?? 30
        AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
            guard let self = self else { return }
            guard granted else { call.reject("camera not authorized"); return }
            self.sessionQueue.async {
                if self.running {
                    call.resolve(["port": self.server.port, "running": true, "controls": self.controlRanges()])
                    return
                }
                let info: SessionInfo
                do {
                    info = try self.configureSession(presetName: preset, targetFps: fps)
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
                    // freeze the current auto-computed gains (supported broadly, incl.
                    // the multi-lens camera) — no specific Kelvin
                    if device.isWhiteBalanceModeSupported(.locked) {
                        device.whiteBalanceMode = .locked
                    }
                } else if let temp = temperature, device.isLockingWhiteBalanceWithCustomDeviceGainsSupported {
                    // specific Kelvin — MUST be gated on the custom-gains capability, or
                    // AVFoundation throws an NSException that crashes the app (Swift
                    // try/catch can't catch it; the support check is the only guard)
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

    private func controlRanges() -> [String: Any] {
        guard let device = self.device else { return [:] }
        let lensFactors = device.virtualDeviceSwitchOverVideoZoomFactors.map { $0.doubleValue }
        // Probe whether the plain single WIDE lens would allow custom-Kelvin WB even
        // when the active (multi-lens) device does not — answers the lens-vs-manual-WB
        // tradeoff in one device run.
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
                             "customGainsSupportedWideLens": wideCustomWB]
        ]
    }

    // MARK: - session config

    private struct SessionInfo {
        let width: Int
        let height: Int
        let requestedFps: Double
        let cameraMaxFps: Double
    }

    private func configureSession(presetName: String, targetFps: Double) throws -> SessionInfo {
        let target: (w: Int, h: Int)
        switch presetName {
        case "hd720": target = (1280, 720)
        case "hd1080": target = (1920, 1080)
        case "uhd": target = (3840, 2160)
        default: target = (1920, 1080)
        }

        guard let device = pickCamera() else {
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
