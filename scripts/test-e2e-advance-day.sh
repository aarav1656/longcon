#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/e2e-lib.sh"
WEB="$ROOT/scripts/fixtures"
start_server
open_page endday.html

[[ "$(ev "String(window.contractDay)")" == 8 ]] || fail "fixture did not start on day 8"
[[ "$(ev "String(window.enddayInitiallyAbsent)")" == true ]] || fail "fixture did not start without end-day control"
click_endday
waitjs "window.contractDay === 9 && window.enddayClicks === 1" 10
[[ "$(ev "String(window.enddayWasDisabled)")" == true ]] || fail "fixture did not exercise the disabled control state"
[[ "$(ev "String(window.contractDay)")" == 9 ]] || fail "contract day did not advance once"
[[ "$(ev "String(window.enddayClicks)")" == 1 ]] || fail "end-day control clicked more than once"
assert_no_errors
pass "delayed end-day control advanced day 8 to 9 with one click and no page errors"
