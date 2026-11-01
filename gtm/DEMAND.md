# Long Con demand evidence

Fetched 2026-10-31. Verbatim text is copied from the opened source. X text was hydrated through fxTwitter. HN identity and dates were checked through the HN API plus the public profile. Reddit comments were retrieved from the public comment endpoint after the page itself returned a 403 through Jina.

## Exact pain fit

### BearMiner, persistent rumor and consequence network

Source: [Reddit comment](https://www.reddit.com/r/AzerothCore/comments/1woy8ag/i_hooked_an_llm_into_every_npc_in_wow_wotlk_they/pbs28sv/). Date: 2026-09-24, from the comment timestamp. Person: BearMiner, an AzerothCore community commenter, outside the team, judges, and rival builders.

> I'm honestly surprised this wasn't done sooner.
>
> Hook an LLM into an MMORPG, give every single NPC their prompt profile (this is your name, this is your backstory, this is the quest thread you participate in, these are the recent rumors you've heard, avoid these topics) and just let them do their thing.
>
> Of course, if you allow them to communicate with each other (via proximity) it gets interesting really fast. Imagine bad talking an NPC and insulting their shop, and over the next several days related NPC's in the neighboring shops, then towns, and later the capitol cities start reacting to you negatively. It would also add incredible importance to the very often ignored "traveling merchant" NPC's as they would actually pass information along from one community to another without player intervention.

Why it fits: this is the player-visible pain Long Con targets: an action should create delayed social consequences that travel between communities. It is exact for persistent NPC memory, rumor propagation, and traveling merchants. It is not evidence for the chain or bounded treasury.

### ryebread777, consequence-free lies flatten strategy

Source: [Hacker News comment](https://news.ycombinator.com/item?id=40092236). Date: 2024-04-19, HN API `created_at`. Person: ryebread777, data scientist and indie hacker, HN account created 2024-04-08, 194 karma, outside the team, judges, and rival builders.

> This is brilliant! I think a game with LLM NPCs would be crazy cool. Agree with the other commenter I would probably need a playable demo to pull the trigger though.
>
> Also, I didn’t realize from the website that it actually uses voice? That should probably be highlighted, unless I just missed it.
>
> One other thought, your title says it’s a game about social persuasion. In the examples on the site it seemed like many of the challenges just involved coming up with lies. If there are no consequences to just making up lies it seems to kind of flatten the strategy. Though I’m just speculating. Thanks for sharing!

Why it fits: exact pain is a flat con loop when lies have no durable consequence. The requested product is adjacent in setting and economy, but the problem statement is direct.

### Web3Convict, hidden rules and unverifiable game state

Source: [X post](https://x.com/Web3Convict/status/2050768099960590751). Date: 2026-05-03. Person: Web3Convict, an independent game and AI critic, 2,143 followers, account joined 2023-04-08, outside the team, judges, and rival builders.

> the AI difficulty? Controlled secretly on their private servers. they can make it harder anytime. you'd never know.
>
Why it fits: exact trust pain for an AI game whose rules and score cannot be independently checked. Long Con answers this with public contract state and signed model responses. It is not evidence that this person wants a merchant game.

## Adjacent pain and willingness to try

### MazzaBreno, free access

Source: [X post](https://x.com/MazzaBreno/status/2029940913326412007). Date: 2026-03-06. Person: MazzaBreno, 2,100 followers, account joined 2021-04-26, profile lists PlaySolCity and SuperteamBR.

> @solana_sailor @stormrae_ai This is an awesome idea! I upvote it 
> 
> @stormrae_ai make some free/sponsored "games" as well for us broke but interested people to play

Why adjacent: supports free play and a low-friction invitation, not persistent consequences.

### TexanWombat, new AI-enabled game genres

Source: [X post](https://x.com/TexanWombat/status/2115804235010806079). Date: 2026-10-29. Person: TexanWombat, streamer, 364 followers, account joined 2025-08-18, profile links Twitch and YouTube.

> The game scam with your friends made me realize, we're going to have entire game types possible now that simply weren't possible before without AI, that was genuinely fun and I think the antis are about to miss out on entire genres of games all because they can't get off their high horse. I can't wait to have all these exclusive experiences that filter out crazy people inherently.

Why adjacent: supports novelty and AI-enabled game formats, but does not state the persistent merchant or rumor pain.

### EnumeratedArray, fun beyond a general LLM

Source: [Reddit comment](https://www.reddit.com/r/aigamedev/comments/1v2enqh/made_a_little_planet_where_llm_npcs_remember_you/oyvl1j1/). Date: 2026-07-21, from the comment timestamp. Person: EnumeratedArray, an r/aigamedev commenter outside the team, judges, and rival builders.

> It's a cool concept, but where's the fun?
>
> If the fun is seeing the town evolve? It looks too big to consume and see changes over time.
>
> If it's LLM NPCs, what makes interacting with them fun, when I could just talk to any LLM online?

Why adjacent and adversarial: this is a direct test of whether the loop has a reason to return, but it is not a positive request for Long Con.

## Search and source limits

Exa search was run for persistent NPC memory, gossip, consequences, and repetitive AI game loops. Exa hit its free MCP rate limit after the first calls and fell back to Parallel. RivalSearch social_search was run across Reddit, Hacker News, and Product Hunt. Parallel web_search and web_fetch lanes were run. The Reddit page fetch through Jina returned 403, so the two Reddit comments were fetched through the public PullPush comment endpoint and their source URLs were opened separately. `papers search` was run twice on LLM NPC memory and agent safety queries, but OpenAlex, arXiv, and Semantic Scholar returned no results. Existing paper evidence remains in `docs/PRIOR-ART.md` and is not counted as a person quote.

Conclusion: 3 exact-pain people found, 3 adjacent people found. No evidence found that any named person wants a chain, NEAR, tokens, or a contract ledger.
