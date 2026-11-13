//! The road's rules in one file. Every number a merchant's model cannot override lives here, and
//! every clamp is a pure function so it is tested without a chain.

pub const GOLD_STIPEND: u64 = 20;
pub const MAX_ASK: u64 = 60;
pub const PITCH_MAX_BYTES: usize = 400;
pub const REASON_MAX_BYTES: usize = 160;
pub const MODEL_MAX_BYTES: usize = 64;

/// A merchant loses at most this much gold on any one game day.
pub const LOSS_CAP_PER_DAY: u64 = 15;
/// Open principal may not exceed this share of a merchant's capital (gold plus open principal).
pub const TREASURY_CAP_PCT: u64 = 30;
pub const MAX_DUE_DAYS: u32 = 5;
pub const MAX_INTEREST_PCT: u64 = 50;
pub const MAX_OFFERS_PER_DAY: u32 = 6;
/// An account's lifetime offers. A settled offer keeps its hashes and outcome in state, so this
/// bounds what one join deposit has to pay for.
pub const MAX_OFFERS_PER_ACCOUNT: u32 = 24;
/// Storage stake attached to a join: 20 KB at 0.00001 NEAR per byte, enough for the player row and
/// every offer the allowance above permits.
pub const JOIN_DEPOSIT_YOCTO: u128 = 200_000_000_000_000_000_000_000;
pub const TRADE_LINE_DIV: u64 = 10;
/// Each recorded unpaid default takes this share off the credit line every merchant offers the
/// account, up to REP_HAIRCUT_MAX_PCT, so a con at one merchant is priced by all of them.
pub const REP_HAIRCUT_PCT_PER_DEFAULT: u64 = 25;
pub const REP_HAIRCUT_MAX_PCT: u64 = 75;
/// Reputation changes per emitted event, so a day of mass defaults stays under the log limits.
pub const REP_EVENT_CHUNK: usize = 48;
pub const REPAY_LINE_DIV: u64 = 2;
pub const ON_TERMS_TGAS: u64 = 30;

pub const QUOTE_STEP: u64 = 1;
pub const BUY_MIN: u64 = 1;
pub const SELL_MIN: u64 = 2;
pub const SELL_MAX: u64 = 12;
pub const BUY_MAX: u64 = SELL_MAX - 1;

pub const RECORDS_IN_PROMPT: usize = 4;
/// A landed con stops being news this many days after it landed. Stale or false information
/// would otherwise persist in every later prompt.
pub const NEWS_TTL_DAYS: u32 = 8;
/// Offers for one merchant wait this many blocks (about 23 s) so that a batch is weighed together.
pub const BATCH_WINDOW_BLOCKS: u64 = 40;
pub const MAX_BATCH: usize = 8;
pub const MAX_QUEUE: usize = 64;
pub const RECORD_SCAN: u64 = 64;

pub const TOWNS: [&str; 3] = ["Millford", "Pellgate", "Oskmoor"];

pub struct Seed {
    pub name: &'static str,
    pub persona: &'static str,
    pub town: u8,
    pub buy: u64,
    pub sell: u64,
}

pub const SEEDS: [Seed; 3] = [
    Seed { name: "Marta", persona: "a shrewd but fair grain wife who has sold at Millford for thirty years", town: 0, buy: 4, sell: 6 },
    Seed { name: "Pell", persona: "a nervous tinker who trusts a good story too quickly", town: 1, buy: 5, sell: 7 },
    Seed { name: "Osk", persona: "a suspicious toll keeper who writes down every name he hears", town: 2, buy: 4, sell: 6 },
];

pub fn distance(a: u8, b: u8) -> u32 {
    (a as i32 - b as i32).unsigned_abs()
}

/// Caravan clock: a con landed on `landed_day` in `origin` is known in `town` from this day on.
pub fn news_arrives(landed_day: u32, origin: u8, town: u8) -> u32 {
    landed_day + distance(origin, town)
}

pub fn clamp_due_days(proposed: u32) -> (u32, bool) {
    let c = proposed.clamp(1, MAX_DUE_DAYS);
    (c, c != proposed)
}

/// Limits that bind an advance. Each field is the most the road allows on that axis.
#[derive(Clone, Copy, Debug)]
pub struct Room {
    pub ask: u64,
    pub exposure: u64,
    pub daily_loss: u64,
    pub treasury: u64,
    pub gold: u64,
}

pub fn treasury_room(gold: u64, outstanding: u64) -> u64 {
    let capital = gold.saturating_add(outstanding);
    (capital.saturating_mul(TREASURY_CAP_PCT) / 100).saturating_sub(outstanding)
}

pub fn exposure_room(locked_bonds: u64, earned_line: u64, outstanding: u64) -> u64 {
    locked_bonds.saturating_add(earned_line).saturating_sub(outstanding)
}

