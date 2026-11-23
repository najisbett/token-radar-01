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
  const mult = (n) => n.toFixed(2) + '×';
  const ageText = (r) => {
    if (!r.age_known) return 'n/a';
    const d = r.age_days;
    return d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d';
  };
  const mins = (m) => (m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min');
  const money = (n) => (n >= 10 ? '$' + Math.round(n) : '$' + (Math.round(n * 100) / 100));
  const median = (xs) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const COLS = [
    { key: 'rank', label: 'Rank', num: true, val: (r) => r.rank },
    { key: 'name', label: 'Protocol', val: (r) => r.name.toLowerCase() },
    { key: 'category', label: 'Category', val: (r) => (r.category || '').toLowerCase() },
    { key: 'chain', label: 'Chain', val: (r) => (r.chains[0] || '').toLowerCase() },
    { key: 'tvl', label: 'TVL', num: true, val: (r) => r.tvl_usd },
    { key: 'change', label: '7d', num: true, val: (r) => r.change_7d },
    { key: 'age', label: 'No token', num: true, tip: 'Time listed with no token', val: (r) => (r.age_known ? r.age_days : null) },
    { key: 'ready', label: 'Readiness', num: true, tip: 'Launch readiness, 0–100', val: (r) => r.readiness.score },
    { key: 'multiple', label: 'Multiple', num: true, tip: 'Implied value as a multiple of TVL', val: (r) => r.multiple },
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
    state.dir = p.get('dir') === 'desc' ? 'desc' : p.get('dir') === 'asc' ? 'asc' : state.sort === 'value' ? 'desc' : 'asc';
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

  // Text with the search match wrapped in <mark>.
  function hl(text, q) {
    const frag = document.createDocumentFragment();
    const i = q ? text.toLowerCase().indexOf(q) : -1;
    if (i < 0) { frag.append(text); return frag; }
    frag.append(text.slice(0, i), el('mark', '', text.slice(i, i + q.length)), text.slice(i + q.length));
    return frag;
  }

  // ---- header
  const watchN = D.rows.filter((r) => r.watch).length;
  $('meta').replaceChildren(
    ...[
      ['', 'Snapshot ' + D.as_of],
      ['b', watchN + ' on watchlist + ' + D.early_size + ' early finds below ' + usd(D.floor_usd) + ' TVL'],
      ['', D.live_size + ' live-token protocols excluded'],
      ['', 'model ' + D.model_version],
    ].map(([t, s], i) => {
      const span = el('span');
      if (i) span.append(' · ');
      span.append(t ? el('b', '', s) : document.createTextNode(s));
      return span;
    })
  );
  const P = D.params;

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
    b.title = (c.tip ? c.tip + '. ' : '') + 'Sort by ' + c.label;
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

  // ---- stat strip (over the rows shown)
  function renderStrip(list) {
    const growing = list.filter((r) => r.change_7d !== null && r.change_7d > 0).length;
    const items = [
      ['Protocols scored', String(list.length), list.length === D.rows.length ? 'every row on the board' : 'of ' + D.rows.length + ' on the board'],
      ['Watchlist', String(list.filter((r) => r.watch).length), 'of ' + D.watchlist_size + ' watched'],
      ['Median multiple', list.length ? mult(median(list.map((r) => r.multiple))) : '–', 'implied value / TVL'],
      ['Growing', list.length ? Math.round((growing / list.length) * 100) + '%' : '–', 'share with TVL up over 7d'],
    ];
    $('strip').replaceChildren(
      ...items.map(([k, v, c]) => {
        const d = el('div', 'stat');
        d.append(el('span', 'sk', k), el('b', 'sv', v), el('span', 'sc', c));
        return d;
      })
    );
  }

  const maxRatio = Math.max(...D.rows.map((r) => r.multiple), 1);
  function valCell(r) {
    const td = el('td', 'num val');
    const top = el('div', 'vtop');
    if (r.f.thin < 1) {
      const g = el('span', 'warn', '⚠');
      g.title = 'Thin-TVL discount applied (TVL under ' + usd(P.thin_tvl_usd) + ', ×' + r.f.thin.toFixed(2) + ')';
      g.setAttribute('role', 'img');
      g.setAttribute('aria-label', 'thin TVL discount');
      top.append(g);
    }
    top.append(el('span', 'chip', '±' + r.band_pct + '%'), el('span', 'vnum', usd(r.implied_value_usd)));
    const bar = el('div', 'ratio');
    bar.title = 'implied value / TVL = ' + r.multiple.toFixed(2) + '×';
    const f = el('i');
    f.style.width = Math.min(100, (r.multiple / maxRatio) * 100).toFixed(1) + '%';
    bar.append(f);
    td.append(top, bar);
    td.title = 'Implied ' + usd(r.implied_value_usd) + ', band ' + usd(r.band_low_pct_usd) + ' – ' + usd(r.band_high_pct_usd);
    return td;
  }

  function readyCell(r) {
    const td = el('td', 'num ready');
    const s = r.readiness.score;
    const row = el('div', 'rrow');
    const bar = el('div', 'rbar');
    const f = el('i');
    f.style.width = s + '%';
    bar.append(f);
    row.append(bar, el('span', 'rn', String(s)));
    td.append(row);
    td.title = 'Launch readiness ' + s + '/100: age ' + r.readiness.age_pts + '/40, growth persistence ' + r.readiness.persistence_pts + '/30, TVL durability ' + r.readiness.durability_pts + '/30';
    return td;
  }

  function renderRows(list) {
    const q = state.q.trim().toLowerCase();
    const tb = $('rows');
    const frag = document.createDocumentFragment();
    list.forEach((r) => {
      const tr = el('tr', r.slug === state.row ? 'sel' : '');
      tr.tabIndex = 0;
      tr.dataset.slug = r.slug;

      const name = el('td', 'name');
      name.title = r.name + ' — ' + r.why;
      const nm = el('div', 'nm');
      if (r.watch) { const w = el('span', 'w'); w.title = 'On the watchlist'; w.setAttribute('role', 'img'); w.setAttribute('aria-label', 'On the watchlist'); nm.append(w); }
      nm.append(hl(r.name, q));
      const FN = { category: 'category', growth: 'growth', age: 'age', thin: 'thin TVL' };
      const sw = el('div', 'why');
      sw.append(el('span', 'u', '▲'), ' ' + FN[r.driver] + ' ×' + r.f[r.driver].toFixed(2) + '  ');
      sw.append(el('span', 'd', '▼'), r.f[r.drag] < 1 ? ' ' + FN[r.drag] + ' ×' + r.f[r.drag].toFixed(2) : ' no drag');
      name.append(nm, sw);

      const catTd = el('td', 'muted');
      catTd.append(hl(r.category || '–', q));
      catTd.title = (r.category || 'Uncategorised') + ' · ×' + r.f.category.toFixed(2);
      const ch0 = r.chains[0] || '–';
      const chTd = el('td', 'muted');
      chTd.append(hl(ch0, q));
      if (r.chains.length > 1) chTd.append(' +' + (r.chains.length - 1));
      chTd.title = r.chains.join(', ') || 'no chain';
      const chg = el('td', 'num ' + (r.change_7d === null ? 'muted' : r.change_7d >= 0 ? 'up' : 'down'), pct(r.change_7d));
      chg.title = r.change_7d === null ? 'No 7-day change in the snapshot' : '7-day TVL change ' + pct(r.change_7d);
      const ageTd = el('td', 'num muted', ageText(r));
      ageTd.title = r.age_known ? 'Listed ' + r.listed_at + ', no token since (' + r.age_days + ' days)' : 'Listing date unknown';
      const tvlTd = el('td', 'num', usd(r.tvl_usd));
      tvlTd.title = '$' + Math.round(r.tvl_usd).toLocaleString('en-US');
      const mTd = el('td', 'num mult', mult(r.multiple));
      mTd.title = 'Implied value ' + usd(r.implied_value_usd) + ' / TVL ' + usd(r.tvl_usd);
      const rk = el('td', 'num muted', String(r.rank));
      rk.title = 'Rank ' + r.rank + ' by implied value';

      tr.append(rk, name, catTd, chTd, tvlTd, chg, ageTd, readyCell(r), mTd, valCell(r));
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

  // ---- detail
  function term(k, label, text, note) {
    const t = el('div', 'term');
    t.style.setProperty('--k', 'var(' + k + ')');
    t.append(el('span', 'tl', label), el('b', 'tv', text), el('span', 'tn', note || ''));
    if (note) t.title = label + ' ' + text + ': ' + note;
    return t;
  }
  function op(s) { return el('span', 'op', s); }

  function factor(k, name, value, why) {
    const f = el('div', 'fac');
    f.style.setProperty('--k', 'var(' + k + ')');
    f.title = name + ' ×' + value.toFixed(2) + ': ' + why;
    f.append(el('div', 'k', name), el('div', 'v', '×' + value.toFixed(2)), el('div', 'why', why));
    return f;
  }

  const RISK_TIP = {
    Low: 'Low: no money moves, or a read-only step',
    Med: 'Medium: capital is deposited or a position changes',
    High: 'High: leverage, a lock, a loan or an extra-risky venue',
  };

  function renderDetail() {
    const box = $('detail');
    const r = rowsBySlug.get(state.row);
    box.className = 'detail' + (r ? '' : ' hint');
    if (!r) {
      const kids = [el('h2', '', 'Select a protocol')];
      kids.push(el('p', 'lead', 'Click any row for the formula trace with the actual numbers, a readiness breakdown, and a farm table with cost, time and risk per step.'));
      kids.push(el('h3', '', 'The four factors'));
      const dl = el('dl', 'mults');
      const groups = new Map();
      Object.entries(D.category_multiplier).forEach(([k, v]) => { if (!groups.has(v)) groups.set(v, []); groups.get(v).push(k); });
      const cat = [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([v, ks]) => '×' + v.toFixed(2) + ' ' + (v === D.category_default ? 'all other categories (' + ks.length + ')' : ks.join(', '))).join('; ');
      [
        ['--cat', 'category', cat],
        ['--gro', 'growth', '7d change compounded to ' + P.outlook_days + ' days, damped (^' + P.growth_damping + '), kept in ' + P.growth_min + '–' + P.growth_max],
        ['--age', 'age', P.age_floor + ' on listing day, rising to ' + (P.age_floor + P.age_range) + ' at ' + Math.round(P.age_saturation_days / 365) + ' years with no token'],
        ['--thin', 'thin', P.thin_discount + ' when TVL is under ' + usd(P.thin_tvl_usd)],
      ].forEach(([k, n, t]) => {
        const li = el('div', 'rule');
        li.style.setProperty('--k', 'var(' + k + ')');
        li.append(el('b', '', n), el('span', '', t));
        kids.push(li);
      });
      kids.push(el('h3', '', 'Launch readiness, 0–100'));
      kids.push(el('p', 'lead', '40 points for time listed with no token, 30 for how steady the 7-day growth is (a mild rise scores best, a spike or a fall scores less), and 30 for TVL durability, log-scaled from $100K to $1B. It is shown beside the value and does not change it.'));
      kids.push(el('p', 'lead', 'The board is the whole watchlist plus the largest protocols below ' + usd(D.floor_usd) + ' TVL that still have no token. Values are model estimates, not prices.'));
      void dl;
      box.replaceChildren(...kids);
      return;
    }
    const kids = [];
    const head = el('div', 'dhead');
    const h2 = el('h2', '', r.name);
    h2.title = r.name;
    head.append(h2);
    if (r.watch) { const b = el('span', 'badge', 'watchlist'); head.append(b); }
    kids.push(head);
    const sub = el('p', 'sub', (r.category || 'Uncategorised') + ' · ' + (r.chains.slice(0, 3).join(', ') || 'no chain') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + ' · rank ' + r.rank + ' of ' + D.rows.length);
    sub.title = (r.category || 'Uncategorised') + ' · ' + r.chains.join(', ');
    kids.push(sub);

    const big = el('div', 'big');
    big.append(el('span', 'n', usd(r.implied_value_usd)), el('span', 'l', 'implied value'), el('span', 'chip', mult(r.multiple) + ' TVL'));
    big.append(el('span', 'rangeTxt', usd(r.band_low_pct_usd) + ' – ' + usd(r.band_high_pct_usd)));
    kids.push(big);
    kids.push(el('p', 'whyline', r.why));

    // formula trace
    kids.push(el('h3', '', 'Formula trace'));
    const tr = el('div', 'trace');
    tr.append(
      term('--tvl', 'TVL', usd(r.tvl_usd), 'snapshot'), op('×'),
      term('--cat', 'category', r.f.category.toFixed(2), r.category || 'none'), op('×'),
      term('--gro', 'growth', r.f.growth.toFixed(2), pct(r.change_7d) + ' 7d'), op('×'),
      term('--age', 'age', r.f.age.toFixed(2), r.age_known ? ageText(r) : 'unknown'), op('×'),
      term('--thin', 'thin', r.f.thin.toFixed(2), r.f.thin < 1 ? '< ' + usd(P.thin_tvl_usd) : '≥ ' + usd(P.thin_tvl_usd)), op('='),
      term('--accent', 'implied', usd(r.implied_value_usd), mult(r.multiple) + ' TVL')
    );
    kids.push(tr);

    // band
    const span = r.band_high_pct_usd - r.band_low_pct_usd;
    const band = el('div', 'band');
    const bar = el('div', 'bar');
    const rng = el('div', 'rng');
    const mid = el('div', 'mid');
    mid.style.left = (span > 0 ? ((r.implied_value_usd - r.band_low_pct_usd) / span) * 100 : 50).toFixed(1) + '%';
    bar.append(rng, mid);
    const lab = el('div', 'lab');
    lab.append(el('span', '', 'low ' + usd(r.band_low_pct_usd)), el('span', '', '±' + r.band_pct + '% · ' + (r.band_pct === 15 ? 'thin TVL' : 'TVL ≥ ' + usd(P.thin_tvl_usd))), el('span', '', 'high ' + usd(r.band_high_pct_usd)));
    band.append(bar, lab);
    kids.push(band);

    // readiness
    const R = r.readiness;
    kids.push(el('h3', '', 'Launch readiness'));
    const rh = el('div', 'rhead');
    rh.append(el('b', 'rscore', String(R.score)), el('span', 'rof', '/ 100'));
    kids.push(rh);
    const seg = el('div', 'rseg');
    [
      ['--age', 'Age', R.age_pts, 40, ageText(r) + ' listed'],
      ['--gro', 'Persistence', R.persistence_pts, 30, pct(r.change_7d) + ' in 7d'],
      ['--dur', 'Durability', R.durability_pts, 30, usd(r.tvl_usd) + ' TVL'],
    ].forEach(([k, n, v, cap, note]) => {
      const s = el('div', 'seg');
      s.style.setProperty('--k', 'var(' + k + ')');
      s.style.flex = cap + ' 1 0';
      s.title = n + ' ' + v + ' of ' + cap + ' points (' + note + ')';
      const track = el('div', 'track');
      const f = el('i');
      f.style.width = ((v / cap) * 100).toFixed(0) + '%';
      track.append(f);
      s.append(track, el('div', 'sl', n + ' ' + v + '/' + cap), el('div', 'sn', note));
      seg.append(s);
    });
    kids.push(seg);

    // farm
    let time = 0, gasTotal = 0, capTotal = 0;
    r.steps.forEach((s) => { time += s.minutes; gasTotal += s.gas_usd; capTotal += s.capital_usd; });
    kids.push(el('h3', '', 'Farm plan · ' + r.steps.length + ' steps · ' + money(capTotal) + ' + ' + money(gasTotal) + ' gas · ' + mins(time)));
    const t = el('table', 'farm');
    const thead = el('thead');
    const hr = el('tr');
    [['Action', ''], ['Cost', 'num'], ['Time', 'num'], ['Risk', 'rk']].forEach(([h, c]) => hr.append(el('th', c, h)));
    thead.append(hr);
    const tbody = el('tbody');
    r.steps.forEach((s) => {
      const tr2 = el('tr');
      const costText = s.capital_usd > 0 ? money(s.capital_usd) + ' + ' + money(s.gas_usd) + ' gas' : s.gas_usd > 0 ? money(s.gas_usd) + ' gas' : '$0';
      const rk = el('td', 'rk');
      const pill = el('span', 'pill ' + s.risk.toLowerCase(), s.risk);
      pill.title = RISK_TIP[s.risk];
      rk.append(pill);
      tr2.append(el('td', 'a', s.action), el('td', 'c', costText), el('td', 't', mins(s.minutes)), rk);
      tbody.append(tr2);
    });
    const foot = el('tfoot');
    const fr = el('tr');
    fr.append(el('td', '', 'Total · deposits are returned on exit'), el('td', 'c', money(capTotal) + ' + ' + money(gasTotal)), el('td', 't', mins(time)), el('td', ''));
    foot.append(fr);
    t.append(thead, tbody, foot);
    kids.push(t);

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
    $('watch').checked = state.watch;
    head.querySelectorAll('th').forEach((th) => {
      th.setAttribute('aria-sort', th.dataset.key === state.sort ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    });
    const list = visible();
    renderRows(list);
    renderStrip(list);
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
