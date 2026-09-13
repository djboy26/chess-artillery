/**
 * Tiny static file server for CHESS ARTILLERY — no dependencies.
 *
 *   node serve.js            →  http://localhost:5173
 *   node serve.js 8080       →  http://localhost:8080
 *
 * The game is a single index.html, but it loads React / three / r3f as ES
 * modules, and browsers block module imports over file:// — so it needs to be
 * served over http. Any static server works; this one just saves you a choice.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.argv[2]) || 5173;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found: ' + rel);
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(buf);
  });
}).listen(PORT, () => {
  console.log('CHESS ARTILLERY → http://localhost:' + PORT);
});
