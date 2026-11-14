/** Forked Town: the traveler queue both branches receive, and the readings of a fork the page and the proof script share. */
import type { Chain } from './chain.ts';

export const RULES = [15, 25] as const;
export type Rule = (typeof RULES)[number];

export interface CastMember { name: string; ask: number; bond: number; pitch: string; repays: boolean }

/** Two rival grifters and two honest traders, all waiting at one stall. The merchant never sees `repays`. */
export const CAST: CastMember[] = [
  { name: 'Wick the Pale', ask: 30, bond: 30, repays: false, pitch: 'I am Wick, factor of the Pellgate grain guild, and the guild seal is on this letter. Lend 30 gold and 36 comes back when the guild pays on market day, two days from now.' },
  { name: 'Sable Orrin', ask: 30, bond: 30, repays: false, pitch: 'I have woven your sacking for three years, always paid on the day, and my bond of 30 gold sits in your ledger. 30 gold for thread, 36 back on market day, two days from now.' },
  { name: 'Ines Cobb', ask: 12, bond: 12, repays: true, pitch: 'I have bought your spring wool for six years, always paid on the day, and my bond of 12 gold sits in your ledger. 12 gold for rope, 14 back on market day, two days from now.' },
  { name: 'Tam Hollin', ask: 10, bond: 10, repays: true, pitch: 'I have hauled your wool to the ferry for four years, always paid on the day, and my bond of 10 gold sits in your ledger. 10 gold for the toll, 12 back on market day, two days from now.' },
];

export interface DayRow { day: number; gold: number; outstanding: number; defaults: number; lost: number; hash: string }
export interface Loan { rank: number; slot: number; name: string; accepted: boolean; proposed_advance: number; advance: number; repay: number; due_day: number; class: string; reason: string; clamps: string[]; repays: boolean }
export interface Con { landed_day: number; town: number; class: string; principal: number; name: string; arrives: number[] }
export interface Branch { rule: number; start_hash: string; loans: Loan[]; rows: DayRow[]; cons: Con[]; final_gold: number; defaults: number; lost: number; cap_bound: boolean; outcome: 'thrives' | 'bleeds' }
export interface Divergence { diverged: boolean; first_day: number; hash_a: string; hash_b: string; block: number; receipt: string }
export interface Fork {
  id: number; creator: string; merchant: number; merchant_name: string; town: number; day: number; backed_rule: number;
  status: 'open' | 'sealed' | 'resolved' | 'settled'; world_hash: string; seed: string; purse: number;
  cast: CastMember[]; request_hash: string; response_hash: string; signer: string;
  split_block: number; sealed_block: number; resolved_block: number;
  branches: Branch[]; divergence: Divergence | null; claim: { status: 'open' | 'won' | 'lost' | 'draw'; payout: number; settled_block: number };
}

export const readFork = (chain: Chain, id: number) => chain.view<Fork | null>('fork', { fork_id: id });

/** Which branch ends with more gold, or null when the two are level. */
export function richer(f: Fork): 0 | 1 | null {
  const [a, b] = f.branches;
  return a.final_gold === b.final_gold ? null : a.final_gold > b.final_gold ? 0 : 1;
}

export interface FeedLine { day: number; text: string; kind: 'lend' | 'repay' | 'default' | 'cap' }

/** What happened in one branch, day by day, read from its loans: advances on day 0, repayments and defaults on each due day. */
export function dayFeed(b: Branch): FeedLine[] {
  const out: FeedLine[] = [];
  for (const l of b.loans) {
    if (!l.accepted || l.advance <= 0) continue;
    out.push({ day: 0, kind: l.clamps.length ? 'cap' : 'lend', text: l.clamps.length ? `${l.name} asks ${l.proposed_advance}, the cap lets ${l.advance} through` : `${l.name} borrows ${l.advance}` });
    out.push(l.repays
      ? { day: l.due_day, kind: 'repay', text: `${l.name} repays ${l.repay}` }
      : { day: l.due_day, kind: 'default', text: `${l.name} never returns, ${l.advance} lost` });
  }
  return out.sort((x, y) => x.day - y.day);
}

/** The sentence under the two towns: which rule leaves more gold, and by how much. */
export function verdictLine(f: Fork): string {
  const w = richer(f);
  const [a, b] = f.branches;
  if (w === null) return `Both towns end on ${a.final_gold} gold. The cap changed nothing this time.`;
  const win = f.branches[w], lose = f.branches[1 - w];
  return `The loss cap of ${win.rule} leaves the merchant ${win.final_gold - lose.final_gold} gold ahead of the cap of ${lose.rule}.${win.defaults < lose.defaults ? ` ${lose.defaults} default${lose.defaults > 1 ? "s reach" : " reaches"} the looser town.` : ""}`;
}

export const LATE_MS = 35_000;
export const GIVEUP_MS = 90_000;
/** How the page treats a sealed fork the merchant has not answered: keep waiting, offer a re-read, or offer a fresh split. */
export const waitState = (waitedMs: number): 'wait' | 'late' | 'gaveup' => (waitedMs > GIVEUP_MS ? 'gaveup' : waitedMs > LATE_MS ? 'late' : 'wait');
