import { Account, JsonRpcProvider, KeyPairSigner } from 'near-api-js';

export const env = (k: string, d?: string): string => {
  const v = process.env[k] ?? d;
  if (v === undefined || v === '') throw new Error(`${k} is not set`);
  return v;
};

export const RPC: Record<string, string> = {
  testnet: 'https://test.rpc.fastnear.com',
  mainnet: 'https://free.rpc.fastnear.com',
};

const rpcHosts = new Set([...Object.values(RPC), process.env.NEAR_RPC_URL ?? ''].filter(Boolean).map((u) => new URL(u).host));
const realFetch = globalThis.fetch;
/** The public RPCs answer a burst with 429, or with HTTP 200 and a JSON-RPC error code -429, and near-api-js retries neither, so a game turn would fail. Ask again after a pause. */
const rateLimited = async (r: Response): Promise<boolean> => {
  if (r.status === 429) return true;
  if (!r.ok) return false;
  const text = await r.clone().text();
  return text.length < 400 && /"code"\s*:\s*-429/.test(text);
};
globalThis.fetch = (async (input: any, init?: any) => {
  const host = new URL(typeof input === 'string' ? input : (input.url ?? String(input))).host;
  for (let attempt = 0; ; attempt++) {
    const r = await realFetch(input, init);
    if (!rpcHosts.has(host) || attempt >= 120 || !(await rateLimited(r))) return r;
    await new Promise((res) => setTimeout(res, Math.min(800 * (attempt + 1), 5000)));
  }
}) as typeof fetch;

export function provider(): JsonRpcProvider {
  const net = env('NEAR_NETWORK', 'testnet');
  return new JsonRpcProvider({ url: process.env.NEAR_RPC_URL || RPC[net] });
}

export function account(idKey: string, keyKey: string): Account {
  return new Account(env(idKey), provider(), KeyPairSigner.fromSecretKey(env(keyKey) as any));
}

export const view = <T = any>(p: JsonRpcProvider, contractId: string, method: string, args: object = {}): Promise<T> =>
  p.callFunction({ contractId, method, args }) as Promise<T>;
