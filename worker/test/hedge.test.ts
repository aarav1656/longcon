import { afterEach, expect, test } from 'bun:test';
import { answer } from '../src/llm.ts';
import { sha256Hex, signedText } from '../src/lib.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const completion = (id: string) => JSON.stringify({ id, choices: [{ message: { content: '{"decisions":[{"slot":1,"verdict":"refuse","advance":0,"repay":0,"due_days":1,"class":"other","reason":"no"}]}' } }] });
const cfg = { baseUrl: 'http://nearai.test/v1', apiKey: 'test-key-not-a-secret', model: 'm/x', signMode: 'near-ai' as const };
const body = '{"request":"body"}';

function stub(slowFirst: boolean) {
  let posts = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes('/signature/')) {
      const id = decodeURIComponent(String(url).split('/signature/')[1].split('?')[0]);
      const text = signedText('provider_tee', cfg.model, sha256Hex(body), sha256Hex(completion(id)));
      return new Response(JSON.stringify({ signature: 'ab'.repeat(64), signature_kind: 'provider_tee', signing_algo: 'ed25519', text }), { status: 200 });
    }
    const n = ++posts;
    if (slowFirst && n === 1) {
      await new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    }
    return new Response(completion(`chat-${n}`), { status: 200 });
  }) as unknown as typeof fetch;
  return () => posts;
}

test('a model call that never returns is raced by a second identical call, which wins', async () => {
  const posts = stub(true);
  const t0 = Date.now();
  const a = await answer(cfg, body, 1, Date.now() + 30_000, undefined, 150);
  expect(a.chatId).toBe('chat-2');
  expect(posts()).toBe(2);
  expect(Date.now() - t0).toBeLessThan(2000);
});

test('with a prompt model there is no second call', async () => {
  const posts = stub(false);
  const a = await answer(cfg, body, 1, Date.now() + 30_000, undefined, 5000);
  expect(a.chatId).toBe('chat-1');
  expect(posts()).toBe(1);
});

test('a readable answer landing after the model deadline is still signed, not discarded', async () => {
  stub(false);
  const a = await answer(cfg, body, 1, Date.now() + 1000, undefined, 5000);
  expect(a.signature.length).toBe(128);
});
