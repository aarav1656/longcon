import { afterEach, expect, test } from 'bun:test';
import { createPublicKey, verify } from 'node:crypto';
import { answer } from '../src/llm.ts';
import { publicKeyHex, sha256Hex, signedText } from '../src/lib.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const seed = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';

test('an operator key signs as kind worker, never as the model TEE', async () => {
  const completion = JSON.stringify({ id: 'chatcmpl-w', choices: [{ message: { content: '{"decisions":[{"slot":1,"verdict":"refuse","advance":0,"repay":0,"due_days":1,"class":"other","reason":"no"}]}' } }] });
  globalThis.fetch = (async () => new Response(completion, { status: 200 })) as unknown as typeof fetch;
  const cfg = { baseUrl: 'http://gateway.test/v1', apiKey: 'test-key-not-a-secret', model: 'm/x', signMode: 'worker' as const, seed };
  const a = await answer(cfg, '{"request":"body"}', 1, Date.now() + 30_000);
  expect(a.kind).toBe('worker');
  const text = signedText('worker', cfg.model, sha256Hex('{"request":"body"}'), sha256Hex(completion));
  expect(text).toBe(`m/x:${sha256Hex('{"request":"body"}')}:${sha256Hex(completion)}`);
  const pub = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKeyHex(seed), 'hex')]), format: 'der', type: 'spki' });
  expect(verify(null, Buffer.from(text), pub, Buffer.from(a.signature, 'hex'))).toBe(true);
});
