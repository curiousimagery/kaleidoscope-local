#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Daniel Nelson
#
# Builds ios/ndi.xcframework from the LOCALLY INSTALLED Vizrt NDI SDK
# (/Library/NDI SDK for Apple — a licensed install; the framework is
# .gitignored, never committed: run this once per machine / SDK update).
#
# The SDK ships ONE fat static lib (x86_64 + arm64) where arm64 = DEVICE and
# x86_64 = simulator; an xcframework needs them split per platform. NOTE: there
# is no arm64-SIMULATOR slice, so on Apple Silicon the simulator needs a
# Rosetta (x86_64) destination — device builds (Daniel's workflow) are native.
set -euo pipefail
SDK="/Library/NDI SDK for Apple"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$DIR/ios/ndi.xcframework"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

[ -d "$SDK/lib/iOS" ] || { echo "NDI SDK not found at $SDK (install it from ndi.video)"; exit 1; }

# headers + a modulemap so Swift can `import NDIlib`
mkdir -p "$TMP/include"
cp "$SDK/include/"*.h "$TMP/include/"
cat > "$TMP/include/module.modulemap" <<'MAP'
module NDIlib {
  header "Processing.NDI.Lib.h"
  export *
}
MAP

lipo -thin arm64  "$SDK/lib/iOS/libndi_ios.a" -output "$TMP/libndi_device.a"
lipo -thin x86_64 "$SDK/lib/iOS/libndi_ios.a" -output "$TMP/libndi_sim.a"

rm -rf "$OUT"
xcodebuild -create-xcframework \
  -library "$TMP/libndi_device.a" -headers "$TMP/include" \
  -library "$TMP/libndi_sim.a"    -headers "$TMP/include" \
  -output "$OUT"
echo "built $OUT"
