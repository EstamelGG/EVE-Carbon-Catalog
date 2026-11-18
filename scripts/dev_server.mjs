import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'renderer', 'model-catalog', 'dist');
const site = path.join(root, 'public');
const assets = path.resolve(process.env.EVE_MODEL_ASSETS || 'E:/EVE-Model-Assets/public');
const port = Number(process.env.PORT || 9020);
const host = process.env.HOST || '127.0.0.1';
const origin = `http://${host}:${port}`;
const appConfig = JSON.parse(readFileSync(path.join(root, 'app-config.json'), 'utf8'));
const types = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.ktx2', 'image/ktx2'],
  ['.wasm', 'application/wasm'],
]);

if (!existsSync(path.join(assets, 'res', 'model-index.json')))
  throw new Error(`Local model assets not found: ${assets}`);

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendFile(res, file) {
  if (!file || !existsSync(file) || !statSync(file).isFile()) return false;
  res.writeHead(200, {
    'Content-Type': types.get(path.extname(file)) || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
  return true;
}

function renderIndex() {
  return readFileSync(path.join(site, 'index.html'), 'utf8').replace(
    /\{\{(appName|appVersion|appNameUpper)\}\}/g,
    (_, key) =>
      ({
        appName: appConfig.appName,
        appVersion: appConfig.appVersion,
        appNameUpper: appConfig.appName.toUpperCase(),
      })[key],
  );
}

createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, origin).pathname);
  if (pathname === '/' || pathname === '/index.html')
    return send(res, 200, renderIndex(), 'text/html; charset=utf-8');
  if (pathname === '/site-config.json')
    return send(
      res,
      200,
      JSON.stringify({
        resourceBaseURL: `${origin}/`,
        localResources: true,
        rendererModuleURL: `./eve-model-viewer.js?v=${Math.floor(statSync(path.join(dist, 'eve-model-viewer.js')).mtimeMs)}`,
      }),
      'application/json; charset=utf-8',
    );
  if (pathname === '/messages.mjs') {
    const body = readFileSync(path.join(site, 'messages.mjs'), 'utf8').replace(
      '"{{appTitle}}"',
      JSON.stringify(`${appConfig.appName} ${appConfig.appVersion}`),
    );
    return send(res, 200, body, 'text/javascript; charset=utf-8');
  }
  const relative = pathname.slice(1);
  if (relative.split('/').includes('..')) return send(res, 400, 'bad path');
  const file = [dist, assets, site].map((base) => path.join(base, relative)).find(existsSync);
  if (!sendFile(res, file)) send(res, 404, 'not found');
}).listen(port, host, () => {
  console.log(`Local assets: ${assets}`);
  console.log(`Dev site: ${origin}/`);
});
