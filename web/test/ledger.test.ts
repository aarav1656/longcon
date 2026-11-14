import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// app.js is a plain browser script. Run it against a document with no elements so main() exits early and the render functions can be called.
const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const lib = new Function('document', 'location', 'fetch', `${src}; return { renderMerchants, renderRecords, renderSigners, rpcCall };`)(
  { getElementById: () => null },
  { search: '' },
  (...a: unknown[]) => fetchImpl(...a),
);
let fetchImpl: (...a: unknown[]) => Promise<unknown> = () => Promise.reject(new Error('no network in unit tests'));
const el = () => ({ innerHTML: '' });
const readAt = { blockHeight: 275716181, timestamp: '2026-11-01T07:14:27.418Z', explorer: 'https://testnet.nearblocks.io' };
const towns = ['Millford', 'Pellgate', 'Oskmoor'];

test('an empty ledger says how a con lands and where to read one that has', () => {
  const e = el();
  lib.renderRecords(e, [], towns, readAt);
  expect(e.innerHTML).toContain('An unpaid advance appears here after its due day ends.');
  expect(e.innerHTML).not.toContain('?contract=longcon2-game.testnet');
  expect(e.innerHTML).toContain('Read at block 275716181');
});

test('a landed con shows class, town, loss and the three hashes, and escapes the player id', () => {
  const e = el();
  const rec = { class: 'future_cargo', town: 1, day: 4, loss: 9, player: '<b>x</b>', bond_burned: 5, principal: 4, request_hash: 'aa', response_hash: 'bb', config_hash: 'cc' };
  lib.renderRecords(e, [rec], towns, readAt);
  expect(e.innerHTML).toContain('future_cargo');
  expect(e.innerHTML).toContain('Pellgate, day 4');
  expect(e.innerHTML).toContain('-9');
  expect(e.innerHTML).toContain('Request aa . Response bb . Config cc');
  expect(e.innerHTML).not.toContain('<b>x</b>');
});

test('merchants show treasury, loans and the cap they are held to', () => {
  const e = el();
  const state = { rules: { towns, loss_cap_per_day: 15, treasury_cap_pct: 30 }, merchants: [{ name: 'Marta', town: 0, gold: 100, grain: 50, buy_price: 4, sell_price: 6, outstanding: 10, treasury_room: 20, lost_total: 3 }] };
  lib.renderMerchants(e, state, readAt);
  expect(e.innerHTML).toContain('Marta');
  expect(e.innerHTML).toContain('10 of 30');
  expect(e.innerHTML).toContain('Daily loss cap 15 gold. Treasury cap 30 percent.');
});

test('the default road in config.json is the new testnet road', () => {
  const cfg = JSON.parse(readFileSync(new URL('../public/config.json', import.meta.url), 'utf8'));
  expect(cfg.contract_id).toBe('longcon4-game.testnet');
  expect(cfg.rpc).toBe('/api/rpc');
  expect(cfg.relayer).toBe('/api/relay');
});

test('the ledger page compares the registered model key with its published report', () => {
  const e = el();
  const state = { model: 'm', signers: [['m', 'a'.repeat(64)]] };
  lib.renderSigners(e, state, readAt, { model_signing_key: 'a'.repeat(64) });
  expect(e.innerHTML).toContain('matches the published attestation report');
  lib.renderSigners(e, state, readAt, { model_signing_key: 'b'.repeat(64) });
  expect(e.innerHTML).toContain('does not match the published attestation report');
  lib.renderSigners(e, state, readAt, null);
  expect(e.innerHTML).toContain('no attestation report is published for this road');
});

const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, statusText: 'x', json: async () => body });

test('rpcCall asks again after a 429 and after a JSON-RPC -429 body, then returns the result', async () => {
  const answers = [reply(429, {}), reply(200, { error: { code: -429 } }), reply(200, { result: { height: 7 } })];
  let calls = 0;
  fetchImpl = async () => { calls++; return answers.shift(); };
  expect(await lib.rpcCall('http://rpc', 'block', {}, 1)).toEqual({ height: 7 });
  expect(calls).toBe(3);
});

test('rpcCall gives up with a rate limit message after six tries and does not retry a real error', async () => {
  let calls = 0;
  fetchImpl = async () => { calls++; return reply(429, {}); };
  await expect(lib.rpcCall('http://rpc', 'block', {}, 1)).rejects.toThrow('rate limiting');
  expect(calls).toBe(6);
  calls = 0;
  fetchImpl = async () => { calls++; return reply(200, { error: { code: -32000, message: 'bad' } }); };
  await expect(lib.rpcCall('http://rpc', 'block', {}, 1)).rejects.toThrow('-32000');
  expect(calls).toBe(1);
});

test('the signer panel prints every registered key and marks the road model', () => {
  const e = el();
  const key = 'f09a1eb8d850aab7393bcbd03020fba53f452cb7efc8fc57eeeb9c115761f3aa';
  lib.renderSigners(e, { model: 'm/a', signers: [['m/a', key], ['m/b', 'ab'.repeat(32)]] }, readAt);
  expect(e.innerHTML).toContain(key);
  expect(e.innerHTML).toContain('m/b');
  expect(e.innerHTML.match(/the road&#39;s model|the road's model/g)?.length).toBe(1);
  expect(e.innerHTML).toContain('model:sha256(request):sha256(response)');
});

test('with no registered key the signer panel says the contract accepts no answer', () => {
  const e = el();
  lib.renderSigners(e, { model: 'm/a', signers: [] }, readAt);
  expect(e.innerHTML).toContain('accepts no merchant answer');
});
