#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/e2e-lib.sh"
WEB="$ROOT/scripts/fixtures"
E2E_BHN_PROFILE="${E2E_BHN_PROFILE:-longcon-capture}"
start_server
open_page endday.html

[[ "$(ev "String(window.contractDay)")" == 8 ]] || fail "fixture did not start on day 8"
[[ "$(ev "String(window.enddayInitiallyAbsent)")" == true ]] || fail "fixture did not start without end-day control"
waitjs "!!document.querySelector('[data-act=endday]')" 30
[[ "$(ev "String(window.enddayWasDisabled)")" == true ]] || fail "fixture did not insert end-day control disabled"
click_endday
waitjs "window.contractDay === 9 && window.enddayClicks === 1" 10
[[ "$(ev "String(window.contractDay)")" == 9 ]] || fail "contract day did not advance once"
[[ "$(ev "String(window.enddayClicks)")" == 1 ]] || fail "end-day control clicked more than once"
[[ "$(ev "String(window.__relay.length)")" == 0 ]] || fail "fixture submitted a relayer chain write"
assert_no_errors
pass "delayed disabled end-day control advanced local day 8 to 9 with one click and no chain write or page errors"
