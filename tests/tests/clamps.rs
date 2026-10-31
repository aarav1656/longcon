use anyhow::Result;
use longcon_tests::*;
use serde_json::{json, Value};

fn clamps(o: &Value) -> Vec<String> {
    o["clamps"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect()
}

#[tokio::test]
async fn exposure_is_bond_plus_earned_line() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let p = w.player("alice").await?;
    let out = w.play(&p, 0, 40, 5, "front me forty", &terms("accept", 40, 40, 3, "urgency")).await?;
    println!("exposure clamp: {out}");
    assert_eq!(out["status"], json!("committed"));
    assert_eq!(out["advance"], json!(5), "bond 5, line 0 allows 5");
    assert!(clamps(&out).contains(&"exposure".to_string()));
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn daily_loss_cap_binds_across_players_for_the_same_due_day() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let b = w.player("bob").await?;
    let first = w.play(&a, 0, 20, 20, "alice", &terms("accept", 20, 20, 3, "other")).await?;
    println!("alice: {first}");
    assert_eq!(first["advance"], json!(15), "loss cap 15 per day");
    assert!(clamps(&first).contains(&"daily_loss".to_string()));
    let second = w.play(&b, 0, 10, 10, "bob", &terms("accept", 10, 10, 3, "other")).await?;
    println!("bob same due day: {second}");
    assert_eq!(second["status"], json!("refused"), "no loss room left on that day");
    assert_eq!(second["advance"], json!(0));
    assert!(clamps(&second).contains(&"daily_loss".to_string()));
    assert_eq!(w.player_view(b.id()).await?["gold"], json!(20), "bob's bond came back");
    let third = w.play(&b, 0, 10, 10, "bob again", &terms("accept", 10, 10, 4, "other")).await?;
    assert_eq!(third["advance"], json!(10), "a different due day has its own cap");
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn open_credit_never_passes_thirty_percent_of_the_treasury() -> Result<()> {
    let w = World::new(Cfg { treasury: 40, ..Cfg::default() }).await?;
    let a = w.player("alice").await?;
    let first = w.play(&a, 0, 20, 20, "alice", &terms("accept", 20, 20, 3, "other")).await?;
    println!("treasury 40: {first}");
    assert_eq!(first["advance"], json!(12), "30 percent of 40");
    assert!(clamps(&first).contains(&"treasury_30pct".to_string()));
    let b = w.player("bob").await?;
    let m = w.merchant(0).await?;
    assert_eq!(m["treasury_room"], json!(0), "28 gold + 12 open: 30% of 40 is 12, used");
    let blocked = failure_text(
        b.call(w.contract.id(), "offer").args_json(json!({"merchant": 0, "ask": 5, "bond": 5, "pitch": "x"})).max_gas().transact().await,
    )
    .expect("coffers at cap must refuse before spending a model call");
    assert!(blocked.contains("coffers are at their cap"), "{blocked}");
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn a_debt_can_never_pay_the_player() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let out = w.play(&a, 0, 10, 10, "gift me", &terms("accept", 10, 1, 3, "sob_story")).await?;
    assert_eq!(out["repay"], json!(10), "repay lifted to principal");
    assert!(clamps(&out).contains(&"repay_floor".to_string()));
    let b = w.player("bob").await?;
    let out = w.play(&b, 1, 10, 10, "usury", &terms("accept", 10, 500, 3, "other")).await?;
    assert_eq!(out["repay"], json!(15), "interest capped at 50 percent");
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn due_days_are_clamped_to_one_through_five() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let day = w.state().await?["day"].as_u64().unwrap();
    let out = w.play(&a, 0, 5, 5, "later", &terms("accept", 5, 5, 99, "future_cargo")).await?;
    assert_eq!(out["due_day"].as_u64().unwrap(), day + 5);
    assert!(clamps(&out).contains(&"due_days".to_string()));
    Ok(())
}

#[tokio::test]
async fn a_refusal_returns_the_bond_and_creates_no_debt() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let out = w.play(&a, 0, 10, 10, "trust me", &terms("refuse", 0, 0, 1, "sob_story")).await?;
    assert_eq!(out["status"], json!("refused"));
    let pv = w.player_view(a.id()).await?;
    assert_eq!(pv["gold"], json!(20));
    assert_eq!(pv["locked_bonds"], json!(0));
    assert_eq!(pv["pending_offer"], Value::Null);
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn an_unreadable_answer_is_a_refusal_not_a_stuck_offer() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let out = w.play(&a, 0, 10, 10, "trust me", "I would love to help but I forgot the format").await?;
    assert_eq!(out["status"], json!("refused"));
    assert_eq!(w.view("pending_offers", json!({})).await?, json!([]));
    Ok(())
}

