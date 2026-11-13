import './style.css';
import { Chain, Config, explain, identity, loadConfig } from './chain.ts';
import { loadTraction, renderTraction, type Traction } from './traction.ts';
import { createWorld } from './world.ts';
import { sfx, startMusic, toggleMute, muted } from './sfx.ts';
import { checkPitch, classLabel, classShort, clampSentence, esc, newsArrives, shortId, txUrl, answeredLine, newsLines, sha256Hex, signatureValid, purseLines, tickerLine, relayRetry, travelStops, conLandDay, sealLine, heardLine, answerPhase } from './words.ts';

interface Merchant { id: number; name: string; town: number; gold: number; grain: number; outstanding: number; buy_price: number; sell_price: number; lost_total: number; town_name: string; treasury_room: number; due_exposure: number[] }
interface Rules { loss_cap_per_day: number; treasury_cap_pct: number; max_due_days: number; max_interest_pct: number; max_ask: number; gold_stipend: number; towns: string[] }
interface StateV { day: number; day_length_ms: number; day_started_ns: string; model: string; signers: [string, string][]; merchants: Merchant[]; records: number; offers: number; players: number; rules: Rules }
interface Debt { id: number; merchant: number; principal: number; repay: number; bond: number; due_day: number; status: string; class: string }
interface PlayerV { gold: number; grain: number; earned_line: number; locked_bonds: number; outstanding: number; pending_offer: number | null; offers_total: number; cons_landed: number; debts: Debt[] }
interface Outcome { status: string; proposed_advance: number; proposed_repay: number; advance: number; repay: number; due_day: number; class: string; reason: string; clamps: string[]; debt_id: number | null; model: string; signer: string; response_hash: string }
interface Offer { id: number; merchant: number; ask: number; bond: number; pitch: string; day: number; status: string; batch: number | null; request_hash: string; outcome: Outcome | null }
interface BatchV { signature: string; response_hash: string }
interface Rec { id: number; debt_id?: number; day: number; town: number; merchant: number; player: string; class: string; principal: number; bond_burned: number; loss: number; request_hash: string; response_hash: string }
interface Wanted { class: string; record_id: number; first_player: string; day: number; landed: number }
interface Queued { merchant: number; ask: number; bond: number; pitch: string; at: number }

const CLASSES = ['future_cargo', 'borrowed_authority', 'sob_story', 'urgency', 'false_collateral', 'other'];
const STARTERS = [
  { label: 'Seed grain', ask: 2, bond: 5, text: 'Two gold until tomorrow for a sack of seed. I pay back three.' },
  { label: 'Drop a name', ask: 25, bond: 6, text: 'The toll keeper at Oskmoor vouches for me and said you would stand a short loan. Put 25 gold on his word and he settles it with you himself.' },
  { label: 'Sob story', ask: 20, bond: 5, text: 'My mule died on the Millford road and my children have not eaten since yesterday. Twenty gold gets us through the week, I will pay you back.' },
];

const html = new WeakMap<Element, string>();
function setHtml(el: Element, s: string) {
  if (html.get(el) === s) return;
  html.set(el, s);
  el.innerHTML = s;
}
const qtys = [2, 2, 2];
const put = (sel: string, s: string) => setHtml(document.querySelector(sel)!, s);

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const app = $('#app');

let chain: Chain;
let cfg: Config;
let st: StateV | null = null;
let pv: PlayerV | null = null;
let last: Offer | null = null;
let lastBatch: BatchV | null = null;
let attestation: any = null;
let history: Offer[] = [];
let records: Rec[] = [];
let wanted: Wanted[] = [];
let rumours: Record<string, string> = {};
let news: Rec[][] = [[], [], []];
let seenKey = '';
let selected = 0;
let busy = '';
let errMsg = '';
let pendingSince = 0;
let answeredMs = 0;
const TX_KEY = 'longcon.offer-tx';
const REQUESTS_KEY = 'longcon.requests';
const requestCaptures: Record<string, { match?: boolean; missed?: boolean; news?: string[] }> = JSON.parse(localStorage.getItem(REQUESTS_KEY) ?? '{}');
const offerTx: Record<string, string> = JSON.parse(localStorage.getItem(TX_KEY) ?? '{}');
let ready = false;
let queued: Queued | null = null;
const relay = { kind: 'ok' as 'ok' | 'busy' | 'closed', attempt: 0, retryAt: 0, timer: 0 };
let copied = '';
let lastGold = -1;
let flashUntil = 0;
let lastTraction: Traction | null = null;
const wantRecord = Number(new URLSearchParams(location.search).get('record')) || 0;
let recordShown = false;
let placed = false;
let dayHint = '';
let wantTalk = false;

const GREETING = [
  'Grain, salt, a little credit for honest faces. What brings you to my stall?',
  'Every coin that passes this gate is counted twice. Make your case, traveller.',
  'Ships come in, ships go out. Tell me why your story is worth my gold.',
];
const TOWN_ART = (m?: Merchant) => Math.min(2, Math.max(0, m?.town ?? selected));
let seenOutcome = -1; // set to the newest answer on the first read, so only answers that arrive while watching play their reaction
let talking = false;
let askOver = false;
let typedAt = 0;
let lastDay = 0;
let lineShown = '';
let typer = 0;
const VOICE = [520, 300, 420];
let world: ReturnType<typeof createWorld>;
let moodUntil = 0;
let stampFor = -1;

