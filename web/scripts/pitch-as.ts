/** A fresh traveler pitches the open round through the relayer: bun web/scripts/pitch-as.ts "<pitch>" <ask> <bond> [merchant]
 *  Prints each step with elapsed seconds and the terminal outcome read from the contract. */
import { KeyPair } from 'near-api-js';
import { Chain, type Config } from '../src/chain.ts';

const [pitch = 'Two gold until tomorrow for a sack of seed. I pay back three.', ask = '2', bond = '5', merchant = '0'] = process.argv.slice(2);
const cfg: Config = await Bun.file(new URL('../public/config.json', import.meta.url)).json();
const site = process.env.SITE ?? 'https://near-longcon.nearbuild.workers.dev';
if (cfg.relayer.startsWith('/')) cfg.relayer = site + cfg.relayer;
if (cfg.rpc.startsWith('/')) cfg.rpc = site + cfg.rpc;
if (process.env.RELAYER_URL) cfg.relayer = process.env.RELAYER_URL;
const kp = KeyPair.fromRandom('ed25519');
const id = Array.from(kp.getPublicKey().data, (x) => x.toString(16).padStart(2, '0')).join('');
const chain = new Chain(cfg, { id, kp });
const t0 = Date.now();
const say = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const round = chain.openRound(Number(merchant)).then((r) => say(`round ${r.opened ? 'opened' : `left alone (${r.reason})`}`));
await chain.activate(60_000);
say('account activated');
await chain.send('join', {});
for (let k = 0; k < 60 && !(await chain.view('player', { account_id: id })); k++) await new Promise((r) => setTimeout(r, 800));
say('joined');
await round;
const { tx } = await chain.send('offer', { merchant: Number(merchant), ask: Number(ask), bond: Number(bond), pitch });
say(`pitch sent ${tx}`);
for (;;) {
  await new Promise((r) => setTimeout(r, 1500));
  const p: any = await chain.view('player', { account_id: id });
  if (p?.pending_offer) continue;
  const [o]: any[] = await chain.view('offers_of', { account_id: id, limit: 1 });
  say(`answer: ${o.status}, advance ${o.outcome?.advance ?? 0}, batch ${o.batch}, reason "${o.outcome?.reason ?? ''}"`);
  console.log(JSON.stringify({ account: id, offer: o.id, batch: o.batch, status: o.status, advance: o.outcome?.advance ?? 0, clamps: o.outcome?.clamps ?? [], seconds: Number(((Date.now() - t0) / 1000).toFixed(1)) }));
  break;
}
process.exit(0);
