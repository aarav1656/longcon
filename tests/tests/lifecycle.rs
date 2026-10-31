use anyhow::Result;
use longcon_tests::*;
use rand::{rngs::StdRng, Rng, SeedableRng};
use serde_json::{json, Value};

#[tokio::test]
async fn a_merchant_that_never_answers_times_out_and_the_bond_comes_back() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let o = w.open_offer(&a, 0, 5, 7, "nobody will answer this").await?;
    assert_eq!(w.player_view(a.id()).await?["locked_bonds"], json!(7));
    w.worker.fast_forward(260).await?;
    let out = o.status.await?.json::<Value>()?;
    println!("timeout outcome: {out}");
    assert_eq!(out["status"], json!("timed_out"));
    let pv = w.player_view(a.id()).await?;
    assert_eq!(pv["gold"], json!(20));
    assert_eq!(pv["locked_bonds"], json!(0));
    assert_eq!(pv["pending_offer"], Value::Null);
    assert_eq!(w.view("pending_offers", json!({})).await?, json!([]));
    let sealed = failure_text(w.seal_raw(0).await).expect("a timed-out offer leaves the queue");
    assert!(sealed.contains("no offers are waiting"), "{sealed}");
    let late = failure_text(w.relay(1, "{}", &"00".repeat(64), "provider_tee").await).expect("nothing was ever sealed");
    assert!(late.contains("no such batch"), "{late}");
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn a_default_burns_the_bond_books_the_loss_and_writes_a_con_record() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let out = w.play(&a, 0, 8, 8, "caravan on day 4", &terms("accept", 8, 9, 1, "future_cargo")).await?;
    assert_eq!(out["status"], json!("committed"));
    let day = w.state().await?["day"].as_u64().unwrap();
    assert_eq!(out["due_day"].as_u64().unwrap(), day + 1);
    w.advance_day(&a).await?.into_result()?; // day -> day+1, debt not yet due-past
    assert_eq!(w.view("con_records", json!({"from": 0, "limit": 10})).await?, json!([]), "still repayable on the due day");
    w.advance_day(&a).await?.into_result()?; // due day over: default
    let recs = w.view("con_records", json!({"from": 0, "limit": 10})).await?;
    println!("con record: {}", recs[0]);
    assert_eq!(recs.as_array().unwrap().len(), 1);
    assert_eq!(recs[0]["class"], json!("future_cargo"));
    assert_eq!(recs[0]["loss"], json!(8));
    assert_eq!(recs[0]["bond_burned"], json!(8));
    assert_eq!(recs[0]["town"], json!(0));
    assert_eq!(recs[0]["request_hash"].as_str().unwrap().len(), 64);
    assert_eq!(recs[0]["response_hash"].as_str().unwrap().len(), 64);
    let audit = w.audit().await?;
    assert_eq!(audit["burned_gold"], json!(8));
    let m = w.merchant(0).await?;
    assert_eq!(m["lost_total"], json!(8));
    assert_eq!(m["outstanding"], json!(0));
    let pv = w.player_view(a.id()).await?;
    assert_eq!(pv["cons_landed"], json!(1));
    assert_eq!(pv["locked_bonds"], json!(0));
    assert_eq!(pv["gold"], json!(20), "20 - 8 bond + 8 advance: the bond is the price of the con");
    let late = failure_text(a.call(w.contract.id(), "repay_debt").args_json(json!({"debt_id": 1})).max_gas().transact().await).expect("defaulted debt");
    assert!(late.contains("debt is not open"), "{late}");
    Ok(())
}

#[tokio::test]
async fn repaying_returns_the_bond_and_grows_the_credit_line() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    w.play(&a, 0, 8, 8, "honest loan", &terms("accept", 8, 10, 2, "other")).await?;
    a.call(w.contract.id(), "repay_debt").args_json(json!({"debt_id": 1})).max_gas().transact().await?.into_result()?;
    let pv = w.player_view(a.id()).await?;
    assert_eq!(pv["gold"], json!(18), "20 + 8 advance - 8 bond - 10 repay + 8 bond back");
    assert_eq!(pv["earned_line"], json!(4));
    assert_eq!(pv["outstanding"], json!(0));
    assert_eq!(pv["open_debts"], json!([]));
    assert_eq!(w.merchant(0).await?["gold"], json!(102));
    // the earned line now lets a smaller bond carry a bigger advance
    let out = w.play(&a, 0, 10, 2, "second loan", &terms("accept", 10, 10, 2, "other")).await?;
    assert_eq!(out["advance"], json!(6), "bond 2 + line 4");
    w.audit().await?;
    // and the debt cannot be repaid by someone else or twice
    let b = w.player("bob").await?;
    let t = failure_text(b.call(w.contract.id(), "repay_debt").args_json(json!({"debt_id": 2})).max_gas().transact().await).expect("not bob's");
    assert!(t.contains("not your debt"), "{t}");
    Ok(())
}