/// Share of the credit line withheld from an account with `defaults` recorded unpaid defaults.
pub fn reputation_haircut_pct(defaults: u32) -> u64 {
    (defaults as u64).saturating_mul(REP_HAIRCUT_PCT_PER_DEFAULT).min(REP_HAIRCUT_MAX_PCT)
}

/// The most any merchant may advance this account: the exposure room less the reputation haircut.
/// Rounds down, so one recorded default lowers every non-zero line.
pub fn credit_line(locked_bonds: u64, earned_line: u64, outstanding: u64, defaults: u32) -> u64 {
    let room = exposure_room(locked_bonds, earned_line, outstanding);
    room.saturating_mul(100 - reputation_haircut_pct(defaults)) / 100
}

pub fn daily_room(already_due_that_day: u64) -> u64 {
    LOSS_CAP_PER_DAY.saturating_sub(already_due_that_day)
}

pub fn clamp_advance(proposed: u64, r: &Room, notes: &mut Vec<String>) -> u64 {
    let mut a = proposed;
    for (limit, tag) in [
        (r.ask, "ask"),
        (r.exposure, "exposure"),
        (r.daily_loss, "daily_loss"),
        (r.treasury, "treasury_30pct"),
        (r.gold, "merchant_gold"),
    ] {
        if a > limit {
            a = limit;
            notes.push(tag.to_string());
        }
    }
    a
}

/// Interest is never negative and never above MAX_INTEREST_PCT: a debt cannot pay the player.
pub fn clamp_repay(advance: u64, proposed: u64, notes: &mut Vec<String>) -> u64 {
    let ceiling = advance.saturating_add(advance.saturating_mul(MAX_INTEREST_PCT) / 100);
    if proposed < advance {
        notes.push("repay_floor".to_string());
        advance
    } else if proposed > ceiling {
        notes.push("repay_ceiling".to_string());
        ceiling
    } else {
        proposed
    }
}

