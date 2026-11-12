import './style.css';
import { Chain, Config, explain, identity, loadConfig } from './chain.ts';
import { loadTraction, renderTraction } from './traction.ts';
import { checkPitch, classLabel, classShort, clampSentence, esc, nextMove, newsArrives, shortId, STATUS_LABEL, txUrl, answeredLine, newsLines, sha256Hex, signatureValid } from './words.ts';

interface Merchant { id: number; name: string; town: number; gold: number; grain: number; outstanding: number; buy_price: number; sell_price: number; lost_total: number; town_name: string; treasury_room: number; due_exposure: number[] }
interface Rules { loss_cap_per_day: number; treasury_cap_pct: number; max_due_days: number; max_interest_pct: number; max_ask: number; gold_stipend: number; towns: string[] }
interface StateV { day: number; day_length_ms: number; day_started_ns: string; model: string; signers: [string, string][]; merchants: Merchant[]; records: number; offers: number; players: number; rules: Rules }
interface Debt { id: number; merchant: number; principal: number; repay: number; bond: number; due_day: number; status: string; class: string }
interface PlayerV { gold: number; grain: number; earned_line: number; locked_bonds: number; outstanding: number; pending_offer: number | null; offers_total: number; cons_landed: number; debts: Debt[] }
interface Outcome { status: string; proposed_advance: number; proposed_repay: number; advance: number; repay: number; due_day: number; class: string; reason: string; clamps: string[]; debt_id: number | null; model: string; signer: string; response_hash: string }
interface Offer { id: number; merchant: number; ask: number; bond: number; pitch: string; day: number; status: string; batch: number | null; request_hash: string; outcome: Outcome | null }
interface BatchV { signature: string; response_hash: string }
interface Rec { id: number; day: number; town: number; merchant: number; player: string; class: string; principal: number; bond_burned: number; loss: number; request_hash: string; response_hash: string }
interface Wanted { class: string; record_id: number; first_player: string; day: number; landed: number }