#[tokio::test]
async fn news_of_a_landed_con_travels_one_town_per_day() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    w.play(&a, 0, 6, 6, "future cargo pitch", &terms("accept", 6, 6, 1, "future_cargo")).await?;
    w.advance_day(&a).await?.into_result()?;
    w.advance_day(&a).await?.into_result()?;
    let landed = w.view("con_records", json!({"from": 0, "limit": 5})).await?[0]["day"].as_u64().unwrap();
    let day = w.state().await?["day"].as_u64().unwrap();
    assert_eq!(landed, day, "record is dated the day it landed");

    let marker = "a future_cargo pitch won an advance of 6 gold";
    for step in 0..3u64 {
        let mut row = vec![];
        for (merchant, name) in [(0u8, "Marta"), (1, "Pell"), (2, "Osk")] {
            let news = w.view("news_at", json!({"merchant": merchant})).await?;
            // the prompt the model would receive on this day, read from a real pending offer
            let p = w.player(&format!("probe{step}{merchant}")).await?;
            let o = w.open_offer(&p, merchant, 5, 5, "probe").await?;
            let (_, body) = w.body_of(&o).await?;
            let in_prompt = body.contains(marker);
            assert_eq!(!news.as_array().unwrap().is_empty(), in_prompt, "news_at and the prompt must agree for {name}");
            row.push((name, in_prompt));
            // settle the probe so the next one can open
            w.answer(&o, &terms("refuse", 0, 0, 1, "other")).await?.into_result()?;
            o.status.await?;
        }
        println!("day {}: {row:?}", day + step);
        let expect = [step >= 0, step >= 1, step >= 2];
        assert_eq!(row.iter().map(|r| r.1).collect::<Vec<_>>(), expect, "step {step}");
        w.advance_day(&a).await?.into_result()?;
    }
    Ok(())
}

#[tokio::test]
async fn the_day_cannot_be_forced_before_it_ends_or_by_strangers() -> Result<()> {
    let w = World::new(Cfg { day_length_ms: 3_600_000, ..Cfg::default() }).await?;
    let a = w.player("alice").await?;
    let early = failure_text(w.advance_day(&a).await).expect("day not over");
    assert!(early.contains("the day has not ended yet"), "{early}");
    let stranger = w.worker.root_account()?.create_subaccount("stranger").initial_balance(near_workspaces::types::NearToken::from_near(2)).transact().await?.into_result()?;
    let t = failure_text(w.advance_day(&stranger).await).expect("stranger");
    assert!(t.contains("join the road first"), "{t}");
    w.owner_call("set_day_length_ms", json!({"day_length_ms": 0})).await?.into_result()?;
    w.advance_day(&a).await?.into_result()?;
    assert_eq!(w.state().await?["day"], json!(2));
    Ok(())
}

#[tokio::test]
async fn gold_and_grain_are_conserved_across_random_play() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let mut rng = StdRng::seed_from_u64(7);
    let mut players = vec![];
    for i in 0..4 {
        players.push(w.player(&format!("rp{i}")).await?);
    }
    let classes = ["future_cargo", "borrowed_authority", "sob_story", "urgency", "false_collateral", "other"];
    let mut committed = 0;
    for step in 0..40 {
        let p = &players[rng.gen_range(0..players.len())];
        match rng.gen_range(0..5) {
            0 => {
                let side = if rng.gen_bool(0.5) { "buy" } else { "sell" };
                let _ = p.call(w.contract.id(), "trade").args_json(json!({"merchant": rng.gen_range(0..3), "side": side, "qty": rng.gen_range(1..4)})).max_gas().transact().await;
            }
            1 | 2 => {
                let bond = rng.gen_range(1..10u64);
                let ask = rng.gen_range(1..40u64);
                let verdict = if rng.gen_bool(0.7) { "accept" } else { "refuse" };
                let content = json!({
                    "verdict": verdict, "advance": rng.gen_range(0..50), "repay": rng.gen_range(0..60), "due_days": rng.gen_range(0..9),
                    "buy_price": rng.gen_range(0..14), "sell_price": rng.gen_range(0..14),
                    "class": classes[rng.gen_range(0..classes.len())], "reason": "r"
                }).to_string();
                if let Ok(o) = w.open_offer(p, rng.gen_range(0..3), ask, bond, &format!("pitch {step}")).await {
                    w.answer(&o, &content).await?.into_result()?;
                    let out = o.status.await?.json::<Value>()?;
                    if out["status"] == json!("committed") { committed += 1; }
                }
            }
            3 => {
                let pv = w.player_view(p.id()).await?;
                if let Some(d) = pv["open_debts"].as_array().and_then(|d| d.first()) {
                    let _ = p.call(w.contract.id(), "repay_debt").args_json(json!({"debt_id": d})).max_gas().transact().await;
                }
            }
            _ => {
                let _ = w.advance_day(p).await;
            }
        }
        w.audit().await?;
    }
    let a = w.audit().await?;
    println!("after 40 random steps: committed {committed}, audit {a}");
    assert!(committed > 0, "the run must have exercised commits, or conservation proves nothing");
    // daily loss never exceeded on any merchant/day
    let recs = w.view("con_records", json!({"from": 0, "limit": 50})).await?;
    let mut by: std::collections::BTreeMap<(u64, u64), u64> = Default::default();
    for r in recs.as_array().unwrap() {
        *by.entry((r["merchant"].as_u64().unwrap(), r["day"].as_u64().unwrap())).or_default() += r["loss"].as_u64().unwrap();
    }
    println!("cons landed {} ; loss by (merchant, day) {by:?}", recs.as_array().unwrap().len());
    assert!(by.values().all(|v| *v <= 15), "{by:?}");
    Ok(())
}
