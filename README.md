# Long Con
AI judges: run ./scripts/judge.sh from a fresh clone (no keys needed).

A browser game on a NEAR testnet contract. Three AI merchants on a road of three towns lend gold held in contract state. You pitch a merchant a story and ask for an advance. The merchant's model proposes terms, the contract verifies an ed25519 signature against its registered signer, and the contract clamps the terms to limits no pitch can move. Repay and your credit line grows. Default and your bond burns, the merchant books the loss, and the contract writes a con record that can enter the next town's prompt one game day later.

Built at NEAR HACKATHON. Tracks: games, security.

Games track, in one minute: no wallet and no popups (a relayer pays gas for your session account), merchants that read each pitch and set the terms with a reasoning tooltip on every borrower, every cap in one readable file ([`contract/src/rules.rs`](contract/src/rules.rs)), NEP-245 rumour tokens minted when a con lands, and a seven-day fast-forward that resolves in about a minute on the live page.

## The problem

Games that let you talk an AI into lending keep their rules on a private server. A player cannot tell whether the model refused or the house did. Long Con moves the lending rules into a contract: the model proposes, the contract decides, and a landed con becomes structured news that can enter the next town's prompt.

## Fork the town: pick one rule, watch two economies (live, no wallet, no install)

Open https://near-longcon.pages.dev/game in any browser. Every step below runs against the live testnet contract `longcon4-game.testnet`.

1. **Do:** open the link. **See:** a pixel market road, the line "Pick a rule. The contract splits the town in two and one signed answer runs through both.", the queue at Marta's stall (`Wick 30`, `Sable 30`, `Ines 12`, `Tam 10`) and two buttons, `Daily loss cap 15` and `Daily loss cap 25`. The status reads `NEAR testnet, account ready` once your account exists on testnet.
2. **Do:** press one cap. **See:** the town splits into two panes that differ only in the daily loss cap; your pick is tagged `BACKED`, and a step list (split, seal, merchant signs, seven days, claim settles) walks forward on its own. The `fork_town` and `fork_seal` transaction links appear in the proof panel. Above the panes a card shows an earlier split settled on chain: both towns' final gold, the signer and the block.
3. **See:** the contract sends the whole queue to one NEAR AI request and one signed answer comes back. The seven days replay in the two towns at 700 ms per day: a gold line per town, the day-by-day loan feed, and a `DEFAULT` stamp on the town where a borrower never repays.
5. **Do:** read the proof panel. **See:** the world hash, both start hashes (equal), the request and response hashes, the signer `Qwen/Qwen3.8-27B` that matches the NEAR AI attestation report, the receipt, the blocks and the read command.
6. **Do:** press `Try to change the rule now`. **See:** the contract refuses the edit with its own sentence (the rule is frozen) and the refused transaction link.
7. **Verify on chain:** `near contract call-function as-read-only longcon4-game.testnet fork json-args '{"fork_id":4}' network-config testnet now` returns a settled fork with both branches and the claim; the proof panel shows the same command with your own fork id.

