#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${LONGCON_E2E_PORT:-4187}"
PROFILE="longcon-keyboard-$$"
TMP="$(mktemp -d)"
SERVER_PID=''
TUNNEL_PID=''
PROFILE_CREATED=0
cleanup() {
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi
  if [ -n "$TUNNEL_PID" ]; then kill "$TUNNEL_PID" 2>/dev/null || true; wait "$TUNNEL_PID" 2>/dev/null || true; fi
  if [ "$PROFILE_CREATED" = 1 ]; then ssh -o BatchMode=yes mini "bh-multi stop '$PROFILE' >/dev/null 2>&1 || true; rm -f '/tmp/$PROFILE.bcode'"; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

mkdir -p "$TMP/dist"
tbx "cd web && bun install --frozen-lockfile >/dev/null && bun run build >/dev/null && printf '__LONGCON_DIST__' && tar -czf - -C dist . | base64 | tr -d '\n' && printf '\n'" \
  | sed -n 's/^__LONGCON_DIST__//p' | base64 -D | tar -xz -C "$TMP/dist"
node "$ROOT/scripts/fixtures/read-only-web.mjs" "$TMP/dist" "$PORT" >"$TMP/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 50); do curl -fsS "http://127.0.0.1:$PORT/config.json" >/dev/null 2>&1 && break; sleep 0.1; done
curl -fsS "http://127.0.0.1:$PORT/config.json" >/dev/null
ssh -o BatchMode=yes -N -R "$PORT:127.0.0.1:$PORT" mini >"$TMP/tunnel.log" 2>&1 &
TUNNEL_PID=$!
for _ in $(seq 1 50); do ssh -o BatchMode=yes mini "curl -fsS http://127.0.0.1:$PORT/config.json >/dev/null" && break; sleep 0.2; done
ssh -o BatchMode=yes mini "bh-multi launch '$PROFILE' >/dev/null"
PROFILE_CREATED=1
cat >"$TMP/test.bcode" <<EOF
goto_url('http://127.0.0.1:$PORT/game.html'); wait_for_load()
for _ in range(45):
    if js("document.querySelectorAll('#road button[data-act=pick]').length === 3"): break
    wait(1)
assert js("(()=>{const cards=[...document.querySelectorAll('#road article')],buttons=cards.map(c=>c.querySelector('button[data-act=pick]')),names=cards.map(c=>c.querySelector('h3').textContent.trim());if(names.length!==3||buttons.some((b,i)=>!b||b.textContent.trim()!=='Select '+names[i]||b.getAttribute('aria-pressed')!==(i===0?'true':'false')))return false;if(cards.some(c=>[...c.querySelectorAll('input,button:not([data-act=pick])')].some(x=>buttons.some(b=>b.contains(x)))))return false;window.__merchantBefore=document.querySelector('#target').textContent;buttons[1].focus();return true})()"), 'selector names, pressed state, or control boundary failed'
press_key(' '); wait(1)
assert js("(()=>{const buttons=[...document.querySelectorAll('#road button[data-act=pick]')],target=document.querySelector('#target').textContent;return buttons.map(b=>b.getAttribute('aria-pressed')).join(',')==='false,true,false'&&target!==window.__merchantBefore&&target.startsWith('Pitching '+buttons[1].textContent.trim().slice(7)+' in ')&&window.__pageErrors.length===0})()"), 'Space selection, pitch target, or page error assertion failed'
print('PASS keyboard merchant selection')
EOF
scp -q "$TMP/test.bcode" "mini:/tmp/$PROFILE.bcode"
ssh -o BatchMode=yes mini "bh-multi run '$PROFILE' \"\$(cat '/tmp/$PROFILE.bcode')\""
