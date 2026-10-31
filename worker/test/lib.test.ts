import { expect, test } from 'bun:test';
import { verify, createPublicKey } from 'node:crypto';
import { contentOf, publicKeyHex, readable, sha256Hex, signedText, signWithSeed, termsObject, percentile } from '../src/lib.ts';

const seed = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';

test('sha256 matches the standard vector', () => {
  expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('signedText has the two shapes the contract expects', () => {
  expect(signedText('provider_tee', 'm', 'a', 'b')).toBe('m:a:b');
  expect(signedText('gateway', 'm', 'a', 'b')).toBe('a:b');
});

test('seed signatures verify under the derived public key and fail when one char changes', () => {
  const text = signedText('provider_tee', 'm', sha256Hex('req'), sha256Hex('resp'));
  const sig = Buffer.from(signWithSeed(seed, text), 'hex');
  const raw = Buffer.from(publicKeyHex(seed), 'hex');
  expect(raw.toString('hex')).toBe('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
  const pub = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
  expect(verify(null, Buffer.from(text), pub, sig)).toBe(true);
  expect(verify(null, Buffer.from(text.replace('m:', 'x:')), pub, sig)).toBe(false);
});

test('terms are read the way the contract reads them', () => {
  const body = JSON.stringify({ choices: [{ message: { content: '<think>{"verdict":"accept"}</think>ok {"verdict":"refuse","advance":0}' } }] });
  expect(termsObject(contentOf(body)!)).toEqual({ verdict: 'refuse', advance: 0 });
  expect(readable(body)).toBe(true);
  expect(readable('not json')).toBe(false);
  expect(readable(JSON.stringify({ choices: [{ message: { content: 'no object' } }] }))).toBe(false);
  expect(readable(JSON.stringify({ choices: [{ message: { content: '{"advance":3}' } }] }))).toBe(false);
});

test('percentile', () => {
  expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
  expect(percentile([], 50)).toBeNaN();
});
