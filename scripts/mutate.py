#!/usr/bin/env python3
"""Mutation check for every guard that moves or gates value.

For each row: break the guard in the source, run the test that is meant to catch it and require RED,
restore the file byte for byte, run the same test and require GREEN. Writes docs/TESTS.md.

  scripts/mutate.py            run every row
  scripts/mutate.py M12 M17    run the named rows
"""
import os, subprocess, sys, time, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = ". " + os.path.join(os.path.dirname(ROOT), "env.sh") + "; export CARGO_BUILD_JOBS=3; "

def sandbox(binary, name, extra=""):
    return ENV + f"{extra}cargo test -p longcon-tests --test {binary} {name} -- --exact"

def unit(name):
    return ENV + f"cargo test -p longcon --lib {name} -- --exact"

# id, guard, file, old, new, replace-count, test command, test label
M = [
    ("M01", "join: one stipend per account", "contract/src/lib.rs", 'require!(!self.players.contains_key(&who), "already joined");', "", 1, sandbox("guards", "joining_twice_does_not_mint_a_second_stipend"), "guards::joining_twice_does_not_mint_a_second_stipend"),
    ("M02", "trade: buyer must afford the grain", "contract/src/lib.rs", 'require!(p.gold >= value, "not enough gold");', "", 1, sandbox("guards", "trades_are_refused_beyond_what_either_side_holds"), "guards::trades_are_refused_beyond_what_either_side_holds"),
    ("M03", "trade: merchant must hold the grain", "contract/src/lib.rs", 'require!(m.grain >= qty, "merchant has not that much grain");', "", 1, sandbox("guards", "trades_are_refused_beyond_what_either_side_holds"), "guards::trades_are_refused_beyond_what_either_side_holds"),
    ("M04", "trade: merchant must hold the gold it pays", "contract/src/lib.rs", 'require!(m.gold >= value, "merchant cannot pay that much gold");', "", 1, sandbox("guards", "a_merchant_with_too_little_gold_cannot_buy_grain"), "guards::a_merchant_with_too_little_gold_cannot_buy_grain"),
    ("M05", "offer: the bond leaves the player's gold", "contract/src/lib.rs", "        p.gold -= bond;\n        p.locked_bonds += bond;", "        p.locked_bonds += bond;", 1, sandbox("lifecycle", "a_default_burns_the_bond_books_the_loss_and_writes_a_con_record"), "lifecycle::a_default_burns_the_bond_books_the_loss_and_writes_a_con_record"),
    ("M06", "offer: one open offer per player", "contract/src/lib.rs", 'require!(p.pending_offer.is_none(), "you already have an offer awaiting an answer");', "", 1, sandbox("clamps", "one_open_offer_per_player_and_limits_are_checked_before_any_model_call"), "clamps::one_open_offer_per_player_and_limits_are_checked_before_any_model_call"),
    ("M07", "offer: six offers a day", "contract/src/lib.rs", 'require!(p.offers_today < MAX_OFFERS_PER_DAY, "offer limit for today reached");', "", 1, sandbox("guards", "six_offers_a_day_and_then_the_limit"), "guards::six_offers_a_day_and_then_the_limit"),
    ("M08", "offer: cannot bond more than held", "contract/src/lib.rs", 'require!(bond <= p.gold, "you cannot bond more gold than you hold");', "", 1, sandbox("clamps", "one_open_offer_per_player_and_limits_are_checked_before_any_model_call"), "clamps::one_open_offer_per_player_and_limits_are_checked_before_any_model_call"),
    ("M09", "offer: ask between 1 and 60", "contract/src/lib.rs", 'require!(ask >= 1 && ask <= MAX_ASK, "ask must be between 1 and 60 gold");', "", 1, sandbox("clamps", "one_open_offer_per_player_and_limits_are_checked_before_any_model_call"), "clamps::one_open_offer_per_player_and_limits_are_checked_before_any_model_call"),
    ("M10", "offer: 64 offers per merchant queue", "contract/src/lib.rs", 'require!(self.queues[merchant as usize].len() < MAX_QUEUE, "this merchant\'s queue is full, try again shortly");', "", 1, sandbox("guards", "the_merchant_queue_holds_sixty_four_offers_and_the_next_one_waits"), "guards::the_merchant_queue_holds_sixty_four_offers_and_the_next_one_waits"),
    ("M11", "seal_batch: the window must pass", "contract/src/lib.rs", "queue.len() >= MAX_BATCH || env::block_height() >= oldest + BATCH_WINDOW_BLOCKS,", "true,", 1, sandbox("batch", "a_batch_cannot_be_sealed_early_so_a_stranger_cannot_isolate_one_traveler"), "batch::a_batch_cannot_be_sealed_early_so_a_stranger_cannot_isolate_one_traveler"),
    ("M12", "npc_resume_batch: the ed25519 signature must verify", "contract/src/lib.rs", 'require!(attest::verify(&sig, &text, &key), "signature does not verify over the request this contract built and the response given");', "", 1, sandbox("attestation", "one_altered_response_byte_is_rejected_and_the_yield_stays_open"), "attestation::one_altered_response_byte_is_rejected_and_the_yield_stays_open"),
    ("M13", "npc_resume_batch: a settled batch cannot be answered again", "contract/src/lib.rs", 'require!(batch.status == BatchStatus::Open, "batch is not awaiting an answer");', "", 1, sandbox("attestation", "a_settled_offer_cannot_be_resumed_again"), "attestation::a_settled_offer_cannot_be_resumed_again"),
    ("M14", "npc_resume_batch: a gateway signature needs the gateway key", "contract/src/lib.rs", 'SigKind::Gateway => "gateway".to_string(),', "SigKind::Gateway => self.model.clone(),", 1, sandbox("attestation", "gateway_kind_needs_its_own_registered_key"), "attestation::gateway_kind_needs_its_own_registered_key"),
    ("M15", "owner methods are owner only", "contract/src/lib.rs", 'require!(env::predecessor_account_id() == self.owner, "owner only");', "", 1, sandbox("attestation", "owner_methods_and_the_callback_are_closed_to_everyone_else"), "attestation::owner_methods_and_the_callback_are_closed_to_everyone_else"),
    ("M16", "on_terms is a private callback", "contract/src/lib.rs", "    #[private]\n    pub fn on_terms", "    pub fn on_terms", 1, sandbox("attestation", "owner_methods_and_the_callback_are_closed_to_everyone_else"), "attestation::owner_methods_and_the_callback_are_closed_to_everyone_else"),
    ("M17", "clamp: merchant loses at most 15 gold per due day", "contract/src/rules.rs", '(r.daily_loss, "daily_loss"),', "", 1, sandbox("clamps", "daily_loss_cap_binds_across_players_for_the_same_due_day"), "clamps::daily_loss_cap_binds_across_players_for_the_same_due_day"),
    ("M18", "clamp: open credit at most 30 percent of capital", "contract/src/rules.rs", '(r.treasury, "treasury_30pct"),', "", 1, sandbox("clamps", "open_credit_never_passes_thirty_percent_of_the_treasury"), "clamps::open_credit_never_passes_thirty_percent_of_the_treasury"),
    ("M19", "clamp: exposure is bond plus earned line", "contract/src/rules.rs", '(r.exposure, "exposure"),', "", 1, sandbox("clamps", "exposure_is_bond_plus_earned_line"), "clamps::exposure_is_bond_plus_earned_line"),
    ("M20", "clamp: never more than the merchant holds", "contract/src/rules.rs", '(r.gold, "merchant_gold"),', "", 1, unit("rules::tests::each_axis_binds_on_its_own"), "rules::tests::each_axis_binds_on_its_own (unit; the 30 percent cap always binds first in sandbox play)"),
    ("M21", "clamp: never more than the traveler asked", "contract/src/rules.rs", '(r.ask, "ask"),', "", 1, unit("rules::tests::each_axis_binds_on_its_own"), "rules::tests::each_axis_binds_on_its_own (unit)"),
    ("M22", "clamp: repay is never below principal", "contract/src/rules.rs", "if proposed < advance {", "if false {", 1, sandbox("clamps", "a_debt_can_never_pay_the_player"), "clamps::a_debt_can_never_pay_the_player"),
    ("M23", "clamp: interest is at most 50 percent", "contract/src/rules.rs", "} else if proposed > ceiling {", "} else if false {", 1, sandbox("clamps", "a_debt_can_never_pay_the_player"), "clamps::a_debt_can_never_pay_the_player"),
    ("M24", "clamp: due in one to five days", "contract/src/rules.rs", "let c = proposed.clamp(1, MAX_DUE_DAYS);", "let c = proposed;", 1, sandbox("clamps", "due_days_are_clamped_to_one_through_five"), "clamps::due_days_are_clamped_to_one_through_five"),
    ("M25", "money pump: a sell quote stays above every buy quote", "contract/src/rules.rs", "let s_lo = SELL_MIN.max(others_max_buy + 1).max(cur.1.saturating_sub(QUOTE_STEP));", "let s_lo = SELL_MIN.max(cur.1.saturating_sub(QUOTE_STEP));", 1, sandbox("clamps", "a_merchant_cannot_cut_its_sell_quote_down_to_another_merchants_buy_quote"), "clamps::a_merchant_cannot_cut_its_sell_quote_down_to_another_merchants_buy_quote"),
    ("M26", "money pump: a buy quote stays below every sell quote", "contract/src/rules.rs", ".min(others_min_sell.saturating_sub(1))", "", 1, sandbox("clamps", "quotes_cannot_open_an_arbitrage_between_merchants"), "clamps::quotes_cannot_open_an_arbitrage_between_merchants"),
    ("M27", "repay_debt: the bond comes back with the repayment", "contract/src/lib.rs", "p.gold = p.gold - d.repay + d.bond;", "p.gold = p.gold - d.repay;", 1, sandbox("lifecycle", "repaying_returns_the_bond_and_grows_the_credit_line"), "lifecycle::repaying_returns_the_bond_and_grows_the_credit_line"),
    ("M28", "repay_debt: only the debtor repays", "contract/src/lib.rs", 'require!(d.player == who, "this is not your debt");', "", 1, sandbox("lifecycle", "repaying_returns_the_bond_and_grows_the_credit_line"), "lifecycle::repaying_returns_the_bond_and_grows_the_credit_line"),
    ("M29", "advance_day: the day cannot be forced", "contract/src/lib.rs", "self.day_length_ms == 0 || now >= self.day_started_ns + self.day_length_ms * 1_000_000,", "true,", 1, sandbox("lifecycle", "the_day_cannot_be_forced_before_it_ends_or_by_strangers"), "lifecycle::the_day_cannot_be_forced_before_it_ends_or_by_strangers"),
    ("M30", "advance_day: strangers cannot advance it", "contract/src/lib.rs", 'require!(who == self.owner || self.players.contains_key(&who), "join the road first");', "", 1, sandbox("lifecycle", "the_day_cannot_be_forced_before_it_ends_or_by_strangers"), "lifecycle::the_day_cannot_be_forced_before_it_ends_or_by_strangers"),
    ("M31", "default: the bond burns", "contract/src/lib.rs", "self.supply.burned_gold += d.bond;", "", 1, sandbox("lifecycle", "a_default_burns_the_bond_books_the_loss_and_writes_a_con_record"), "lifecycle::a_default_burns_the_bond_books_the_loss_and_writes_a_con_record"),
    ("M32", "default: the merchant books the loss", "contract/src/lib.rs", "m.lost_total += d.principal;", "", 1, sandbox("lifecycle", "a_default_burns_the_bond_books_the_loss_and_writes_a_con_record"), "lifecycle::a_default_burns_the_bond_books_the_loss_and_writes_a_con_record"),
    ("M33", "timeout: the bond comes back", "contract/src/lib.rs", "            p.gold += offer.bond;", "", 1, sandbox("lifecycle", "a_merchant_that_never_answers_times_out_and_the_bond_comes_back"), "lifecycle::a_merchant_that_never_answers_times_out_and_the_bond_comes_back"),
    ("M34", "news: one town per game day", "contract/src/rules.rs", "landed_day + distance(origin, town)", "landed_day", 1, sandbox("lifecycle", "news_of_a_landed_con_travels_one_town_per_day"), "lifecycle::news_of_a_landed_con_travels_one_town_per_day"),
    ("M35", "news: expires after 8 days", "contract/src/lib.rs", " && self.day <= r.day + NEWS_TTL_DAYS", "", 1, sandbox("batch", "news_expires_after_eight_days"), "batch::news_expires_after_eight_days"),
    ("M36", "records: merchant configuration is pinned", "contract/src/prompt.rs", 'hex::encode(env::sha256_array(format!("{model}|temperature={TEMPERATURE}|{SYSTEM}").as_bytes()))', "String::new()", 1, sandbox("batch", "every_debt_and_record_carries_the_pinned_merchant_configuration"), "batch::every_debt_and_record_carries_the_pinned_merchant_configuration"),
    ("M37", "fund_merchant: minted gold is tracked", "contract/src/lib.rs", "        self.supply.minted_gold += gold;", "", 1, sandbox("guards", "funding_a_merchant_keeps_the_audit_identity"), "guards::funding_a_merchant_keeps_the_audit_identity"),
    ("M38", "join: the stipend is tracked as minted", "contract/src/lib.rs", "self.supply.minted_gold += GOLD_STIPEND;", "", 1, sandbox("guards", "joining_twice_does_not_mint_a_second_stipend"), "guards::joining_twice_does_not_mint_a_second_stipend"),
    ("M39", "batch parse: the first decision for a slot wins", "contract/src/attest.rs", " && decisions[slot - 1].is_none()", "", 1, unit("attest::tests::a_batch_answer_is_read_per_slot_and_a_missing_slot_is_a_refusal"), "attest::tests::a_batch_answer_is_read_per_slot_and_a_missing_slot_is_a_refusal (unit)"),
    ("M40", "rumours: a transfer needs exactly 1 yocto", "contract/src/rumour.rs", "        assert_one_yocto();", "", 1, sandbox("rumours", "rumours_transfer_with_one_yocto_and_not_without_a_balance"), "rumours::rumours_transfer_with_one_yocto_and_not_without_a_balance"),
    ("M41", "rumours: a transfer cannot exceed the balance", "contract/src/rumour.rs", 'require!(fb >= amount, "not enough rumours");', "", 1, sandbox("rumours", "rumours_transfer_with_one_yocto_and_not_without_a_balance"), "rumours::rumours_transfer_with_one_yocto_and_not_without_a_balance"),
    ("M42", "sybil: a thousand fresh accounts stay under the daily cap", "contract/src/rules.rs", '(r.daily_loss, "daily_loss"),', "", 1, sandbox("sybil", "a_thousand_fresh_accounts_cannot_take_more_than_the_daily_cap_from_one_merchant", "SYBIL_ACCOUNTS=70 "), "sybil::a_thousand_fresh_accounts_cannot_take_more_than_the_daily_cap_from_one_merchant (70 accounts for the mutation run)"),
    ("M43", "a skipped model slot is a refusal, never a guess", "contract/src/attest.rs", "decisions: decisions.into_iter().map(|d| d.unwrap_or_else(unparsable)).collect(),", "decisions: decisions.into_iter().map(|d| d.unwrap_or_else(|| Proposed { accept: true, advance: 5, repay: 5, due_days: 1, buy_price: None, sell_price: None, class: ConClass::Other, reason: String::new() })).collect(),", 1, sandbox("batch", "an_answer_that_skips_a_slot_refuses_that_traveler_and_loses_nothing"), "batch::an_answer_that_skips_a_slot_refuses_that_traveler_and_loses_nothing"),
    ("M44", "seal_batch: every request carries its batch id and the block's random seed", "contract/src/prompt.rs", "c.day, c.batch_id, c.nonce,", 'c.day, 0, "",', 1, sandbox("hardening", "an_answer_signed_for_one_batch_is_rejected_on_an_identical_later_batch"), "hardening::an_answer_signed_for_one_batch_is_rejected_on_an_identical_later_batch"),
    ("M45", "npc_resume_batch: only the owner or a registered relayer delivers an answer", "contract/src/lib.rs", 'require!(caller == self.owner || self.relayers.contains(&caller), "relayers only: ask the owner to register your account");', "", 1, sandbox("hardening", "only_a_registered_relayer_can_deliver_a_signed_answer"), "hardening::only_a_registered_relayer_can_deliver_a_signed_answer"),
    ("M46", "set_relayer: removing a relayer takes its access away", "contract/src/lib.rs", "        self.relayers.retain(|r| *r != account_id);\n", "", 1, sandbox("hardening", "only_a_registered_relayer_can_deliver_a_signed_answer"), "hardening::only_a_registered_relayer_can_deliver_a_signed_answer"),
    ("M47", "default: the credit line the con was lent against is taken back", "contract/src/lib.rs", "p.earned_line = p.earned_line.saturating_sub(d.principal);", "", 1, sandbox("hardening", "a_default_takes_back_the_credit_it_was_lent_against"), "hardening::a_default_takes_back_the_credit_it_was_lent_against"),
    ("M48", "join: the storage deposit is attached", "contract/src/lib.rs", "env::attached_deposit().as_yoctonear() == JOIN_DEPOSIT_YOCTO,", "true,", 1, sandbox("hardening", "joining_needs_the_storage_deposit_and_a_sponsor_can_pay_it"), "hardening::joining_needs_the_storage_deposit_and_a_sponsor_can_pay_it"),
    ("M49", "sponsor_join: the sponsored account is the one that joins", "contract/src/lib.rs", "        self.join_account(account_id);", "        self.join_account(env::predecessor_account_id());", 1, sandbox("hardening", "joining_needs_the_storage_deposit_and_a_sponsor_can_pay_it"), "hardening::joining_needs_the_storage_deposit_and_a_sponsor_can_pay_it"),
    ("M50", "on_terms: a settled offer drops its pitch", "contract/src/lib.rs", "o.pitch = String::new();", "", 1, sandbox("hardening", "a_settled_offer_drops_its_pitch_and_an_account_has_a_lifetime_offer_allowance"), "hardening::a_settled_offer_drops_its_pitch_and_an_account_has_a_lifetime_offer_allowance"),
    ("M51", "offer: an account has a lifetime offer allowance", "contract/src/lib.rs", 'require!(p.offers_total < MAX_OFFERS_PER_ACCOUNT, "this account has used its offer allowance; the deposit it joined with pays for no more");', "", 1, sandbox("hardening", "a_settled_offer_drops_its_pitch_and_an_account_has_a_lifetime_offer_allowance"), "hardening::a_settled_offer_drops_its_pitch_and_an_account_has_a_lifetime_offer_allowance"),
    ("M52", "npc_resume_batch: an operator signature is reported as worker:<model>", "contract/src/lib.rs", 'SigKind::Worker => format!("worker:{}", self.model),', "SigKind::Worker => self.model.clone(),", 1, sandbox("hardening", "an_operator_key_signs_as_worker_and_the_outcome_says_so"), "hardening::an_operator_key_signs_as_worker_and_the_outcome_says_so"),
    ("M53", "reputation: a recorded default lowers the credit line", "contract/src/rules.rs", "room.saturating_mul(100 - reputation_haircut_pct(defaults)) / 100", "room.saturating_mul(100) / 100", 1, sandbox("reputation", "pell_credit_line_reflects_marta_default"), "reputation::pell_credit_line_reflects_marta_default"),
    ("M54", "reputation: the commit clamp uses the reputation line", "contract/src/lib.rs", "exposure: credit_line(p.locked_bonds, p.earned_line, p.outstanding, p.cons_landed),", "exposure: exposure_room(p.locked_bonds, p.earned_line, p.outstanding),", 1, sandbox("reputation", "pell_credit_line_reflects_marta_default"), "reputation::pell_credit_line_reflects_marta_default"),
    ("M55", "npc_resume_batch: the loan decision event is emitted only after the signature verifies", "contract/src/lib.rs", 'require!(attest::verify(&sig, &text, &key), "signature does not verify over the request this contract built and the response given");', 'emit("loan_decision", json!({"batch_id": batch_id}));\n        require!(attest::verify(&sig, &text, &key), "signature does not verify over the request this contract built and the response given");', 1, sandbox("attestation", "loan_proof_rejects_replay_tamper_cross_merchant_and_expired_payload"), "attestation::loan_proof_rejects_replay_tamper_cross_merchant_and_expired_payload"),
]

