import { afterEach, expect, test } from 'bun:test';
import { nearAiSignature } from '../src/llm.ts';
import { attestedSigners, sha256Hex, signedText } from '../src/lib.ts';

// Response shapes follow https://docs.near.ai/cloud/verification/cloud-api/response-signatures.md and model-attestations.md.
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const cfg = { baseUrl: 'https://cloud-api.near.ai/v1', apiKey: 'test-key-not-a-secret', model: 'Qwen/Qwen3.8-27B', signMode: 'near-ai' as const };
const text = signedText('provider_tee', cfg.model, sha256Hex('req'), sha256Hex('resp'));
const expected = () => text;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

test('a 2xx carrying error_code is not a signature: the poll continues until the signature is recorded', async () => {
  const urls: string[] = [];
  const replies = [() => json({ error_code: 'pending', message: 'not recorded yet' }), () => json({}, 404), () => json({ text, signature: '0xdeadbeef', signing_algo: 'ed25519', signature_kind: 'provider_tee' })];
  globalThis.fetch = (async (u: string) => { urls.push(u); return replies[urls.length - 1](); }) as unknown as typeof fetch;
  const s = await nearAiSignature(cfg, 'chatcmpl-1', expected, Date.now() + 20000);
  expect(urls.length).toBe(3);
  expect(urls[0]).toContain('/signature/chatcmpl-1?model=Qwen%2FQwen3.8-27B&signing_algo=ed25519');
  expect(s).toEqual({ signature: 'deadbeef', kind: 'provider_tee' });
}, 20000);

test('a signature over text that is not our request and response hashes is refused', async () => {
  globalThis.fetch = (async () => json({ text: signedText('provider_tee', cfg.model, sha256Hex('req'), sha256Hex('other')), signature: 'aa', signature_kind: 'provider_tee', signing_algo: 'ed25519' })) as unknown as typeof fetch;
  await expect(nearAiSignature(cfg, 'chatcmpl-2', expected, Date.now() + 5000)).rejects.toThrow('not the hash of what we sent and received');
});

test('signature metadata rejects invalid values and accepts supported kinds', async () => {
  for (const [metadata, error] of [
    [{ signing_algo: 'ed25519' }, 'unsupported signature_kind'],
    [{ signature_kind: 'unknown', signing_algo: 'ed25519' }, 'unsupported signature_kind'],
    [{ signature_kind: 'provider_tee' }, 'unsupported signing_algo'],
    [{ signature_kind: 'gateway', signing_algo: 'ecdsa' }, 'unsupported signing_algo'],
  ]) {
    globalThis.fetch = (async () => json({ text, signature: 'aa', ...metadata })) as unknown as typeof fetch;
    await expect(nearAiSignature(cfg, 'chatcmpl-invalid', expected, Date.now() + 5000)).rejects.toThrow(error);
  }

  for (const kind of ['provider_tee', 'gateway'] as const) {
    const signed = signedText(kind, cfg.model, sha256Hex('req'), sha256Hex('resp'));
    globalThis.fetch = (async () => json({ text: signed, signature: 'cc', signature_kind: kind, signing_algo: 'ed25519' })) as unknown as typeof fetch;
    const result = await nearAiSignature(cfg, 'chatcmpl-valid', (k) => signedText(k, cfg.model, sha256Hex('req'), sha256Hex('resp')), Date.now() + 5000);
    expect(result).toEqual({ signature: 'cc', kind });
  }
});

test('the signer comes from signing_address of an ed25519 report, many instances of one model are one signer', () => {
  const rep = { gateway_attestation: { signing_address: KEY_B, signing_algo: 'ed25519' }, model_attestations: [{ signing_address: `0x${KEY_A}`, signing_algo: 'ed25519' }, { signing_address: KEY_A.toUpperCase(), signing_algo: 'ed25519' }] };
  expect(attestedSigners(rep)).toEqual({ model: KEY_A, gateway: KEY_B });
});

test('reports that cannot name exactly one 32 byte ed25519 model signer are refused', () => {
  expect(() => attestedSigners({})).toThrow('no ed25519 model signer');
  expect(() => attestedSigners({ model_attestations: [{ signing_address: '0x' + '1'.repeat(40), signing_algo: 'ecdsa' }] })).toThrow('no ed25519 model signer');
  expect(() => attestedSigners({ model_attestations: [{ signing_address: KEY_A, signing_algo: 'ed25519' }, { signing_address: KEY_B, signing_algo: 'ed25519' }] })).toThrow('2 different');
  expect(() => attestedSigners({ model_attestations: [{ signing_address: 'abcd', signing_algo: 'ed25519' }] })).toThrow('32 bytes');
});
