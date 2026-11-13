import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Account, KeyPair, KeyPairSigner, actions as A } from 'near-api-js';
import { env, provider } from './chain.ts';
import { PERSONAS } from './rivals.ts';

/**
 * Create the rival grifters' accounts as sub-accounts of one parent and join them to the game.
 * The parent key is read from its near-cli credential file; the new keys go to RIVALS_FILE (mode 600)
 * and are never printed. Usage: PARENT=longcon-relay.testnet BODIES=2 FUND_NEAR=0.4 bun run src/make-rivals.ts
 */
const contractId = env('CONTRACT_ID');
const parent = env('PARENT');
const bodies = Number(process.env.BODIES ?? 2);
const fundNear = process.env.FUND_NEAR ?? '0.4';
const file = env('RIVALS_FILE', `${process.env.HOME}/.config/longcon/rivals.json`);
const p = provider();
const parentKey = JSON.parse(readFileSync(`${process.env.HOME}/.near-credentials/testnet/${parent}.json`, 'utf8')).private_key;
const parentAcc = new Account(parent, p, KeyPairSigner.fromSecretKey(parentKey));
const yocto = (n: string) => BigInt(Math.round(Number(n) * 1e6)) * 10n ** 18n;

mkdirSync(dirname(file), { recursive: true });
const known: { id: string; persona: string; key: string }[] = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).accounts : [];
const save = () => { writeFileSync(file, JSON.stringify({ accounts: known }, null, 2)); chmodSync(file, 0o600); };

for (const persona of PERSONAS) {
  for (let n = 1; n <= bodies; n++) {
    const id = `${persona.slug}${n}.${parent}`;
    if (known.some((k) => k.id === id)) continue;
    const kp = KeyPair.fromRandom('ed25519');
    await parentAcc.createAccount({ newAccountId: id, publicKey: kp.getPublicKey(), nearToTransfer: yocto(fundNear) });
    known.push({ id, persona: persona.slug, key: kp.toString() });
    save();
    const acc = new Account(id, p, KeyPairSigner.fromSecretKey(kp.toString() as any));
    await acc.signAndSendTransaction({ receiverId: contractId, actions: [A.functionCall('join', {}, 100_000_000_000_000n, 200_000_000_000_000_000_000_000n)], waitUntil: 'FINAL' } as any);
    console.log(JSON.stringify({ ev: 'rival_ready', id, persona: persona.slug }));
  }
}
