import { expect, test } from 'bun:test';
import { checkPitch, classLabel, clampSentence, esc, nextMove, shortId } from '../src/words.ts';

test('every clamp tag the contract can emit has its own sentence', () => {
  const tags = ['ask', 'exposure', 'daily_loss', 'treasury_30pct', 'merchant_gold', 'due_days', 'repay_floor', 'repay_ceiling', 'sell_quote', 'buy_quote'];
  const seen = new Set(tags.map(clampSentence));
  expect(seen.size).toBe(tags.length);
  expect(clampSentence('brand_new')).toContain('brand_new');
});

test('class names read as plain english', () => {
  expect(classLabel('future_cargo')).toBe('a promise of cargo on its way');
  expect(classLabel('nonsense')).toContain('no name');
});

test('shortId keeps short strings whole and middles long ones', () => {
  expect(shortId('bob.near')).toBe('bob.near');
  expect(shortId('a'.repeat(64))).toBe('aaaaaa…aaaa');
});

test('esc neutralises markup from a model reason', () => {
  expect(esc('<img src=x onerror=alert(1)>')).not.toContain('<');
});

test('checkPitch rejects each bound the contract enforces and accepts a good pitch', () => {
  expect(checkPitch('hi', 10, 5, 20, 60).ok).toBe(true);
  expect(checkPitch('  ', 10, 5, 20, 60).ok).toBe(false);
  expect(checkPitch('x'.repeat(401), 10, 5, 20, 60).ok).toBe(false);
  expect(checkPitch('hi', 0, 5, 20, 60).ok).toBe(false);
  expect(checkPitch('hi', 61, 5, 20, 60).ok).toBe(false);
  expect(checkPitch('hi', 10, 21, 20, 60).why).toContain('cannot bond');
  expect(checkPitch('é'.repeat(201), 10, 5, 20, 60).ok).toBe(false); // 402 bytes, 201 characters
});

test('nextMove walks a new player from account to pitch to debt', () => {
  const base = { ready: true, pending: false, openDebts: 0, offers: 0, records: 0, day: 1 };
  expect(nextMove({ ...base, ready: false }).tone).toBe('wait');
  expect(nextMove(base).text).toContain('Pick a merchant');
  expect(nextMove({ ...base, pending: true }).tone).toBe('wait');
  expect(nextMove({ ...base, openDebts: 1, dueDay: 2 }).text).toContain('day 1 through day 2');
});

import { newsArrives } from '../src/words.ts';

test('news travels one town per day, same as the contract clock', () => {
  expect(newsArrives(5, 0, 0)).toBe(5);
  expect(newsArrives(5, 0, 1)).toBe(6);
  expect(newsArrives(5, 0, 2)).toBe(7);
  expect(newsArrives(5, 2, 0)).toBe(7);
});
