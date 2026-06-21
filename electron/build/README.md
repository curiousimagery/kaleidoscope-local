# DMG / app icon

`icon.png` here is the macOS app icon that `npm run dist` bakes into the DMG (via
electron-builder's `mac.icon` in `electron/package.json`).

**Current:** a placeholder rasterized from `public/fold-icon.svg` (1024×1024, white
mark on transparent — fine as a placeholder, but it reads poorly on light Finder
backgrounds, so replace it).

**To replace** (e.g. with an Apple Icon Composer export):
- Drop a **1024×1024 PNG** named `icon.png` here (electron-builder generates the
  `.icns` at build time), OR
- Drop a fully-formed `icon.icns` here and change `mac.icon` to `build/icon.icns`.

This is intentionally separate from the favicon (`public/favicon.svg`) and the
PWA/app mark (`public/fold-icon.svg`) — they share the mark today but each has its
own home so they can diverge (the app icon usually wants a background/treatment; the
favicon wants a simplified mark legible at 16px).
