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
export E2E_GAME="$C"
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

wait_day_ended() {
  local state block deadline now
  for _ in $(seq 90); do
    state="$(v state)"
    [ "$(jq -r .day_length_ms <<<"$state")" = 0 ] && return
    block="$(rpc "$RPC" block '{"finality":"final"}')"
    deadline="$(jq -r '(.day_started_ns|tonumber) + (.day_length_ms|tonumber * 1000000)' <<<"$state")"
    now="$(jq -r '.header.timestamp_nanosec|tonumber' <<<"$block")"
    [ "$now" -ge "$deadline" ] && return
    sleep 2
  done
  fail "day $(( $(jq -r .day <<<"$state") )) did not end before its on-chain deadline"
}

wait_advanced_day() {
  local target="$1" day
  for _ in $(seq 60); do
    day="$(v state | jq -r .day)"
    [ "$day" -ge "$target" ] && break
    sleep 2
  done
  [ "$day" -ge "$target" ] || fail "advance_day did not move the contract to day $target; page error: $(ev "document.getElementById('err')?.innerText||''" 2>/dev/null || echo unavailable)"
  waitjs "(function(){var m=/road day\\s*(\\d+)/i.exec(document.getElementById('bar').innerText);return !!m && Number(m[1]) >= $target})()" 60
}

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
  printf '| %s | %s | [`%s`](https://testnet.nearblocks.io/txns/%s) | %s |\n' "$step" "$label" "$h" "$h" "$height" >>"$EVIDENCE_OUT"
}

click() { waitjs "!!document.querySelector('$1') && !document.querySelector('$1').disabled" 60; ev "document.querySelector('$1').click()" >/dev/null; }

start_server
open_page "game.html"

