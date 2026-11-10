export interface Traction {
  contract_id: string;
  finalized_height: number;
  pitches: number;
  loans: number;
  defaults: number;
}

const INDEXER = 'https://tx.test.fastnear.com';
const RPC = 'https://rpc.testnet.fastnear.com';
export const TRACTION_CONTRACT = 'longcon4-game.testnet';

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json() as Promise<T>;
}

function successful(outcome: any): boolean {
  const status = outcome?.outcome?.status;
  return !!status && ('SuccessValue' in status || 'SuccessReceiptId' in status);
}

export function countTraction(transactions: any[], contractId: string, finalizedHeight: number): Traction {
  const pitches = new Set<string>();
  const loans = new Set<string>();
  const defaults = new Set<string>();
  for (const tx of transactions) for (const receipt of tx.receipts ?? []) {
    if (receipt.receipt?.receiver_id !== contractId || !successful(receipt.execution_outcome)) continue;
    const logs: string[] = receipt.execution_outcome.outcome.logs ?? [];
    if (!logs.some((line) => line.startsWith('EVENT_JSON:'))) continue;
    const height = Number(receipt.receipt.block_height ?? receipt.execution_outcome.block_height);
    if (!Number.isSafeInteger(height) || height <= 0) throw new Error('contract receipt is missing its execution block height');
    if (height > finalizedHeight) continue;
    for (const log of logs) {
      if (!log.startsWith('EVENT_JSON:')) continue;
      const event = JSON.parse(log.slice('EVENT_JSON:'.length));
      if (event.standard !== 'longcon' || event.version !== '1.0.0') continue;
      for (const row of Array.isArray(event.data) ? event.data : [event.data]) {
        if (event.event === 'offer_opened' && row.offer_id != null) pitches.add(String(row.offer_id));
        if (event.event === 'offer_settled' && row.offer_id != null && row.status === 'committed' && Number(row.advance) > 0) loans.add(String(row.offer_id));
        if (event.event === 'con_landed' && row.record_id != null) defaults.add(String(row.record_id));
      }
    }
  }
  return { contract_id: contractId, finalized_height: finalizedHeight, pitches: pitches.size, loans: loans.size, defaults: defaults.size };
}

export async function readTraction(contractId = TRACTION_CONTRACT): Promise<Traction> {
  const head = await post<{ result?: { header?: { height?: number } }; error?: unknown }>(RPC, {
    jsonrpc: '2.0', id: 'longcon-traction', method: 'block', params: { finality: 'final' },
  });
  const finalizedHeight = Number(head.result?.header?.height);
  if (!Number.isSafeInteger(finalizedHeight) || finalizedHeight <= 0) throw new Error('finalized block height is missing');

  const hashes = new Set<string>();
  let resumeToken: string | undefined;
  do {
    const page = await post<{ account_txs?: { transaction_hash: string }[]; resume_token?: string | null }>(`${INDEXER}/v0/account`, {
      account_id: contractId, is_receiver: true, limit: 200, ...(resumeToken ? { resume_token: resumeToken } : {}),
    });
    for (const row of page.account_txs ?? []) hashes.add(row.transaction_hash);
    const next = page.resume_token || undefined;
    if (next && next === resumeToken) throw new Error('event history pagination stopped advancing');
    resumeToken = next;
  } while (resumeToken);

  const transactions: any[] = [];
  const allHashes = [...hashes];
  for (let i = 0; i < allHashes.length; i += 20) {
    const result = await post<{ transactions?: any[] }>(`${INDEXER}/v0/transactions`, { tx_hashes: allHashes.slice(i, i + 20) });
    if (!Array.isArray(result.transactions)) throw new Error('transaction history response is missing transactions');
    transactions.push(...result.transactions);
  }
  return countTraction(transactions, contractId, finalizedHeight);
}

export async function loadTraction(): Promise<Traction> {
  const response = await fetch(`/api/traction?contract_id=${encodeURIComponent(TRACTION_CONTRACT)}`, {
    cache: 'no-store', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`activity endpoint returned ${response.status}`);
  return response.json() as Promise<Traction>;
}

export function renderTraction(data: Traction): string {
  return `<dl class="traction-grid">
    <div><dt>Live pitches</dt><dd data-metric="pitches">${data.pitches}</dd></div>
    <div><dt>Loans issued</dt><dd data-metric="loans">${data.loans}</dd></div>
    <div><dt>Defaults</dt><dd data-metric="defaults">${data.defaults}</dd></div>
  </dl>`;
}
