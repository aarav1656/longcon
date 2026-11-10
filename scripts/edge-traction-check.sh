#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CONTRACT_ID=longcon4-game.testnet
if [[ "${1:-}" != "--page-local" || -z "${2:-}" ]]; then
  echo 'usage: scripts/edge-traction-check.sh --page-local <web/dist>' >&2
  exit 2
fi
DIST=$(cd "$ROOT" && realpath "$2")
[[ -f "$DIST/game.html" ]] || { echo "missing built page: $DIST/game.html" >&2; exit 1; }

(cd "$ROOT/web" && bun test ./test/traction.test.ts)
data() { (cd "$ROOT/web" && bun scripts/traction-data.ts "$CONTRACT_ID"); }
expected=$(data)
tmp=$(mktemp -d)
server_pid=
cleanup() {
  [[ -z "$server_pid" ]] || kill "$server_pid" 2>/dev/null || true
  rm -rf "$tmp"
}
trap cleanup EXIT
(cd "$ROOT"; exec bun web/scripts/local-page-server.ts "$DIST" "$CONTRACT_ID") >"$tmp/server.log" 2>&1 &
server_pid=$!
for _ in {1..30}; do
  port=$(sed -nE 's/^READY ([0-9]+)$/\1/p' "$tmp/server.log" | tail -1)
  [[ -n "$port" ]] && break
  kill -0 "$server_pid" 2>/dev/null || { cat "$tmp/server.log" >&2; exit 1; }
  sleep 1
done
[[ -n "${port:-}" ]] || { echo 'local page server did not start within 30 seconds' >&2; exit 1; }
base="http://127.0.0.1:$port"
curl -fsS "$base/game.html" -o "$tmp/game.html"
curl -fsS "$base/api/traction?contract_id=$CONTRACT_ID" -o "$tmp/actual.json"
jq -e --argjson expected "$expected" '
  .contract_id == $expected.contract_id and
  .pitches == $expected.pitches and
  .loans == $expected.loans and
  .defaults == $expected.defaults
' "$tmp/actual.json" >/dev/null || { echo 'served page data differs from the fresh finalized receipt read' >&2; exit 1; }

(cd "$ROOT/web" && TRACTION_PAYLOAD="$expected" bun -e '
  import { renderTraction } from "./src/traction.ts";
  const data = JSON.parse(process.env.TRACTION_PAYLOAD);
  const html = renderTraction(data);
  for (const [name, value] of [["pitches", data.pitches], ["loans", data.loans], ["defaults", data.defaults]]) {
    if (!html.includes(`data-metric="${name}">${value}</dd>`)) throw new Error(`rendered ${name} does not equal the fresh receipt count`);
  }
')

asset=$(sed -nE 's/.*src="([^"]+\.js)".*/\1/p' "$tmp/game.html" | head -1)
[[ -n "$asset" ]] && curl -fsS "$base$asset" -o "$tmp/game.js" && rg -q 'Live pitches|Loans issued|Defaults' "$tmp/game.js" || {
  echo 'served game bundle is missing the traction metric renderer' >&2
  exit 1
}
jq -c '{contract_id,finalized_height,pitches,loans,defaults}' <<<"$expected"
echo 'PASS: local game page serves all three values from finalized Long Con receipt events'
