import { signedText, sha256Hex, signWithSeed, sleep, readable, type SigKind } from './lib.ts';

export interface LlmCfg {
  baseUrl: string;
  apiKey: string;
  model: string;
  signMode: 'near-ai' | 'worker';
  seed?: string;
}

export interface Answered {
  response: string;
  signature: string;
  kind: SigKind;
  chatId: string;
  llmMs: number;
  sigMs: number;
  attempts: number;
}

async function post(cfg: LlmCfg, body: string): Promise<{ text: string; status: number }> {
  const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` };
  if (cfg.signMode === 'near-ai') headers['x-no-aliasing'] = 'true';
  const r = await fetch(`${cfg.baseUrl}/chat/completions`, { method: 'POST', headers, body });
  return { text: await r.text(), status: r.status };
}

async function nearAiSignature(
  cfg: LlmCfg,
  chatId: string,
  expected: (kind: SigKind) => string,
  deadline: number,
): Promise<{ signature: string; kind: SigKind }> {
  const url = `${cfg.baseUrl}/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(cfg.model)}&signing_algo=ed25519`;
  let last = '';
  while (Date.now() < deadline) {
    const r = await fetch(url, { headers: { authorization: `Bearer ${cfg.apiKey}` } });
    const raw = await r.text();
    if (r.ok) {
      const j = JSON.parse(raw);
      const kind: SigKind = j.signature_kind === 'gateway' ? 'gateway' : 'provider_tee';
      if (j.text !== expected(kind)) throw new Error(`signed text ${String(j.text).slice(0, 90)} is not the hash of what we sent and received`);
      return { signature: String(j.signature).replace(/^0x/, ''), kind };
    }
    last = `${r.status} ${raw.slice(0, 120)}`;
    await sleep(700);
  }
  throw new Error(`signature never became available: ${last}`);
}

/**
 * Send the contract-built request byte for byte, then obtain a signature over
 * model:sha256(request):sha256(response). Retries the model while the answer is unreadable and
 * the deadline allows.
 */
export async function answer(cfg: LlmCfg, requestBody: string, deadline: number): Promise<Answered> {
  const reqHash = sha256Hex(requestBody);
  let attempts = 0;
  let lastErr = 'no attempt';
  while (Date.now() < deadline - 8000) {
    attempts++;
    const t0 = Date.now();
    const { text, status } = await post(cfg, requestBody);
    const llmMs = Date.now() - t0;
    if (status !== 200) {
      lastErr = `model endpoint ${status}: ${text.slice(0, 200)}`;
      await sleep(1000);
      continue;
    }
    if (!readable(text)) {
      lastErr = 'answer had no readable verdict';
      continue;
    }
    const respHash = sha256Hex(text);
    const t1 = Date.now();
    if (cfg.signMode === 'worker') {
      if (!cfg.seed) throw new Error('worker signing needs WORKER_SIGNING_SEED');
      const signature = signWithSeed(cfg.seed, signedText('provider_tee', cfg.model, reqHash, respHash));
      return { response: text, signature, kind: 'provider_tee', chatId: JSON.parse(text).id ?? '', llmMs, sigMs: Date.now() - t1, attempts };
    }
    const chatId = String(JSON.parse(text).id ?? '');
    const s = await nearAiSignature(cfg, chatId, (k) => signedText(k, cfg.model, reqHash, respHash), deadline);
    return { response: text, signature: s.signature, kind: s.kind, chatId, llmMs, sigMs: Date.now() - t1, attempts };
  }
  throw new Error(lastErr);
}
