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

const GREETING = [
  'Grain, salt, a little credit for honest faces. What brings you to my stall?',
  'Every coin that passes this gate is counted twice. Make your case, traveller.',
  'Ships come in, ships go out. Tell me why your story is worth my gold.',
];
const TOWN_ART = (m?: Merchant) => Math.min(2, Math.max(0, m?.town ?? selected));
let seenOutcome = -1;
let moodUntil = 0;
let stampFor = -1;

function skeleton() {
  app.innerHTML = `
  <div class="game">
    <div class="top">
      <header class="hud" id="bar"></header>
      <nav class="roadmap" aria-label="The road">
        <span class="sr" id="roadnote">Three towns, one road</span>
        <div id="road"></div>
      </nav>
    </div>
    <section class="stage" id="stage" aria-label="The market stall">
     <div class="scene">
      <img class="layer" id="scene-back" alt="" src="/art/town0-back.png">
      <div class="merchant" id="merchant" data-m="0" role="img" aria-label="The merchant"></div>
      <img class="layer" id="scene-front" alt="" src="/art/town0-front.png">
      <div class="sign panel" id="sign"></div>
      <div class="board panel" id="board" aria-live="polite"></div>
      <div class="bubble" id="mline" aria-live="polite"></div>
      <div id="seal"></div>
      <div class="coins" id="coins"></div>
      <div class="quest wait" id="move" role="status" aria-live="polite"><span class="dot"></span><span id="movetext"></span></div>
     </div>
     <div class="dialog" aria-label="The table">
      <div class="face">
        <div class="portrait" id="portrait" data-m="0" role="img" aria-label="Merchant portrait"></div>
        <p class="nameplate" id="nameplate"></p>
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
      <p class="err" id="traction-error" role="status"></p>
    </section>
    <footer><p class="who" id="who"></p><p id="foot"></p></footer>
  </div>`;
  mountForm();
}

