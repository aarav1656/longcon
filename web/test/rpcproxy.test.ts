import { describe, expect, test } from 'bun:test';
import { forward, shouldFailOver } from '../src/rpcproxy';

const reply = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch;

describe('rpc proxy failover', () => {
  test('429 and drpc rate-limit-in-200 fail over, a result does not', () => {
    expect(shouldFailOver(429, '')).toBe(true);
    expect(shouldFailOver(200, '{"error":{"code":15,"message":"rate limit"}}')).toBe(true);
    expect(shouldFailOver(200, '{"jsonrpc":"2.0","result":{"x":1}}')).toBe(false);
    expect(shouldFailOver(200, '{"error":{"code":-32000,"message":"Server error","data":"UNKNOWN_ACCOUNT"}}')).toBe(false);
  });
  test('skips a limited upstream and returns the next answer', async () => {
    const calls: string[] = [];
    const f = (async (u: string) => { calls.push(u); return u === 'a' ? new Response('', { status: 429 }) : new Response('{"result":1}', { status: 200 }); }) as unknown as typeof fetch;
    expect(await forward('{}', ['a', 'b'], f)).toEqual({ status: 200, body: '{"result":1}' });
    expect(calls).toEqual(['a', 'b']);
  });
  test('all limited gives null', async () => {
    expect(await forward('{}', ['a', 'b'], reply(429, ''))).toBeNull();
  });
});
