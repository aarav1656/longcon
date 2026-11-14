interface Stub { fetch(request: Request): Promise<Response> }
interface Env { HUB?: { get(id: unknown): Stub; idFromName(name: string): unknown } }

/** Reports whether the relayer host holds its hub connection and answers: 200 with the contract and relayer account, or 503 with the reason. */
export async function onRequest({ env }: { env: Env }): Promise<Response> {
  const headers = { 'cache-control': 'no-store' };
  if (!env.HUB) return Response.json({ ok: false, relayer: 'no hub bound' }, { status: 503, headers });
  try {
    const res = await env.HUB.get(env.HUB.idFromName('relayer')).fetch(new Request('https://hub.invalid/health', { signal: AbortSignal.timeout(8000) }));
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json(res.ok ? { ok: true, hub: 'connected', ...body } : { ok: false, hub: 'offline', ...body }, { status: res.ok ? 200 : 503, headers });
  } catch {
    return Response.json({ ok: false, hub: 'unreachable' }, { status: 503, headers });
  }
}
