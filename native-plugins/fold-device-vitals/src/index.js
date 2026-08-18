// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// JS entry for the fold-device-vitals plugin. The host seam
// (src/shell/capacitor-host.js) registers the plugin directly off
// @capacitor/core, matching the fold-native-camera precedent; this is for
// completeness / future conduit consumers.

import { registerPlugin } from '@capacitor/core';

export const FoldDeviceVitals = registerPlugin('FoldDeviceVitals');
