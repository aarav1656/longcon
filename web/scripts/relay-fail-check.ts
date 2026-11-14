import { KeyPair } from 'near-api-js';
import { Chain, ChainError, type Config } from '../src/chain.ts';
const cfg: Config = await Bun.file(new URL('../public/config.json', import.meta.url)).json();
const site = 'https://near-longcon.nearbuild.workers.dev';
if (cfg.relayer.startsWith('/')) cfg.relayer = site + cfg.relayer;
if (cfg.rpc.startsWith('/')) cfg.rpc = site + cfg.rpc;
if (process.env.RELAYER_URL) cfg.relayer = process.env.RELAYER_URL;
const kp = KeyPair.fromRandom('ed25519');
const id = Array.from(kp.getPublicKey().data, (x) => x.toString(16).padStart(2, '0')).join('');
const chain = new Chain(cfg, { id, kp });
await chain.activate(60_000);
await chain.send('join', {});
for (let k = 0; k < 60 && !(await chain.view('player', { account_id: id })); k++) await new Promise((r) => setTimeout(r, 800));
const t0 = Date.now();
try { const r = await chain.send('fork_rule', { fork_id: 999999, backed_rule: 15 }); console.log('NO ERROR', r.tx, Date.now() - t0); } catch (e) { console.log('error as required:', (e as Error).message, e instanceof ChainError ? e.tx : '', Date.now() - t0, 'ms'); }
process.exit(0);
