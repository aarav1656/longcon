import { readFile } from 'node:fs/promises';
import { provider, view } from './chain.ts';
import { verifiedSigners } from './attest-check.ts';

const source = process.argv[2] ?? 'https://longcon-near.vercel.app/attestation.json';
const contractId = process.env.CONTRACT_ID ?? 'longcon3-game.testnet';
const accepted = (process.env.ATTEST_TCB_STATUSES ?? 'UpToDate').split(',').map((s) => s.trim());
const text = source.startsWith('http://') || source.startsWith('https://')
  ? await (async () => { const r = await fetch(source); if (!r.ok) throw new Error(`attestation file returned ${r.status}`); return r.text(); })()
  : await readFile(source, 'utf8');
const record = JSON.parse(text);
const signers = await verifiedSigners(record.report, record.request_nonce, accepted);
if (record.model_signing_key !== signers.model) throw new Error('published model key does not match its report');
if ((record.gateway_signing_key ?? null) !== signers.gateway) throw new Error('published gateway key does not match its report');
const state = await view<any>(provider(), contractId, 'state');
const registered = Object.fromEntries(state.signers ?? []);
if (state.model !== record.model) throw new Error(`contract model mismatch: ${state.model}`);
if (registered[record.model] !== signers.model) throw new Error(`contract model signer mismatch for ${record.model}`);
if ((registered.gateway ?? null) !== signers.gateway) throw new Error('contract gateway signer mismatch');
console.log('attestation ok');
