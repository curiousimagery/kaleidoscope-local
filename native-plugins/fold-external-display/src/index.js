// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// JS entry for the fold-external-display plugin. The shell sink
// (src/shell/external-display.js) registers the plugin directly off
// @capacitor/core (the proven pattern from fold-native-camera); this is for
// completeness / future consumers.

import { registerPlugin } from '@capacitor/core';

export const FoldExternalDisplay = registerPlugin('FoldExternalDisplay');
