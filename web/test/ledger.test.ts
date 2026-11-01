import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// app.js is a plain browser script. Run it against a document with no elements so main() exits early and the render functions can be called.
const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const lib = new Function('document', 'location', 'fetch', `${src}; return { renderMerchants, renderRecords };`)(
  { getElementById: () => null },
  { search: '' },
  () => Promise.reject(new Error('no network in unit tests')),
);
const el = () => ({ innerHTML: '' });
const readAt = { blockHeight: 275716181, timestamp: '2026-11-01T07:14:27.418Z', explorer: 'https://testnet.nearblocks.io' };
const towns = ['Millford', 'Pellgate', 'Oskmoor'];

test('an empty ledger says how a con lands and where to read one that has', () => {
  const e = el();
  lib.renderRecords(e, [], towns, readAt);
  expect(e.innerHTML).toContain('repays a small advance');
  expect(e.innerHTML).toContain('?contract=longcon2-game.testnet');
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

test('the default road in config.json is one that holds con records', () => {
  const cfg = JSON.parse(readFileSync(new URL('../public/config.json', import.meta.url), 'utf8'));
  expect(cfg.contract_id).toBe('longcon2-game.testnet');
  expect(cfg.rpc).toStartWith('https://');
});
