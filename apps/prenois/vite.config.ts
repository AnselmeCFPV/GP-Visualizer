import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sirv from 'sirv';
import { defineConfig, type Plugin } from 'vite';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, '../..');
const dataDir = path.resolve(repoRoot, 'data');

function serveDataDir(): Plugin {
  const serve = sirv(dataDir, { dev: true, etag: true, single: false });
  return {
    name: 'serve-data-dir',
    configureServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        serve(req, res, next);
      });
    },
  };
}

export default defineConfig({
  root: appDir,
  publicDir: path.resolve(repoRoot, 'public'),
  plugins: [serveDataDir()],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(appDir, 'index.html'),
      },
    },
  },
  server: {
    open: true,
    fs: { allow: [repoRoot] },
  },
});
