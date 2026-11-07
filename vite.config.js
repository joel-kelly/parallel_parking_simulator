import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built game works from any folder (or GitHub Pages).
  base: './',
  // Short commit id shown on the menu, so it's easy to tell which version is live.
  define: {
    __BUILD__: JSON.stringify((process.env.GITHUB_SHA || 'dev').slice(0, 7)),
  },
});
