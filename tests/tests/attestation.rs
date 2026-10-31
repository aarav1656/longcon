use anyhow::Result;
use ed25519_dalek::{Signer, SigningKey};
use longcon_tests::*;
use serde_json::json;

#[tokio::test]
async fn signed_answer_commits_and_gas_is_measured() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let p = w.player("alice").await?;
    let o = w.open_offer(&p, 0, 5, 5, "my caravan brings grain on day 4").await?;
    let r = w.answer(&o, &terms("accept", 5, 6, 3, "future_cargo")).await?;
    let burnt: Vec<(String, f64)> = r.outcomes().iter().map(|x| (x.executor_id.to_string(), x.gas_burnt.as_gas() as f64 / 1e12)).collect();
    let resume_tgas: f64 = r.total_gas_burnt.as_gas() as f64 / 1e12;
    println!("npc_resume total gas burnt incl. resume receipt: {resume_tgas:.2} Tgas; receipts: {burnt:?}");
    assert!(r.is_success(), "{:?}", r.failures());
    assert!(resume_tgas < 30.0, "verify path must stay under 30 Tgas, got {resume_tgas}");
    let out = o.status.await?.json::<serde_json::Value>()?;
    println!("outcome: {out}");
    assert_eq!(out["status"], json!("committed"));
    assert_eq!(out["advance"], json!(5));
    assert_eq!(out["repay"], json!(6));
    assert_eq!(out["signer"], json!(MODEL));
    assert_eq!(out["clamps"], json!([]));
    let pv = w.player_view(p.id()).await?;
    assert_eq!(pv["gold"], json!(20), "20 - 5 bond + 5 advance");
    assert_eq!(pv["locked_bonds"], json!(5));
    assert_eq!(w.merchant(0).await?["gold"], json!(95));
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn one_altered_response_byte_is_rejected_and_the_yield_stays_open() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let p = w.player("alice").await?;
    let o = w.open_offer(&p, 0, 5, 5, "front me five").await?;
    let (batch, body) = w.body_of(&o).await?;
    let (resp, sig) = w.signed(&body, &batch_content(&[terms("accept", 5, 6, 3, "other")]));
    let altered = resp.replacen("\"advance\\\":5", "\"advance\\\":9", 1);
    assert_ne!(altered, resp, "the fixture must actually change a byte");
    let bad = failure_text(w.relay(batch, &altered, &sig, "provider_tee").await).expect("altered body must fail");
    println!("altered response: {}", bad.lines().find(|l| l.contains("signature")).unwrap_or(&bad));
    assert!(bad.contains("signature does not verify"), "{bad}");
    assert_eq!(w.view("pending_offers", json!({})).await?.as_array().unwrap().len(), 1, "still pending");
    let ok = w.relay(batch, &resp, &sig, "provider_tee").await?;
    assert!(ok.is_success(), "{:?}", ok.failures());
    assert_eq!(o.status.await?.json::<serde_json::Value>()?["status"], json!("committed"));
    Ok(())
}

#[tokio::test]
async fn a_signature_from_an_unregistered_key_is_rejected() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let p = w.player("alice").await?;
    let o = w.open_offer(&p, 0, 5, 5, "front me five").await?;
    let (batch, body) = w.body_of(&o).await?;
    let (resp, _) = w.signed(&body, &batch_content(&[terms("accept", 5, 6, 3, "other")]));
    let rogue = SigningKey::generate(&mut rand::rngs::OsRng);
    let text = format!("{MODEL}:{}:{}", sha256_hex(&body), sha256_hex(&resp));
    let sig = hex::encode(rogue.sign(text.as_bytes()).to_bytes());
    let bad = failure_text(w.relay(batch, &resp, &sig, "provider_tee").await).expect("rogue key must fail");
    assert!(bad.contains("signature does not verify"), "{bad}");
    Ok(())
}

