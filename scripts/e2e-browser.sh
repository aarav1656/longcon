#!/usr/bin/env bash
# Browser E2E through the `deepsurge` bhn profile. Serves web/ locally, drives the
# page like a judge, and compares what the DOM shows with a direct RPC read.
# Page errors are captured by a script injected into every served HTML page.
# Needs: bhn (profile deepsurge), python3, curl, jq. Opens one tab, closes it on exit.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="${E2E_WEB:-$ROOT/web}"
B=(bhn deepsurge)
TMP="$(mktemp -d)"
PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')"
TAB=""
SRV=""
cleanup() {
  [ -n "$TAB" ] && "${B[@]}" close "$TAB" >/dev/null 2>&1 || true
  [ -n "$SRV" ] && { kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; } || true
  rm -rf "$TMP"
}
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }
for t in bhn python3 curl jq; do command -v "$t" >/dev/null || fail "missing tool: $t"; done

cat >"$TMP/serve.py" <<'PY'
import http.server, os, re, sys
INJ = (b"<script>window.__errs=[];"
       b"addEventListener('error',function(e){__errs.push('error: '+e.message)});"
       b"addEventListener('unhandledrejection',function(e){__errs.push('rejection: '+(e.reason&&e.reason.message||e.reason))})</script>")
BASE = http.server.SimpleHTTPRequestHandler
if os.environ.get("E2E_BASE_HANDLER"):  # a repo's own server module with a Handler class (e.g. an API proxy)
    sys.path.insert(0, sys.argv[2]); BASE = __import__(os.environ["E2E_BASE_HANDLER"]).Handler
class H(BASE):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-store"); super().end_headers()
    def do_GET(self):
        if self.path.startswith(os.environ.get("E2E_PASS_PREFIX", "\0")): return super().do_GET()
        p = self.translate_path(self.path.split("?")[0].split("#")[0])
        if os.path.isdir(p): p = os.path.join(p, "index.html")
        if p.endswith(".html") and os.path.isfile(p):
            b = open(p, "rb").read()
            m = re.search(rb"<head[^>]*>", b, re.I)
            i = m.end() if m else 0
            b = b[:i] + INJ + b[i:]
            self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b); return
        super().do_GET()
os.chdir(sys.argv[2])
http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
start_server() { # optional env first: E2E_BASE_HANDLER=<module in web/> E2E_PASS_PREFIX=<path prefix the handler owns>
  python3 "$TMP/serve.py" "$PORT" "$WEB" & SRV=$!
  for _ in $(seq 50); do curl -sf "http://127.0.0.1:$PORT/" >/dev/null && break; sleep 0.1; done
  curl -sf "http://127.0.0.1:$PORT/" >/dev/null || fail "local server did not start"
}

open_page() { # path-with-query; opens a fresh tab, switches to it
  "${B[@]}" open "http://127.0.0.1:$PORT/$1" >/dev/null
  TAB="$("${B[@]}" tabs | jq -r --arg p "127.0.0.1:$PORT" '[.tabs[]|select(.url|contains($p))]|last|.targetId')"
  [ -n "$TAB" ] && [ "$TAB" != null ] || fail "tab did not open"
  "${B[@]}" use "$TAB" >/dev/null
}
# other agents share the profile and may switch the attached tab, so every call re-attaches to ours first
goto_page() { "${B[@]}" use "$TAB" >/dev/null; "${B[@]}" goto "http://127.0.0.1:$PORT/$1" >/dev/null; }  # same tab, new document (fresh __errs)
ev() { "${B[@]}" use "$TAB" >/dev/null; "${B[@]}" eval "$1" | jq -r '.value'; }      # eval JS, raw value
evj() { ev "JSON.stringify($1)"; }                  # eval JS expr, JSON out
waitjs() { # JS predicate, timeout seconds
  local end=$((SECONDS + ${2:-60}))
  while [ "$SECONDS" -lt "$end" ]; do
    [ "$(ev "!!($1)" 2>/dev/null || true)" = true ] && return 0
    sleep 1
  done
  fail "timeout waiting for: $1"
}
eq() { [ "$2" = "$3" ] || fail "$1: page shows '$2', chain says '$3'"; pass "$1 = $2"; }
nonempty() { [ -n "$2" ] && [ "$2" != null ] || fail "$1 is empty"; }
assert_no_errors() {
  local e; e="$(ev "JSON.stringify(window.__errs||['__errs missing'])")"
  [ "$e" = "[]" ] || fail "uncaught page errors: $e"
  pass "zero uncaught page exceptions"
}
rpc_view() { # rpc_url contract method args-json -> JSON result on stdout
  local body i
  body="$(jq -nc --arg a "$2" --arg m "$3" --arg g "$(printf %s "$4" | base64 | tr -d '\n')" \
    '{jsonrpc:"2.0",id:1,method:"query",params:{request_type:"call_function",finality:"final",account_id:$a,method_name:$m,args_base64:$g}}')"
  for i in 1 2 3 4; do
    if curl -sf -m 20 -X POST "$1" -H 'content-type: application/json' -d "$body" \
      | python3 -c 'import sys,json;r=json.load(sys.stdin);assert "error" not in r and "error" not in r["result"],r;sys.stdout.write(bytes(r["result"]["result"]).decode())' 2>/dev/null; then return 0; fi
    sleep 2
  done
  fail "rpc view $2.$3 failed on $1"
}
rpc() { # rpc_url method params-json -> .result JSON
  local i
  for i in 1 2 3 4; do
    curl -sf -m 20 -X POST "$1" -H 'content-type: application/json' \
      -d "$(jq -nc --arg m "$2" --argjson p "$3" '{jsonrpc:"2.0",id:1,method:$m,params:$p}')" \
      | jq -ce '.result // empty' && return 0
    sleep 2
  done
  fail "rpc $2 failed on $1"
}