const CLASSES = ['future_cargo', 'borrowed_authority', 'sob_story', 'urgency', 'false_collateral', 'other'];
const STARTERS = [
  { label: 'Seed grain', ask: 4, bond: 5, text: 'I would like to borrow 4 gold until tomorrow to buy seed grain, and I will repay 5 then. My bond is posted.' },
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
let onboardErr = '';
let pendingSince = 0;
let answeredMs = 0;
const TX_KEY = 'longcon.offer-tx';
const REQUESTS_KEY = 'longcon.requests';
const requestCaptures: Record<string, { match?: boolean; missed?: boolean; news?: string[] }> = JSON.parse(localStorage.getItem(REQUESTS_KEY) ?? '{}');
const offerTx: Record<string, string> = JSON.parse(localStorage.getItem(TX_KEY) ?? '{}');
let ready = false;

function skeleton() {
  app.innerHTML = `
  <div class="wrap">
    <header class="bar" id="bar"></header>
    <section class="plate g12" aria-label="long con">
      <h1>talk the road out of its gold<span class="sq"></span></h1>
    </section>
    <section class="intro g12">
      <p class="what">Three merchants on a road of towns lend real gold held in a NEAR contract. Each one is an AI model. You pitch one for an advance. The contract checks the signed answer, then clamps the terms to limits no pitch can move. Skip the repayment and the con lands in a public ledger that the next town reads one day later.</p>
      <ol class="steps">
        <li><b>Pick a merchant and pitch.</b> See the merchant's own words and exactly what the road let through.</li>
        <li><b>Take the advance, end its due day, then one more.</b> See the debt default, your bond burn, and the con enter the ledger.</li>
        <li><b>Pitch the next town.</b> See its merchant carry the news into the answer.</li>
      </ol>
    </section>
    <section class="sec g12 traction" aria-label="live road activity">
      <div class="head"><h2>the road's record</h2><button class="btn small" type="button" data-act="traction-refresh">Refresh</button></div>
      <p class="label traction-stamp" id="traction-stamp" aria-live="polite">Reading finalized event receipts.</p>
      <div class="traction-values" id="traction-values"><p class="empty">Reading finalized event receipts.</p></div>
      <p class="err" id="traction-error" role="status"></p>
    </section>
    <section class="sec g12" aria-label="the road">
      <div class="head"><h2>the road</h2><span class="label" id="roadnote"></span></div>
      <div class="move wait" id="move" role="status" aria-live="polite"><span class="dot"></span><span id="movetext"></span></div>
      <div class="g12 road" style="grid-column:1/-1;padding:0" id="road"></div>
    </section>
    <section class="sec g12 work" aria-label="the table">
      <div class="head"><h2>the table</h2><span class="label">Nothing here moves gold until the road has checked the answer</span></div>
      <div class="pitchbox" id="pitchbox"></div>
      <div class="verdict" id="verdict" aria-live="polite"></div>
      <div class="block" style="grid-column:1/-1" id="mine"></div>
    </section>
    <section class="sec g12 ledger" aria-label="the con ledger">
      <div class="head"><h2>the con ledger</h2><span class="label" id="ledgernote"></span></div>
      <div class="recs" id="recs"></div>
      <div class="side" id="side"></div>
    </section>
    <footer><div class="g12"><p id="foot"></p></div></footer>
  </div>`;
  mountForm();
}

function mountForm() {
  $('#pitchbox').innerHTML = `
    <h3>Your pitch</h3>
    <p class="label" id="target">Pitching Marta in Millford</p>
    <div class="starters" role="group" aria-label="Pitch starters">
      ${STARTERS.map((s, i) => `<button class="btn small" type="button" data-act="starter" data-i="${i}">${esc(s.label)}</button>`).join('')}
    </div>
    <div class="field"><label class="label" for="pitch">What you say to the merchant</label><textarea id="pitch" maxlength="400" placeholder="Make your case. The merchant weighs it against the news that has reached its town."></textarea><span class="hint" id="pitchcount">0 of 400 bytes</span></div>
    <div class="row2">
      <div class="field"><label class="label" for="ask">Gold you ask for</label><input id="ask" type="number" min="1" max="60" value="30" inputmode="numeric"></div>
      <div class="field"><label class="label" for="bond">Bond you stake</label><input id="bond" type="number" min="0" value="6" inputmode="numeric"></div>
    </div>
    <p class="hint">The bond is locked while the merchant thinks and burns if you do not repay.</p>
    <p style="margin-top:12px"><button class="btn primary" id="send" data-act="pitch" type="button">Pitch</button></p>
    <p class="err" id="err" role="alert"></p>`;
  $<HTMLTextAreaElement>('#pitch').addEventListener('input', syncForm);
  $<HTMLInputElement>('#ask').addEventListener('input', syncForm);
  $<HTMLInputElement>('#bond').addEventListener('input', syncForm);
}

function syncForm() {
  const pitch = $<HTMLTextAreaElement>('#pitch').value;
  const bytes = new TextEncoder().encode(pitch).length;
  $('#pitchcount').textContent = `${bytes} of 400 bytes`;
  const m = st?.merchants[selected];
  if (m) $('#target').textContent = `Pitching ${m.name} in ${m.town_name}`;
  const send = $<HTMLButtonElement>('#send');
  const waiting = !!pv?.pending_offer;
  send.disabled = !ready || waiting || !!busy;
  send.textContent = waiting ? 'Waiting for the merchant' : busy === 'offer' ? 'Sending' : m ? `Pitch ${m.name}` : 'Pitch';
  $('#err').textContent = errMsg;
}

async function captureRequest() {
  const id = pv?.pending_offer;
  if (!id || Object.hasOwn(requestCaptures, String(id))) return;
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

const gold = (n: number) => `<span class="num">${n}</span>`;

function signerSentence(signer: string, model: string): string {
  if (signer === 'gateway') return 'Answer signed by the NEAR AI Cloud gateway TEE; this signature does not name the model.';
  if (signer.startsWith('worker:')) return "Answer signed by the operator's worker key, not a TEE.";
  return signer ? `Answer signed by the ${model} model TEE.` : 'Answer signer not recorded.';
}

function renderBar() {
  const p = pv;
  const signer = last?.outcome?.signer || st?.model || '';
  const kind = signer === 'gateway' ? 'gateway' : signer.startsWith('worker:') ? 'worker' : 'provider_tee';
  const signerLine = last?.outcome ? signerSentence(signer, last.outcome.model) : '';
  const registered = Object.fromEntries(st?.signers ?? []);
  const expectedKey = kind === 'gateway' ? attestation?.gateway_signing_key : attestation?.model_signing_key;
  const tcb = kind === 'gateway' ? attestation?.tcb_status?.gateway : attestation?.tcb_status?.model?.join(', ');
  const attestationLine = !attestation ? 'no attestation report is published for this road'
    : registered[signer] === expectedKey ? `key ${shortId(registered[signer])} matches the published attestation report (fetched ${attestation.fetched_at}, TCB ${tcb})`
      : 'key does not match the published attestation report';
  put("#bar", `
    <div class="mark"><i></i>long con</div>
    <div class="stat"><span class="label">Road day</span><b>${st?.day ?? '-'}</b></div>
    <div class="stat"><span class="label">Your gold</span><b>${p ? p.gold : '-'}</b></div>
    <div class="stat"><span class="label">Bond locked</span><b>${p ? p.locked_bonds : '-'}</b></div>
    <div class="stat"><span class="label">Credit earned</span><b>${p ? p.earned_line : '-'}</b></div>
    <div class="who"><span class="label">${esc(cfg.network)} account</span><br><span class="mono" title="${esc(chain.me.id)}">${esc(shortId(chain.me.id, 8, 6))}</span><p>${esc(signerLine || `Road model: ${signer}`)}. ${esc(attestationLine)}</p></div>`);
}

function renderRoad() {
  if (!st) { put("#road", '<p class="empty" style="padding:0 8px">Reading the road from the contract.</p>'); return; }
  const cap = st.rules.loss_cap_per_day;
  $('#roadnote').textContent = `News moves one town per day. Each merchant can lose at most ${cap} gold a day.`;
  put("#road", st.merchants.map((m, i) => {
    const allowed = m.outstanding + m.treasury_room;
    const pct = allowed ? Math.min(100, Math.round((m.outstanding / allowed) * 100)) : 100;
    const bars = m.due_exposure.slice(0, 6);
    const nws = news[i] ?? [];
    return `
    <article class="m ${i === selected ? 'on' : ''}">
      <p class="label">${esc(m.town_name)}, town ${m.town + 1} of 3</p>
      <h3>${esc(m.name)}</h3>
      <button class="btn small" type="button" data-act="pick" data-m="${i}" aria-pressed="${i === selected}">Select ${esc(m.name)}</button>
      <p class="gold num">${m.gold}<small>gold in the strongbox</small></p>
      <dl class="kv">
        <dt>Grain in stock</dt><dd>${m.grain}</dd>
        <dt>Buys grain at</dt><dd>${m.buy_price}</dd>
        <dt>Sells grain at</dt><dd>${m.sell_price}</dd>
        <dt>Lost to cons so far</dt><dd>${m.lost_total}</dd>
      </dl>
      <div class="cap"><span class="label">Lent out</span>
        <div class="rail" role="img" aria-label="${m.outstanding} of ${allowed} gold lent"><i class="${pct >= 90 ? 'hot' : ''}" style="width:${pct}%"></i></div>
        <p>${m.outstanding} of ${allowed} gold allowed (${st!.rules.treasury_cap_pct} percent of capital)</p></div>
      <div class="cap"><span class="label">Gold due to be lost, by day</span>
        <div class="bars" role="img" aria-label="Gold at risk on each of the next days">${bars.map((v) => `<span class="${v === 0 ? 'zero' : v >= cap ? 'hot' : ''}" style="height:${v === 0 ? 2 : Math.max(6, Math.round((v / cap) * 56))}px" title="${v}"></span>`).join('')}</div>
        <div class="barlab">${bars.map((v, k) => `<span>${st!.day + k}<br>${v}</span>`).join('')}</div></div>
      <div class="news"><span class="label">News that has reached ${esc(m.town_name)}</span>
        ${nws.length ? `<ul>${nws.map((r) => `<li>Day ${r.day}, ${esc(st!.rules.towns[r.town])}: ${esc(classShort(r.class))}, ${r.principal} gold lost</li>`).join('')}</ul>` : '<p class="none">Nothing yet.</p>'}</div>
      <div class="trade">
        <input class="small" id="qty${i}" type="number" min="1" value="${qtys[i]}" aria-label="Grain to trade with ${esc(m.name)}" style="width:64px;border:1px solid var(--color-ink);padding:4px 8px;border-radius:0;background:var(--color-paper)">
        <button class="btn small" type="button" data-act="buy" data-m="${i}">Buy grain</button>
        <button class="btn small" type="button" data-act="sell" data-m="${i}">Sell grain</button>
      </div>
    </article>`;
  }).join(""));
}

function renderMove() {
  const open = pv?.debts.filter((d) => d.status === 'open') ?? [];
  const mv = nextMove({
    ready, pending: !!pv?.pending_offer, openDebts: open.length, offers: pv?.offers_total ?? 0,
    records: st?.records ?? 0, day: st?.day ?? 1, dueDay: open.length ? Math.max(...open.map((d) => d.due_day)) : undefined,
  });
  const el = $('#move');
  el.className = `move ${mv.tone}`;
  $('#movetext').textContent = onboardErr || mv.text;
}

function seconds(): number { return pendingSince ? Math.floor((Date.now() - pendingSince) / 1000) : 0; }

function renderVerdict() {
  const el = $('#verdict');
  const name = (id: number) => st?.merchants[id]?.name ?? 'The merchant';
  if (pv?.pending_offer) {
    el.innerHTML = `<h3>The merchant is thinking</h3>
      <p class="clock" id="clock">${seconds()}<small>seconds, up to 115 before the bond comes back</small></p>
      <p class="hint" style="margin-top:12px">The model answers, a signature over the exact request and answer is checked on chain, and only then are the terms clamped and committed.</p>`;
    return;
  }
  const o = last;
  if (!o || !o.outcome) {
    el.innerHTML = `<h3>What the road allowed</h3><p class="empty">Pitch a merchant and this panel shows what you asked for, what the merchant offered, and what the road let through.</p>`;
    return;
  }
  const oc = o.outcome;
  el.dataset.requestHash = o.request_hash;
  const signerKind = oc.signer === 'gateway' ? 'gateway' : oc.signer.startsWith('worker:') ? 'worker' : 'provider_tee';
  const signerKey = Object.fromEntries(st?.signers ?? [])[oc.signer] ?? '';
  const signatureOk = !!lastBatch && signatureValid(signerKind, oc.model, o.request_hash, lastBatch.response_hash, lastBatch.signature, signerKey);
  const capture = requestCaptures[String(o.id)];
  const requestCheck = capture?.match === true ? 'Request checked in your browser: sha256 matches the hash the signature covers.'
    : capture?.match === false ? 'Request bytes did NOT match the hash on chain.'
      : capture?.missed ? 'The answer came back before this page read the request.'
        : Object.hasOwn(requestCaptures, String(o.id)) ? 'Request not captured in this browser.'
          : 'Request not captured in this browser.';
  const max = Math.max(o.ask, oc.proposed_advance, oc.advance, 1);
  const w = (n: number) => Math.round((n / max) * 100);
  const interest = oc.advance ? oc.repay - oc.advance : 0;
  el.innerHTML = `<h3><span class="mk ${esc(o.status)}"></span>${esc(STATUS_LABEL[o.status] ?? o.status)} (${esc(name(o.merchant))}, day ${o.day})</h3>
    <p class="say"><q>${esc(oc.reason || 'The merchant gave no reason.')}</q></p>
    <p class="fine">${esc(signerSentence(oc.signer, oc.model))}</p>
    <p class="fine">${signatureOk ? 'Signature checked in your browser.' : 'Signature did NOT verify against the registered key.'}</p>
    <p class="fine">${requestCheck}</p>
    ${capture?.news?.length ? `<div class="fine"><span>News in this request:</span><ul>${capture.news.map((line) => `<li>${esc(line)}</li>`).join('')}</ul></div>` : ''}
    <div class="tri">
      <div class="r"><span class="label">You asked</span><span class="rail"><i style="width:${w(o.ask)}%"></i></span><b>${o.ask}</b></div>
      <div class="r"><span class="label">Merchant offered</span><span class="rail"><i style="width:${w(oc.proposed_advance)}%"></i></span><b>${oc.proposed_advance}</b></div>
      <div class="r allowed"><span class="label">Road allowed</span><span class="rail"><i style="width:${w(oc.advance)}%"></i></span><b>${oc.advance}</b></div>
    </div>
    ${oc.clamps.length ? `<ul class="why">${oc.clamps.map((c) => `<li>${esc(clampSentence(c))}</li>`).join('')}</ul>` : o.status === 'committed' ? '<p class="hint">Nothing was clamped: the offer sat inside every limit.</p>' : ''}
    ${o.status === 'committed' ? `<p>Repay <b>${oc.repay}</b> gold (${interest} interest) by the end of day <b>${oc.due_day}</b>, or your ${o.bond} gold bond burns and a con lands in the ledger as ${esc(classLabel(oc.class))}.</p>` : ''}
    ${o.status === 'refused' ? `<p>The road filed this pitch as ${esc(classLabel(oc.class))}. Your bond is back in your purse.</p>` : ''}
    <p class="fine" style="margin-top:12px">${offerTx[o.id] ? `<a href="${esc(txUrl(cfg.explorer, offerTx[o.id]))}" target="_blank" rel="noreferrer">Your pitch transaction</a>. ` : ''}${esc(answeredLine(answeredMs))}Response ${esc(shortId(oc.response_hash, 10, 6))}. Request ${esc(shortId(o.request_hash, 10, 6))}.</p>`;
}

function renderMine() {
  const open = pv?.debts.filter((d) => d.status === 'open') ?? [];
  const day = st?.day ?? 1;
  const endsIn = st && st.day_length_ms > 0 ? Math.max(0, Math.ceil((Number(BigInt(st.day_started_ns) / 1_000_000n) + st.day_length_ms - Date.now()) / 1000)) : 0;
  const canEnd = ready && !busy && endsIn === 0;
  put("#mine", `
    <div class="g12" style="gap:32px 0;padding:0">
      <div style="grid-column:1/-1;padding:0 8px" class="dbt">
        <h3>What you owe</h3>
        ${open.length ? `<div class="rows">${open.map((d) => `
          <div class="r"><span class="main"><b>${d.repay}</b> gold to ${esc(st?.merchants[d.merchant]?.name ?? '')}, due by the end of day ${d.due_day}. Bond ${d.bond}.</span>
          <button class="btn small" data-act="repay" data-d="${d.id}" ${pv && pv.gold >= d.repay && day <= d.due_day && !busy ? '' : 'disabled'} type="button">Pay back</button></div>`).join('')}</div>`
          : '<p class="empty">No open debts. Take an advance and it shows up here with its due day.</p>'}
        <p style="margin-top:16px"><button class="btn primary" data-act="endday" type="button" ${canEnd ? '' : 'disabled'}>${endsIn > 0 ? `Day ${day} ends in ${endsIn}s` : `End day ${day}`}</button>
        <span class="hint" style="margin-left:12px">Debts due today default when the day ends.</span></p>
      </div>
      <div style="grid-column:1/-1;padding:0 8px" class="hist">
        <h3>Your recent pitches</h3>
        ${history.length ? `<div class="rows">${history.map((h) => `
          <div class="r"><span class="main"><span class="mk ${esc(h.status)}"></span>Day ${h.day}, ${esc(st?.merchants[h.merchant]?.name ?? '')}: asked ${h.ask}, got ${h.outcome?.advance ?? 0}. ${h.outcome ? esc(classShort(h.outcome.class)) : 'waiting'}</span><span class="fine">${esc(STATUS_LABEL[h.status] ?? h.status)}</span></div>`).join('')}</div>`
          : '<p class="empty">No pitches yet. The first one is one click away.</p>'}
      </div>
    </div>`);
}

function renderLedger() {
  if (!st) return;
  const towns = st.rules.towns;
  $('#ledgernote').textContent = `${st.records} landed, ${st.players} players, ${st.offers} pitches`;
  put("#recs", `<h3 class="label" style="padding-bottom:8px;border-bottom:2px solid var(--color-ink);margin-bottom:0">Every landed con, newest first</h3>` + (records.length
    ? [...records].reverse().map((r) => `
      <div class="rec"><span class="n">${r.id}</span>
        <span><span class="cls">${esc(classShort(r.class))}</span> in ${esc(towns[r.town])}, day ${r.day}, by <span class="mono">${esc(shortId(r.player, 6, 6))}</span></span>
        <span class="lost">-${r.loss}</span>
        <span class="sub">${towns.map((t, k) => `${esc(t)} ${newsArrives(r.day, r.town, k) <= st!.day ? 'knows' : `hears day ${newsArrives(r.day, r.town, k)}`}`).join(' / ')}. Bond burned ${r.bond_burned}. Response ${esc(shortId(r.response_hash, 8, 6))}</span>
      </div>`).join('')
    : '<p class="empty" style="padding-top:16px">No con has landed. When a debt goes unpaid and its day ends, the loss, the class and the hashes of what the model saw and said are written here.</p>'));
  put("#side", `
    <div class="block"><h3>Wanted board</h3>
      ${wanted.length ? `<div class="rows">${wanted.map((w) => `<div class="r"><span class="main"><b>${esc(classShort(w.class))}</b><br><span class="fine">First by <span class="mono">${esc(shortId(w.first_player, 6, 6))}</span> on day ${w.day}</span></span><span class="num">${w.landed} landed</span></div>`).join('')}</div>` : '<p class="empty">Each new kind of con earns a place here. Be the first to land one.</p>'}
    </div>
    <div class="block" style="margin-top:32px"><h3>Rumour tokens you hold</h3>
      <div class="rows">${CLASSES.map((c) => `<div class="r"><span class="main">${esc(classShort(c))}</span><span class="num">${rumours[c] ?? '0'}</span></div>`).join('')}</div>
      <p class="hint" style="margin-top:8px">A landed con mints one rumour token to the con artist.</p>
    </div>`);
}

function renderFoot() {
  put("#foot", `Contract <a href="${esc(cfg.explorer)}/address/${esc(cfg.contract_id)}" target="_blank" rel="noreferrer">${esc(cfg.contract_id)}</a> on ${esc(cfg.network)}. Model ${esc(st?.model ?? '')}. Every gold figure on this page is read from the contract.`);
}

function renderAll() {
  renderBar(); renderRoad(); renderMove(); renderVerdict(); renderMine(); renderLedger(); renderFoot(); syncForm();
}

async function refreshTraction() {
  const stamp = $('#traction-stamp');
  const error = $('#traction-error');
  const button = $<HTMLButtonElement>('[data-act="traction-refresh"]');
  button.disabled = true;
  stamp.textContent = 'Reading finalized event receipts.';
  error.textContent = '';
  try {
    const data = await loadTraction();
    setHtml($('#traction-values'), renderTraction(data));
    stamp.textContent = `${data.contract_id} · finalized through block ${data.finalized_height}`;
  } catch (e: any) {
    stamp.textContent = 'Finalized receipt read failed.';
    error.textContent = `Could not read activity: ${String(e?.message ?? e).slice(0, 160)}`;
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
      rumours = Object.fromEntries(CLASSES.map((c, i) => [c, bal[i]]));
      last = hist.find((o) => o.status !== 'pending') ?? null;
      lastBatch = last?.batch ? await chain.view<BatchV>('batch', { batch_id: last.batch }) : null;
    }
    await captureRequest();
  } catch (e: any) {
    $('#movetext').textContent = `Could not read the road: ${String(e?.message ?? e).slice(0, 120)}`;
    return;
  }
  renderAll();
}

async function onboard() {
  try {
    await chain.activate();
    if (!(await chain.view('player', { account_id: chain.me.id }))) {
      await chain.send('join', {});
      for (let i = 0; i < 40; i++) {
        if (await chain.view('player', { account_id: chain.me.id })) break;
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    ready = true;
    onboardErr = '';
  } catch (e: any) {
    onboardErr = `Could not open your account: ${explain(String(e?.message ?? e)).slice(0, 140)}`;
  }
  await refresh();
}

async function act(name: string, args: Record<string, unknown>, label: string) {
  const dayBefore = st?.day ?? 0;
  busy = label;
  errMsg = '';
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
  if (a === 'pick') {
    selected = Number(t.dataset.m);
    renderRoad(); syncForm();
    return;
  }
  if (a === 'starter') {
    const s = STARTERS[Number(t.dataset.i)];
    $<HTMLTextAreaElement>('#pitch').value = s.text;
    $<HTMLInputElement>('#ask').value = String(s.ask);
    $<HTMLInputElement>('#bond').value = String(s.bond);
    syncForm();
    return;
  }
  if (a === 'pitch') {
    const pitch = $<HTMLTextAreaElement>('#pitch').value;
    const ask = Number($<HTMLInputElement>('#ask').value);
    const bond = Number($<HTMLInputElement>('#bond').value);
    const c = checkPitch(pitch, ask, bond, pv?.gold ?? 0, st?.rules.max_ask ?? 60);
    if (!c.ok) { errMsg = c.why; syncForm(); return; }
    void act('offer', { merchant: selected, ask, bond, pitch }, 'offer');
    return;
  }
  if (a === 'buy' || a === 'sell') {
    const m = Number(t.dataset.m);
    const qty = Number($<HTMLInputElement>(`#qty${m}`).value);
    if (!Number.isInteger(qty) || qty < 1) { errMsg = 'Trade a whole number of grain.'; syncForm(); return; }
    void act('trade', { merchant: m, side: a, qty }, 'trade');
    return;
  }
  if (a === 'repay') { void act('repay_debt', { debt_id: Number(t.dataset.d) }, 'repay'); return; }
  if (a === 'endday') { void act('advance_day', {}, 'day'); }
});

setInterval(() => {
  const c = document.getElementById('clock');
  if (c && pendingSince) c.firstChild!.textContent = String(seconds());
}, 1000);

async function boot() {
  cfg = await loadConfig();
  try {
    const r = await fetch('/attestation.json', { cache: 'no-store' });
    if (r.ok) attestation = await r.json();
  } catch { attestation = null; }
  chain = new Chain(cfg, identity());
  skeleton();
  void refreshTraction();
  setInterval(() => { void refreshTraction(); }, 60_000);
  renderBar();
  await refresh();
  void onboard();
  setInterval(() => { void refresh(); }, pendingSince ? 1500 : 3000);
  setInterval(() => { if (pv?.pending_offer) { seenKey = ''; void refresh(); } }, 1500);
}

boot().catch((e) => {
  app.innerHTML = `<div class="wrap"><p class="err" style="padding:48px 8px">Could not start: ${esc(String(e?.message ?? e))}</p></div>`;
});
