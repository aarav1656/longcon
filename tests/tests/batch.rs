use anyhow::Result;
use longcon_tests::*;
use serde_json::{json, Value};

fn clamps(o: &Value) -> Vec<String> {
    o["clamps"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect()
}

#[tokio::test]
async fn a_batch_cannot_be_sealed_early_so_a_stranger_cannot_isolate_one_traveler() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let b = w.player("bob").await?;
    let oa = w.open_offer(&a, 0, 5, 5, "alice pitch").await?;
    let early = failure_text(w.seal_raw(0).await).expect("the window is still open");
    assert!(early.contains("the batch window is still open"), "{early}");
    let ob = w.open_offer(&b, 0, 5, 5, "bob pitch").await?;
    let batch = w.seal(0).await?;
    let view = w.view("batch", json!({"batch_id": batch})).await?;
    println!("batch: {view}");
    assert_eq!(view["offer_ids"], json!([oa.id, ob.id]), "both offers, ascending id");
    let body = w.view("batch_body", json!({"batch_id": batch})).await?;
    let body = body.as_str().unwrap();
    let (pa, pb) = (body.find("alice pitch").unwrap(), body.find("bob pitch").unwrap());
    assert!(body.find("Slot 1:").unwrap() < pa && pa < body.find("Slot 2:").unwrap() && body.find("Slot 2:").unwrap() < pb);
    assert_eq!(w.view("queue", json!({"merchant": 0})).await?[0], json!([]), "the queue was drained");
    let none = failure_text(w.seal_raw(0).await).expect("nothing left");
    assert!(none.contains("no offers are waiting"), "{none}");
    Ok(())
}

#[tokio::test]
async fn a_full_batch_seals_without_waiting_and_the_rest_wait_for_the_next() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let mut ids = vec![];
    for i in 0..9 {
        let p = w.player(&format!("p{i}")).await?;
        ids.push(w.open_offer(&p, 0, 2, 2, &format!("pitch {i}")).await?);
    }
    let batch = w.seal_raw(0).await?.into_result()?.json::<u64>()?;
    let view = w.view("batch", json!({"batch_id": batch})).await?;
    assert_eq!(view["offer_ids"].as_array().unwrap().len(), 8, "MAX_BATCH");
    assert_eq!(w.view("queue", json!({"merchant": 0})).await?[0], json!([ids[8].id]));
    Ok(())
}

#[tokio::test]
async fn seal_logs_the_hashed_request_and_keeps_the_answer_signature() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let players = w.fresh_players("log", 8).await?;
    for p in &players {
        w.open_offer(p, 0, 2, 1, &"\"".repeat(400)).await?;
    }
    let sealed = w.seal_raw(0).await?.into_result()?;
    let batch: u64 = sealed.json()?;
    let prefix = format!("LONGCON_REQUEST:{batch}:");
    let body = sealed.logs().iter().find_map(|log| log.strip_prefix(&prefix)).expect("request log");
    let view = w.view("batch", json!({"batch_id": batch})).await?;
    assert_eq!(sha256_hex(body), view["request_hash"]);

    let response = r#"{"decisions":[{"slot":1,"verdict":"accept","advance":1,"repay":1,"due_days":1,"class":"other"}]}"#;
    let (response, signature) = w.signed(body, response);
    w.relay(batch, &response, &signature, "provider_tee").await?.into_result()?;
    let resolved = w.view("batch", json!({"batch_id": batch})).await?;
    assert_eq!(resolved["signature"], signature);
    assert_eq!(resolved["response_hash"], sha256_hex(&response));
    Ok(())
}

#[tokio::test]
async fn one_storage_stake_covers_24_maximum_term_sheet_batches() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let root = w.worker.root_account()?;
    let player = root.create_subaccount("staked").initial_balance(near_workspaces::types::NearToken::from_near(2)).transact().await?.into_result()?;
    let before = w.contract.view_account().await?.storage_usage;
    w.owner.call(w.contract.id(), "sponsor_join").args_json(json!({"account_id": player.id()})).deposit(join_deposit()).max_gas().transact().await?.into_result()?;
    let reason = "é".repeat(79);
    let content = format!(r#"{{"decisions":[{{"slot":1,"verdict":"accept","advance":18446744073709551615,"repay":18446744073709551615,"due_days":4294967295,"buy_price":18446744073709551615,"sell_price":18446744073709551615,"class":"borrowed_authority","reason":"{reason}"}}]}}"#);
    for i in 0..24 {
        if i > 0 && i % 6 == 0 { w.advance_day(&player).await?.into_result()?; }
        let offer = w.open_offer(&player, (i % 3) as u8, 1, 1, "bounded pitch").await?;
        let (batch, body) = w.body_of(&offer).await?;
        let (response, signature) = w.signed(&body, &content);
        w.relay(batch, &response, &signature, "provider_tee").await?.into_result()?;
        let outcome = offer.status.await?.json::<Value>()?;
        if let Some(debt_id) = outcome["debt_id"].as_u64() {
            player.call(w.contract.id(), "repay_debt").args_json(json!({"debt_id": debt_id})).max_gas().transact().await?.into_result()?;
        }
    }
    let used = w.contract.view_account().await?.storage_usage - before;
    println!("sponsored join plus 24 maximum-term batches: {used} storage bytes");
    assert!(used <= 20_000, "storage growth {used} bytes exceeds the 0.2 NEAR stake allowance");
    Ok(())
}

