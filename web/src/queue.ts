import { classShort, esc } from './words.ts';

/** The contract seals a merchant's queue this many blocks after its oldest offer arrived. */
export const WINDOW_BLOCKS = 40;
export const MS_PER_BLOCK = 580;

export interface QOffer {
  id: number;
  player: string;
  ask: number;
  bond: number;
  pitch: string;
  block: number;
  status: string;
  batch: number | null;
  outcome: { advance: number; proposed_advance: number; clamps: string[]; reason: string; class: string; debt_id: number | null } | null;
}

const RIVALS: Record<string, string> = { doran: 'Doran Vale', wick: 'Wick the Pale', sable: 'Sable Orrin' };

/** The rival grifters are named sub-accounts; every other account is a traveler. */
export function whoIs(account: string, me: string): { name: string; kind: 'me' | 'rival' | 'other' } {
  if (account === me) return { name: 'You', kind: 'me' };
  const slug = account.split(/[0-9.]/)[0];
  if (RIVALS[slug] && account.includes('.')) return { name: RIVALS[slug], kind: 'rival' };
  return { name: 'Another traveler', kind: 'other' };
}

/** Seconds until the seal, read from the block heights the page has seen and the time it saw them. */
export function sealIn(oldestBlock: number, head: number, headSeenAt: number, now: number): number {
  const blocksNow = head + (now - headSeenAt) / MS_PER_BLOCK;
  return Math.max(0, Math.ceil(((oldestBlock + WINDOW_BLOCKS - blocksNow) * MS_PER_BLOCK) / 1000));
}

export interface Ranked {
  id: number;
  rank: number;
  player: string;
  ask: number;
  advance: number;
  status: string;
  cut: boolean;
  reason: string;
  cls: string;
}

/** The order the purse was paid down. Offers that got gold keep the order their debts were written in, which is the order the merchant listed them; the rest follow in slot order. */
export function rankBatch(offers: QOffer[]): Ranked[] {
  const paid = offers.filter((o) => (o.outcome?.advance ?? 0) > 0).sort((a, b) => (a.outcome!.debt_id ?? 0) - (b.outcome!.debt_id ?? 0));
  const rest = offers.filter((o) => !paid.includes(o));
  return [...paid, ...rest].map((o, i) => ({
    id: o.id,
    rank: i + 1,
    player: o.player,
    ask: o.ask,
    advance: o.outcome?.advance ?? 0,
    status: o.status,
    cut: !!o.outcome && o.outcome.proposed_advance > o.outcome.advance && o.outcome.clamps.some((c) => c === 'daily_loss' || c === 'treasury'),
    reason: o.outcome?.reason ?? '',
    cls: o.outcome?.class ?? '',
  }));
}

export interface RoundView {
  phase: 'none' | 'opening' | 'open' | 'reading' | 'settled';
  merchantName: string;
  slots: { id: number; player: string; ask: number; bond: number; pitch: string }[];
  left: number;
  ranking: Ranked[];
  lossCap: number;
  strongbox?: number | null;
  me: string;
  mePitch: string;
  meAsk: number;
  meBond: number;
  note: string;
  seating?: boolean;
}

const gold = (n: number) => `${n} gold`;

function card(name: string, kind: string, pitch: string, ask: number, tail = '') {
  return `<li class="qcard ${kind}"><div class="qh"><b class="qn">${esc(name)}</b><span class="qa">${ask ? gold(ask) : ''}</span></div><p class="qp">${pitch ? esc(pitch) : '<span class="qwait">Writing a pitch</span>'}</p>${tail}</li>`;
}

export function clockBlock(v: RoundView): string {
  const total = (WINDOW_BLOCKS * MS_PER_BLOCK) / 1000;
  if (v.phase === 'open') {
    const pct = Math.max(0, Math.min(100, Math.round(((total - v.left) / total) * 100)));
    return `<div class="qclock open"><span class="qk">Seals in</span><b class="qt" data-tick="seal">${v.left}</b><span class="qs">s</span><span class="qbar"><i style="width:${pct}%"></i></span></div>`;
  }
  if (v.phase === 'reading') return `<div class="qclock reading"><span class="qk">Sealed</span><b class="qt small">${esc(v.merchantName)} reads all ${v.slots.length}</b><span class="qbar run"><i></i></span></div>`;
  if (v.phase === 'settled') return `<div class="qclock settled"><span class="qk">Answered</span><b class="qt small">${v.ranking.some((r) => r.advance > 0) ? 'Purse paid down the list' : `Nobody paid, ${esc(v.merchantName)}'s purse holds`}</b></div>`;
  return `<div class="qclock"><span class="qk">${v.phase === 'opening' ? 'Rivals arriving' : 'Between rounds'}</span><b class="qt small">${v.phase === 'opening' ? 'Pitching the queue' : 'No round open'}</b></div>`;
}

