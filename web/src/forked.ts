import './style.css';
import './forked.css';
import { Chain, ChainError, identity, loadConfig, type Config } from './chain.ts';
import { CAST, RULES, canSettleAgain, dayFeed, readFork, readHealth, richer, verdictLine, waitState, type Branch, type Fork, type Rule } from './fork.ts';
import { clampSentence, esc, shortId, txUrl } from './words.ts';

const FORK_SLOT = 'longcon.fork';
const KEY_SLOT = 'longcon.player-key';
const DAY_MS = 700;
const app = document.getElementById('app')!;

let cfg: Config;
let chain: Chain;
let ready = false;
let onboardFailed = false;
let onboardTry = 0;
let fork: Fork | null = null;
let backed: Rule | null = null;
let busy = '';
let notice: { kind: 'ok' | 'bad'; text: string; tx?: string } | null = null;
let txs: { label: string; hash: string }[] = [];
let replayAt = 0;
let settled: { tx: string; seconds: number } | null = null;
let settling = false;
let sealedAt = 0;
let lateShown = false;
let gaveShown = false;
let readFails = 0;
let readErr = '';
let failShown = false;
let settleFailed = false;
let lastFork: Fork | null = null;
let merchantName = "the merchant";
let openPurse: number | null = null;
let doneAt = 0;

const nap = (ms: number) => new Promise((r) => setTimeout(r, ms));
const html = new WeakMap<Element, string>();
function put(sel: string, s: string) {
  const el = document.querySelector(sel)!;
  if (html.get(el) === s) return;
  html.set(el, s);
  el.innerHTML = s;
}
const tx = (hash: string, label: string) => `<a class="txl" href="${esc(txUrl(cfg.explorer, hash))}" target="_blank" rel="noopener">${esc(label)}</a>`;
let startedAt = 0;
const elapsed = () => (startedAt ? Math.round((performance.now() - startedAt) / 1000) : 0);

function dayIdx(): number {
  if (!fork || fork.status === 'open' || fork.status === 'sealed' || !replayAt) return -1;
  return Math.min(7, Math.floor((Date.now() - replayAt) / DAY_MS));
}
const replayDone = () => dayIdx() === 7;

function skeleton() {
  app.innerHTML = `
  <div class="fork">
    <header class="ftop">
      <div class="flogo"><b>LONG CON</b><small>Forked Town</small></div>
      <h1 class="fhero" id="fhero" hidden></h1>
      <p class="fdeck">Pick a rule. The contract splits the town in two and one signed answer runs through both.</p>
      <p class="net" id="net"></p>
    </header>
    <section class="controls" id="controls" aria-live="polite"></section>
    <section class="flast panel" id="last" aria-label="Last split on chain" hidden></section>
    <section class="fqueue" id="queue" aria-label="The queue at the stall"></section>
    <section class="fverdict panel" id="verdict" aria-live="polite" hidden></section>
    <section class="twins" id="twins" aria-label="The two towns"></section>
    <section class="fproof panel" id="proof" aria-label="Proof"></section>
    <footer class="ffoot" id="ffoot"><p><b>No wallet, no popups:</b> the relayer pays gas for your session account.</p><p><b>One readable rules file:</b> every cap the contract enforces is in <a href="/rules.rs.txt" target="_blank" rel="noopener">contract/src/rules.rs</a>. Hover a borrower to read the merchant's reasoning.</p><p><b>Items:</b> landed cons mint NEP-245 rumour tokens, see the <a href="/queue">queue game</a>.</p></footer>
  </div>`;
}

function renderQueue() {
  put("#queue", `<p class="fmini"><span class="ico s scroll"></span><b>The queue at ${esc(merchantName)}'s stall</b>${CAST.map((c) => `<span class="chip2">${esc(c.name.split(" ")[0])} <em>${c.ask}</em></span>`).join("")}</p>
    <details class="pitches"><summary>Read the four pitches</summary><ol class="cast">${CAST.map((c) => `<li class="card"><span class="fwho"><b>${esc(c.name)}</b><span class="ask">${c.ask} gold, due in two days</span></span><q>${esc(c.pitch)}</q></li>`).join("")}</ol></details>`);
}