# J1: the browser key becomes an account, the relayer activates and joins it. The server port is random,
# so the page origin and its localStorage are new on every run: a fresh identity each time.
waitjs "/Your gold\\s*20/i.test(document.getElementById('bar').innerText)" 300
waitjs "!!document.querySelector('#send') && document.querySelector('#send').getClientRects().length > 0 && document.querySelector('#send').innerText.trim() === 'Pitch'" 60
pass "fresh account has a visible Pitch action"
P="$(ev "document.querySelector('.who .mono').title")"
[[ "$P" =~ ^[0-9a-f]{64}$ ]] || fail "judge account is not a 64 hex implicit account: $P"
for _ in $(seq 60); do [ "$(v player "{\"account_id\":\"$P\"}")" != null ] && break; sleep 2; done  # chain reads are at final, a few blocks behind the page
eq "J1 player.gold on chain" "$(v player "{\"account_id\":\"$P\"}" | jq -r .gold)" 20
eq "J1 merchants on chain" "$(v state | jq '.merchants|length')" 3
mkdir -p "$(dirname "$EVIDENCE_OUT")"
{ [ ! -s "$EVIDENCE_OUT" ] || printf '\n'
  printf '## Judge journey on `%s`, account `%s`\n\n| Step | Transaction | Transaction proof | Block |\n|---|---|---|---|\n' "$C" "$P"; } >>"$EVIDENCE_OUT"
JOIN_TX="$(evj "window.__relay.filter(function(x){return x.method==='join'})[0]" | jq -r .tx)"
ACTIVATE="$(evj "window.__relay.filter(function(x){return typeof x.created==='boolean'})[0]")"
if [ "$(jq -r '.created // empty' <<<"$ACTIVATE")" = true ]; then
  tx_final J1 "activate implicit account" "$(jq -r '.tx // empty' <<<"$ACTIVATE")" "$RELAYER_ACCOUNT"
else
  jq -e '.created == false' <<<"$ACTIVATE" >/dev/null || fail "activation response missing: $ACTIVATE"
  pass "J1 implicit account already exists; no activation transaction was sent"
fi
tx_final J1 "join (sponsor_join via relayer)" "$JOIN_TX" "$RELAYER_ACCOUNT"
if [ "$STEP" = J1 ]; then
  assert_no_errors
  echo "PASS J1 browser onboarding on $C ($P)"
  exit 0
fi

# A real market round backs the next pitch's claim that Marta can see the player's trades.
trade_grain() { # side, quantity -> a finalized relayed transaction
  local side="$1" qty="$2" tx before
  before="$(evj "window.__relay.filter(function(x){return x.method==='trade'})" | jq 'length')"
  ev "document.querySelector('#qty0').value='$qty';document.querySelector('#qty0').dispatchEvent(new Event('input',{bubbles:true}));true" >/dev/null
  click "[data-act=$side][data-m=\"0\"]"
  for _ in $(seq 60); do
    tx="$(evj "window.__relay.filter(function(x){return x.method==='trade'})" | jq -r --argjson n "$before" '.[ $n ].tx // empty')"
    [ -n "$tx" ] && break
    sleep 1
  done
  tx_final PREP "Marta $side grain x$qty" "$tx" "$RELAYER_ACCOUNT"
}
trade_grain buy 3
for _ in $(seq 60); do
  PLAYER="$(v player "{\"account_id\":\"$P\"}")"
  [ "$(jq -r '.grain' <<<"$PLAYER")" = 3 ] && break
  sleep 1
done
eq "PREP grain after Marta buy" "$(jq -r .grain <<<"$PLAYER")" 3
trade_grain sell 3
for _ in $(seq 60); do
  PLAYER="$(v player "{\"account_id\":\"$P\"}")"
  [ "$(jq -r '.earned_line' <<<"$PLAYER")" = 2 ] && break
  sleep 1
done
eq "PREP earned credit after Marta round trip" "$(jq -r .earned_line <<<"$PLAYER")" 2
TOWN_ONE_CREDIT_LINE="$(jq -r .credit_line <<<"$PLAYER")"
pass "town-one credit line before default = $TOWN_ONE_CREDIT_LINE"

for day in $(seq 1 "${E2E_PREP_DAYS:-0}"); do
  BEFORE="$(v state | jq -r .day)"
  wait_day_ended
  click_endday
  wait_advanced_day $((BEFORE + 1))
  ADVANCE_TX="$(evj "window.__relay.filter(function(x){return x.method==='advance_day'})" | jq -r '.[-1].tx // empty')"
  tx_final PREP "advance_day #$day before Marta" "$ADVANCE_TX" "$RELAYER_ACCOUNT"
done

# J2: Marta, honest starter
pitch_and_wait() { # merchant index -> waits for a verdict whose request hash differs from the last one
  local m="$1" prev
  prev="$(ev "document.getElementById('verdict').dataset.requestHash||''")"
  click "[data-act=pick][data-m=\"$m\"]"
  if [ "$m" = 0 ]; then
  ev "document.querySelector('#pitch').value='I traded grain with you today, and my account now shows two gold of earned credit. Would you lend me fifteen gold?';document.querySelector('#ask').value='15';document.querySelector('#bond').value='0';document.querySelector('#ask').dispatchEvent(new Event('input',{bubbles:true}));true" >/dev/null
  else
    click "[data-act=starter][data-i=\"0\"]"
  fi
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
  OFFER_ID="$(jq -r .id <<<"$O")"
  BATCH="$(jq -r .batch <<<"$O")"
  RH="$(jq -r .request_hash <<<"$O")"
  OFFER_TX="$(ev "(document.querySelector('#verdict a[href*=\"/txns/\"],#verdict a[href*=\"/tx/\"]')||{}).href||''" | grep -oE '[1-9A-HJ-NP-Za-km-z]{43,44}' | tail -1)"
  tx_final J2 "offer $OFFER_ID (delegate via relayer)" "$OFFER_TX" "$RELAYER_ACCOUNT"
  [ "$STATUS" = committed ] || fail "A2 status is '$STATUS', not committed (a refused pitch shows no con; rerun)"
  jq -e '.outcome.proposed_advance > .outcome.advance and (.outcome.clamps | index("exposure") != null)' <<<"$O" >/dev/null \
    || fail "A2 did not prove an exposure clamp: $(jq -c '.outcome|{proposed_advance,advance,clamps}' <<<"$O")"
  CAP_ASK="$(jq -r .ask <<<"$O")"
  CAP_PROPOSED="$(jq -r .outcome.proposed_advance <<<"$O")"
  CAP_ALLOWED="$(jq -r .outcome.advance <<<"$O")"
  CAP_TAGS="$(jq -r '.outcome.clamps|join(", ")' <<<"$O")"
  PLAYER="$(v player "{\"account_id\":\"$P\"}")"
  eq "A2 contract exposure cap" "$CAP_ALLOWED" "$(jq -r .earned_line <<<"$PLAYER")"
case "$SIGNER" in worker:*) fail "A2 signer is a worker key: $SIGNER";; "$(v state | jq -r .model)"|gateway) ;; *) fail "A2 unexpected signer $SIGNER";; esac
pass "A2 offer committed, signer $SIGNER"
VERDICT="$(ev "document.getElementById('verdict').innerText.replace(/\\s+/g,' ')")"
case "$VERDICT" in *"Signature checked in your browser"*"sha256 matches"*) pass "A2 DOM: signature and request hash checked in the browser";; *) fail "A2 verdict text: $VERDICT";; esac
case "$VERDICT" in *"Merchant offered"*"Road allowed"*"Your credit with the road"*) pass "A2 DOM: signed offer shows merchant proposal and contract-clamped credit cap";; *) fail "A2 verdict omits the proposal, allowed cap, or clamp reason: $VERDICT";; esac

