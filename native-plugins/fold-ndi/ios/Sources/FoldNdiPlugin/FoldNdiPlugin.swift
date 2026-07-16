// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// FoldNdiPlugin — publishes the program output as an NDI network source
// (Resolume Arena / OBS / any NDI receiver on the LAN lists it like a camera).
//
// Frame path (the native-camera frame socket REVERSED): start() creates the
// named NDI sender AND a localhost WebSocket RECEIVE server; the webview's
// output bus connects as the one client and streams raw RGBA frames. Control
// rides the normal Capacitor bridge; pixels never do (base64-over-bridge
// can't sustain 1080p30 — the loopback socket demonstrably can, it already
// carries the native camera's preview the other direction).
//
// Sends are ASYNC (NDIlib_send_send_video_async_v2) with two alternating
// native buffers: the SDK compresses/transmits frame N on its own thread
// while this queue receives frame N+1 — the async call only waits if N is
// still in flight, so the drain side stops paying compression serially (the
// wall Daniel measured: JS production ~60fps-capable, delivered 21fps). The
// copy into our buffer is the price of async lifetime (the SDK reads it
// until the NEXT send), ~1–2ms for FHD against the ~10ms+ compression it
// takes off this queue. A 5s drain profile prints to the Xcode console:
// frame gap (production+socket), copy, and send-wait (backpressure from the
// in-flight frame) — the numbers that decide the next drain lever.
//
// Frame wire format (16-byte header, little-endian after the magic):
//   [0..4)   magic "FNDI" (big-endian constant)
//   [4..8)   width  (u32)
//   [8..12)  height (u32)
//   [12..16) flags  (u32)  bit0 = topDown (NDI wants top-down; a bottom-up
//                          frame is row-flipped here before the send)
//   then RGBA pixels (width * height * 4 bytes)
//
// The NDI SDK links via the locally built ios/ndi.xcframework (a LICENSED
// install — see scripts/make-xcframework.sh); libndi is why the package links c++.

import Foundation
import Capacitor
import Network
import NDIlib

