import { describe, expect, test } from 'bun:test';
import { Chain, explain } from '../src/chain.ts';
import { KeyPair } from 'near-api-js';

test('view retries RPC rate limits and still fails after non-rate-limit errors', async () => {
  const chain = new Chain({ contract_id: 'road.testnet', network: 'sandbox', rpc: 'http://rpc', relayer: '', explorer: '' }, { id: 'player', kp: KeyPair.fromRandom('ed25519') });
  let calls = 0;
  Object.defineProperty(chain.provider, 'callFunction', { value: async () => {
    calls++;
    if (calls === 1) throw new Error('HTTP 429');
    if (calls === 2) throw new Error('JSON-RPC error code -429');
    return { day: 2 };
  } });
  expect(await chain.view('state')).toEqual({ day: 2 });
  expect(calls).toBe(3);
  const broken = new Chain({ contract_id: 'road.testnet', network: 'sandbox', rpc: 'http://rpc', relayer: '', explorer: '' }, { id: 'player', kp: KeyPair.fromRandom('ed25519') });
  Object.defineProperty(broken.provider, 'callFunction', { value: async () => { throw new Error('contract missing'); } });
  await expect(broken.view('state')).rejects.toThrow('contract missing');
});

test('view moves to the fallback node when the first answers 429, and keeps non-rate-limit errors', async () => {
  const chain = new Chain({ contract_id: 'road.testnet', network: 'testnet', rpc: 'http://rpc', relayer: '', explorer: '' }, { id: 'player', kp: KeyPair.fromRandom('ed25519') });
  const fallback = (chain as unknown as { fallback: { callFunction: unknown } }).fallback;
  expect(fallback).not.toBeNull();
  let first = 0, second = 0;
  Object.defineProperty(chain.provider, 'callFunction', { value: async () => { first++; throw new Error('HTTP 429'); } });
  Object.defineProperty(fallback, 'callFunction', { value: async () => { second++; return { day: 7 }; } });
  expect(await chain.view('state')).toEqual({ day: 7 });
  expect([first, second]).toEqual([1, 1]);
  const other = new Chain({ contract_id: 'road.testnet', network: 'testnet', rpc: 'http://rpc', relayer: '', explorer: '' }, { id: 'player', kp: KeyPair.fromRandom('ed25519') });
  let reached = 0;
  Object.defineProperty(other.provider, 'callFunction', { value: async () => { throw new Error('contract missing'); } });
  Object.defineProperty((other as unknown as { fallback: object }).fallback, 'callFunction', { value: async () => { reached++; return {}; } });
  await expect(other.view('state')).rejects.toThrow('contract missing');
  expect(reached).toBe(0);
});

test('view moves to the fallback node when the browser cannot fetch the primary RPC', async () => {
  const chain = new Chain({ contract_id: 'road.testnet', network: 'testnet', rpc: 'http://rpc', relayer: '', explorer: '' }, { id: 'player', kp: KeyPair.fromRandom('ed25519') });
  const fallback = (chain as unknown as { fallback: { callFunction: unknown } }).fallback;
  Object.defineProperty(chain.provider, 'callFunction', { value: async () => { throw new TypeError('Failed to fetch'); } });
  Object.defineProperty(fallback, 'callFunction', { value: async () => ({ day: 8 }) });
  expect(await chain.view('state')).toEqual({ day: 8 });
});

test('view moves to the fallback node on drpc\'s HTTP 200 rate-limit body (code 15, no 429 in it)', async () => {
  const chain = new Chain({ contract_id: 'road.testnet', network: 'testnet', rpc: 'https://near-testnet.drpc.org', relayer: '', explorer: '' }, { id: 'player', kp: KeyPair.fromRandom('ed25519') });
  const fallback = (chain as unknown as { fallback: { callFunction: unknown } }).fallback;
  Object.defineProperty(chain.provider, 'callFunction', { value: async () => { throw new Error('{"id":"124","jsonrpc":"2.0","error":{"message":"You reached Public endpoint rate limit, please upgrade to paid plan","code":15}}'); } });
  Object.defineProperty(fallback, 'callFunction', { value: async () => ({ day: 10 }) });
  expect(await chain.view('state')).toEqual({ day: 10 });
});

