import { expect, test } from 'bun:test';
import { KeyPair, KeyPairSigner, actions, buildDelegateAction, encodeSignedDelegate } from 'near-api-js';
import { budgets, clientKey, proxiedClient, vet } from '../src/delegate.ts';

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

test('vet rejects a delegate with one flipped signature byte', async () => {
  const { bytes } = await make();
  const altered = new Uint8Array(bytes);
  altered[altered.length - 1] ^= 1;
  expect(() => vet(altered, CONTRACT)).toThrow('delegate signature does not verify');
});

test('clientKey uses the socket unless a trusted proxy is configured', () => {
  for (let i = 0; i < 20; i++) expect(clientKey(`10.0.0.${i + 1}, 203.0.113.4`, '192.0.2.2', true)).toBe('203.0.113.4');
  expect(clientKey('10.0.0.1, 203.0.113.4', '192.0.2.2', false)).toBe('192.0.2.2');
});

test('budgets enforce per-client and shared limits without charging a rejected take', () => {
  const b = budgets(3, 4, 1000);
  expect([b.take('a', 0), b.take('a', 1), b.take('a', 2), b.take('a', 3), b.take('b', 4)]).toEqual([true, true, true, false, true]);
  const global = budgets(3, 120, 1000);
  expect(Array.from({ length: 121 }, (_, i) => global.take(String(i), i)).filter(Boolean)).toHaveLength(120);
});

import { callFor, joinBudget } from '../src/delegate.ts';

test('a join delegate becomes a sponsored join for the account that signed it and nothing else does', async () => {
  const join = await make({ method: 'join' });
  expect(callFor(vet(join.bytes, CONTRACT))).toEqual({ kind: 'sponsor_join', args: { account_id: join.implicit } });
  const offer = await make({ method: 'offer' });
  expect(callFor(vet(offer.bytes, CONTRACT))).toEqual({ kind: 'delegate' });
});

test('the join budget stops at its maximum and frees a slot when the window passes', () => {
  const may = joinBudget(2, 1000);
  expect([may(0), may(10), may(20)]).toEqual([true, true, false]);
  expect(may(1005)).toBe(true);
  expect(may(1015)).toBe(true);
  expect(may(1016)).toBe(false);
});

test('proxiedClient keys on the forwarded address only with the shared secret', () => {
  const secret = 'abcdefghijklmnop0123456789';
  expect(proxiedClient(secret, secret, '198.51.100.7', 'edge')).toBe('proxied:198.51.100.7');
  expect(proxiedClient(secret, 'abcdefghijklmnop0123456780', '198.51.100.7', 'edge')).toBe('edge');
  expect(proxiedClient(secret, null, '198.51.100.7', 'edge')).toBe('edge');
  expect(proxiedClient('', '', '198.51.100.7', 'edge')).toBe('edge');
  expect(proxiedClient(secret, secret, null, 'edge')).toBe('edge');
});
