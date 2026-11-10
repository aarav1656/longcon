import { createServer } from 'node:http';
import { resolve, sep } from 'node:path';
import { readTraction, TRACTION_CONTRACT } from '../src/traction.ts';

const root = resolve(process.argv[2]);
const contractId = process.argv[3] || TRACTION_CONTRACT;
const types: Record<string, string> = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/api/traction') {
      const data = await readTraction(url.searchParams.get('contract_id') || contractId);
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(data));
      return;
    }
    const path = resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/game.html' : url.pathname)}`);
    if (!path.startsWith(`${root}${sep}`)) throw new Error('path outside dist');
    const file = Bun.file(path);
    if (!(await file.exists())) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'content-type': types[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream' }).end(Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});
server.listen(0, '127.0.0.1', () => console.log(`READY ${server.address()?.port}`));