/// Money-pump invariant: after the update, every merchant's buy price is strictly below every
/// merchant's sell price (including its own), so no grain round trip anywhere on the road gains
/// gold. `others` are the (buy, sell) quotes of the other merchants, which already satisfy it.
pub fn clamp_quotes(
    cur: (u64, u64),
    proposed: (Option<u64>, Option<u64>),
    others: &[(u64, u64)],
    notes: &mut Vec<String>,
) -> (u64, u64) {
    let others_max_buy = others.iter().map(|q| q.0).max().unwrap_or(0);
    let others_min_sell = others.iter().map(|q| q.1).min().unwrap_or(u64::MAX);

    let s_lo = SELL_MIN.max(others_max_buy + 1).max(cur.1.saturating_sub(QUOTE_STEP));
    let s_hi = SELL_MAX.min(cur.1 + QUOTE_STEP);
    let want_s = proposed.1.unwrap_or(cur.1);
    let sell = want_s.clamp(s_lo, s_hi.max(s_lo));
    if sell != want_s {
        notes.push("sell_quote".to_string());
    }

    let b_lo = BUY_MIN.max(cur.0.saturating_sub(QUOTE_STEP));
    let b_hi = BUY_MAX
        .min(cur.0 + QUOTE_STEP)
        .min(others_min_sell.saturating_sub(1))
        .min(sell - 1);
    let want_b = proposed.0.unwrap_or(cur.0);
    let buy = want_b.clamp(b_lo.min(b_hi), b_hi);
    if buy != want_b {
        notes.push("buy_quote".to_string());
    }
    (buy, sell)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn room() -> Room {
        Room { ask: 30, exposure: 12, daily_loss: 15, treasury: 30, gold: 100 }
    }

    #[test]
    fn advance_takes_the_tightest_limit_and_names_every_limit_it_hit() {
        let mut n = vec![];
        assert_eq!(clamp_advance(50, &room(), &mut n), 12);
        assert_eq!(n, vec!["ask", "exposure"]);
    }

    #[test]
    fn advance_inside_every_limit_is_untouched() {
        let mut n = vec![];
        assert_eq!(clamp_advance(10, &room(), &mut n), 10);
        assert!(n.is_empty());
    }

    #[test]
    fn each_axis_binds_on_its_own() {
        for (r, tag) in [
            (Room { ask: 5, ..room() }, "ask"),
            (Room { exposure: 5, ..room() }, "exposure"),
            (Room { daily_loss: 5, ..room() }, "daily_loss"),
            (Room { treasury: 5, ..room() }, "treasury_30pct"),
            (Room { gold: 5, ..room() }, "merchant_gold"),
        ] {
            let mut n = vec![];
            assert_eq!(clamp_advance(10, &r, &mut n), 5, "{tag}");
            assert_eq!(n, vec![tag], "{tag}");
        }
    }

    #[test]
    fn repay_never_below_principal_never_above_ceiling() {
        let mut n = vec![];
        assert_eq!(clamp_repay(10, 3, &mut n), 10);
        assert_eq!(clamp_repay(10, 99, &mut n), 15);
        assert_eq!(clamp_repay(10, 12, &mut n), 12);
        assert_eq!(n, vec!["repay_floor", "repay_ceiling"]);
    }

    #[test]
    fn treasury_cap_is_thirty_percent_of_capital() {
        assert_eq!(treasury_room(100, 0), 30);
        assert_eq!(treasury_room(90, 10), 20);
        assert_eq!(treasury_room(70, 30), 0);
        assert_eq!(treasury_room(0, 0), 0);
    }

    #[test]
    fn exposure_is_bond_plus_line_minus_open_principal() {
        assert_eq!(exposure_room(10, 4, 0), 14);
        assert_eq!(exposure_room(10, 4, 14), 0);
        assert_eq!(exposure_room(0, 0, 5), 0);
    }

    #[test]
    fn each_recorded_default_lowers_the_credit_line_to_a_floor() {
        assert_eq!(credit_line(8, 0, 0, 0), 8);
        assert_eq!(credit_line(8, 0, 0, 1), 6);
        assert_eq!(credit_line(8, 0, 0, 2), 4);
        assert_eq!(credit_line(8, 0, 0, 3), 2);
        assert_eq!(credit_line(8, 0, 0, 40), 2, "the haircut stops at 75 percent");
        for room in 1..50 {
            assert!(credit_line(room, 0, 0, 1) < credit_line(room, 0, 0, 0), "room {room}");
        }
    }

    #[test]
    fn caravan_clock_is_one_town_per_day() {
        assert_eq!(news_arrives(5, 0, 0), 5);
        assert_eq!(news_arrives(5, 0, 1), 6);
        assert_eq!(news_arrives(5, 0, 2), 7);
        assert_eq!(news_arrives(5, 2, 0), 7);
    }

    #[test]
    fn seeds_start_inside_the_invariant() {
        let q: Vec<(u64, u64)> = SEEDS.iter().map(|s| (s.buy, s.sell)).collect();
        let max_buy = q.iter().map(|x| x.0).max().unwrap();
        let min_sell = q.iter().map(|x| x.1).min().unwrap();
        assert!(max_buy < min_sell);
    }

    #[test]
    fn a_proposal_that_opens_an_arbitrage_is_pulled_back() {
        let mut n = vec![];
        // Pell proposes to buy at 11 while Marta sells at 6: buying from Marta and selling to Pell would pump.
        let others = [(4, 6), (4, 6)];
        let (b, s) = clamp_quotes((5, 7), (Some(11), Some(12)), &others, &mut n);
        assert!(b < 6, "buy {b} must stay below the cheapest sell elsewhere");
        assert!(b < s);
        assert!(!n.is_empty());
    }

    proptest! {
        #[test]
        fn quotes_keep_the_money_pump_invariant_for_any_proposal_sequence(
            steps in proptest::collection::vec((0usize..3, proptest::option::of(0u64..40), proptest::option::of(0u64..40)), 1..80)
        ) {
            let mut q: Vec<(u64, u64)> = SEEDS.iter().map(|s| (s.buy, s.sell)).collect();
            for (m, pb, ps) in steps {
                let others: Vec<(u64, u64)> = q.iter().enumerate().filter(|(i, _)| *i != m).map(|(_, x)| *x).collect();
                let mut n = vec![];
                q[m] = clamp_quotes(q[m], (pb, ps), &others, &mut n);
                let max_buy = q.iter().map(|x| x.0).max().unwrap();
                let min_sell = q.iter().map(|x| x.1).min().unwrap();
                prop_assert!(max_buy < min_sell, "{q:?}");
                prop_assert!(q.iter().all(|x| x.0 >= BUY_MIN && x.1 <= SELL_MAX && x.0 < x.1));
            }
        }

        #[test]
        fn advance_never_exceeds_any_limit(p in 0u64..500, a in 0u64..80, e in 0u64..80, d in 0u64..20, t in 0u64..80, g in 0u64..200) {
            let r = Room { ask: a, exposure: e, daily_loss: d, treasury: t, gold: g };
            let mut n = vec![];
            let out = clamp_advance(p, &r, &mut n);
            prop_assert!(out <= p && out <= a && out <= e && out <= d && out <= t && out <= g);
        }

        #[test]
        fn repay_is_always_within_floor_and_ceiling(a in 0u64..1000, p in 0u64..5000) {
            let mut n = vec![];
            let r = clamp_repay(a, p, &mut n);
            prop_assert!(r >= a && r <= a + a * MAX_INTEREST_PCT / 100);
        }
    }
}
