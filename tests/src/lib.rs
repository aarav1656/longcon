//! Sandbox harness: builds the contract once per test binary, deploys it, registers a test
//! signer for the model, and plays the worker (fetch request, sign, relay) so every test drives
//! the real contract code through real receipts.
use anyhow::{anyhow, Context, Result};
use ed25519_dalek::{Signer, SigningKey};
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, AccountId, Contract, Worker};
use futures::future::join_all;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tokio::sync::OnceCell;

pub const MODEL: &str = "Qwen/Qwen3.8-27B";

fn root_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

async fn build() -> Result<Vec<u8>> {
    let out = root_dir().join("target").join("wasm");
    let status = tokio::process::Command::new(root_dir().join("scripts").join("build-wasm.sh"))
        .arg(&out)
        .status()
        .await
        .context("run scripts/build-wasm.sh")?;
    if !status.success() {
        return Err(anyhow!("build-wasm.sh failed: {status}"));
    }
    std::fs::read(out.join("longcon.wasm")).context("read longcon.wasm")
}

/// Built once per test binary so a mutated contract source is always the code under test.
pub async fn wasm() -> &'static Vec<u8> {
    static CELL: OnceCell<Vec<u8>> = OnceCell::const_new();
    CELL.get_or_init(|| async { build().await.expect("contract builds") }).await
}

pub fn sha256_hex(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}

pub struct World {
    pub worker: Worker<Sandbox>,
    pub owner: Account,
    pub contract: Contract,
    pub signer: SigningKey,
}

pub struct Cfg {
    pub day_length_ms: u64,
    pub treasury: u64,
    pub grain: u64,
}

impl Default for Cfg {
    fn default() -> Self {
        Self { day_length_ms: 0, treasury: 100, grain: 50 }
    }
}

impl World {
    pub async fn new(cfg: Cfg) -> Result<Self> {
        let wasm = wasm().await;
        let worker = near_workspaces::sandbox().await?;
        let root = worker.root_account()?;
        let owner = root.create_subaccount("owner").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
        let contract_acc = root.create_subaccount("longcon").initial_balance(NearToken::from_near(40)).transact().await?.into_result()?;
        let contract = contract_acc.deploy(wasm).await?.into_result()?;
        contract
            .call("new")
            .args_json(json!({
                "owner": owner.id(), "model": MODEL, "day_length_ms": cfg.day_length_ms,
                "treasury": cfg.treasury, "grain": cfg.grain
            }))
            .transact()
            .await?
            .into_result()?;
        let signer = SigningKey::generate(&mut rand::rngs::OsRng);
        let w = Self { worker, owner, contract, signer };
        w.owner_call("set_signer", json!({"name": MODEL, "key_hex": hex::encode(w.signer.verifying_key().to_bytes())})).await?.into_result()?;
        Ok(w)
    }

    pub async fn owner_call(&self, method: &str, args: Value) -> Result<ExecutionFinalResult> {
        Ok(self.owner.call(self.contract.id(), method).args_json(args).max_gas().transact().await?)
    }

    pub async fn view(&self, method: &str, args: Value) -> Result<Value> {
        Ok(self.contract.view(method).args_json(args).await?.json()?)
    }

    pub async fn player(&self, name: &str) -> Result<Account> {
        let root = self.worker.root_account()?;
        let acc = root.create_subaccount(name).initial_balance(NearToken::from_near(2)).transact().await?.into_result()?;
        acc.call(self.contract.id(), "join").max_gas().transact().await?.into_result()?;
        Ok(acc)
    }


