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

export function provider(): JsonRpcProvider {
  const net = env('NEAR_NETWORK', 'testnet');
  return new JsonRpcProvider({ url: process.env.NEAR_RPC_URL || RPC[net] });
}

export function account(idKey: string, keyKey: string): Account {
  return new Account(env(idKey), provider(), KeyPairSigner.fromSecretKey(env(keyKey) as any));
}

export const view = <T = any>(p: JsonRpcProvider, contractId: string, method: string, args: object = {}): Promise<T> =>
  p.callFunction({ contractId, method, args }) as Promise<T>;