@objc(FoldNdiPlugin)
public class FoldNdiPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FoldNdiPlugin"
    public let jsName = "FoldNdi"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
    ]

    private var sender: NDIlib_send_instance_t?
    private var listener: NWListener?
    private var client: NWConnection?
    private let queue = DispatchQueue(label: "fold.ndi.socket")
    private static var ndiInitialized = false

    // double buffer for async sends — the SDK reads a frame's memory until the
    // NEXT async send, so the buffer two sends back is always free to reuse
    private var buf: [UnsafeMutableRawPointer?] = [nil, nil]
    private var bufCap: [Int] = [0, 0]
    private var bufIdx = 0

    // drain profile, 5s windows → Xcode console
    private var statFrames = 0
    private var statCopyMs = 0.0, statWaitMs = 0.0, statGapMs = 0.0
    private var statLastArrive: CFAbsoluteTime = 0
    private var statWindowStart: CFAbsoluteTime = 0

    @objc func start(_ call: CAPPluginCall) {
        let name = call.getString("name") ?? "Fold"
        queue.async { [weak self] in
            guard let self = self else { return }
            self.teardown()

            if !Self.ndiInitialized {
                guard NDIlib_initialize() else { call.reject("NDI failed to initialize"); return }
                Self.ndiInitialized = true
            }
            var created: NDIlib_send_instance_t?
            name.withCString { cName in
                var desc = NDIlib_send_create_t()
                desc.p_ndi_name = cName
                created = NDIlib_send_create(&desc)   // NDI copies the name during create
            }
            guard let send = created else { call.reject("could not create the NDI sender"); return }
            self.sender = send

            // localhost WS receive server on an ephemeral port — the webview streams frames in
            let params = NWParameters.tcp
            let ws = NWProtocolWebSocket.Options()
            ws.autoReplyPing = true
            ws.maximumMessageSize = 64 * 1024 * 1024   // a 4K RGBA frame is ~33MB
            params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
            guard let listener = try? NWListener(using: params, on: .any) else {
                NDIlib_send_destroy(send); self.sender = nil
                call.reject("could not open the frame socket")
                return
            }
            listener.newConnectionHandler = { [weak self] c in self?.accept(c) }
            listener.stateUpdateHandler = { [weak self, weak listener] state in
                guard let self = self else { return }
                if case .ready = state, let port = listener?.port?.rawValue {
                    call.resolve(["port": Int(port)])
                } else if case .failed(let err) = state {
                    self.teardown()
                    call.reject("frame socket failed: \(err.localizedDescription)")
                }
            }
            listener.start(queue: self.queue)
            self.listener = listener
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        queue.async { [weak self] in
            self?.teardown()
            call.resolve()
        }
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        queue.async { [weak self] in
            call.resolve(["running": self?.sender != nil])
        }
    }

    private func teardown() {
        client?.cancel(); client = nil
        listener?.cancel(); listener = nil
        // destroy FIRST — it synchronizes any in-flight async send, releasing
        // the buffer it references; only then is freeing the buffers safe
        if let s = sender { NDIlib_send_destroy(s); sender = nil }   // the source leaves the network
        for i in 0..<2 { buf[i]?.deallocate(); buf[i] = nil; bufCap[i] = 0 }
        statFrames = 0; statCopyMs = 0; statWaitMs = 0; statGapMs = 0
        statLastArrive = 0; statWindowStart = 0
    }

    private func accept(_ c: NWConnection) {
        client?.cancel()          // one producer (our own webview); a reconnect replaces it
        client = c
        c.start(queue: queue)
        receiveLoop(c)
    }

    private func receiveLoop(_ c: NWConnection) {
        c.receiveMessage { [weak self] data, _, _, error in
            guard let self = self, self.client === c else { return }
            if let data = data, error == nil {
                self.handleFrame(data)
                self.receiveLoop(c)
            } else {
                c.cancel()
                if self.client === c { self.client = nil }
            }
        }
    }

    private func handleFrame(_ data: Data) {
        let tArrive = CFAbsoluteTimeGetCurrent()
        guard let send = sender, data.count >= 16 else { return }
        let magic = data.withUnsafeBytes { $0.load(fromByteOffset: 0, as: UInt32.self) }
        guard magic.bigEndian == 0x464E_4449 else { return }   // "FNDI"
        let w = data.withUnsafeBytes { $0.load(fromByteOffset: 4, as: UInt32.self) }.littleEndian
        let h = data.withUnsafeBytes { $0.load(fromByteOffset: 8, as: UInt32.self) }.littleEndian
        let flags = data.withUnsafeBytes { $0.load(fromByteOffset: 12, as: UInt32.self) }.littleEndian
        let stride = Int(w) * 4
        guard w > 0, h > 0, data.count >= 16 + stride * Int(h) else { return }
        let topDown = (flags & 1) != 0
        let total = stride * Int(h)

        // this buffer was last sent TWO async calls ago — already released by
        // the intervening send's synchronization, so resizing/writing is safe
        let i = bufIdx
        if bufCap[i] < total {
            buf[i]?.deallocate()
            buf[i] = UnsafeMutableRawPointer.allocate(byteCount: total, alignment: 16)
            bufCap[i] = total
        }
        let dst = buf[i]!

        let tCopy = CFAbsoluteTimeGetCurrent()
        data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            let src = raw.baseAddress!.advanced(by: 16)
            if topDown {
                memcpy(dst, src, total)
            } else {
                // bottom-up producer (the wire is top-down since B364; kept for the contract)
                for y in 0..<Int(h) {
                    memcpy(dst.advanced(by: y * stride),
                           src.advanced(by: (Int(h) - 1 - y) * stride), stride)
                }
            }
        }

        var frame = NDIlib_video_frame_v2_t()
        frame.xres = Int32(w)
        frame.yres = Int32(h)
        frame.FourCC = NDIlib_FourCC_video_type_RGBA
        frame.frame_rate_N = 30000            // nominal; receivers pace on arrival
        frame.frame_rate_D = 1000
        frame.picture_aspect_ratio = Float(w) / Float(h)
        frame.frame_format_type = NDIlib_frame_format_type_progressive
        frame.timecode = NDIlib_send_timecode_synthesize
        frame.line_stride_in_bytes = Int32(stride)
        frame.p_data = dst.assumingMemoryBound(to: UInt8.self)

        let tSend = CFAbsoluteTimeGetCurrent()
        NDIlib_send_send_video_async_v2(send, &frame)   // waits only while the PREVIOUS frame is in flight
        let tEnd = CFAbsoluteTimeGetCurrent()
        bufIdx = 1 - i

        statFrames += 1
        statCopyMs += (tSend - tCopy) * 1000
        statWaitMs += (tEnd - tSend) * 1000
        if statLastArrive > 0 { statGapMs += (tArrive - statLastArrive) * 1000 }
        statLastArrive = tArrive
        if statWindowStart == 0 { statWindowStart = tArrive }
        let win = tArrive - statWindowStart
        if win >= 5 {
            let fps = Double(statFrames) / win
            print(String(format: "[FoldNdi] %.1f fps · frame gap %.1fms · copy %.1fms · send-wait %.1fms (%d frames / %.1fs)",
                         fps, statGapMs / Double(max(1, statFrames - 1)),
                         statCopyMs / Double(statFrames), statWaitMs / Double(statFrames),
                         statFrames, win))
            statFrames = 0; statCopyMs = 0; statWaitMs = 0; statGapMs = 0
            statWindowStart = tArrive
        }
    }
}