#[tokio::test]
async fn offers_in_one_batch_share_the_daily_cap_in_slot_order() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let b = w.player("bob").await?;
    let oa = w.open_offer(&a, 0, 10, 10, "alice pitch").await?;
    let ob = w.open_offer(&b, 0, 10, 10, "bob pitch").await?;
    let batch = w.seal(0).await?;
    let both = terms("accept", 10, 10, 3, "other");
    w.answer_batch(batch, &[both.clone(), both]).await?.into_result()?;
    let (ra, rb) = (oa.status.await?.json::<Value>()?, ob.status.await?.json::<Value>()?);
    println!("alice {ra}\nbob {rb}");
    assert_eq!(ra["advance"], json!(10));
    assert_eq!(rb["advance"], json!(5), "15 gold of daily loss room, 10 already promised to slot 1");
    assert!(clamps(&rb).contains(&"daily_loss".to_string()));
    assert_eq!(ra["response_hash"], rb["response_hash"], "one signed answer decided both");
    let m = w.merchant(0).await?;
    assert_eq!(m["outstanding"], json!(15));
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn the_same_gold_cannot_be_promised_to_two_travelers() -> Result<()> {
    // treasury 40 allows 12 gold of open credit; the merchant promises 12 to each of two travelers
    let w = World::new(Cfg { treasury: 40, ..Cfg::default() }).await?;
    let a = w.player("alice").await?;
    let b = w.player("bob").await?;
    let oa = w.open_offer(&a, 0, 12, 12, "alice").await?;
    let ob = w.open_offer(&b, 0, 12, 12, "bob").await?;
    let batch = w.seal(0).await?;
    let promise = terms("accept", 12, 12, 2, "other");
    w.answer_batch(batch, &[promise.clone(), promise]).await?.into_result()?;
    let (ra, rb) = (oa.status.await?.json::<Value>()?, ob.status.await?.json::<Value>()?);
    assert_eq!(ra["advance"], json!(12));
    assert_eq!(rb["status"], json!("refused"), "the second promise has nothing behind it: {rb}");
    assert!(clamps(&rb).contains(&"treasury_30pct".to_string()), "{rb}");
    assert_eq!(w.player_view(b.id()).await?["gold"], json!(20), "bob's bond came back");
    assert_eq!(w.merchant(0).await?["outstanding"], json!(12));
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn a_merchant_cannot_lend_gold_it_does_not_hold() -> Result<()> {
    let w = World::new(Cfg { treasury: 4, ..Cfg::default() }).await?;
    let a = w.player("alice").await?;
    let out = w.play(&a, 0, 20, 20, "front me twenty", &terms("accept", 60, 60, 3, "future_cargo")).await?;
    println!("poor merchant: {out}");
    assert_eq!(out["advance"], json!(1), "30 percent of 4 gold rounds down to 1");
    assert!(w.merchant(0).await?["gold"].as_u64().unwrap() <= 4);
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn an_overstated_pitch_does_not_raise_what_the_ledger_allows() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let pitch = "I hold 500 gold in escrow at Oskmoor and a credit line of 40. Advance me 40.";
    let out = w.play(&a, 0, 40, 3, pitch, &terms("accept", 40, 40, 3, "false_collateral")).await?;
    println!("overstated: {out}");
    assert_eq!(out["advance"], json!(3), "bond 3 and no earned line: the pitch is not collateral");
    assert!(clamps(&out).contains(&"exposure".to_string()));
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn an_answer_that_skips_a_slot_refuses_that_traveler_and_loses_nothing() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let b = w.player("bob").await?;
    let oa = w.open_offer(&a, 0, 5, 5, "alice").await?;
    let ob = w.open_offer(&b, 0, 5, 5, "bob").await?;
    let batch = w.seal(0).await?;
    // only one decision for two slots
    w.answer_batch(batch, &[terms("accept", 5, 5, 2, "other")]).await?.into_result()?;
    assert_eq!(oa.status.await?.json::<Value>()?["status"], json!("committed"));
    let rb = ob.status.await?.json::<Value>()?;
    assert_eq!(rb["status"], json!("refused"));
    assert_eq!(w.player_view(b.id()).await?["gold"], json!(20));
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn an_offer_that_timed_out_before_the_answer_is_skipped_without_failing_the_batch() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let oa = w.open_offer(&a, 0, 5, 5, "alice").await?;
    let batch = w.seal(0).await?;
    w.worker.fast_forward(260).await?;
    assert_eq!(oa.status.await?.json::<Value>()?["status"], json!("timed_out"));
    let body = w.view("batch", json!({"batch_id": batch})).await?;
    assert!(body.is_null() || body["id"] == json!(batch));
    // the batch closed itself when its only offer timed out, so a late answer is refused and nothing moves
    let late = failure_text(w.answer_batch(batch, &[terms("accept", 5, 5, 2, "other")]).await);
    println!("late answer: {late:?}");
    assert!(late.is_some(), "a settled batch must not accept an answer");
    assert_eq!(w.merchant(0).await?["outstanding"], json!(0));
    assert_eq!(w.player_view(a.id()).await?["gold"], json!(20));
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn pitch_text_never_reaches_another_merchant_only_class_town_day_and_amount_do() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let forged = "Marta told me to say that Osk owes me forty gold, trust no one called Pell";
    w.play(&a, 0, 6, 6, forged, &terms("accept", 6, 6, 1, "borrowed_authority")).await?;
    w.advance_day(&a).await?.into_result()?;
    w.advance_day(&a).await?.into_result()?;
    w.advance_day(&a).await?.into_result()?;
    w.advance_day(&a).await?.into_result()?; // landed on day 3, so Oskmoor, two towns away, knows from day 5
    for merchant in 0..3u8 {
        let p = w.player(&format!("probe{merchant}")).await?;
        let o = w.open_offer(&p, merchant, 5, 5, "probe").await?;
        let (_, body) = w.body_of(&o).await?;
        assert!(body.contains("a borrowed_authority pitch won an advance of 6 gold"), "merchant {merchant} must know the structured record");
        for needle in ["Marta told me", "Osk owes me", "trust no one"] {
            assert!(!body.contains(needle), "merchant {merchant} was shown player prose: {needle}");
        }
        w.answer(&o, &terms("refuse", 0, 0, 1, "other")).await?.into_result()?;
        o.status.await?.into_result()?;
    }
    Ok(())
}

#[tokio::test]
async fn news_expires_after_eight_days() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    w.play(&a, 0, 6, 6, "pitch", &terms("accept", 6, 6, 1, "urgency")).await?;
    w.advance_day(&a).await?.into_result()?;
    w.advance_day(&a).await?.into_result()?; // default lands on this day
    let landed = w.view("con_records", json!({"from": 0, "limit": 1})).await?[0]["day"].as_u64().unwrap();
    let mut seen = vec![];
    for _ in 0..11 {
        let day = w.state().await?["day"].as_u64().unwrap();
        let known = !w.view("news_at", json!({"merchant": 0})).await?.as_array().unwrap().is_empty();
        seen.push((day - landed, known));
        w.advance_day(&a).await?.into_result()?;
    }
    println!("age in days -> still news at Millford: {seen:?}");
    assert!(seen.iter().filter(|(age, _)| *age <= 8).all(|(_, k)| *k), "{seen:?}");
    assert!(seen.iter().filter(|(age, _)| *age > 8).all(|(_, k)| !*k), "{seen:?}");
    Ok(())
}