RPC="${E2E_RPC:-https://test.rpc.fastnear.com}"
GAME="${E2E_GAME:-longcon4-game.testnet}"        # default road in web/public/config.json
RECORDS_GAME="${E2E_RECORDS_GAME:-longcon2-game.testnet}"   # a road with landed cons on chain
jp() { ev "$1"; }

check_road() { # $1 = contract id, rest of the page already loaded
  local id="$1" st recs
  waitjs "document.getElementById('meta').innerText.includes('Read at block') && !document.querySelector('#merchants .error') && document.querySelector('#records .readat')" 90
  st="$(rpc_view "$RPC" "$id" state '{}')"
  recs="$(rpc_view "$RPC" "$id" con_records '{"from":0,"limit":50}')"
  eq "[$id] meta names the contract" "$(jp "document.getElementById('meta').innerText.match(/Contract (\\S+) on/)[1]")" "$id"
  n="$(jq '.merchants|length' <<<"$st")"
  eq "[$id] merchant cards" "$(jp "document.querySelectorAll('#merchants .merchant').length")" "$n"
  for ((i=0; i<n; i++)); do
    m="$(jq -c ".merchants[$i]" <<<"$st")"
    page="$(evj "(()=>{const c=document.querySelectorAll('#merchants .merchant')[$i];const dd=[...c.querySelectorAll('dd')].map(e=>e.innerText);return {name:c.querySelector('h3').innerText,gold:dd[0],grain:dd[1],buy:dd[2],sell:dd[3],out:dd[4],lost:dd[5]}})()")"
    eq "[$id] merchant $i name" "$(jq -r .name <<<"$page")" "$(jq -r .name <<<"$m")"
    eq "[$id] merchant $i gold" "$(jq -r .gold <<<"$page")" "$(jq -r .gold <<<"$m")"
    eq "[$id] merchant $i grain" "$(jq -r .grain <<<"$page")" "$(jq -r .grain <<<"$m")"
    eq "[$id] merchant $i buy/sell" "$(jq -r '"\(.buy)/\(.sell)"' <<<"$page")" "$(jq -r '"\(.buy_price)/\(.sell_price)"' <<<"$m")"
    eq "[$id] merchant $i outstanding/lost" "$(jq -r '"\(.out)/\(.lost)"' <<<"$page")" "$(jq -r '"\(.outstanding)/\(.lost_total)"' <<<"$m")"
  done
  # signers: every key the contract holds is on the page
  for k in $(jq -r '.signers[][1]' <<<"$st"); do
    [ "$(jp "document.getElementById('signers').innerText.includes('$k')")" = true ] || fail "[$id] signer key $k missing from page"
  done
  pass "[$id] signer keys on page match contract state"
  # records
  eq "[$id] con records" "$(jp "document.querySelectorAll('#records .record').length")" "$(jq length <<<"$recs")"
  for ((i=0; i<$(jq length <<<"$recs"); i++)); do
    r="$(jq -c ".[$i]" <<<"$recs")"
    txt="$(jp "document.querySelectorAll('#records .record')[$i].innerText.replace(/\\s+/g,' ')")"
    for f in request_hash response_hash config_hash; do
      v="$(jq -r ".$f" <<<"$r")"; case "$txt" in *"$v"*) ;; *) fail "[$id] record $i $f $v not on page: $txt";; esac
    done
    case "$txt" in *"-$(jq -r .loss <<<"$r")"*"$(jq -r .player <<<"$r")"*) ;; *) fail "[$id] record $i loss/player mismatch: $txt";; esac
  done
  pass "[$id] $(jq length <<<"$recs") con records match con_records"
  pb="$(jp "document.getElementById('meta').innerText.match(/Read at block (\\d+)/)[1]")"
  head="$(rpc "$RPC" block '{"finality":"final"}' | jq -r .header.height)"
  [ "$pb" -le "$head" ] && [ $((head - pb)) -lt 3000 ] || fail "[$id] page block $pb not near head $head (fixture?)"
  pass "[$id] page read at live block $pb (head $head)"
  assert_no_errors
}

start_server
open_page "index.html"
check_road "$GAME"
st="$(rpc_view "$RPC" "$GAME" state '{}')"
# signers panel must compare keys against the published attestation report (docs promise this)
sig="$(jp "document.getElementById('signers').innerText")"
case "$sig" in *"matches the published attestation report"*) pass "signers match the published attestation report";; *) fail "signers panel does not show attestation match: $sig";; esac
goto_page "index.html?contract=$RECORDS_GAME"
check_road "$RECORDS_GAME"
echo "PASS longcon browser e2e"
