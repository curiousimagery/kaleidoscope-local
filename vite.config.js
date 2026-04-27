// vite.config.js
// minimal Vite config — single-page app. dev server defaults to port 5173.
// build outputs to dist/ as static files; deployable as-is to Vercel/Netlify.

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
};
