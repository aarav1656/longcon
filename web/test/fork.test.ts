import { expect, test } from 'bun:test';
import { dayFeed, richer, verdictLine, waitState, readHealth, canSettleAgain, type Branch, type Fork } from '../src/fork.ts';

const loan = (o: Partial<Branch['loans'][0]>): Branch['loans'][0] => ({ rank: 0, slot: 0, name: 'X', accepted: true, proposed_advance: 10, advance: 10, repay: 12, due_day: 2, class: 'other', reason: '', clamps: [], repays: true, ...o });
const branch = (rule: number, final_gold: number, defaults: number, loans: Branch['loans']): Branch => ({ rule, start_hash: '', loans, rows: [], cons: [], final_gold, defaults, lost: defaults * 3, cap_bound: false, outcome: 'thrives' });

test('dayFeed books advances on day 0 and settles each loan on its due day, grifters default', () => {
  const f = dayFeed(branch(25, 201, 1, [loan({ name: 'Tam' }), loan({ name: 'Sable', advance: 3, proposed_advance: 14, clamps: ['daily_loss'], repays: false }), loan({ name: 'Wick', accepted: false, advance: 0 })]));
  expect(f.map((l) => `${l.day}:${l.kind}`)).toEqual(['0:lend', '0:cap', '2:repay', '2:default']);
  expect(f.find((l) => l.kind === 'default')!.text).toBe('Sable never returns, 3 lost');
});

test('richer and verdictLine name the better rule and the gap', () => {
  const fork = { branches: [branch(15, 204, 0, []), branch(25, 201, 1, [])] } as unknown as Fork;
  expect(richer(fork)).toBe(0);
  expect(verdictLine(fork)).toContain('cap of 15 leaves the merchant 3 gold ahead of the cap of 25');
  const tie = { branches: [branch(15, 202, 0, []), branch(25, 202, 0, [])] } as unknown as Fork;
  expect(richer(tie)).toBeNull();
  expect(verdictLine(tie)).toContain('changed nothing');
});

test('waitState: keeps waiting, offers a re-read, then a fresh split as the merchant stays silent', () => {
    expect(waitState(34_000)).toBe('wait');
    expect(waitState(36_000)).toBe('late');
    expect(waitState(91_000)).toBe('gaveup');
});

test('readHealth: two failed reads stay quiet, the third is shown, one good read clears it', () => {
    expect(readHealth(0)).toBe('ok');
    expect(readHealth(2)).toBe('ok');
    expect(readHealth(3)).toBe('failing');
});

test('canSettleAgain: only after the replay, with a divergence, while the claim is open and nothing is settling', () => {
    const open = { status: 'sealed' as const, divergence: { receipt: 'r' } } as never;
    expect(canSettleAgain(open, true, false)).toBe(true);
    expect(canSettleAgain(open, false, false)).toBe(false);
    expect(canSettleAgain(open, true, true)).toBe(false);
    expect(canSettleAgain({ status: 'settled', divergence: { receipt: 'r' } } as never, true, false)).toBe(false);
    expect(canSettleAgain({ status: 'sealed', divergence: null } as never, true, false)).toBe(false);
    expect(canSettleAgain(null, true, false)).toBe(false);
});

import { ANSWER_BLOCKS, blocksToExpiry, expiryBlock } from '../src/fork.ts';
import { test as expiryTest, expect as expiryExpect } from 'bun:test';
expiryTest('the answer window closes ANSWER_BLOCKS after the seal and never goes negative', () => {
  const f = { sealed_block: 1000 };
  expiryExpect(expiryBlock(f)).toBe(1000 + ANSWER_BLOCKS);
  expiryExpect(blocksToExpiry(f, 1000)).toBe(ANSWER_BLOCKS);
  expiryExpect(blocksToExpiry(f, 1000 + ANSWER_BLOCKS - 1)).toBe(1);
  expiryExpect(blocksToExpiry(f, 1000 + ANSWER_BLOCKS)).toBe(0);
  expiryExpect(blocksToExpiry(f, 99999)).toBe(0);
});

test('the fork slot is per tab: no code path keeps it in localStorage, so a second tab cannot delete the first tab\'s fork', async () => {
  const src = await Bun.file(new URL('../src/forked.ts', import.meta.url)).text();
  const uses = src.split('\n').filter((l) => l.includes('FORK_SLOT') && !l.startsWith('const FORK_SLOT'));
  expect(uses.length).toBeGreaterThanOrEqual(4);
  for (const l of uses) expect(l).not.toContain('localStorage');
});