function mountForm() {
  $('#pitchbox').innerHTML = `
    <p class="who" id="target">Pitching Marta in Millford</p>
    <div class="choices" role="group" aria-label="Pitch starters">
      ${STARTERS.map((s, i) => `<button class="btn small" type="button" data-act="starter" data-i="${i}">${esc(s.label)}</button>`).join('')}
    </div>
    <div class="field"><label class="sr" for="pitch">What you say to the merchant</label>
      <div class="well"><textarea id="pitch" maxlength="400" placeholder="Pick a starter or make your own case. The merchant weighs it against the news in town."></textarea></div></div>
    <div class="wager">
      <div class="field"><label for="ask">Gold you ask for</label><div class="well"><span class="ico s coin"></span><input id="ask" type="number" min="1" max="60" value="30" inputmode="numeric"></div></div>
      <div class="field"><label for="bond">Bond you stake</label><div class="well"><span class="ico s lock"></span><input id="bond" type="number" min="0" value="6" inputmode="numeric"></div></div>
      <button class="btn gold big" id="send" data-act="pitch" type="button">Pitch</button>
    </div>
    <p class="hint"><span id="pitchcount">0 of 400 bytes</span>. The bond burns if you do not repay.</p>
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
  send.setAttribute('aria-busy', String(waiting || busy === 'offer'));
  send.textContent = waiting ? 'Waiting for the merchant' : busy === 'offer' ? 'Sending' : m ? `Pitch ${m.name}` : 'Pitch';
  $('#err').textContent = errMsg;
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

function signerSentence(signer: string, model: string): string {
  if (signer === 'gateway') return 'Answer signed by the NEAR AI Cloud gateway TEE; this signature does not name the model.';
  if (signer.startsWith('worker:')) return "Answer signed by the operator's worker key, not a TEE.";
  return signer ? `Answer signed by the ${model} model TEE.` : 'Answer signer not recorded.';
}

function dayLeft(): { left: number; pct: number } {
  if (!st || !(st.day_length_ms > 0)) return { left: 0, pct: 100 };
  const start = Number(BigInt(st.day_started_ns) / 1_000_000n);
  const left = Math.max(0, Math.ceil((start + st.day_length_ms - Date.now()) / 1000));
  return { left, pct: Math.min(100, Math.round(((st.day_length_ms / 1000 - left) / (st.day_length_ms / 1000)) * 100)) };
}

function renderBar() {
  const p = pv;
  const signer = last?.outcome?.signer || st?.model || '';
  const kind = signer === 'gateway' ? 'gateway' : signer.startsWith('worker:') ? 'worker' : 'provider_tee';
  const registered = Object.fromEntries(st?.signers ?? []);
  const registeredKey = registered[signer] ?? '';
  const reportKey = kind === 'gateway' ? attestation?.gateway_signing_key : attestation?.model_signing_key;
  const tcb = kind === 'worker' ? 'Not attested: worker signer' : kind === 'gateway' ? attestation?.tcb_status?.gateway : attestation?.tcb_status?.model?.join(', ');
  const attested = kind !== 'worker' && !!attestation && !!registeredKey && registeredKey === reportKey;
  const d = dayLeft();
  put("#bar", `
    <div class="logo"><div><b>LONG CON</b><small>talk three AI merchants out of their gold</small></div></div>
    <div class="panel chip day"><span class="ico ${d.left > 0 ? 'sun' : 'moon'}"></span><div><div class="k">Road day</div><div class="v">${st?.day ?? '-'}</div><span class="daybar" title="${d.left > 0 ? `${d.left}s of daylight left` : 'The day can end'}"><i style="width:${d.pct}%"></i></span></div></div>
    <div class="panel chip" id="purse"><span class="ico coin"></span><div><div class="k">Your gold</div><div class="v">${p ? p.gold : '-'}</div></div></div>
    <div class="panel chip"><span class="ico lock"></span><div><div class="k">Bond locked</div><div class="v">${p ? p.locked_bonds : '-'}</div></div></div>
    <div class="panel chip"><span class="ico star"></span><div><div class="k">Credit earned</div><div class="v">${p ? p.earned_line : '-'}</div></div></div>
    <details class="panel chip proof"><summary><span class="mk ${attested ? 'committed' : kind === 'worker' ? 'timed_out' : 'refused'}"></span><span><span class="k">Signer proof</span><br><b>${attested ? 'TEE match' : kind === 'worker' ? 'Worker key' : 'No match'}</b></span></summary>
      <div class="provenance" aria-label="Signer provenance">
        <p>Registered signer: <span data-provenance-signer="${esc(signer)}">${esc(signer)}</span>${kind === 'worker' ? ' · WORKER SIGNER · NOT ATTESTED' : ''}</p>
        <p>Registered public key: <code class="mono" data-registered-key>${esc(registeredKey || 'Not registered')}</code></p>
        <p>${kind === 'worker' ? 'Attestation public key: Not applicable to worker signer' : `Attestation public key: <code class="mono" data-report-key>${esc(reportKey ?? 'Unavailable')}</code>`}</p>
        <p data-key-match>${kind === 'worker' ? 'Worker key is not an attested key' : attested ? 'Matches attestation report' : 'Does not match attestation report'}</p>
        <p>TCB status: <span data-tcb>${esc(tcb ?? 'Unavailable')}</span></p>
        ${attestation ? '<a href="/attestation.json" target="_blank" rel="noreferrer">Open published report</a>' : '<span>Attestation report unavailable</span>'}
      </div></details>
`);
  put('#who', `<span class="ico s lock"></span>${esc(cfg.network)} account <span class="mono" title="${esc(chain.me.id)}">${esc(shortId(chain.me.id, 8, 6))}</span>. ${esc(st?.model ? `Merchants answer with ${st.model}` : 'Reading the road')}${attested ? ', and the signer key matches the published TEE attestation' : ''}. <a href="#ledger">Con ledger</a>`);
}

function renderRoad() {
  if (!st) { put("#road", ''); return; }
  $('#roadnote').textContent = 'Three towns on one road. News of a con travels one town per day.';
  put("#road", st.merchants.map((m, i) => {
    const pos = TOWN_POS[Math.min(2, m.town)] ?? TOWN_POS[i];
    const heard = (news[i] ?? []).length;
    return `<button class="town" type="button" data-act="pick" data-m="${i}" aria-pressed="${i === selected}" aria-label="Go to ${esc(m.town_name)} and talk to ${esc(m.name)}" style="left:${(pos.x / 320) * 100}%;top:${(pos.y / 64) * 100}%;background-position-x:${Math.min(2, m.town) * 50}%">
      ${heard ? `<span class="pin" title="${heard} con${heard > 1 ? 's' : ''} heard of here">${heard}</span>` : ''}
      <span class="tag">${esc(m.town_name)}</span></button>`;
  }).join(""));
}

const TOWN_POS = [{ x: 64, y: 43 }, { x: 160, y: 25 }, { x: 256, y: 41 }];

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
    if (seenOutcome !== -1) {
      moodUntil = now + 2400;
      if (o.status === 'committed') coinBurst(o.outcome.advance);
      $('#stage').classList.remove('shake'); void $('#stage').offsetWidth; $('#stage').classList.add('shake');
    }
    seenOutcome = o.id;
  }
  const mood = pv?.pending_offer ? 'think'
    : mine && now < moodUntil ? 'talk'
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
      setHtml($('#seal'), `<div class="stamp" data-s="${esc(o!.status)}"><span>${esc(o!.status === 'committed' ? `${o!.outcome!.advance} gold advanced` : STATUS_LABEL[o!.status] ?? o!.status)}</span></div>`);
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
  const line = pv?.pending_offer ? `<q>Hmm. Let me think on that.</q>`
    : mine && o!.outcome ? `<q>${esc(o!.outcome!.reason || 'I have nothing more to say.')}</q>`
      : `<q>${esc(GREETING[art])}</q>`;
  put('#mline', line);
}

function coinBurst(n: number) {
  const stage = $('#stage').getBoundingClientRect();
  const purse = document.getElementById('purse')?.getBoundingClientRect();
  if (!purse) return;
  const count = Math.max(3, Math.min(12, n));
  const cx = stage.width * 0.52, cy = stage.height * 0.55;
  const dx = purse.left + purse.width / 2 - stage.left - cx, dy = purse.top + purse.height / 2 - stage.top - cy;
  $('#coins').innerHTML = Array.from({ length: count }, (_, k) =>
    `<i style="left:${cx + (k % 4) * 10 - 15}px;top:${cy - Math.floor(k / 4) * 8}px;--dx:${dx}px;--dy:${dy}px;animation-delay:0s,${k * 70}ms"></i>`).join('');
  setTimeout(() => { $('#coins').innerHTML = ''; }, 2200);
}

function renderMove() {
  const open = pv?.debts.filter((d) => d.status === 'open') ?? [];
  const mv = nextMove({
    ready, pending: !!pv?.pending_offer, openDebts: open.length, offers: pv?.offers_total ?? 0,
    records: st?.records ?? 0, day: st?.day ?? 1, dueDay: open.length ? Math.max(...open.map((d) => d.due_day)) : undefined,
  });
  const el = $('#move');
  el.className = `quest panel ${mv.tone}`;
  $('#movetext').textContent = onboardErr || mv.text;
}

function seconds(): number { return pendingSince ? Math.floor((Date.now() - pendingSince) / 1000) : 0; }

function renderVerdict() {
  const el = $('#verdict');
  const name = (id: number) => st?.merchants[id]?.name ?? 'The merchant';
  if (pv?.pending_offer) {
    setHtml(el, `<h3><span class="ico s hourglass"></span>The merchant is thinking</h3>
      <p class="clock" id="clock">${seconds()}<small>seconds, up to 115 before the bond comes back</small></p>
      <p class="hint" style="margin-top:12px">The model answers, a signature over the exact request and answer is checked on chain, and only then are the terms clamped and committed.</p>`);
    return;
  }
  const o = last;
  if (!o || !o.outcome) {
    setHtml(el, `<h3><span class="mk pending"></span>What the road allowed</h3><p class="empty" style="margin-top:8px">Pitch a merchant. The seal lands here with what you asked for, what the merchant offered, and what the road let through.</p>`);
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
        : 'Request not captured in this browser.';
  const max = Math.max(o.ask, oc.proposed_advance, oc.advance, 1);
  const w = (n: number) => Math.round((n / max) * 100);
  const interest = oc.advance ? oc.repay - oc.advance : 0;
  setHtml(el, `<h3><span class="mk ${esc(o.status)}"></span>${esc(STATUS_LABEL[o.status] ?? o.status)}<span class="hint">&nbsp;${esc(name(o.merchant))}, day ${o.day}</span></h3>
    <div class="tri">
      <div class="r"><span class="k">You asked</span><span class="rail"><i style="width:${w(o.ask)}%"></i></span><b>${o.ask}</b></div>
      <div class="r"><span class="k">Merchant offered</span><span class="rail"><i style="width:${w(oc.proposed_advance)}%"></i></span><b>${oc.proposed_advance}</b></div>
      <div class="r allowed"><span class="k">Road allowed</span><span class="rail"><i style="width:${w(oc.advance)}%"></i></span><b>${oc.advance}</b></div>
    </div>
    ${oc.clamps.length ? `<ul class="why">${oc.clamps.map((c) => `<li>${esc(clampSentence(c))}</li>`).join('')}</ul>` : o.status === 'committed' ? '<p class="hint">Nothing was clamped: the offer sat inside every limit.</p>' : ''}
    ${o.status === 'committed' ? `<p style="font-size:15px;margin:8px 0">Repay <b>${oc.repay}</b> gold (${interest} interest) by the end of day <b>${oc.due_day}</b>, or your ${o.bond} gold bond burns and a con lands in the ledger as ${esc(classLabel(oc.class))}.</p>` : ''}
    ${o.status === 'refused' ? `<p style="font-size:15px;margin:8px 0">The road filed this pitch as ${esc(classLabel(oc.class))}. Your bond is back in your purse.</p>` : ''}
    <p class="fine">${esc(signerSentence(oc.signer, oc.model))} ${signatureOk ? 'Signature checked in your browser.' : 'Signature did NOT verify against the registered key.'} ${requestCheck}</p>
    ${capture?.news?.length ? `<div class="fine"><span>News in this request:</span><ul>${capture.news.map((line) => `<li>${esc(line)}</li>`).join('')}</ul></div>` : ''}
    <p class="fine" style="margin-top:6px">${offerTx[o.id] ? `<a href="${esc(txUrl(cfg.explorer, offerTx[o.id]))}" target="_blank" rel="noreferrer">Your pitch transaction</a>. ` : ''}${esc(answeredLine(answeredMs))}</p>
    <p class="fine">Request hash: <code class="mono" data-request-hash>${esc(o.request_hash)}</code></p>
    <p class="fine">Response hash: <code class="mono" data-response-hash>${esc(oc.response_hash)}</code></p>`);
}

function renderMine() {
  const open = pv?.debts.filter((d) => d.status === 'open') ?? [];
  const day = st?.day ?? 1;
  const endsIn = dayLeft().left;
  const canEnd = ready && !busy && endsIn === 0;
  const m = st?.merchants[selected];
  put("#mine", `
    <h2><span class="ico s coin"></span>Your purse</h2>
    <h3>What you owe</h3>
    ${open.length ? `<div class="rows">${open.map((d) => `
      <div class="r"><span class="main"><span class="ico s scroll"></span><span><b>${d.repay}</b> gold to ${esc(st?.merchants[d.merchant]?.name ?? '')}, due end of day ${d.due_day}. Bond ${d.bond}.</span></span>
      <button class="btn small green" data-act="repay" data-d="${d.id}" ${pv && pv.gold >= d.repay && day <= d.due_day && !busy ? '' : 'disabled'} type="button">Pay back</button></div>`).join('')}</div>`
      : '<p class="empty">No open debts. Take an advance and it shows here with its due day.</p>'}
    <div class="endrow"><button class="btn big" data-act="endday" type="button" ${canEnd ? '' : 'disabled'}><span class="ico s ${endsIn > 0 ? 'sun' : 'moon'}"></span>${endsIn > 0 ? `Day ${day} ends in ${endsIn}s` : `End day ${day}`}</button>
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
  put("#recs", records.length
    ? [...records].reverse().map((r) => `
      <div class="rec"><span class="n">#${r.id}</span>
        <span><span class="cls">${esc(classShort(r.class))}</span> in ${esc(towns[r.town])}, day ${r.day}, by <span class="mono">${esc(shortId(r.player, 6, 6))}</span></span>
        <span class="lost">-${r.loss}</span>
        <span class="sub">${towns.map((t, k) => `${esc(t)} ${newsArrives(r.day, r.town, k) <= st!.day ? 'knows' : `hears day ${newsArrives(r.day, r.town, k)}`}`).join(' / ')}. Bond burned ${r.bond_burned}. Response <span class="mono">${esc(shortId(r.response_hash, 8, 6))}</span></span>
      </div>`).join('')
    : '<p class="empty" style="padding-top:8px">No con has landed. When a debt goes unpaid and its day ends, the loss, the class and the hashes of what the model saw and said are written here.</p>');
  put("#side", `
    <h3>Wanted board</h3>
    ${wanted.length ? `<div class="rows">${wanted.map((w) => `<div class="r"><span class="main"><b>${esc(classShort(w.class))}</b><span class="hint">first by <span class="mono">${esc(shortId(w.first_player, 6, 6))}</span>, day ${w.day}</span></span><span class="num">${w.landed} landed</span></div>`).join('')}</div>` : '<p class="empty">Each new kind of con earns a place here. Be the first to land one.</p>'}
    <h3>Rumour tokens you hold</h3>
    <div class="rows">${CLASSES.map((c) => `<div class="r"><span class="main">${esc(classShort(c))}</span><span class="num">${rumours[c] ?? '0'}</span></div>`).join('')}</div>
    <p class="hint" style="margin-top:8px">A landed con mints one rumour token to the con artist.</p>`);
}

function renderFoot() {
  put("#foot", `Contract <a href="${esc(cfg.explorer)}/address/${esc(cfg.contract_id)}" target="_blank" rel="noreferrer">${esc(cfg.contract_id)}</a> on ${esc(cfg.network)}. Model ${esc(st?.model ?? '')}. Every gold figure on this page is read from the contract.`);
}

function renderAll() {
  renderBar(); renderRoad(); renderStage(); renderMove(); renderVerdict(); renderMine(); renderLedger(); renderFoot(); syncForm();
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
    renderAll();
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
