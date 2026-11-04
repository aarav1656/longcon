#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
RPC="${NEAR_RPC_URL:-https://test.rpc.fastnear.com}"
C="${CONTRACT_ID:-$(jq -r .contract_id "$root/web/public/config.json")}" 
MODEL="${EXPECT_MODEL:-Qwen/Qwen3.8-27B}"
SIGNER="${EXPECT_SIGNER:-provider_tee}"
RELAYER="${RELAYER_ACCOUNT_ID:-${C%-game.testnet}-worker.testnet}"
for bin in curl jq; do command -v "$bin" >/dev/null || { echo "missing $bin" >&2; exit 1; }; done
v() {
  local args="${2:-}" encoded
  [ -n "$args" ] || args='{}'
  encoded="$(printf '%s' "$args" | base64 | tr -d '\n')"
  curl -fsS "$RPC" -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$C\",\"method_name\":\"$1\",\"args_base64\":\"$encoded\"}}" | jq -c '.result.result | implode | fromjson'
}
fail() { echo "$1" >&2; exit 1; }
state="$(v state)" || fail "cannot read state from $C"
day="$(jq -r .day_length_ms <<<"$state")"
model="$(jq -r .model <<<"$state")"
[ "$day" = 30000 ] || fail "day_length_ms $day (expected 30000)"
echo "day_length_ms $day"
[ "$model" = "$MODEL" ] || fail "model $model (expected $MODEL)"
echo "model $model"
signers="$(jq -c '.signers | map({key: .[0], value: .[1]}) | from_entries' <<<"$state")"
if [ "$SIGNER" = worker ]; then
  jq -e --arg n "worker:$MODEL" '.[$n] | type == "string" and length == 64' <<<"$signers" >/dev/null || fail "worker signer missing for $MODEL"
else
  report="$root/web/public/attestation.json"
  [ -f "$report" ] || fail "attestation report is missing"
  jq -e --arg n "$MODEL" --slurpfile r "$report" '.[$n] == $r[0].model_signing_key and ($r[0].model == $n)' <<<"$signers" >/dev/null || fail "model signer does not match the published attestation report"
  jq -e --arg g "$(jq -r '.gateway_signing_key // empty' "$report")" '.gateway == $g or $g == ""' <<<"$signers" >/dev/null || fail "gateway signer does not match the published attestation report"
fi
echo "signer ok"
relayers="$(v relayers)" || fail "relayers view is unavailable on $C"
echo "relayers $relayers"
jq -e --arg a "$RELAYER" 'index($a) != null' <<<"$relayers" >/dev/null || fail "relayer $RELAYER is not registered"
jq -e '[.merchants[].treasury_room] | all(. >= 20)' <<<"$state" >/dev/null || fail "treasury_room below 20"
echo "treasury_room ok"
balance="$(curl -fsS "$RPC" -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$RELAYER\"}}" | jq -r '.result.amount')" || fail "cannot read relayer balance"
awk -v b="$balance" 'BEGIN { if (b < 10000000000000000000000000) exit 1 }' || fail "relayer balance below 10 NEAR"
echo "relayer_balance ok"
