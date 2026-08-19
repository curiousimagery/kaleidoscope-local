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

// ⚠️ B676 — THE TIMEOUT, AND I SHIPPED THIS EXACT BUG TWO BUILDS AGO. B664 fixed a hung Capacitor
// bridge call in `capacitor-host.js` by racing it against a deadline, and then B675 wrote a fresh
// `await` here with no deadline at all. Daniel's report came back `native: "not requested"` — which
// in this file meant only "nativeState was never set", and that is true both when the call was
// never made AND when it was made and never settled. **An absence that cannot say which is not
// evidence**, which is the standing rule this project keeps re-learning.
//
// It matters here because this plugin's `read()` hangs rather than rejecting (28 timeouts, 0
// errors), so an unknown method — the shape you get when the JS shipped but the Swift did not —
// looks exactly like silence.
const NATIVE_MS = 3000;

async function applyNative(on) {
  if (!nativeHook) { nativeState = 'no native host on this build'; return false; }
  nativeState = 'requesting…';
  try {
    const got = await Promise.race([
      Promise.resolve(nativeHook(on)),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), NATIVE_MS)),
    ]);
    // ⚠️ REPORT WHAT THE SYSTEM HOLDS, NOT WHAT WE ASKED FOR. A request that silently did not take
    // is the failure mode that cost a forty-minute run.
    nativeState = got === on ? (on ? 'held (native idle timer)' : 'released (native idle timer)')
                             : `asked ${on}, system reports ${got}`;
    return got === on;
  } catch (e) {
    nativeState = String(e?.message) === 'timeout'
      // Names the most likely cause in the report itself, because the operator is the only one who
      // can check it and "timeout" alone would send them looking in the wrong place.
      ? 'native call never settled — is the Swift half built? (JS can ship without it)'
      : `native refused: ${e?.message || e}`;
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
    // ⚠️ MEASURED, NOT ASSUMED (2026-08-19): in the Capacitor WKWebView `navigator.wakeLock` EXISTS
    // (`supported: true`) and then denies the request outright — `NotAllowedError: Permission was
    // denied`. So the API being present says nothing about it being usable, and the web path is
    // dead on the runtime that matters. It stays for web and Electron, where it is the only option,
    // and its failure here is expected rather than a fault to chase.
    const denied = e?.name === 'NotAllowedError';
    why = denied
      ? 'web lock denied by WKWebView (expected on device — the native idle timer is the real one)'
      : `refused: ${e?.name || ''} ${e?.message || e}`.trim();
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
    native: nativeState || (nativeHook ? 'not requested yet' : 'no native host on this build'),
    supported: supported(),
    wanted: want,
    held: !!sentinel,
    heldForSec: sentinel && acquiredAt ? Math.round((Date.now() - acquiredAt) / 1000) : 0,
    osReleases: releases,
    why: why || undefined,
  };
}
