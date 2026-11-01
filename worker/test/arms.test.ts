import { expect, test } from 'bun:test';
import { HITS, PITCH_MAX_BYTES, hitAsk, offerFinished, tally, type Trial } from '../src/arms.ts';

test('every hit pitch fits the contract limit and names the ask it carries', () => {
  expect(HITS.length).toBe(5);
  for (const h of HITS) {
    for (const ask of [7, 15, 60]) {
      const t = h.text(ask);
      expect(Buffer.byteLength(t)).toBeLessThanOrEqual(PITCH_MAX_BYTES);
      expect(t).toContain(`${ask} gold`);
    }
  }
});

test('hit ask is the bond plus half the repaid principal, at least one', () => {
  expect(hitAsk(5, 4)).toBe(7);
  expect(hitAsk(5, 1)).toBe(6);
  expect(hitAsk(10, 12)).toBe(16);
});

test('tally counts only trials whose warm-up repaid, and only a nonzero advance as landed', () => {
  const t = (arm: string, warm: Trial['warm'], hitStatus?: string, advance = 0, proposed = advance): Trial => ({ arm, hit: 'x', warm, hitStatus, advance, proposed });
  const rows = tally([
    t('a', 'repaid', 'committed', 7),
    t('a', 'repaid', 'refused', 0, 0),
    t('a', 'repaid', 'committed', 0, 7),
    t('a', 'refused'),
    t('b', 'repaid', 'committed', 5),
  ]);
  const a = rows.find((r) => r.arm === 'a')!;
  expect(a).toEqual({ arm: 'a', n: 4, warm_ok: 3, hit_committed: 1, hit_proposed: 2, rate: 1 / 3 });
  expect(rows.find((r) => r.arm === 'b')!.rate).toBe(1);
  expect(Number.isNaN(tally([t('c', 'refused')])[0].rate)).toBe(true);
});

test('an offer is not finished in the stale view between inclusion and the yield opening', () => {
  expect(offerFinished({ pending_offer: null, settled: 1 }, 2)).toBe(false); // second offer sent, first one's numbers still showing
  expect(offerFinished({ pending_offer: 7, settled: 1 }, 2)).toBe(false);
  expect(offerFinished({ pending_offer: null, settled: 2 }, 2)).toBe(true);
  expect(offerFinished(null, 1)).toBe(false);
});
