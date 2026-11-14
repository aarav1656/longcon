/**
 * Live acceptance for a starter pitch: N fresh accounts each pitch the same text to merchant 0 on the real
 * contract through the real relayer, and the script counts how many come back `committed` with advance > 0.
 *
 *   bun web/scripts/starter-acceptance.ts <runs> <ask> <bond> "<pitch text>"
 *
 * Exit 0 only when at least 2 of 3 (or ceil(2/3 * runs)) are committed. Config comes from web/public/config.json.
 */
import { KeyPair } from 'near-api-js';
import { Chain, type Config } from '../src/chain.ts';

const [runsArg, askArg, bondArg, ...rest] = process.argv.slice(2);
const merchant = Number(process.env.MERCHANT ?? 0);
const runs = Number(runsArg), ask = Number(askArg), bond = Number(bondArg), pitch = rest.join(' ');
if (!(runs > 0) || !(ask > 0) || !(bond >= 0) || !pitch) {
  console.error('usage: starter-acceptance.ts <runs> <ask> <bond> "<pitch>"');
  process.exit(2);
}
const cfg: Config = await Bun.file(new URL('../public/config.json', import.meta.url)).json();
if (cfg.relayer.startsWith('/')) cfg.relayer = (process.env.SITE ?? 'https://near-longcon.nearlive.workers.dev') + cfg.relayer;
if (process.env.RELAYER_URL) cfg.relayer = process.env.RELAYER_URL;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function one(i: number) {
  const kp = KeyPair.fromRandom('ed25519');
  const id = Array.from(kp.getPublicKey().data, (x) => x.toString(16).padStart(2, '0')).join('');
  const chain = new Chain(cfg, { id, kp });
  const t0 = Date.now();
  const s = () => Math.round((Date.now() - t0) / 1000);
  await chain.activate(60_000);
  const activated = s();
  await chain.send('join', {});
  for (let k = 0; k < 60 && !(await chain.view('player', { account_id: id })); k++) await sleep(800);
  const joined = s();
  const { tx } = await chain.send('offer', { merchant, ask, bond, pitch });
  for (let k = 0; k < 120; k++) {
    await sleep(1500);
    const offers: any[] = await chain.view('offers_of', { account_id: id, limit: 1 });
    const o = offers[0];
    if (o && o.status !== 'pending') {
      const row = { run: i, status: o.status, advance: o.outcome?.advance ?? 0, class: o.outcome?.class, reason: o.outcome?.reason, activated, joined, answered: s(), tx };
      console.log(JSON.stringify(row));
      return o.status === 'committed' && (o.outcome?.advance ?? 0) > 0;
    }
  }
  console.log(JSON.stringify({ run: i, status: 'no terminal state in 180 s', tx }));
  return false;
}

const results = await Promise.all(Array.from({ length: runs }, (_, i) => one(i + 1).catch((e) => { console.log(JSON.stringify({ run: i + 1, error: String(e?.message ?? e).slice(0, 200) })); return false; })));
const wins = results.filter(Boolean).length;
console.log(`committed ${wins} of ${runs}`);
process.exit(wins >= Math.ceil((runs * 2) / 3) ? 0 : 1);
