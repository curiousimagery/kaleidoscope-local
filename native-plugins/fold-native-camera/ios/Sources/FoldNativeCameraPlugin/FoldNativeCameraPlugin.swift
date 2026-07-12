// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// FoldNativeCameraPlugin.swift
//
// Tier-2 frame-bridge SPIKE. Runs a native AVCaptureSession (so we OWN the
// camera and can later apply real EV/WB/focus/lens), and streams biplanar YUV
// frames to the webview over a localhost WebSocket, where WebGL uploads them as
// textures and converts YUV->RGB. Purpose: measure fps / latency / thermals of
// the copy-based bridge on device — including its MAX sustainable fps — before
// committing to build the full native-camera feature. Controls (EV/zoom/etc.)
// are intentionally NOT here yet; this proves the pipe first.

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
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "fold.camera.session")
    private let videoQueue = DispatchQueue(label: "fold.camera.video")
    private let output = AVCaptureVideoDataOutput()
    private let server = FrameSocketServer(port: 8899)
    private var running = false

    // `fps` of 0 means "run the chosen format at its maximum" (ceiling probe).
    @objc func start(_ call: CAPPluginCall) {
        let preset = call.getString("preset") ?? "hd1080"
        let fps = call.getDouble("fps") ?? 30
        AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
            guard let self = self else { return }
            guard granted else {
                call.reject("camera not authorized")
                return
            }
            self.sessionQueue.async {
                if self.running {
                    call.resolve(["port": self.server.port, "running": true])
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

    private struct SessionInfo {
        let width: Int
        let height: Int
        let requestedFps: Double
        let cameraMaxFps: Double   // absolute max the device offers at this resolution
    }

    private func configureSession(presetName: String, targetFps: Double) throws -> SessionInfo {
        let target: (w: Int, h: Int)
        switch presetName {
        case "hd720": target = (1280, 720)
        case "hd1080": target = (1920, 1080)
        case "uhd": target = (3840, 2160)
        default: target = (1920, 1080)
        }

        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
            ?? AVCaptureDevice.default(for: .video) else {
            throw NSError(domain: "fold", code: 1, userInfo: [NSLocalizedDescriptionKey: "no camera device"])
        }

        // All formats matching the requested resolution, and the absolute max fps
        // across them (the device's ceiling at this resolution — reported to the HUD).
        let matches = device.formats.filter {
            let d = CMVideoFormatDescriptionGetDimensions($0.formatDescription)
            return Int(d.width) == target.w && Int(d.height) == target.h
        }
        let cameraMaxFps = matches
            .flatMap { $0.videoSupportedFrameRateRanges }
            .map { $0.maxFrameRate }
            .max() ?? 0

        // Pick a format: for a specific target, the TIGHTEST format that still meets
        // it (avoids selecting a slo-mo/binned format); for the max probe (fps<=0),
        // the highest-fps format.
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
        if chosen == nil {   // target unmet by any format — fall back to the fastest one
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
            // no exact-dims format — fall back to a session preset
            let preset: AVCaptureSession.Preset = presetName == "hd720" ? .hd1280x720
                : presetName == "uhd" ? .hd4K3840x2160 : .hd1920x1080
            if session.canSetSessionPreset(preset) { session.sessionPreset = preset }
        }

        session.commitConfiguration()
        return SessionInfo(width: target.w, height: target.h,
                           requestedFps: requestedFps, cameraMaxFps: cameraMaxFps)
    }

    // MARK: - frame delivery (encode synchronously here; the pixel buffer is only
    // valid for the duration of this call, and dropped frames skip the encode)
    public func captureOutput(_ output: AVCaptureOutput,
                              didOutput sampleBuffer: CMSampleBuffer,
                              from connection: AVCaptureConnection) {
        guard server.wantsFrame() else { return }
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        guard let data = FrameSocketServer.encode(pixelBuffer) else { return }
        server.send(data)
    }
}
