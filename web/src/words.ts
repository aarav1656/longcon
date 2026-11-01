/** Plain-English wording for contract enums. Pure, so it is tested without a browser. */

export const CLASS_LABEL: Record<string, string> = {
  future_cargo: 'a promise of cargo on its way',
  borrowed_authority: 'a powerful name dropped',
  sob_story: 'a sob story',
  urgency: 'false urgency',
  false_collateral: 'collateral that is not there',
  other: 'a pitch the road has no name for yet',
};

export const CLASS_SHORT: Record<string, string> = {
  future_cargo: 'cargo promise',
  borrowed_authority: 'name drop',
  sob_story: 'sob story',
  urgency: 'false urgency',
  false_collateral: 'fake collateral',
  other: 'new kind',
};

export const CLAMP_SENTENCE: Record<string, string> = {
  ask: 'The merchant offered more than you asked for, so the road paid what you asked.',
  exposure: 'Your credit with the road is your bond plus what trading has earned, minus what you already owe. It stopped here.',
  daily_loss: 'This merchant had reached the road\'s cap on gold lost on that due day.',
  treasury_30pct: 'Open advances may not pass 30 percent of a merchant\'s capital.',
  merchant_gold: 'The merchant ran out of coin.',
  due_days: 'Due dates run from 1 to 5 days. The road moved this one.',
  repay_floor: 'Interest cannot be negative. The road raised the repayment to the amount advanced.',
  repay_ceiling: 'Interest is capped at 50 percent. The road lowered the repayment.',
  sell_quote: 'The road limits how far a merchant moves a sell price in one day.',
  buy_quote: 'A buy price stays below every sell price on the road, so grain cannot be traded in a circle for free gold.',
};

export const STATUS_LABEL: Record<string, string> = {
  pending: 'waiting for the merchant',
  committed: 'advanced',
  refused: 'refused',
  timed_out: 'no answer, bond returned',
};

export const clampSentence = (tag: string): string => CLAMP_SENTENCE[tag] ?? `The road limited this (${tag}).`;
export const classLabel = (c: string): string => CLASS_LABEL[c] ?? CLASS_LABEL.other;
export const classShort = (c: string): string => CLASS_SHORT[c] ?? CLASS_SHORT.other;

/** `a1b2c3...d4e5` for an account or hash, so rows stay on one line. */
export function shortId(s: string, head = 6, tail = 4): string {
  if (!s) return '';
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const byteLen = (s: string): number => new TextEncoder().encode(s).length;

export interface PitchCheck {
  ok: boolean;
  why: string;
}

/** Same bounds the contract enforces, so a bad pitch is stopped before it costs a transaction. */
export function checkPitch(pitch: string, ask: number, bond: number, gold: number, maxAsk: number, maxBytes = 400): PitchCheck {
  if (!pitch.trim()) return { ok: false, why: 'Write a pitch first.' };
  if (byteLen(pitch) > maxBytes) return { ok: false, why: `The pitch is over ${maxBytes} bytes.` };
  if (!Number.isInteger(ask) || ask < 1 || ask > maxAsk) return { ok: false, why: `Ask for between 1 and ${maxAsk} gold.` };
  if (!Number.isInteger(bond) || bond < 0) return { ok: false, why: 'The bond is a whole number of gold.' };
  if (bond > gold) return { ok: false, why: `You hold ${gold} gold, so you cannot bond ${bond}.` };
  return { ok: true, why: '' };
}

export interface Move {
  text: string;
  tone: 'wait' | 'act';
}

/** The one sentence that tells a stranger what to do next, derived from the chain state only. */
export function nextMove(p: { ready: boolean; pending: boolean; openDebts: number; offers: number; records: number; day: number; dueDay?: number }): Move {
  if (!p.ready) return { text: 'Opening your account on testnet. The relayer pays the gas.', tone: 'wait' };
  if (p.pending) return { text: 'The merchant is reading your pitch. The answer is checked against its signature before any gold moves.', tone: 'wait' };
  if (p.openDebts > 0) {
    const due = p.dueDay ?? p.day;
    return {
      text: due >= p.day
        ? `You owe the road. Pay it back to grow your credit, or end day ${p.day} through day ${due} and let it default.`
        : 'You owe the road. End the day to settle it.',
      tone: 'act',
    };
  }
  if (p.offers === 0) return { text: 'Pick a merchant, write a pitch, and ask for gold.', tone: 'act' };
  if (p.records === 0) return { text: 'Ask again, or take an advance and let it default: the con lands when its due day ends.', tone: 'act' };
  return { text: 'The ledger has a landed con. Pitch a town that has not heard of it yet.', tone: 'act' };
}

export const distance = (a: number, b: number): number => Math.abs(a - b);

/** Mirrors contract rules.rs news_arrives: a con landed on `day` in town `origin` is known in `town` from this day. */
export const newsArrives = (day: number, origin: number, town: number): number => day + distance(origin, town);

/** The line under a verdict: how long the turn took from the pitch to the contract's answer. Empty when this page did not watch the turn. */
export function answeredLine(ms: number): string {
  if (!(ms > 0)) return '';
  return `Answered in ${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s. `;
}

/** Explorer page for a transaction the relayer submitted for the player. */
export const txUrl = (explorer: string, tx: string): string => `${explorer.replace(/\/+$/, '')}/txns/${tx}`;
