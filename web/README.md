# Long Con web

`index.html` is the live ledger page: static files, no build step, no packages. It reads the contract straight from the NEAR RPC.

Open it:

```
python3 -m http.server 8080 --directory web
```

Then browse to `/` on port 8080, or to `/?contract=<account id>` to read another road. Query parameters `contract`, `rpc`, `explorer` and `network` override `web/public/config.json`.

| Panel | RPC call | Contract view |
|---|---|---|
| Merchants and treasuries | `query` with `request_type: call_function`, `finality: final` | `state` (merchants, gold, grain, prices, open advances, gold lost, caps) |
| Con records | same | `con_records` with `from: 0, limit: 50` (class, town, day, principal, bond burned, request, response and config hashes) |
| Read at | `block` with `finality: final` | block height and timestamp of the read, printed under each panel |

`game.html` is the playable client (vite, TypeScript): `cd web && bun install && bun run dev`, then open `/game.html` on port 5173.
