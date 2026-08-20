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
        CAPPluginMethod(name: "frameStats", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLoopCache", returnType: CAPPluginReturnPromise)
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
    private var endObs: NSObjectProtocol?         // loopBySeek: the end-of-item rewind
    // WHETHER THE OPERATOR MEANS THIS TO BE PLAYING. `actionAtItemEnd = .none` leaves the player
    // stopped at the end, so the loopBySeek rewind has to decide whether to resume — and it must
    // not resume a clip the operator paused, which is the exact regression B595 fixed.
    private var parked = false
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
    // when the current lap began, so `swapGapMs` can be closed by the next pushed frame
    private var swapAt: TimeInterval = 0

    // ---- THE LOOP HEAD CACHE (B605) -----------------------------------------------------
    //
    // B599-B604 established what this is for and closed every alternative. The lap costs a FIXED
    // ~150ms of no frames — 141/150 at 4K and 141/150 at FHD, four times the pixels — because
    // that is what AVFoundation takes to resume delivering after the playhead returns to zero.
    // It is not decode work, not the item swap (a single-item seek costs the same), not output
    // priming (reuse changed nothing), and not anything a notification API can hurry along.
    //
    // So stop trying to remove the gap and fill it. We already receive the head of the clip on
    // the opening pass; keeping those frames lets us feed them back at the lap while the decoder
    // restarts. The wire carries real frames with real timestamps the whole way through, so both
    // webviews, the motion clock and every downstream consumer are unaware anything happened —
    // and it works on any clip, which matters because most loops are authored elsewhere.
    //
    // CACHED FRAMES ARE SOURCE FOOTAGE, NOT RENDERED OUTPUT. The kaleidoscope is applied by each
    // engine at render time from live state, so the slice keeps animating through the lap and a
    // performer moving it across the loop point sees no difference (Daniel's question, B604).
    //
    // BUDGET: the NEED is a duration (the gap is fixed in time), the RISK is bytes (this project
    // has a 4K jetsam history). So the cache holds `headSeconds` worth, capped by a byte budget
    // that is live-adjustable from the frame-cost panel. At 4K a frame is ~12.4MB, so 64MB buys
    // ~5 frames ≈ 0.17s, just over the gap; at FHD the same budget buys ~20. Under-budget is not
    // a failure — a partial fill still turns a 150ms hold into a short one — but it must SAY so,
    // which is what `coveredMs` in the stats is for.
    private struct CachedFrame { let pts: Double; let data: Data }
    private var headCache: [CachedFrame] = []
    private var headBytes = 0
    private var cacheBudget = 64 * 1024 * 1024
    // ⚠️ B690 — HOW MUCH HEAD TO KEEP IS NOW DERIVED FROM THE MEASURED LAP, NOT A CONSTANT.
    //
    // This was a flat 0.22s, sized when the measured lap was 141-158ms on a 20.4s clip. **T9 then
    // measured a 325ms lap on a 6:39 clip** — the AVPlayerLooper item swap scales with clip length
    // (a longer movie is a bigger index to re-open). At 0.22 the cache could never cover it, and
    // the panel correctly advised raising a budget that could not help, because `headSeconds` was
    // the binding limit rather than the bytes.
    //
    // So: **ask for what the lap actually costs**, floored at the old constant so no clip that
    // works today asks for less, and ceilinged so a pathological reading cannot run away.
    // `swapGapMs` is already measured every lap; the first lap has none, so the floor covers it and
    // the second lap sizes correctly. +1.5x margin because the gap varies lap to lap.
    private let headSecondsFloor = 0.22
    private let headSecondsCeil = 0.60
    private var headSeconds: Double {
        guard maxSwapGapMs > 0 else { return headSecondsFloor }
        return min(headSecondsCeil, max(headSecondsFloor, Double(maxSwapGapMs) * 1.5 / 1000.0))
    }
    private let cacheLock = NSLock()
    // replay state — `replayFedPts` also suppresses live frames we have already shown from cache,
    // so the content never goes backwards when the decoder finally catches up
    private var replaying = false
    private var replayStartedAt: TimeInterval = 0
    private var replayFedPts: Double = -1
    private var lapsCovered = 0
    private var lastReplayFrames = 0
    private var replayIndex = 0
    // the source's own frame interval, learned from consecutive pushed pts — the replay is paced
    // to the CLIP's rate, not the display link's, so 30fps content stays 30fps content
    private var frameInterval: Double = 1.0 / 30.0

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
        self.parked = startPaused
        let loopBySeek = call.getBool("loopBySeek") ?? false
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
            // TWO WAYS TO LOOP, AND THE SECOND EXISTS BECAUSE THE FIRST COSTS 150ms (B601).
            //
            // AVPlayerLooper is seamless for PLAYBACK and is not seamless for FRAME EXTRACTION:
            // it swaps in a fresh copy of the template item each lap, and B599/B600 measured that
            // swap at 141-150ms of no frames produced, with the new item's clock running through
            // the silence so the footage skipped equals the stall. Reusing the video output across
            // the swap did not move it (150 against 150), so the cost is the swap itself.
            //
            // `loopBySeek` does not swap: ONE item, rewound to zero when it reaches the end, with
            // the output attached once and never moved. Whether that is cheaper is a question
            // about AVFoundation, so both arms are instrumented identically and it ships as an
            // A/B rather than a replacement.
            if loop && loopBySeek {
                qp.replaceCurrentItem(with: item)
                self.endObs = NotificationCenter.default.addObserver(
                    forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
                ) { [weak self] _ in
                    guard let self = self else { return }
                    // instrument the LAP, exactly as the item-swap path does, so the two are
                    // comparable in one sitting instead of across builds
                    self.itemSwaps += 1
                    self.pendingSwap = true
                    self.swapAt = CACurrentMediaTime()
                    self.player?.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero) { _ in
                        // `actionAtItemEnd = .none` leaves the player paused at the end
                        if !self.parked { self.player?.play() }
                    }
                }
            } else if loop {
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
    // A FRESH OUTPUT PER ITEM, and B600 established that this is NOT the loop hold: reusing
    // the object across the swap left `swapGapMs` at 150 against 150. The reuse and its
    // rebuild-watchdog were deleted with the hypothesis (perf-flags.js's rule), which leaves
    // this the straightforward version it always was.
    private func attachOutput(to item: AVPlayerItem) {
        if outputItem === item, output != nil { return }
        if let old = output, let prev = outputItem { prev.remove(old) }
        let attrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
        ]
        let out = AVPlayerItemVideoOutput(pixelBufferAttributes: attrs)
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
        guard let out = output else { return }
        let hostTime = CACurrentMediaTime()
        // FILL THE LAP BEFORE ASKING THE DECODER (B605). During the ~150ms after the playhead
        // returns to zero there is nothing to ask for, so this is the only place the gap can be
        // covered — and it has to run ahead of the hasNewPixelBuffer guard, which returns early
        // for the whole duration of it.
        if feedFromCache(hostTime) { return }
        // THE CACHE CANNOT BE FILLED FROM WHAT WE HAPPEN TO SEND (B607).
        //
        // `cacheHeadFrame` rode along behind `server.send`, so the cache only ever saw frames the
        // fan-out actually wanted. At FHD that is every frame and the cache filled from pts 0 and
        // the lap became seamless. At 4K `ticksNoTaker` runs into the thousands, and the frames
        // near pts 0 — produced once, on the opening pass, while both clients are busy with 12.4MB
        // sends — are exactly the ones most likely to be passed over. Daniel's 4K reading:
        // `firstPts: 0.115`, which is where the decoder resumes anyway, so the replay could only
        // ever repeat content that was coming regardless. **It filled nothing, precisely.**
        //
        // So while the head is still missing, take the buffer whether or not anyone wants it. The
        // extra encode is bounded: `cacheNeedsFill` goes false as soon as the window is covered
        // from ~0, which is once, on the first playthrough.
        let wants = server.wantsFrame()
        let fillingHead = cacheNeedsFill()
        guard wants || fillingHead else { return }
        let itemTime = out.itemTime(forHostTime: hostTime)
        guard out.hasNewPixelBuffer(forItemTime: itemTime) else { ticksNoBuffer &+= 1; return }
        var displayTime = CMTime.invalid
        guard let pb = out.copyPixelBuffer(forItemTime: itemTime, itemTimeForDisplay: &displayTime) else { return }
        // the buffer's own display time when the output reports one, else the time we asked for
        let stamped = displayTime.isValid ? displayTime : itemTime
        let pts = CMTimeGetSeconds(stamped)
        // AVPlayerLooper swaps in a fresh copy of the template item each lap, so this is
        // the CLIP's duration (position within the clip), not the queue's — which is
        // exactly the span the timeline is scaled to.
        let dur = CMTimeGetSeconds(player?.currentItem?.duration ?? .indefinite)
        // NEVER LET PARKING COST US THE DECODE (B603).
        //
        // B598 parked by pausing, seeking to zero and returning WITHOUT pushing, on the reasoning
        // that the frame worth showing is the one at zero. That reasoning assumed a paused player
        // reliably produces another buffer, and it does not always: Daniel's FHD run reported
        // `failed at "frame socket": no native frames on port 8900` — the socket opened, nothing
        // ever came down it, and the 8s requireFrame window expired into the `<video>` fallback.
        // **The park had swallowed the only frame the decode was going to offer.**
        //
        // The order is now: PUSH this frame (the socket must see traffic, or JS has no reason to
        // believe the decode is alive), rewind while still playing so the output keeps producing,
        // and pause only once the seek has landed. Landing on the exact head frame is not this
        // code's job any more — `attachNativeVideo` seek-settles to the `<video>`'s position after
        // the attach (B600), which is the authoritative answer and re-asserts it either way.
        if pauseAfterFirstFrame {
            pauseAfterFirstFrame = false
            player?.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
                self?.player?.pause()
            }
        }
        // close the swap measurement on the first frame produced after the item changed
        if pendingSwap {
            pendingSwap = false
            swapGapMs = lastPushAt > 0 ? Int((hostTime - lastPushAt) * 1000) : -1
            if swapGapMs > maxSwapGapMs { maxSwapGapMs = swapGapMs }
            swapFromPts = lastPushPts
            swapToPts = pts
        }
        // THE DECODER IS BACK. Close the replay, and drop anything the cache already showed so
        // the content never runs backwards at the hand-off.
        if replaying { replaying = false; lapsCovered += 1 }
        if replayFedPts >= 0 {
            if pts <= replayFedPts + 0.001 { return }   // already on screen, from cache
            replayFedPts = -1                            // live has caught up; normal service
        }
        if lastPushPts >= 0 {
            let d = pts - lastPushPts
            if d > 0.005 && d < 0.2 { frameInterval = frameInterval * 0.9 + d * 0.1 }
        }
        lastPushAt = hostTime
        lastPushPts = pts
        encodeQueue.async { [weak self] in
            guard let self = self,
                  let data = FrameSocketServer.encode(pb, pts: pts, duration: dur) else { return }
            if wants { self.server.send(data) }
            self.cacheHeadFrame(pts: pts, data: data)
        }
    }

    // Keep the head of the clip while there is budget for it. Called off the encode queue, so
    // everything it touches is behind `cacheLock`. Frames arrive in order on the opening pass and
    // roughly in order on later ones; the pts proximity test is what stops a second lap from
    // storing duplicates, and what lets a RAISED budget top the cache up on the next pass instead
    // of requiring a reload.
    private func cacheHeadFrame(pts: Double, data: Data) {
        guard pts >= 0, pts <= headSeconds else { return }
        cacheLock.lock(); defer { cacheLock.unlock() }
        guard headBytes + data.count <= cacheBudget else { return }
        if headCache.contains(where: { abs($0.pts - pts) < 0.008 }) { return }
        headCache.append(CachedFrame(pts: pts, data: data))
        headCache.sort { $0.pts < $1.pts }
        headBytes += data.count
    }

    // Is the head window still missing anything? Goes false once the cache spans ~0 to headSeconds,
    // so the extra work this authorises is paid once per clip rather than per frame.
    private func cacheNeedsFill() -> Bool {
        cacheLock.lock(); defer { cacheLock.unlock() }
        if cacheBudget == 0 || headBytes >= cacheBudget { return false }
        let haveStart = (headCache.first?.pts ?? 1.0) <= 0.02
        let haveEnd = (headCache.last?.pts ?? -1) >= headSeconds - 0.02
        return !(haveStart && haveEnd)
    }

    // Feed the next cached frame if this moment of the lap calls for one. Paced by PTS against
    // wall-clock elapsed since the lap began, so the replay runs at the clip's own rate rather
    // than the display link's — 30fps content stays 30fps content.
    //
    // Returns true when it fed a frame, which tells `tick` to stand down for this tick.
    private func feedFromCache(_ hostTime: TimeInterval) -> Bool {
        guard pendingSwap else { return false }
        cacheLock.lock()
        let frames = headCache
        cacheLock.unlock()
        guard !frames.isEmpty else { return false }
        if !replaying { replaying = true; replayStartedAt = hostTime; replayFedPts = -1; lastReplayFrames = 0; replayIndex = 0 }
        // PACE BY SEQUENCE, NOT BY ABSOLUTE PTS (B606). The first version gated on
        // `pts <= elapsed`, which silently assumed the cache begins at pts 0. It does not: after
        // the opening pass the decoder never produces anything below ~0.116 again, so the cache
        // fills from there and every cached frame was still "in the future" for the whole 141ms
        // the replay had to work with. `lastReplayFrames: 0` with `lapsCovered: 28` — the replay
        // ran every lap and fed nothing, which is exactly why the take gap never moved.
        //
        // The cache is the head of the clip IN ORDER, so replaying it as a sequence at the source
        // frame interval reproduces the motion correctly whatever its absolute timestamps are.
        guard replayIndex < frames.count else { return false }
        let due = Double(replayIndex) * frameInterval
        guard hostTime - replayStartedAt >= due - 0.001 else { return false }
        let next = frames[replayIndex]
        replayIndex += 1
        replayFedPts = next.pts
        lastReplayFrames += 1
        let payload = next.data
        encodeQueue.async { [weak self] in self?.server.send(payload) }
        return true
    }

    // A SCRUB ABANDONS THE REPLAY. The cached frames are the head of the clip; if the operator has
    // jumped somewhere else, they are the wrong content and feeding them would fight the seek.
    private func endReplay() {
        replaying = false
        replayFedPts = -1
        replayIndex = 0
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
        DispatchQueue.main.async { self.parked = true; self.player?.pause(); call.resolve() }
    }

    @objc func resume(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.parked = false; self.player?.play(); call.resolve() }
    }

    @objc func seek(_ call: CAPPluginCall) {
        let t = call.getDouble("time") ?? 0
        DispatchQueue.main.async {
            self.endReplay()   // the cache holds the HEAD of the clip; a scrub is going elsewhere
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
    // LIVE, and deliberately so (Daniel, B605): the whole point of a tunable budget is comparing
    // 64MB against 128MB while the same clip loops, rather than across a pair of builds. Raising
    // it lets the cache top itself up on the next pass; lowering it trims immediately.
    @objc func setLoopCache(_ call: CAPPluginCall) {
        let mb = max(0, call.getInt("mb") ?? 64)
        DispatchQueue.main.async {
            self.cacheBudget = mb * 1024 * 1024
            self.cacheLock.lock()
            while self.headBytes > self.cacheBudget, let last = self.headCache.popLast() {
                self.headBytes -= last.data.count
            }
            if self.cacheBudget == 0 { self.headCache.removeAll(); self.headBytes = 0 }
            let n = self.headCache.count
            self.cacheLock.unlock()
            print("[FoldVideo] loop cache budget \(mb)MB — holding \(n) frames")
            call.resolve()
        }
    }

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
        // THE CACHE'S OWN ACCOUNT. `coveredMs` against `swapGapMs` is the whole reading: equal or
        // greater means the lap is fully filled, less means a partial fill and a shorter hold, and
        // zero with a budget set means it never got to store anything and must say so.
        cacheLock.lock()
        let held = headCache.count
        let bytes = headBytes
        let firstPts = headCache.first?.pts ?? -1
        let lastPts = headCache.last?.pts ?? -1
        // ⚠️ COVERAGE IS A DURATION, AND THIS USED TO REPORT A TIMESTAMP.
        // It was `Int(last.pts * 1000)` — the PTS of the newest cached frame, which is neither the
        // span (wrong whenever the cache does not start at 0) nor the playable duration (a frame
        // covers the interval AFTER its own timestamp, so N frames at 33ms cover N*33, not
        // (N-1)*33). It therefore under-reported by exactly one frame interval, and the `why`
        // string below compared that short figure against `swapGapMs` and **advised raising a
        // budget that was already sufficient.** An instrument that gives a wrong instruction is
        // worse than one that stays quiet.
        let span = held > 0 ? (lastPts - firstPts) + frameInterval : 0
        let covered = Int((span * 1000).rounded())
        cacheLock.unlock()
        out["loopCache"] = [
            "budgetMB": cacheBudget / (1024 * 1024),
            "frames": held,
            "heldMB": bytes / (1024 * 1024),
            "coveredMs": covered,
            // WHAT IS IN IT, not just how much. B605 reported `covering the lap` while feeding
            // nothing, because "300ms of frames" said nothing about WHERE those 300ms start.
            "firstPts": (firstPts * 1000).rounded() / 1000,
            "lastPts": (lastPts * 1000).rounded() / 1000,
            "frameIntervalMs": Int(frameInterval * 1000),
            // B690 — WHAT THE CACHE ASKED FOR AND WHY. Without this, a budget that is no longer
            // binding is indistinguishable from one that is: `heldMB` well under `budgetMB` could
            // mean "sized correctly" or "gave up early", and those want opposite responses.
            "headTargetMs": Int(headSeconds * 1000),
            "headTargetFrom": maxSwapGapMs > 0 ? "measured lap \(maxSwapGapMs)ms x1.5" : "floor (no lap measured yet)",
            "lapsCovered": lapsCovered,
            "lastReplayFrames": lastReplayFrames,
            "why": cacheBudget == 0 ? "disabled from the frame-cost panel"
                 : held == 0 ? "no head frames stored yet (the clip has not played through 0-0.3s)"
                 : firstPts > 0.02 ? "the cache starts at \(Int(firstPts * 1000))ms, not 0 — it can only repeat content the decoder was going to deliver anyway. The head of a clip is produced ONCE, on the opening pass, so if the cache was cleared (budget set to 0) mid-session it cannot rebuild itself: reload the clip."
                 : lastReplayFrames == 0 && lapsCovered > 0 ? "held frames but fed none on the last lap"
                 // the SAME number the report carries, so the advice and the reading cannot disagree
                 : swapGapMs > 0 && covered < swapGapMs ? "partial fill — \(covered)ms of a \(swapGapMs)ms lap; raise the budget"
                 : "covering the lap",
        ] as [String: Any]
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
        if let o = endObs { NotificationCenter.default.removeObserver(o); endObs = nil }
        parked = false
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
        swapAt = 0
        endReplay()
        cacheLock.lock(); headCache.removeAll(); headBytes = 0; cacheLock.unlock()
        lapsCovered = 0; lastReplayFrames = 0; replayIndex = 0; frameInterval = 1.0 / 30.0
    }
}
