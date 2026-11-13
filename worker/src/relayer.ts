import { account, env, provider, view } from './chain.ts';
import { budgets, callFor, clientKey, proxiedClient, toAction, vet } from './delegate.ts';
import { sleep } from './lib.ts';
import { parseNearAmount } from 'near-api-js';
import { existsSync } from 'node:fs';
import { loadRivals, makeConductor, PERSONAS } from './rivals.ts';

const contractId = env('CONTRACT_ID');
const p = provider();
const relayer = account('RELAYER_ACCOUNT_ID', 'RELAYER_PRIVATE_KEY');
const ACTIVATION = BigInt(process.env.ACTIVATION_YOCTO ?? '3000000000000000000000'); // 0.003 NEAR covers the implicit account's state
const PORT = Number(process.env.RELAYER_PORT ?? 8787);
const ORIGIN = process.env.RELAYER_ORIGIN ?? '*';
const PER_MINUTE = Number(process.env.RELAYER_PER_MINUTE ?? 30);

const JOIN_DEPOSIT = BigInt(process.env.JOIN_DEPOSIT_YOCTO ?? '200000000000000000000000'); // 0.2 NEAR, the storage stake the contract requires on join
const activationBudget = budgets(Number(process.env.ACTIVATE_PER_CLIENT_HOUR ?? 3), Number(process.env.ACTIVATE_GLOBAL_HOUR ?? 120), 3_600_000);
const joinBudget = budgets(Number(process.env.JOIN_PER_CLIENT_DAY ?? 3), Number(process.env.RELAYER_JOINS_PER_DAY ?? 100), 86_400_000);

const roundBudget = budgets(Number(process.env.ROUND_PER_CLIENT_HOUR ?? 12), Number(process.env.ROUND_GLOBAL_HOUR ?? 240), 3_600_000);
const rivalsFile = process.env.RIVALS_FILE ?? `${process.env.HOME}/.config/longcon/rivals.json`;
const rivals = existsSync(rivalsFile) ? loadRivals(rivalsFile, p) : new Map();
const openRound = makeConductor(contractId, p, rivals, (id) => PERSONAS.find((x) => id.startsWith(`${x.slug}`))?.slug ?? '');
const opening = new Set<number>();

const hits = new Map<string, number[]>();
function limited(who: string): boolean {
  const now = Date.now();
  const recent = (hits.get(who) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(who, recent);
  return recent.length > PER_MINUTE;
}

const cors = {
  'access-control-allow-origin': ORIGIN,
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...cors } });

async function exists(id: string): Promise<boolean> {
  try {
    await p.viewAccount({ accountId: id });
    return true;
  } catch {
    return false;
  }
}

/** First outcome of the transaction: a failure in the call itself shows within a few seconds, a yielded offer stays open. */
async function early(txHash: string, sender: string): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < 14; i++) {
    await sleep(500);
    let r: any;
    try {
      r = await p.viewTransactionStatus({ txHash, accountId: sender, waitUntil: 'INCLUDED' } as any);
    } catch {
      continue;
    }
    const outs: any[] = r.receiptsOutcome ?? r.receipts_outcome ?? [];
    for (const o of outs) {
      const st = o.outcome?.status;
      if (st?.Failure) return { ok: false, error: JSON.stringify(st.Failure).slice(0, 400) };
    }
    const top = r.status;
    if (top?.Failure) return { ok: false, error: JSON.stringify(top.Failure).slice(0, 400) };
    if (top?.SuccessValue !== undefined) return { ok: true };
    const call = outs.find((o) => o.outcome?.status && (o.outcome.status.SuccessReceiptId || o.outcome.status.SuccessValue !== undefined));
    if (outs.length >= 3 && call) return { ok: true };
  }
  return { ok: true };
}

Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const who = proxiedClient(process.env.PROXY_SECRET ?? '', req.headers.get('x-relay-proxy'), req.headers.get('x-client-ip'),
      clientKey(req.headers.get('x-forwarded-for'), server.requestIP(req)?.address ?? null, process.env.TRUST_PROXY === '1'));
    try {
      if (url.pathname === '/health') return json({ ok: true, contract: contractId, relayer: relayer.accountId });
      if (limited(who)) return json({ error: 'slow down' }, 429);
      if (url.pathname === '/activate' && req.method === 'POST') {
        const { account_id } = (await req.json()) as { account_id: string };
        if (!/^[0-9a-f]{64}$/.test(account_id)) return json({ error: 'activate takes a 64 hex implicit account' }, 400);
        if (await exists(account_id)) return json({ ok: true, created: false });
        if (!activationBudget.take(who)) return json({ error: 'activation limit reached for now' }, 429);
        const res: any = await relayer.transfer({ receiverId: account_id, amount: ACTIVATION });
        const tx = res?.transaction?.hash ?? res?.transactionOutcome?.id ?? res?.transaction_outcome?.id;
        return json({ ok: true, created: true, tx });
      }
      if (url.pathname === '/round' && req.method === 'POST') {
        const { account_id, merchant } = (await req.json()) as { account_id: string; merchant: number };
        if (!/^[0-9a-f]{64}$/.test(account_id) || ![0, 1, 2].includes(merchant)) return json({ error: 'round takes your 64 hex account and a stall 0 to 2' }, 400);
        if (rivals.size === 0) return json({ error: 'the rival grifters are not at the road yet' }, 503);
        if (!(await view(p, contractId, 'player', { account_id }))) return json({ error: 'join the road before you open a round' }, 400);
        if (opening.has(merchant)) return json({ ok: true, merchant, opened: false, offers: [], reason: 'a round is opening at this stall' });
        if (!roundBudget.take(who)) return json({ error: 'round limit reached for now' }, 429);
        opening.add(merchant);
        try {
          const state: any = await view(p, contractId, 'state');
          return json({ ok: true, ...(await openRound(merchant, state.merchants[merchant].town_name)) });
        } finally {
          opening.delete(merchant);
        }
      }
      if (url.pathname === '/relay' && req.method === 'POST') {
        const { signed_delegate } = (await req.json()) as { signed_delegate: string };
        const checked = vet(Buffer.from(signed_delegate, 'base64'), contractId);
        const call = callFor(checked);
        if (call.kind === 'sponsor_join') {
          if (!joinBudget.take(who)) return json({ error: 'join limit reached for now' }, 429);
          const res: any = await relayer.callFunctionRaw({ contractId, methodName: 'sponsor_join', args: call.args, gas: 30_000_000_000_000n, deposit: JOIN_DEPOSIT });
          const tx = res?.transaction?.hash ?? res?.transaction_outcome?.id ?? res?.transactionOutcome?.id;
          return json({ ok: true, method: 'join', tx });
        }
        const res: any = await relayer.signAndSendTransaction({
          receiverId: checked.senderId,
          actions: [toAction(checked.signed)],
          waitUntil: 'INCLUDED',
        } as any);
        const txHash = res?.transaction?.hash ?? res?.transactionOutcome?.id ?? res?.transaction_outcome?.id;
        const e = await early(txHash, checked.senderId);
        return json({ ok: e.ok, error: e.error, method: checked.method, tx: txHash }, e.ok ? 200 : 422);
      }
      return json({ error: 'not found' }, 404);
    } catch (e: any) {
      return json({ error: String(e?.message ?? e).slice(0, 300) }, 400);
    }
  },
});
console.log(JSON.stringify({ ev: 'relayer_up', port: PORT, contract: contractId, relayer: relayer.accountId }));
void view;
void parseNearAmount;
