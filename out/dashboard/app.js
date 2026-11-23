// Token Radar dashboard. Static: it reads window.RADAR from ../data.js and makes no requests.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var $ = function (id) { return document.getElementById(id); };
  var tbody = $('rows'), detail = $('detail'), layout = document.querySelector('.layout');
  var state = { q: '', category: 'all', chain: 'all', sort: 'rank', dir: 1, selected: null };

  if (!DATA || !Array.isArray(DATA.rows)) {
    $('meta').textContent = 'The board data did not load. Run main.ts again so data.js sits beside the dashboard folder.';
    return;
  }

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    return d >= 365 ? (d / 365).toFixed(1) + ' years' : Math.max(0, Math.round(d)) + ' days';
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  // Farm plan: category, chain, TVL and age decide the action, capital, hold, cost and time.
  function chainOf(p) { return p.chains && p.chains.length ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) { return p.tvl_usd >= 5e9 ? 250 : p.tvl_usd >= 1e9 ? 150 : p.tvl_usd >= 1e8 ? 100 : 50; }
  function holdFor(age) { return age === null || age === undefined ? 30 : age < 180 ? 60 : age < 365 ? 45 : 30; }
  function actionFor(p, cap, chain) {
    var c = (p.category || '').toLowerCase(), n = p.name;
    function has() { for (var i = 0; i < arguments.length; i++) if (c.indexOf(arguments[i]) >= 0) return true; return false; }
    if (has('lend', 'cdp', 'collateral')) return 'Supply $' + cap + ' of USDC to ' + n + ' on ' + chain + ' and keep the position open.';
    if (has('dex', 'yield', 'leveraged farm')) return 'Provide $' + cap + ' of liquidity to ' + n + "'s main pool on " + chain + ' and keep the position open.';
    if (has('bridge')) return 'Bridge $' + cap + ' of USDC to ' + chain + ' through ' + n + ' and use the bridged funds in its app.';
    if (has('staking', 'restak')) return 'Stake $' + cap + " of the chain's staking asset through " + n + ' and keep the receipt.';
    if (has('perpetual', 'derivative')) return 'Deposit $' + cap + ' of USDC as margin on ' + n + ' and open one small hedge.';
    if (has('prediction')) return 'Fund $' + cap + ' and place one market position on ' + n + '.';
    if (has('curator', 'allocator')) return 'Deposit $' + cap + ' into a ' + n + ' vault on ' + chain + ' and keep the shares.';
    if (has('stable')) return 'Mint or deposit $' + cap + ' of the stable asset through ' + n + ' on ' + chain + '.';
    if (has('rwa')) return 'Mint $' + cap + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (has('insurance')) return 'Buy $' + cap + ' of cover from ' + n + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + cap + ' of USDC into ' + n + ' on ' + chain + ' and keep the position open.';
  }
  // Each category owns its step count, 3 to 8, from a fixed hash of its name, so the count varies by category.
  function countFor(category) {
    var h = 7, c = category || 'Other';
    for (var i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) % 9973;
    return 3 + (h % 6);
  }
  function farmSteps(p) {
    var chain = chainOf(p), cap = capitalFor(p), hold = holdFor(p.age_days);
    var pool = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, cap, chain), cost: '$' + cap + ' of capital and about $' + (cap >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + cap + ' stays in the position', time: hold + ' days' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
      { text: 'Check the protocol\'s audits and contract addresses against its docs before each new deposit.', cost: 'no fee', time: '10 minutes' },
      { text: 'Plan the exit: note any lock-up or withdrawal queue, and set a calendar date to unwind the position.', cost: 'about $' + (cap >= 150 ? 8 : 4) + ' of gas to exit', time: '15 minutes' }
    ];
    return pool.slice(0, countFor(p.category));
  }

  function visible() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      return (r.name + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase().indexOf(q) >= 0;
    });
  }

  function renderRows() {
    var rows = visible();
    var key = { rank: 'rank', tvl: 'tvl_usd', implied: 'implied_value_usd' }[state.sort];
    rows.sort(function (a, b) { return (a[key] - b[key]) * state.dir || a.rank - b.rank; });
    Array.prototype.forEach.call(document.querySelectorAll('th[data-sort]'), function (th) {
      var on = th.dataset.sort === state.sort;
      th.setAttribute('aria-sort', on ? (state.dir > 0 ? 'ascending' : 'descending') : 'none');
      th.querySelector('.arrow').textContent = on ? (state.dir > 0 ? ' \u25B2' : ' \u25BC') : '';
    });
    tbody.textContent = '';
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.dataset.slug = r.slug;
      tr.setAttribute('aria-selected', String(r.slug === state.selected));
      tr.appendChild(el('td', 'num', String(r.rank)));
      var nameTd = el('td', 'name');
      var btn = el('button', null, r.name);
      btn.type = 'button';
      btn.setAttribute('aria-controls', 'detail');
      nameTd.appendChild(btn);
      tr.appendChild(nameTd);
      tr.appendChild(el('td', null, r.category || 'Other'));
      var chains = r.chains || [];
      tr.appendChild(el('td', 'chain', chains.length ? chains.slice(0, 3).join(', ') + (chains.length > 3 ? ' +' + (chains.length - 3) : '') : 'n/a'));
      tr.appendChild(el('td', 'num', fmtUsd(r.tvl_usd)));
      tr.appendChild(el('td', 'num implied', fmtUsd(r.implied_value_usd)));
      tr.appendChild(el('td', 'num', String(countFor(r.category))));
      tr.appendChild(el('td', 'go', '\u203A'));
      tr.lastChild.setAttribute('aria-hidden', 'true');
      tr.addEventListener('click', function () { select(r.slug, false); });
      btn.addEventListener('click', function (e) { e.stopPropagation(); select(r.slug, true); });
      tbody.appendChild(tr);
    });
    $('count').textContent = rows.length + ' of ' + DATA.rows.length + ' protocols shown';
    $('empty').hidden = rows.length > 0;
  }

  function fact(dl, label, value) {
    var d = el('div');
    d.appendChild(el('dt', null, label));
    d.appendChild(el('dd', null, value));
    dl.appendChild(d);
  }

  // How the number is built: the formula, this protocol's three biggest drivers, and the confidence band.
  function drivers(r) {
    var base = r.tvl_usd * DATA.model.base_multiple;
    var mult = r.growth_multiplier * r.maturity_multiplier * r.chain_multiplier * r.category_multiplier * r.thin_tvl_multiplier;
    var value = mult > 0 ? r.implied_value_usd / mult : base;
    var list = [
      { name: 'Revenue multiplier', m: base > 0 ? value / base : 1, note: 'revenue (or fees) x ' + DATA.model.cashflow_multiple + ' added to TVL x ' + DATA.model.base_multiple },
      { name: 'Growth (7-day change)', m: r.growth_multiplier, note: fmtPct(r.change_7d) + ' at weight ' + DATA.model.growth_weight },
      { name: 'Age (maturity)', m: r.maturity_multiplier, note: fmtAge(r.age_days) + ' with no token' },
      { name: 'Chain weight', m: r.chain_multiplier, note: (r.chains || []).slice(0, 3).join(', ') || 'no chain listed' },
      { name: 'Category multiplier', m: r.category_multiplier, note: r.category || 'Other' },
      { name: 'Thin-TVL discount', m: r.thin_tvl_multiplier, note: r.thin_tvl_multiplier < 1 ? 'TVL under ' + fmtUsd(DATA.model.thin_tvl_usd) : 'not applied' }
    ];
    list.forEach(function (d) { d.mag = Math.abs(Math.log(d.m > 0 ? d.m : 1)); });
    list.sort(function (a, b) { return b.mag - a.mag; });
    return list.slice(0, 3);
  }
  function buildPanel(r) {
    var box = el('section', 'build');
    box.setAttribute('aria-label', 'How the number is built');
    box.appendChild(el('h3', null, 'How the number is built'));
    box.appendChild(el('p', 'formula', 'implied = (TVL x ' + DATA.model.base_multiple + ' + revenue x ' + DATA.model.cashflow_multiple + ') x growth x maturity x chain weight x category multiplier x thin-TVL discount (' + DATA.model.thin_discount + ' under ' + fmtUsd(DATA.model.thin_tvl_usd) + ')'));
    box.appendChild(el('p', 'sub', 'Top three drivers for ' + r.name));
    var ul = el('ol', 'drivers');
    drivers(r).forEach(function (d) {
      var pct = (d.m - 1) * 100;
      var li = el('li', null, d.name + ': x' + d.m.toFixed(2) + ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%)');
      li.appendChild(el('span', 'meta-line', d.note));
      ul.appendChild(li);
    });
    box.appendChild(ul);
    var pctBand = r.tvl_usd < 5e7 ? 15 : 8;
    var band = el('p', 'band', 'Implied value ' + fmtUsd(r.implied_value_usd) + ' \u00B1' + pctBand + '%, a range of ' + fmtUsd(r.implied_value_usd * (1 - pctBand / 100)) + ' to ' + fmtUsd(r.implied_value_usd * (1 + pctBand / 100)) + '. ');
    band.appendChild(el('span', 'meta-line', 'Confidence band: \u00B115% when TVL is under $50M, \u00B18% otherwise.'));
    box.appendChild(band);
    return box;
  }

  function renderDetail(focus) {
    var r = DATA.rows.filter(function (x) { return x.slug === state.selected; })[0];
    if (!r) { detail.hidden = true; layout.classList.remove('has-detail'); return; }
    detail.textContent = '';
    var head = el('div', 'detail-head');
    var titles = el('div');
    var h2 = el('h2', null, r.name);
    h2.id = 'detail-title';
    h2.tabIndex = -1;
    titles.appendChild(h2);
    titles.appendChild(el('p', 'sub', 'Rank ' + r.rank + ' of ' + DATA.rows.length + '. ' + (r.category || 'Other') + ' on ' + ((r.chains || []).join(', ') || 'an unnamed chain') + '.'));
    var close = el('button', 'close', 'Close');
    close.type = 'button';
    close.addEventListener('click', function () { select(null, false); });
    head.appendChild(titles);
    head.appendChild(close);
    detail.appendChild(head);

    var dl = el('dl', 'facts');
    fact(dl, 'TVL', fmtUsd(r.tvl_usd));
    fact(dl, 'Implied value', fmtUsd(r.implied_value_usd));
    fact(dl, 'Seven-day change', fmtPct(r.change_7d));
    fact(dl, 'Age with no token', fmtAge(r.age_days));
    detail.appendChild(dl);
    detail.appendChild(buildPanel(r));

    var steps = farmSteps(r);
    detail.appendChild(el('h3', null, 'Farm steps (' + steps.length + ')'));
    var ol = el('ol', 'steps');
    steps.forEach(function (s) {
      var li = el('li', null, s.text);
      li.appendChild(el('span', 'meta-line', 'Cost: ' + s.cost + '. Time: ' + s.time + '.'));
      ol.appendChild(li);
    });
    detail.appendChild(ol);
    detail.appendChild(el('p', 'note', 'Implied value is a model estimate, not a price, and farming may earn nothing.'));

    detail.hidden = false;
    layout.classList.add('has-detail');
    if (focus) h2.focus();
  }

  function select(slug, focus) {
    var prev = state.selected;
    state.selected = slug === prev && slug !== null && !focus ? null : slug;
    Array.prototype.forEach.call(tbody.children, function (tr) {
      tr.setAttribute('aria-selected', String(tr.dataset.slug === state.selected));
    });
    renderDetail(focus);
    if (!state.selected && prev) {
      var back = tbody.querySelector('tr[data-slug="' + prev + '"] button');
      if (back) back.focus();
    }
  }

  // Setup
  $('meta').textContent = 'Snapshot ' + DATA.as_of + '. ' + DATA.board_size + ' protocols with no token on record, scored by the ' + DATA.model_version + ' model. Select a row for its farm steps and how its number is built.';
  var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
  cats.forEach(function (c) {
    var o = el('option', null, c);
    o.value = c;
    $('category').appendChild(o);
  });
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderRows(); });
  var chainNames = Array.from(new Set([].concat.apply([], DATA.rows.map(function (r) { return r.chains || []; })))).sort();
  chainNames.forEach(function (c) { var o = el('option', null, c); o.value = c; $('chain').appendChild(o); });
  Array.prototype.forEach.call(document.querySelectorAll('th[data-sort] button'), function (b) {
    b.addEventListener('click', function () {
      var k = b.parentNode.dataset.sort;
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'rank' ? 1 : -1; }
      renderRows();
    });
  });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderRows(); });
  $('category').addEventListener('change', function (e) { state.category = e.target.value; renderRows(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.selected) select(null, false); });
  // URL parameters: ?open=<slug>&category=&chain=&q=&sort=rank|tvl|implied&dir=asc|desc
  var params = new URLSearchParams(location.search);
  if (params.get('category') && cats.indexOf(params.get('category')) >= 0) { state.category = params.get('category'); $('category').value = state.category; }
  if (params.get('chain') && chainNames.indexOf(params.get('chain')) >= 0) { state.chain = params.get('chain'); $('chain').value = state.chain; }
  if (params.get('q')) { state.q = params.get('q'); $('q').value = state.q; }
  if (['rank', 'tvl', 'implied'].indexOf(params.get('sort')) >= 0) { state.sort = params.get('sort'); state.dir = state.sort === 'rank' ? 1 : -1; }
  if (params.get('dir') === 'asc') state.dir = 1; else if (params.get('dir') === 'desc') state.dir = -1;
  renderRows();
  if (params.get('open')) select(params.get('open'), false);
})();
