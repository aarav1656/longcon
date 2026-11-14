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
const BATCH_WINDOW_BLOCKS = Number(process.env.BATCH_WINDOW_BLOCKS ?? 40);
const MAX_BATCH = 8;
const inflight = new Set<number>();
const handled = new Set<number>();
const sealing = new Set<number>();
const forksHandled = new Set<number>();
const FORK_ANSWER_MS = Number(process.env.FORK_ANSWER_MS ?? 180_000);
let signatureFailures = 0;

function log(o: object) {
  const line = JSON.stringify({ t: new Date().toISOString(), ...o });
  console.log(line);
  if (metricsFile) appendFileSync(metricsFile, line + '\n');
}

interface Pending { id: number; merchant: number; batch: number | null; block: number }
interface BatchView { id: number; merchant: number; offer_ids: number[]; request_hash: string; block: number }

/** Sealing is open to anyone; the contract only accepts it once the oldest waiting offer has aged the window. */
async function seal(merchant: number, waiting: Pending[], head: number): Promise<boolean> {
  const oldest = Math.min(...waiting.map((o) => o.block));
  if (waiting.length < MAX_BATCH && head < oldest + BATCH_WINDOW_BLOCKS) return false;
  if (sealing.has(merchant)) return false;
  sealing.add(merchant);
  try {
    await acc.callFunction({ contractId, methodName: 'seal_batch', args: { merchant }, gas: 100_000_000_000_000n, deposit: 0n });
    log({ ev: 'sealed', merchant, waiting: waiting.length });
    return true;
  } catch (e: any) {
    log({ ev: 'seal_failed', merchant, error: String(e?.message ?? e).slice(0, 200) });
    return false;
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
  const a = await answer(cfg, body, b.offer_ids.length, deadline, (chatId, status) => log({ ev: 'attempt', batch: b.id, chat_id: chatId, status }));
  const t1 = Date.now();
  let res;
  try {
    res = await acc.callFunctionRaw({
      contractId,
      methodName: 'npc_resume_batch',
      args: { batch_id: b.id, response: a.response, signature: a.signature, kind: a.kind },
      gas: 300_000_000_000_000n,
      deposit: 0n,
    });
    signatureFailures = 0;
  } catch (e: any) {
    if (/signature does not verify/.test(String(e?.message ?? e)) && ++signatureFailures >= 3) {
      log({ ev: 'alert', what: 'signer_mismatch' });
      signatureFailures = 0;
    }
    throw e;
  }
  log({ ev: 'resumed', batch: b.id, offers: b.offer_ids.length, kind: a.kind, llm_ms: a.llmMs, sig_ms: a.sigMs, resume_tx_ms: Date.now() - t1, total_ms: Date.now() - t0, attempts: a.attempts, tx: (res as any)?.transaction?.hash });
}

interface ForkView { id: number; request_hash: string; cast: unknown[] }

/** A sealed fork is one request for two branches: the same signed answer resolves both, so it is fetched once. */
async function handleFork(id: number) {
  const t0 = Date.now();
  const f = await view<ForkView>(p, contractId, 'fork', { fork_id: id });
  const body: string = await view(p, contractId, 'fork_request', { fork_id: id });
  if (sha256Hex(body) !== f.request_hash) throw new Error('fork request body does not hash to the request_hash on chain');
  const a = await answer(cfg, body, f.cast.length, t0 + FORK_ANSWER_MS, (chatId, status) => log({ ev: 'attempt', fork: id, chat_id: chatId, status }));
  const t1 = Date.now();
  const res = await acc.callFunctionRaw({ contractId, methodName: 'fork_resume', args: { fork_id: id, response: a.response, signature: a.signature, kind: a.kind }, gas: 300_000_000_000_000n, deposit: 0n });
  log({ ev: 'fork_resumed', fork: id, kind: a.kind, llm_ms: a.llmMs, sig_ms: a.sigMs, resume_tx_ms: Date.now() - t1, total_ms: Date.now() - t0, attempts: a.attempts, tx: (res as any)?.transaction?.hash });
}

async function tickForks() {
  const open = await view<number[]>(p, contractId, 'open_forks');
  for (const id of open) {
    if (forksHandled.has(id)) continue;
    forksHandled.add(id);
    handleFork(id).catch((e) => {
      forksHandled.delete(id);
      log({ ev: 'fork_failed', fork: id, error: String(e?.message ?? e).slice(0, 300) });
    });
  }
}

async function tick() {
  const [pending, listed, block] = await Promise.all([
    view<Pending[]>(p, contractId, 'pending_offers'),
    view<BatchView[]>(p, contractId, 'open_batches'),
    p.viewBlock({ finality: 'final' }),
  ]);
  const head = block.header.height;
  const byMerchant = new Map<number, Pending[]>();
  for (const o of pending.filter((o) => o.batch === null)) byMerchant.set(o.merchant, [...(byMerchant.get(o.merchant) ?? []), o]);
  let sealed = false;
  for (const [merchant, waiting] of byMerchant) sealed = (await seal(merchant, waiting, head)) || sealed;
  // a batch sealed just now is answered in this pass instead of waiting a poll interval
  const batches = sealed ? await view<BatchView[]>(p, contractId, 'open_batches') : listed;
  const offers = sealed ? await view<Pending[]>(p, contractId, 'pending_offers') : pending;
  for (const b of batches) {
    if (handled.has(b.id) || inflight.has(b.id)) continue;
    handled.add(b.id);
    inflight.add(b.id);
    const oldest = Math.min(...offers.filter((o) => o.batch === b.id).map((o) => o.block), b.block);
    handle(b, head, oldest)
      .catch((e) => log({ ev: 'failed', batch: b.id, error: String(e?.message ?? e).slice(0, 300) }))
      .finally(() => inflight.delete(b.id));
  }
}

log({ ev: 'start', contract: contractId, model: cfg.model, base: cfg.baseUrl, sign_mode: cfg.signMode, worker: acc.accountId });
for (;;) {
  try {
    await tick();
    await tickForks();
  } catch (e: any) {
    log({ ev: 'tick_error', error: String(e?.message ?? e).slice(0, 200) });
  }
  await sleep(Number(process.env.POLL_MS ?? 1200));
}
