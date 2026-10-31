#!/usr/bin/env bash
# Register the signing key the contract trusts for LLM_MODEL (NEAR AI attestation key, or the worker seed).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
. "$root/scripts/dev-env.sh"
cd "$root/worker" && bun run register-signer
