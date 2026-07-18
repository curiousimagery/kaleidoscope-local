// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// JS entry for the conduit-ndi-capacitor plugin. The app's host implementation
// (src/shell/capacitor-host.js) registers the plugin directly off
// @capacitor/core (the proven pattern); this is for completeness.

import { registerPlugin } from '@capacitor/core';

export const FoldNdi = registerPlugin('FoldNdi');