function skeleton() {
  app.innerHTML = `
  <div class="game">
    <div class="logo" id="logo"><b>LONG CON</b></div>
    <p class="deck">Make one lie travel three towns.</p>
    <div class="panel chip day" id="daychip"></div>
    <div class="panel chip purse" id="purse" aria-live="polite"></div>
    <button class="mute" type="button" data-act="mute" id="mute"></button>
    <div class="ticker" id="ticker" role="status"><span class="tk">NEWS</span><span id="tktext"></span></div>
    <section class="world" id="world" aria-label="The road. Walk with the arrow keys or WASD, press E next to a merchant to talk, or click where to walk.">
      <canvas id="worldcanvas"></canvas>
      <p class="walkhint">Arrows or WASD to walk. E to talk. Or click where to go.</p>
      <div class="pad" aria-hidden="true">
        <button type="button" data-pad="up">&#9650;</button><button type="button" data-pad="left">&#9664;</button>
        <button type="button" data-pad="right">&#9654;</button><button type="button" data-pad="down">&#9660;</button>
        <button type="button" class="act" data-pad="act">E</button>
      </div>
      <div class="pitchbar"><button class="btn gold big" id="pitchgo" type="button" data-act="pitchgo"><kbd>E</kbd><span id="pitchgolabel">Pitch for gold</span></button></div>
    </section>
    <nav class="roadmap" aria-label="The road"><span class="sr" id="roadnote">Three towns on one road. News of a con travels one town per day.</span><div id="road"></div></nav>
    <section class="stage" id="stage" aria-label="The market stall">
     <div class="left"><div class="scene">
      <img class="layer" id="scene-back" alt="" src="/art/town0-back.png">
      <div class="merchant" id="merchant" data-m="0" role="img" aria-label="The merchant"></div>
      <img class="layer" id="scene-front" alt="" src="/art/town0-front.png">
      <div class="sign panel" id="sign"></div>
      <div class="bubble" id="mline" aria-live="polite"></div>
      <div id="seal"></div>
      <div class="coins" id="coins"></div>
      <button class="btn small back" type="button" data-act="leave">&#9664; Back to the road <kbd>Esc</kbd></button>
     </div>
     <div class="board panel" id="board" aria-live="polite"></div></div>
     <div class="dialog" aria-label="The table">
      <div class="face">
        <div class="portrait" id="portrait" data-m="0" role="img" aria-label="Merchant portrait"></div>
        <div class="who2"><p class="nameplate" id="nameplate"></p><p class="say" id="say"></p></div>
      </div>
      <div class="panel speech" id="pitchbox"></div>
      <div class="panel verdict" id="verdict" aria-live="polite"></div>
     </div>
    </section>
    <section class="lower">
      <div class="panel sec" id="mine"></div>
      <div class="panel sec" id="ledger">
        <div class="head"><h2><span class="ico s scroll"></span>The con ledger</h2><span class="hint" id="ledgernote"></span></div>
        <div class="recs" id="recs"></div>
        <div id="side"></div>
      </div>
    </section>
    <section class="panel sec traction" aria-label="Live road activity">
      <div class="head"><h2><span class="ico s star"></span>The road's record</h2><button class="btn small" type="button" data-act="traction-refresh">Refresh</button></div>
      <div class="traction-values" id="traction-values"><p class="empty">Reading finalized event receipts.</p></div>
      <p class="traction-stamp" id="traction-stamp" aria-live="polite">Reading finalized event receipts.</p>
    </section>
    <footer><p class="who" id="who"></p><p id="foot"></p></footer>
  </div>`;
  mountForm();
}

function mountForm() {
  $('#pitchbox').innerHTML = `
    <p class="who" id="target"></p>
    <div class="choices" role="group" aria-label="Pitch starters">
      ${STARTERS.map((s, i) => `<button class="btn small" type="button" data-act="starter" data-i="${i}">${esc(s.label)}</button>`).join('')}
    </div>
    <div class="field"><label class="sr" for="pitch">What you say to the merchant</label>
      <div class="well"><textarea id="pitch" maxlength="400" placeholder="Pick a starter or make your own case. The merchant weighs it against the news in town."></textarea></div></div>
    <div class="wager">
      <div class="field"><label for="ask">Ask</label><div class="well"><span class="ico s coin"></span><input id="ask" type="number" min="1" max="60" value="${STARTERS[0].ask}" inputmode="numeric"></div></div>
      <div class="field"><label for="bond">Bond</label><div class="well"><span class="ico s lock"></span><input id="bond" type="number" min="0" value="${STARTERS[0].bond}" inputmode="numeric"></div></div>
      <button class="btn gold big" id="send" data-act="pitch" type="button">Pitch</button>
    </div>
    <p class="hint"><span id="capline"></span> <span id="pitchcount">0 of 400 bytes</span></p>
    <p class="err" id="err" role="alert"></p>`;
  $<HTMLTextAreaElement>('#pitch').value = STARTERS[0].text;
  $<HTMLTextAreaElement>('#pitch').addEventListener('input', syncForm);
  $<HTMLInputElement>('#ask').addEventListener('input', syncForm);
  $<HTMLInputElement>('#bond').addEventListener('input', syncForm);
}

function applyStarter(i: number) {
  const s = STARTERS[i];
  $<HTMLTextAreaElement>('#pitch').value = s.text;
  $<HTMLInputElement>('#ask').value = String(s.ask);
  $<HTMLInputElement>('#bond').value = String(s.bond);
  syncForm();
}

function syncForm() {
  const pitch = $<HTMLTextAreaElement>('#pitch').value;
  const bytes = new TextEncoder().encode(pitch).length;
  $('#pitchcount').textContent = `${bytes} of 400 bytes`;
  const m = st?.merchants[selected];
  if (m) $('#target').textContent = `${m.name.toUpperCase()} · ${m.town_name.toUpperCase()} · strongbox ${m.gold} gold`;
  const send = $<HTMLButtonElement>('#send');
  const waiting = !!pv?.pending_offer;
  const inFlight = waiting || busy === 'offer' || (!!queued && !ready);
  send.hidden = relay.kind === 'closed' && !ready;
  send.disabled = inFlight;
  send.setAttribute('aria-busy', String(inFlight));
  send.textContent = inFlight ? (waiting ? `${m?.name ?? 'The merchant'} is reading` : 'Pitch sent') : m ? `Pitch ${m.name}` : 'Pitch';
  $('#err').textContent = errMsg;
  const ask = Number($<HTMLInputElement>('#ask').value) || 0;
  const bond = Number($<HTMLInputElement>('#bond').value) || 0;
  if (m && st) {
    // The road never lets more through than these limits; it can cut further (daily loss cap), never less strictly.
    const credit = bond + (pv?.earned_line ?? 0) - (pv?.outstanding ?? 0);
    const cap = Math.max(0, Math.min(st.rules.max_ask, m.treasury_room, m.gold, credit));
    const was = askOver;
    askOver = ask > cap;
    $('#capline').textContent = askOver ? `${m.name} frowns: the road lets at most ${cap} gold through to you here.` : `The road lets at most ${cap} gold through to you here.`;
    if (was !== askOver) renderStage();
  }
}

let capturing = false;
let lastPendingId = 0; // RPC nodes disagree for a moment, so pv.pending_offer can read null while the offer is still waiting
// The request body is readable only between the seal and the answer, a few seconds: a dedicated loop reads it
// without waiting for the full road refresh.
async function captureRequest() {
  if (capturing) return;
  capturing = true;
  try {
    const id = pv?.pending_offer || lastPendingId || (busy === 'offer' ? (await chain.view<PlayerV | null>('player', { account_id: chain.me.id }))?.pending_offer : 0);
    if (!id || Object.hasOwn(requestCaptures, String(id))) return;
    lastPendingId = id;
    await captureRequestFor(id);
  } finally { capturing = false; }
}

async function captureRequestFor(id: number) {
  const offer = await chain.view<Offer>('offer_by_id', { offer_id: id });
  if (!offer?.batch) return;
  try {
    const body = await chain.view<string>('batch_body', { batch_id: offer.batch });
    requestCaptures[String(id)] = { match: await sha256Hex(body) === offer.request_hash, news: newsLines(body) };
    localStorage.setItem(REQUESTS_KEY, JSON.stringify(requestCaptures));
  } catch (e) {
    if (!explain(String(e)).includes('batch is settled')) throw e;
    requestCaptures[String(id)] = { missed: true };
    localStorage.setItem(REQUESTS_KEY, JSON.stringify(requestCaptures));
  }
}

function signerKind(signer: string): 'gateway' | 'worker' | 'provider_tee' {
  return signer === 'gateway' ? 'gateway' : signer.startsWith('worker:') ? 'worker' : 'provider_tee';
}

