import { account, env } from './chain.ts';
import { attestedSigners, publicKeyHex } from './lib.ts';

/**
 * Tell the contract which ed25519 key to trust for the configured model.
 *  - SIGN_MODE=near-ai: read the signing keys out of the NEAR AI Cloud attestation report
 *    (the model TEE key for provider signatures, the gateway TEE key for gateway signatures).
 *  - SIGN_MODE=worker: register the public half of WORKER_SIGNING_SEED for the model name.
 */
const contractId = env('CONTRACT_ID');
const owner = account('OWNER_ACCOUNT_ID', 'OWNER_PRIVATE_KEY');
const model = env('LLM_MODEL');
const mode = env('SIGN_MODE', 'near-ai');
const base = env('LLM_BASE_URL', 'https://cloud-api.near.ai/v1').replace(/\/$/, '');

async function setSigner(name: string, keyHex: string) {
  if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new Error(`signer key for ${name} is not 32 bytes of hex`);
  await owner.callFunction({ contractId, methodName: 'set_signer', args: { name, key_hex: keyHex }, gas: 30_000_000_000_000n, deposit: 0n });
  console.log(JSON.stringify({ ev: 'signer_set', name, key: keyHex }));
}

if (mode === 'worker') {
  await setSigner(model, publicKeyHex(env('WORKER_SIGNING_SEED')));
} else {
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(nonce, (b) => b.toString(16).padStart(2, '0')).join('');
  const r = await fetch(`${base}/attestation/report?model=${encodeURIComponent(model)}&provider=near&signing_algo=ed25519&nonce=${hex}`, {
    headers: { accept: 'application/json', 'x-no-aliasing': 'true', authorization: `Bearer ${env('LLM_API_KEY')}` },
  });
  if (!r.ok) throw new Error(`attestation report ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const signers = attestedSigners(await r.json());
  await setSigner(model, signers.model);
  if (signers.gateway) await setSigner('gateway', signers.gateway);
}
await owner.callFunction({ contractId, methodName: 'set_model', args: { model }, gas: 30_000_000_000_000n, deposit: 0n });
console.log(JSON.stringify({ ev: 'model_set', model, contract: contractId }));
