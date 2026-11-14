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

async function post(cfg: LlmCfg, body: string, signal?: AbortSignal): Promise<{ text: string; status: number }> {
  const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` };
  if (cfg.signMode === 'near-ai') headers['x-no-aliasing'] = 'true';
  const r = await fetch(`${cfg.baseUrl}/chat/completions`, { method: 'POST', headers, body, signal });
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

const SIGNATURE_WINDOW_MS = 30_000;

/**
 * Send the contract-built request byte for byte, then obtain a signature over
 * model:sha256(request):sha256(response). A model call slower than hedgeMs gets a second
 * identical call racing it (up to three in flight): either readable answer is a valid signed
 * answer, so the first wins and the rest are aborted. A readable answer is never thrown away
 * for lack of time: its signature lookup gets its own window past the model deadline.
 */
export async function answer(
  cfg: LlmCfg,
  requestBody: string,
  slots: number,
  deadline: number,
  onAttempt?: (chatId: string, status: number) => void,
  hedgeMs = 20_000,
): Promise<Answered> {
  const reqHash = sha256Hex(requestBody);
  let attempts = 0;
  let lastErr = 'no attempt';
  const controllers = new Set<AbortController>();
  type Won = { text: string; llmMs: number };
  const launch = async (): Promise<Won | null> => {
    attempts++;
    const ctl = new AbortController();
    controllers.add(ctl);
    const timer = setTimeout(() => ctl.abort(), Math.max(30_000, deadline + 30_000 - Date.now()));
    const t0 = Date.now();
    try {
      const { text, status } = await post(cfg, requestBody, ctl.signal);
      onAttempt?.(text.match(/"id"\s*:\s*"([^"]+)"/)?.[1] ?? '', status);
      if (status !== 200) {
        lastErr = `model endpoint ${status}: ${text.slice(0, 200)}`;
        await sleep(1000);
        return null;
      }
      if (!readable(text, slots)) {
        lastErr = 'answer did not decide every slot';
        return null;
      }
      return { text, llmMs: Date.now() - t0 };
    } catch (e) {
      if (!ctl.signal.aborted) lastErr = `model call failed: ${String((e as Error)?.message ?? e).slice(0, 160)}`;
      return null;
    } finally {
      clearTimeout(timer);
      controllers.delete(ctl);
    }
  };
  const won = await new Promise<Won | null>((resolve) => {
    let running = 0;
    let over = false;
    const timeLeft = () => Date.now() < deadline - 8000;
    const finish = (r: Won | null) => {
      if (over) return;
      over = true;
      clearInterval(hedge);
      resolve(r);
    };
    const spawn = () => {
      running++;
      launch().then((r) => {
        running--;
        if (r) return finish(r);
        if (over || running > 0) return;
        if (timeLeft()) spawn();
        else finish(null);
      });
    };
    const hedge = setInterval(() => {
      if (!over && running < 3 && timeLeft()) spawn();
    }, hedgeMs);
    spawn();
  });
  for (const c of controllers) c.abort();
  if (!won) throw new Error(lastErr);
  const { text, llmMs } = won;
  const respHash = sha256Hex(text);
  const t1 = Date.now();
  if (cfg.signMode === 'worker') {
    if (!cfg.seed) throw new Error('worker signing needs WORKER_SIGNING_SEED');
    const signature = signWithSeed(cfg.seed, signedText('worker', cfg.model, reqHash, respHash));
    return { response: text, signature, kind: 'worker', chatId: JSON.parse(text).id ?? '', llmMs, sigMs: Date.now() - t1, attempts };
  }
  const chatId = String(JSON.parse(text).id ?? '');
  const s = await nearAiSignature(cfg, chatId, (k) => signedText(k, cfg.model, reqHash, respHash), Math.max(deadline, Date.now() + SIGNATURE_WINDOW_MS));
  return { response: text, signature: s.signature, kind: s.kind, chatId, llmMs, sigMs: Date.now() - t1, attempts };
}
