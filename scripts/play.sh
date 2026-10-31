#!/usr/bin/env bash
# One command: relayer, merchant worker and the web app. Ctrl-C stops all three.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
. "$root/scripts/dev-env.sh"
: "${LLM_MODEL:?set LLM_MODEL in .env (the model the contract was initialised with)}"
if [ "$SIGN_MODE" = near-ai ]; then : "${LLM_API_KEY:?set LLM_API_KEY in .env for NEAR AI Cloud, or use SIGN_MODE=worker with another endpoint}"; fi
: "${LLM_API_KEY:=none}"; export LLM_API_KEY
pids=()
trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT INT TERM
(cd "$root/worker" && exec bun run relayer) & pids+=($!)
(cd "$root/worker" && exec bun run worker) & pids+=($!)
(cd "$root/web" && exec bun run dev) & pids+=($!)
wait
