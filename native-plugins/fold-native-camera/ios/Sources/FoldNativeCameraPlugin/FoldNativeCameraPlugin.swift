// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// FoldNativeCameraPlugin.swift
//
// Tier-2 frame-bridge SPIKE. Runs a native AVCaptureSession (so we OWN the
// camera and can later apply real EV/WB/focus/lens), and streams biplanar YUV
// frames to the webview over a localhost WebSocket, where WebGL uploads them as
// textures and converts YUV->RGB. Purpose of the spike: measure fps / latency /
// thermals of the copy-based bridge on device, before committing to build the
// full native-camera feature. Controls (EV/zoom/etc.) are intentionally NOT here
// yet — this proves the pipe first.

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

    @objc func start(_ call: CAPPluginCall) {
        let preset = call.getString("preset") ?? "hd1080"
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
                do {
                    try self.configureSession(presetName: preset)
                } catch {
                    call.reject("configure failed: \(error.localizedDescription)")
                    return
                }
                self.server.start()
                self.session.startRunning()
                self.running = true
                let dims = self.currentDimensions()
                call.resolve([
                    "port": self.server.port,
                    "sensorWidth": dims.width,
                    "sensorHeight": dims.height,
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

    private func configureSession(presetName: String) throws {
        session.beginConfiguration()

        let preset: AVCaptureSession.Preset
        switch presetName {
        case "hd720": preset = .hd1280x720
        case "hd1080": preset = .hd1920x1080
        case "uhd": preset = .hd4K3840x2160
        default: preset = .hd1920x1080
        }
        if session.canSetSessionPreset(preset) { session.sessionPreset = preset }

        // restart safety
        for input in session.inputs { session.removeInput(input) }
        for out in session.outputs { session.removeOutput(out) }

        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
            ?? AVCaptureDevice.default(for: .video) else {
            throw NSError(domain: "fold", code: 1, userInfo: [NSLocalizedDescriptionKey: "no camera device"])
        }
        let input = try AVCaptureDeviceInput(device: device)
        if session.canAddInput(input) { session.addInput(input) }

        // biplanar YUV 420f (full-range) — 1.5 bytes/px, native format, cheap
        output.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
        ]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: videoQueue)
        if session.canAddOutput(output) { session.addOutput(output) }

        // deliver upright portrait frames (spike holds the phone vertically)
        if let conn = output.connection(with: .video) {
            if #available(iOS 17.0, *) {
                if conn.isVideoRotationAngleSupported(90) { conn.videoRotationAngle = 90 }
            } else if conn.isVideoOrientationSupported {
                conn.videoOrientation = .portrait
            }
        }

        session.commitConfiguration()
    }

    private func currentDimensions() -> (width: Int, height: Int) {
        guard let device = (session.inputs.first as? AVCaptureDeviceInput)?.device else { return (0, 0) }
        let d = CMVideoFormatDescriptionGetDimensions(device.activeFormat.formatDescription)
        return (Int(d.width), Int(d.height))
    }

    // MARK: - frame delivery (authoritative dims are per-frame in the header)
    public func captureOutput(_ output: AVCaptureOutput,
                              didOutput sampleBuffer: CMSampleBuffer,
                              from connection: AVCaptureConnection) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        server.sendFrame(pixelBuffer)
    }
}
