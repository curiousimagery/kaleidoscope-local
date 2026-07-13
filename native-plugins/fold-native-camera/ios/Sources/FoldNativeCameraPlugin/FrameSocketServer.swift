// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// FrameSocketServer.swift
//
// Minimal localhost WebSocket PUSH server built on Network.framework's native
// NWProtocolWebSocket (no third-party dependency, no hand-rolled framing). One
// direction, one client (the webview): it streams binary biplanar-YUV frames.
// Control commands ride the normal Capacitor bridge, not this socket.
//
// Realtime discipline: the capture callback calls wantsFrame() FIRST and skips
// the (expensive) encode when a send is still in flight — so a slow link drops
// frames instead of building a queue, and the measured fps reflects the true
// sustainable rate. Encoding happens synchronously on the capture thread (the
// pixel buffer is only valid there); only the finished Data is handed to the
// socket queue.
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
    private var conn: NWConnection?
    private var hasClient = false
    private var sending = false

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
            self.conn?.cancel()
            self.conn = nil
            self.hasClient = false
            self.sending = false
            self.lock.unlock()
            self.listener?.cancel()
            self.listener = nil
        }
    }

    private func accept(_ c: NWConnection) {
        lock.lock()
        conn?.cancel()          // single client — a new connection replaces any prior
        conn = c
        hasClient = true
        sending = false
        lock.unlock()
        c.stateUpdateHandler = { [weak self] state in
            guard let self = self else { return }
            switch state {
            case .failed, .cancelled:
                self.lock.lock()
                if self.conn === c {
                    self.conn = nil
                    self.hasClient = false
                    self.sending = false
                }
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

    // Called on the capture thread BEFORE encoding, so a dropped frame costs nothing.
    func wantsFrame() -> Bool {
        lock.lock(); defer { lock.unlock() }
        return hasClient && !sending
    }

    func send(_ data: Data) {
        lock.lock()
        guard hasClient, !sending, let c = conn else { lock.unlock(); return }
        sending = true
        lock.unlock()
        let meta = NWProtocolWebSocket.Metadata(opcode: .binary)
        let ctx = NWConnection.ContentContext(identifier: "frame", metadata: [meta])
        c.send(content: data, contentContext: ctx, isComplete: true,
               completion: .contentProcessed { [weak self] _ in
            guard let self = self else { return }
            self.lock.lock(); self.sending = false; self.lock.unlock()
        })
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
