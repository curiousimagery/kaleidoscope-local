// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// FrameSocketServer.swift
//
// Minimal localhost WebSocket PUSH server built on Network.framework's native
// NWProtocolWebSocket (no third-party dependency, no hand-rolled framing). One
// direction, MULTIPLE clients: the main webview renders the preview, and the
// external-display webview (HDMI out) joins as a SECOND consumer of the same
// frames — that's how the live native camera reaches the external screen
// (frames can't cross WKWebViews any other way without readback). Control
// commands ride the normal Capacitor bridge, not this socket.
//
// Realtime discipline (per client): the capture callback calls wantsFrame()
// FIRST and skips the (expensive) encode when NO client is ready — and send()
// skips any client whose previous send is still in flight, so a slow client
// drops frames instead of building a queue (and can't stall a fast one).
// Encoding happens synchronously on the capture thread (the pixel buffer is
// only valid there); only the finished Data is handed to the socket queue.
//
// Frame wire format (little-endian header, then two raw planes):
//   [0..4)   magic "FYUV"
//   [4..8)   width   (u32)   image width in px
//   [8..12)  height  (u32)   image height in px
//   [12..16) yStride (u32)   bytes per row, luma plane (may be padded)
//   [16..20) cStride (u32)   bytes per row, chroma plane (interleaved Cb,Cr)
//   [20..24) cHeight (u32)   chroma plane row count (== height/2 for 420)
//   then Y plane  (yStride * height bytes)
//   then CbCr     (cStride * cHeight bytes)

import Foundation
import Network
import CoreVideo

final class FrameSocketServer {
    let port: Int
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "fold.camera.socket")
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

    // Called on the capture thread BEFORE encoding, so a dropped frame costs
    // nothing when no client is ready to take one.
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

    static func encode(_ pb: CVPixelBuffer) -> Data? {
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

        var out = Data(capacity: 24 + ySize + cSize)
        out.append(contentsOf: [0x46, 0x59, 0x55, 0x56]) // "FYUV"
        for value in [width, height, yStride, cStride, cHeight] {
            var le = UInt32(value).littleEndian
            withUnsafeBytes(of: &le) { out.append(contentsOf: $0) }
        }
        out.append(Data(bytes: yBase, count: ySize))
        out.append(Data(bytes: cBase, count: cSize))
        return out
    }
}
