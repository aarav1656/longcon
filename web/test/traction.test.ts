import { expect, test } from 'bun:test';
import { countTraction, tractionEvents } from '../src/traction.ts';

const contract = 'longcon4-game.testnet';
const log = (event: string, data: object) => `EVENT_JSON:${JSON.stringify({ standard: 'longcon', version: '1.0.0', event, data })}`;
const receipt = (event: string, data: object, { receiver = contract, height = 100, success = true } = {}) => ({
  receipt: { receiver_id: receiver, block_height: height, receipt_id: `${event}-${height}-${receiver}` },
  execution_outcome: { block_height: height, outcome: { status: success ? { SuccessValue: '' } : { Failure: {} }, logs: [log(event, data)] } },
});

test('counts distinct finalized successful contract pitches, loans, and defaults only', () => {
  const transactions = [{ receipts: [
    receipt('offer_opened', { offer_id: 1 }),
    receipt('offer_settled', { offer_id: 1, status: 'committed', advance: 4 }),
    receipt('con_landed', { record_id: 1 }),
    receipt('offer_opened', { offer_id: 2 }, { height: 101 }),
    receipt('offer_opened', { offer_id: 3 }, { success: false }),
    receipt('offer_opened', { offer_id: 4 }, { receiver: 'other.testnet' }),
    receipt('offer_settled', { offer_id: 5, status: 'refused', advance: 0 }),
  ] }];
  expect(countTraction(transactions, contract, 100)).toEqual({ contract_id: contract, finalized_height: 100, pitches: 1, loans: 1, defaults: 1 });
});

test('returns finalized event evidence with source transaction hashes and heights', () => {
  const transactions = [{ transaction: { hash: 'tx1' }, receipts: [
    receipt('offer_opened', { offer_id: 1 }),
    receipt('offer_settled', { offer_id: 1, status: 'committed', advance: 4 }),
    receipt('con_landed', { record_id: 1 }),
    receipt('offer_opened', { offer_id: 2 }, { height: 101 }),
  ] }];
  expect(tractionEvents(transactions, contract, 100)).toEqual([
    { event: 'con_landed', transaction_hash: 'tx1', block_height: 100, record_id: 1 },
    { event: 'offer_opened', transaction_hash: 'tx1', block_height: 100, offer_id: 1 },
    { event: 'offer_settled', transaction_hash: 'tx1', block_height: 100, offer_id: 1 },
  ]);
});

test('an incremental read fetches only unseen transactions and reports progress per batch', async () => {
  const { readTractionEvents } = await import('../src/traction.ts');
  const requested: string[] = [];
  let limited = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    if (String(url).includes('/v0/account')) return json({ account_txs: [{ transaction_hash: 'a' }, { transaction_hash: 'b' }, { transaction_hash: 'c' }], resume_token: null });
    if (String(url).includes('/v0/transactions')) {
      requested.push(...body.tx_hashes);
      if (limited && body.tx_hashes.includes('c')) return json({}, 429);
      return json({ transactions: body.tx_hashes.map((h: string, i: number) => ({ transaction: { hash: h }, receipts: [receipt('offer_opened', { offer_id: h.charCodeAt(0) })] })) });
    }
    return json({ result: { header: { height: 100 } } });
  }) as unknown as typeof fetch;
  try {
    const first = await readTractionEvents(contract, { seen: ['a'], events: [{ event: 'offer_opened', transaction_hash: 'a', block_height: 100, offer_id: 'a'.charCodeAt(0) }] });
    expect(requested).toEqual(['b', 'c']);
    expect(first.summary.pitches).toBe(3);
    expect(first.state.seen.sort()).toEqual(['a', 'b', 'c']);
    const progress: number[] = [];
    requested.length = 0;
    await readTractionEvents(contract, { seen: [], events: [] }, (st) => { progress.push(st.seen.length); });
    expect(requested.sort()).toEqual(['a', 'b', 'c']);
    expect(progress).toEqual([3]);
  } finally { globalThis.fetch = realFetch; }
});