resume_tx_of() { # batch and offer id -> the finalized worker transaction, from metrics or the contract event index
  local b="$1" offer="$2" t="" i
  if [[ -n "${METRICS_FILE:-}" && -r "$METRICS_FILE" ]]; then
    t="$(grep "\"ev\":\"resumed\"" "$METRICS_FILE" | jq -r --argjson b "$b" 'select(.batch==$b)|.tx' | tail -1)"
  fi
  for i in $(seq 40); do
    if [[ -z "$t" ]]; then
      t="$(cd "$ROOT/web" && bun scripts/traction-events.ts "$C" | jq -r --argjson offer "$offer" '.events[] | select(.event=="offer_settled" and .offer_id==$offer) | .transaction_hash' | tail -1)"
    fi
    [[ -n "$t" ]] && break
    sleep 2
  done
  [[ -n "$t" ]] || fail "no finalized-event transaction found for batch $b / offer $offer"
  printf %s "$t"
}
RESUME_TX="$(resume_tx_of "$BATCH" "$OFFER_ID")"
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
    wait_day_ended
    click_endday
    wait_advanced_day $((day + 1))
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
REC_ID="$(jq -r .id <<<"$REC")"
REC_LOSS="$(jq -r .loss <<<"$REC")"
waitjs "Array.from(document.querySelectorAll('#recs .rec')).some(function(r){return r.querySelector('.n')?.innerText.trim()=='$REC_ID' && r.querySelector('.lost')?.innerText.trim()=='-$REC_LOSS'})" 90
ROAD_RECORD="$(evj "(()=>{const r=Array.from(document.querySelectorAll('#recs .rec')).find(function(x){return x.querySelector('.n')?.innerText.trim()=='$REC_ID'});return r?{id:r.querySelector('.n').innerText.trim(),loss:r.querySelector('.lost').innerText.trim(),detail:r.innerText.replace(/\\s+/g,' ')}:null})()")"
eq "A3 rendered road record id" "$(jq -r .id <<<"$ROAD_RECORD")" "$REC_ID"
eq "A3 rendered road record loss" "$(jq -r .loss <<<"$ROAD_RECORD")" "-$REC_LOSS"

