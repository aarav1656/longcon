const params = new URLSearchParams(location.search);

async function loadConfig() {
  let fileCfg = {};
  for (const path of ['config.json', 'public/config.json']) {
    try {
      const r = await fetch(path, { cache: 'no-store' });
      if (r.ok) { fileCfg = await r.json(); break; }
    } catch (e) {
      // try the next location; query params can still configure the page
    }
  }
  const cfg = Object.assign({}, fileCfg);
  if (params.get('contract')) cfg.contract_id = params.get('contract');
  if (params.get('rpc')) cfg.rpc = params.get('rpc');
  if (params.get('explorer')) cfg.explorer = params.get('explorer');
  if (params.get('network')) cfg.network = params.get('network');
  return cfg;
}

function defaultRpc(network) {
  return network === 'mainnet'
    ? 'https://rpc.mainnet.fastnear.com'
    : 'https://test.rpc.fastnear.com';
}

function defaultExplorer(network) {
  return network === 'mainnet'
    ? 'https://nearblocks.io'
    : 'https://testnet.nearblocks.io';
}

async function rpcCall(rpcUrl, method, rpcParams) {
  const r = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'longcon-demo', method: method, params: rpcParams })
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + r.statusText);
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}

async function callFunction(contractId, methodName, args, rpcUrl) {
  const argsBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(args || {}))));
  const result = await rpcCall(rpcUrl, 'query', {
    request_type: 'call_function',
    finality: 'final',
    account_id: contractId,
    method_name: methodName,
    args_base64: argsBase64
  });
  const bytes = new Uint8Array(result.result);
  const text = new TextDecoder().decode(bytes);
  let value;
  try { value = JSON.parse(text); } catch (e) { value = text; }
  return { value: value, blockHeight: result.block_height };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function linkAccount(explorer, id) {
  return '<a href="' + esc(explorer) + '/address/' + encodeURIComponent(id) + '" target="_blank" rel="noreferrer">' + esc(id) + '</a>';
}

function showError(el, msg, hint) {
  el.innerHTML = '<p class="error">' + esc(msg) + '</p>' + (hint ? '<pre>' + esc(hint) + '</pre>' : '');
}

function renderMerchants(el, state, readAt) {
  if (!state || !Array.isArray(state.merchants)) {
    el.innerHTML = '<p class="empty">No merchant data returned.</p>';
    return;
  }
  const towns = (state.rules && Array.isArray(state.rules.towns)) ? state.rules.towns : [];
  const cap = state.rules ? state.rules.loss_cap_per_day : '';
  const pct = state.rules ? state.rules.treasury_cap_pct : '';
  el.innerHTML = state.merchants.map(function (m) {
    const townName = towns[m.town] || ('town ' + (m.town + 1));
    const allowed = (m.outstanding || 0) + (m.treasury_room || 0);
    return '<div class="merchant">' +
      '<h3>' + esc(m.name) + '</h3>' +
      '<p class="label">' + esc(townName) + ', town ' + (m.town + 1) + ' of ' + (towns.length || 3) + '</p>' +
      '<dl class="kv">' +
        '<dt>Gold in strongbox (treasury)</dt><dd class="num">' + esc(m.gold) + '</dd>' +
        '<dt>Grain in stock</dt><dd class="num">' + esc(m.grain) + '</dd>' +
        '<dt>Buys grain at</dt><dd class="num">' + esc(m.buy_price) + '</dd>' +
        '<dt>Sells grain at</dt><dd class="num">' + esc(m.sell_price) + '</dd>' +
        '<dt>Outstanding loans</dt><dd class="num">' + esc(m.outstanding) + '</dd>' +
        '<dt>Lost to cons so far</dt><dd class="num">' + esc(m.lost_total) + '</dd>' +
        '<dt>Lent of allowed</dt><dd class="num">' + esc(m.outstanding) + ' of ' + esc(allowed) + '</dd>' +
      '</dl>' +
      '<p class="label" style="margin-top:8px;">Daily loss cap ' + esc(cap) + ' gold. Treasury cap ' + esc(pct) + ' percent.</p>' +
      '</div>';
  }).join('') + '<p class="readat">Read at block ' + esc(readAt.blockHeight) + ', ' + esc(readAt.timestamp) + '</p>';
}

