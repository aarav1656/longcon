#!/usr/bin/env bash
# Create the four testnet accounts (faucet funded), build the contract, deploy and initialise it.
#   PREFIX=mygame scripts/testnet-up.sh
# Then run scripts/register-signer.sh and scripts/play.sh.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
. "$root/scripts/env.sh"
PREFIX="${PREFIX:-longcon}"
DAY_MS="${DAY_LENGTH_MS:-0}"   # 0 lets any player end the day, which keeps a first game inside two minutes
MODEL="${LLM_MODEL:-Qwen/Qwen3.8-27B}"
for a in game owner worker relay; do
  id="$PREFIX-$a.testnet"
  if near account view-account-summary "$id" network-config testnet now >/dev/null 2>&1; then
    echo "exists $id"
  else
    near account create-account sponsor-by-faucet-service "$id" autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
  fi
done
(cd "$root/contract" && cargo near build non-reproducible-wasm --no-abi --out-dir "$root/target/wasm")
near contract deploy "$PREFIX-game.testnet" use-file "$root/target/wasm/longcon.wasm" \
  with-init-call new json-args "{\"owner\":\"$PREFIX-owner.testnet\",\"model\":\"$MODEL\",\"day_length_ms\":$DAY_MS,\"treasury\":100,\"grain\":50}" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
