import { readFileSync } from 'node:fs';
import { actions as A, Account, JsonRpcProvider, KeyPairSigner } from 'near-api-js';
import { view } from './chain.ts';

export type ConClass = 'future_cargo' | 'borrowed_authority' | 'sob_story' | 'urgency' | 'false_collateral';

export interface Persona {
  slug: string;
  name: string;
  ask: number;
  /** Cons this grifter knows, in order of preference. The visitor's starter pitch is index 0 of future_cargo; rivals only use the variants after it. */
  repertoire: ConClass[];
}

export const PERSONAS: Persona[] = [
  { slug: 'doran', name: 'Doran Vale', ask: 3, repertoire: ['borrowed_authority', 'urgency'] },
  { slug: 'wick', name: 'Wick the Pale', ask: 2, repertoire: ['future_cargo', 'sob_story'] },
  { slug: 'sable', name: 'Sable Orrin', ask: 4, repertoire: ['false_collateral', 'borrowed_authority'] },
];

const PITCHES: Record<string, string[]> = {
  borrowed_authority: [
    'The Reeve of {town} sent me for {ask} gold of seed on his writ. He pays on market day and hates to wait.',
    'I carry the Reeve of {town}\'s seal. Lend {ask} gold in his name and he remembers who helped him.',
  ],
  urgency: [
    'My axle snapped at your door and the buyer leaves at noon. {ask} gold now, {more} back before the bells.',
    'The ferry leaves in minutes and I need {ask} gold to board. {more} back to you by tomorrow, on my word.',
  ],
  sob_story: [
    'My mother is ill and the physic wants {ask} gold today. I have never owed a coin. I repay {more} at harvest.',
    'My brother has a fever and the apothecary wants {ask} gold. I repay {more} as soon as the harvest comes.',
  ],
  false_collateral: [
    'I leave you the deed to my loom, worth thirty gold, in a barn at the edge of {town}. Lend {ask} gold against it.',
    'My brother-in-law owns two mills past the river and stands surety. Lend me {ask} gold against his name.',
  ],
  future_cargo: [
    'Two gold until tomorrow for a sack of seed. I pay back three.',
    'Lend me {ask} gold for seed before the frost. I bring {more} back the day the barley sells.',
    'A sack of seed costs {ask} gold and I am short. Lend it and the sack pays you {more} at harvest.',
  ],
};

/** The class this grifter pitches today: the one in its repertoire the road has heard least, so a class that just landed is dropped for the next. Ties keep the repertoire's order. */
export function pickClass(p: Persona, heard: Record<string, number>): ConClass {
  let best = p.repertoire[0];
  for (const c of p.repertoire) if ((heard[c] ?? 0) < (heard[best] ?? 0)) best = c;
  return best;
}

export function pitchFor(p: Persona, cls: ConClass, town: string, round: number): string {
  const list = cls === 'future_cargo' ? PITCHES[cls].slice(1) : PITCHES[cls];
  const text = list[round % list.length].replaceAll('{town}', town).replaceAll('{ask}', String(p.ask)).replaceAll('{more}', String(p.ask + 1));
  if (new TextEncoder().encode(text).length > 400) throw new Error(`pitch for ${p.slug}/${cls} is over 400 bytes`);
  return text;
}

export interface Body {
  id: string;
  persona: string;
  gold: number;
  offersTotal: number;
  offersToday: number;
  cons: number;
  pending: boolean;
}

/** The persona's account with room left to pitch: no offer waiting, its allowance and the day's offers unused, gold for the bond, and the fewest recorded defaults. */
export function chooseBody(bodies: Body[], persona: Persona, bond: number, maxTotal = 24, maxToday = 6): Body | null {
  const ready = bodies.filter((b) => b.persona === persona.slug && !b.pending && b.offersTotal < maxTotal && b.offersToday < maxToday && b.gold >= bond);
  ready.sort((a, b) => a.cons - b.cons || a.offersTotal - b.offersTotal);
  return ready[0] ?? null;
}

export function heardClasses(news: { class: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of news) out[n.class] = (out[n.class] ?? 0) + 1;
  return out;
}

interface RivalFile { accounts: { id: string; persona: string; key: string }[] }

export function loadRivals(path: string, provider: JsonRpcProvider): Map<string, Account> {
  const file = JSON.parse(readFileSync(path, 'utf8')) as RivalFile;
  return new Map(file.accounts.map((a) => [a.id, new Account(a.id, provider, KeyPairSigner.fromSecretKey(a.key as any))]));
}

export interface RoundResult { merchant: number; opened: boolean; offers: { persona: string; account: string; class: string; tx?: string }[]; reason?: string }

export function makeConductor(contractId: string, provider: JsonRpcProvider, rivals: Map<string, Account>, personaOf: (id: string) => string) {
  let round = 0;
  const log = (o: object) => console.log(JSON.stringify({ t: new Date().toISOString(), ev: 'rival', ...o }));

  async function bodies(): Promise<Body[]> {
    const pending: { player: string }[] = await view(provider, contractId, 'pending_offers');
    const busy = new Set(pending.map((p) => p.player));
    const day: { day: number } = await view(provider, contractId, 'state');
    return Promise.all([...rivals.keys()].map(async (id) => {
      const p: any = await view(provider, contractId, 'player', { account_id: id });
      if (!p) return { id, persona: personaOf(id), gold: 0, offersTotal: 99, offersToday: 99, cons: 0, pending: true };
      return {
        id,
        persona: personaOf(id),
        gold: Number(p.gold),
        offersTotal: Number(p.offers_total),
        offersToday: p.offers_day === day.day ? Number(p.offers_today) : 0,
        cons: Number(p.cons_landed),
        pending: busy.has(id) || p.pending_offer != null,
      } satisfies Body;
    }));
  }

  /** Open a round at a merchant: every rival with room posts its pitch to the merchant's queue. A queue that already holds offers is a round in progress and is left alone. */
  return async function openRound(merchant: number, townName: string): Promise<RoundResult> {
    const [queue]: [number[], number] = await view(provider, contractId, 'queue', { merchant });
    if (queue.length > 0) return { merchant, opened: false, offers: [], reason: 'a round is already open at this stall' };
    const [news, all] = await Promise.all([view<any[]>(provider, contractId, 'news_at', { merchant }), bodies()]);
    const heard = heardClasses(news);
    const n = round++;
    const posted = await Promise.all(PERSONAS.map(async (persona) => {
      const body = chooseBody(all, persona, persona.ask);
      if (!body) return null;
      const cls = pickClass(persona, heard);
      const acc = rivals.get(body.id)!;
      const res: any = await acc.signAndSendTransaction({
        receiverId: contractId,
        actions: [A.functionCall('offer', { merchant, ask: persona.ask, bond: persona.ask, pitch: pitchFor(persona, cls, townName, n) }, 150_000_000_000_000n, 0n)],
        waitUntil: 'INCLUDED',
      } as any).catch((e: any) => { log({ persona: persona.slug, account: body.id, error: String(e?.message ?? e).slice(0, 200) }); return null; });
      if (!res) return null;
      const tx = res?.transaction?.hash ?? res?.transactionOutcome?.id ?? res?.transaction_outcome?.id;
      log({ persona: persona.slug, account: body.id, class: cls, merchant, tx });
      return { persona: persona.slug, account: body.id, class: cls, tx };
    }));
    const offers = posted.filter((x): x is NonNullable<typeof x> => x !== null);
    return { merchant, opened: offers.length > 0, offers, reason: offers.length ? undefined : 'no rival has room to pitch' };
  };
}
