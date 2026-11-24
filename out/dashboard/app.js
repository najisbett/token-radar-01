'use strict';
// Token Radar page: reads window.RADAR (data.js), no network. State lives in the URL:
//   ?row=<slug>  open a row   ?q=  search   ?category=  ?chain=  ?verdict=FARM|WATCH|SKIP  ?watch=1  ?sort=<col>&dir=asc|desc
(function () {
  const D = window.RADAR;
  const P = D.params;
  const I = D.integrity;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const usd = (n) => {
    if (n === null || n === undefined) return '–';
    const a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K';
    return '$' + Math.round(n);
  };
  const money = (n) => (n >= 10 ? '$' + Math.round(n) : '$' + (Math.round(n * 100) / 100));
  const pct = (n) => (n === null || n === undefined ? '–' : (n > 0 ? '+' : '') + (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1)) + '%');
  const pc0 = (p) => Math.round(p * 100) + '%';
  const mult = (n) => n.toFixed(2) + '×';
  const ageText = (r) => (r.age_days === null ? 'n/a' : r.age_days >= 365 ? (r.age_days / 365).toFixed(1) + ' y' : r.age_days + ' d');
  const mins = (m) => (m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min');
  const num = (n, d) => (n < 0 ? '−' : '') + Math.abs(n).toFixed(d === undefined ? 3 : d);

  const dl = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const Q90 = I.q90_net_per_hr, Q50 = I.q50_net_per_hr;
  const GASCAP = '$' + P.farm_max_gas_usd, PMIN = Math.round(P.farm_min_p * 100) + '%';
  const FARM_RULE = 'top decile by net $/hr within this board (q90 = ' + dl(Q90) + '/hr or more), gas ≤ ' + GASCAP + ', p ≥ ' + PMIN;
  const WATCH_RULE = 'at or above the board median net $/hr (q50 = ' + dl(Q50) + '/hr), not FARM';
  const RULE_TEXT = 'FARM = ' + FARM_RULE + '; WATCH = ' + WATCH_RULE + '; SKIP = rest';
  const SUP = I.support_counts;
  const VRANK = { FARM: 0, WATCH: 1, SKIP: 2 };
  const COLS = [
    { key: 'rank', label: 'Rank', num: true, val: (r) => r.rank },
    { key: 'name', label: 'Protocol', val: (r) => r.name.toLowerCase() },
    { key: 'category', label: 'Category', val: (r) => (r.category || '').toLowerCase() },
    { key: 'tvl', label: 'TVL', num: true, val: (r) => r.tvl_usd },
    { key: 'change', label: '7d %', num: true, tip: '7-day TVL change', val: (r) => r.change_7d },
    { key: 'age', label: 'Age', num: true, tip: 'Time listed with no token', val: (r) => r.age_days },
    { key: 'p', label: 'p(token)', num: true, tip: 'Peer-based token odds, with the support level and peer counts behind the estimate', val: (r) => r.p_token },
    { key: 'value', label: 'Implied value', num: true, tip: 'p50 implied value with the p10–p90 range', val: (r) => r.implied_value_usd },
    { key: 'hr', label: 'Net $/hr', num: true, tip: 'Expected dollars per hour at p50 after gas, uncapped; p10 below. Gross $/hr is in the detail panel', val: (r) => r.net_per_hr_p50 },
    { key: 'verdict', label: 'Verdict', val: (r) => VRANK[r.verdict] },
  ];
  const DESC_FIRST = new Set(['tvl', 'change', 'age', 'p', 'value', 'hr']);
  const state = { sort: 'rank', dir: 'asc', q: '', category: '', chain: '', verdict: '', watch: false, row: '' };
  const rowsBySlug = new Map(D.rows.map((r) => [r.slug, r]));

  function readUrl() {
    const p = new URLSearchParams(location.search);
    state.q = p.get('q') || '';
    state.category = p.get('category') || '';
    state.chain = p.get('chain') || '';
    state.verdict = VRANK[p.get('verdict')] !== undefined ? p.get('verdict') : '';
    state.watch = p.get('watch') === '1';
    state.row = p.get('row') || '';
    const s = p.get('sort');
    if (COLS.some((c) => c.key === s)) state.sort = s;
    state.dir = p.get('dir') === 'desc' ? 'desc' : p.get('dir') === 'asc' ? 'asc' : DESC_FIRST.has(state.sort) ? 'desc' : 'asc';
  }
  function writeUrl() {
    const p = new URLSearchParams();
    ['q', 'category', 'chain', 'verdict', 'row'].forEach((k) => { if (state[k]) p.set(k, state[k]); });
    if (state.watch) p.set('watch', '1');
    if (state.sort !== 'rank' || state.dir !== 'asc') { p.set('sort', state.sort); p.set('dir', state.dir); }
    const qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }
  function hl(text, q) {
    const frag = document.createDocumentFragment();
    const i = q ? text.toLowerCase().indexOf(q) : -1;
    if (i < 0) { frag.append(text); return frag; }
    frag.append(text.slice(0, i), el('mark', '', text.slice(i, i + q.length)), text.slice(i + q.length));
    return frag;
  }
  function chip(v) {
    const c = el('span', 'vchip v-' + v.toLowerCase(), v);
    c.title = { FARM: 'FARM = ' + FARM_RULE, WATCH: 'WATCH = ' + WATCH_RULE + ' and not FARM', SKIP: 'SKIP = rest (net $/hr under q50 = ' + dl(Q50) + '/hr)' }[v];
    return c;
  }
  // ---- legend, filled from the build's own quantiles
  (function legend() {
    const k = $('keys');
    const key = (v, text) => { const s = el('span', 'key'); s.append(chip(v), ' ' + text); return s; };
    k.append(
      key('FARM', 'top decile by net $/hr within this board (q90 = ' + dl(Q90) + '/hr or more), gas ≤ ' + GASCAP + ', p ≥ ' + PMIN),
      key('WATCH', 'at or above the board median net $/hr (q50 = ' + dl(Q50) + '/hr), not FARM'),
      key('SKIP', 'rest'),
    );
    const w = el('span', 'key'); w.append(el('span', 'wdot'), ' watchlist');
    const n = el('span', 'key', 'ranked by implied value desc, ties by slug asc; net $/hr is a column and sets the verdict; $/hr is uncapped, wallet cap $' + P.wallet_cap_usd.toLocaleString('en-US') + '; thresholds are quantiles of this board, computed at build time');
    k.append(w, n);
  })();

  // ---- header and integrity strip
  const watchN = D.rows.filter((r) => r.watch).length;
  $('meta').textContent = 'Snapshot ' + D.as_of + ' · ' + watchN + ' on watchlist + ' + D.early_size + ' early finds below ' + usd(D.floor_usd) + ' TVL · ' + D.live_size + ' live-token protocols excluded · model ' + D.model_version;
  const ratioNote = (x) => (x >= 0.8 && x <= 1.25 ? 'within ±25% of 1.00' : 'off the 1.00 ideal');
  [
    ['Protocols scored', String(I.protocols_scored), 'ranked by implied value, ' + D.watchlist_size + ' on the watchlist', 'Rows on this board'],
    ['Peers used', String(I.peers_used), 'tokenised peers (mcap known)', 'Tokenised, non-CEX protocols behind implied values and the fit; the odds pool is ' + I.pool_size],
    ['Walk-forward', num(I.walk_forward_ratio, 2), 'out-of-sample, ' + I.walk_forward_test + ' newest peers', 'Median predicted ÷ median realised value on the newest 30% by listing date; 1.00 is ideal. p10–p90 covered ' + pc0(I.walk_forward_p10_p90_coverage) + ' of them (80% ideal)'],
    ['Leave-one-out', num(I.leave_one_out_ratio, 2), 'refit without each peer', 'Median predicted ÷ median realised value, each peer predicted from a fit that excluded it; 1.00 is ideal'],
    ['Brier vs base (test)', num(I.brier_stratified_test, 4) + ' vs ' + num(I.brier_base_test, 4), (I.brier_stratified_test < I.brier_base_test ? 'pooled odds beat base rate' : 'pooled odds do not beat base rate') + ', n=' + I.brier_test_n, 'Walk-forward Brier of the stratified, support-pooled odds that drive p(token), trained on the oldest 70% of ' + I.pool_size + ' protocols and scored on the newest 30% (' + I.brier_test_n + ' rows), beside the train base rate. Lower is better. Row odds are these pooled odds; the logistic candidates are scored in the Calibration card.'],
    ['Calibration', I.calib_model + ': ' + num(I.calib_test_brier, 4) + ' vs ' + num(I.calib_base_test, 4), 'test Brier vs base rate, n=' + I.calib_n + (I.calib_model === 'base-rate' ? ' · no logistic beat the base rate' : ''), I.calib_line + '. Validation Briers (chosen inside the training 70%): base ' + num(I.calib_val_briers['base-rate'], 4) + ', plain-3 ' + num(I.calib_val_briers['plain-3'], 4) + ', rich ' + num(I.calib_val_briers.rich, 4) + '. Test Briers, shown for information and not used to choose: plain-3 ' + num(I.brier_plain_test, 4) + ', rich ' + num(I.brier_rich_test, 4) + '.'],
    ['Verdicts', I.verdict_counts.FARM + ' · ' + I.verdict_counts.WATCH + ' · ' + I.verdict_counts.SKIP, 'FARM · WATCH · SKIP, ' + I.verdict_violations + ' violations', RULE_TEXT + '. Quantiles of net $/hr p50 over the ' + D.rows.length + ' rows, computed at build time; the build asserts every row.'],
    ['Odds support', SUP.finest + ' · ' + SUP.category + ' · ' + SUP.global, 'finest · category · global', 'Every p(token) rests on at least ' + P.min_support + ' tokenised peers: a stratum with fewer pools down finest → category → global. Rows per level out of ' + D.rows.length],
  ].forEach(([k, v, c, tip]) => {
    const d = el('div', 'stat');
    d.title = tip;
    d.append(el('span', 'sk', k), el('b', 'sv', v), el('span', 'sc', c));
    $('strip').append(d);
  });
  void ratioNote;

  // ---- integrity view (?view=integrity): the strip in full, plus the support distribution
  function integrityView() {
    document.body.classList.add('view-integrity');
    const box = $('integrity-view');
    box.hidden = false;
    const kids = [el('h2', '', 'Integrity strip')];
    document.querySelectorAll('#strip .stat').forEach((st) => {
      const d = el('div', 'iv-row');
      d.append(el('b', 'iv-k', st.querySelector('.sk').textContent), el('span', 'iv-v', st.querySelector('.sv').textContent + '  ·  ' + st.querySelector('.sc').textContent), el('span', 'iv-t', st.title));
      kids.push(d);
    });
    kids.push(el('h2', '', 'Support distribution · level used across ' + D.rows.length + ' rows'));
    const lv = [['finest', 'category × TVL bucket × age bucket'], ['category', 'whole category'], ['global', 'every non-CEX protocol']];
    lv.forEach(([k, desc]) => {
      const n = SUP[k];
      const d = el('div', 'sup-row');
      const bar = el('span', 'sup-bar');
      const fill = el('i', 'sup-fill sup-' + k);
      fill.style.width = (n / D.rows.length * 100).toFixed(1) + '%';
      bar.append(fill);
      const rs = D.rows.filter((r) => r.support_level === k);
      const med = rs.length ? rs.map((r) => r.peer_tokenised).sort((a, b) => a - b)[rs.length >> 1] : '–';
      d.append(el('b', 'sup-k', k), bar, el('span', 'sup-n', n + ' rows · ' + (n / D.rows.length * 100).toFixed(1) + '%'), el('span', 'sup-d', desc + (rs.length ? ' · median ' + med + ' tokenised peers' : '')));
      kids.push(d);
    });
    kids.push(el('h2', '', 'Calibration · chosen on a validation slice, reported once on test'));
    kids.push(el('p', 'calc rule-line calib-line', I.calib_line));
    kids.push(el('p', 'calc', 'Candidates: base rate, plain logistic (log TVL, age years, 7d change), rich logistic (adds log TVL × age and indicators for the top ' + 6 + ' categories, rest = other). Validation Brier: base ' + num(I.calib_val_briers['base-rate'], 4) + ' · plain-3 ' + num(I.calib_val_briers['plain-3'], 4) + ' · rich ' + num(I.calib_val_briers.rich, 4) + ' (n=' + I.calib_val_n + '). Test Brier for information: plain-3 ' + num(I.brier_plain_test, 4) + ' · rich ' + num(I.brier_rich_test, 4) + ' · base ' + num(I.calib_base_test, 4) + '.'));
    kids.push(el('h2', '', 'Verdict rule · q50 / q90 of net $/hr'));
    kids.push(el('p', 'calc rule-line', RULE_TEXT));
    kids.push(el('p', 'calc', 'Computed at build time from the ' + D.rows.length + ' rows: q50 = ' + dl(Q50) + '/hr, q90 = ' + dl(Q90) + '/hr (linear interpolation). Counts FARM ' + I.verdict_counts.FARM + ' · WATCH ' + I.verdict_counts.WATCH + ' · SKIP ' + I.verdict_counts.SKIP + '. Every row carries its reason, e.g. "farmable", "below q90", "gas $30 over the $25 cap", "p 3% under 5%".'));
    kids.push(el('p', 'calc', 'Rule: an estimate is never taken from a stratum with fewer than ' + P.min_support + ' tokenised peers. The finest stratum is tried first, then the category, then all non-CEX protocols, until at least ' + P.min_support + ' tokenised peers stand behind it. Value range bounds: p10 ≥ ' + P.implied_p10_floor + '× TVL, p90 ≤ ' + P.implied_p90_cap + '× TVL.'));
    box.replaceChildren(...kids);
  }

  // ---- filters
  const uniq = (xs) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
  const fill = (id, values) => values.forEach((v) => { const o = el('option', '', v); o.value = v; $(id).append(o); });
  fill('category', uniq(D.rows.map((r) => r.category).filter(Boolean)));
  fill('chain', uniq(D.rows.flatMap((r) => r.chains)));

  const head = $('head');
  COLS.forEach((c) => {
    const th = el('th');
    if (c.num) th.className = 'num';
    th.scope = 'col';
    const b = el('button');
    b.type = 'button';
    b.append(c.label, el('span', 'arr'));
    b.title = (c.tip ? c.tip + '. ' : '') + 'Sort by ' + c.label;
    b.addEventListener('click', () => {
      if (state.sort === c.key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort = c.key; state.dir = DESC_FIRST.has(c.key) ? 'desc' : 'asc'; }
      render();
    });
    th.append(b);
    th.dataset.key = c.key;
    head.append(th);
  });

  function visible() {
    const q = state.q.trim().toLowerCase();
    const col = COLS.find((c) => c.key === state.sort);
    const out = D.rows.filter((r) =>
      (!q || (r.name + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase().includes(q)) &&
      (!state.category || r.category === state.category) &&
      (!state.chain || r.chains.includes(state.chain)) &&
      (!state.verdict || r.verdict === state.verdict) &&
      (!state.watch || r.watch)
    );
    const sign = state.dir === 'asc' ? 1 : -1;
    out.sort((a, b) => {
      const x = col.val(a), y = col.val(b);
      if (x === null && y === null) return a.rank - b.rank;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sign || a.rank - b.rank;
    });
    return out;
  }

  const stack = (cls, top, sub, title) => {
    const td = el('td', 'num ' + cls);
    td.append(el('div', 'l1', top), el('div', 'l2', sub));
    if (title) td.title = title;
    return td;
  };

  function renderRows(list, shown) {
    const q = state.q.trim().toLowerCase();
    const frag = document.createDocumentFragment();
    list.forEach((r) => {
      const tr = el('tr', r.slug === shown ? 'sel' : '');
      tr.tabIndex = 0;
      tr.dataset.slug = r.slug;
      const rk = el('td', 'num muted', String(r.rank));
      rk.title = 'Rank ' + r.rank + ' by implied value at p50';
      const name = el('td', 'name');
      name.title = r.name + ' — ' + r.why;
      const nm = el('div', 'nm');
      if (r.watch) { const w = el('span', 'w'); w.title = 'On the watchlist'; nm.append(w); }
      nm.append(hl(r.name, q));
      const sub = el('div', 'l2', (r.chains[0] || '–') + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '') + ' · ' + money(r.total_cost_usd) + ' · ' + r.total_hours.toFixed(1) + ' h');
      sub.title = 'Chains: ' + (r.chains.join(', ') || 'none') + '. Farm plan: ' + money(r.total_cost_usd) + ' total cost, ' + r.total_hours.toFixed(2) + ' hours';
      name.append(nm, sub);
      const cat = el('td', 'muted');
      cat.append(hl(r.category || '–', q));
      cat.title = r.category || 'Uncategorised';
      const tvl = el('td', 'num', usd(r.tvl_usd));
      tvl.title = '$' + Math.round(r.tvl_usd).toLocaleString('en-US');
      const chg = el('td', 'num ' + (r.change_7d === null ? 'muted' : r.change_7d >= 0 ? 'up' : 'down'), pct(r.change_7d));
      const age = el('td', 'num muted', ageText(r));
      age.title = r.listed_at ? 'Listed ' + r.listed_at + ', no token since' : 'Listing date unknown';
      const pt = stack('ptok', pc0(r.p_token), ({ finest: 'fine', category: 'cat', global: 'glob' })[r.support_level] + ' ' + r.peer_count + ' · ' + r.peer_tokenised + ' tok', 'p(token) ' + (r.p_token * 100).toFixed(1) + '% — ' + r.support_text + '; finest stratum has ' + r.odds.strata[2].n + ' peers (' + r.odds.strata[2].k + ' tokenised), category ' + r.odds.strata[0].n + ' (' + r.odds.strata[0].k + ')');
      const val = stack('val', usd(r.implied_value_usd), usd(r.implied_p10_usd) + '–' + usd(r.implied_p90_usd), 'p50 ' + usd(r.implied_value_usd) + ', p10–p90 ' + usd(r.implied_p10_usd) + ' – ' + usd(r.implied_p90_usd));
      const hr = stack('hr', usd(r.net_per_hr_p50) + '/hr', 'p10 ' + usd(r.net_per_hr_p10), 'Net p50 $' + r.net_per_hr_p50.toLocaleString('en-US') + '/hr, p10 $' + r.net_per_hr_p10.toLocaleString('en-US') + '/hr; gross p50 $' + r.usd_per_hr_p50.toLocaleString('en-US') + '/hr, gas $' + r.gas_usd);
      if (r.capped) { const cm = el('span', 'capmark', 'wallet cap'); cm.title = 'Expected $ hit the $' + r.wallet_cap_usd.toLocaleString('en-US') + ' per-wallet cap (the only cap; $/hr is not capped).'; hr.querySelector('.l2').append(' ', cm); }
      const vd = el('td');
      vd.append(chip(r.verdict));
      vd.title = r.verdict + ': ' + r.verdict_reason + ' (' + RULE_TEXT + ')';
      tr.append(rk, name, cat, tvl, chg, age, pt, val, hr, vd);
      tr.addEventListener('click', () => open(r.slug));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(r.slug); } });
      frag.append(tr);
    });
    $('rows').replaceChildren(frag);
  }

  function open(slug) {
    state.row = slug;
    writeUrl();
    document.querySelectorAll('#rows tr').forEach((tr) => tr.classList.toggle('sel', tr.dataset.slug === slug));
    renderDetail(rowsBySlug.get(slug));
  }

  // ---- detail
  function table(cls, heads, rows, foot) {
    const t = el('table', 'mini ' + cls);
    const hr = el('tr');
    heads.forEach(([h, c]) => hr.append(el('th', c || '', h)));
    const th = el('thead');
    th.append(hr);
    t.append(th);
    const tb = el('tbody');
    rows.forEach((cells) => {
      const tr = el('tr');
      cells.forEach((c, i) => {
        const td = el('td', heads[i][1] || '');
        if (c instanceof Node) td.append(c); else td.textContent = c;
        tr.append(td);
      });
      tb.append(tr);
    });
    t.append(tb);
    if (foot) {
      const tf = el('tfoot');
      const tr = el('tr');
      foot.forEach((c, i) => tr.append(el('td', heads[i][1] || '', c)));
      tf.append(tr);
      t.append(tf);
    }
    return t;
  }
  const line = (label, text) => { const d = el('div', 'ln'); d.append(el('span', 'lk', label), el('span', 'lv', text)); return d; };

  function nearestPeers(r) {
    const set = D.peer_sets[r.value.peer_key];
    const x = Math.log(r.tvl_usd);
    const members = set.members.map((m) => ({ name: m[0], tvl: m[1], mcap: m[2], d: Math.abs(Math.log(m[1]) - x) })).sort((a, b) => a.d - b.d);
    return { set, shown: members.slice(0, 10) };
  }

  const implied10 = (r, w) => Math.round(r.implied_value_usd / w);
  const implied90 = (r, w) => Math.round(r.implied_value_usd * w);

  function renderDetail(r) {
    const box = $('detail');
    if (!r) { box.replaceChildren(el('h2', '', 'No protocol matches the filters')); return; }
    const V = r.value, O = r.odds, F = D.fit;
    const kids = [];
    const hd = el('div', 'dhead');
    hd.append(el('h2', '', r.name), chip(r.verdict));
    if (r.watch) hd.append(el('span', 'badge', 'watchlist'));
    kids.push(hd);
    kids.push(el('p', 'sub', (r.category || 'Uncategorised') + ' · ' + (r.chains.slice(0, 3).join(', ') || 'no chain') + ' · rank ' + r.rank + ' of ' + D.rows.length + ' by implied value'));

    // bottom line
    const bl = el('div', 'bottom');
    const big = el('div', 'big');
    big.append(el('span', 'n', money(r.net_per_hr_p50) + '/hr net'), el('span', 'l', 'at p50'), el('span', 'n2', money(r.net_per_hr_p10) + '/hr'), el('span', 'l', 'at p10'));
    bl.append(big);
    bl.append(el('p', 'bl', 'Gross ' + money(r.usd_per_hr_p50) + '/hr · gas ' + money(r.gas_usd) + ' · capital at risk ' + money(r.capital_at_risk_usd) + ' · ' + r.total_hours.toFixed(2) + ' h (' + mins(r.farm_total_minutes) + ')'));
    bl.append(el('p', 'calc', 'expected = min(p(token) × implied × capture, wallet cap); net = expected − gas; $/hr = ÷ max(hours, 0.5). No $/hr cap. Wallet cap here: $' + r.wallet_cap_usd.toLocaleString('en-US') + (r.capped ? ' (hit)' : ' (not hit; uncapped expected ' + money(r.expected_usd_raw) + ')') + '. Capture and cap are assumptions, not measurements.'));
    const vr = el('p', 'calc verdict-why');
    vr.append(el('b', '', r.verdict + ': ' + r.verdict_reason), ' — ' + (r.verdict === 'FARM' ? 'net ' + dl(r.net_per_hr_p50) + '/hr ≥ q90 ' + dl(Q90) + ', gas ' + money(r.gas_usd) + ' ≤ ' + GASCAP + ', p ' + pc0(r.p_token) + ' ≥ ' + PMIN + '.' : r.verdict === 'WATCH' ? 'net ' + dl(r.net_per_hr_p50) + '/hr is above q50 ' + dl(Q50) + ' but not FARM. ' : 'net ' + dl(r.net_per_hr_p50) + '/hr is below q50 ' + dl(Q50) + '. ') + (r.verdict === 'FARM' ? '' : RULE_TEXT + '.'));
    bl.append(vr);
    kids.push(bl);
    kids.push(el('h3', '', 'Campaign maths' + (r.capped ? ' · wallet cap hit' : '')));
    const c0 = (x) => money(x);
    kids.push(table('camp', [['Term'], ['p50', 'num'], ['p10', 'num']], [
      ['p(token)', pc0(r.p_token), pc0(r.p_token)],
      ['Implied value', usd(r.implied_value_usd), usd(r.implied_p10_usd)],
      ['Capture', (r.capture * 10000).toFixed(0) + ' bps', (r.capture * 10000).toFixed(0) + ' bps'],
      ['Wallet cap ($' + r.wallet_cap_usd.toLocaleString('en-US') + ') applied', r.capped ? 'yes' : 'no', r.expected_usd_p10 >= r.wallet_cap_usd ? 'yes' : 'no'],
      ['Expected $ (gross)', c0(r.expected_usd_p50), c0(r.expected_usd_p10)],
      ['− Gas', c0(r.gas_usd), c0(r.gas_usd)],
      ['= Net $', c0(r.net_usd_p50), c0(r.net_usd_p10)],
      ['Hours (floor 0.5)', Math.max(r.total_hours, 0.5).toFixed(2), Math.max(r.total_hours, 0.5).toFixed(2)],
      ['Gross $/hr', c0(r.usd_per_hr_p50), c0(r.usd_per_hr_p10)],
      ['Net $/hr', c0(r.net_per_hr_p50), c0(r.net_per_hr_p10)],
      ['Capital at risk', c0(r.capital_at_risk_usd), c0(r.capital_at_risk_usd)],
    ], ['Deposits come back on exit; not subtracted from net. Bridge fees ' + c0(r.bridge_usd) + ' not counted as gas.', '', '']));

    // token odds
    kids.push(el('h3', '', 'Token odds · p(token) ' + (r.p_token * 100).toFixed(1) + '%'));
    const sup = el('p', 'support ' + r.support_level);
    sup.append(el('b', '', r.support_text));
    kids.push(sup);
    kids.push(table('odds', [['Nested stratum'], ['Peers', 'num'], ['Tokenised', 'num'], ['Rate', 'num']],
      [['all non-CEX protocols', String(O.global.n), String(O.global.k), pc0(O.global.rate)]].concat(O.strata.map((s) => [s.label, String(s.n), String(s.k), s.n ? pc0(s.rate) : '–']))));
    kids.push(el('p', 'calc', 'Category rate, Laplace (k+1)/(n+2) = ' + pc0(O.p_category) + ' → with TVL stratum, shrunk toward it (k + ' + P.shrink_m + '·prior)/(n + ' + P.shrink_m + ') = ' + pc0(O.p_tvl) + ' → with age stratum = ' + pc0(O.p_age) + '. Used: ' + r.support_level + ' level, because a stratum needs ≥ ' + P.min_support + ' tokenised peers' + (r.support_level === 'finest' ? ' and the finest has ' + O.strata[2].k : r.support_level === 'category' ? '; the finest has only ' + O.strata[2].k + ' and the category has ' + O.strata[0].k : '; the finest has ' + O.strata[2].k + ' and the category ' + O.strata[0].k) + '. p(token) = ' + pc0(O.p) + (O.clipped ? ' after clipping to ' + pc0(P.p_min) + '–' + pc0(P.p_max) : '') + '. This protocol is excluded from its own peers.'));

    // implied value maths
    kids.push(el('h3', '', 'Implied value · ' + usd(r.implied_value_usd) + ' (' + mult(r.multiple) + ' TVL)'));
    const tr = el('div', 'trace');
    [['TVL', usd(r.tvl_usd)], ['×', ''], ['cat median', mult(V.category_median)], ['×', ''], ['growth', '×' + V.growth_factor.toFixed(2)], ['×', ''], ['age', '×' + V.age_factor.toFixed(2)], ['=', ''], ['multiple', mult(V.raw_multiple) + (V.clipped ? ' → ' + mult(r.multiple) : '')]].forEach(([k, v]) => {
      if (!v) tr.append(el('span', 'op', k));
      else { const t = el('div', 'term'); t.append(el('span', 'tl', k), el('b', 'tv', v)); tr.append(t); }
    });
    kids.push(tr);
    kids.push(el('p', 'calc', 'Median of mcap/TVL over ' + V.peer_n + ' ' + (V.peer_key === '*' ? 'tokenised peers (all categories: the category has under ' + P.min_peers + ')' : V.peer_key + ' peers') + '. Multiple clipped to ' + P.multiple_min + '–' + P.multiple_max + '× TVL' + (V.clipped ? '; this one was clipped.' : '; this one was inside.')));

    // range maths
    const w = Math.exp(V.z * V.sigma_eff);
    kids.push(el('h3', '', 'Range maths · p10 ' + usd(r.implied_p10_usd) + ' – p90 ' + usd(r.implied_p90_usd)));
    kids.push(line('σ peers', V.sigma.toFixed(3) + ' = 1.4826 × MAD of ln(mcap/TVL), ' + V.peer_n + ' peers'));
    kids.push(line('σ widened', V.sigma.toFixed(3) + ' × √(1 + ' + P.widen_k + '/' + V.peer_n + ') = ' + V.sigma_eff.toFixed(3)));
    kids.push(line('half-width', 'z ' + V.z + ' × σ = ' + (V.z * V.sigma_eff).toFixed(3) + ' in log terms: ÷' + w.toFixed(2) + ' to ×' + w.toFixed(2)));
    kids.push(line('range', usd(r.implied_value_usd) + ' ÷ ' + w.toFixed(2) + ' = ' + usd(implied10(r, w)) + ' · × ' + w.toFixed(2) + ' = ' + usd(implied90(r, w))));
    kids.push(line('bounds', 'p10 ≥ ' + P.implied_p10_floor + '× TVL (' + usd(r.tvl_usd * P.implied_p10_floor) + '), p90 ≤ ' + P.implied_p90_cap + '× TVL (' + usd(r.tvl_usd * P.implied_p90_cap) + ')' + (r.p10_clamped ? '; p10 was clamped up' : '') + (r.p90_clamped ? '; p90 was clamped down' : '') + (r.p10_clamped || r.p90_clamped ? '' : '; neither bound bit here')));

    // coefficients
    kids.push(el('h3', '', 'Coefficients · fit on ' + F.n + ' tokenised peers'));
    kids.push(line('growth b', num(F.b_growth) + ' on ln(1 + 7d change), centred at ' + num(F.mean_growth) + '; factor bounded ' + P.growth_min + '–' + P.growth_max));
    kids.push(line('age b', num(F.b_age) + ' on min(days, ' + P.age_saturation_days + ')/' + P.age_saturation_days + ', centred at ' + num(F.mean_age)));
    kids.push(line('fit R²', num(F.r2) + ' on ln(mcap/TVL ÷ category median); low means growth and age explain little'));
    const cm = D.categories[r.category || 'Uncategorised'];
    kids.push(line('category', cm ? (r.category + ': median ' + mult(cm.median) + ', σ ' + cm.sigma.toFixed(2) + ', ' + cm.n + ' peers') : 'no tokenised peers: global median ' + mult(D.global.median)));

    // peers
    const np = nearestPeers(r);
    kids.push(el('h3', '', 'Peer table · ' + np.shown.length + ' nearest by TVL of ' + np.set.n + (V.peer_key === '*' ? ' (all categories)' : ' ' + V.peer_key)));
    kids.push(table('peers', [['Peer'], ['TVL', 'num'], ['Mcap', 'num'], ['Mcap/TVL', 'num']],
      np.shown.map((m) => [m.name, usd(m.tvl), usd(m.mcap), mult(m.mcap / m.tvl)]),
      ['Median of all ' + np.set.n, '', '', mult(np.set.median)]));

    // steps
    let dep = 0, gas = 0, br = 0, time = 0;
    r.steps.forEach((s) => { dep += s.deposit_usd; gas += s.gas_usd; br += s.bridge_usd; time += s.minutes; });
    kids.push(el('h3', '', 'Costed steps · ' + r.steps.length + ' · ' + money(r.total_cost_usd) + ' · ' + mins(time)));
    const costOf = (s) => [s.deposit_usd > 0 ? money(s.deposit_usd) + ' dep' : '', s.gas_usd > 0 ? money(s.gas_usd) + ' gas' : '', s.bridge_usd > 0 ? money(s.bridge_usd) + ' bridge' : ''].filter(Boolean).join(' + ') || '$0';
    kids.push(table('farm', [['Action'], ['Cost', 'num'], ['Time', 'num'], ['Risk', 'rk']],
      r.steps.map((s) => { const p = el('span', 'pill ' + s.risk.toLowerCase(), s.risk); return [s.action, costOf(s), mins(s.minutes), p]; }),
      ['Total · capital at risk comes back on exit', money(dep) + ' capital at risk + ' + money(gas) + ' gas + ' + money(br) + ' bridge = ' + money(dep + gas + br), mins(time), '']));
    const note = el('div', 'risknote');
    note.append(el('b', '', 'Risk note'), el('span', '', r.risk_note));
    kids.push(note);
    box.replaceChildren(...kids);
    box.scrollTop = 0;
  }

  function render() {
    $('q').value = state.q;
    $('category').value = state.category;
    $('chain').value = state.chain;
    $('verdict').value = state.verdict;
    $('watch').checked = state.watch;
    head.querySelectorAll('th').forEach((th) => {
      th.setAttribute('aria-sort', th.dataset.key === state.sort ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    });
    const list = visible();
    const shown = rowsBySlug.get(state.row) || list[0];
    renderRows(list, shown ? shown.slug : '');
    const counts = { FARM: 0, WATCH: 0, SKIP: 0 };
    list.forEach((r) => counts[r.verdict]++);
    $('count').textContent = 'Showing ' + list.length + ' of ' + D.rows.length + ' · ' + counts.FARM + ' FARM · ' + counts.WATCH + ' WATCH · ' + counts.SKIP + ' SKIP';
    $('empty').hidden = list.length > 0;
    writeUrl();
    renderDetail(shown);
  }

  $('q').addEventListener('input', (e) => { state.q = e.target.value; render(); });
  ['category', 'chain', 'verdict'].forEach((k) => $(k).addEventListener('change', (e) => { state[k] = e.target.value; render(); }));
  $('watch').addEventListener('change', (e) => { state.watch = e.target.checked; render(); });
  $('reset').addEventListener('click', () => {
    Object.assign(state, { sort: 'rank', dir: 'asc', q: '', category: '', chain: '', verdict: '', watch: false, row: '' });
    render();
  });

  const wantIntegrity = new URLSearchParams(location.search).get('view') === 'integrity';
  const focusMaths = new URLSearchParams(location.search).get('focus') === 'maths';
  readUrl();
  render();
  if (wantIntegrity) integrityView();
  if (focusMaths) {
    const h = [...document.querySelectorAll('#detail h3')].find((n) => n.textContent.indexOf('Campaign maths') === 0);
    if (h) $('detail').scrollTop = h.offsetTop - $('detail').offsetTop - 6;
  }
  const sel = document.querySelector('#rows tr.sel');
  if (sel) sel.scrollIntoView({ block: 'center' });
})();
