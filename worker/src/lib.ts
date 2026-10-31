import { createHash, createPrivateKey, sign as edSign } from 'node:crypto';

export type SigKind = 'provider_tee' | 'gateway';

export const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** The exact text the signer signs, mirroring contract/src/attest.rs signed_text. */
export function signedText(kind: SigKind, model: string, reqHash: string, respHash: string): string {
  return kind === 'provider_tee' ? `${model}:${reqHash}:${respHash}` : `${reqHash}:${respHash}`;
}

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** Sign `text` with a 32 byte ed25519 seed given as hex. Used when the endpoint has no TEE signature. */
export function signWithSeed(seedHex: string, text: string): string {
  const seed = Buffer.from(seedHex.replace(/^0x/, ''), 'hex');
  if (seed.length !== 32) throw new Error('WORKER_SIGNING_SEED must be 32 bytes of hex');
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  return edSign(null, Buffer.from(text, 'utf8'), key).toString('hex');
}

export function publicKeyHex(seedHex: string): string {
  const seed = Buffer.from(seedHex.replace(/^0x/, ''), 'hex');
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const jwk = key.export({ format: 'jwk' }) as { x: string };
  return Buffer.from(jwk.x, 'base64url').toString('hex');
}

export function contentOf(body: string): string | null {
  try {
    const v = JSON.parse(body);
    const c = v?.choices?.[0]?.message?.content;
    return typeof c === 'string' ? c : null;
  } catch {
    return null;
  }
}

/** Same extraction the contract performs: the last {...} after any </think> block. */
export function termsObject(content: string): Record<string, unknown> | null {
  const tail = content.split('</think>').pop() ?? '';
  const s = tail.indexOf('{');
  const e = tail.lastIndexOf('}');
  if (s < 0 || e < s) return null;
  try {
    const o = JSON.parse(tail.slice(s, e + 1));
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

/** True when the contract would read a verdict out of this response body. */
export function readable(body: string): boolean {
  const c = contentOf(body);
  const o = c ? termsObject(c) : null;
  return !!o && (typeof o.verdict === 'string' || typeof o.accept === 'boolean');
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
