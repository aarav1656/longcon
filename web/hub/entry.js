// Worker entry: the compiled Pages Functions plus a Durable Object that carries relayer calls over a WebSocket the relayer host dials out.
// The relayer host (scripts/hub-agent.ts) connects to /_hub/connect with the shared secret; /api/relay/* then reaches it at a fixed address.
import pages from './out/index.js';

export class Hub {
  constructor(state, env) { this.state = state; this.env = env; this.pending = new Map(); }

  async fetch(request) {
    if (request.headers.get('upgrade') === 'websocket') {
      if (!this.env.HUB_SECRET || request.headers.get('x-hub-secret') !== this.env.HUB_SECRET) return new Response('forbidden', { status: 403 });
      for (const old of this.state.getWebSockets()) old.close(1000, 'replaced');
      const [client, server] = Object.values(new WebSocketPair());
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    const ws = this.state.getWebSockets()[0];
    if (!ws) return Response.json({ error: 'relayer offline' }, { status: 503, headers: { 'cache-control': 'no-store' } });
    const url = new URL(request.url);
    const id = crypto.randomUUID();
    const body = request.method === 'POST' ? await request.text() : null;
    const reply = await new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve({ status: 504, body: '{"error":"relayer timed out"}' }); }, 120000);
      this.pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
      ws.send(JSON.stringify({ id, method: request.method, path: url.pathname + url.search, headers: Object.fromEntries(request.headers), body }));
    });
    return new Response(reply.body, { status: reply.status, headers: { 'content-type': reply.type || 'application/json', 'cache-control': 'no-store' } });
  }

  webSocketMessage(ws, data) {
    const m = JSON.parse(String(data));
    if (m.ping) { ws.send('{"pong":1}'); return; }
    const done = this.pending.get(m.id);
    if (done) { this.pending.delete(m.id); done(m); }
  }

  webSocketClose(ws) { ws.close(); }
}

export default {
  fetch(request, env, ctx) {
    if (new URL(request.url).pathname === '/_hub/connect') return env.HUB.get(env.HUB.idFromName('relayer')).fetch(request);
    return pages.fetch(request, env, ctx);
  },
};
