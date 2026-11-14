import { pollPause } from './poll.ts';
import { JsonRpcProvider, KeyPair, KeyPairSigner, actions, buildDelegateAction, encodeSignedDelegate } from 'near-api-js';

export interface Config {
  contract_id: string;
  network: string;
  rpc: string;
  relayer: string;
  explorer: string;
}

export interface Identity {
  id: string;
  kp: KeyPair;
}

const KEY_SLOT = 'longcon.player-key';
const hex = (b: Uint8Array | number[]) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

export async function loadConfig(): Promise<Config> {
  const r = await fetch('/config.json', { cache: 'no-store' });
  if (!r.ok) throw new Error(`config.json ${r.status}`);
  return r.json();
}

/** One ed25519 key per tab, kept in sessionStorage: a reload keeps the account, two tabs never race over one stored key. */
export function identity(fresh = false): Identity {
  let raw: string | null = null;
  try { raw = fresh ? null : sessionStorage.getItem(KEY_SLOT); } catch { /* storage blocked: the key lives for this load only */ }
  if (!raw) {
    raw = KeyPair.fromRandom('ed25519').toString();
    try { sessionStorage.setItem(KEY_SLOT, raw); } catch { /* storage blocked */ }
  }
  const kp = KeyPair.fromString(raw as any);
  return { id: hex(kp.getPublicKey().data), kp };
}

export const GAS: Record<string, bigint> = {
  join: 100_000_000_000_000n,
  trade: 100_000_000_000_000n,
  repay_debt: 100_000_000_000_000n,
  advance_day: 200_000_000_000_000n,
  offer: 150_000_000_000_000n,
  fork_town: 100_000_000_000_000n,
  fork_rule: 60_000_000_000_000n,
  fork_seal: 100_000_000_000_000n,
  fork_expire: 100_000_000_000_000n,
  fork_settle: 100_000_000_000_000n,
};

/** A relayed call the contract rejected: the sentence it wrote and the transaction that carries it. */
export class ChainError extends Error {
  constructor(message: string, readonly tx?: string, readonly raw = "") {
    super(message);
  }
}

export class Chain {
  readonly provider: JsonRpcProvider;
  private readonly fallback: JsonRpcProvider | null;
  constructor(readonly cfg: Config, readonly me: Identity) {
    this.provider = new JsonRpcProvider({ url: new URL(cfg.rpc, typeof location === "undefined" ? "http://localhost/" : location.href).href });
    // The primary testnet endpoint can rate-limit reads or reject browser CORS requests.
    const alt = cfg.network === 'testnet' ? ['https://near-testnet.drpc.org', 'https://test.rpc.fastnear.com'].find((u) => u !== cfg.rpc) : '';
    this.fallback = alt ? new JsonRpcProvider({ url: alt }) : null;
  }

  /** The newest final block height the RPC pool reports. */
  async height(): Promise<number> {
    const b = await this.rpc((provider) => provider.viewBlock({ finality: 'final' }));
    return Number(b.header.height);
  }

