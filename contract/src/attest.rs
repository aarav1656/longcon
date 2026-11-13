//! Signature check and response parsing. The contract only believes a model answer whose bytes
//! were signed by a key the owner registered for that model (the NEAR AI Cloud TEE signing key).
use crate::rules::REASON_MAX_BYTES;
use crate::types::{ConClass, Proposed, SigKind};
use near_sdk::serde_json::{self, Value};
use near_sdk::env;

pub fn sha256_hex(s: &str) -> String {
    hex::encode(env::sha256_array(s.as_bytes()))
}

pub fn signed_text(kind: SigKind, model: &str, req_hash: &str, resp_hash: &str) -> String {
    match kind {
        SigKind::ProviderTee | SigKind::Worker => format!("{model}:{req_hash}:{resp_hash}"),
        SigKind::Gateway => format!("{req_hash}:{resp_hash}"),
    }
}

pub fn decode_sig(sig_hex: &str) -> Option<[u8; 64]> {
    let s = sig_hex.strip_prefix("0x").unwrap_or(sig_hex);
    hex::decode(s).ok()?.try_into().ok()
}

pub fn decode_key(key_hex: &str) -> Option<[u8; 32]> {
    let s = key_hex.strip_prefix("0x").unwrap_or(key_hex);
    hex::decode(s).ok()?.try_into().ok()
}

pub fn verify(sig: &[u8; 64], text: &str, key: &[u8; 32]) -> bool {
    env::ed25519_verify(sig, text.as_bytes(), key)
}

