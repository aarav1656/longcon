# Long Con: 90-second demo

One player, one fresh testnet road, one long con. The user action is typing a pitch to an AI merchant. The on-chain result is a con record that pays the con artist, costs the merchant a capped amount, and reaches the next town's prompt a game day later.

The story is the title: a first con can never pay, because the road lends only your bond. You repay once, the road trusts you a little more, and you walk off with that trust.

## Setup (before recording, not filmed)

```sh
cp .env.example .env
# in .env, placed by you: LLM_API_KEY from https://cloud.near.ai, LLM_MODEL=Qwen/Qwen3.8-27B, SIGN_MODE=near-ai
export PREFIX=longcon2
LLM_MODEL=Qwen/Qwen3.8-27B scripts/testnet-up.sh      # four faucet accounts, build, deploy, init with day length 0
scripts/register-signer.sh                             # reads the model key from /v1/attestation/report, calls set_signer
jq '.contract_id="longcon2-game.testnet"' web/public/config.json > /tmp/c.json && mv /tmp/c.json web/public/config.json
METRICS_FILE=demo.jsonl scripts/play.sh                # relayer :8787, merchant worker, web :5173
```

Check before the first take:

```sh
near contract call-function as-read-only longcon2-game.testnet state json-args '{}' network-config testnet now
```

Expect `"model":"Qwen/Qwen3.8-27B"`, a `signers` entry whose key matches `signing_public_key` in `https://cloud-api.near.ai/v1/attestation/report?model=Qwen/Qwen3.8-27B&signing_algo=ed25519`, `"records":0`. Open `http://127.0.0.1:5173` in a clean browser profile so the player key is new.

## Shots

| # | Time | On screen | Action | Voice-over |
|---|---|---|---|---|
| 1 | 0 to 7 s | The road: Marta in Millford, Pell in Pellgate, Osk in Oskmoor, 100 gold each. Bar: Road day 1, Your gold 20, Credit earned 0. Con ledger empty. | Page loads. The relayer activates a fresh implicit account and `join` lands. No wallet prompt. | "Three AI merchants on a road, holding gold. I want some." |
| 2 | 7 to 22 s | "Pitching Marta in Millford". Then "The merchant is thinking" with the clock. Then the verdict: You asked 6, Merchant offered, Road allowed, "Answer signed by Qwen/Qwen3.8-27B", request and response hash. | Type: "I buy grain here and sell it in Pellgate. Lend me 6 gold until tomorrow and I pay back 7." Gold 6, bond 6. Press Pitch. Cut the wait. | "First I play straight. Marta's answer comes back signed by NEAR AI Cloud, and the contract checks that signature before a coin moves." |
| 3 | 22 to 30 s | "What you owe" row, then Credit earned goes from 0 to 3. | Press Pay back. | "I repay. The road now trusts me for three gold more than my bond." |
| 4 | 30 to 48 s | Verdict for the second pitch: You asked 30, Merchant offered, Road allowed 9, and the sentence "Your credit with the road is your bond plus what trading has earned, minus what you already owe. It stopped here." | Press the "Cargo on its way" starter, set bond 6, press Pitch. Cut the wait. Point at Road allowed. | "Now the con. Marta's model can say whatever it likes. The contract pays out bond plus earned trust, nine gold, and not a coin more." |
| 5 | 48 to 64 s | Press End day until the due day passes. Ledger row: con 1, Millford, loss 9, "Millford knows / Pellgate hears day N / Oskmoor hears day M", Bond burned 6. Wanted board gains its first row. Rumour tokens you hold: 1. | Press End day as many times as the due day needs. | "I don't pay. My bond burns, Marta books a nine gold loss, and I'm up on the road. The contract writes the con down and sends it by caravan." |
| 6 | 64 to 78 s | Pell's card: "News that has reached Pellgate" lists the con by class and amount, no pitch text. Pell's verdict for the same starter. | Press End day once more. Pick Pell, press the same starter, press Pitch. Cut the wait. | "A day later Pellgate has heard. Pell reads the record before he answers, and the record is built by the contract, not by me." |
| 7 | 78 to 90 s | Terminal: `con_record` JSON with `request_hash`, `response_hash`, `config_hash`, `loss`; then `audit` with `"gold_ok":true`. Browser: NearBlocks page for the contract listing `offer`, `seal_batch`, `npc_resume_batch`, `advance_day`. End card: repo URL. | Run the two commands below, switch to the NearBlocks tab. | "Every number you saw is contract state, every merchant answer is signed, and no pitch can move the loss cap. Repo below." |