  private async rpc<T>(read: (provider: JsonRpcProvider) => Promise<T>): Promise<T> {
    const pauses = [1000, 2000, 4000, 8000];
    const call = (provider: JsonRpcProvider) => {
      let timer: ReturnType<typeof setTimeout>;
      return Promise.race([
        read(provider),
        new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('RPC request timed out')), 10_000); }),
      ]).finally(() => clearTimeout(timer));
    };
    for (let attempt = 0; ; attempt++) {
      try {
        try { return await call(this.provider); }
        catch (e) {
          if (!this.fallback || !/429|rate limit|-32011|timed out|failed to fetch|networkerror|load failed/i.test(String(e))) throw e;
          return await call(this.fallback);
        }
      } catch (e) {
        // drpc answers HTTP 200 with error code 15 and "rate limit" in the message, never 429
        if (!/429|rate limit/i.test(String(e)) || attempt === pauses.length) throw e;
        await new Promise((resolve) => setTimeout(resolve, pauses[attempt]));
      }
    }
  }

  view<T = any>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.rpc((provider) => provider.callFunction({ contractId: this.cfg.contract_id, method, args }) as Promise<T>);
  }

  async head(): Promise<number> {
    const b = await this.rpc((provider) => provider.viewBlock({ finality: 'optimistic' }));
    return b.header.height;
  }

  /** Ask the relayer to have the rival grifters pitch the stall's queue. A round that is already open is left alone. */
  async openRound(merchant: number): Promise<{ opened: boolean; reason?: string }> {
    const r = await fetch(`${this.cfg.relayer}/round`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account_id: this.me.id, merchant }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `round ${r.status}`);
    return { opened: !!j.opened, reason: j.reason };
  }

  async accountExists(): Promise<boolean> {
    try {
      await this.rpc((provider) => provider.viewAccount({ accountId: this.me.id }));
      return true;
    } catch (e) {
      if (/does not exist|unknown_account|accountdoesnotexist/i.test(String(e))) return false;
      throw e;
    }
  }

  /** Ask the relayer to fund the implicit account's storage, then wait until it exists. */
  /** True when the relayer answers its health route within five seconds. */
  async relayUp(): Promise<boolean> {
    try {
      const r = await fetch(`${this.cfg.relayer}/health`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      return r.ok && (await r.json()).ok === true;
    } catch { return false; }
  }

  async activate(timeoutMs = 30_000): Promise<void> {
    if (await this.accountExists()) return;
    const r = await fetch(`${this.cfg.relayer}/activate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_id: this.me.id }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `activate ${r.status}`);
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await this.accountExists()) return;
      await pollPause();
    }
    throw new Error('the account did not appear on chain in time');
  }

  private lastNonce = 0n;
  private sending: Promise<unknown> = Promise.resolve();

  /** Sign one function call as a NEP-366 delegate and let the relayer pay for it. Calls from this tab go one at a time and a nonce another tab used first is retried with a fresh one. */
  send(method: string, args: Record<string, unknown>): Promise<{ tx?: string; value?: string }> {
    const run = this.sending.then(async () => {
      for (let attempt = 0; ; attempt++) {
        try { return await this.sendOnce(method, args); } catch (e) {
          if (attempt < 3 && /InvalidNonce/.test((e as ChainError).raw ?? "")) { await new Promise((res) => setTimeout(res, 1500)); continue; }
          throw e;
        }
      }
    });
    this.sending = run.catch(() => undefined);
    return run;
  }

  private async sendOnce(method: string, args: Record<string, unknown>): Promise<{ tx?: string; value?: string }> {
    const pk = this.me.kp.getPublicKey();
    const [key, block] = await Promise.all([
      this.rpc((provider) => provider.viewAccessKey({ accountId: this.me.id, publicKey: pk.toString() })),
      this.rpc((provider) => provider.viewBlock({ finality: 'final' })),
    ]);
    const da = buildDelegateAction({
      senderId: this.me.id,
      receiverId: this.cfg.contract_id,
      actions: [actions.functionCall(method, args, GAS[method] ?? GAS.join, 0n)],
      nonce: (BigInt(key.nonce) > this.lastNonce ? BigInt(key.nonce) : this.lastNonce) + 1n,
      maxBlockHeight: BigInt(block.header.height) + 150n,
      publicKey: pk,
    } as any);
    this.lastNonce = da.nonce;
    const { signedDelegate } = await new KeyPairSigner(this.me.kp).signDelegateAction(da);
    const r = await fetch(`${this.cfg.relayer}/relay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signed_delegate: b64(encodeSignedDelegate(signedDelegate)) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new ChainError(explain(j.error ?? `relay ${r.status}`), j.tx, String(j.error ?? ""));
    return { tx: j.tx, value: j.value };
  }
}

/** Contract panics arrive wrapped in RPC JSON. Pull out the sentence the contract wrote. */
export function explain(raw: string): string {
  const m = raw.match(/Smart contract panicked: ([^"\\]+)/);
  if (m) return m[1].trim();
  if (/InvalidNonce/.test(raw)) return "Another window of yours sent a call at the same moment. Try again in a few seconds.";
  if (/^\s*[{\[]/.test(raw)) return "The network did not accept that call. Try again.";
  return raw.trim();
}
