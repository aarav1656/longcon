# AGENTS.md

Long Con: a NEAR contract game. Three AI merchants lend gold held as contract state; the contract builds each merchant's request, verifies the model's ed25519 signature on chain and clamps every term.

## Layout
- `contract/` NEAR contract (Rust, near-sdk). Caps live in `contract/src/rules.rs`; prompt and config hash in `contract/src/prompt.rs`; signature check in `contract/src/attest.rs`.
- `tests/` sandbox suite on near-workspaces (runs the real wasm).
- `worker/` merchant worker, delegate relayer, signer registration, testnet measurement tool (`worker/src/spike.ts`).
- `web/` `web/index.html` is the live ledger page (static, no build). `web/game.html` is the playable client (vite, TypeScript).
- `scripts/` wasm build, testnet deploy, one-command play, mutation runner, doc checks.

## Install and test
- Toolchain: Rust stable with `wasm32-unknown-unknown`, `wasm-opt` (binaryen 123) on PATH, `bun` 1.4, `jq`, `near-cli-rs` 0.20.
- Contract and sandbox: `cargo test --workspace --no-fail-fast` (builds the wasm through `scripts/build-wasm.sh`).
- Client: `(cd worker && bun install && bun test ./test) && (cd web && bun install && bun test ./test)`.
- Docs: `scripts/check-docs.sh` (README links resolve, no prize or audit vocabulary in tracked docs).
- Mutation table: `python3 scripts/mutate.py` (one row: `python3 scripts/mutate.py M25`).

## Run
- Env names are in `.env.example`: `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `SIGN_MODE` (`near-ai` or `worker`), `WORKER_SIGNING_SEED`. Never commit values.
- Network: NEAR testnet. RPC `https://test.rpc.fastnear.com`. Reference contract `longcon-game.testnet`; evidence run on `longcon2-game.testnet`.
- Deploy a road: `PREFIX=mygame LLM_MODEL=<model> scripts/testnet-up.sh`, then `PREFIX=mygame scripts/register-signer.sh` (registers the signer key and the worker as a relayer; only the owner and registered relayers can deliver an answer), then `PREFIX=mygame scripts/play.sh`.
- Ledger page: `python3 -m http.server 8080 --directory web`, open `/?contract=<id>`.
- Measurements: `cd worker && bun run spike latency|batch|negative|redteam|longcon`.

## Rules for changes
- Every method that moves or gates value needs a sandbox test and a row in `docs/TESTS.md` showing the guard broken (red) and restored (green).
- Numbers in docs come from a command and a block height; keep the command next to the number.
- Mainnet deploys and funded accounts are the owner's. Testnet only from here.
