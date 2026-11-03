import { expect, test } from 'bun:test';
import { Chain } from '../src/chain.ts';
import { KeyPair } from 'near-api-js';

test('view retries RPC rate limits and still fails after non-rate-limit errors', async () => {
  const chain = new Chain({ contract_id: 'road.testnet', network: 'testnet', rpc: 'http://rpc', relayer: '', explorer: '' }, { id: 'player', kp: KeyPair.fromRandom('ed25519') });
  let calls = 0;
  Object.defineProperty(chain.provider, 'callFunction', { value: async () => {
    calls++;
    if (calls === 1) throw new Error('HTTP 429');
    if (calls === 2) throw new Error('JSON-RPC error code -429');
    return { day: 2 };
  } });
  expect(await chain.view('state')).toEqual({ day: 2 });
  expect(calls).toBe(3);
  const broken = new Chain({ contract_id: 'road.testnet', network: 'testnet', rpc: 'http://rpc', relayer: '', explorer: '' }, { id: 'player', kp: KeyPair.fromRandom('ed25519') });
  Object.defineProperty(broken.provider, 'callFunction', { value: async () => { throw new Error('contract missing'); } });
  await expect(broken.view('state')).rejects.toThrow('contract missing');
});
