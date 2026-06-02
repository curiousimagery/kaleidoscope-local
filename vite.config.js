// vite.config.js
// minimal Vite config — single-page app. dev server defaults to port 5173.
// build outputs to dist/ as static files; deployable as-is to Vercel/Netlify.
//
// vite-plugin-pwa adds the web manifest + a service worker (offline precache)
// and the standalone install story. iOS standalone also needs the apple-* meta
// tags in index.html.

import { VitePWA } from 'vite-plugin-pwa';

export default {
  root: '.',
  base: './',         // relative paths so dist/ works from any subpath
  build: {
    outDir: 'dist',
    emptyOutDir: true,
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
