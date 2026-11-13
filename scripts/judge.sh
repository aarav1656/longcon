#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/.."
pass=0; total=3
report() { if "$@"; then printf 'PASS %s\n' "$3"; pass=$((pass+1)); else printf 'FAIL %s: %s\n' "$3" "$4"; fi; }
run_tests() { cargo test --workspace >/tmp/judge-tests.log 2>&1; }
if [ -f /Volumes/AgentData/near/build/env.sh ]; then source /Volumes/AgentData/near/build/env.sh; fi
if ! command -v cargo >/dev/null; then printf 'FAIL README fast tests: missing Rust toolchain, install with rustup\n'; fi
if run_tests; then printf 'PASS README fast tests\n'; pass=$((pass+1)); else reason=$(tail -n 1 /tmp/judge-tests.log); printf 'FAIL README fast tests: %s\n' "$reason"; fi
rpc_read() {
  command -v curl >/dev/null && command -v jq >/dev/null || return 1
  local body='{"jsonrpc":"2.0","id":"judge","method":"query","params":{"request_type":"view_account","finality":"final","account_id":"longcon4-game.testnet"}}' response url
  for url in https://near-testnet.drpc.org https://test.rpc.fastnear.com https://rpc.testnet.near.org; do
    response=$(curl -fsS --max-time 20 -H 'content-type: application/json' -d "$body" "$url" 2>/dev/null) || { sleep 2; continue; }
    if jq -e '.result.amount and .result.code_hash' >/dev/null 2>&1 <<<"$response"; then return 0; fi
    sleep 2
  done
  return 1
}
if rpc_read; then printf 'PASS live testnet contract account exists: longcon4-game.testnet\n'; pass=$((pass+1)); else printf 'FAIL live testnet contract account exists: RPC unavailable, account missing, or tools curl/jq missing\n'; fi
if curl -fsS --max-time 20 -o /dev/null 'https://near-longcon.pages.dev/'; then printf 'PASS README live page responds\n'; pass=$((pass+1)); else printf 'FAIL README live page responds: https://near-longcon.pages.dev/ unreachable\n'; fi
printf 'JUDGE: %s/%s PASS\n' "$pass" "$total"
[ "$pass" -eq "$total" ]
