import { expect, test } from 'bun:test';

const RPC = 'https://test.rpc.fastnear.com';
const limited = () => new Response('{"jsonrpc": "2.0", "error": {"code": -429, "message": "Rate limits exceeded."}, "id": "1"}', { status: 200 });
const fine = () => new Response('{"jsonrpc":"2.0","id":"1","result":{"ok":true}}', { status: 200 });

async function withFakeRpc(replies: (() => Response)[]) {
  let calls = 0;
  globalThis.fetch = (async () => replies[Math.min(calls++, replies.length - 1)]()) as typeof fetch;
  await import(`../src/chain.ts?probe=${Math.random()}`);
  const r = await fetch(RPC, { method: 'POST', body: '{}' });
  return { body: await r.text(), calls };
}

test('a JSON-RPC -429 inside an HTTP 200 is asked again until the node answers', async () => {
  const { body, calls } = await withFakeRpc([limited, limited, fine]);
  expect(calls).toBe(3);
  expect(JSON.parse(body).result.ok).toBe(true);
}, 20000);

test('a real JSON-RPC error that is not a rate limit is returned at once', async () => {
  const { body, calls } = await withFakeRpc([() => new Response('{"jsonrpc":"2.0","id":"1","error":{"code":-32000,"message":"Server error"}}', { status: 200 })]);
  expect(calls).toBe(1);
  expect(JSON.parse(body).error.code).toBe(-32000);
});

test('a host that is not a NEAR RPC is never retried', async () => {
  let calls = 0;
  globalThis.fetch = (async () => (calls++, limited())) as typeof fetch;
  await import(`../src/chain.ts?probe=${Math.random()}`);
  await fetch('http://localhost:20128/v1/chat/completions');
  expect(calls).toBe(1);
});
