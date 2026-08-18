// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// FoldDeviceVitalsPlugin — the device's own account of how close it is to a limit.
//
// WHY THIS IS ITS OWN PLUGIN and not bolted onto fold-native-video: vitals have to
// work when no video is loaded (an exhibit may be camera-driven, or idle), and
// coupling them to the video plugin would make the instrument vanish in half the
// scenarios worth measuring. It is also a conduit-layer concern — every future
// consumer app wants device vitals, and conduit/pressure.js + conduit/vitals.js
// already have the seam waiting.
//
// ⚠️ THE RIGHT NOUN FOR MEMORY IS HEADROOM, NOT FOOTPRINT. What ends a long run is
// the OS killing us, so the conserved quantity is how much room is left before that
// happens (`os_proc_available_memory`) — a boundary we do not own. Footprint is what
// we spent: it rises for good reasons and bad ones alike and never says how close
// the wall is. Both are reported; only headroom is meant to be concluded from.
//
// ⚠️ THERMAL IS A SET OF TRANSITIONS, NOT A LEVEL. "It went serious at 6m12s" is a
// finding; "it is serious now" is a readout. The level is available on demand for a
// glanceable warning, and every CHANGE is pushed as an event so a degradation can be
// lined up against the moment the device changed state.
//
// ⚠️ AN UNAVAILABLE READING PUBLISHES WHY, AND NEVER READS AS ZERO. This is the
// project's standing rule (DEBUGGING-PROTOCOL: anything that can decline to act must
// publish why) and here it is load-bearing: `os_proc_available_memory()` returns 0
// when the process is not memory-limited or the call is unsupported, and a literal 0
// would arrive in the report as "0MB headroom" — indistinguishable from a device
// about to be killed. Zero becomes `nil` plus a reason.

import Foundation
import Capacitor
import UIKit
import os

@objc(FoldDeviceVitalsPlugin)
public class FoldDeviceVitalsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FoldDeviceVitalsPlugin"
    public let jsName = "FoldDeviceVitals"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise)
    ]

    // Count of memory warnings this process has received. A jetsam kill and a random
    // crash are indistinguishable after the fact unless the warning announced itself,
    // so this rides along in every read as well as firing as an event.
    private var memoryWarnings = 0

    override public func load() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(thermalChanged),
            name: ProcessInfo.thermalStateDidChangeNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(memoryWarning),
            name: UIApplication.didReceiveMemoryWarningNotification, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    @objc private func thermalChanged() {
        // Pushed rather than polled: a transition's ONSET is the finding, and a 5s poll
        // can put it up to five seconds away from where it actually happened.
        notifyListeners("thermalChanged", data: snapshot())
    }

    @objc private func memoryWarning() {
        memoryWarnings += 1
        notifyListeners("memoryWarning", data: snapshot())
    }

    @objc func read(_ call: CAPPluginCall) {
        call.resolve(snapshot())
    }

    // MARK: - readings

    private func thermalName() -> String {
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: return "nominal"
        case .fair: return "fair"
        case .serious: return "serious"
        case .critical: return "critical"
        @unknown default: return "unknown"
        }
    }

    // Headroom before jetsam, in MB. Nil (with a reason) rather than 0 — see the header.
    private func availableMB() -> (Int?, String?) {
        let bytes = os_proc_available_memory()
        if bytes <= 0 {
            return (nil, "os_proc_available_memory returned 0 — not memory-limited in this context")
        }
        return (bytes / (1024 * 1024), nil)
    }

    // What we currently cost, per the kernel's own accounting (the number jetsam scores
    // against). Recorded, never concluded from on its own.
    private func footprintMB() -> Int? {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        let kr = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        guard kr == KERN_SUCCESS else { return nil }
        return Int(info.phys_footprint) / (1024 * 1024)
    }

    private func snapshot() -> [String: Any] {
        let (avail, why) = availableMB()
        var out: [String: Any] = [
            "thermal": thermalName(),
            "physicalMB": Int(ProcessInfo.processInfo.physicalMemory / (1024 * 1024)),
            "memoryWarnings": memoryWarnings,
            // Stamped at the SOURCE so the JS side can age it. A cached reading that has
            // stopped refreshing must not be readable as a live one.
            "at": Date().timeIntervalSince1970 * 1000,
        ]
        if let a = avail { out["availableMB"] = a }
        if let w = why { out["availableWhy"] = w }
        if let f = footprintMB() { out["footprintMB"] = f }
        else { out["footprintWhy"] = "task_info(TASK_VM_INFO) failed" }
        // Low-power mode changes the CPU/GPU ceiling, so a run under it is a different
        // device from a run without it and the report must be able to say which.
        out["lowPowerMode"] = ProcessInfo.processInfo.isLowPowerModeEnabled
        return out
    }
}
