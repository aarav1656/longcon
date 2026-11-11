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
