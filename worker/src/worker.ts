import { appendFileSync } from 'node:fs';
import { account, env, provider, view } from './chain.ts';
import { answer, type LlmCfg } from './llm.ts';
import { sha256Hex, sleep } from './lib.ts';

const contractId = env('CONTRACT_ID');
const p = provider();
const acc = account('WORKER_ACCOUNT_ID', 'WORKER_PRIVATE_KEY');
const cfg: LlmCfg = {
  baseUrl: env('LLM_BASE_URL', 'https://cloud-api.near.ai/v1').replace(/\/$/, ''),
  apiKey: env('LLM_API_KEY'),
  model: env('LLM_MODEL'),
  signMode: env('SIGN_MODE', 'near-ai') as LlmCfg['signMode'],
  seed: process.env.WORKER_SIGNING_SEED,
};
const metricsFile = process.env.METRICS_FILE;
// a yield lives 200 blocks; the worker leaves this many blocks for the resume transaction itself
const YIELD_BLOCKS = 200;
const RESUME_MARGIN_BLOCKS = 25;
const BATCH_WINDOW_BLOCKS = Number(process.env.BATCH_WINDOW_BLOCKS ?? 6);
const MAX_BATCH = 8;
const inflight = new Set<number>();
const sealing = new Set<number>();

function log(o: object) {
  const line = JSON.stringify({ t: new Date().toISOString(), ...o });
  console.log(line);
  if (metricsFile) appendFileSync(metricsFile, line + '\n');
}

interface Pending { id: number; merchant: number; batch: number | null; block: number }
interface BatchView { id: number; merchant: number; offer_ids: number[]; request_hash: string; block: number }

/** Sealing is open to anyone; the contract only accepts it once the oldest waiting offer has aged the window. */
async function seal(merchant: number, waiting: Pending[], head: number) {
  const oldest = Math.min(...waiting.map((o) => o.block));
  if (waiting.length < MAX_BATCH && head < oldest + BATCH_WINDOW_BLOCKS) return;
  if (sealing.has(merchant)) return;
  sealing.add(merchant);
  try {
    await acc.callFunction({ contractId, methodName: 'seal_batch', args: { merchant }, gas: 100_000_000_000_000n, deposit: 0n });
    log({ ev: 'sealed', merchant, waiting: waiting.length });
  } catch (e: any) {
    log({ ev: 'seal_failed', merchant, error: String(e?.message ?? e).slice(0, 200) });
  } finally {
    sealing.delete(merchant);
  }
}

async function handle(b: BatchView, head: number, oldestOffer: number) {
  const t0 = Date.now();
  const blocksLeft = YIELD_BLOCKS - RESUME_MARGIN_BLOCKS - (head - oldestOffer);
  const deadline = t0 + Math.max(10_000, blocksLeft * 575);
  const body: string = await view(p, contractId, 'batch_body', { batch_id: b.id });
  if (sha256Hex(body) !== b.request_hash) throw new Error('request body does not hash to the request_hash on chain');
  const a = await answer(cfg, body, b.offer_ids.length, deadline);
  const t1 = Date.now();
  const res = await acc.callFunction({
    contractId,
    methodName: 'npc_resume_batch',
    args: { batch_id: b.id, response: a.response, signature: a.signature, kind: a.kind },
    gas: 300_000_000_000_000n,
    deposit: 0n,
  });
  log({ ev: 'resumed', batch: b.id, offers: b.offer_ids.length, kind: a.kind, llm_ms: a.llmMs, sig_ms: a.sigMs, resume_tx_ms: Date.now() - t1, total_ms: Date.now() - t0, attempts: a.attempts, tx: (res as any)?.transaction?.hash });
}

async function tick() {
  const [pending, batches, block] = await Promise.all([
    view<Pending[]>(p, contractId, 'pending_offers'),
    view<BatchView[]>(p, contractId, 'open_batches'),
    p.viewBlock({ finality: 'final' }),
  ]);
  const head = block.header.height;
  const byMerchant = new Map<number, Pending[]>();
  for (const o of pending.filter((o) => o.batch === null)) byMerchant.set(o.merchant, [...(byMerchant.get(o.merchant) ?? []), o]);
  for (const [merchant, waiting] of byMerchant) await seal(merchant, waiting, head);
  for (const b of batches) {
    if (inflight.has(b.id)) continue;
    inflight.add(b.id);
    const oldest = Math.min(...pending.filter((o) => o.batch === b.id).map((o) => o.block), b.block);
    handle(b, head, oldest)
      .catch((e) => log({ ev: 'failed', batch: b.id, error: String(e?.message ?? e).slice(0, 300) }))
      .finally(() => inflight.delete(b.id));
  }
}

log({ ev: 'start', contract: contractId, model: cfg.model, base: cfg.baseUrl, sign_mode: cfg.signMode, worker: acc.accountId });
for (;;) {
  try {
    await tick();
  } catch (e: any) {
    log({ ev: 'tick_error', error: String(e?.message ?? e).slice(0, 200) });
  }
  await sleep(Number(process.env.POLL_MS ?? 1200));
}
