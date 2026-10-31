# Judge review: Long Con as it stands

Internal working file. Move it to `.progress/` before the repo goes public: it is written in audit voice and a public reader should not see it.

Read on 2026-10-31 against commit `9e17463` plus the uncommitted worker rewrite in the working tree. Chain reads: `longcon-game.testnet` via `https://test.rpc.fastnear.com`, finality final, block 275,570,582. Quotes come from `docs/research/ground/JUDGES.md` (grade in brackets). Scores are judgment, not measurement.

## What a judge finds today

- Contract (`contract/src/`): offers open a yield with id (`lib.rs:267`); a merchant's queue is sealed into one contract-built request after 6 blocks (`lib.rs:281`); the answer resumes the batch only if `env::ed25519_verify` passes over `model:sha256(req):sha256(resp)` (`lib.rs:371`, `attest.rs`); terms are clamped by bond plus earned line, a 15 gold per merchant per day loss cap, a 30% treasury cap, a 50% interest ceiling and a money-pump quote invariant (`rules.rs`); unpaid debts default in `advance_day`, burn the bond, write a structured con record and mint a NEP-245 rumour (`lib.rs:468`, `rumour.rs`); news reaches a town one day per town of distance and expires after 8 days (`lib.rs:705`).
- Tests on disk: 38 sandbox tests in `tests/tests/` (attestation 7, batch 11, clamps 10, lifecycle 6, rumours 2, sybil 2, including a 1,000-account Sybil wave and an altered-byte rejection), 23 unit tests (3 of them proptests) in `contract/src/`, 16 bun tests in `worker/test` and `web/test`. I did not run them (this lane may not run cargo).
- Client: one page (`web/src/main.ts`), a browser-held ed25519 key as an implicit account, relayer-paid NEP-366 delegates (`worker/src/relayer.ts`, allowlist in `delegate.ts`). The verdict panel shows asked, merchant offered, road allowed, and which cap cut it.
- Deployed: `longcon-game.testnet` answers `state` with `offers 0, players 0, records 0`, model `agy/gemini-3.1-flash-lite`, and `open_batches` returns `MethodNotFound`. The deployed wasm predates the batch commit.
- Live run config (`.env`, names only): `SIGN_MODE=worker`, `LLM_BASE_URL` is a localhost gateway. The worker signs answers with its own seed and registers that key as the model's signer (`register-signer.ts`, worker branch). The NEAR AI Cloud path (`llm.ts nearAiSignature`, attestation-report key read) exists in code and has never run.
- Not in code, though research files name them: Privy email login, a function-call key scoped to the game, merchants as their own sub-accounts, `rules/merchants.toml`, mainnet `longcon.near`, the house con artist, the immunity spike, `docs/SPIKE.md`, Intents, Chain Signatures, Sputnik.

## Change catalogue (each under a day)

- **C1. Real NEAR AI Cloud signer, live.** Deploy HEAD to a fresh testnet prefix (`PREFIX=longcon2 LLM_MODEL=Qwen/Qwen3.8-27B scripts/testnet-up.sh`; the state layout changed, so redeploying over `longcon-game.testnet` will not deserialize), set `SIGN_MODE=near-ai` with the user-placed key, run `scripts/register-signer.sh`, play one pitch, and record the `npc_resume_batch` tx whose outcome reads `signer: Qwen/Qwen3.8-27B`. Point `web/public/config.json` at it.
- **C2. Machine-readable repo.** `README.md` (what, problem, "do X, see Y" steps, NEAR primitives table with file paths, one test command with expected counts, libraries per Q-005, Q-001 window note, Q-015 disclosure), a 20 to 40 line `AGENTS.md`, `.env.example` with names only, `docs/EVIDENCE.md` with every tx hash and block height. Move `docs/HACKATHON.md` (contains the prize table) and `docs/WIN-CONDITIONS.md` out of the tracked tree.
- **C3. Immunity measured on chain.** A `worker/src/house.ts` script that drives `Qwen/Qwen3.8-27B-abliterated` through the relayer: land 10 cons per class on Marta, then pitch the same scripts to Pell before and after the news arrives, and to Osk as control. Publish land rate per arm with n, model and `config_hash` in `docs/SPIKE.md`. Every trial is a testnet tx, so the ledger and Wanted board are populated at zero outside users.
- **C4. Tx links in the UI.** Keep the relay tx hash per offer in the client and link it; add the resume block to the offer record and link the block on NearBlocks. Today the ledger shows hashes but no clickable on-chain proof.
- **C5. Latency on screen.** Run 20 pitches with `METRICS_FILE=run.jsonl`, publish p50 and p95 of `total_ms` and `llm_ms` in EVIDENCE, show "answered in N s" in the verdict panel.
- **C6. Merchant retirement.** In `advance_day`, a merchant whose gold falls under a floor is replaced from house capital, keeps the news, and emits `merchant_retired`. One sandbox test. This is the "turn them off" line made into contract behaviour.
- **C7. Hosted demo to 2026-11-25.** Static `web/dist` plus relayer and worker on an always-on box; `config.json` with the public relayer URL; CORS origin pinned.

