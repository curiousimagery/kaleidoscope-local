// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// patch-node-syphon.cjs — postinstall hook.
//
// node-syphon@1.5.0's native publishImageData leaks one Metal texture per published
// frame (upstream issue https://github.com/benoitlahoz/node-syphon/issues/45 — it
// never releases the per-frame texture). Unfixed at the latest release. We carry a
// one-line native fix (local texture + release on GPU completion) built into the
// vendored binary beside this script, and copy it over the npm-installed one after
// every install (npm reverts node_modules otherwise).
//
// Vendored binary provenance: our fork of benoitlahoz/node-syphon @ 5074f0ab (patched
// src/addon/metal/MetalServer.mm), built with node-gyp + Command Line Tools. It is
// N-API, so it loads in both Node and Electron. NOTE: currently arm64-only (built on
// Apple Silicon); a universal binary is a packaging concern for distribution.
//
// REVERT (when the fix lands upstream): bump node-syphon to the fixed version in
// package.json, then delete this script, the "postinstall" hook, and vendor/. The
// dependency name is unchanged, so re-consuming their maintained package is that bump.

'use strict';

const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'vendor', 'node-syphon', 'syphon.node');
const dst = path.join(__dirname, '..', 'node_modules', 'node-syphon', 'dist', 'bin', 'syphon.node');

if (!fs.existsSync(dst)) {
  console.log('[patch-node-syphon] node-syphon not installed yet — skipping');
  process.exit(0);
}
if (!fs.existsSync(src)) {
  console.error('[patch-node-syphon] vendored binary missing:', src);
  process.exit(0); // don't fail the whole install over our patch
}

fs.copyFileSync(src, dst);
console.log('[patch-node-syphon] applied non-leaking syphon.node (upstream #45 fix)');
