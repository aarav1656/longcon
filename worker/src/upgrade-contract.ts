import { readFileSync } from 'node:fs';
import { Account, KeyPairSigner } from 'near-api-js';
import { createHash } from 'node:crypto';
import { env, provider } from './chain.ts';

/**
 * Deploy a built wasm over the game contract (state layout unchanged). The contract account's own key is read
 * from its near-cli credential file and never printed.  Usage: CONTRACT_ID=x.testnet bun run src/upgrade-contract.ts path/to/longcon.wasm
 */
const contractId = env('CONTRACT_ID');
const path = process.argv[2];
if (!path) throw new Error('usage: upgrade-contract.ts <wasm>');
const wasm = readFileSync(path);
const key = JSON.parse(readFileSync(`${process.env.HOME}/.near-credentials/testnet/${contractId}.json`, 'utf8')).private_key;
const acc = new Account(contractId, provider(), KeyPairSigner.fromSecretKey(key));
const r: any = await acc.deployContract(new Uint8Array(wasm));
console.log(JSON.stringify({ ev: 'deployed', contract: contractId, sha256: createHash('sha256').update(wasm).digest('hex'), tx: r?.transaction?.hash ?? r?.transaction_outcome?.id }));
