#!/usr/bin/env bash
# Browser E2E through the `deepsurge` bhn profile. Serves web/ locally, drives the
# page like a judge, and compares what the DOM shows with a direct RPC read.
# Page errors are captured by a script injected into every served HTML page.
# Needs: bhn (profile deepsurge), python3, curl, jq. Opens one tab, closes it on exit.
source "$(dirname "$0")/e2e-lib.sh"
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
sig="$(jp "document.getElementById('signers').innerText")"
case "$sig" in
  *"does not match the published attestation report"*) ;;
  *) fail "[$RECORDS_GAME] signers panel does not show the expected attestation mismatch: $sig";;
esac
case "$sig" in
  *"matches the published"*) fail "[$RECORDS_GAME] signers panel incorrectly shows an attestation match: $sig";;
  *) pass "[$RECORDS_GAME] signers show attestation mismatch";;
esac
echo "PASS longcon browser e2e"
