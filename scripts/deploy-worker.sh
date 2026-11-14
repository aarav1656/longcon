#!/usr/bin/env bash
# Deploy web/ at git HEAD as the Worker near-longcon: vite build as assets, Pages Functions (/api/rpc, /api/traction, /api/relay) compiled into the Worker.
# usage: scripts/deploy-worker.sh   (wrangler logged in to the target account)
set -euo pipefail
export CLOUDFLARE_ACCOUNT_ID=5914596afc2e76b3edef2b64d8cf63b2  # wrangler can cache the old account in node_modules/.cache; pin the target
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
git -C "$repo" archive HEAD web contract/src/rules.rs | tar -x -C "$t"
rm -rf "$t/web/node_modules" && cp -Rc "$repo/web/node_modules" "$t/web/node_modules"  # APFS clone: instant, and tsc resolves types inside the tree
cd "$t/web"
bun run build && cp index.html dist/ledger.html && cp app.js style.css dist/
npx -y wrangler@latest pages functions build functions --outdir "$t/out"
cat > "$t/wrangler.toml" <<TOML
name = "near-longcon"
main = "out/index.js"
compatibility_date = "2026-11-01"

[assets]
directory = "./web/dist"
binding = "ASSETS"
run_worker_first = true

[vars]
RELAYER_URL = "$(jq -r .relayer public/config.json)"
TOML
cd "$t" && npx -y wrangler@latest deploy --config wrangler.toml
