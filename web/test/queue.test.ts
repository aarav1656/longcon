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
