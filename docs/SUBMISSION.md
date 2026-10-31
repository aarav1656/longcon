# Long Con: submission fields

Personal fields (lead name, email, team size, payout account, demo URL, consent) come from the human at submit time and are never written here. The human confirms the full JSON payload before anything is sent.

## What did you build (`idea`, 1,945 characters)

```
Problem: games where you talk an AI out of a prize keep their rules on a private server. A player cannot tell whether the model refused or the house did, and a trick that works once works forever, so the fun runs out fast.

Product: Long Con is a free browser game on a road of three AI merchants who lend gold held as NEAR contract state. You pitch a merchant a story and ask for an advance. The model proposes terms; the contract decides. The road lends only your bond until you repay, and each repayment raises your credit by half the principal, so a con pays only after you have earned trust. Default and your bond burns, the merchant books a capped loss, and the contract writes a con record (class, town, amount, request and response hashes, no pitch text). The record reaches the next town one game day later and enters that merchant's prompt, so a con works only until the news arrives. Each landed con mints a NEP-245 rumour token.

How NEAR fits: the contract builds each merchant's request and holds the player's offer in a yield for up to 200 blocks; a timeout refunds the bond. It accepts an answer only if an ed25519 signature over model, request hash and response hash verifies on chain against the key from NEAR AI Cloud's attestation report for that model. Contract rules then apply whatever the model said: bond plus earned line, 15 gold per merchant per due day, 30% of a merchant's capital, interest at most 50%, quotes that cannot be traded in a circle. Offers for one merchant are sealed into one batch, so the model weighs every waiting pitch together. Players hold a browser key as a NEAR implicit account and a relayer pays gas through NEP-366 delegate actions: no wallet popup.

Try it: the README has testnet run steps and one command for 44 sandbox tests on the real wasm (signature tampering, every cap, batch fairness, a 1,000-account Sybil wave), plus a mutation table: each guard broken, test red, guard restored.
```

## Tracks

```json
["games", "security"]
```

- `games`: the merchants are AI NPCs whose gold is contract state, and the road changes from play alone: every landed con travels as a record into later prompts with no dev patch, and the chain stays behind a browser key and a relayer, which is the brief's bonus condition.
- `security`: "Give AI money without giving it the keys to everything" is the contract's whole job here: the model proposes, an on-chain signature check proves which model answered, and hard caps bound what any answer can cost, tested against a 1,000-account Sybil wave and a player who always defaults.

## Q-015 disclosure (README and form)

```
Members of this team also enter Voucher, Overdraft and Receipts in NEAR HACKATHON; Long Con is a separate project with its own contract and shares no code with them.
```

Add Cachet, Customs, Sworn or Taster to that sentence if any of them is submitted, and keep the README's Disclosure section identical to it.

## Before sending

- `state` on the contract in `web/public/config.json` shows `"model":"Qwen/Qwen3.8-27B"` with the signer key from NEAR AI Cloud's attestation report.
- Every file the README links opens from a clean clone.
- The repo is public and the demo post is live; the submission cannot be edited afterwards.
