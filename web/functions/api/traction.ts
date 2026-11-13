import { readTractionEvents, TRACTION_CONTRACT, type TractionState } from '../../src/traction';

interface Ctx { request: Request }
const FRESH_MS = 60_000;
const BUDGET_MS = 24_000;

interface Stored { state: TractionState; summary: { contract_id: string; finalized_height: number; pitches: number; loans: number; defaults: number } | null; at: number }

/** Finalized receipts never change, so the read is incremental: the last state is kept at the edge and a refresh fetches only new transactions. */
export async function onRequestGet(ctx: Ctx & { waitUntil: (p: Promise<unknown>) => void }): Promise<Response> {
  const contractId = new URL(ctx.request.url).searchParams.get('contract_id') || TRACTION_CONTRACT;
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(`https://traction.cache.invalid/${encodeURIComponent(contractId)}`);
  const hit = await cache.match(key);
  const stored: Stored = hit ? await hit.json() : { state: { seen: [], events: [] }, summary: null, at: 0 };
  const headers = { 'cache-control': 'no-store' };
  if (stored.summary && Date.now() - stored.at < FRESH_MS) return Response.json(stored.summary, { headers });

  const save = (s: Stored) => cache.put(key, new Response(JSON.stringify(s), { headers: { 'cache-control': 'max-age=31536000' } }));
  const work = readTractionEvents(contractId, stored.state, (state) => save({ ...stored, state })).then(async (r) => {
    await save({ state: r.state, summary: r.summary, at: Date.now() });
    return r.summary;
  });
  work.catch(() => undefined);
  ctx.waitUntil(work.catch(() => undefined));
  const first = await Promise.race([work.catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), BUDGET_MS))]);
  if (first) return Response.json(first, { headers });
  if (stored.summary) return Response.json(stored.summary, { headers });
  return Response.json({ contract_id: contractId, pending: true }, { headers });
}