# J4: one more day and the news reaches Pellgate
[ "$(v state | jq -r .day)" -le $((DUE + 1)) ] && eq "A4 news at Pellgate before the news day" "$(v news_at '{"merchant":1}' | jq "[.[]|select(.player==\"$P\")]|length")" 0
end_day_to $((DUE + 2))
record_days J4
eq "A4 news at Pellgate after the news day" "$(v news_at '{"merchant":1}' | jq "[.[]|select(.player==\"$P\")]|length")" 1
TOWN_TWO_CREDIT_LINE="$(v player "{\"account_id\":\"$P\"}" | jq -r .credit_line)"
[ "$TOWN_TWO_CREDIT_LINE" -lt "$TOWN_ONE_CREDIT_LINE" ] || fail "default did not lower the chain credit line: before $TOWN_ONE_CREDIT_LINE, after $TOWN_TWO_CREDIT_LINE"
pass "town-two credit line after default = $TOWN_TWO_CREDIT_LINE (below town one $TOWN_ONE_CREDIT_LINE)"

# J5: Pell hears the news
pitch_and_wait 1
O2="$(v offers_of "{\"account_id\":\"$P\",\"limit\":1}" | jq -c '.[0]')"
[ "$(jq -r .merchant <<<"$O2")" = 1 ] || fail "A5 newest offer is not Pell's: $O2"
TOWN_TWO_OFFER="$(jq -r '.outcome.advance' <<<"$O2")"
[ "$(jq -r .status <<<"$O2")" = committed ] || fail "A5 Pell offer is not committed: $O2"
[ "$TOWN_TWO_OFFER" -gt 0 ] && [ "$TOWN_TWO_OFFER" -le "$TOWN_TWO_CREDIT_LINE" ] && [ "$TOWN_TWO_OFFER" -lt "$TOWN_ONE_CREDIT_LINE" ] \
  || fail "town-two offer $TOWN_TWO_OFFER does not reflect default credit line $TOWN_TWO_CREDIT_LINE (town-one line $TOWN_ONE_CREDIT_LINE)"
pass "town_two_offer = $TOWN_TWO_OFFER, within the default-reduced chain credit line"
eq "A5 verdict data-request-hash" "$(ev "document.getElementById('verdict').dataset.requestHash")" "$(jq -r .request_hash <<<"$O2")"
NEWS="$(ev "[...document.querySelectorAll('#verdict li')].map(function(l){return l.innerText}).join(' | ')")"
case "$NEWS" in *"at Millford"*) pass "A5 news in Pell's request: $NEWS";; *) fail "A5 Pell's request lists no Millford news: '$NEWS'";; esac
B2="$(jq -r .batch <<<"$O2")"
RESUME2="$(resume_tx_of "$B2" "$(jq -r .id <<<"$O2")")"
tx_final J5 "npc_resume_batch $B2 (Pell, carries the news)" "$RESUME2" "$WORKER_ACCOUNT"
assert_no_errors


{
  printf '\nSigned pitch: `%s` asked `%s` gold; the registered signer proposed `%s`, and the contract allowed `%s` under clamp `%s`. The rendered verdict showed the merchant proposal, allowed cap, signature check, and request hash.\n' \
    "$P" "$CAP_ASK" "$CAP_PROPOSED" "$CAP_ALLOWED" "$CAP_TAGS"
  printf 'Default: road record `%s` landed for `%s` gold loss. The page ledger rendered record `%s` and loss `-%s`; its advance-day transaction is linked above.\n' \
    "$REC_ID" "$REC_LOSS" "$REC_ID" "$REC_LOSS"
  printf 'Pell heard the Millford news in the same account\x27s town-two pitch; the signed town-two offer and worker resume transaction are linked above.\n'
  printf 'town_one_credit_line=%s\ntown_two_credit_line_after_default=%s\ntown_two_offer=%s\n' \
    "$TOWN_ONE_CREDIT_LINE" "$TOWN_TWO_CREDIT_LINE" "$TOWN_TWO_OFFER"
} >>"$EVIDENCE_OUT"

echo "PASS longcon judge journey on $C"
