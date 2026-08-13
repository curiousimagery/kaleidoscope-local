// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// FrameSocketServer.swift  (fold-native-video)
//
// Verbatim sibling of fold-native-camera's FrameSocketServer — the SAME localhost
// WebSocket PUSH server and the SAME "FYUV" wire format, so the existing JS
// consumer (shell/native-camera-receiver.js) decodes video frames with no change,
// just on a different port. One direction, MULTIPLE clients: the main webview's
// engine and the external-display (HDMI) webview both join and sample the SAME
// decoded frames — that's what kills the iPad double-decode (each webview no longer
// opens its own <video>). Control (start/seek/rate) rides the Capacitor bridge.
//
// Realtime discipline (per client): the decode tick calls wantsFrame() FIRST and
// skips the (expensive) encode when NO client is ready — and send() skips any client
// whose previous send is still in flight, so a slow client drops frames instead of
// building a queue (and can't stall a fast one).
//
// Frame wire format (little-endian header, then two raw planes):
//   [0..4)   magic "FYUW"   (the camera's clockless variant is "FYUV" — see below)
//   [4..8)   width   (u32)
//   [8..12)  height  (u32)
//   [12..16) yStride (u32)   bytes per row, luma plane (may be padded)
//   [16..20) cStride (u32)   bytes per row, chroma plane (interleaved Cb,Cr)
//   [20..24) cHeight (u32)   chroma plane row count (== height/2 for 420)
//   [24..32) pts      (f64)  presentation time of THIS frame, seconds into the clip
//   [32..40) duration (f64)  clip duration in seconds (0 = not known yet)
//   then Y plane  (yStride * height bytes)
//   then CbCr     (cStride * cHeight bytes)
//
// WHY THE EXTRA MAGIC: video's decode owns the motion runtime's master
// clock, and the receiver must be able to answer `currentTime` without a per-frame
// bridge round-trip. Stamping every frame is the cheapest possible answer — 16 bytes
// on a multi-MB frame — and a distinct magic means one JS receiver reads both sockets
//
// The camera used to be genuinely clockless ("FYUV", 24-byte header, no time). It is not any
// more: cinematic stabilization buffers frames, so arrival time is not capture time, and
// stamping arrival broke A/V sync in recordings. It now sends "FYUX" with the pts field at the
// SAME offset and in the SAME f64-seconds units as below, so both sockets parse identically.
// while an old consumer can never silently misparse a stamped frame as an unstamped one.

import Foundation
import Network
import CoreVideo

final class FrameSocketServer {
    let port: Int
    private var listener: NWListener?
    // ACCEPT ON ITS OWN QUEUE. `queue` is serial and each 4K frame is a 12.4MB send, so a
    // busy first client can occupy it for a long time — long enough that a SECOND client's
    // handshake never completes inside the JS receiver's 6s window. That is what stopped
    // the external display from joining port 8900 while the main webview was streaming
    // ("could not join the video stream: no native frames on port 8900" — Daniel, B501),
    // and it is exactly the fan-out this whole design exists to do.
    private let acceptQueue = DispatchQueue(label: "fold.video.accept")
    private let lock = NSLock()

