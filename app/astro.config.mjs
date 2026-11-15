import { defineConfig } from 'astro/config';
import { cpSync, createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));

// The kiosk shares its photos and fonts with the Flutter app until step 5 of
// specs/008-typescript-rewrite: images/ and assets/fonts/ stay where Flutter
// reads them and are copied into the build under /kiosk/.
const kioskAssets = [
  ['images', 'kiosk/images'],
  ['assets/fonts', 'kiosk/fonts'],
];

const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf' };

function kioskAssetsIntegration() {
  return {
    name: 'luna-kiosk-assets',
    hooks: {
      'astro:server:setup': ({ server }) => {
        server.middlewares.use((req, res, next) => {
          const path = decodeURIComponent((req.url ?? '').split('?')[0]);
          for (const [from, to] of kioskAssets) {
            if (!path.startsWith(`/${to}/`)) continue;
            const file = join(repo, from, path.slice(to.length + 2));
            if (existsSync(file) && statSync(file).isFile()) {
              res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
              createReadStream(file).pipe(res);
              return;
            }
          }
          next();
        });
      },
      'astro:build:done': ({ dir }) => {
        const out = fileURLToPath(dir);
        for (const [from, to] of kioskAssets) {
          mkdirSync(join(out, to), { recursive: true });
          cpSync(join(repo, from), join(out, to), {
            recursive: true,
            filter: (src) => !/\.(txt|md|json)$/.test(src),
          });
        }
      },
    },
  };
}

// Static output only: Firebase Hosting serves build/app as files.
export default defineConfig({
  site: 'https://lunabitesanddelights.web.app',
  outDir: '../build/app',
  output: 'static',
  compressHTML: false,
  build: { format: 'directory', inlineStylesheets: 'always' },
  trailingSlash: 'ignore',
  devToolbar: { enabled: false },
  integrations: [kioskAssetsIntegration()],
});
