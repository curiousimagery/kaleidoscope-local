// vite.config.js
// minimal Vite config. TWO html entries: index.html (the app) and output.html
// (the chrome-free GPU output window — a second engine view that renders the live
// program; see src/output-view.js). dev server defaults to port 5173.
// build outputs to dist/ as static files; deployable as-is to Vercel/Netlify.
//
// vite-plugin-pwa adds the web manifest + a service worker (offline precache)
// and the standalone install story. iOS standalone also needs the apple-* meta
// tags in index.html.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { VitePWA } from 'vite-plugin-pwa';

const root = dirname(fileURLToPath(import.meta.url));

export default {
  root: '.',
  base: './',         // relative paths so dist/ works from any subpath (and file:// in Electron)
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        output: resolve(root, 'output.html'),
      },
    },
  },
  server: {
    port: 5173,
    open: false,      // don't auto-open browser
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['fold-icon.svg'],
      manifest: {
        name: 'Fold',
        short_name: 'Fold',
        description: 'A playground for visual symmetry.',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'fold-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
};