    // one entry per connected consumer (main webview, external-display webview)
    private final class Client {
        let conn: NWConnection
        var sending = false
        // NOT BROADCASTABLE UNTIL `.ready`. See accept() — sending to a connection whose
        // WebSocket upgrade hasn't completed is how the external display starved.
        var ready = false
        var sentAt: TimeInterval = 0
        // THE CONSERVED QUANTITY ACROSS THE PROCESS BOUNDARY (B584). `send()` silently skips a
        // client whose previous frame is still in flight — correct behaviour, and completely
        // invisible from JS, where a starving consumer and a dead one look identical. Daniel's
        // B583 session had the app's client at `0.0 in/s` while the external client on the SAME
        // socket took 30/s, and nothing on either side could say which of the two it was.
        // `offered` counts frames this client was considered for, `taken` counts frames actually
        // handed to Network.framework. Their DIFFERENCE is the skip, and it is not inferable
        // from any count the webview can take on its own side of the wire.
        var offered: UInt64 = 0
        var taken: UInt64 = 0
        var lastTakenAt: TimeInterval = 0
        let joinedAt = Date().timeIntervalSinceReferenceDate
        let id: Int
        init(_ c: NWConnection, id: Int) { conn = c; self.id = id }
    }
    private var clients: [Client] = []
    private var joinSeq = 0
    // whole-socket totals, so a client that was REAPED (and is therefore no longer in `clients`)
    // still leaves a trace. Without this, a dropped consumer looks exactly like one that never
    // connected — the absence problem, one process boundary further out than usual.
    private var framesOffered: UInt64 = 0
    private var ticksNoTaker: UInt64 = 0
    private var reaped = 0
    private var lastReapAt: TimeInterval = 0
    // a send that never completes would latch `sending` forever and silently starve that
    // consumer; past this long we treat the client as wedged and drop it
    private let sendStallSeconds: TimeInterval = 6
    // THE PICTURE THAT IS CURRENTLY ON SCREEN, kept so a client joining a PAUSED source has
    // something to draw (B596).
    //
    // The decode tick only pushes when the output has a NEW pixel buffer, which is exactly
    // right while playing and leaves a newcomer with nothing while paused. B595 parked the
    // player on load (correctly — it had been playing since load and autoplayed the wall),
    // and that turned the latent case into the visible one: starting a broadcast from a
    // paused motion timeline joined the external view to a silent socket and it drew NOTHING.
    // Daniel: "the output display is blank but not autoplaying... as soon as i scrub the
    // motion timeline it shows the expected frame" — the scrub was the first event that
    // produced a buffer. His report carries the matching native warning:
    // "joined port 8900 but no frames yet — the decode may be stalled".
    //
    // One frame retained, replaced in place. A newcomer gets the current picture immediately
    // and a fresh one on the next tick if anything is moving.
    private var lastFrame: Data?

    init(port: Int) { self.port = port }

    func start() {
        acceptQueue.async { [weak self] in
            guard let self = self, self.listener == nil else { return }
            let params = NWParameters.tcp
            let ws = NWProtocolWebSocket.Options()
            ws.autoReplyPing = true
            params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
            guard let nwPort = NWEndpoint.Port(rawValue: UInt16(self.port)),
                  let listener = try? NWListener(using: params, on: nwPort) else { return }
            listener.newConnectionHandler = { [weak self] c in self?.accept(c) }
            listener.start(queue: self.acceptQueue)   // never blocked behind a frame send
            self.listener = listener
        }
    }

    func stop() {
        acceptQueue.async { [weak self] in
            guard let self = self else { return }
            self.lock.lock()
            for client in self.clients { client.conn.cancel() }
            self.clients.removeAll()
            self.lastFrame = nil   // a new clip must never prime a joiner with the old one's picture
            self.lock.unlock()
            self.listener?.cancel()
            self.listener = nil
        }
    }

