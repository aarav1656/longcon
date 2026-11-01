#!/usr/bin/env bash
# Create the four testnet accounts (faucet funded), build the contract, deploy and initialise it.
#   PREFIX=mygame LLM_MODEL=<model id the merchants run> scripts/testnet-up.sh
# Then run scripts/register-signer.sh and scripts/play.sh.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
. "$root/scripts/env.sh"
PREFIX="${PREFIX:-longcon}"
NETCFG="${NEAR_NETWORK_CONFIG:-testnet}"   # a near-cli connection name; testnet-fast avoids the public RPC rate limit
RPC="${NEAR_RPC_URL:-https://test.rpc.fastnear.com}"
DAY_MS="${DAY_LENGTH_MS:-0}"               # 0 lets any player end the day, which keeps a first game inside two minutes
MODEL="${LLM_MODEL:-Qwen/Qwen3.8-27B}"
exists() {
  curl -s "$RPC" -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" \
    | jq -e '.result.amount' >/dev/null 2>&1
}
for a in game owner worker relay; do
  id="$PREFIX-$a.testnet"
  if exists "$id"; then
    echo "exists $id"
  else
    near account create-account sponsor-by-faucet-service "$id" autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
  fi
done
[ -n "${SKIP_BUILD:-}" ] && test -f "$root/target/wasm/longcon.wasm" || "$root/scripts/build-wasm.sh" "$root/target/wasm"
near contract deploy "$PREFIX-game.testnet" use-file "$root/target/wasm/longcon.wasm" \
  with-init-call new json-args "{\"owner\":\"$PREFIX-owner.testnet\",\"model\":\"$MODEL\",\"day_length_ms\":$DAY_MS,\"treasury\":100,\"grain\":50}" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config "$NETCFG" sign-with-legacy-keychain send