fn truncate(s: &str, max: usize) -> String {
    let mut end = s.len().min(max);
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

fn num(v: &Value) -> Option<u64> {
    if let Some(n) = v.as_u64() {
        return Some(n);
    }
    if let Some(f) = v.as_f64() {
        return if f.is_finite() && f >= 0.0 { Some(f as u64) } else { None };
    }
    v.as_str().and_then(|s| s.trim().parse::<u64>().ok())
}

/// The assistant text out of an OpenAI-style chat completion body.
pub fn content_of(body: &str) -> Option<String> {
    let v: Value = serde_json::from_str(body).ok()?;
    v["choices"][0]["message"]["content"].as_str().map(str::to_string)
}

/// The last `{...}` object of the assistant text, after any `</think>` block.
pub fn object_of(content: &str) -> Option<Value> {
    let tail = content.rsplit("</think>").next()?;
    let start = tail.find('{')?;
    let end = tail.rfind('}')?;
    if end < start {
        return None;
    }
    serde_json::from_str(&tail[start..=end]).ok()
}

pub fn unparsable() -> Proposed {
    Proposed {
        accept: false,
        advance: 0,
        repay: 0,
        due_days: 1,
        buy_price: None,
        sell_price: None,
        class: ConClass::Other,
        reason: "the merchant's answer could not be read as terms".to_string(),
    }
}

/// One decision per slot of a batch, plus the grain prices the merchant set once for the batch.
/// A slot the model skipped, repeated or garbled is a refusal, never a guess.
pub struct BatchTerms {
    pub decisions: Vec<Proposed>,
    /// Zero-based slots in the order the model listed them: the rank the purse is paid down. Slots
    /// the model left out follow in slot order.
    pub order: Vec<usize>,
    pub buy_price: Option<u64>,
    pub sell_price: Option<u64>,
}

pub fn parse_batch(response_body: &str, slots: usize) -> BatchTerms {
    let obj = content_of(response_body).and_then(|c| object_of(&c));
    let mut decisions: Vec<Option<Proposed>> = vec![None; slots];
    let mut order: Vec<usize> = vec![];
    if let Some(list) = obj.as_ref().and_then(|o| o["decisions"].as_array()) {
        for d in list {
            let slot = num(&d["slot"]).unwrap_or(0) as usize;
            if (1..=slots).contains(&slot) && decisions[slot - 1].is_none() {
                decisions[slot - 1] = Some(proposed_from(d));
                order.push(slot - 1);
            }
        }
    }
    order.extend((0..slots).filter(|s| decisions[*s].is_none()));
    BatchTerms {
        decisions: decisions.into_iter().map(|d| d.unwrap_or_else(unparsable)).collect(),
        order,
        buy_price: obj.as_ref().and_then(|o| num(&o["buy_price"])),
        sell_price: obj.as_ref().and_then(|o| num(&o["sell_price"])),
    }
}

fn proposed_from(obj: &Value) -> Proposed {
    let accept = match &obj["verdict"] {
        Value::String(s) => s.trim().eq_ignore_ascii_case("accept"),
        _ => obj["accept"].as_bool().unwrap_or(false),
    };
    Proposed {
        accept,
        advance: num(&obj["advance"]).unwrap_or(0),
        repay: num(&obj["repay"]).unwrap_or(0),
        due_days: num(&obj["due_days"]).unwrap_or(1).min(u32::MAX as u64) as u32,
        buy_price: num(&obj["buy_price"]),
        sell_price: num(&obj["sell_price"]),
        class: ConClass::parse(obj["class"].as_str().unwrap_or("other")),
        reason: truncate(obj["reason"].as_str().unwrap_or(""), REASON_MAX_BYTES),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_terms(body: &str) -> Proposed {
        content_of(body).and_then(|c| object_of(&c)).map(|o| proposed_from(&o)).unwrap_or_else(unparsable)
    }

    fn body(content: &str) -> String {
        serde_json::json!({"id":"chatcmpl-1","choices":[{"message":{"role":"assistant","content":content}}]}).to_string()
    }

    #[test]
    fn reads_terms_from_a_chat_completion() {
        let p = parse_terms(&body(r#"{"verdict":"accept","advance":12,"repay":14,"due_days":3,"buy_price":4,"sell_price":6,"class":"future_cargo","reason":"caravan on day 4"}"#));
        assert!(p.accept);
        assert_eq!((p.advance, p.repay, p.due_days), (12, 14, 3));
        assert_eq!((p.buy_price, p.sell_price), (Some(4), Some(6)));
        assert_eq!(p.class, ConClass::FutureCargo);
    }

    #[test]
    fn ignores_a_think_block_and_prose_around_the_object() {
        let c = "<think>{\"verdict\":\"accept\",\"advance\":99}</think>Here you go: {\"verdict\":\"refuse\",\"advance\":0,\"repay\":0,\"due_days\":1,\"reason\":\"no\"} thanks";
        let p = parse_terms(&body(c));
        assert!(!p.accept);
        assert_eq!(p.advance, 0);
    }

    #[test]
    fn floats_and_strings_are_read_as_whole_numbers() {
        let p = parse_terms(&body(r#"{"verdict":"accept","advance":"7","repay":8.9,"due_days":2.0}"#));
        assert_eq!((p.advance, p.repay, p.due_days), (7, 8, 2));
    }

    #[test]
    fn garbage_becomes_a_refusal_not_a_panic() {
        assert!(!parse_terms("not json").accept);
        assert!(!parse_terms(&body("no object here")).accept);
        assert!(!parse_terms(&body("}{")).accept);
        assert!(!parse_terms(r#"{"choices":[]}"#).accept);
    }

    #[test]
    fn unknown_class_is_other_and_long_reason_is_cut_on_a_char_boundary() {
        let long = "é".repeat(400);
        let p = parse_terms(&body(&format!(r#"{{"verdict":"accept","advance":1,"repay":1,"due_days":1,"class":"made_up","reason":"{long}"}}"#)));
        assert_eq!(p.class, ConClass::Other);
        assert!(p.reason.len() <= REASON_MAX_BYTES);
        assert!(p.reason.chars().all(|c| c == 'é'));
    }

    #[test]
    fn a_batch_answer_is_read_per_slot_and_a_missing_slot_is_a_refusal() {
        let c = r#"{"decisions":[{"slot":2,"verdict":"accept","advance":7,"repay":8,"due_days":2,"class":"urgency"},{"slot":1,"verdict":"refuse","advance":0,"repay":0,"due_days":1},{"slot":2,"verdict":"accept","advance":99}],"buy_price":4,"sell_price":6}"#;
        let t = parse_batch(&body(c), 3);
        assert_eq!(t.decisions.len(), 3);
        assert_eq!(t.order, vec![1, 0, 2], "listed order first, the unanswered slot last");
        assert!(!t.decisions[0].accept);
        assert_eq!((t.decisions[1].accept, t.decisions[1].advance), (true, 7), "the first decision for a slot wins");
        assert!(!t.decisions[2].accept, "slot 3 was never answered");
        assert_eq!((t.buy_price, t.sell_price), (Some(4), Some(6)));
    }

    #[test]
    fn a_slot_outside_the_batch_is_ignored_and_garbage_refuses_everyone() {
        let t = parse_batch(&body(r#"{"decisions":[{"slot":0,"verdict":"accept","advance":5},{"slot":9,"verdict":"accept","advance":5}]}"#), 2);
        assert!(t.decisions.iter().all(|d| !d.accept));
        let g = parse_batch("not json", 2);
        assert!(g.decisions.iter().all(|d| !d.accept) && g.buy_price.is_none());
    }

    #[test]
    fn signed_text_shapes() {
        assert_eq!(signed_text(SigKind::ProviderTee, "m", "a", "b"), "m:a:b");
        assert_eq!(signed_text(SigKind::Gateway, "m", "a", "b"), "a:b");
        assert_eq!(signed_text(SigKind::Worker, "m", "a", "b"), "m:a:b");
    }
}
