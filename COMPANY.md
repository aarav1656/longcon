# Long Con

Long Con is a browser game on NEAR where travelers pitch AI merchants for advances and the contract enforces signed terms, repayment, and reputation.

## Who uses it

Players use the game to negotiate with merchants and build or lose credit as their journeys and prior outcomes become public on chain.

## How it works

The Rust contract keeps merchant capital, traveler bonds, loans, debts, and structured con records. A worker sends each merchant prompt to the configured model, then submits the signed answer through an authorized relayer. The contract verifies the signature, clamps the terms, records defaults, and propagates news between towns. The browser game serves the road and the live ledger reads contract state.

## Evidence

| Fact | Evidence |
|---|---|
| Testnet traveler journeys and merchant offers are recorded against `longcon4-game.testnet`. | [Offer transaction](https://testnet.nearblocks.io/txns/5PtncDpBSAtv3K9BfbN5UTHruimTQdnrriQrhjXWn7rX), [signed batch answer](https://testnet.nearblocks.io/txns/DHFskY1oSysVbwuHbqzADuE2J48YK5APKEVoxoNsRYxF); [`scripts/play.sh`](scripts/play.sh), details in [docs/EVIDENCE.md](docs/EVIDENCE.md). |
| A sealed batch of concurrent traveler answers was recorded and checked. | [Batch evidence commit](https://github.com/kamalbuilds/near-longcon/commit/ffb482e); details in [docs/EVIDENCE.md](docs/EVIDENCE.md). |
| The live app and worker routes are documented alongside the contract and model-signature flow. | [`README.md`](README.md), [`AGENTS.md`](AGENTS.md), and [`docs/SPIKE.md`](docs/SPIKE.md). |
| Git history records `kamalbuilds` as commit author from 2026-10-31 through 2026-11-13. | `git log --reverse --format='%ad %an' --date=short`; `git log -1 --format='%ad %an' --date=short`. |

## Try it in 60 seconds

Open [Long Con](https://near-longcon.pages.dev), select a traveler, and send a pitch to a merchant. The game shows the queued answer and its on-chain settlement in the road ledger.

## Why NEAR

NEAR stores the game state, verifies merchant answer signatures, and supports sponsored access through NEP-366 delegate actions. The live road registers the NEAR AI Cloud model signer from a fresh attestation report; the worker checks its Intel TDX quote before registration. Long Con does not use Sputnik DAO or NEAR Intents for the game flow.

## Team and build window

Git history records `kamalbuilds` as commit author from 2026-10-31 to 2026-11-13. The dates come from the first and latest commits; see the commands in the evidence table.