function drain(v: RoundView): string {
  const cap = Math.max(1, v.lossCap);
  const segs = v.ranking.filter((r) => r.advance > 0);
  const paid = segs.reduce((s, r) => s + r.advance, 0);
  const bars = segs.map((r) => `<i class="seg ${r.player === v.me ? 'me' : ''}" style="width:${Math.min(100, (r.advance / cap) * 100)}%" title="${r.advance} gold"></i>`).join('');
  const cut = v.ranking.find((r) => r.cut);
  return `<div class="qdrain" aria-label="The merchant's daily loss cap, spent down the list"><span class="qk">Loss cap ${cap} gold</span><span class="qtrack">${bars}${cut ? '<i class="cutmark"></i>' : ''}</span><span class="qk">${paid >= cap || cut ? 'spent' : `${Math.max(0, cap - paid)} left`}</span></div>`;
}

function mech(v: RoundView): string {
  const box = v.strongbox != null ? `<b>${esc(v.merchantName)}'s strongbox ${v.strongbox} gold.</b> ` : '';
  return `<p class="qmech">${box}One NEAR AI attested read ranks every pitch in the queue, and the purse pays down that list until the ${v.lossCap} gold loss cap.</p>`;
}

export function queueHtml(v: RoundView): string {
  const head = clockBlock(v);
  if (v.phase === 'settled' || (v.phase === 'reading' && v.ranking.length)) {
    const rows = v.ranking.map((r) => {
      const w = whoIs(r.player, v.me);
      const verdict = r.advance > 0 ? `<b class="gain">${gold(r.advance)}</b>` : r.cut ? '<b class="cutoff">cut off</b>' : '<b class="no">refused</b>';
      const why = r.cut ? `Asked ${r.ask}. The daily loss cap ran out above this slot.` : r.reason;
      return `<li class="qrow ${w.kind} ${r.advance > 0 ? 'paid' : ''} ${r.cut ? 'cut' : ''}"><span class="qrank">${r.rank}</span><span class="qwho"><b>${esc(w.name)}</b><span class="qwhy">${esc(why)}${r.cls ? ` <em>${esc(classShort(r.cls))}</em>` : ''}</span></span>${verdict}</li>`;
    }).join('');
    return `<section class="panel queue settled" aria-label="The queue, ranked">${head}<div class="qbody">${mech(v)}<ol class="qrows">${rows}</ol>${drain(v)}${v.phase === 'settled' ? '<button class="btn small gold qnext" type="button" data-act="nextround">Next round</button>' : ''}${v.note ? `<p class="qnote">${esc(v.note)}</p>` : ''}</div></section>`;
  }
  if (v.seating || (v.phase === 'opening' && !v.slots.length)) {
    const rivals = ['Doran Vale', 'Wick the Pale', 'Sable Orrin'].map((n) => card(n, 'rival', '', 0)).join('');
    const you = card('You', 'me', v.mePitch, v.meAsk, '<span class="qtag live">Type over it, then press Pitch</span>');
    return `<section class="panel queue opening" aria-label="The queue">${clockBlock({ ...v, phase: 'opening' })}<div class="qbody">${mech(v)}<ol class="qcards">${rivals}${you}</ol></div></section>`;
  }
  const cards = v.slots.filter((s) => s.player !== v.me).map((s) => {
    const w = whoIs(s.player, v.me);
    return card(w.name, w.kind, s.pitch, s.ask);
  });
  const mine = v.slots.find((s) => s.player === v.me);
  const sent = !!mine;
  const you = card('You', 'me', sent ? mine!.pitch : v.mePitch, sent ? mine!.ask : v.meAsk, sent ? '<span class="qtag">In the queue</span>' : v.phase === 'open' ? '<span class="qtag live">Type over it, then press Pitch</span>' : '');
  const empty = v.phase === 'none' ? '<li class="qcard idle"><p class="qp">Three rival grifters pitch each round. Open one and you are fourth in the queue.</p><button class="btn small gold" type="button" data-act="nextround">Open a round</button></li>' : '';
  return `<section class="panel queue ${v.phase}" aria-label="The queue">${head}<div class="qbody">${mech(v)}<ol class="qcards">${cards.join('')}${v.phase === 'none' ? empty : ''}${you}</ol>${v.note ? `<p class="qnote">${esc(v.note)}</p>` : ''}</div></section>`;
}

