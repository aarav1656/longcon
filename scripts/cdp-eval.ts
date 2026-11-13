// Evaluate one JS expression in one specific browser tab over CDP, so a call never lands in another agent's tab.
// usage: bun scripts/cdp-eval.ts <debug-port> <targetId> '<js expression>'  -> {"value": ...} or exit 1 with the page error
const [port, target, expression] = process.argv.slice(2);
if (!port || !target || !expression) { console.error('usage: cdp-eval.ts <port> <targetId> <expression>'); process.exit(2); }
const ws = new WebSocket(`ws://127.0.0.1:${port}/devtools/page/${target}`);
const timer = setTimeout(() => { console.error('cdp-eval: timed out'); process.exit(1); }, 60_000);
ws.onerror = () => { console.error('cdp-eval: websocket error'); process.exit(1); };
ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
ws.onmessage = (m) => {
  const r = JSON.parse(String(m.data));
  if (r.id !== 1) return;
  clearTimeout(timer);
  if (r.error || r.result?.exceptionDetails) {
    console.error(`page threw: ${r.error?.message ?? r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ value: r.result.result.value ?? null }));
  process.exit(0);
};
