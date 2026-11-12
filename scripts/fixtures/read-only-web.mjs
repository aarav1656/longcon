import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const [root, port] = process.argv.slice(2);
const rpc = 'https://test.rpc.fastnear.com';
const types = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'content-type' }); return res.end(); }
  if (req.url === '/rpc' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const call = JSON.parse(body);
    if (call.method !== 'query') { res.writeHead(403); return res.end(JSON.stringify({ error: 'read-only test RPC' })); }
    const upstream = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    res.writeHead(upstream.status, { 'content-type': 'application/json' });
    return res.end(await upstream.text());
  }
  if (req.url === '/activate' || req.url === '/relay') { res.writeHead(403, { 'content-type': 'application/json' }); return res.end('{"error":"read-only keyboard test"}'); }
  if (req.url === '/api/traction') { res.writeHead(204); return res.end(); }
  if (req.url === '/config.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ contract_id: 'longcon4-game.testnet', network: 'testnet', rpc: `http://127.0.0.1:${port}/rpc`, relayer: `http://127.0.0.1:${port}`, explorer: 'https://testnet.nearblocks.io' }));
  }
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^([.][.][/\\])+/, '');
  let file = join(root, path === '/' ? 'game.html' : path);
  try { if (!(await stat(file)).isFile()) throw new Error('not a file'); }
  catch { res.writeHead(404); return res.end('not found'); }
  let data = await readFile(file);
  if (file.endsWith('/game.html')) data = Buffer.from(data.toString().replace('<script type="module"', '<script>window.__pageErrors=[];addEventListener("error",e=>window.__pageErrors.push(e.message));addEventListener("unhandledrejection",e=>window.__pageErrors.push(String(e.reason)));</script><script type="module"'));
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(data);
}).listen(Number(port), '127.0.0.1');
