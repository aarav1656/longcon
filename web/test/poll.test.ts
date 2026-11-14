import { expect, test } from 'bun:test';
import { POLL_MS, pollPause } from '../src/poll';

test('a poll gap is at least ten seconds', () => {
  expect(POLL_MS).toBeGreaterThanOrEqual(10_000);
});

test('pollPause sleeps one full gap and holds while the tab is hidden', async () => {
  const slept: number[] = [];
  let hiddenFor = 3;
  await pollPause(async (ms) => { slept.push(ms); }, () => hiddenFor-- <= 0);
  expect(slept[0]).toBe(POLL_MS);
  expect(slept.length).toBe(4);
});
