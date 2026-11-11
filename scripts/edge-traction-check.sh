#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CONTRACT_ID=longcon4-game.testnet
events() { (cd "$ROOT/web" && bun scripts/traction-events.ts "$CONTRACT_ID"); }

case "${1:-}" in
  --events)
    events
    ;;
  --evidence)
    payload=$(events)
    base=${LONGCON_PUBLIC_URL:-https://near-longcon.earn-shield-alerts.workers.dev}
    page=$(curl -fsS -m 30 "$base/game.html")
    actual=$(curl -fsS -m 30 "$base/api/traction?contract_id=$CONTRACT_ID")
    jq -e --argjson source "$payload" '
      .contract_id == $source.summary.contract_id and
      .pitches == $source.summary.pitches and
      .loans == $source.summary.loans and
      .defaults == $source.summary.defaults
    ' <<<"$actual" >/dev/null || { echo 'hosted page counters do not match finalized receipt history' >&2; exit 1; }
    [[ "$page" == *"the road's record"* ]] || { echo 'hosted playable page is missing the traction section' >&2; exit 1; }
    evidence="$ROOT/docs/EVIDENCE.md"
    ! rg -q '^## Long Con traction$' "$evidence" || { echo 'Long Con traction evidence already exists' >&2; exit 1; }
    {
      printf '\n## Long Con traction\n\n'
      printf 'Playable page: %s/game.html. Contract: `%s`.\n\n' "$base" "$CONTRACT_ID"
      printf 'Read time: `%s`; finalized source height: `%s`. Counters come from successful finalized contract receipts: pitches count distinct `offer_opened` events, loans count distinct `offer_settled` events with `status=committed` and positive advance, and defaults count distinct `con_landed` events. The hosted page API returned matching values.\n\n' \
        "$(jq -r .read_at_utc <<<"$payload")" "$(jq -r .summary.finalized_height <<<"$payload")"
      printf '| Event / entity | Counted item | Transaction hash | Block height |\n|---|---:|---|---:|\n'
      jq -r '.events[] | [.event, (.offer_id // .record_id | tostring), .transaction_hash, (.block_height | tostring)] | @tsv' <<<"$payload" |
        while IFS=$'\t' read -r event id hash height; do
          case "$event" in
            offer_opened) label='Pitch';;
            offer_settled) label='Committed loan';;
            con_landed) label='Default';;
          esac
          printf '| %s | %s | `%s` | %s |\n' "$label" "$id" "$event" "$hash" "$height"
        done
      printf '\nCounts at finalized height `%s`: pitches `%s`, loans `%s`, defaults `%s`.\n' \
        "$(jq -r .summary.finalized_height <<<"$payload")" \
        "$(jq -r .summary.pitches <<<"$payload")" "$(jq -r .summary.loans <<<"$payload")" "$(jq -r .summary.defaults <<<"$payload")"
    } >>"$evidence"
    ;;
  --page-local)
    [[ -n "${2:-}" ]] || { echo 'usage: scripts/edge-traction-check.sh --page-local <web/dist>' >&2; exit 2; }
    DIST=$(cd "$ROOT" && realpath "$2")
    [[ -f "$DIST/game.html" ]] || { echo "missing built page: $DIST/game.html" >&2; exit 1; }
    (cd "$ROOT/web" && bun test ./test/traction.test.ts)
    expected=$(events)
    tmp=$(mktemp -d); server_pid=
    cleanup() { [[ -z "$server_pid" ]] || kill "$server_pid" 2>/dev/null || true; rm -rf "$tmp"; }
    trap cleanup EXIT
    (cd "$ROOT"; exec bun web/scripts/local-page-server.ts "$DIST" "$CONTRACT_ID") >"$tmp/server.log" 2>&1 & server_pid=$!
    for _ in {1..30}; do
      port=$(sed -nE 's/^READY ([0-9]+)$/\1/p' "$tmp/server.log" | tail -1)
      [[ -n "${port:-}" ]] && break
      kill -0 "$server_pid" 2>/dev/null || { cat "$tmp/server.log" >&2; exit 1; }
      sleep 1
    done
    [[ -n "${port:-}" ]] || { echo 'local page server did not start within 30 seconds' >&2; exit 1; }
    base="http://127.0.0.1:$port"
    curl -fsS "$base/game.html" -o "$tmp/game.html"
    curl -fsS "$base/api/traction?contract_id=$CONTRACT_ID" -o "$tmp/actual.json"
    jq -e --argjson expected "$expected" '.contract_id == $expected.summary.contract_id and .pitches == $expected.summary.pitches and .loans == $expected.summary.loans and .defaults == $expected.summary.defaults' "$tmp/actual.json" >/dev/null
    (cd "$ROOT/web" && TRACTION_PAYLOAD="$(jq -c .summary <<<"$expected")" bun -e '
      import { renderTraction } from "./src/traction.ts";
      const data = JSON.parse(process.env.TRACTION_PAYLOAD!); const html = renderTraction(data);
      for (const [name, value] of [["pitches", data.pitches], ["loans", data.loans], ["defaults", data.defaults]])
        if (!html.includes(`data-metric="${name}">${value}</dd>`)) throw new Error(`rendered ${name} mismatch`);
    ')
    jq -c '.summary' <<<"$expected"
    echo 'PASS: local game page serves all three values from finalized Long Con receipt events'
    ;;
  *) echo 'usage: scripts/edge-traction-check.sh --events | --evidence | --page-local <web/dist>' >&2; exit 2;;
esac
