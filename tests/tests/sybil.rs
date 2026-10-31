use anyhow::Result;
use futures::future::join_all;
use longcon_tests::*;
use near_workspaces::types::NearToken;
use serde_json::{json, Value};

/// Every sub-account a player uses is a fresh identity, so the bound has to come from the ledger and
/// not from who is asking.
async fn fresh_players(w: &World, prefix: &str, n: usize) -> Result<Vec<near_workspaces::Account>> {
    let root = w.worker.root_account()?;
    let mut out = vec![];
    for chunk in (0..n).collect::<Vec<_>>().chunks(25) {
        let mut accs = vec![];
        for i in chunk {
            // one signer, so creation is sequential; the joins below are parallel because each account signs its own
            accs.push(root.create_subaccount(&format!("{prefix}{i}")).initial_balance(NearToken::from_millinear(300)).transact().await?.into_result()?);
        }
        let id = w.contract.id().clone();
        let joined = join_all(accs.iter().map(|a| a.call(&id, "join").gas(near_workspaces::types::Gas::from_tgas(30)).transact())).await;
        for j in joined {
            j?.into_result()?;
        }
        out.extend(accs);
    }
    Ok(out)
}

/// One wave: every account queues an offer, then the road seals and answers batch after batch.
async fn run_wave(w: &World, accounts: &[near_workspaces::Account], merchant: u8, decision: &str) -> Result<Vec<Value>> {
    let id = w.contract.id().clone();
    let mut statuses = vec![];
    for (i, a) in accounts.iter().enumerate() {
        statuses.push(
            a.call(&id, "offer")
                .args_json(json!({"merchant": merchant, "ask": 15, "bond": 15, "pitch": format!("sybil pitch {i}")}))
                .gas(near_workspaces::types::Gas::from_tgas(150))
                .transact_async()
                .await?,
        );
    }
    for _ in 0..200 {
        let q = w.view("queue", json!({"merchant": merchant})).await?;
        if q[0].as_array().unwrap().len() == accounts.len() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    assert_eq!(w.view("queue", json!({"merchant": merchant})).await?[0].as_array().unwrap().len(), accounts.len(), "every offer queued");
    w.worker.fast_forward(BATCH_WINDOW_BLOCKS + 1).await?;
    loop {
        let q = w.view("queue", json!({"merchant": merchant})).await?;
        let n = q[0].as_array().unwrap().len();
        if n == 0 {
            break;
        }
        let batch = w.seal_raw(merchant).await?.into_result()?.json::<u64>()?;
        let slots = w.view("batch", json!({"batch_id": batch})).await?["offer_ids"].as_array().unwrap().len();
        let all = vec![decision.to_string(); slots];
        w.answer_batch(batch, &all).await?.into_result()?;
    }
    let mut outcomes = vec![];
    for s in statuses {
        outcomes.push(s.await?.json::<Value>()?);
    }
    Ok(outcomes)
}

#[tokio::test]
async fn a_thousand_fresh_accounts_cannot_take_more_than_the_daily_cap_from_one_merchant() -> Result<()> {
    let n: usize = std::env::var("SYBIL_ACCOUNTS").ok().and_then(|v| v.parse().ok()).unwrap_or(1000);
    let w = World::new(Cfg::default()).await?;
    let accounts = fresh_players(&w, "sy", n).await?;
    let decision = terms("accept", 15, 15, 1, "future_cargo");
    let mut committed = 0u64;
    let mut principal = 0u64;
    let mut refused_daily = 0u64;
    for wave in accounts.chunks(64) {
        for o in run_wave(&w, wave, 0, &decision).await? {
            if o["status"] == json!("committed") {
                committed += 1;
                principal += o["advance"].as_u64().unwrap();
            } else if o["clamps"].as_array().map(|c| c.contains(&json!("daily_loss"))).unwrap_or(false) {
                refused_daily += 1;
            }
        }
    }
    let m = w.merchant(0).await?;
    println!("sybil: {n} accounts, {committed} advances committed totalling {principal}, {refused_daily} stopped by the daily cap, merchant outstanding {}", m["outstanding"]);
    assert!(committed >= 1, "the attack must land at least once or the cap proves nothing");
    assert!(refused_daily + committed >= (n as u64) / 2, "most accounts must have reached the cap check");
    assert!(principal <= 15, "all of these debts fall due on one day, so the cap is 15");
    w.audit().await?;
    // everyone defaults
    w.advance_day(&w.owner).await?.into_result()?;
    w.advance_day(&w.owner).await?.into_result()?;
    let m = w.merchant(0).await?;
    println!("after defaults: merchant gold {} lost_total {}", m["gold"], m["lost_total"]);
    assert!(m["lost_total"].as_u64().unwrap() <= 15);
    assert_eq!(m["gold"], json!(100 - principal));
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn a_player_who_defaults_every_time_costs_a_merchant_at_most_the_cap_per_day() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let mut crew = vec![];
    for i in 0..3 {
        crew.push(w.player(&format!("crook{i}")).await?);
    }
    let decision = terms("accept", 15, 15, 1, "borrowed_authority");
    let mut total_burned = 0;
    for day in 0..4 {
        for c in &crew {
            // a crook who defaulted already holds no bond and little gold; skip the ones who cannot post one
            let gold = w.player_view(c.id()).await?["gold"].as_u64().unwrap();
            if gold < 5 {
                continue;
            }
            let out = w.play(c, 0, 15, 5, "the same pitch again", &decision).await?;
            println!("day {day} {}: {}", c.id(), out["status"]);
        }
        w.advance_day(&crew[0]).await?.into_result()?;
        w.advance_day(&crew[0]).await?.into_result()?;
        let a = w.audit().await?;
        total_burned = a["burned_gold"].as_u64().unwrap();
    }
    let recs = w.view("con_records", json!({"from": 0, "limit": 50})).await?;
    let mut by: std::collections::BTreeMap<(u64, u64), u64> = Default::default();
    for r in recs.as_array().unwrap() {
        *by.entry((r["merchant"].as_u64().unwrap(), r["day"].as_u64().unwrap())).or_default() += r["loss"].as_u64().unwrap();
    }
    println!("loss by (merchant, day): {by:?}; bonds burned {total_burned}");
    assert!(by.len() >= 2, "the defector must have landed cons on several days: {by:?}");
    assert!(by.values().all(|v| *v <= 15), "{by:?}");
    assert!(total_burned > 0);
    Ok(())
}
