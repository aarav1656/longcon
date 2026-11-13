#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/.." || exit 1
account='longcon4-game.testnet'
page='https://near-longcon.pages.dev/'
test_cmd='cargo test --workspace --no-fail-fast'
pass=0
rpc_log=$(mktemp)
trap 'rm -f "$rpc_log"' EXIT

# Cargo runs through the shared remote shim when this build environment is present.
[ -f /Volumes/AgentData/near/build/env.sh ] && source /Volumes/AgentData/near/build/env.sh

run_tests() {
  if ! command -v cargo >/dev/null 2>&1; then
    printf 'FAIL README fast tests: missing cargo; install Rust with https://rustup.rs
'
    return 1
  fi
  if eval "$test_cmd" >"$rpc_log" 2>&1; then
    printf 'PASS README fast tests
'
    pass=$((pass + 1))
    return 0
  fi
  reason=$(tail -n 1 "$rpc_log" 2>/dev/null)
  [ -n "$reason" ] || reason='test command exited non-zero'
  printf 'FAIL README fast tests: %s
' "$reason"
  case "$(cat "$rpc_log")" in
    *cargo-near*not\ found*|*cargo-near*No\ such\ file*) printf 'Install: cargo install cargo-near --locked --version 0.16.0
' ;;
    *wasm-opt*not\ found*|*wasm-opt*No\ such\ file*) printf 'Install: install Binaryen 123 and put wasm-opt on PATH
' ;;
    *bun*not\ found*|*bun*No\ such\ file*) printf 'Install: https://bun.sh/docs/installation
' ;;
  esac
  return 1
}

rpc_post() {
  local body="$1" url attempt raw status payload delay
  for url in https://near-testnet.drpc.org https://test.rpc.fastnear.com; do
    for attempt in 1 2 3; do
      raw=$(curl -sS --max-time 25 -H 'content-type: application/json' -d "$body" -w '\n%{http_code}' "$url" 2>/dev/null) || { break; }
      status=${raw##*$'\n'}
      payload=${raw%$'\n'*}
      if [ "$status" = 429 ]; then
        delay=$((2 ** attempt))
        sleep "$delay"
        continue
      fi
      if [ "$status" -ge 200 ] 2>/dev/null && [ "$status" -lt 300 ] 2>/dev/null && jq -e '.result' >/dev/null 2>&1 <<<"$payload"; then
        printf '%s' "$payload"
        return 0
      fi
      break
    done
  done
  return 1
}

run_tests
if ! command -v curl >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
  missing=''
  command -v curl >/dev/null 2>&1 || missing='curl (install curl)'
  command -v jq >/dev/null 2>&1 || missing="${missing:+$missing, }jq (install jq from https://jqlang.github.io/jq/download/)"
  printf 'FAIL live deployed contract code: missing %s
' "$missing"
  printf 'FAIL live contract access-key list: missing %s
' "$missing"
else
  account_body=$(printf '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"%s"}}' "$account")
  if account_json=$(rpc_post "$account_body") && jq -e '.result.code_hash | type == "string" and length > 20 and . != "11111111111111111111111111111111"' >/dev/null 2>&1 <<<"$account_json"; then
    printf 'PASS live deployed contract code: %s
' "$account"
    pass=$((pass + 1))
  else
    printf 'FAIL live deployed contract code: %s returned no deployed code from both testnet RPCs
' "$account"
  fi
  keys_body=$(printf '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"%s"}}' "$account")
  if [ -n "${account_json:-}" ] && jq -e '.result.code_hash | type == "string" and length > 20 and . != "11111111111111111111111111111111"' >/dev/null 2>&1 <<<"$account_json" && keys_json=$(rpc_post "$keys_body") && jq -e '.result.keys | type == "array"' >/dev/null 2>&1 <<<"$keys_json"; then
    key_count=$(jq -r '.result.keys | length' <<<"$keys_json")
    printf 'PASS live contract access-key list: %s keys at block %s
' "$key_count" "$(jq -r '.result.block_height' <<<"$keys_json")"
    pass=$((pass + 1))
  else
    printf 'FAIL live contract access-key list: RPCs could not read %s
' "$account"
  fi
fi

if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 25 -o /dev/null "$page"; then
  printf 'PASS README live page responds: %s
' "$page"
  pass=$((pass + 1))
else
  printf 'FAIL README live page responds: %s unreachable (install curl if missing)
' "$page"
fi
printf 'JUDGE: %s/4 PASS
' "$pass"
[ "$pass" -eq 4 ]
