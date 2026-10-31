# Source this to load the testnet game configuration into the shell. Keys are read from the
# near-cli credential files and exported to this shell only; nothing is printed or written.
#   PREFIX     account prefix, default longcon (accounts <PREFIX>-game, -owner, -worker, -relay .testnet)
#   LLM_*      the OpenAI compatible endpoint the merchants think with
root="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
[ -f "$root/.env" ] && { set -a; . "$root/.env"; set +a; }
export NEAR_NETWORK="${NEAR_NETWORK:-testnet}"
PREFIX="${PREFIX:-longcon}"
cred() { jq -r .private_key "$HOME/.near-credentials/$NEAR_NETWORK/$1.$NEAR_NETWORK.json"; }
export CONTRACT_ID="${CONTRACT_ID:-$PREFIX-game.$NEAR_NETWORK}"
export OWNER_ACCOUNT_ID="${OWNER_ACCOUNT_ID:-$PREFIX-owner.$NEAR_NETWORK}"
export WORKER_ACCOUNT_ID="${WORKER_ACCOUNT_ID:-$PREFIX-worker.$NEAR_NETWORK}"
export RELAYER_ACCOUNT_ID="${RELAYER_ACCOUNT_ID:-$PREFIX-relay.$NEAR_NETWORK}"
export OWNER_PRIVATE_KEY="${OWNER_PRIVATE_KEY:-$(cred "$PREFIX-owner")}"
export WORKER_PRIVATE_KEY="${WORKER_PRIVATE_KEY:-$(cred "$PREFIX-worker")}"
export RELAYER_PRIVATE_KEY="${RELAYER_PRIVATE_KEY:-$(cred "$PREFIX-relay")}"
export LLM_BASE_URL="${LLM_BASE_URL:-https://cloud-api.near.ai/v1}"
export SIGN_MODE="${SIGN_MODE:-near-ai}"
