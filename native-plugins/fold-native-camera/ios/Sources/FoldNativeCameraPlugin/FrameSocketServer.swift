// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// FrameSocketServer.swift
//
// Minimal localhost WebSocket PUSH server built on Network.framework's native
// NWProtocolWebSocket (no third-party dependency, no hand-rolled framing). One
// direction only: it streams binary biplanar-YUV frames to connected webview
// clients. Control commands ride the normal Capacitor bridge, not this socket,
// so the real-time path stays simple.
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
    private var clients: [ObjectIdentifier: Client] = [:]

    private final class Client {
        let conn: NWConnection
        var sending = false
        init(_ c: NWConnection) { conn = c }
    }

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
            listener.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
            listener.start(queue: self.queue)
            self.listener = listener
        }
    }

    func stop() {
        queue.async { [weak self] in
            guard let self = self else { return }
            for (_, client) in self.clients { client.conn.cancel() }
            self.clients.removeAll()
            self.listener?.cancel()
            self.listener = nil
        }
    }

    private func accept(_ conn: NWConnection) {
        let client = Client(conn)
        clients[ObjectIdentifier(conn)] = client
        conn.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled:
                self?.queue.async { self?.clients[ObjectIdentifier(conn)] = nil }
            default:
                break
            }
        }
        // We don't consume client messages, but keep receiving so the connection
        // stays open and close is observed.
        drain(conn)
        conn.start(queue: queue)
    }

    private func drain(_ conn: NWConnection) {
        conn.receiveMessage { [weak self] _, _, _, error in
            if error == nil { self?.drain(conn) }
        }
    }

    // Encode a biplanar-YUV pixel buffer and push it to every ready client. A
    // client that still has a send in flight is skipped (dropped frame) so latency
    // reflects true real-time capability instead of a growing queue.
    func sendFrame(_ pixelBuffer: CVPixelBuffer) {
        queue.async { [weak self] in
            guard let self = self, !self.clients.isEmpty else { return }
            guard let data = FrameSocketServer.encode(pixelBuffer) else { return }
            let meta = NWProtocolWebSocket.Metadata(opcode: .binary)
            let ctx = NWConnection.ContentContext(identifier: "frame", metadata: [meta])
            for (_, client) in self.clients {
                if client.sending { continue }
                client.sending = true
                client.conn.send(content: data, contentContext: ctx, isComplete: true,
                                 completion: .contentProcessed { [weak self] _ in
                    self?.queue.async { client.sending = false }
                })
            }
        }
    }

    private static func encode(_ pb: CVPixelBuffer) -> Data? {
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
