# Long Con testnet demo

Long Con is a browser game on NEAR testnet. Three AI merchants lend contract-held gold. The contract verifies each answer against its registered signer, clamps the terms, and records defaults. A record can reach the next town and appear in its request.

## Start the local road

Copy `.env.example` to `.env` and configure the model endpoint and worker signing seed. Set `LLM_MODEL` to the same model in the contract and worker configuration, then run:

```sh
PREFIX=longcon3 LLM_MODEL=agy/gemini-3.1-flash-lite scripts/testnet-up.sh
PREFIX=longcon3 SIGN_MODE=worker scripts/register-signer.sh
PREFIX=longcon3 SIGN_MODE=worker scripts/play.sh
```

Open `http://127.0.0.1:5173/game.html` in a fresh browser profile. The signer is labelled `worker:<model>` in this mode. The browser checks the request hash and signature against the key registered on the contract.

## Play

1. Select Marta and choose **Seed grain**. Press Pitch. Read the merchant's proposed terms beside the contract's allowed terms.
2. Leave the debt unpaid. End each day after its countdown reaches zero until the debt defaults. The ledger shows the con record, bond burned and rumour token.
3. End one more day. Select Pell and pitch again. Read the arrived news in Pell's card and in the request checked by the browser.
4. Run `near contract call-function as-read-only longcon3-game.testnet audit json-args '{}' network-config testnet now` and confirm `gold_ok` is true.

## What the contract does

| NEAR feature | Role in the game |
|---|---|
| Yield and resume | Holds an offer while the merchant answers. A timeout returns the bond. |
| NEP-366 delegate actions | Lets the browser key submit game actions through the testnet relayer without a wallet popup. |
| Contract state | Applies the credit, daily loss, treasury, repayment and grain quote limits after an answer arrives. |
| NEP-245 style balances and events | Records transferable rumour balances for landed cons. |
| NEP-297 events | Emits offer, batch, settlement, con and token events for indexers. |

The contract builds and hashes each merchant request. Its signature check binds that request hash and the response hash. Amounts and repayment terms are bounded by contract rules.
