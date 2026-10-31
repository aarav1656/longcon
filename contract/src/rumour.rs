//! Rumour tokens, a NEP-245 subset (transfer, batch transfer, balance and supply views, events).
//! A landed con mints one `rumour:<class>` token to the con artist. The first landing of a class
//! also takes its place on the Wanted board.
use crate::types::{ConClass, ConRecord};
use crate::{Contract, ContractExt};
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{assert_one_yocto, env, near, require, AccountId};

pub fn token_id(class: ConClass) -> String {
    format!("rumour:{}", class.as_str())
}

fn event(name: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard": "nep245", "version": "1.0.0", "event": name, "data": [data]})
    ));
}

#[near(serializers = [json])]
pub struct MtToken {
    pub token_id: String,
    pub owner_id: Option<AccountId>,
}

#[near(serializers = [json])]
pub struct MtMetadata {
    pub title: String,
    pub description: String,
    pub class: ConClass,
}

#[near(serializers = [json])]
pub struct WantedRow {
    pub class: ConClass,
    pub record_id: u64,
    pub first_player: AccountId,
    pub day: u32,
    pub landed: u64,
}

impl Contract {
    pub(crate) fn mint_rumour(&mut self, rec: &ConRecord) {
        let id = token_id(rec.class);
        let bal = self.rumour_balances.get(&(rec.player.clone(), id.clone())).copied().unwrap_or(0);
        self.rumour_balances.insert((rec.player.clone(), id.clone()), bal + 1);
        let sup = self.rumour_supply.get(&id).copied().unwrap_or(0);
        self.rumour_supply.insert(id.clone(), sup + 1);
        event("mt_mint", json!({"owner_id": rec.player, "token_ids": [id], "amounts": ["1"], "memo": format!("con record {}", rec.id)}));
        if let Some(row) = self.wanted.iter_mut().find(|w| w.0 == rec.class) {
            row.2 += 1;
        } else {
            self.wanted.push((rec.class, rec.id, 1));
        }
    }

    fn move_rumour(&mut self, from: &AccountId, to: &AccountId, id: &str, amount: u128) {
        require!(amount > 0, "amount must be positive");
        require!(from != to, "sender and receiver must differ");
        let fb = self.rumour_balances.get(&(from.clone(), id.to_string())).copied().unwrap_or(0);
        require!(fb >= amount, "not enough rumours");
        self.rumour_balances.insert((from.clone(), id.to_string()), fb - amount);
        let tb = self.rumour_balances.get(&(to.clone(), id.to_string())).copied().unwrap_or(0);
        self.rumour_balances.insert((to.clone(), id.to_string()), tb + amount);
    }
}

#[near]
impl Contract {
    #[payable]
    pub fn mt_transfer(&mut self, receiver_id: AccountId, token_id: String, amount: U128, approval: Option<(AccountId, u64)>, memo: Option<String>) {
        assert_one_yocto();
        require!(approval.is_none(), "approvals are not supported");
        let from = env::predecessor_account_id();
        self.move_rumour(&from, &receiver_id, &token_id, amount.0);
        event("mt_transfer", json!({"old_owner_id": from, "new_owner_id": receiver_id, "token_ids": [token_id], "amounts": [amount.0.to_string()], "memo": memo}));
    }

    #[payable]
    pub fn mt_batch_transfer(&mut self, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>, approvals: Option<Vec<Option<(AccountId, u64)>>>, memo: Option<String>) {
        assert_one_yocto();
        require!(approvals.map_or(true, |a| a.iter().all(|x| x.is_none())), "approvals are not supported");
        require!(token_ids.len() == amounts.len() && !token_ids.is_empty(), "token_ids and amounts must match");
        let from = env::predecessor_account_id();
        for (id, a) in token_ids.iter().zip(amounts.iter()) {
            self.move_rumour(&from, &receiver_id, id, a.0);
        }
        event("mt_transfer", json!({"old_owner_id": from, "new_owner_id": receiver_id, "token_ids": token_ids, "amounts": amounts.iter().map(|a| a.0.to_string()).collect::<Vec<_>>(), "memo": memo}));
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 {
        U128(self.rumour_balances.get(&(account_id, token_id)).copied().unwrap_or(0))
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<String>) -> Vec<U128> {
        token_ids.into_iter().map(|t| self.mt_balance_of(account_id.clone(), t)).collect()
    }

    pub fn mt_supply(&self, token_id: String) -> Option<U128> {
        self.rumour_supply.get(&token_id).map(|s| U128(*s))
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<String>) -> Vec<Option<U128>> {
        token_ids.into_iter().map(|t| self.mt_supply(t)).collect()
    }

    pub fn mt_token(&self, token_ids: Vec<String>) -> Vec<Option<MtToken>> {
        token_ids
            .into_iter()
            .map(|t| self.rumour_supply.get(&t).map(|_| MtToken { token_id: t, owner_id: None }))
            .collect()
    }

    pub fn mt_metadata_token_by_token_id(&self, token_ids: Vec<String>) -> Vec<Option<MtMetadata>> {
        token_ids
            .into_iter()
            .map(|t| {
                self.rumour_supply.get(&t)?;
                let class = ConClass::parse(t.strip_prefix("rumour:")?);
                Some(MtMetadata {
                    title: format!("Rumour: {}", class.as_str()),
                    description: format!("A {} con landed on the road. One token per landing.", class.as_str()),
                    class,
                })
            })
            .collect()
    }

    /// The Wanted board: for each con class, the first landing and how many have landed since.
    pub fn wanted(&self) -> Vec<WantedRow> {
        self.wanted
            .iter()
            .filter_map(|(class, id, n)| {
                let r = self.records.get((*id - 1) as u32)?;
                Some(WantedRow { class: *class, record_id: *id, first_player: r.player.clone(), day: r.day, landed: *n })
            })
            .collect()
    }
}
