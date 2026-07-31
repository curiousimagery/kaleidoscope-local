// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// FoldNativeVideoPlugin.swift
//
// ONE native AVFoundation decode of a clip, fanned to both webviews over a
// localhost socket (FrameSocketServer, port 8900) — the video sibling of
// fold-native-camera. Purpose: on iPad, HDMI + video currently opens TWO <video>
// decoders (the main engine's and the external-display view's, output-view.js:163);
// at 4K/6K that trips the iOS jetsam limit → lost GL context → unrecoverable, which
// is why video-over-HDMI is capped to 1080p today. Decoding once here and serving
// both views over the socket removes the second decode and lifts the cap.
//
// Pipeline: AVQueuePlayer (+ AVPlayerLooper for a seamless loop) → AVPlayerItemVideoOutput
// (biplanar 420 full-range, the exact format FrameSocketServer.encode / the JS receiver
// expect) → CADisplayLink tick → on each NEW pixel buffer, encode off the main thread
// and push. wantsFrame() skips the encode when no client is attached.
//
// Transport (all over the Capacitor bridge, never the socket): start/stop/pause/resume/
// seek/setRate. The app's motion/perform timeline drives these instead of a <video>.
// READS come back the other way, in the frames themselves: every frame is stamped with
// its presentation time + the clip duration ("FYUW"), so THIS decode owns the motion
// clock and JS can answer currentTime/duration without a bridge round-trip per frame.
// ADDITIVE for now — nothing in the app calls this yet; the source-swap (S3) wires it
// with the JS <video> path kept as the fallback.

import Foundation
import AVFoundation
import CoreVideo
import QuartzCore
import Capacitor

@objc(FoldNativeVideoPlugin)
public class FoldNativeVideoPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FoldNativeVideoPlugin"
    public let jsName = "FoldNativeVideo"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seek", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRate", returnType: CAPPluginReturnPromise)
    ]

    private let server = FrameSocketServer(port: 8900)
    private var player: AVQueuePlayer?
    private var looper: AVPlayerLooper?          // strong ref required; it owns the loop
    private var output: AVPlayerItemVideoOutput?
    private var displayLink: CADisplayLink?
    // encode + socket send off the main thread — copyPixelBuffer hands us an owned
    // buffer, so it's safe to carry to another queue; keeps 4K encode off the UI/decode tick
    private let encodeQueue = DispatchQueue(label: "fold.video.encode")

    // path: a file:// URL or plain filesystem path to the clip. loop: seamless repeat (default true).
    @objc func start(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), !path.isEmpty else {
            call.reject("no path"); return
        }
        let loop = call.getBool("loop") ?? true
        let url = path.hasPrefix("file://") ? (URL(string: path) ?? URL(fileURLWithPath: path))
                                            : URL(fileURLWithPath: path)
        DispatchQueue.main.async {
            self.teardown()
            self.server.start()

            let item = AVPlayerItem(asset: AVURLAsset(url: url))
            let attrs: [String: Any] = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
            ]
            let out = AVPlayerItemVideoOutput(pixelBufferAttributes: attrs)
            item.add(out)
            self.output = out

            let qp = AVQueuePlayer()
            qp.isMuted = true
            qp.actionAtItemEnd = .none
            if loop {
                self.looper = AVPlayerLooper(player: qp, templateItem: item)
            } else {
                qp.replaceCurrentItem(with: item)
            }
            self.player = qp
            qp.play()

            let link = CADisplayLink(target: self, selector: #selector(self.tick))
            link.add(to: .main, forMode: .common)
            self.displayLink = link

            call.resolve(["port": self.server.port])
        }
    }

    // paced to the display; pushes only when the output has a NEW buffer, so the
    // effective rate is the clip's fps, not the screen's.
    //
    // Every frame carries its PRESENTATION TIME (and the clip duration) — that's what
    // makes this decode the motion runtime's master clock without a per-frame bridge
    // round-trip: the JS receiver answers `currentTime`/`duration` straight off the
    // frame it is about to paint, so sampled params are locked to the frame on screen
    // (strictly tighter than reading a <video>'s clock a beat after it presented).
    @objc private func tick() {
        guard let out = output, server.wantsFrame() else { return }
        let hostTime = CACurrentMediaTime()
        let itemTime = out.itemTime(forHostTime: hostTime)
        guard out.hasNewPixelBuffer(forItemTime: itemTime) else { return }
        var displayTime = CMTime.invalid
        guard let pb = out.copyPixelBuffer(forItemTime: itemTime, itemTimeForDisplay: &displayTime) else { return }
        // the buffer's own display time when the output reports one, else the time we asked for
        let stamped = displayTime.isValid ? displayTime : itemTime
        let pts = CMTimeGetSeconds(stamped)
        // AVPlayerLooper swaps in a fresh copy of the template item each lap, so this is
        // the CLIP's duration (position within the clip), not the queue's — which is
        // exactly the span the timeline is scaled to.
        let dur = CMTimeGetSeconds(player?.currentItem?.duration ?? .indefinite)
        encodeQueue.async { [weak self] in
            guard let self = self,
                  let data = FrameSocketServer.encode(pb, pts: pts, duration: dur) else { return }
            self.server.send(data)
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.teardown()
            self.server.stop()
            call.resolve()
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.player?.pause(); call.resolve() }
    }

    @objc func resume(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.player?.play(); call.resolve() }
    }

    @objc func seek(_ call: CAPPluginCall) {
        let t = call.getDouble("time") ?? 0
        DispatchQueue.main.async {
            self.player?.seek(to: CMTime(seconds: t, preferredTimescale: 600),
                              toleranceBefore: .zero, toleranceAfter: .zero)
            call.resolve()
        }
    }

    @objc func setRate(_ call: CAPPluginCall) {
        let r = Float(call.getDouble("rate") ?? 1.0)
        DispatchQueue.main.async { self.player?.rate = r; call.resolve() }
    }

    private func teardown() {
        displayLink?.invalidate(); displayLink = nil
        player?.pause(); player = nil
        looper = nil
        output = nil
    }
}
