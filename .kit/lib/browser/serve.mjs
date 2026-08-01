/**
 * serveStatic — the one static file server for every headless harness in the kit.
 *
 * Six near-identical copies of this existed across four projects: `game2/tools/capture.mjs`,
 * `survival/tools/{shot,perf,playthrough,vantage}.mjs`, `game/tools/serve.mjs` and
 * `Q/tools/serve.mjs`. They differed in exactly three ways — the MIME table, the cache
 * header, and whether the site was mounted under a sub-path — so all three are options here
 * and nothing else needed to vary.
 *
 * Binds 127.0.0.1 by default. A capture rig has no reason to be reachable from the network.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

/**
 * Union of the four projects' tables. `.mjs` matters most: served as
 * `application/octet-stream` a module script is rejected by the browser with a MIME error
 * that looks nothing like a MIME error, and two of the six copies were missing it.
 */
export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/**
 * @param {object} options
 * @param {string} options.root          Directory to serve. Nothing outside it is reachable.
 * @param {number} [options.port]        0 (default) takes an ephemeral port; read it back
 *                                       from the resolved `port` field.
 * @param {string} [options.basePath]    Mount point, e.g. `/Q`. Requests outside it 404 —
 *                                       that is the point: `survival` serves from
 *                                       `/cinderline-test` specifically to prove the build
 *                                       survives sub-directory hosting, which is how
 *                                       GitHub Pages actually serves a project site.
 * @param {string} [options.cacheControl] Defaults to `no-store`. A capture that re-reads a
 *                                       rebuilt `dist/` through a warm cache measures the
 *                                       previous build.
 * @param {object} [options.mime]        Extra or overriding MIME entries.
 * @returns {Promise<{server: import('node:http').Server, port: number, origin: string, close: () => Promise<void>}>}
 */
export function serveStatic({
  root,
  port = 0,
  basePath = '/',
  cacheControl = 'no-store',
  mime = {},
  host = '127.0.0.1',
} = {}) {
  if (!root) throw new Error('serveStatic: root is required');
  const rootAbs = resolve(root);
  const types = { ...MIME, ...mime };
  const base = basePath === '/' ? '' : `/${basePath.replace(/^\/+|\/+$/g, '')}`;

  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

      if (base) {
        if (path === base) path = '/';
        else if (path.startsWith(`${base}/`)) path = path.slice(base.length);
        else { res.writeHead(404, { 'content-type': 'text/plain' }).end('404'); return; }
      }
      if (path.endsWith('/')) path += 'index.html';

      const file = join(rootAbs, normalize(path));
      // `file.startsWith(rootAbs)` alone lets `/rootevil` through when root is `/root`.
      // Require the separator (or an exact match) so the guard means what it reads as.
      if (file !== rootAbs && !file.startsWith(rootAbs + sep)) {
        res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden');
        return;
      }

      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }).end('404'); return; }

      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': types[extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': cacheControl,
        'content-length': body.length,
      }).end(body);
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(String(error));
    }
  });

  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => {
      const actual = server.address().port;
      done({
        server,
        port: actual,
        origin: `http://${host}:${actual}${base}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
