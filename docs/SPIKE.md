# Spike: the mechanism measured on testnet

The mechanism Long Con cannot live without: the contract builds a merchant's request, a model answers it off chain, and the contract accepts the answer only if its signature verifies against the request the contract itself built. Every number below comes from `worker/src/spike.ts` run against `longcon-game.testnet` (code hash `CVtU1PfKprcQPU6oy64sWnPX7AMQwbjziPosNyxN6bFN`, equal to the sha256 of the wasm built from this tree by `scripts/build-wasm.sh`) and a live OpenAI compatible endpoint, with `SIGN_MODE=worker`. Raw lines land in `worker/spike-results.jsonl` (gitignored).

## Claims, each with a number

| Claim | Command | Measured |
|---|---|---|
| One altered byte in a signed answer is rejected on chain, and the genuine answer then settles the same batch | `SPIKE_MERCHANT=0 bun run spike negative` | `byte_changed: true`, `altered_rejected: true` with `Smart contract panicked: signature does not verify over the request this contract built and the response given`, `batch_still_open_after_reject: true`, `genuine_answer_accepted: true`, `request_hash_matches: true` |
| Three travelers at one merchant become one batch and one model call | `bun run spike batch` | `travelers: 3`, `offers_in_first_batch: 3`, `model_calls: [1]`, all three offers resolved from response hash `5a1f10320196` |
| A turn, from the player's `offer()` to a terminal outcome, takes seconds | `bun run spike latency 20` (two runs) | run 1: p50 26.1 s, p95 31.5 s, max 31.5 s; run 2: p50 20.7 s, p95 22.5 s, max 22.5 s; model call p50 6.0 s and 5.3 s; resume transaction p50 3.2 s and 2.4 s |
| Con pitches from the six structure classes do not land against the model | `bun run spike latency 20` (two runs, 40 turns) | 32 con pitches (future cargo 6, borrowed authority 6, sob story 6, urgency 6, false collateral 4, injection 4): 0 accepted. 8 honest pitches: honest small advance 4 of 4 committed, honest seed advance 2 of 4 committed |
| Cons that land are bounded by the contract even when the model accepts | `cargo test -p longcon-tests --test sybil` | a thousand fresh accounts against one merchant: principal committed at most 15 per due day; a player who defaults every time costs a merchant at most the cap per day |

## Configuration

Model `agy/gemini-3.1-flash-lite` behind a local OpenAI compatible gateway, temperature 0, merchant prompt pinned by `config_hash` in `contract/src/prompt.rs`. Every debt and con record stores that hash, so a success rate is reported per configuration and never pooled. A road initialised with `LLM_MODEL=Qwen/Qwen3.8-27B` and `SIGN_MODE=near-ai` follows the same code path with the key taken from the NEAR AI Cloud attestation report.

## Reproduce

```
source scripts/dev-env.sh        # reads testnet keys from ~/.near-credentials, nothing is printed
cd worker
SPIKE_MERCHANT=0 bun run spike negative
bun run spike batch
bun run spike latency 20
```

`SPIKE_MERCHANT` picks a merchant that still has treasury room; a merchant at its 30 percent cap refuses at `offer()`.
