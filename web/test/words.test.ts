import { expect, test } from 'bun:test';
import { checkPitch, classLabel, clampSentence, esc, nextMove, shortId, answeredLine, txUrl, newsLines, sha256Hex, signedText, signatureValid } from '../src/words.ts';

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
  expect(checkPitch('hi\u0001there', 10, 5, 20, 60).why).toBe('Remove control characters from the pitch.');
  expect(checkPitch('line one\nline two', 10, 5, 20, 60).ok).toBe(true);
});

test('request hashing matches SHA-256 and changes after one byte changes', async () => {
  expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(await sha256Hex('abc')).not.toBe(await sha256Hex('abd'));
});

test('request news stops before traveler pitch text', async () => {
  const body = await Bun.file(new URL('./fixtures/body-news.json', import.meta.url)).text();
  expect(newsLines(body)).toEqual(['- day 5 at Millford: a future_cargo pitch won an advance of 12 gold and the traveler defaulted.']);
  expect(newsLines(await Bun.file(new URL('./fixtures/body-no-news.json', import.meta.url)).text())).toEqual([]);
});

test('browser signature verification accepts the signer and rejects one changed byte', async () => {
  const kp = (await import('near-api-js')).KeyPair.fromRandom('ed25519');
  const text = signedText('provider_tee', 'm', 'a'.repeat(64), 'b'.repeat(64));
  const signature = kp.sign(new TextEncoder().encode(text)).signature;
  const sigHex = Array.from(signature, (b) => b.toString(16).padStart(2, '0')).join('');
  const keyHex = Array.from(kp.getPublicKey().data, (b) => b.toString(16).padStart(2, '0')).join('');
  expect(signatureValid('provider_tee', 'm', 'a'.repeat(64), 'b'.repeat(64), sigHex, keyHex)).toBe(true);
  const altered = `${sigHex.slice(0, -2)}${sigHex.endsWith('00') ? '01' : '00'}`;
  expect(signatureValid('provider_tee', 'm', 'a'.repeat(64), 'b'.repeat(64), altered, keyHex)).toBe(false);
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

test('the answered line states seconds with one decimal under ten and is empty when the turn was not watched', () => {
  expect(answeredLine(8460)).toBe('Answered in 8.5 s. ');
  expect(answeredLine(26100)).toBe('Answered in 26 s. ');
  expect(answeredLine(0)).toBe('');
  expect(answeredLine(Number.NaN)).toBe('');
});

test('txUrl joins the explorer and the hash without doubling the slash', () => {
  expect(txUrl('https://testnet.nearblocks.io/', 'AbC')).toBe('https://testnet.nearblocks.io/txns/AbC');
  expect(txUrl('https://testnet.nearblocks.io', 'AbC')).toBe('https://testnet.nearblocks.io/txns/AbC');
});

import { purseLines, tickerLine, relayRetry } from '../src/words.ts';

test('the purse chip never prints a dash: account, then stipend waiting, then a skeleton', () => {
  const p = { gold: 15, locked_bonds: 5, earned_line: 0, debts: [{ merchant: 0, repay: 5, due_day: 149, status: 'open' }, { merchant: 1, repay: 9, due_day: 150, status: 'repaid' }] };
  expect(purseLines(20, p, ['Marta', 'Pell'])).toEqual({ main: '15 gold', sub: ['5 locked in bonds', 'owe Marta 5 · due end of day 149'] });
  expect(purseLines(20, { ...p, locked_bonds: 0, debts: [] }, [])).toEqual({ main: '15 gold', sub: [] });
  expect(purseLines(20, null, [])).toEqual({ main: '20 gold waiting', sub: [] });
  expect(purseLines(null, null, [])).toBeNull();
});

test('the ticker names the newest con and the next town to hear it, or says none has landed', () => {
  const towns = ['Millford', 'Pellgate', 'Oskmoor'], names = ['Marta', 'Pell', 'Osk'];
  const r = { day: 147, town: 1, merchant: 1, class: 'sob_story', loss: 9, player: 'abc' };
  expect(tickerLine(r, 36, 147, towns, names, 'me')).toBe('Day 147: a sob story con landed in Pellgate. Pell lost 9 gold. Millford hears it on day 148.');
  expect(tickerLine(r, 36, 150, towns, names, 'me')).toBe('Day 147: a sob story con landed in Pellgate. Pell lost 9 gold.');
  expect(tickerLine({ ...r, town: 0, player: 'me' }, 36, 147, towns, names, 'me')).toBe('Your con landed in Millford. Pellgate hears it on day 148.');
  expect(tickerLine(null, 0, 1, towns, names, 'me')).toContain('No con has landed');
  expect(tickerLine(null, 36, 1, towns, names, 'me')).toBeNull();
});

test('a busy relay retries at 10, 20, 40 s and an unreachable one closes the table on the third try', () => {
  expect(relayRetry('join limit reached for now', 0)).toEqual({ kind: 'busy', wait: 10 });
  expect(relayRetry('activation limit reached for now', 5)).toEqual({ kind: 'busy', wait: 40 });
  expect(relayRetry('TypeError: Failed to fetch', 1)).toEqual({ kind: 'busy', wait: 20 });
  expect(relayRetry('TypeError: Failed to fetch', 2).kind).toBe('closed');
  expect(relayRetry('activate 502', 2).kind).toBe('closed');
});