/** Registered signer against the published attestation report, for the footer and the answer's disclosure. */
function proof(signer: string) {
  const kind = signerKind(signer);
  const registeredKey = Object.fromEntries(st?.signers ?? [])[signer] ?? '';
  const reportKey = kind === 'gateway' ? attestation?.gateway_signing_key : attestation?.model_signing_key;
  const tcb = kind === 'worker' ? 'Not attested: worker signer' : kind === 'gateway' ? attestation?.tcb_status?.gateway : attestation?.tcb_status?.model?.join(', ');
  return { kind, registeredKey, reportKey, tcb, attested: kind !== 'worker' && !!attestation && !!registeredKey && registeredKey === reportKey };
}

function dayLeft(): { left: number; pct: number } {
  if (!st || !(st.day_length_ms > 0)) return { left: 0, pct: 100 };
  const start = Number(BigInt(st.day_started_ns) / 1_000_000n);
  const left = Math.max(0, Math.ceil((start + st.day_length_ms - Date.now()) / 1000));
  return { left, pct: Math.min(100, Math.round(((st.day_length_ms / 1000 - left) / (st.day_length_ms / 1000)) * 100)) };
}

const skel = (w: number, label: string) => `<span class="skel" style="width:${w}px" role="img" aria-label="${esc(label)}"></span>`;
const myCons = () => records.filter((r) => r.player === chain.me.id);

function renderHud() {
  const d = dayLeft();
  const open = pv?.debts.filter((x) => x.status === 'open') ?? [];
  const names = st?.merchants.map((m) => m.name) ?? [];
  const due = st ? open.find((x) => x.due_day === st!.day) : undefined;
  $('#daychip').classList.toggle('due', !!due);
  put('#daychip', `<span class="ico ${d.left > 0 ? 'sun' : 'moon'}"></span><div><div class="v">${st ? `DAY ${st.day}` : skel(64, 'Reading the day')}</div>
    ${due ? `<div class="k due">Your debt ${esc(names[due.merchant] ?? 'to the road')} due today</div>` : `<span class="daybar" title="${d.left > 0 ? `${d.left} s daylight left` : 'The day can end'}"><i style="width:${d.pct}%"></i></span>`}</div>`);
  const pl = purseLines(st?.rules.gold_stipend ?? null, pv, names);
  const sub = pl ? [...pl.sub.filter((x) => x.startsWith('owe')), ...pl.sub.filter((x) => !x.startsWith('owe'))].slice(0, 2) : [];
  put('#purse', `<span class="ico coin"></span><div>${pl ? `<div class="v">${esc(pl.main.replace(/ waiting$/, ''))}${pl.main.endsWith(' waiting') ? '<span class="wait"> waiting</span>' : ''}</div>${sub.map((x) => `<div class="k">${esc(x)}</div>`).join('')}` : `<div class="v">${skel(64, 'Reading your purse')}</div>`}</div>`);
  const gold = pv?.gold ?? -1;
  if (lastGold >= 0 && gold >= 0 && gold !== lastGold) flashUntil = Date.now() + 1400;
  if (gold >= 0) lastGold = gold;
  $('#purse').classList.toggle('flash', Date.now() < flashUntil);
  const mute = $('#mute');
  mute.setAttribute('aria-pressed', String(muted));
  mute.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on');
  setHtml(mute, `<span class="note ${muted ? 'off' : ''}">&#9835;</span>`);
  const tk = st ? tickerLine(records[records.length - 1] ?? null, st.records, st.day, st.rules.towns, names, chain.me.id) : 'Reading the road news';
  put('#tktext', esc(tk ?? `Reading ${st?.records} landed cons`));
  const sig = last?.outcome?.signer || st?.model || '';
  const pr = proof(sig);
  put('#who', `<span class="ico s lock"></span>${esc(cfg.network)} account <span class="mono" title="${esc(chain.me.id)}">${esc(shortId(chain.me.id, 8, 6))}</span>. ${esc(st?.model ? `Merchants answer with ${st.model}` : 'Reading the road')}${pr.attested ? ', and the signer key matches the published TEE attestation' : ''}. <a href="#ledger">Con ledger</a>`);
}

function renderRoad() {
  if (!st) { put('#road', ''); return; }
  put('#road', st.merchants.map((m, i) => {
    const heard = (news[i] ?? []).length;
    const mine = myCons().map((r) => ({ r, day: newsArrives(r.day, r.town, m.town) })).filter((x) => x.day > st!.day).sort((a, b) => a.day - b.day)[0];
    const label = `${m.town_name}${heard ? `, ${heard} con${heard > 1 ? 's' : ''} heard` : ''}${mine ? `. Your con arrives day ${mine.day}` : ''}`;
    return `<button class="town" type="button" data-act="pick" data-m="${i}" aria-pressed="${i === selected}" aria-label="Go to ${esc(label)} and talk to ${esc(m.name)}">
      <span class="tsprite" style="background-position-x:${Math.min(2, m.town) * 50}%"></span>
      <span class="ttext"><span class="tn">${esc(m.town_name)}</span><span class="th">${heard ? `${heard} con${heard > 1 ? 's' : ''} heard` : 'quiet'}</span>${mine ? `<span class="tc"><i></i>your con, day ${mine.day}</span>` : ''}</span>
      ${heard ? `<span class="pin" title="${heard} con${heard > 1 ? 's' : ''} heard here">${heard}</span>` : ''}</button>`;
  }).join(''));
}

