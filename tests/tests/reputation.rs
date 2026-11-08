use anyhow::Result;
use longcon_tests::*;
use serde_json::{json, Value};

fn clamps(o: &Value) -> Vec<String> {
    o["clamps"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect()
}

/// Alice defaults at Marta; Bob never borrows. Both then ask Pell for the same advance on the same bond.
#[tokio::test]
async fn pell_credit_line_reflects_marta_default() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let alice = w.player("alice").await?;
    let bob = w.player("bob").await?;

    let con = w.play(&alice, 0, 8, 8, "caravan on day 4", &terms("accept", 8, 9, 1, "future_cargo")).await?;
    assert_eq!(con["status"], json!("committed"));
    w.advance_day(&alice).await?.into_result()?;
    let landed = w.advance_day(&alice).await?.into_result()?;
    let logs = landed.logs().join("\n");
    println!("default logs: {logs}");
    let event = logs
        .lines()
        .find(|l| l.contains("\"event\":\"reputation_changed\""))
        .expect("the default emits a reputation_changed event");
    let ev: Value = serde_json::from_str(event.trim_start_matches("EVENT_JSON:"))?;
    assert_eq!(ev["standard"], json!("longcon"));
    assert_eq!(ev["event"], json!("reputation_changed"));
    assert_eq!(ev["data"]["players"], json!([alice.id().to_string()]));
    assert_eq!(ev["data"]["cons_landed"], json!([1]));
    assert_eq!(ev["data"]["haircut_pct_per_default"], json!(25));

    // the changed line is visible in the player view before any new offer
    let a = w.player_view(alice.id()).await?;
    let b = w.player_view(bob.id()).await?;
    println!("alice view: credit_line {} haircut {}; bob view: credit_line {} haircut {}", a["credit_line"], a["credit_haircut_pct"], b["credit_line"], b["credit_haircut_pct"]);
    assert_eq!(a["gold"], b["gold"], "same gold held");
    assert_eq!(b["credit_line"], json!(20));
    assert_eq!(b["credit_haircut_pct"], json!(0));
    assert_eq!(a["credit_line"], json!(15));
    assert_eq!(a["credit_haircut_pct"], json!(25));

    // identical offers to Pell: bond 8, ask 8, Pell would lend all 8
    // different due days keep the merchant's daily loss cap out of the comparison
    let clean = w.play(&bob, 1, 8, 8, "same story", &terms("accept", 8, 9, 3, "other")).await?;
    let burned = w.play(&alice, 1, 8, 8, "same story", &terms("accept", 8, 9, 4, "other")).await?;
    println!("bob at Pell: {clean}\nalice at Pell: {burned}");
    assert_eq!(clean["advance"], json!(8));
    assert!(!clamps(&clean).contains(&"exposure".to_string()));
    assert_eq!(burned["advance"], json!(6), "bond 8 less the 25 percent haircut");
    assert!(clamps(&burned).contains(&"exposure".to_string()));
    assert!(burned["advance"].as_u64() < clean["advance"].as_u64());
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn repaying_leaves_the_credit_line_whole() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    w.play(&a, 0, 8, 8, "honest loan", &terms("accept", 8, 10, 2, "other")).await?;
    a.call(w.contract.id(), "repay_debt").args_json(json!({"debt_id": 1})).max_gas().transact().await?.into_result()?;
    let pv = w.player_view(a.id()).await?;
    assert_eq!(pv["credit_haircut_pct"], json!(0));
    assert_eq!(pv["cons_landed"], json!(0));
    let out = w.play(&a, 1, 8, 8, "second loan", &terms("accept", 8, 9, 2, "other")).await?;
    assert_eq!(out["advance"], json!(8));
    Ok(())
}
