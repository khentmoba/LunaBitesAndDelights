import { defineConfig } from 'astro/config';

// Static output only: Firebase Hosting serves build/app as files.
export default defineConfig({
  site: 'https://lunabitesanddelights.web.app',
  outDir: '../build/app',
  output: 'static',
  compressHTML: true,
  build: { format: 'directory', inlineStylesheets: 'always' },
  trailingSlash: 'ignore',
  devToolbar: { enabled: false },
});
