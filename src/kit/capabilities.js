// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// kit/capabilities.js
//
// The capability profile: probe the runtime ONCE and answer the per-engine
// questions the app used to make as scattered point decisions (UA sniffs for the
// video-export capture path, the Firefox texture cap, …). One queryable table
// instead of N conditionals across M engines — and the natural home for
// per-platform feature locking as the runtime count grows (web WebKit/Gecko/Blink
// + Electron-Chromium + Capacitor-WKWebView).
//
// SCOPE: this owns the engine-IDENTITY + capture-path + texture-cap decisions that
// were genuinely sprinkled through the chrome. The pieces that are ALREADY
// single-sourced stay where they live (this module is the index that points at
// them — don't duplicate):
//   - encode support + per-resolution codec ceiling → `videoExportSupported` /
//     `pickVideoCodec` in shell/video-export.js (encoder-coupled, async).
//   - seek-based decode strategy → `seekVideoTo` in shell/video-source.js.
//   - readback strategy (fence vs finish) + the FBO/toBlob probe → engine/gl.js.
//
// Threaded onto `env.capabilities` by createApp; built once in the chrome from the
// engine's diagnostics. DOM-agnostic (navigator/location/engine.diagnostics only),
// so it sits in Kit.

// ---------------------------------------------------------------------------
// Edition + native-shell identity — the CROSS-SHELL gating seam.
//
// Two orthogonal axes decide what a build offers. NATIVE CAPABILITY (does the
// host provide Syphon/NDI/HDMI/native-camera?) is answered by `env.host.*`. The
// other axis is EDITION/TIER — is this a lite/pro/freemium build? — and it is
// deliberately platform-independent: the SAME edition flag is honored by the web,
// Electron, and Capacitor builds, so a future "Electron + iPad bundle without
// motion" or a freemium mobile tier is one flag BOTH chromes read, not per-shell
// special-casing. Kept engine-independent (navigator/globals/build-env only) so
// the phone chrome — which does not mount createApp — can import it directly.
//
// The edition is a BUILD-TIME choice (Vite replaces `import.meta.env.VITE_FOLD_EDITION`
// at `vite build`; a native shell sets it in its build env). `?edition=` overrides
// at runtime so the gates can be exercised in a browser without a rebuild.

export function resolveEdition() {
  const q = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('edition')) || '';
  if (q) return q;
  const built = (import.meta && import.meta.env && import.meta.env.VITE_FOLD_EDITION) || '';
  return built || 'web';
}

export const EDITION = resolveEdition();

// Native-shell identity, independent of the engine so BOTH chromes can read it.
// Capacitor injects `window.Capacitor` (isNativePlatform() is true only in the
// native runtime, so plain web stays false without bundling @capacitor/core); the
// Electron preload injects `window.foldHost`.
export function detectRuntime() {
  const w = typeof window !== 'undefined' ? window : {};
  const isCapacitor = !!(w.Capacitor && typeof w.Capacitor.isNativePlatform === 'function' && w.Capacitor.isNativePlatform());
  const isElectron = !!w.foldHost;
  return { isCapacitor, isElectron, isNative: isCapacitor || isElectron };
}

// Feature families an edition may WITHHOLD. Default (any edition not listed) =
// everything on, so the shipping 'web'/'desktop' builds are unaffected — this is
// the SEAM, not a paywall. The full gating map is a later, positioning-gated
// decision; 'lite' is a documented example that also drives the cross-shell proof
// (`?edition=lite` hides motion + perform in the mode picker).
const EDITION_FEATURES = {
  lite: { motion: false, perform: false },
};

export function editionAllows(feature) {
  const cfg = EDITION_FEATURES[EDITION];
  return !cfg || cfg[feature] !== false;
}

export function createCapabilities(engine) {
  const ua = navigator.userAgent;
  // WebKit = Safari / iPadOS proper — exclude the Chromium family and Firefox
  // (incl. their iOS shells CriOS/FxiOS, which are WebKit under the hood but
  // behave/choose differently for our capture path). Matches the long-standing
  // `defaultCaptureMode` sniff exactly.
  const isWebKit = /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox|FxiOS|CriOS/.test(ua);
  const isGecko = /Firefox\//i.test(ua);
  const isBlink = !isWebKit && !isGecko;   // Chromium family (and future Electron-Chromium)
  const engineId = isWebKit ? 'webkit' : isGecko ? 'gecko' : 'blink';

  const maxFBOSize = (engine && engine.diagnostics && engine.diagnostics.maxFBOSize) || 4096;
  const maxTextureSize = (engine && engine.diagnostics && engine.diagnostics.maxTextureSize) || 4096;

  // Video-export frame source per engine (was `defaultCaptureMode`): all WebKit is
  // far faster wrapping the WebGL canvas directly in a VideoFrame; Firefox+Chromium
  // prefer the 2D-canvas path. `?capture=2d|bitmap|gl` overrides (a safety hatch if
  // some older iOS device hangs on the WebGL-direct path).
  const captureOverride = new URLSearchParams(location.search).get('capture');
  const capturePath = (captureOverride === '2d' || captureOverride === 'bitmap' || captureOverride === 'gl')
    ? captureOverride
    : (isWebKit ? 'gl' : '2d');

  // Firefox with Resist Fingerprinting caps MAX_TEXTURE_SIZE at 8192 regardless of
  // hardware (was `isFirefoxCappedAt8K`): "browser is Firefox" + "max texture is
  // exactly 8192 (or lower)" is a strong signal of the RFP cap on a desktop GPU.
  const firefoxTextureCapped = isGecko && maxTextureSize <= 8192;

  return Object.freeze({
    engineId, isWebKit, isGecko, isBlink,
    capturePath,
    maxFBOSize, maxTextureSize,
    firefoxTextureCapped,
    edition: EDITION,
    ...detectRuntime(),
  });
}
