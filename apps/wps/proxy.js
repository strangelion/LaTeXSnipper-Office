const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROXY_PORT = 28766;
const BRIDGE_HOST = '127.0.0.1';
const BRIDGE_PORT = 28765;
const TEMP_DIR = path.join(os.tmpdir(), 'latexsnipper');
const LOG_DIR = path.join(process.env.APPDATA, 'kingsoft', 'wps', 'jsaddons', 'latexsnipper-wps_1.0.0', 'logs');

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/log') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString());
        const logFile = path.join(LOG_DIR, 'debug.log');
        const ts = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z/, '');
        const line = ts + ' ' + (data.msg || '') + '\n';
        fs.appendFileSync(logFile, line, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/save-temp') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString());
        const fileName = data.name || ('latex_' + Date.now() + '.png');
        const filePath = path.join(TEMP_DIR, fileName);
        const buffer = Buffer.from(data.base64, 'base64');
        fs.writeFileSync(filePath, buffer);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: filePath }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'DELETE' && req.url.startsWith('/delete-temp')) {
    try {
      const url = new URL(req.url, `http://localhost`);
      const filePath = url.searchParams.get('path');
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }
    return;
  }

  const body = [];
  req.on('data', chunk => body.push(chunk));
  req.on('end', () => {
    const proxyReq = http.request({
      hostname: BRIDGE_HOST,
      port: BRIDGE_PORT,
      path: req.url,
      method: req.method,
      headers: req.headers
    }, proxyRes => {
      Object.keys(proxyRes.headers).forEach(key => {
        res.setHeader(key, proxyRes.headers[key]);
      });
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(proxyRes.statusCode);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', err => {
      console.error('[PROXY] Bridge error:', err.message);
      res.writeHead(502);
      res.end(JSON.stringify({ ok: false, error: 'Bridge unreachable: ' + err.message }));
    });

    if (body.length) proxyReq.write(Buffer.concat(body));
    proxyReq.end();
  });
});

server.listen(PROXY_PORT, BRIDGE_HOST, () => {
  console.log(`[PROXY] CORS proxy running at http://${BRIDGE_HOST}:${PROXY_PORT}`);
  console.log(`[PROXY] Forwarding to Bridge at ${BRIDGE_HOST}:${BRIDGE_PORT}`);
  console.log(`[PROXY] Temp dir: ${TEMP_DIR}`);
});
