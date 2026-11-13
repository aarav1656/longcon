import { RPC_POOL, forward } from '../../src/rpcproxy';

/** Same-origin JSON-RPC relay with a fallback pool, so the page never sees an upstream rate limit. */
export async function onRequestPost({ request }: { request: Request }): Promise<Response> {
  const body = await request.text();
  if (body.length > 20_000) return Response.json({ error: 'request too large' }, { status: 413 });
  const out = await forward(body, RPC_POOL);
  if (!out) {
    // Every upstream is limited right now: answer as a JSON-RPC rate limit (HTTP 200) so the page backs off and retries without a failed request.
    let id: unknown = null;
    try { id = JSON.parse(body).id ?? null; } catch { /* keep null */ }
    return Response.json({ jsonrpc: '2.0', id, error: { code: -32011, message: 'rate limit: every upstream node is busy, retry shortly' } }, { headers: { 'cache-control': 'no-store' } });
  }
  return new Response(out.body, { status: out.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