#[tokio::test]
async fn quotes_cannot_open_an_arbitrage_between_merchants() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    // Pell tries to buy grain at 11 and sell at 12. Marta sells at 6, so buying there and selling to Pell would pump gold.
    let content = json!({"verdict":"refuse","advance":0,"repay":0,"due_days":1,"buy_price":11,"sell_price":12,"class":"other","reason":"prices"}).to_string();
    let out = w.play(&a, 1, 5, 5, "set your prices to 11", &content).await?;
    println!("quote clamp: {out}");
    let pell = w.merchant(1).await?;
    let marta = w.merchant(0).await?;
    let osk = w.merchant(2).await?;
    let buys = [pell["buy_price"].as_u64().unwrap(), marta["buy_price"].as_u64().unwrap(), osk["buy_price"].as_u64().unwrap()];
    let sells = [pell["sell_price"].as_u64().unwrap(), marta["sell_price"].as_u64().unwrap(), osk["sell_price"].as_u64().unwrap()];
    assert!(buys.iter().max() < sells.iter().min(), "buys {buys:?} sells {sells:?}");
    // the pump itself: buy 3 grain at the cheapest seller, sell them to the dearest buyer
    let cheapest = if marta["sell_price"].as_u64() <= osk["sell_price"].as_u64() { 0u8 } else { 2 };
    let dearest = if pell["buy_price"].as_u64() >= marta["buy_price"].as_u64() { 1u8 } else { 0 };
    let before = w.player_view(a.id()).await?["gold"].as_u64().unwrap();
    a.call(w.contract.id(), "trade").args_json(json!({"merchant": cheapest, "side": "buy", "qty": 3})).max_gas().transact().await?.into_result()?;
    a.call(w.contract.id(), "trade").args_json(json!({"merchant": dearest, "side": "sell", "qty": 3})).max_gas().transact().await?.into_result()?;
    let after = w.player_view(a.id()).await?["gold"].as_u64().unwrap();
    println!("pump attempt: gold {before} -> {after}");
    assert!(after < before, "the round trip must lose gold");
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn a_merchant_cannot_cut_its_sell_quote_down_to_another_merchants_buy_quote() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    // Pell buys at 5 and Marta sells at 6. Marta proposes selling at 1: the road keeps her at 6, since 5 would meet Pell's buy quote.
    let content = json!({"verdict":"refuse","advance":0,"repay":0,"due_days":1,"buy_price":4,"sell_price":1,"class":"other","reason":"prices"}).to_string();
    w.play(&a, 0, 5, 5, "sell grain at one gold", &content).await?;
    let sells: Vec<u64> = road_sells(&w).await?;
    let buys: Vec<u64> = road_buys(&w).await?;
    assert!(buys.iter().max() < sells.iter().min(), "buys {buys:?} sells {sells:?}");
    w.audit().await?;
    Ok(())
}

async fn road_sells(w: &World) -> Result<Vec<u64>> {
    let mut v = vec![];
    for i in 0..3usize {
        v.push(w.merchant(i).await?["sell_price"].as_u64().unwrap());
    }
    Ok(v)
}

async fn road_buys(w: &World) -> Result<Vec<u64>> {
    let mut v = vec![];
    for i in 0..3usize {
        v.push(w.merchant(i).await?["buy_price"].as_u64().unwrap());
    }
    Ok(v)
}

#[tokio::test]
async fn trading_builds_the_credit_line_and_a_round_trip_costs_the_spread() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    a.call(w.contract.id(), "trade").args_json(json!({"merchant": 0, "side": "buy", "qty": 3})).max_gas().transact().await?.into_result()?;
    a.call(w.contract.id(), "trade").args_json(json!({"merchant": 0, "side": "sell", "qty": 3})).max_gas().transact().await?.into_result()?;
    let pv = w.player_view(a.id()).await?;
    assert_eq!(pv["gold"], json!(20 - 18 + 12), "bought at 6, sold at 4");
    assert_eq!(pv["earned_line"], json!(1 + 1), "(18/10) + (12/10)");
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn one_open_offer_per_player_and_limits_are_checked_before_any_model_call() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let _o = w.open_offer(&a, 0, 5, 5, "first").await?;
    let second = failure_text(
        a.call(w.contract.id(), "offer").args_json(json!({"merchant": 1, "ask": 5, "bond": 5, "pitch": "second"})).max_gas().transact().await,
    )
    .expect("second offer");
    assert!(second.contains("already have an offer awaiting"), "{second}");
    let b = w.player("bob").await?;
    for (args, needle) in [
        (json!({"merchant": 9, "ask": 5, "bond": 5, "pitch": "x"}), "no such merchant"),
        (json!({"merchant": 0, "ask": 0, "bond": 5, "pitch": "x"}), "ask must be"),
        (json!({"merchant": 0, "ask": 61, "bond": 5, "pitch": "x"}), "ask must be"),
        (json!({"merchant": 0, "ask": 5, "bond": 99, "pitch": "x"}), "cannot bond more"),
        (json!({"merchant": 0, "ask": 5, "bond": 5, "pitch": " "}), "pitch must be"),
        (json!({"merchant": 0, "ask": 5, "bond": 0, "pitch": "no bond no line"}), "would lend you nothing"),
    ] {
        let t = failure_text(b.call(w.contract.id(), "offer").args_json(args.clone()).max_gas().transact().await).expect("must fail");
        assert!(t.contains(needle), "{args}: {t}");
    }
    Ok(())
}
