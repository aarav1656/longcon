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

/** Public RPCs answer a burst with 429 independently of each other, so a rate limited call moves to the next endpoint before it waits. NEAR_RPC_URL takes a comma separated list. */
const FALLBACKS: Record<string, string[]> = {
  testnet: ['https://near-testnet.drpc.org', 'https://rpc.testnet.near.org', 'https://archival-rpc.testnet.near.org'],
  mainnet: ['https://rpc.mainnet.near.org', 'https://archival-rpc.mainnet.near.org'],
};
export const rpcPool = (net = process.env.NEAR_NETWORK ?? 'testnet'): string[] => {
  const given = (process.env.NEAR_RPC_URL ?? '').split(',').map((u) => u.trim()).filter(Boolean);
  return [...new Set([...(given.length ? given : [RPC[net]]), ...(given.length ? [] : (FALLBACKS[net] ?? []))])];
};

const poolUrls = rpcPool();
const rpcHosts = new Set(poolUrls.map((u) => new URL(u).host));
const realFetch = globalThis.fetch;
/** The public RPCs answer a burst with 429, or with HTTP 200 and a JSON-RPC error code -429, and near-api-js retries neither, so a game turn would fail. Ask the next endpoint, and after a full cycle ask again after a pause. */
const rateLimited = async (r: Response): Promise<boolean> => {
  if (r.status === 429) return true;
  if (!r.ok) return false;
  const text = await r.clone().text();
  return text.length < 400 && /"code"\s*:\s*-429/.test(text);
};
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : (input.url ?? String(input));
  const host = new URL(url).host;
  if (!rpcHosts.has(host) || typeof input !== 'string') return realFetch(input, init);
  const start = Math.max(0, poolUrls.findIndex((u) => new URL(u).host === host));
  for (let attempt = 0; ; attempt++) {
    const r = await realFetch(poolUrls[(start + attempt) % poolUrls.length], init);
    if (attempt >= 120 * poolUrls.length || !(await rateLimited(r))) return r;
    if ((attempt + 1) % poolUrls.length === 0) await new Promise((res) => setTimeout(res, Math.min(800 * Math.ceil((attempt + 1) / poolUrls.length), 5000)));
  }
}) as typeof fetch;

export function provider(): JsonRpcProvider {
  const net = env('NEAR_NETWORK', 'testnet');
  return new JsonRpcProvider({ url: poolUrls[0] ?? RPC[net] });
}

export function account(idKey: string, keyKey: string): Account {
  return new Account(env(idKey), provider(), KeyPairSigner.fromSecretKey(env(keyKey) as any));
}

export const view = <T = any>(p: JsonRpcProvider, contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> =>
  p.callFunction({ contractId, method, args }) as Promise<T>;