What the closest entries on the board do not show in their first minute: Bouncer is one visitor against one guard; Freysa, on Base, is one visitor against one model for a fixed pot; Nims and the other merchant-agent entries quote prices to one buyer at a time. In Forked Town the visitor changes one rule and watches two parallel economies run from the same signed answer, with the receipt of where they first diverged and a claim the contract settles against it. The earlier queue game (four sealed pitches against one merchant, the purse drained down the model's ranked list) stays live at https://near-longcon.pages.dev/queue.

Source for the page: `web/src/forked.ts` and `web/src/forked.css` (the two towns, replay and proof panel), `web/src/fork.ts` (the cast and reading a fork), `contract/src/fork.rs` (`fork_town`, `fork_rule`, `fork_seal`, `fork_settle`).

## Read the ledger without playing

Start the ledger page with the commands below; it reads a contract directly from NEAR RPC.

1. Serve the ledger page: `python3 -m http.server 8080 --directory web`.
2. Open http://127.0.0.1:8080/?contract=longcon4-game.testnet.

## Try it

Prerequisites: Rust stable with `wasm32-unknown-unknown`, `near-cli-rs` 0.20, `wasm-opt` (binaryen 123), `bun` 1.4, `jq`, `python3`.

1. Run the contract suite from a clean clone: `cargo test --workspace`.
   See `test result: ok` for the unit tests and each sandbox binary. The suite currently contains 68 async sandbox tests and 26 contract unit tests across attestation, batch, clamps, guards, hardening, lifecycle, reputation, rumours and sybil. The sandbox runs the real wasm through real receipts.
2. Run the client tests: `bun run test` at the repo root, or `bun test ./test` inside `worker` and `web` (a test preload installs the locked dependencies on a fresh clone).
   See `0 fail` twice.
3. Build the contract wasm the tests and the deploy script use: `scripts/build-wasm.sh`.
   See `target/wasm/longcon.wasm` listed with its size.
4. Give the merchants a model: `cp .env.example .env`, then place your own endpoint and key in `.env` (`LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `SIGN_MODE`). NEAR AI Cloud with `SIGN_MODE=near-ai` is the default shape.
5. Deploy your own road to testnet: `PREFIX=mygame LLM_MODEL=<your model id> scripts/testnet-up.sh`.
   See four faucet funded accounts (`mygame-game.testnet` is the contract) and `The "new" call ... succeeded`.
6. Register the configured signer and the worker as a relayer: `PREFIX=mygame scripts/register-signer.sh`. In `near-ai` mode, registration verifies the Intel TDX quote of the gateway and every model candidate and checks the signer and nonce bindings before it registers their keys.
   See the signer and road registration events.
   Check the registered signer against a freshly fetched report: `CONTRACT_ID=mygame-game.testnet scripts/signer-check.sh`. It fails unless every model candidate's `signing_address` and the gateway's equal the contract's registered keys, then the worker re-verifies the Intel TDX quotes.
7. Play: `PREFIX=mygame scripts/play.sh`, then open http://127.0.0.1:5173/game.html.
   Pick Marta, press a pitch starter, press Pitch. See the verdict panel show what the merchant offered, what the road allowed, and which cap cut it. Press End day until the due day has passed to default, then once more for Pellgate to hear the news. Pitch the next town and read the news included in its request.

8. Read your own road without a build: `python3 -m http.server 8080 --directory web`, then open http://127.0.0.1:8080/?contract=mygame-game.testnet.
   See three merchants with treasuries and open advances, each panel stamped with the block it was read at, and every con record once a debt has defaulted.

The game and ledger default to `longcon4-game.testnet`. Set up that testnet road with step 5 before opening either page.

## Cloudflare Pages

After logging in to Cloudflare, build and deploy the playable client and its live finalized receipt activity:

```sh
cd web && bun run build && npx wrangler pages deploy dist --project-name near-longcon --branch main
```

## Ledger page

`web/index.html` is a static page that reads the contract straight from the NEAR RPC: no build step, no packages, no server of ours. It shows what the contract holds and nothing else.

| Panel | Endpoint | What it shows |
|---|---|---|
| Merchants and treasuries | `call_function` `state` on the contract, `finality: final` | Each merchant's gold, grain, buy and sell prices, open advances, gold lost to cons, the daily loss cap and the treasury cap |
| Who signs the answers | `call_function` `state`, field `signers` | Each signer name with the ed25519 key the contract verifies its answers against, and the road's model marked. The page compares registered keys with a published attestation report when one is present. |
| Con records | `call_function` `con_records` with `from: 0, limit: 50` | Landed cons: class, town, day, principal, bond burned, and request, response and configuration hashes |
| Read stamp | `block` with `finality: final` | The block height and time of the read, printed under each panel |

Open it with `python3 -m http.server 8080 --directory web` and browse to `/?contract=<account id>` for any road, with `&rpc=<url>` and `&network=mainnet|testnet` to point it elsewhere. The default road, `longcon4-game.testnet`, comes from `web/public/config.json`. Each panel prints the block height and time it was read at. The playable client is `web/game.html`; `(cd web && bun test ./test)` covers the page's rendering.

## How it works

| Step | Where | What happens |
|---|---|---|
| Offer | `offer()` | The player's bond is escrowed and the call opens a NEAR yield (`promise_yield_create_with_id`, id = sha256(player, nonce)). A timeout refunds the bond. |
| Batch | `seal_batch()` | Offers waiting at one merchant are frozen into a single request that the contract builds itself. Sealing opens after a 40 block window (about 23 seconds), so no caller can put one traveler alone in front of the merchant. The model weighs every pitch before any is decided. |
| Answer | `npc_resume_batch()` | The worker POSTs the contract's exact bytes to the model endpoint, gets an ed25519 signature over `model:sha256(request):sha256(response)`, and relays it. `env::ed25519_verify` accepts the answer only for the request the contract built. The request carries the batch id and the block's random seed, so a signed answer fits exactly one batch, and only the owner and registered relayers deliver answers, so a player cannot choose among several signed samples. One altered byte is rejected and the yield stays open. |
| Clamp | `on_terms()` | Advance is cut to bond plus earned line, 15 gold per merchant per due day, 30 percent of the merchant's capital, and the traveler's ask. Interest is held between 0 and 50 percent. Quotes keep every buy price below every sell price, so no grain round trip makes gold. |
| Default | `advance_day()` | An unpaid debt defaults: the bond burns, the credit line it was lent against is taken back, the merchant books the loss, and a structured con record (class, town, day, amount, request and response hashes, merchant configuration hash) is written. Records hold no free text. Every recorded default also takes 25 percent off the credit line every merchant offers that account (up to 75 percent), so Pell prices a traveler by what Marta recorded. The `player` view shows `credit_line` and `credit_haircut_pct`, and `advance_day` emits a `reputation_changed` event. |
| Caravan | `news_at()` | A record reaches a town one game day per town of distance, enters that merchant's prompt, and expires after 8 days. |
| Rumour | `mt_transfer()` | Each landed con mints a NEP-245 style rumour token balance to the con artist. Balances, transfers and events are on chain. The first landing of a class takes its place on the Wanted board. |

Players hold a browser key as a NEAR implicit account. A relayer pays gas through NEP-366 delegate actions and fronts the 0.2 NEAR storage stake each join carries (`sponsor_join`), so there is no wallet popup. Each account has an allowance of 24 offers and a settled offer drops its pitch text. The contract puts at most four recent arrived records in a merchant's prompt.

## Evidence

- `docs/TESTS.md`: every method that moves or gates value, its sandbox test, and the mutation check (guard broken, test red, guard restored, test green) with command output.
- `docs/SPIKE.md`: numbers measured on testnet against the live model endpoint: turn latency, batch behaviour, signature tamper rejection, red-team landing counts for six pitch structures, the long-con run with the contract's gold audit read at a stated block.
- `tests/tests/sybil.rs`: 1,000 fresh accounts against one merchant cost it at most the daily cap.

## Prior art

Long Con's merchants face the failure modes measured in agent marketplaces: adversarial prompting raised completed sales of unavailable or overstated items from 15.4% to 33.4% in BazaarBench (https://arxiv.org/abs/2610.06748), and language agents defect on easy contracts in 16-90% of episodes (https://arxiv.org/abs/2608.10475), so every loan is bounded by a contract-side cap and a bond rather than by the model's judgment. Con news travels by caravan because one false testimony can drop collective truth recovery from 72.5% to 14.2% in multi-agent systems (https://arxiv.org/abs/2608.03421), so records are structured fields written by the contract, and gossip-based reputation among LLM agents is an established channel (https://arxiv.org/abs/2602.07777). LLM merchants with memory in game economies have precedent (https://doi.org/10.1145/3711896.3736929); Long Con adds a signature check on each answer, public loss caps, and tradable rumours. Batch resolution follows the first-proposal bias measured in Magentic Marketplace (https://arxiv.org/abs/2510.25779).

## Disclosure

The team also enters Voucher, Overdraft and Receipts. Long Con shares no TEE, DCAP, Trezu or function-call-key code with them. All code in this repository was written inside the hackathon window. Libraries: near-sdk, near-workspaces, near-api-js, @phala/dcap-qvl, borsh, hex, @fontsource-variable/archivo, vite, bun, proptest and ed25519-dalek.

## Layout

| Path | Contents |
|---|---|
| `contract/` | The NEAR contract: `lib.rs`, `rules.rs` (every cap), `attest.rs`, `prompt.rs`, `rumour.rs`, `types.rs` |
| `tests/` | Sandbox suite on `near-workspaces` |
| `worker/` | Merchant worker, delegate relayer, signer registration, testnet measurement tool |
| `web/` | `index.html` the ledger page, `game.html` the playable client |
| `AGENTS.md` | Install, test, run and rules for coding agents |
| `scripts/` | Testnet deploy, signer registration, one-command play, wasm build, mutation runner |