function renderRecords(el, records, towns, readAt) {
  if (!Array.isArray(records) || records.length === 0) {
    el.innerHTML = '<p class="empty">No con has landed yet.</p><p class="readat">Read at block ' + esc(readAt.blockHeight) + ', ' + esc(readAt.timestamp) + '</p>';
    return;
  }
  el.innerHTML = records.map(function (r) {
    const townName = (towns && towns[r.town]) ? towns[r.town] : ('town ' + (r.town + 1));
    const originTown = (towns && towns[r.town]) ? towns[r.town] : ('town ' + (r.town + 1));
    return '<div class="record">' +
      '<div class="head">' +
        '<span><span class="cls">' + esc(r.class) + '</span> in ' + esc(originTown) + ', day ' + esc(r.day) + '</span>' +
        '<span class="lost">-' + esc(r.loss) + '</span>' +
      '</div>' +
      '<p>By ' + linkAccount(readAt.explorer, r.player) + '. Bond burned ' + esc(r.bond_burned) + '. Principal ' + esc(r.principal) + '.</p>' +
      '<p class="sub">Request ' + esc(r.request_hash) + ' . Response ' + esc(r.response_hash) + ' . Config ' + esc(r.config_hash) + '</p>' +
      '</div>';
  }).join('') + '<p class="readat">Read at block ' + esc(readAt.blockHeight) + ', ' + esc(readAt.timestamp) + '</p>';
}

async function main() {
  const meta = document.getElementById('meta');
  const merchantsEl = document.getElementById('merchants');
  const recordsEl = document.getElementById('records');

  const cfg = await loadConfig();
  const contractId = cfg.contract_id;
  const network = cfg.network || 'mainnet';
  const rpcUrl = cfg.rpc || defaultRpc(network);
  const explorer = cfg.explorer || defaultExplorer(network);

  if (!contractId) {
    const msg = 'No contract id configured.';
    meta.textContent = msg;
    const hint = 'Run the local road: PREFIX=mygame scripts/testnet-up.sh\nThen open this page with ?contract=mygame-game.testnet\nOr serve it with: python3 -m http.server 8080 --directory web';
    showError(merchantsEl, msg, hint);
    showError(recordsEl, msg, hint);
    return;
  }

  let blockHeight = '';
  let timestamp = '';
  try {
    const block = await rpcCall(rpcUrl, 'block', { finality: 'final' });
    blockHeight = block.header.height;
    timestamp = new Date(Math.floor(block.header.timestamp / 1e6)).toISOString();
  } catch (e) {
    // timestamp is optional; continue
  }

  const readAt = { blockHeight: blockHeight, timestamp: timestamp, explorer: explorer };

  let st = null;
  try {
    st = await callFunction(contractId, 'state', {}, rpcUrl);
    readAt.blockHeight = st.blockHeight || readAt.blockHeight;
    renderMerchants(merchantsEl, st.value, readAt);
  } catch (e) {
    showError(merchantsEl, 'Could not read merchants: ' + (e && e.message ? e.message : String(e)), 'Check the contract id and RPC URL, or run the local road: PREFIX=mygame scripts/testnet-up.sh');
  }

  try {
    const recs = await callFunction(contractId, 'con_records', { from: 0, limit: 50 }, rpcUrl);
    const towns = (st && st.value && st.value.rules && Array.isArray(st.value.rules.towns)) ? st.value.rules.towns : [];
    readAt.blockHeight = recs.blockHeight || readAt.blockHeight;
    renderRecords(recordsEl, recs.value, towns, readAt);
  } catch (e) {
    showError(recordsEl, 'Could not read con records: ' + (e && e.message ? e.message : String(e)), 'Check the contract id and RPC URL, or run the local road: PREFIX=mygame scripts/testnet-up.sh');
  }

  meta.textContent = 'Contract ' + contractId + ' on ' + network + '. RPC ' + rpcUrl + '. Read at block ' + readAt.blockHeight + (readAt.timestamp ? ', ' + readAt.timestamp : '') + '.';
}

main().catch(function (e) {
  const meta = document.getElementById('meta');
  if (meta) meta.textContent = 'Could not start: ' + (e && e.message ? e.message : String(e));
});
