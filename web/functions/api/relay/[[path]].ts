import { DEFAULT_UPSTREAM, upstreamFor } from '../../../src/relayproxy';

interface Stub { fetch(request: Request): Promise<Response> }
interface Env { RELAYER_URL?: string; RELAY_PROXY_SECRET?: string; HUB?: { get(id: unknown): Stub; idFromName(name: string): unknown } }

/** Forwards the relayer routes from the page's own origin and tells the relayer which browser address asked, under a shared secret.
 *  With a HUB binding the call rides the WebSocket the relayer host holds open (scripts/hub-agent.ts); otherwise it goes to RELAYER_URL. */
export async function onRequest({ request, params, env }: { request: Request; params: { path?: string | string[] }; env: Env }): Promise<Response> {
  const url = upstreamFor(params.path, env.RELAYER_URL || DEFAULT_UPSTREAM, request.method);
  if (!url) return Response.json({ error: 'not found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  const headers = new Headers({ 'content-type': request.headers.get('content-type') ?? 'application/json' });
  if (env.RELAY_PROXY_SECRET) {
    headers.set('x-relay-proxy', env.RELAY_PROXY_SECRET);
    headers.set('x-client-ip', request.headers.get('cf-connecting-ip') ?? '');
  }
  try {
    const body = request.method === 'POST' ? await request.text() : undefined;
    const res = env.HUB
      ? await env.HUB.get(env.HUB.idFromName('relayer')).fetch(new Request(`https://hub.invalid/${[params.path].flat().join("/")}`, { method: request.method, headers, body }))
      : await fetch(url, { method: request.method, headers, body });
    return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ error: 'relayer unreachable' }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}
