import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { attestationRecord, checkNearReport, verifiedSigners, type VerifiedQuote } from '../src/attest-check.ts';

// Fixture: a NEAR report and the quote an Intel verifier would return for it. The layout follows
// https://docs.near.ai/cloud/verification/reference/quote-nonce-signer (report data = signer || nonce, MRCONFIGID = 01 || sha256(app_compose) || 15 zero bytes, RTMR3 replay).
// The quote signature itself is Intel's verifier's job and is replaced here by a verifier stub; these tests cover the bindings this repo adds on top.
const sha = (alg: string, ...p: (Buffer | string)[]) => { const h = createHash(alg); p.forEach((x) => h.update(x)); return h.digest(); };
const NONCE = '11'.repeat(32);
const KEY = 'ab'.repeat(32);
const APP_COMPOSE = '{"runner":"docker-compose","name":"model-instance"}';
const EVENT = { imr: 3, event_type: 134217729, event: 'compose-hash', event_payload: '0a'.repeat(32), digest: '' };
const rtmr3 = (() => { const t = Buffer.alloc(4); t.writeUInt32LE(EVENT.event_type); return sha('sha384', Buffer.alloc(48), sha('sha384', t, ':', EVENT.event, ':', Buffer.from(EVENT.event_payload, 'hex'))); })();

const report = (over: Record<string, unknown> = {}) => ({
  intel_quote: '00',
  signing_address: `0x${KEY}`,
  signing_algo: 'ed25519',
  request_nonce: NONCE,
  info: { tcb_info: JSON.stringify({ app_compose: APP_COMPOSE }) },
  event_log: JSON.stringify([EVENT, { imr: 2, event_type: 1, event: 'ignored', event_payload: '' }]),
  ...over,
});
const quote = (over: Partial<VerifiedQuote['report']['data']> = {}, status = 'UpToDate'): VerifiedQuote => ({
  status,
  advisory_ids: [],
  report: {
    type: 'td10',
    data: {
      tdAttributes: Buffer.from('0000001000000000', 'hex'),
      reportData: Buffer.concat([Buffer.from(KEY, 'hex'), Buffer.from(NONCE, 'hex')]),
      mrConfigId: Buffer.concat([Buffer.from([1]), sha('sha256', APP_COMPOSE), Buffer.alloc(15)]),
      rtMr3: rtmr3,
      ...over,
    },
  },
});
const ok = (q: VerifiedQuote) => async () => q;
const ACCEPT = ['UpToDate'];

test('a report whose quote binds the signer and our nonce, the compose hash and the event log is accepted', async () => {
  expect(await checkNearReport(report(), NONCE, ACCEPT, ok(quote()))).toBe('UpToDate');
});

test('a quote whose report data names another signer is refused', async () => {
  const other = quote({ reportData: Buffer.concat([Buffer.from('cd'.repeat(32), 'hex'), Buffer.from(NONCE, 'hex')]) });
  await expect(checkNearReport(report(), NONCE, ACCEPT, ok(other))).rejects.toThrow('does not bind the signer and nonce');
});

test('a quote bound to another nonce is refused, which stops a replayed report', async () => {
  const stale = quote({ reportData: Buffer.concat([Buffer.from(KEY, 'hex'), Buffer.from('22'.repeat(32), 'hex')]) });
  await expect(checkNearReport(report(), NONCE, ACCEPT, ok(stale))).rejects.toThrow('does not bind the signer and nonce');
});

test('a report that echoes a different nonce is refused', async () => {
  await expect(checkNearReport(report({ request_nonce: '22'.repeat(32) }), NONCE, ACCEPT, ok(quote()))).rejects.toThrow('echoed nonce');
});

test('a TDX debug quote is refused', async () => {
  await expect(checkNearReport(report(), NONCE, ACCEPT, ok(quote({ tdAttributes: Buffer.from('0100001000000000', 'hex') })))).rejects.toThrow('debug mode');
});

test('a TCB status outside the accepted list is refused', async () => {
  await expect(checkNearReport(report(), NONCE, ACCEPT, ok(quote({}, 'OutOfDate')))).rejects.toThrow('TCB status OutOfDate');
});

test('an app_compose that does not match MRCONFIGID is refused', async () => {
  const r = report({ info: { tcb_info: JSON.stringify({ app_compose: APP_COMPOSE + ' ' }) } });
  await expect(checkNearReport(r, NONCE, ACCEPT, ok(quote()))).rejects.toThrow('MRCONFIGID');
});

test('an event log that does not replay to the quote RTMR3 is refused', async () => {
  const r = report({ event_log: JSON.stringify([{ ...EVENT, event_payload: '0b'.repeat(32) }]) });
  await expect(checkNearReport(r, NONCE, ACCEPT, ok(quote()))).rejects.toThrow('RTMR3');
});

test('registration reads the key only after the gateway and every model candidate verify', async () => {
  const gateway = report({ signing_address: 'cd'.repeat(32) });
  const gq = quote({ reportData: Buffer.concat([Buffer.from('cd'.repeat(32), 'hex'), Buffer.from(NONCE, 'hex')]) });
  const verifiedFor = (q: Record<string, VerifiedQuote>) => async (b: Buffer) => q[b.toString('hex')];
  const m = report({ intel_quote: '01' });
  const g = { ...gateway, intel_quote: '02' };
  const quotes = { '01': quote(), '02': gq };
  const source = { model_attestations: [m], gateway_attestation: g };
  const s = await verifiedSigners(source, NONCE, ACCEPT, verifiedFor(quotes));
  expect(s).toEqual({ model: KEY, gateway: 'cd'.repeat(32), tcb: { model: ['UpToDate'], gateway: 'UpToDate' } });
  expect(attestationRecord({ ...source, model: 'm' }, NONCE, s, '2026-11-01T00:00:00.000Z')).toEqual({
    model: 'm', model_signing_key: KEY, gateway_signing_key: 'cd'.repeat(32), request_nonce: NONCE,
    fetched_at: '2026-11-01T00:00:00.000Z', tcb_status: { model: ['UpToDate'], gateway: 'UpToDate' }, report: source,
  });
  await expect(verifiedSigners({ model_attestations: [m], gateway_attestation: g }, NONCE, ACCEPT, verifiedFor({ ...quotes, '02': quote({}, 'Revoked') }))).rejects.toThrow('TCB status Revoked');
  await expect(verifiedSigners({ model_attestations: [] }, NONCE, ACCEPT, ok(quote()))).rejects.toThrow('no model evidence');
});
