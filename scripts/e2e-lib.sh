#!/usr/bin/env bash
# Shared helpers for the browser E2E scripts: static server with page-error capture, bhn tab control, RPC reads.
# Source it, then call start_server and open_page. Needs bhn (profile deepsurge), python3, curl, jq.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="${E2E_WEB:-$ROOT/web}"
BHN_COMMAND="${E2E_BHN_COMMAND:-bhn}"
B=("$BHN_COMMAND" "${E2E_BHN_PROFILE:-deepsurge}")
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
command -v "$BHN_COMMAND" >/dev/null || fail "missing browser tool: $BHN_COMMAND"
for t in python3 curl jq; do command -v "$t" >/dev/null || fail "missing tool: $t"; done

cat >"$TMP/serve.py" <<'PY'
import http.server, os, re, sys
INJ = (b"<script>window.__errs=[];"
       b"addEventListener('error',function(e){if(!/^[a-z-]+-extension:/.test(e.filename||''))__errs.push('error: '+e.message)});"
       b"addEventListener('unhandledrejection',function(e){__errs.push('rejection: '+(e.reason&&e.reason.message||e.reason))});"
       b"window.__relay=JSON.parse(sessionStorage.getItem('__longconE2ERelay')||'[]');var _f=fetch;fetch=function(u,o){var p=_f.apply(this,arguments);if(/\\/(relay|activate)$/.test(String(u)))p.then(function(r){return r.clone().json()}).then(function(j){var x={};if(typeof j.method==='string')x.method=j.method;if(typeof j.tx==='string')x.tx=j.tx;if(typeof j.created==='boolean')x.created=j.created;if(x.tx||typeof x.created==='boolean'){__relay.push(x);sessionStorage.setItem('__longconE2ERelay',JSON.stringify(__relay))}},function(){});return p}</script>")
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
# The public RPCs answer a burst with 429 independently of each other: try the given endpoint, then the others.
RPC_FALLBACKS="${E2E_RPC_FALLBACKS:-https://rpc.testnet.near.org https://near-testnet.drpc.org}"
rpc_call() { # rpc_url body -> first response that is not rate limited
  local u r
  for u in "$1" $RPC_FALLBACKS; do
    r="$(curl -s -m 20 -X POST "$u" -H 'content-type: application/json' -d "$2")" || continue
    case "$r" in ''|*'"code":-429'*|*'"code": -429'*) continue;; esac
    printf %s "$r"; return 0
  done
  return 1
}
rpc_view() { # rpc_url contract method args-json -> JSON result on stdout
  local body i
  body="$(jq -nc --arg a "$2" --arg m "$3" --arg g "$(printf %s "$4" | base64 | tr -d '\n')" \
    '{jsonrpc:"2.0",id:1,method:"query",params:{request_type:"call_function",finality:"final",account_id:$a,method_name:$m,args_base64:$g}}')"
  for i in 1 2 3 4; do
    if rpc_call "$1" "$body" \
      | python3 -c 'import sys,json;r=json.load(sys.stdin);assert "error" not in r and "error" not in r["result"],r;sys.stdout.write(bytes(r["result"]["result"]).decode())' 2>/dev/null; then return 0; fi
    sleep 2
  done
  fail "rpc view $2.$3 failed on $1"
}
rpc() { # rpc_url method params-json -> .result JSON
  local i
  for i in 1 2 3 4; do
    rpc_call "$1" "$(jq -nc --arg m "$2" --argjson p "$3" '{jsonrpc:"2.0",id:1,method:$m,params:$p}')" \
      | jq -ce '.result // empty' && return 0
    sleep 2
  done
  fail "rpc $2 failed on $1"
}