## Judge by judge

Scores: Tech = technical implementation, Des = design, Imp = impact, Orig = originality, Sus = sustainability.

### Illia Polosukhin

Quote relied on: "So how do we actually offer AI where neither we, model provider, hardware provider, is actually able to access what you are using the AI inference with?" (Bankless 2026-03-24, V-PAGE). Lean-in "verifiable", "attestation"; dismiss "a closed-source or centralised inference path".

Says: the on-chain check over NEAR AI Cloud's exact signed-text format is the most NEAR-native line in the repo, and the request is built by the contract so the worker cannot change the prompt. Then he opens the run config and finds a gemini model behind a localhost gateway, signed by the operator's own seed. Games are not on his list.

| Tech | Des | Imp | Orig | Sus |
|---|---|---|---|---|
| 6 | 5 | 3 | 7 | 3 |

Kill shot: "The key your contract trusts belongs to your worker, so this is a server with extra steps."
Changes: C1, C5, C3.

### Eddy Lazzarin

Quote: "Cryptography and blockchains are a verification tool. Provenance is just a chain of cryptographic evidence that something traversed some path between specific hands" (a16z Substack 2026-03-07, V-PAGE). Also: any vulnerability "will be exploited almost instantly by bots... with formal methods we can probably prove code bug-free" (2026-10-23, V-X).

Says: each debt and record carries request hash, response hash and config hash, which is provenance; the proptest on the quote invariant and the `audit()` conservation view are the kind of exhaustive check he rewards. He asks why this needs a chain, and the answer (the house is a party to every con, so its loss cap must be public code) only holds if the signer is not the house.

| Tech | Des | Imp | Orig | Sus |
|---|---|---|---|---|
| 7 | 6 | 3 | 6 | 3 |

Kill shot: "Gold is a number inside one contract with no outside value, so 'real economy' means a scoreboard."
Changes: C1, C4, C3.

### Mert Mumtaz

Quote: "Immutable financial code is akin to a spaceship leaving Earth that you have no further control over... It must work, or there will be [a] catastrophe." (essay 2026-06-09 via Yahoo, V-PAGE). Dismiss: "slop" code shipped like consumer apps.

Says: the clamps are pure functions with proptests and every cap is named in the outcome, which reads as engineered, not shipped. Games and play money are outside his lanes, and no real asset is at risk, so the safety story protects nothing he values.

| Tech | Des | Imp | Orig | Sus |
|---|---|---|---|---|
| 7 | 5 | 2 | 6 | 2 |

Kill shot: "Bounded loss of play gold is a unit test, not a security result."
Changes: C3 (with a caps-off arm reported), C2, C1.

### Avichal Garg

Quote: "You can't punish an AI... You can turn them off, but they don't care." (NEARCON 2026 via CoinDesk 2026-02-24, V-PAGE). Bias note: games and NFTs are "a couple more years out".

Says: merchants lend, take losses and set prices under contract permissions, which is his "agents as employees with permissions" in a toy. But merchants are structs in one contract, not accounts with wallets, and nothing happens to a merchant that goes broke.

| Tech | Des | Imp | Orig | Sus |
|---|---|---|---|---|
| 6 | 5 | 2 | 5 | 2 |

Kill shot: "No merchant holds a wallet and none can be turned off; the agent is a prompt."
Changes: C6, C1, C3.

### Kain Warwick

Quote: "The key, shockingly, is just making it easy and fun to trade." (lean-in list, JUDGES.md section 6) and "spending more resources on an agentic trading platform is negative EV right now for us" (X article 2026-10-27, V-X).

Says: no wallet popup, no gas prompt, a one-page loop with starters, which he likes. He is the swing on fun and the repo has zero plays: `offers 0` on the deployed contract. The waiting clock (up to 115 s) is the first thing he will feel.

| Tech | Des | Imp | Orig | Sus |
|---|---|---|---|---|
| 6 | 6 | 3 | 7 | 3 |

Kill shot: Steam reviewers of the genre: "Fun for about 2 hours". Nobody outside the team has played this for two minutes.
Changes: C7, C5, C3.

### Haseeb Qureshi

Quote: "Something that works with money 90% of the time is unusable for actual economic activity." and "You want to be very cautious of trying to ingest your worldview of technology by reading Twitter hype people and watching Twitter demos." (NEARCON 2026 via CoinDesk 2026-02-23, V-PAGE).

Says: the Sybil suite (1,000 fresh accounts against one merchant) and the always-defaulting player suite are checks that can fail, which is rare. He wants the number they produced and the model's over-commit rate, and there is no EVIDENCE file and no published run.

| Tech | Des | Imp | Orig | Sus |
|---|---|---|---|---|
| 7 | 5 | 3 | 6 | 3 |

Kill shot: "Where is the con success rate, with and without the news, with n? Otherwise this is a Twitter demo."
Changes: C3, C2 (EVIDENCE with suite output), C5.

### Stepan Gershuni

Quote: "We are looking for TEEs fast enough for real-time agentic auctions and inference." (2025-11-27, V-X) and "swarms of AI agents with Coasean bargaining" (2026-02-22, V-X).

