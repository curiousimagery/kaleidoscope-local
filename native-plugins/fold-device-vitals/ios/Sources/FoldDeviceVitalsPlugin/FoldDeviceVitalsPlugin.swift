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
        // ⚠️ B667 — RENAMED FROM `read`, ON EVIDENCE. B666 shipped `ping` purely to discriminate,
        // and it came back `pingOk: true` alongside `read`: 28 attempts, 28 timeouts, 0 errors.
        // So the bridge, the registration and the plugin instance are all fine and the failure is
        // specific to the NAME `read` — which is generic enough to collide. Renaming is now a
        // lever the evidence points at rather than a guess at one.
        CAPPluginMethod(name: "readVitals", returnType: CAPPluginReturnPromise),
        // ⚠️ B666 — A DISCRIMINATOR, NOT A FEATURE. `read` never settled once in 34 attempts on
        // device (34 timeouts, 0 errors, 0 empty resolves) while `notifyListeners` worked
        // perfectly in the same build. `ping` has a trivial body and a different name, so ONE
        // run separates "every bridge call to this plugin hangs" from "something about `read`".
        CAPPluginMethod(name: "ping", returnType: CAPPluginReturnPromise),
        // ⚠️ 2026-08-19 — NAMING COMPROMISE, FLAGGED RATHER THAN HIDDEN. Holding the screen awake
        // is not a "vital"; it is a device-level app setting. It lives here because this is already
        // the DEVICE plugin, and a fifth Capacitor package for two lines of Swift would cost an SPM
        // entry, a sync and a review for no separation anyone benefits from. If a third device
        // setting shows up, rename the package rather than keep stretching this one.
        //
        // **Why native at all:** `navigator.wakeLock` is the cheap path and it shipped first
        // (kit/wake-lock.js), but Screen Wake Lock is a Safari feature and is not reliably exposed
        // inside a WKWebView — Daniel's iPad slept 5-10 minutes into a broadcast with the web lock
        // in place. `UIApplication.isIdleTimerDisabled` is what an iOS app actually uses.
        CAPPluginMethod(name: "setIdleTimerDisabled", returnType: CAPPluginReturnPromise)
    ]

    // The push cadence. Deliberately faster than vitals.js's 10s sampler so a sample is never a
    // cycle behind, and slower than anything that would cost measurable power.
    private var pushTimer: Timer?

    // Count of memory warnings this process has received. A jetsam kill and a random
    // crash are indistinguishable after the fact unless the warning announced itself,
    // so this rides along in every read as well as firing as an event.
    private var memoryWarnings = 0

    override public func load() {
        // ⚠️ B668 — BATTERY, BECAUSE DANIEL FOUND A CEILING NOTHING WAS MEASURING. *"We're a couple
        // hours in on device testing where it's charging and outputting power at about the same rate
        // even when mostly idling, so one limit in our sustained thermal scenario will be if we
        // can't charge as fast as we output power."* That is the eight-hour exhibit case failing for
        // a reason that has nothing to do with frame rate, and no instrument we have would have seen
        // it — the run just ends. `level` over a long session IS the answer: flat or rising means the
        // supply is keeping up, falling means there is a wall the fps series cannot see.
        UIDevice.current.isBatteryMonitoringEnabled = true
        NotificationCenter.default.addObserver(
            self, selector: #selector(thermalChanged),
            name: ProcessInfo.thermalStateDidChangeNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(memoryWarning),
            name: UIApplication.didReceiveMemoryWarningNotification, object: nil)

        // ⚠️ B666 — THE PLUGIN PUSHES; IT DOES NOT WAIT TO BE ASKED. The JS side pulls through
        // `read()`, and on device that call hangs (see `ping` above). The PUSH channel works —
        // it is how the only native numbers we have ever seen arrived. So rather than block the
        // arc on diagnosing a bridge quirk, the reading now arrives on a native timer through the
        // channel that is known to work, and the JS cache already treats a push as authoritative.
        //
        // The pull stays wired and instrumented on purpose: `vitalsSeam` keeps counting its
        // timeouts, so we still learn the answer for free instead of papering over the question.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let t = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
                guard let self else { return }
                self.notifyListeners("vitals", data: self.snapshot())
            }
            RunLoop.main.add(t, forMode: .common)   // keeps ticking during scrolling/gestures
            self.pushTimer = t
            self.notifyListeners("vitals", data: self.snapshot())   // one immediately, so the cache warms at launch
        }
    }

    @objc func ping(_ call: CAPPluginCall) {
        // The build stamp ends the "is the Swift actually on the device" question permanently.
        // Bump it whenever this file changes; the JS compares it against its own build number.
        call.resolve(["ok": true, "swift": 677])
    }

    @objc func setIdleTimerDisabled(_ call: CAPPluginCall) {
        let want = call.getBool("disabled") ?? false
        // ⚠️ B677 — RESOLVE FIRST, THEN DO THE WORK, AND VERIFY THROUGH THE PUSH.
        //
        // The measured facts on this plugin: `ping` (resolves immediately, no dispatch) works;
        // `readVitals` and the B675 form of this method (both resolved AFTER the func returned)
        // never settle. **We do not know the mechanism** — the obvious suspects do not fit, since
        // `snapshot()` serialises fine through `notifyListeners` and hung even before any UIKit
        // call was in it. What we DO have is a shape that demonstrably works and a shape that
        // demonstrably does not, so this method now uses the working one.
        //
        // The read-back has not been abandoned, it has moved: `snapshot()` reports the system's
        // real `idleTimerDisabled` on the 5s push, which is the channel that has never failed. So
        // a request that did not take is still visible — one push later instead of immediately.
        call.resolve(["disabled": want])
        DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = want }
    }

    deinit { pushTimer?.invalidate(); NotificationCenter.default.removeObserver(self) }

    @objc private func thermalChanged() {
        // Pushed rather than polled: a transition's ONSET is the finding, and a 5s poll
        // can put it up to five seconds away from where it actually happened.
        notifyListeners("thermalChanged", data: snapshot())
    }

    @objc private func memoryWarning() {
        memoryWarnings += 1
        notifyListeners("memoryWarning", data: snapshot())
    }

    @objc func readVitals(_ call: CAPPluginCall) {
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
        // B677 — the wake lock's read-back, carried on the channel that works. `false` here while
        // the app believes it asked for `true` is the silent-failure case, now visible.
        out["idleTimerDisabled"] = UIApplication.shared.isIdleTimerDisabled
        // -1 means monitoring is off or the value is unavailable — reported as nil rather than as a
        // flat battery, the same rule the memory reading follows.
        let lvl = UIDevice.current.batteryLevel
        if lvl >= 0 { out["batteryPct"] = Int((lvl * 100).rounded()) }
        else { out["batteryWhy"] = "batteryLevel unavailable" }
        switch UIDevice.current.batteryState {
        case .charging: out["power"] = "charging"
        case .full: out["power"] = "full"
        case .unplugged: out["power"] = "unplugged"
        default: out["power"] = "unknown"
        }
        return out
    }
}