function renderStage() {
  const m = st?.merchants[selected];
  const art = TOWN_ART(m);
  const back = $<HTMLImageElement>('#scene-back');
  if (!back.src.endsWith(`/art/town${art}-back.png`)) {
    back.src = `/art/town${art}-back.png`;
    $<HTMLImageElement>('#scene-front').src = `/art/town${art}-front.png`;
  }
  const o = last;
  const mine = !!o?.outcome && o.merchant === selected;
  const now = Date.now();
  if (o?.outcome && o.id !== seenOutcome) {
    {
      moodUntil = now + 2400;
      if (o.status === 'committed') { coinBurst(o.outcome.advance); sfx.seal(); setTimeout(() => sfx.coins(o.outcome!.advance), 350); }
      else if (o.status === 'refused') sfx.refused();
      else sfx.seal();
      $('#stage').classList.remove('shake'); void $('#stage').offsetWidth; $('#stage').classList.add('shake');
      requestAnimationFrame(() => $('#verdict').scrollIntoView({ block: 'end', behavior: 'smooth' }));
    }
    seenOutcome = o.id;
  }
  const mood = pv?.pending_offer ? 'think'
    : mine && now < moodUntil ? 'talk'
      : askOver ? 'stern'
        : now - typedAt < 1500 ? 'think'
          : mine && o!.status === 'committed' ? 'pleased'
            : mine && o!.status === 'refused' ? 'stern' : 'idle';
  for (const sel of ['#merchant', '#portrait']) {
    const el = $(sel);
    el.dataset.m = String(art);
    el.dataset.mood = mood;
    el.setAttribute('aria-label', m ? `${m.name}, ${mood === 'think' ? 'reading your pitch' : mood === 'pleased' ? 'pleased' : mood === 'stern' ? 'unmoved' : 'waiting'}` : 'The merchant');
  }
  if (mine && !pv?.pending_offer) {
    if (stampFor !== o!.id) {
      stampFor = o!.id;
      setHtml($('#seal'), `<div class="stamp" data-s="${esc(o!.status)}"><span>${esc(o!.status === 'committed' ? `${o!.outcome!.advance} gold advanced` : o!.status)}</span></div>`);
    }
  } else if (stampFor !== -1) { stampFor = -1; setHtml($('#seal'), ''); }
  if (!m) { put('#sign', '<h2>The road</h2><p>Reading the contract</p>'); return; }
  const allowed = m.outstanding + m.treasury_room;
  put('#sign', `<h2>${esc(m.town_name)}</h2><p>${esc(m.name)}'s stall, town ${m.town + 1} of 3</p>
    <p class="srow"><span class="ico s coin"></span>Strongbox <b>${m.gold}</b></p>
    <p class="srow"><span class="ico s scroll"></span>Lent <b>${m.outstanding}</b> of ${allowed}</p>
    <p class="srow"><span class="ico s sack"></span>Grain <b>${m.grain}</b>, buys ${m.buy_price}, sells ${m.sell_price}</p>`);
  put('#nameplate', `${esc(m.name)}<small>${esc(m.town_name)} merchant</small>`);
  const nws = news[selected] ?? [];
  put('#board', `<h3><span class="ico s news"></span>News in ${esc(m.town_name)}</h3>
    ${nws.length ? `<ul>${nws.slice(-3).reverse().map((r) => `<li>Day ${r.day}, ${esc(st!.rules.towns[r.town])}: ${esc(classShort(r.class))}, ${r.principal} gold lost</li>`).join('')}</ul>` : '<p class="none">No cons heard of here yet.</p>'}`);
  const text = pv?.pending_offer ? 'Hmm. Let me think on that.'
    : mine && o!.outcome ? (o!.outcome!.reason || 'I have nothing more to say.')
      : GREETING[art];
  const line = `<q>${esc(text)}</q>`;
  put('#say', esc(text));
  if (line !== lineShown) {
    lineShown = line;
    const el = $('#mline');
    const full = text;
    window.clearInterval(typer);
    let i = 0;
    el.innerHTML = '';
    typer = window.setInterval(() => {
      i = Math.min(full.length, i + 2);
      el.textContent = full.slice(0, i);
      if (talking && i % 4 === 0) sfx.blip(VOICE[art]);
      if (i >= full.length) { window.clearInterval(typer); el.innerHTML = line; }
    }, 30);
  }
}

function coinBurst(n: number) {
  const stage = $('#stage').getBoundingClientRect();
  const purse = document.getElementById('purse')?.getBoundingClientRect();
  if (!purse) return;
  const count = Math.max(3, Math.min(12, n));
  const cx = stage.width * 0.3, cy = stage.height * 0.4;
  const dx = purse.left + purse.width / 2 - stage.left - cx, dy = purse.top + purse.height / 2 - stage.top - cy;
  $('#coins').innerHTML = Array.from({ length: count }, (_, k) =>
    `<i style="left:${cx + (k % 4) * 10 - 15}px;top:${cy - Math.floor(k / 4) * 8}px;--dx:${dx}px;--dy:${dy}px;animation-delay:0s,${k * 70}ms"></i>`).join('');
  setTimeout(() => { $('#coins').innerHTML = ''; }, 2200);
}

const secs = (since: number): number => (since ? Math.max(0, Math.floor((Date.now() - since) / 1000)) : 0);

function phaseInput() {
  return {
    relay: relay.kind, ready, queued: !!queued, pending: !!pv?.pending_offer, sending: busy === 'offer',
    last: last && (last.outcome || last.status === 'timed_out') ? { status: last.status, proposed: last.outcome?.proposed_advance ?? 0, clamps: last.outcome?.clamps.length ?? 0 } : null,
  };
}

function steps(done: number, s2 = '', s3 = ''): string {
  const row = (i: number, text: string) => `<li class="${i < done ? 'done' : i === done ? 'now' : 'todo'}"><span class="n">${i < done ? '✓' : i + 1}</span><span>${text}</span></li>`;
  return `<ol class="steps">${row(0, `Opening your purse (the road pays gas)${done === 0 ? ` <span class="t"><span data-tick="queue">${secs(queued?.at ?? 0)}</span> s</span>` : ''}`)}${row(1, `Sending your pitch${s2}`)}${row(2, s3 || `${esc(st?.merchants[selected]?.name ?? 'The merchant')} reads it`)}</ol>`;
}

