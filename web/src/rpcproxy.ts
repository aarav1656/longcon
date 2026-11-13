/** Upstream testnet RPC endpoints tried in order by the same-origin /api/rpc function. */
export const RPC_POOL = ['https://near-testnet.drpc.org', 'https://rpc.testnet.near.org', 'https://archival-rpc.testnet.fastnear.com'];

/** True when an upstream answer means "ask another node": HTTP 429/5xx, or a JSON-RPC rate-limit error carried in a 200. */
export function shouldFailOver(status: number, body: string): boolean {
  if (status === 429 || status >= 500) return true;
  if (status !== 200) return false;
  return /"code"\s*:\s*-?(429|32011|15)\b|rate limit/i.test(body.slice(0, 600)) && !/"result"/.test(body.slice(0, 600));
}

/** Posts one JSON-RPC body to each upstream in turn and returns the first answer that is not a rate limit. */
export async function forward(body: string, pool: string[], doFetch: typeof fetch = fetch): Promise<{ status: number; body: string } | null> {
  for (const url of pool) {
    try {
      const res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      const text = await res.text();
      if (!shouldFailOver(res.status, text)) return { status: res.status, body: text };
    } catch { /* next upstream */ }
  }
  return null;
}
