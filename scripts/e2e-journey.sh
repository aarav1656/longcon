#!/usr/bin/env bash
# Judge journey J1 to J5 (E2E-SPEC 5) through the real game page on a live road.
# A fresh browser identity joins, pitches Marta, lets the debt default, waits for the news and pitches Pell.
# Every assertion is read back from chain RPC. Every transaction is polled to FINAL and its receipts checked.
# Needs the relayer and the merchant worker running for the road (scripts/play.sh) and a web build whose
# config.json names that relayer: E2E_WEB=<built dir with game.html and config.json>, default web/dist.
# Each FINAL transaction is appended to docs/EVIDENCE.md (EVIDENCE_OUT overrides the file) as it lands.
# usage: METRICS_FILE=<worker metrics file> [E2E_RELAYER=<url>] [E2E_PAGE_RPC=<url>] e2e-journey.sh [--step J1]   (--step J1 stops after the join)
source "$(dirname "$0")/e2e-lib.sh"
RPC="${E2E_RPC:-https://test.rpc.fastnear.com}"
C="${E2E_GAME:-$(jq -r .contract_id "$WEB/config.json" 2>/dev/null || jq -r .contract_id "$ROOT/web/public/config.json")}"
RELAYER_ACCOUNT="${RELAYER_ACCOUNT_ID:-${C%-game.testnet}-relay.testnet}"
WORKER_ACCOUNT="${WORKER_ACCOUNT_ID:-${C%-game.testnet}-worker.testnet}"
WEB="${E2E_WEB:-$ROOT/web/dist}"
if [ -n "${E2E_RELAYER:-}${E2E_PAGE_RPC:-}" ]; then  # the build names its relayer and RPC in config.json; point a copy at the ones this run uses
  cp -R "$WEB" "$TMP/web" && WEB="$TMP/web"
  jq --arg r "${E2E_RELAYER:-}" --arg p "${E2E_PAGE_RPC:-}" '(if $r != "" then .relayer=$r else . end) | (if $p != "" then .rpc=$p else . end)' "$WEB/config.json" >"$TMP/config.json" && mv "$TMP/config.json" "$WEB/config.json"
fi
EVIDENCE_OUT="${EVIDENCE_OUT:-$ROOT/docs/EVIDENCE.md}"
STEP=""
if [ "${1:-}" = --step ]; then STEP="${2:-}"; [ "$STEP" = J1 ] || { echo "usage: $0 [--step J1]" >&2; exit 2; }; fi
v() { rpc_view "$RPC" "$C" "$1" "${2:-\{\}}"; }

tx_final() { # step label hash signer -> polls to FINAL, asserts no failed receipt, appends an EVIDENCE row
  local step="$1" label="$2" h="$3" signer="$4" r st i
  [ -n "$h" ] && [ "$h" != null ] || fail "$label: no transaction hash"
  for i in $(seq 60); do
    r="$(rpc_call "$RPC" "$(jq -nc --arg h "$h" --arg s "$signer" '{jsonrpc:"2.0",id:1,method:"EXPERIMENTAL_tx_status",params:{tx_hash:$h,sender_account_id:$s,wait_until:"FINAL"}}')" | jq -c '.result // empty' 2>/dev/null || true)"
    st="$(jq -r '.final_execution_status // empty' <<<"$r" 2>/dev/null || true)"
    [ "$st" = FINAL ] && break
    sleep 2
  done
  [ "$st" = FINAL ] || fail "$label $h never reached FINAL (last status '$st')"
  jq -e '.status.SuccessValue != null' <<<"$r" >/dev/null || fail "$label $h top status is not SuccessValue: $(jq -c .status <<<"$r")"
  jq -e '[.receipts_outcome[].outcome.status | has("Failure")] | any | not' <<<"$r" >/dev/null || fail "$label $h has a failed receipt: $(jq -c '[.receipts_outcome[].outcome.status|select(has("Failure"))]' <<<"$r")"
  local blk; blk="$(jq -r '.transaction_outcome.block_hash' <<<"$r")"
  local height; height="$(rpc "$RPC" block "{\"block_id\":\"$blk\"}" | jq -r .header.height)"
  pass "$step $label tx $h FINAL at block $height, every receipt succeeded"
  printf '| %s | %s | `%s` | %s |\n' "$step" "$label" "$h" "$height" >>"$EVIDENCE_OUT"
}

