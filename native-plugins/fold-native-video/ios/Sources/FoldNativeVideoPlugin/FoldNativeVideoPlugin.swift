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
// Bytes in: `AVURLAsset` needs a file on disk and a WKWebView Blob has no path, so the
// clip arrives over a BINARY UPLOAD SOCKET (FileUploadServer, port 8901) rather than
// base64 across the bridge — see that file for the reasoning. Stills out: `frameAt`
// serves the EDITOR one bounded frame at a time (AVAssetImageGenerator) so motion
// staging survives having only one player. Wired by shell/native-video.js, capability-
// gated, with the JS <video> path intact as the fallback.

import Foundation
import AVFoundation
import CoreVideo
import QuartzCore
import UIKit
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
        CAPPluginMethod(name: "setRate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginUpload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishUpload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "frameAt", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "frameStats", returnType: CAPPluginReturnPromise)
    ]

    private let server = FrameSocketServer(port: 8900)
    private let uploads = FileUploadServer(port: 8901)
    // Stills for the EDITOR while motion staging is on (shell/stage-source.js). The
    // audience keeps the one playing decode; the editor asks for one frame at a time,
    // which is what an image generator is for — a decode burst per scrub, no second
    // player. maximumSize bounds the buffer; the tolerances buy speed over exactness,
    // which is the right trade for scrubbing.
    private var stills: AVAssetImageGenerator?
    private let stillQueue = DispatchQueue(label: "fold.video.stills")
    private var player: AVQueuePlayer?
    private var looper: AVPlayerLooper?          // strong ref required; it owns the loop
    private var output: AVPlayerItemVideoOutput?
    private weak var outputItem: AVPlayerItem?   // which item `output` is currently attached to
    private var itemObs: NSKeyValueObservation?
    private var displayLink: CADisplayLink?
    // encode + socket send off the main thread — copyPixelBuffer hands us an owned
    // buffer, so it's safe to carry to another queue; keeps 4K encode off the UI/decode tick
    private let encodeQueue = DispatchQueue(label: "fold.video.encode")
    // set by start(startPaused:), cleared by the tick that pushes the first frame
    private var pauseAfterFirstFrame = false

    // THE LOOP BOUNDARY, MEASURED WHERE THE BOUNDARY ACTUALLY IS (B599).
    //
    // Every JS-side reading of the lap has been taken downstream of a wire we do not control
    // the far end of, and it keeps producing the same shape: the frames look continuous and a
    // large slab of CONTENT is missing. Daniel's B598 lap went `fromPts 19.4 → toPts 0.833` on
    // a 20.4s clip — **1.8 seconds of footage absent** — with the receiver reporting a 7ms wire
    // gap. Those two cannot both describe the same event, so at least one of them is measuring
    // the wrong thing, and the only place that can settle it is here: AVPlayerLooper swaps in a
    // fresh copy of the template item each lap and this is the only code that sees the swap.
    //
    // `swapGapMs` is the wall-clock silence between the last frame PUSHED before the swap and
    // the first pushed after. `swapFromPts`/`swapToPts` are the content either side. Compare
    // them against what JS received: if native pushed 20.37 → 0.03 and JS took 19.4 → 0.833,
    // the loss is in the wire and the backpressure. If native itself skips, the loss is
    // AVFoundation's and the fix is a different looping strategy.
    private var itemSwaps = 0
    private var pendingSwap = false
    private var lastPushAt: TimeInterval = 0
    private var lastPushPts: Double = -1
    private var swapGapMs = -1
    private var maxSwapGapMs = -1
    private var swapFromPts: Double = -1
    private var swapToPts: Double = -1
    // ticks where the output had NOTHING NEW to give, which is the direct test of "did the
    // decoder stop producing across the swap" as opposed to "did the fan-out decline to take"
    private var ticksNoBuffer = 0
    // watchdog for the reused output (see attachOutput): if a lap produces nothing for this
    // long, rebuild the output from scratch and SAY SO, so a rescue can never read as normal
    private var swapAt: TimeInterval = 0
    private var swapRecoveries = 0
    private let swapStallSeconds: TimeInterval = 0.5

    // path: a file:// URL or plain filesystem path to the clip. loop: seamless repeat (default true).
    @objc func start(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), !path.isEmpty else {
            call.reject("no path"); return
        }
        let loop = call.getBool("loop") ?? true
        // PARK AFTER EXACTLY ONE FRAME (B597). The player has to run for the output to
        // produce anything, so a clip used to decode however many frames fitted in the
        // round trip before JS could pause it over the bridge. Two symptoms, one cause:
        // the preview "hunts around a couple frames" on load, and a client joining the
        // socket is primed with whichever of those frames happened to be last rather than
        // the one the app is showing (Daniel, B596: "the external display is showing a
        // different frame than the output panel"). Pausing HERE, on the tick that pushed
        // the first frame, closes the window instead of racing it.
        let startPaused = call.getBool("startPaused") ?? false
        self.pauseAfterFirstFrame = startPaused
        let url = path.hasPrefix("file://") ? (URL(string: path) ?? URL(fileURLWithPath: path))
                                            : URL(fileURLWithPath: path)
        DispatchQueue.main.async {
            self.teardown()
            self.server.start()

            let asset = AVURLAsset(url: url)
            let gen = AVAssetImageGenerator(asset: asset)
            gen.appliesPreferredTrackTransform = true
            gen.requestedTimeToleranceBefore = CMTime(seconds: 0.05, preferredTimescale: 600)
            gen.requestedTimeToleranceAfter = CMTime(seconds: 0.05, preferredTimescale: 600)
            self.stills = gen
            let item = AVPlayerItem(asset: asset)

            let qp = AVQueuePlayer()
            qp.isMuted = true
            qp.actionAtItemEnd = .none
            if loop {
                self.looper = AVPlayerLooper(player: qp, templateItem: item)
            } else {
                qp.replaceCurrentItem(with: item)
            }
            self.player = qp

            // THE VIDEO OUTPUT FOLLOWS `currentItem`, it is not attached once.
            //
            // AVPlayerLooper does NOT enqueue the template item — it enqueues COPIES of it,
            // and swaps in a fresh copy every lap. An output added to the template is
            // therefore attached to an item that never plays: hasNewPixelBuffer() is false
            // forever, no frame is ever pushed, and the JS receiver times out and falls back
            // to <video>. That is exactly what Daniel saw on iPad ("no native frames on port
            // 8900"), and it is why the app looked unchanged after stages 3+4 landed.
            // Observing currentItem re-attaches a fresh output to whatever is actually
            // playing, which also covers the non-looping replaceCurrentItem path.
            self.itemObs = qp.observe(\.currentItem, options: [.initial, .new]) { [weak self] p, _ in
                guard let self = self else { return }
                let current = p.currentItem
                DispatchQueue.main.async {
                    guard let item = current else { return }
                    self.itemSwaps += 1
                    self.pendingSwap = true     // the next pushed frame closes the measurement
                    self.swapAt = CACurrentMediaTime()
                    self.attachOutput(to: item)
                }
            }
            qp.play()

            let link = CADisplayLink(target: self, selector: #selector(self.tick))
            link.add(to: .main, forMode: .common)
            self.displayLink = link

            call.resolve(["port": self.server.port])
        }
    }

    // Attach a FRESH video output to `item`, detaching from whatever held the last one.
    // An AVPlayerItemVideoOutput belongs to one item at a time, and AVPlayerLooper hands us
    // a new item every lap (see the observer in start()).
    // REUSE THE OUTPUT ACROSS THE LAP (B600). B599 measured the loop hold here, natively:
    // `swapGapMs` 141, `maxSwapGapMs` 150, `swapFromPts 20.4 → swapToPts 0.116`. The decode
    // itself goes ~150ms without producing a frame at the item swap, and the new item's clock
    // runs through the silence, so the content skipped equals the stall.
    //
    // A fresh AVPlayerItemVideoOutput has to prime before `hasNewPixelBuffer` says yes, and we
    // were allocating one every lap. Whether that priming IS the 150ms is a question about
    // AVFoundation that only a measurement can answer, so this reuses the object and lets
    // `swapGapMs` report the result: it either drops or it does not, and if it does not the
    // cost is AVFoundation's own item swap and the next move is to stop swapping items at all
    // (one item, `actionAtItemEnd = .none`, seek to zero on end — the output never moves).
    //
    // `force` is the watchdog's escape hatch: reuse is the risky half of this, and a reused
    // output that never delivers would freeze the picture permanently at the first lap.
    private func attachOutput(to item: AVPlayerItem, force: Bool = false) {
        if outputItem === item, output != nil, !force { return }
        if let old = output, let prev = outputItem { prev.remove(old) }
        let attrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
        ]
        let out = (force ? nil : output) ?? AVPlayerItemVideoOutput(pixelBufferAttributes: attrs)
        item.add(out)
        output = out
        outputItem = item
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
        guard out.hasNewPixelBuffer(forItemTime: itemTime) else {
            ticksNoBuffer &+= 1
            // a reused output that never delivers would freeze the picture for good, so give
            // the lap half a second and then rebuild from scratch
            if pendingSwap, swapAt > 0, hostTime - swapAt > swapStallSeconds,
               let item = player?.currentItem {
                swapRecoveries += 1
                swapAt = hostTime
                attachOutput(to: item, force: true)
                print("[FoldVideo] reused output produced nothing across the lap — rebuilt (\(swapRecoveries))")
            }
            return
        }
        var displayTime = CMTime.invalid
        guard let pb = out.copyPixelBuffer(forItemTime: itemTime, itemTimeForDisplay: &displayTime) else { return }
        // the buffer's own display time when the output reports one, else the time we asked for
        let stamped = displayTime.isValid ? displayTime : itemTime
        let pts = CMTimeGetSeconds(stamped)
        // AVPlayerLooper swaps in a fresh copy of the template item each lap, so this is
        // the CLIP's duration (position within the clip), not the queue's — which is
        // exactly the span the timeline is scaled to.
        let dur = CMTimeGetSeconds(player?.currentItem?.duration ?? .indefinite)
        // ONE FRAME, AND IT MUST BE THE FIRST ONE (B598). B597 parked on the tick that saw a
        // buffer, which stopped the preview hopping through several frames but left it parked
        // on whichever frame the display link happened to catch — a few frames in, not the head
        // of the clip. Daniel: "the initial image that loads in output is wrong but after
        // scrubbing it corrects to the right frame."
        //
        // So park AND rewind, and push nothing yet: the frame worth showing is the one at zero,
        // which the next tick picks up. A seek on a paused player still produces a buffer, and
        // that is the same mechanism a scrub has always relied on.
        if pauseAfterFirstFrame {
            pauseAfterFirstFrame = false
            player?.pause()
            player?.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
            return
        }
        // close the swap measurement on the first frame produced after the item changed
        if pendingSwap {
            pendingSwap = false
            swapGapMs = lastPushAt > 0 ? Int((hostTime - lastPushAt) * 1000) : -1
            if swapGapMs > maxSwapGapMs { maxSwapGapMs = swapGapMs }
            swapFromPts = lastPushPts
            swapToPts = pts
        }
        lastPushAt = hostTime
        lastPushPts = pts
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
            self.uploads.purge()   // the staged copy dies with the decode that used it
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

    // ---- byte transport: the clip's bytes reach AVURLAsset over a socket ----------
    // See FileUploadServer.swift for why this isn't base64 over the bridge.

    @objc func beginUpload(_ call: CAPPluginCall) {
        let name = call.getString("name") ?? "clip.mp4"
        guard let id = uploads.begin(name: name) else { call.reject("could not open the upload file"); return }
        call.resolve(["port": uploads.port, "id": id])
    }

    @objc func finishUpload(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("no upload id"); return }
        let bytes = call.getInt("bytes") ?? 0
        uploads.finish(id: id, bytes: bytes) { url, received in
            guard let url = url else { call.reject("upload did not complete"); return }
            call.resolve(["path": url.path, "bytes": received])
        }
    }

    // One frame, as a JPEG data URL. `maxSize` caps the long edge — the editor's preview
    // never needs native 4K, and a bounded still is the whole reason staging can survive
    // a single decode.
    // `tolerance` (seconds) is the caller's answer to "how exact does this frame have to
    // be?", and it is the difference between a fast thumbnail pass and a slow one. A tight
    // tolerance forces the generator to decode forward from the preceding keyframe to the
    // exact time — on a long 4K clip that is most of the cost, and it competes with the
    // player for the hardware decoder (measured: frame delivery drops from 30/s to ~14/s
    // during a thumbnail pass). A scrub preview wants exactness; a 96px filmstrip cell does
    // not care which frame of the surrounding second it gets.
    // THE FAN-OUT'S OWN ACCOUNT OF WHO GOT WHAT (B584). Cheap enough to poll once a second; it
    // takes the socket lock and copies counters. See FrameSocketServer.stats() for why this rides
    // the JS bridge rather than the frame socket it describes.
    @objc func frameStats(_ call: CAPPluginCall) {
        var out = server.stats()
        // the DECODE's own account of the lap, beside the SOCKET's account of the wire —
        // the pair is what separates "AVFoundation skipped it" from "we did not take it"
        out["itemSwaps"] = itemSwaps
        out["swapGapMs"] = swapGapMs
        out["maxSwapGapMs"] = maxSwapGapMs
        out["swapFromPts"] = swapFromPts
        out["swapToPts"] = swapToPts
        out["ticksNoBuffer"] = ticksNoBuffer
        out["swapRecoveries"] = swapRecoveries
        call.resolve(out)
    }

    @objc func frameAt(_ call: CAPPluginCall) {
        let t = call.getDouble("time") ?? 0
        let maxSize = CGFloat(call.getInt("maxSize") ?? 2048)
        let quality = CGFloat(call.getDouble("quality") ?? 0.9)
        let tol = CMTime(seconds: max(0, call.getDouble("tolerance") ?? 0.05), preferredTimescale: 600)
        guard let gen = stills else { call.reject("no clip loaded"); return }
        gen.maximumSize = CGSize(width: maxSize, height: maxSize)
        gen.requestedTimeToleranceBefore = tol
        gen.requestedTimeToleranceAfter = tol
        stillQueue.async {
            do {
                let cg = try gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600),
                                             actualTime: nil)
                let img = UIImage(cgImage: cg)
                guard let data = img.jpegData(compressionQuality: quality) else {
                    call.reject("could not encode the frame"); return
                }
                call.resolve([
                    "dataUrl": "data:image/jpeg;base64," + data.base64EncodedString(),
                    "width": cg.width,
                    "height": cg.height,
                ])
            } catch {
                call.reject("frame extraction failed: \(error.localizedDescription)")
            }
        }
    }

    private func teardown() {
        displayLink?.invalidate(); displayLink = nil
        itemObs?.invalidate(); itemObs = nil
        if let out = output, let item = outputItem { item.remove(out) }
        output = nil
        outputItem = nil
        player?.pause(); player = nil
        looper = nil
        stills = nil
        // per-clip counters: carrying them across a source swap is how B597's `maxTakeGapMs`
        // ended up reporting an attach cost as if it were a lap
        itemSwaps = 0; pendingSwap = false
        lastPushAt = 0; lastPushPts = -1
        swapGapMs = -1; maxSwapGapMs = -1; swapFromPts = -1; swapToPts = -1
        ticksNoBuffer = 0
        swapAt = 0; swapRecoveries = 0
    }
}
