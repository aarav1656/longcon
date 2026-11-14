#!/usr/bin/env bash
# Deploy web/ at git HEAD (/ and /game serve the walkable road, /fork serves Forked Town) as the Worker near-longcon: vite build as assets, Pages Functions (/api/rpc, /api/traction, /api/relay) and the relayer hub Durable Object (web/hub/entry.js).
# usage: scripts/deploy-worker.sh   (wrangler logged in to the target account)
set -euo pipefail
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-cbf9ca23103839b3c6696543d7a67f94}"  # wrangler can cache another account in node_modules/.cache; pin the target
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
git -C "$repo" archive HEAD web contract/src/rules.rs | tar -x -C "$t"
rm -rf "$t/web/node_modules" && cp -Rc "$repo/web/node_modules" "$t/web/node_modules"  # APFS clone: instant, and tsc resolves types inside the tree
cd "$t/web"
bun run build && cp index.html dist/ledger.html && cp dist/game.html dist/fork.html && cp dist/queue.html dist/game.html && cp dist/queue.html dist/index.html && cp app.js style.css dist/
npx -y wrangler@latest pages functions build functions --outdir "$t/out"
cp hub/entry.js "$t/entry.js"
cat > "$t/wrangler.toml" <<TOML
name = "near-longcon"
main = "entry.js"
compatibility_date = "2026-11-01"

[assets]
directory = "./web/dist"
binding = "ASSETS"
run_worker_first = ["/api/*", "/_hub/*"]

[[durable_objects.bindings]]
name = "HUB"
class_name = "Hub"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Hub"]

TOML
cd "$t" && npx -y wrangler@latest deploy --config wrangler.toml
