import { SCHEMA, actions as A } from 'near-api-js';
import { deserialize } from 'borsh';

export const ALLOWED = new Set(['join', 'offer', 'trade', 'repay_debt', 'advance_day']);
export const MAX_GAS = 200_000_000_000_000n;

export interface Checked {
  senderId: string;
  method: string;
  signed: any;
}

const hex = (b: number[] | Uint8Array) => Buffer.from(b).toString('hex');

/** Decode and vet a signed delegate. Throws a short reason when the relayer must not pay for it. */
export function vet(bytes: Uint8Array, contractId: string): Checked {
  let d: any;
  try {
    d = deserialize(SCHEMA.SignedDelegate as any, bytes);
  } catch {
    throw new Error('not a signed delegate');
  }
  const da = d.delegateAction;
  if (da.receiverId !== contractId) throw new Error(`receiver must be ${contractId}`);
  if (da.actions.length !== 1 || !da.actions[0].functionCall) throw new Error('exactly one function call allowed');
  const fc = da.actions[0].functionCall;
  if (!ALLOWED.has(fc.methodName)) throw new Error(`method ${fc.methodName} is not relayed`);
  if (BigInt(fc.deposit) !== 0n) throw new Error('no deposit may be attached');
  if (BigInt(fc.gas) > MAX_GAS) throw new Error('gas above the relay limit');
  const key = da.publicKey.ed25519Key?.data;
  if (!key) throw new Error('only ed25519 keys');
  if (da.senderId !== hex(key)) throw new Error('sender must be the implicit account of the signing key');
  return { senderId: da.senderId, method: fc.methodName, signed: d };
}

export const toAction = (signed: any) => A.signedDelegate(signed);

/** The contract call a vetted delegate turns into. A join cannot carry its storage deposit in a delegate, so the relayer pays it with `sponsor_join` for the account that signed. */
export function callFor(c: Checked): { kind: 'delegate' } | { kind: 'sponsor_join'; args: { account_id: string } } {
  return c.method === 'join' ? { kind: 'sponsor_join', args: { account_id: c.senderId } } : { kind: 'delegate' };
}

/** A rolling day budget for the storage deposits the relayer fronts, so the relayer's own balance bounds what joins can cost. */
export function joinBudget(max: number, windowMs = 86_400_000) {
  const times: number[] = [];
  return (now = Date.now()): boolean => {
    while (times.length && now - times[0] >= windowMs) times.shift();
    if (times.length >= max) return false;
    times.push(now);
    return true;
  };
}
