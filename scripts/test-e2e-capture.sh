#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${E2E_BHN_PROFILE:-longcon-capture}"
export E2E_BHN_COMMAND="${E2E_BHN_COMMAND:-bh-multi}" E2E_BHN_PROFILE="$PROFILE"
source "$ROOT/scripts/e2e-lib.sh"
FIXTURE="$TMP/fixture"
WEB="$FIXTURE"
mkdir -p "$FIXTURE"
cat >"$FIXTURE/index.html" <<'HTML'
<!doctype html><meta charset="utf-8"><title>E2E capture fixture</title>
<script>
if (!sessionStorage.getItem('sent')) {
  sessionStorage.setItem('sent', '1');
  fetch('/relay').then(r => r.json());
  fetch('/activate').then(r => r.json());
}
</script>
HTML
cat >"$FIXTURE/relay" <<'JSON'
{"ok":true,"method":"join","tx":"relay-transaction-hash","secret":"must-not-be-journaled"}
JSON
cat >"$FIXTURE/activate" <<'JSON'
{"created":true,"tx":"activation-transaction-hash","secret":"must-not-be-journaled"}
JSON
start_server

run_browser() { "$E2E_BHN_COMMAND" run "$PROFILE" "$1"; }
run_browser "new_tab('http://127.0.0.1:$PORT/'); wait_for_load(); wait(1); print(js('JSON.stringify(window.__relay)'))" >/dev/null
RESULT="$(run_browser "goto_url('http://127.0.0.1:$PORT/'); wait_for_load(); wait(1); print(js('JSON.stringify(window.__relay)'))" | tail -1)"
python3 - "$RESULT" <<'PY'
import json, sys
from collections import Counter
actual = json.loads(sys.argv[1])
assert Counter(row.get("tx") for row in actual) == Counter({"relay-transaction-hash": 1, "activation-transaction-hash": 1}), actual
assert {tuple(sorted(row.items())) for row in actual} == {
    (("method", "join"), ("tx", "relay-transaction-hash")),
    (("created", True), ("tx", "activation-transaction-hash")),
}, actual
print("PASS: relay and activation metadata survive reload exactly once")
PY
