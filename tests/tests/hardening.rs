use anyhow::Result;
use longcon_tests::*;
use ed25519_dalek::{Signer, SigningKey};
use near_workspaces::types::NearToken;
use serde_json::{json, Value};

const OFFER_GAS_TGAS: u64 = 150;

#[tokio::test]
async fn an_answer_signed_for_one_batch_is_rejected_on_an_identical_later_batch() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let o1 = w.open_offer(&a, 0, 5, 5, "front me five").await?;
    let (b1, body1) = w.body_of(&o1).await?;
    let (resp, sig) = w.signed(&body1, &batch_content(&[terms("accept", 5, 6, 3, "other")]));
    // nobody relays it: the offer times out, nothing about the game state changes, and the same pitch is offered again
    w.worker.fast_forward(260).await?;
    assert_eq!(o1.status.await?.json::<Value>()?["status"], json!("timed_out"));
    let o2 = w.open_offer(&a, 0, 5, 5, "front me five").await?;
    let (b2, body2) = w.body_of(&o2).await?;
    assert_ne!(b1, b2);
    assert_ne!(body1, body2, "two batches over identical game state must still ask the model different bytes");
    let held = failure_text(w.relay(b2, &resp, &sig, "provider_tee").await).expect("an answer held from batch 1 must not settle batch 2");
    assert!(held.contains("signature does not verify"), "{held}");
    assert_eq!(w.view("pending_offers", json!({})).await?.as_array().unwrap().len(), 1, "batch 2 is still open");
    let ok = w.answer_batch(b2, &[terms("accept", 5, 6, 3, "other")]).await?;
    assert!(ok.is_success(), "{:?}", ok.failures());
    assert_eq!(o2.status.await?.json::<Value>()?["status"], json!("committed"));
    Ok(())
}

#[tokio::test]
async fn only_a_registered_relayer_can_deliver_a_signed_answer() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let stranger = w.worker.root_account()?.create_subaccount("stranger").initial_balance(NearToken::from_near(2)).transact().await?.into_result()?;
    let o = w.open_offer(&a, 0, 5, 5, "front me five").await?;
    let (batch, body) = w.body_of(&o).await?;
    let (resp, sig) = w.signed(&body, &batch_content(&[terms("accept", 5, 6, 3, "other")]));
    let relay_as = |who: near_workspaces::Account| {
        let (id, resp, sig) = (w.contract.id().clone(), resp.clone(), sig.clone());
        async move {
            who.call(&id, "npc_resume_batch")
                .args_json(json!({"batch_id": batch, "response": resp, "signature": sig, "kind": "provider_tee"}))
                .max_gas()
                .transact()
                .await
        }
    };
    let refused = failure_text(relay_as(stranger.clone()).await).expect("a stranger holding a genuine signed answer must not choose which answer lands");
    assert!(refused.contains("relayers only"), "{refused}");
    let self_added = failure_text(stranger.call(w.contract.id(), "set_relayer").args_json(json!({"account_id": stranger.id(), "allowed": true})).max_gas().transact().await).expect("only the owner registers relayers");
    assert!(self_added.contains("owner only"), "{self_added}");
    w.owner_call("set_relayer", json!({"account_id": stranger.id(), "allowed": true})).await?.into_result()?;
    assert_eq!(w.view("relayers", json!({})).await?.as_array().unwrap().iter().filter(|r| **r == json!(stranger.id())).count(), 1);
    w.owner_call("set_relayer", json!({"account_id": stranger.id(), "allowed": false})).await?.into_result()?;
    assert!(failure_text(relay_as(stranger.clone()).await).expect("removed relayer").contains("relayers only"));
    w.owner_call("set_relayer", json!({"account_id": stranger.id(), "allowed": true})).await?.into_result()?;
    let ok = relay_as(stranger).await?;
    assert!(ok.is_success(), "{:?}", ok.failures());
    assert_eq!(o.status.await?.json::<Value>()?["status"], json!("committed"));
    Ok(())
}

