// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// kit/wake-lock.js
//
// KEEP THE SCREEN AWAKE WHILE SOMETHING IS BEING OUTPUT.
//
// ⚠️ WHY THIS EXISTS (2026-08-19). Daniel's second 40-minute run was ruined by the iPad going to
// sleep mid-broadcast — *"the ipad went to sleep and paused the broadcast a few times"* — and the
// report could not say so: 217 samples repeated one frozen reading and read as a rock-steady run.
//
// **But the test is not the reason to fix it.** An eight-hour exhibit on an iPad requires the
// device to stay awake, and nothing in the app was asking it to. A gallery installation that
// blanks after fifteen minutes is not a performance problem to tune, it is the whole thing not
// working. Broadcasting to an external display does NOT keep iOS awake on its own; we measured it.
//
// The Screen Wake Lock API is the cheap path — supported on WebKit since 16.4, so it needs no
// native plugin and no Xcode cycle. It is also revoked automatically when the page is hidden, so
// the re-acquire on `visibilitychange` is required rather than defensive.
//
// ⚠️ AND IT PUBLISHES WHETHER IT WORKED. A wake lock that silently fails is worse than none: the
// operator believes the exhibit is safe. `state()` is exported into the diagnostic report so a
// blanked screen is diagnosable after the fact rather than mysterious.

let sentinel = null;
let want = false;
let why = 'not requested';
let acquiredAt = 0;
let releases = 0;      // how many times the OS took it back (each one is a visible risk window)

// ⚠️ 2026-08-19 — THE NATIVE PATH, BECAUSE THE WEB ONE DID NOT HOLD. Daniel's iPad slept 5-10
// minutes into a broadcast with the Screen Wake Lock in place: it is a Safari feature and is not
// reliably exposed inside a WKWebView. `UIApplication.isIdleTimerDisabled` is what an iOS app
// actually uses, and the native host injects it here at boot.
//
// Injected rather than imported so this module stays free of `env` and works identically in the
// web build, where it simply has no hook and falls back to the web API.
let nativeHook = null;   // async (on) => boolean actually applied
let nativeState = null;  // what the OS reported back, or an error string
export function setWakeLockHost(fn) { nativeHook = typeof fn === 'function' ? fn : null; }

async function applyNative(on) {
  if (!nativeHook) return false;
  try {
    const got = await nativeHook(on);
    // ⚠️ REPORT WHAT THE SYSTEM HOLDS, NOT WHAT WE ASKED FOR. A request that silently did not take
    // is the failure mode that cost a forty-minute run.
    nativeState = got === on ? (on ? 'held (native idle timer)' : 'released (native idle timer)')
                             : `asked ${on}, system reports ${got}`;
    return got === on;
  } catch (e) {
    nativeState = `native refused: ${e?.message || e}`;
    return false;
  }
}

const supported = () => typeof navigator !== 'undefined' && !!navigator.wakeLock?.request;

async function acquire() {
  if (!want || sentinel) return;
  if (!supported()) { why = 'navigator.wakeLock unavailable on this engine'; return; }
  try {
    sentinel = await navigator.wakeLock.request('screen');
    acquiredAt = Date.now();
    why = null;
    // The OS releases it on backgrounding; count it, because each release is time the screen
    // could have blanked and the run cannot be trusted across it.
    sentinel.addEventListener('release', () => { sentinel = null; releases++; if (want) why = 'released by the OS — will re-acquire when visible'; });
  } catch (e) {
    sentinel = null;
    why = `refused: ${e?.name || ''} ${e?.message || e}`.trim();
  }
}

// Re-acquire on visibility, because the OS revokes the lock whenever the page is hidden and does
// not hand it back. Registered once, at module load, and inert until something asks to stay awake.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (want && document.visibilityState === 'visible') acquire();
  });
}

// Ask for / drop the lock. Idempotent; callers can call it on every state change.
export function keepAwake(on) {
  want = !!on;
  // BOTH paths, deliberately. Native is the one that works on iOS; the web lock costs nothing and
  // is the only option on the web/Electron builds. Neither is trusted to be present.
  applyNative(want);
  if (want) { acquire(); return; }
  const s = sentinel;
  sentinel = null;
  why = 'not requested';
  try { s?.release?.(); } catch { /* already gone */ }
}

// Read by the perf panel's export.
export function wakeLockState() {
  return {
    // the native lock is the one that decides whether an iPad actually stays awake
    native: nativeState || (nativeHook ? 'not requested' : 'no native host on this build'),
    supported: supported(),
    wanted: want,
    held: !!sentinel,
    heldForSec: sentinel && acquiredAt ? Math.round((Date.now() - acquiredAt) / 1000) : 0,
    osReleases: releases,
    why: why || undefined,
  };
}