const STEPS = ['Split the town', 'Seal the queue', 'Merchant signs', 'Seven days', 'Claim settles'];
function stage(): number {
  if (!fork) return busy.startsWith('split') ? 0 : -1;
  if (fork.status === 'open') return 1;
  if (fork.status === 'sealed') return 2;
  if (fork.status === 'settled' && replayDone()) return 5;
  return replayDone() ? 4 : 3;
}

function renderControls() {
  const picked = !!fork || busy.startsWith('split');
  const label = (r: Rule) => (backed === r ? `Daily loss cap ${r} <small>backed</small>` : `Daily loss cap ${r} <small>${r === 15 ? "the merchant risks 15 gold a day" : "the merchant risks 25 gold a day"}</small>`);
  const status = busy || (onboardFailed ? 'The account is closed. Press Retry to open it.' : !ready ? (onboardTry > 1 ? `Opening your account on testnet, attempt ${onboardTry} of 6.` : 'Opening your account on testnet.') : !fork ? 'Choose the cap you back. One click splits the town and runs the seven days.' : '');
  const sealing = fork?.status === 'sealed';
  const waited = sealing ? Date.now() - sealedAt : 0;
  const wait = sealing ? waitState(waited) : 'wait';
  const late = wait !== 'wait';
  const gaveUp = wait === 'gaveup';
  lateShown = late; gaveShown = gaveUp; failShown = readHealth(readFails) === 'failing';
  const at = stage();
  put('#controls', `
    <div class="pick">
      <span class="fk">Back a rule</span>
      <div class="btns">${RULES.map((r) => `<button class="btn ${!fork || backed === r ? 'gold' : ''} big" type="button" data-cap="${r}" ${!picked ? '' : 'disabled'} ${busy.startsWith('split') && backed === r ? 'aria-busy="true"' : ''}>${label(r)}</button>`).join('')}</div>
    </div>
    ${picked ? `<ol class="steps" aria-label="Progress">${STEPS.map((t, i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}">${esc(t)}</li>`).join('')}</ol>` : ''}
    ${sealing && readHealth(readFails) === 'failing' ? `<p class="retry">The chain read is failing (${esc(readErr || 'no answer')}). Your seal is on chain and nothing is lost. <button class="btn gold" type="button" data-act="recheck">Read again</button></p>` : ''}
    ${settleFailed && canSettleAgain(fork, replayDone(), settling) ? '<p class="retry">The claim did not settle yet. The divergence receipt is still valid. <button class="btn gold" type="button" data-act="settle">Settle again</button></p>' : ''}
    ${gaveUp ? '<p class="retry">NEAR AI Cloud has not returned the signed merchant answer in 90 s. Your seal stays on chain, the merchant worker keeps retrying it, and the claim settles the moment it lands. <button class="btn gold" type="button" data-act="recheck">Check again</button> <button class="btn" type="button" data-act="again">Split a new town</button></p>'
      : late ? '<p class="retry">The merchant is taking longer than usual. The seal is on chain, and the answer settles it the moment it lands. <button class="btn gold" type="button" data-act="recheck">Check again</button></p>' : ''}
    ${onboardFailed ? '<p class="retry"><button class="btn gold" type="button" data-act="retry">Retry</button></p>' : ''}
    <p class="status" role="status">${esc(status)}${sealing ? ` The merchant is deciding <span class="num">${Math.max(0, Math.round(waited / 1000))} s</span>` : ''}</p>`);
}

const stampFor = (b: Branch, idx: number) => {
  const defaults = b.rows[idx]?.defaults ?? 0;
  const prev = idx > 0 ? b.rows[idx - 1].defaults : 0;
  return defaults > prev ? b.rows[idx].lost - b.rows[idx - 1].lost : 0;
};

function chart(i: number, idx: number): string {
  const all = fork!.branches.flatMap((b) => b.rows.map((r) => r.gold));
  const lo = Math.min(...all) - 2, hi = Math.max(...all) + 2;
  const rows = fork!.branches[i].rows;
  const x = (d: number) => 8 + (d * 284) / 7;
  const y = (g: number) => 8 + (1 - (g - lo) / Math.max(1, hi - lo)) * 64;
  const pts = rows.slice(0, idx + 1).map((r, d) => `${x(d).toFixed(1)},${y(r.gold).toFixed(1)}`).join(' ');
  const fd = fork!.divergence?.first_day ?? 0;
  const mark = idx >= fd && fork!.divergence?.diverged
    ? `<line x1="${x(fd)}" x2="${x(fd)}" y1="2" y2="78" class="split"/><text x="${x(fd) + 4}" y="12" class="splitlabel">rules part here</text>` : '';
  const dots = rows.slice(0, idx + 1).map((r, d) => `<circle cx="${x(d).toFixed(1)}" cy="${y(r.gold).toFixed(1)}" r="${d === idx ? 4 : 2}" class="${d === idx ? 'now' : ''}"/>`).join('');
  return `<svg viewBox="0 0 300 80" class="chart" role="img" aria-label="Merchant gold by day, cap ${fork!.branches[i].rule}">${mark}<polyline points="${pts}"/>${dots}</svg>`;
}

/** Both towns' gold by day on one chart, so the two futures share a screen at any width. */
function dualChart(f: Fork, idx: number): string {
  const all = f.branches.flatMap((b) => b.rows.map((r) => r.gold));
  const lo = Math.min(...all) - 4, hi = Math.max(...all) + 4;
  const x = (d: number) => 10 + (d * 250) / 7;
  const y = (g: number) => 10 + (1 - (g - lo) / Math.max(1, hi - lo)) * 90;
  const lines = f.branches.map((b, i) => {
    const pts = b.rows.slice(0, idx + 1).map((r, d) => `${x(d).toFixed(1)},${y(r.gold).toFixed(1)}`).join(' ');
    const last = b.rows[Math.min(idx, b.rows.length - 1)];
    return `<polyline class="l${i}" points="${pts}"/><circle class="l${i}" cx="${x(Math.min(idx, 7)).toFixed(1)}" cy="${y(last.gold).toFixed(1)}" r="4"/><text class="t${i}" x="${(x(Math.min(idx, 7)) + 8).toFixed(1)}" y="${(y(last.gold) + 4).toFixed(1)}">cap ${b.rule} ${last.gold}</text>`;
  }).join('');
  return `<svg viewBox="0 0 340 110" class="dual" role="img" aria-label="Merchant gold by day: cap ${f.branches[0].rule} against cap ${f.branches[1].rule}">${lines}</svg>`;
}

function renderTwins() {
  const idx = dayIdx();
  const panes = RULES.map((rule, i) => {
    const b = fork && fork.status !== 'open' && fork.status !== 'sealed' ? fork.branches[i] : null;
    const row = b && idx >= 0 ? b.rows[idx] : null;
    const gold = row ? row.gold : fork ? fork.purse : openPurse;
    const lost = b && idx > 0 ? stampFor(b, idx) : 0;
    const done = !!fork && replayDone();
    const win = done ? richer(fork!) === i : false;
    const behind = done && !win && richer(fork!) !== null;
    const debt = done && b ? b.rows[b.rows.length - 1].lost : 0;
    const feed = b ? dayFeed(b).filter((l) => l.day <= idx) : [];
    const loans = b
      ? b.loans.map((l) => `<li title="${esc(l.reason)}" class="${l.accepted && l.advance > 0 ? (l.clamps.length ? 'cut' : 'lent') : 'no'}"><b>${esc(l.name)}</b><span>${l.accepted && l.advance > 0 ? (l.clamps.length ? `lends ${l.advance} of ${l.proposed_advance}` : `lends ${l.advance}`) : 'refused'}</span>${l.clamps.length && l.advance > 0 ? `<em title="${esc(clampSentence(l.clamps[0]))}">cap</em>` : ''}</li>`).join('')
      : CAST.map((c) => `<li class="wait"><b>${esc(c.name)}</b><span>waits</span></li>`).join('');
    return `
    <article class="twin ${win ? 'wins' : ''} ${behind ? 'behind' : ''} ${backed === rule ? 'backed' : ''}" data-rule="${rule}">
      <div class="fscene">
        <img class="layer" alt="" src="/art/town0-back.png"><div class="merchant" data-m="0" data-mood="${b && lost ? 'stern' : b && row ? 'pleased' : fork?.status === 'sealed' ? 'think' : 'idle'}" role="img" aria-label="${esc(merchantName)}"></div><img class="layer" alt="" src="/art/town0-front.png">
        <div class="ftag"><h2>Daily loss cap ${rule}</h2><p>At most ${rule} gold may come due on one day.</p></div>
        ${backed === rule ? '<span class="you">You back this</span>' : ''}
        <div class="pursebar"><span class="fcoin"></span><b class="num">${gold ?? '–'}</b><span class="fk">${row ? `day ${idx}` : 'purse'}</span></div>
        ${b ? `<div class="fchartbox">${chart(i, Math.max(0, idx))}</div>` : ""}
        ${lost ? `<div class="fstamp">DEFAULT −${lost}</div>` : ''}
        ${done && debt > 0 && !lost ? `<div class="fdebt${behind ? ' deep' : ''}"><b class="num">−${debt}</b><span>gold lost to an unpaid loan</span></div>` : ''}
        ${win ? '<div class="crown">KEEPS MORE GOLD</div>' : ''}
      </div>
      <div class="ledger">
        <ul class="loans">${loans}</ul>
        ${b ? "" : '<p class="hold">The same four pitches reach both towns. Only the cap differs.</p>'}
        ${b && idx >= 0 ? `<ul class="feed">${feed.slice(-4).map((l) => `<li class="${l.kind}"><span>day ${l.day}</span>${esc(l.text)}</li>`).join('')}</ul>` : ''}
      </div>
    </article>`;
  });
  put('#twins', panes.join(''));
}

function deltaHtml(f: Fork): string {
  const w = richer(f);
  const side = (br: Branch, lead: boolean) => `<div class="fd ${lead ? 'up' : w === null ? '' : 'down'}"><span class="fk">Cap ${br.rule}</span><b class="num">${br.final_gold}</b><span class="fk">${br.defaults ? `${br.defaults} unpaid loan${br.defaults > 1 ? 's' : ''}` : 'no unpaid loan'}</span></div>`;
  const gap = w === null ? 0 : f.branches[w].final_gold - f.branches[1 - w].final_gold;
  return `<div class="fdelta" aria-label="Final gold in each town">${side(f.branches[0], w === 0)}<div class="fgap"><b class="num">${w === null ? '=' : `+${gap}`}</b><span class="fk">${w === null ? 'level' : `more gold under cap\u00a0${f.branches[w].rule}`}</span></div>${side(f.branches[1], w === 1)}</div>`;
}

function renderLast() {
  const f = lastFork;
  const running = !!fork && (fork.status === 'open' || fork.status === 'sealed');
  const show = !!f && (!fork || running);
  const el = document.querySelector('#last') as HTMLElement;
  el.hidden = !show;
  const hero = document.querySelector('#fhero') as HTMLElement;
  hero.hidden = !show;
  if (!show || !f) return;
  hero.textContent = verdictLine(f);
  put('#last', `<h2><span class="ico s lock"></span>An earlier split, settled on chain</h2>
    ${deltaHtml(f)}
    <p class="fk">Fork #${f.id} on ${esc(cfg.contract_id)}. ${running || busy.startsWith('split') ? 'Your own split is running below.' : 'Press a cap to run your own.'} Same four pitches, one signed answer from <span class="mono">${esc(f.signer)}</span>, only the cap differs. Settled at block ${f.claim.settled_block}. <a class="txl" href="${esc(cfg.explorer.replace(/\/+$/, ''))}/address/${esc(cfg.contract_id)}" target="_blank" rel="noopener">Contract on explorer</a></p>`);
}

/** A settled, diverged, signed fork the chain is known to hold; the first screen falls back to it when the newest forks are stalled or unreadable. */
const PINNED_FORK = 57;
const SCAN_FORKS = 40;
const usable = (f: Fork | null | undefined): f is Fork => !!f && f.status === 'settled' && !!f.divergence?.diverged && !!f.signer;

async function loadLast() {
  const pinned = readFork(chain, PINNED_FORK).catch(() => null);
  try {
    const n = Number(await chain.view<number>('fork_count'));
    for (let hi = n; hi > 0 && hi > n - SCAN_FORKS; hi -= 4) {
      const ids = [hi, hi - 1, hi - 2, hi - 3].filter((id) => id > 0);
      const found = (await Promise.all(ids.map((id) => readFork(chain, id).catch(() => null)))).find(usable);
      if (found) { lastFork = found; break; }
      if (!lastFork) {
        const f = await pinned;
        if (usable(f)) { lastFork = f; renderLast(); }
      }
    }
  } catch { /* the pinned fork below still answers */ }
  if (!lastFork) {
    const f = await pinned;
    if (usable(f)) lastFork = f;
  }
  renderLast();
}

function renderVerdict() {
  let body = '';
  if (notice) body += `<p class="fnote ${notice.kind}" role="alert">${esc(notice.text)}${notice.tx ? ` ${tx(notice.tx, 'transaction')}` : ''}</p>`;
  if (fork && replayDone()) {
    const c = fork.claim;
    body += `<div class="fdual">${dualChart(fork, 7)}</div>`;
    const line = c.status === 'won' ? `You backed the cap of ${fork.backed_rule}. It kept more gold, so the claim wins ${c.payout} gold.`
      : c.status === 'lost' ? `You backed the cap of ${fork.backed_rule}. The other rule kept more gold, so the claim loses.`
      : c.status === 'draw' ? `You backed the cap of ${fork.backed_rule}. Both towns end level, so the claim draws.`
      : 'The contract is settling your claim.';
    const w = richer(fork);
    body += deltaHtml(fork);
    const said = fork.branches[0].loans.map((l) => `<li><b>${esc(l.name.split(' ')[0])}</b> ${l.accepted ? `lend ${l.proposed_advance}` : 'refuse'}<q>${esc(l.reason)}</q></li>`).join('');
    body += `<div class="fsigned"><p class="fk">One signed answer, applied to both towns <span class="mono">${esc(fork.signer || '')}, NEAR AI attested, response ${esc(shortId(fork.response_hash, 8, 6))}</span></p><ul>${said}</ul></div>`;
    body += `<h2>${esc(verdictLine(fork))}</h2><p class="claim ${c.status}">${esc(line)}${settled ? ` ${tx(settled.tx, 'settlement')}` : ''}</p>
      <p class="fclock">Rule pick to settled claim: <b class="num">${doneAt || elapsed()} s</b> <button class="btn small" type="button" data-act="again">Split another town</button></p>`;
  } else if (fork && fork.status !== 'open' && fork.status !== 'sealed') {
    body += `<h2>Seven days pass in the two towns.</h2><div class="fdual">${dualChart(fork, Math.max(0, dayIdx()))}</div><p class="claim">Day ${Math.max(0, dayIdx())} of 7. The proof below is already final.</p>`;
  }
  put("#verdict", body);
  (document.querySelector("#verdict") as HTMLElement).hidden = !body;
}

function renderProof() {
  if (!fork || fork.status === 'open') { put('#proof', '<h2><span class="ico s lock"></span>Proof</h2><p class="claim">Back a cap and the world hash, both start hashes, the signed request and response and the divergence receipt land here.</p>'); return; }
  const rows = ([
    ['Fork', `#${fork.id} on ${cfg.contract_id}`],
    ['World hash', fork.world_hash],
    ['Cap 15 start hash', fork.branches[0].start_hash],
    ['Cap 25 start hash', fork.branches[1].start_hash],
    ['Request hash', fork.request_hash],
    ['Response hash', fork.response_hash || ''],
    ['Signer', fork.signer ? `${fork.signer}, NEAR AI attested` : ''],
    ['Divergence receipt', fork.divergence?.receipt ?? ''],
    ['Day 7 hash, cap 15 | cap 25', fork.divergence ? `${shortId(fork.divergence.hash_a, 10, 8)} | ${shortId(fork.divergence.hash_b, 10, 8)}` : ''],
    ['Blocks', `split ${fork.split_block}, sealed ${fork.sealed_block}${fork.resolved_block ? `, resolved ${fork.resolved_block}` : ''}${fork.claim.settled_block ? `, settled ${fork.claim.settled_block}` : ''}`],
  ] as [string, string][]).filter(([, v]) => v);
  const waiting = fork.status === 'sealed' ? '<p class="claim">Waiting for the merchant to sign its answer. The signer, response hash and divergence receipt land here the moment it arrives.</p>' : '';
  const links = txs.map((t) => tx(t.hash, t.label)).join('');
  put('#proof', `
    <h2><span class="ico s lock"></span>Proof</h2>
    ${waiting}
    <dl>${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="mono" title="${esc(v)}">${v.length > 40 && !v.includes(' ') ? esc(shortId(v, 14, 10)) : esc(v)}</dd></div>`).join('')}</dl>
    <p class="links">${links}</p>
    <p class="read mono">near contract call-function as-read-only ${esc(cfg.contract_id)} fork json-args '{"fork_id":${fork.id}}' network-config testnet now</p>
    <p class="edit"><button class="btn small" type="button" data-act="edit" ${busy ? 'disabled' : ''}>Try to change the rule now</button><span>The sealed rule is frozen. The contract answers any edit.</span></p>`);
}

function renderNet() {
  put('#net', `<span class="fdot ${ready ? 'on' : ''}"></span>${ready ? 'NEAR testnet, account ready' : onboardFailed ? 'NEAR testnet, account closed' : 'NEAR testnet, opening account'}`);
}

function render() {
  renderNet(); renderQueue(); renderControls(); renderLast(); renderTwins(); renderVerdict(); renderProof();
}

async function onboard() {
  onboardFailed = false; notice = null; onboardTry = 0;
  const ATTEMPTS = 6;
  let last = '';
  for (let k = 1; k <= ATTEMPTS && !ready; k++) {
    onboardTry = k; renderControls(); renderNet();
    try {
      await chain.activate(60_000);
      if (!(await chain.view('player', { account_id: chain.me.id }))) {
        await chain.send('join', {});
        for (let j = 0; j < 60 && !(await chain.view('player', { account_id: chain.me.id })); j++) await nap(800);
      }
      ready = true;
    } catch (e) {
      const m = (e as Error).message;
      last = m.length > 60 || m.includes('<') ? 'the relay did not answer' : m;
      if (k < ATTEMPTS) await nap(Math.min(1500 * k, 6000));
    }
  }
  if (!ready) {
    onboardFailed = true;
    notice = { kind: 'bad', text: `The account did not open (${last}). Retry opens it again.` };
  }
  render();
}

async function myForkIds(): Promise<number[]> {
  const ids = await chain.view<number[]>('forks_of', { account_id: chain.me.id }).catch(() => []);
  return (ids ?? []).map(Number);
}

async function call(label: string, method: string, args: Record<string, unknown>): Promise<{ tx?: string; value?: string }> {
  const r = await chain.send(method, args);
  if (r.tx) txs.push({ label, hash: r.tx });
  return r;
}

async function pick(rule: Rule) {
  if (busy) return;
  notice = null;
  try {
    if (!fork) {
      startedAt = performance.now();
      backed = rule;
      busy = 'split: the contract is cloning the town.'; render();
      while (!ready && !onboardFailed) await nap(300);
      if (!ready) throw new Error('the account is not open yet, press Retry');
      let before = await myForkIds();
      if (before.length >= 3) {
        localStorage.removeItem(KEY_SLOT);
        chain = new Chain(cfg, identity());
        ready = false; txs = []; render();
        await onboard();
        before = [];
      }
      const split = await call(`split town, cap ${rule}`, "fork_town", { merchant: 0, backed_rule: rule, cast: CAST });
      let id = Number(split.value ?? -1);
      if (!Number.isInteger(id)) id = -1;
      for (let k = 0; k < 40 && id < 0; k++) {
        await nap(700);
        const now = await myForkIds();
        const fresh = now.filter((x) => !before.includes(x));
        if (fresh.length) id = fresh[fresh.length - 1];
      }
      if (id < 0) throw new Error('the split did not appear on chain in time');
      fork = await readFork(chain, id);
      localStorage.setItem(FORK_SLOT, String(id));
    }
  } catch (e) {
    if (!fork) backed = null;
    notice = { kind: 'bad', text: (e as Error).message, tx: e instanceof ChainError ? e.tx : undefined };
  }
  busy = '';
  render();
  if (fork?.status === 'open') void seal();
}

async function seal() {
  if (!fork || fork.status !== 'open' || busy) return;
  notice = null;
  busy = 'Sealing the queue on chain.'; sealedAt = Date.now(); render();
  try {
    await call('seal', 'fork_seal', { fork_id: fork.id });
    sealedAt = Date.now();
    fork = (await readFork(chain, fork.id)) ?? fork;
  } catch (e) {
    notice = { kind: 'bad', text: (e as Error).message, tx: e instanceof ChainError ? e.tx : undefined };
  }
  busy = '';
  render();
  void follow();
}

async function recheck() {
  if (!fork || fork.status !== 'sealed') return;
  try { fork = (await readFork(chain, fork.id)) ?? fork; readFails = 0; readErr = ''; }
  catch (e) { readFails += 1; readErr = (e as Error).message.slice(0, 80); }
  renderControls();
}

async function follow() {
  while (fork && fork.status === 'sealed') {
    await nap(1200);
    try { fork = (await readFork(chain, fork.id)) ?? fork; readFails = 0; readErr = ''; }
    catch (e) { readFails += 1; readErr = (e as Error).message.slice(0, 80); }
    renderControls();
  }
  if (fork && fork.status !== 'open' && !replayAt) { replayAt = Date.now(); render(); void settle(); }
}

async function settle() {
  if (!fork || settling || !fork.divergence || fork.status === 'settled') return;
  settling = true;
  try {
    const done = await call("settle", "fork_settle", { fork_id: fork.id, receipt: fork.divergence.receipt });
    fork = (await readFork(chain, fork.id)) ?? fork;
    settled = { tx: done.tx ?? "", seconds: elapsed() };
    settleFailed = false;
  } catch (e) {
    settleFailed = true;
    notice = { kind: 'bad', text: (e as Error).message, tx: e instanceof ChainError ? e.tx : undefined };
  }
  settling = false;
  render();
}

async function tryEdit() {
  if (!fork || busy) return;
  busy = 'Asking the contract to change a sealed rule.'; render();
  const other = fork.backed_rule === 15 ? 25 : 15;
  try {
    await call('edit attempt', 'fork_rule', { fork_id: fork.id, backed_rule: other });
    notice = { kind: 'ok', text: 'The contract accepted the edit.' };
  } catch (e) {
    notice = { kind: 'bad', text: `The contract refuses: ${(e as Error).message}`, tx: e instanceof ChainError ? e.tx : undefined };
    if (e instanceof ChainError && e.tx) txs.push({ label: 'refused edit', hash: e.tx });
  }
  busy = '';
  render();
}

function again() {
  localStorage.removeItem(FORK_SLOT);
  fork = null; backed = null; startedAt = 0; replayAt = 0; settled = null; settling = false; notice = null; txs = []; doneAt = 0;
  render();
}

async function restore() {
  const id = Number(localStorage.getItem(FORK_SLOT));
  if (!id) return;
  const f = await readFork(chain, id).catch(() => null);
  if (!f || f.creator !== chain.me.id) { localStorage.removeItem(FORK_SLOT); return; }
  fork = f; backed = f.backed_rule as Rule; startedAt = performance.now();
  if (f.status === 'open') void seal();
  else if (f.status === 'sealed') { sealedAt = Date.now(); void follow(); }
  else { replayAt = Date.now(); void settle(); }
}

async function boot() {
  cfg = await loadConfig();
  chain = new Chain(cfg, identity());
  skeleton();
  render();
  app.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-cap],[data-act]');
    if (!t || (t as HTMLButtonElement).disabled) return;
    if (t.dataset.cap) void pick(Number(t.dataset.cap) as Rule);
    else if (t.dataset.act === 'edit') void tryEdit();
    else if (t.dataset.act === 'again') again();
    else if (t.dataset.act === 'retry') void onboard();
    else if (t.dataset.act === 'recheck') void recheck();
    else if (t.dataset.act === 'settle') void settle();
  });
  const st = await chain.view<{ merchants: { name: string; gold: number }[] }>("state").catch(() => null);
  if (st?.merchants?.[0]) { merchantName = st.merchants[0].name; openPurse = Math.min(200, st.merchants[0].gold); render(); }
  void loadLast();
  void onboard().then(restore).then(render);
  setInterval(() => {
    if (fork && replayAt) {
      if (replayDone() && !doneAt && (fork.status === 'settled' || !fork.divergence)) doneAt = elapsed();
      renderTwins(); renderVerdict(); renderControls();
    }
    if (fork?.status === 'sealed') {
      const n = document.querySelector('#controls .status .num');
      if (n) n.textContent = `${Math.max(0, Math.round((Date.now() - sealedAt) / 1000))} s`;
      const ws = waitState(Date.now() - sealedAt);
      if ((!lateShown && ws !== 'wait') || (!gaveShown && ws === 'gaveup') || (!failShown && readHealth(readFails) === 'failing')) renderControls();
    }
  }, 250);
}

boot().catch(() => {
  app.innerHTML = '<p class="ferr">The road is not answering. Reload in a moment.</p>';
});
