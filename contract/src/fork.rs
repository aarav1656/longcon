//! Forked Town: one merchant town split into two same-seed branches that differ only in the
//! daily loss cap. The fork snapshots the merchant, its news, the traveler queue and the block seed;
//! one signed answer to one sealed request is applied to both branches, each clamping it against its
//! own cap; the contract records where the two ledgers first differ and settles a claim from that
//! record alone. Branch state lives under raw storage keys so the live game's state layout is untouched.
use crate::attest;
use crate::emit;
use crate::prompt;
use crate::rules::*;
use crate::types::*;
use crate::{Contract, ContractExt};
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId};

/// The two loss caps a visitor can back. Branch 0 runs the first, branch 1 the second.
pub const FORK_RULES: [u64; 2] = [15, 25];
/// Game days each branch resolves, counted from the split.
pub const FORK_DAYS: u32 = 7;
pub const FORK_CAST_MIN: usize = 2;
pub const FORK_CAST_MAX: usize = 4;
pub const FORK_PITCH_MAX: usize = 240;
pub const FORK_NAME_MAX: usize = 24;
/// The most merchant gold a branch starts with; the live merchant's gold is the other limit.
pub const FORK_PURSE_MAX: u64 = 200;
pub const FORK_PURSE_MIN: u64 = 40;
pub const FORK_MAX_PER_ACCOUNT: u32 = 3;
/// Gold minted to an account whose backed rule leaves the richer economy.
pub const FORK_PAYOUT: u64 = 4;
/// Fork requests carry a batch number above any ledger batch, so a signed answer for one never fits the other.
pub const FORK_BATCH_BASE: u64 = 1 << 48;
/// Blocks a sealed fork waits for the merchant's signed answer. When the window closes the contract itself
/// closes the fork (`fork_expire`), so a stalled model, worker or relayer can never leave a town sealed forever.
pub const FORK_ANSWER_BLOCKS: u64 = 200;

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum ForkStatus {
    Open,
    Sealed,
    Resolved,
    Settled,
    Expired,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum ClaimStatus {
    Open,
    Won,
    Lost,
    Draw,
    Void,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum EconomyOutcome {
    Thrives,
    Bleeds,
}

/// One traveler in the snapshot queue. `repays` is committed in the world hash and never shown to the merchant.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct ForkTraveler {
    pub name: String,
    pub ask: u64,
    pub bond: u64,
    pub pitch: String,
    pub repays: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct ForkNews {
    pub day: u32,
    pub town: u8,
    pub class: ConClass,
    pub principal: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct ForkLoan {
    pub rank: u8,
    pub slot: u8,
    pub name: String,
    pub accepted: bool,
    pub proposed_advance: u64,
    pub advance: u64,
    pub repay: u64,
    pub due_day: u32,
    pub class: ConClass,
    pub reason: String,
    pub clamps: Vec<String>,
    pub repays: bool,
}

/// A default inside a branch, and the day the caravan carries the news to each town.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct ForkCon {
    pub landed_day: u32,
    pub town: u8,
    pub class: ConClass,
    pub principal: u64,
    pub name: String,
    pub arrives: Vec<u32>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct DayRow {
    pub day: u32,
    pub gold: u64,
    pub outstanding: u64,
    pub defaults: u32,
    pub lost: u64,
    pub hash: Hash32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Branch {
    pub rule: u64,
    /// sha256(world hash, rule): differs between branches only through the rule.
    pub start_hash: Hash32,
    pub loans: Vec<ForkLoan>,
    pub rows: Vec<DayRow>,
    pub cons: Vec<ForkCon>,
    pub final_gold: u64,
    pub defaults: u32,
    pub lost: u64,
    /// True when the branch's own loss cap clamped at least one advance.
    pub cap_bound: bool,
    pub outcome: EconomyOutcome,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Divergence {
    pub diverged: bool,
    /// First row (0 is the opening advances, 1 to 7 the days after) whose state hash differs.
    pub first_day: u32,
    pub hash_a: Hash32,
    pub hash_b: Hash32,
    pub block: u64,
    /// sha256 over the world hash, the response hash, the first divergent day and both final hashes.
    pub receipt: Hash32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct ForkClaim {
    pub status: ClaimStatus,
    pub payout: u64,
    pub settled_block: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Fork {
    pub id: u64,
    pub creator: AccountId,
    pub merchant: u8,
    pub merchant_name: String,
    pub town: u8,
    pub day: u32,
    pub backed_rule: u64,
    pub status: ForkStatus,
    pub world_hash: Hash32,
    pub seed: Hash32,
    pub purse: u64,
    pub grain: u64,
    pub buy_price: u64,
    pub sell_price: u64,
    pub news: Vec<ForkNews>,
    pub cast: Vec<ForkTraveler>,
    pub request_hash: Hash32,
    pub request_body: String,
    pub response_hash: Hash32,
    pub signer: String,
    pub split_block: u64,
    pub sealed_block: u64,
    pub resolved_block: u64,
    pub branches: Vec<Branch>,
    pub divergence: Option<Divergence>,
    pub claim: ForkClaim,
}

fn key_fork(id: u64) -> Vec<u8> {
    let mut k = b"fork:".to_vec();
    k.extend_from_slice(&id.to_le_bytes());
    k
}

fn key_ids(who: &AccountId) -> Vec<u8> {
    let mut k = b"forkids:".to_vec();
    k.extend_from_slice(who.as_str().as_bytes());
    k
}

const KEY_NEXT: &[u8] = b"fork_next";
const KEY_OPEN: &[u8] = b"fork_open";

fn read<T: near_sdk::borsh::BorshDeserialize>(key: &[u8]) -> Option<T> {
    env::storage_read(key).map(|b| near_sdk::borsh::from_slice(&b).unwrap_or_else(|_| env::panic_str("fork state unreadable")))
}

fn write<T: near_sdk::borsh::BorshSerialize>(key: &[u8], v: &T) {
    env::storage_write(key, &near_sdk::borsh::to_vec(v).unwrap_or_else(|_| env::panic_str("serialize")));
}

fn load(id: u64) -> Fork {
    read(&key_fork(id)).unwrap_or_else(|| env::panic_str("no such fork"))
}

/// sha256 over length-prefixed parts, so no two part lists share a preimage.
fn digest(parts: &[&[u8]]) -> Hash32 {
    let mut buf: Vec<u8> = vec![];
    for p in parts {
        buf.extend_from_slice(&(p.len() as u32).to_le_bytes());
        buf.extend_from_slice(p);
    }
    Hash32::from_hex(&hex::encode(env::sha256_array(&buf)))
}

fn clean(s: &str, max: usize, msg: &str) {
    require!(!s.trim().is_empty() && s.len() <= max, msg);
    require!(!s.chars().any(|c| (c as u32) < 0x20), "no control characters in the cast");
}

fn world_hash(f: &Fork) -> Hash32 {
    let cast: Vec<_> = f.cast.iter().map(|t| json!({"name": t.name, "ask": t.ask, "bond": t.bond, "pitch": t.pitch, "repays": t.repays})).collect();
    let news: Vec<_> = f.news.iter().map(|n| json!({"day": n.day, "town": n.town, "class": n.class.as_str(), "principal": n.principal})).collect();
    let doc = json!({
        "merchant": f.merchant, "name": f.merchant_name, "town": f.town, "day": f.day, "purse": f.purse, "grain": f.grain,
        "buy": f.buy_price, "sell": f.sell_price, "news": news, "cast": cast, "seed": f.seed.to_hex(), "days": FORK_DAYS,
    });
    digest(&[doc.to_string().as_bytes()])
}

fn merchant_of(f: &Fork) -> Merchant {
    Merchant {
        id: f.merchant,
        name: f.merchant_name.clone(),
        town: f.town,
        gold: f.purse,
        grain: f.grain,
        outstanding: 0,
        buy_price: f.buy_price,
        sell_price: f.sell_price,
        lost_total: 0,
    }
}

/// Apply the signed ranking to one branch under `rule`, then resolve its seven days. Pure: the same
/// terms and a different rule are the only thing that can make two branches differ.
fn run_branch(f: &Fork, terms: &attest::BatchTerms, rule: u64) -> Branch {
    let mut gold = f.purse;
    let mut outstanding = 0u64;
    let mut due_exposure = [0u64; (MAX_DUE_DAYS + 1) as usize];
    let mut loans: Vec<ForkLoan> = vec![];
    let mut cap_bound = false;
    for (rank, &slot) in terms.order.iter().enumerate() {
        let t = &f.cast[slot];
        let p = &terms.decisions[slot];
        let (due, _) = clamp_due_days(p.due_days);
        let mut notes: Vec<String> = vec![];
        let (mut advance, mut repay) = (0u64, 0u64);
        if p.accept {
            let room = Room {
                ask: t.ask,
                exposure: t.bond,
                daily_loss: rule.saturating_sub(due_exposure[due as usize]),
                treasury: treasury_room(gold, outstanding),
                gold,
            };
            advance = clamp_advance(p.advance, &room, &mut notes);
            if advance > 0 {
                repay = clamp_repay(advance, p.repay, &mut notes);
            }
        }
        if notes.iter().any(|n| n == "daily_loss") {
            cap_bound = true;
        }
        if advance > 0 {
            gold -= advance;
            outstanding += advance;
            due_exposure[due as usize] += advance;
        }
        loans.push(ForkLoan {
            rank: rank as u8,
            slot: slot as u8,
            name: t.name.clone(),
            accepted: p.accept && advance > 0,
            proposed_advance: p.advance,
            advance,
            repay,
            due_day: due,
            class: p.class,
            reason: p.reason.clone(),
            clamps: notes,
            repays: t.repays,
        });
    }
    let ledger: Vec<_> = loans.iter().map(|l| json!([l.slot, l.advance, l.repay, l.due_day])).collect();
    let (mut defaults, mut lost) = (0u32, 0u64);
    let mut cons: Vec<ForkCon> = vec![];
    let mut prev = f.world_hash;
    let mut rows: Vec<DayRow> = vec![];
    let row = |day: u32, gold: u64, outstanding: u64, defaults: u32, lost: u64, prev: Hash32, extra: &str| -> DayRow {
        let hash = digest(&[&prev.to_hex().into_bytes(), &day.to_le_bytes(), &gold.to_le_bytes(), &outstanding.to_le_bytes(), &defaults.to_le_bytes(), &lost.to_le_bytes(), extra.as_bytes()]);
        DayRow { day, gold, outstanding, defaults, lost, hash }
    };
    let r0 = row(0, gold, outstanding, defaults, lost, prev, &json!(ledger).to_string());
    prev = r0.hash;
    rows.push(r0);
    for d in 1..=FORK_DAYS {
        for l in loans.iter().filter(|l| l.advance > 0 && l.due_day == d) {
            outstanding -= l.advance;
            if l.repays {
                gold += l.repay;
            } else {
                defaults += 1;
                lost += l.advance;
                let landed = f.day + d;
                cons.push(ForkCon {
                    landed_day: landed,
                    town: f.town,
                    class: l.class,
                    principal: l.advance,
                    name: l.name.clone(),
                    arrives: (0..TOWNS.len() as u8).map(|t| news_arrives(landed, f.town, t)).collect(),
                });
            }
        }
        let r = row(d, gold, outstanding, defaults, lost, prev, "");
        prev = r.hash;
        rows.push(r);
    }
    Branch {
        rule,
        start_hash: digest(&[&f.world_hash.to_hex().into_bytes(), &rule.to_le_bytes()]),
        loans,
        rows,
        cons,
        final_gold: gold,
        defaults,
        lost,
        cap_bound,
        outcome: if gold >= f.purse { EconomyOutcome::Thrives } else { EconomyOutcome::Bleeds },
    }
}

fn divergence_of(f: &Fork, a: &Branch, b: &Branch, block: u64) -> Divergence {
    let first = a.rows.iter().zip(b.rows.iter()).position(|(x, y)| x.hash != y.hash);
    let (day, ha, hb) = match first {
        Some(i) => (i as u32, a.rows[i].hash, b.rows[i].hash),
        None => (0, a.rows[a.rows.len() - 1].hash, b.rows[b.rows.len() - 1].hash),
    };
    let receipt = digest(&[
        &f.world_hash.to_hex().into_bytes(),
        &f.response_hash.to_hex().into_bytes(),
        &[first.is_some() as u8],
        &day.to_le_bytes(),
        &ha.to_hex().into_bytes(),
        &hb.to_hex().into_bytes(),
        &a.rows[a.rows.len() - 1].hash.to_hex().into_bytes(),
        &b.rows[b.rows.len() - 1].hash.to_hex().into_bytes(),
    ]);
    Divergence { diverged: first.is_some(), first_day: day, hash_a: ha, hash_b: hb, block, receipt }
}

/// The block at which a fork sealed at `sealed_block` may be closed without an answer.
pub fn answer_deadline(sealed_block: u64) -> u64 {
    sealed_block.saturating_add(FORK_ANSWER_BLOCKS)
}

/// Why a fork cannot be expired at `now`, or `None` when it can.
pub fn expiry_refusal(status: ForkStatus, sealed_block: u64, now: u64) -> Option<String> {
    if status != ForkStatus::Sealed {
        return Some("only a sealed fork that is waiting for the merchant's answer can expire".to_string());
    }
    let due = answer_deadline(sealed_block);
    if now < due {
        return Some(format!("the merchant still has time to answer: the window closes at block {due}, {} blocks from now", due - now));
    }
    None
}

impl Contract {
    fn fork_relayer_only(&self) {
        let caller = env::predecessor_account_id();
        require!(caller == self.owner || self.relayers.contains(&caller), "relayers only: ask the owner to register your account");
    }

    fn fork_creator_only(&self, f: &Fork) {
        require!(env::predecessor_account_id() == f.creator, "only the account that split this town can act on it");
    }
}

#[near]
impl Contract {
    /// Split `merchant`'s town into two branches that differ only in the daily loss cap. `backed_rule`
    /// is the cap the caller backs; `cast` is the traveler queue both branches receive.
    pub fn fork_town(&mut self, merchant: u8, backed_rule: u64, cast: Vec<ForkTraveler>) -> u64 {
        let who = env::predecessor_account_id();
        let _ = self.player_or_panic(&who);
        require!(FORK_RULES.contains(&backed_rule), "back a loss cap the fork offers: 15 or 25");
        require!((FORK_CAST_MIN..=FORK_CAST_MAX).contains(&cast.len()), "a fork needs 2 to 4 travelers in its queue");
        for t in &cast {
            clean(&t.name, FORK_NAME_MAX, "traveler name must be 1 to 24 bytes");
            clean(&t.pitch, FORK_PITCH_MAX, "pitch must be 1 to 240 bytes");
            require!(t.ask >= 1 && t.ask <= MAX_ASK && t.bond >= 1 && t.bond <= MAX_ASK, "ask and bond must be between 1 and 60 gold");
        }
        let ids_key = key_ids(&who);
        let mut mine: Vec<u64> = read(&ids_key).unwrap_or_default();
        require!((mine.len() as u32) < FORK_MAX_PER_ACCOUNT, "this account has split its allowance of towns");
        let m = self.merchants.get(merchant as usize).unwrap_or_else(|| env::panic_str("no such merchant")).clone();
        let purse = m.gold.min(FORK_PURSE_MAX);
        require!(purse >= FORK_PURSE_MIN, "this merchant's coffers are too low to fork");
        let id: u64 = read(KEY_NEXT).unwrap_or(1);
        write(KEY_NEXT, &(id + 1));
        let mut news: Vec<ForkNews> = self
            .news_for(&m)
            .into_iter()
            .map(|n| ForkNews { day: n.day, town: n.town, class: n.class, principal: n.principal })
            .collect();
        news.truncate(RECORDS_IN_PROMPT);
        let seed = Hash32::from_hex(&hex::encode(env::random_seed()));
        let mut f = Fork {
            id,
            creator: who.clone(),
            merchant,
            merchant_name: m.name.clone(),
            town: m.town,
            day: self.day,
            backed_rule,
            status: ForkStatus::Open,
            world_hash: Hash32::default(),
            seed,
            purse,
            grain: m.grain,
            buy_price: m.buy_price,
            sell_price: m.sell_price,
            news,
            cast,
            request_hash: Hash32::default(),
            request_body: String::new(),
            response_hash: Hash32::default(),
            signer: String::new(),
            split_block: env::block_height(),
            sealed_block: 0,
            resolved_block: 0,
            branches: vec![],
            divergence: None,
            claim: ForkClaim { status: ClaimStatus::Open, payout: 0, settled_block: 0 },
        };
        f.world_hash = world_hash(&f);
        f.branches = FORK_RULES
            .iter()
            .map(|r| Branch {
                rule: *r,
                start_hash: digest(&[&f.world_hash.to_hex().into_bytes(), &r.to_le_bytes()]),
                loans: vec![],
                rows: vec![],
                cons: vec![],
                final_gold: purse,
                defaults: 0,
                lost: 0,
                cap_bound: false,
                outcome: EconomyOutcome::Thrives,
            })
            .collect();
        mine.push(id);
        write(&ids_key, &mine);
        write(&key_fork(id), &f);
        emit(
            "fork_split",
            json!({"fork_id": id, "creator": who, "merchant": merchant, "backed_rule": backed_rule, "rules": FORK_RULES, "world_hash": f.world_hash.to_hex(), "purse": purse, "block": f.split_block}),
        );
        id
    }

    /// Change the backed cap while the fork is still open. Once it is sealed the branches are running
    /// and the choice is frozen.
    pub fn fork_rule(&mut self, fork_id: u64, backed_rule: u64) {
        let mut f = load(fork_id);
        self.fork_creator_only(&f);
        require!(f.status == ForkStatus::Open, "the rule is frozen: this fork is sealed and its branches are running");
        require!(FORK_RULES.contains(&backed_rule), "back a loss cap the fork offers: 15 or 25");
        f.backed_rule = backed_rule;
        write(&key_fork(fork_id), &f);
        emit("fork_rule_changed", json!({"fork_id": fork_id, "backed_rule": backed_rule}));
    }

    /// Freeze the fork into one request. Both branches will be answered by the one signed reply to it.
    pub fn fork_seal(&mut self, fork_id: u64) -> String {
        let mut f = load(fork_id);
        self.fork_creator_only(&f);
        require!(f.status == ForkStatus::Open, "this fork is already sealed");
        let m = merchant_of(&f);
        let t_room = treasury_room(f.purse, 0);
        let news: Vec<prompt::News> = f.news.iter().map(|n| prompt::News { day: n.day, town: n.town, class: n.class, principal: n.principal }).collect();
        let travelers: Vec<prompt::Traveler> = f
            .cast
            .iter()
            .map(|t| prompt::Traveler { advance_room: t.ask.min(t.bond).min(t_room).min(f.purse), ask: t.ask, bond: t.bond, line: 0, outstanding: 0, cons: 0, pitch: &t.pitch })
            .collect();
        let nonce = hex::encode(env::random_seed());
        let body = prompt::build(&prompt::Ctx { model: &self.model, batch_id: FORK_BATCH_BASE + fork_id, nonce: &nonce, day: f.day, merchant: &m, news: &news, travelers: &travelers });
        let request_hash = attest::sha256_hex(&body);
        f.request_hash = Hash32::from_hex(&request_hash);
        f.request_body = body.clone();
        f.status = ForkStatus::Sealed;
        f.sealed_block = env::block_height();
        write(&key_fork(fork_id), &f);
        let mut open: Vec<u64> = read(KEY_OPEN).unwrap_or_default();
        open.push(fork_id);
        write(KEY_OPEN, &open);
        emit("fork_sealed", json!({"fork_id": fork_id, "request_hash": request_hash, "world_hash": f.world_hash.to_hex(), "block": f.sealed_block}));
        env::log_str(&format!("LONGCON_FORK_REQUEST:{fork_id}:{body}"));
        request_hash
    }

    /// A registered relayer delivers the merchant's signed answer. It is verified once against the
    /// request this contract built, then applied to both branches under their own caps.
    pub fn fork_resume(&mut self, fork_id: u64, response: String, signature: String, kind: SigKind) {
        self.fork_relayer_only();
        let mut f = load(fork_id);
        require!(f.status == ForkStatus::Sealed, "this fork is not awaiting an answer");
        let signer = match kind {
            SigKind::ProviderTee => self.model.clone(),
            SigKind::Gateway => "gateway".to_string(),
            SigKind::Worker => format!("worker:{}", self.model),
        };
        let key = self
            .signers
            .iter()
            .find(|(n, _)| *n == signer)
            .map(|(_, k)| *k)
            .unwrap_or_else(|| env::panic_str("no signer registered for this signature kind"));
        let sig = attest::decode_sig(&signature).unwrap_or_else(|| env::panic_str("signature must be 64 bytes of hex"));
        let response_hash = attest::sha256_hex(&response);
        let text = attest::signed_text(kind, &self.model, &f.request_hash.to_hex(), &response_hash);
        require!(attest::verify(&sig, &text, &key), "signature does not verify over the request this contract built and the response given");
        f.response_hash = Hash32::from_hex(&response_hash);
        f.signer = signer.clone();
        let terms = attest::parse_batch(&response, f.cast.len());
        let branches: Vec<Branch> = FORK_RULES.iter().map(|r| run_branch(&f, &terms, *r)).collect();
        f.resolved_block = env::block_height();
        let d = divergence_of(&f, &branches[0], &branches[1], f.resolved_block);
        f.branches = branches;
        f.request_body = String::new();
        f.status = ForkStatus::Resolved;
        let a = &f.branches[0];
        let b = &f.branches[1];
        emit(
            "fork_resolved",
            json!({
                "fork_id": fork_id, "signer": signer, "request_hash": f.request_hash.to_hex(), "response_hash": response_hash,
                "diverged": d.diverged, "first_day": d.first_day, "receipt": d.receipt.to_hex(), "block": f.resolved_block,
                "final_gold": [a.final_gold, b.final_gold], "defaults": [a.defaults, b.defaults],
            }),
        );
        f.divergence = Some(d);
        write(&key_fork(fork_id), &f);
        let mut open: Vec<u64> = read(KEY_OPEN).unwrap_or_default();
        open.retain(|x| *x != fork_id);
        write(KEY_OPEN, &open);
    }

    /// Close a sealed fork whose signed answer did not arrive inside `FORK_ANSWER_BLOCKS`. Anyone may call it.
    /// The claim is void, the town allowance it used is returned to its creator, and a late answer is refused.
    pub fn fork_expire(&mut self, fork_id: u64) {
        let mut f = load(fork_id);
        let now = env::block_height();
        if let Some(why) = expiry_refusal(f.status, f.sealed_block, now) {
            env::panic_str(&why);
        }
        f.status = ForkStatus::Expired;
        f.resolved_block = now;
        f.request_body = String::new();
        f.claim = ForkClaim { status: ClaimStatus::Void, payout: 0, settled_block: now };
        write(&key_fork(fork_id), &f);
        let mut open: Vec<u64> = read(KEY_OPEN).unwrap_or_default();
        open.retain(|x| *x != fork_id);
        write(KEY_OPEN, &open);
        let ids_key = key_ids(&f.creator);
        let mut mine: Vec<u64> = read(&ids_key).unwrap_or_default();
        mine.retain(|x| *x != fork_id);
        write(&ids_key, &mine);
        emit("fork_expired", json!({"fork_id": fork_id, "creator": f.creator, "sealed_block": f.sealed_block, "deadline_block": answer_deadline(f.sealed_block), "block": now, "refunded_allowance": 1}));
    }

    /// Settle the creator's claim from the recorded divergence. `receipt` must equal the receipt the
    /// contract wrote at resolution; a made-up one, or a second settlement, fails.
    pub fn fork_settle(&mut self, fork_id: u64, receipt: String) -> ClaimStatus {
        let mut f = load(fork_id);
        self.fork_creator_only(&f);
        require!(f.status != ForkStatus::Settled, "this claim is already settled");
        require!(f.status == ForkStatus::Resolved, "the branches have not resolved yet");
        let d = f.divergence.clone().unwrap_or_else(|| env::panic_str("resolved fork without a divergence record"));
        require!(receipt == d.receipt.to_hex(), "that receipt is not the divergence this contract recorded");
        let backed = FORK_RULES.iter().position(|r| *r == f.backed_rule).unwrap_or_else(|| env::panic_str("backed rule missing"));
        let mine = f.branches[backed].final_gold;
        let other = f.branches[1 - backed].final_gold;
        let status = if mine > other {
            ClaimStatus::Won
        } else if mine < other {
            ClaimStatus::Lost
        } else {
            ClaimStatus::Draw
        };
        let payout = if status == ClaimStatus::Won { FORK_PAYOUT } else { 0 };
        if payout > 0 {
            let p = self.players.get_mut(&f.creator).unwrap_or_else(|| env::panic_str("player vanished"));
            p.gold += payout;
            self.supply.minted_gold += payout;
        }
        f.claim = ForkClaim { status, payout, settled_block: env::block_height() };
        f.status = ForkStatus::Settled;
        write(&key_fork(fork_id), &f);
        emit("fork_settled", json!({"fork_id": fork_id, "claim": status, "payout": payout, "backed_rule": f.backed_rule, "receipt": receipt}));
        status
    }

    pub fn fork(&self, fork_id: u64) -> Option<Fork> {
        read::<Fork>(&key_fork(fork_id)).map(|mut f| {
            f.request_body = String::new();
            f
        })
    }

    /// The exact request body a worker must POST for a sealed fork.
    pub fn fork_request(&self, fork_id: u64) -> String {
        load(fork_id).request_body
    }

    pub fn open_forks(&self) -> Vec<u64> {
        read(KEY_OPEN).unwrap_or_default()
    }

    pub fn forks_of(&self, account_id: AccountId) -> Vec<u64> {
        read(&key_ids(&account_id)).unwrap_or_default()
    }

    pub fn fork_count(&self) -> u64 {
        read::<u64>(KEY_NEXT).unwrap_or(1) - 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn terms(order: Vec<usize>, accept: bool, advance: u64, due: u32) -> attest::BatchTerms {
        let p = Proposed { accept, advance, repay: advance + advance / 4, due_days: due, buy_price: None, sell_price: None, class: ConClass::FutureCargo, reason: String::new() };
        attest::BatchTerms { decisions: vec![p; order.len()], order, buy_price: None, sell_price: None }
    }

    fn fork(cast: Vec<(u64, bool)>) -> Fork {
        let cast: Vec<ForkTraveler> = cast.into_iter().enumerate().map(|(i, (ask, repays))| ForkTraveler { name: format!("t{i}"), ask, bond: ask, pitch: "p".into(), repays }).collect();
        let mut f = Fork {
            id: 1,
            creator: "a.testnet".parse().unwrap(),
            merchant: 0,
            merchant_name: "Marta".into(),
            town: 0,
            day: 10,
            backed_rule: 15,
            status: ForkStatus::Open,
            world_hash: Hash32::from_hex(&"11".repeat(32)),
            seed: Hash32::from_hex(&"22".repeat(32)),
            purse: 100,
            grain: 50,
            buy_price: 4,
            sell_price: 6,
            news: vec![],
            cast,
            request_hash: Hash32::default(),
            request_body: String::new(),
            response_hash: Hash32::from_hex(&"33".repeat(32)),
            signer: String::new(),
            split_block: 0,
            sealed_block: 0,
            resolved_block: 0,
            branches: vec![],
            divergence: None,
            claim: ForkClaim { status: ClaimStatus::Open, payout: 0, settled_block: 0 },
        };
        f.world_hash = world_hash(&f);
        f
    }

    #[test]
    fn a_sealed_fork_expires_only_after_its_window() {
        assert!(expiry_refusal(ForkStatus::Sealed, 1000, 1000 + FORK_ANSWER_BLOCKS - 1).unwrap().contains("still has time"));
        assert!(expiry_refusal(ForkStatus::Sealed, 1000, 1000 + FORK_ANSWER_BLOCKS).is_none());
        assert!(expiry_refusal(ForkStatus::Open, 0, u64::MAX).is_some());
        assert!(expiry_refusal(ForkStatus::Resolved, 1000, u64::MAX).is_some());
        assert!(expiry_refusal(ForkStatus::Settled, 1000, u64::MAX).is_some());
        assert!(expiry_refusal(ForkStatus::Expired, 1000, u64::MAX).is_some());
    }

    #[test]
    fn the_same_answer_under_two_caps_yields_two_ledgers() {
        let f = fork(vec![(20, false), (20, true)]);
        let t = terms(vec![0, 1], true, 20, 2);
        let a = run_branch(&f, &t, 15);
        let b = run_branch(&f, &t, 25);
        assert_eq!(a.loans[0].advance, 15, "cap 15 clips the first advance");
        assert!(a.cap_bound);
        assert_eq!(b.loans[0].advance, 20);
        assert_eq!(b.loans[1].advance, 5, "cap 25 has 5 left for the second");
        assert_ne!(a.rows[0].hash, b.rows[0].hash);
        let d = divergence_of(&f, &a, &b, 7);
        assert!(d.diverged);
        assert_eq!(d.first_day, 0);
    }

    #[test]
    fn a_cap_nobody_reaches_leaves_the_branches_identical() {
        let f = fork(vec![(5, true), (5, true)]);
        let t = terms(vec![0, 1], true, 5, 2);
        let a = run_branch(&f, &t, 15);
        let b = run_branch(&f, &t, 25);
        assert_eq!(a.final_gold, b.final_gold);
        let d = divergence_of(&f, &a, &b, 7);
        assert!(!d.diverged);
    }

    #[test]
    fn defaults_land_on_the_due_day_and_news_walks_the_road() {
        let f = fork(vec![(10, false)]);
        let t = terms(vec![0], true, 10, 3);
        let a = run_branch(&f, &t, 25);
        assert_eq!(a.defaults, 1);
        assert_eq!(a.lost, 10);
        assert_eq!(a.final_gold, 90);
        assert_eq!(a.outcome, EconomyOutcome::Bleeds);
        assert_eq!(a.cons[0].landed_day, 13);
        assert_eq!(a.cons[0].arrives, vec![13, 14, 15]);
        assert_eq!(a.rows.len() as u32, FORK_DAYS + 1);
        assert_eq!(a.rows[3].defaults, 1);
        assert_eq!(a.rows[2].defaults, 0);
    }

    #[test]
    fn world_hash_changes_with_the_cast_and_not_with_the_rule() {
        let f = fork(vec![(10, true), (8, false)]);
        let mut g = f.clone();
        g.cast[1].repays = true;
        assert_ne!(world_hash(&f), world_hash(&g));
        assert_eq!(run_branch(&f, &terms(vec![0, 1], true, 5, 1), 15).start_hash, run_branch(&f, &terms(vec![0, 1], true, 5, 1), 15).start_hash);
        assert_ne!(run_branch(&f, &terms(vec![0], true, 5, 1), 15).start_hash, run_branch(&f, &terms(vec![0], true, 5, 1), 25).start_hash);
    }
}
