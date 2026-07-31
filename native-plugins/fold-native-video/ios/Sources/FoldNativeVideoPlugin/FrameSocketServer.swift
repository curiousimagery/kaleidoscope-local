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
// WHY THE EXTRA MAGIC: the camera is CLOCKLESS (a live stream — "now" is the only
// time there is), so its "FYUV" frames carry no timestamp and its 24-byte header is
// unchanged. Video is the opposite: the decode owns the motion runtime's master
// clock, and the receiver must be able to answer `currentTime` without a per-frame
// bridge round-trip. Stamping every frame is the cheapest possible answer — 16 bytes
// on a multi-MB frame — and a distinct magic means one JS receiver reads both sockets
// while an old consumer can never silently misparse a stamped frame as an unstamped one.

import Foundation
import Network
import CoreVideo

final class FrameSocketServer {
    let port: Int
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "fold.video.socket")
    private let lock = NSLock()

    // one entry per connected consumer (main webview, external-display webview)
    private final class Client {
        let conn: NWConnection
        var sending = false
        init(_ c: NWConnection) { conn = c }
    }
    private var clients: [Client] = []

    init(port: Int) { self.port = port }

    func start() {
        queue.async { [weak self] in
            guard let self = self, self.listener == nil else { return }
            let params = NWParameters.tcp
            let ws = NWProtocolWebSocket.Options()
            ws.autoReplyPing = true
            params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
            guard let nwPort = NWEndpoint.Port(rawValue: UInt16(self.port)),
                  let listener = try? NWListener(using: params, on: nwPort) else { return }
            listener.newConnectionHandler = { [weak self] c in self?.accept(c) }
            listener.start(queue: self.queue)
            self.listener = listener
        }
    }

    func stop() {
        queue.async { [weak self] in
            guard let self = self else { return }
            self.lock.lock()
            for client in self.clients { client.conn.cancel() }
            self.clients.removeAll()
            self.lock.unlock()
            self.listener?.cancel()
            self.listener = nil
        }
    }

    private func accept(_ c: NWConnection) {
        let client = Client(c)
        lock.lock()
        clients.append(client)
        lock.unlock()
        c.stateUpdateHandler = { [weak self] state in
            guard let self = self else { return }
            switch state {
            case .failed, .cancelled:
                self.lock.lock()
                self.clients.removeAll { $0 === client }
                self.lock.unlock()
            default:
                break
            }
        }
        drain(c)
        c.start(queue: queue)
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
        return clients.contains { !$0.sending }
    }

    func send(_ data: Data) {
        lock.lock()
        let ready = clients.filter { !$0.sending }
        for client in ready { client.sending = true }
        lock.unlock()
        guard !ready.isEmpty else { return }
        let meta = NWProtocolWebSocket.Metadata(opcode: .binary)
        let ctx = NWConnection.ContentContext(identifier: "frame", metadata: [meta])
        for client in ready {
            client.conn.send(content: data, contentContext: ctx, isComplete: true,
                             completion: .contentProcessed { [weak self] _ in
                guard let self = self else { return }
                self.lock.lock(); client.sending = false; self.lock.unlock()
            })
        }
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
