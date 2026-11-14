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
    base=${LONGCON_PUBLIC_URL:-https://near-longcon.nearbuild.workers.dev}
    page=$(curl -fsSL -m 30 "$base/game.html")
    bundle_path=$(grep -oE 'src="[^"]*game-[^"]+\.js"' <<<"$page" | head -1 | cut -d'"' -f2)
    [[ -n "$bundle_path" ]] || { echo 'hosted game entry has no built client bundle' >&2; exit 1; }
    bundle=$(curl -fsS -m 30 "$base$bundle_path")
    for marker in "the road's record" 'data-metric="pitches"' 'data-metric="loans"' 'data-metric="defaults"'; do
      [[ "$bundle" == *"$marker"* ]] || { echo "hosted game bundle is missing traction UI marker: $marker" >&2; exit 1; }
    done
    actual=$(curl -fsS -m 30 "$base/api/traction?contract_id=$CONTRACT_ID")
    jq -e --argjson source "$payload" '
      .contract_id == $source.summary.contract_id and
      .pitches == $source.summary.pitches and
      .loans == $source.summary.loans and
      .defaults == $source.summary.defaults
    ' <<<"$actual" >/dev/null || { echo 'hosted page counters do not match finalized receipt history' >&2; exit 1; }
    evidence="$ROOT/docs/EVIDENCE.md"
    section_file=$(mktemp)
    {
      printf '\n## Long Con traction\n\n'
      printf 'Playable page: %s/game.html. Contract: `%s`.\n\n' "$base" "$CONTRACT_ID"
      printf 'Read time: `%s`; finalized source height: `%s`. Counters come from successful finalized contract receipts: pitches count distinct `offer_opened` events, loans count distinct `offer_settled` events with `status=committed` and positive advance, and defaults count distinct `con_landed` events. The hosted page API returned matching values.\n\n' \
        "$(jq -r .read_at_utc <<<"$payload")" "$(jq -r .summary.finalized_height <<<"$payload")"
      printf '| Event / entity | Counted item | Transaction hash | Block height |\n|---|---:|---|---:|\n'
      jq -r '["offer_opened","offer_settled","con_landed"][] as $event |
        (.events | map(select(.event == $event)) | .[0]) as $row |
        [$event, ($row.offer_id // $row.record_id | tostring), $row.transaction_hash, ($row.block_height | tostring)] | @tsv' <<<"$payload" |
        while IFS=$'\t' read -r event id hash height; do
          case "$event" in
            offer_opened) label='Pitch';;
            offer_settled) label='Committed loan';;
            con_landed) label='Default';;
          esac
          printf '| %s | %s | `%s` | %s |\n' "$label" "$id" "$hash" "$height"
        done
      printf '\nCounts at finalized height `%s`: pitches `%s`, loans `%s`, defaults `%s`.\n' \
        "$(jq -r .summary.finalized_height <<<"$payload")" \
        "$(jq -r .summary.pitches <<<"$payload")" "$(jq -r .summary.loans <<<"$payload")" "$(jq -r .summary.defaults <<<"$payload")"
    } >"$section_file"
    python3 - "$evidence" "$section_file" <<'PYDOC'
from pathlib import Path
import re
import sys

evidence, section_path = map(Path, sys.argv[1:])
text = evidence.read_text()
section = section_path.read_text().strip() + "\n\n"
match = re.search(r"(?m)^## Long Con traction\s*\n", text)
if match:
    rest = text[match.end():]
    next_heading = re.search(r"(?m)^## (?!Long Con traction)[^\n]*\n", rest)
    end = match.end() + next_heading.start() if next_heading else len(text)
    text = text[:match.start()] + section + text[end:]
else:
    text = text.rstrip() + "\n\n" + section

evidence.write_text(text)
PYDOC
    rm -f "$section_file"
    echo 'PASS: recorded traction evidence from finalized receipts; hosted counters match'
    ;;
  --page-local)
    [[ -n "${2:-}" ]] || { echo 'usage: scripts/edge-traction-check.sh --page-local <web/dist>' >&2; exit 2; }
    DIST=$(cd "$ROOT" && realpath "$2")
    [[ -f "$DIST/game.html" ]] || { echo "missing built page: $DIST/game.html" >&2; exit 1; }
    (cd "$ROOT/web" && bun test ./test/traction.test.ts)
    tmp=$(mktemp -d); server_pid=
    cleanup() { [[ -z "$server_pid" ]] || kill "$server_pid" 2>/dev/null || true; rm -rf "$tmp"; }
    trap cleanup EXIT
    events >"$tmp/expected.json"
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
    jq -e --slurpfile e "$tmp/expected.json" '$e[0] as $expected | .contract_id == $expected.summary.contract_id and .pitches == $expected.summary.pitches and .loans == $expected.summary.loans and .defaults == $expected.summary.defaults' "$tmp/actual.json" >/dev/null
    (cd "$ROOT/web" && TRACTION_PAYLOAD="$(jq -c .summary "$tmp/expected.json")" bun -e '
      import { renderTraction } from "./src/traction.ts";
      const data = JSON.parse(process.env.TRACTION_PAYLOAD!); const html = renderTraction(data);
      for (const [name, value] of [["pitches", data.pitches], ["loans", data.loans], ["defaults", data.defaults]])
        if (!html.includes(`data-metric="${name}">${value}</dd>`)) throw new Error(`rendered ${name} mismatch`);
    ')
    jq -c '.summary' "$tmp/expected.json"
    echo 'PASS: local game page serves all three values from finalized Long Con receipt events'
    ;;
  *) echo 'usage: scripts/edge-traction-check.sh --events | --evidence | --page-local <web/dist>' >&2; exit 2;;
esac
