// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// JS entry for the fold-native-camera plugin. The spike harness registers the
// plugin directly off @capacitor/core, so this is mostly for completeness /
// future consumers (the eventual host.nativeCamera seam).

import { registerPlugin } from '@capacitor/core';

export const FoldNativeCamera = registerPlugin('FoldNativeCamera');
