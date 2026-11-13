use anyhow::Result;
use longcon_tests::*;
use near_workspaces::Account;
use serde_json::{json, Value};

fn cast() -> Value {
    json!([
        {"name": "Wick the Pale", "ask": 20, "bond": 20, "pitch": "My cousin's barge reaches Pellgate at dawn with grain; lend me coin for the toll.", "repays": false},
        {"name": "Sable Orrin", "ask": 20, "bond": 20, "pitch": "I buy the spring wool every year and pay on the due day.", "repays": true},
        {"name": "Doran Vale", "ask": 6, "bond": 6, "pitch": "A small advance for rope, repaid with a coin on top.", "repays": true},
    ])
}

/// The model ranks Wick first and accepts all three at the asked amounts, due in two days.
fn ranking() -> String {
    batch_content(&[
        terms("accept", 20, 24, 2, "future_cargo"),
        terms("accept", 20, 24, 2, "urgency"),
        terms("accept", 6, 7, 2, "other"),
    ])
}

async fn split(w: &World, who: &Account, backed: u64) -> Result<u64> {
    let r = who.call(w.contract.id(), "fork_town").args_json(json!({"merchant": 0, "backed_rule": backed, "cast": cast()})).max_gas().transact().await?;
    Ok(r.into_result()?.json::<u64>()?)
}

async fn seal(w: &World, who: &Account, id: u64) -> Result<String> {
    let r = who.call(w.contract.id(), "fork_seal").args_json(json!({"fork_id": id})).max_gas().transact().await?.into_result()?;
    let log = r.logs().iter().find_map(|l| l.strip_prefix(&format!("LONGCON_FORK_REQUEST:{id}:")).map(str::to_string));
    Ok(log.expect("the seal logs the exact request"))
}

async fn resume(w: &World, id: u64, response: &str, sig: &str) -> Result<near_workspaces::result::ExecutionFinalResult> {
    let relayer = w.worker.root_account()?;
    Ok(relayer.call(w.contract.id(), "fork_resume").args_json(json!({"fork_id": id, "response": response, "signature": sig, "kind": "provider_tee"})).max_gas().transact().await?)
}

async fn fork(w: &World, id: u64) -> Result<Value> {
    w.view("fork", json!({"fork_id": id})).await
}

#[tokio::test]
async fn one_signed_answer_under_two_caps_yields_two_economies_and_a_settled_claim() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let id = split(&w, &a, 15).await?;
    let f = fork(&w, id).await?;
    assert_eq!(f["status"], "open");
    assert_eq!(f["branches"][0]["rule"], 15);
    assert_eq!(f["branches"][1]["rule"], 25);
    assert_ne!(f["branches"][0]["start_hash"], f["branches"][1]["start_hash"], "only the rule differs between the starts");
    let body = seal(&w, &a, id).await?;
    assert_eq!(sha256_hex(&body), fork(&w, id).await?["request_hash"], "the request hash binds the logged body");
    assert!(!body.contains("repays"), "the committed repay plan is never shown to the merchant");
    assert_eq!(w.view("open_forks", json!({})).await?, json!([id]));
    let (response, sig) = w.signed(&body, &ranking());
    resume(&w, id, &response, &sig).await?.into_result()?;
    let f = fork(&w, id).await?;
    assert_eq!(f["status"], "resolved");
    assert_eq!(w.view("open_forks", json!({})).await?, json!([]));
    let (b15, b25) = (&f["branches"][0], &f["branches"][1]);
    assert_eq!(b15["loans"][0]["advance"], 15, "cap 15 clips Wick");
    assert!(b15["loans"][0]["clamps"].as_array().unwrap().iter().any(|c| c == "daily_loss"));
    assert_eq!(b15["loans"][1]["advance"], 0, "the cap is spent for that due day");
    assert_eq!(b25["loans"][0]["advance"], 20);
    assert_eq!(b25["loans"][1]["advance"], 5);
    assert_eq!(b15["rows"].as_array().unwrap().len(), 8, "the opening row plus seven days");
    assert_eq!(b15["defaults"], 1);
    assert_eq!(b25["defaults"], 1);
    assert_eq!(b15["final_gold"], 100 - 15, "15 lost to Wick and the cap leaves nothing for the others");
    assert_eq!(b25["final_gold"], 100 - 20 - 5 + 7, "20 lost to Wick, Sable's clipped 5 repays 7");
    assert_eq!(b15["outcome"], "bleeds");
    let d = &f["divergence"];
    assert_eq!(d["diverged"], true);
    assert_eq!(d["first_day"], 0);
    assert_ne!(d["hash_a"], d["hash_b"]);
    // a made-up receipt, then the real one, then a replay
    let forged = failure_text(a.call(w.contract.id(), "fork_settle").args_json(json!({"fork_id": id, "receipt": "ab".repeat(32)})).max_gas().transact().await).expect("forged receipt");
    assert!(forged.contains("not the divergence this contract recorded"), "{forged}");
    let gold_before = w.player_view(a.id()).await?["gold"].as_u64().unwrap();
    let ok = a.call(w.contract.id(), "fork_settle").args_json(json!({"fork_id": id, "receipt": d["receipt"]})).max_gas().transact().await?.into_result()?;
    let claim: String = ok.json()?;
    let winner = if b15["final_gold"].as_u64() > b25["final_gold"].as_u64() { "won" } else { "lost" };
    assert_eq!(claim, winner);
    let paid = if winner == "won" { 4 } else { 0 };
    assert_eq!(w.player_view(a.id()).await?["gold"].as_u64().unwrap(), gold_before + paid);
    let replay = failure_text(a.call(w.contract.id(), "fork_settle").args_json(json!({"fork_id": id, "receipt": d["receipt"]})).max_gas().transact().await).expect("replayed settlement");
    assert!(replay.contains("already settled"), "{replay}");
    assert_eq!(w.player_view(a.id()).await?["gold"].as_u64().unwrap(), gold_before + paid, "the replay paid nothing");
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn the_rule_is_frozen_once_the_fork_is_sealed() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let id = split(&w, &a, 15).await?;
    a.call(w.contract.id(), "fork_rule").args_json(json!({"fork_id": id, "backed_rule": 25})).max_gas().transact().await?.into_result()?;
    assert_eq!(fork(&w, id).await?["backed_rule"], 25, "the rule may change while the fork is open");
    let bob = w.player("bob").await?;
    let stranger = failure_text(bob.call(w.contract.id(), "fork_rule").args_json(json!({"fork_id": id, "backed_rule": 15})).max_gas().transact().await).expect("not the creator");
    assert!(stranger.contains("only the account that split this town"), "{stranger}");
    seal(&w, &a, id).await?;
    let late = failure_text(a.call(w.contract.id(), "fork_rule").args_json(json!({"fork_id": id, "backed_rule": 15})).max_gas().transact().await).expect("edit after the split");
    assert!(late.contains("the rule is frozen"), "{late}");
    assert_eq!(fork(&w, id).await?["backed_rule"], 25);
    let again = failure_text(a.call(w.contract.id(), "fork_seal").args_json(json!({"fork_id": id})).max_gas().transact().await).expect("double seal");
    assert!(again.contains("already sealed"), "{again}");
    Ok(())
}