click() { ev "document.querySelector('$1').click()" >/dev/null; }

start_server
open_page "game.html"

# J1: the browser key becomes an account, the relayer activates and joins it. The server port is random,
# so the page origin and its localStorage are new on every run: a fresh identity each time.
waitjs "/Your gold\\s*20/i.test(document.getElementById('bar').innerText)" 120
P="$(ev "document.querySelector('.who .mono').title")"
[[ "$P" =~ ^[0-9a-f]{64}$ ]] || fail "judge account is not a 64 hex implicit account: $P"
eq "J1 player.gold on chain" "$(v player "{\"account_id\":\"$P\"}" | jq -r .gold)" 20
eq "J1 merchants on chain" "$(v state | jq '.merchants|length')" 3
mkdir -p "$(dirname "$EVIDENCE_OUT")"
{ [ ! -s "$EVIDENCE_OUT" ] || printf '\n'
  printf '## Judge journey on `%s`, account `%s`\n\n| Step | Transaction | Hash | Block |\n|---|---|---|---|\n' "$C" "$P"; } >>"$EVIDENCE_OUT"
JOIN_TX="$(evj "window.__relay.filter(function(x){return x.method==='join'})[0]" | jq -r .tx)"
tx_final J1 "join (sponsor_join via relayer)" "$JOIN_TX" "$RELAYER_ACCOUNT"
if [ "$STEP" = J1 ]; then
  assert_no_errors
  echo "PASS J1 browser onboarding on $C ($P)"
  exit 0
fi

# J2: Marta, honest starter
pitch_and_wait() { # merchant index -> waits for a verdict whose request hash differs from the last one
  local m="$1" prev
  prev="$(ev "document.getElementById('verdict').dataset.requestHash||''")"
  click "[data-act=pick][data-m=\"$m\"]"
  click "[data-act=starter][data-i=\"0\"]"
  waitjs "!document.getElementById('send').disabled" 30
  click "#send"
  waitjs "(document.getElementById('verdict').dataset.requestHash||'') !== '$prev' && !document.getElementById('clock')" 240
}
T0=$SECONDS
pitch_and_wait 0
pass "J2 verdict rendered $((SECONDS - T0))s after Pitch"
O="$(v offers_of "{\"account_id\":\"$P\",\"limit\":1}" | jq -c '.[0]')"
STATUS="$(jq -r .status <<<"$O")"
SIGNER="$(jq -r .outcome.signer <<<"$O")"
[ "$STATUS" = committed ] || fail "A2 status is '$STATUS', not committed (a refused pitch shows no con; rerun)"
case "$SIGNER" in worker:*) fail "A2 signer is a worker key: $SIGNER";; "$(v state | jq -r .model)"|gateway) ;; *) fail "A2 unexpected signer $SIGNER";; esac
pass "A2 offer committed, signer $SIGNER"
VERDICT="$(ev "document.getElementById('verdict').innerText.replace(/\\s+/g,' ')")"
case "$VERDICT" in *"Signature checked in your browser"*"sha256 matches"*) pass "A2 DOM: signature and request hash checked in the browser";; *) fail "A2 verdict text: $VERDICT";; esac
OFFER_ID="$(jq -r .id <<<"$O")"; BATCH="$(jq -r .batch <<<"$O")"; RH="$(jq -r .request_hash <<<"$O")"
OFFER_TX="$(ev "(document.querySelector('#verdict a[href*=\"/txns/\"],#verdict a[href*=\"/tx/\"]')||{}).href||''" | grep -oE '[1-9A-HJ-NP-Za-km-z]{43,44}' | tail -1)"
tx_final J2 "offer $OFFER_ID (delegate via relayer)" "$OFFER_TX" "$RELAYER_ACCOUNT"
RESUME_TX="$(grep "\"ev\":\"resumed\"" "${METRICS_FILE:?set METRICS_FILE to the metrics file the merchant worker writes}" | jq -r --argjson b "$BATCH" 'select(.batch==$b)|.tx' | tail -1)"
tx_final J2 "npc_resume_batch $BATCH (signature verified on chain)" "$RESUME_TX" "$WORKER_ACCOUNT"
DEBT="$(v player "{\"account_id\":\"$P\"}" | jq -c '[.debts[]|select(.status=="open")][0]')"
[ -n "$DEBT" ] && [ "$DEBT" != null ] || fail "no open debt after a committed offer"
DUE="$(jq -r .due_day <<<"$DEBT")"; MADE="$(jq -r .made_day <<<"$DEBT")"
pass "debt $(jq -r .id <<<"$DEBT") made day $MADE, due day $DUE"