    /// `n` joined accounts, each a fresh identity: a bound has to come from the ledger and not from who is asking.
    pub async fn fresh_players(&self, prefix: &str, n: usize) -> Result<Vec<Account>> {
        let root = self.worker.root_account()?;
        let mut out = vec![];
        for chunk in (0..n).collect::<Vec<_>>().chunks(25) {
            let mut accs = vec![];
            for i in chunk {
                // one signer, so creation is sequential; the joins below are parallel because each account signs its own
                accs.push(root.create_subaccount(&format!("{prefix}{i}")).initial_balance(NearToken::from_millinear(300)).transact().await?.into_result()?);
            }
            let id = self.contract.id().clone();
            let joined = join_all(accs.iter().map(|a| a.call(&id, "join").gas(near_workspaces::types::Gas::from_tgas(30)).transact())).await;
            for j in joined {
                j?.into_result()?;
            }
            out.extend(accs);
        }
        Ok(out)
    }

    pub async fn state(&self) -> Result<Value> {
        self.view("state", json!({})).await
    }

    pub async fn merchant(&self, i: usize) -> Result<Value> {
        Ok(self.state().await?["merchants"][i].clone())
    }

    pub async fn player_view(&self, a: &AccountId) -> Result<Value> {
        self.view("player", json!({"account_id": a})).await
    }

    pub async fn audit(&self) -> Result<Value> {
        let a = self.view("audit", json!({})).await?;
        for k in ["gold_ok", "grain_ok", "debt_ok", "quotes_ok"] {
            assert_eq!(a[k], json!(true), "audit {k} failed: {a}");
        }
        Ok(a)
    }

    pub async fn advance_day(&self, who: &Account) -> Result<ExecutionFinalResult> {
        Ok(who.call(self.contract.id(), "advance_day").max_gas().transact().await?)
    }

    /// The model's chat-completion body for `content`, plus the signature the TEE would attach.
    pub fn signed(&self, request_body: &str, content: &str) -> (String, String) {
        let response = json!({"id": "chatcmpl-test", "object": "chat.completion", "choices": [{"index": 0, "message": {"role": "assistant", "content": content}}]}).to_string();
        let text = format!("{MODEL}:{}:{}", sha256_hex(request_body), sha256_hex(&response));
        let sig = self.signer.sign(text.as_bytes());
        (response, hex::encode(sig.to_bytes()))
    }

    pub async fn open_offer(&self, who: &Account, merchant: u8, ask: u64, bond: u64, pitch: &str) -> Result<OpenOffer> {
        let status = who
            .call(self.contract.id(), "offer")
            .args_json(json!({"merchant": merchant, "ask": ask, "bond": bond, "pitch": pitch}))
            .gas(Gas::from_tgas(150))
            .transact_async()
            .await?;
        for _ in 0..80 {
            let pending = self.view("pending_offers", json!({})).await?;
            if let Some(p) = pending.as_array().and_then(|a| a.iter().find(|p| p["player"] == json!(who.id()))) {
                return Ok(OpenOffer { status, id: p["id"].as_u64().unwrap(), merchant });
            }
            if let std::task::Poll::Ready(r) = status.status().await? {
                return Err(anyhow!("offer tx failed: {:?}", r.failures()));
            }
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        }
        Err(anyhow!("offer never became pending"))
    }

    /// Let the batch window pass, then freeze the merchant's queue. Returns the batch id.
    pub async fn seal(&self, merchant: u8) -> Result<u64> {
        self.worker.fast_forward(BATCH_WINDOW_BLOCKS + 1).await?;
        let r = self.seal_raw(merchant).await?.into_result().context("seal_batch")?;
        Ok(r.json::<u64>()?)
    }

    pub async fn seal_raw(&self, merchant: u8) -> Result<ExecutionFinalResult> {
        let relayer = self.worker.root_account()?;
        Ok(relayer.call(self.contract.id(), "seal_batch").args_json(json!({"merchant": merchant})).max_gas().transact().await?)
    }

    /// The batch an offer sits in, sealing its merchant's queue first when it is still waiting.
    pub async fn batch_of(&self, o: &OpenOffer) -> Result<u64> {
        let offer = self.view("offer_by_id", json!({"offer_id": o.id})).await?;
        match offer["batch"].as_u64() {
            Some(b) => Ok(b),
            None => self.seal(o.merchant).await,
        }
    }

