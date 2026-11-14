/** Advance the live road N days through the relayer with a fresh throwaway account: bun web/scripts/advance-days.ts <n> */
import { KeyPair } from 'near-api-js';
import { Chain, type Config } from '../src/chain.ts';

const n = Number(process.argv[2] ?? 1);
const cfg: Config = await Bun.file(new URL('../public/config.json', import.meta.url)).json();
const site = process.env.SITE ?? 'https://near-longcon.nearlive.workers.dev';
if (cfg.relayer.startsWith('/')) cfg.relayer = site + cfg.relayer;
if (cfg.rpc.startsWith('/')) cfg.rpc = site + cfg.rpc;
if (process.env.RELAYER_URL) cfg.relayer = process.env.RELAYER_URL;
const kp = KeyPair.fromRandom('ed25519');
const id = Array.from(kp.getPublicKey().data, (x) => x.toString(16).padStart(2, '0')).join('');
const chain = new Chain(cfg, { id, kp });
await chain.activate(60_000);
await chain.send('join', {});
for (let k = 0; k < 60 && !(await chain.view('player', { account_id: id })); k++) await new Promise((r) => setTimeout(r, 800));
for (let i = 0; i < n; i++) {
  const before: any = await chain.view('state');
  const wait = Number(BigInt(before.day_started_ns) / 1_000_000n) + before.day_length_ms - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait + 1500));
  const { tx } = await chain.send('advance_day', {});
  for (let k = 0; k < 40; k++) {
    const s: any = await chain.view('state');
    if (s.day > before.day) { console.log(JSON.stringify({ day: s.day, records: s.records, tx, marta: s.merchants[0].due_exposure })); break; }
    await new Promise((r) => setTimeout(r, 1500));
  }
}