#[tokio::test]
async fn a_signature_is_bound_to_the_request_the_contract_built() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let b = w.player("bob").await?;
    let oa = w.open_offer(&a, 0, 5, 5, "alice pitch").await?;
    let ob = w.open_offer(&b, 1, 5, 5, "bob pitch").await?;
    let (batch_a, body_a) = w.body_of(&oa).await?;
    let (batch_b, _) = w.body_of(&ob).await?;
    assert_ne!(batch_a, batch_b);
    // a perfectly valid signed answer to Alice's request, replayed against Bob's batch
    let (resp, sig) = w.signed(&body_a, &batch_content(&[terms("accept", 5, 6, 3, "other")]));
    let bad = failure_text(w.relay(batch_b, &resp, &sig, "provider_tee").await).expect("cross-batch replay must fail");
    assert!(bad.contains("signature does not verify"), "{bad}");
    let ok = w.relay(batch_a, &resp, &sig, "provider_tee").await?;
    assert!(ok.is_success());
    Ok(())
}

#[tokio::test]
async fn gateway_kind_needs_its_own_registered_key() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let p = w.player("alice").await?;
    let o = w.open_offer(&p, 0, 5, 5, "front me five").await?;
    let (batch, body) = w.body_of(&o).await?;
    let (resp, sig) = w.signed(&body, &batch_content(&[terms("accept", 5, 6, 3, "other")]));
    let bad = failure_text(w.relay(batch, &resp, &sig, "gateway").await).expect("no gateway key registered");
    assert!(bad.contains("no signer registered"), "{bad}");
    // register a gateway key and sign the two-field text
    let gw = SigningKey::generate(&mut rand::rngs::OsRng);
    w.owner_call("set_signer", json!({"name": "gateway", "key_hex": hex::encode(gw.verifying_key().to_bytes())})).await?.into_result()?;
    let text = format!("{}:{}", sha256_hex(&body), sha256_hex(&resp));
    let gsig = hex::encode(gw.sign(text.as_bytes()).to_bytes());
    let ok = w.relay(batch, &resp, &gsig, "gateway").await?;
    assert!(ok.is_success(), "{:?}", ok.failures());
    let out = o.status.await?.json::<serde_json::Value>()?;
    assert_eq!(out["signer"], json!("gateway"));
    Ok(())
}

#[tokio::test]
async fn a_settled_offer_cannot_be_resumed_again() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let p = w.player("alice").await?;
    let o = w.open_offer(&p, 0, 5, 5, "front me five").await?;
    let (batch, body) = w.body_of(&o).await?;
    let (resp, sig) = w.signed(&body, &batch_content(&[terms("accept", 5, 6, 3, "other")]));
    assert!(w.relay(batch, &resp, &sig, "provider_tee").await?.is_success());
    o.status.await?;
    let again = failure_text(w.relay(batch, &resp, &sig, "provider_tee").await).expect("replay must fail");
    assert!(again.contains("not awaiting an answer"), "{again}");
    assert_eq!(w.merchant(0).await?["outstanding"], json!(5), "no second debt");
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn owner_methods_and_the_callback_are_closed_to_everyone_else() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let p = w.player("alice").await?;
    for (method, args) in [
        ("set_signer", json!({"name": MODEL, "key_hex": "00".repeat(32)})),
        ("fund_merchant", json!({"merchant": 0, "gold": 1000, "grain": 0})),
        ("set_day_length_ms", json!({"day_length_ms": 1})),
        ("set_model", json!({"model": "x"})),
    ] {
        let t = failure_text(p.call(w.contract.id(), method).args_json(args).max_gas().transact().await).expect(method);
        assert!(t.contains("owner only"), "{method}: {t}");
    }
    let cb = failure_text(p.call(w.contract.id(), "on_terms").args_json(json!({"offer_id": 1})).max_gas().transact().await).expect("on_terms");
    assert!(cb.contains("Method on_terms is private") || cb.contains("private"), "{cb}");
    Ok(())
}