    /// The exact request the worker would POST for this offer's batch.
    pub async fn body_of(&self, o: &OpenOffer) -> Result<(u64, String)> {
        let b = self.batch_of(o).await?;
        let body = self.view("batch_body", json!({"batch_id": b})).await?;
        Ok((b, body.as_str().unwrap().to_string()))
    }

    /// Fetch the batch request, sign `content` as the model's decision for this single offer, relay it.
    pub async fn answer(&self, o: &OpenOffer, content: &str) -> Result<ExecutionFinalResult> {
        let (batch, body) = self.body_of(o).await?;
        self.answer_batch_body(batch, &body, &[content.to_string()]).await
    }

    /// Sign one decision per slot, in the batch's slot order, and relay the batch answer.
    pub async fn answer_batch(&self, batch: u64, contents: &[String]) -> Result<ExecutionFinalResult> {
        let body = self.view("batch_body", json!({"batch_id": batch})).await?;
        self.answer_batch_body(batch, body.as_str().unwrap(), contents).await
    }

    async fn answer_batch_body(&self, batch: u64, body: &str, contents: &[String]) -> Result<ExecutionFinalResult> {
        let (response, signature) = self.signed(body, &batch_content(contents));
        self.relay(batch, &response, &signature, "provider_tee").await
    }

    pub async fn relay(&self, batch_id: u64, response: &str, signature: &str, kind: &str) -> Result<ExecutionFinalResult> {
        let relayer = self.worker.root_account()?;
        Ok(relayer
            .call(self.contract.id(), "npc_resume_batch")
            .args_json(json!({"batch_id": batch_id, "response": response, "signature": signature, "kind": kind}))
            .max_gas()
            .transact()
            .await?)
    }

    /// Full round trip: open, answer, wait for the committed outcome.
    pub async fn play(&self, who: &Account, merchant: u8, ask: u64, bond: u64, pitch: &str, content: &str) -> Result<Value> {
        let o = self.open_offer(who, merchant, ask, bond, pitch).await?;
        let r = self.answer(&o, content).await?;
        r.into_result().context("npc_resume")?;
        let res = o.status.await?;
        Ok(res.json::<Value>().context("offer outcome")?)
    }
}

pub struct OpenOffer {
    pub status: near_workspaces::operations::TransactionStatus,
    pub id: u64,
    pub merchant: u8,
}

pub const BATCH_WINDOW_BLOCKS: u64 = 6;

/// A batch answer from per-slot decision objects (as produced by `terms`). The merchant's grain
/// prices, when a decision carries them, move to the top level where the prompt asks for them.
pub fn batch_content(decisions: &[String]) -> String {
    let mut list = vec![];
    let (mut buy, mut sell) = (None, None);
    for (i, d) in decisions.iter().enumerate() {
        let Ok(mut v) = serde_json::from_str::<Value>(d) else { return d.clone() }; // free text stays free text
        v["slot"] = json!(i + 1);
        if let Some(o) = v.as_object_mut() {
            if let Some(b) = o.remove("buy_price") { buy.get_or_insert(b); }
            if let Some(x) = o.remove("sell_price") { sell.get_or_insert(x); }
        }
        list.push(v);
    }
    let mut out = json!({"decisions": list});
    if let Some(b) = buy { out["buy_price"] = b; }
    if let Some(x) = sell { out["sell_price"] = x; }
    out.to_string()
}

pub fn terms(verdict: &str, advance: u64, repay: u64, due_days: u64, class: &str) -> String {
    json!({"verdict": verdict, "advance": advance, "repay": repay, "due_days": due_days, "class": class, "reason": "test terms"}).to_string()
}

pub fn failure_text(r: Result<ExecutionFinalResult, impl std::fmt::Display>) -> Option<String> {
    match r {
        Err(e) => Some(e.to_string()),
        Ok(r) if r.is_failure() => Some(format!("{:?}", r.failures())),
        Ok(_) => None,
    }
}
