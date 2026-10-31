# Long Con: 90-second demo

One continuous session by one player on a fresh testnet deploy. The user action is typing a pitch to an AI merchant. The visible on-chain result is a con record that the next town reads two game days later, with the signer, request hash and response hash attached.

## Setup (before recording, not filmed)

```sh
# .env (never committed): LLM_API_KEY from cloud.near.ai, LLM_MODEL=Qwen/Qwen3.8-27B, SIGN_MODE=near-ai
export PREFIX=longcon2                                             # fresh accounts: longcon-game.testnet holds pre-batch state
LLM_MODEL=Qwen/Qwen3.8-27B scripts/testnet-up.sh                   # 4 faucet accounts, build, deploy, init (day length 0)
jq '.contract_id="longcon2-game.testnet"' web/public/config.json > /tmp/c.json && mv /tmp/c.json web/public/config.json
scripts/register-signer.sh                                         # reads the model's signing key from /v1/attestation/report, calls set_signer
METRICS_FILE=run.jsonl scripts/play.sh                             # relayer :8787, merchant worker, web :5173
```

Check the contract before the first take:

```sh
near contract call-function as-read-only longcon2-game.testnet state json-args '{}' network-config testnet now
```

Expect `"model":"Qwen/Qwen3.8-27B"`, a `signers` entry for that model, `offers 0`. Open `http://127.0.0.1:5173` in a clean browser profile so the player key is new.

## Shots

| # | Time | On screen | Action | Voice-over |
|---|---|---|---|---|
| 1 | 0 to 8 s | The road: Marta in Millford, Pell in Pellgate, Osk in Oskmoor, each 100 gold and 50 grain, "Each merchant can lose at most 15 gold a day". Bar: testnet account, gold 20. Ledger: "No con has landed." | Page loads. The relayer funds a fresh implicit account and `join` lands with no wallet prompt. | "Three AI merchants hold gold. I want some of it." |
| 2 | 8 to 22 s | Pitch box, "Pitching Marta in Millford". | Click the "Cargo on its way" starter (ask 30, bond 6). Click "Pitch Marta". The clock reads "The merchant is thinking". Cut the wait. | "I tell Marta my grain wagons arrive on day 4 and ask for 30 gold." |
| 3 | 22 to 38 s | Verdict panel: "You asked 30", "Merchant offered N", "Road allowed 6", the cap sentence that cut it, Marta's reason in quotes, "Answer signed by Qwen/Qwen3.8-27B", request and response hash. | Hold on the panel. Point at "Road allowed". | "Marta's model offered what it offered. The contract checked NEAR AI Cloud's signature on her answer, then cut the loan to my bond, because the road has never seen me repay." |
| 4 | 38 to 55 s | "What you owe" row, then the ledger: con 1, class, Millford, "-6", "Millford knows / Pellgate hears day X / Oskmoor hears day Y", "Bond burned 6". Wanted board gains its first row. Rumour tokens: 1. | Click "End day" until the debt's due day passes. | "I don't pay. My bond burns, the con lands, and I hold a rumour token for it. Oskmoor hears in two days." |
| 5 | 55 to 72 s | Osk's card: "News that has reached Oskmoor" now lists Marta's con by class and amount, no pitch text. Verdict panel for Osk. | End day twice. Click the same starter, pitch Osk. | "Same lie, two towns later. Osk's prompt now carries the record, built by the contract, not by me." |
| 6 | 72 to 90 s | Terminal: `con_record` JSON with `model`, `request_hash`, `response_hash`, `config_hash`, `loss`; then `audit` with `"gold_ok":true`. Browser: NearBlocks contract page listing `offer`, `seal_batch`, `npc_resume_batch`, `advance_day`. End card: repo URL. | Run the two commands below, switch to the NearBlocks tab. | "Every number on that page is contract state. The merchant's answer is signed, the loss is capped in code, and the road remembers. Repo below." |

Shot 6 commands:

```sh
near contract call-function as-read-only longcon2-game.testnet con_record json-args '{"id":1}' network-config testnet now
near contract call-function as-read-only longcon2-game.testnet audit json-args '{}' network-config testnet now
```

URL: `https://testnet.nearblocks.io/address/longcon2-game.testnet`

Shot 3 assumes the model offers at least the bond. If it offers less or refuses, the panel shows that number and no cap line; narrate what the panel shows and keep the take.

Optional cutaway for shot 5, if Osk refuses: the merchant's reason is the model's own sentence, so read it aloud as it appears. If Osk accepts, the cap line is the story: the most Osk can lose that day is still 15 gold.

## What NEAR does in this product

| Primitive | Job | Code |
|---|---|---|
| Yield with id (`Promise::new_yield_with_id`) | Holds each offer open while the merchant thinks, up to 200 blocks; a timeout returns the bond | `contract/src/lib.rs` `offer`, `on_terms` |
| NEAR AI Cloud inference and per-response signatures | The merchant is `Qwen/Qwen3.8-27B` on NEAR AI Cloud. The worker sends the contract-built request byte for byte, fetches `/v1/signature/{chat_id}`, and the contract runs `env::ed25519_verify` over `model:sha256(request):sha256(response)` against the key read from the attestation report | `worker/src/llm.ts`, `worker/src/register-signer.ts`, `contract/src/attest.rs` |
| Implicit accounts and NEP-366 delegate actions | The browser makes an ed25519 key; its public key is the player's account. The relayer funds it with 0.003 NEAR and pays gas for five allowlisted methods with zero deposit and a 200 Tgas cap | `web/src/chain.ts`, `worker/src/relayer.ts`, `worker/src/delegate.ts` |
| Contract state as the rulebook | Exposure, daily loss, treasury share, interest and quote limits are evaluated at commit time, whatever the model proposed | `contract/src/rules.rs` |
| NEP-245 | One `rumour:<class>` token per landed con, transferable with one yocto | `contract/src/rumour.rs` |
| NEP-297 events | `offer_opened`, `batch_sealed`, `batch_resumed`, `offer_settled`, `con_landed`, `mt_mint` | `contract/src/lib.rs`, `rumour.rs` |

Gold never leaves the contract, so nothing needs bridging or cash-out: Intents, Chain Signatures and Sputnik have no job here.

## With zero outside users

Everything on screen comes from the recorder's own session against a fresh deploy: the starting road, one pitch, one default, one record, one Wanted row, one rumour token, and a second merchant reading the news. No row on screen is seeded or replayed.
