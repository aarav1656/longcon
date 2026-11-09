#!/usr/bin/env bash
# The road's registered signer must equal the signing_address of a freshly fetched NEAR AI Cloud attestation report.
#   CONTRACT_ID=longcon4-game.testnet scripts/signer-check.sh
# Fetches a report for a new random nonce, requires the echoed nonce, compares every model candidate's signing_address
# (and the gateway's) with the contract's `signers`, then lets the worker verify the Intel TDX quotes and bindings (--check).
# The attestation report is public. A key from NEAR_AI_API_KEY or the file NEAR_AI_ENV is sent when present and never printed.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
C="${CONTRACT_ID:-$(jq -r .contract_id "$root/web/public/config.json")}"
MODEL="${LLM_MODEL:-Qwen/Qwen3.8-27B}"
RPC="${NEAR_RPC_URL:-https://test.rpc.fastnear.com}"
BASE="${LLM_BASE_URL_ATTEST:-https://cloud-api.near.ai/v1}"
if [ -z "${NEAR_AI_API_KEY:-}" ] && [ -f "${NEAR_AI_ENV:-/Volumes/AgentData/near/web/longcon/.env}" ]; then
  NEAR_AI_API_KEY="$(sed -n 's/^NEAR_AI_API_KEY=//p' "${NEAR_AI_ENV:-/Volumes/AgentData/near/web/longcon/.env}" | head -1)"
fi
AUTH=(); [ -z "${NEAR_AI_API_KEY:-}" ] || AUTH=(-H "Authorization: Bearer $NEAR_AI_API_KEY")
nonce="$(head -c32 /dev/urandom | xxd -p -c64)"
report="$(curl -fsS -m 60 "$BASE/attestation/report?model=$MODEL&provider=near&signing_algo=ed25519&nonce=$nonce" \
  ${AUTH[@]+"${AUTH[@]}"} -H 'x-no-aliasing: true')"
state="$(curl -fsS -m 30 "$RPC" -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$C\",\"method_name\":\"state\",\"args_base64\":\"e30=\"}}" \
  | jq -c '.result.result | implode | fromjson')"
jq -ne --argjson r "$report" --argjson s "$state" --arg n "$nonce" --arg m "$MODEL" '
  ($s.signers | map({key: .[0], value: .[1]}) | from_entries) as $reg
  | ($r.model_attestations | length) > 0
    and ([$r.model_attestations[] | .request_nonce == $n and .signing_algo == "ed25519" and .signing_address == $reg[$m]] | all)
    and ($r.gateway_attestation.signing_address == $reg["gateway"])
    and $s.model == $m' >/dev/null \
  || { echo "registered signers $(jq -c '.signers' <<<"$state") differ from the fresh report's $(jq -c '[.model_attestations[].signing_address, .gateway_attestation.signing_address]' <<<"$report")" >&2; exit 1; }
echo "signer equals signing_address: contract $C model key $(jq -r --arg m "$MODEL" '.signers[] | select(.[0] == $m) | .[1]' <<<"$state") nonce $nonce"
. "$root/scripts/dev-env.sh"
cd "$root/worker" && CONTRACT_ID="$C" LLM_MODEL="$MODEL" LLM_BASE_URL="$BASE" LLM_API_KEY="${NEAR_AI_API_KEY:-none}" SIGN_MODE=near-ai bun run register-signer --check
