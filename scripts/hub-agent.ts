// Holds one outbound WebSocket to the Worker's relayer hub and answers each call from the local relayer, so the page's /api/relay needs no inbound tunnel.
// usage: HUB_SECRET=$(cat ~/.config/longcon/hub-secret) bun scripts/hub-agent.ts [wss://near-longcon.nearbuild.workers.dev/_hub/connect] [http://127.0.0.1:8790]
const [hub = 'wss://near-longcon.nearbuild.workers.dev/_hub/connect', relayer = 'http://127.0.0.1:8790'] = process.argv.slice(2);
const secret = process.env.HUB_SECRET;
if (!secret) { console.error('HUB_SECRET missing'); process.exit(1); }

function connect(delay = 1000) {
  const ws = new WebSocket(hub, { headers: { 'x-hub-secret': secret } } as unknown as string[]);
  let alive = Date.now();
  const watchdog = setInterval(() => { if (Date.now() - alive > 90_000) ws.close(); else if (ws.readyState === WebSocket.OPEN) ws.send('{"ping":1}'); }, 25_000);
  ws.onopen = () => { alive = Date.now(); delay = 1000; console.log(new Date().toISOString(), 'hub connected'); };
  ws.onmessage = async (m) => {
    alive = Date.now();
    const req = JSON.parse(String(m.data));
    if (!req.id) return;
    const headers: Record<string, string> = {};
    for (const k of ['content-type', 'x-relay-proxy', 'x-client-ip']) if (req.headers[k]) headers[k] = req.headers[k];
    try {
      const res = await fetch(relayer + req.path, { method: req.method, headers, body: req.body ?? undefined });
      ws.send(JSON.stringify({ id: req.id, status: res.status, type: res.headers.get('content-type'), body: await res.text() }));
    } catch (e) {
      ws.send(JSON.stringify({ id: req.id, status: 502, body: JSON.stringify({ error: 'relayer unreachable' }) }));
    }
  };
  ws.onclose = () => { clearInterval(watchdog); console.log(new Date().toISOString(), 'hub closed, retry'); setTimeout(() => connect(Math.min(delay * 2, 30_000)), delay); };
  ws.onerror = () => ws.close();
}
connect();
