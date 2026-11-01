import { createHash } from 'node:crypto';
import { getCollateralAndVerify } from '@phala/dcap-qvl';
import { attestedSigners } from './lib.ts';

/** What the Intel TDX quote verifier hands back; the fields are the ones NEAR AI Cloud's verification reference reads. */
export interface VerifiedQuote {
  status: string;
  advisory_ids: string[];
  report: { type: string; data: { tdAttributes: Uint8Array; reportData: Uint8Array; mrConfigId: Uint8Array; rtMr3: Uint8Array } };
}
export type QuoteVerifier = (quote: Buffer) => Promise<VerifiedQuote>;

const hexBytes = (v: string) => Buffer.from(v.replace(/^0x/i, ''), 'hex');
const parse = (v: any) => (typeof v === 'string' ? JSON.parse(v) : v);
const hash = (alg: string, ...parts: (Buffer | string)[]) => {
  const h = createHash(alg);
  for (const p of parts) h.update(p);
  return h.digest();
};

export const intelVerifier: QuoteVerifier = (quote) => getCollateralAndVerify(quote) as unknown as Promise<VerifiedQuote>;

export function replayRtmr3(eventLog: unknown): Buffer {
  let rtmr3: Buffer = Buffer.alloc(48);
  for (const ev of parse(eventLog)) {
    if (ev.imr !== 3) continue;
    const type = Buffer.alloc(4);
    type.writeUInt32LE(ev.event_type);
    const digest = hash('sha384', type, ':', Buffer.from(ev.event, 'utf8'), ':', hexBytes(ev.event_payload ?? ''));
    if (ev.digest && !hexBytes(ev.digest).equals(digest)) throw new Error(`digest mismatch for event ${ev.event}`);
    rtmr3 = hash('sha384', rtmr3, digest);
  }
  return rtmr3;
}

/**
 * The checks NEAR AI Cloud's "Quote, Nonce, and Signer Bindings" reference prescribes for one NEAR report:
 * the Intel quote verifies and its TCB status is accepted, TDX debug is off, the quote's report data is
 * the signing identity followed by the nonce this client generated, the measured configuration matches
 * app_compose, and the RTMR3 event log replays to the quote's RTMR3. Returns the TCB status.
 */
export async function checkNearReport(report: any, nonceHex: string, accepted: string[], verify: QuoteVerifier = intelVerifier): Promise<string> {
  const v = await verify(hexBytes(report.intel_quote));
  if (!accepted.includes(v.status)) throw new Error(`TCB status ${v.status} not accepted: ${v.advisory_ids}`);
  if (v.report.type !== 'td10') throw new Error('expected a TDX quote');
  const quote = v.report.data;
  if (quote.tdAttributes[0] & 1) throw new Error('TDX debug mode is enabled');
  const identity = hexBytes(report.signing_address);
  if (({ ecdsa: 20, ed25519: 32 } as Record<string, number>)[report.signing_algo] !== identity.length) throw new Error('unsupported signing identity');
  const fingerprint: string | undefined = report.tls_cert_fingerprint;
  const bound = fingerprint ? hash('sha256', identity, hexBytes(fingerprint)) : Buffer.concat([identity, Buffer.alloc(32 - identity.length)]);
  if (!Buffer.from(quote.reportData).equals(Buffer.concat([bound, hexBytes(nonceHex)]))) throw new Error('report data does not bind the signer and nonce');
  if (String(report.request_nonce).toLowerCase() !== nonceHex.toLowerCase()) throw new Error('echoed nonce does not match');
  const appCompose = parse(report.info.tcb_info).app_compose;
  const expected = Buffer.concat([Buffer.from([1]), hash('sha256', Buffer.from(appCompose, 'utf8')), Buffer.alloc(15)]);
  if (!Buffer.from(quote.mrConfigId).equals(expected)) throw new Error('MRCONFIGID does not match app_compose');
  if (!replayRtmr3(report.event_log).equals(Buffer.from(quote.rtMr3))) throw new Error('event log does not match RTMR3');
  return v.status;
}

/** Verify the gateway report and every model candidate, then read the signing keys the contract will trust. */
export async function verifiedSigners(rep: any, nonceHex: string, accepted: string[], verify: QuoteVerifier = intelVerifier) {
  const candidates: any[] = rep?.model_attestations ?? [];
  if (candidates.length === 0) throw new Error('attestation report has no model evidence');
  for (const c of candidates) await checkNearReport(c, nonceHex, accepted, verify);
  if (rep.gateway_attestation) await checkNearReport(rep.gateway_attestation, nonceHex, accepted, verify);
  return attestedSigners(rep);
}
