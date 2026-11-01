# Long Con edge sweep

Sweep date: 2026-10-31. Query lanes: `papers search "LLM NPC persistent memory gossip game agent economy contract safety"`, `exa search "NEAR SDK yield resume host functions signed AI response verification 2026"`, Parallel fallback after Exa's free limit, and the already-read official NEAR docs.

## Adopted or spiked

| Finding | Source opened | Status and consequence |
|---|---|---|
| NEAR yield and resume can wait for an external response for up to 200 blocks, then resume with a timeout value. The public resume path must be guarded and invalid responses should be rejected in the resume function. | [NEAR yield and resume docs](https://docs.near.org/smart-contracts/anatomy/yield-resume) | Adopted in the existing yield-budget spike and the contract design: bounded wait, guarded resume, timeout branch, and invalid-response rejection are explicit acceptance cases. |
| NEAR AI response signatures bind exact request and response bytes. A missing or unfamiliar signature kind must not be treated as verified. | [NEAR AI response signatures](https://docs.near.ai/cloud/verification/cloud-api/response-signatures.md) | Adopted in the existing attestation path: model, request hash, response hash, signer kind, and altered-byte rejection are evidence fields. |
| NEAR AI's current TypeScript inference SDK exposes direct verification functions for model attestation and response signatures. | [nearai/inference-sdk API reference](https://github.com/nearai/inference-sdk/blob/main/js/docs/api-reference.md) | Spiked as the worker integration path: `worker/src/llm.ts` in `near-ai` mode reads the signature endpoint and checks the signed text against the hashes it sent and received. |
| NEAR AI's official verification example distinguishes model TEE signatures from gateway signatures and warns that the signer kind matters. | [near-examples verification example](https://github.com/near-examples/nearai-cloud-verification-example) | Adopted in the red-team checklist: report signer kind and reject third-party or absent verification instead of inferring trust from response shape. |

## Paper and search result

The requested paper search returned no results from OpenAlex, arXiv, or Semantic Scholar on 2026-10-31. Existing read papers in `docs/PRIOR-ART.md` support three design constraints: batch offers to reduce first-proposal bias, structured records instead of free text for caravan news, and contract-side caps and escrow for agent mistakes. This is a documented search failure, not a claim that no paper exists.

## Kill list

- Do not claim the newest SDK is live until a signed response is completed and verified.
- Do not call the game self-balancing from caps alone.
- Do not let a free-text merchant or player story become the next town's state.
