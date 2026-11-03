# Long Con: submission fields

Personal fields (lead name, email, team size, payout account, demo URL, consent) come from the human at submit time and are never written here. The human confirms the full JSON payload before anything is sent.

## What did you build (`idea`, 1,945 characters)

```
Problem: games where you talk an AI into lending keep their rules on a private server. A player cannot tell whether the model refused or the house did.

Product: Long Con is a browser game on a NEAR testnet road of three AI merchants who lend gold held as contract state. You pitch a merchant a story and ask for an advance. The model proposes terms; the contract decides. Your advance is bounded by your bond and earned credit. Default burns your bond, books a capped loss and writes a structured con record with class, town, amount and request and response hashes. The record can reach the next town one game day later and enter that merchant's prompt. Each landed con mints a NEP-245 style rumour token balance.

How NEAR fits: the contract builds each merchant's request and holds the player's offer in a yield for up to 200 blocks; a timeout refunds the bond. It verifies an ed25519 signature over the request and response hashes against the registered signer, then applies contract rules: bond plus earned line, 15 gold per merchant per due day, 30% of a merchant's capital, interest at most 50%, and quotes that cannot be traded in a circle. Each sealed request carries its batch id and the block's random seed. Only the owner and registered relayers deliver answers. Offers for one merchant are sealed into one batch, so the model weighs every waiting pitch together. Players hold a browser key as a NEAR implicit account and a relayer pays gas through NEP-366 delegate actions, with no wallet popup.

Try it: the README has testnet run steps and a command for 55 sandbox tests on the real wasm (signature tampering, every cap, batch fairness and a 1,000-account Sybil wave), plus a mutation table showing each guard broken, test red and guard restored.
```

## Tracks

```json
["games", "security"]
```

- `games`: the merchants are AI NPCs whose gold is contract state, and the road changes from play alone: a landed con can travel as a record into later prompts, and the chain stays behind a browser key and a relayer.
- `security`: "Give AI money without giving it the keys to everything" is the contract's whole job here: the model proposes, an on-chain signature check binds each answer to the request hash and registered signer key, and hard caps bound what any answer can cost. Tests cover a 1,000-account Sybil wave and a player who always defaults.

## Q-015 disclosure (README and form)

```
Members of this team also enter Voucher, Overdraft and Receipts in NEAR HACKATHON; Long Con is a separate project with its own contract and shares no code with them.
```

Add Cachet, Customs, Sworn or Taster to that sentence if any of them is submitted, and keep the README's Disclosure section identical to it.

## Before sending

- `state` on the testnet contract in `web/public/config.json` shows the configured road model and its registered signer key.
- Every file the README links opens from a clean clone.
- The repo is public and the demo post is live; the submission cannot be edited afterwards.
