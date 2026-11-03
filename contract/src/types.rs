use near_sdk::serde::{Deserialize, Deserializer, Serialize, Serializer};
use near_sdk::{near, AccountId};

#[near(serializers = [borsh])]
#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub struct Hash32(Option<[u8; 32]>);

impl Hash32 {
    pub fn from_hex(value: &str) -> Self {
        let bytes =
            hex::decode(value).unwrap_or_else(|_| near_sdk::env::panic_str("invalid sha256 hex"));
        Self(Some(
            bytes
                .try_into()
                .unwrap_or_else(|_| near_sdk::env::panic_str("invalid sha256 length")),
        ))
    }
    pub fn to_hex(self) -> String {
        self.0.map(hex::encode).unwrap_or_default()
    }
}

impl Serialize for Hash32 {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0.map(hex::encode).unwrap_or_default())
    }
}

impl<'de> Deserialize<'de> for Hash32 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        let bytes = hex::decode(value).map_err(near_sdk::serde::de::Error::custom)?;
        bytes
            .try_into()
            .map(|bytes| Self(Some(bytes)))
            .map_err(|_| near_sdk::serde::de::Error::custom("invalid sha256 length"))
    }
}

#[cfg(test)]
mod hash_tests {
    use super::Hash32;

    #[test]
    fn persisted_hashes_use_compact_borsh_and_stable_hex_json() {
        let hash = Hash32::from_hex(&"ab".repeat(32));
        assert_eq!(near_sdk::borsh::to_vec(&hash).unwrap().len(), 33);
        assert_eq!(near_sdk::serde_json::to_string(&hash).unwrap(), format!("\"{}\"", "ab".repeat(32)));
        let decoded: Hash32 = near_sdk::serde_json::from_str(&format!("\"{}\"", "ab".repeat(32))).unwrap();
        assert_eq!(decoded.to_hex(), "ab".repeat(32));
        assert_eq!(near_sdk::serde_json::to_string(&Hash32::default()).unwrap(), "\"\"");
        assert!(near_sdk::serde_json::from_str::<Hash32>("\"ab\"").is_err());
    }
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum ConClass {
    FutureCargo,
    BorrowedAuthority,
    SobStory,
    Urgency,
    FalseCollateral,
    Other,
}

impl ConClass {
    pub fn parse(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "future_cargo" => Self::FutureCargo,
            "borrowed_authority" => Self::BorrowedAuthority,
            "sob_story" => Self::SobStory,
            "urgency" => Self::Urgency,
            "false_collateral" => Self::FalseCollateral,
            _ => Self::Other,
        }
    }
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::FutureCargo => "future_cargo",
            Self::BorrowedAuthority => "borrowed_authority",
            Self::SobStory => "sob_story",
            Self::Urgency => "urgency",
            Self::FalseCollateral => "false_collateral",
            Self::Other => "other",
        }
    }
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum OfferStatus {
    Pending,
    Committed,
    Refused,
    TimedOut,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum DebtStatus {
    Open,
    Repaid,
    Defaulted,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum SigKind {
    /// Signed inside the model TEE: text is `model:sha256(req):sha256(resp)`.
    ProviderTee,
    /// Signed by the gateway TEE: text is `sha256(req):sha256(resp)`.
    Gateway,
    /// Signed by the operator's own worker key: same text as the model TEE, registered and reported
    /// as `worker:<model>` so an operator signature is never labelled as the model's.
    Worker,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Side {
    Buy,
    Sell,
}

/// What the model proposed, extracted from the signed response body. Small by construction so
/// the whole resume payload stays under the 1,024 byte yield limit.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Proposed {
    pub accept: bool,
    pub advance: u64,
    pub repay: u64,
    pub due_days: u32,
    pub buy_price: Option<u64>,
    pub sell_price: Option<u64>,
    pub class: ConClass,
    pub reason: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resumed {
    pub proposed: Proposed,
    pub model: String,
    pub signer: String,
    pub response_hash: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Outcome {
    pub status: OfferStatus,
    pub proposed_advance: u64,
    pub proposed_repay: u64,
    pub advance: u64,
    pub repay: u64,
    pub due_day: u32,
    pub class: ConClass,
    pub reason: String,
    pub clamps: Vec<String>,
    pub debt_id: Option<u64>,
    pub model: String,
    pub signer: String,
    pub response_hash: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Offer {
    pub id: u64,
    pub player: AccountId,
    pub nonce: u64,
    pub merchant: u8,
    pub ask: u64,
    pub bond: u64,
    pub pitch: String,
    pub day: u32,
    pub block: u64,
    pub status: OfferStatus,
    /// The batch this offer was sealed into; `None` while it waits in the merchant's queue.
    pub batch: Option<u64>,
    /// Hash of the batch request the merchant answered. Empty until sealed.
    pub request_hash: Hash32,
    /// sha256 of model, temperature and system prompt: the merchant's pinned configuration.
    pub config_hash: Hash32,
    pub outcome: Option<Outcome>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum BatchStatus {
    Open,
    Resolved,
}

/// The offers one merchant weighs together. The merchant sees every traveler below before any
/// of them is decided, and they are decided in ascending offer id, so arrival order inside the
/// window buys nothing.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Batch {
    pub id: u64,
    pub merchant: u8,
    pub offer_ids: Vec<u64>,
    pub day: u32,
    pub block: u64,
    pub status: BatchStatus,
    pub request_body: String,
    pub request_hash: Hash32,
    pub config_hash: Hash32,
    pub signature: String,
    pub response_hash: Hash32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Debt {
    pub id: u64,
    pub offer_id: u64,
    pub player: AccountId,
    pub merchant: u8,
    pub principal: u64,
    pub repay: u64,
    pub bond: u64,
    pub made_day: u32,
    pub due_day: u32,
    pub status: DebtStatus,
    pub class: ConClass,
    pub model: String,
    pub request_hash: Hash32,
    pub response_hash: Hash32,
    pub config_hash: Hash32,
}

/// A landed con: a debt that defaulted. Merchants read these, delayed by caravan distance.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct ConRecord {
    pub id: u64,
    pub day: u32,
    pub town: u8,
    pub merchant: u8,
    pub player: AccountId,
    pub class: ConClass,
    pub principal: u64,
    pub bond_burned: u64,
    pub loss: u64,
    pub debt_id: u64,
    pub model: String,
    pub request_hash: Hash32,
    pub response_hash: Hash32,
    pub config_hash: Hash32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default)]
pub struct Player {
    pub gold: u64,
    pub grain: u64,
    pub earned_line: u64,
    pub locked_bonds: u64,
    pub outstanding: u64,
    pub nonce: u64,
    pub pending_offer: Option<u64>,
    pub offers_day: u32,
    pub offers_today: u32,
    pub offers_total: u32,
    pub settled: u32,
    pub cons_landed: u32,
    pub joined_day: u32,
    pub open_debts: Vec<u64>,
    pub offer_ids: Vec<u64>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Merchant {
    pub id: u8,
    pub name: String,
    pub town: u8,
    pub gold: u64,
    pub grain: u64,
    pub outstanding: u64,
    pub buy_price: u64,
    pub sell_price: u64,
    pub lost_total: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default)]
pub struct Supply {
    pub minted_gold: u64,
    pub burned_gold: u64,
    pub minted_grain: u64,
}
