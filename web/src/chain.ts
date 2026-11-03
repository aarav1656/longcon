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

/** One ed25519 key per browser. Its public key is the player's implicit NEAR account. */
export function identity(): Identity {
  let raw = localStorage.getItem(KEY_SLOT);
  if (!raw) {
    raw = KeyPair.fromRandom('ed25519').toString();
    localStorage.setItem(KEY_SLOT, raw);
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
};

export class Chain {
  readonly provider: JsonRpcProvider;
  constructor(readonly cfg: Config, readonly me: Identity) {
    this.provider = new JsonRpcProvider({ url: cfg.rpc });
  }

  view<T = any>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    const pauses = [1000, 2000, 4000, 8000];
    const read = () => this.provider.callFunction({ contractId: this.cfg.contract_id, method, args }) as Promise<T>;
    return (async () => {
      for (let attempt = 0; ; attempt++) {
        try { return await read(); }
        catch (e) {
          if (!/429/.test(String(e)) || attempt === pauses.length) throw e;
          await new Promise((resolve) => setTimeout(resolve, pauses[attempt]));
        }
      }
    })();
  }

  async accountExists(): Promise<boolean> {
    try {
      await this.provider.viewAccount({ accountId: this.me.id });
      return true;
    } catch {
      return false;
    }
  }

  /** Ask the relayer to fund the implicit account's storage, then wait until it exists. */
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
      await new Promise((res) => setTimeout(res, 800));
    }
    throw new Error('the account did not appear on chain in time');
  }

  /** Sign one function call as a NEP-366 delegate and let the relayer pay for it. */
  async send(method: string, args: Record<string, unknown>): Promise<{ tx?: string }> {
    const pk = this.me.kp.getPublicKey();
    const key = await this.provider.viewAccessKey({ accountId: this.me.id, publicKey: pk.toString() });
    const block = await this.provider.viewBlock({ finality: 'final' });
    const da = buildDelegateAction({
      senderId: this.me.id,
      receiverId: this.cfg.contract_id,
      actions: [actions.functionCall(method, args, GAS[method] ?? GAS.join, 0n)],
      nonce: BigInt(key.nonce) + 1n,
      maxBlockHeight: BigInt(block.header.height) + 150n,
      publicKey: pk,
    } as any);
    const { signedDelegate } = await new KeyPairSigner(this.me.kp).signDelegateAction(da);
    const r = await fetch(`${this.cfg.relayer}/relay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signed_delegate: b64(encodeSignedDelegate(signedDelegate)) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(explain(j.error ?? `relay ${r.status}`));
    return { tx: j.tx };
  }
}

/** Contract panics arrive wrapped in RPC JSON. Pull out the sentence the contract wrote. */
export function explain(raw: string): string {
  const m = raw.match(/Smart contract panicked: ([^"\\]+)/);
  return (m ? m[1] : raw).trim();
}
