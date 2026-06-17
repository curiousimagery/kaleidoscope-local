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
  });
}