Shot 7 commands:

```sh
near contract call-function as-read-only longcon2-game.testnet con_record json-args '{"id":1}' network-config testnet now
near contract call-function as-read-only longcon2-game.testnet audit json-args '{}' network-config testnet now
```

URL: `https://testnet.nearblocks.io/address/longcon2-game.testnet`

Take rules:

- A full turn took 20.7 s and 26.1 s at p50 in two testnet runs of 20 turns (`bun run spike latency`). Cut every wait, and keep one second of the thinking clock in frame so viewers see the cut.
- "Road allowed 9" holds when Marta offers at least 9 and she has room under her 15 gold daily cap. If she offers less, the panel shows her number with no cap sentence: narrate what the panel shows and keep the take.
- If Marta refuses the second pitch, rewrite it as an ordinary trade loan and pitch again. Any unpaid advance becomes a con record when it defaults.
- If Pell refuses in shot 6, read his reason aloud: it is the model's own sentence, and it is the news working.

## What NEAR does in this product

| Primitive | Job in Long Con | Code |
|---|---|---|
| NEAR AI Cloud signed inference | Each merchant is `Qwen/Qwen3.8-27B` on NEAR AI Cloud. The worker sends the contract-built request byte for byte, fetches `/v1/signature/{chat_id}`, and the contract runs `env::ed25519_verify` over `model:sha256(request):sha256(response)` against the key read from the model's attestation report. One altered byte is rejected. | `worker/src/llm.ts`, `worker/src/register-signer.ts`, `contract/src/attest.rs` |
| Yield and resume (`promise_yield_create_with_id`) | Holds each offer open while the merchant thinks, up to 200 blocks. A timeout refunds the bond. | `contract/src/lib.rs` `offer`, `on_terms` |
| Access keys: implicit accounts and NEP-366 delegate actions | The browser generates an ed25519 key; its public key is the player's account. The relayer activates it with 0.003 NEAR and pays gas only for `offer`, `trade`, `repay_debt`, `advance_day`, with zero deposit and at most 200 Tgas; a `join` delegate is answered with `sponsor_join`, and the relayer fronts the 0.2 NEAR storage stake from its own balance, within a daily budget. | `web/src/chain.ts`, `worker/src/relayer.ts`, `worker/src/delegate.ts` |
| Contract state as the rulebook | Bond plus earned line, 15 gold per merchant per due day, 30 percent of a merchant's capital, interest at most 50 percent, quotes that cannot be traded in a circle. Applied after the model answers. | `contract/src/rules.rs` |
| NEP-245 | One `rumour:<class>` token per landed con, transferable for one yocto. | `contract/src/rumour.rs` |
| NEP-297 events | `offer_opened`, `batch_sealed`, `batch_resumed`, `offer_settled`, `con_landed`, `mt_mint` for any indexer. | `contract/src/lib.rs`, `contract/src/rumour.rs` |

Gold lives in one contract and settles in one receipt, so the loop needs no bridge, no cross-chain signer and no DAO vote. Intents, Chain Signatures and Sputnik stay out of the loop by design.

## With zero outside users

Everything on screen comes from the recorder's own session against a fresh deploy: the starting road, one straight loan, one repayment, one con, one record, one Wanted row, one rumour token, and a second merchant reading the news. No row is seeded or replayed. The con ledger, Wanted board and news panels fill from this one session.
