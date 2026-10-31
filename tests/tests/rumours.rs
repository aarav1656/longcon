use anyhow::Result;
use longcon_tests::*;
use near_workspaces::types::NearToken;
use serde_json::json;

async fn land_a_con(w: &World, who: &near_workspaces::Account, class: &str, merchant: u8, amount: u64) -> Result<()> {
    w.play(who, merchant, amount, amount, "a pitch", &terms("accept", amount, amount, 1, class)).await?;
    w.advance_day(who).await?.into_result()?;
    w.advance_day(who).await?.into_result()?;
    Ok(())
}

#[tokio::test]
async fn a_landed_con_mints_a_rumour_and_takes_the_board_only_first() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let b = w.player("bob").await?;
    land_a_con(&w, &a, "future_cargo", 0, 6).await?;
    let id = "rumour:future_cargo";
    let bal = w.view("mt_balance_of", json!({"account_id": a.id(), "token_id": id})).await?;
    assert_eq!(bal, json!("1"));
    assert_eq!(w.view("mt_supply", json!({"token_id": id})).await?, json!("1"));
    assert_eq!(w.view("mt_supply", json!({"token_id": "rumour:sob_story"})).await?, serde_json::Value::Null);
    land_a_con(&w, &b, "future_cargo", 1, 5).await?;
    land_a_con(&w, &b, "sob_story", 2, 4).await?;
    let board = w.view("wanted", json!({})).await?;
    println!("wanted board: {board}");
    let rows = board.as_array().unwrap();
    assert_eq!(rows.len(), 2);
    let fc = rows.iter().find(|r| r["class"] == json!("future_cargo")).unwrap();
    assert_eq!(fc["first_player"], json!(a.id()), "alice landed it first");
    assert_eq!(fc["landed"], json!(2));
    assert_eq!(w.view("mt_supply", json!({"token_id": id})).await?, json!("2"));
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn rumours_transfer_with_one_yocto_and_not_without_a_balance() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let b = w.player("bob").await?;
    land_a_con(&w, &a, "urgency", 0, 6).await?;
    let id = "rumour:urgency";
    let no_deposit = failure_text(a.call(w.contract.id(), "mt_transfer").args_json(json!({"receiver_id": b.id(), "token_id": id, "amount": "1"})).max_gas().transact().await).expect("needs 1 yocto");
    assert!(no_deposit.contains("Requires attached deposit of exactly 1 yoctoNEAR"), "{no_deposit}");
    let r = a.call(w.contract.id(), "mt_transfer").args_json(json!({"receiver_id": b.id(), "token_id": id, "amount": "1"})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    assert!(r.is_success(), "{:?}", r.failures());
    assert!(r.logs().iter().any(|l| l.contains("\"standard\":\"nep245\"") && l.contains("mt_transfer")), "{:?}", r.logs());
    assert_eq!(w.view("mt_balance_of", json!({"account_id": a.id(), "token_id": id})).await?, json!("0"));
    assert_eq!(w.view("mt_balance_of", json!({"account_id": b.id(), "token_id": id})).await?, json!("1"));
    let overspend = failure_text(a.call(w.contract.id(), "mt_transfer").args_json(json!({"receiver_id": b.id(), "token_id": id, "amount": "1"})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await).expect("alice has none left");
    assert!(overspend.contains("not enough rumours"), "{overspend}");
    Ok(())
}
