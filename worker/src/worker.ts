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
const YIELD_BUDGET_MS = Number(process.env.YIELD_BUDGET_MS ?? 100_000);
const inflight = new Set<number>();

function log(o: object) {
  const line = JSON.stringify({ t: new Date().toISOString(), ...o });
  console.log(line);
  if (metricsFile) appendFileSync(metricsFile, line + '\n');
}

async function handle(offer: { id: number; request_hash: string }) {
  const t0 = Date.now();
  const deadline = t0 + YIELD_BUDGET_MS;
  const body: string = await view(p, contractId, 'request_body', { offer_id: offer.id });
  if (sha256Hex(body) !== offer.request_hash) throw new Error('request body does not hash to the request_hash on chain');
  const a = await answer(cfg, body, deadline);
  const t1 = Date.now();
  const res = await acc.callFunction({
    contractId,
    methodName: 'npc_resume',
    args: { offer_id: offer.id, response: a.response, signature: a.signature, kind: a.kind },
    gas: 300_000_000_000_000n,
    deposit: 0n,
  });
  log({ ev: 'resumed', offer: offer.id, kind: a.kind, llm_ms: a.llmMs, sig_ms: a.sigMs, resume_tx_ms: Date.now() - t1, total_ms: Date.now() - t0, attempts: a.attempts, tx: (res as any)?.transaction?.hash });
}

async function tick() {
  const pending: { id: number; request_hash: string }[] = await view(p, contractId, 'pending_offers');
  for (const o of pending) {
    if (inflight.has(o.id)) continue;
    inflight.add(o.id);
    handle(o)
      .catch((e) => log({ ev: 'failed', offer: o.id, error: String(e?.message ?? e).slice(0, 300) }))
      .finally(() => inflight.delete(o.id));
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
