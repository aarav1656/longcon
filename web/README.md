# Long Con demo page

Static page, no build step and no packages.

Open it:

python3 -m http.server 8080 --directory web
then open http://localhost:8080

Panels and the endpoints they read:
- Merchants and treasuries: NEAR JSON-RPC call_function `state` on the configured contract.
- Con records: NEAR JSON-RPC call_function `con_records` on the configured contract.

Configure the contract id with web/config.json or the `?contract=` query parameter. If no contract id is configured, the page shows the error and the local run command instead of data.
