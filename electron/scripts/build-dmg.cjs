#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Nelson
//
// electron/scripts/build-dmg.cjs
//
// One command to cut a fresh, correctly-named Fold Live DMG:  npm run dist
//
// Names the DMG with the REAL app version (src/version.js — the single source of
// truth shown in the footer), NOT the electron shell's package.json version (0.1.0,
// which never changes and was confusingly stamped on the artifact). It reads VERSION
// from src/version.js and injects it into electron-builder via extraMetadata, so the
// default artifactName ("${productName}-${version}-${arch}.${ext}") becomes e.g.
// "Fold Live-0.10.21-arm64.dmg". Also re-applies the leak-fixed node-syphon binary
// and rebuilds the web app first, so the command is fully self-contained.

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const electronDir = path.join(__dirname, '..');
const root = path.join(electronDir, '..');

const vsrc = fs.readFileSync(path.join(root, 'src', 'version.js'), 'utf8');
const ver = (vsrc.match(/VERSION\s*=\s*['"]v?([\d.]+)['"]/) || [])[1];
const build = (vsrc.match(/BUILD\s*=\s*(\d+)/) || [])[1];
if (!ver) {
  console.error('[build-dmg] could not read VERSION from src/version.js — aborting');
  process.exit(1);
}
console.log(`[build-dmg] packaging Fold Live ${ver} (Build ${build}) → "Fold Live-${ver}-arm64.dmg"`);

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', cwd: electronDir });
const ebBin = path.join(electronDir, 'node_modules', '.bin', 'electron-builder');

// 0) ensure the leak-fixed node-syphon binary is vendored in (idempotent)
sh('node', ['scripts/patch-node-syphon.cjs']);
// 0b) build the native trackpad-gesture addon if its binary is missing (N-API →
//     ABI-stable, so one build serves Node and Electron alike)
const tpNode = path.join(electronDir, 'native', 'trackpad', 'build', 'Release', 'fold_trackpad.node');
if (!fs.existsSync(tpNode)) {
  console.log('[build-dmg] building the trackpad gesture addon…');
  execFileSync('npx', ['node-gyp', 'rebuild'], { stdio: 'inherit', cwd: path.join(electronDir, 'native', 'trackpad') });
}
// 0c) the NDI sender addon — needs the locally installed NDI SDK (the `sdk`
//     symlink → /Library/NDI SDK for Apple). Skipped, not fatal, when the SDK
//     isn't installed: the ndi bridge reports unavailable and the app simply
//     doesn't offer the NDI destination. NOTE for real distribution: the DMG
//     must BUNDLE the redistributable libndi (SDK redist/ + its terms) — today
//     the addon's rpath points at the local SDK install (fine on this machine).
const ndiHost = path.join(electronDir, 'node_modules', 'conduit', 'hosts', 'electron-ndi');
const ndiNode = path.join(ndiHost, 'build', 'Release', 'fold_ndi.node');
const ndiSdkLink = path.join(ndiHost, 'sdk');
const NDI_SDK = '/Library/NDI SDK for Apple';
if (!fs.existsSync(ndiNode) && fs.existsSync(NDI_SDK)) {
  console.log('[build-dmg] building the NDI sender addon…');
  // the space-free `sdk` symlink is BUILD-TIME-ONLY tooling (gyp can't take the
  // spaced /Library path): created here, removed below — it must never exist
  // while electron-builder packs node_modules (the asar walker follows it into
  // /Library and refuses the "unsafe path")
  fs.rmSync(ndiSdkLink, { force: true });
  fs.symlinkSync(NDI_SDK, ndiSdkLink);
  execFileSync('npx', ['node-gyp', 'rebuild'], { stdio: 'inherit', cwd: ndiHost });
}
fs.rmSync(ndiSdkLink, { force: true });
// 1) build the web app into ../dist
sh('npm', ['run', 'build', '--prefix', '..']);
// 2) package, injecting the real app version so the DMG name reflects the build
sh(ebBin, [`--config.extraMetadata.version=${ver}`]);