# J3: End day until the due day has passed and the debt defaulted
record_days() { # step -> FINAL-checks the advance_day transactions the page sent since the last call
  local h; for h in $(evj "window.__relay.filter(function(x){return x.method==='advance_day'})" | jq -r '.[].tx' | tail -n +$((DAYS_DONE + 1))); do
    DAYS_DONE=$((DAYS_DONE + 1)); tx_final "$1" "advance_day #$DAYS_DONE by the judge" "$h" "$RELAYER_ACCOUNT"
  done
}
DAYS_DONE=0
end_day_to() { # target day
  local target="$1" day
  while day="$(v state | jq -r .day)"; [ "$day" -lt "$target" ]; do
    waitjs "!document.querySelector('[data-act=endday]').disabled" 90
    click "[data-act=endday]"
    waitjs "document.getElementById('bar').innerText.replace(/\\s+/g,' ').includes('Road day $((day + 1))') || ${day} < 0" 90
  done
}
end_day_to $((DUE + 1))
record_days J3
N="$(v state | jq .records)"
eq "A3 con records by the judge" "$(v con_records "{\"from\":$((N>50?N-50:0)),\"limit\":50}" | jq "[.[]|select(.player==\"$P\")]|length")" 1
REC="$(v con_records "{\"from\":$((N>50?N-50:0)),\"limit\":50}" | jq -c "[.[]|select(.player==\"$P\")][0]")"
CLASS="$(jq -r .class <<<"$REC")"
eq "A3 rumour token balance" "$(v mt_balance_of "{\"account_id\":\"$P\",\"token_id\":\"rumour:$CLASS\"}" | jq -r .)" 1
eq "A3 audit gold_ok and debt_ok" "$(v audit | jq '.gold_ok and .debt_ok')" true
pass "A3 con record $(jq -r .id <<<"$REC"): $CLASS at town $(jq -r .town <<<"$REC"), loss $(jq -r .loss <<<"$REC")"

# J4: one more day and the news reaches Pellgate
[ "$(v state | jq -r .day)" -le $((DUE + 1)) ] && eq "A4 news at Pellgate before the news day" "$(v news_at '{"merchant":1}' | jq "[.[]|select(.player==\"$P\")]|length")" 0
end_day_to $((DUE + 2))
record_days J4
eq "A4 news at Pellgate after the news day" "$(v news_at '{"merchant":1}' | jq "[.[]|select(.player==\"$P\")]|length")" 1

# J5: Pell hears the news
pitch_and_wait 1
O2="$(v offers_of "{\"account_id\":\"$P\",\"limit\":1}" | jq -c '.[0]')"
[ "$(jq -r .merchant <<<"$O2")" = 1 ] || fail "A5 newest offer is not Pell's: $O2"
eq "A5 verdict data-request-hash" "$(ev "document.getElementById('verdict').dataset.requestHash")" "$(jq -r .request_hash <<<"$O2")"
NEWS="$(ev "[...document.querySelectorAll('#verdict li')].map(function(l){return l.innerText}).join(' | ')")"
case "$NEWS" in *"at Millford"*) pass "A5 news in Pell's request: $NEWS";; *) fail "A5 Pell's request lists no Millford news: '$NEWS'";; esac
B2="$(jq -r .batch <<<"$O2")"
RESUME2="$(grep "\"ev\":\"resumed\"" "${METRICS_FILE:?set METRICS_FILE to the metrics file the merchant worker writes}" | jq -r --argjson b "$B2" 'select(.batch==$b)|.tx' | tail -1)"
tx_final J5 "npc_resume_batch $B2 (Pell, carries the news)" "$RESUME2" "$WORKER_ACCOUNT"
assert_no_errors

echo "PASS longcon judge journey on $C"
