# Long Con: X post drafts

The human posts; nothing here is sent by an agent. Attach the 90-second video from `docs/DEMO-SCRIPT.md`. Replace `OWNER` with the GitHub account that publishes the repo. Lengths are counted the way X counts them, with every URL as 23 characters.

Two checks before posting: the deployed contract's `state` view shows `"model":"Qwen/Qwen3.8-27B"` with a signer read from the NEAR AI Cloud attestation report, and the long-form "In the video" paragraph matches the recorded take (edit outcomes and amounts to what the take shows).

## Variant A (279): the trust problem

```
AI prize games hide rules on their servers. Did you lose to the model or the house?

Long Con: con AI merchants out of gold. The contract checks each answer's NEAR AI Cloud signature and caps the loss.

Built at NEAR HACKATHON @NEARProtocol #NEARHackathon
https://github.com/OWNER/longcon
```

## Variant B (278): the two-hour problem

```
Conning an AI is fun for two hours, then every trick repeats.

In Long Con a landed con goes on chain and a caravan carries it a town a day. A lie works in Oskmoor until Oskmoor hears.

Which con next? https://github.com/OWNER/longcon
Built at NEAR HACKATHON @NEARProtocol #NEARHackathon
```

## Variant C (274): the security problem

```
Give an AI a treasury and someone talks it out of it.

Long Con's merchants are LLMs, but their limit is contract code: 15 gold per merchant per day, whatever the model agreed to.

Try to break it: https://github.com/OWNER/longcon
Built at NEAR HACKATHON @NEARProtocol #NEARHackathon
```

## Long-form variant

```
If you've tried to talk an AI out of a prize pool, you know the problem: the rules live on someone's server and you never find out whether the model said no or the house did.

Long Con is a road of three AI merchants who lend gold. You pitch one of them a story ("my grain wagons arrive on day 4, front me 30"), she answers, and the NEAR contract decides what actually happens. In the video: Marta offers a loan, the road cuts it to my bond because it has never seen me repay, I don't pay, my bond burns, and a con record lands on chain. Two game days later the record reaches Oskmoor, and Osk reads it before he answers my same lie.

What NEAR does here, concretely:
- Each merchant is Qwen3.8-27B on NEAR AI Cloud. The contract builds the request, and it accepts an answer only if NEAR AI Cloud's ed25519 signature over the request and response hashes verifies on chain.
- The offer waits in a yield for up to 200 blocks; a timeout hands your bond back.
- Loss caps are contract code: 15 gold per merchant per day, 30% of a treasury, interest at most 50%.
- You play from a browser key with no wallet popup; a relayer pays gas through NEP-366 delegate actions.
- Each landed con mints a NEP-245 rumour token.

Repo, run steps and the test suite (it throws 1,000 fresh accounts at one merchant): https://github.com/OWNER/longcon

Which con should the road learn next? Tell me where it stops being fun.

Built at NEAR HACKATHON @NEARProtocol #NEARHackathon @NearLegion @NearBuilders
```
