#!/usr/bin/env bash
# Shared helpers for the browser E2E scripts: static server with page-error capture, bhn tab control, RPC reads.
# Source it, then call start_server and open_page. Needs bhn (profile deepsurge), python3, curl, jq.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="${E2E_WEB:-$ROOT/web}"
BHN_COMMAND="${E2E_BHN_COMMAND:-bhn}"
B=("$BHN_COMMAND" "${E2E_BHN_PROFILE:-deepsurge}")
export BH_TAB_SESSION="${BH_TAB_SESSION:-longcon-e2e-$$}"
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
import http.server, os, re, subprocess, sys, urllib.request
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
    def do_POST(self):
        if self.path.split("?")[0] != "/api/rpc": self.send_error(404); return
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        out = None
        for u in os.environ.get("E2E_RPC_POOL", "https://near-testnet.drpc.org https://rpc.testnet.near.org https://test.rpc.fastnear.com").split():
            try:
                with urllib.request.urlopen(urllib.request.Request(u, body, {"content-type": "application/json"}), timeout=45) as r:
                    t = r.read()
            except Exception: continue
            if re.search(rb'"code"\s*:\s*-?(429|32011|15)\b', t[:600]) and b'"result"' not in t[:600]: continue
            out = t; break
        if out is None: out = b'{"jsonrpc":"2.0","id":null,"error":{"code":-32011,"message":"rate limit: every upstream node is busy"}}'
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(out)))
        self.end_headers(); self.wfile.write(out)
    def do_GET(self):
        if self.path.startswith(os.environ.get("E2E_PASS_PREFIX", "\0")): return super().do_GET()
        if self.path.startswith("/api/traction?"):
            contract = os.environ.get("E2E_GAME", "longcon4-game.testnet")
            run = subprocess.run(["bun", os.environ["E2E_TRACTION_SCRIPT"], contract], capture_output=True, text=True, timeout=60)
            body = run.stdout.encode() if run.returncode == 0 else run.stderr.encode()
            self.send_response(200 if run.returncode == 0 else 502)
            self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body)))
            self.end_headers(); self.wfile.write(body); return
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
  export E2E_TRACTION_SCRIPT="$ROOT/web/scripts/traction-data.ts"
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
# Other agents share the profile and switch its attached tab at any moment, so `bhn use` + `bhn eval` can land in
# their tab. Every eval goes straight to our tab over CDP (scripts/cdp-eval.ts) and never depends on the attached tab.
CDP_PORT=""
cdp_port() { [ -n "$CDP_PORT" ] || CDP_PORT="$("${B[@]}" status | grep -oE '\b9[0-9]{3}\b' | head -1)"; [ -n "$CDP_PORT" ] || fail "no CDP port for profile"; }
ev() { # eval JS expression in our tab, raw value
  local out i
  cdp_port
  for i in 1 2 3; do
    if out="$(bun "$ROOT/scripts/cdp-eval.ts" "$CDP_PORT" "$TAB" "$1" 2>&1)"; then jq -r '.value' <<<"$out"; return 0; fi
    case "$out" in *"page threw"*) break;; esac
    sleep 0.5
  done
  printf '%s\n' "$out" >&2; return 1
}
goto_page() { # same tab, new document (fresh __errs); returns once the new document finished loading
  ev "location.assign('http://127.0.0.1:$PORT/$1')" >/dev/null
  waitjs "location.href === 'http://127.0.0.1:$PORT/$1' && document.readyState === 'complete'" 30
}
evj() { ev "JSON.stringify($1)"; }                  # eval JS expr, JSON out
waitjs() { # JS predicate, timeout seconds
  local end=$((SECONDS + ${2:-60})) last_error='none' value
  while [ "$SECONDS" -lt "$end" ]; do
    if value="$(ev "!!($1)" 2>&1)"; then [ "$value" = true ] && return 0; else last_error="$value"; fi
    sleep 2
  done
  fail "timeout waiting for: $1; browser error: $last_error; page state: $(ev "JSON.stringify({bar:document.getElementById('bar')?.innerText,move:document.getElementById('move')?.innerText,error:document.getElementById('err')?.innerText,pitch:document.getElementById('pitch')?.value,sendDisabled:document.getElementById('send')?.disabled})" 2>/dev/null || echo unavailable)"
}
click_endday() {
  waitjs "(function(){var b=document.querySelector('[data-act=endday]');return !!b && !b.disabled})()" 90
  ev "document.querySelector('[data-act=endday]').click()" >/dev/null
}
eq() { [ -n "$2" ] && [ "$2" = "$3" ] || fail "$1: page shows '$2', chain says '$3'"; pass "$1 = $2"; }
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
    r="$(curl -fsS -m 45 -X POST "$u" -H 'content-type: application/json' -d "$2")" || continue
    case "$r" in ''|*'"code":-429'*|*'"code": -429'*|*'"code":-32011'*|*'"code": -32011'*) continue;; esac
    printf %s "$r"; return 0
  done
  return 1
}
rpc_view() { # rpc_url contract method args-json -> JSON result on stdout
  local body i
  body="$(jq -nc --arg a "$2" --arg m "$3" --arg g "$(printf %s "$4" | base64 | tr -d '\n')" \
    '{jsonrpc:"2.0",id:1,method:"query",params:{request_type:"call_function",finality:"final",account_id:$a,method_name:$m,args_base64:$g}}')"
  for i in 1 2 3 4 5 6; do
    if rpc_call "$1" "$body" \
      | python3 -c 'import sys,json;r=json.load(sys.stdin);assert "error" not in r and "error" not in r["result"],r;sys.stdout.write(bytes(r["result"]["result"]).decode())' 2>/dev/null; then return 0; fi
    sleep "$((i * 5))"
  done
  sleep 30
  if rpc_call "$1" "$body" \
    | python3 -c 'import sys,json;r=json.load(sys.stdin);assert "error" not in r and "error" not in r["result"],r;sys.stdout.write(bytes(r["result"]["result"]).decode())' 2>/dev/null; then return 0; fi
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
