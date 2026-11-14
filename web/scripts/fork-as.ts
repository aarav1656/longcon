/** A fresh traveler splits a town and settles the claim through the relayer: bun web/scripts/fork-as.ts [rule=15] [merchant=0]
 *  Success path, then the must-fail cases (post-seal rule edit, wrong receipt, replay). Prints every step with elapsed seconds and tx hashes. */
import { KeyPair } from 'near-api-js';
import { Chain, ChainError, type Config } from '../src/chain.ts';
import { CAST, readFork, richer } from '../src/fork.ts';

const [rule = '15', merchant = '0'] = process.argv.slice(2);
const cfg: Config = await Bun.file(new URL('../public/config.json', import.meta.url)).json();
const site = process.env.SITE ?? 'https://near-longcon.nearlive.workers.dev';
if (cfg.relayer.startsWith('/')) cfg.relayer = site + cfg.relayer;
if (cfg.rpc.startsWith('/')) cfg.rpc = site + cfg.rpc;
if (process.env.RELAYER_URL) cfg.relayer = process.env.RELAYER_URL;
const kp = KeyPair.fromRandom('ed25519');
const id = Array.from(kp.getPublicKey().data, (x) => x.toString(16).padStart(2, '0')).join('');
const chain = new Chain(cfg, { id, kp });
const t0 = Date.now();
const say = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const nap = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mustFail = async (label: string, fn: () => Promise<unknown>) => {
  try { const r: any = await fn(); say(`UNEXPECTED SUCCESS: ${label} tx ${r?.tx}`); process.exitCode = 1; }
  catch (e) { say(`rejected as required: ${label}: ${(e as Error).message}${e instanceof ChainError && e.tx ? ` tx ${e.tx}` : ''}`); }
};

await chain.activate(60_000); say('account activated');
await chain.send('join', {});
for (let k = 0; k < 60 && !(await chain.view('player', { account_id: id })); k++) await nap(800);
say('joined');
const split = await chain.send('fork_town', { merchant: Number(merchant), backed_rule: Number(rule), cast: CAST });
say(`fork_town ${split.tx}`);
let fid = -1;
for (let k = 0; k < 40 && fid < 0; k++) { await nap(1000); const ids: any[] = await chain.view('forks_of', { account_id: id }).catch(() => []); if (ids?.length) fid = Number(typeof ids[0] === 'object' ? ids[0].id : ids[0]); }
if (fid < 0) throw new Error('fork not found');
say(`fork id ${fid}`);
const seal = await chain.send('fork_seal', { fork_id: fid });
say(`fork_seal ${seal.tx}`);
await mustFail('fork_rule after seal', () => chain.send('fork_rule', { fork_id: fid, backed_rule: Number(rule) === 15 ? 25 : 15 }));
let f = await readFork(chain, fid);
for (let k = 0; k < 90 && f && f.status === 'sealed'; k++) { await nap(1500); f = await readFork(chain, fid); }
if (!f || f.status !== 'resolved') throw new Error(`fork did not resolve: ${f?.status}`);
say(`resolved at block ${f.resolved_block}, signer ${f.signer}, first divergence day ${f.divergence?.first_day}, diverged ${f.divergence?.diverged}`);
for (const b of f.branches) console.log(`  cap ${b.rule}: final gold ${b.final_gold}, defaults ${b.defaults}, lost ${b.lost}, ${b.outcome}, loans ${b.loans.map((l) => `${l.name}:${l.accepted ? l.advance : 'no'}`).join(' ')}`);
await mustFail('fork_settle with a wrong receipt', () => chain.send('fork_settle', { fork_id: fid, receipt: 'f'.repeat(64) }));
const ok = await chain.send('fork_settle', { fork_id: fid, receipt: f.divergence!.receipt });
say(`fork_settle ok ${ok.tx}`);
await mustFail('fork_settle replay', () => chain.send('fork_settle', { fork_id: fid, receipt: f!.divergence!.receipt }));
const end = await readFork(chain, fid);
console.log(JSON.stringify({ account: id, fork: fid, status: end?.status, claim: end?.claim, richer: end ? richer(end) : null, request_hash: end?.request_hash, response_hash: end?.response_hash, signer: end?.signer, seconds: Number(((Date.now() - t0) / 1000).toFixed(1)) }));
process.exit(process.exitCode ?? 0);
