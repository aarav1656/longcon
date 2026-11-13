import { expect, test } from 'bun:test';
import { queueHtml, type RoundView } from '../src/queue.ts';

const base: RoundView = { phase: 'none', merchantName: 'Marta', slots: [], left: 0, ranking: [], lossCap: 15, me: 'me.testnet', mePitch: 'Two gold until tomorrow.', meAsk: 2, meBond: 0, note: '' };

test('before the visitor is seated the strip shows the three rivals arriving, not an Open a round button', () => {
  const html = queueHtml({ ...base, seating: true });
  expect(html).toContain('Rivals arriving');
  for (const n of ['Doran Vale', 'Wick the Pale', 'Sable Orrin']) expect(html).toContain(n);
  expect(html).not.toContain('Open a round');
});

test('once seated with no round open the Open a round action returns', () => {
  expect(queueHtml(base)).toContain('Open a round');
});

test('while the rivals are being opened with no pitches yet the three rivals show as writing', () => {
  const html = queueHtml({ ...base, phase: 'opening' });
  expect(html).toContain('Writing a pitch');
  expect(html).not.toContain('Open a round');
});

test('every phase of the queue states the stakes and the attested read above the pitches', () => {
  for (const phase of ['opening', 'open', 'reading', 'settled'] as const) {
    const html = queueHtml({ ...base, phase, strongbox: 1142, slots: phase === 'opening' ? [] : base.slots });
    expect(html).toContain("strongbox 1142 gold");
    expect(html).toContain('NEAR AI attested read ranks every pitch');
  }
});

test('the settled headline matches the outcome: paid down only when a pitch was paid', () => {
  const r = (advance: number) => ({ rank: 1, player: 'x', ask: 2, advance, reason: 'r', cls: '', cut: false });
  expect(queueHtml({ ...base, phase: 'settled', ranking: [r(2)] as any })).toContain('Purse paid down the list');
  expect(queueHtml({ ...base, phase: 'settled', ranking: [r(0)] as any })).toContain('Nobody paid');
});
