import { PublicKey, baseEncode } from 'near-api-js';

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
  if (Array.from(pitch).some((c) => c.codePointAt(0)! < 0x20 && c !== '\n')) return { ok: false, why: 'Remove control characters from the pitch.' };
  if (!Number.isInteger(ask) || ask < 1 || ask > maxAsk) return { ok: false, why: `Ask for between 1 and ${maxAsk} gold.` };
  if (!Number.isInteger(bond) || bond < 0) return { ok: false, why: 'The bond is a whole number of gold.' };
  if (bond > gold) return { ok: false, why: `You hold ${gold} gold, so you cannot bond ${bond}.` };
  return { ok: true, why: '' };
}

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newsLines(body: string): string[] {
  try {
    const content = JSON.parse(body)?.messages?.[1]?.content;
    if (typeof content !== 'string') return [];
    const lines = content.split('\n');
    const start = lines.findIndex((line) => line.includes('News that has reached your town:'));
    if (start < 0) return [];
    const end = lines.findIndex((line, i) => i > start && line.endsWith('traveler(s) are waiting.'));
    return lines.slice(start + 1, end < 0 ? undefined : end).filter((line) => line.startsWith('- day '));
  } catch {
    return [];
  }
}

export function signedText(kind: string, model: string, reqHash: string, respHash: string): string {
  return kind === 'gateway' ? `${reqHash}:${respHash}` : `${model}:${reqHash}:${respHash}`;
}

export function signatureValid(kind: string, model: string, reqHash: string, respHash: string, sigHex: string, keyHex: string): boolean {
  try {
    const hexBytes = (value: string) => {
      const clean = value.replace(/^0x/, '');
      if (!/^(?:[0-9a-f]{2})+$/i.test(clean)) throw new Error('invalid hex');
      return Uint8Array.from(clean.match(/.{2}/g)!, (b) => parseInt(b, 16));
    };
    return PublicKey.fromString(`ed25519:${baseEncode(hexBytes(keyHex))}`).verify(
      new TextEncoder().encode(signedText(kind, model, reqHash, respHash)), hexBytes(sigHex),
    );
  } catch {
    return false;
  }
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

/** The HUD purse chip, most certain value first: the account read, then the stipend a new account receives, then nothing (the page shows a skeleton). */
export function purseLines(
  stipend: number | null,
  p: { gold: number; locked_bonds: number; earned_line: number; debts: { merchant: number; repay: number; due_day: number; status: string }[] } | null,
  names: string[],
): { main: string; sub: string[] } | null {
  if (p) {
    const sub: string[] = [];
    if (p.locked_bonds > 0) sub.push(`${p.locked_bonds} locked in bonds`);
    if (p.earned_line > 0) sub.push(`credit ${p.earned_line}`);
    const due = p.debts.filter((d) => d.status === 'open').sort((a, b) => a.due_day - b.due_day)[0];
    if (due) sub.push(`owe ${names[due.merchant] ?? 'the road'} ${due.repay} · due end of day ${due.due_day}`);
    return { main: `${p.gold} gold`, sub };
  }
  return stipend === null ? null : { main: `${stipend} gold waiting`, sub: [] };
}

const conPhrase = (c: string): string => (c === 'other' || !CLASS_SHORT[c] ? 'a new kind of con' : `a ${CLASS_SHORT[c]} con`);

/** The news ticker from the newest con record. Null while records exist but have not been read yet. */
export function tickerLine(
  r: { day: number; town: number; merchant: number; class: string; loss: number; player: string } | null,
  records: number, today: number, towns: string[], names: string[], me: string,
): string | null {
  if (!r) return records === 0 ? 'No con has landed on this road yet. The first one is named on the wanted board.' : null;
  const next = towns.map((t, k) => ({ t, k, d: newsArrives(r.day, r.town, k) })).filter((x) => x.k !== r.town && x.d > today).sort((a, b) => a.d - b.d)[0];
  const hears = next ? ` ${next.t} hears it on day ${next.d}.` : '';
  if (r.player === me) return `Your con landed in ${towns[r.town]}.${hears}`;
  return `Day ${r.day}: ${conPhrase(r.class)} landed in ${towns[r.town]}. ${names[r.merchant] ?? 'A merchant'} lost ${r.loss} gold.${hears}`;
}

/** After the relayer fails to open an account: retry at 10, 20, 40 s, or close the table when it stays unreachable for three tries. */
export function relayRetry(err: string, attempt: number): { kind: 'busy' | 'closed'; wait: number } {
  const unreachable = /failed to fetch|networkerror|load failed|50[234]|timed out/i.test(err);
  return { kind: unreachable && attempt >= 2 ? 'closed' : 'busy', wait: [10, 20, 40][Math.min(attempt, 2)] };
}
