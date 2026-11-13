import { expect, test } from 'bun:test';
import { PERSONAS, chooseBody, heardClasses, pickClass, pitchFor, type Body } from '../src/rivals.ts';

const [doran, wick, sable] = PERSONAS;

test('a grifter drops the con the road has just heard and picks the one it has heard least', () => {
  expect(pickClass(doran, {})).toBe('borrowed_authority');
  expect(pickClass(doran, heardClasses([{ class: 'borrowed_authority' }]))).toBe('urgency');
  expect(pickClass(doran, heardClasses([{ class: 'borrowed_authority' }, { class: 'urgency' }, { class: 'urgency' }]))).toBe('borrowed_authority');
});

test('no rival ever speaks the visitor starter pitch word for word', () => {
  const starter = 'Two gold until tomorrow for a sack of seed. I pay back three.';
  for (const p of PERSONAS) for (let r = 0; r < 6; r++) expect(pitchFor(p, 'future_cargo', 'Millford', r)).not.toBe(starter);
});

test('every pitch fits the contract limit and names the amount the rival asks', () => {
  for (const p of PERSONAS) for (const c of p.repertoire) for (let r = 0; r < 4; r++) {
    const text = pitchFor(p, c, 'Millford', r);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(400);
    expect(text.length).toBeLessThanOrEqual(125); // fits the queue card without being cut
    expect(/[\u0000-\u001f]/.test(text)).toBe(false);
    expect(text).not.toContain('{');
  }
  expect(pitchFor(sable, 'false_collateral', 'Pellgate', 0)).toContain('Pellgate');
  expect(pitchFor(wick, 'urgency', 'Millford', 0)).toContain('2 gold');
});

const body = (o: Partial<Body>): Body => ({ id: 'x', persona: 'doran', gold: 20, offersTotal: 0, offersToday: 0, cons: 0, pending: false, ...o });

test('a body is chosen only with room: no offer waiting, allowance left, gold for the bond', () => {
  const bodies = [
    body({ id: 'busy', pending: true }),
    body({ id: 'spent', offersTotal: 24 }),
    body({ id: 'today', offersToday: 6 }),
    body({ id: 'poor', gold: 5 }),
    body({ id: 'defaulted', cons: 2 }),
    body({ id: 'clean', cons: 0, offersTotal: 3 }),
    body({ id: 'other', persona: 'wick' }),
  ];
  expect(chooseBody(bodies, doran, 6)?.id).toBe('clean');
  expect(chooseBody(bodies.filter((b) => b.id !== 'clean'), doran, 6)?.id).toBe('defaulted');
  expect(chooseBody(bodies.filter((b) => ['busy', 'spent', 'today', 'poor'].includes(b.id)), doran, 6)).toBeNull();
});