function seal(o: Offer, oc: Outcome): string {
  const p = proof(oc.signer);
  const lb = lastBatch;
  // null while the batch is not read yet or belongs to another answer: never show a failure for a read that has not happened
  const ok = lb && lb.response_hash === oc.response_hash ? signatureValid(p.kind, oc.model, o.request_hash, lb.response_hash, lb.signature, p.registeredKey) : null;
  const capture = requestCaptures[String(o.id)];
  const requestCheck = capture?.match === true ? 'Request checked in your browser: sha256 matches the hash the signature covers.'
    : capture?.match === false ? 'Request bytes did not match the hash on chain.'
      : capture?.missed ? 'The answer came back before this page read the request.' : '';
  const keyLine = p.kind === 'worker' ? 'Worker key, not an attested key' : p.attested ? 'Registered signer key matches the published report' : 'Registered signer key does not match the published report';
  const hash = (label: string, h: string, attr: string) => `<p class="fine">${label} <code class="mono" ${attr}="${esc(h)}" title="${esc(h)}">${esc(shortId(h, 6, 4))}</code> <button class="copy" type="button" data-act="copy" data-v="${esc(h)}">${copied === h ? 'copied' : 'copy'}</button></p>`;
  return `<p class="seal ${ok === false ? 'bad' : ''}">${esc(sealLine(p.kind, oc.model, ok))}</p>
    <details class="how"><summary>How answer checked</summary>
      ${hash('Request hash', o.request_hash, 'data-request-hash')}${hash('Response hash', oc.response_hash, 'data-response-hash')}
      <p class="fine">${esc(keyLine)}</p>
      <p class="fine">TCB status: ${esc(p.tcb ?? 'Unavailable')}</p>
      ${requestCheck ? `<p class="fine">${esc(requestCheck)}</p>` : ''}
      ${capture?.news?.length ? `<div class="fine"><span>News in this request:</span><ul>${capture.news.map((line) => `<li>${esc(line)}</li>`).join('')}</ul></div>` : ''}
      <p class="fine">${attestation ? '<a href="/attestation.json" target="_blank" rel="noreferrer">Open published report &#8599;</a>' : 'Published report unavailable'}${offerTx[o.id] ? ` &middot; <a href="${esc(txUrl(cfg.explorer, offerTx[o.id]))}" target="_blank" rel="noreferrer">Your pitch transaction &#8599;</a>` : ''}</p>
      <p class="fine">${esc(answeredLine(answeredMs))}</p>
    </details>`;
}

/** Days only end at dusk, and an unpaid debt defaults when its due day ends: this is the button that lets the lie travel. */
function dayControl(o: Offer, oc: Outcome, status?: string): string {
  if (!st || status === 'repaid') return '';
  const stops = travelStops(conLandDay(oc.due_day), st.merchants[o.merchant]?.town ?? 0, st.rules.towns, st.day);
  if (stops.every((s) => s.heard)) return '';
  return `<div class="actions"><button class="btn small" type="button" data-act="endday" ${ready && !busy ? '' : 'disabled'}><span class="ico s moon"></span>End day <b class="num">${st.day}</b></button>
    <span class="fine">${esc(dayHint || 'Unpaid debts default when their day ends, and the news starts to travel.')}</span></div>`;
}

/** The lie's road: three towns, the day each hears it. Gold where it already travelled. */
function route(o: Offer, oc: Outcome): string {
  if (!st) return '';
  const debt = pv?.debts.find((x) => x.id === oc.debt_id);
  if (debt?.status === 'repaid') return '';
  const rec = records.find((r) => r.debt_id === oc.debt_id);
  const origin = st.merchants[o.merchant]?.town ?? 0;
  const landed = !!rec || debt?.status === 'defaulted';
  const day = rec ? rec.day : conLandDay(oc.due_day);
  const stops = travelStops(day, origin, st.rules.towns, st.day);
  return `<div class="route" aria-label="The road your lie travels"><p class="k">${landed ? 'Your lie is travelling' : 'Your lie travels if you do not repay'}</p>
    <ol>${stops.map((s) => `<li class="stop ${s.origin ? 'origin' : ''} ${landed && s.heard ? 'gold' : ''}"><b>${esc(s.name)}</b><span>${s.origin ? `day ${s.day}` : s.heard ? `heard day ${s.day}` : `hears day ${s.day}`}</span></li>`).join('')}</ol></div>`;
}

function renderVerdict() {
  const el = $('#verdict');
  const m = st?.merchants[selected];
  const name = (id: number) => st?.merchants[id]?.name ?? 'The merchant';
  const phase = answerPhase(phaseInput());
  const pendingId = pv?.pending_offer ?? 0;
  const pendingMerchant = history.find((h) => h.status === 'pending')?.merchant ?? selected;
  if (phase === 'closed') {
    setHtml(el, `<h3><span class="mk timed_out"></span>The table is closed</h3><p class="say2">The table is closed to new players for now. Watch the road and the ledger below.</p>`);
    return;
  }
  if (phase === 'busy') {
    const left = Math.max(0, Math.ceil((relay.retryAt - Date.now()) / 1000));
    setHtml(el, `<h3><span class="ico s hourglass"></span>The road is busy</h3>
      <p class="say2">The road is busy opening purses. Trying again in <b data-tick="retry">${left}</b> s.</p>
      <div class="actions"><button class="btn small" type="button" data-act="retry-now">Try now</button></div>`);
    return;
  }
  if (phase === 'queued') { setHtml(el, `<h3>Your pitch is lined up</h3>${steps(0)}`); return; }
  if (phase === 'sending') { setHtml(el, `<h3>Your pitch is on its way</h3>${steps(1)}`); return; }
  if (phase === 'waiting') {
    const heard = heardLine(requestCaptures[String(pendingId)]?.news?.[0] ?? '');
    const tx = offerTx[pendingId];
    setHtml(el, `<h3>${esc(name(pendingMerchant))} reads your pitch</h3>
      ${steps(2, tx ? ` <a href="${esc(txUrl(cfg.explorer, tx))}" target="_blank" rel="noreferrer">Your pitch transaction &#8599;</a>` : '', `${esc(name(pendingMerchant))} reading pitch. <span class="t"><span data-tick="pending">${secs(pendingSince)}</span> s</span>`)}
      <p class="fine">If not answered in 115 s your bond comes back.</p>
      ${heard ? `<p class="fine">${esc(heard)}</p>` : ''}`);
    return;
  }
  const o = last;
  if (phase === 'idle' || !o) {
    const n = m?.name ?? 'The merchant';
    setHtml(el, `<h3><span class="mk pending"></span>${esc(n)} answers here</h3><p class="empty" style="margin-top:8px">What you asked, what ${esc(n)} offered, and what the road let through.</p>`);
    return;
  }
  const mn = name(o.merchant);
  if (phase === 'timed_out') {
    setHtml(el, `<h3><span class="mk timed_out"></span>${esc(mn)} did not answer in time</h3><p class="say2">Your bond is back.</p><div class="actions"><button class="btn gold" type="button" data-act="again">Pitch again</button></div>`);
    return;
  }
  const oc = o.outcome!;
  const max = Math.max(o.ask, oc.proposed_advance, oc.advance, 1);
  const w = (n: number) => Math.round((n / max) * 100);
  const bars = `<div class="tri">
      <div class="r"><span class="k">You asked</span><span class="rail"><i style="width:${w(o.ask)}%"></i></span><b>${o.ask}</b></div>
      <div class="r"><span class="k">${esc(mn)} offered</span><span class="rail"><i style="width:${w(oc.proposed_advance)}%"></i></span><b>${oc.proposed_advance}</b></div>
      <div class="r allowed"><span class="k">The road allowed</span><span class="rail"><i style="width:${w(oc.advance)}%"></i></span><b>${oc.advance}</b></div>
    </div>`;
  const clamps = oc.clamps.length ? `<ul class="why">${oc.clamps.map((c) => `<li>${esc(clampSentence(c))}</li>`).join('')}</ul>` : '';
  el.dataset.requestHash = o.request_hash;
  if (phase === 'refused') {
    setHtml(el, `<h3><span class="mk refused"></span>${esc(mn)} says no</h3>
      <p class="say2">${esc(mn)} filed it as ${esc(classLabel(oc.class))}. Your ${o.bond} gold bond is back in your purse.</p>
      ${(news[o.merchant] ?? []).some((r) => r.class === oc.class) ? `<p class="fine">${esc(st?.merchants[o.merchant]?.town_name ?? 'This town')} has heard a ${esc(classShort(oc.class))} con landed on the road. A different kind of pitch gets a different answer.</p>` : ''}
      <div class="actions"><button class="btn gold" type="button" data-act="again">Try another pitch</button></div>${seal(o, oc)}`);
    return;
  }
  if (phase === 'blocked') {
    setHtml(el, `<h3><span class="mk refused"></span>The road blocked this loan</h3>${bars}${clamps}
      <p class="say2">Your ${o.bond} gold bond is back in your purse.</p>
      <div class="actions"><button class="btn gold" type="button" data-act="again">Try another pitch</button></div>${seal(o, oc)}`);
    return;
  }
  const debt = pv?.debts.find((x) => x.id === oc.debt_id);
  const open = debt?.status === 'open';
  const consequence = open ? `Repay <b>${oc.repay}</b> by end of day <b>${oc.due_day}</b>, or your ${o.bond} gold bond burns and your con lands in the ledger.`
    : debt?.status === 'repaid' ? `Repaid. Your credit grows by ${oc.advance}.`
      : debt?.status === 'defaulted' ? `Unpaid. Your ${o.bond} gold bond burned and your con is in the ledger.` : '';
  const rec = records.find((r) => r.debt_id === oc.debt_id);
  const tx = offerTx[o.id];
  setHtml(el, `<h3 class="win"><span class="mk"></span>${esc(mn)} lends you <b class="num">${oc.advance}</b> gold</h3>${bars}${clamps}
    <p class="say2">${consequence}</p>
    ${route(o, oc)}
    ${dayControl(o, oc, debt?.status)}
    <div class="actions">${open && debt ? `<button class="btn small green" type="button" data-act="repay" data-d="${debt.id}" ${pv && pv.gold >= debt.repay && !busy ? '' : 'disabled'}>Pay back ${debt.repay}</button>` : ''}
      <button class="btn small" type="button" data-act="share" data-text="${esc(`I talked ${mn} out of ${oc.advance} gold on the Long Con road. ${tx ? txUrl(cfg.explorer, tx) : location.origin}`)}">${copied === 'loan' ? 'Link copied' : 'Share this loan &#8599;'}</button>
      ${rec ? `<button class="btn small" type="button" data-act="share" data-text="${esc(`${location.origin}/?record=${rec.id}`)}" data-key="con">${copied === 'con' ? 'Link copied' : 'Share my con &#8599;'}</button>` : ''}</div>
    ${seal(o, oc)}`);
}

function renderMine() {
  const open = pv?.debts.filter((d) => d.status === 'open') ?? [];
  const day = st?.day ?? 1;
  const endsIn = dayLeft().left;
  const canEnd = ready && !busy && endsIn === 0;
  const m = st?.merchants[selected];
  put('#mine', `
    <h2><span class="ico s coin"></span>Your purse</h2>
    <h3>What you owe</h3>
    ${open.length ? `<div class="rows">${open.map((d) => `
      <div class="r"><span class="main"><span class="ico s scroll"></span><span><b>${d.repay}</b> gold to ${esc(st?.merchants[d.merchant]?.name ?? '')}, due end of day ${d.due_day}. Bond ${d.bond}.</span></span>
      <button class="btn small green" data-act="repay" data-d="${d.id}" ${pv && pv.gold >= d.repay && day <= d.due_day && !busy ? '' : 'disabled'} type="button">Pay back</button></div>`).join('')}</div>`
      : '<p class="empty">No open debts. Take an advance and it shows here with its due day.</p>'}
    <div class="endrow"><button class="btn big" data-act="endday" type="button" ${canEnd ? '' : 'disabled'}><span class="ico s ${endsIn > 0 ? 'sun' : 'moon'}"></span>${endsIn > 0 ? `Day <b class="num">${day}</b> ends in <b class="num">${endsIn}</b> s` : `End day <b class="num">${day}</b>`}</button>
      <span class="hint">Debts due today default when the day ends.</span></div>
    ${m ? `<h3>Trade grain with ${esc(m.name)}</h3>
    <div class="trade"><div class="well"><input id="qty${selected}" type="number" min="1" value="${qtys[selected]}" aria-label="Grain to trade with ${esc(m.name)}"></div>
      <button class="btn small" type="button" data-act="buy" data-m="${selected}">Buy at ${m.sell_price}</button>
      <button class="btn small" type="button" data-act="sell" data-m="${selected}">Sell at ${m.buy_price}</button></div>` : ''}
    <h3>Your recent pitches</h3>
    ${history.length ? `<div class="rows">${history.map((h) => `
      <div class="r"><span class="main"><span class="mk ${esc(h.status)}"></span>Day ${h.day}, ${esc(st?.merchants[h.merchant]?.name ?? '')}: asked ${h.ask}, got ${h.outcome?.advance ?? 0}</span><span class="hint">${h.outcome ? esc(classShort(h.outcome.class)) : 'waiting'}</span></div>`).join('')}</div>`
      : '<p class="empty">No pitches yet. The first one is one click away.</p>'}`);
}

function renderLedger() {
  if (!st) return;
  const towns = st.rules.towns;
  $('#ledgernote').textContent = `${st.records} landed, ${st.players} players, ${st.offers} pitches`;
  put('#recs', records.length
    ? [...records].reverse().map((r) => `
      <div class="rec ${r.id === wantRecord ? 'want' : ''}" id="rec-${r.id}"><span class="n">#${r.id}</span>
        <span><span class="cls">${esc(classShort(r.class))}</span> in ${esc(towns[r.town])}, day ${r.day}, by <span class="mono">${esc(shortId(r.player, 6, 6))}</span></span>
        <span class="lost">-${r.loss}</span>
        <span class="sub">${towns.map((t, k) => `${esc(t)} ${newsArrives(r.day, r.town, k) <= st!.day ? 'knows' : `hears day ${newsArrives(r.day, r.town, k)}`}`).join(' / ')}. Bond burned ${r.bond_burned}. Response <span class="mono">${esc(shortId(r.response_hash, 8, 6))}</span>
          ${r.player === chain.me.id ? `<button class="copy" type="button" data-act="share" data-key="con${r.id}" data-text="${esc(`${location.origin}/?record=${r.id}`)}">${copied === `con${r.id}` ? 'link copied' : 'Share my con &#8599;'}</button>` : ''}</span>
      </div>`).join('')
    : st.records > 0
      ? `<p class="empty" style="padding-top:8px">Reading ${st.records} landed cons...</p>${'<div class="skelrow"></div>'.repeat(3)}`
      : '<p class="empty" style="padding-top:8px">No con has landed. When a debt goes unpaid and its day ends, the loss, the class and the hashes of what the model saw and said are written here.</p>');
  put('#side', `
    <h3>Wanted board</h3>
    ${wanted.length ? `<div class="rows">${wanted.map((w) => `<div class="r"><span class="main"><b>${esc(classShort(w.class))}</b><span class="hint">first by <span class="mono">${esc(shortId(w.first_player, 6, 6))}</span>, day ${w.day}</span></span><span class="num">${w.landed} landed</span></div>`).join('')}</div>` : '<p class="empty">Be the first to land a borrowed authority con.</p>'}
    <h3>Rumour tokens you hold</h3>
    <div class="rows">${CLASSES.map((c) => `<div class="r"><span class="main">${esc(classShort(c))}</span><span class="num">${rumours[c] ?? '0'}</span></div>`).join('')}</div>
    <p class="hint" style="margin-top:8px">A landed con mints one rumour token to the con artist.</p>`);
  if (wantRecord && !recordShown && document.getElementById(`rec-${wantRecord}`)) {
    recordShown = true;
    requestAnimationFrame(() => document.getElementById(`rec-${wantRecord}`)!.scrollIntoView({ block: 'center' }));
  }
}

function renderFoot() {
  put('#foot', `Contract <a href="${esc(cfg.explorer)}/address/${esc(cfg.contract_id)}" target="_blank" rel="noreferrer">${esc(cfg.contract_id)}</a> on ${esc(cfg.network)}. Model ${esc(st?.model ?? '')}. Every gold figure on this page is read from the contract.`);
}

function pitchTarget(): number {
  const n = world?.nearest() ?? -1;
  return n >= 0 ? n : selected;
}

function renderPitchGo() {
  const i = pitchTarget();
  const m = st?.merchants[i];
  const heardMe = !!m && !!st && myCons().some((r) => newsArrives(r.day, r.town, m.town) <= st!.day && r.town !== m.town);
  $('#pitchgolabel').textContent = m && placed ? (heardMe ? `Pitch ${m.name} (has heard you)` : `Pitch ${m.name} gold`) : 'Pitch for gold';
  $('#pitchgo').parentElement!.hidden = relay.kind === 'closed' && !ready;
}

function pushWorld() {
  if (!world || !st) return;
  const d = dayLeft();
  if (lastDay && st.day > lastDay) sfx.bell();
  lastDay = st.day;
  const recent = records.filter((r) => st!.day - r.day < 3).map((r) => ({ day: r.day, town: r.town, cls: classShort(r.class) }));
  world.setState({
    merchants: st.merchants.map((mm, i) => ({ name: mm.name, town_name: mm.town_name, gold: mm.gold, news: (news[i] ?? []).map((r) => ({ day: r.day, town: r.town, cls: classShort(r.class) })) })),
    couriers: recent, day: st.day, dayFrac: d.pct / 100, canEnd: d.left === 0, selected,
  });
}

function setTalking(on: boolean) {
  talking = on;
  document.querySelector('.game')!.classList.toggle('talking', on);
  world?.setActive(!on);
  if (on) {
    lineShown = '';
    if (!$<HTMLTextAreaElement>('#pitch').value.trim()) applyStarter(0);
    renderAll();
    $('#stage').scrollIntoView({ block: 'nearest' });
    requestAnimationFrame(() => { const b = $<HTMLButtonElement>('#send'); if (!b.disabled && !b.hidden) b.focus({ preventScroll: true }); });
  } else { world?.standAt(selected); sfx.talkClose(); $('#world').scrollIntoView({ block: 'nearest' }); requestAnimationFrame(() => $('#pitchgo').focus({ preventScroll: true })); }
}

function renderAll() {
  pushWorld();
  renderHud(); renderRoad(); renderStage(); renderVerdict(); renderMine(); renderLedger(); renderFoot(); syncForm(); renderPitchGo();
}

async function refreshTraction() {
  const stamp = $('#traction-stamp');
  const button = $<HTMLButtonElement>('[data-act="traction-refresh"]');
  button.disabled = true;
  try {
    const data = await loadTraction();
    lastTraction = data;
    setHtml($('#traction-values'), renderTraction(data));
    stamp.textContent = `${data.contract_id} · finalized through block ${data.finalized_height.toLocaleString('en-US')}`;
  } catch {
    // keep the last good figures with their block; the next refresh replaces them
    stamp.textContent = lastTraction ? `as of block ${lastTraction.finalized_height.toLocaleString('en-US')}` : 'Reading finalized event receipts.';
    if (!lastTraction) setTimeout(() => { void refreshTraction(); }, 15_000);
  } finally {
    button.disabled = false;
  }
}

async function refresh() {
  try {
    const [s, p] = await Promise.all([chain.view<StateV>('state'), chain.view<PlayerV | null>('player', { account_id: chain.me.id })]);
    st = s;
    pv = p;
    if (p?.pending_offer) {
      lastPendingId = p.pending_offer;
      if (!pendingSince) pendingSince = Date.now();
    } else if (busy !== 'offer') {
      if (pendingSince) answeredMs = Date.now() - pendingSince;
      pendingSince = 0;
    }
    const key = `${s.day}:${s.records}:${p?.offers_total ?? 0}:${p?.pending_offer ?? 0}:${p?.cons_landed ?? 0}`;
    if (key !== seenKey) {
      seenKey = key;
      const from = Math.max(0, s.records - 30);
      const [recs, wd, hist, n0, n1, n2, bal] = await Promise.all([
        chain.view<Rec[]>('con_records', { from, limit: 30 }),
        chain.view<Wanted[]>('wanted'),
        p ? chain.view<Offer[]>('offers_of', { account_id: chain.me.id, limit: 6 }) : Promise.resolve([] as Offer[]),
        chain.view<Rec[]>('news_at', { merchant: 0 }), chain.view<Rec[]>('news_at', { merchant: 1 }), chain.view<Rec[]>('news_at', { merchant: 2 }),
        chain.view<string[]>('mt_batch_balance_of', { account_id: chain.me.id, token_ids: CLASSES.map((c) => `rumour:${c}`) }),
      ]);
      records = recs; wanted = wd; history = hist; news = [n0, n1, n2];
      if (wantRecord && !records.some((r) => r.id === wantRecord) && wantRecord <= s.records) {
        const one = await chain.view<Rec[]>('con_records', { from: wantRecord - 1, limit: 1 }).catch(() => [] as Rec[]);
        records = [...one, ...records].sort((a, b) => a.id - b.id);
      }
      rumours = Object.fromEntries(CLASSES.map((c, i) => [c, bal[i]]));
      last = hist.find((o) => o.status !== 'pending') ?? null;
      if (seenOutcome === -1) seenOutcome = last?.id ?? 0;
      lastBatch = last?.batch ? await chain.view<BatchV>('batch', { batch_id: last.batch }) : null;
    }
    if (!placed && seenKey) {
      // News travels one town per day, so the player starts where the fewest cons have been heard: the lie has the most road ahead of it.
      placed = true;
      const quiet = news.reduce((best, n, i) => (n.length < news[best].length ? i : best), 0);
      if (!talking && quiet !== selected) { selected = quiet; world?.standAt(quiet); }
      if (wantTalk) { wantTalk = false; renderPitchGo(); world?.walkTo(selected); }
    }
    if (last?.batch && last.outcome && lastBatch?.response_hash !== last.outcome.response_hash) lastBatch = await chain.view<BatchV>('batch', { batch_id: last.batch });
    await captureRequest();
  } catch {
    // keep what was last read; the next tick reads again and the page never prints a transport error
    return;
  }
  renderAll();
}

async function openPurse() {
  await chain.activate();
  if (!(await chain.view('player', { account_id: chain.me.id }))) {
    await chain.send('join', {});
    for (let i = 0; i < 40; i++) {
      if (await chain.view('player', { account_id: chain.me.id })) break;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}

async function onboard() {
  window.clearTimeout(relay.timer);
  try {
    await openPurse();
    ready = true;
    relay.kind = 'ok';
    relay.attempt = 0;
  } catch (e: any) {
    const r = relayRetry(String(e?.message ?? e), relay.attempt++);
    relay.kind = r.kind;
    relay.retryAt = Date.now() + (r.kind === 'closed' ? 40 : r.wait) * 1000;
    relay.timer = window.setTimeout(() => { void onboard(); }, relay.retryAt - Date.now());
  }
  await refresh();
  if (ready && queued) {
    const q = queued;
    queued = null;
    void act('offer', { merchant: q.merchant, ask: q.ask, bond: q.bond, pitch: q.pitch }, 'offer');
  }
}

async function act(name: string, args: Record<string, unknown>, label: string) {
  const dayBefore = st?.day ?? 0;
  busy = label;
  errMsg = '';
  dayHint = '';
  if (name === 'offer') { pendingSince = Date.now(); answeredMs = 0; }
  renderAll();
  try {
    const { tx } = await chain.send(name, args);
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 900)); seenKey = ''; await refresh();
      if (name === 'offer' && tx && pv?.pending_offer && !offerTx[pv.pending_offer]) {
        offerTx[pv.pending_offer] = tx;
        localStorage.setItem(TX_KEY, JSON.stringify(offerTx));
      }
    }
  } catch (e: any) {
    const message = explain(String(e?.message ?? e));
    if (name === 'advance_day' && message.includes('the day has not ended yet')) {
      const fresh = await chain.view<StateV>('state');
      if (fresh.day > dayBefore) st = fresh;
      else errMsg = message.slice(0, 200);
    } else errMsg = message.slice(0, 200);
    if (name === 'offer') { pendingSince = 0; answeredMs = 0; }
  } finally {
    busy = '';
    seenKey = '';
    await refresh();
  }
}

function startPitch() {
  const pitch = $<HTMLTextAreaElement>('#pitch').value;
  const ask = Number($<HTMLInputElement>('#ask').value);
  const bond = Number($<HTMLInputElement>('#bond').value);
  const c = checkPitch(pitch, ask, bond, pv?.gold ?? st?.rules.gold_stipend ?? 0, st?.rules.max_ask ?? 60);
  if (!c.ok) { errMsg = c.why; syncForm(); return; }
  errMsg = '';
  if (!ready) {
    queued = { merchant: selected, ask, bond, pitch, at: Date.now() };
    renderAll();
    return;
  }
  void act('offer', { merchant: selected, ask, bond, pitch }, 'offer');
}

app.addEventListener('input', (ev) => {
  const t = ev.target as HTMLInputElement;
  const m = t.id?.match(/^qty(\d)$/);
  if (m) qtys[Number(m[1])] = Number(t.value) || 1;
});

app.addEventListener('click', (ev) => {
  const t = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!t) return;
  const a = t.dataset.act!;
  if (a === 'traction-refresh') { void refreshTraction(); return; }
  if (a === 'leave') { setTalking(false); return; }
  if (a === 'mute') { toggleMute(); renderHud(); return; }
  if (a === 'pitchgo') {
    if (!placed) { wantTalk = true; sfx.talkOpen(); return; } // the first state read picks the town; the table opens as soon as it has
    selected = pitchTarget();
    sfx.talkOpen();
    world?.walkTo(selected);
    return;
  }
  if (a === 'pick') {
    selected = Number(t.dataset.m);
    world?.standAt(selected);
    if (!talking) sfx.talkOpen();
    setTalking(true);
    return;
  }
  if (a === 'starter') { applyStarter(Number(t.dataset.i)); return; }
  if (a === 'again') {
    const box = $<HTMLTextAreaElement>('#pitch');
    box.value = '';
    syncForm();
    box.focus();
    return;
  }
  if (a === 'retry-now') { relay.attempt = 0; void onboard(); return; }
  if (a === 'copy' || a === 'share') {
    const text = t.dataset.text ?? t.dataset.v ?? '';
    const key = t.dataset.key ?? (a === 'share' ? 'loan' : text);
    void navigator.clipboard?.writeText(text).then(() => { copied = key; renderAll(); setTimeout(() => { copied = ''; renderAll(); }, 2000); });
    return;
  }
  if (a === 'pitch') { startPitch(); return; }
  if (a === 'buy' || a === 'sell') {
    const m = Number(t.dataset.m);
    const qty = Number($<HTMLInputElement>(`#qty${m}`).value);
    if (!Number.isInteger(qty) || qty < 1) { errMsg = 'Trade a whole number of grain.'; syncForm(); return; }
    void act('trade', { merchant: m, side: a, qty }, 'trade');
    return;
  }
  if (a === 'repay') { void act('repay_debt', { debt_id: Number(t.dataset.d) }, 'repay'); return; }
  if (a === 'endday') {
    const left = dayLeft().left;
    dayHint = left > 0 ? `Day ${st?.day} has ${left} s of daylight left. The road lets it end at dusk.` : '';
    if (left > 0) { renderVerdict(); return; }
    void act('advance_day', {}, 'day');
  }
});

