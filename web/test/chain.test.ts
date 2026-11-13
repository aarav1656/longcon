import { expect, test } from 'bun:test';
import { Chain } from '../src/chain.ts';
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
