use anyhow::Result;
use longcon_tests::*;
use serde_json::json;

#[tokio::test]
async fn joining_twice_does_not_mint_a_second_stipend() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let again = failure_text(a.call(w.contract.id(), "join").deposit(join_deposit()).max_gas().transact().await).expect("second join");
    assert!(again.contains("already joined"), "{again}");
    assert_eq!(w.player_view(a.id()).await?["gold"], json!(20));
    assert_eq!(w.audit().await?["minted_gold"], json!(300 + 20));
    Ok(())
}

#[tokio::test]
async fn trades_are_refused_beyond_what_either_side_holds() -> Result<()> {
    let w = World::new(Cfg { treasury: 100, grain: 5, ..Cfg::default() }).await?;
    let a = w.player("alice").await?;
    for (args, needle) in [
        (json!({"merchant": 0, "side": "buy", "qty": 0}), "quantity must be positive"),
        (json!({"merchant": 0, "side": "buy", "qty": 6}), "merchant has not that much grain"),
        (json!({"merchant": 0, "side": "buy", "qty": 4}), "not enough gold"),
        (json!({"merchant": 0, "side": "sell", "qty": 1}), "you do not hold that much grain"),
        (json!({"merchant": 7, "side": "buy", "qty": 1}), "no such merchant"),
    ] {
        let t = failure_text(a.call(w.contract.id(), "trade").args_json(args.clone()).max_gas().transact().await).expect("must fail");
        assert!(t.contains(needle), "{args}: {t}");
    }
    // a merchant that cannot afford the grain refuses to buy it
    let rich = w.owner.clone();
    let _ = rich;
    let before = w.audit().await?;
    assert_eq!(before["players_gold"], json!(20), "failed trades moved nothing");
    Ok(())
}

#[tokio::test]
async fn a_merchant_with_too_little_gold_cannot_buy_grain() -> Result<()> {
    let w = World::new(Cfg { treasury: 3, grain: 50, ..Cfg::default() }).await?;
    let a = w.player("alice").await?;
    a.call(w.contract.id(), "trade").args_json(json!({"merchant": 0, "side": "buy", "qty": 3})).max_gas().transact().await?.into_result()?;
    let t = failure_text(a.call(w.contract.id(), "trade").args_json(json!({"merchant": 2, "side": "sell", "qty": 3})).max_gas().transact().await).expect("Osk holds 3 gold, 3 grain is worth 12");
    assert!(t.contains("merchant cannot pay that much gold"), "{t}");
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn six_offers_a_day_and_then_the_limit() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    for i in 0..6 {
        let out = w.play(&a, (i % 3) as u8, 2, 1, &format!("pitch {i}"), &terms("refuse", 0, 0, 1, "other")).await?;
        assert_eq!(out["status"], json!("refused"));
    }
    let seventh = failure_text(a.call(w.contract.id(), "offer").args_json(json!({"merchant": 0, "ask": 2, "bond": 1, "pitch": "seven"})).max_gas().transact().await).expect("limit");
    assert!(seventh.contains("offer limit for today reached"), "{seventh}");
    w.advance_day(&a).await?.into_result()?;
    let next = w.play(&a, 0, 2, 1, "a new day", &terms("refuse", 0, 0, 1, "other")).await?;
    assert_eq!(next["status"], json!("refused"), "the counter resets with the day");
    Ok(())
}

#[tokio::test]
async fn funding_a_merchant_keeps_the_audit_identity() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    w.owner_call("fund_merchant", json!({"merchant": 1, "gold": 40, "grain": 10})).await?.into_result()?;
    let a = w.audit().await?;
    assert_eq!(a["minted_gold"], json!(340));
    assert_eq!(a["merchants_gold"], json!(340));
    assert_eq!(w.merchant(1).await?["gold"], json!(140));
    let bad = failure_text(w.owner_call("fund_merchant", json!({"merchant": 9, "gold": 1, "grain": 0})).await).expect("no merchant 9");
    assert!(bad.contains("no such merchant"), "{bad}");
    Ok(())
}

#[tokio::test]
async fn the_merchant_queue_holds_sixty_four_offers_and_the_next_one_waits() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let accounts = w.fresh_players("q", 65).await?;
    let id = w.contract.id().clone();
    let mut statuses = vec![];
    for (i, acc) in accounts.iter().take(64).enumerate() {
        let call = acc.call(&id, "offer").args_json(json!({"merchant": 0, "ask": 2, "bond": 1, "pitch": format!("p{i}")})).gas(near_workspaces::types::Gas::from_tgas(100));
        statuses.push(call.transact_async().await?);
    }
    for _ in 0..100 {
        if w.view("queue", json!({"merchant": 0})).await?[0].as_array().unwrap().len() == 64 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    let last = failure_text(
        accounts[64].call(&id, "offer").args_json(json!({"merchant": 0, "ask": 2, "bond": 1, "pitch": "p64"})).gas(near_workspaces::types::Gas::from_tgas(100)).transact().await,
    );
    let q = w.view("queue", json!({"merchant": 0})).await?;
    assert_eq!(q[0].as_array().unwrap().len(), 64);
    let msg = last.expect("the 65th offer must be refused");
    assert!(msg.contains("queue is full"), "{msg}");
    drop(statuses);
    Ok(())
}
