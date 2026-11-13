import { RPC_POOL, forward } from '../../src/rpcproxy';

/** Same-origin JSON-RPC relay with a fallback pool, so the page never sees an upstream rate limit. */
export async function onRequestPost({ request }: { request: Request }): Promise<Response> {
  const body = await request.text();
  if (body.length > 20_000) return Response.json({ error: 'request too large' }, { status: 413 });
  const out = await forward(body, RPC_POOL);
  if (!out) return Response.json({ error: 'rpc unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  return new Response(out.body, { status: out.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