setInterval(() => {
  document.querySelectorAll<HTMLElement>('[data-tick]').forEach((el) => {
    const k = el.dataset.tick;
    el.textContent = String(k === 'queue' ? secs(queued?.at ?? 0) : k === 'pending' ? secs(pendingSince) : Math.max(0, Math.ceil((relay.retryAt - Date.now()) / 1000)));
  });
}, 1000);

async function boot() {
  cfg = await loadConfig();
  try {
    const r = await fetch('/attestation.json', { cache: 'no-store' });
    if (r.ok) attestation = await r.json();
  } catch { attestation = null; }
  chain = new Chain(cfg, identity());
  skeleton();
  world = createWorld($<HTMLCanvasElement>('#worldcanvas'), (mi) => { selected = mi; setTalking(true); });
  world.standAt(0);
  const wake = () => { if (!muted) startMusic(); };
  window.addEventListener('pointerdown', wake, { once: true });
  window.addEventListener('keydown', wake, { once: true });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && talking) setTalking(false); });
  $('#pitch').addEventListener('input', () => { typedAt = Date.now(); renderStage(); });
  document.querySelectorAll<HTMLButtonElement>('.pad button').forEach((b) => {
    const d = b.dataset.pad!;
    if (d === 'act') { b.addEventListener('click', () => world.act()); return; }
    const go = (e: Event) => { e.preventDefault(); world.move(d as any); };
    const stop = () => world.move(null);
    b.addEventListener('pointerdown', go); b.addEventListener('pointerup', stop); b.addEventListener('pointerleave', stop); b.addEventListener('pointercancel', stop);
  });
  void refreshTraction();
  setInterval(() => { void refreshTraction(); }, 60_000);
  renderHud();
  renderPitchGo();
  $('#pitchgo').focus({ preventScroll: true });
  setInterval(renderPitchGo, 300);
  setInterval(() => { if (relay.kind === 'busy' && !ready) renderVerdict(); }, 1000);
  void onboard();
  await refresh();
  setInterval(() => { void refresh(); }, pendingSince ? 1500 : 5000);
  setInterval(() => { if (pv?.pending_offer) { seenKey = ''; void refresh(); } }, 1500);
}

boot().catch(() => {
  app.innerHTML = `<div class="wrap"><p class="err" style="padding:48px 8px">The road is not answering. Reload in a moment.</p></div>`;
});
