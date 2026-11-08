#!/usr/bin/env bash
# Screenshots a URL at 390px and 1440px in the shared `deepsurge` profile (one tab, closed when done).
# usage: scripts/shoot.sh <url> <out-prefix> [ready-js-predicate]
# Output: <out-prefix>-390-fold.png, -390-full.png, -1440-fold.png, -1440-full.png
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
url="${1:?url}" out="${2:?out prefix}" ready="${3:-document.readyState==='complete'}"
for t in bhn browser-harness curl jq; do command -v "$t" >/dev/null || { echo "missing tool: $t" >&2; exit 1; }; done
bhn deepsurge status >/dev/null
port="$(bhn ls --running | awk '$1=="deepsurge"{print $2}')"
[ -n "$port" ] || { echo "deepsurge is not running" >&2; exit 1; }
ws="$(curl -sf "http://127.0.0.1:$port/json/version" | jq -r .webSocketDebuggerUrl)"
mkdir -p "$(dirname "$out")"
BU_NAME=deepsurge BU_CDP_WS="$ws" SHOOT_URL="$url" SHOOT_OUT="$out" SHOOT_READY="$ready" \
  browser-harness -c "exec(open('$ROOT/scripts/shoot.py').read(), globals())"