#[tokio::test]
async fn an_answer_signed_for_one_fork_does_not_resolve_another() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let one = split(&w, &a, 15).await?;
    let two = split(&w, &a, 15).await?;
    let body_one = seal(&w, &a, one).await?;
    seal(&w, &a, two).await?;
    let (response, sig) = w.signed(&body_one, &ranking());
    let wrong = failure_text(resume(&w, two, &response, &sig).await).expect("wrong request");
    assert!(wrong.contains("signature does not verify"), "{wrong}");
    assert_eq!(fork(&w, two).await?["status"], "sealed", "the other fork keeps waiting");
    resume(&w, one, &response, &sig).await?.into_result()?;
    let replay = failure_text(resume(&w, one, &response, &sig).await).expect("replayed answer");
    assert!(replay.contains("not awaiting an answer"), "{replay}");
    // the sibling fork and the live ledger are untouched by the first fork's resolution
    let two_view = fork(&w, two).await?;
    assert_eq!(two_view["branches"][0]["loans"], json!([]));
    assert_eq!(w.merchant(0).await?["gold"], 100);
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn only_a_registered_relayer_delivers_and_a_stranger_cannot_split_without_joining() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let id = split(&w, &a, 25).await?;
    let body = seal(&w, &a, id).await?;
    let (response, sig) = w.signed(&body, &ranking());
    let denied = failure_text(a.call(w.contract.id(), "fork_resume").args_json(json!({"fork_id": id, "response": response, "signature": sig, "kind": "provider_tee"})).max_gas().transact().await).expect("not a relayer");
    assert!(denied.contains("relayers only"), "{denied}");
    let root = w.worker.root_account()?;
    let unjoined = failure_text(root.call(w.contract.id(), "fork_town").args_json(json!({"merchant": 0, "backed_rule": 15, "cast": cast()})).max_gas().transact().await).expect("unjoined");
    assert!(unjoined.contains("not joined") || unjoined.contains("join"), "{unjoined}");
    let bad_rule = failure_text(a.call(w.contract.id(), "fork_town").args_json(json!({"merchant": 0, "backed_rule": 20, "cast": cast()})).max_gas().transact().await).expect("a cap the fork does not offer");
    assert!(bad_rule.contains("15 or 25"), "{bad_rule}");
    let one = failure_text(a.call(w.contract.id(), "fork_town").args_json(json!({"merchant": 0, "backed_rule": 15, "cast": [cast()[0]]})).max_gas().transact().await).expect("one traveler");
    assert!(one.contains("2 to 4 travelers"), "{one}");
    Ok(())
}

#[tokio::test]
async fn a_cap_nobody_reaches_records_no_divergence_and_pays_nothing() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let id = split(&w, &a, 25).await?;
    let body = seal(&w, &a, id).await?;
    let small = batch_content(&[terms("accept", 4, 5, 2, "other"), terms("refuse", 0, 0, 1, "other"), terms("refuse", 0, 0, 1, "other")]);
    let (response, sig) = w.signed(&body, &small);
    resume(&w, id, &response, &sig).await?.into_result()?;
    let f = fork(&w, id).await?;
    assert_eq!(f["divergence"]["diverged"], false);
    let d = f["divergence"].clone();
    let gold_before = w.player_view(a.id()).await?["gold"].as_u64().unwrap();
    let claim: String = a.call(w.contract.id(), "fork_settle").args_json(json!({"fork_id": id, "receipt": d["receipt"]})).max_gas().transact().await?.into_result()?.json()?;
    assert_eq!(claim, "draw");
    assert_eq!(w.player_view(a.id()).await?["gold"].as_u64().unwrap(), gold_before);
    Ok(())
}

#[tokio::test]
async fn an_account_splits_at_most_three_towns() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    for _ in 0..3 {
        split(&w, &a, 15).await?;
    }
    let fourth = failure_text(a.call(w.contract.id(), "fork_town").args_json(json!({"merchant": 0, "backed_rule": 15, "cast": cast()})).max_gas().transact().await).expect("allowance");
    assert!(fourth.contains("allowance of towns"), "{fourth}");
    assert_eq!(w.view("forks_of", json!({"account_id": a.id()})).await?, json!([1, 2, 3]));
    Ok(())
}
