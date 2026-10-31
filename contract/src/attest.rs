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
        SigKind::ProviderTee => format!("{model}:{req_hash}:{resp_hash}"),
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

pub fn parse_terms(response_body: &str) -> Proposed {
    let Some(obj) = content_of(response_body).and_then(|c| object_of(&c)) else {
        return unparsable();
    };
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
    fn signed_text_shapes() {
        assert_eq!(signed_text(SigKind::ProviderTee, "m", "a", "b"), "m:a:b");
        assert_eq!(signed_text(SigKind::Gateway, "m", "a", "b"), "a:b");
    }
}
