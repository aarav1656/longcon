# Long Con

Long Con: Forked Town. Pick one town rule and the contract splits the town in two, runs one signed AI answer through both, and shows which economy survives.

## Who uses it

Players and judges who want to see what one rule change does to an AI-run economy. A visitor backs a daily loss cap, the contract settles the claim against the receipt of where the two towns first diverged, and every figure is public on chain.

## How it works

The visitor picks a daily loss cap (15 or 25). The contract clones the town into two branch accounts that differ only in that cap, seals the queue of four borrowers into one NEAR AI request, verifies one ed25519 signed answer, and resolves seven days in both branches with each branch clamping by its own cap. The rule is frozen at the seal and the claim settles once. The Rust contract keeps merchant capital, traveler bonds, loans, debts, and structured con records. A worker sends each merchant prompt to the configured model, then submits the signed answer through an authorized relayer. The contract verifies the signature, clamps the terms, records defaults, and propagates news between towns. The browser game serves the road and the live ledger reads contract state.

## Evidence

| Fact | Evidence |
|---|---|
| Forked Town runs end to end on testnet: split, one signed answer, two outcomes, settled claim. | `bun web/scripts/fork-as.ts 25`; fork `4` on `longcon4-game.testnet`, settle tx [CjSj1WxJ6Ta3Affm3k2Jd8i1MshXjptDMwE6fsSPBBTb](https://testnet.nearblocks.io/txns/CjSj1WxJ6Ta3Affm3k2Jd8i1MshXjptDMwE6fsSPBBTb); `near contract call-function as-read-only longcon4-game.testnet fork json-args '{"fork_id":4}' network-config testnet now`. |
| The sealed rule cannot be edited, a forged receipt and a replayed settle are refused. | Refused txs [BvWddPmeBBqRJZYZNEPq7sxSMz5ivo8eaYxmFwhvQMxv](https://testnet.nearblocks.io/txns/BvWddPmeBBqRJZYZNEPq7sxSMz5ivo8eaYxmFwhvQMxv), [EGSGJCpGMCnFWEvK6f7jjsBYK8ZTxge5f6UrWBPD5A8v](https://testnet.nearblocks.io/txns/EGSGJCpGMCnFWEvK6f7jjsBYK8ZTxge5f6UrWBPD5A8v), [6G6fqzqYnYrdQJu3331e6FYvuX8eAVfzW8ggqjNw5mur](https://testnet.nearblocks.io/txns/6G6fqzqYnYrdQJu3331e6FYvuX8eAVfzW8ggqjNw5mur); mutations M57 to M64 in [docs/TESTS.md](docs/TESTS.md). |
| A cold visitor reaches a settled claim on the live page in under a minute. | Live run 2026-11-14 through https://near-longcon.pages.dev/game with fresh storage: 29 s desktop and 25 s mobile from the cap press to the settled claim (fork 47, cap 15 ends 185, cap 25 ends 175, claim won 4 gold, split block 277602179, settled block 277602213, read with `near contract call-function as-read-only longcon4-game.testnet fork json-args '{"fork_id":47}' network-config testnet now`); commit `HEADC`. |
| Testnet traveler journeys and merchant offers are recorded against `longcon4-game.testnet`. | [Offer transaction](https://testnet.nearblocks.io/txns/5PtncDpBSAtv3K9BfbN5UTHruimTQdnrriQrhjXWn7rX), [signed batch answer](https://testnet.nearblocks.io/txns/DHFskY1oSysVbwuHbqzADuE2J48YK5APKEVoxoNsRYxF); [`scripts/play.sh`](scripts/play.sh), details in [docs/EVIDENCE.md](docs/EVIDENCE.md). |
| A sealed batch of concurrent traveler answers was recorded and checked. | [Batch evidence commit](https://github.com/kamalbuilds/near-longcon/commit/ffb482e); details in [docs/EVIDENCE.md](docs/EVIDENCE.md). |
| The live app and worker routes are documented alongside the contract and model-signature flow. | [`README.md`](README.md), [`AGENTS.md`](AGENTS.md), and [`docs/SPIKE.md`](docs/SPIKE.md). |
| Git history records `kamalbuilds` as commit author from 2026-10-31 through 2026-11-13. | `git log --reverse --format='%ad %an' --date=short`; `git log -1 --format='%ad %an' --date=short`. |

## Try it in 60 seconds

Open [Forked Town](https://near-longcon.pages.dev/game) and press `Daily loss cap 15` or `Daily loss cap 25`. One press splits the town, seals the queue and replays seven days in both towns, the banner names the winning cap, and the proof panel shows the hashes, the signer and the `fork_settle` transaction.

## Why NEAR

NEAR stores the game state, verifies merchant answer signatures, and supports sponsored access through NEP-366 delegate actions. The live road registers the NEAR AI Cloud model signer from a fresh attestation report; the worker checks its Intel TDX quote before registration. Long Con does not use Sputnik DAO or NEAR Intents for the game flow.

## Team and build window

Git history records `kamalbuilds` as commit author from 2026-10-31 to 2026-11-13. The dates come from the first and latest commits; see the commands in the evidence table.