    // WHY `ready` GATES THE BROADCAST (the bug that made 4K unbroadcastable).
    //
    // A client used to join the fan-out the instant its connection was accepted — before
    // `start()`, and therefore before the WebSocket upgrade had completed. The very next
    // decode tick would mark it `sending` and hand Network.framework a whole frame for a
    // connection that wasn't up yet. That send's completion never fired, `sending` latched
    // true, and the consumer never received another frame: it sat there until the JS
    // receiver's 6s window expired and reported "no native frames on port 8900".
    //
    // Why it looked like a RESOLUTION problem: the race is against the upgrade handshake.
    // With a 4K source the loopback is already carrying ~370MB/s to the first client, so
    // the newcomer's handshake routinely lost to the next 33ms tick and the join failed
    // every time. At 1080p the handshake usually won and the join worked — which is
    // exactly the pattern Daniel found (fails at every source-detail setting with a 4K
    // clip, succeeds at every setting with a 1080p clip). The source-detail cap could
    // never have helped: it bounds the engine's texture, not the wire.
    private func accept(_ c: NWConnection) {
        lock.lock()
        joinSeq += 1
        let client = Client(c, id: joinSeq)
        clients.append(client)
        lock.unlock()
        // one queue PER CLIENT: a slow consumer can no longer delay a fast one, and neither
        // can delay a new arrival
        let clientQueue = DispatchQueue(label: "fold.video.client.\(ObjectIdentifier(client).hashValue)")
        c.stateUpdateHandler = { [weak self] state in
            guard let self = self else { return }
            switch state {
            case .ready:
                self.lock.lock()
                client.ready = true
                let n = self.clients.filter { $0.ready }.count
                // hand over the current picture before the next tick, which may never come
                let priming = self.lastFrame
                if priming != nil { client.sending = true; client.sentAt = Date().timeIntervalSinceReferenceDate }
                self.lock.unlock()
                print("[FoldFrames:\(self.port)] client ready — \(n) receiving\(priming != nil ? " (primed with the current frame)" : " (no frame decoded yet)")")
                if let data = priming {
                    let meta = NWProtocolWebSocket.Metadata(opcode: .binary)
                    let ctx = NWConnection.ContentContext(identifier: "frame", metadata: [meta])
                    client.conn.send(content: data, contentContext: ctx, isComplete: true,
                                     completion: .contentProcessed { [weak self] _ in
                        guard let self = self else { return }
                        self.lock.lock(); client.sending = false; self.lock.unlock()
                    })
                }
            case .failed, .cancelled:
                self.lock.lock()
                self.clients.removeAll { $0 === client }
                let n = self.clients.filter { $0.ready }.count
                self.lock.unlock()
                print("[FoldFrames:\(self.port)] client gone — \(n) receiving")
            default:
                break
            }
        }
        drain(c)
        c.start(queue: clientQueue)
    }

    private func drain(_ c: NWConnection) {
        c.receiveMessage { [weak self] _, _, _, error in
            if error == nil { self?.drain(c) }
        }
    }

    // Called on the decode tick BEFORE encoding, so a dropped frame costs nothing
    // when no client is ready to take one.
    func wantsFrame() -> Bool {
        lock.lock(); defer { lock.unlock() }
        reapStalledLocked()
        let want = clients.contains { $0.ready && !$0.sending }
        if !want { ticksNoTaker &+= 1 }
        return want
    }

    func send(_ data: Data) {
        let now = Date().timeIntervalSinceReferenceDate
        lock.lock()
        reapStalledLocked()
        lastFrame = data           // the current picture, for whoever joins next
        framesOffered &+= 1
        // EVERY READY CLIENT WAS OFFERED THIS FRAME; only the idle ones take it. Counting the
        // offer separately from the take is the whole point — `taken` alone cannot distinguish
        // "this consumer is slow" from "this consumer is gone".
        for client in clients where client.ready { client.offered &+= 1 }
        let takers = clients.filter { $0.ready && !$0.sending }
        for client in takers {
            client.sending = true; client.sentAt = now
            client.taken &+= 1; client.lastTakenAt = now
        }
        lock.unlock()
        guard !takers.isEmpty else { return }
        let meta = NWProtocolWebSocket.Metadata(opcode: .binary)
        let ctx = NWConnection.ContentContext(identifier: "frame", metadata: [meta])
        for client in takers {
            client.conn.send(content: data, contentContext: ctx, isComplete: true,
                             completion: .contentProcessed { [weak self] _ in
                guard let self = self else { return }
                self.lock.lock(); client.sending = false; self.lock.unlock()
            })
        }
    }