def run(cmd):
    t = time.time()
    p = subprocess.run(["bash", "-c", cmd], cwd=ROOT, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr, time.time() - t

def evidence(out):
    keep = []
    for line in out.splitlines():
        if re.search(r"panicked at|assertion|left:|right:|Error:|FAILED|test result|^test .* \.\.\. (ok|FAILED)|signature does not verify", line) and "Blocking" not in line:
            keep.append(line.strip()[:200])
    return keep[:5]

def main():
    want = set(sys.argv[1:])
    rows = []
    for (mid, guard, path, old, new, cnt, cmd, label) in M:
        if want and mid not in want:
            continue
        full = os.path.join(ROOT, path)
        original = open(full, "rb").read()
        text = original.decode()
        if text.count(old) < 1:
            rows.append((mid, guard, path, label, "SKIPPED", "mutation anchor not found: " + old[:60], "", 0))
            print(mid, "ANCHOR MISSING", flush=True)
            continue
        try:
            open(full, "w").write(text.replace(old, new, cnt))
            rc_red, out_red, t_red = run(cmd)
        finally:
            open(full, "wb").write(original)
        restored = open(full, "rb").read() == original
        rc_green, out_green, t_green = run(cmd)
        red = rc_red != 0
        green = rc_green == 0
        verdict = "KILLED" if (red and green and restored) else "SURVIVED" if (not red) else "BROKEN"
        rows.append((mid, guard, path, label, verdict, " | ".join(evidence(out_red)), " | ".join(evidence(out_green)), t_red + t_green))
        print(mid, verdict, f"{t_red + t_green:.0f}s", flush=True)
    write_doc(rows)
    bad = [r for r in rows if r[4] != "KILLED"]
    sys.exit(1 if bad else 0)

def write_doc(rows):
    out = os.path.join(ROOT, "docs", "TESTS.md" if not os.environ.get("MUTATION_OUT") else os.environ["MUTATION_OUT"])
    lines = [
        "| Id | Guard broken | File | Test that must go red | Red run | Green after restore | Result |",
        "|---|---|---|---|---|---|---|",
    ]
    for (mid, guard, path, label, verdict, red, green, secs) in rows:
        esc = lambda s: s.replace("|", "/").replace("`", "'")
        lines.append(f"| {mid} | {guard} | `{path}` | `{label}` | {esc(red)} | {esc(green)} | {verdict} |")
    open(out + ".rows", "w").write("\n".join(lines) + "\n")
    print("wrote", out + ".rows")

main()
