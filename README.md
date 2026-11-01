# Long Con

[![ci](https://github.com/kamalbuilds/near-longcon/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/kamalbuilds/near-longcon/actions/workflows/ci.yml)

A free browser game on a NEAR contract. Three AI merchants on a road of three towns lend gold that is real contract state. You pitch a merchant a story and ask for an advance. The merchant's model proposes terms, the contract proves which model answered, and the contract clamps the terms to limits no pitch can move. Repay and your credit line grows. Default and your bond burns, the merchant books the loss, and the contract writes a con record that the next town reads one game day later.

Built at NEAR HACKATHON. Tracks: games, security.

## The problem

Games that let you talk an AI out of a prize keep their rules on a private server. A player cannot tell whether the model refused or the house did, and a trick that works once works forever, so the fun ends in about two hours. Long Con moves the rules into a contract: the model proposes, the contract decides, and every landed con becomes news that makes the next merchant harder to fool.

## See it live in one minute

Needs only `python3` and a browser.

1. Serve the ledger page: `python3 -m http.server 8080 --directory web`.
2. Open http://127.0.0.1:8080/.
   See the line `Contract longcon2-game.testnet on testnet ... Read at block <height>`, three merchants (Marta, Pell, Osk) with treasuries, grain and open loans read from the contract, a Who signs the answers panel with the ed25519 key the contract trusts, and a Con records panel listing every landed con with its class, town, principal, bond burned and the request, response and configuration hashes.

## Try it

Prerequisites: Rust stable with `wasm32-unknown-unknown`, `near-cli-rs` 0.20, `wasm-opt` (binaryen 123), `bun` 1.4, `jq`, `python3`.

1. Run the contract suite from a clean clone: `cargo test --workspace`.
   See `test result: ok` for the unit tests and for each sandbox binary (attestation, batch, clamps, guards, lifecycle, rumours, sybil). The sandbox runs the real wasm through real receipts.
2. Run the client tests: `(cd worker && bun install && bun test ./test) && (cd web && bun install && bun test ./test)`.
   See `0 fail` twice.
3. Build the contract wasm the tests and the deploy script use: `scripts/build-wasm.sh`.
   See `target/wasm/longcon.wasm` listed with its size.
4. Give the merchants a model: `cp .env.example .env`, then place your own endpoint and key in `.env` (`LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `SIGN_MODE`). NEAR AI Cloud with `SIGN_MODE=near-ai` is the default shape.
5. Deploy your own road to testnet: `PREFIX=mygame LLM_MODEL=<your model id> scripts/testnet-up.sh`.
   See four faucet funded accounts (`mygame-game.testnet` is the contract) and `The "new" call ... succeeded`.
6. Register the key the contract trusts for that model: `PREFIX=mygame scripts/register-signer.sh`.
   See `signer_set` and `model_set` lines.
7. Play: `PREFIX=mygame scripts/play.sh`, then open http://127.0.0.1:5173/game.html.
   Pick Marta, press a pitch starter, press Pitch. See the verdict panel show what the merchant offered, what the road allowed, and which cap cut it. Press End day twice after taking an advance and see the debt default, your bond burn and a record appear in the con ledger. Pitch the next town and see its merchant carry the news.

8. Read your own road without a build: `python3 -m http.server 8080 --directory web`, then open http://127.0.0.1:8080/?contract=mygame-game.testnet.
   See three merchants with treasuries and open advances, each panel stamped with the block it was read at, and every con record once a debt has defaulted.

The reference road is deployed at `longcon2-game.testnet` and carries landed cons. Read it with `near contract call-function as-read-only longcon2-game.testnet state json-args {} network-config testnet now`.

## Ledger page

`web/index.html` is a static page that reads the contract straight from the NEAR RPC: no build step, no packages, no server of ours. It shows what the contract holds and nothing else.

| Panel | Endpoint | What it shows |
|---|---|---|
| Merchants and treasuries | `call_function` `state` on the contract, `finality: final` | Each merchant's gold, grain, buy and sell prices, open advances, gold lost to cons, the daily loss cap and the treasury cap |
| Who signs the answers | `call_function` `state`, field `signers` | Each model name with the ed25519 key the contract verifies its answers against, and the road's model marked |
| Con records | `call_function` `con_records` with `from: 0, limit: 50` | Every landed con: class, town, day, principal, bond burned, and the request, response and configuration hashes that bind it to a signed answer |
| Read stamp | `block` with `finality: final` | The block height and time of the read, printed under each panel |

Open it with `python3 -m http.server 8080 --directory web` and browse to `/`, or to `/?contract=<account id>` for any road, with `&rpc=<url>` and `&network=mainnet|testnet` to point it elsewhere. The default road, `longcon2-game.testnet`, comes from `web/public/config.json`. Each panel prints the block height and time it was read at. A road with no landed con shows how one lands and which road to open instead. The playable client is `web/game.html`; `(cd web && bun test ./test)` covers the page's rendering.

## How it works

| Step | Where | What happens |
|---|---|---|
| Offer | `offer()` | The player's bond is escrowed and the call opens a NEAR yield (`promise_yield_create_with_id`, id = sha256(player, nonce)). A timeout refunds the bond. |
| Batch | `seal_batch()` | Offers waiting at one merchant are frozen into a single request that the contract builds itself. Sealing opens after a 6 block window, so no caller can put one traveler alone in front of the merchant. The model weighs every pitch before any is decided. |
| Answer | `npc_resume_batch()` | The worker POSTs the contract's exact bytes to the model endpoint, gets an ed25519 signature over `model:sha256(request):sha256(response)`, and relays it. `env::ed25519_verify` accepts the answer only for the request the contract built. One altered byte is rejected and the yield stays open. |
| Clamp | `on_terms()` | Advance is cut to bond plus earned line, 15 gold per merchant per due day, 30 percent of the merchant's capital, and the traveler's ask. Interest is held between 0 and 50 percent. Quotes keep every buy price below every sell price, so no grain round trip makes gold. |
| Default | `advance_day()` | An unpaid debt defaults: the bond burns, the merchant books the loss, and a structured con record (class, town, day, amount, request and response hashes, merchant configuration hash) is written. Records hold no free text. |
| Caravan | `news_at()` | A record reaches a town one game day per town of distance, enters that merchant's prompt, and expires after 8 days. |
| Rumour | `mt_transfer()` | Each landed con mints a NEP-245 rumour token to the con artist. The first landing of a class takes its place on the Wanted board. |

Players hold a browser key as a NEAR implicit account. A relayer pays gas through NEP-366 delegate actions, so there is no wallet popup.

## Evidence

- `docs/TESTS.md`: every method that moves or gates value, its sandbox test, and the mutation check (guard broken, test red, guard restored, test green) with command output.
- `docs/SPIKE.md`: numbers measured on testnet against the live model endpoint: turn latency, batch behaviour, signature tamper rejection, red-team landing counts for six pitch structures, the long-con run with the contract's gold audit read at a stated block.
- `tests/tests/sybil.rs`: 1,000 fresh accounts against one merchant cost it at most the daily cap.

## Prior art

Long Con's merchants face the failure modes measured in agent marketplaces: adversarial prompting raised completed sales of unavailable or overstated items from 15.4% to 33.4% in BazaarBench (https://arxiv.org/abs/2610.06748), and language agents defect on easy contracts in 16-90% of episodes (https://arxiv.org/abs/2608.10475), so every loan is bounded by a contract-side cap and a bond rather than by the model's judgment. Con news travels by caravan because one false testimony can drop collective truth recovery from 72.5% to 14.2% in multi-agent systems (https://arxiv.org/abs/2608.03421), so records are structured fields written by the contract, and gossip-based reputation among LLM agents is an established channel (https://arxiv.org/abs/2602.07777). LLM merchants with memory in game economies have precedent (https://doi.org/10.1145/3711896.3736929); Long Con adds a signature check on each answer, public loss caps, and tradable rumours. Batch resolution follows the first-proposal bias measured in Magentic Marketplace (https://arxiv.org/abs/2510.25779).

## Disclosure

The team also enters Voucher, Overdraft and Receipts. Long Con shares no TEE, DCAP, Trezu or function-call-key code with them. All code in this repository was written inside the hackathon window. Libraries: near-sdk, near-workspaces, near-api-js, vite, bun, proptest, ed25519-dalek.

## Layout

| Path | Contents |
|---|---|
| `contract/` | The NEAR contract: `lib.rs`, `rules.rs` (every cap), `attest.rs`, `prompt.rs`, `rumour.rs`, `types.rs` |
| `tests/` | Sandbox suite on `near-workspaces` |
| `worker/` | Merchant worker, delegate relayer, signer registration, testnet measurement tool |
| `web/` | `index.html` the ledger page, `game.html` the playable client |
| `AGENTS.md` | Install, test, run and rules for coding agents |
| `scripts/` | Testnet deploy, signer registration, one-command play, wasm build, mutation runner |
