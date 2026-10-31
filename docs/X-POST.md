# Long Con: X post drafts

The human posts; no agent sends anything. Attach the 90-second video from `docs/DEMO-SCRIPT.md`. The repo URL is the `origin` remote; change it if the repo moves. Lengths count every URL as 23 characters, the way X does (counted with a script, not by eye).

Before posting, two checks:

1. `near contract call-function as-read-only longcon2-game.testnet state json-args '{}' network-config testnet now` shows `"model":"Qwen/Qwen3.8-27B"` and a signer key equal to the one in NEAR AI Cloud's attestation report. Variant A and the long form say NEAR AI Cloud signs each answer; that has to be true of the road in the video.
2. Variant B and the long form describe the recorded take: one repaid loan, then 9 gold borrowed and not repaid. Edit the amounts to what the take shows.

## Variant A (276): the trust problem

```
AI prize games hide their rules on a server. Did the model say no, or the house?

Long Con: con AI merchants out of gold. NEAR AI Cloud signs each answer; the contract checks it before a coin moves.

Built at NEAR HACKATHON @NEARProtocol #NEARHackathon
https://github.com/kamalbuilds/near-longcon
```

## Variant B (279): the moment

```
Con an AI once and the trick works forever.

In Long Con I repaid a loan, borrowed 9 gold on trust and walked. The contract capped the loss; a caravan took the news. The next town knew.

Which con next? https://github.com/kamalbuilds/near-longcon
Built at NEAR HACKATHON @NEARProtocol #NEARHackathon
```

## Variant C (277): the security problem

```
Give an AI a treasury and someone talks it out of it.

Long Con's merchants are LLMs. Their limit is NEAR contract code: bond plus earned trust, 15 gold a day each, whatever the model says.

Break it: https://github.com/kamalbuilds/near-longcon
Built at NEAR HACKATHON @NEARProtocol #NEARHackathon
```

## Long-form variant

```
If you've tried to talk an AI out of a prize pool, you know the catch: the rules sit on someone's server, and you never learn whether the model said no or the house did.

Long Con is a road of three AI merchants who lend gold. You pitch one a story, she answers, and a NEAR contract decides what actually happens.

In the video I play it straight first. Marta lends me 6, I repay 7, and the road now trusts me for 3 gold beyond my bond. Then I pitch her a cargo story and ask for 30. Her model can offer anything; the contract pays bond plus earned trust, 9 gold. I don't repay. My bond burns, Marta books the loss, and a con record goes on chain. A game day later Pellgate has the news, and Pell reads it before he answers my same story.

What NEAR does here:
- Each merchant runs Qwen3.8-27B on NEAR AI Cloud. The contract writes the request itself and accepts an answer only if NEAR AI Cloud's ed25519 signature over the request and response hashes verifies on chain.
- Your offer waits in a NEAR yield for up to 200 blocks. If no answer comes, your bond comes back.
- Loss limits are contract code: 15 gold per merchant per due day, 30% of a merchant's capital, interest at most 50%.
- You play from a key your browser makes, with no wallet popup. A relayer pays gas through NEP-366 delegate actions.
- Every landed con mints a NEP-245 rumour token.

The repo has the run steps and the test suite, including 1,000 fresh accounts thrown at one merchant: https://github.com/kamalbuilds/near-longcon

Where does it stop being fun? Tell me which con the road should learn next.

Built at NEAR HACKATHON @NEARProtocol #NEARHackathon @NearLegion @NearBuilders
```