Says: the sealed batch, where a merchant weighs every waiting offer at once and the ledger fills shared caps in slot order, is a small auction against first-proposal bias, and he will notice it. Merchants never bargain with each other, and TEE latency is unmeasured.

| Tech | Des | Imp | Orig | Sus |
|---|---|---|---|---|
| 6 | 5 | 3 | 6 | 3 |

Kill shot: "One model answering one batch is not a swarm, and you have no latency number for the TEE path."
Changes: C1, C5, C3.

## Panel totals

| Criterion | Mean | Weakest reader |
|---|---|---|
| Technical implementation | 6.4 | Illia (signer), Avichal (no accounts) |
| Design | 5.3 | Mert, Avichal |
| Impact | 2.7 | everyone: zero users, play gold, no buyer |
| Originality | 6.1 | Avichal |
| Sustainability | 2.7 | everyone: house pays inference and gas per pitch, no revenue or sink |

## The three changes that most raise the chance of first

1. **C1, real NEAR AI Cloud signer on a live deploy.** Without it the one reason the game needs a chain (the house cannot fake a merchant's answer) is false in the running system, and Illia, Eddy and Stepan all reach that in the first minute.
2. **C3, immunity measured through the deployed contract.** It answers Haseeb and Kain with a number, fills the ledger and Wanted board at zero outside users, and decides whether "merchants learn" can be said at all.
3. **C2, README, AGENTS.md, .env.example, EVIDENCE.md.** The AI screen opens the README first and there is none.

## What the Claude Code and Codex screen fails on today

1. **No README.md.** HACKATHON.md procedure step 1 asks for "do X, see Y" steps for a machine reader. There is no description, install step, run step or test command anywhere at the root.
2. **No AGENTS.md or CLAUDE.md, no `.env.example`.** `scripts/play.sh` exits without `LLM_MODEL` and, in the default `near-ai` mode, `LLM_API_KEY`; nothing tells a reader those names exist.
3. **Committed worker does not match the committed contract.** At `9e17463`, `worker/src/worker.ts` calls `request_body` and `npc_resume`, reads `request_hash` from `pending_offers`, and `lib.ts readable()` requires a top-level `verdict`. The contract exposes `batch_body`, `seal_batch`, `npc_resume_batch`, and batch answers carry `decisions[]`. A screen tracing worker against contract finds a dead path. The rewrite in the working tree fixes this once committed.
4. **Deployed contract is not the code.** `web/public/config.json` points at `longcon-game.testnet`, which runs pre-batch wasm (`open_batches` is `MethodNotFound`) and has 0 offers. Clicking through the UI against it exercises old code.
5. **Stand-in in the production signing path.** With `SIGN_MODE=worker` (the current `.env`), `llm.ts` signs with `WORKER_SIGNING_SEED` and `register-signer.ts` registers that key under the model's name. A screen that greps `signWithSeed` reads the attestation claim as self-signed.
6. **Secret needed for the full loop.** The real path needs a NEAR AI Cloud key (Q-000). There is no recorded run, replay log or EVIDENCE file a screen can read instead.
7. **Prerequisites undocumented.** `cargo test` builds wasm through `scripts/build-wasm.sh`, which needs the `wasm32-unknown-unknown` target and `wasm-opt` on PATH, and near-workspaces downloads a sandbox binary. Bun tests need `bun install` in two folders. From a clean clone with only `cargo`, the sandbox suite fails at build.
8. **Docs cite files and features that do not exist.** `docs/WIN-CONDITIONS.md` cites `docs/SPIKE.md`, `rules/merchants.toml`, Privy login, mainnet `longcon.near` and a house con artist; none is in the tree. It also lists "Off-platform buyer: MISSING".
9. **Prize table in a tracked file.** `docs/HACKATHON.md` carries the prize amounts.
10. **Commit dates before 2026-11-01.** All eight commits are dated 2026-10-31. Q-001 allows work from 2026-10-19; without one README line citing Q-001 a screen applying "first commit on or after 2026-11-01" flags it.
11. **No hosted demo.** The relayer URL is `http://127.0.0.1:8787`. Q-012 accepts local-only with a video; a hosted demo is a plus.

Passes today: MIT `LICENSE`; no secrets in tracked files (`git grep` for key and token patterns returned nothing beyond env-var names in `scripts/dev-env.sh`); no TODO, mock or stub markers in `contract/`, `worker/src`, `web/src`, `scripts/`; must-fail cases exist in the sandbox suite.

## Rules risk

Q-015 caps one person at two projects. `docs/research/round2/ENTRY-PLAN.md` puts Person A on Voucher and Receipts and Person B on Voucher and Overdraft. Long Con needs an owner who is on at most one other entry, and that person's README and this one must name each other's projects.

## Blind spots

- I did not run `cargo test` or `bun test`, so whether the 38 sandbox tests pass at HEAD is unverified here.
- The uncommitted worker rewrite may change items 3 and 5 before you read this.
- Judge reactions are inferred from public quotes; none has seen this repo, and five of seven have no games statement on record.