    // READ FROM THE JS BRIDGE, WHICH IS NOT THE FRAME SOCKET (B584). That separation is the
    // point: when a consumer is starving on this socket, the bridge still answers, so the app
    // can report its own starvation. A diagnostic that travelled the same wire as the thing it
    // measures would go silent exactly when it mattered.
    func stats() -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        let now = Date().timeIntervalSinceReferenceDate
        // Int, not UInt64, at the bridge: the plugin result is JSON-serialized and UInt64 is not a
        // type the Capacitor bridge converts. Frame counters never approach Int64 anyway.
        return [
            "port": port,
            "offered": Int(framesOffered),
            "ticksNoTaker": Int(ticksNoTaker),
            // a REAPED client is gone from `clients`, so without these two a wedged consumer
            // and one that never joined are the same observation
            "reaped": reaped,
            "msSinceReap": lastReapAt > 0 ? Int((now - lastReapAt) * 1000) : -1,
            "clients": clients.map { c in
                [
                    "id": c.id,
                    "ready": c.ready,
                    "sending": c.sending,
                    "offered": Int(c.offered),
                    "taken": Int(c.taken),
                    "skipped": Int(c.offered &- c.taken),
                    "msSinceTaken": c.lastTakenAt > 0 ? Int((now - c.lastTakenAt) * 1000) : -1,
                    "ageMs": Int((now - c.joinedAt) * 1000),
                ] as [String: Any]
            },
        ]
    }

    // Caller holds `lock`. A completion that never fires would leave `sending` true for
    // good, which reads as "this consumer is busy" forever — a silent starve rather than a
    // visible failure. Cancelling makes it a disconnect the consumer can retry from.
    private func reapStalledLocked() {
        let now = Date().timeIntervalSinceReferenceDate
        let stalled = clients.filter { $0.sending && now - $0.sentAt > sendStallSeconds }
        guard !stalled.isEmpty else { return }
        for client in stalled { client.conn.cancel() }
        clients.removeAll { c in stalled.contains { $0 === c } }
        reaped += stalled.count
        lastReapAt = now
        print("[FoldFrames:\(port)] dropped \(stalled.count) stalled client(s) — \(clients.filter { $0.ready }.count) receiving")
    }

    // pts/duration in SECONDS. A non-finite value (an unloaded duration is
    // .indefinite) goes on the wire as 0 — "not known yet", which the receiver
    // treats as "keep the last good value" rather than seeking to zero.
    static func encode(_ pb: CVPixelBuffer, pts: Double, duration: Double) -> Data? {
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }

        guard CVPixelBufferGetPlaneCount(pb) >= 2,
              let yBase = CVPixelBufferGetBaseAddressOfPlane(pb, 0),
              let cBase = CVPixelBufferGetBaseAddressOfPlane(pb, 1) else { return nil }

        let width = CVPixelBufferGetWidth(pb)
        let height = CVPixelBufferGetHeight(pb)
        let yStride = CVPixelBufferGetBytesPerRowOfPlane(pb, 0)
        let cStride = CVPixelBufferGetBytesPerRowOfPlane(pb, 1)
        let cHeight = CVPixelBufferGetHeightOfPlane(pb, 1)
        let ySize = yStride * height
        let cSize = cStride * cHeight

        var out = Data(capacity: 40 + ySize + cSize)
        out.append(contentsOf: [0x46, 0x59, 0x55, 0x57]) // "FYUW" (stamped)
        for value in [width, height, yStride, cStride, cHeight] {
            var le = UInt32(value).littleEndian
            withUnsafeBytes(of: &le) { out.append(contentsOf: $0) }
        }
        for value in [pts, duration] {
            var bits = (value.isFinite ? value : 0).bitPattern.littleEndian
            withUnsafeBytes(of: &bits) { out.append(contentsOf: $0) }
        }
        out.append(Data(bytes: yBase, count: ySize))
        out.append(Data(bytes: cBase, count: cSize))
        return out
    }
}
