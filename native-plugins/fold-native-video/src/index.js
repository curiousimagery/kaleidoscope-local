// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// JS entry for the fold-native-video plugin — ONE native decode of a clip served
// to both webviews over a localhost socket (FYUV), consumed by the same receiver as
// the native camera (shell/native-camera-receiver.js) on the plugin's port.
//
// Transport rides this bridge, not the socket: start({path, loop}) → { port },
// stop(), pause(), resume(), seek({time}), setRate({rate}). Additive today; the
// source-swap (S3) wires motion/perform video through it on iOS with the JS <video>
// path kept as the fallback.

import { registerPlugin } from '@capacitor/core';

export const FoldNativeVideo = registerPlugin('FoldNativeVideo');