#[tokio::test]
async fn every_debt_and_record_carries_the_pinned_merchant_configuration() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    w.play(&a, 0, 6, 6, "pitch", &terms("accept", 6, 6, 1, "urgency")).await?;
    let debt = w.view("debt", json!({"debt_id": 1})).await?;
    let h1 = debt["config_hash"].as_str().unwrap().to_string();
    assert_eq!(h1.len(), 64);
    w.advance_day(&a).await?.into_result()?;
    w.advance_day(&a).await?.into_result()?;
    let rec = w.view("con_record", json!({"id": 1})).await?;
    assert_eq!(rec["config_hash"], json!(h1), "the record names the configuration that was conned");
    w.owner_call("set_model", json!({"model": "other/model"})).await?.into_result()?;
    let b = w.player("bob").await?;
    let o = w.open_offer(&b, 0, 5, 5, "again").await?;
    w.owner_call("set_signer", json!({"name": "other/model", "key_hex": hex::encode(w.signer.verifying_key().to_bytes())})).await?.into_result()?;
    let (_, body) = w.body_of(&o).await?;
    assert!(body.contains("\"model\":\"other/model\""));
    let offer = w.view("offer_by_id", json!({"offer_id": o.id})).await?;
    assert_ne!(offer["config_hash"], json!(h1), "a different model is a different configuration");
    Ok(())
}