#[tokio::test]
async fn a_default_takes_back_the_credit_it_was_lent_against() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    w.play(&a, 0, 8, 8, "honest loan", &terms("accept", 8, 10, 2, "other")).await?;
    a.call(w.contract.id(), "repay_debt").args_json(json!({"debt_id": 1})).max_gas().transact().await?.into_result()?;
    assert_eq!(w.player_view(a.id()).await?["earned_line"], json!(4));
    let out = w.play(&a, 0, 10, 2, "second loan", &terms("accept", 10, 10, 2, "future_cargo")).await?;
    assert_eq!(out["advance"], json!(6), "bond 2 + line 4");
    for _ in 0..3 {
        w.advance_day(&a).await?.into_result()?;
    }
    let pv = w.player_view(a.id()).await?;
    assert_eq!(pv["cons_landed"], json!(1));
    assert_eq!(pv["earned_line"], json!(0), "the line the con was lent against is gone with the con");
    let again = failure_text(
        a.call(w.contract.id(), "offer")
            .args_json(json!({"merchant": 0, "ask": 5, "bond": 0, "pitch": "lend me against my old line"}))
            .gas(near_workspaces::types::Gas::from_tgas(OFFER_GAS_TGAS))
            .transact()
            .await,
    )
    .expect("a bond-0 offer after a default has nothing to stand on");
    assert!(again.contains("the road would lend you nothing"), "{again}");
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn joining_needs_the_storage_deposit_and_a_sponsor_can_pay_it() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let root = w.worker.root_account()?;
    let bare = root.create_subaccount("bare").initial_balance(NearToken::from_near(2)).transact().await?.into_result()?;
    let no_deposit = failure_text(bare.call(w.contract.id(), "join").max_gas().transact().await).expect("join without a deposit");
    assert!(no_deposit.contains("storage deposit"), "{no_deposit}");
    let short = failure_text(bare.call(w.contract.id(), "join").deposit(NearToken::from_millinear(199)).max_gas().transact().await).expect("join with a short deposit");
    assert!(short.contains("storage deposit"), "{short}");
    assert_eq!(w.player_view(bare.id()).await?, Value::Null, "a refused join leaves no player behind");
    bare.call(w.contract.id(), "join").deposit(NearToken::from_millinear(200)).max_gas().transact().await?.into_result()?;
    assert_eq!(w.player_view(bare.id()).await?["gold"], json!(20));

    let sponsor = root.create_subaccount("sponsor").initial_balance(NearToken::from_near(2)).transact().await?.into_result()?;
    let guest = root.create_subaccount("guest").initial_balance(NearToken::from_near(1)).transact().await?.into_result()?;
    let unpaid = failure_text(sponsor.call(w.contract.id(), "sponsor_join").args_json(json!({"account_id": guest.id()})).max_gas().transact().await).expect("sponsor_join without a deposit");
    assert!(unpaid.contains("storage deposit"), "{unpaid}");
    sponsor.call(w.contract.id(), "sponsor_join").args_json(json!({"account_id": guest.id()})).deposit(NearToken::from_millinear(200)).max_gas().transact().await?.into_result()?;
    assert_eq!(w.player_view(guest.id()).await?["gold"], json!(20));
    let twice = failure_text(sponsor.call(w.contract.id(), "sponsor_join").args_json(json!({"account_id": guest.id()})).deposit(NearToken::from_millinear(200)).max_gas().transact().await).expect("sponsoring a second stipend");
    assert!(twice.contains("already joined"), "{twice}");
    w.audit().await?;
    Ok(())
}

#[tokio::test]
async fn a_settled_offer_drops_its_pitch_and_an_account_has_a_lifetime_offer_allowance() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let refuse = terms("refuse", 0, 0, 1, "other");
    let out = w.play(&a, 0, 5, 5, "a pitch that must not stay in state forever", &refuse).await?;
    assert_eq!(out["status"], json!("refused"));
    let offer = w.view("offer_by_id", json!({"offer_id": 1})).await?;
    assert_eq!(offer["pitch"], json!(""), "request_hash already binds the pitch, so state does not keep it");
    assert_eq!(offer["request_hash"].as_str().unwrap().len(), 64);

    let allowance = w.state().await?["rules"]["max_offers_per_account"].as_u64().unwrap();
    assert!(allowance >= 24, "{allowance}");
    for i in 1..allowance {
        if i % 6 == 0 {
            w.advance_day(&a).await?.into_result()?;
        }
        w.play(&a, 0, 5, 5, &format!("pitch {i}"), &refuse).await?;
    }
    assert_eq!(w.player_view(a.id()).await?["offers_total"], json!(allowance));
    w.advance_day(&a).await?.into_result()?;
    let spent = failure_text(
        a.call(w.contract.id(), "offer")
            .args_json(json!({"merchant": 0, "ask": 5, "bond": 5, "pitch": "one more"}))
            .gas(near_workspaces::types::Gas::from_tgas(OFFER_GAS_TGAS))
            .transact()
            .await,
    )
    .expect("an account that used its allowance");
    assert!(spent.contains("offer allowance"), "{spent}");
    Ok(())
}

#[tokio::test]
async fn an_operator_key_signs_as_worker_and_the_outcome_says_so() -> Result<()> {
    let w = World::new(Cfg::default()).await?;
    let a = w.player("alice").await?;
    let o = w.open_offer(&a, 0, 5, 5, "front me five").await?;
    let (batch, body) = w.body_of(&o).await?;
    let (resp, model_sig) = w.signed(&body, &batch_content(&[terms("accept", 5, 6, 3, "other")]));
    let unregistered = failure_text(w.relay(batch, &resp, &model_sig, "worker").await).expect("no operator key is registered yet");
    assert!(unregistered.contains("no signer registered"), "{unregistered}");
    let operator = SigningKey::generate(&mut rand::rngs::OsRng);
    w.owner_call("set_signer", json!({"name": format!("worker:{MODEL}"), "key_hex": hex::encode(operator.verifying_key().to_bytes())})).await?.into_result()?;
    let wrong_key = failure_text(w.relay(batch, &resp, &model_sig, "worker").await).expect("the model key is not the operator key");
    assert!(wrong_key.contains("signature does not verify"), "{wrong_key}");
    let text = format!("{MODEL}:{}:{}", sha256_hex(&body), sha256_hex(&resp));
    let sig = hex::encode(operator.sign(text.as_bytes()).to_bytes());
    let ok = w.relay(batch, &resp, &sig, "worker").await?;
    assert!(ok.is_success(), "{:?}", ok.failures());
    let out = o.status.await?.json::<Value>()?;
    assert_eq!(out["status"], json!("committed"));
    assert_eq!(out["signer"], json!(format!("worker:{MODEL}")), "an operator signature is never labelled with the model name");
    Ok(())
}
