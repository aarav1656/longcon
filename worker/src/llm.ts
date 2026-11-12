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

export async function nearAiSignature(
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
      if (j.error_code || !j.signature) {
        last = `unavailable ${String(j.error_code ?? 'no signature')} ${String(j.message ?? '').slice(0, 100)}`; // a 2xx carrying error_code is not a signature yet
        await sleep(700);
        continue;
      }
      if (j.signature_kind !== 'provider_tee' && j.signature_kind !== 'gateway') throw new Error('unsupported signature_kind');
      if (j.signing_algo !== 'ed25519') throw new Error('unsupported signing_algo');
      const kind: SigKind = j.signature_kind;
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
export async function answer(cfg: LlmCfg, requestBody: string, slots: number, deadline: number, onAttempt?: (chatId: string, status: number) => void): Promise<Answered> {
  const reqHash = sha256Hex(requestBody);
  let attempts = 0;
  let lastErr = 'no attempt';
  while (Date.now() < deadline - 8000) {
    attempts++;
    const t0 = Date.now();
    const { text, status } = await post(cfg, requestBody);
    onAttempt?.(text.match(/"id"\s*:\s*"([^"]+)"/)?.[1] ?? '', status);
    const llmMs = Date.now() - t0;
    if (status !== 200) {
      lastErr = `model endpoint ${status}: ${text.slice(0, 200)}`;
      await sleep(1000);
      continue;
    }
    if (!readable(text, slots)) {
      lastErr = 'answer did not decide every slot';
      continue;
    }
    const respHash = sha256Hex(text);
    const t1 = Date.now();
    if (cfg.signMode === 'worker') {
      if (!cfg.seed) throw new Error('worker signing needs WORKER_SIGNING_SEED');
      const signature = signWithSeed(cfg.seed, signedText('worker', cfg.model, reqHash, respHash));
      return { response: text, signature, kind: 'worker', chatId: JSON.parse(text).id ?? '', llmMs, sigMs: Date.now() - t1, attempts };
    }
    const chatId = String(JSON.parse(text).id ?? '');
    const s = await nearAiSignature(cfg, chatId, (k) => signedText(k, cfg.model, reqHash, respHash), deadline);
    return { response: text, signature: s.signature, kind: s.kind, chatId, llmMs, sigMs: Date.now() - t1, attempts };
  }
  throw new Error(lastErr);
}
