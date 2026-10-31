# Long Con: submission fields

Personal fields (lead name, email, team size, payout account, demo URL, consent) come from the human at submit time and are never written here.

## What did you build (`idea`)

```
Problem: games where you talk an AI out of a prize keep their rules on a private server, so a player cannot tell whether the model refused or the house did, and once a trick works it works forever, so the fun ends in about two hours.

Product: Long Con is a free browser game on a road of three AI merchants who lend gold. You pitch a merchant a story and ask for an advance. The merchant's model proposes terms; a NEAR contract decides what happens. Repay and your credit line grows. Default and your bond burns, the merchant books the loss, and the contract writes a con record (class, town, amount, request and response hashes, no pitch text). That record reaches the next town one game day later and goes into that merchant's prompt, so a con works only until the news arrives. Each landed con mints a rumour token.

How NEAR fits: the contract builds each merchant's request itself, holds the player's offer in a yield (up to 200 blocks, timeout refunds the bond), and accepts an answer only if NEAR AI Cloud's ed25519 signature over model, request hash and response hash verifies on chain against the key from the model's attestation report. Exposure, a 15 gold per merchant per day loss cap, a 30% treasury cap, a 50% interest ceiling and a no-arbitrage quote rule are contract code applied after the model answers. Offers for one merchant are sealed into one batch, so the model weighs every waiting pitch together instead of anchoring on the first one. Players use a browser key as a NEAR implicit account; a relayer pays gas through NEP-366 delegate actions, so there is no wallet popup. Rumours are NEP-245 tokens.

Try it: the README gives the testnet run steps and one command for the sandbox suite (signature tampering, every cap, batch fairness, a 1,000-account Sybil wave).
```

## Tracks

```json
["games", "security"]
```

- `games`: merchants are AI NPCs whose gold is contract state, and the road changes from play alone, because landed cons travel as records into later prompts without a dev patch; the chain stays out of sight behind a browser key and a relayer.
- `security`: the brief's line "give AI money without giving it the keys to everything" is the contract's job here: the model proposes, a signature check proves which model answered, and hard caps bound what any answer can cost, tested against a 1,000-account Sybil wave and a player who always defaults.

Not selected: `agents`, because merchants do not pay or hire other agents, and `privacy`, because the request body and pitches are public on chain.

## Q-015 disclosure (README and form)

```
Members of this team also enter Voucher, Overdraft and Receipts in NEAR HACKATHON; Long Con is a separate project with its own contract and shares no code with them.
```

If Cachet, Customs, Sworn or Taster are entered too, add their names to that sentence before submitting.
