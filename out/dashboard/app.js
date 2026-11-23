'use strict';
// Token Radar page: reads window.RADAR (data.js), no network. State lives in the URL:
//   ?row=<slug>  open a row   ?q=  search   ?category=  ?chain=  ?watch=1  ?sort=<col>&dir=asc|desc
(function () {
  const D = window.RADAR;
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
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  };
  const pct = (n) => (n === null || n === undefined ? '–' : (n > 0 ? '+' : '') + (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1)) + '%');
  const ageText = (r) => {
    if (!r.age_known) return 'n/a';
    const d = r.age_days;
    return d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d';
  };
  const mins = (m) => (m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min');
  const money = (n) => (n >= 10 ? '$' + Math.round(n) : '$' + (Math.round(n * 100) / 100));

  const COLS = [
    { key: 'rank', label: 'Rank', num: true, val: (r) => r.rank },
    { key: 'name', label: 'Protocol', val: (r) => r.name.toLowerCase() },
    { key: 'category', label: 'Category', val: (r) => (r.category || '').toLowerCase() },
    { key: 'chain', label: 'Chain', val: (r) => (r.chains[0] || '').toLowerCase() },
    { key: 'tvl', label: 'TVL', num: true, val: (r) => r.tvl_usd },
    { key: 'change', label: '7d', num: true, val: (r) => r.change_7d },
    { key: 'age', label: 'No token since listing', num: true, val: (r) => (r.age_known ? r.age_days : null) },
    { key: 'value', label: 'Implied value', num: true, val: (r) => r.implied_value_usd },
  ];

  const state = { sort: 'rank', dir: 'asc', q: '', category: '', chain: '', watch: false, row: '' };
  const rowsBySlug = new Map(D.rows.map((r) => [r.slug, r]));

  function readUrl() {
    const p = new URLSearchParams(location.search);
    state.q = p.get('q') || '';
    state.category = p.get('category') || '';
    state.chain = p.get('chain') || '';
    state.watch = p.get('watch') === '1';
    state.row = p.get('row') || '';
    const s = p.get('sort');
    if (COLS.some((c) => c.key === s)) state.sort = s;
    state.dir = p.get('dir') === 'desc' ? 'desc' : state.sort === 'value' ? 'desc' : 'asc';
    if (p.get('sort') && !p.get('dir') && state.sort !== 'value') state.dir = 'asc';
  }
  function writeUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category) p.set('category', state.category);
    if (state.chain) p.set('chain', state.chain);
    if (state.watch) p.set('watch', '1');
    if (state.row) p.set('row', state.row);
    if (state.sort !== 'rank' || state.dir !== 'asc') { p.set('sort', state.sort); p.set('dir', state.dir); }
    const qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }

  // ---- header and legend
  const watchN = D.rows.filter((r) => r.watch).length;
  $('meta').replaceChildren(
    ...[
      ['', 'Snapshot ' + D.as_of],
      ['b', D.board_size + ' protocols'],
      ['', watchN + ' on watchlist + ' + D.early_size + ' early finds below ' + usd(D.floor_usd) + ' TVL'],
      ['', D.live_size + ' live-token protocols excluded'],
      ['', 'model ' + D.model_version],
    ].map(([t, s], i) => {
      const span = el('span');
      if (i) span.append(' · ');
      const inner = t ? el('b', '', s) : document.createTextNode(s);
      span.append(inner);
      return span;
    })
  );
  const P = D.params;
  // Grouped by multiplier, straight from D.category_multiplier (categories present on the board).
  function multGroups() {
    const by = new Map();
    Object.entries(D.category_multiplier).forEach(([k, v]) => { if (!by.has(v)) by.set(v, []); by.get(v).push(k); });
    return [...by.entries()].sort((a, b) => b[0] - a[0]).map(([v, ks]) =>
      '×' + v.toFixed(2) + ' ' + (v === D.category_default ? 'all other categories (' + ks.length + ')' : ks.join(', '))
    );
  }
  const legend = [
    ['--cat', 'category', 'what the market pays for the business: ' + multGroups().join('; ')],
    ['--gro', 'growth', '7-day change compounded to ' + P.outlook_days + ' days, damped (^' + P.growth_damping + '), kept in ' + P.growth_min + '–' + P.growth_max],
    ['--age', 'age', P.age_floor + ' on listing day rising to ' + (P.age_floor + P.age_range) + ' at ' + (P.age_saturation_days / 365).toFixed(0) + ' years with no token'],
    ['--thin', 'thin', P.thin_discount + ' when TVL is under ' + usd(P.thin_tvl_usd)],
  ];
  $('legend-terms').replaceChildren(
    ...legend.map(([v, name, text]) => {
      const li = el('li');
      li.style.setProperty('--k', 'var(' + v + ')');
      li.append(el('b', '', name + ' '), text);
      return li;
    })
  );

  // ---- filters
  const uniq = (xs) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
  const fill = (id, values) => values.forEach((v) => { const o = el('option', '', v); o.value = v; $(id).append(o); });
  fill('category', uniq(D.rows.map((r) => r.category).filter(Boolean)));
  fill('chain', uniq(D.rows.flatMap((r) => r.chains)));

  // ---- table head
  const head = $('head');
  COLS.forEach((c) => {
    const th = el('th');
    if (c.num) th.className = 'num';
    th.scope = 'col';
    const b = el('button');
    b.type = 'button';
    b.append(c.label, el('span', 'arr'));
    b.title = 'Sort by ' + c.label;
    b.addEventListener('click', () => {
      if (state.sort === c.key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort = c.key; state.dir = c.num && c.key !== 'rank' ? 'desc' : 'asc'; }
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

  function cell(tag, cls, text) { return el(tag, cls, text); }

  const maxRatio = Math.max(...D.rows.map((r) => (r.tvl_usd > 0 ? r.implied_value_usd / r.tvl_usd : 0)), 1);
  function valCell(r) {
    const td = el('td', 'num val');
    const top = el('div', 'vtop');
    if (r.f.thin < 1) {
      const g = el('span', 'warn', '⚠');
      g.title = 'Thin-TVL discount applied (TVL under ' + usd(D.params.thin_tvl_usd) + ', ×' + r.f.thin.toFixed(2) + ')';
      g.setAttribute('role', 'img');
      g.setAttribute('aria-label', 'thin TVL discount');
      top.append(g);
    }
    top.append(el('span', 'chip', '±' + r.band_pct + '%'), el('span', 'vnum', usd(r.implied_value_usd)));
    const ratio = r.tvl_usd > 0 ? r.implied_value_usd / r.tvl_usd : 0;
    const bar = el('div', 'ratio');
    bar.title = 'implied value / TVL = ' + ratio.toFixed(2) + '×';
    const fill = el('i');
    fill.style.width = Math.min(100, (ratio / maxRatio) * 100).toFixed(1) + '%';
    bar.append(fill);
    td.append(top, bar);
    return td;
  }

  function renderRows(list) {
    const tb = $('rows');
    const frag = document.createDocumentFragment();
    list.forEach((r) => {
      const tr = el('tr', r.slug === state.row ? 'sel' : '');
      tr.tabIndex = 0;
      tr.dataset.slug = r.slug;
      const name = cell('td', 'name', r.name);
      name.title = r.name;
      if (r.watch) { const w = el('span', 'w'); w.title = 'On the watchlist'; w.setAttribute('role', 'img'); w.setAttribute('aria-label', 'On the watchlist'); name.prepend(w); }
      const ch = r.chains.length > 1 ? r.chains[0] + ' +' + (r.chains.length - 1) : r.chains[0] || '–';
      const chg = cell('td', 'num ' + (r.change_7d === null ? 'muted' : r.change_7d >= 0 ? 'up' : 'down'), pct(r.change_7d));
      chg.title = r.change_7d === null ? 'No 7-day change in the snapshot' : '7-day TVL change ' + pct(r.change_7d);
      const catTd = cell('td', 'muted', r.category || '–');
      catTd.title = (r.category || 'Uncategorised') + ' · ×' + r.f.category.toFixed(2);
      const chTd = cell('td', 'muted', ch);
      chTd.title = r.chains.join(', ') || 'no chain';
      const ageTd = cell('td', 'num muted', ageText(r));
      ageTd.title = r.age_known ? 'Listed ' + r.listed_at + ', no token since (' + r.age_days + ' days)' : 'Listing date unknown';
      const tvlTd = cell('td', 'num', usd(r.tvl_usd));
      tvlTd.title = '$' + Math.round(r.tvl_usd).toLocaleString('en-US');
      tr.append(cell('td', 'num muted', String(r.rank)), name, catTd, chTd, tvlTd, chg, ageTd, valCell(r));
      tr.addEventListener('click', () => open(r.slug));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(r.slug); } });
      frag.append(tr);
    });
    tb.replaceChildren(frag);
  }

  function open(slug) {
    state.row = state.row === slug ? '' : slug;
    writeUrl();
    document.querySelectorAll('#rows tr').forEach((tr) => tr.classList.toggle('sel', tr.dataset.slug === state.row));
    renderDetail();
  }

  function factor(k, name, value, why) {
    const f = el('div', 'fac');
    f.style.setProperty('--k', 'var(' + k + ')');
    f.append(el('div', 'k', name), el('div', 'v', '×' + value.toFixed(2)), el('div', 'why', why));
    return f;
  }

  function renderDetail() {
    const box = $('detail');
    const r = rowsBySlug.get(state.row);
    box.className = 'detail' + (r ? '' : ' hint');
    if (!r) {
      const h = el('h2', '', 'Select a protocol');
      const p = el('p', '', 'Click any row to see its four factors, the confidence band and a farm plan with cost and time per step.');
      const h3 = el('h3', '', 'Category multipliers');
      const dl = el('dl', 'mults');
      Object.entries(D.category_multiplier).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).filter(([, v]) => v !== D.category_default)
        .forEach(([k, v]) => dl.append(el('dt', '', k), el('dd', '', '×' + v.toFixed(2))));
      const nOther = Object.values(D.category_multiplier).filter((v) => v === D.category_default).length;
      dl.append(el('dt', '', 'Other (' + nOther + ' categories)'), el('dd', '', '×' + D.category_default.toFixed(2)));
      const note = el('p', '', 'The board is the whole watchlist plus the largest protocols below ' + usd(D.floor_usd) + ' TVL that still have no token. Values are model estimates, not prices.');
      box.replaceChildren(h, p, h3, dl, note);
      return;
    }
    const kids = [];
    kids.push(el('h2', '', r.name));
    kids.push(el('p', 'sub', '#' + r.rank + ' · ' + (r.category || 'Uncategorised') + ' · ' + r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + (r.watch ? ' · watchlist' : '')));

    const big = el('div', 'big');
    big.append(el('span', 'n', usd(r.implied_value_usd)), el('span', 'l', 'implied value'), el('span', 'chip', '±' + r.band_pct + '%'), el('span', 'rangeTxt', usd(r.band_low_pct_usd) + ' – ' + usd(r.band_high_pct_usd)));
    kids.push(big);

    const span = r.band_high_pct_usd - r.band_low_pct_usd;
    const band = el('div', 'band');
    const bar = el('div', 'bar');
    const rng = el('div', 'rng');
    rng.style.left = '0%'; rng.style.right = '0%';
    const mid = el('div', 'mid');
    mid.style.left = ((r.implied_value_usd - r.band_low_pct_usd) / span * 100).toFixed(1) + '%';
    bar.append(rng, mid);
    const lab = el('div', 'lab');
    lab.append(el('span', '', 'low ' + usd(r.band_low_pct_usd)), el('span', '', '±' + r.band_pct + '% · ' + (r.band_pct === 15 ? 'thin TVL' : 'TVL ≥ ' + usd(D.params.thin_tvl_usd))), el('span', '', 'high ' + usd(r.band_high_pct_usd)));
    band.append(bar, lab);
    kids.push(band);

    kids.push(el('h3', '', 'Four factors'));
    const fs = el('div', 'factors');
    fs.append(
      factor('--cat', 'Category', r.f.category, r.category || 'no category'),
      factor('--gro', 'Growth', r.f.growth, pct(r.change_7d) + ' in 7d → ' + pct(r.outlook_90d_pct) + ' in 90d, damped'),
      factor('--age', 'Age', r.f.age, r.age_known ? ageText(r) + ' with no token' : 'listing date unknown, 1 y assumed'),
      factor('--thin', 'Thin TVL', r.f.thin, r.f.thin < 1 ? 'TVL under ' + usd(D.params.thin_tvl_usd) : 'TVL ' + usd(r.tvl_usd) + ', no discount')
    );
    kids.push(fs);
    const eq = el('p', 'eq');
    eq.append(el('b', '', usd(r.tvl_usd)), ' × ' + r.f.category.toFixed(2) + ' × ' + r.f.growth.toFixed(2) + ' × ' + r.f.age.toFixed(2) + ' × ' + r.f.thin.toFixed(2) + ' = ', el('b', '', usd(r.implied_value_usd)));
    kids.push(eq);

    kids.push(el('h3', '', 'Farm plan · ' + r.steps.length + ' steps'));
    const t = el('table', 'farm');
    const thead = el('thead');
    const hr = el('tr');
    [['#', ''], ['Action', ''], ['Cost', 'num'], ['Time', 'num']].forEach(([h, c]) => hr.append(el('th', c, h)));
    thead.append(hr);
    const tbody = el('tbody');
    let cost = 0, time = 0;
    r.steps.forEach((s, i) => {
      const total = s.capital_usd + s.gas_usd;
      cost += total; time += s.minutes;
      const tr = el('tr');
      const costText = s.capital_usd > 0 ? money(s.capital_usd) + ' + ' + money(s.gas_usd) + ' gas' : s.gas_usd > 0 ? 'gas only ' + money(s.gas_usd) : '$0';
      tr.append(el('td', 'i', String(i + 1)), el('td', '', s.action), el('td', 'c', costText), el('td', 't', mins(s.minutes)));
      tbody.append(tr);
    });
    const foot = el('tfoot');
    const fr = el('tr');
    const gasTotal = r.steps.reduce((a, s) => a + s.gas_usd, 0);
    const capTotal = r.steps.reduce((a, s) => a + s.capital_usd, 0);
    fr.append(el('td', ''), el('td', '', 'Total · deposits are returned on exit'), el('td', 'c', money(capTotal) + ' + ' + money(gasTotal)), el('td', 't', mins(time)));
    foot.append(fr);
    t.append(thead, tbody, foot);
    kids.push(t);
    box.replaceChildren(...kids);
    box.scrollTop = 0;
  }

  function render() {
    $('q').value = state.q;
    $('category').value = state.category;
    $('chain').value = state.chain;
    $('watch').checked = state.watch;
    head.querySelectorAll('th').forEach((th) => {
      th.setAttribute('aria-sort', th.dataset.key === state.sort ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    });
    const list = visible();
    renderRows(list);
    $('count').textContent = 'Showing ' + list.length + ' of ' + D.rows.length;
    $('empty').hidden = list.length > 0;
    writeUrl();
    renderDetail();
  }

  $('q').addEventListener('input', (e) => { state.q = e.target.value; render(); });
  $('category').addEventListener('change', (e) => { state.category = e.target.value; render(); });
  $('chain').addEventListener('change', (e) => { state.chain = e.target.value; render(); });
  $('watch').addEventListener('change', (e) => { state.watch = e.target.checked; render(); });
  $('reset').addEventListener('click', () => {
    Object.assign(state, { sort: 'rank', dir: 'asc', q: '', category: '', chain: '', watch: false, row: '' });
    render();
  });

  readUrl();
  render();
  const sel = document.querySelector('#rows tr.sel');
  if (sel) sel.scrollIntoView({ block: 'center' });
})();
