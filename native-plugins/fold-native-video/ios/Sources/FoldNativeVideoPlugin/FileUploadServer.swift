// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// FileUploadServer.swift  (fold-native-video)
//
// GETTING THE CLIP'S BYTES TO AVFoundation. `AVURLAsset` needs a file on disk, and a
// clip picked through a WKWebView `<input type=file>` is a Blob with no native path —
// so the bytes have to move. Daniel's call (2026-07-31): move them over a BINARY
// SOCKET, not base64 over the Capacitor bridge.
//
// Why: the bridge is the same transport that caps external-display staging at ~2GB
// today, and a 6min 4K clip can't even start over it. base64 inflates 4:3 and every
// chunk crosses a JSON boundary. A localhost WebSocket carries the raw bytes — the
// measured loopback rate on the NDI path is ~165MB/s, so ~12s for 2GB — with peak
// memory of one slice, because JS reads the File with `blob.slice()` (lazy, disk-
// backed) rather than materializing it. It also covers **Loop Builder baked clips**,
// which are Blobs that never existed as a file, so a native document picker (the
// zero-copy alternative) structurally cannot replace this.
//
// Protocol (deliberately tiny — WebSocket message boundaries do the framing, and one
// TCP connection preserves order, so there is nothing to reassemble):
//   1. bridge  beginUpload({name})   → { port, id }   opens/creates the temp file
//   2. socket  binary messages, in order, appended verbatim
//   3. bridge  finishUpload({id, bytes}) → { path }   resolves once `bytes` have landed
//
// Step 3 carries the expected total because the bridge and the socket are DIFFERENT
// channels: `finishUpload` can arrive while the last slices are still in flight. So it
// waits for the byte count to match rather than assuming the write queue is drained.

import Foundation
import Network

final class FileUploadServer {
    let port: Int
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "fold.video.upload")

    // one in-flight upload at a time — the app stages one clip
    private var handle: FileHandle?
    private var url: URL?
    private var uploadId: String?
    private var received: Int = 0
    private var waiter: ((URL?, Int) -> Void)?
    private var waitFor: Int = -1

    init(port: Int) { self.port = port }

    // Create (truncate) the destination and make sure the listener is up. Returns the id.
    func begin(name: String) -> String? {
        var out: String?
        queue.sync {
            closeFileLocked()
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("fold-video", isDirectory: true)
            // PURGE FIRST. Every clip load writes another full copy here and nothing was
            // ever deleting them — across a few test rounds with a 1.2GB clip that is many
            // GB of dead staging in the app container, and a nearly-full container makes
            // the whole app slow (Daniel's B500 session opened with three Fig -12710s, a
            // 5.4s networking-process launch and an immediately unresponsive web process).
            // One clip is staged at a time, so anything already in here is garbage.
            purgeLocked(dir)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let safe = name.isEmpty ? "clip.mp4" : name
            let dest = dir.appendingPathComponent(safe)
            FileManager.default.createFile(atPath: dest.path, contents: nil)
            guard let h = try? FileHandle(forWritingTo: dest) else { return }
            handle = h
            url = dest
            received = 0
            uploadId = UUID().uuidString
            out = uploadId
            startLocked()
        }
        return out
    }

    // Resolve once `bytes` have actually landed (or the wait times out).
    func finish(id: String, bytes: Int, timeout: TimeInterval = 120, done: @escaping (URL?, Int) -> Void) {
        queue.async { [weak self] in
            guard let self = self, self.uploadId == id else { done(nil, 0); return }
            if self.received >= bytes || bytes <= 0 {
                let u = self.url, n = self.received
                self.closeFileLocked()
                done(u, n)
                return
            }
            self.waitFor = bytes
            self.waiter = done
            self.queue.asyncAfter(deadline: .now() + timeout) { [weak self] in
                guard let self = self, let w = self.waiter else { return }   // already resolved
                self.waiter = nil
                self.waitFor = -1
                let u = self.url, n = self.received
                self.closeFileLocked()
                w(n > 0 ? u : nil, n)
            }
        }
    }

    func cancel() {
        queue.async { [weak self] in self?.closeFileLocked() }
    }

    // Drop every staged clip. Called before staging a new one and on plugin teardown.
    // NEVER PURGE OUT FROM UNDER AN IN-FLIGHT UPLOAD (B597).
    //
    // `stop()` purges on the principle that the staged copy dies with the decode that used
    // it, which is right when stopping is the last thing that happens. A Loop Builder bake
    // makes it the FIRST thing: B595 taught the bake to re-attach the native decode, so JS
    // now tears the old decode down and immediately begins staging the baked clip. The stop
    // hops through the main queue on its way here, so it can land AFTER `begin()` has
    // created the new file — and `purgeLocked` deletes everything in the directory
    // unconditionally.
    //
    // Writes to an unlinked file still succeed on Unix, so nothing failed loudly: the upload
    // "completed", `finishUpload` returned a path with no file behind it, AVURLAsset produced
    // no frames, and the receiver's 8s requireFrame window expired into the `<video>`
    // fallback. Daniel's B596 report is that state — `from <video>` with the staged panel dark.
    //
    // `begin()` already purges the directory before creating its file, so standing down here
    // when an upload owns the directory costs nothing and makes either ordering safe.
    func purge() {
        queue.async { [weak self] in
            guard let self = self else { return }
            if self.handle != nil { return }
            self.closeFileLocked()
            self.purgeLocked(FileManager.default.temporaryDirectory
                .appendingPathComponent("fold-video", isDirectory: true))
        }
    }

    private func purgeLocked(_ dir: URL) {
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: dir.path) else { return }
        for n in names { try? fm.removeItem(at: dir.appendingPathComponent(n)) }
    }

    // MARK: - internals (all on `queue`)

    private func closeFileLocked() {
        try? handle?.close()
        handle = nil
        url = nil
        uploadId = nil
        received = 0
        waiter = nil
        waitFor = -1
    }

    private func startLocked() {
        guard listener == nil else { return }
        let params = NWParameters.tcp
        let ws = NWProtocolWebSocket.Options()
        ws.autoReplyPing = true
        params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
        guard let nwPort = NWEndpoint.Port(rawValue: UInt16(port)),
              let l = try? NWListener(using: params, on: nwPort) else { return }
        l.newConnectionHandler = { [weak self] c in self?.accept(c) }
        l.start(queue: queue)
        listener = l
    }

    private func accept(_ c: NWConnection) {
        receive(c)
        c.start(queue: queue)
    }

    // Append every binary message in arrival order. One connection = ordered delivery,
    // so the file is byte-exact without any sequencing of our own.
    private func receive(_ c: NWConnection) {
        c.receiveMessage { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            if let d = data, !d.isEmpty, let h = self.handle {
                h.write(d)
                self.received += d.count
                if let w = self.waiter, self.waitFor >= 0, self.received >= self.waitFor {
                    self.waiter = nil
                    self.waitFor = -1
                    let u = self.url, n = self.received
                    self.closeFileLocked()
                    w(u, n)
                }
            }
            if error == nil { self.receive(c) }   // keep reading until the peer goes away
        }
    }
}
