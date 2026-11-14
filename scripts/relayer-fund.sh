#!/usr/bin/env bash
# Keeps longcon4-relay.testnet above 3 NEAR: below that, a fresh faucet account is created and sends 8 NEAR to it.
# Reads the balance from testnet RPC; the new account's key goes to the near-cli keychain and is never printed.
set -euo pipefail
relay=longcon4-relay.testnet
bal=$(curl -s -m 15 https://rpc.testnet.near.org -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$relay\"}}" | jq -r '.result.amount')
[ -n "$bal" ] && [ "$bal" != null ] || { echo "balance read failed"; exit 1; }
min=${RELAY_MIN:-3000000000000000000000000}
if [ "$(echo "$bal < $min" | bc)" = 1 ]; then
  id="longcon-fund-$(date +%m%d%H%M%S).testnet"
  near account create-account sponsor-by-faucet-service "$id" autogenerate-new-keypair save-to-legacy-keychain network-config testnet create >/dev/null 2>&1
  near tokens "$id" send-near "$relay" '8 NEAR' network-config testnet sign-with-legacy-keychain send >/dev/null 2>&1
  echo "$(date '+%F %T') refilled $relay from $id (was $bal yocto)"
else
  echo "ok $bal"
fi
