import { expect, test } from 'bun:test';
import { KeyPair, KeyPairSigner, actions, buildDelegateAction, encodeSignedDelegate } from 'near-api-js';
import { vet } from '../src/delegate.ts';

const CONTRACT = 'longcon.testnet';

async function make(over: { method?: string; deposit?: bigint; receiver?: string; sender?: string; gas?: bigint; two?: boolean } = {}) {
  const kp = KeyPair.fromRandom('ed25519');
  const pk = kp.getPublicKey();
  const implicit = Buffer.from(pk.data).toString('hex');
  const fc = actions.functionCall(over.method ?? 'offer', { merchant: 0 }, over.gas ?? 150_000_000_000_000n, over.deposit ?? 0n);
  const da = buildDelegateAction({
    senderId: over.sender ?? implicit,
    receiverId: over.receiver ?? CONTRACT,
    actions: over.two ? [fc, fc] : [fc],
    nonce: 1n,
    maxBlockHeight: 1000n,
    publicKey: pk,
  } as any);
  const { signedDelegate } = await new KeyPairSigner(kp).signDelegateAction(da);
  return { bytes: encodeSignedDelegate(signedDelegate), implicit };
}

test('a well formed offer from an implicit account is accepted', async () => {
  const { bytes, implicit } = await make();
  const c = vet(bytes, CONTRACT);
  expect(c.senderId).toBe(implicit);
  expect(c.method).toBe('offer');
});

for (const [name, over, msg] of [
  ['wrong receiver', { receiver: 'evil.testnet' }, 'receiver must be'],
  ['method outside the list', { method: 'fund_merchant' }, 'is not relayed'],
  ['attached deposit', { deposit: 1n }, 'no deposit'],
  ['gas above the limit', { gas: 300_000_000_000_000n }, 'gas above'],
  ['sender that is not the key', { sender: 'a'.repeat(64) }, 'implicit account'],
  ['two actions', { two: true }, 'exactly one'],
] as const) {
  test(`rejects ${name}`, async () => {
    const { bytes } = await make(over as any);
    expect(() => vet(bytes, CONTRACT)).toThrow(msg);
  });
}

test('rejects bytes that are not a delegate', () => {
  expect(() => vet(new Uint8Array([1, 2, 3]), CONTRACT)).toThrow('not a signed delegate');
});