test('the shipped config, which reads drpc first, still gets a second node', async () => {
  const shipped = await Bun.file(new URL('../public/config.json', import.meta.url)).json();
  const chain = new Chain(shipped, { id: 'player', kp: KeyPair.fromRandom('ed25519') });
  const fallback = (chain as unknown as { fallback: { callFunction: unknown } | null }).fallback;
  expect(fallback).not.toBeNull();
  Object.defineProperty(chain.provider, 'callFunction', { value: async () => { throw new Error('HTTP 429'); } });
  Object.defineProperty(fallback, 'callFunction', { value: async () => ({ day: 9 }) });
  expect(await chain.view('state')).toEqual({ day: 9 });
});

describe('explain', () => {
  test('a nonce collision becomes a plain sentence, never raw JSON', () => {
    const raw = '{"ActionError":{"index":0,"kind":{"DelegateActionInvalidNonce":{"ak_nonce":277602161000007,"delegate_nonce":277602161000005}}}}';
    const s = explain(raw);
    expect(s).toContain('same moment');
    expect(s.includes('{')).toBe(false);
  });
  test('any other raw JSON also becomes a sentence', () => {
    expect(explain('{"x":1}').includes('{')).toBe(false);
  });
  test('a contract panic keeps its own sentence', () => {
    expect(explain('Smart contract panicked: the cap is frozen"')).toBe('the cap is frozen');
  });
});

describe('relay probe and per-tab identity', () => {
  const mk = () => new Chain({ contract_id: 'road.testnet', network: 'sandbox', rpc: 'http://rpc', relayer: '/api/relay', explorer: '' }, { id: 'p', kp: KeyPair.fromRandom('ed25519') });
  const realFetch = globalThis.fetch;
  test('relayUp is true only when the health route answers ok', async () => {
    globalThis.fetch = (async () => new Response('{"ok":true}', { status: 200 })) as unknown as typeof fetch;
    expect(await mk().relayUp()).toBe(true);
    globalThis.fetch = (async () => new Response('{"error":"relayer offline"}', { status: 503 })) as unknown as typeof fetch;
    expect(await mk().relayUp()).toBe(false);
    globalThis.fetch = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
    expect(await mk().relayUp()).toBe(false);
    globalThis.fetch = realFetch;
  });
  test('identity keeps one key per tab and mints a fresh one on request', async () => {
    const store = new Map<string, string>();
    (globalThis as any).sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const { identity } = await import('../src/chain.ts');
    const a = identity();
    expect(identity().id).toBe(a.id);
    expect(identity(true).id).not.toBe(a.id);
  });
});

test('a rate-limited relay is retried, then explained in words; a contract refusal is never retried', async () => {
  const { ChainError, relayPauses } = await import('../src/chain.ts');
  relayPauses.splice(0, relayPauses.length, 0, 0, 0);
  const mk = () => new Chain({ contract_id: 'road.testnet', network: 'sandbox', rpc: 'http://rpc', relayer: '', explorer: '' }, { id: 'p', kp: KeyPair.fromRandom('ed25519') });
  const c = mk(); let n = 0;
  (c as any).sendOnce = async () => { n++; if (n < 3) throw new ChainError(explain('relay 429'), undefined, 'relay 429'); return { tx: 'T1' }; };
  expect((await c.send('fork_town', {})).tx).toBe('T1');
  expect(n).toBe(3);
  const d = mk(); let m = 0;
  (d as any).sendOnce = async () => { m++; throw new ChainError(explain('relay 429'), undefined, 'relay 429'); };
  await expect(d.send('fork_town', {})).rejects.toThrow('rate limited right now. Nothing was sent');
  expect(m).toBe(4);
  const e = mk(); let k = 0;
  (e as any).sendOnce = async () => { k++; throw new ChainError('the rule is frozen', 'TX', 'Smart contract panicked: the rule is frozen'); };
  await expect(e.send('fork_rule', {})).rejects.toThrow('frozen');
  expect(k).toBe(1);
  expect(explain('relay 502')).toContain('did not answer');
});
